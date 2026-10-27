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
// Hand off to the Global Log pre-filtered to this client over the current range.
// The Global Log reads these sessionStorage keys on load (see global-log.ts).
function openInGlobalLog(companyId: number): void {
  sessionStorage.setItem('glog_company', String(companyId));
  sessionStorage.setItem('glog_from', cutoffFor(range));   // '' for all-time
  sessionStorage.setItem('glog_to', RowUtils.localDateStr());
  api.send('navigate', 'global-log');
}

function cutoffFor(r: Range): string {
  if (r === 'all') return '';
  const days = Number(r);
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return RowUtils.localDateStr(d);
}

// ── Data ────────────────────────────────────────────────────────────────────
async function loadData(): Promise<void> {
  const [raw, cos, profile, dis] = await Promise.all([
    Store.getEntries(),
    Store.getCompanies(),
    api.invoke('profile:get'),
    api.invoke('settings:get', 'schedule_dismissed'),
  ]);
  try { const d = JSON.parse(String(dis || '[]')); dismissed = Array.isArray(d) ? d : []; } catch { dismissed = []; }
  companies = cos || [];
  companyMap = {};
  companies.forEach(c => { companyMap[Number(c.id)] = c; });
  _colorFor = null; // identity-color map depends on companies + entries
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
  renderSchedule();
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

// Depth defs for the bar charts — a vertical accent gradient (bright top → dim
// bottom) + a soft drop shadow, so bars read as raised rather than flat. Both
// reference the theme accent via CSS var, so they repaint on theme change.
function barDefs(gradId: string): string {
  return `<defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity="0.95"/>
      <stop offset="1" stop-color="var(--accent)" stop-opacity="0.45"/>
    </linearGradient>
    <filter id="${gradId}-sh" x="-40%" y="-25%" width="180%" height="150%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.42"/>
    </filter>
  </defs>`;
}

// ── Identity colors (shared galaxy hue per company — matches web + week band) ──
// The shared BubbleWeb.colorMap owns the grouping + recency logic so a client's
// donut slice is the exact colour of its galaxy bubble. Cached; invalidated on
// data reload (loadData).
let _colorFor: ((companyId: number) => string) | null = null;
function identityColorFor(companyId: number): string {
  if (!_colorFor) _colorFor = BubbleWeb.colorMap(companies, entries).colorFor;
  return _colorFor(companyId);
}

// ── Donut (Client Mix / Earnings) ────────────────────────────────────────────
interface DonutSlice { label: string; value: number; color: string; ended?: boolean; disp: string; coId?: number; }
function buildDonut(container: HTMLElement, slices: DonutSlice[], centerTop: string, centerBot: string, emptyMsg: string): void {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (!total) { container.innerHTML = `<div class="insight-empty">${escapeHtml(emptyMsg)}</div>`; return; }

  const cx = 80, cy = 80, rO = 72, rI = 46, TAU = Math.PI * 2;
  const gap = slices.length > 1 ? 0.035 : 0;
  const polar = (r: number, ang: number): [number, number] => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  let a = -Math.PI / 2;
  const paths = slices.map((d) => {
    const frac = d.value / total, a1 = a + frac * TAU;
    const s0 = a + gap / 2, s1 = a1 - gap / 2;
    const large = (s1 - s0) > Math.PI ? 1 : 0;
    const [x0, y0] = polar(rO, s0), [x1, y1] = polar(rO, s1), [x2, y2] = polar(rI, s1), [x3, y3] = polar(rI, s0);
    a = a1;
    const pct = Math.round(d.value / total * 100);
    const dPath = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rO} ${rO} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${rI} ${rI} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
    const val = d.disp + ' · ' + pct + '%' + (d.coId != null ? ' · click to view in Global Log' : '');
    const co = d.coId != null ? ` data-co="${d.coId}" class="clickable"` : '';
    return `<path d="${dPath}" fill="${d.color}"${co} data-tip-name="${escapeHtml(d.label)}" data-tip-val="${escapeHtml(val)}"/>`;
  }).join('');
  const svg = `<svg class="donut-svg" viewBox="0 0 160 160" aria-hidden="true">${paths}`
    + `<text x="80" y="76" text-anchor="middle" fill="var(--text-white)" font-family="var(--mono)" font-size="19" font-weight="600">${escapeHtml(centerTop)}</text>`
    + `<text x="80" y="93" text-anchor="middle" fill="var(--text-dim)" font-family="var(--sans)" font-size="10">${escapeHtml(centerBot)}</text></svg>`;
  const legend = slices.map(d => {
    const pct = Math.round(d.value / total * 100);
    const co = d.coId != null ? ` data-co="${d.coId}" title="Open ${escapeHtml(d.label)} in the Global Log"` : '';
    return `<div class="dl-row${d.coId != null ? ' clickable' : ''}"${co}><span class="dl-dot ${d.ended ? 'ended' : ''}" style="background:${d.color}"></span>`
      + `<span class="dl-name">${escapeHtml(d.label)}</span><span class="dl-val">${escapeHtml(d.disp)}</span><span class="dl-pct">${pct}%</span></div>`;
  }).join('');
  container.innerHTML = `<div class="donut-row">${svg}<div class="donut-legend">${legend}</div></div>`;
}

