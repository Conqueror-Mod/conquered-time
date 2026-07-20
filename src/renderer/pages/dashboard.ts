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
/** companyId → identity color, shared by Recent Activity + the week band. */
let colorFor: (companyId: number) => string = () => 'var(--border-light)';

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
  colorFor   = BubbleWeb.colorMap(companies, allEntries).colorFor;

  // LOCAL dates — toISOString is UTC and bucketed evening hours into tomorrow.
  const today = RowUtils.localDateStr();
  const dOf = (offset: number): string => RowUtils.localDateStr(new Date(Date.now() - offset * 86400000));
  const byDate: Record<string, number> = {};
  for (const e of allEntries) if (e.total_mins) byDate[e.log_date] = (byDate[e.log_date] || 0) + e.total_mins;

  // Rolling 7-day windows (offset 0 = today). This aligns the headline number,
  // its delta, and the sparkline on ONE window; the calendar week band below is
  // deliberately a different (Sun–Sat) view — see renderWeekBand.
  let thisWeek = 0, priorWeek = 0;
  for (let o = 0; o <= 6; o++) thisWeek  += byDate[dOf(o)]  || 0;
  for (let o = 7; o <= 13; o++) priorWeek += byDate[dOf(o)] || 0;
  const todayMins   = byDate[today] || 0;
  const lastWeekDay = byDate[dOf(7)] || 0;   // same weekday, 7 days ago
  const allTimeMins = allEntries.reduce((a, e) => a + e.total_mins, 0);

  document.getElementById('stat-today')!.textContent     = fmtH(todayMins);
  document.getElementById('stat-week')!.textContent      = fmtH(thisWeek);
  document.getElementById('stat-alltime')!.textContent   = fmtH(allTimeMins);
  document.getElementById('stat-companies')!.textContent = String(companies.length);

  // Deltas (arrow glyph carries direction — colorblind-safe) + 7-day sparkline.
  setDelta('delta-today', todayMins - lastWeekDay, 'vs last ' + weekdayName(today));
  setDelta('delta-week', thisWeek - priorWeek, 'vs prior week');
  const sparkDates = Array.from({ length: 7 }, (_, i) => dOf(6 - i));   // oldest → today
  renderSparkline('spark-week', sparkDates.map(d => byDate[d] || 0), sparkDates, today);

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
      <div class="activity-company"><span class="co-dot" style="background:${colorFor(e.company_id)}"></span>${escapeHtml(compMap[e.company_id]) || '—'}</div>
      <div class="activity-date">${escapeHtml(e.log_date)}${e.session_label ? ' · ' + escapeHtml(e.session_label) : ''}</div>
      <div class="activity-hours">${fmtH(e.total_mins)}</div>
    </div>
  `).join('');
}

// Ink for text drawn ON an identity-color fill (week-band blocks). Identity
// colors are always `hsl(h, s%, l%)` (identity-color.js); pick dark/light ink
// by the fill's WCAG luminance so bright hues (Zanarkand cyan) don't get
// white-on-cyan at ~2:1 (C1 / D-302 straggler, Crucible III). Any luminance
// threshold in [0.12, 0.30] guarantees ≥3:1 either way; 0.2 splits the range.
function inkOn(cssFill: string): string {
  const m = /^hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)$/.exec(cssFill);
  if (!m) return '#fff';
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const chan = (t: number): number => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    const c = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * chan(h + 1 / 3) + 0.7152 * chan(h) + 0.0722 * chan(h - 1 / 3);
  return lum > 0.2 ? '#101318' : '#fff';
}

function fmtH(mins: number): string {
  if (!mins) return '0h';
  return (mins / 60).toFixed(1) + 'h';
}

// Compact hours for deltas/sparkline tips: 1 decimal under 10h, whole above.
function fmtHShort(mins: number): string {
  const h = mins / 60;
  return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
}
function weekdayName(dateStr: string): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dateStr + 'T00:00').getDay()];
}

// Delta chip under a stat value. The ▲/▼/≈ glyph carries the meaning (color is a
// secondary cue only — colorblind-safe). Sub-3-minute swings read as "even".
function setDelta(id: string, deltaMins: number, label: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const abs = Math.abs(deltaMins);
  if (abs < 3) { el.className = 'stat-delta even'; el.textContent = `≈ even ${label}`; return; }
  const up = deltaMins > 0;
  el.className = 'stat-delta ' + (up ? 'up' : 'down');
  el.textContent = `${up ? '▲' : '▼'} ${fmtHShort(abs)} ${label}`;
}

// 7-day micro-sparkline (inline SVG, one bar per day, today highlighted). Single
// accent hue, static — colorblind-safe and no motion to gate. The daily
// breakdown rides along as a data-tip for the shared tooltip system.
function renderSparkline(id: string, vals: number[], dates: string[], todayStr: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const max = Math.max(1, ...vals);
  const W = 92, H = 26, n = vals.length, gap = 3;
  const bw = (W - gap * (n - 1)) / n;
  let bars = '';
  for (let i = 0; i < n; i++) {
    const h = Math.max(2, Math.round((vals[i] / max) * (H - 2)));
    const x = i * (bw + gap), y = H - h;
    const op = dates[i] === todayStr ? '1' : '0.45';
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="1.5" fill="var(--accent)" opacity="${op}"></rect>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${bars}</svg>`;
  el.setAttribute('data-tip', dates.map((d, i) => `${weekdayName(d)} ${fmtHShort(vals[i])}`).join(' · '));
}

