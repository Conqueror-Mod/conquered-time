'use strict';

// ── Auto-updater ─────────────────────────────────────────────────────────────
// Wraps electron-updater against the GitHub Releases feed (see package.json
// build.publish). Design: manual/opt-in download, not silent.
//
//   1. checkForUpdates() — on launch (packaged only) + on-demand from About.
//   2. If an update is available the renderer shows a "Download" affordance.
//   3. On user click we download; progress is streamed to the renderer.
//   4. When downloaded the renderer offers "Restart & Install" → quitAndInstall.
//
// electron-updater only functions in a packaged build (it reads app-update.yml
// bundled by electron-builder). In dev we short-circuit every IPC with a clear
// "dev build" status so the UI degrades gracefully instead of throwing.

const { ipcMain, app } = require('electron');

interface UpdaterCtx {
  getMainWindow: () => any;
  getAppPref: (key: string, dflt: any) => any;
  setAppPref: (key: string, val: any) => void;
}

// Post-install confirmation: computed once at register() by comparing the
// running version to the last version we recorded in app-prefs. Consumed once
// by the renderer (update:just-updated) so the profile selector can show a
// "✓ Updated to vX" notice — the install itself is otherwise invisible.
let justUpdated: { from: string; to: string } | null = null;

// Numeric-aware semver-ish "is a greater than b" (major.minor.patch). Guards the
// confirmation against a downgrade/reinstall showing a bogus "updated" message.
function versionGreater(a: string, b: string): boolean {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// State forwarded to the renderer via the 'update:status' channel. `state` is
// the discriminator; other fields are populated per-state.
interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'download-progress' | 'downloaded' | 'error' | 'dev';
  version?: string;
  notes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
}

let lastStatus: UpdateStatus = { state: 'idle' };

function register(ctx: UpdaterCtx): void {
  const send = (status: UpdateStatus) => {
    lastStatus = status;
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
  };

  // Detect a completed self-update: the recorded version differs from (and is
  // older than) the running one. Only meaningful in a packaged build; recorded
  // regardless so the FIRST packaged launch just seeds the baseline (no notice).
  const current = app.getVersion();
  if (app.isPackaged) {
    const last = ctx.getAppPref('appVersion', null);
    if (last && last !== current && versionGreater(current, last)) {
      justUpdated = { from: last, to: current };
    }
    if (last !== current) ctx.setAppPref('appVersion', current);
  }
  // Consume-once: the renderer asks on load, we hand it over and clear it so the
  // confirmation shows exactly once after an update (survives listener-attach
  // races that a fire-and-forget event would lose). Registered in BOTH branches.
  ipcMain.handle('update:just-updated', () => {
    const ju = justUpdated;
    justUpdated = null;
    return ju ? { updated: true, ...ju } : { updated: false };
  });

  // In dev (not packaged) electron-updater has no app-update.yml — don't even
  // require it. Report a stable 'dev' status for the UI and no-op the actions.
  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => { const s: UpdateStatus = { state: 'dev' }; send(s); return s; });
    ipcMain.handle('update:download', () => ({ ok: false, error: 'Updates are only available in installed builds.' }));
    ipcMain.handle('update:install', () => ({ ok: false, error: 'Updates are only available in installed builds.' }));
    ipcMain.handle('update:status', () => lastStatus);
    return;
  }

  const { autoUpdater } = require('electron-updater');
  // Opt-in flow: we drive download/install explicitly from the UI.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info: any) =>
    send({ state: 'available', version: info?.version, notes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : '' }));
  autoUpdater.on('update-not-available', (info: any) =>
    send({ state: 'not-available', version: info?.version || app.getVersion() }));
  autoUpdater.on('download-progress', (p: any) =>
    send({ state: 'download-progress', percent: p?.percent || 0, transferred: p?.transferred, total: p?.total, bytesPerSecond: p?.bytesPerSecond }));
  autoUpdater.on('update-downloaded', (info: any) =>
    send({ state: 'downloaded', version: info?.version }));
  autoUpdater.on('error', (err: any) =>
    send({ state: 'error', error: (err && err.message) ? err.message : String(err) }));

  ipcMain.handle('update:check', async () => {
    try { await autoUpdater.checkForUpdates(); return lastStatus; }
    catch (e) { const s: UpdateStatus = { state: 'error', error: (e as Error).message }; send(s); return s; }
  });

  ipcMain.handle('update:download', async () => {
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { const msg = (e as Error).message; send({ state: 'error', error: msg }); return { ok: false, error: msg }; }
  });

  // Quit and install the staged update. autoInstallOnAppQuit is also on as a
  // fallback if the user just closes the app instead of clicking install.
  ipcMain.handle('update:install', () => {
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  });

  ipcMain.handle('update:status', () => lastStatus);
}

// Fire a silent check shortly after launch (packaged only). Any 'available'
// result surfaces through the same 'update:status' channel; the About panel
// reflects it whenever the user opens Settings.
function checkOnLaunch(ctx: UpdaterCtx): void {
  if (!app.isPackaged) return;
  setTimeout(() => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdates().catch(() => {});
    } catch { /* no-op */ }
  }, 10000);
}

module.exports = { register, checkOnLaunch };
