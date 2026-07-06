'use strict';

// Unit tests for the shared emailed-report builders (src/main/report-html.ts,
// compiled to dist-main). Covers the redesign contract: branded HTML with
// every user string escaped (the seed's XSS canary class), aggregation math
// shared between PDF and CSV, the scoped CSV + summary block, and the
// formula-injection guard carried over from the old inline builder.

const { test } = require('node:test');
const assert   = require('node:assert');
const { buildEmailReportHTML, buildReportCSV, aggregate, csvCell } = require('../dist-main/main/report-html.js');

const companyNames = { 1: 'Zenith Analytics', 2: '<script>alert(1)</script> & "Sons"' };

const entries = [
  { id: 10, company_id: 1, log_date: '2026-07-01', session_label: 'Day A', total_mins: 120,
    rows_json: JSON.stringify([
      { label: 'QA', name: 'Suite', desc: 'line one\nline two', total_mins: 90, clock_in: '09:00', clock_out: '10:30' },
      { label: 'Admin', name: '', desc: '', total_mins: 30, clock_in: '10:30', clock_out: '11:00' },
      { label: '', name: '', desc: '', total_mins: 0, clock_in: '', clock_out: '' }, // blank — excluded
    ]) },
  { id: 11, company_id: 2, log_date: '2026-07-02', session_label: '=HYPERLINK("evil")', total_mins: 60,
    rows_json: JSON.stringify([
      { label: '<img src=x onerror=alert(1)>', name: '=1+1', desc: 'desc-only rows export too', total_mins: 60, clock_in: '08:00', clock_out: '09:00' },
    ]) },
  { id: 12, company_id: 1, log_date: '2026-07-02', session_label: 'corrupt', total_mins: 45, rows_json: '{not json' },
];

const input = { title: 'Period Report', fromDate: '2026-07-01', toDate: '2026-07-07', coLabel: 'All Companies', entries, companyNames };

test('aggregate: one shared pass drives both HTML and CSV numbers', () => {
  const agg = aggregate(entries, companyNames);
  assert.strictEqual(agg.totalMins, 225);                 // 120 + 60 + 45
  assert.strictEqual(agg.sessionCount, 3);
  assert.deepStrictEqual(agg.byDate, [['2026-07-01', 120], ['2026-07-02', 105]]);
  assert.strictEqual(agg.byCompany[0][0], 'Zenith Analytics');   // 165m, sorted first
  assert.deepStrictEqual(agg.byCompany[0][1], { mins: 165, sessions: 2 });
  // Labels come from row-level minutes; corrupt rows_json contributes none.
  assert.deepStrictEqual(agg.byLabel, [['QA', 90], ['<img src=x onerror=alert(1)>', 60], ['Admin', 30]]);
});

test('HTML: branded, summary stats, and every user string escaped', () => {
  const html = buildEmailReportHTML(input);
  assert.match(html, /CONQUERED <span>TIME<\/span>/, 'wordmark present');
  assert.match(html, /2026-07-01 → 2026-07-07/, 'period line');
  assert.match(html, /3h 45m/, 'total time formatted');
  assert.match(html, /Days Worked/, 'summary band');
  assert.match(html, /By Company/, 'company breakdown section');
  // XSS canary class: raw company name / label must never reach the HTML.
  assert.ok(!html.includes('<script>alert(1)</script>'), 'company name escaped');
  assert.ok(!html.includes('<img src=x'), 'label escaped');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Sons&quot;'));
});

test('HTML: empty period renders placeholders, not broken tables', () => {
  const html = buildEmailReportHTML({ ...input, entries: [] });
  assert.match(html, /No time recorded in this period\./);
  assert.match(html, /0m/, 'zero total');
});

test('CSV: detail rows scoped to the given entries + summary block', () => {
  const csv = buildReportCSV({ entries, companyNames, fromDate: '2026-07-01', toDate: '2026-07-07' });
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], '"Date","Company","Session","Task Label","Task Name","Description","Clock In","Clock Out","Minutes"');
  // 3 content rows (blank row excluded, corrupt entry contributes none).
  assert.strictEqual(lines.filter(l => l.startsWith('"2026-07-')).length, 3);
  // Multi-line description flattened.
  assert.ok(csv.includes('"line one line two"'));
  // Summary block present with the same totals as aggregate().
  assert.ok(csv.includes('"SUMMARY"'));
  assert.ok(csv.includes('"Total Minutes","225"'));
  assert.ok(csv.includes('"BY COMPANY","Sessions","Minutes"'));
  assert.ok(csv.includes('"Zenith Analytics","2","165"'));
  assert.ok(csv.includes('"BY TASK LABEL","Minutes"'));
  assert.ok(csv.includes('"QA","90"'));
});

test('CSV: formula injection neutralized, quotes doubled', () => {
  assert.strictEqual(csvCell('=1+1'), '"\'=1+1"');
  assert.strictEqual(csvCell('+SUM(A1)'), '"\'+SUM(A1)"');
  assert.strictEqual(csvCell('-2'), '"\'-2"');
  assert.strictEqual(csvCell('@cmd'), '"\'@cmd"');
  assert.strictEqual(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.strictEqual(csvCell(null), '""');
  const csv = buildReportCSV({ entries, companyNames, fromDate: '2026-07-01', toDate: '2026-07-07' });
  assert.ok(csv.includes(`"'=HYPERLINK(""evil"")"`), 'session label neutralized');
  assert.ok(csv.includes(`"'=1+1"`), 'task name neutralized');
});

test('CSV: desc-only rows are included (C3/D-011 contract)', () => {
  const descOnly = [{ id: 1, company_id: 1, log_date: '2026-07-03', session_label: 'S', total_mins: 0,
    rows_json: JSON.stringify([{ label: '', name: '', desc: 'only a description', total_mins: 0, clock_in: '', clock_out: '' }]) }];
  const csv = buildReportCSV({ entries: descOnly, companyNames, fromDate: '2026-07-03', toDate: '2026-07-03' });
  assert.ok(csv.includes('"only a description"'));
});