// ── Week band (docs/PLAN-week-view.md — Direction A volume columns) ──────────
// Seven Sun–Sat day-columns of stacked per-session blocks, sized by hours and
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

  // Sunday of the viewed week — date-part arithmetic (DST-safe), local dates
  // throughout (never toISOString; see the UTC-date gotcha). Week runs
  // Sun–Sat (getDay(): Sun=0 → subtract 0, Sat=6 → subtract 6).
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(),
    now.getDate() - now.getDay() + weekOffset * 7);
  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dayDates.push(RowUtils.localDateStr(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)));
  }
  const inWeek = new Set(dayDates);

  const today = RowUtils.localDateStr();   // underlines today's column below
  // Identity color per company is the shared module `colorFor` (BubbleWeb.colorMap,
  // set in loadData) — so band blocks, Recent Activity, and the galaxy directly
  // above can never disagree on a company's color.
  const coById: Record<number, Company> = {};
  for (const co of companies) coById[co.id] = co;

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
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (weekTotal === 0) {
    // Branded empty state — an invitation, not an apology. The CTA differs by
    // tense: past weeks are history (no CTA), the current/future week can
    // still be conquered.
    const isPastWeek = weekOffset < 0;
    cols.innerHTML = `
      <div class="week-empty-state" style="flex:1;">
        <div class="week-empty-glyph">⧗</div>
        <div class="week-empty-title">${isPastWeek ? 'A quiet week' : 'Nothing on the board yet'}</div>
        ${isPastWeek ? '' : '<button class="btn-neutral week-empty-cta" data-action="navigate" data-arg="tracker">⏱ Start the clock</button>'}
      </div>`;
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
        const fill = colorFor(e.company_id);
        return `<div class="week-blk" data-i="${i}" data-tip="${escapeHtml(tip)}"`
          + ` style="height:${px}px;background:${fill};color:${inkOn(fill)};">`
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

  // Header: range label ("Mar 8 – 14", cross-month "Mar 30 – Apr 5", year
  // suffix when not the current year), grand total, This-week reset.
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const mon = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short' });
  let range = weekStart.getMonth() === weekEnd.getMonth()
    ? `${mon(weekStart)} ${weekStart.getDate()} – ${weekEnd.getDate()}`
    : `${mon(weekStart)} ${weekStart.getDate()} – ${mon(weekEnd)} ${weekEnd.getDate()}`;
  if (weekStart.getFullYear() !== now.getFullYear() || weekEnd.getFullYear() !== now.getFullYear())
    range += `, ${weekEnd.getFullYear()}`;
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
