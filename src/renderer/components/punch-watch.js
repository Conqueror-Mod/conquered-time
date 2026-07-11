'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  punch-watch.js — proactive forgotten-punch detection.
//
//  Injected by Shell.init() on every inner page (like pomodoro.js), so the idle
//  nudge works regardless of which page is open. Catches a running punch left
//  open when the user walks away — BEFORE it becomes an audit discrepancy —
//  with a gentle "still clocked in?" prompt that offers to trim or close it.
//
//  Design constraints (confirmed decisions — do not change casually):
//  • Opt-in: OFF by default (ui_idlePunchMinutes = 0). Independent of Auto-Lock,
//    so it works even when auto-lock is disabled.
//  • Prompt-to-punch only: the three actions (trim / clock out now / keep going)
//    each require an explicit click. The watcher NEVER closes a punch on its own.
//  • Runs only against an OPEN punch (entries:get-active → a clocked-in, not-out
//    row). No open punch → silent.
//  • Idle is measured from renderer activity (same events shell.js listens for).
//    Walking away from the app = no activity = idle; that's exactly the signal.
//  • Cross-page close reuses entries:get-active + entries:save (no new IPC): the
//    tracker's own in-memory rowsData is bypassed, so if the tracker page is up
//    we reload it afterward to reflect the change.
// ════════════════════════════════════════════════════════════════════════════