// Shared hover tooltip for donut slices + bars — any mark carrying
// data-tip-name/data-tip-val shows it. Installed once. textContent-only
// (values are re-decoded from attributes, so escape via textContent).
function installChartTooltips(): void {
  const tip = document.getElementById('ins-tooltip');
  const root = document.getElementById('insights-scroll');
  if (!tip || !root) return;
  const show = (el: Element) => {
    const name = el.getAttribute('data-tip-name'); if (name == null) return;
    tip.textContent = '';
    const n = document.createElement('div'); n.className = 'tt-name'; n.textContent = name;
    const v = document.createElement('div'); v.className = 'tt-val'; v.textContent = el.getAttribute('data-tip-val') || '';
    tip.append(n, v); tip.style.display = '';
  };
  root.addEventListener('mouseover', e => { const el = (e.target as Element); if (el.getAttribute?.('data-tip-name') != null) show(el); });
  root.addEventListener('mousemove', e => {
    if (tip.style.display === 'none') return;
    tip.style.left = ((e as MouseEvent).clientX + 14) + 'px';
    tip.style.top = ((e as MouseEvent).clientY + 14) + 'px';
  });
  root.addEventListener('mouseout', e => { if ((e.target as Element).getAttribute?.('data-tip-name') != null) tip.style.display = 'none'; });
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

  let out = barDefs('trend-grad');
  // y grid
  for (let i = 0; i <= 4; i++) {
    const y = pT + cH - (cH * i / 4);
    out += `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${pL + cW}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>`;
    out += `<text x="${pL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${(maxH * i / 4).toFixed(maxH < 4 ? 1 : 0)}h</text>`;
  }
  // bars
  buckets.forEach((b, i) => {
    const h = b.mins / 60;
    const bh = h > 0 ? Math.max(1, (h / maxH) * cH) : 0;
    const x = pL + i * slotW + (slotW - barW) / 2;
    if (h > 0) out += `<rect x="${x.toFixed(1)}" y="${(pT + cH - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#trend-grad)" fill-opacity="0.75" filter="url(#trend-grad-sh)" data-tip-name="${escapeHtml(b.label)}" data-tip-val="${escapeHtml(fmtH(b.mins))}"/>`;
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
  // pT reserves headroom for the value label above the TALLEST bar: its
  // baseline sits at pT-5, and the 10px glyphs need ~8px of ascent — with the
  // old pT=10 the top half of the label was clipped by the SVG viewport
  // (user report 2026-07-19, visible at every UI scale).
  const pL = 8, pR = 8, pT = 18, pB = 20;
  const cW = W - pL - pR, cH = H - pT - pB;
  const slotW = cW / 7;
  const barW = Math.min(slotW - 8, 34);

  const fullLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let out = barDefs('dow-grad');
  vals.forEach((v, i) => {
    const bh = v > 0 ? Math.max(1, (v / maxV) * cH) : 0;
    const x = pL + i * slotW + (slotW - barW) / 2;
    if (v > 0) {
      out += `<rect x="${x.toFixed(1)}" y="${(pT + cH - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="url(#dow-grad)" fill-opacity="${i === busiest ? '1' : '0.7'}" filter="url(#dow-grad-sh)" data-tip-name="${fullLabels[i]}" data-tip-val="${escapeHtml(fmtH(v))}"/>`;
      out += `<text x="${(x + barW / 2).toFixed(1)}" y="${(pT + cH - bh - 5).toFixed(1)}" text-anchor="middle" fill="${i === busiest ? 'var(--text)' : 'var(--text-muted)'}" font-size="10" font-family="var(--mono)">${fmtH(v)}</text>`;
    }
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

  const hourLbl = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  let out = barDefs('hour-grad');
  vals.forEach((v, i) => {
    const bh = v > 0 ? Math.max(1, (v / maxV) * cH) : 0;
    const x = pL + i * slotW + (slotW - barW) / 2;
    if (v > 0) out += `<rect x="${x.toFixed(1)}" y="${(pT + cH - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="url(#hour-grad)" fill-opacity="${i === peak ? '1' : '0.6'}" filter="url(#hour-grad-sh)" data-tip-name="${hourLbl(i)}" data-tip-val="${escapeHtml(fmtH(v))}"/>`;
  });
  [0, 6, 12, 18].forEach(h => {
    out += `<text x="${(pL + h * slotW + slotW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${String(h).padStart(2, '0')}</text>`;
  });
  out += `<text x="${(pL + 23 * slotW + slotW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">23</text>`;
  svg.innerHTML = out;
}

// ── Client mix (share-of-hours donut, coloured by galaxy identity) ────────────
function renderClientMix(es: InsightEntry[]): void {
  const body = $id('client-mix-body');
  const byCo = InsightsCompute.byCompany(es);
  const rows = Object.entries(byCo)
    .map(([id, mins]) => ({ id: Number(id), mins }))
    .filter(r => r.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const total = rows.reduce((s, r) => s + r.mins, 0);

  // Top 6 + aggregated "N others" so the donut never fragments into slivers.
  const TOP = 6;
  const shown = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const restMins = rest.reduce((s, r) => s + r.mins, 0);

  const slices: DonutSlice[] = shown.map(r => ({
    label: coName(r.id), value: r.mins, color: identityColorFor(r.id),
    ended: !!(companyMap[r.id] && companyMap[r.id].date_end), disp: fmtH(r.mins), coId: r.id,
  }));
  if (restMins > 0) slices.push({ label: `${rest.length} other${rest.length !== 1 ? 's' : ''}`, value: restMins, color: 'var(--text-muted)', disp: fmtH(restMins) });

  buildDonut(body, slices, fmtH(total).replace('.0', ''), 'total', 'No activity in this range yet.');
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
  // Donut is proportional, so it needs one currency. Use the dominant currency
  // (most clients) for the slices + centre total; a footnote flags any others.
  const curCount: Record<string, number> = {};
  rows.forEach(r => { curCount[r.cur] = (curCount[r.cur] || 0) + 1; });
  const mainCur = Object.entries(curCount).sort((a, b) => b[1] - a[1])[0][0];
  const inCur = rows.filter(r => r.cur === mainCur && r.amount > 0).sort((a, b) => b.amount - a.amount);
  const otherCurs = Object.keys(curCount).filter(c => c !== mainCur).length;

  const TOP = 6;
  const shown = inCur.slice(0, TOP);
  const rest = inCur.slice(TOP);
  const restAmt = rest.reduce((s, r) => s + r.amount, 0);
  const total = inCur.reduce((s, r) => s + r.amount, 0);

  const slices: DonutSlice[] = shown.map(r => ({
    label: coName(r.id), value: r.amount, color: identityColorFor(r.id),
    ended: !!(companyMap[r.id] && companyMap[r.id].date_end), disp: fmtMoney(r.amount, mainCur), coId: r.id,
  }));
  if (restAmt > 0) slices.push({ label: `${rest.length} other${rest.length !== 1 ? 's' : ''}`, value: restAmt, color: 'var(--text-muted)', disp: fmtMoney(restAmt, mainCur) });

  buildDonut(body, slices, fmtMoney(total, mainCur), 'estimated', 'No earnings in this range.');
  if (otherCurs > 0) {
    body.insertAdjacentHTML('beforeend', `<div class="insight-hint">+ ${otherCurs} other currenc${otherCurs === 1 ? 'y' : 'ies'} not shown (the donut totals one currency).</div>`);
  }
}

// ── Your Schedule (docs/PLAN-recurring-schedule.md) ─────────────────────────
// Detection always looks at the last 8 weeks (not the range toggles). A
// detected pattern is only a suggestion until saved into the company's
// encrypted blob; logging shifts goes through the shared catch-up prompt.
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtClock = (t: string): string => (typeof Settings !== 'undefined' ? Settings.formatTime(t) : t);
const fmtDate = (d: string): string => Schedule.parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
let detected: DetectedSlot[] = [];
let dismissed: string[] = [];
let editingCo: Company | null = null;

const slotText = (s: ScheduleSlot): string => `${DAY[s.weekday]} ${fmtClock(s.start)}–${fmtClock(s.end)}`;
const patternKey = (slots: ScheduleSlot[]): string => slots.map(Schedule.slotId).sort().join(',');

function sessionsList(): Array<{ company_id: number; log_date: string; total_mins: number }> {
  return entries.map(e => ({ company_id: e.company_id, log_date: e.log_date, total_mins: e.total_mins }));
}

function renderSchedule(): void {
  const body = $id('schedule-body');
  const today = RowUtils.localDateStr();
  detected = Schedule.detectSchedule(
    entries.map(e => ({ company_id: e.company_id, log_date: e.log_date, rows: e.rows as EntryRow[] })), { today });
  const detBy: Record<number, DetectedSlot[]> = {};
  detected.forEach(s => { (detBy[s.companyId] ||= []).push(s); });
  const sessions = sessionsList();
  const due = Schedule.dueShifts(companies, sessions, { today, dismissed });

  let html = '';
  if (due.length) {
    const mins = due.reduce((t, d) => t + d.mins, 0);
    html += `<div class="sched-due"><span>${due.length} scheduled shift${due.length === 1 ? '' : 's'} (${fmtH(mins)}) not logged yet.</span>`
      + `<button class="btn-primary sched-btn" data-sched-act="catchup">Review &amp; log</button></div>`;
  }

  const cos = companies.filter(c => c.schedule || detBy[Number(c.id)]);
  if (!cos.length) {
    html += `<div class="insight-empty">No repeating weekly pattern yet. Once the same shift shows up for 3 or more weeks, it appears here.`
      + (companies.length ? `<br><button class="btn-neutral sched-btn" style="margin-top:10px;" data-sched-act="new">Set up a schedule by hand</button>` : '')
      + `</div>`;
    body.innerHTML = html;
    return;
  }

  for (const co of cos) {
    const cid = Number(co.id);
    const saved = co.schedule;
    const det = detBy[cid] || [];
    const shown: ScheduleSlot[] = saved ? saved.slots : det;
    const pill = saved
      ? (saved.paused ? '<span class="sched-pill paused">Paused</span>' : '<span class="sched-pill saved">Saved</span>')
      : '<span class="sched-pill suggest">Suggested</span>';
    const week = DAY.map((dn, wd) => {
      const chips = shown.filter(s => Number(s.weekday) === wd).map(s => {
        const ev = !saved ? (s as DetectedSlot) : null;
        return `<div class="sched-chip${saved ? '' : ' suggest'}">${escapeHtml(fmtClock(s.start))}–${escapeHtml(fmtClock(s.end))}`
          + (ev ? `<small>${ev.weeksSeen} of ${ev.weeksTotal} wks</small>` : '') + `</div>`;
      }).join('');
      return `<div class="sched-day"><div class="sched-dn">${dn}</div>${chips}</div>`;
    }).join('');

    let foot: string;
    if (saved) {
      const p = Schedule.periodSummary(co, sessions, { today });
      foot = `<div class="sched-period">Pay period ${escapeHtml(fmtDate(p.start))} – ${escapeHtml(fmtDate(p.end))} · <b>${fmtH(p.loggedMins)}</b> logged`
        + ` · <b>${fmtH(p.aheadMins)}</b> scheduled ahead</div>`
        + `<button class="btn-neutral sched-btn" data-sched-act="pause" data-sched-co="${cid}">${saved.paused ? 'Resume' : 'Pause'}</button>`
        + `<button class="btn-neutral sched-btn" data-sched-act="edit" data-sched-co="${cid}">Edit</button>`;
    } else {
      const weekly = det.reduce((t, s) => t + s.mins, 0);
      foot = `<div class="sched-period">About <b>${fmtH(weekly)}</b> a week. Save it and the app will offer to log these shifts as each day passes.</div>`
        + `<button class="btn-neutral sched-btn" data-sched-act="adjust" data-sched-co="${cid}">Adjust first…</button>`
        + `<button class="btn-primary sched-btn" data-sched-act="save" data-sched-co="${cid}">Save as schedule</button>`;
    }

    let drift = '';
    if (saved && det.length && Schedule.scheduleDiffers(det, saved.slots) && saved.kept !== patternKey(det)) {
      drift = `<div class="sched-drift"><span>Your recent weeks look different: ${escapeHtml(det.map(slotText).join(', '))}</span>`
        + `<button class="btn-neutral sched-btn" data-sched-act="keep" data-sched-co="${cid}">Keep mine</button>`
        + `<button class="btn-primary sched-btn" data-sched-act="update" data-sched-co="${cid}">Update to match</button></div>`;
    }

    html += `<div class="sched-co"><div class="sched-co-head"><span class="hbar-dot" style="background:${identityColorFor(cid)};"></span>`
      + `<span class="sched-co-name">${escapeHtml(co.name)}</span>${pill}</div>`
      + `<div class="sched-week">${week}</div>${drift}<div class="sched-foot">${foot}</div></div>`;
  }
  if (companies.some(c => !c.schedule && !detBy[Number(c.id)])) {
    html += `<div style="margin-top:12px;"><button class="btn-neutral sched-btn" data-sched-act="new">+ Schedule for another company</button></div>`;
  }
  body.innerHTML = html;
}

async function saveCompanySchedule(co: Company, schedule: CompanySchedule | undefined, payPeriod?: PayPeriod | null): Promise<boolean> {
  const data: Company = { ...co, schedule };
  if (!schedule) delete data.schedule;
  if (payPeriod !== undefined) {
    if (payPeriod) data.pay_period = payPeriod; else delete data.pay_period;
  }
  const res = await IPC.companies.save(data);
  if (!res.ok) { Shell.toast(res.error || 'Could not save the schedule.', 'error'); return false; }
  Store.invalidate('companies');
  await reloadSchedule();
  return true;
}

async function reloadSchedule(): Promise<void> {
  await loadData();
  renderAll();
}

// After saving, offer this pay period's already-passed shifts straight away.
async function offerCatchup(): Promise<void> {
  const due = Schedule.dueShifts(companies, sessionsList(), { dismissed });
  if (due.length && window.ScheduleCatchup) {
    const n = await window.ScheduleCatchup.open();
    if (n) await reloadSchedule();
  }
}

async function onScheduleAction(act: string, cid: number): Promise<void> {
  const co = companies.find(c => Number(c.id) === cid) || null;
  const det = detected.filter(s => s.companyId === cid);
  const today = RowUtils.localDateStr();
  switch (act) {
    case 'catchup':
      if (window.ScheduleCatchup && await window.ScheduleCatchup.open()) await reloadSchedule();
      else await reloadSchedule();   // dismissed days may have changed
      return;
    case 'new':    openEditor(null, []); return;
    case 'adjust': if (co) openEditor(co, det); return;
    case 'edit':   if (co && co.schedule) openEditor(co, co.schedule.slots); return;
  }
  if (!co) return;
  if (act === 'save') {
    if (await saveCompanySchedule(co, Schedule.makeSchedule(det, co, today))) {
      Shell.toast('Schedule saved.', 'success');
      await offerCatchup();
    }
  } else if (act === 'pause' && co.schedule) {
    await saveCompanySchedule(co, { ...co.schedule, paused: !co.schedule.paused });
  } else if (act === 'keep' && co.schedule) {
    await saveCompanySchedule(co, { ...co.schedule, kept: patternKey(det) });
  } else if (act === 'update' && co.schedule) {
    const next = Schedule.makeSchedule(det, co, today);
    if (await saveCompanySchedule(co, { slots: next.slots, since: co.schedule.since })) Shell.toast('Schedule updated.', 'success');
  }
}

// ── Schedule editor ─────────────────────────────────────────────────────────
function editorRow(s: Partial<ScheduleSlot>): string {
  const opts = DAY.map((d, i) => `<option value="${i}"${Number(s.weekday ?? 1) === i ? ' selected' : ''}>${d}</option>`).join('');
  return `<div class="sed-row">
    <select data-f="weekday">${opts}</select>
    <input type="text" class="sed-time" data-f="start" placeholder="09:00" value="${escapeHtml(s.start || '')}">
    <input type="text" class="sed-time" data-f="end" placeholder="12:00" value="${escapeHtml(s.end || '')}">
    <input type="text" data-f="label" placeholder="e.g. QA" value="${escapeHtml(s.label || '')}">
    <input type="text" data-f="name" placeholder="e.g. Shift" value="${escapeHtml(s.name || '')}">
    <button class="btn-neutral sed-x" data-sed-x title="Remove this shift">×</button></div>`;
}

function syncEditorAnchor(): void {
  const kind = ($id('sed-pay-period') as HTMLSelectElement).value;
  $id('sed-anchor-group').style.display = kind === 'weekly' || kind === 'biweekly' ? '' : 'none';
  $id('sed-anchor-label').textContent = kind === 'biweekly' ? 'A Period Started On' : 'Week Starts On (any date)';
}

function openEditor(co: Company | null, slots: ScheduleSlot[]): void {
  editingCo = co;
  $id('sed-title').textContent = co ? `Schedule — ${co.name}` : 'New Schedule';
  $id('sed-co-group').style.display = co ? 'none' : '';
  if (!co) {
    const choices = companies.filter(c => !c.schedule && !c.date_end);
    if (!choices.length) { Shell.toast('Every active company already has a schedule.', 'info'); return; }
    ($id('sed-company') as HTMLSelectElement).innerHTML =
      choices.map(c => `<option value="${Number(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  }
  const pp = co?.pay_period;
  ($id('sed-pay-period') as HTMLSelectElement).value = pp ? (pp.kind === 'weekly' && !pp.anchor ? '' : pp.kind) : '';
  ($id('sed-anchor') as HTMLInputElement).value = pp?.anchor || '';
  syncEditorAnchor();
  $id('sed-rows').innerHTML = (slots.length ? slots : [{}]).map(editorRow).join('');
  ($id('sed-paused') as HTMLInputElement).checked = !!co?.schedule?.paused;
  $id('sed-remove').style.display = co?.schedule ? '' : 'none';
  $id('sched-editor').style.display = 'flex';
}

function closeEditor(): void {
  $id('sched-editor').style.display = 'none';
  editingCo = null;
}

// Gotcha #8: stored times are always zero-padded 24h HH:MM.
function readEditorSlots(): ScheduleSlot[] | null {
  const out: ScheduleSlot[] = [];
  for (const row of Array.from($id('sed-rows').querySelectorAll<HTMLElement>('.sed-row'))) {
    const f = (k: string) => (row.querySelector(`[data-f="${k}"]`) as HTMLInputElement).value.trim();
    if (!f('start') && !f('end') && !f('label') && !f('name')) continue;   // blank row
    const a = Schedule.toMin(f('start')), b = Schedule.toMin(f('end'));
    if (a == null || b == null) { Shell.toast('Use 24-hour times like 09:00 or 14:30.', 'error'); return null; }
    if (a === b) { Shell.toast('A shift needs different start and end times.', 'error'); return null; }
    const slot: ScheduleSlot = { weekday: Number(f('weekday')), start: Schedule.fromMin(a), end: Schedule.fromMin(b), label: f('label'), name: f('name') };
    slot.id = Schedule.slotId(slot);
    out.push(slot);
  }
  return out;
}

function readEditorPayPeriod(): PayPeriod | null {
  const kind = ($id('sed-pay-period') as HTMLSelectElement).value as PayPeriod['kind'] | '';
  const anchor = ($id('sed-anchor') as HTMLInputElement).value;
  if (!kind) return null;
  if (kind === 'weekly') return anchor ? { kind, anchor } : null;
  if (kind === 'biweekly') return anchor ? { kind, anchor } : { kind };
  return { kind };
}

async function saveEditor(): Promise<void> {
  const co = editingCo || companies.find(c => Number(c.id) === Number(($id('sed-company') as HTMLSelectElement).value)) || null;
  if (!co) return;
  const slots = readEditorSlots();
  if (!slots) return;
  if (!slots.length) { Shell.toast('Add at least one shift, or use Remove schedule.', 'error'); return; }
  const pp = readEditorPayPeriod();
  if (pp && pp.kind === 'biweekly' && !pp.anchor) { Shell.toast('Every-two-weeks needs a date a pay period started on.', 'error'); return; }
  const isNew = !co.schedule;
  const schedule: CompanySchedule = {
    ...(co.schedule || {}),
    slots,
    since: co.schedule?.since || Schedule.periodFor(RowUtils.localDateStr(), pp).start,
    paused: ($id('sed-paused') as HTMLInputElement).checked,
  };
  closeEditor();
  if (await saveCompanySchedule(co, schedule, pp)) {
    Shell.toast('Schedule saved.', 'success');
    if (isNew) await offerCatchup();
  }
}

async function removeSchedule(): Promise<void> {
  const co = editingCo;
  if (!co) return;
  const ok = await Shell.confirm({
    title: 'Remove this schedule?',
    message: `Shifts already logged for ${co.name} stay as they are. The app just stops offering new ones.`,
    confirmLabel: 'Remove', danger: true,
  });
  if (!ok) return;
  closeEditor();
  if (await saveCompanySchedule(co, undefined)) Shell.toast('Schedule removed.', 'success');
}

function installScheduleUI(): void {
  $id('schedule-body').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-sched-act]');
    if (b) void onScheduleAction(b.dataset.schedAct || '', Number(b.dataset.schedCo || 0));
  });
  $id('sed-rows').addEventListener('click', e => {
    const x = (e.target as Element).closest('[data-sed-x]');
    if (x) x.closest('.sed-row')?.remove();
  });
  $id('sed-add').addEventListener('click', () => {
    const last = $id('sed-rows').querySelector<HTMLElement>('.sed-row:last-child');
    const wd = last ? (Number((last.querySelector('[data-f="weekday"]') as HTMLSelectElement).value) + 1) % 7 : 1;
    $id('sed-rows').insertAdjacentHTML('beforeend', editorRow({ weekday: wd }));
  });
  $id('sed-pay-period').addEventListener('change', syncEditorAnchor);
  $id('sed-cancel').addEventListener('click', closeEditor);
  $id('sed-save').addEventListener('click', () => void saveEditor());
  $id('sed-remove').addEventListener('click', () => void removeSchedule());
  $id('sched-editor').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditor(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $id('sched-editor').style.display === 'flex') closeEditor();
  });
  // A catch-up run from anywhere on this page invalidates entries → refresh.
  Store.subscribe('entries', () => { void reloadSchedule(); });
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

  installChartTooltips();
  installScheduleUI();
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

  // Click-through: a client donut slice / legend row → Global Log filtered to
  // that company over the range currently in view.
  $id('insights-scroll').addEventListener('click', e => {
    const el = (e.target as Element).closest<HTMLElement>('[data-co]');
    if (el && el.dataset.co) openInGlobalLog(Number(el.dataset.co));
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
