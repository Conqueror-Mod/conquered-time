'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, screen, safeStorage } = require('electron');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const { execFile } = require('child_process');

// ── Single instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── Data paths ─────────────────────────────────────────────────────────────
// --dev flag: uses ./dev-data/dev-vault.db; skips profile selector entirely.
// Production: each user lives in conquered-data/profiles/<username>/vault.db.
const IS_DEV        = process.argv.includes('--dev');
const ROOT_DATA_DIR = IS_DEV
  ? path.join(__dirname, '..', '..', 'dev-data')
  : path.join(app.getPath('userData'), 'conquered-data');
const PROFILES_DIR  = IS_DEV ? null : path.join(ROOT_DATA_DIR, 'profiles');

// Mutable — set when a profile is selected via profiles:select (or auto-set in dev)
let ACTIVE_PROFILE_DIR = IS_DEV ? ROOT_DATA_DIR : null;
let DB_FILE            = IS_DEV ? path.join(ROOT_DATA_DIR, 'dev-vault.db') : null;
let BACKUP_DIR         = IS_DEV ? path.join(ROOT_DATA_DIR, 'backups') : null;

fs.mkdirSync(ROOT_DATA_DIR, { recursive: true });
if (IS_DEV) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── In-memory session state ────────────────────────────────────────────────
let sessionKey  = null;
let sessionUser = null;
let mainWindow  = null;
let SQL         = null;   // sql.js module
let db          = null;   // sql.js Database instance
let idleTimer    = null;   // auto-lock timeout handle
let forceClose   = false;  // set true after user confirms close through audit prompt
let activeEntryId = null;  // rowid of the currently live time_entries row

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
  if (db) {
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
    const tmpDb = new SQL.Database(buf);
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
    const tmpDb = new SQL.Database(buf);
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
  DB_FILE   = path.join(profileDir, IS_DEV ? 'dev-vault.db' : 'vault.db');
  BACKUP_DIR = path.join(profileDir, 'backups');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  if (!SQL) SQL = await require('sql.js')();

  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

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

  // time_entries encryption columns
  try { db.run('ALTER TABLE time_entries ADD COLUMN rows_enc TEXT'); } catch {}
  try { db.run('ALTER TABLE time_entries ADD COLUMN rows_iv  TEXT'); } catch {}
  try { db.run('ALTER TABLE time_entries ADD COLUMN rows_tag TEXT'); } catch {}

  // Profile column migrations — safe to run on every startup
  try { db.run('ALTER TABLE users ADD COLUMN display_name TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN profile_enc  TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN profile_iv   TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN profile_tag  TEXT'); } catch {}
  // Recovery key packet — seals the session key under the recovery code so password reset is possible
  try { db.run('ALTER TABLE users ADD COLUMN recovery_key_enc  TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN recovery_key_iv   TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN recovery_key_tag  TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN recovery_key_salt TEXT'); } catch {}

  persistDB();
}

// ── Persist sql.js DB to disk ──────────────────────────────────────────────
function persistDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// ── Backup ─────────────────────────────────────────────────────────────────
function performBackup() {
  if (!fs.existsSync(DB_FILE)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest  = path.join(BACKUP_DIR, `vault-${stamp}.db`);
  fs.copyFileSync(DB_FILE, dest);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('vault-') && f.endsWith('.db')).sort();
  if (files.length > 30)
    files.slice(0, files.length - 30).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
}

// ── sql.js helpers ─────────────────────────────────────────────────────────
function dbGet(sql, params = []) {
  const result = db.exec(sql, params);
  if (result && result[0] && result[0].values && result[0].values[0]) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const row = {};
    cols.forEach((col, i) => { row[col] = vals[i] !== undefined ? vals[i] : null; });
    return row;
  }
  return null;
}

function dbAll(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result || !result[0]) return [];
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const row = {};
    cols.forEach((col, i) => { row[col] = vals[i] !== undefined ? vals[i] : null; });
    return row;
  });
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  return db.getRowsModified();
}

function dbInsert(sql, params = []) {
  db.run(sql, params);
  // sql.js last_insert_rowid() can be unreliable — use max(id) from the table instead
  // Extract the table name from the INSERT statement
  const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
  if (tableMatch) {
    const table = tableMatch[1];
    const result = db.exec(`SELECT MAX(id) as id FROM ${table}`);
    if (result && result[0] && result[0].values && result[0].values[0]) {
      return Number(result[0].values[0][0]);
    }
  }
  return null;
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────
function encrypt(plaintext, key) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: enc.toString('hex') };
}

