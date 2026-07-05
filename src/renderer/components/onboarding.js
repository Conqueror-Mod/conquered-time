'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  onboarding.js — first-time-user coach-mark tour (PR 4 of the tooltips/
//  pomodoro/onboarding plan; see docs/PLAN-pomodoro-tooltips-onboarding.md).
//
//  Injected by Shell.init() on every inner page (like pomodoro.js). A tour is a
//  step list keyed by PAGE: because navigation is full loadFile() reloads, the
//  engine persists the current step in sessionStorage (ct_tour) and resumes on
//  the next page's init(). Steps with selector(s) get a spotlight cutout +
//  anchored card; steps without get a centered card over a full dim.
//
//  v2 (beta round 2):
//  • sel may be an ARRAY — the spotlight is the union of all visible targets.
//  • The spotlight FOLLOWS layout shifts for a few seconds after render (the
//    email-required banner appears after the first measure and pushed the
//    profile fields down, leaving the cutout stranded on first view).
//  • enter/leave step hooks (force-show the Pomodoro preset picker on the
//    profile step; switch Reports tabs; inject demo data).
//  • Display-only EXAMPLE DATA on tracker/Dispatch/Reports/Global Log steps,
//    injected into the live page ONLY when the vault has no real data. It is
//    pure DOM — nothing is written to the database, and the full page reload
//    on every navigation wipes it automatically. Each injection carries an
//    "Example data" pill so it can't be mistaken for the user's own records.
//
//  Trigger/sequencing (owned by shell.js): auto-starts once per profile on
//  first login (ui_onboardingDone flag) and replaces the audit login-notice
//  that login. Re-runnable from Settings → About via Onboarding.replay().
// ════════════════════════════════════════════════════════════════════════════

