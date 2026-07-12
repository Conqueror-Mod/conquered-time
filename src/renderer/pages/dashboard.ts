'use strict';

// Dashboard page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, escapeHtml) — must load after ../components/shell.js.
//
// IIFE-wrapped (Phase 3 pattern): tsc compiles all renderer pages in one
// project as classic scripts sharing a global scope, so page-local helpers
// must not leak as globals.
(() => {

let companies: Company[] = [], allEntries: EntrySummary[] = [];
/** Week band paging: 0 = the current calendar week, -1 = last week, … */
let weekOffset = 0;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('dashboard');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  // overflow AUTO (not hidden): with the week band added, very short windows
  // scroll rather than crushing the network web (docs/PLAN-week-view.md).
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'auto'; }

  // Backup Now — page-specific action (the nav buttons use the shell's
  // delegated data-action="navigate" handler instead).
  document.getElementById('btn-backup-now')?.addEventListener('click', () => {
    api.invoke('settings:set', { key: 'backup_trigger', value: Date.now().toString() })
      .then(() => Shell.toast('Backup saved', 'success'));
  });

  document.getElementById('week-prev')?.addEventListener('click', () => { weekOffset--; renderWeekBand(); });
  document.getElementById('week-next')?.addEventListener('click', () => { weekOffset++; renderWeekBand(); });
  document.getElementById('week-today')?.addEventListener('click', () => { weekOffset = 0; renderWeekBand(); });
  // Theme switches change identityCss lightness (light vs dark ground) — the
  // event is dispatched on document and bubbles to window (same hook the web
  // uses to recolor itself).
  window.addEventListener('ct:settings-changed', () => renderWeekBand());

  await loadData();
  renderWeekBand();
  drawMiniWeb();
});

async function loadData(): Promise<void> {
  companies  = await Store.getCompanies();
  allEntries = await Store.getEntriesSummary();

  // LOCAL dates — toISOString is UTC and bucketed evening hours into tomorrow.
  const today   = RowUtils.localDateStr();
  const weekAgo = RowUtils.localDateStr(new Date(Date.now() - 7*86400000));

  const todayMins   = allEntries.filter(e => e.log_date === today).reduce((a,e) => a+e.total_mins, 0);
  const weekMins    = allEntries.filter(e => e.log_date >= weekAgo).reduce((a,e) => a+e.total_mins, 0);
  const allTimeMins = allEntries.reduce((a,e) => a+e.total_mins, 0);

  document.getElementById('stat-today')!.textContent     = fmtH(todayMins);
  document.getElementById('stat-week')!.textContent      = fmtH(weekMins);
  document.getElementById('stat-alltime')!.textContent   = fmtH(allTimeMins);
  document.getElementById('stat-companies')!.textContent = String(companies.length);

  const compMap: Record<number, string> = {};
  companies.forEach(c => compMap[c.id] = c.name || '—');

  // C6 (D-009): future-dated entries don't belong in "Recent Activity" —
  // they'd headline the list indefinitely. They stay visible (badged) in the
  // Global Log instead. Capped to 5 so the top row stays short enough for the
  // week band below it (docs/PLAN-week-view.md placement decision).
  const recent = allEntries.filter(e => e.log_date <= today)
    .sort((a,b) => b.log_date.localeCompare(a.log_date)).slice(0, 5);
  const list   = document.getElementById('activity-list');
  if (recent.length === 0 || !list) return;

  list.innerHTML = recent.map(e => `
    <div class="activity-row">
      <div class="activity-company">${escapeHtml(compMap[e.company_id]) || '—'}</div>
      <div class="activity-date">${escapeHtml(e.log_date)}${e.session_label ? ' · ' + escapeHtml(e.session_label) : ''}</div>
      <div class="activity-hours">${fmtH(e.total_mins)}</div>
    </div>
  `).join('');
}

function fmtH(mins: number): string {
  if (!mins) return '0h';
  return (mins / 60).toFixed(1) + 'h';
}

