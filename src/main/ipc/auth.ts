'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app, ipcMain, safeStorage, dialog } = require('electron');
const { session, decryptEntry, resetIdleTimer, sweepOrphanTaskItems } = require('../session');
const {
  dbGet, dbAll, dbRun, dbInsert, persistDB, hasDb, closeDb, setDbFile,
  getSql, getDb, adoptDb, newDatabase,
} = require('../db');
const { readCache, invalidateEntriesCache } = require('../cache');
const { performBackup, setBackupDir } = require('../backups');
const { encrypt, decrypt, deriveKey, reEncryptVault: reEncryptVaultCore, migrateTimeEntries: migrateTimeEntriesCore } = require('../vault-crypto');
const { runScheduledEmailCheck, profileEmailMissing } = require('../email');
const { POMODORO_PRESETS } = require('../policies');
const betaKeys = require('../beta-keys');

// ctx: main-owned install/profile plumbing.
function register(ctx: Record<string, any>) {
  const {
    IS_DEV, PROFILES_DIR, BETA_SECRET,
    getAppPref, setAppPref,
    initProfileDB, writeManifest, readManifest,
  } = ctx;
// ── Beta-key gate ──────────────────────────────────────────────────────────
// Gate NEW installs only: a fresh machine (no profiles yet, no redeemed key)
// must enter a valid beta key before account setup. Existing installs (any
// profile already present) and dev runs are never gated.
function profilesExist() {
  if (IS_DEV || !PROFILES_DIR || !fs.existsSync(PROFILES_DIR)) return false;
  try {
    return fs.readdirSync(PROFILES_DIR)
      .some((name: any) => fs.existsSync(path.join(PROFILES_DIR, name, 'profile-manifest.json')));
  } catch { return false; }
}

function betaGateRequired() {
  if (IS_DEV || !BETA_SECRET) return false;          // dev / no-secret → open
  if (profilesExist()) return false;                  // existing install → grandfathered
  const stored = getAppPref('betaKey', null);         // already redeemed on this machine?
  if (stored && betaKeys.verifyKey(BETA_SECRET, stored).valid) return false;
  return true;
}

ipcMain.handle('beta:status', () => ({ required: betaGateRequired() }));

ipcMain.handle('beta:redeem', (_: unknown, key: any) => {
  if (!BETA_SECRET) return { ok: true };              // gate disabled → accept
  const res = betaKeys.verifyKey(BETA_SECRET, key);
  if (!res.valid) {
    const msg = res.reason === 'expired'
      ? `This beta key expired on ${res.expiry.toISOString().slice(0, 10)}.`
      : 'That beta key isn’t valid. Check for typos and try again.';
    return { ok: false, error: msg, reason: res.reason };
  }
  setAppPref('betaKey', String(key).trim());
  setAppPref('betaRedeemedAt', new Date().toISOString());
  return { ok: true, expiry: res.expiry.toISOString().slice(0, 10) };
});

// Thin wrapper over the testable core in ./vault-crypto. Injects the live SQL
// module + db handle, and adopts the handle the core returns — on a write-phase
// rollback that is a fresh instance restored from the pre-write snapshot, so the
// module-level `db` must be reassigned to it. Caller persists only when ok.
function reEncryptVault(opts: Record<string, any>) {
  const res = reEncryptVaultCore({ SQL: getSql(), db: getDb(), ...opts });
  adoptDb(res.db);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

function migrateTimeEntries() {
  if (!session.key || !session.user) return;
  try {
    const migrated = migrateTimeEntriesCore({ db: getDb(), key: session.key, userId: session.user.id });
    if (migrated > 0) { persistDB(); invalidateEntriesCache(); }
  } catch (e) { console.warn('[migrateTimeEntries] failed:', e.message); }
}

// ── IPC: Profiles ─────────────────────────────────────────────────────────
ipcMain.handle('profiles:list', () => {
  if (IS_DEV || !PROFILES_DIR || !fs.existsSync(PROFILES_DIR)) return [];
  try {
    return fs.readdirSync(PROFILES_DIR)
      .filter((name: any) => fs.existsSync(path.join(PROFILES_DIR, name, 'profile-manifest.json')))
      .map((name: any) => readManifest(path.join(PROFILES_DIR, name)))
      .filter(Boolean);
  } catch { return []; }
});

ipcMain.handle('profiles:select', async (_: unknown, { username }: Record<string, any>) => {
  // Dev mode: DB is already initialised at startup — nothing to create.
  if (IS_DEV) return { ok: true };
  if (!username || typeof username !== 'string') return { ok: false, error: 'Invalid username.' };
  const safeName  = username.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeName)  return { ok: false, error: 'Invalid username.' };
  const profileDir = path.join(PROFILES_DIR, safeName);
  // Guard: if folder + vault + user already exist, reject as duplicate
  if (fs.existsSync(path.join(profileDir, 'vault.db'))) {
    const tmpDb = newDatabase(fs.readFileSync(path.join(profileDir, 'vault.db')));
    const res   = tmpDb.exec('SELECT COUNT(*) FROM users');
    tmpDb.close();
    const count = res[0]?.values?.[0]?.[0] || 0;
    if (count > 0 && !fs.existsSync(path.join(profileDir, 'profile-manifest.json'))) {
      // Existing vault but no manifest — migrated profile, just load it
    } else if (count > 0) {
      return { ok: false, error: 'A profile with that username already exists.' };
    }
  }
  await initProfileDB(profileDir);
  const needsSetup = !dbGet('SELECT 1 FROM users LIMIT 1');
  return { ok: true, needsSetup };
});

ipcMain.handle('profiles:load', async (_: unknown, { username }: Record<string, any>) => {
  if (!username || typeof username !== 'string') return { ok: false, error: 'Invalid username.' };
  const safeName   = username.replace(/[^a-zA-Z0-9_\-]/g, '');
  const profileDir = path.join(PROFILES_DIR, safeName);
  if (!fs.existsSync(path.join(profileDir, 'vault.db')))
    return { ok: false, error: 'Profile not found.' };
  await initProfileDB(profileDir);
  return { ok: true, needsSetup: false };
});

ipcMain.handle('profiles:deselect', () => {
  closeDb();
  session.profileDir = null; setDbFile(null); setBackupDir(null);
  session.key = null; session.user = null;
  return { ok: true };
});

// Delete the currently-loaded profile. Called from the pre-auth settings
// modal — the profile must already be loaded via profiles:load (vault is
// open, but no session key yet).
//
// Intent gate, NOT an auth gate: the caller must send the profile's username
// (typed by the user) and it must match the loaded profile directory. The old
// password check was removed on purpose — a user who forgot their password
// AND lost their recovery code was permanently unable to delete their own
// locked-out profile, and the check added no real security (anyone with
// filesystem access can delete the encrypted vault dir directly; deletion
// discloses nothing). Do not reintroduce a password requirement here.
// Returns { ok, error } — on success the profile directory is removed from
// disk and the caller should navigate back to login (profile selector).
ipcMain.handle('profiles:delete', async (_: unknown, { confirmUsername }: Record<string, any>) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  try {
    const profileDir = session.profileDir;
    const dirName = profileDir ? path.basename(profileDir) : '';
    const typed   = String(confirmUsername || '').trim();
    if (!typed || typed.toLowerCase() !== dirName.toLowerCase())
      return { ok: false, error: 'Username does not match this profile.' };

    // Close DB and clear all session state before deleting files
    closeDb();
    session.profileDir = null; setDbFile(null); setBackupDir(null);
    session.key = null; session.user = null; session.activeEntryId = null;

    if (profileDir && fs.existsSync(profileDir))
      fs.rmSync(profileDir, { recursive: true, force: true });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: safeStorage fast-path (Windows Hello bridge) ─────────────────────
// safe_key.json lives in the profile directory alongside vault.db.
// It stores the vault session.key encrypted with Electron safeStorage (DPAPI
// on Windows), plus an AES-256-GCM canary to verify the key on decryption.
// Password + TOTP login is always available as a fallback — these handlers
// only add / verify / remove the fast-path layer.

const SAFE_KEY_FILENAME = 'safe_key.json';
function safeKeyPath() { return session.profileDir ? path.join(session.profileDir, SAFE_KEY_FILENAME) : null; }

// ── Device-bound recovery packet (auto-enrolled) ──────────────────────────
// recovery_key.json seals the vault key under safeStorage (DPAPI on Windows),
// same format as safe_key.json, but written AUTOMATICALLY on setup and every
// successful login — no opt-in, nothing to write down. It powers the
// "Forgot password?" reset on the login screen: DPAPI unseals the key on the
// same Windows user account (gated behind a Windows Hello / PIN prompt when
// available), then the vault is re-encrypted under the new password via the
// same reEncryptVault path the recovery-code reset uses. Device-bound by
// nature: the packet is useless on any other machine or Windows account, so
// the recovery code / backup restore remain the device-loss fallbacks.
const RECOVERY_KEY_FILENAME = 'recovery_key.json';
function recoveryKeyPath() { return session.profileDir ? path.join(session.profileDir, RECOVERY_KEY_FILENAME) : null; }

function sealKeyFile(filePath: string, key: Buffer) {
  const encKey = safeStorage.encryptString(key.toString('hex')).toString('base64');
  const canary = encrypt('conquered-time-v1', key); // { data, iv, tag }
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, key: encKey, canary }));
}

