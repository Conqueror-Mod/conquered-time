'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  report-html.ts — shared emailed-report builders (PDF HTML + CSV).
//
//  Pure, Electron-free, unit-testable (test/report-html.test.js). Both email
//  paths — the Reports-page "Email Report" modal and the scheduled report —
//  render through buildEmailReportHTML() so the two emails are identical in
//  layout and branding, and buildReportCSV() produces the matching CSV from
//  the SAME scoped entry set (historically the manual path's CSV ignored the
//  period/company filter and dumped the entire vault — fixed by making the
//  caller pass the scoped entries everywhere).
//
//  Visual identity (confirmed with Chris 2026-07-06): branded print-safe
//  light palette, Inter typography (base64 CSS injected by the caller),
//  summary band + Daily Hours / Per-Company / Task Label breakdowns. Row-level
//  detail lives in the CSV, keeping the PDF to ~1-2 pages. NavIDs never
//  appear in any export (project rule).
// ════════════════════════════════════════════════════════════════════════════

const { rowHasContent } = require('../renderer/row-utils');

interface ReportEntry {
  id?: number;
  company_id?: number | string;
  log_date?: string;
  session_label?: string | null;
  rows_json?: string;
  total_mins?: number;
}

interface ReportInput {
  /** Report heading, e.g. 'Period Report' / 'Scheduled Report'. */
  title: string;
  fromDate: string;
  toDate: string;
  /** 'All Companies' or a company name when filtered. */
  coLabel: string;
  /** Scoped, DECRYPTED entries (rows_json populated). */
  entries: ReportEntry[];
  /** rowid → company name. */
  companyNames: Record<number, string>;
  /** rowid → identity CSS color (the company's bubble color — built via
   *  IdentityColor.colorMap by the caller). Optional: without it every bar/dot
   *  falls back to a neutral slate and the report stays fully renderable. */
  companyColors?: Record<number, string>;
  /** Optional @font-face CSS (Inter base64) injected into the document. */
  fontCss?: string;
}

function escapeHtml(v: unknown): string {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtMins(m: number): string {
  if (!Number.isFinite(m)) m = 0;   // D-306: NaN total_mins would print "NaNm"
  const h = Math.floor(m / 60), mn = m % 60;
  return h > 0 ? `${h}h ${String(mn).padStart(2, '0')}m` : `${mn}m`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

interface Aggregates {
  totalMins: number;
  sessionCount: number;
  byDate: Array<[string, number]>;
  /** date → (companyId → minutes) — feeds the stacked daily bars. */
  byDateCompany: Record<string, Record<number, number>>;
  byCompany: Array<[string, { mins: number; sessions: number; companyId: number }]>;
  byLabel: Array<[string, number]>;
}

// One aggregation pass shared by the HTML and CSV builders so they can never
// disagree about the numbers they present.
function aggregate(entries: ReportEntry[], companyNames: Record<number, string>): Aggregates {
  const byDate: Record<string, number> = {};
  const byDateCompany: Record<string, Record<number, number>> = {};
  const byCompany: Record<string, { mins: number; sessions: number; companyId: number }> = {};
  const byLabel: Record<string, number> = {};
  let totalMins = 0;

  for (const e of entries) {
    const mins = Number(e.total_mins || 0);
    totalMins += mins;
    const d = e.log_date || '';
    byDate[d] = (byDate[d] || 0) + mins;
    const cid = Number(e.company_id);
    (byDateCompany[d] || (byDateCompany[d] = {}))[cid] = (byDateCompany[d]?.[cid] || 0) + mins;
    const co = companyNames[cid] || '(unknown)';
    const c = byCompany[co] || (byCompany[co] = { mins: 0, sessions: 0, companyId: cid });
    c.mins += mins; c.sessions += 1;
    try {
      JSON.parse(e.rows_json || '[]').forEach((r: any) => {
        if (r && r.total_mins > 0) {
          const l = String(r.label || 'Other');
          byLabel[l] = (byLabel[l] || 0) + Number(r.total_mins);
        }
      });
    } catch {}
  }

  return {
    totalMins,
    sessionCount: entries.length,
    byDate: Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)),
    byDateCompany,
    byCompany: Object.entries(byCompany).sort((a, b) => b[1].mins - a[1].mins),
    byLabel: Object.entries(byLabel).sort((a, b) => b[1] - a[1]),
  };
}

// Inline vector-family hourglass mark (matches the v3.24.3 app icon) — no
// asset dependency, prints crisply at any DPI.
const HOURGLASS_SVG =
  '<svg width="26" height="26" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="6" y="0" width="52" height="10" rx="3" fill="#b8862e"/>' +
  '<rect x="6" y="54" width="52" height="10" rx="3" fill="#b8862e"/>' +
  '<path d="M12 10 h40 v6 c0 9 -9 14 -15 19 6 5 15 10 15 19 v6 h-40 v-6 c0 -9 9 -14 15 -19 -6 -5 -15 -10 -15 -19 z" fill="#d9b45a"/>' +
  '<path d="M20 14 h24 v3 c0 6 -7 10 -12 14 -5 -4 -12 -8 -12 -14 z" fill="#5b7fd4"/>' +
  '<path d="M32 36 l9 8 c2.5 2.5 3 5 3 8 h-24 c0 -3 0.5 -5.5 3 -8 z" fill="#5b7fd4"/></svg>';