// ── Week band (docs/PLAN-week-view.md — Direction A volume columns) ──────────
// Seven Mon–Sun day-columns of stacked per-session blocks, sized by hours and
// colored with the company's Galaxy identity hue. NOTE: this is a fixed
// CALENDAR week with prev/next paging — the "This Week" stat chip above is a
// rolling 7-day total. Their numbers intentionally differ; do not "fix".
// Data is entries:summary only (no rows_json decrypt); within a day, blocks
// sort by rowid as the session-order proxy (summary has no clock_in).

/** Click payloads for the delegated block handler (index = data-i). */
let weekBlocks: Array<{ entry: EntrySummary; co: Company | undefined }> = [];

function renderWeekBand(): void {
  const cols = document.getElementById('week-cols');
  const axis = document.getElementById('week-axis');
  if (!cols || !axis) return;

  // Monday of the viewed week — date-part arithmetic (DST-safe), local dates
  // throughout (never toISOString; see the UTC-date gotcha).
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dayDates.push(RowUtils.localDateStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  }
  const inWeek = new Set(dayDates);

  // Identity color per company — group rows exactly like the web (groupKey),
  // recency from the latest worked date, so band blocks and the galaxy
  // directly above can never disagree on a company's color.
  const today = RowUtils.localDateStr();
  const lastByCo: Record<number, string> = {};
  for (const e of allEntries) {
    if (e.log_date <= today && (!lastByCo[e.company_id] || e.log_date > lastByCo[e.company_id]))
      lastByCo[e.company_id] = e.log_date;
  }
  const dayMs = 86400000;
  const groups = new Map<string, { rows: Company[]; lastDays: number }>();
  const coById: Record<number, Company> = {};
  for (const co of companies) {
    coById[co.id] = co;
    const key = BubbleWeb.groupKey(co);
    let g = groups.get(key);
    if (!g) { g = { rows: [], lastDays: Infinity }; groups.set(key, g); }
    g.rows.push(co);
    const lastDays = lastByCo[co.id]
      ? Math.max(0, Math.round((new Date(today + 'T00:00').getTime() - new Date(lastByCo[co.id] + 'T00:00').getTime()) / dayMs))
      : Infinity;
    g.lastDays = Math.min(g.lastDays, lastDays);
  }
  const colorFor = (companyId: number): string => {
    const co = coById[companyId];
    const g = co ? groups.get(BubbleWeb.groupKey(co)) : null;
    return g ? BubbleWeb.identityCss(g) : 'var(--border-light)';
  };

  // Sessions per day, rowid-ordered within the day.
  const byDay = new Map<string, EntrySummary[]>();
  for (const e of allEntries) {
    if (!inWeek.has(e.log_date)) continue;
    const list = byDay.get(e.log_date) || [];
    list.push(e);
    byDay.set(e.log_date, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.id - b.id);

  // Auto-scale: tallest day fills the plot, but a light week never inflates —
  // anything ≥8h is treated as a full column.
  const dayTotals = dayDates.map(d => (byDay.get(d) || []).reduce((s, e) => s + (e.total_mins || 0), 0));
  const weekTotal = dayTotals.reduce((s, m) => s + m, 0);
  const PLOT = 126;
  const maxDayH = Math.max(8, Math.max(...dayTotals) / 60);
  const pxPerHour = PLOT / maxDayH;

  weekBlocks = [];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (weekTotal === 0) {
    cols.innerHTML = '<div class="week-empty-msg" style="flex:1;">No sessions this week</div>';
  } else {
    cols.innerHTML = dayDates.map(d => {
      const sessions = byDay.get(d) || [];
      if (!sessions.length) return '<div class="week-col"><div class="week-day-empty">—</div></div>';
      const blocks = sessions.map(e => {
        const i = weekBlocks.length;
        weekBlocks.push({ entry: e, co: coById[e.company_id] });
        const h = (e.total_mins || 0) / 60;
        const px = Math.max(6, Math.round(h * pxPerHour));
        const name = coById[e.company_id]?.name || '—';
        const tip = `${name}${e.session_label ? ' · ' + e.session_label : ''} · ${fmtH(e.total_mins)} — click to open in the Tracker`;
        return `<div class="week-blk" data-i="${i}" data-tip="${escapeHtml(tip)}"`
          + ` style="height:${px}px;background:${colorFor(e.company_id)};">`
          + (px >= 17 ? escapeHtml(fmtH(e.total_mins)) : '') + '</div>';
      }).join('');
      return `<div class="week-col">${blocks}</div>`;
    }).join('');
  }
  axis.innerHTML = dayDates.map((d, i) => {
    const mins = dayTotals[i];
    return `<div class="week-ax" data-date="${d}" data-tip="Open the Tracker on ${d}.">`
      + `<div class="wd" style="color:${mins ? 'var(--text-bright)' : 'var(--text-dim)'};${d === today ? 'text-decoration:underline;' : ''}">${dayNames[i]}</div>`
      + `<div class="wh">${mins ? fmtH(mins) : '0h'}</div></div>`;
  }).join('');

  // Header: range label ("Mar 9 – 15", cross-month "Mar 30 – Apr 5", year
  // suffix when not the current year), grand total, This-week reset.
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const mon = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short' });
  let range = monday.getMonth() === sunday.getMonth()
    ? `${mon(monday)} ${monday.getDate()} – ${sunday.getDate()}`
    : `${mon(monday)} ${monday.getDate()} – ${mon(sunday)} ${sunday.getDate()}`;
  if (monday.getFullYear() !== now.getFullYear() || sunday.getFullYear() !== now.getFullYear())
    range += `, ${sunday.getFullYear()}`;
  const rangeEl = document.getElementById('week-range');
  const totalEl = document.getElementById('week-total');
  const todayBtn = document.getElementById('week-today');
  if (rangeEl) rangeEl.textContent = range;
  if (totalEl) totalEl.textContent = fmtH(weekTotal) + ' total';
  if (todayBtn) todayBtn.style.display = weekOffset === 0 ? 'none' : '';
}

// Delegated click-through (CSP-safe; covers re-rendered innerHTML). A block
// opens its exact session in the Tracker (same sessionStorage handoff the
// Global Log "Open" uses); a day label opens the Tracker on that date.
document.addEventListener('click', ev => {
  const t = ev.target as HTMLElement;
  const blk = t.closest<HTMLElement>('.week-blk');
  if (blk) {
    const b = weekBlocks[Number(blk.dataset.i)];
    if (!b) return;
    sessionStorage.setItem('tracker_date', b.entry.log_date);
    sessionStorage.setItem('tracker_entry', String(b.entry.id));
    if (b.co) sessionStorage.setItem('active_company', JSON.stringify(b.co));
    api.send('navigate', 'tracker');
    return;
  }
  const ax = t.closest<HTMLElement>('.week-ax');
  if (ax && ax.dataset.date) {
    sessionStorage.setItem('tracker_date', ax.dataset.date);
    api.send('navigate', 'tracker');
  }
});

// Mini galaxy web — same BubbleWeb engine as the Companies page, galaxies
// only (no drill on the small canvas). Follows the shared per-profile window
// preset (ui_webRange, set from the Companies page toggles). Single-project
// galaxy click → tracker, as always; multi-project click → Companies page
// PRE-ZOOMED into that galaxy (approved decision #6).
async function drawMiniWeb(): Promise<void> {
  const canvas = document.getElementById('web-canvas') as HTMLCanvasElement | null;
  const wrap   = document.getElementById('web-canvas-wrap');
  const tt     = document.getElementById('node-tooltip');
  if (!canvas || !wrap || !tt) return;
  let range: '30' | '90' | 'all' = '90';
  const saved = await api.invoke('settings:get', 'ui_webRange');
  if (saved === '30' || saved === '90' || saved === 'all') range = saved;
  const web = BubbleWeb.attach({
    canvas, wrap, mini: true,
    tooltip: {
      root: tt,
      name: document.getElementById('tt-name')!,
      hier: document.getElementById('tt-hier')!,
      detail: document.getElementById('tt-detail')!,
    },
    onOpenTracker: (co) => {
      sessionStorage.setItem('active_company', JSON.stringify(co));
      api.send('navigate', 'tracker');
    },
    onGalaxyNavigate: (galaxy) => {
      sessionStorage.setItem('web_zoom_galaxy', galaxy.key);
      api.send('navigate', 'companies');
    },
  });
  web.update(companies, allEntries, range);
}

})();