// Best-effort — a failed write must never break login. Also refreshes an
// existing safe_key.json (Hello fast-path) so both sealed files self-heal to
// the current vault key after any password change/reset. safe_key.json stays
// opt-in: it is only rewritten here if the user already enrolled it.
function refreshSealedKeyFiles(key: Buffer) {
  try {
    if (!session.profileDir || !safeStorage.isEncryptionAvailable()) return;
    sealKeyFile(recoveryKeyPath()!, key);
    const skPath = safeKeyPath();
    if (skPath && fs.existsSync(skPath)) sealKeyFile(skPath, key);
  } catch (e) { console.warn('[recovery] sealed key refresh failed:', e.message); }
}

ipcMain.handle('auth:safe-check', () => {
  const available = safeStorage.isEncryptionAvailable();
  const skPath    = safeKeyPath();
  const enrolled  = !!(skPath && fs.existsSync(skPath));
  return { available, enrolled };
});

ipcMain.handle('auth:safe-setup', async (_: unknown, { password }: Record<string, any>) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Secure sign-in is not available on this device.' };
  try {
    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, * FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'No account found in this profile.' };
    if (!bcrypt.compareSync(password, user.password_hash)) return { ok: false, error: 'Incorrect password.' };

    const key    = deriveKey(password, user.key_salt || user.totp_secret);
    const keyHex = key.toString('hex');
    const encKey = safeStorage.encryptString(keyHex).toString('base64');
    const canary = encrypt('conquered-time-v1', key); // { data, iv, tag }

    fs.writeFileSync(safeKeyPath(), JSON.stringify({ version: 1, key: encKey, canary }));

    // Record in manifest
    if (session.profileDir && !IS_DEV) {
      const manifest = readManifest(session.profileDir);
      if (manifest && !manifest.auth_methods.includes('safestorage')) {
        manifest.auth_methods.push('safestorage');
        writeManifest(session.profileDir, manifest);
      }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Triggers the Windows Hello / PIN consent dialog via WinRT UserConsentVerifier.
// Resolves to true if the user was verified, false if cancelled or not available.
// Returns 'Verified' | 'Cancelled' | 'NotAvailable' | 'Error'
function requestWindowsHelloConsent() {
  return new Promise((resolve) => {
    const ps = [
      '[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null',
      '$avail = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync().GetAwaiter().GetResult()',
      'if ($avail -ne "Available") { Write-Output "NotAvailable"; exit 0 }',
      '$result = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync("Conquered Time — verify your identity").GetAwaiter().GetResult()',
      'Write-Output $result.ToString()'
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-Sta', '-Command', ps], { timeout: 60000 }, (err: any, stdout: any, stderr: any) => {
      if (err) { console.error('Windows Hello PS error:', stderr || err.message); resolve('Error'); return; }
      resolve(stdout.trim() || 'Error');
    });
  });
}

ipcMain.handle('auth:safe-login', async () => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  const skPath = safeKeyPath();
  if (!skPath || !fs.existsSync(skPath)) return { ok: false, error: 'Secure sign-in not enrolled for this profile.' };
  try {
    // Show the Windows Hello biometric / PIN prompt before decrypting.
    // If Hello isn't configured on this device, skip it — DPAPI still protects the key.
    const helloResult = await requestWindowsHelloConsent();
    if (helloResult === 'Cancelled') return { ok: false, error: 'Verification cancelled — use password instead.' };
    if (helloResult === 'NotAvailable' || helloResult === 'Error') return { ok: false, quickUnlock: true };

    const stored = JSON.parse(fs.readFileSync(skPath, 'utf8'));
    const keyHex = safeStorage.decryptString(Buffer.from(stored.key, 'base64'));
    const key    = Buffer.from(keyHex, 'hex');

    // Verify the key is correct via the canary
    const canaryPlain = decrypt(stored.canary, key);
    if (canaryPlain !== 'conquered-time-v1') return { ok: false, error: 'Secure sign-in key mismatch — use password login.' };

    const user = dbGet('SELECT rowid as rid, * FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'No account found in this profile.' };

    session.key  = key;
    session.user = { id: Number(user.rid), username: user.username, display_name: user.display_name || null, work_state: null };
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const pd = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, key));
        session.user.work_state      = pd?.work_state || null;
        session.user.break_style     = pd?.break_style === 'pomodoro' ? 'pomodoro' : 'state';
        session.user.pomodoro_preset = pd?.pomodoro_preset || 'classic';
      } catch {}
    }
    dbRun('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    migrateTimeEntries();
    sweepOrphanTaskItems(); // C6 (D-012): stop orphaned running tasks/breaks
    refreshSealedKeyFiles(key); // auto-enroll / refresh device recovery packet
    // Catch up any scheduled report missed while the app was closed (session is
    // now available). Mirrors auth:login — without this, Quick Unlock / Windows
    // Hello sign-ins never run the on-launch schedule check.
    setTimeout(runScheduledEmailCheck, 5000);
    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: 'Secure sign-in failed — use password login.' }; }
});

