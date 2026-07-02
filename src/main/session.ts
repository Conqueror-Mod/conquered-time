'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  session.ts — in-memory session state + idle lock (Phase 2 extraction).
//
//  Owns the security-critical mutable state: the AES session key (held in
//  memory only, cleared on lock/close), the logged-in user row, and the live
//  time-entry id. Exported as one `session` object so every module mutates
//  the SAME state (destructured lets would snapshot).
//
//  lockSession needs main-window access and the audit count, which live in
//  modules that themselves depend on session state — those are injected via
//  initSession() to keep the require graph acyclic.
// ════════════════════════════════════════════════════════════════════════════

const path = require('path');
const { decrypt } = require('./vault-crypto');
const { dbGet, dbAll, dbRun, persistDB } = require('./db');

interface SessionState {
  /** AES-256 session key — memory only, null when locked/logged out. */
  key: Buffer | null;
  /** Logged-in user row (id = rowid; see gotcha #1). */
  user: Record<string, any> | null;
  /** rowid of the currently live time_entries row. */
  activeEntryId: number | null;
  /** Active profile directory (unique per profile — the cache-owner salt). */
  profileDir: string | null;
}

const session: SessionState = { key: null, user: null, activeEntryId: null, profileDir: null };

let idleTimer: ReturnType<typeof setTimeout> | null = null;

interface SessionDeps {
  getMainWindow: () => any;
  countAuditDiscrepancies: () => number;
  rendererDir: string;
}
let deps: SessionDeps | null = null;

function initSession(d: SessionDeps): void { deps = d; }

// Decrypt a time_entries row's rows_json in place using the session key.
function decryptEntry(row: Record<string, any>): Record<string, any> {
  if (row.rows_enc && row.rows_iv && row.rows_tag) {
    try {
      row.rows_json = decrypt({ data: row.rows_enc, iv: row.rows_iv, tag: row.rows_tag }, session.key);
    } catch { row.rows_json = '[]'; }
  }
  return row;
}

function lockSession(skipAuditCheck = false): void {
  const mainWindow = deps.getMainWindow();
  if (!skipAuditCheck && session.user) {
    const count = deps.countAuditDiscrepancies();
    if (count > 0) {
      mainWindow.webContents.send('audit:close-warning', { count, action: 'lock' });
      return;
    }
  }
  clearIdleTimer();
  session.key = null; session.user = null; session.activeEntryId = null;
  mainWindow.loadFile(path.join(deps.rendererDir, 'pages/login.html'));
}

function clearIdleTimer(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function resetIdleTimer(): void {
  clearIdleTimer();
  const row = dbGet('SELECT value FROM app_settings WHERE key=?', ['ui_autoLockMinutes']);
  const minutes = parseInt(row?.value || '0', 10);
  if (!minutes || !session.user) return;
  idleTimer = setTimeout(() => {
    deps.getMainWindow().webContents.send('toast', { msg: 'Session locked due to inactivity.', type: 'info' });
    setTimeout(() => lockSession(true), 1200); // let toast render briefly before navigating
  }, minutes * 60 * 1000);
}

// C6 (D-012): recovery sweep for orphaned running task_items. A task/break/
// lunch left running when its session has no open punch (crash, close-to-tray
// quit, or a clock-out that predates the auto-stop fix) is invisible in
// Dispatch (entries:get-active → null) and unstoppable. On every login, stop
// any such item: at the entry's last clock_out when that's after started_at,
// else at started_at (zero duration — the punch closed before it started).
// Runs after migrateTimeEntries() in ALL login handlers (auth:login,
// auth:quick-unlock, auth:safe-login) — same rule as the report catch-up
// (gotcha #9): add it to any future session-establishing path too.
function sweepOrphanTaskItems(): number {
  if (!session.key || !session.user) return 0;
  let fixed = 0;
  try {
    const open = dbAll('SELECT rowid as rid, * FROM task_items WHERE user_id=? AND stopped_at IS NULL', [session.user.id]);
    for (const t of open) {
      const e = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?', [Number(t.entry_id), session.user.id]);
      let hasOpenPunch = false, lastOutMs = 0;
      if (e) {
        try {
          decryptEntry(e);
          const rows = JSON.parse(e.rows_json || '[]');
          hasOpenPunch = rows.some(r => r.clock_in && !r.clock_out);
          rows.forEach(r => {
            if (!r.clock_out) return;
            const ms = new Date(`${e.log_date}T${r.clock_out}:00`).getTime();
            if (ms > lastOutMs) lastOutMs = ms;
          });
        } catch {}
      }
      if (hasOpenPunch) continue; // legitimately running inside an open punch
      const startedAt = Number(t.started_at) || Date.now();
      const stopAt = lastOutMs > startedAt ? lastOutMs : startedAt;
      dbRun('UPDATE task_items SET stopped_at=?, duration_secs=? WHERE rowid=? AND user_id=?',
        [stopAt, Math.max(0, Math.floor((stopAt - startedAt) / 1000)), Number(t.rid), session.user.id]);
      fixed++;
    }
    if (fixed > 0) {
      persistDB();
      console.log(`[sweep] stopped ${fixed} orphaned running task item(s)`);
    }
  } catch (err) { console.warn('[sweep] orphan task sweep failed:', err.message); }
  return fixed;
}

module.exports = {
  session, initSession, decryptEntry,
  lockSession, clearIdleTimer, resetIdleTimer, sweepOrphanTaskItems,
};
