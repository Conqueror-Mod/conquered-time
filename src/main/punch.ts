'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  punch.ts — main-process punch engine (tray punch + global hotkey).
//
//  Lets the user Clock In / Clock Out without the renderer: from the tray menu
//  or the global punch hotkey, including while the window is hidden in the
//  tray. Clock-in repeats the LAST task (most recent company + its last row's
//  Task Label/Name — the app-wide "a punch needs a label and a name" rule is
//  satisfied by carrying them forward, never by writing a blank punch).
//
//  All writes go through the same encrypted-row path as entries:save; after a
//  successful punch the renderer is told via the 'punch:changed' event so an
//  open tracker page reloads instead of autosaving a stale copy (its
//  optimistic-concurrency guard would reject that write anyway).
// ════════════════════════════════════════════════════════════════════════════

const { Notification } = require('electron');
const { session, decryptEntry } = require('./session');
const { dbAll, dbGet, dbRun, persistDB } = require('./db');
const { invalidateEntriesCache } = require('./cache');
const { performBackup } = require('./backups');
const { encrypt, decrypt } = require('./vault-crypto');
const { localDateStr } = require('../renderer/row-utils');
const { computeDiffMins } = require('../renderer/time-parse');

interface PunchDeps {
  getMainWindow: () => any;
  showMainWindow: () => void;
  /** Rebuild the tray menu after punch state changes. */
  refreshTray: () => void;
}
let deps: PunchDeps | null = null;
function initPunch(d: PunchDeps): void { deps = d; }

function nowTime(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

// ── Active-entry lookup ──────────────────────────────────────────────────────
// The single source of truth for "is a punch open?" — used by the tray/hotkey
// AND by entries:get-active (ipc/entries.ts) so the two can never disagree.
// Fast path is session.activeEntryId; fallback scans today's (and, for
// overnight sessions, yesterday's) entries for a clocked-in-not-out row.
function findActiveEntry(): Record<string, any> | null {
  if (!session.key || !session.user) return null;

  let row: Record<string, any> | null = null;
  if (session.activeEntryId) {
    row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
      [session.activeEntryId, session.user.id]);
  }
  if (!row) {
    // LOCAL date — toISOString here is UTC and pointed at tomorrow all evening.
    const scan = (date: string) => {
      const candidates = dbAll(
        'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date=? ORDER BY updated_at DESC',
        [session.user!.id, date]);
      for (const c of candidates) {
        try {
          decryptEntry(c);
          const rows = JSON.parse(c.rows_json || '[]');
          if (rows.some((r: any) => r.clock_in && !r.clock_out)) return c;
        } catch {}
      }
      return null;
    };
    row = scan(localDateStr()) || scan(localDateStr(new Date(Date.now() - 86400000)));
    if (row) session.activeEntryId = Number(row.rid);
  }
  return row;
}

// IMPORTANT: findActiveEntry's fast path returns the activeEntryId entry even
// when every row is closed ("the entry being worked on" — entries:get-active
// semantics the tracker relies on). Punch decisions need the stricter
// question "is a punch actually OPEN?", so they use this instead: the active
// entry only counts if it still has a clocked-in-not-out row, else the
// date-scan fallback decides.
function findOpenPunch(): { entry: Record<string, any>; rows: any[]; open: any } | null {
  const inspect = (e: Record<string, any> | null) => {
    if (!e) return null;
    try {
      decryptEntry(e);
      const rows = JSON.parse(e.rows_json || '[]');
      const open = rows.find((r: any) => r.clock_in && !r.clock_out);
      return open ? { entry: e, rows, open } : null;
    } catch { return null; }
  };
  if (session.activeEntryId) {
    const hit = inspect(dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
      [session.activeEntryId, session.user!.id]));
    if (hit) return hit;
  }
  for (const date of [localDateStr(), localDateStr(new Date(Date.now() - 86400000))]) {
    const candidates = dbAll(
      'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date=? ORDER BY updated_at DESC',
      [session.user!.id, date]);
    for (const c of candidates) {
      if (Number(c.rid) === session.activeEntryId) continue; // already inspected
      const hit = inspect(c);
      if (hit) return hit;
    }
  }
  return null;
}

