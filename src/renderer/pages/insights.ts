'use strict';

// Insights page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, api, escapeHtml) plus RowUtils + InsightsCompute (pure aggregation).
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

type Range = '30' | '90' | '365' | 'all';

let range: Range = '90';
let entries: InsightEntry[] = [];
let companies: Company[] = [];
let companyMap: Record<number, Company> = {};
let defaultCurrency = 'USD';
let chartObserver: ResizeObserver | null = null;

const $id = (id: string): HTMLElement => document.getElementById(id)!;

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtH(mins: number): string {
  if (!mins || mins <= 0) return '0.0h';
  return (mins / 60).toFixed(1) + 'h';
}
function fmtHShort(mins: number): string {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtMoney(amount: number, cur: string): string {
  const c = cur || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(amount);
  } catch { return `${c} ${Math.round(amount)}`; }
}
function coName(id: number): string { return companyMap[id]?.name || `#${id}`; }
function coCurrency(id: number): string { return companyMap[id]?.currency || defaultCurrency; }

// Inclusive cutoff date for the active range ('' = all time).
function cutoffFor(r: Range): string {
  if (r === 'all') return '';
  const days = Number(r);
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return RowUtils.localDateStr(d);
}

// ── Data ────────────────────────────────────────────────────────────────────
async function loadData(): Promise<void> {
  const [raw, cos, profile] = await Promise.all([
    Store.getEntries(),
    Store.getCompanies(),
    api.invoke('profile:get'),
  ]);
  companies = cos || [];
  companyMap = {};
  companies.forEach(c => { companyMap[Number(c.id)] = c; });
  defaultCurrency = (profile && profile.default_currency) || 'USD';
  entries = (raw || []).map(e => {
    let rows: InsightEntry['rows'] = [];
    try { rows = JSON.parse(e.rows_json || '[]'); } catch { rows = []; }
    return { log_date: e.log_date, total_mins: Number(e.total_mins) || 0, company_id: Number(e.company_id), rows };
  });
}

function scoped(): InsightEntry[] {
  return InsightsCompute.filterByRange(entries, cutoffFor(range) || null);
}

// ── Render orchestration ────────────────────────────────────────────────────
// The three SVG charts (measured, must re-render on resize) — grouped so the
// ResizeObserver and the first-frame safety redraw share one call.
function renderCharts(es: InsightEntry[]): void {
  renderTrend(es);
  renderDayOfWeek(es);
  renderHourOfDay(es);
}

function renderAll(): void {
  const es = scoped();
  renderChips(es);
  renderCharts(es);
  renderClientMix(es);
  renderEarnings(es);
}

// ── Summary chips ───────────────────────────────────────────────────────────
function renderChips(es: InsightEntry[]): void {
  const totalMins = InsightsCompute.sumMins(es);

  // Day span for the average: fixed for presets, first-entry→today for "All".
  let spanDays: number;
  if (range === 'all') {
    if (es.length) {
      const first = es.reduce((min, e) => e.log_date < min ? e.log_date : min, es[0].log_date);
      const ms = Date.now() - InsightsCompute.parseLocalDate(first).getTime();
      spanDays = Math.max(1, Math.round(ms / 86400000) + 1);
    } else spanDays = 1;
  } else spanDays = Number(range);
  const weeks = Math.max(1, spanDays / 7);

  const byCo = InsightsCompute.byCompany(es);
  const activeClients = Object.values(byCo).filter(v => v > 0).length;

  // Earnings by currency; headline shows the largest-currency total.
  const earn = InsightsCompute.earningsByCompany(es, rateMap());
  const byCurrency: Record<string, number> = {};
  Object.keys(earn).forEach(k => {
    const cur = coCurrency(Number(k));
    byCurrency[cur] = (byCurrency[cur] || 0) + earn[Number(k)];
  });
  const curEntries = Object.entries(byCurrency).sort((a, b) => b[1] - a[1]);
  const topCur = curEntries[0];
  const earnValue = topCur ? fmtMoney(topCur[1], topCur[0]) : fmtMoney(0, defaultCurrency);
  const earnSub = curEntries.length > 1 ? `+ ${curEntries.length - 1} more currenc${curEntries.length - 1 === 1 ? 'y' : 'ies'}` : 'estimated';

  $id('insight-chips').innerHTML = `
    <div class="insight-chip">
      <div class="chip-label">Total Hours</div>
      <div class="chip-value">${fmtH(totalMins)}</div>
      <div class="chip-sub">${es.length} session${es.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="insight-chip green">
      <div class="chip-label">Est. Earnings</div>
      <div class="chip-value" style="font-size:19px;">${escapeHtml(earnValue)}</div>
      <div class="chip-sub">${earnSub}</div>
    </div>
    <div class="insight-chip violet">
      <div class="chip-label">Avg / Week</div>
      <div class="chip-value">${fmtH(totalMins / weeks)}</div>
      <div class="chip-sub">over ${range === 'all' ? Math.round(weeks) + ' wks' : range + 'd'}</div>
    </div>
    <div class="insight-chip yellow">
      <div class="chip-label">Active Clients</div>
      <div class="chip-value">${activeClients}</div>
      <div class="chip-sub">with logged time</div>
    </div>`;
}

