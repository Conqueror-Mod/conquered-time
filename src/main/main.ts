'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } = require('electron');
const path       = require('path');
const fs         = require('fs');
const { loadSqlJs, newDatabase, openDb, hasDb, setDbFile, getDbFile, persistDB, dbGet, dbRun } = require('./db');
const { readCache } = require('./cache');
const {
  session, initSession,
  lockSession, clearIdleTimer, resetIdleTimer,
} = require('./session');
const { countAuditDiscrepancies } = require('./audit');
const { setBackupDir, getBackupDir, performBackup } = require('./backups');
const { initEmail, runScheduledEmailCheck } = require('./email');

// Beta-key signing secret — private, gitignored, bundled into builds. If the
// file is absent (e.g. a fresh clone), the gate fails OPEN (disabled) so the
// app still runs; a missing secret must never brick the app.
let BETA_SECRET: unknown = null;
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
session.profileDir = IS_DEV ? ROOT_DATA_DIR : null;
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
function getAppPref(key: string, dflt: any) {
  const v = readAppPrefs()[key];
  return v === undefined ? dflt : v;
}
function setAppPref(key: string, val: any) {
  const p = readAppPrefs();
  p[key] = val;
  try { fs.writeFileSync(APP_PREFS_FILE, JSON.stringify(p, null, 2)); }
  catch (e) { console.error('[app-prefs] write failed:', e.message); }
}

// Beta-key gate + beta:* handlers live in ./ipc/auth.

// ── In-memory session state ────────────────────────────────────────────────
// session.key / session.user / session.activeEntryId + the idle-lock timer
// live in ./session (imported above); mutate through that shared object only.
let mainWindow: any = null;
// App-wide UI scale, applied as a browser-style webContents zoom factor so the
// WHOLE window scales uniformly (sidebar, titlebar, modals, content). Replaces
// the old CSS `zoom` on #main-content, which left the chrome unscaled and gave
// no visible feedback while the Settings modal was open. Held here because the
// zoom resets on navigation (loadFile) and must be reapplied on every page.
let zoomFactor = 1;
function applyZoomFactor(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.setZoomFactor(zoomFactor); } catch {}
  }
}
let forceClose   = false;  // set true after user confirms close through audit prompt
let tray: any        = null;   // system tray icon (created on whenReady)
let isQuitting   = false;  // set true when the user really means to quit (tray/menu Quit)

// Wire the acyclic deps: session needs the window, the audit count, and the
// renderer dir (for the lock navigation); email needs the window for toasts.
initSession({
  getMainWindow: () => mainWindow,
  countAuditDiscrepancies,
  rendererDir: RENDERER_DIR,
});
initEmail({ getMainWindow: () => mainWindow });

// ── IPC handler modules ─────────────────────────────────────────────────────
// Each ipc/* module registers its own handlers at require time; main-owned
// helpers (window creation etc.) are passed as a ctx object. Function
// declarations below are hoisted, so referencing them here is safe.
require('./ipc/companies').register();
require('./ipc/entries').register();
require('./ipc/audit').register({ createAuditWizardWindow });
require('./ipc/email').register();
require('./ipc/invoices').register();
require('./ipc/settings').register({
  getMainWindow: () => mainWindow,
  applyLaunchAtStartup, loginItemOpts, getAppPref, setAppPref,
  rendererDir: RENDERER_DIR, IS_DEV,
});
require('./ipc/auth').register({
  IS_DEV, PROFILES_DIR, BETA_SECRET,
  getAppPref, setAppPref,
  initProfileDB, writeManifest, readManifest,
});
// Auto-updater (electron-updater ↔ GitHub Releases). No-ops in dev.
const updater = require('./updater');
updater.register({ getMainWindow: () => mainWindow, getAppPref, setAppPref });

// The main-process read cache (memoized decrypted reads) lives in ./cache.

// ── Profile manifest helpers ───────────────────────────────────────────────
function writeManifest(profileDir: string, data: any) {
  fs.writeFileSync(path.join(profileDir, 'profile-manifest.json'), JSON.stringify(data, null, 2));
}

function readManifest(profileDir: string) {
  try { return JSON.parse(fs.readFileSync(path.join(profileDir, 'profile-manifest.json'), 'utf8')); }
  catch { return null; }
}