const Onboarding = (() => {
  const KEY = 'ct_tour';
  /** How long the spotlight keeps re-measuring its target after render (ms). */
  const FOLLOW_MS = 3000;
  const FOLLOW_TICK = 250;

  /**
   * @typedef {Object} TourStep
   * @property {string} page           inner-page name (navigate target)
   * @property {string|string[]|null} sel  CSS selector(s) to spotlight (null = centered)
   * @property {string} title
   * @property {string} body           developer-authored copy; may contain <strong>
   * @property {(() => void)=} enter   runs when the step renders on its page
   * @property {(() => void)=} leave   runs before a SAME-PAGE step change (navigation resets pages anyway)
   */

  /** @type {TourStep[]} */
  const STEPS = [
    { page: 'dashboard', sel: null,
      title: 'Welcome to Conquered Time',
      body: 'Everything you track here is encrypted on this device with AES-256-GCM and never leaves it. This quick tour walks you through your first setup.' },
    { page: 'profile', sel: ['#field-work-state', '#field-break-style', '#pomodoro-preset-group', '#field-email'],
      title: 'Set your Work State & Break Style',
      body: 'Your Work state sets the break and lunch rules the tracker warnings and audits check against. Prefer structured focus cycles instead? Switch Break Style to Pomodoro and pick a preset. While you’re here, add your email address too — <strong>reports and audit notifications need it</strong>, and you’ll be reminded before you can move on without one.',
      enter: profileStepEnter, leave: profileStepLeave },
    { page: 'companies', sel: '#btn-add-company',
      title: 'Add your first company',
      body: 'Companies are who you work for — each holds its own projects, platforms, and hours. Add one here; the web view around it grows as you log time.' },
    { page: 'tracker', sel: '.clock-module',
      title: 'Clock in to work',
      body: 'Pick a company and date, give the work a Task Label and Task Name, then Clock In. Breaks and lunches are punched here too, and every action autosaves. The table below shows what a logged session looks like.',
      enter: () => { void demoTracker(); } },
    { page: 'task-timer', sel: '.tt-input-panel',
      title: 'Time tasks with Dispatch',
      body: 'While clocked in, Dispatch times individual tasks and writes what you did back into the session’s Description. If you chose Pomodoro, your focus/break cycle runs here as well — this is what a live session looks like.',
      enter: () => { void demoDispatch(); } },
    { page: 'reports', sel: '.tab-bar',
      title: 'Reports — Period Summary',
      body: 'Pick a date range and company to see total hours, daily bars, and a task-label breakdown for the period.',
      enter: () => { switchReportsTab('period'); void demoReportsPeriod(); } },
    { page: 'reports', sel: '.tab-bar',
      title: 'Reports — Company Breakdown',
      body: 'Every company gets a card: total hours, session count, last active date, and where the time went by task label.',
      enter: () => { switchReportsTab('company'); void demoReportsCompany(); } },
    { page: 'reports', sel: '.tab-bar',
      title: 'Reports — Audit Log',
      body: 'The audit checks every punch for problems — missing clock-outs, skipped breaks, duration drift — and suggests fixes. Nothing is ever changed without your explicit confirmation.',
      enter: () => { switchReportsTab('audit'); void demoReportsAudit(); } },
    { page: 'global-log', sel: null,
      title: 'Review & export',
      body: 'The Global Log is your full history across companies — filter it, expand a session for its punches, export CSV or PDF, or jump back into any session with Open.',
      enter: () => { void demoGlobalLog(); } },
    { page: 'dashboard', sel: null,
      title: 'You’re all set',
      body: 'Hover any control for a hint — tooltips are everywhere. Settings is Ctrl+, whenever you need it, and you can replay this guide from Settings → About.' },
  ];

  let escBound = false;
  /** Index of the step currently rendered ON THIS PAGE (for leave hooks). */
  let renderedIdx = /** @type {number|null} */ (null);
  let followTimer = /** @type {ReturnType<typeof setInterval>|null} */ (null);

  // ── Step persistence ──────────────────────────────────────────────────────
  function activeStep() {
    const raw = sessionStorage.getItem(KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : null;
  }
  function currentPage() {
    return (location.pathname.split('/').pop() || '').replace('.html', '');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /** Resume an in-flight tour after a page load (no-op otherwise). */
  function init() {
    const idx = activeStep();
    if (idx == null) return;
    showStep(idx);
  }

  /** Start (or restart) the tour from the first step. */
  function begin() {
    sessionStorage.setItem(KEY, '0');
    showStep(0);
  }

  /** Settings → About replay: close the settings modal, then start over. */
  function replay() {
    document.getElementById('settings-modal')?.classList.remove('open');
    begin();
  }

  /** @param {boolean} completed reached the end (vs. skipped) */
  async function finish(completed) {
    if (renderedIdx != null) STEPS[renderedIdx]?.leave?.();
    renderedIdx = null;
    sessionStorage.removeItem(KEY);
    teardown();
    try { await api.invoke('settings:set', { key: 'ui_onboardingDone', value: '1' }); } catch {}
    if (completed) Shell.toast('Setup guide complete — conquer your time.', 'success');
  }

  /** @param {number} idx */
  function showStep(idx) {
    const step = STEPS[idx];
    if (!step) { void finish(true); return; }
    // Same-page step change: run the outgoing step's leave hook. (Cross-page
    // changes reload everything, so leave hooks are same-page-only.)
    if (renderedIdx != null && renderedIdx !== idx) STEPS[renderedIdx]?.leave?.();
    sessionStorage.setItem(KEY, String(idx));
    if (currentPage() !== step.page) {
      renderedIdx = null;
      teardown();
      api.send('navigate', step.page);
      return;
    }
    renderedIdx = idx;
    step.enter?.();
    render(idx, step);
  }

  // ── Spotlight measurement ─────────────────────────────────────────────────
  // Union of all VISIBLE targets (0×0 rects — display:none ancestors — are
  // skipped; an all-hidden selector list degrades to the centered treatment).
  /** @param {string|string[]|null} sel @returns {DOMRect|null} */
  function measure(sel) {
    if (!sel) return null;
    const sels = Array.isArray(sel) ? sel : [sel];
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity, any = false;
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      any = true;
      L = Math.min(L, r.left); T = Math.min(T, r.top);
      R = Math.max(R, r.right); B = Math.max(B, r.bottom);
    }
    return any ? new DOMRect(L, T, R - L, B - T) : null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function teardown() {
    document.getElementById('ct-tour-overlay')?.remove();
    document.getElementById('ct-tour-spot')?.remove();
    document.getElementById('ct-tour-card')?.remove();
    window.removeEventListener('resize', onResize);
    if (followTimer) { clearInterval(followTimer); followTimer = null; }
  }
  function onResize() {
    const idx = activeStep();
    if (idx != null && renderedIdx === idx) render(idx, STEPS[idx]);
  }

  /** @param {number} idx @param {TourStep} step */
  function render(idx, step) {
    teardown();
    window.addEventListener('resize', onResize);

    let anchor = measure(step.sel);

    // Click-blocking backdrop. When there's a spotlight, the dim comes from the
    // spot's huge box-shadow instead, so the backdrop itself stays transparent.
    const overlay = document.createElement('div');
    overlay.id = 'ct-tour-overlay';
    if (!anchor) overlay.classList.add('dim');
    document.body.appendChild(overlay);

    /** @type {HTMLElement|null} */
    let spot = null;
    if (anchor) {
      spot = document.createElement('div');
      spot.id = 'ct-tour-spot';
      placeSpot(spot, anchor);
      document.body.appendChild(spot);
    }

    const card = document.createElement('div');
    card.id = 'ct-tour-card';

    const title = document.createElement('div');
    title.className = 'ct-tour-title';
    title.textContent = step.title;
    const body = document.createElement('div');
    body.className = 'ct-tour-body';
    // Step bodies are developer-authored constants above (never user data), so
    // limited inline markup (<strong>) is safe here.
    body.innerHTML = step.body;
    const dots = document.createElement('div');
    dots.className = 'ct-tour-dots';
    dots.textContent = STEPS.map((_, i) => (i === idx ? '●' : '○')).join(' ');

    const btns = document.createElement('div');
    btns.className = 'ct-tour-btns';
    const skip = document.createElement('button');
    skip.className = 'btn-neutral';
    skip.textContent = 'Skip tour';
    skip.addEventListener('click', () => { void finish(false); });
    btns.appendChild(skip);
    if (idx > 0) {
      const back = document.createElement('button');
      back.className = 'btn-neutral';
      back.textContent = '← Back';
      back.addEventListener('click', () => showStep(idx - 1));
      btns.appendChild(back);
    }
    const next = document.createElement('button');
    next.className = 'btn-primary';
    next.textContent = idx === STEPS.length - 1 ? 'Finish' : 'Next →';
    next.addEventListener('click', () => {
      if (idx === STEPS.length - 1) void finish(true);
      else showStep(idx + 1);
    });
    btns.appendChild(next);

    card.append(title, body, dots, btns);
    document.body.appendChild(card);
    placeCard(card, anchor);
    next.focus();

    // Follow layout shifts briefly: async content (email-required banner, data
    // loads, fonts) can move the target AFTER the first measure — the profile
    // step's stranded first-view spotlight was exactly this.
    const followUntil = Date.now() + FOLLOW_MS;
    followTimer = setInterval(() => {
      if (Date.now() > followUntil) { if (followTimer) clearInterval(followTimer); followTimer = null; return; }
      const fresh = measure(step.sel);
      if (!fresh || !anchor) return;
      if (Math.abs(fresh.left - anchor.left) > 2 || Math.abs(fresh.top - anchor.top) > 2 ||
          Math.abs(fresh.width - anchor.width) > 2 || Math.abs(fresh.height - anchor.height) > 2) {
        anchor = fresh;
        if (spot) placeSpot(spot, anchor);
        placeCard(card, anchor);
      }
    }, FOLLOW_TICK);

    if (!escBound) {
      escBound = true;
      // Escape skips the tour (only when a tour is actually up).
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && activeStep() != null && document.getElementById('ct-tour-card')) {
          void finish(false);
        }
      }, true);
    }
  }

  /** @param {HTMLElement} spot @param {DOMRect} r */
  function placeSpot(spot, r) {
    const PAD = 8;
    spot.style.left   = `${Math.round(r.left - PAD)}px`;
    spot.style.top    = `${Math.round(r.top - PAD)}px`;
    spot.style.width  = `${Math.round(r.width + PAD * 2)}px`;
    spot.style.height = `${Math.round(r.height + PAD * 2)}px`;
  }

  /**
   * Below the target when it fits, above otherwise; centered when no anchor.
   * @param {HTMLElement} card @param {DOMRect|null} anchor
   */
  function placeCard(card, anchor) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const EDGE = 12, GAP = 14;
    if (!anchor) {
      card.style.left = `${Math.round((vw - cw) / 2)}px`;
      card.style.top  = `${Math.round((vh - ch) / 2)}px`;
      return;
    }
    let x = anchor.left + anchor.width / 2 - cw / 2;
    let y = anchor.bottom + GAP;
    if (y + ch > vh - EDGE) y = anchor.top - ch - GAP;
    x = Math.max(EDGE, Math.min(x, vw - cw - EDGE));
    y = Math.max(EDGE, Math.min(y, vh - ch - EDGE));
    card.style.left = `${Math.round(x)}px`;
    card.style.top  = `${Math.round(y)}px`;
  }

  // ── Profile step hooks ────────────────────────────────────────────────────
  // The Pomodoro preset picker is normally hidden until Break Style is set to
  // Pomodoro (by design). During the tour we force it visible so the user sees
  // it exists, then restore the value-driven visibility on leave.
  function profileStepEnter() {
    // The page's own DOMContentLoaded continues AFTER this hook and re-syncs
    // the preset group's visibility from the Break Style value (hiding it
    // again) — so re-assert for a few seconds rather than setting it once.
    const until = Date.now() + FOLLOW_MS;
    const assert = () => {
      if (renderedIdx !== 1 || Date.now() > until) return;
      const pg = document.getElementById('pomodoro-preset-group');
      if (pg && pg.style.display === 'none') pg.style.display = '';
      setTimeout(assert, FOLLOW_TICK);
    };
    assert();
  }
  function profileStepLeave() {
    const pg = document.getElementById('pomodoro-preset-group');
    const bs = /** @type {HTMLSelectElement|null} */ (document.getElementById('field-break-style'));
    if (pg) pg.style.display = (bs && bs.value === 'pomodoro') ? '' : 'none';
  }

  // ── Reports tab switching ────────────────────────────────────────────────
  /** @param {string} tab */
  function switchReportsTab(tab) {
    const btn = /** @type {HTMLElement|null} */ (document.querySelector(`.tab-btn[data-tab="${tab}"]`));
    btn?.click();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  EXAMPLE DATA (display-only)
  //  Injected into the live page's containers ONLY while the tour is on that
  //  step AND the vault holds no real data of that kind — a replayed tour on a
  //  populated vault shows the user's real records instead. Never persisted:
  //  nothing below touches IPC mutation channels, and the full page reload on
  //  every step navigation discards the DOM. All values are clearly-fake
  //  placeholders (PPI discipline — see CLAUDE.md).
  // ══════════════════════════════════════════════════════════════════════════

  function demoPill() {
    return `<div class="ct-demo-pill" data-tour-demo="pill">Example data — for the tour only, nothing is saved</div>`;
  }
  function demoAlready(tag) {
    return !!document.querySelector(`[data-tour-demo="${tag}"]`);
  }
  async function vaultHasEntries() {
    try { return ((await api.invoke('entries:summary')) || []).length > 0; }
    catch { return true; } // fail closed: never overlay demo on possible real data
  }

  // The page's own async renders land AFTER the tour's enter hook and overwrite
  // injected demo content (Global Log's empty-state, Dispatch's no-session
  // reset, the reports chart redraw). So a demo isn't a one-shot write — it
  // re-asserts every few hundred ms for the settle window, re-applying whenever
  // its marker/end-state got clobbered. `stepIdx` stops it the moment the user
  // moves on within the same page.
  /** @param {number} stepIdx @param {() => boolean} broken @param {() => void} apply */
  function demoAssert(stepIdx, broken, apply) {
    const until = Date.now() + FOLLOW_MS;
    const tick = () => {
      if (renderedIdx !== stepIdx || activeStep() == null || Date.now() > until) return;
      try { if (broken()) apply(); } catch {}
      setTimeout(tick, 350);
    };
    tick();
  }

  async function demoTracker() {
    if (await vaultHasEntries()) return;
    demoAssert(3, () => !demoAlready('tracker'), () => {
      const tbody = document.getElementById('tbody');
      if (!tbody) return;
      const cell = (v, mono) => `<td style="${mono ? 'font-family:var(--mono);' : ''}color:var(--text-muted);">${v}</td>`;
      const dot = `<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);opacity:.6;"></span></td>`;
      tbody.insertAdjacentHTML('afterbegin',
        `<tr data-tour-demo="tracker"><td colspan="8" style="padding:6px 10px;">${demoPill()}</td></tr>
         <tr data-tour-demo="tracker">${cell('01', true)}${dot}${cell('Annotation')}${cell('Batch review — set A')}${cell('First pass, flagged 3 items')}${cell('9:15 AM', true)}${cell('11:40 AM', true)}${cell('2h 25m', true)}</tr>
         <tr data-tour-demo="tracker">${cell('02', true)}${dot}${cell('QA')}${cell('Spot-check set A')}${cell('Second pass on flagged items')}${cell('12:20 PM', true)}${cell('1:05 PM', true)}${cell('45m', true)}</tr>`);
    });
  }

  let dispatchTickStarted = false;
  async function demoDispatch() {
    try { if (await api.invoke('entries:get-active')) return; } catch { return; }

    const apply = () => {
      const banner = document.getElementById('session-banner');
      banner?.classList.remove('no-session');
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('banner-company', 'Example Co');
      // Local date inline — RowUtils isn't loaded on the Dispatch page.
      const d = new Date();
      set('banner-date', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      set('banner-clock-in', '9:15 AM');
      set('banner-duration', '2h 40m');
      const live = document.getElementById('live-badge');
      if (live) live.style.display = '';
      const noMsg = document.getElementById('no-session-msg');
      if (noMsg) noMsg.style.display = 'none';
      const main = document.getElementById('tt-main');
      if (main) { main.style.display = 'grid'; main.setAttribute('data-tour-demo', 'dispatch'); }

      const input = /** @type {HTMLInputElement|null} */ (document.getElementById('task-label-input'));
      if (input) input.value = 'Annotation — set B';
      const list = document.getElementById('task-list');
      if (list && !list.querySelector('.tt-task-row')) {
        const row = (n, label, dur) =>
          `<div class="tt-task-row"><span class="tt-task-num">#${n}</span><span class="tt-task-label">${label}</span><span class="tt-task-dur">${dur}</span></div>`;
        list.innerHTML = demoPill() + row(1, 'Review batch', '25m') + row(2, 'Annotation — set A', '41m') + row(3, 'QA spot-check', '18m');
      }
      set('counter-num', '3');
      const dp = document.getElementById('desc-preview');
      if (dp) dp.style.display = '';
      set('desc-preview-text', '[3 tasks] Annotation — set A, Review batch, QA spot-check');

      // Ticking stopwatch + live sidebar badges — real render surfaces, purely
      // visual state that the next navigation's fresh page discards. Ticker is
      // started once (re-asserts must not stack a second interval).
      const sw = document.getElementById('stopwatch');
      if (sw && !dispatchTickStarted) {
        dispatchTickStarted = true;
        sw.classList.add('running');
        let secs = 12 * 60 + 41;
        const tick = () => {
          if (!document.body.contains(sw)) return;
          secs += 1;
          sw.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
          setTimeout(tick, 1000);
        };
        tick();
      }
      try {
        Shell.showLiveBadge(Date.now() - 160 * 60000);
        Shell.showSidebarTimer(Date.now() - (12 * 60 + 41) * 1000);
      } catch {}
    };

    // Broken when the page's null-activeEntry render has re-hidden the demo.
    demoAssert(4, () => {
      const noMsg = document.getElementById('no-session-msg');
      const main  = document.getElementById('tt-main');
      return (noMsg ? noMsg.style.display !== 'none' : false)
        || (main ? main.style.display === 'none' : false)
        || !demoAlready('dispatch');
    }, apply);
  }

  async function demoReportsPeriod() {
    if (await vaultHasEntries()) return;
    demoAssert(5, () => {
      // The page's chart redraw replaces the SVG's CONTENT while the marker
      // attribute survives — detect the overwrite by bar count, not marker.
      const svg = document.getElementById('bar-svg');
      return !document.querySelector('#period-chips [data-tour-demo="rpt-chips"]')
        || !(svg && svg.querySelectorAll('rect').length >= 10)
        || !document.querySelector('#label-breakdown [data-tour-demo="rpt-period"]');
    }, () => {
      const chips = document.getElementById('period-chips');
      if (chips && !chips.querySelector('[data-tour-demo="rpt-chips"]')) {
        chips.innerHTML = `
          <div class="summary-chip" data-tour-demo="rpt-chips"><div class="chip-label">Total Hours</div><div class="chip-value">37.5h</div><div class="chip-sub">14 sessions (example)</div></div>
          <div class="summary-chip violet"><div class="chip-label">Avg / Day</div><div class="chip-value">2.7h</div><div class="chip-sub">over 14 days</div></div>
          <div class="summary-chip yellow"><div class="chip-label">Top Company</div><div class="chip-value" style="font-size:13px;line-height:1.5;">Example Co</div><div class="chip-sub">22.0h</div></div>
          <div class="summary-chip green"><div class="chip-label">Active Clients</div><div class="chip-value">2</div><div class="chip-sub">in period</div></div>`;
        chips.insertAdjacentHTML('beforebegin', `<div data-tour-demo="rpt-chips-pill">${demoPill()}</div>`);
      }
      const svg = document.getElementById('bar-svg');
      if (svg && svg.querySelectorAll('rect').length < 10) {
        const heights = [30, 55, 20, 70, 45, 0, 0, 60, 40, 75, 35, 50, 25, 65];
        let bars = '';
        for (let i = 0; i <= 4; i++) {
          const y = 100 - (i * 25);
          bars += `<line x1="40" y1="${y}" x2="390" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
        }
        heights.forEach((h, i) => {
          const x = 42 + i * 24;
          bars += `<rect x="${x}" y="${100 - h}" width="16" height="${Math.max(h, 1)}" rx="2" fill="var(--accent)" fill-opacity="${h ? 0.75 : 0}"/>`;
        });
        svg.setAttribute('viewBox', '0 0 400 112');
        svg.setAttribute('data-tour-demo', 'rpt-period');
        svg.innerHTML = bars;
      }
      const lb = document.getElementById('label-breakdown');
      if (lb && !lb.querySelector('[data-tour-demo="rpt-period"]')) {
        lb.insertAdjacentHTML('beforeend',
          `<div data-tour-demo="rpt-period" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;font-family:var(--sans);font-size:12px;color:var(--text-muted);">
             <div>Annotation — <span style="font-family:var(--mono);color:var(--text-bright);">18.5h</span></div>
             <div>Review — <span style="font-family:var(--mono);color:var(--text-bright);">11.0h</span></div>
             <div>QA — <span style="font-family:var(--mono);color:var(--text-bright);">8.0h</span></div>
           </div>`);
      }
    });
  }

  async function demoReportsCompany() {
    try { if (((await api.invoke('companies:list')) || []).length > 0) return; } catch { return; }
    demoAssert(6, () => !demoAlready('rpt-company'), () => {
    const cards = document.getElementById('company-cards');
    if (!cards) return;
    cards.innerHTML = `<div data-tour-demo="rpt-company" style="grid-column:1/-1;">${demoPill()}</div>
      <div class="company-card" data-tour-demo="rpt-company">
        <div><div class="cc-name">Example Co</div><div class="cc-hier">Example Co › Project Aurora › Platform X</div></div>
        <div class="cc-stats">
          <div class="cc-stat"><div class="cc-stat-val">22.0h</div><div class="cc-stat-lbl">Total</div></div>
          <div class="cc-stat"><div class="cc-stat-val">9</div><div class="cc-stat-lbl">Sessions</div></div>
          <div class="cc-stat"><div class="cc-stat-val" style="font-size:13px;">07-04</div><div class="cc-stat-lbl">Last Active</div></div>
        </div>
        <div class="cc-chips"><span class="cc-chip">Annotation <span>12.5h</span></span><span class="cc-chip">Review <span>6.5h</span></span><span class="cc-chip">QA <span>3.0h</span></span></div>
      </div>
      <div class="company-card" data-tour-demo="rpt-company">
        <div><div class="cc-name">Sample Client LLC</div><div class="cc-hier">Sample Client LLC › Localization</div></div>
        <div class="cc-stats">
          <div class="cc-stat"><div class="cc-stat-val">15.5h</div><div class="cc-stat-lbl">Total</div></div>
          <div class="cc-stat"><div class="cc-stat-val">5</div><div class="cc-stat-lbl">Sessions</div></div>
          <div class="cc-stat"><div class="cc-stat-val" style="font-size:13px;">07-02</div><div class="cc-stat-lbl">Last Active</div></div>
        </div>
        <div class="cc-chips"><span class="cc-chip">Translation <span>10.0h</span></span><span class="cc-chip">Review <span>5.5h</span></span></div>
      </div>`;
    });
  }

  async function demoReportsAudit() {
    if (await vaultHasEntries()) return;
    demoAssert(7, () => !demoAlready('rpt-audit'), () => {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    const label = document.getElementById('audit-count-label');
    if (label) label.textContent = '2 issues found (example)';
    const td = (v, mono) => `<td style="${mono ? 'font-family:var(--mono);' : ''}color:var(--text-muted);">${v}</td>`;
    const badge = (txt, color) => `<td><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-family:var(--sans);font-size:11px;border:1px solid ${color};color:${color};">${txt}</span></td>`;
    tbody.innerHTML = `
      <tr data-tour-demo="rpt-audit"><td colspan="9" style="padding:6px 10px;">${demoPill()}</td></tr>
      <tr data-tour-demo="rpt-audit">${td('2026-07-03', true)}${td('Example Co')}${td('Annotation')}${td('9:15 AM', true)}${td('—', true)}${td('—', true)}${badge('No clock-out', 'var(--red, #e5484d)')}<td style="font-style:italic;color:var(--text-dim);">Auto-set clock-out to clock-in + 8h.</td><td></td></tr>
      <tr data-tour-demo="rpt-audit">${td('2026-07-02', true)}${td('Example Co')}${td('(session)')}${td('—', true)}${td('—', true)}${td('8h 00m', true)}${badge('Break(s) missing', 'var(--yellow, #d4a030)')}<td style="font-style:italic;color:var(--text-dim);">Standard practice recommends a rest break for shifts over 3.5h.</td><td></td></tr>`;
    });
  }

  async function demoGlobalLog() {
    if (await vaultHasEntries()) return;
    demoAssert(8, () => !demoAlready('global-log'), () => {
    const tbody = document.getElementById('log-tbody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr data-tour-demo="global-log"><td colspan="6" style="padding:6px 10px;">${demoPill()}</td></tr>
      <tr data-tour-demo="global-log">
        <td><span class="expand-arrow">▶</span></td>
        <td class="log-company">Example Co</td>
        <td class="log-date">2026-07-04</td>
        <td class="log-session">Sprint #12 — Review batch</td>
        <td class="log-hours">3h 10m</td>
        <td class="log-actions"><button class="btn-xs" disabled>Open</button> <button class="btn-xs" disabled>PDF</button></td>
      </tr>`;
    const count = document.getElementById('row-count');
    if (count) count.textContent = 'Showing 1 session (example)';
    });
  }

  return { init, begin, replay };
})();

window.Onboarding = Onboarding;