function companyName(companyId: any): string | null {
  try {
    const co = dbGet('SELECT rowid as rid, * FROM companies WHERE rowid=? AND user_id=?',
      [Number(companyId), session.user!.id]);
    if (!co) return null;
    const plain = decrypt({ iv: co.data_iv, tag: co.data_tag, data: co.data_enc }, session.key);
    return JSON.parse(plain).name || null;
  } catch { return null; }
}

// Most recent entry that has a row with a Task Label + Name — the template a
// tray clock-in repeats. Scans newest-first and stops at the first hit.
function findLastTask(): { company_id: number; label: string; name: string } | null {
  if (!session.key || !session.user) return null;
  const entries = dbAll(
    'SELECT rowid as rid, * FROM time_entries WHERE user_id=? ORDER BY log_date DESC, updated_at DESC LIMIT 60',
    [session.user.id]);
  for (const e of entries) {
    try {
      decryptEntry(e);
      const rows = JSON.parse(e.rows_json || '[]');
      // Last named row in the entry (the most recent task worked).
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r && r.label && String(r.label).trim() && r.name && String(r.name).trim()) {
          return { company_id: Number(e.company_id), label: String(r.label), name: String(r.name) };
        }
      }
    } catch {}
  }
  return null;
}

// ── Punch state (drives the tray menu labels) ────────────────────────────────
interface PunchState {
  state: 'locked' | 'in' | 'out';
  /** state 'in': open row's clock_in + the entry's company name. */
  since?: string;
  company?: string | null;
  /** state 'out': the task a clock-in would repeat (null = no history yet). */
  lastTask?: { company_id: number; label: string; name: string; company: string | null } | null;
}
function getPunchState(): PunchState {
  if (!session.key || !session.user) return { state: 'locked' };
  const hit = findOpenPunch();
  if (hit) {
    return { state: 'in', since: hit.open.clock_in, company: companyName(hit.entry.company_id) };
  }
  const last = findLastTask();
  return {
    state: 'out',
    lastTask: last ? { ...last, company: companyName(last.company_id) } : null,
  };
}

// ── Persistence helpers ──────────────────────────────────────────────────────
function saveEntryRows(entryId: number, rows: any[], totalMins: number, sessionLabel: string): void {
  const enc = encrypt(JSON.stringify(rows), session.key);
  dbRun(
    'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,session_label=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
    [enc.data, enc.iv, enc.tag, '', totalMins, sessionLabel || '', entryId, session.user!.id]
  );
  session.activeEntryId = entryId;
  persistDB(); performBackup();
  invalidateEntriesCache();
}

// Toast when the window is visible, OS notification when it's hidden/tray'd.
// Content renders outside the app when notifying — keep it terse.
function announce(title: string, body: string, type = 'success'): void {
  const win = deps!.getMainWindow();
  const visible = win && !win.isDestroyed() && win.isVisible();
  if (visible) {
    try { win.webContents.send('toast', { msg: `${title} ${body}`.trim(), type }); } catch {}
  } else {
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: title.slice(0, 120), body: body.slice(0, 300) });
        n.on('click', () => deps!.showMainWindow());
        n.show();
      }
    } catch {}
  }
}

function broadcastChange(entryId: number | null, companyId: number | null): void {
  const win = deps!.getMainWindow();
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('punch:changed', { entry_id: entryId, company_id: companyId }); } catch {}
  }
  deps!.refreshTray();
}