// Read a single app_settings value without requiring an active session.
// In dev mode (db already loaded), reads directly. In prod, peeks into the
// first available profile's vault to pull startup prefs (theme, window pos).
function readStartupSetting(key: string) {
  if (hasDb()) {
    const row = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
    return row?.value ?? null;
  }
  if (!PROFILES_DIR || !fs.existsSync(PROFILES_DIR)) return null;
  const dirs = fs.readdirSync(PROFILES_DIR).filter(
    (n: string) => fs.existsSync(path.join(PROFILES_DIR, n, 'vault.db'))
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
async function initProfileDB(profileDir: string) {
  session.profileDir = profileDir;
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
    CREATE TABLE IF NOT EXISTS invoices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      seq        INTEGER NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'unpaid',
      paid_at    INTEGER,
      issued_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      data_enc   TEXT    NOT NULL,
      data_iv    TEXT    NOT NULL,
      data_tag   TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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

// reEncryptVault / migrateTimeEntries wrappers live in ./ipc/auth.

// ── Window ─────────────────────────────────────────────────────────────────
function createSplashWindow(theme: string, display?: any) {
  const W = 600, H = 400;
  // Center on the display the main window will occupy (preferred display /
  // remembered bounds) — `center: true` would put the splash on the primary
  // monitor while the app then opens elsewhere.
  const pos = display ? {
    x: Math.round(display.workArea.x + (display.workArea.width - W) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - H) / 2),
  } : null;
  const splash = new BrowserWindow({
    width: W, height: H,
    ...(pos ? pos : { center: true }),
    frame: false,
    resizable: false,
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

// Center child windows on the display the MAIN WINDOW currently occupies —
// `center: true` centers on the PRIMARY display, which strands the window on
// another monitor in multi-display setups.
function centerOnAppDisplay(width: number, height: number): { x: number; y: number } | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const wa = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
  };
}

function createAuditWizardWindow(mode?: string, theme?: string) {
  const W = 680, H = 520;
  const pos = centerOnAppDisplay(W, H);
  const wizard = new BrowserWindow({
    width: W, height: H,
    ...(pos ? pos : { center: true }),
    frame: false,
    resizable: false,
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
    query: { mode: mode || 'fix', theme: theme || 'memoria' }
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
  // webContents zoom resets on each navigation; reapply the stored scale after
  // every page load (this is not a SPA — each page is a fresh loadFile).
  mainWindow.webContents.on('did-finish-load', applyZoomFactor);
  mainWindow.loadFile(path.join(RENDERER_DIR, 'pages/login.html'));
  mainWindow.on('close', (event: any) => {
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
  // NOTE the quotes around the app path: setLoginItemSettings joins args with
  // spaces and does NOT quote them, so an unquoted app path containing a space
  // (e.g. "…\My Projects\…") gets split — electron.exe then launches with no
  // valid app and shows its default "welcome" window on every Windows login /
  // RDP reconnect. Quoting keeps the path a single argument. (Packaged builds
  // don't hit this: execPath is the real exe and needs no app-path arg.)
  const o = app.isPackaged
    ? { args: ['--startup'] }
    : { path: process.execPath, args: [`"${app.getAppPath()}"`, '--startup'] };
  return Object.assign(o, extra);
}
function applyLaunchAtStartup(enabled: boolean) {
  try {
    app.setLoginItemSettings(loginItemOpts({ openAtLogin: !!enabled }));
  } catch (e) {
    console.error('[startup] setLoginItemSettings failed:', e.message);
  }
}

function navigate(page: string) {
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

// App-wide UI scale — set the browser-style zoom factor for the whole window.
// Clamped to a sane range. The renderer (settings.js / login pre-auth) calls
// this whenever the scale changes; did-finish-load reapplies it per page.
ipcMain.handle('win:set-zoom', (_: unknown, factor: any) => {
  const n = Number(factor);
  if (Number.isFinite(n)) { zoomFactor = Math.max(0.5, Math.min(2, n)); applyZoomFactor(); }
  return { ok: true };
});
ipcMain.on('shell:open-external', (_: unknown, url: any) => {
  const { shell } = require('electron');
  // Only allow http/https URLs to prevent protocol abuse
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// win:* preference handlers live in ./ipc/settings.
ipcMain.on('navigate',     (_: unknown, page: any) => navigate(page));

// profiles:* / auth:* / totp:generate live in ./ipc/auth.

ipcMain.handle('session:get', () => session.user ? { id: session.user.id, username: session.user.username, display_name: session.user.display_name || null, work_state: session.user.work_state || null } : null);
ipcMain.handle('session:heartbeat', () => { if (session.user) resetIdleTimer(); return null; });
ipcMain.on('session:request-lock',   () => lockSession(false));
ipcMain.on('session:confirm-close',  () => { forceClose = true; mainWindow.close(); });
ipcMain.on('session:confirm-lock',   () => lockSession(true));

// companies:* handlers live in ./ipc/companies.
// entries:* / tasks:* handlers live in ./ipc/entries.
// ── IPC: Settings ──────────────────────────────────────────────────────────
// ── IPC: Backup library ───────────────────────────────────────────────────
// backup:* / auth:browse-backup live in ./ipc/settings.
// audit:* handlers live in ./ipc/audit.

// getProfileEmail / profileEmailMissing live in ./email.

// profile:get / profile:save / auth:change-password live in ./ipc/auth.

// audit:open-wizard / audit:count / audit:email-notify live in ./ipc/audit.

// db:clear-* handlers live in ./ipc/settings.

// app:get-info / settings:* live in ./ipc/settings. Update checking lives in
// ./updater (electron-updater, channels update:*).

// ── App lifecycle ──────────────────────────────────────────────────────────
// ── Context menu (right-click) ─────────────────────────────────────────────
// Electron disables the browser's built-in context menu by default.
// This restores a standard edit menu (cut/copy/paste/select-all) on all windows.
app.on('web-contents-created', (_e: any, wc: any) => {
  wc.on('context-menu', (_ev: any, params: any) => {
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
  setInterval(() => runScheduledEmailCheck().catch((e: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', `Scheduled report failed: ${e.message}`, 'error', 8000);
  }), 5 * 60 * 1000);

  // Silent update check ~10s after launch (packaged builds only).
  updater.checkOnLaunch({ getMainWindow: () => mainWindow });

  // Load the sql.js WASM module once (needed for migration peek reads too)
  await loadSqlJs();

  // Prod only: migrate old flat vault.db → profiles/<username>/vault.db
  if (!IS_DEV) migrateFromLegacyVault();

  // Dev: auto-load the dev profile so the rest of the flow is identical
  if (IS_DEV) await initProfileDB(ROOT_DATA_DIR);

  // Start minimized to tray: only when the OS auto-launched us (--startup) AND the
  // user opted in. Skips the splash and leaves the window hidden in the tray.
  const startHidden = STARTED_AT_LOGIN && getAppPref('startMinimized', false) === true;

  // Window position/size settings — read BEFORE the splash so it can open on
  // the same display the main window will land on (not always the primary).
  const rememberPos   = readStartupSetting('win_rememberPosition') === 'true';
  const lastBoundsRaw = readStartupSetting('win_lastBounds');
  const prefDisplay   = readStartupSetting('win_preferredDisplay') || 'primary';
  // Default to true — only false when user has explicitly toggled it off
  const startMax      = readStartupSetting('win_startMaximized') !== 'false';

  let splashDisplay: any = null;
  try {
    if (rememberPos && lastBoundsRaw) splashDisplay = screen.getDisplayMatching(JSON.parse(lastBoundsRaw));
    else if (prefDisplay !== 'primary')
      splashDisplay = screen.getAllDisplays().find((d: any) => d.id === Number(prefDisplay)) || null;
  } catch {}

  // Splash always uses zanarkand — it's a brand moment, not a user preference moment.
  const splash = startHidden ? null : createSplashWindow('zanarkand', splashDisplay);
  createWindow(); // creates hidden (show: false)
  createTray();
  // No launch-at-startup re-sync needed here: the OS login item is its own
  // persistent source of truth (toggled via win:set-launch-at-startup).

  if (rememberPos && lastBoundsRaw) {
    try {
      const b = JSON.parse(lastBoundsRaw);
      mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }, false);
    } catch {}
  } else if (prefDisplay !== 'primary') {
    // Move onto the preferred display; always maximize to avoid off-screen issues
    const target = screen.getAllDisplays().find((d: any) => d.id === Number(prefDisplay)) || screen.getPrimaryDisplay();
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
  // Dragging the window to another monitor updates the stored preferred
  // display, so the picker highlight and the next launch both follow the
  // monitor the window actually lives on.
  function syncPreferredDisplay() {
    if (!hasDb()) return;
    const d = screen.getDisplayMatching(mainWindow.getBounds());
    const val = d.id === screen.getPrimaryDisplay().id ? 'primary' : String(d.id);
    if (dbGet("SELECT value FROM app_settings WHERE key='win_preferredDisplay'")?.value === val) return;
    dbRun("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('win_preferredDisplay',?)", [val]);
    persistDB();
  }
  mainWindow.on('moved',   () => { saveWindowBounds(); syncPreferredDisplay(); });
  mainWindow.on('resized', saveWindowBounds);
  // 'moved' only fires at the end of a REAL drag (WM_EXITSIZEMOVE) — programmatic
  // setPosition/maximize emit only 'move'. Debounced so a drag doesn't write on
  // every pixel.
  let moveDebounce: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on('move', () => {
    if (moveDebounce) clearTimeout(moveDebounce);
    moveDebounce = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) syncPreferredDisplay();
    }, 400);
  });

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

// email:* handlers live in ./ipc/email.

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
