'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  Vault fixture builders — extracted from seed-dev.js (Phase B of
//  docs/PLAN-property-testing.md) so tests can build arbitrary vaults in
//  memory, hundreds per run. seed-dev.js imports these same builders to write
//  its designed on-disk fixture — one schema, one insert discipline, one
//  crypto path for both.
//
//  Also home of computeExpectedDiscrepancies(): the INDEPENDENT mirror of
//  countAuditDiscrepancies() in src/main/audit.ts. The differential oracle
//  (test/audit-oracle.props.test.js) mechanically asserts the two agree on
//  randomized vaults, so any edit to either side that forgets the other fails
//  within seconds. Keep the mirror independent — it deliberately re-states the
//  policy tables and row predicate rather than importing the engine's modules
//  (importing them would make the oracle a tautology).
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

// ── Crypto (same primitives as src/main/vault-crypto.js) ───────────────────
const { encrypt, deriveKey } = require('../src/main/vault-crypto');

/** decrypt with the seed's historical (data, iv, tag, key) signature. */
function decrypt(data, iv, tag, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

// ── Schema (mirrors initProfileDB in src/main — keep in sync) ──────────────
const SCHEMA_SQL = `
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
      display_name    TEXT,
      profile_enc      TEXT,
      profile_iv       TEXT,
      profile_tag      TEXT,
      recovery_key_enc  TEXT,
      recovery_key_iv   TEXT,
      recovery_key_tag  TEXT,
      recovery_key_salt TEXT,
      created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
      rows_json     TEXT    NOT NULL DEFAULT '',
      rows_enc      TEXT,
      rows_iv       TEXT,
      rows_tag      TEXT,
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
  `;

/** New in-memory vault with the full schema. Caller closes. */
function createVaultSchema(SQL) {
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run(SCHEMA_SQL);
  return db;
}

function lastId(db) {
  return Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
}

// ── Row builders (rowid discipline: callers use the returned id) ───────────

/**
 * Insert a user row. All credential/recovery fields are caller-supplied so
 * seed-dev.js can pass its real bcrypt hashes / recovery packet while tests
 * pass cheap dummies.
 */
function insertUser(db, {
  username, passwordHash, totpSecret = 'DEVMODE_NO_TOTP', recoveryHash = null,
  keySalt = null, devMode = 0, displayName = null,
  profileEnc = null, profileIv = null, profileTag = null,
  recoveryKeyEnc = null, recoveryKeyIv = null, recoveryKeyTag = null, recoveryKeySalt = null,
}) {
  db.run(
    `INSERT INTO users
       (username, password_hash, totp_secret, totp_verified, recovery_hash,
        key_salt, dev_mode, display_name, profile_enc, profile_iv, profile_tag,
        recovery_key_enc, recovery_key_iv, recovery_key_tag, recovery_key_salt)
     VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`,
    [username, passwordHash, totpSecret, recoveryHash, keySalt, devMode, displayName,
     profileEnc, profileIv, profileTag,
     recoveryKeyEnc, recoveryKeyIv, recoveryKeyTag, recoveryKeySalt]
  );
  return lastId(db);
}

/** Insert a company whose data object is encrypted under `key`. */
function insertCompany(db, key, userId, data) {
  const enc = encrypt(JSON.stringify(data), key);
  db.run('INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (?,?,?,?)',
    [userId, enc.data, enc.iv, enc.tag]);
  return lastId(db);
}

/** Insert an encrypted time entry (rows encrypted under `key`, rows_json=''). */
function insertEntry(db, key, userId, { companyId, logDate, label = null, rows = [], totalMins = 0 }) {
  const enc = encrypt(JSON.stringify(rows), key);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyId, logDate, label, '', enc.data, enc.iv, enc.tag, totalMins]
  );
  return lastId(db);
}