function decrypt(encObj, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encObj.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encObj.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encObj.data, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

function deriveKey(password, salt) {
  // Key derived from password + stable stored salt only.
  // TOTP is used for authentication but NOT key derivation (TOTP rotates every 30s).
  return crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
}

function decryptEntry(row) {
  if (row.rows_enc && row.rows_iv && row.rows_tag) {
    try {
      row.rows_json = decrypt({ data: row.rows_enc, iv: row.rows_iv, tag: row.rows_tag }, sessionKey);
    } catch { row.rows_json = '[]'; }
  }
  return row;
}

function migrateTimeEntries() {
  if (!sessionKey || !sessionUser) return;
  try {
    const plain = dbAll(
      'SELECT rowid as rid, rows_json FROM time_entries WHERE user_id=? AND rows_enc IS NULL',
      [sessionUser.id]
    );
    for (const r of plain) {
      const enc = encrypt(r.rows_json || '[]', sessionKey);
      db.run(
        'UPDATE time_entries SET rows_enc=?, rows_iv=?, rows_tag=?, rows_json=? WHERE rowid=?',
        [enc.data, enc.iv, enc.tag, '', r.rid]
      );
    }
    if (plain.length > 0) persistDB();
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
  splash.loadFile(path.join(__dirname, '../renderer/pages/splash.html'), {
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
  wizard.loadFile(path.join(__dirname, '../renderer/pages/audit-wizard.html'), {
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
  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/login.html'));
  mainWindow.on('close', (event) => {
    if (sessionUser && !forceClose) {
      const count = countAuditDiscrepancies();
      if (count > 0) {
        event.preventDefault();
        mainWindow.webContents.send('audit:close-warning', { count, action: 'close' });
        return;
      }
    }
    forceClose = false;
    clearIdleTimer(); persistDB(); performBackup();
    sessionKey = null; sessionUser = null;
  });
}

function buildMenu() {
  const template = [
    { label: 'File', submenu: [
      { label: 'Lock Session',   accelerator: 'CmdOrCtrl+L', click: lockSession },
      { type: 'separator' },
      { label: 'Export PDF...',  accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('menu:export-pdf') },
      { label: 'Export CSV...',  click: () => mainWindow.webContents.send('menu:export-csv') },
      { type: 'separator' },
      { label: 'Backup Now',     click: () => { persistDB(); performBackup(); mainWindow.webContents.send('toast', { msg: 'Backup saved.', type: 'success' }); } },
      { type: 'separator' },
      { label: 'Quit',           accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
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

function navigate(page) {
  if (!sessionUser && page !== 'login') return;
  mainWindow.loadFile(path.join(__dirname, `../renderer/pages/${page}.html`));
}

const BREAK_POLICIES = {
  default: {
    label: 'General recommendation',
    breakThresholds: [[210, 0], [360, 1], [600, 2], [Infinity, 3]],
    lunchThreshMins: 300,
    dispatchBreakWarnMins: 150,
    dispatchLunchWarnMins: 270,
  },
  strict_breaks: {
    label: 'Strict rest breaks (per 4h)',
    breakThresholds: [[120, 0], [360, 1], [600, 2], [Infinity, 3]],
    lunchThreshMins: 300,
    dispatchBreakWarnMins: 90,
    dispatchLunchWarnMins: 270,
  },
  meal_only: {
    label: 'Meal break required (no rest break mandate)',
    breakThresholds: [[Infinity, 0]],
    lunchThreshMins: 360,
    dispatchBreakWarnMins: Infinity,
    dispatchLunchWarnMins: 300,
  },
};

const STATE_POLICY = {
  CA:'strict_breaks', CO:'strict_breaks', IL:'strict_breaks', KY:'strict_breaks',
  ME:'strict_breaks', MN:'strict_breaks', NE:'strict_breaks', NV:'strict_breaks',
  NH:'strict_breaks', ND:'strict_breaks', OR:'strict_breaks', VT:'strict_breaks',
  WA:'strict_breaks', WV:'strict_breaks',
  CT:'meal_only', DE:'meal_only', MA:'meal_only', NM:'meal_only',
  NY:'meal_only', RI:'meal_only', TN:'meal_only',
};

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'Washington D.C.', FL:'Florida',
  GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana',
  IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine',
  MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi',
  MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire',
  NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island',
  SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah',
  VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin',
  WY:'Wyoming',
};

function getPolicy(workState) {
  const key = workState ? (STATE_POLICY[workState] || 'default') : 'default';
  return BREAK_POLICIES[key];
}

function requiredBreaks(totalMins, policy) {
  const thresholds = (policy || BREAK_POLICIES.default).breakThresholds;
  for (const [threshold, count] of thresholds) {
    if (totalMins < threshold) return count;
  }
  return 0;
}

function getDismissedSet() {
  if (!sessionUser) return new Set();
  return new Set(
    dbAll('SELECT entry_id, row_idx, type FROM audit_dismissed WHERE user_id=?', [sessionUser.id])
      .map(d => `${d.entry_id}:${d.row_idx}:${d.type}`)
  );
}

function countAuditDiscrepancies() {
  if (!sessionUser) return 0;
  const dismissed = getDismissedSet();
  const entries = dbAll('SELECT rowid as rid, rows_json, rows_enc, rows_iv, rows_tag, total_mins FROM time_entries WHERE user_id=?', [sessionUser.id]);
  let count = 0;
  entries.forEach(e => {
    decryptEntry(e);
    const entryId = Number(e.rid);
    try {
      JSON.parse(e.rows_json || '[]').forEach((r, idx) => {
        if (!r.clock_in && !r.clock_out && !r.label && !r.name) return;
        if (!r.clock_in) {
          if (!dismissed.has(`${entryId}:${idx}:no_clock_in`)) count++;
        } else if (!r.clock_out) {
          if (!dismissed.has(`${entryId}:${idx}:no_clock_out`)) count++;
        } else if (!r.total_mins) {
          if (!dismissed.has(`${entryId}:${idx}:zero_duration`)) count++;
        } else if (r.total_mins > 720) {
          if (!dismissed.has(`${entryId}:${idx}:over_12h`)) count++;
        }
      });
    } catch {}

    const totalMins = Number(e.total_mins || 0);
    const policy = getPolicy(sessionUser.work_state);
    const reqBreaks = requiredBreaks(totalMins, policy);
    if (reqBreaks > 0) {
      const breakCount = (dbGet('SELECT COUNT(*) as c FROM task_items WHERE entry_id=? AND user_id=? AND item_type=?',
        [entryId, sessionUser.id, 'break']) || {}).c || 0;
      if (breakCount < reqBreaks && !dismissed.has(`${entryId}:-1:missing_break`)) count++;
    }
    if (totalMins > policy.lunchThreshMins) {
      const hasLunch = dbGet('SELECT id FROM task_items WHERE entry_id=? AND user_id=? AND item_type=? LIMIT 1',
        [entryId, sessionUser.id, 'lunch']);
      if (!hasLunch && !dismissed.has(`${entryId}:-1:missing_lunch`)) count++;
    }
  });
  return count;
}

function lockSession(skipAuditCheck = false) {
  if (!skipAuditCheck && sessionUser) {
    const count = countAuditDiscrepancies();
    if (count > 0) {
      mainWindow.webContents.send('audit:close-warning', { count, action: 'lock' });
      return;
    }
  }
  clearIdleTimer();
  sessionKey = null; sessionUser = null; activeEntryId = null;
  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/login.html'));
}

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function resetIdleTimer() {
  clearIdleTimer();
  const row = dbGet('SELECT value FROM app_settings WHERE key=?', ['ui_autoLockMinutes']);
  const minutes = parseInt(row?.value || '0', 10);
  if (!minutes || !sessionUser) return;
  idleTimer = setTimeout(() => {
    mainWindow.webContents.send('toast', { msg: 'Session locked due to inactivity.', type: 'info' });
    setTimeout(() => lockSession(true), 1200); // let toast render briefly before navigating
  }, minutes * 60 * 1000);
}

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
    const tmpDb = new SQL.Database(fs.readFileSync(path.join(profileDir, 'vault.db')));
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
  if (db) { db.close(); db = null; }
  ACTIVE_PROFILE_DIR = null; DB_FILE = null; BACKUP_DIR = null;
  sessionKey = null; sessionUser = null;
  return { ok: true };
});

// Delete the currently-loaded profile after verifying the user's password.
// Called from the pre-auth settings modal — the profile must already be loaded
// via profiles:load (vault is open, but no session key yet).
// Returns { ok, error } — on success the profile directory is removed from disk
// and the caller should navigate back to login (profile selector).
ipcMain.handle('profiles:delete', async (_, { password }) => {
  if (!db) return { ok: false, error: 'No profile loaded.' };
  try {
    const bcrypt = require('bcryptjs');
    const user   = dbGet('SELECT rowid as rid, password_hash FROM users LIMIT 1');
    if (!user) return { ok: false, error: 'Profile has no account — cannot verify.' };
    if (!bcrypt.compareSync(password, user.password_hash))
      return { ok: false, error: 'Incorrect password.' };

    const profileDir = ACTIVE_PROFILE_DIR;

    // Close DB and clear all session state before deleting files
    db.close(); db = null;
    ACTIVE_PROFILE_DIR = null; DB_FILE = null; BACKUP_DIR = null;
    sessionKey = null; sessionUser = null; activeEntryId = null;

    if (profileDir && fs.existsSync(profileDir))
      fs.rmSync(profileDir, { recursive: true, force: true });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: safeStorage fast-path (Windows Hello bridge) ─────────────────────
// safe_key.json lives in the profile directory alongside vault.db.
// It stores the vault sessionKey encrypted with Electron safeStorage (DPAPI
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
  if (!db) return { ok: false, error: 'No profile loaded.' };
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
  if (!db) return { ok: false, error: 'No profile loaded.' };
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

    sessionKey  = key;
    sessionUser = { id: Number(user.rid), username: user.username, display_name: user.display_name || null, work_state: null };
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const pd = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, key));
        sessionUser.work_state = pd?.work_state || null;
      } catch {}
    }
    db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    migrateTimeEntries();
    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: 'Secure sign-in failed — use password login.' }; }
});

ipcMain.handle('auth:quick-unlock', async (_, { password }) => {
  if (!db) return { ok: false, error: 'No profile loaded.' };
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
    sessionKey  = key;
    sessionUser = { id: Number(user.rid), username: user.username, display_name: user.display_name || null, work_state: null };
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const pd = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, key));
        sessionUser.work_state = pd?.work_state || null;
      } catch {}
    }
    db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    migrateTimeEntries();
    return { ok: true, needsEmail: profileEmailMissing() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:safe-disable', async (_, { password }) => {
  if (!db) return { ok: false, error: 'No profile loaded.' };
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
  if (!db) return { needsSetup: true };
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

    // Dev mode: skip TOTP verification entirely
    const totpOk = user.dev_mode
      ? true
      : speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });

    if (!totpOk) {
      const r = incrementFailed(user);
      return { ok: false, error: 'Invalid TOTP code.', ...r };
    }

    // Derive key from password + stored stable salt (never the rotating TOTP code)
    const salt  = user.key_salt || user.totp_secret;
    sessionKey  = deriveKey(password, salt);
    // Always use rowid — sql.js AUTOINCREMENT id columns return null through our query helper
    sessionUser = { id: Number(user.rid), username: user.username, display_name: user.display_name || null, work_state: null };
    db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();

    // Decrypt profile blob once to backfill avatar_thumb and extract work_state
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const profileData = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, sessionKey));
        sessionUser.work_state = profileData?.work_state || null;
        if (ACTIVE_PROFILE_DIR && !IS_DEV) {
          const manifest = readManifest(ACTIVE_PROFILE_DIR);
          if (manifest && !manifest.avatar_thumb_48 && profileData?.avatar) {
            writeManifest(ACTIVE_PROFILE_DIR, { ...manifest, avatar_thumb_48: profileData.avatar });
          }
        }
      } catch (e) { console.warn('[login] profile decrypt failed:', e.message); }
    }

    migrateTimeEntries();

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
    db.run('UPDATE users SET failed_attempts=?, locked_until=? WHERE rowid=?', [attempts, lockUntil, uid]);
    persistDB();
    return { locked: true, attemptsLeft: 0 };
  }
  db.run('UPDATE users SET failed_attempts=? WHERE rowid=?', [attempts, uid]);
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
    db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
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

    // Re-encrypt all company rows
    const companies = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [Number(user.rid)]);
    for (const co of companies) {
      try {
        const plain = decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, oldKey);
        const reenc = encrypt(plain, newKey);
        db.run('UPDATE companies SET data_enc=?, data_iv=?, data_tag=? WHERE rowid=?',
          [reenc.data, reenc.iv, reenc.tag, Number(co.rid)]);
      } catch(e) { return { ok: false, error: 'Re-encryption failed: ' + e.message }; }
    }

    // Re-encrypt profile blob if present
    if (user.profile_enc && user.profile_iv && user.profile_tag) {
      try {
        const plain = decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, oldKey);
        const reenc = encrypt(plain, newKey);
        db.run('UPDATE users SET profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?',
          [reenc.data, reenc.iv, reenc.tag, Number(user.rid)]);
      } catch {}
    }

    // Re-encrypt SMTP password if present
    const smtpEnc = dbGet("SELECT value FROM app_settings WHERE key='email_smtp_password_enc'");
    const smtpIv  = dbGet("SELECT value FROM app_settings WHERE key='email_smtp_password_iv'");
    const smtpTag = dbGet("SELECT value FROM app_settings WHERE key='email_smtp_password_tag'");
    if (smtpEnc?.value && smtpIv?.value && smtpTag?.value) {
      try {
        const plain = decrypt({ data: smtpEnc.value, iv: smtpIv.value, tag: smtpTag.value }, oldKey);
        const reenc = encrypt(plain, newKey);
        const setSetting = (k, v) => db.run('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [k, v]);
        setSetting('email_smtp_password_enc', reenc.data);
        setSetting('email_smtp_password_iv',  reenc.iv);
        setSetting('email_smtp_password_tag', reenc.tag);
      } catch {}
    }

    // Re-encrypt time entries
    const entries = dbAll('SELECT rowid as rid, rows_enc, rows_iv, rows_tag FROM time_entries WHERE user_id=? AND rows_enc IS NOT NULL', [Number(user.rid)]);
    for (const e of entries) {
      try {
        const plain = decrypt({ data: e.rows_enc, iv: e.rows_iv, tag: e.rows_tag }, oldKey);
        const reenc = encrypt(plain, newKey);
        db.run('UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=? WHERE rowid=?',
          [reenc.data, reenc.iv, reenc.tag, e.rid]);
      } catch(e) { return { ok: false, error: 'Re-encryption failed: ' + e.message }; }
    }

    // Update password hash and clear lockout
    db.run('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL WHERE rowid=?',
      [bcrypt.hashSync(newPassword, 12), Number(user.rid)]);
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

ipcMain.handle('session:get', () => sessionUser ? { id: sessionUser.id, username: sessionUser.username, display_name: sessionUser.display_name || null, work_state: sessionUser.work_state || null } : null);
ipcMain.handle('session:heartbeat', () => { if (sessionUser) resetIdleTimer(); return null; });
ipcMain.on('session:request-lock',   () => lockSession(false));
ipcMain.on('session:confirm-close',  () => { forceClose = true; mainWindow.close(); });
ipcMain.on('session:confirm-lock',   () => lockSession(true));

// ── IPC: Companies ─────────────────────────────────────────────────────────
ipcMain.handle('companies:list', () => {
  if (!sessionKey || !sessionUser) return [];
  const rows = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=? ORDER BY rowid ASC', [sessionUser.id]);
  return rows.map(r => {
    const id = (r.id != null && r.id !== 0) ? Number(r.id) : Number(r.rid);
    try {
      const plain = decrypt({ iv: r.data_iv, tag: r.data_tag, data: r.data_enc }, sessionKey);
      const parsed = JSON.parse(plain);
      // Ensure id is never null/NaN — always a real positive integer
      const finalId = (id && !isNaN(id)) ? id : Number(r.rid);
      return { ...parsed, id: finalId };
    } catch { return { id: Number(r.rid), name: '[Decryption Error]' }; }
  });
});

ipcMain.handle('companies:save', (_, data) => {
  if (!sessionKey || !sessionUser) return { ok: false, error: 'Not authenticated' };
  try {
    const { iv, tag, data: enc } = encrypt(JSON.stringify(data), sessionKey);
    if (data.id) {
      db.run('UPDATE companies SET data_enc=?,data_iv=?,data_tag=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [enc, iv, tag, data.id, sessionUser.id]);
    } else {
      db.run('INSERT INTO companies (user_id,data_enc,data_iv,data_tag) VALUES (?,?,?,?)',
        [sessionUser.id, enc, iv, tag]);
    }
    persistDB(); performBackup();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('companies:delete', (_, id) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  const numId = Number(id);
  db.run('DELETE FROM time_entries WHERE company_id=? AND user_id=?', [numId, sessionUser.id]);
  db.run('DELETE FROM companies WHERE rowid=? AND user_id=?', [numId, sessionUser.id]);
  persistDB(); performBackup();
  return { ok: true };
});

// ── IPC: Time entries ──────────────────────────────────────────────────────
ipcMain.handle('entries:list', (_, companyId) => {
  if (!sessionKey || !sessionUser) return [];
  return dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND company_id=? ORDER BY log_date DESC',
    [sessionUser.id, companyId]).map(r => ({...decryptEntry(r), id: Number(r.rid)}));
});

ipcMain.handle('entries:save', (_, entry) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  try {
    const enc = encrypt(entry.rows_json || '[]', sessionKey);
    if (entry.id) {
      db.run(
        'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,session_label=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [enc.data, enc.iv, enc.tag, '', entry.total_mins, entry.session_label || '', entry.id, sessionUser.id]
      );
      activeEntryId = Number(entry.id);
      persistDB(); performBackup();
      return { ok: true, id: entry.id };
    } else {
      db.run(
        'INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,rows_enc,rows_iv,rows_tag,total_mins) VALUES (?,?,?,?,?,?,?,?,?)',
        [sessionUser.id, entry.company_id, entry.log_date, entry.session_label || '', '', enc.data, enc.iv, enc.tag, entry.total_mins]
      );
      const result = db.exec('SELECT MAX(rowid) as rid FROM time_entries WHERE user_id=?', [sessionUser.id]);
      const newId = (result && result[0] && result[0].values[0]) ? Number(result[0].values[0][0]) : null;
      activeEntryId = newId;
      persistDB(); performBackup();
      return { ok: true, id: newId };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('entries:all', () => {
  if (!sessionKey || !sessionUser) return [];
  return dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [sessionUser.id])
    .map(r => ({...decryptEntry(r), id: Number(r.rid)}));
});

ipcMain.handle('entries:get-active', () => {
  if (!sessionKey || !sessionUser) return null;

  let row = null;

  // Fast path: use in-memory activeEntryId if set
  if (activeEntryId) {
    row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
      [activeEntryId, sessionUser.id]);
  }

  // Fallback: find today's entry that has a clocked-in but not clocked-out row
  if (!row) {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = dbAll(
      'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date=? ORDER BY updated_at DESC',
      [sessionUser.id, today]
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
        [sessionUser.id, yesterday]
      );
      for (const c of prev) {
        try {
          decryptEntry(c);
          const rows = JSON.parse(c.rows_json || '[]');
          if (rows.some(r => r.clock_in && !r.clock_out)) { row = c; break; }
        } catch {}
      }
    }
    if (row) activeEntryId = Number(row.rid);
  }

  if (!row) return null;

  decryptEntry(row);

  let company_name = null;
  try {
    const co = dbGet('SELECT rowid as rid, * FROM companies WHERE rowid=? AND user_id=?',
      [Number(row.company_id), sessionUser.id]);
    if (co) {
      const plain = decrypt({ iv: co.data_iv, tag: co.data_tag, data: co.data_enc }, sessionKey);
      company_name = JSON.parse(plain).name || null;
    }
  } catch {}
  return { ...row, id: Number(row.rid), company_name };
});

ipcMain.handle('entries:get', (_, id) => {
  if (!sessionKey || !sessionUser) return null;
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(id), sessionUser.id]);
  if (!row) return null;
  return { ...decryptEntry(row), id: Number(row.rid) };
});

// ── IPC: Task items ────────────────────────────────────────────────────────
ipcMain.handle('tasks:list', (_, entryId) => {
  if (!sessionKey || !sessionUser) return [];
  return dbAll(
    'SELECT rowid as rid, * FROM task_items WHERE entry_id=? AND user_id=? ORDER BY started_at ASC',
    [Number(entryId), sessionUser.id]
  ).map(r => ({ ...r, id: Number(r.rid) }));
});

ipcMain.handle('tasks:save', (_, item) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  try {
    if (item.id) {
      db.run(
        'UPDATE task_items SET label=?,item_type=?,stopped_at=?,duration_secs=? WHERE rowid=? AND user_id=?',
        [item.label, item.item_type || 'task', item.stopped_at ?? null,
         item.duration_secs || 0, Number(item.id), sessionUser.id]
      );
      persistDB();
      return { ok: true, id: Number(item.id) };
    } else {
      db.run(
        'INSERT INTO task_items (user_id,entry_id,label,item_type,started_at,stopped_at,duration_secs) VALUES (?,?,?,?,?,?,?)',
        [sessionUser.id, Number(item.entry_id), item.label,
         item.item_type || 'task', item.started_at, item.stopped_at ?? null, item.duration_secs || 0]
      );
      const result = db.exec('SELECT MAX(rowid) as rid FROM task_items WHERE user_id=?', [sessionUser.id]);
      const newId = (result && result[0] && result[0].values[0]) ? Number(result[0].values[0][0]) : null;
      persistDB();
      return { ok: true, id: newId };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('tasks:delete', (_, id) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  db.run('DELETE FROM task_items WHERE rowid=? AND user_id=?', [Number(id), sessionUser.id]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('tasks:recent-labels', () => {
  if (!sessionKey || !sessionUser) return [];
  const rows = dbAll(
    `SELECT label FROM task_items
     WHERE user_id=? AND item_type='task'
     GROUP BY label
     ORDER BY MAX(started_at) DESC LIMIT 10`,
    [sessionUser.id]
  );
  return rows.map(r => r.label);
});

ipcMain.handle('tasks:summary', () => {
  if (!sessionKey || !sessionUser) return {};
  const rows = dbAll(
    `SELECT entry_id, item_type, COUNT(*) as cnt
     FROM task_items WHERE user_id=? AND item_type IN ('break','lunch')
     GROUP BY entry_id, item_type`,
    [sessionUser.id]
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
  if (!sessionUser) return [];
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('vault-') && f.endsWith('.db'))
    .sort().reverse();
  return files.map(f => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    const ts = f.replace('vault-', '').replace('.db', '').replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
    return { filename: f, timestamp: ts, sizeKB: Math.round(stat.size / 1024) };
  });
});

ipcMain.handle('backup:preview', (_, filename) => {
  if (!sessionUser) return { error: 'No session' };
  if (!/^vault-[\d\-T]+\.db$/.test(filename)) return { error: 'Invalid filename' };
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return { error: 'File not found' };
  try {
    const buf     = fs.readFileSync(filepath);
    const preview = new SQL.Database(buf);
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
  if (!sessionUser) return { ok: false, error: 'No session' };
  if (!/^vault-[\d\-T]+\.db$/.test(filename)) return { ok: false, error: 'Invalid filename' };
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return { ok: false, error: 'File not found' };
  try {
    performBackup(); // safety-save current state before overwriting
    fs.copyFileSync(filepath, DB_FILE);
    // Reload the DB in memory
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
    // Clear session
    clearIdleTimer();
    sessionKey = null; sessionUser = null; activeEntryId = null;
    mainWindow.loadFile(path.join(__dirname, '../renderer/pages/login.html'));
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
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.pre-restore.bak');
    fs.copyFileSync(src, DB_FILE);
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
    clearIdleTimer(); sessionKey = null; sessionUser = null; activeEntryId = null;
    mainWindow.loadFile(path.join(__dirname, '../renderer/pages/login.html'));
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── IPC: Audit policy ────────────────────────────────────────────────────
ipcMain.handle('audit:get-policy', () => {
  const stateCode = sessionUser?.work_state || null;
  const policy    = getPolicy(stateCode);
  const stateName = stateCode ? (STATE_NAMES[stateCode] || stateCode) : null;
  // Replace Infinity with null so serialization is safe across IPC boundary
  const safeThresholds = policy.breakThresholds.map(([t, c]) => [isFinite(t) ? t : null, c]);
  return {
    stateCode, stateName, policyLabel: policy.label,
    breakThresholds: safeThresholds,
    lunchThreshMins: policy.lunchThreshMins,
    dispatchBreakWarnMins: isFinite(policy.dispatchBreakWarnMins) ? policy.dispatchBreakWarnMins : null,
    dispatchLunchWarnMins: isFinite(policy.dispatchLunchWarnMins) ? policy.dispatchLunchWarnMins : null,
  };
});

// ── IPC: Audit dismissed ──────────────────────────────────────────────────
ipcMain.handle('audit:get-dismissed', () => {
  if (!sessionUser) return [];
  return dbAll('SELECT entry_id, row_idx, type FROM audit_dismissed WHERE user_id=?', [sessionUser.id]);
});

ipcMain.handle('audit:dismiss', (_, { entry_id, row_idx, type }) => {
  if (!sessionUser) return { ok: false };
  db.run(
    'INSERT OR IGNORE INTO audit_dismissed (user_id, entry_id, row_idx, type) VALUES (?,?,?,?)',
    [sessionUser.id, Number(entry_id), Number(row_idx), type]
  );
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:clear-dismissed', () => {
  if (!sessionUser) return { ok: false };
  db.run('DELETE FROM audit_dismissed WHERE user_id=?', [sessionUser.id]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:apply-fix', (_, { entry_id, row_idx, fix_type }) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  // Only these discrepancy types have an automated fix. Everything else
  // (e.g. missing_break / missing_lunch) is acknowledge-only by design — reject
  // explicitly so the dismiss-only guarantee can't be bypassed by a forged call.
  const ALLOWED_FIXES = ['set_clock_out', 'recalc_duration'];
  if (!ALLOWED_FIXES.includes(fix_type)) {
    return { ok: false, error: `No automated fix for "${fix_type}" — this discrepancy is acknowledge-only.` };
  }
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(entry_id), sessionUser.id]);
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
    const enc      = encrypt(newJson, sessionKey);
    db.run(
      'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
      [enc.data, enc.iv, enc.tag, '', newTotal, Number(entry_id), sessionUser.id]
    );
    persistDB(); performBackup();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Returns true when the logged-in user has no email saved in their profile blob.
function profileEmailMissing() {
  if (!sessionKey || !sessionUser) return false;
  try {
    const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [sessionUser.id]);
    if (!user || !user.profile_enc) return true;
    const data = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, sessionKey));
    return !data?.email?.trim();
  } catch { return true; }
}

// ── IPC: User Profile ─────────────────────────────────────────────────────
ipcMain.handle('profile:get', () => {
  if (!sessionKey || !sessionUser) return null;
  const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [sessionUser.id]);
  if (!user) return null;
  let profileData = { full_name: '', email: '', phone: '', job_title: '', avatar: null };
  if (user.profile_enc && user.profile_iv && user.profile_tag) {
    try {
      profileData = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, sessionKey));
    } catch {}
  }
  return { display_name: user.display_name || '', ...profileData };
});

ipcMain.handle('profile:save', (_, { display_name, full_name, email, phone, job_title, work_state, avatar, avatar_thumb_48 }) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  try {
    const blob = encrypt(JSON.stringify({ full_name: full_name || '', email: email || '', phone: phone || '', job_title: job_title || '', work_state: work_state || null, avatar: avatar || null }), sessionKey);
    db.run('UPDATE users SET display_name=?, profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?',
      [display_name || null, blob.data, blob.iv, blob.tag, sessionUser.id]);
    sessionUser.display_name = display_name || null;
    sessionUser.work_state   = work_state   || null;
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
  if (!sessionKey || !sessionUser) return { ok: false, error: 'No active session.' };
  const bcrypt    = require('bcryptjs');
  const speakeasy = require('speakeasy');
  const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [sessionUser.id]);
  if (!user) return { ok: false, error: 'User not found.' };
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return { ok: false, error: 'Current password is incorrect.' };
  const totpOk = user.dev_mode ? true :
    speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totpCode, window: 1 });
  if (!totpOk) return { ok: false, error: 'Invalid TOTP code.' };

  const newKey = deriveKey(newPassword, user.key_salt);

  // Re-encrypt all company rows with the new key
  const companies = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [sessionUser.id]);
  for (const co of companies) {
    try {
      const plain = decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, sessionKey);
      const reenc = encrypt(plain, newKey);
      db.run('UPDATE companies SET data_enc=?, data_iv=?, data_tag=? WHERE rowid=?',
        [reenc.data, reenc.iv, reenc.tag, Number(co.rid)]);
    } catch(e) { return { ok: false, error: 'Re-encryption failed: ' + e.message }; }
  }

  // Re-encrypt profile blob if present
  if (user.profile_enc && user.profile_iv && user.profile_tag) {
    try {
      const plain = decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, sessionKey);
      const reenc = encrypt(plain, newKey);
      db.run('UPDATE users SET profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?',
        [reenc.data, reenc.iv, reenc.tag, sessionUser.id]);
    } catch {}
  }

  // Re-encrypt SMTP password if present
  const smtpEnc = dbGet("SELECT value FROM app_settings WHERE key='email_smtp_password_enc'");
  const smtpIv  = dbGet("SELECT value FROM app_settings WHERE key='email_smtp_password_iv'");
  const smtpTag = dbGet("SELECT value FROM app_settings WHERE key='email_smtp_password_tag'");
  if (smtpEnc?.value && smtpIv?.value && smtpTag?.value) {
    try {
      const plain = decrypt({ data: smtpEnc.value, iv: smtpIv.value, tag: smtpTag.value }, sessionKey);
      const reenc = encrypt(plain, newKey);
      const setSetting = (k, v) => db.run('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [k, v]);
      setSetting('email_smtp_password_enc', reenc.data);
      setSetting('email_smtp_password_iv',  reenc.iv);
      setSetting('email_smtp_password_tag', reenc.tag);
    } catch {}
  }

  // Re-encrypt time entries
  const entries = dbAll('SELECT rowid as rid, rows_enc, rows_iv, rows_tag FROM time_entries WHERE user_id=? AND rows_enc IS NOT NULL', [sessionUser.id]);
  for (const e of entries) {
    try {
      const plain = decrypt({ data: e.rows_enc, iv: e.rows_iv, tag: e.rows_tag }, sessionKey);
      const reenc = encrypt(plain, newKey);
      db.run('UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=? WHERE rowid=?',
        [reenc.data, reenc.iv, reenc.tag, e.rid]);
    } catch(e) { return { ok: false, error: 'Re-encryption failed: ' + e.message }; }
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.run('UPDATE users SET password_hash=? WHERE rowid=?', [newHash, sessionUser.id]);
  sessionKey = newKey;
  persistDB(); performBackup();
  return { ok: true };
});