// ── Clock in ────────────────────────────────────────────────────────────────
// Repeats the last task: most recent company + its last row's Label/Name onto
// today's entry for that company (appending a row, or creating the entry).
function punchIn(): Record<string, any> {
  if (!session.key || !session.user) return { ok: false, locked: true };
  if (findOpenPunch()) return { ok: false, already: 'in' };
  const last = findLastTask();
  if (!last) return { ok: false, noHistory: true };

  const today = localDateStr();
  const t = nowTime();
  const newRow = { label: last.label, name: last.name, desc: '', clock_in: t, clock_out: '', total_mins: 0 };

  // Reuse today's entry for that company if one exists (same rule as the
  // tracker page loading "today"); otherwise start a fresh session entry.
  const existing = dbGet(
    'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND company_id=? AND log_date=? ORDER BY updated_at DESC',
    [session.user.id, last.company_id, today]);
  let entryId: number;
  if (existing) {
    decryptEntry(existing);
    let rows: any[] = [];
    try { rows = JSON.parse(existing.rows_json || '[]'); } catch {}
    rows.push(newRow);
    entryId = Number(existing.rid);
    saveEntryRows(entryId, rows, Number(existing.total_mins) || 0, existing.session_label || '');
  } else {
    const enc = encrypt(JSON.stringify([newRow]), session.key);
    dbRun(
      'INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,rows_enc,rows_iv,rows_tag,total_mins) VALUES (?,?,?,?,?,?,?,?,?)',
      [session.user.id, last.company_id, today, '', '', enc.data, enc.iv, enc.tag, 0]);
    const maxRow = dbGet('SELECT MAX(rowid) as rid FROM time_entries WHERE user_id=?', [session.user.id]);
    entryId = Number(maxRow.rid);
    session.activeEntryId = entryId;
    persistDB(); performBackup();
    invalidateEntriesCache();
  }

  const co = companyName(last.company_id);
  announce('Clocked in.', `${last.name}${co ? ' — ' + co : ''} at ${t}`);
  broadcastChange(entryId, last.company_id);
  return { ok: true, id: entryId, company: co, label: last.label, name: last.name, time: t };
}

// ── Clock out ───────────────────────────────────────────────────────────────
function punchOut(): Record<string, any> {
  if (!session.key || !session.user) return { ok: false, locked: true };
  const hit = findOpenPunch();
  if (!hit) return { ok: false, already: 'out' };
  const { entry, rows, open } = hit;

  const t = nowTime();
  const diff = computeDiffMins(open.clock_in, t);
  open.clock_out = t;
  open.total_mins = (open.total_mins || 0) + diff;
  const totalMins = rows.reduce((s: number, r: any) => s + (Number(r.total_mins) || 0), 0);
  saveEntryRows(Number(entry.rid), rows, totalMins, entry.session_label || '');

  // Same rule as the tracker's clock-out (C6/D-012): once the session has no
  // open punch, no task/break/lunch may keep running — it would become
  // invisible in Dispatch and unstoppable.
  let stopped = 0;
  if (!rows.some((r: any) => r.clock_in && !r.clock_out)) {
    const openItems = dbAll(
      'SELECT rowid as rid, * FROM task_items WHERE entry_id=? AND user_id=? AND stopped_at IS NULL',
      [Number(entry.rid), session.user.id]);
    for (const it of openItems) {
      const startedAt = Number(it.started_at) || Date.now();
      const stopAt = Date.now();
      dbRun('UPDATE task_items SET stopped_at=?, duration_secs=? WHERE rowid=? AND user_id=?',
        [stopAt, Math.max(0, Math.floor((stopAt - startedAt) / 1000)), Number(it.rid), session.user.id]);
      stopped++;
    }
    if (stopped > 0) persistDB();
  }

  const co = companyName(entry.company_id);
  announce('Clocked out.', `${co ? co + ' — ' : ''}${open.clock_in}–${t} (${diff}m)${stopped ? `, stopped ${stopped} running item${stopped === 1 ? '' : 's'}` : ''}`);
  broadcastChange(Number(entry.rid), Number(entry.company_id));
  return { ok: true, id: Number(entry.rid), company: co, time: t, mins: diff };
}

// ── Toggle (the global hotkey / tray fallbacks) ─────────────────────────────
// Locked → open the app to sign in (the vault is encrypted; nothing can be
// written, and we never queue plaintext punches outside it). No task history →
// open the tracker so the first punch is made with a real label/name.
function togglePunch(): void {
  const st = getPunchState();
  if (st.state === 'locked') {
    deps!.showMainWindow();
    announce('Sign in to punch.', 'Unlock your session, then punch from the tray or hotkey.', 'info');
    return;
  }
  if (st.state === 'in') { punchOut(); return; }
  const res = punchIn();
  if (res && res.noHistory) {
    deps!.showMainWindow();
    const win = deps!.getMainWindow();
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('toast', { msg: 'No previous task to repeat — clock in from the tracker first.', type: 'info' }); } catch {}
    }
  }
}

module.exports = { initPunch, findActiveEntry, getPunchState, punchIn, punchOut, togglePunch };