const PunchWatch = (() => {
  /** How often we re-check idle-vs-threshold (ms). */
  const TICK_MS = 30000;
  /** Sticky alert toasts stay up this long (ms) — they carry action buttons. */
  const ALERT_MS = 30000;

  let lastActivityMs = Date.now();
  /** True once we've alerted for the current idle spell; re-armed on next activity. */
  let alerted = false;
  /** @type {ReturnType<typeof setInterval>|null} */ let tickInt = null;

  function thresholdMs() {
    const mins = (typeof Settings !== 'undefined') ? Number(Settings.get('idlePunchMinutes')) : 0;
    return (mins > 0) ? mins * 60000 : 0;
  }
  function enabled() { return thresholdMs() > 0; }

  // ── Time helpers (storage is always 24h HH:MM — gotcha #8) ────────────────
  function hhmm(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function diffMins(inT, outT) {
    const [ih, im] = inT.split(':').map(Number);
    const [oh, om] = outT.split(':').map(Number);
    let diff = (oh * 60 + om) - (ih * 60 + im);
    if (diff < 0) diff += 1440; // crossed midnight
    return diff;
  }

  // ── Open-punch check ──────────────────────────────────────────────────────
  async function getOpenPunch() {
    try {
      const entry = await api.invoke('entries:get-active');
      if (!entry) return null;
      const rows = JSON.parse(entry.rows_json || '[]');
      const open = rows.find(r => r.clock_in && !r.clock_out);
      return open ? { entry, rows, open } : null;
    } catch (e) {
      // A decrypt/IPC failure here looks identical to "no open punch" — log it
      // so a silently-stopped watcher is diagnosable.
      console.warn('[punch-watch] getOpenPunch failed:', e);
      return null;
    }
  }

  // ── Activity tracking ─────────────────────────────────────────────────────
  function onActivity() {
    lastActivityMs = Date.now();
    alerted = false; // a new idle spell can nudge again
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function init() {
    lastActivityMs = Date.now();
    alerted = false;
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
      document.addEventListener(evt, onActivity, { passive: true })
    );
    if (tickInt) clearInterval(tickInt);
    tickInt = setInterval(tick, TICK_MS);
  }

  async function tick() {
    if (!enabled() || alerted) return;
    const idle = Date.now() - lastActivityMs;
    if (idle < thresholdMs()) return;
    const punch = await getOpenPunch();
    if (!punch) return;
    // Alert only once per idle spell; freeze the trim time at when idle began.
    alerted = true;
    fireAlert(lastActivityMs);
  }

  // ── The prompt ────────────────────────────────────────────────────────────
  function fireAlert(idleStartMs) {
    const mins = Math.round((Date.now() - idleStartMs) / 60000);
    const trimLabel = `⏮ Clock out at ${trimDisplay(idleStartMs)}`;
    actionToast(
      `Still clocked in? No activity for about ${mins} minute${mins === 1 ? '' : 's'}.`,
      [
        { label: trimLabel, fn: () => { void clockOutActive(idleStartMs); }, primary: true },
        { label: 'Clock out now', fn: () => { void clockOutActive(Date.now()); } },
        { label: 'Still working', fn: () => { onActivity(); } },
      ]
    );
    osNotifyIfHidden('Conquered Time — still clocked in?',
      `No activity for ${mins} minute${mins === 1 ? '' : 's'}. Trim or close your open punch.`);
  }

  // Show the trim time in the user's chosen 12h/24h display format.
  function trimDisplay(ms) {
    const raw = hhmm(ms);
    return (typeof Settings !== 'undefined') ? Settings.formatTime(raw) : raw;
  }

  // ── Close the open punch (never automatic) ────────────────────────────────
  async function clockOutActive(atMs) {
    // On the Time Tracker the page owns the in-memory rows AND runs its own
    // autosave timer. If we saved independently via entries:save, that timer
    // could fire in between with the stale (still-open) rows and blind-overwrite
    // us — silently reopening the punch. So route through the tracker's own
    // clockOut(), which mutates rowsData and saves on one consistent path.
    const trackerHook = window.__trackerClockOutActive;
    if (typeof trackerHook === 'function') {
      if (trackerHook(atMs)) { Shell.toast(`Clocked out at ${trimDisplay(atMs)}.`, 'success'); return; }
      // Hook reports no open punch on this page — fall through to the generic
      // path (the open punch belongs to an entry this page isn't showing).
    }

    // Off the tracker there's no competing writer, so a direct save is safe.
    const punch = await getOpenPunch();
    if (!punch) {
      Shell.toast('That punch is already closed.', 'info');
      return;
    }
    const { entry, rows, open } = punch;
    const outT = hhmm(atMs);
    open.clock_out = outT;
    open.total_mins = (open.total_mins || 0) + diffMins(open.clock_in, outT);
    const total = rows.reduce((s, r) => s + (Number(r.total_mins) || 0), 0);
    try {
      const res = await api.invoke('entries:save', {
        id: entry.id,
        company_id: entry.company_id,
        log_date: entry.log_date,
        session_label: entry.session_label || '',
        rows_json: JSON.stringify(rows),
        total_mins: total,
        // Optimistic-concurrency token: reject rather than clobber if the row
        // changed since getOpenPunch() read it.
        updated_at: entry.updated_at,
      });
      if (res?.stale) Shell.toast('That session was updated elsewhere — reopen it to clock out.', 'warning');
      else if (res?.ok) Shell.toast(`Clocked out at ${trimDisplay(atMs)}.`, 'success');
      else Shell.toast('Clock-out failed: ' + (res?.error || 'unknown error'), 'error');
    } catch { Shell.toast('Clock-out failed.', 'error'); }
  }

  // ── Alert UI (sticky action toast; OS notify when hidden) ─────────────────
  // Reuses the .pomo-alert styling from the Pomodoro engine — a generic sticky
  // toast with an action-button row.
  /**
   * @param {string} msg
   * @param {Array<{label: string, fn: () => void, primary?: boolean}>} actions
   */
  function actionToast(msg, actions) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast warning pomo-alert';
    const text = document.createElement('div');
    text.textContent = msg;
    el.appendChild(text);
    const row = document.createElement('div');
    row.className = 'pomo-alert-btns';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-primary' : 'btn-neutral';
      b.textContent = a.label;
      b.addEventListener('click', () => { el.remove(); a.fn(); });
      row.appendChild(b);
    });
    el.appendChild(row);
    container.appendChild(el);
    setTimeout(() => el.remove(), ALERT_MS);
  }

  /** @param {string} title @param {string} body */
  function osNotifyIfHidden(title, body) {
    if (document.visibilityState === 'visible') return;
    api.invoke('app:notify', { title, body }).catch(() => {});
  }

  return { init, enabled };
})();

window.PunchWatch = PunchWatch;