ipcMain.handle('audit:open-wizard', (_, { mode, theme } = {}) => {
  createAuditWizardWindow(mode, theme);
  return { ok: true };
});

// ── IPC: Database clear operations ────────────────────────────────────────
// Architecture note: each profile has its own vault.db file, so `db` is
// always scoped to the active user's vault. All DELETEs still use
// WHERE user_id=? explicitly so the intent is unambiguous and the code
// stays safe if vault sharing is ever introduced.

ipcMain.handle('db:clear-timeclock', () => {
  if (!sessionKey || !sessionUser) return { ok: false };
  const uid = sessionUser.id;
  db.run('DELETE FROM task_items   WHERE user_id=?', [uid]);
  db.run('DELETE FROM time_entries WHERE user_id=?', [uid]);
  activeEntryId = null;
  persistDB(); performBackup();
  return { ok: true };
});

ipcMain.handle('db:clear-companies', () => {
  if (!sessionKey || !sessionUser) return { ok: false };
  const uid = sessionUser.id;
  db.run('DELETE FROM task_items   WHERE user_id=?', [uid]);
  db.run('DELETE FROM time_entries WHERE user_id=?', [uid]);
  db.run('DELETE FROM companies    WHERE user_id=?', [uid]);
  activeEntryId = null;
  persistDB(); performBackup();
  return { ok: true };
});

