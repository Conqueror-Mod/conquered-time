'use strict';

const fs = require('fs');
const path = require('path');
const { app, ipcMain, screen, dialog } = require('electron');
const { session, clearIdleTimer } = require('../session');
const { dbGet, dbRun, persistDB, hasDb, getDbFile, setDbFile, replaceDb, newDatabase } = require('../db');
const { readCache, invalidateEntriesCache } = require('../cache');
const { setBackupDir, getBackupDir, performBackup } = require('../backups');

// Update check URL — point this at the raw version.json in your GitHub repo once published
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/Conqueror-Mod/conquered-time/master/version.json';

// ctx: main-owned window/prefs helpers.
function register(ctx: Record<string, any>) {
  const { getMainWindow, applyLaunchAtStartup, loginItemOpts, getAppPref, setAppPref, rendererDir, IS_DEV } = ctx;
ipcMain.handle('win:get-displays', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d: any, i: any) => ({
    id:        d.id,
    index:     i + 1,
    isPrimary: d.id === primary.id,
    width:     d.bounds.width,
    height:    d.bounds.height,
  }));
});

ipcMain.handle('win:move-to-display', (_: unknown, displayId: any) => {
  const displays = screen.getAllDisplays();
  const target = displayId === 'primary'
    ? screen.getPrimaryDisplay()
    : (displays.find((d: any) => d.id === Number(displayId)) || screen.getPrimaryDisplay());
  // Windows ignores setPosition() on a maximized window — must unmaximize first,
  // reposition, then re-maximize so Electron targets the correct display.
  if (getMainWindow().isMaximized()) getMainWindow().unmaximize();
  getMainWindow().setPosition(target.bounds.x + 10, target.bounds.y + 10);
  getMainWindow().maximize();
  return { ok: true };
});
ipcMain.handle('win:set-launch-at-startup', (_: unknown, enabled: any) => {
  applyLaunchAtStartup(enabled);
  return { ok: true };
});
// Source of truth is the OS login item itself — no app storage needed. Read with
// the same opts used to register, or Windows won't match the entry (see loginItemOpts).
ipcMain.handle('win:get-launch-at-startup', () => {
  try { return app.getLoginItemSettings(loginItemOpts()).openAtLogin === true; } catch { return false; }
});
ipcMain.handle('win:get-close-to-tray', () => getAppPref('closeToTray', false) === true);
ipcMain.handle('win:set-close-to-tray', (_: unknown, enabled: any) => {
  setAppPref('closeToTray', !!enabled);
  return { ok: true };
});
ipcMain.handle('win:get-start-minimized', () => getAppPref('startMinimized', false) === true);
ipcMain.handle('win:set-start-minimized', (_: unknown, enabled: any) => {
  setAppPref('startMinimized', !!enabled);
  return { ok: true };
});

ipcMain.handle('backup:list', () => {
  if (!session.user) return [];
  if (!fs.existsSync(getBackupDir())) return [];
  const files = fs.readdirSync(getBackupDir())
    .filter((f: any) => f.startsWith('vault-') && f.endsWith('.db'))
    .sort().reverse();
  return files.map((f: any) => {
    const stat = fs.statSync(path.join(getBackupDir(), f));
    const ts = f.replace('vault-', '').replace('.db', '').replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
    return { filename: f, timestamp: ts, sizeKB: Math.round(stat.size / 1024) };
  });
});

ipcMain.handle('backup:preview', (_: unknown, filename: any) => {
  if (!session.user) return { error: 'No session' };
  if (!/^vault-[\d\-T]+\.db$/.test(filename)) return { error: 'Invalid filename' };
  const filepath = path.join(getBackupDir(), filename);
  if (!fs.existsSync(filepath)) return { error: 'File not found' };
  try {
    const buf     = fs.readFileSync(filepath);
    const preview = newDatabase(buf);
    const get1    = (q: any) => { const r = preview.exec(q); return r[0]?.values[0]?.[0] ?? null; };
    const username    = get1('SELECT username FROM users LIMIT 1') || 'Unknown';
    const companyCount = Number(get1('SELECT COUNT(*) FROM companies') || 0);
    const entryCount   = Number(get1('SELECT COUNT(*) FROM time_entries') || 0);
    const dateFrom     = get1('SELECT MIN(log_date) FROM time_entries') || '—';
    const dateTo       = get1('SELECT MAX(log_date) FROM time_entries') || '—';
    preview.close();
    return { username, companyCount, entryCount, dateFrom, dateTo };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('backup:restore', (_: unknown, filename: any) => {
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
    getMainWindow().loadFile(path.join(rendererDir, 'pages/login.html'));
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// Pre-auth backup restore — opens file dialog, no session required
ipcMain.handle('auth:browse-backup', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(getMainWindow(), {
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
    getMainWindow().loadFile(path.join(rendererDir, 'pages/login.html'));
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
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
ipcMain.handle('db:clear-timeclock-company', (_: unknown, arg: any) => {
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
  const profileDir = session.profileDir; // capture before clearing session state

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
  session.profileDir = null;
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




ipcMain.handle('app:check-update', () => new Promise((resolve) => {
  const https = require('https');
  const current = app.getVersion();
  const req = https.get(UPDATE_CHECK_URL, { timeout: 8000 }, (res: any) => {
    let raw = '';
    res.on('data', (chunk: any) => raw += chunk);
    res.on('end', () => {
      try {
        const data = JSON.parse(raw);
        const latest = data.version || current;
        // Simple semver comparison: split on dots, compare each segment numerically
        const parse = (v: string) => v.replace(/[^0-9.]/g, '').split('.').map(Number);
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

ipcMain.handle('settings:get', (_: unknown, key: any) => {
  if (!hasDb()) return null;
  const row = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
  return row ? row.value : null;
});
ipcMain.handle('settings:set', (_: unknown, { key, value }: Record<string, any>) => {
  if (!hasDb()) return { ok: false };
  dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [key, String(value)]);
  persistDB();
  return { ok: true };
});
}

module.exports = { register };