ipcMain.handle('auth:quick-unlock', async (_: unknown, { password }: Record<string, any>) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  const skPath = safeKeyPath();
  if (!skPath || !fs.existsSync(skPath)) return { ok: false, error: 'Secure sign-in not enrolled.' };
  try {
    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, * FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'No account found.' };
    if (!bcrypt.compareSync(password, user.password_hash)) return { ok: false, error: 'Incorrect password.' };
    // Password verified — restore session key from safeStorage
    const stored = JSON.parse(fs.readFileSync(skPath, 'utf8'));
    const keyHex = safeStorage.decryptString(Buffer.from(stored.key, 'base64'));
    const key    = Buffer.from(keyHex, 'hex');
    const canaryPlain = decrypt(stored.canary, key);
    if (canaryPlain !== 'conquered-time-v1') return { ok: false, error: 'Key mismatch — use full login.' };
    session.key  = key;
    session.user = { id: Number(user.rid), username: user.username, display_name: user.display_name || null, work_state: null };
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const pd = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, key));
        session.user.work_state      = pd?.work_state || null;
        session.user.break_style     = pd?.break_style === 'pomodoro' ? 'pomodoro' : 'state';
        session.user.pomodoro_preset = pd?.pomodoro_preset || 'classic';
      } catch {}
    }
    dbRun('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    migrateTimeEntries();
    sweepOrphanTaskItems(); // C6 (D-012): stop orphaned running tasks/breaks
    refreshSealedKeyFiles(key); // auto-enroll / refresh device recovery packet
    // Catch up any scheduled report missed while the app was closed (session is
    // now available). Mirrors auth:login — without this, Quick Unlock / Windows
    // Hello sign-ins never run the on-launch schedule check.
    setTimeout(runScheduledEmailCheck, 5000);
    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:safe-disable', async (_: unknown, { password }: Record<string, any>) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  try {
    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, password_hash FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'No account found in this profile.' };
    if (!bcrypt.compareSync(password, user.password_hash)) return { ok: false, error: 'Incorrect password.' };

    const skPath = safeKeyPath();
    if (skPath && fs.existsSync(skPath)) fs.unlinkSync(skPath);

    // Remove from manifest
    if (session.profileDir && !IS_DEV) {
      const manifest = readManifest(session.profileDir);
      if (manifest) {
        manifest.auth_methods = manifest.auth_methods.filter((m: any) => m !== 'safestorage');
        writeManifest(session.profileDir, manifest);
      }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: Device-bound password reset ("Forgot password?") ─────────────────
ipcMain.handle('auth:reset-check', () => {
  const rkPath = recoveryKeyPath();
  const available = !!(hasDb() && rkPath && fs.existsSync(rkPath) && safeStorage.isEncryptionAvailable());
  return { available };
});

ipcMain.handle('auth:reset-password', async (_: unknown, { newPassword }: Record<string, any>) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  if (!newPassword || String(newPassword).length < 8)
    return { ok: false, error: 'Password must be at least 8 characters.' };
  const rkPath = recoveryKeyPath();
  if (!rkPath || !fs.existsSync(rkPath) || !safeStorage.isEncryptionAvailable())
    return { ok: false, error: 'Device recovery is not available for this profile.' };
  try {
    // Windows Hello / PIN gate. DPAPI alone would let anyone at an unlocked
    // Windows session reset the password silently; Hello adds a presence check.
    // NotAvailable/Error still proceeds — DPAPI already binds the packet to
    // this Windows account, and there is no password to fall back to here.
    const hello = await requestWindowsHelloConsent();
    if (hello === 'Cancelled') return { ok: false, error: 'Verification cancelled.' };

    const stored = JSON.parse(fs.readFileSync(rkPath, 'utf8'));
    const keyHex = safeStorage.decryptString(Buffer.from(stored.key, 'base64'));
    const oldKey = Buffer.from(keyHex, 'hex');
    if (decrypt(stored.canary, oldKey) !== 'conquered-time-v1')
      return { ok: false, error: 'Recovery data on this device is stale. Use your recovery code or restore a backup instead.' };

    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, * FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'No account found in this profile.' };
    const newKey = deriveKey(newPassword, user.key_salt || user.totp_secret);

    const res = reEncryptVault({
      oldKey, newKey, userId: Number(user.rid), user,
      onCommit: () => dbRun('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL WHERE rowid=?',
        [bcrypt.hashSync(newPassword, 12), Number(user.rid)]),
    });
    if (!res.ok) return res;

    // Reseal both device key files under the new vault key. Note: the
    // recovery-CODE packet (recovery_key_enc) cannot be resealed here — we
    // don't know the code — so it goes stale for future password resets
    // (the code still works for lockout unlock; a stale reset attempt fails
    // cleanly inside reEncryptVault's decrypt phase and rolls back).
    refreshSealedKeyFiles(newKey);
    persistDB(); performBackup();
    return { ok: true, passwordReset: true };
  } catch (e) { return { ok: false, error: 'Device reset failed: ' + e.message }; }
});