// Full clear removes the entire profile from disk so the profile selector
// does not show a ghost card after logout. The profile directory
// (vault.db + profile-manifest.json + backups/) is deleted, then the
// renderer is expected to navigate to login, which will show the selector
// with only surviving profiles.
ipcMain.handle('db:clear-full', () => {
  if (!sessionKey || !sessionUser) return { ok: false };
  const uid        = sessionUser.id;
  const profileDir = ACTIVE_PROFILE_DIR; // capture before clearing session state

  // Wipe in-memory DB rows first so persistDB() writes a clean file
  // (belt-and-suspenders: the whole directory is deleted right after)
  db.run('DELETE FROM task_items      WHERE user_id=?', [uid]);
  db.run('DELETE FROM time_entries    WHERE user_id=?', [uid]);
  db.run('DELETE FROM companies       WHERE user_id=?', [uid]);
  db.run('DELETE FROM audit_dismissed WHERE user_id=?', [uid]);
  db.run('DELETE FROM app_settings');   // vault-level; no user_id column
  db.run('DELETE FROM users           WHERE rowid=?',   [uid]); // sessionUser.id is the rowid (see line 606)

  activeEntryId      = null;
  sessionKey         = null;
  sessionUser        = null;
  ACTIVE_PROFILE_DIR = null;
  DB_FILE            = null;
  BACKUP_DIR         = null;

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
  if (!db) return null;
  const row = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
  return row ? row.value : null;
});
ipcMain.handle('settings:set', (_, { key, value }) => {
  if (!db) return { ok: false };
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
    if (items.length) Menu.buildFromTemplate(items).popup({ window: wc.getOwnerBrowserWindow() });
  });
});

