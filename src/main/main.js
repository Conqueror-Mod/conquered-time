'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, screen } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ── Single instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── Data paths ─────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(app.getPath('userData'), 'conquered-data');
const DB_FILE    = path.join(DATA_DIR, 'vault.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

[DATA_DIR, BACKUP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── In-memory session state ────────────────────────────────────────────────
let sessionKey  = null;
let sessionUser = null;
let mainWindow  = null;
let SQL         = null;   // sql.js module
let db          = null;   // sql.js Database instance
let idleTimer    = null;   // auto-lock timeout handle
let forceClose   = false;  // set true after user confirms close through audit prompt
let activeEntryId = null;  // rowid of the currently live time_entries row

// ── sql.js init ────────────────────────────────────────────────────────────
async function initDB() {
  SQL = await require('sql.js')();

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

  // Profile column migrations — safe to run on every startup
  try { db.run('ALTER TABLE users ADD COLUMN display_name TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN profile_enc  TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN profile_iv   TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN profile_tag  TEXT'); } catch {}

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
    query: { theme: theme || 'arctic' }
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
  const entries = dbAll('SELECT rowid as rid, rows_json, total_mins FROM time_entries WHERE user_id=?', [sessionUser.id]);
  let count = 0;
  entries.forEach(e => {
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
    if (totalMins > 240) {
      const hasBreak = dbGet('SELECT id FROM task_items WHERE entry_id=? AND user_id=? AND item_type=? LIMIT 1',
        [entryId, sessionUser.id, 'break']);
      if (!hasBreak && !dismissed.has(`${entryId}:-1:missing_break`)) count++;
    }
    if (totalMins > 360) {
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
  // Move window onto the target display first, then maximize so Electron
  // picks the right display for the maximize operation.
  mainWindow.setPosition(target.bounds.x + 10, target.bounds.y + 10);
  mainWindow.maximize();
  return { ok: true };
});
ipcMain.on('navigate',     (_, page) => navigate(page));

// ── IPC: Auth ──────────────────────────────────────────────────────────────
ipcMain.handle('auth:check-setup', () => {
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
    dbInsert(
      'INSERT INTO users (username, password_hash, totp_secret, totp_verified, recovery_hash, key_salt) VALUES (?,?,?,1,?,?)',
      [username, passwordHash, totpSecret, recoveryHash, keySalt]
    );
    persistDB();
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
    sessionUser = { id: Number(user.rid), username: user.username, display_name: user.display_name || null };
    db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
    persistDB();
    resetIdleTimer();
    return { ok: true };
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

ipcMain.handle('auth:recover', async (_, { username, recoveryCode }) => {
  const bcrypt = require('bcryptjs');
  const user   = dbGet('SELECT rowid as rid, * FROM users WHERE username=?', [username]);
  if (!user?.recovery_hash) return { ok: false, error: 'No recovery available.' };
  if (!bcrypt.compareSync(recoveryCode, user.recovery_hash)) return { ok: false, error: 'Invalid recovery code.' };
  db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE rowid=?', [Number(user.rid)]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('totp:generate', async () => {
  const speakeasy = require('speakeasy');
  const qrcode    = require('qrcode');
  const secret = speakeasy.generateSecret({ name: 'Conquered Time', length: 20 });
  const qrUrl  = await qrcode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrUrl };
});

ipcMain.handle('session:get', () => sessionUser ? { id: sessionUser.id, username: sessionUser.username, display_name: sessionUser.display_name || null } : null);
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
    [sessionUser.id, companyId]).map(r => ({...r, id: Number(r.rid)}));
});

ipcMain.handle('entries:save', (_, entry) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  try {
    if (entry.id) {
      db.run('UPDATE time_entries SET rows_json=?,total_mins=?,session_label=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [entry.rows_json, entry.total_mins, entry.session_label || '', entry.id, sessionUser.id]);
      activeEntryId = Number(entry.id);
      persistDB(); performBackup();
      return { ok: true, id: entry.id };
    } else {
      db.run('INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,total_mins) VALUES (?,?,?,?,?,?)',
        [sessionUser.id, entry.company_id, entry.log_date, entry.session_label || '', entry.rows_json, entry.total_mins]);
      // Get the rowid of the just-inserted row
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
    .map(r => ({...r, id: Number(r.rid)}));
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
          const rows = JSON.parse(c.rows_json || '[]');
          if (rows.some(r => r.clock_in && !r.clock_out)) { row = c; break; }
        } catch {}
      }
    }
    if (row) activeEntryId = Number(row.rid);
  }

  if (!row) return null;

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
  return { ...row, id: Number(row.rid) };
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
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(entry_id), sessionUser.id]);
  if (!row) return { ok: false, error: 'Entry not found' };
  try {
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
    const newJson = JSON.stringify(rows);
    const newTotal = rows.reduce((s, row) => s + (row.total_mins || 0), 0);
    db.run('UPDATE time_entries SET rows_json=?, total_mins=?, updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
      [newJson, newTotal, Number(entry_id), sessionUser.id]);
    persistDB(); performBackup();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

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

ipcMain.handle('profile:save', (_, { display_name, full_name, email, phone, job_title, avatar }) => {
  if (!sessionKey || !sessionUser) return { ok: false };
  try {
    const blob = encrypt(JSON.stringify({ full_name: full_name || '', email: email || '', phone: phone || '', job_title: job_title || '', avatar: avatar || null }), sessionKey);
    db.run('UPDATE users SET display_name=?, profile_enc=?, profile_iv=?, profile_tag=? WHERE rowid=?',
      [display_name || null, blob.data, blob.iv, blob.tag, sessionUser.id]);
    sessionUser.display_name = display_name || null;
    persistDB();
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
ipcMain.handle('db:clear-timeclock', () => {
  if (!sessionKey || !sessionUser) return { ok: false };
  db.run('DELETE FROM task_items WHERE user_id=?', [sessionUser.id]);
  db.run('DELETE FROM time_entries WHERE user_id=?', [sessionUser.id]);
  activeEntryId = null;
  persistDB(); performBackup();
  return { ok: true };
});

ipcMain.handle('db:clear-companies', () => {
  if (!sessionKey || !sessionUser) return { ok: false };
  db.run('DELETE FROM task_items WHERE user_id=?', [sessionUser.id]);
  db.run('DELETE FROM time_entries WHERE user_id=?', [sessionUser.id]);
  db.run('DELETE FROM companies WHERE user_id=?', [sessionUser.id]);
  activeEntryId = null;
  persistDB(); performBackup();
  return { ok: true };
});

ipcMain.handle('db:clear-full', () => {
  if (!sessionKey || !sessionUser) return { ok: false };
  db.run('DELETE FROM task_items');
  db.run('DELETE FROM time_entries');
  db.run('DELETE FROM companies');
  db.run('DELETE FROM app_settings');
  db.run('DELETE FROM users');
  activeEntryId = null;
  sessionKey  = null;
  sessionUser = null;
  persistDB();
  return { ok: true };
});

ipcMain.handle('app:get-info', () => ({
  version:         app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion:     process.versions.node,
  platform:        process.platform === 'win32' ? 'Windows' :
                   process.platform === 'darwin' ? 'macOS' : 'Linux',
  arch:            process.arch,
}));

ipcMain.handle('settings:get', (_, key) => {
  const row = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
  return row ? row.value : null;
});
ipcMain.handle('settings:set', (_, { key, value }) => {
  dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [key, String(value)]);
  persistDB();
  return { ok: true };
});

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await initDB();

  // Read saved theme so splash matches the user's preference
  let savedTheme = 'arctic';
  try {
    const row = dbGet("SELECT value FROM app_settings WHERE key='ui_theme'");
    if (row?.value) savedTheme = row.value;
  } catch {}

  const splash = createSplashWindow(savedTheme);
  createWindow(); // creates hidden (show: false)

  // Apply window position/size settings before show
  const rememberPos   = dbGet("SELECT value FROM app_settings WHERE key='win_rememberPosition'")?.value === 'true';
  const lastBoundsRaw = dbGet("SELECT value FROM app_settings WHERE key='win_lastBounds'")?.value;
  const prefDisplay   = dbGet("SELECT value FROM app_settings WHERE key='win_preferredDisplay'")?.value || 'primary';
  // Default to true — only false when user has explicitly toggled it off
  const startMax      = dbGet("SELECT value FROM app_settings WHERE key='win_startMaximized'")?.value !== 'false';

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

app.on('window-all-closed', () => {
  persistDB(); performBackup(); app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