// Print-safe fallback when the caller supplies no identity color for a company.
const NEUTRAL = '#94a3b8';

// Weekday prefix for the daily-bars axis ('2026-07-06' → 'Mon 07-06').
function dayLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${names[dt.getDay()]} ${m[2]}-${m[3]}`;
}

function buildEmailReportHTML(input: ReportInput): string {
  const { title, fromDate, toDate, coLabel, entries, companyNames, fontCss } = input;
  const colors = input.companyColors || {};
  const colorOf = (cid: number) => colors[cid] || NEUTRAL;
  const agg = aggregate(entries, companyNames);
  const daysWorked = agg.byDate.filter(([, m]) => m > 0).length;
  const maxDay = Math.max(1, ...agg.byDate.map(([, m]) => m));

  // Daily Hours — horizontal bars, stacked by company identity color when a
  // day spans several companies. Width is relative to the busiest day.
  const dateBars = agg.byDate.map(([d, m]) => {
    const segs = Object.entries(agg.byDateCompany[d] || {})
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([cid, cm]) =>
        `<div class="seg" style="width:${(Number(cm) / maxDay) * 100}%;background:${escapeHtml(colorOf(Number(cid)))}"></div>`)
      .join('');
    return `<div class="brow"><div class="bd mono">${escapeHtml(dayLabel(d))}</div>` +
      `<div class="btrack">${segs}</div><div class="bt mono">${fmtMins(m)}</div></div>`;
  }).join('');

  // Legend: companies in period order of weight, dot = identity color.
  const legend = agg.byCompany.map(([name, c]) =>
    `<span class="lg"><i style="background:${escapeHtml(colorOf(c.companyId))}"></i>${escapeHtml(name)}</span>`).join('');

  const companyRows = agg.byCompany
    .map(([name, c]) =>
      `<tr><td><i class="dot" style="background:${escapeHtml(colorOf(c.companyId))}"></i>${escapeHtml(name)}</td>` +
      `<td class="num mono">${c.sessions}</td><td class="num mono">${fmtMins(c.mins)}</td>` +
      `<td class="num"><div class="share"><div class="sbar"><div class="sfill" style="width:${pct(c.mins, agg.totalMins) === '—' ? 0 : Math.round((c.mins / agg.totalMins) * 100)}%;background:${escapeHtml(colorOf(c.companyId))}"></div></div><span class="mono">${pct(c.mins, agg.totalMins)}</span></div></td></tr>`)
    .join('');
  const labelRows = agg.byLabel
    .map(([l, m]) =>
      `<tr><td>${escapeHtml(l)}</td><td class="num mono">${fmtMins(m)}</td>` +
      `<td class="num"><div class="share"><div class="sbar"><div class="sfill" style="width:${agg.totalMins > 0 ? Math.round((m / agg.totalMins) * 100) : 0}%;background:#5b7fd4"></div></div><span class="mono">${pct(m, agg.totalMins)}</span></div></td></tr>`)
    .join('');

  const empty = '<tr><td colspan="4" class="empty">No time recorded in this period.</td></tr>';
  const emptyBars = '<div class="empty">No time recorded in this period.</div>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
${fontCss || ''}
:root{color-scheme:light;}
*{box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:12px;color:#1f2937;margin:0;padding:44px 48px;max-width:860px;margin:0 auto;background:#fff;}
.mono{font-variant-numeric:tabular-nums;}
.brand{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:3px solid #b8862e;}
.brand-left{display:flex;align-items:center;gap:10px;}
.wordmark{font-size:15px;font-weight:600;letter-spacing:3px;color:#141c2e;}
.wordmark span{color:#b8862e;}
.report-title{text-align:right;}
.report-title h1{font-size:19px;font-weight:600;margin:0;color:#141c2e;}
.report-title .period{font-size:11px;color:#64748b;margin-top:2px;}
.summary{display:flex;gap:10px;margin:20px 0 6px;}
.stat{flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}
.stat .v{font-size:17px;font-weight:600;color:#141c2e;}
.stat .k{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin-top:2px;}
h2{font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#b8862e;margin:26px 0 10px;}
.brow{display:flex;align-items:center;gap:10px;padding:3.5px 0;}
.bd{width:86px;font-size:11px;color:#475569;flex-shrink:0;}
.btrack{flex:1;height:13px;background:#f1f3f7;border-radius:4px;overflow:hidden;display:flex;}
.seg{height:100%;}
.bt{width:64px;text-align:right;font-size:11px;color:#141c2e;font-weight:600;flex-shrink:0;}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:10px;color:#64748b;}
.lg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;}
.share{display:flex;align-items:center;gap:8px;justify-content:flex-end;}
.sbar{width:70px;height:8px;background:#f1f3f7;border-radius:4px;overflow:hidden;}
.sfill{height:100%;border-radius:4px;}
table{width:100%;border-collapse:collapse;}
th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#475569;border-bottom:2px solid #b8862e;}
td{padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:11.5px;}
.num{text-align:right;}th.num{text-align:right;}
tr.total td{font-weight:600;background:#f8fafc;border-bottom:none;border-top:2px solid #cbd5e1;}
.empty{color:#94a3b8;text-align:center;padding:16px;}
.footer{margin-top:36px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9.5px;color:#94a3b8;}
.footer .conf{letter-spacing:1.5px;font-weight:600;color:#b8862e;}
</style></head><body>
<div class="brand">
  <div class="brand-left">${HOURGLASS_SVG}<div class="wordmark">CONQUERED <span>TIME</span></div></div>
  <div class="report-title"><h1>${escapeHtml(title)}</h1>
    <div class="period">${escapeHtml(fromDate)} → ${escapeHtml(toDate)} · ${escapeHtml(coLabel)}</div></div>
</div>
<div class="summary">
  <div class="stat"><div class="v mono">${fmtMins(agg.totalMins)}</div><div class="k">Total Time</div></div>
  <div class="stat"><div class="v mono">${daysWorked}</div><div class="k">Days Worked</div></div>
  <div class="stat"><div class="v mono">${agg.sessionCount}</div><div class="k">Sessions</div></div>
  <div class="stat"><div class="v mono">${agg.byCompany.length}</div><div class="k">Companies</div></div>
</div>
<h2>Daily Hours</h2>
<div class="bars">${dateBars || emptyBars}
<div class="legend">${legend}</div></div>
<h2>By Company</h2>
<table><thead><tr><th>Company</th><th class="num">Sessions</th><th class="num">Time</th><th class="num">Share</th></tr></thead>
<tbody>${companyRows || empty}</tbody></table>
<h2>Task Label Breakdown</h2>
<table><thead><tr><th>Task Label</th><th class="num">Time</th><th class="num">Share</th></tr></thead>
<tbody>${labelRows || empty}</tbody></table>
<div class="footer">
  <span>Generated by Conquered Time · ${escapeHtml(new Date().toLocaleString())}</span>
  <span class="conf">CONFIDENTIAL</span>
</div>
</body></html>`;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