app.whenReady().then(async () => {
  // Schedule email check fires every 5 minutes (catches sub-hour scheduling windows)
  setInterval(() => runScheduledEmailCheck().then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', 'Scheduled report sent!', 'success');
  }).catch(e => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', `Scheduled report failed: ${e.message}`, 'error', 8000);
  }), 5 * 60 * 1000);

  // Load the sql.js WASM module once (needed for migration peek reads too)
  SQL = await require('sql.js')();

  // Prod only: migrate old flat vault.db → profiles/<username>/vault.db
  if (!IS_DEV) migrateFromLegacyVault();

  // Dev: auto-load the dev profile so the rest of the flow is identical
  if (IS_DEV) await initProfileDB(ROOT_DATA_DIR);

  // Splash always uses zanarkand — it's a brand moment, not a user preference moment.
  const splash = createSplashWindow('zanarkand');
  createWindow(); // creates hidden (show: false)

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
    if (!db) return;
    if (dbGet("SELECT value FROM app_settings WHERE key='win_rememberPosition'")?.value !== 'true') return;
    const b = mainWindow.getBounds();
    db.run("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('win_lastBounds',?)", [JSON.stringify(b)]);
    persistDB();
  }
  mainWindow.on('moved',   saveWindowBounds);
  mainWindow.on('resized', saveWindowBounds);

  setTimeout(() => {
    if (!splash.isDestroyed()) splash.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      // Always maximize when preferred display is set, or when startMax is on
      if (prefDisplay !== 'primary' || startMax) mainWindow.maximize();
    }
  }, 3000);
});

