'use strict';

// Shared in-app export (PDF-HTML) builders — the tracker session export, the
// Global Log per-session export, and the Global Log export-all all render
// through these, so every locally-exported timesheet carries the same branded
// identity as the emailed report (src/main/report-html.ts, v3.14): teal accent,
// hourglass + wordmark brand bar, summary stat band, uppercase section heads,
// CONFIDENTIAL footer. Unlike the emailed report (aggregate-only), these keep
// the ROW-LEVEL task detail — that's the whole point of a timesheet handed to
// a supervisor.
//
// Rules preserved from the old per-page builders: NavIDs never appear in any
// export; clock times stay raw 24h HH:MM (display 12/24h pref is on-screen
// only); multi-line descriptions are flattened by the caller.
//
// Pure + UMD-ish (window.ExportHtml / require()-able) so the layout is
// unit-testable without a DOM (test/export-html.test.js).
(function (root) {

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** @param {number} m */
  function fmtMins(m) {
    if (!m || m <= 0) return '0m';
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? `${h}h ${String(mn).padStart(2, '0')}m` : `${mn}m`;
  }

  // Same inline hourglass mark as report-html.ts — no asset dependency.
  const HOURGLASS_SVG =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6 2h12v2.5c0 2.6-2.1 4.8-4.2 6.6l-1 .9 1 .9c2.1 1.8 4.2 4 4.2 6.6V22H6v-2.5c0-2.6 2.1-4.8 4.2-6.6l1-.9-1-.9C8.1 9.3 6 7.1 6 4.5V2z" ' +
    'stroke="#0d9488" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M8.5 19.5c.7-1.9 2-3.1 3.5-3.1s2.8 1.2 3.5 3.1z" fill="#0d9488"/></svg>';

  // Shared stylesheet — visually identical to the emailed template's, plus the
  // detail-table and session-block styles the in-app timesheets need.
  const BASE_CSS = `
:root{color-scheme:light;}
*{box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:12px;color:#1f2937;margin:0 auto;padding:44px 48px;max-width:920px;background:#fff;}
.mono{font-variant-numeric:tabular-nums;}
.brand{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:3px solid #0d9488;}
.brand-left{display:flex;align-items:center;gap:10px;}
.wordmark{font-size:15px;font-weight:600;letter-spacing:3px;color:#0f172a;}
.wordmark span{color:#0d9488;}
.report-title{text-align:right;}
.report-title h1{font-size:19px;font-weight:600;margin:0;color:#0f172a;}
.report-title .period{font-size:11px;color:#64748b;margin-top:2px;}
.meta-block{margin-top:14px;}
.meta-name{font-size:15px;font-weight:600;color:#0f172a;}
.meta-hier{font-size:11px;color:#0d9488;font-weight:500;margin-top:2px;}
.meta{font-size:11px;color:#64748b;margin-top:2px;}
.summary{display:flex;gap:10px;margin:18px 0 6px;}
.stat{flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}
.stat .v{font-size:17px;font-weight:600;color:#0f172a;}
.stat .k{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin-top:2px;}
h2{font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#0d9488;margin:26px 0 8px;}
table{width:100%;border-collapse:collapse;}
th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#475569;border-bottom:2px solid #0d9488;}
td{padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:11.5px;vertical-align:top;}
.num{text-align:right;}th.num{text-align:right;}
tr.total td{font-weight:600;background:#f8fafc;border-bottom:none;border-top:2px solid #cbd5e1;}
.label-table{width:300px;}
.session-block{margin-top:24px;page-break-inside:avoid;}
.session-head{font-size:11.5px;font-weight:600;color:#0f172a;padding-bottom:4px;border-bottom:2px solid #0d9488;margin-bottom:0;display:flex;justify-content:space-between;}
.session-head .s-total{color:#0d9488;font-variant-numeric:tabular-nums;}
.footer{margin-top:36px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9.5px;color:#94a3b8;}
.footer .conf{letter-spacing:1.5px;font-weight:600;}
@media print{body{padding:24px 28px;}}
`;

  function brandBar(title, periodLine) {
    return `<div class="brand">
  <div class="brand-left">${HOURGLASS_SVG}<div class="wordmark">CONQUERED <span>TIME</span></div></div>
  <div class="report-title"><h1>${escapeHtml(title)}</h1>
    <div class="period">${escapeHtml(periodLine)}</div></div>
</div>`;
  }

  // Company header block (name, hierarchy breadcrumb, meta lines). `meta` is a
  // list of already-composed plain strings (escaped here).
  function metaBlock(name, hier, metaLines) {
    return `<div class="meta-block">
  <div class="meta-name">${escapeHtml(name || 'Timesheet')}</div>
  ${hier ? `<div class="meta-hier">${escapeHtml(hier)}</div>` : ''}
  ${(metaLines || []).filter(Boolean).map(l => `<div class="meta">${escapeHtml(l)}</div>`).join('\n  ')}
</div>`;
  }

  function statBand(stats) {
    return `<div class="summary">
  ${stats.map(s => `<div class="stat"><div class="v mono">${escapeHtml(s.v)}</div><div class="k">${escapeHtml(s.k)}</div></div>`).join('\n  ')}
</div>`;
  }

  // rows: [{label,name,desc,clock_in,clock_out,total_mins}] — desc already flattened.
  function detailTable(rows, totalLabel, totalMins) {
    const body = rows.map((r, i) => `<tr>
      <td class="mono">${String(i + 1).padStart(2, '0')}</td>
      <td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.desc)}</td>
      <td class="mono">${escapeHtml(r.clock_in || '')}</td><td class="mono">${escapeHtml(r.clock_out || '')}</td>
      <td class="num mono">${r.total_mins > 0 ? fmtMins(r.total_mins) : '—'}</td>
    </tr>`).join('');
    return `<table>
  <thead><tr><th>#</th><th>Label</th><th>Name</th><th>Description</th><th>Clock In</th><th>Clock Out</th><th class="num">Duration</th></tr></thead>
  <tbody>${body}
  <tr class="total"><td colspan="6" style="text-align:right;">${escapeHtml(totalLabel)}</td><td class="num mono">${fmtMins(totalMins)}</td></tr></tbody>
</table>`;
  }

  // Per-label rollup from row objects; sorted by minutes desc.
  function labelBreakdown(rows) {
    const map = {};
    rows.forEach(r => {
      if (r && r.label) map[r.label] = (map[r.label] || 0) + (Number(r.total_mins) || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  // Rendered only when there are ≥2 distinct labels (single-label = noise).
  function labelTable(rows, totalMins) {
    const bd = labelBreakdown(rows);
    if (bd.length < 2) return '';
    const body = bd.map(([lbl, mins]) =>
      `<tr><td>${escapeHtml(lbl)}</td><td class="num mono">${fmtMins(mins)}</td><td class="num mono">${totalMins > 0 ? Math.round((mins / totalMins) * 100) + '%' : '—'}</td></tr>`).join('');
    return `<h2>Time by Label</h2>
<table class="label-table"><thead><tr><th>Label</th><th class="num">Time</th><th class="num">Share</th></tr></thead>
<tbody>${body}</tbody></table>`;
  }

  function footer() {
    return `<div class="footer">
  <span>Generated by Conquered Time · ${escapeHtml(new Date().toLocaleString())}</span>
  <span class="conf">CONFIDENTIAL</span>
</div>`;
  }

  function docShell(title, fontCss, bodyHtml) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${fontCss || ''}</style>
<style>${BASE_CSS}</style></head><body>
${bodyHtml}
${footer()}
</body></html>`;
  }

  /**
   * Single-session timesheet (tracker export + Global Log per-session PDF).
   * input: { companyName, hier, metaLines:[], dateLabel, sessionLabel,
   *          rows:[{label,name,desc,clock_in,clock_out,total_mins}],
   *          totalMins, fontCss }
   */
  function buildSessionExportHTML(input) {
    const rows = input.rows || [];
    const clocked = rows.filter(r => r.clock_in);
    const firstIn = clocked.length ? clocked[0].clock_in : '—';
    const outs = rows.filter(r => r.clock_out).map(r => r.clock_out);
    const lastOut = outs.length ? outs[outs.length - 1] : '—';

    const body = [
      brandBar('Timesheet', `${input.dateLabel}${input.sessionLabel ? ' · ' + input.sessionLabel : ''}`),
      metaBlock(input.companyName, input.hier, input.metaLines),
      statBand([
        { v: fmtMins(input.totalMins), k: 'Total Time' },
        { v: String(rows.length), k: 'Tasks' },
        { v: firstIn, k: 'First Clock-In' },
        { v: lastOut, k: 'Last Clock-Out' },
      ]),
      '<h2>Task Detail</h2>',
      detailTable(rows, 'Total', input.totalMins),
      labelTable(rows, input.totalMins),
    ].join('\n');
    return docShell('Timesheet', input.fontCss, body);
  }

  /**
   * Multi-session export (Global Log "Export All PDF", company-scoped).
   * input: { companyName, hier, metaLines:[], fromDate, toDate,
   *          sessions:[{dateLabel, sessionLabel, rows, totalMins}],
   *          grandTotalMins, fontCss }
   */
  function buildLogExportHTML(input) {
    const sessions = input.sessions || [];
    const allRows = [];
    sessions.forEach(s => (s.rows || []).forEach(r => allRows.push(r)));
    const days = new Set(sessions.map(s => s.dateLabel)).size;

    const blocks = sessions.map(s => `<div class="session-block">
  <div class="session-head"><span>${escapeHtml(s.dateLabel)}${s.sessionLabel ? ' · ' + escapeHtml(s.sessionLabel) : ''}</span><span class="s-total">${fmtMins(s.totalMins)}</span></div>
  ${detailTable(s.rows || [], 'Session Total', s.totalMins)}
</div>`).join('\n');

    const body = [
      brandBar('Timesheet Report', `${input.fromDate} → ${input.toDate}`),
      metaBlock(input.companyName, input.hier, input.metaLines),
      statBand([
        { v: fmtMins(input.grandTotalMins), k: 'Grand Total' },
        { v: String(sessions.length), k: 'Sessions' },
        { v: String(days), k: 'Days' },
        { v: String(allRows.length), k: 'Tasks' },
      ]),
      labelTable(allRows, input.grandTotalMins),
      '<h2>Sessions</h2>',
      blocks,
    ].join('\n');
    return docShell('Timesheet Report', input.fontCss, body);
  }

  const api = { buildSessionExportHTML, buildLogExportHTML, labelBreakdown, fmtMins, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExportHtml = api;
})(this);
