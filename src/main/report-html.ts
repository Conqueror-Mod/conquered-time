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
  /** Optional @font-face CSS (Inter base64) injected into the document. */
  fontCss?: string;
}

function escapeHtml(v: unknown): string {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtMins(m: number): string {
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
  byCompany: Array<[string, { mins: number; sessions: number }]>;
  byLabel: Array<[string, number]>;
}

// One aggregation pass shared by the HTML and CSV builders so they can never
// disagree about the numbers they present.
function aggregate(entries: ReportEntry[], companyNames: Record<number, string>): Aggregates {
  const byDate: Record<string, number> = {};
  const byCompany: Record<string, { mins: number; sessions: number }> = {};
  const byLabel: Record<string, number> = {};
  let totalMins = 0;

  for (const e of entries) {
    const mins = Number(e.total_mins || 0);
    totalMins += mins;
    const d = e.log_date || '';
    byDate[d] = (byDate[d] || 0) + mins;
    const co = companyNames[Number(e.company_id)] || '(unknown)';
    const c = byCompany[co] || (byCompany[co] = { mins: 0, sessions: 0 });
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
    byCompany: Object.entries(byCompany).sort((a, b) => b[1].mins - a[1].mins),
    byLabel: Object.entries(byLabel).sort((a, b) => b[1] - a[1]),
  };
}

// Inline hourglass mark — no asset dependency, prints crisply at any DPI.
const HOURGLASS_SVG =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M6 2h12v2.5c0 2.6-2.1 4.8-4.2 6.6l-1 .9 1 .9c2.1 1.8 4.2 4 4.2 6.6V22H6v-2.5c0-2.6 2.1-4.8 4.2-6.6l1-.9-1-.9C8.1 9.3 6 7.1 6 4.5V2z" ' +
  'stroke="#0d9488" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M8.5 19.5c.7-1.9 2-3.1 3.5-3.1s2.8 1.2 3.5 3.1z" fill="#0d9488"/></svg>';

function buildEmailReportHTML(input: ReportInput): string {
  const { title, fromDate, toDate, coLabel, entries, companyNames, fontCss } = input;
  const agg = aggregate(entries, companyNames);
  const daysWorked = agg.byDate.filter(([, m]) => m > 0).length;

  const dateRows = agg.byDate
    .map(([d, m]) => `<tr><td class="mono">${escapeHtml(d)}</td><td class="num mono">${fmtMins(m)}</td></tr>`)
    .join('');
  const companyRows = agg.byCompany
    .map(([name, c]) =>
      `<tr><td>${escapeHtml(name)}</td><td class="num mono">${c.sessions}</td><td class="num mono">${fmtMins(c.mins)}</td><td class="num mono">${pct(c.mins, agg.totalMins)}</td></tr>`)
    .join('');
  const labelRows = agg.byLabel
    .map(([l, m]) =>
      `<tr><td>${escapeHtml(l)}</td><td class="num mono">${fmtMins(m)}</td><td class="num mono">${pct(m, agg.totalMins)}</td></tr>`)
    .join('');

  const empty = '<tr><td colspan="4" class="empty">No time recorded in this period.</td></tr>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
${fontCss || ''}
:root{color-scheme:light;}
*{box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:12px;color:#1f2937;margin:0;padding:44px 48px;max-width:860px;margin:0 auto;background:#fff;}
.mono{font-variant-numeric:tabular-nums;}
.brand{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:3px solid #0d9488;}
.brand-left{display:flex;align-items:center;gap:10px;}
.wordmark{font-size:15px;font-weight:600;letter-spacing:3px;color:#0f172a;}
.wordmark span{color:#0d9488;}
.report-title{text-align:right;}
.report-title h1{font-size:19px;font-weight:600;margin:0;color:#0f172a;}
.report-title .period{font-size:11px;color:#64748b;margin-top:2px;}
.summary{display:flex;gap:10px;margin:20px 0 6px;}
.stat{flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}
.stat .v{font-size:17px;font-weight:600;color:#0f172a;}
.stat .k{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin-top:2px;}
h2{font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#0d9488;margin:26px 0 8px;}
table{width:100%;border-collapse:collapse;}
th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#475569;border-bottom:2px solid #0d9488;}
td{padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:11.5px;}
.num{text-align:right;}th.num{text-align:right;}
tr.total td{font-weight:600;background:#f8fafc;border-bottom:none;border-top:2px solid #cbd5e1;}
.empty{color:#94a3b8;text-align:center;padding:16px;}
.footer{margin-top:36px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9.5px;color:#94a3b8;}
.footer .conf{letter-spacing:1.5px;font-weight:600;}
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
<table><thead><tr><th>Date</th><th class="num">Time</th></tr></thead>
<tbody>${dateRows || empty}
<tr class="total"><td>Total</td><td class="num mono">${fmtMins(agg.totalMins)}</td></tr></tbody></table>
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