// ── Email helpers ─────────────────────────────────────────────────────────

// Render an HTML string to a PDF buffer using a hidden BrowserWindow.
function generatePDF(htmlContent) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(app.getPath('temp'), `ct-report-${Date.now()}.html`);
    fs.writeFileSync(tmp, htmlContent, 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    // Use loadFile() — avoids Windows backslash issues with file:// URLs
    win.loadFile(tmp);
    const cleanup = () => { try { fs.unlinkSync(tmp); } catch {} };
    win.webContents.once('did-finish-load', () => {
      win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' })
        .then(buf => { win.close(); cleanup(); resolve(buf); })
        .catch(e  => { win.close(); cleanup(); reject(e); });
    });
    win.webContents.once('did-fail-load', (_, code, desc) => {
      win.close(); cleanup(); reject(new Error(`PDF window failed to load: ${desc} (${code})`));
    });
  });
}

function getEmailSmtpConfig() {
  const get = k => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
  const host     = get('email_smtp_host');
  const port     = parseInt(get('email_smtp_port') || '587', 10);
  const username = get('email_smtp_username');
  const fromName = get('email_smtp_from_name');
  const defaultTo = get('email_smtp_default_to');
  const enc  = get('email_smtp_password_enc');
  const iv   = get('email_smtp_password_iv');
  const tag  = get('email_smtp_password_tag');
  let password = '';
  if (enc && iv && tag && sessionKey) {
    try { password = decrypt({ data: enc, iv, tag }, sessionKey); } catch {}
  }
  return { host, port, username, password, fromName, defaultTo };
}

