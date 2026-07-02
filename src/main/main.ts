'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, screen, safeStorage } = require('electron');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const { execFile } = require('child_process');
const { encrypt, decrypt, deriveKey, reEncryptVault: reEncryptVaultCore, migrateTimeEntries: migrateTimeEntriesCore } = require('./vault-crypto');
const { createReadCache } = require('./read-cache');
const {
  loadSqlJs, getSql, newDatabase,
  openDb, replaceDb, closeDb, hasDb, getDb, adoptDb,
  setDbFile, getDbFile, persistDB,
  dbGet, dbAll, dbRun, dbInsert,
} = require('./db');
const { BREAK_POLICIES, STATE_POLICY, STATE_NAMES, getPolicy, requiredBreaks } = require('./policies');
const {
  session, initSession, decryptEntry,
  lockSession, clearIdleTimer, resetIdleTimer, sweepOrphanTaskItems,
} = require('./session');
const { getDismissedSet, countAuditDiscrepancies } = require('./audit');
const { setBackupDir, getBackupDir, performBackup } = require('./backups');
const {
  initEmail, getProfileEmail, profileEmailMissing, getEmailSmtpConfig,
  doSendReport, computeNextSendDate, runScheduledEmailCheck,
} = require('./email');
const { rowHasContent } = require('../renderer/row-utils'); // shared "is this row real?" predicate (C3)
const betaKeys = require('./beta-keys');

// Beta-key signing secret — private, gitignored, bundled into builds. If the
// file is absent (e.g. a fresh clone), the gate fails OPEN (disabled) so the
// app still runs; a missing secret must never brick the app.
let BETA_SECRET = null;
try { BETA_SECRET = require('../shared/beta-secret'); }
catch { console.warn('[beta] beta-secret.js not found — beta-key gate disabled.'); }

// ── Single instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── Source paths ────────────────────────────────────────────────────────────
// The compiled main process runs from dist-main/main/, but the renderer pages
// stay plain JS under src/renderer (loaded straight by loadFile — no build).
// Resolve them from the app root — the project dir in dev, the asar root when
// packaged — instead of __dirname-relative hops that would land in dist-main.
const RENDERER_DIR = path.join(app.getAppPath(), 'src', 'renderer');

// ── Data paths ─────────────────────────────────────────────────────────────
// --dev flag: uses ./dev-data/dev-vault.db; skips profile selector entirely.
// Production: each user lives in conquered-data/profiles/<username>/vault.db.
// --dev is honored only in an unpackaged (developer) run. A shipped build must
// never drop into the dev-data sandbox just because someone passed --dev.
const IS_DEV        = process.argv.includes('--dev') && !app.isPackaged;
// True when the OS launched us via the login item (it passes --startup; see
// loginItemOpts). Lets "start minimized to tray" apply only to auto-launches,
// never to a manual open.
const STARTED_AT_LOGIN = process.argv.includes('--startup');
const ROOT_DATA_DIR = IS_DEV
  ? path.join(__dirname, '..', '..', 'dev-data')
  : path.join(app.getPath('userData'), 'conquered-data');
const PROFILES_DIR  = IS_DEV ? null : path.join(ROOT_DATA_DIR, 'profiles');

// Mutable — set when a profile is selected via profiles:select (or auto-set in dev)
// The vault file path itself lives in ./db (setDbFile/getDbFile) next to the handle.
let ACTIVE_PROFILE_DIR = IS_DEV ? ROOT_DATA_DIR : null;
setBackupDir(IS_DEV ? path.join(ROOT_DATA_DIR, 'backups') : null);
setDbFile(IS_DEV ? path.join(ROOT_DATA_DIR, 'dev-vault.db') : null);

fs.mkdirSync(ROOT_DATA_DIR, { recursive: true });
if (IS_DEV) fs.mkdirSync(getBackupDir(), { recursive: true });

// ── App-global prefs ───────────────────────────────────────────────────────
// Settings that describe how the APP behaves around the OS (not a profile's
// data): close-to-tray, etc. Stored in one JSON file next to the profiles so
// main can read them with no profile/vault loaded (e.g. on the login screen or
// at window-close before any sign-in). Launch-at-startup is NOT stored here —
// the OS login item (app.getLoginItemSettings) is its own source of truth.
const APP_PREFS_FILE = path.join(ROOT_DATA_DIR, 'app-prefs.json');
function readAppPrefs() {
  try { return JSON.parse(fs.readFileSync(APP_PREFS_FILE, 'utf8')); } catch { return {}; }
}
function getAppPref(key, dflt) {
  const v = readAppPrefs()[key];
  return v === undefined ? dflt : v;
}
function setAppPref(key, val) {
  const p = readAppPrefs();
  p[key] = val;
  try { fs.writeFileSync(APP_PREFS_FILE, JSON.stringify(p, null, 2)); }
  catch (e) { console.error('[app-prefs] write failed:', e.message); }
}