/** Legacy shape: PLAINTEXT rows_json, rows_enc NULL (pre-migration probe). */
function insertLegacyEntry(db, userId, { companyId, logDate, label = null, rows = [], totalMins = 0, rowsJson = null }) {
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, total_mins)
     VALUES (?,?,?,?,?,?)`,
    [userId, companyId, logDate, label, rowsJson !== null ? rowsJson : JSON.stringify(rows), totalMins]
  );
  return lastId(db);
}

function insertTaskItem(db, userId, { entryId, label, itemType = 'task', startedAt, stoppedAt = null, durationSecs = 0 }) {
  db.run(
    'INSERT INTO task_items (user_id, entry_id, label, item_type, started_at, stopped_at, duration_secs) VALUES (?,?,?,?,?,?,?)',
    [userId, entryId, label, itemType, startedAt, stoppedAt, durationSecs]
  );
  return lastId(db);
}

function insertDismissed(db, userId, { entryId, rowIdx, type }) {
  db.run('INSERT OR IGNORE INTO audit_dismissed (user_id, entry_id, row_idx, type) VALUES (?,?,?,?)',
    [userId, entryId, rowIdx, type]);
}

// ════════════════════════════════════════════════════════════════════════════
//  computeExpectedDiscrepancies — independent mirror of
//  countAuditDiscrepancies() in src/main/audit.ts. If the engine's detection
//  changes, update BOTH (the differential oracle fails otherwise).
//
//  Contract mirrored (6 types only — no overlap / stored-vs-span detection):
//    per row (content-bearing rows only, both desc fields checked):
//      no_clock_in → no_clock_out → zero_duration → over_12h (>720), first hit
//    per entry: missing_break (policy tier by work_state), missing_lunch
//    audit_dismissed rows (entryId:rowIdx:type, -1 for entry-level) suppress
//    legacy plaintext entries: rows_json parsed directly; undecryptable /
//    unparsable rows contribute no row flags, entry-level checks still run
// ════════════════════════════════════════════════════════════════════════════

// Independent restatement of the policy tiers (src/main/policies.ts).
const MIRROR_TIERS = {
  default:       { breaks: [[210, 0], [360, 1], [600, 2], [Infinity, 3]], lunch: 300 },
  strict_breaks: { breaks: [[120, 0], [360, 1], [600, 2], [Infinity, 3]], lunch: 300 },
  meal_only:     { breaks: [[Infinity, 0]],                               lunch: 360 },
};
const MIRROR_STATE_TIER = {
  CA:'strict_breaks', CO:'strict_breaks', IL:'strict_breaks', KY:'strict_breaks',
  ME:'strict_breaks', MN:'strict_breaks', NE:'strict_breaks', NV:'strict_breaks',
  NH:'strict_breaks', ND:'strict_breaks', OR:'strict_breaks', VT:'strict_breaks',
  WA:'strict_breaks', WV:'strict_breaks',
  CT:'meal_only', DE:'meal_only', MA:'meal_only', NM:'meal_only',
  NY:'meal_only', RI:'meal_only', TN:'meal_only',
};

function computeExpectedDiscrepancies(db, userId, sessionKey, workState) {
  const tier = MIRROR_TIERS[(workState && MIRROR_STATE_TIER[workState]) || 'default'];
  const reqBreaks = (m) => { for (const [t, c] of tier.breaks) if (m < t) return c; return 0; };

  const dismissed = new Set();
  const dres = db.exec(`SELECT entry_id, row_idx, type FROM audit_dismissed WHERE user_id=${userId}`);
  if (dres.length) for (const [e, r, t] of dres[0].values) dismissed.add(`${e}:${r}:${t}`);

  const rows = db.exec('SELECT rowid, rows_json, rows_enc, rows_iv, rows_tag, total_mins FROM time_entries WHERE user_id=' + userId);
  if (!rows.length) return 0;
  let count = 0;
  for (const v of rows[0].values) {
    const [rid, rowsJson, enc, iv, tag, total] = v;
    let parsed = [];
    try {
      const json = (enc && iv && tag) ? decrypt(enc, iv, tag, sessionKey) : rowsJson;
      parsed = JSON.parse(json || '[]');
      if (!Array.isArray(parsed)) parsed = [];
    } catch { parsed = []; }
    parsed.forEach((r, idx) => {
      // Mirror of rowHasContent() (src/renderer/row-utils.js): any punch,
      // label, name, OR either description field counts (C3 / D-004).
      if (!r) return;
      const hasContent =
        String(r.clock_in || '').trim() || String(r.clock_out || '').trim() ||
        String(r.label || '').trim()    || String(r.name || '').trim() ||
        String(r.desc || '').trim()     || String(r.description || '').trim();
      if (!hasContent) return;
      if (!r.clock_in)             { if (!dismissed.has(`${rid}:${idx}:no_clock_in`))   count++; }
      else if (!r.clock_out)       { if (!dismissed.has(`${rid}:${idx}:no_clock_out`))  count++; }
      else if (!r.total_mins)      { if (!dismissed.has(`${rid}:${idx}:zero_duration`)) count++; }
      else if (r.total_mins > 720) { if (!dismissed.has(`${rid}:${idx}:over_12h`))      count++; }
    });
    const tm = Number(total || 0);
    const rb = reqBreaks(tm);
    if (rb > 0) {
      const bc = Number(db.exec(`SELECT COUNT(*) FROM task_items WHERE entry_id=${rid} AND user_id=${userId} AND item_type='break'`)[0].values[0][0]);
      if (bc < rb && !dismissed.has(`${rid}:-1:missing_break`)) count++;
    }
    if (tm > tier.lunch) {
      const hl = Number(db.exec(`SELECT COUNT(*) FROM task_items WHERE entry_id=${rid} AND user_id=${userId} AND item_type='lunch'`)[0].values[0][0]);
      if (!hl && !dismissed.has(`${rid}:-1:missing_lunch`)) count++;
    }
  }
  return count;
}

module.exports = {
  SCHEMA_SQL, createVaultSchema,
  insertUser, insertCompany, insertEntry, insertLegacyEntry, insertTaskItem, insertDismissed,
  computeExpectedDiscrepancies,
  encrypt, decrypt, deriveKey,
};
