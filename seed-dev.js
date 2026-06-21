/**
 * ═══════════════════════════════════════════════════════════
 *  CONQUERED TIME — Dev Seed Script
 *  Run: node seed-dev.js
 *
 *  Creates a ready-to-use dev database with:
 *    Username : devuser
 *    Password : devpass123
 *    TOTP     : BYPASSED (dev mode flag set in DB)
 *    Company  : RWS (with full hierarchy pre-filled)
 *    Entry    : Sample time session for today
 *
 *  ⚠ NEVER ships in production build — dev only.
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const os     = require('os');

// ── Paths (mirrors what Electron uses for userData on Windows) ─────────────
const APP_NAME  = 'conquered-time';
const DATA_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', APP_NAME, 'conquered-data');
const DB_FILE   = path.join(DATA_DIR, 'vault.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// ── Dev credentials (hardcoded — this is the point) ──────────────────────
const DEV_USERNAME = 'devuser';
const DEV_PASSWORD = 'devpass123';
const DEV_RECOVERY = 'SEED-ABCD-1234-EFGH';

// ── Crypto (mirrors main.js exactly) ─────────────────────────────────────
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

async function seed() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   CONQUERED TIME — Dev Seed Script   ║');
  console.log('╚══════════════════════════════════════╝\n');

  // ── Wipe existing dev DB ───────────────────────────────────────────────
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('✓ Cleared old database');
  }
  fs.mkdirSync(DATA_DIR,   { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('✓ Created data directories');

  // ── Load sql.js ────────────────────────────────────────────────────────
  let SQL;
  try {
    SQL = await require('sql.js')();
  } catch (e) {
    console.error('✗ sql.js not found. Run `npm install` first.\n', e.message);
    process.exit(1);
  }
  const db = new SQL.Database();

  // ── Schema ─────────────────────────────────────────────────────────────
  db.run(`PRAGMA foreign_keys = ON;`);
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
  `);
  console.log('✓ Schema created');

  // ── Create dev user ────────────────────────────────────────────────────
  const bcrypt  = require('bcryptjs');
  const keySalt = crypto.randomBytes(32).toString('hex');
  const sessionKey = deriveKey(DEV_PASSWORD, keySalt);

  const passwordHash = bcrypt.hashSync(DEV_PASSWORD, 10); // lower cost for dev speed
  const recoveryHash = bcrypt.hashSync(DEV_RECOVERY, 10);

  // dev_mode=1 tells main.js to skip TOTP verification on login
  db.run(
    `INSERT INTO users (username, password_hash, totp_secret, totp_verified, recovery_hash, key_salt, dev_mode)
     VALUES (?,?,?,1,?,?,1)`,
    [DEV_USERNAME, passwordHash, 'DEVMODE_NO_TOTP', recoveryHash, keySalt]
  );

  // Get inserted user ID
  const idResult = db.exec('SELECT last_insert_rowid() as id');
  const userId   = Number(idResult[0].values[0][0]);
  console.log(`✓ Dev user created (id: ${userId})`);

  // ── Encrypt and insert sample company ─────────────────────────────────
  const companyData = {
    name:          'RWS',
    job_title:     'Annotation Specialist',
    work_type:     'Annotation',
    location:      'Remote — USA',
    pay_rate:      0,
    date_start:    '2025-01-01',
    date_end:      '',
    hier_company:  'RWS',
    hier_project:  'Diamond',
    hier_platform: 'multimango',
    nav_id:        'X192847',       // randomized placeholder — never use real PPI in dev data
    platform_login: 'test_login',
    platform_email: 'test@rws.com',
    platform_url:   'https://platform.rws.com',
    supervisors:    'Test Supervisor',
    notes:          'Seeded dev company'
  };

  const { iv, tag, data } = encrypt(JSON.stringify(companyData), sessionKey);
  db.run(
    `INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (?,?,?,?)`,
    [userId, data, iv, tag]
  );

  const coIdResult = db.exec('SELECT last_insert_rowid() as id');
  const companyId  = Number(coIdResult[0].values[0][0]);
  console.log(`✓ Sample company inserted (id: ${companyId})`);

  // ── Insert sample time entry ───────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const sampleRows = [
    { label: 'Training',   name: 'Onboarding',      desc: 'Initial setup',   total_mins: 45 },
    { label: 'Annotation', name: 'Batch A review',   desc: 'Test entries',    total_mins: 90 },
    { label: 'QA',         name: 'Quality check',    desc: 'Review pass',     total_mins: 30 },
    ...Array(12).fill({ label: '', name: '', desc: '', total_mins: 0 })
  ];

  db.run(
    `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, total_mins)
     VALUES (?,?,?,?,?,?)`,
    [userId, companyId, today, 'Dev seed session', JSON.stringify(sampleRows), 165]
  );
  console.log(`✓ Sample time entry inserted (${today}, 2h 45m)`);

  // ── Persist to disk ────────────────────────────────────────────────────
  const dbData = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(dbData));
  console.log(`✓ Database written to: ${DB_FILE}`);

  // ── Print login instructions ───────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║         DEV LOGIN CREDENTIALS        ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Username : ${DEV_USERNAME.padEnd(26)}║`);
  console.log(`║  Password : ${DEV_PASSWORD.padEnd(26)}║`);
  console.log('║  TOTP     : (leave blank / any code) ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('\n⚡ Run `npm start` to launch.\n');
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