// ── IPC: Auth ──────────────────────────────────────────────────────────────
ipcMain.handle('auth:check-setup', () => {
  if (!hasDb()) return { needsSetup: true };
  const row = dbGet('SELECT COUNT(*) as c FROM users');
  return { needsSetup: (row?.c || 0) === 0 };
});

ipcMain.handle('auth:setup', async (_: unknown, { username, password, totpSecret, totpCode, recoveryCode }: Record<string, any>) => {
  try {
    const speakeasy = require('speakeasy');
    const bcrypt    = require('bcryptjs');
    const valid = speakeasy.totp.verify({ secret: totpSecret, encoding: 'base32', token: totpCode, window: 1 });
    if (!valid) return { ok: false, error: 'TOTP code invalid. Scan the QR again.' };
    const passwordHash = bcrypt.hashSync(password, 12);
    const recoveryHash = bcrypt.hashSync(recoveryCode, 12);
    // Generate a stable random salt for key derivation — stored permanently
    const keySalt = crypto.randomBytes(32).toString('hex');
    // Seal the session key under the recovery code so password reset can recover encrypted data
    const sessionKeyBuf   = deriveKey(password, keySalt);
    const recoveryKeySalt = crypto.randomBytes(32).toString('hex');
    const recoveryEncKey  = deriveKey(recoveryCode, recoveryKeySalt);
    const recoveryKeyBlob = encrypt(sessionKeyBuf.toString('hex'), recoveryEncKey);
    dbInsert(
      'INSERT INTO users (username, password_hash, totp_secret, totp_verified, recovery_hash, key_salt, recovery_key_enc, recovery_key_iv, recovery_key_tag, recovery_key_salt) VALUES (?,?,?,1,?,?,?,?,?,?)',
      [username, passwordHash, totpSecret, recoveryHash, keySalt, recoveryKeyBlob.data, recoveryKeyBlob.iv, recoveryKeyBlob.tag, recoveryKeySalt]
    );
    persistDB();
    refreshSealedKeyFiles(sessionKeyBuf); // auto-enroll device recovery packet at setup
    // Write profile manifest so the selector card appears on next launch
    if (session.profileDir && !IS_DEV) {
      writeManifest(session.profileDir, {
        username, display_name: username, avatar_thumb_48: null,
        created_at: Math.floor(Date.now() / 1000),
        auth_methods: ['password+totp'], key_derivation_version: 'pbkdf2-v1',
        passkey_credential_id: null
      });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:login', async (_: unknown, { username, password, totpCode }: Record<string, any>) => {
  try {
    const bcrypt    = require('bcryptjs');
    const speakeasy = require('speakeasy');
    const user = dbGet('SELECT rowid as rid, * FROM users WHERE username = ?', [username]);
    if (!user) return { ok: false, error: 'Invalid credentials.' };

    if (user.locked_until && Date.now() < user.locked_until) {
      const remaining = Math.ceil((user.locked_until - Date.now()) / 3600000);
      return { ok: false, locked: true, hoursRemaining: remaining };
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return { ok: false, error: 'Invalid credentials.', ...incrementFailed(user) };
    }

    // Dev mode: skip TOTP verification entirely — gated on IS_DEV so the bypass is
    // physically impossible in a packaged build, no matter what the vault says.
    const totpOk = (IS_DEV && user.dev_mode)
      ? true
      : speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });

    if (!totpOk) {
      const r = incrementFailed(user);
      return { ok: false, error: 'Invalid TOTP code.', ...r };
    }

    // Derive key from password + stored stable salt (never the rotating TOTP code)
    const salt  = user.key_salt || user.totp_secret;
    session.key  = deriveKey(password, salt);
    // Always use rowid — sql.js AUTOINCREMENT id columns return null through our query helper
    session.user = { id: Number(user.rid), username: user.username, display_name: user.display_name || null, work_state: null };
    dbRun('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();

    // Decrypt profile blob once to backfill avatar_thumb and extract work_state
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const profileData = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, session.key));
        session.user.work_state      = profileData?.work_state || null;
        session.user.break_style     = profileData?.break_style === 'pomodoro' ? 'pomodoro' : 'state';
        session.user.pomodoro_preset = profileData?.pomodoro_preset || 'classic';
        if (session.profileDir && !IS_DEV) {
          const manifest = readManifest(session.profileDir);
          if (manifest && !manifest.avatar_thumb_48 && profileData?.avatar) {
            writeManifest(session.profileDir, { ...manifest, avatar_thumb_48: profileData.avatar });
          }
        }
      } catch (e) { console.warn('[login] profile decrypt failed:', e.message); }
    }

    migrateTimeEntries();
    sweepOrphanTaskItems(); // C6 (D-012): stop orphaned running tasks/breaks

    // Auto-enroll / refresh the device-bound recovery packet (best-effort)
    refreshSealedKeyFiles(session.key);

    // Fire scheduled email check shortly after login (session now available)
    setTimeout(runScheduledEmailCheck, 5000);

    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: e.message }; }
});