function rateMap(): Record<number, number> {
  const m: Record<number, number> = {};
  companies.forEach(c => { m[Number(c.id)] = Number(c.pay_rate) || 0; });
  return m;
}

// ── SVG helpers ─────────────────────────────────────────────────────────────
function svgFor(wrapId: string, svgId: string): { svg: SVGElement; W: number; H: number } | null {
  const wrap = document.getElementById(wrapId);
  const svg = document.getElementById(svgId) as unknown as SVGElement | null;
  if (!wrap || !svg) return null;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return null;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  return { svg, W, H };
}
function emptySvg(svg: SVGElement, W: number, H: number, msg: string): void {
  svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-dim)" font-size="12" font-family="var(--sans)">${escapeHtml(msg)}</text>`;
}

// ── Trends over time (bars + moving-average line) ────────────────────────────
function renderTrend(es: InsightEntry[]): void {
  const ctx = svgFor('trend-wrap', 'trend-svg');
  if (!ctx) return;
  const { svg, W, H } = ctx;
  const bucket: 'week' | 'month' = (range === '365' || range === 'all') ? 'month' : 'week';
  $id('trend-unit').textContent = bucket === 'month' ? 'Monthly' : 'Weekly';

  const buckets = InsightsCompute.trendBuckets(es, bucket);
  if (!buckets.length) { emptySvg(svg, W, H, 'No activity in this range yet.'); return; }

  const hours = buckets.map(b => b.mins / 60);
  const avg = InsightsCompute.movingAverage(hours, bucket === 'month' ? 3 : 4);
  const maxH = Math.max(...hours, ...avg, 1);

  const pL = 34, pR = 10, pT = 10, pB = 26;
  const cW = W - pL - pR, cH = H - pT - pB;
  const n = buckets.length;
  const slotW = cW / n;
  const barW = Math.max(2, Math.min(slotW - 3, 40));
  const yFor = (h: number) => pT + cH - (h / maxH) * cH;
  const xMid = (i: number) => pL + i * slotW + slotW / 2;

  let out = '';
  // y grid
  for (let i = 0; i <= 4; i++) {
    const y = pT + cH - (cH * i / 4);
    out += `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${pL + cW}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>`;
    out += `<text x="${pL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${(maxH * i / 4).toFixed(0)}h</text>`;
  }
  // bars
  buckets.forEach((b, i) => {
    const h = b.mins / 60;
    const bh = h > 0 ? Math.max(1, (h / maxH) * cH) : 0;
    const x = pL + i * slotW + (slotW - barW) / 2;
    out += `<rect x="${x.toFixed(1)}" y="${(pT + cH - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="var(--accent)" fill-opacity="0.55"/>`;
  });
  // moving-average line
  const pts = avg.map((v, i) => `${xMid(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  out += `<polyline points="${pts}" fill="none" stroke="var(--yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  // x labels (sparse)
  const step = Math.max(1, Math.ceil(n / 8));
  buckets.forEach((b, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    out += `<text x="${xMid(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${escapeHtml(b.label)}</text>`;
  });
  svg.innerHTML = out;
}

// ── Busiest days (Mon-first bars) ────────────────────────────────────────────
function renderDayOfWeek(es: InsightEntry[]): void {
  const ctx = svgFor('dow-wrap', 'dow-svg');
  if (!ctx) return;
  const { svg, W, H } = ctx;
  const raw = InsightsCompute.byDayOfWeek(es);            // Sun=0..Sat=6
  const order = [1, 2, 3, 4, 5, 6, 0];                    // Mon-first
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const vals = order.map(i => raw[i]);
  const total = vals.reduce((s, v) => s + v, 0);
  if (total <= 0) { emptySvg(svg, W, H, 'No activity in this range yet.'); return; }

  const maxV = Math.max(...vals, 1);
  const busiest = vals.indexOf(maxV);
  const pL = 8, pR = 8, pT = 10, pB = 20;
  const cW = W - pL - pR, cH = H - pT - pB;
  const slotW = cW / 7;
  const barW = Math.min(slotW - 8, 34);

  let out = '';
  vals.forEach((v, i) => {
    const bh = v > 0 ? Math.max(1, (v / maxV) * cH) : 0;
    const x = pL + i * slotW + (slotW - barW) / 2;
    const fill = i === busiest ? 'var(--accent)' : 'var(--accent)';
    const op = i === busiest ? '0.9' : '0.4';
    out += `<rect x="${x.toFixed(1)}" y="${(pT + cH - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${fill}" fill-opacity="${op}"/>`;
    if (v > 0) out += `<text x="${(x + barW / 2).toFixed(1)}" y="${(pT + cH - bh - 4).toFixed(1)}" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--mono)">${fmtH(v)}</text>`;
    out += `<text x="${(pL + i * slotW + slotW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="${i === busiest ? 'var(--accent)' : 'var(--text-dim)'}" font-size="10" font-family="var(--sans)">${labels[i]}</text>`;
  });
  svg.innerHTML = out;
}

// ── Busiest times (hour-of-day bars) ─────────────────────────────────────────
function renderHourOfDay(es: InsightEntry[]): void {
  const ctx = svgFor('hour-wrap', 'hour-svg');
  if (!ctx) return;
  const { svg, W, H } = ctx;
  const vals = InsightsCompute.byHourOfDay(es);            // [24]
  const total = vals.reduce((s, v) => s + v, 0);
  if (total <= 0) { emptySvg(svg, W, H, 'No clock-in/out times in this range.'); return; }

  const maxV = Math.max(...vals, 1);
  const peak = vals.indexOf(maxV);
  const pL = 8, pR = 8, pT = 10, pB = 20;
  const cW = W - pL - pR, cH = H - pT - pB;
  const slotW = cW / 24;
  const barW = Math.max(2, slotW - 2);

  let out = '';
  vals.forEach((v, i) => {
    const bh = v > 0 ? Math.max(1, (v / maxV) * cH) : 0;
    const x = pL + i * slotW + (slotW - barW) / 2;
    out += `<rect x="${x.toFixed(1)}" y="${(pT + cH - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="var(--accent)" fill-opacity="${i === peak ? '0.95' : '0.45'}"/>`;
  });
  [0, 6, 12, 18].forEach(h => {
    out += `<text x="${(pL + h * slotW + slotW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${String(h).padStart(2, '0')}</text>`;
  });
  out += `<text x="${(pL + 23 * slotW + slotW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">23</text>`;
  svg.innerHTML = out;
}

// ── Client mix (share-of-hours horizontal bars) ──────────────────────────────
function renderClientMix(es: InsightEntry[]): void {
  const body = $id('client-mix-body');
  const byCo = InsightsCompute.byCompany(es);
  const rows = Object.entries(byCo)
    .map(([id, mins]) => ({ id: Number(id), mins }))
    .filter(r => r.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const total = rows.reduce((s, r) => s + r.mins, 0);
  if (!rows.length) { body.innerHTML = `<div class="insight-empty">No activity in this range yet.</div>`; return; }

  // Top 6 + aggregated "Others".
  const TOP = 6;
  const shown = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const restMins = rest.reduce((s, r) => s + r.mins, 0);
  const max = shown[0].mins;

  let out = '';
  shown.forEach(r => {
    const co = companyMap[r.id];
    const ended = !!(co && co.date_end);
    const pct = total ? Math.round((r.mins / total) * 100) : 0;
    out += `
      <div class="hbar-row">
        <div class="hbar-label"><span class="hbar-dot ${ended ? 'ended' : ''}" style="background:${ended ? 'var(--text-dim)' : 'var(--accent)'};"></span>${escapeHtml(coName(r.id))}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, (r.mins / max) * 100).toFixed(1)}%;"></div></div>
        <div class="hbar-value">${fmtH(r.mins)} · ${pct}%</div>
      </div>`;
  });
  if (restMins > 0) {
    const pct = total ? Math.round((restMins / total) * 100) : 0;
    out += `
      <div class="hbar-row">
        <div class="hbar-label"><span class="hbar-dot" style="background:var(--text-muted);"></span>${rest.length} other${rest.length !== 1 ? 's' : ''}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, (restMins / max) * 100).toFixed(1)}%;background:var(--text-muted);"></div></div>
        <div class="hbar-value">${fmtH(restMins)} · ${pct}%</div>
      </div>`;
  }
  body.innerHTML = out;
}

// ── Estimated earnings (hours × rate, per client) ────────────────────────────
function renderEarnings(es: InsightEntry[]): void {
  const body = $id('earnings-body');
  const earn = InsightsCompute.earningsByCompany(es, rateMap());
  const byCoMins = InsightsCompute.byCompany(es);
  const rows = Object.keys(earn)
    .map(k => ({ id: Number(k), amount: earn[Number(k)], mins: byCoMins[Number(k)] || 0, cur: coCurrency(Number(k)) }))
    .sort((a, b) => b.mins - a.mins);

  if (!rows.length) {
    body.innerHTML = `<div class="insight-empty">No billable rate set on any client with logged time.<br>Add a Pay Rate in a company's details to see earnings.</div>`;
    return;
  }
  const maxMins = Math.max(...rows.map(r => r.mins), 1);
  let out = '';
  rows.forEach(r => {
    out += `
      <div class="hbar-row">
        <div class="hbar-label">${escapeHtml(coName(r.id))}</div>
        <div class="hbar-track"><div class="hbar-fill gold" style="width:${Math.max(2, (r.mins / maxMins) * 100).toFixed(1)}%;"></div></div>
        <div class="hbar-value">${escapeHtml(fmtMoney(r.amount, r.cur))}</div>
      </div>`;
  });
  body.innerHTML = out;
}

// ── Range toggles ────────────────────────────────────────────────────────────
function setRange(r: Range): void {
  range = r;
  document.querySelectorAll<HTMLElement>('#range-toggles .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === r));
  renderAll();
}

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('insights');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'hidden'; }

  await loadData();
  renderAll();
  // The SVG charts render in real pixel coordinates, so they need the wraps to
  // have a measured width. On first paint the layout may not be flushed yet —
  // redraw them once on the next frame so they never flash empty.
  requestAnimationFrame(() => renderCharts(scoped()));

  $id('range-toggles').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.range-btn');
    if (btn && btn.dataset.range) setRange(btn.dataset.range as Range);
  });

  // Redraw the SVG charts when the layout width changes (charts render in real
  // pixel coordinates, so they must re-measure on resize).
  let raf = 0;
  chartObserver = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => renderCharts(scoped()));
  });
  chartObserver.observe($id('insights-scroll'));

  // Re-render on theme change so SVG var() colors repaint crisply.
  window.addEventListener('ct:settings-changed', () => renderAll());
});

})();
