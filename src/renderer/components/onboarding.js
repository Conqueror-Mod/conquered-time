'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  onboarding.js — first-time-user coach-mark tour (PR 4 of the tooltips/
//  pomodoro/onboarding plan; see docs/PLAN-pomodoro-tooltips-onboarding.md).
//
//  Injected by Shell.init() on every inner page (like pomodoro.js). A tour is a
//  step list keyed by PAGE: because navigation is full loadFile() reloads, the
//  engine persists the current step in sessionStorage (ct_tour) and resumes on
//  the next page's init(). Steps with a selector get a spotlight cutout +
//  anchored card; steps without one get a centered card over a full dim.
//
//  Trigger/sequencing (owned by shell.js): auto-starts once per profile on
//  first login (ui_onboardingDone flag), AFTER the encryption notice and
//  INSTEAD of the audit login-notice that login. Re-runnable any time from
//  Settings → About ("Replay setup guide") via Onboarding.replay().
// ════════════════════════════════════════════════════════════════════════════

const Onboarding = (() => {
  const KEY = 'ct_tour';

  /**
   * @typedef {Object} TourStep
   * @property {string} page      inner-page name (navigate target)
   * @property {string|null} sel  CSS selector to spotlight (null = centered)
   * @property {string} title
   * @property {string} body
   */

  /** @type {TourStep[]} */
  const STEPS = [
    { page: 'dashboard', sel: null,
      title: 'Welcome to Conquered Time',
      body: 'Everything you track here is encrypted on this device with AES-256-GCM and never leaves it. This one-minute tour walks you through your first setup.' },
    { page: 'profile', sel: '#field-work-state',
      title: 'Set your Work State & Break Style',
      body: 'Your Work state sets the break and lunch rules the tracker warnings and audits check against. Prefer structured focus cycles instead? Switch Break Style to Pomodoro, right below it.' },
    { page: 'companies', sel: '#btn-add-company',
      title: 'Add your first company',
      body: 'Companies are who you work for — each holds its own projects, platforms, and hours. Add one here; the web view around it grows as you log time.' },
    { page: 'tracker', sel: '.clock-module',
      title: 'Clock in to work',
      body: 'Pick a company and date, give the work a Task Label and Task Name, then Clock In. Breaks and lunches are punched here too, and every action autosaves.' },
    { page: 'task-timer', sel: '.tt-input-panel',
      title: 'Time tasks with Dispatch',
      body: 'While clocked in, Dispatch times individual tasks and writes what you did back into the session’s Description. If you chose Pomodoro, your focus/break cycle runs here as well.' },
    { page: 'global-log', sel: null,
      title: 'Review & export',
      body: 'The Global Log is your full history across companies — filter it, expand a session for its punches, export CSV or PDF. The Reports page adds audits and scheduled email reports.' },
    { page: 'dashboard', sel: null,
      title: 'You’re all set',
      body: 'Hover any control for a hint — tooltips are everywhere. Settings is Ctrl+, whenever you need it, and you can replay this guide from Settings → About.' },
  ];

  let escBound = false;

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
    sessionStorage.removeItem(KEY);
    teardown();
    try { await api.invoke('settings:set', { key: 'ui_onboardingDone', value: '1' }); } catch {}
    if (completed) Shell.toast('Setup guide complete — conquer your time.', 'success');
  }

  /** @param {number} idx */
  function showStep(idx) {
    const step = STEPS[idx];
    if (!step) { void finish(true); return; }
    sessionStorage.setItem(KEY, String(idx));
    if (currentPage() !== step.page) {
      // Resume on the target page — its Shell.init() calls Onboarding.init().
      teardown();
      api.send('navigate', step.page);
      return;
    }
    render(idx, step);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function teardown() {
    document.getElementById('ct-tour-overlay')?.remove();
    document.getElementById('ct-tour-spot')?.remove();
    document.getElementById('ct-tour-card')?.remove();
    window.removeEventListener('resize', onResize);
  }
  function onResize() {
    const idx = activeStep();
    if (idx != null) render(idx, STEPS[idx]);
  }

  /** @param {number} idx @param {TourStep} step */
  function render(idx, step) {
    teardown();
    window.addEventListener('resize', onResize);

    const target = step.sel ? document.querySelector(step.sel) : null;

    // Click-blocking backdrop. When there's a spotlight, the dim comes from the
    // spot's huge box-shadow instead, so the backdrop itself stays transparent.
    const overlay = document.createElement('div');
    overlay.id = 'ct-tour-overlay';
    if (!target) overlay.classList.add('dim');
    document.body.appendChild(overlay);

    let anchor = null;
    if (target) {
      const r = target.getBoundingClientRect();
      const spot = document.createElement('div');
      spot.id = 'ct-tour-spot';
      const PAD = 8;
      spot.style.left   = `${Math.round(r.left - PAD)}px`;
      spot.style.top    = `${Math.round(r.top - PAD)}px`;
      spot.style.width  = `${Math.round(r.width + PAD * 2)}px`;
      spot.style.height = `${Math.round(r.height + PAD * 2)}px`;
      document.body.appendChild(spot);
      anchor = r;
    }

    const card = document.createElement('div');
    card.id = 'ct-tour-card';

    const title = document.createElement('div');
    title.className = 'ct-tour-title';
    title.textContent = step.title;
    const body = document.createElement('div');
    body.className = 'ct-tour-body';
    body.textContent = step.body;
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

  return { init, begin, replay };
})();

window.Onboarding = Onboarding;
