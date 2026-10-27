'use strict';

// Scheduled-shift catch-up prompt (docs/PLAN-recurring-schedule.md).
// Injected by Shell.init() on every inner page. Lists saved-schedule shifts
// that have come due and aren't logged, lets the user untick days they didn't
// work, then logs the rest through entries:fill-schedule (which rebuilds the
// rows main-side and refuses future dates).
//
// - Unticked days are remembered (app_settings `schedule_dismissed`) so they
//   aren't offered again. "Not now" remembers nothing — asked again next time.
// - Sign-in prompting can be switched off from the prompt itself
//   (`ui_scheduleCatchupOff` = '1'); Insights can still open it any time.
// - Plain in-DOM modal — never window.confirm (gotcha #10).
(function () {
  const DISMISS_KEY = 'schedule_dismissed';
  const OPTOUT_KEY = 'ui_scheduleCatchupOff';
  const DISMISS_KEEP_DAYS = 60;

  const esc = v => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));
  const fmtClock = t => (typeof Settings !== 'undefined' && Settings.formatTime ? Settings.formatTime(t) : t);
  const fmtH = m => (m / 60).toFixed(1) + 'h';
  const fmtDay = d => Schedule.parseLocalDate(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  async function readDismissed() {
    try { const v = JSON.parse((await api.invoke('settings:get', DISMISS_KEY)) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }

  async function loadDue() {
    const [companies, sessions, dismissed] = await Promise.all([
      Store.getCompanies(), Store.getEntriesSummary(), readDismissed(),
    ]);
    return { companies, dismissed, due: Schedule.dueShifts(companies, sessions, { dismissed }) };
  }

  async function check() {
    if (typeof Schedule === 'undefined') return;
    try {
      if ((await api.invoke('settings:get', OPTOUT_KEY)) === '1') return;
      const state = await loadDue();
      if (state.due.length) await show(state);
    } catch { /* never block sign-in on this */ }
  }

  async function open() {
    const state = await loadDue();
    if (!state.due.length) { Shell.toast('No scheduled shifts waiting to be logged.', 'info'); return 0; }
    return show(state);
  }

  function show({ companies, dismissed, due }) {
    return new Promise(async resolve => {
      const optOut = (await api.invoke('settings:get', OPTOUT_KEY).catch(() => null)) === '1';
      const coName = id => (companies.find(c => Number(c.id) === id) || {}).name || `#${id}`;
      const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      const overlay = document.createElement('div');
      overlay.className = 'ct-confirm-overlay';
      overlay.setAttribute('style',
        'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);');
      const rows = due.map((d, i) => {
        const times = d.slots.map(s => `${esc(fmtClock(s.start))} – ${esc(fmtClock(s.end))}`).join(', ');
        return `<label style="display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border);cursor:pointer;flex-shrink:0;">
            <input type="checkbox" data-i="${i}" checked>
            <span style="flex:0 0 96px;color:var(--text-bright);font-size:13px;">${esc(fmtDay(d.date))}</span>
            <span style="flex:1;min-width:0;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(coName(d.companyId))}</span>
            <span style="font-family:var(--mono);font-size:12px;color:var(--text-muted);white-space:nowrap;">${times}</span>
            <span style="font-family:var(--mono);font-size:12px;color:var(--text-dim);min-width:38px;text-align:right;">${fmtH(d.mins)}</span>
          </label>`;
      }).join('');
      overlay.innerHTML = `
        <div class="ct-confirm-card" role="dialog" aria-modal="true" aria-labelledby="sc-title"
             style="max-width:560px;width:92%;background:var(--surface-1);border:1px solid var(--border);
             border-radius:12px;padding:22px 24px;box-shadow:var(--shadow-3);font-family:var(--sans);">
          <div id="sc-title" style="font-size:16px;font-weight:700;color:var(--text-bright);margin-bottom:6px;"></div>
          <div style="font-size:13px;line-height:1.5;color:var(--text-muted);margin-bottom:12px;">
            From your saved schedule. Untick any day you didn't work — it won't be offered again.</div>
          <div style="display:flex;flex-direction:column;max-height:300px;overflow-y:auto;margin-bottom:14px;">${rows}</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:16px;cursor:pointer;">
            <input type="checkbox" id="sc-ask" ${optOut ? '' : 'checked'}> Ask me when I sign in</label>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="dba-confirm-btn" data-sc="later">Not now</button>
            <button class="dba-confirm-btn" data-sc="ok" style="border-color:var(--accent);color:var(--accent);"></button>
          </div>
        </div>`;

      const title = overlay.querySelector('#sc-title');
      const okBtn = /** @type {HTMLButtonElement} */ (overlay.querySelector('[data-sc="ok"]'));
      const boxes = () => Array.from(overlay.querySelectorAll('input[data-i]'));
      const refresh = () => {
        const n = boxes().filter(b => /** @type {HTMLInputElement} */ (b).checked).length;
        title.textContent = `${due.length} scheduled shift${due.length === 1 ? '' : 's'} not logged yet`;
        okBtn.textContent = n ? `Log ${n} shift${n === 1 ? '' : 's'}` : 'Skip these days';
      };
      refresh();
      overlay.addEventListener('change', e => { if (e.target instanceof HTMLInputElement && e.target.dataset.i) refresh(); });

      let busy = false;
      const close = value => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try { prevFocus && prevFocus.focus(); } catch {}
        resolve(value);
      };
      const saveOptOut = () => {
        const ask = /** @type {HTMLInputElement} */ (overlay.querySelector('#sc-ask')).checked;
        if (ask === optOut) api.invoke('settings:set', { key: OPTOUT_KEY, value: ask ? '0' : '1' });
      };
      const onKey = e => { if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); saveOptOut(); close(0); } };

      overlay.addEventListener('click', async e => {
        const b = e.target instanceof Element ? e.target.closest('[data-sc]') : null;
        if (!b || busy) return;
        saveOptOut();
        if (b.getAttribute('data-sc') === 'later') { close(0); return; }
        busy = true; okBtn.disabled = true;
        const picked = [], skipped = [];
        boxes().forEach(el => {
          const inp = /** @type {HTMLInputElement} */ (el);
          (inp.checked ? picked : skipped).push(due[Number(inp.dataset.i)]);
        });
        let created = 0;
        try {
          if (skipped.length) {
            const cutoff = Schedule.addDays(Schedule.dateStr(new Date()), -DISMISS_KEEP_DAYS);
            const keep = dismissed.filter(k => String(k).split('|')[1] >= cutoff);
            const next = Array.from(new Set(keep.concat(skipped.map(d => `${d.companyId}|${d.date}`))));
            await api.invoke('settings:set', { key: DISMISS_KEY, value: JSON.stringify(next) });
          }
          if (picked.length) {
            const res = await api.invoke('entries:fill-schedule', { items: picked.map(d => ({ companyId: d.companyId, date: d.date })) });
            if (!res || !res.ok) throw new Error((res && res.error) || 'Could not log shifts.');
            created = res.created || 0;
            Store.invalidate('entries');
            Shell.toast(`Logged ${created} scheduled shift${created === 1 ? '' : 's'}.`, 'success');
          }
        } catch (err) {
          Shell.toast(err.message || 'Could not log shifts.', 'error');
        }
        close(created);
      });

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      okBtn.focus();
    });
  }

  window.ScheduleCatchup = { check, open };
})();
