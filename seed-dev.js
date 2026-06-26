/**
 * ═══════════════════════════════════════════════════════════════════════
 *  CONQUERED TIME — Comprehensive Dev Seed Script
 *  Run:  npm run seed      → seeds ./dev-data/dev-vault.db (never touches real vault)
 *        npm run dev       → launches app using dev-vault.db
 *
 *  What this seeds:
 *    • 1 dev user (TOTP bypassed, profile pre-filled)
 *    • 2 companies with ALL fields populated
 *    • 6 time entries across multiple dates:
 *        - Clean sessions with clock in/out + break + lunch rows
 *        - Discrepancy sessions to exercise the audit system:
 *            › Missing clock-out on a row
 *            › Overlapping clock times between rows
 *            › Duration mismatch (stored vs calculated)
 *    • Task items for Dispatch module
 *    • App settings (Arctic theme default)
 *
 *  Prints a structured manual-verification checklist on completion.
 *
 *  ⚠  NEVER ships in a production build — dev only.
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ── Paths ──────────────────────────────────────────────────────────────────
// Dev DB lives inside the project at ./dev-data/ — completely separate from
// the real user vault in AppData. Run the app with `npm run start:dev` to
// pick this DB up. The real vault.db is never touched by this script.
const DATA_DIR   = path.join(__dirname, 'dev-data');
const DB_FILE    = path.join(DATA_DIR, 'dev-vault.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// ── Dev credentials ────────────────────────────────────────────────────────
const DEV_USERNAME = 'devuser';
const DEV_PASSWORD = 'devpass123';
const DEV_RECOVERY = 'SEED-ABCD-1234-EFGH';

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
  console.log('║   CONQUERED TIME — Comprehensive Dev Seed v2.0  ║');
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
  const avatarDataUrl = `data:image/gif;base64,${require('fs').readFileSync(require('path').join(__dirname, 'assets', 'ruxin_dev.gif')).toString('base64')}`;

  const profileData = {
    full_name:   'Dev Tester',
    email:       'dev@conqueredtime.app',
    phone:       '555-0100',
    job_title:   'QA Engineer',
    work_state:  'CA',
    descriptor:  'Testing all the things so you don\'t have to.',
    avatar:      avatarDataUrl
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
  console.log(`✓ Dev user created (id: ${userId}, display: Dev Tester)`);

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
  db.run(
    `INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (?,?,?,?)`,
    [userId, encA.data, encA.iv, encA.tag]
  );
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
  db.run(
    `INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (?,?,?,?)`,
    [userId, encB.data, encB.iv, encB.tag]
  );
  const companyIdB = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Company B: Apex Digital (id: ${companyIdB})`);

  // ── Helper: blank filler rows ──────────────────────────────────────────────
  const blank = (n = 12) => Array(n).fill(null).map(() => ({
    label: '', name: '', desc: '', total_mins: 0, clock_in: '', clock_out: ''
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  //  TIME ENTRIES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Entry 1: TODAY — Company A — Clean session with break + lunch ──────────
  const entry1Rows = [
    { label: 'Clock In',   name: 'Start of day',      desc: 'Logged in and set up workspace',   total_mins: 0,   clock_in: timeStr(8, 0),  clock_out: '' },
    { label: 'Annotation', name: 'Batch Phoenix-001',  desc: 'Text classification — set A',      total_mins: 90,  clock_in: timeStr(8, 0),  clock_out: timeStr(9, 30) },
    { label: 'Break',      name: 'Morning break',      desc: '15 min rest',                       total_mins: 15,  clock_in: timeStr(9, 30), clock_out: timeStr(9, 45) },
    { label: 'Annotation', name: 'Batch Phoenix-002',  desc: 'Text classification — set B',      total_mins: 105, clock_in: timeStr(9, 45), clock_out: timeStr(11, 30) },
    { label: 'Lunch',      name: 'Lunch break',        desc: '30 min lunch',                      total_mins: 30,  clock_in: timeStr(11, 30),clock_out: timeStr(12, 0) },
    { label: 'QA',         name: 'Review pass',        desc: 'Spot-check annotations from AM',   total_mins: 60,  clock_in: timeStr(12, 0), clock_out: timeStr(13, 0) },
    { label: 'Admin',      name: 'Batch submission',   desc: 'Submit completed batches to portal',total_mins: 15,  clock_in: timeStr(13, 0), clock_out: timeStr(13, 15) },
    ...blank(8)
  ];
  const enc1 = encrypt(JSON.stringify(entry1Rows), sessionKey);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyIdA, daysAgo(0), 'Morning Annotation Block', '', enc1.data, enc1.iv, enc1.tag, 270]
  );
  const entry1Id = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Entry 1: Today — Zenith Analytics — clean session (4h 30m)`);

  // ── Entry 2: YESTERDAY — Company B — Clean session ─────────────────────────
  const entry2Rows = [
    { label: 'QA',         name: 'Regression suite A', desc: 'Login flow + auth edge cases',    total_mins: 120, clock_in: timeStr(9, 0),  clock_out: timeStr(11, 0) },
    { label: 'Break',      name: 'Break',               desc: '',                                total_mins: 15,  clock_in: timeStr(11, 0), clock_out: timeStr(11, 15) },
    { label: 'QA',         name: 'Regression suite B', desc: 'Payment flow + checkout errors',  total_mins: 90,  clock_in: timeStr(11, 15),clock_out: timeStr(12, 45) },
    { label: 'Bug Report', name: 'File BRs',            desc: 'Wrote up 3 P2 bugs in tracker',  total_mins: 45,  clock_in: timeStr(12, 45),clock_out: timeStr(13, 30) },
    ...blank(11)
  ];
  const enc2 = encrypt(JSON.stringify(entry2Rows), sessionKey);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyIdB, daysAgo(1), 'QA Regression Day', '', enc2.data, enc2.iv, enc2.tag, 255]
  );
  const entry2Id = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Entry 2: Yesterday — Apex Digital — clean session (4h 15m)`);

  // ── Entry 3: 3 DAYS AGO — Company A — DISCREPANCY SESSION (for audit) ──────
  //    Discrepancies planted:
  //      Row 1: missing clock_out (clock in recorded, never clocked out)
  //      Row 2 & 3: overlapping clock times (row 2 ends at 11:30, row 3 starts at 11:00)
  //      Row 4: duration mismatch (stored 120 mins but clock_in/out span = 45 mins)
  const entry3Rows = [
    { label: 'Annotation', name: 'Batch Phoenix-003', desc: 'Early session — interrupted',      total_mins: 60,  clock_in: timeStr(8, 0),  clock_out: '' },           // ← MISSING CLOCK-OUT
    { label: 'QA',         name: 'Review batch 003',  desc: 'Spot check pass',                  total_mins: 90,  clock_in: timeStr(10, 0), clock_out: timeStr(11, 30) },
    { label: 'Annotation', name: 'Batch Phoenix-004', desc: 'Overlap with QA row above',        total_mins: 75,  clock_in: timeStr(11, 0), clock_out: timeStr(12, 15) }, // ← OVERLAP (starts before row 2 ends)
    { label: 'Admin',      name: 'Portal admin tasks', desc: 'Duration mismatch entry',         total_mins: 120, clock_in: timeStr(13, 0), clock_out: timeStr(13, 45) }, // ← MISMATCH (45 min span, stored 120)
    { label: 'Lunch',      name: 'Lunch',              desc: '',                                total_mins: 30,  clock_in: timeStr(12, 15),clock_out: timeStr(12, 45) },
    ...blank(10)
  ];
  const enc3 = encrypt(JSON.stringify(entry3Rows), sessionKey);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyIdA, daysAgo(3), 'Discrepancy Test Session', '', enc3.data, enc3.iv, enc3.tag, 345]
  );
  const entry3Id = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Entry 3: 3 days ago — Zenith Analytics — DISCREPANCY session (audit bait)`);

  // ── Entry 4: 5 DAYS AGO — Company B — Clean older session ──────────────────
  const entry4Rows = [
    { label: 'QA',         name: 'Smoke test build 42', desc: 'Full app smoke test post-deploy', total_mins: 60,  clock_in: timeStr(10, 0), clock_out: timeStr(11, 0) },
    { label: 'Bug Report', name: 'Critical BR',          desc: 'P1 crash on checkout — filed',   total_mins: 30,  clock_in: timeStr(11, 0), clock_out: timeStr(11, 30) },
    { label: 'QA',         name: 'Verify hotfix',        desc: 'Confirmed fix on build 42a',     total_mins: 30,  clock_in: timeStr(11, 30),clock_out: timeStr(12, 0) },
    ...blank(12)
  ];
  const enc4 = encrypt(JSON.stringify(entry4Rows), sessionKey);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyIdB, daysAgo(5), 'Hotfix Verification', '', enc4.data, enc4.iv, enc4.tag, 120]
  );
  const entry4Id = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  console.log(`✓ Entry 4: 5 days ago — Apex Digital — clean session (2h)`);

  // ── Entry 5: 10 DAYS AGO — Company A — Older global log entry ──────────────
  const entry5Rows = [
    { label: 'Training',   name: 'Platform onboarding', desc: 'ZenDesk Pro tutorial modules',   total_mins: 120, clock_in: timeStr(9, 0),  clock_out: timeStr(11, 0) },
    { label: 'Annotation', name: 'Trial batch',          desc: 'Unpaid trial annotation set',    total_mins: 60,  clock_in: timeStr(11, 0), clock_out: timeStr(12, 0) },
    ...blank(13)
  ];
  const enc5 = encrypt(JSON.stringify(entry5Rows), sessionKey);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyIdA, daysAgo(10), 'Onboarding Week', '', enc5.data, enc5.iv, enc5.tag, 180]
  );
  console.log(`✓ Entry 5: 10 days ago — Zenith Analytics — training session`);

  // ── Entry 6: 14 DAYS AGO — Company B — Oldest entry ───────────────────────
  const entry6Rows = [
    { label: 'QA',         name: 'Environment setup',   desc: 'VPN + tooling setup for Apex',   total_mins: 90,  clock_in: timeStr(14, 0), clock_out: timeStr(15, 30) },
    ...blank(14)
  ];
  const enc6 = encrypt(JSON.stringify(entry6Rows), sessionKey);
  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, companyIdB, daysAgo(14), 'Setup Day', '', enc6.data, enc6.iv, enc6.tag, 90]
  );
  console.log(`✓ Entry 6: 14 days ago — Apex Digital — setup session`);

  // ── Task items (Dispatch module) ────────────────────────────────────────────
  const now = unixNow();
  // Completed tasks on entry 1
  db.run(`INSERT INTO task_items (user_id, entry_id, label, item_type, started_at, stopped_at, duration_secs) VALUES (?,?,?,?,?,?,?)`,
    [userId, entry1Id, 'Review Phoenix batch guidelines', 'task', now - 7200, now - 6300, 900]);
  db.run(`INSERT INTO task_items (user_id, entry_id, label, item_type, started_at, stopped_at, duration_secs) VALUES (?,?,?,?,?,?,?)`,
    [userId, entry1Id, 'Annotation — set A', 'task', now - 6000, now - 4500, 1500]);
  db.run(`INSERT INTO task_items (user_id, entry_id, label, item_type, started_at, stopped_at, duration_secs) VALUES (?,?,?,?,?,?,?)`,
    [userId, entry1Id, 'Morning break', 'break', now - 4500, now - 3600, 900]);
  // In-progress task (no stopped_at)
  db.run(`INSERT INTO task_items (user_id, entry_id, label, item_type, started_at, stopped_at, duration_secs) VALUES (?,?,?,?,?,?,?)`,
    [userId, entry1Id, 'Annotation — set B', 'task', now - 3600, null, 0]);
  console.log(`✓ Task items seeded (3 completed + 1 in-progress for Dispatch)`);

  // ── App settings ────────────────────────────────────────────────────────────
  const settings = [
    ['theme',            'arctic'],
    ['uiScale',          'normal'],
    ['timeFormat',       '12h'],
    ['reducedMotion',    'false'],
    ['highContrast',     'false'],
    ['colorblindSafe',   'false'],
    ['autoLockMinutes',  '0'],
    ['startMaximized',   'true'],
    ['rememberPosition', 'false'],
  ];
  for (const [key, value] of settings) {
    db.run('INSERT INTO app_settings (key, value) VALUES (?,?)', [key, value]);
  }
  console.log('✓ App settings seeded (Arctic theme, Normal scale, 12h time)');

  // ── Persist DB ─────────────────────────────────────────────────────────────
  const dbData = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(dbData));
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
  //  CREDENTIALS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║           DEV LOGIN CREDENTIALS             ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Username : devuser                         ║');
  console.log('║  Password : devpass123                      ║');
  console.log('║  TOTP     : (leave blank — bypassed)        ║');
  console.log('║  Recovery : SEED-ABCD-1234-EFGH             ║');
  console.log('╚══════════════════════════════════════════════╝');

  // ═══════════════════════════════════════════════════════════════════════════
  //  MANUAL VERIFICATION CHECKLIST
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║             MANUAL VERIFICATION CHECKLIST                       ║
║             Run \`npm start\` then work through these.           ║
╚══════════════════════════════════════════════════════════════════╝

── 1. LOGIN ──────────────────────────────────────────────────────
  [ ] Login screen loads with animated background grid
  [ ] Enter devuser / devpass123 — TOTP field can be left blank
  [ ] Lands on Dashboard (not login loop)

── 2. DASHBOARD ──────────────────────────────────────────────────
  [ ] Stat chips show data (total time, companies, sessions)
  [ ] Mini spiderweb renders 2 company nodes
  [ ] Recent activity list shows today's entry
  [ ] Quick actions respond to clicks

── 3. COMPANIES PAGE ─────────────────────────────────────────────
  [ ] Both companies appear: Zenith Analytics + Apex Digital
  [ ] Full spiderweb renders with 2 nodes; click a node selects it
  [ ] Open each company — verify ALL fields are populated:
        Name, Job Title, Work Type, Location, Pay Rate, Dates,
        Hierarchy (Company/Project/Platform), Nav ID,
        Login, Email, URL, Supervisors, Notes
  [ ] Edit a field → Save → reopen to confirm persistence
  [ ] Add a 3rd company, fill minimum fields, save, delete it

── 4. TRACKER ────────────────────────────────────────────────────
  [ ] Select Zenith Analytics from company dropdown
  [ ] Clock In button → timestamp appears in clock_in column
  [ ] Add a label/task name to a row
  [ ] Clock Out → duration calculates correctly
  [ ] Add a Break row and a Lunch row
  [ ] Inline edit: double-click a clock_in time → change it → Tab out
        Duration should recalculate automatically
  [ ] Verify 5-row minimum is maintained
  [ ] Verify table auto-grows when last row is used
  [ ] Session time summary footer updates (total + per-label chips)
  [ ] Save Session button → no duplicate entries in Global Log

── 5. DISPATCH (Task Timer) ──────────────────────────────────────
  [ ] Navigate to Dispatch page
  [ ] Pre-seeded tasks visible (3 completed, 1 in-progress)
  [ ] Start a new task → timer ticks in sidebar
  [ ] Stop task → duration recorded
  [ ] Break / Lunch compliance timers appear correctly
  [ ] Tracker footer preview shows Dispatch data

── 6. GLOBAL LOG ─────────────────────────────────────────────────
  [ ] All 6 seeded entries appear across the log
  [ ] Filter by Company — Zenith shows 3 entries, Apex shows 3
  [ ] Filter by date range — narrow to last 7 days
  [ ] Expand a session row → per-task detail rows visible
  [ ] CSV Export — file downloads, opens cleanly in Excel
  [ ] PDF Export — modal/print preview opens; NavID NOT visible
        (check both company A and company B PDFs)

── 7. AUDIT ──────────────────────────────────────────────────────
  [ ] Navigate to Audit page
  [ ] Entry from 3 days ago (Discrepancy Test Session) shows issues:
        › Row 1: Missing clock-out flagged
        › Row 2/3: Overlapping times flagged
        › Row 4: Duration mismatch flagged
  [ ] Dismiss a discrepancy → count decreases in toolbar
  [ ] Apply Fix on a discrepancy → row updates in tracker
  [ ] Suggest Fix wizard steps through each issue
  [ ] Acknowledge button marks issue resolved
  [ ] Dismissed items hidden by default; Show Dismissed reveals them
  [ ] Clear All Dismissed removes them from the dismissed list

── 8. SETTINGS ───────────────────────────────────────────────────
  Open Settings via sidebar button OR Ctrl+,

  APPEARANCE:
  [ ] Arctic (default) — verify cool blue/navy look ← START HERE
  [ ] Slate — professional blue-grey
  [ ] Void — teal on black, glow effects visible
  [ ] Paper — light mode, soft blue-grey (card should be visible, not blended)
  [ ] Quartz — light mode, near-black charcoal, stark/legal feel
  [ ] Return to Arctic before continuing

  SCALE:
  [ ] Compact — UI shrinks, sidebar stays visible and clickable
  [ ] Normal — default proportions
  [ ] Comfortable — slightly larger
  [ ] Large — enlarged; sidebar MUST still be fully accessible
  [ ] Return to Normal

  TIME & DISPLAY:
  [ ] Toggle 12h/24h — timestamps in tracker update display format
  [ ] Auto-lock: set to 1 min → wait → verify lock fires → set back to Off

  ACCESSIBILITY:
  [ ] Reduced Motion — toggle; animations should cease/resume
  [ ] High Contrast — toggle; verify contrast increases
  [ ] Colorblind Safe — toggle on/off

  DATA:
  [ ] Backup Library — list loads; expand an accordion preview
  [ ] Time Clock Clear — type CONFIRM → clears → verify tracker is empty
      (re-run seed after this if you want data back)

  WINDOW:
  [ ] Preferred Display picker shows your monitor(s)
  [ ] Start Maximized toggle

  ABOUT:
  [ ] Version, Electron, Node, Platform all populated
  [ ] Check for Updates button → shows result (error is OK if not on GitHub)
  [ ] Credits and changelog visible

── 9. USER PROFILE ───────────────────────────────────────────────
  [ ] Click avatar/initials in sidebar → Profile page opens
  [ ] Pre-seeded fields visible: Dev Tester, dev@conqueredtime.app,
        555-0100, QA Engineer, descriptor text
  [ ] Edit display name → save → sidebar avatar/name updates live
  [ ] Upload an avatar image → appears in sidebar
  [ ] Password change: enter devpass123 as current → set new → log out
        → log back in with new password (then reseed to reset)

── 10. SESSION AUTO-LOCK ────────────────────────────────────────
  [ ] Settings → Time & Display → Auto-lock: set to 1 min
  [ ] Leave app idle for 60 seconds
  [ ] App returns to login screen automatically
  [ ] Login again → session data still intact

── 11. SPLASH SCREEN ────────────────────────────────────────────
  [ ] Close and relaunch app (npm start)
  [ ] Splash screen appears: icon, wordmark, tagline, progress bar
  [ ] Theme-aware: change theme, relaunch → splash should match

── 12. EASTER EGGS (optional) ───────────────────────────────────
  [ ] On login screen: press Ctrl+Shift+D → debug overlay labels cells
  [ ] Click the 3-cell E sequence → ASCII hourglass appears, fades
  [ ] Dev backdoor: click 5-cell D sequence → styled backdoor screen

══════════════════════════════════════════════════════════════════
  ⚡ Run \`npm run seed\` at any time to reset to this full state.
══════════════════════════════════════════════════════════════════
`);
}

seed().catch(e => { console.error('\n✗ Seed failed:', e); process.exit(1); });