// Quote every field, double embedded quotes, and neutralize CSV formula
// injection (leading = + - @ tab CR) by prefixing a single quote.
function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// Detail rows for the SCOPED entries, followed by a clearly-separated summary
// block (period totals, per-company, per-label) so the one attachment carries
// both the machine-readable detail and the human-readable totals.
function buildReportCSV(input: { entries: ReportEntry[]; companyNames: Record<number, string>; fromDate: string; toDate: string }): string {
  const { entries, companyNames, fromDate, toDate } = input;
  const agg = aggregate(entries, companyNames);

  const lines: string[][] = [];
  lines.push(['Date', 'Company', 'Session', 'Task Label', 'Task Name', 'Description', 'Clock In', 'Clock Out', 'Minutes']);
  for (const e of entries) {
    try {
      JSON.parse(e.rows_json || '[]').forEach((r: any) => {
        if (!rowHasContent(r)) return; // C3 (D-011): desc-only rows export too
        // Flatten multi-line descriptions so the CSV column stays single-line.
        const descFlat = String(r.desc || r.description || '').replace(/\s+/g, ' ').trim();
        lines.push([
          e.log_date || '', companyNames[Number(e.company_id)] || '', e.session_label || '',
          r.label || '', r.name || '', descFlat, r.clock_in || '', r.clock_out || '', String(r.total_mins || 0),
        ]);
      });
    } catch {}
  }

  lines.push([]);
  lines.push(['SUMMARY']);
  lines.push(['Period', `${fromDate} to ${toDate}`]);
  lines.push(['Total Minutes', String(agg.totalMins)]);
  lines.push(['Total Time', fmtMins(agg.totalMins)]);
  lines.push(['Sessions', String(agg.sessionCount)]);
  lines.push([]);
  lines.push(['BY COMPANY', 'Sessions', 'Minutes']);
  for (const [name, c] of agg.byCompany) lines.push([name, String(c.sessions), String(c.mins)]);
  lines.push([]);
  lines.push(['BY TASK LABEL', 'Minutes']);
  for (const [l, m] of agg.byLabel) lines.push([l, String(m)]);

  return lines.map(r => r.map(csvCell).join(',')).join('\n');
}

module.exports = { buildEmailReportHTML, buildReportCSV, aggregate, csvCell, escapeHtml, fmtMins };
