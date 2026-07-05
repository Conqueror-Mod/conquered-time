'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  pomodoro.js — Pomodoro cycle engine (PR 3 of the tooltips/pomodoro/
//  onboarding plan; see docs/PLAN-pomodoro-tooltips-onboarding.md).
//
//  Injected by Shell.init() on every inner page (like store.js), so the sidebar
//  chip and break alerts work regardless of which page is open. Active only
//  when the profile's break_style is 'pomodoro' (audit:get-policy.breakStyle) —
//  otherwise init() clears any leftover state and renders nothing.
//
//  Design constraints (confirmed decisions — do not change casually):
//  • Warnings-only: this engine paces the LIVE rhythm. The audit engine and
//    lunch compliance stay on the state policy.
//  • Prompt-to-punch: break alerts offer a one-click punch that writes a real
//    break task_item on the active session. The engine NEVER auto-punches.
//  • State lives in sessionStorage (ct_pomo) because navigation is full
//    loadFile() reloads — same pattern as the Dispatch task timer.
//  • Runs only against an open punch (clocked in, not out); Start is blocked
//    otherwise, and a clock-out discovered on page init stops the engine.
// ════════════════════════════════════════════════════════════════════════════

const Pomodoro = (() => {
  const KEY = 'ct_pomo';
  /** Sticky alert toasts stay up this long (ms) — they carry action buttons. */
  const ALERT_MS = 20000;

  /**
   * @typedef {Object} PomoState
   * @property {boolean} running
   * @property {'focus'|'break'|'long'} phase
   * @property {number} phaseStartMs
   * @property {number|null} pausedRemainMs  non-null while paused
   * @property {number} cycle                completed focus blocks
   * @property {number|null} breakTaskId     task_items rowid of the punched break
   * @property {number|null} breakTaskStartMs
   */

  /** @type {AuditPolicy|null} */ let policy = null;
  /** @type {PomoState|null} */   let state = null;
  /** @type {ReturnType<typeof setInterval>|null} */ let tickInt = null;

  // ── State persistence ─────────────────────────────────────────────────────
  function load() {
    try { state = JSON.parse(sessionStorage.getItem(KEY) || 'null'); }
    catch { state = null; }
  }
  function save() {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
  }

  // ── Cadence helpers ───────────────────────────────────────────────────────
  /** @returns {PomodoroPresetInfo} */
  function preset() {
    return policy?.pomodoro
      || { label: 'Classic 25/5', focusMins: 25, breakMins: 5, longBreakMins: 15, cyclesPerLong: 4 };
  }
  /** @param {'focus'|'break'|'long'} phase */
  function phaseDurMs(phase) {
    const p = preset();
    const mins = phase === 'focus' ? p.focusMins
      : phase === 'long' ? (p.longBreakMins || p.breakMins)
      : p.breakMins;
    return mins * 60000;
  }
  function remainMs() {
    if (!state) return 0;
    if (state.pausedRemainMs != null) return state.pausedRemainMs;
    return phaseDurMs(state.phase) - (Date.now() - state.phaseStartMs);
  }
  function enabled() { return policy?.breakStyle === 'pomodoro'; }

  // ── Open-punch check (engine only paces an active session) ───────────────
  async function hasOpenPunch() {
    try {
      const entry = await api.invoke('entries:get-active');
      if (!entry) return false;
      const rows = JSON.parse(entry.rows_json || '[]');
      return !!rows.find(r => r.clock_in && !r.clock_out);
    } catch { return false; }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  async function init() {
    try { policy = await api.invoke('audit:get-policy'); } catch { policy = null; }
    if (!enabled()) { sessionStorage.removeItem(KEY); state = null; renderAll(); return; }
    load();
    if (state && !(await hasOpenPunch())) { state = null; save(); }
    if (state) startTick();
    renderAll();
  }

  async function start() {
    if (!enabled()) return;
    if (!(await hasOpenPunch())) {
      Shell.toast('Clock in from the Time Tracker first — Pomodoro paces an active session.', 'warning');
      return;
    }
    if (state && state.pausedRemainMs != null) {
      // Resume: rebase phaseStartMs so remainMs() picks up where we paused.
      state.phaseStartMs = Date.now() - (phaseDurMs(state.phase) - state.pausedRemainMs);
      state.pausedRemainMs = null;
      state.running = true;
    } else {
      state = { running: true, phase: 'focus', phaseStartMs: Date.now(),
                pausedRemainMs: null, cycle: 0, breakTaskId: null, breakTaskStartMs: null };
    }
    save(); startTick(); renderAll();
  }

  function pause() {
    if (!state || !state.running) return;
    state.pausedRemainMs = Math.max(0, remainMs());
    state.running = false;
    save(); renderAll();
  }

  function stop() {
    state = null; save();
    stopTick(); renderAll();
  }

  function skipPhase() {
    if (!state) return;
    transition(true);
  }

  function startTick() {
    if (tickInt) return;
    tickInt = setInterval(tick, 1000);
    tick();
  }
  function stopTick() { if (tickInt) clearInterval(tickInt); tickInt = null; }

  function tick() {
    if (!state) { stopTick(); return; }
    if (state.running && remainMs() <= 0) transition(false);
    renderAll();
  }

  /** @param {boolean} skipped user-initiated skip → no alert */
  function transition(skipped) {
    if (!state) return;
    const p = preset();
    if (state.phase === 'focus') {
      state.cycle += 1;
      const isLong = !!(p.cyclesPerLong && p.longBreakMins && state.cycle % p.cyclesPerLong === 0);
      state.phase = isLong ? 'long' : 'break';
      state.phaseStartMs = Date.now();
      state.pausedRemainMs = null;
      save();
      if (!skipped) alertBreakStart(isLong);
    } else {
      const hadPunch = state.breakTaskId != null;
      state.phase = 'focus';
      state.phaseStartMs = Date.now();
      state.pausedRemainMs = null;
      save();
      if (!skipped) alertBreakOver(hadPunch);
    }
    renderAll();
  }

  // ── Prompt-to-punch (never automatic) ────────────────────────────────────
  async function punchBreak() {
    if (!state) return;
    try {
      const entry = await api.invoke('entries:get-active');
      if (!entry) { Shell.toast('No active session to punch a break on.', 'warning'); return; }
      const startedAt = Date.now();
      const res = await api.invoke('tasks:save', {
        entry_id: entry.id, label: 'Break', item_type: 'break',
        started_at: startedAt, duration_secs: 0,
      });
      if (res?.ok) {
        state.breakTaskId = res.id ?? null;
        state.breakTaskStartMs = startedAt;
        save();
        Shell.toast('Break punched in.', 'success');
      } else {
        Shell.toast('Break punch failed: ' + (res?.error || 'unknown error'), 'error');
      }
    } catch { Shell.toast('Break punch failed.', 'error'); }
  }

  async function endPunchedBreak() {
    if (!state || state.breakTaskId == null) return;
    const durationSecs = state.breakTaskStartMs
      ? Math.max(0, Math.floor((Date.now() - state.breakTaskStartMs) / 1000)) : 0;
    try {
      const res = await api.invoke('tasks:save', {
        id: state.breakTaskId, label: 'Break', item_type: 'break',
        stopped_at: Date.now(), duration_secs: durationSecs,
      });
      if (res?.ok) Shell.toast('Break punched out.', 'success');
    } catch {}
    state.breakTaskId = null;
    state.breakTaskStartMs = null;
    save();
  }

  // ── Alerts ────────────────────────────────────────────────────────────────
  // In-app: a sticky toast with action buttons. When the window is hidden
  // (minimized / close-to-tray), ALSO fire a Windows notification via main —
  // clicking it restores the window, where the action toast is still up.
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

  /** @param {boolean} isLong */
  function alertBreakStart(isLong) {
    const p = preset();
    const mins = isLong ? (p.longBreakMins || p.breakMins) : p.breakMins;
    const label = isLong ? 'long break' : 'break';
    actionToast(`Focus block done — time for a ${mins}-minute ${label}.`, [
      { label: '☕ Start Break (punch)', fn: () => { void punchBreak(); }, primary: true },
      { label: 'Skip', fn: () => skipPhase() },
    ]);
    osNotifyIfHidden('Pomodoro — break time', `Focus block done. Take a ${mins}-minute ${label}.`);
  }

  /** @param {boolean} hadPunch */
  function alertBreakOver(hadPunch) {
    const actions = hadPunch
      ? [{ label: '✓ End Break (punch out)', fn: () => { void endPunchedBreak(); }, primary: true }]
      : [];
    actionToast('Break over — back to focus.', actions);
    osNotifyIfHidden('Pomodoro — focus time', 'Break over. Next focus block has started.');
  }

  // ── Rendering (sidebar chip on every page; full panel on Dispatch) ───────
  function fmtRemain(ms) {
    const secs = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function phaseLabel() {
    if (!state) return '';
    return state.phase === 'focus' ? 'Focus' : state.phase === 'long' ? 'Long Break' : 'Break';
  }

  function renderAll() {
    renderSidebarChip();
    renderPanel();
  }

  function renderSidebarChip() {
    const wrap = document.getElementById('sidebar-pomo');
    if (!wrap) return;
    if (!enabled() || !state) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const phaseEl = document.getElementById('sidebar-pomo-phase');
    const timeEl  = document.getElementById('sidebar-pomo-time');
    if (phaseEl) phaseEl.textContent = state.pausedRemainMs != null ? `${phaseLabel()} ⏸` : phaseLabel();
    if (timeEl)  timeEl.textContent  = fmtRemain(remainMs());
  }

  // The Dispatch page renders the full cycle display — these ids only exist there.
  function renderPanel() {
    const panel = document.getElementById('pomo-panel');
    if (!panel) return;
    panel.style.display = enabled() ? '' : 'none';
    if (!enabled()) return;

    const phaseEl  = document.getElementById('pomo-phase');
    const timeEl   = document.getElementById('pomo-countdown');
    const cyclesEl = document.getElementById('pomo-cycles');
    const btnStart = document.getElementById('pomo-start');
    const btnPause = document.getElementById('pomo-pause');
    const btnSkip  = document.getElementById('pomo-skip');
    const btnStop  = document.getElementById('pomo-stop');
    const hintEl   = document.getElementById('pomo-hint');
    const p = preset();

    if (!state) {
      if (phaseEl)  phaseEl.textContent  = 'Idle';
      if (timeEl)   timeEl.textContent   = fmtRemain(p.focusMins * 60000);
      if (cyclesEl) cyclesEl.textContent = p.label;
      if (hintEl)   hintEl.textContent   = 'Start a cycle while clocked in — you’ll be nudged when it’s break time.';
      if (btnStart) { btnStart.style.display = ''; btnStart.textContent = '▶ Start'; }
      if (btnPause) btnPause.style.display = 'none';
      if (btnSkip)  btnSkip.style.display  = 'none';
      if (btnStop)  btnStop.style.display  = 'none';
      return;
    }
    const paused = state.pausedRemainMs != null;
    if (phaseEl)  phaseEl.textContent = paused ? `${phaseLabel()} (paused)` : phaseLabel();
    if (timeEl)   timeEl.textContent  = fmtRemain(remainMs());
    if (cyclesEl) {
      if (p.cyclesPerLong) {
        const done = state.cycle % p.cyclesPerLong;
        const shown = (done === 0 && state.cycle > 0 && state.phase !== 'focus') ? p.cyclesPerLong : done;
        cyclesEl.textContent = '●'.repeat(shown) + '○'.repeat(Math.max(0, p.cyclesPerLong - shown))
          + `  ·  ${p.label}`;
      } else {
        cyclesEl.textContent = `Cycle ${state.cycle + (state.phase === 'focus' ? 1 : 0)}  ·  ${p.label}`;
      }
    }
    if (hintEl) hintEl.textContent = state.phase === 'focus'
      ? 'Break alerts offer a one-click punch — nothing is logged automatically.'
      : 'On a Pomodoro break. Punch it in the Time Tracker (or the alert) to log it.';
    if (btnStart) { btnStart.style.display = paused ? '' : 'none'; btnStart.textContent = '▶ Resume'; }
    if (btnPause) btnPause.style.display = paused ? 'none' : '';
    if (btnSkip)  btnSkip.style.display  = '';
    if (btnStop)  btnStop.style.display  = '';
  }

  return { init, start, pause, stop, skipPhase, enabled };
})();

window.Pomodoro = Pomodoro;
