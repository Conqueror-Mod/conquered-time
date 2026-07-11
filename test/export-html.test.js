'use strict';

// Unit tests for the branded in-app export builders (src/renderer/export-html.js).
// Pure functions, no DOM — required directly like row-utils/report-html.

const { test } = require('node:test');
const assert   = require('node:assert');
const EH = require('../src/renderer/export-html.js');

const ROWS = [
  { label: 'Work',  name: 'Alpha', desc: 'first task',  clock_in: '09:00', clock_out: '11:00', total_mins: 120 },
  { label: 'Admin', name: 'Beta',  desc: 'second task', clock_in: '11:00', clock_out: '11:45', total_mins: 45 },
];

function sessionInput(over = {}) {
  return Object.assign({
    companyName: 'Zenith Analytics', hier: 'Zenith › Diamond › multimango',
    metaLines: ['Annotation Specialist', 'Location: Remote — USA'],
    dateLabel: '2026-07-10', sessionLabel: 'Morning block',
    rows: ROWS, totalMins: 165, fontCss: '/*font*/',
  }, over);
}

test('session export carries the shared brand identity', () => {
  const html = EH.buildSessionExportHTML(sessionInput());
  assert.match(html, /CONQUERED <span>TIME<\/span>/, 'wordmark present');
  assert.match(html, /#0d9488/, 'teal brand accent');
  assert.match(html, /CONFIDENTIAL/, 'confidential footer');
  assert.match(html, /\/\*font\*\//, 'caller font CSS injected');
  assert.match(html, /Timesheet/, 'title');
});

test('session export renders detail rows, totals, and stat band', () => {
  const html = EH.buildSessionExportHTML(sessionInput());
  assert.match(html, /Alpha/); assert.match(html, /Beta/);
  assert.match(html, /2h 45m/, 'total 165m formatted');
  assert.match(html, /09:00/, 'first clock-in stat');
  assert.match(html, /11:45/, 'last clock-out stat');
  assert.match(html, /Total Time/); assert.match(html, /Tasks/);
});

test('label breakdown appears only with >=2 distinct labels', () => {
  const two = EH.buildSessionExportHTML(sessionInput());
  assert.match(two, /Time by Label/);
  const one = EH.buildSessionExportHTML(sessionInput({
    rows: [ROWS[0], { ...ROWS[1], label: 'Work' }],
  }));
  assert.doesNotMatch(one, /Time by Label/);
});

test('user content is HTML-escaped in every sink', () => {
  const html = EH.buildSessionExportHTML(sessionInput({
    companyName: '<img src=x onerror=alert(1)>',
    sessionLabel: '<script>bad()</script>',
    rows: [{ label: '<b>L</b>', name: 'N', desc: '"quoted" & <i>desc</i>', clock_in: '09:00', clock_out: '10:00', total_mins: 60 }],
  }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.doesNotMatch(html, /<b>L<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('multi-session export: per-session blocks + aggregate stat band', () => {
  const html = EH.buildLogExportHTML({
    companyName: 'Zenith Analytics', hier: 'Zenith › Diamond',
    metaLines: ['Annotation Specialist'],
    fromDate: '2026-07-01', toDate: '2026-07-10',
    sessions: [
      { dateLabel: '2026-07-01', sessionLabel: 'S1', rows: ROWS, totalMins: 165 },
      { dateLabel: '2026-07-02', sessionLabel: '',   rows: [ROWS[0]], totalMins: 120 },
    ],
    grandTotalMins: 285, fontCss: '',
  });
  assert.match(html, /Timesheet Report/);
  assert.match(html, /2026-07-01 → 2026-07-10/);
  assert.match(html, /4h 45m/, 'grand total 285m');
  assert.match(html, /Grand Total/); assert.match(html, /Sessions/); assert.match(html, /Days/);
  assert.strictEqual((html.match(/session-block/g) || []).length >= 2, true, 'two session blocks');
  assert.match(html, /Session Total/);
  assert.match(html, /Time by Label/, 'cross-session label rollup (2 labels)');
});

test('NavID never appears even if passed inside meta by mistake is caller-side; builder adds none', () => {
  // The builder has no navId input at all — assert the output of a normal build
  // contains no nav-id-shaped artifacts from the fixture company.
  const html = EH.buildSessionExportHTML(sessionInput());
  assert.doesNotMatch(html, /nav[_-]?id/i);
});

test('fmtMins formats hours/minutes and zero', () => {
  assert.strictEqual(EH.fmtMins(0), '0m');
  assert.strictEqual(EH.fmtMins(59), '59m');
  assert.strictEqual(EH.fmtMins(60), '1h 00m');
  assert.strictEqual(EH.fmtMins(165), '2h 45m');
});