ipcMain.handle('email:save-config', (_, { host, port, username, password, fromName, defaultTo }) => {
  if (!sessionKey) return { ok: false, error: 'Not logged in.' };
  try {
    const set = (k, v) => db.run('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [k, String(v || '')]);
    set('email_smtp_host', host);
    set('email_smtp_port', port || 587);
    set('email_smtp_username', username);
    set('email_smtp_from_name', fromName);
    set('email_smtp_default_to', defaultTo);
    if (password) {
      const enc = encrypt(password, sessionKey);
      set('email_smtp_password_enc', enc.data);
      set('email_smtp_password_iv',  enc.iv);
      set('email_smtp_password_tag', enc.tag);
    }
    persistDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:get-config', () => {
  if (!db) return {};
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
  if (!sessionKey) return { ok: false, error: 'Not logged in.' };
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

async function doSendReport({ htmlContent, subject, recipients, entriesOverride }) {
  const cfg = getEmailSmtpConfig();
  if (!cfg.host || !cfg.username || !cfg.password) throw new Error('Email not configured. Open Settings → Data to add SMTP credentials.');

  const toList = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : (recipients || cfg.defaultTo || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!toList.length) throw new Error('No recipients specified.');

  const entries = entriesOverride || dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [sessionUser.id])
    .map(r => ({ ...r, id: Number(r.rid) }));
  const companies = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [sessionUser.id])
    .reduce((m, co) => {
      try { const d = JSON.parse(decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, sessionKey)); m[Number(co.rid)] = d.name || ''; } catch {} return m;
    }, {});

  const csvHeader = ['Date','Company','Session','Task Label','Task Name','Description','Clock In','Clock Out','Minutes'];
  const csvRows = [];
  entries.forEach(e => {
    try {
      JSON.parse(e.rows_json || '[]').forEach(r => {
        if (!r.label && !r.name && !r.clock_in) return;
        csvRows.push([e.log_date, companies[Number(e.company_id)] || '', e.session_label || '', r.label || '', r.name || '', r.desc || r.description || '', r.clock_in || '', r.clock_out || '', r.total_mins || 0]);
      });
    } catch {}
  });
  const csv = [csvHeader, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

  const pdfBuf = await generatePDF(htmlContent);
  const dateTag = new Date().toISOString().slice(0, 10);
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.username, pass: cfg.password },
  });
  const fromAddr = cfg.fromName ? `"${cfg.fromName}" <${cfg.username}>` : cfg.username;
  await transport.sendMail({
    from: fromAddr, to: toList.join(', '),
    subject: subject || `Conquered Time Report — ${dateTag}`,
    html: `<p>Please find your Conquered Time report attached.</p><p style="color:#6b7280;font-size:12px">Generated ${new Date().toLocaleString()} · CONFIDENTIAL</p>`,
    attachments: [
      { filename: `conquered-time-report-${dateTag}.pdf`, content: pdfBuf, contentType: 'application/pdf' },
      { filename: `conquered-time-report-${dateTag}.csv`, content: csv,    contentType: 'text/csv' },
    ],
  });
}

