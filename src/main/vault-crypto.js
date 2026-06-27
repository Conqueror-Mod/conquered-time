'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  Vault crypto — pure, Electron-free, unit-testable.
//
//  Extracted from main.js so the security-critical primitives (AES-256-GCM
//  encrypt/decrypt, PBKDF2 key derivation) and the atomic re-encryption routine
//  can be exercised by `node --test` without booting Electron. main.js requires
//  this module; tests require it directly.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

// AES-256-GCM. Returns hex-encoded { iv, tag, data } for storage in TEXT columns.
function encrypt(plaintext, key) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: enc.toString('hex') };
}

// Throws on auth-tag mismatch / wrong key — callers rely on this to detect
// undecryptable blobs.
function decrypt(encObj, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encObj.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encObj.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encObj.data, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

// Key derived from password + stable stored salt ONLY. TOTP authenticates login
// but must never feed key derivation (it rotates every 30s — see gotcha #2).
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
}

// ── tiny sql.js row helpers (kept local so this module has no other deps) ──
function all(db, sql, params = []) {
  const res = db.exec(sql, params);
  if (!res || !res[0]) return [];
  const cols = res[0].columns;
  return res[0].values.map(vals => {
    const o = {};
    cols.forEach((c, i) => { o[c] = vals[i] !== undefined ? vals[i] : null; });
    return o;
  });
}
function get(db, sql, params = []) {
  return all(db, sql, params)[0] || null;
}

// ── Atomic vault re-encryption ─────────────────────────────────────────────
// Re-encrypts every encrypted blob in the vault (companies, profile, SMTP
// password, time entries) from oldKey to newKey. All-or-nothing:
//
//   1. Read phase — decrypt EVERYTHING first. If a single blob can't be read,
//      abort before any mutation. (No swallowed failures: a profile/SMTP blob
//      that won't decrypt aborts the whole operation rather than being silently
//      left under the old key.)
//   2. Snapshot the in-memory db.
//   3. Write phase — apply all re-encrypts plus onCommit (password hash, lockout
//      reset) together. If anything throws, roll the db back to the snapshot so a
//      half-re-encrypted (mixed-key) database can never survive in memory.
//
// Returns { ok, db, error }. The caller MUST adopt the returned `db` handle
// (on rollback it is a fresh instance restored from the snapshot), and should
// persist to disk only when ok === true.
function reEncryptVault({ SQL, db, oldKey, newKey, userId, user, onCommit }) {
  const writes = [];
  try {
    const companies = all(db, 'SELECT rowid as rid, data_enc, data_iv, data_tag FROM companies WHERE user_id=?', [userId]);
    for (const co of companies) {
      const plain = decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, oldKey);
      writes.push(() => {
        const r = encrypt(plain, newKey);
        db.run('UPDATE companies SET data_enc=?, data_iv=?, data_tag=? WHERE rowid=?', [r.data, r.iv, r.tag, Number(co.rid)]);
      });
    }

    if (user && user.profile_enc && user.profile_iv && user.profile_tag) {
      const plain = decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, oldKey);
      writes.push(() => {
        const r = encrypt(plain, newKey);
        db.run('UPDATE users SET profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?', [r.data, r.iv, r.tag, userId]);
      });
    }

    const smtpEnc = get(db, "SELECT value FROM app_settings WHERE key='email_smtp_password_enc'");
    const smtpIv  = get(db, "SELECT value FROM app_settings WHERE key='email_smtp_password_iv'");
    const smtpTag = get(db, "SELECT value FROM app_settings WHERE key='email_smtp_password_tag'");
    if (smtpEnc?.value && smtpIv?.value && smtpTag?.value) {
      const plain = decrypt({ data: smtpEnc.value, iv: smtpIv.value, tag: smtpTag.value }, oldKey);
      writes.push(() => {
        const r = encrypt(plain, newKey);
        const set = (k, v) => db.run('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [k, v]);
        set('email_smtp_password_enc', r.data);
        set('email_smtp_password_iv',  r.iv);
        set('email_smtp_password_tag', r.tag);
      });
    }

    const entries = all(db, 'SELECT rowid as rid, rows_enc, rows_iv, rows_tag FROM time_entries WHERE user_id=? AND rows_enc IS NOT NULL', [userId]);
    for (const e of entries) {
      const plain = decrypt({ data: e.rows_enc, iv: e.rows_iv, tag: e.rows_tag }, oldKey);
      writes.push(() => {
        const r = encrypt(plain, newKey);
        db.run('UPDATE time_entries SET rows_enc=?, rows_iv=?, rows_tag=? WHERE rowid=?', [r.data, r.iv, r.tag, e.rid]);
      });
    }
  } catch (e) {
    // Nothing mutated yet — safe to bail with the original handle intact.
    return { ok: false, db, error: 'Re-encryption aborted (could not read existing data): ' + e.message };
  }

  const snapshot = Buffer.from(db.export());
  try {
    for (const apply of writes) apply();
    if (onCommit) onCommit(db);
    return { ok: true, db };
  } catch (e) {
    try { db.close(); } catch {}
    const restored = new SQL.Database(snapshot);
    return { ok: false, db: restored, error: 'Re-encryption failed during write, rolled back: ' + e.message };
  }
}

module.exports = { encrypt, decrypt, deriveKey, reEncryptVault };