// ── Beta-key gate ──────────────────────────────────────────────────────────
// Gate NEW installs only: a fresh machine (no profiles yet, no redeemed key)
// must enter a valid beta key before account setup. Existing installs (any
// profile already present) and dev runs are never gated.
function profilesExist() {
  if (IS_DEV || !PROFILES_DIR || !fs.existsSync(PROFILES_DIR)) return false;
  try {
    return fs.readdirSync(PROFILES_DIR)
      .some(name => fs.existsSync(path.join(PROFILES_DIR, name, 'profile-manifest.json')));
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

ipcMain.handle('beta:redeem', (_, key) => {
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

// ── In-memory session state ────────────────────────────────────────────────
// session.key / session.user / session.session.activeEntryId + the idle-lock timer
// live in ./session (imported above); mutate through that shared object only.
let mainWindow  = null;
let forceClose   = false;  // set true after user confirms close through audit prompt
let tray         = null;   // system tray icon (created on whenReady)
let isQuitting   = false;  // set true when the user really means to quit (tray/menu Quit)

// Wire the acyclic deps: session needs the window, the audit count, and the
// renderer dir (for the lock navigation); email needs the window for toasts.
initSession({
  getMainWindow: () => mainWindow,
  countAuditDiscrepancies,
  rendererDir: RENDERER_DIR,
});
initEmail({ getMainWindow: () => mainWindow });

// Memoizes decrypted session-wide reads (companies:list / entries:all /
// entries:summary) across page navigations — see read-cache.js. Keyed on
// session.user.id; mutations invalidate, session resets clear().
const readCache = createReadCache();
// Cache owner token. NOTE: session.user.id is the user's rowid, which is 1 in
// every profile vault — so it alone can't tell two profiles apart. Compose it
// with ACTIVE_PROFILE_DIR (unique per profile) so switching profiles changes
// the owner and the cache auto-clears before serving another profile's data.
const cacheOwner = () => `${ACTIVE_PROFILE_DIR}#${session.user && session.user.id}`;
// Both entry views (full + summary) go stale together — mirrors the renderer
// Store's coupled invalidation (store.js).
const invalidateEntriesCache = () => readCache.invalidate('entriesAll', 'entriesSummary');

// ── Profile manifest helpers ───────────────────────────────────────────────
function writeManifest(profileDir, data) {
  fs.writeFileSync(path.join(profileDir, 'profile-manifest.json'), JSON.stringify(data, null, 2));
}

function readManifest(profileDir) {
  try { return JSON.parse(fs.readFileSync(path.join(profileDir, 'profile-manifest.json'), 'utf8')); }
  catch { return null; }
}

// Read a single app_settings value without requiring an active session.
// In dev mode (db already loaded), reads directly. In prod, peeks into the
// first available profile's vault to pull startup prefs (theme, window pos).
function readStartupSetting(key) {
  if (hasDb()) {
    const row = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
    return row?.value ?? null;
  }
  if (!PROFILES_DIR || !fs.existsSync(PROFILES_DIR)) return null;
  const dirs = fs.readdirSync(PROFILES_DIR).filter(
    n => fs.existsSync(path.join(PROFILES_DIR, n, 'vault.db'))
  );
  if (!dirs.length) return null;
  try {
    const buf  = fs.readFileSync(path.join(PROFILES_DIR, dirs[0], 'vault.db'));
    const tmpDb = newDatabase(buf);
    const res   = tmpDb.exec(`SELECT value FROM app_settings WHERE key='${key.replace(/'/g, "''")}'`);
    tmpDb.close();
    return res[0]?.values?.[0]?.[0] ?? null;
  } catch { return null; }
}

// ── Migration: legacy flat vault.db → profiles/<username>/vault.db ─────────
function migrateFromLegacyVault() {
  const legacyDb = path.join(ROOT_DATA_DIR, 'vault.db');
  if (!fs.existsSync(legacyDb) || fs.existsSync(PROFILES_DIR)) return;
  try {
    const buf   = fs.readFileSync(legacyDb);
    const tmpDb = newDatabase(buf);
    const res   = tmpDb.exec('SELECT username FROM users LIMIT 1');
    tmpDb.close();
    if (!res.length || !res[0].values.length) return;
    const username   = res[0].values[0][0];
    const profileDir = path.join(PROFILES_DIR, username);
    fs.mkdirSync(path.join(profileDir, 'backups'), { recursive: true });
    fs.renameSync(legacyDb, path.join(profileDir, 'vault.db'));
    writeManifest(profileDir, {
      username, display_name: username, avatar_thumb_48: null,
      created_at: Math.floor(Date.now() / 1000),
      auth_methods: ['password+totp'], key_derivation_version: 'pbkdf2-v1',
      passkey_credential_id: null
    });
  } catch (e) { console.error('[migrate] Legacy vault migration failed:', e.message); }
}

// ── sql.js init ────────────────────────────────────────────────────────────
async function initProfileDB(profileDir) {
  ACTIVE_PROFILE_DIR = profileDir;
  const dbFile = path.join(profileDir, IS_DEV ? 'dev-vault.db' : 'vault.db');
  setDbFile(dbFile);
  setBackupDir(path.join(profileDir, 'backups'));
  fs.mkdirSync(getBackupDir(), { recursive: true });

  await loadSqlJs();

  openDb(fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : undefined);

  dbRun(`PRAGMA foreign_keys = ON;`);

  dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT    NOT NULL UNIQUE,
      password_hash   TEXT    NOT NULL,
      totp_secret     TEXT    NOT NULL,
      totp_verified   INTEGER NOT NULL DEFAULT 0,
      recovery_hash   TEXT,
      key_salt        TEXT,
      dev_mode        INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS companies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      data_enc   TEXT    NOT NULL,
      data_iv    TEXT    NOT NULL,
      data_tag   TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      company_id    INTEGER NOT NULL REFERENCES companies(id),
      log_date      TEXT    NOT NULL,
      session_label TEXT,
      rows_json     TEXT    NOT NULL,
      total_mins    INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS task_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      entry_id      INTEGER NOT NULL,
      label         TEXT    NOT NULL,
      item_type     TEXT    NOT NULL DEFAULT 'task',
      started_at    INTEGER NOT NULL,
      stopped_at    INTEGER,
      duration_secs INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS audit_dismissed (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      row_idx  INTEGER NOT NULL,
      type     TEXT    NOT NULL,
      UNIQUE(user_id, entry_id, row_idx, type)
    );
  `);

  // audit_dismissed: emailed_at marks discrepancies the user was emailed about
  // (acknowledged) — silenced on close like a dismiss, but kept visible in the log.
  try { dbRun('ALTER TABLE audit_dismissed ADD COLUMN emailed_at INTEGER'); } catch {}

  // time_entries encryption columns
  try { dbRun('ALTER TABLE time_entries ADD COLUMN rows_enc TEXT'); } catch {}
  try { dbRun('ALTER TABLE time_entries ADD COLUMN rows_iv  TEXT'); } catch {}
  try { dbRun('ALTER TABLE time_entries ADD COLUMN rows_tag TEXT'); } catch {}

  // Profile column migrations — safe to run on every startup
  try { dbRun('ALTER TABLE users ADD COLUMN display_name TEXT'); } catch {}
  try { dbRun('ALTER TABLE users ADD COLUMN profile_enc  TEXT'); } catch {}
  try { dbRun('ALTER TABLE users ADD COLUMN profile_iv   TEXT'); } catch {}
  try { dbRun('ALTER TABLE users ADD COLUMN profile_tag  TEXT'); } catch {}
  // Recovery key packet — seals the session key under the recovery code so password reset is possible
  try { dbRun('ALTER TABLE users ADD COLUMN recovery_key_enc  TEXT'); } catch {}
  try { dbRun('ALTER TABLE users ADD COLUMN recovery_key_iv   TEXT'); } catch {}
  try { dbRun('ALTER TABLE users ADD COLUMN recovery_key_tag  TEXT'); } catch {}
  try { dbRun('ALTER TABLE users ADD COLUMN recovery_key_salt TEXT'); } catch {}

  // Belt-and-suspenders: dev_mode must never be honored in a packaged build.
  // The TOTP bypass is already gated on IS_DEV (so a stray flag can't skip TOTP),
  // but scrub the flag from the vault too so it can't linger or mislead. Self-heals
  // a vault that somehow carries dev_mode=1 into production (corruption, a seed run
  // pointed at a real profile, hand-tampering).
  if (app.isPackaged) {
    try {
      const stray = dbGet('SELECT COUNT(*) AS n FROM users WHERE dev_mode=1');
      if (stray && stray.n > 0) {
        console.warn(`[security] Scrubbing dev_mode flag from ${stray.n} user row(s) in a packaged build.`);
        dbRun('UPDATE users SET dev_mode=0 WHERE dev_mode=1');
      }
    } catch (e) { console.error('[security] dev_mode scrub failed:', e.message); }
  }

  persistDB();
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────
// encrypt / decrypt / deriveKey live in ./vault-crypto (imported above) so they
// can be unit-tested without Electron. Do not redefine them here.
// decryptEntry (session-key decryption of rows_json) lives in ./session.
// performBackup + the backups/ dir live in ./backups.

// Thin wrapper over the testable core in ./vault-crypto. Injects the live SQL
// module + db handle, and adopts the handle the core returns — on a write-phase
// rollback that is a fresh instance restored from the pre-write snapshot, so the
// module-level `db` must be reassigned to it. Caller persists only when ok.
function reEncryptVault(opts) {
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

// ── Window ─────────────────────────────────────────────────────────────────
function createSplashWindow(theme) {
  const splash = new BrowserWindow({
    width: 600, height: 400,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#0a0c12',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });
  splash.loadFile(path.join(RENDERER_DIR, 'pages/splash.html'), {
    query: { theme: theme || 'zanarkand' }
  });
  return splash;
}

function createAuditWizardWindow(mode, theme) {
  const wizard = new BrowserWindow({
    width: 680, height: 520,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#0d0f14',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    }
  });
  wizard.loadFile(path.join(RENDERER_DIR, 'pages/audit-wizard.html'), {
    query: { mode: mode || 'fix', theme: theme || 'arctic' }
  });
  wizard.on('closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('audit:wizard-done');
    }
  });
  return wizard;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0d0f14',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      webSecurity:      true
    }
  });
  buildMenu();
  mainWindow.loadFile(path.join(RENDERER_DIR, 'pages/login.html'));
  mainWindow.on('close', (event) => {
    // Close-to-tray: hide the window instead of quitting, keeping the session alive.
    // Bypassed when the user explicitly quits (tray/menu Quit set isQuitting).
    if (!isQuitting && tray && getAppPref('closeToTray', false) === true) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    if (session.user && !forceClose) {
      const count = countAuditDiscrepancies();
      if (count > 0) {
        event.preventDefault();
        mainWindow.webContents.send('audit:close-warning', { count, action: 'close' });
        return;
      }
    }
    forceClose = false;
    clearIdleTimer(); persistDB(); performBackup();
    session.key = null; session.user = null;
  });
}

function buildMenu() {
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    { label: 'File', submenu: [
      // Wrapped: Electron invokes click with (menuItem, window, event), and a bare
      // `click: lockSession` fed the MenuItem into skipAuditCheck — truthy — so
      // menu/Ctrl+L locking silently bypassed the audit-discrepancy warning.
      { label: 'Lock Session',   accelerator: 'CmdOrCtrl+L', click: () => lockSession() },
      { type: 'separator' },
      { label: 'Export PDF...',  accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('menu:export-pdf') },
      { label: 'Export CSV...',  click: () => mainWindow.webContents.send('menu:export-csv') },
      { type: 'separator' },
      { label: 'Backup Now',     click: () => { persistDB(); performBackup(); mainWindow.webContents.send('toast', { msg: 'Backup saved.', type: 'success' }); } },
      { type: 'separator' },
      { label: 'Quit',           accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } }
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
      { label: 'Dashboard',    click: () => navigate('dashboard') },
      { label: 'Time Tracker', click: () => navigate('tracker') },
      { label: 'Companies',    click: () => navigate('companies') },
      { type: 'separator' },
      { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
    ]},
    { label: 'About', submenu: [
      { label: 'Conquered Time v1.0.0', enabled: false }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── System tray ─────────────────────────────────────────────────────────────
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.ico'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Conquered Time');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Conquered Time', click: showMainWindow },
    { type: 'separator' },
    { label: 'Lock Session', click: () => { showMainWindow(); lockSession(); } },
    { label: 'Backup Now',   click: () => { persistDB(); performBackup(); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', { msg: 'Backup saved.', type: 'success' }); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

// ── Launch at startup ───────────────────────────────────────────────────────
// Registers/clears the OS login item. In a packaged build process.execPath is the
// installed Conquered Time .exe; in dev it's electron.exe (registers the dev binary).
// Login-item path/args. Unpackaged: process.execPath is electron.exe, which with
// no args opens the default Electron shell (no app, no tray) — so pass the app
// path. The SAME opts must be used to read back, or Windows' getLoginItemSettings
// won't match the entry and reports openAtLogin:false. Packaged: execPath IS the
// real app exe and needs no args.
function loginItemOpts(extra?: object) {
  // --startup lets the launched instance know it was auto-started (vs manual),
  // so "start minimized to tray" can apply only then. The same args are used to
  // read the item back, so the marker doesn't break openAtLogin detection.
  const o = app.isPackaged
    ? { args: ['--startup'] }
    : { path: process.execPath, args: [app.getAppPath(), '--startup'] };
  return Object.assign(o, extra);
}
function applyLaunchAtStartup(enabled) {
  try {
    app.setLoginItemSettings(loginItemOpts({ openAtLogin: !!enabled }));
  } catch (e) {
    console.error('[startup] setLoginItemSettings failed:', e.message);
  }
}

function navigate(page) {
  if (!session.user && page !== 'login') return;
  mainWindow.loadFile(path.join(RENDERER_DIR, `pages/${page}.html`));
}

// Break/lunch policy tiers live in ./policies (imported above) — pure data,
// unit-testable without Electron.

// Session state + idle lock live in ./session; the audit engine in ./audit.

// ── IPC: Window controls ───────────────────────────────────────────────────
ipcMain.on('win:minimize', () => mainWindow.minimize());
ipcMain.on('win:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win:close',    () => mainWindow.close());
ipcMain.on('shell:open-external', (_, url) => {
  const { shell } = require('electron');
  // Only allow http/https URLs to prevent protocol abuse
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('win:get-displays', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id:        d.id,
    index:     i + 1,
    isPrimary: d.id === primary.id,
    width:     d.bounds.width,
    height:    d.bounds.height,
  }));
});

ipcMain.handle('win:move-to-display', (_, displayId) => {
  const displays = screen.getAllDisplays();
  const target = displayId === 'primary'
    ? screen.getPrimaryDisplay()
    : (displays.find(d => d.id === Number(displayId)) || screen.getPrimaryDisplay());
  // Windows ignores setPosition() on a maximized window — must unmaximize first,
  // reposition, then re-maximize so Electron targets the correct display.
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setPosition(target.bounds.x + 10, target.bounds.y + 10);
  mainWindow.maximize();
  return { ok: true };
});
ipcMain.handle('win:set-launch-at-startup', (_, enabled) => {
  applyLaunchAtStartup(enabled);
  return { ok: true };
});
// Source of truth is the OS login item itself — no app storage needed. Read with
// the same opts used to register, or Windows won't match the entry (see loginItemOpts).
ipcMain.handle('win:get-launch-at-startup', () => {
  try { return app.getLoginItemSettings(loginItemOpts()).openAtLogin === true; } catch { return false; }
});
ipcMain.handle('win:get-close-to-tray', () => getAppPref('closeToTray', false) === true);
ipcMain.handle('win:set-close-to-tray', (_, enabled) => {
  setAppPref('closeToTray', !!enabled);
  return { ok: true };
});
ipcMain.handle('win:get-start-minimized', () => getAppPref('startMinimized', false) === true);
ipcMain.handle('win:set-start-minimized', (_, enabled) => {
  setAppPref('startMinimized', !!enabled);
  return { ok: true };
});
ipcMain.on('navigate',     (_, page) => navigate(page));

// ── IPC: Profiles ─────────────────────────────────────────────────────────
ipcMain.handle('profiles:list', () => {
  if (IS_DEV || !PROFILES_DIR || !fs.existsSync(PROFILES_DIR)) return [];
  try {
    return fs.readdirSync(PROFILES_DIR)
      .filter(name => fs.existsSync(path.join(PROFILES_DIR, name, 'profile-manifest.json')))
      .map(name => readManifest(path.join(PROFILES_DIR, name)))
      .filter(Boolean);
  } catch { return []; }
});

ipcMain.handle('profiles:select', async (_, { username }) => {
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

ipcMain.handle('profiles:load', async (_, { username }) => {
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
  ACTIVE_PROFILE_DIR = null; setDbFile(null); setBackupDir(null);
  session.key = null; session.user = null;
  return { ok: true };
});

// Delete the currently-loaded profile after verifying the user's password.
// Called from the pre-auth settings modal — the profile must already be loaded
// via profiles:load (vault is open, but no session key yet).
// Returns { ok, error } — on success the profile directory is removed from disk
// and the caller should navigate back to login (profile selector).
ipcMain.handle('profiles:delete', async (_, { password }) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  try {
    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, password_hash FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'Profile has no account — cannot verify.' };
    if (!bcrypt.compareSync(password, user.password_hash))
      return { ok: false, error: 'Incorrect password.' };

    const profileDir = ACTIVE_PROFILE_DIR;

    // Close DB and clear all session state before deleting files
    closeDb();
    ACTIVE_PROFILE_DIR = null; setDbFile(null); setBackupDir(null);
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
function safeKeyPath() { return ACTIVE_PROFILE_DIR ? path.join(ACTIVE_PROFILE_DIR, SAFE_KEY_FILENAME) : null; }

ipcMain.handle('auth:safe-check', () => {
  const available = safeStorage.isEncryptionAvailable();
  const skPath    = safeKeyPath();
  const enrolled  = !!(skPath && fs.existsSync(skPath));
  return { available, enrolled };
});

ipcMain.handle('auth:safe-setup', async (_, { password }) => {
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
    if (ACTIVE_PROFILE_DIR && !IS_DEV) {
      const manifest = readManifest(ACTIVE_PROFILE_DIR);
      if (manifest && !manifest.auth_methods.includes('safestorage')) {
        manifest.auth_methods.push('safestorage');
        writeManifest(ACTIVE_PROFILE_DIR, manifest);
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
    execFile('powershell.exe', ['-NoProfile', '-Sta', '-Command', ps], { timeout: 60000 }, (err, stdout, stderr) => {
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
        session.user.work_state = pd?.work_state || null;
      } catch {}
    }
    dbRun('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    migrateTimeEntries();
    sweepOrphanTaskItems(); // C6 (D-012): stop orphaned running tasks/breaks
    // Catch up any scheduled report missed while the app was closed (session is
    // now available). Mirrors auth:login — without this, Quick Unlock / Windows
    // Hello sign-ins never run the on-launch schedule check.
    setTimeout(runScheduledEmailCheck, 5000);
    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: 'Secure sign-in failed — use password login.' }; }
});

ipcMain.handle('auth:quick-unlock', async (_, { password }) => {
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
        session.user.work_state = pd?.work_state || null;
      } catch {}
    }
    dbRun('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    migrateTimeEntries();
    sweepOrphanTaskItems(); // C6 (D-012): stop orphaned running tasks/breaks
    // Catch up any scheduled report missed while the app was closed (session is
    // now available). Mirrors auth:login — without this, Quick Unlock / Windows
    // Hello sign-ins never run the on-launch schedule check.
    setTimeout(runScheduledEmailCheck, 5000);
    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:safe-disable', async (_, { password }) => {
  if (!hasDb()) return { ok: false, error: 'No profile loaded.' };
  try {
    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, password_hash FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'No account found in this profile.' };
    if (!bcrypt.compareSync(password, user.password_hash)) return { ok: false, error: 'Incorrect password.' };

    const skPath = safeKeyPath();
    if (skPath && fs.existsSync(skPath)) fs.unlinkSync(skPath);

    // Remove from manifest
    if (ACTIVE_PROFILE_DIR && !IS_DEV) {
      const manifest = readManifest(ACTIVE_PROFILE_DIR);
      if (manifest) {
        manifest.auth_methods = manifest.auth_methods.filter(m => m !== 'safestorage');
        writeManifest(ACTIVE_PROFILE_DIR, manifest);
      }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: Auth ──────────────────────────────────────────────────────────────
ipcMain.handle('auth:check-setup', () => {
  if (!hasDb()) return { needsSetup: true };
  const row = dbGet('SELECT COUNT(*) as c FROM users');
  return { needsSetup: (row?.c || 0) === 0 };
});

ipcMain.handle('auth:setup', async (_, { username, password, totpSecret, totpCode, recoveryCode }) => {
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
    // Write profile manifest so the selector card appears on next launch
    if (ACTIVE_PROFILE_DIR && !IS_DEV) {
      writeManifest(ACTIVE_PROFILE_DIR, {
        username, display_name: username, avatar_thumb_48: null,
        created_at: Math.floor(Date.now() / 1000),
        auth_methods: ['password+totp'], key_derivation_version: 'pbkdf2-v1',
        passkey_credential_id: null
      });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:login', async (_, { username, password, totpCode }) => {
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
        session.user.work_state = profileData?.work_state || null;
        if (ACTIVE_PROFILE_DIR && !IS_DEV) {
          const manifest = readManifest(ACTIVE_PROFILE_DIR);
          if (manifest && !manifest.avatar_thumb_48 && profileData?.avatar) {
            writeManifest(ACTIVE_PROFILE_DIR, { ...manifest, avatar_thumb_48: profileData.avatar });
          }
        }
      } catch (e) { console.warn('[login] profile decrypt failed:', e.message); }
    }

    migrateTimeEntries();
    sweepOrphanTaskItems(); // C6 (D-012): stop orphaned running tasks/breaks

    // Fire scheduled email check shortly after login (session now available)
    setTimeout(runScheduledEmailCheck, 5000);

    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: e.message }; }
});

function incrementFailed(user) {
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

ipcMain.handle('auth:recover', async (_, { username, recoveryCode, newPassword }) => {
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

    persistDB(); performBackup();
    return { ok: true, passwordReset: true };
  } catch(e) { return { ok: false, error: 'Recovery failed: ' + e.message }; }
});

ipcMain.handle('totp:generate', async () => {
  const speakeasy = require('speakeasy');
  const qrcode    = require('qrcode');
  const secret = speakeasy.generateSecret({ name: 'Conquered Time', length: 20 });
  const qrUrl  = await qrcode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrUrl };
});

ipcMain.handle('session:get', () => session.user ? { id: session.user.id, username: session.user.username, display_name: session.user.display_name || null, work_state: session.user.work_state || null } : null);
ipcMain.handle('session:heartbeat', () => { if (session.user) resetIdleTimer(); return null; });
ipcMain.on('session:request-lock',   () => lockSession(false));
ipcMain.on('session:confirm-close',  () => { forceClose = true; mainWindow.close(); });
ipcMain.on('session:confirm-lock',   () => lockSession(true));

// ── IPC: Companies ─────────────────────────────────────────────────────────
ipcMain.handle('companies:list', () => {
  if (!session.key || !session.user) return [];
  return readCache.get('companies', cacheOwner(), () => {
    const rows = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=? ORDER BY rowid ASC', [session.user.id]);
    return rows.map(r => {
      const id = (r.id != null && r.id !== 0) ? Number(r.id) : Number(r.rid);
      try {
        const plain = decrypt({ iv: r.data_iv, tag: r.data_tag, data: r.data_enc }, session.key);
        const parsed = JSON.parse(plain);
        // Ensure id is never null/NaN — always a real positive integer
        const finalId = (id && !isNaN(id)) ? id : Number(r.rid);
        return { ...parsed, id: finalId };
      } catch { return { id: Number(r.rid), name: '[Decryption Error]' }; }
    });
  });
});

ipcMain.handle('companies:save', (_, data) => {
  if (!session.key || !session.user) return { ok: false, error: 'Not authenticated' };
  try {
    const { iv, tag, data: enc } = encrypt(JSON.stringify(data), session.key);
    if (data.id) {
      dbRun('UPDATE companies SET data_enc=?,data_iv=?,data_tag=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [enc, iv, tag, data.id, session.user.id]);
    } else {
      dbRun('INSERT INTO companies (user_id,data_enc,data_iv,data_tag) VALUES (?,?,?,?)',
        [session.user.id, enc, iv, tag]);
    }
    persistDB(); performBackup();
    readCache.invalidate('companies');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('companies:delete', (_, id) => {
  if (!session.key || !session.user) return { ok: false };
  const numId = Number(id);
  // task_items are entry_id-scoped — delete them via subquery BEFORE the
  // entries are removed, otherwise the company's break/lunch/Dispatch tasks
  // are orphaned in the DB.
  dbRun(
    'DELETE FROM task_items WHERE user_id=? AND entry_id IN (SELECT rowid FROM time_entries WHERE user_id=? AND company_id=?)',
    [session.user.id, session.user.id, numId]
  );
  dbRun('DELETE FROM time_entries WHERE company_id=? AND user_id=?', [numId, session.user.id]);
  dbRun('DELETE FROM companies WHERE rowid=? AND user_id=?', [numId, session.user.id]);
  persistDB(); performBackup();
  // Deletes the company AND its time_entries → both caches go stale.
  readCache.invalidate('companies');
  invalidateEntriesCache();
  return { ok: true };
});

// ── IPC: Time entries ──────────────────────────────────────────────────────
ipcMain.handle('entries:list', (_, companyId) => {
  if (!session.key || !session.user) return [];
  return dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND company_id=? ORDER BY log_date DESC',
    [session.user.id, companyId]).map(r => ({...decryptEntry(r), id: Number(r.rid)}));
});

ipcMain.handle('entries:save', (_, entry) => {
  if (!session.key || !session.user) return { ok: false };
  try {
    const enc = encrypt(entry.rows_json || '[]', session.key);
    if (entry.id) {
      dbRun(
        'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,session_label=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [enc.data, enc.iv, enc.tag, '', entry.total_mins, entry.session_label || '', entry.id, session.user.id]
      );
      session.activeEntryId = Number(entry.id);
      persistDB(); performBackup();
      invalidateEntriesCache();
      return { ok: true, id: entry.id };
    } else {
      dbRun(
        'INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,rows_enc,rows_iv,rows_tag,total_mins) VALUES (?,?,?,?,?,?,?,?,?)',
        [session.user.id, entry.company_id, entry.log_date, entry.session_label || '', '', enc.data, enc.iv, enc.tag, entry.total_mins]
      );
      const maxRow = dbGet('SELECT MAX(rowid) as rid FROM time_entries WHERE user_id=?', [session.user.id]);
      const newId = (maxRow && maxRow.rid != null) ? Number(maxRow.rid) : null;
      session.activeEntryId = newId;
      persistDB(); performBackup();
      invalidateEntriesCache();
      return { ok: true, id: newId };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('entries:all', () => {
  if (!session.key || !session.user) return [];
  return readCache.get('entriesAll', cacheOwner(), () =>
    dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [session.user.id])
      .map(r => ({...decryptEntry(r), id: Number(r.rid)})));
});

// Lightweight variant: returns only the plaintext aggregate columns and does NOT
// decrypt rows_json. Consumers that only need totals/dates/labels (dashboard,
// company hour rollups) use this so they don't pay AES-GCM decryption on the
// entire entry history every page load. Anything needing per-row clock detail
// (global log, audit, reports) must keep using entries:all.
ipcMain.handle('entries:summary', () => {
  if (!session.key || !session.user) return [];
  return readCache.get('entriesSummary', cacheOwner(), () =>
    dbAll('SELECT rowid as rid, company_id, log_date, session_label, total_mins FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [session.user.id])
      .map(r => ({ ...r, id: Number(r.rid) })));
});

ipcMain.handle('entries:get-active', () => {
  if (!session.key || !session.user) return null;

  let row = null;

  // Fast path: use in-memory session.activeEntryId if set
  if (session.activeEntryId) {
    row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
      [session.activeEntryId, session.user.id]);
  }

  // Fallback: find today's entry that has a clocked-in but not clocked-out row
  if (!row) {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = dbAll(
      'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date=? ORDER BY updated_at DESC',
      [session.user.id, today]
    );
    for (const c of candidates) {
      try {
        decryptEntry(c);
        const rows = JSON.parse(c.rows_json || '[]');
        if (rows.some(r => r.clock_in && !r.clock_out)) { row = c; break; }
      } catch {}
    }
    // Also check entries from yesterday in case of overnight sessions
    if (!row) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const prev = dbAll(
        'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date=? ORDER BY updated_at DESC',
        [session.user.id, yesterday]
      );
      for (const c of prev) {
        try {
          decryptEntry(c);
          const rows = JSON.parse(c.rows_json || '[]');
          if (rows.some(r => r.clock_in && !r.clock_out)) { row = c; break; }
        } catch {}
      }
    }
    if (row) session.activeEntryId = Number(row.rid);
  }

  if (!row) return null;

  decryptEntry(row);

  let company_name = null;
  try {
    const co = dbGet('SELECT rowid as rid, * FROM companies WHERE rowid=? AND user_id=?',
      [Number(row.company_id), session.user.id]);
    if (co) {
      const plain = decrypt({ iv: co.data_iv, tag: co.data_tag, data: co.data_enc }, session.key);
      company_name = JSON.parse(plain).name || null;
    }
  } catch {}
  return { ...row, id: Number(row.rid), company_name };
});

ipcMain.handle('entries:get', (_, id) => {
  if (!session.key || !session.user) return null;
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(id), session.user.id]);
  if (!row) return null;
  return { ...decryptEntry(row), id: Number(row.rid) };
});

// ── IPC: Task items ────────────────────────────────────────────────────────
ipcMain.handle('tasks:list', (_, entryId) => {
  if (!session.key || !session.user) return [];
  return dbAll(
    'SELECT rowid as rid, * FROM task_items WHERE entry_id=? AND user_id=? ORDER BY started_at ASC',
    [Number(entryId), session.user.id]
  ).map(r => ({ ...r, id: Number(r.rid) }));
});

ipcMain.handle('tasks:save', (_, item) => {
  if (!session.key || !session.user) return { ok: false };
  try {
    if (item.id) {
      dbRun(
        'UPDATE task_items SET label=?,item_type=?,stopped_at=?,duration_secs=? WHERE rowid=? AND user_id=?',
        [item.label, item.item_type || 'task', item.stopped_at ?? null,
         item.duration_secs || 0, Number(item.id), session.user.id]
      );
      persistDB();
      return { ok: true, id: Number(item.id) };
    } else {
      dbRun(
        'INSERT INTO task_items (user_id,entry_id,label,item_type,started_at,stopped_at,duration_secs) VALUES (?,?,?,?,?,?,?)',
        [session.user.id, Number(item.entry_id), item.label,
         item.item_type || 'task', item.started_at, item.stopped_at ?? null, item.duration_secs || 0]
      );
      const maxRow = dbGet('SELECT MAX(rowid) as rid FROM task_items WHERE user_id=?', [session.user.id]);
      const newId = (maxRow && maxRow.rid != null) ? Number(maxRow.rid) : null;
      persistDB();
      return { ok: true, id: newId };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('tasks:delete', (_, id) => {
  if (!session.key || !session.user) return { ok: false };
  dbRun('DELETE FROM task_items WHERE rowid=? AND user_id=?', [Number(id), session.user.id]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('tasks:recent-labels', () => {
  if (!session.key || !session.user) return [];
  const rows = dbAll(
    `SELECT label FROM task_items
     WHERE user_id=? AND item_type='task'
     GROUP BY label
     ORDER BY MAX(started_at) DESC LIMIT 10`,
    [session.user.id]
  );
  return rows.map(r => r.label);
});

ipcMain.handle('tasks:summary', () => {
  if (!session.key || !session.user) return {};
  const rows = dbAll(
    `SELECT entry_id, item_type, COUNT(*) as cnt
     FROM task_items WHERE user_id=? AND item_type IN ('break','lunch')
     GROUP BY entry_id, item_type`,
    [session.user.id]
  );
  const map = {};
  (rows || []).forEach(r => {
    if (!map[r.entry_id]) map[r.entry_id] = { break_count: 0, lunch_count: 0 };
    if (r.item_type === 'break') map[r.entry_id].break_count = Number(r.cnt);
    if (r.item_type === 'lunch') map[r.entry_id].lunch_count = Number(r.cnt);
  });
  return map;
});

// ── IPC: Settings ──────────────────────────────────────────────────────────
// ── IPC: Backup library ───────────────────────────────────────────────────
ipcMain.handle('backup:list', () => {
  if (!session.user) return [];
  if (!fs.existsSync(getBackupDir())) return [];
  const files = fs.readdirSync(getBackupDir())
    .filter(f => f.startsWith('vault-') && f.endsWith('.db'))
    .sort().reverse();
  return files.map(f => {
    const stat = fs.statSync(path.join(getBackupDir(), f));
    const ts = f.replace('vault-', '').replace('.db', '').replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
    return { filename: f, timestamp: ts, sizeKB: Math.round(stat.size / 1024) };
  });
});

ipcMain.handle('backup:preview', (_, filename) => {
  if (!session.user) return { error: 'No session' };
  if (!/^vault-[\d\-T]+\.db$/.test(filename)) return { error: 'Invalid filename' };
  const filepath = path.join(getBackupDir(), filename);
  if (!fs.existsSync(filepath)) return { error: 'File not found' };
  try {
    const buf     = fs.readFileSync(filepath);
    const preview = newDatabase(buf);
    const get1    = (q) => { const r = preview.exec(q); return r[0]?.values[0]?.[0] ?? null; };
    const username    = get1('SELECT username FROM users LIMIT 1') || 'Unknown';
    const companyCount = Number(get1('SELECT COUNT(*) FROM companies') || 0);
    const entryCount   = Number(get1('SELECT COUNT(*) FROM time_entries') || 0);
    const dateFrom     = get1('SELECT MIN(log_date) FROM time_entries') || '—';
    const dateTo       = get1('SELECT MAX(log_date) FROM time_entries') || '—';
    preview.close();
    return { username, companyCount, entryCount, dateFrom, dateTo };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('backup:restore', (_, filename) => {
  if (!session.user) return { ok: false, error: 'No session' };
  if (!/^vault-[\d\-T]+\.db$/.test(filename)) return { ok: false, error: 'Invalid filename' };
  const filepath = path.join(getBackupDir(), filename);
  if (!fs.existsSync(filepath)) return { ok: false, error: 'File not found' };
  try {
    performBackup(); // safety-save current state before overwriting
    fs.copyFileSync(filepath, getDbFile());
    // Reload the DB in memory
    const buf = fs.readFileSync(getDbFile());
    replaceDb(buf);
    // Vault replaced in place (same profile dir + user id ⇒ owner unchanged),
    // so the owner guard won't auto-clear — drop the cache explicitly.
    readCache.clear();
    // Clear session
    clearIdleTimer();
    session.key = null; session.user = null; session.activeEntryId = null;
    mainWindow.loadFile(path.join(RENDERER_DIR, 'pages/login.html'));
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// Pre-auth backup restore — opens file dialog, no session required
ipcMain.handle('auth:browse-backup', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select vault backup to restore',
    filters: [{ name: 'Vault backup', extensions: ['db'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const src = result.filePaths[0];
  try {
    const dbFile = getDbFile();
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, dbFile + '.pre-restore.bak');
    fs.copyFileSync(src, dbFile);
    const buf = fs.readFileSync(dbFile);
    replaceDb(buf);
    clearIdleTimer(); session.key = null; session.user = null; session.activeEntryId = null;
    mainWindow.loadFile(path.join(RENDERER_DIR, 'pages/login.html'));
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── IPC: Audit policy ────────────────────────────────────────────────────
ipcMain.handle('audit:get-policy', () => {
  const stateCode = session.user?.work_state || null;
  const policy    = getPolicy(stateCode);
  const stateName = stateCode ? (STATE_NAMES[stateCode] || stateCode) : null;
  // Replace Infinity with null so serialization is safe across IPC boundary
  const safeThresholds = policy.breakThresholds.map(([t, c]) => [isFinite(t) ? t : null, c]);
  return {
    stateCode, stateName, policyLabel: policy.label,
    // C5 (D-007): true only when the state has its OWN policy tier. Default-
    // tier states (e.g. TX) must not get "<State> law requires…" copy — that
    // implies a legal mandate that doesn't exist.
    hasStatePolicy: !!(stateCode && STATE_POLICY[stateCode]),
    breakThresholds: safeThresholds,
    lunchThreshMins: policy.lunchThreshMins,
    dispatchBreakWarnMins: isFinite(policy.dispatchBreakWarnMins) ? policy.dispatchBreakWarnMins : null,
    dispatchLunchWarnMins: isFinite(policy.dispatchLunchWarnMins) ? policy.dispatchLunchWarnMins : null,
  };
});

// ── IPC: Audit dismissed ──────────────────────────────────────────────────
ipcMain.handle('audit:get-dismissed', () => {
  if (!session.user) return [];
  return dbAll('SELECT entry_id, row_idx, type, emailed_at FROM audit_dismissed WHERE user_id=?', [session.user.id]);
});

ipcMain.handle('audit:dismiss', (_, { entry_id, row_idx, type }) => {
  if (!session.user) return { ok: false };
  dbRun(
    'INSERT OR IGNORE INTO audit_dismissed (user_id, entry_id, row_idx, type) VALUES (?,?,?,?)',
    [session.user.id, Number(entry_id), Number(row_idx), type]
  );
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:undismiss', (_, { entry_id, row_idx, type }) => {
  if (!session.user) return { ok: false };
  dbRun('DELETE FROM audit_dismissed WHERE user_id=? AND entry_id=? AND row_idx=? AND type=?',
    [session.user.id, Number(entry_id), Number(row_idx), type]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:clear-dismissed', () => {
  if (!session.user) return { ok: false };
  dbRun('DELETE FROM audit_dismissed WHERE user_id=?', [session.user.id]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:apply-fix', (_, { entry_id, row_idx, fix_type }) => {
  if (!session.key || !session.user) return { ok: false };
  // Only these discrepancy types have an automated fix. Everything else
  // (e.g. missing_break / missing_lunch) is acknowledge-only by design — reject
  // explicitly so the dismiss-only guarantee can't be bypassed by a forged call.
  const ALLOWED_FIXES = ['set_clock_out', 'recalc_duration'];
  if (!ALLOWED_FIXES.includes(fix_type)) {
    return { ok: false, error: `No automated fix for "${fix_type}" — this discrepancy is acknowledge-only.` };
  }
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(entry_id), session.user.id]);
  if (!row) return { ok: false, error: 'Entry not found' };
  try {
    decryptEntry(row);
    const rows = JSON.parse(row.rows_json || '[]');
    const r = rows[row_idx];
    if (!r) return { ok: false, error: 'Row not found' };

    if (fix_type === 'set_clock_out') {
      // Set clock-out to clock-in + 8h, capped at 23:59
      if (!r.clock_in) return { ok: false, error: 'No clock-in to base fix on' };
      const [h, m] = r.clock_in.split(':').map(Number);
      const outMins = Math.min(h * 60 + m + 480, 23 * 60 + 59);
      const outH = String(Math.floor(outMins / 60)).padStart(2, '0');
      const outM = String(outMins % 60).padStart(2, '0');
      r.clock_out  = `${outH}:${outM}`;
      r.total_mins = outMins - (h * 60 + m);
    } else if (fix_type === 'recalc_duration') {
      if (!r.clock_in || !r.clock_out) return { ok: false, error: 'Need both clock-in and clock-out' };
      const [ih, im] = r.clock_in.split(':').map(Number);
      const [oh, om] = r.clock_out.split(':').map(Number);
      r.total_mins = (oh * 60 + om) - (ih * 60 + im);
    }

    rows[row_idx] = r;
    const newJson  = JSON.stringify(rows);
    const newTotal = rows.reduce((s, row) => s + (row.total_mins || 0), 0);
    const enc      = encrypt(newJson, session.key);
    dbRun(
      'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
      [enc.data, enc.iv, enc.tag, '', newTotal, Number(entry_id), session.user.id]
    );
    persistDB(); performBackup();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// getProfileEmail / profileEmailMissing live in ./email.

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

ipcMain.handle('profile:save', (_, { display_name, full_name, email, phone, job_title, work_state, avatar, avatar_thumb_48 }) => {
  if (!session.key || !session.user) return { ok: false };
  try {
    const blob = encrypt(JSON.stringify({ full_name: full_name || '', email: email || '', phone: phone || '', job_title: job_title || '', work_state: work_state || null, avatar: avatar || null }), session.key);
    dbRun('UPDATE users SET display_name=?, profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?',
      [display_name || null, blob.data, blob.iv, blob.tag, session.user.id]);
    session.user.display_name = display_name || null;
    session.user.work_state   = work_state   || null;
    persistDB();
    // Keep profile selector card in sync
    if (ACTIVE_PROFILE_DIR && !IS_DEV) {
      const existing = readManifest(ACTIVE_PROFILE_DIR) || {};
      writeManifest(ACTIVE_PROFILE_DIR, {
        ...existing,
        display_name: display_name || existing.username || '',
        avatar_thumb_48: avatar_thumb_48 || existing.avatar_thumb_48 || null
      });
    }
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:change-password', async (_, { currentPassword, totpCode, newPassword }) => {
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
  persistDB(); performBackup();
  return { ok: true };
});

ipcMain.handle('audit:open-wizard', (_, { mode, theme }: { mode?: string; theme?: string } = {}) => {
  createAuditWizardWindow(mode, theme);
  return { ok: true };
});

// Count of non-dismissed audit discrepancies — used for the at-login notice.
ipcMain.handle('audit:count', () => countAuditDiscrepancies());

// Consent-gated audit notification: email the user about a discrepancy (never
// modifies a punch — fixes still require an explicit Apply Fix). On success the
// discrepancy is recorded as emailed (emailed_at) so it's silenced on close/lock
// but kept visible in the audit log.
ipcMain.handle('audit:email-notify', async (_, { entry_id, row_idx, type, subject, message }: Record<string, any> = {}) => {
  if (!session.key || !session.user) return { ok: false, error: 'Not logged in.' };
  const to = getProfileEmail();
  if (!to) return { ok: false, error: 'Add an email to your profile first (Profile screen).' };
  const cfg = getEmailSmtpConfig();
  if (!cfg.host || !cfg.username || !cfg.password) {
    return { ok: false, error: 'Email not configured. Open Settings → Reports to add SMTP credentials.' };
  }
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.port === 465,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      auth: { user: cfg.username, pass: cfg.password },
    });
    const fromAddr = cfg.fromName ? `"${cfg.fromName}" <${cfg.username}>` : cfg.username;
    const safeMsg  = String(message || 'A timesheet discrepancy needs your attention.')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    await transport.sendMail({
      from: fromAddr, to,
      subject: subject || 'Conquered Time — timesheet discrepancy',
      html: `<p>${safeMsg}</p>
             <p style="color:#374151;font-size:13px">Review it in Conquered Time under <strong>Reports &rarr; Audit</strong>. No changes were made to your timesheet — applying a fix always requires your confirmation in the app.</p>
             <p style="color:#9ca3af;font-size:12px">Sent ${new Date().toLocaleString()} · CONFIDENTIAL</p>`,
    });
    // Record as emailed/acknowledged (silenced on close, kept in the log).
    const args = [session.user.id, Number(entry_id), Number(row_idx), type];
    dbRun('INSERT OR IGNORE INTO audit_dismissed (user_id, entry_id, row_idx, type) VALUES (?,?,?,?)', args);
    dbRun('UPDATE audit_dismissed SET emailed_at=strftime(\'%s\',\'now\') WHERE user_id=? AND entry_id=? AND row_idx=? AND type=?', args);
    persistDB();
    return { ok: true, to };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: Database clear operations ────────────────────────────────────────
// Architecture note: each profile has its own vault.db file, so `db` is
// always scoped to the active user's vault. All DELETEs still use
// WHERE user_id=? explicitly so the intent is unambiguous and the code
// stays safe if vault sharing is ever introduced.

ipcMain.handle('db:clear-timeclock', () => {
  if (!session.key || !session.user) return { ok: false };
  const uid = session.user.id;
  dbRun('DELETE FROM task_items   WHERE user_id=?', [uid]);
  dbRun('DELETE FROM time_entries WHERE user_id=?', [uid]);
  session.activeEntryId = null;
  persistDB(); performBackup();
  invalidateEntriesCache();
  return { ok: true };
});

// Per-company time-clock clear: removes time_entries (and their entry-scoped
// task_items) for ONE company, leaving the company row and all other companies
// intact. task_items are entry_id-scoped, so delete them via subquery BEFORE
// the entries are removed.
ipcMain.handle('db:clear-timeclock-company', (_, arg) => {
  if (!session.key || !session.user) return { ok: false };
  const companyId = Number(arg && arg.companyId);
  if (!companyId) return { ok: false, error: 'No company specified' };
  const uid = session.user.id;
  dbRun(
    'DELETE FROM task_items WHERE user_id=? AND entry_id IN (SELECT rowid FROM time_entries WHERE user_id=? AND company_id=?)',
    [uid, uid, companyId]
  );
  dbRun('DELETE FROM time_entries WHERE user_id=? AND company_id=?', [uid, companyId]);
  session.activeEntryId = null;
  persistDB(); performBackup();
  invalidateEntriesCache();
  return { ok: true };
});

ipcMain.handle('db:clear-companies', () => {
  if (!session.key || !session.user) return { ok: false };
  const uid = session.user.id;
  dbRun('DELETE FROM task_items   WHERE user_id=?', [uid]);
  dbRun('DELETE FROM time_entries WHERE user_id=?', [uid]);
  dbRun('DELETE FROM companies    WHERE user_id=?', [uid]);
  session.activeEntryId = null;
  persistDB(); performBackup();
  readCache.invalidate('companies');
  invalidateEntriesCache();
  return { ok: true };
});

// Full clear removes the entire profile from disk so the profile selector
// does not show a ghost card after logout. The profile directory
// (vault.db + profile-manifest.json + backups/) is deleted, then the
// renderer is expected to navigate to login, which will show the selector
// with only surviving profiles.
ipcMain.handle('db:clear-full', () => {
  if (!session.key || !session.user) return { ok: false };
  const uid        = session.user.id;
  const profileDir = ACTIVE_PROFILE_DIR; // capture before clearing session state

  // Wipe in-memory DB rows first so persistDB() writes a clean file
  // (belt-and-suspenders: the whole directory is deleted right after)
  dbRun('DELETE FROM task_items      WHERE user_id=?', [uid]);
  dbRun('DELETE FROM time_entries    WHERE user_id=?', [uid]);
  dbRun('DELETE FROM companies       WHERE user_id=?', [uid]);
  dbRun('DELETE FROM audit_dismissed WHERE user_id=?', [uid]);
  dbRun('DELETE FROM app_settings');   // vault-level; no user_id column
  dbRun('DELETE FROM users           WHERE rowid=?',   [uid]); // session.user.id is the rowid (see line 606)

  session.activeEntryId      = null;
  session.key         = null;
  session.user        = null;
  ACTIVE_PROFILE_DIR = null;
  setDbFile(null);
  setBackupDir(null);

  // Delete the profile directory so profiles:list won't surface a ghost card
  if (!IS_DEV && profileDir && fs.existsSync(profileDir)) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
  }

  return { ok: true }; // no persistDB() — directory is gone
});

ipcMain.handle('app:get-info', () => ({
  version:         app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion:     process.versions.node,
  platform:        process.platform === 'win32' ? 'Windows' :
                   process.platform === 'darwin' ? 'macOS' : 'Linux',
  arch:            process.arch,
}));

// Update check URL — point this at the raw version.json in your GitHub repo once published
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/Conqueror-Mod/conquered-time/master/version.json';

ipcMain.handle('app:check-update', () => new Promise((resolve) => {
  const https = require('https');
  const current = app.getVersion();
  const req = https.get(UPDATE_CHECK_URL, { timeout: 8000 }, (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      try {
        const data = JSON.parse(raw);
        const latest = data.version || current;
        // Simple semver comparison: split on dots, compare each segment numerically
        const parse = v => v.replace(/[^0-9.]/g, '').split('.').map(Number);
        const [aMaj, aMin, aPat] = parse(latest);
        const [bMaj, bMin, bPat] = parse(current);
        const hasUpdate =
          aMaj > bMaj ||
          (aMaj === bMaj && aMin > bMin) ||
          (aMaj === bMaj && aMin === bMin && aPat > bPat);
        resolve({ ok: true, current, latest, hasUpdate, downloadUrl: data.downloadUrl || '', notes: data.notes || '' });
      } catch {
        resolve({ ok: false, error: 'Invalid response from update server.' });
      }
    });
  });
  req.on('error', () => resolve({ ok: false, error: 'Could not reach update server. Check your connection.' }));
  req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Update check timed out.' }); });
}));

ipcMain.handle('settings:get', (_, key) => {
  if (!hasDb()) return null;
  const row = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
  return row ? row.value : null;
});
ipcMain.handle('settings:set', (_, { key, value }) => {
  if (!hasDb()) return { ok: false };
  dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [key, String(value)]);
  persistDB();
  return { ok: true };
});

// ── App lifecycle ──────────────────────────────────────────────────────────
// ── Context menu (right-click) ─────────────────────────────────────────────
// Electron disables the browser's built-in context menu by default.
// This restores a standard edit menu (cut/copy/paste/select-all) on all windows.
app.on('web-contents-created', (_e, wc) => {
  wc.on('context-menu', (_ev, params) => {
    /** @type {import('electron').MenuItemConstructorOptions[]} */
    const items = [];
    if (params.isEditable) {
      if (params.selectionText) items.push({ label: 'Cut',  role: 'cut'  });
      items.push({ label: 'Copy',       role: 'copy'      });
      items.push({ label: 'Paste',      role: 'paste'     });
      items.push({ type:  'separator'                      });
      items.push({ label: 'Select All', role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy' });
    }
    // @ts-ignore — getOwnerBrowserWindow exists at runtime but is missing from
    // Electron 29's WebContents typings; Phase 2 should switch this to
    // BrowserWindow.fromWebContents(wc).
    if (items.length) Menu.buildFromTemplate(items).popup({ window: wc.getOwnerBrowserWindow() });
  });
});

app.whenReady().then(async () => {
  // Schedule email check fires every 5 minutes (catches sub-hour scheduling windows).
  // runScheduledEmailCheck() emits its own success toast only when it actually
  // sends, and re-throws on failure — so here we only surface errors. (Previously
  // this fired a false "sent!" toast on every tick whether or not anything sent.)
  setInterval(() => runScheduledEmailCheck().catch(e => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', `Scheduled report failed: ${e.message}`, 'error', 8000);
  }), 5 * 60 * 1000);

  // Load the sql.js WASM module once (needed for migration peek reads too)
  await loadSqlJs();

  // Prod only: migrate old flat vault.db → profiles/<username>/vault.db
  if (!IS_DEV) migrateFromLegacyVault();

  // Dev: auto-load the dev profile so the rest of the flow is identical
  if (IS_DEV) await initProfileDB(ROOT_DATA_DIR);

  // Start minimized to tray: only when the OS auto-launched us (--startup) AND the
  // user opted in. Skips the splash and leaves the window hidden in the tray.
  const startHidden = STARTED_AT_LOGIN && getAppPref('startMinimized', false) === true;

  // Splash always uses zanarkand — it's a brand moment, not a user preference moment.
  const splash = startHidden ? null : createSplashWindow('zanarkand');
  createWindow(); // creates hidden (show: false)
  createTray();
  // No launch-at-startup re-sync needed here: the OS login item is its own
  // persistent source of truth (toggled via win:set-launch-at-startup).

  // Apply window position/size settings before show
  const rememberPos   = readStartupSetting('win_rememberPosition') === 'true';
  const lastBoundsRaw = readStartupSetting('win_lastBounds');
  const prefDisplay   = readStartupSetting('win_preferredDisplay') || 'primary';
  // Default to true — only false when user has explicitly toggled it off
  const startMax      = readStartupSetting('win_startMaximized') !== 'false';

  if (rememberPos && lastBoundsRaw) {
    try {
      const b = JSON.parse(lastBoundsRaw);
      mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }, false);
    } catch {}
  } else if (prefDisplay !== 'primary') {
    // Move onto the preferred display; always maximize to avoid off-screen issues
    const target = screen.getAllDisplays().find(d => d.id === Number(prefDisplay)) || screen.getPrimaryDisplay();
    mainWindow.setPosition(target.bounds.x + 10, target.bounds.y + 10);
  }

  // Track window bounds when Remember Last Position is enabled
  function saveWindowBounds() {
    if (!hasDb()) return;
    if (dbGet("SELECT value FROM app_settings WHERE key='win_rememberPosition'")?.value !== 'true') return;
    const b = mainWindow.getBounds();
    dbRun("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('win_lastBounds',?)", [JSON.stringify(b)]);
    persistDB();
  }
  mainWindow.on('moved',   saveWindowBounds);
  mainWindow.on('resized', saveWindowBounds);

  if (startHidden) {
    // Stay in the tray: no splash, window created hidden, user opens it from the
    // tray (Open) or by clicking the tray icon. Nothing else to do here.
    console.log('[startup] Launched at login with "start minimized" — staying in tray.');
  } else {
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) splash.close();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        // Always maximize when preferred display is set, or when startMax is on
        if (prefDisplay !== 'primary' || startMax) mainWindow.maximize();
      }
    }, 3000);
  }
});

// generatePDF / getEmailSmtpConfig live in ./email.

ipcMain.handle('email:save-config', (_, { host, port, username, password, fromName, defaultTo }) => {
  if (!session.key) return { ok: false, error: 'Not logged in.' };
  try {
    const set = (k, v) => dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [k, String(v || '')]);
    set('email_smtp_host', host);
    set('email_smtp_port', port || 587);
    set('email_smtp_username', username);
    set('email_smtp_from_name', fromName);
    set('email_smtp_default_to', defaultTo);
    if (password) {
      const enc = encrypt(password, session.key);
      set('email_smtp_password_enc', enc.data);
      set('email_smtp_password_iv',  enc.iv);
      set('email_smtp_password_tag', enc.tag);
    }
    persistDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:get-config', () => {
  if (!hasDb()) return {};
  const get = k => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
  const hasPassword = !!(get('email_smtp_password_enc'));
  return {
    host:       get('email_smtp_host'),
    port:       get('email_smtp_port') || '587',
    username:   get('email_smtp_username'),
    fromName:   get('email_smtp_from_name'),
    defaultTo:  get('email_smtp_default_to'),
    configured: !!(get('email_smtp_host') && get('email_smtp_username') && hasPassword),
    hasPassword,
  };
});

ipcMain.handle('email:test-smtp', async () => {
  if (!session.key) return { ok: false, error: 'Not logged in.' };
  try {
    const cfg = getEmailSmtpConfig();
    if (!cfg.host || !cfg.username) return { ok: false, error: 'SMTP host and username are required.' };
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port,
      secure: cfg.port === 465,
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     10000,
      auth: { user: cfg.username, pass: cfg.password },
    });
    await Promise.race([
      transport.verify(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connection timed out after 10 seconds')), 10000)),
    ]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// doSendReport lives in ./email.

ipcMain.handle('email:send-report', async (_, { htmlContent, subject, recipients }) => {
  if (!session.key || !session.user) return { ok: false, error: 'Not logged in.' };
  try {
    await doSendReport({ htmlContent, subject, recipients });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:trigger-schedule-check', async () => {
  await runScheduledEmailCheck();
  return { ok: true };
});

ipcMain.handle('email:send-scheduled-now', async () => {
  if (!session.key || !session.user) return { ok: false, error: 'Not logged in.' };
  try {
    const result = await runScheduledEmailCheck(true);
    if (result === false) return { ok: false, error: 'Schedule is set to Off — enable a frequency first.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:get-schedule-status', () => {
  if (!hasDb()) return {};
  const get = k => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
  const freq      = get('email_schedule_freq') || 'off';
  const lastSent  = get('email_schedule_last_sent') || null;
  const lastError = get('email_schedule_last_error') || null;
  const sendTime  = get('email_schedule_time') || '08:00';
  const next      = freq !== 'off' ? computeNextSendDate(freq, lastSent) : null;
  if (next) {
    const [sh, sm] = sendTime.split(':').map(Number);
    next.setHours(sh, sm, 0, 0);
  }
  return { freq, lastSent, lastError, nextSend: next ? next.toISOString() : null };
});

// ── Email schedule check ──────────────────────────────────────────────────
// computeNextSendDate / runScheduledEmailCheck live in ./email (gotcha #9).

app.on('window-all-closed', () => {
  // With close-to-tray the main window can be hidden (not closed), so this won't
  // fire then. If it does fire, the user is genuinely done — persist and quit.
  persistDB(); performBackup(); app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