function incrementFailed(user: Record<string, any>) {
  const attempts = (user.failed_attempts || 0) + 1;
  const uid = Number(user.rid || user.id);
  if (attempts >= 3) {
    const lockUntil = Date.now() + 86400000;
    dbRun('UPDATE users SET failed_attempts=?, locked_until=? WHERE rowid=?', [attempts, lockUntil, uid]);
    persistDB();
    return { locked: true, attemptsLeft: 0 };
  }
  dbRun('UPDATE users SET failed_attempts=? WHERE rowid=?', [attempts, uid]);
  persistDB();
  return { locked: false, attemptsLeft: 3 - attempts };
}

ipcMain.handle('auth:recover', async (_: unknown, { username, recoveryCode, newPassword }: Record<string, any>) => {
  const bcrypt = require('bcryptjs');
  const user   = dbGet('SELECT rowid as rid, * FROM users WHERE username=?', [username]);
  if (!user?.recovery_hash) return { ok: false, error: 'No recovery available.' };
  if (!bcrypt.compareSync(recoveryCode, user.recovery_hash)) return { ok: false, error: 'Invalid recovery code.' };

  // Path A — unlock only (no newPassword supplied)
  if (!newPassword) {
    dbRun('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    return { ok: true };
  }

  // Path B — full password reset using sealed recovery key packet
  if (!user.recovery_key_enc || !user.recovery_key_salt) {
    return { ok: false, noKeyPacket: true, error: 'Password reset via recovery code is only available for accounts created with this feature. You can still unlock your account, or restore from a backup.' };
  }
  try {
    const recoveryEncKey = deriveKey(recoveryCode, user.recovery_key_salt);
    const oldKeyHex      = decrypt({ data: user.recovery_key_enc, iv: user.recovery_key_iv, tag: user.recovery_key_tag }, recoveryEncKey);
    const oldKey         = Buffer.from(oldKeyHex, 'hex');
    const newKey         = deriveKey(newPassword, user.key_salt);

    const res = reEncryptVault({
      oldKey, newKey, userId: Number(user.rid), user,
      onCommit: () => dbRun('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL WHERE rowid=?',
        [bcrypt.hashSync(newPassword, 12), Number(user.rid)]),
    });
    if (!res.ok) return res;

    // Reseal the recovery-code packet under the NEW vault key — without this,
    // the packet still held the old key and a second recovery-code reset would
    // fail. Also refresh the DPAPI-sealed device key files.
    const newRecoverySalt = crypto.randomBytes(32).toString('hex');
    const newRecoveryBlob = encrypt(newKey.toString('hex'), deriveKey(recoveryCode, newRecoverySalt));
    dbRun('UPDATE users SET recovery_key_enc=?, recovery_key_iv=?, recovery_key_tag=?, recovery_key_salt=? WHERE rowid=?',
      [newRecoveryBlob.data, newRecoveryBlob.iv, newRecoveryBlob.tag, newRecoverySalt, Number(user.rid)]);
    refreshSealedKeyFiles(newKey);

    persistDB(); performBackup();
    return { ok: true, passwordReset: true };
  } catch(e) { return { ok: false, error: 'Recovery failed: ' + e.message }; }
});

// Rotate the recovery code from an active session (Settings → Security →
// Account Recovery). For users who lost their code: generates a fresh one,
// re-hashes it, and re-seals the CURRENT vault key under it — the old code
// stops working for resets/unlocks immediately. Password-gated so a stranger
// at an unlocked app can't silently swap the code. Returns the plaintext code
// once (renderer shows it + offers auth:save-recovery-file).
ipcMain.handle('auth:regenerate-recovery', async (_: unknown, { password }: Record<string, any>) => {
  if (!session.key || !session.user) return { ok: false, error: 'No active session.' };
  try {
    const bcrypt = require('bcryptjs');
    const user = dbGet('SELECT rowid as rid, password_hash FROM users WHERE rowid=?', [session.user.id]);
    if (!user) return { ok: false, error: 'User not found.' };
    if (!bcrypt.compareSync(password, user.password_hash))
      return { ok: false, error: 'Incorrect password.' };

    // Same charset/format as the setup-screen generator (no I/O/0/1)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
    const code = `${seg()}-${seg()}-${seg()}-${seg()}`;

    const recoveryKeySalt = crypto.randomBytes(32).toString('hex');
    const blob = encrypt(session.key.toString('hex'), deriveKey(code, recoveryKeySalt));
    dbRun('UPDATE users SET recovery_hash=?, recovery_key_enc=?, recovery_key_iv=?, recovery_key_tag=?, recovery_key_salt=? WHERE rowid=?',
      [bcrypt.hashSync(code, 12), blob.data, blob.iv, blob.tag, recoveryKeySalt, session.user.id]);
    persistDB();
    return { ok: true, recoveryCode: code };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Save the just-generated recovery code as a downloadable file (setup screen,
// or Settings → Security right after auth:regenerate-recovery — the only
// moments the plaintext code exists). Nothing secret is
// read from any vault; the renderer passes the code it just generated. The
// file is deliberately plain text: it must be readable in ten years on any
// machine, and the code alone is useless without the vault files + TOTP device.
ipcMain.handle('auth:save-recovery-file', async (_: unknown, { username, recoveryCode }: Record<string, any>) => {
  const code = String(recoveryCode || '').trim();
  if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code))
    return { ok: false, error: 'Invalid recovery code.' };
  const safeName = String(username || 'account').replace(/[^a-zA-Z0-9_\-]/g, '') || 'account';
  const res = await dialog.showSaveDialog({
    title: 'Save Recovery File',
    defaultPath: path.join(app.getPath('documents'), `Conquered Time Recovery - ${safeName}.txt`),
    filters: [{ name: 'Text File', extensions: ['txt'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const body = [
      'CONQUERED TIME — ACCOUNT RECOVERY FILE',
      '======================================',
      '',
      `Profile:       ${safeName}`,
      `Created:       ${new Date().toISOString().slice(0, 10)}`,
      '',
      `Recovery code: ${code}`,
      '',
      'Keep this file somewhere OFF this computer — a cloud drive',
      '(Google Drive, OneDrive, Dropbox) or a USB stick. It is your',
      'way back in if this device is lost or Windows is reinstalled.',
      '',
      'To use it: open Conquered Time -> Recovery tab ->',
      '"Unlock account" or "Reset my password" and enter the code.',
      '',
      'This code cannot open your data by itself — it only works',
      'inside the app against your encrypted vault.',
      '',
    ].join('\r\n');
    fs.writeFileSync(res.filePath, body);
    return { ok: true, path: res.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('totp:generate', async () => {
  const speakeasy = require('speakeasy');
  const qrcode    = require('qrcode');
  const secret = speakeasy.generateSecret({ name: 'Conquered Time', length: 20 });
  const qrUrl  = await qrcode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrUrl };
});

// ── IPC: User Profile ─────────────────────────────────────────────────────
ipcMain.handle('profile:get', () => {
  if (!session.key || !session.user) return null;
  const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [session.user.id]);
  if (!user) return null;
  let profileData = { full_name: '', email: '', phone: '', job_title: '', avatar: null };
  if (user.profile_enc && user.profile_iv && user.profile_tag) {
    try {
      profileData = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, session.key));
    } catch {}
  }
  return { display_name: user.display_name || '', ...profileData };
});

ipcMain.handle('profile:save', (_: unknown, { display_name, full_name, email, phone, job_title, work_state, break_style, pomodoro_preset, avatar, avatar_thumb_48, business_name, business_address, business_email, tax_id, payment_instructions, default_currency }: Record<string, any>) => {
  if (!session.key || !session.user) return { ok: false };
  try {
    // Normalize break prefs: only 'pomodoro' opts out of state-policy warnings,
    // and the preset must be a known key (unknown → classic).
    const breakStyle = break_style === 'pomodoro' ? 'pomodoro' : 'state';
    const pomoPreset = POMODORO_PRESETS[pomodoro_preset] ? pomodoro_preset : 'classic';
    // Billing identity (invoice "Bill From"). Currency normalized to a 3-letter
    // uppercase ISO code, defaulting to USD.
    const currency = String(default_currency || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';
    const blob = encrypt(JSON.stringify({ full_name: full_name || '', email: email || '', phone: phone || '', job_title: job_title || '', work_state: work_state || null, break_style: breakStyle, pomodoro_preset: pomoPreset, avatar: avatar || null, business_name: business_name || '', business_address: business_address || '', business_email: business_email || '', tax_id: tax_id || '', payment_instructions: payment_instructions || '', default_currency: currency }), session.key);
    dbRun('UPDATE users SET display_name=?, profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?',
      [display_name || null, blob.data, blob.iv, blob.tag, session.user.id]);
    session.user.display_name    = display_name || null;
    session.user.work_state      = work_state   || null;
    session.user.break_style     = breakStyle;
    session.user.pomodoro_preset = pomoPreset;
    persistDB();
    // Keep profile selector card in sync
    if (session.profileDir && !IS_DEV) {
      const existing = readManifest(session.profileDir) || {};
      writeManifest(session.profileDir, {
        ...existing,
        display_name: display_name || existing.username || '',
        avatar_thumb_48: avatar_thumb_48 || existing.avatar_thumb_48 || null
      });
    }
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:change-password', async (_: unknown, { currentPassword, totpCode, newPassword }: Record<string, any>) => {
  if (!session.key || !session.user) return { ok: false, error: 'No active session.' };
  const bcrypt    = require('bcryptjs');
  const speakeasy = require('speakeasy');
  const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [session.user.id]);
  if (!user) return { ok: false, error: 'User not found.' };
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return { ok: false, error: 'Current password is incorrect.' };
  const totpOk = (IS_DEV && user.dev_mode) ? true :
    speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });
  if (!totpOk) return { ok: false, error: 'Invalid TOTP code.' };

  const newKey = deriveKey(newPassword, user.key_salt);

  const res = reEncryptVault({
    oldKey: session.key, newKey, userId: session.user.id, user,
    onCommit: () => dbRun('UPDATE users SET password_hash=? WHERE rowid=?',
      [bcrypt.hashSync(newPassword, 12), session.user.id]),
  });
  if (!res.ok) return res;

  session.key = newKey;
  refreshSealedKeyFiles(newKey); // keep device recovery + Hello fast-path in sync
  persistDB(); performBackup();
  return { ok: true };
});
}

module.exports = { register };
