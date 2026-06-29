/**
 * ═══════════════════════════════════════════════════════════════════════
 *  CONQUERED TIME — Comprehensive Dev Seed Script
 *  Run:  npm run seed      → seeds ./dev-data/dev-vault.db (never touches real vault)
 *        npm run dev       → launches app using dev-vault.db
 *
 *  What this seeds (all values reconciled against the live app, 2026-06-29):
 *    • 1 dev user (TOTP bypassed, profile pre-filled, work_state TX → default policy)
 *    • 2 companies with ALL current fields populated
 *    • 6 time entries across multiple dates:
 *        - 5 CLEAN sessions (every row has clock in+out, non-zero duration ≤12h;
 *          kept under the break/lunch policy thresholds, or compliant via task_items)
 *        - 1 DISCREPANCY session (Entry 3) planting ONLY real, detectable issues:
 *            › no_clock_in   (row has clock-out but no clock-in)
 *            › no_clock_out  (row has clock-in but no clock-out)
 *            › zero_duration (clock in+out but total_mins = 0)
 *            › over_12h      (row duration > 720 min)
 *          + entry hours (480m) with no break/lunch task_items →
 *            › missing_break  (default policy needs 2 breaks <600m)
 *            › missing_lunch  (default policy needs lunch >300m)
 *          ⇒ EXACTLY 6 audit discrepancies, all on Entry 3.
 *    • Task items for Dispatch module + the break/lunch task_items that keep the
 *      long compliant session (Entry 1) clean.
 *    • App settings under the REAL keys (ui_* / win_*) with a REAL theme value.
 *
 *  NOTE — the audit engine detects the 6 types above. It does NOT detect row
 *  overlaps or stored-vs-span duration mismatches; do not seed those expecting
 *  flags. (The previous seed claimed to, which was wrong.)
 *
 *  Prints a structured, order-of-operations verification packet on completion,
 *  plus a self-check PASS/FAIL ledger for the data it just wrote.
 *
 *  ⚠  NEVER ships in a production build — dev only (excluded from electron-builder
 *     `files`; dev_mode is gated on IS_DEV in main.js so it can't bypass TOTP packaged).
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ── Paths ──────────────────────────────────────────────────────────────────
// Dev DB lives inside the project at ./dev-data/ — completely separate from the
// real user vault in AppData. Run `npm run dev` to pick this DB up.
const DATA_DIR   = path.join(__dirname, 'dev-data');
const DB_FILE    = path.join(DATA_DIR, 'dev-vault.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// ── Dev credentials ────────────────────────────────────────────────────────
const DEV_USERNAME = 'devuser';
const DEV_PASSWORD = 'devpass123';
const DEV_RECOVERY = 'SEED-ABCD-1234-EFGH';

// ── Reference data (must mirror the live app) ──────────────────────────────
const VALID_THEMES = ['memoria', 'zanarkand', 'rabanastre', 'treno', 'nibelheim', 'lindblum'];
const SEED_THEME   = 'zanarkand'; // brand default (theme-init fallback)

// ── Crypto (mirrors main.js exactly) ──────────────────────────────────────
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
}
function encrypt(plaintext, key) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: enc.toString('hex') };
}
function decrypt(data, iv, tag, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

// ── Date helpers ───────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function timeStr(h, m = 0) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function unixNow(offsetMins = 0) {
  return Math.floor(Date.now() / 1000) + offsetMins * 60;
}

async function seed() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   CONQUERED TIME — Comprehensive Dev Seed v3.0   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Wipe & recreate data directory ────────────────────────────────────────
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('✓ Cleared old database');
  }
  fs.mkdirSync(DATA_DIR,   { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('✓ Created data directories');

  // ── Load sql.js ────────────────────────────────────────────────────────────
  let SQL;
  try {
    SQL = await require('sql.js')();
  } catch (e) {
    console.error('✗ sql.js not found. Run `npm install` first.\n', e.message);
    process.exit(1);
  }
  const db = new SQL.Database();

  // ── Full schema (mirrors main.js — keep in sync) ──────────────────────────
  db.run('PRAGMA foreign_keys = ON;');
  db.run(`
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
  `);
  console.log('✓ Schema created');

  // ── Dev user ───────────────────────────────────────────────────────────────
  const bcrypt     = require('bcryptjs');
  const keySalt    = crypto.randomBytes(32).toString('hex');
  const sessionKey = deriveKey(DEV_PASSWORD, keySalt);

  const passwordHash    = bcrypt.hashSync(DEV_PASSWORD, 10);
  const recoveryHash    = bcrypt.hashSync(DEV_RECOVERY, 10);
  const recoveryKeySalt = crypto.randomBytes(32).toString('hex');
  const recoveryEncKey  = deriveKey(DEV_RECOVERY, recoveryKeySalt);
  const recoveryKeyBlob = encrypt(sessionKey.toString('hex'), recoveryEncKey);

  // Avatar: Ruxin "COLLUSION!" reaction GIF
  const avatarDataUrl = `data:image/gif;base64,${fs.readFileSync(path.join(__dirname, 'assets', 'ruxin_dev.gif')).toString('base64')}`;

  // Profile fields mirror the live Profile page (no 'descriptor' field exists).
  const profileData = {
    full_name:  'Dev Tester',
    email:      'dev@conqueredtime.app',
    phone:      '555-0100',
    job_title:  'QA Engineer',
    work_state: 'TX',           // not in STATE_POLICY → default break/lunch policy
    avatar:     avatarDataUrl,
  };
  const profEnc = encrypt(JSON.stringify(profileData), sessionKey);

  db.run(
    `INSERT INTO users
       (username, password_hash, totp_secret, totp_verified, recovery_hash,
        key_salt, dev_mode, display_name, profile_enc, profile_iv, profile_tag,
        recovery_key_enc, recovery_key_iv, recovery_key_tag, recovery_key_salt)
     VALUES (?,?,?,1,?,?,1,?,?,?,?,?,?,?,?)`,
    [
      DEV_USERNAME, passwordHash, 'DEVMODE_NO_TOTP', recoveryHash, keySalt,
      'Dev Tester', profEnc.data, profEnc.iv, profEnc.tag,
      recoveryKeyBlob.data, recoveryKeyBlob.iv, recoveryKeyBlob.tag, recoveryKeySalt
    ]
  );
  const userId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Dev user created (id: ${userId}, display: Dev Tester, work_state: TX → default policy)`);

  // ── Company A — Zenith Analytics ──────────────────────────────────────────
  const companyA = {
    name:           'Zenith Analytics',
    job_title:      'Data Annotation Specialist',
    work_type:      'Annotation',
    location:       'Remote — USA',
    pay_rate:       22.50,
    date_start:     '2025-03-01',
    date_end:       '',
    hier_company:   'Zenith Analytics',
    hier_project:   'Phoenix',
    hier_platform:  'ZenDesk Pro',
    nav_id:         'A123456',
    platform_login: 'dev_tester@zenith.com',
    platform_email: 'dev_tester@zenith.com',
    platform_url:   'https://platform.zenithanalytics.com',
    supervisors:    'Jane Smith, Robert Chen',
    notes:          'Primary client — annotation and QA cycles. High volume batches on Tuesdays.'
  };
  const encA = encrypt(JSON.stringify(companyA), sessionKey);
  db.run(`INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (?,?,?,?)`,
    [userId, encA.data, encA.iv, encA.tag]);
  const companyIdA = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Company A: Zenith Analytics (id: ${companyIdA})`);

  // ── Company B — Apex Digital ───────────────────────────────────────────────
  const companyB = {
    name:           'Apex Digital',
    job_title:      'Remote QA Tester',
    work_type:      'Software QA',
    location:       'Remote — USA',
    pay_rate:       19.00,
    date_start:     '2025-06-01',
    date_end:       '',
    hier_company:   'Apex Digital',
    hier_project:   'Orion',
    hier_platform:  'ApexHub',
    nav_id:         'B987654',
    platform_login: 'dtester_apex',
    platform_email: 'dtester@apexdigital.io',
    platform_url:   'https://hub.apexdigital.io',
    supervisors:    'Marcus Webb',
    notes:          'Secondary client — bug regression cycles. Pays weekly via direct deposit.'
  };
  const encB = encrypt(JSON.stringify(companyB), sessionKey);
  db.run(`INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (?,?,?,?)`,
    [userId, encB.data, encB.iv, encB.tag]);
  const companyIdB = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Company B: Apex Digital (id: ${companyIdB})`);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const blank = (n) => Array(n).fill(null).map(() => ({
    label: '', name: '', desc: '', total_mins: 0, clock_in: '', clock_out: ''
  }));
  function insertEntry(companyId, dayOffset, label, rows, totalMins) {
    const enc = encrypt(JSON.stringify(rows), sessionKey);
    db.run(
      `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [userId, companyId, daysAgo(dayOffset), label, '', enc.data, enc.iv, enc.tag, totalMins]
    );
    return Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TIME ENTRIES   (default policy: breaks needed ≥210m; lunch needed >300m)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Entry 1: TODAY — Company A — CLEAN, long (360m) → compliant via task_items
  const entry1Rows = [
    { label: 'Annotation', name: 'Batch Phoenix-001', desc: 'Text classification — set A', total_mins: 90,  clock_in: timeStr(8, 0),  clock_out: timeStr(9, 30) },
    { label: 'Annotation', name: 'Batch Phoenix-002', desc: 'Text classification — set B', total_mins: 105, clock_in: timeStr(9, 45), clock_out: timeStr(11, 30) },
    { label: 'QA',         name: 'Review pass',        desc: 'Spot-check AM annotations',   total_mins: 60,  clock_in: timeStr(12, 0), clock_out: timeStr(13, 0) },
    { label: 'Annotation', name: 'Batch Phoenix-003', desc: 'Text classification — set C', total_mins: 105, clock_in: timeStr(13, 0), clock_out: timeStr(14, 45) },
    ...blank(11)
  ];
  const entry1Id = insertEntry(companyIdA, 0, 'Morning Annotation Block', entry1Rows, 360);
  console.log('✓ Entry 1: Today — Zenith — CLEAN compliant session (6h, breaks+lunch as task_items)');

  // ── Entry 2: YESTERDAY — Company B — CLEAN, short (180m) → no break/lunch needed
  const entry2Rows = [
    { label: 'QA',         name: 'Regression suite A', desc: 'Login + auth edge cases',    total_mins: 120, clock_in: timeStr(9, 0),  clock_out: timeStr(11, 0) },
    { label: 'Bug Report', name: 'File BRs',           desc: 'Wrote up 3 P2 bugs',         total_mins: 60,  clock_in: timeStr(11, 15), clock_out: timeStr(12, 15) },
    ...blank(13)
  ];
  insertEntry(companyIdB, 1, 'QA Regression Day', entry2Rows, 180);
  console.log('✓ Entry 2: Yesterday — Apex — CLEAN short session (3h)');

  // ── Entry 3: 3 DAYS AGO — Company A — DISCREPANCY SESSION (exactly 6 issues)
  //    Row 0: no_clock_in   | Row 1: no_clock_out | Row 2: zero_duration | Row 3: over_12h
  //    + entry total 480m, no break/lunch task_items → missing_break + missing_lunch
  const entry3Rows = [
    { label: 'Annotation', name: 'Forgot clock-in',   desc: 'Has clock-out, no clock-in',  total_mins: 60,  clock_in: '',             clock_out: timeStr(10, 0) }, // no_clock_in
    { label: 'QA',         name: 'Forgot clock-out',  desc: 'Has clock-in, no clock-out',  total_mins: 0,   clock_in: timeStr(10, 0), clock_out: '' },             // no_clock_out
    { label: 'Admin',      name: 'Zero duration',     desc: 'In+out but 0 minutes',        total_mins: 0,   clock_in: timeStr(11, 0), clock_out: timeStr(11, 30) }, // zero_duration
    { label: 'Annotation', name: 'Marathon block',    desc: 'Over 12h on one row',         total_mins: 780, clock_in: timeStr(0, 0),  clock_out: timeStr(13, 0) },  // over_12h
    ...blank(11)
  ];
  const entry3Id = insertEntry(companyIdA, 3, 'Discrepancy Test Session', entry3Rows, 480);
  console.log('✓ Entry 3: 3 days ago — Zenith — DISCREPANCY session (expect EXACTLY 6 issues)');

  // ── Entry 4: 5 DAYS AGO — Company B — CLEAN, short (150m)
  const entry4Rows = [
    { label: 'QA',         name: 'Smoke test build 42', desc: 'Full smoke test post-deploy', total_mins: 60, clock_in: timeStr(10, 0),  clock_out: timeStr(11, 0) },
    { label: 'Bug Report', name: 'Critical BR',         desc: 'P1 crash on checkout — filed', total_mins: 30, clock_in: timeStr(11, 0),  clock_out: timeStr(11, 30) },
    { label: 'QA',         name: 'Verify hotfix',       desc: 'Confirmed fix on build 42a',   total_mins: 60, clock_in: timeStr(11, 30), clock_out: timeStr(12, 30) },
    ...blank(12)
  ];
  insertEntry(companyIdB, 5, 'Hotfix Verification', entry4Rows, 150);
  console.log('✓ Entry 4: 5 days ago — Apex — CLEAN session (2h 30m)');

  // ── Entry 5: 10 DAYS AGO — Company A — CLEAN, short (200m)
  const entry5Rows = [
    { label: 'Training',   name: 'Platform onboarding', desc: 'ZenDesk Pro tutorial modules', total_mins: 120, clock_in: timeStr(9, 0),  clock_out: timeStr(11, 0) },
    { label: 'Annotation', name: 'Trial batch',         desc: 'Trial annotation set',         total_mins: 80,  clock_in: timeStr(11, 0), clock_out: timeStr(12, 20) },
    ...blank(13)
  ];
  insertEntry(companyIdA, 10, 'Onboarding Week', entry5Rows, 200);
  console.log('✓ Entry 5: 10 days ago — Zenith — CLEAN training session (3h 20m)');

  // ── Entry 6: 14 DAYS AGO — Company B — CLEAN, short (90m)
  const entry6Rows = [
    { label: 'QA', name: 'Environment setup', desc: 'VPN + tooling setup for Apex', total_mins: 90, clock_in: timeStr(14, 0), clock_out: timeStr(15, 30) },
    ...blank(14)
  ];
  insertEntry(companyIdB, 14, 'Setup Day', entry6Rows, 90);
  console.log('✓ Entry 6: 14 days ago — Apex — CLEAN setup session (1h 30m)');

  // ── Task items ──────────────────────────────────────────────────────────────
  // Entry 1 needs 2 breaks + 1 lunch (default policy, 360m) to stay clean — seeded
  // as task_items (item_type break/lunch), the ONLY thing the audit counts.
  const now = unixNow();
  const ti = (entryId, label, type, start, stop, dur) =>
    db.run(`INSERT INTO task_items (user_id, entry_id, label, item_type, started_at, stopped_at, duration_secs) VALUES (?,?,?,?,?,?,?)`,
      [userId, entryId, label, type, start, stop, dur]);

  ti(entry1Id, 'Morning break', 'break', now - 7200, now - 6300, 900);   // 15m break
  ti(entry1Id, 'Afternoon break', 'break', now - 3600, now - 2700, 900); // 15m break
  ti(entry1Id, 'Lunch', 'lunch', now - 5400, now - 3600, 1800);          // 30m lunch
  // Dispatch tasks (2 completed + 1 in-progress) for the Dispatch module
  ti(entry1Id, 'Review Phoenix guidelines', 'task', now - 7200, now - 6300, 900);
  ti(entry1Id, 'Annotation — set A', 'task', now - 6000, now - 4500, 1500);
  ti(entry1Id, 'Annotation — set B (in progress)', 'task', now - 1800, null, 0);
  console.log('✓ Task items: Entry 1 → 2 break + 1 lunch (compliance) + 2 done + 1 in-progress (Dispatch)');

  // ── App settings — REAL keys (ui_* / win_*) and a REAL theme value ──────────
  const settings = [
    ['ui_theme',            SEED_THEME],   // valid FF theme (was bare 'theme'='arctic' — invalid)
    ['ui_scale',            'normal'],
    ['ui_timeFormat',       '12h'],
    ['ui_reducedMotion',    'false'],
    ['ui_highContrast',     'false'],
    ['ui_colorblind',       'off'],
    ['ui_focusIndicators',  'false'],
    ['ui_autoLockMinutes',  '0'],
    ['ui_autoSaveInterval', '30'],
    ['win_startMaximized',  'true'],
    ['win_rememberPosition','false'],
  ];
  for (const [key, value] of settings) {
    db.run('INSERT INTO app_settings (key, value) VALUES (?,?)', [key, value]);
  }
  console.log(`✓ App settings seeded under real keys (theme=${SEED_THEME}, scale=normal, 12h)`);

  // ── Persist DB ─────────────────────────────────────────────────────────────
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  console.log(`✓ Database written → ${DB_FILE}`);

  // ── Profile manifest ────────────────────────────────────────────────────────
  const manifest = {
    username: DEV_USERNAME, display_name: 'Dev Tester', avatar_thumb_48: null,
    created_at: Math.floor(Date.now() / 1000),
    auth_methods: ['password+totp'], key_derivation_version: 'pbkdf2-v1',
    passkey_credential_id: null
  };
  fs.writeFileSync(path.join(DATA_DIR, 'profile-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`✓ Profile manifest written → ${path.join(DATA_DIR, 'profile-manifest.json')}`);

  // ═══════════════════════════════════════════════════════════════════════════
  //  SELF-CHECK — automated PASS/FAIL on the data just written
  // ═══════════════════════════════════════════════════════════════════════════
  const one = (sql) => Number(db.exec(sql)[0].values[0][0]);
  const checks = [];
  const expect = (name, expected, actual) =>
    checks.push({ name, expected, actual, pass: String(expected) === String(actual) });

  expect('users.count',                 1, one('SELECT COUNT(*) FROM users'));
  expect('user.dev_mode',               1, one('SELECT dev_mode FROM users'));
  expect('companies.count',             2, one('SELECT COUNT(*) FROM companies'));
  expect('time_entries.count',          6, one('SELECT COUNT(*) FROM time_entries'));
  expect('task_items.count',            6, one('SELECT COUNT(*) FROM task_items'));
  expect('task_items.break',            2, one("SELECT COUNT(*) FROM task_items WHERE item_type='break'"));
  expect('task_items.lunch',            1, one("SELECT COUNT(*) FROM task_items WHERE item_type='lunch'"));
  expect('app_settings.count', settings.length, one('SELECT COUNT(*) FROM app_settings'));
  expect('ui_theme.present',            1, one("SELECT COUNT(*) FROM app_settings WHERE key='ui_theme'"));
  expect('ui_theme.valid', true, VALID_THEMES.includes(
    db.exec("SELECT value FROM app_settings WHERE key='ui_theme'")[0].values[0][0]));
  expect('no_bare_setting_keys', 0, one(
    "SELECT COUNT(*) FROM app_settings WHERE key NOT LIKE 'ui\\_%' ESCAPE '\\' AND key NOT LIKE 'win\\_%' ESCAPE '\\'"));
  // Encryption round-trips with the derived session key
  let decOk = false;
  try {
    const r = db.exec('SELECT data_enc,data_iv,data_tag FROM companies LIMIT 1')[0].values[0];
    decOk = JSON.parse(decrypt(r[0], r[1], r[2], sessionKey)).name === 'Zenith Analytics';
  } catch {}
  expect('company.decrypt_roundtrip', true, decOk);
  // Replicate the audit detector to assert the expected count BEFORE the app runs
  const expectedDiscrepancies = computeExpectedDiscrepancies(db, userId, sessionKey, profileData.work_state);
  expect('audit.discrepancies', 6, expectedDiscrepancies);

  const failed = checks.filter(c => !c.pass);
  console.log('\n┌─ SELF-CHECK (data tier) ───────────────────────────────────┐');
  for (const c of checks) {
    const tag = c.pass ? 'PASS' : 'FAIL';
    console.log(`│ [${tag}] ${c.name.padEnd(26)} expected=${String(c.expected).padEnd(6)} got=${c.actual}`);
  }
  console.log('└────────────────────────────────────────────────────────────┘');
  if (failed.length) {
    console.log(`\n✗ SELF-CHECK FAILED — ${failed.length} bug(s) in the seed data:`);
    for (const c of failed) console.log(`   • ${c.name}: expected ${c.expected}, got ${c.actual}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ SELF-CHECK PASSED — all data-tier variables green.');
  }

  printPacket();
}

// Mirror of countAuditDiscrepancies() in main.js — kept here ONLY to assert the
// seed's expected count at seed time. If main.js's detection changes, update both.
function computeExpectedDiscrepancies(db, userId, sessionKey, workState) {
  const BREAK = { default: [[210, 0], [360, 1], [600, 2], [Infinity, 3]] };
  const LUNCH = 300;
  const reqBreaks = (m) => { for (const [t, c] of BREAK.default) if (m < t) return c; return 0; };
  const rows = db.exec('SELECT rowid, rows_enc, rows_iv, rows_tag, total_mins FROM time_entries WHERE user_id=' + userId);
  if (!rows.length) return 0;
  let count = 0;
  for (const v of rows[0].values) {
    const [rid, enc, iv, tag, total] = v;
    let parsed = [];
    try { parsed = JSON.parse(decrypt(enc, iv, tag, sessionKey)); } catch {}
    parsed.forEach((r) => {
      if (!r.clock_in && !r.clock_out && !r.label && !r.name) return;
      if (!r.clock_in) count++;
      else if (!r.clock_out) count++;
      else if (!r.total_mins) count++;
      else if (r.total_mins > 720) count++;
    });
    const tm = Number(total || 0);
    const rb = reqBreaks(tm);
    if (rb > 0) {
      const bc = Number(db.exec(`SELECT COUNT(*) FROM task_items WHERE entry_id=${rid} AND item_type='break'`)[0].values[0][0]);
      if (bc < rb) count++;
    }
    if (tm > LUNCH) {
      const hl = Number(db.exec(`SELECT COUNT(*) FROM task_items WHERE entry_id=${rid} AND item_type='lunch'`)[0].values[0][0]);
      if (!hl) count++;
    }
  }
  return count;
}

function printPacket() {
  console.log(`
╔══════════════════════════════════════════════╗
║           DEV LOGIN CREDENTIALS              ║
╠══════════════════════════════════════════════╣
║  Username : devuser                          ║
║  Password : devpass123                       ║
║  TOTP     : (leave blank — bypassed in dev)  ║
║  Recovery : SEED-ABCD-1234-EFGH              ║
╚══════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════╗
║   VERIFICATION PACKET — work top-to-bottom (order of operations)  ║
║   Run \`npm run dev\`. Mark each line PASS or FAIL.                ║
║                                                                    ║
║   Tier A = AUTOMATED  (state/data; also asserted by run-app)       ║
║   Tier B = MANUAL     (visual/interaction; confirm by eye)         ║
╚══════════════════════════════════════════════════════════════════╝

── 1. LAUNCH & LOGIN ─────────────────────────────────────────────
  A  splash.theme_aware ........ splash shows branded icon/wordmark/progress
  B  login.background ......... animated cell grid + hover glow render
  A  login.auth ............... devuser / devpass123, TOTP blank → Dashboard
  B  login.view_password ...... eye icon toggles password visibility

── 2. DASHBOARD ──────────────────────────────────────────────────
  A  dash.stat_chips .......... total time / companies(2) / sessions populated
  B  dash.mini_spiderweb ...... 2 company nodes render, theme-aware colors
  A  dash.recent_activity ..... today's Zenith entry listed
  B  dash.quick_actions ....... buttons navigate correctly

── 3. COMPANIES ──────────────────────────────────────────────────
  A  comp.count ............... Zenith Analytics + Apex Digital both present
  B  comp.spiderweb ........... full force-graph, click a node selects it
  A  comp.fields_zenith ....... open Zenith → ALL fields populated:
        Name, Job Title, Work Type, Location, Pay Rate, Start/End,
        Hierarchy (Company/Project/Platform), Nav ID,
        Login, Email, URL, Supervisors, Notes
  A  comp.persist ............. edit a field → Save → reopen shows the change
  A  comp.crud ............... add a 3rd company, save, then delete it

── 4. TIME TRACKER ───────────────────────────────────────────────
  A  trk.company_select ....... pick Zenith; today's entry loads its rows
  A  trk.clock_in_guard ....... Clock In blocked without Task Label + Name
  A  trk.clock_in_out ......... clock in → out → duration computes
  A  trk.manual_entry ......... "+ Manual Entry" adds an editable backfill row
  A  trk.break_lunch .......... Break / Lunch controls add task_items
  B  trk.inline_edit .......... double-click a clock time → edit → recalcs
  B  trk.row_min_grow ......... 5-row floor kept; table auto-grows on last row
  B  trk.summary_footer ....... total + per-label chips update
  A  trk.no_dupe_save ......... Save Session → no duplicate rows in Global Log

── 5. DISPATCH (Task Timer) ──────────────────────────────────────
  A  disp.seeded_tasks ........ 2 completed + 1 in-progress task visible
  B  disp.sidebar_timer ....... start a task → sidebar timer ticks
  A  disp.stop_records ........ stop task → duration recorded
  A  disp.task_name_link ...... "Log a Task" picks from active session names

── 6. GLOBAL LOG ─────────────────────────────────────────────────
  A  log.all_entries .......... all 6 seeded entries appear
  A  log.filter_company ....... Zenith → 3 entries, Apex → 3 entries
  A  log.filter_dates ......... narrow to last 7 days filters correctly
  B  log.expand_detail ........ expand a session → per-row clock detail
  A  log.open_correct_date .... "Open" loads the session's logged date
  A  log.csv_export ........... CSV downloads, opens cleanly
  B  log.pdf_export ........... PDF preview opens; Nav ID NOT shown (both cos.)

── 7. REPORTS & AUDIT ────────────────────────────────────────────
  A  aud.discrepancy_count .... EXACTLY 6 issues, all on the 3-days-ago session:
        no_clock_in, no_clock_out, zero_duration, over_12h,
        missing_break, missing_lunch
  A  aud.clean_sessions ....... the other 5 sessions show NO discrepancies
  A  aud.dismiss .............. Dismiss an issue → toolbar count drops to 5
  A  aud.apply_fix ........... Apply Fix on no_clock_out updates the row
  B  aud.wizard .............. Suggest/Acknowledge wizard steps each issue
  A  aud.email_me ............ "Email Me" marks acknowledged (needs SMTP cfg)
  B  rep.smtp_config ......... Reports tab: SMTP config + Send Now + schedule

── 8. SETTINGS  (sidebar gear or Ctrl+,) ─────────────────────────
  APPEARANCE:
  A  set.theme_default ....... opens on Zanarkand (seeded ui_theme)
  B  set.themes_all .......... Memoria, Zanarkand, Rabanastre, Treno,
        Nibelheim, Lindblum each apply live (6 themes)
  B  set.clock_format ........ 12h/24h toggle (under Appearance) updates times
  A  set.scale ............... Compact/Normal/Comfortable/Large; sidebar stays
        clickable at Large (scoped to #main-content)
  ACCESSIBILITY:
  B  set.reduced_motion ...... animations cease/resume
  B  set.high_contrast ....... contrast increases
  B  set.colorblind .......... mode toggles
  WINDOW:
  A  set.preferred_display ... monitor picker lists your display(s)
  B  set.start_maximized ..... toggle persists
  A  set.launch_at_startup ... toggle on → reflects ON after reopen (OS item)
  A  set.close_to_tray ....... toggle on → closing hides to tray, session alive
  DATA:
  B  set.backup_library ...... list loads; expand an accordion preview
  A  set.db_clear ............ Time Clock Clear (type CONFIRM) empties tracker
  SECURITY:
  B  set.auto_lock .......... set 1 min → idle → returns to login; data intact
  ABOUT:
  A  set.about_info ......... Version / Electron / Node / Platform populated
  B  set.check_updates ...... button returns a result (error OK if offline)

── 9. SYSTEM TRAY ────────────────────────────────────────────────
  B  tray.icon .............. tray icon present with tooltip
  A  tray.menu .............. Open / Lock Session / Backup Now / Quit work
  A  tray.restore ........... click / double-click restores the window

── 10. USER PROFILE ──────────────────────────────────────────────
  A  prof.fields ............ Dev Tester, dev@conqueredtime.app, 555-0100,
        QA Engineer, Work State = TX
  A  prof.avatar ............ seeded animated avatar shows in sidebar
  A  prof.edit_name ......... change display name → sidebar updates live
  A  prof.password_change ... current devpass123 → new → re-login works
        (then \`npm run seed\` to reset)

══════════════════════════════════════════════════════════════════
  RESULTS — fill in after the walkthrough
══════════════════════════════════════════════════════════════════
  • If EVERYTHING passed → report:  "ALL PASS"  then list every variable
    above (1.A … 10.prof.password_change) with PASS.
  • If ANY check failed → report a BUGS list, one per failure:
        BUG <id>  <variable>
          page/area : <where>
          expected  : <what the packet says>
          actual    : <what happened>
          severity  : blocker | major | minor
          repro     : <steps>
  • Tier A items are also machine-checkable — run the run-app driver to
    confirm counts/state without clicking.

══════════════════════════════════════════════════════════════════
  ⚡ \`npm run seed\` resets to this exact state (expected audit count = 6).
══════════════════════════════════════════════════════════════════
`);
}

seed().catch(e => { console.error('\n✗ Seed failed:', e); process.exit(1); });