ipcMain.handle('email:send-report', async (_, { htmlContent, subject, recipients }) => {
  if (!sessionKey || !sessionUser) return { ok: false, error: 'Not logged in.' };
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
  if (!sessionKey || !sessionUser) return { ok: false, error: 'Not logged in.' };
  try {
    const result = await runScheduledEmailCheck(true);
    if (result === false) return { ok: false, error: 'Schedule is set to Off — enable a frequency first.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:get-schedule-status', () => {
  if (!db) return {};
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

function computeNextSendDate(freq, lastSent) {
  const now  = new Date();
  const last = lastSent ? new Date(lastSent) : null;
  if (freq === 'daily')     return last ? new Date(last.getTime() + 86400000) : now;
  if (freq === 'weekly')    return last ? new Date(last.getTime() + 7 * 86400000) : now;
  if (freq === 'monthly') {
    const d = last ? new Date(last) : new Date(now);
    d.setMonth(d.getMonth() + 1); d.setDate(1); return d;
  }
  if (freq === 'quarterly') {
    const d = last ? new Date(last) : new Date(now);
    d.setMonth(d.getMonth() + 3); d.setDate(1); return d;
  }
  if (freq === 'annually') {
    const d = last ? new Date(last) : new Date(now);
    d.setFullYear(d.getFullYear() + 1); d.setMonth(0); d.setDate(1); return d;
  }
  return null;
}

async function runScheduledEmailCheck(force = false) {
  if (!db || !sessionKey || !sessionUser) return;
  try {
    const get = k => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
    const freq = get('email_schedule_freq');
    if (!freq || freq === 'off') return false;

    const lastSent  = get('email_schedule_last_sent') || null;
    const sendTime  = get('email_schedule_time') || '08:00';
    const nextSend  = computeNextSendDate(freq, lastSent);
    if (!nextSend) return;

    const [sh, sm] = sendTime.split(':').map(Number);
    nextSend.setHours(sh, sm, 0, 0);
    if (!force && new Date() < nextSend) return;

    // Time to send — build report covering since lastSent
    const fromDate = lastSent ? lastSent.slice(0, 10) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate   = new Date().toISOString().slice(0, 10);

    const entries = dbAll(
      'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date>=? AND log_date<=? ORDER BY log_date',
      [sessionUser.id, fromDate, toDate]
    ).map(r => ({ ...r, id: Number(r.rid) }));

    const companyRows = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [sessionUser.id]);
    const companies = {};
    companyRows.forEach(co => {
      try { companies[Number(co.rid)] = JSON.parse(decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, sessionKey)).name || ''; } catch {}
    });

    const totalMins = entries.reduce((s, e) => s + (e.total_mins || 0), 0);
    const fmtM = m => { const h = Math.floor(m/60), mn = m%60; return `${h}h ${mn}m`; };

    const byLabel = {};
    entries.forEach(e => { try { JSON.parse(e.rows_json||'[]').forEach(r => { if (r.total_mins > 0) { const l = r.label||'Other'; byLabel[l]=(byLabel[l]||0)+r.total_mins; } }); } catch {} });
    const labelRows = Object.entries(byLabel).sort((a,b)=>b[1]-a[1])
      .map(([l,m]) => `<tr><td>${l}</td><td style="text-align:right">${fmtM(m)}</td></tr>`).join('');

    const htmlContent = `<!DOCTYPE html><html><head><title>Scheduled Report</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:40px;max-width:900px;margin:0 auto;}
h1{font-size:20px;font-weight:600;margin:0 0 4px;}h2{font-size:13px;font-weight:600;color:#374151;margin:20px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;}
.meta{color:#666;font-size:11px;margin-bottom:20px;}table{width:100%;border-collapse:collapse;}
th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:8px;text-align:left;font-size:11px;font-weight:600;}
td{padding:7px 8px;border-bottom:1px solid #e5e7eb;}
.footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;}
</style></head><body>
<h1>Conquered Time — Scheduled Report</h1>
<div class="meta">Period: ${fromDate} → ${toDate} · Total: ${fmtM(totalMins)}</div>
<h2>Task Label Breakdown</h2>
<table><thead><tr><th>Label</th><th style="text-align:right">Duration</th></tr></thead>
<tbody>${labelRows}</tbody></table>
<div class="footer">Generated by Conquered Time · ${new Date().toLocaleString()} · CONFIDENTIAL</div>
</body></html>`;

    const cfg = getEmailSmtpConfig();
    if (!cfg.host || !cfg.password) throw new Error('SMTP not configured.');
    const toList = (cfg.defaultTo || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!toList.length) throw new Error('No default recipient set. Add one in Settings → Data → Email Reports.');

    await doSendReport({
      htmlContent,
      subject: `Conquered Time Scheduled Report — ${toDate}`,
      recipients: toList,
      entriesOverride: entries,
    });

    db.run("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('email_schedule_last_sent',?)", [new Date().toISOString()]);
    db.run("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('email_schedule_last_error','')", []);
    persistDB();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', 'Scheduled report sent successfully!', 'success');
  } catch (e) {
    console.error('[schedule-email]', e.message);
    if (db) { try { db.run("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('email_schedule_last_error',?)", [e.message]); persistDB(); } catch {} }
    throw e; // re-throw so IPC handler / interval caller can surface the error
  }
}

app.on('window-all-closed', () => {
  persistDB(); performBackup(); app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
