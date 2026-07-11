'use strict';

// Unit tests for the Insights aggregation helpers (src/renderer/insights-compute.js).
// Pure functions, no DOM — required directly like row-utils/time-parse.

const { test } = require('node:test');
const assert   = require('node:assert');
const IC = require('../src/renderer/insights-compute.js');

const E = (log_date, total_mins, company_id, rows = []) => ({ log_date, total_mins, company_id, rows });

test('filterByRange keeps entries on/after the cutoff; empty cutoff keeps all', () => {
  const es = [E('2026-01-01', 60, 1), E('2026-06-15', 60, 1), E('2026-07-10', 60, 1)];
  assert.strictEqual(IC.filterByRange(es, '2026-06-15').length, 2);
  assert.strictEqual(IC.filterByRange(es, '').length, 3);
  assert.strictEqual(IC.filterByRange(es, null).length, 3);
});

test('sumMins and byCompany aggregate minutes', () => {
  const es = [E('2026-07-01', 60, 1), E('2026-07-02', 30, 2), E('2026-07-03', 90, 1)];
  assert.strictEqual(IC.sumMins(es), 180);
  assert.deepStrictEqual(IC.byCompany(es), { 1: 150, 2: 30 });
});

test('byDayOfWeek buckets by LOCAL weekday (Sun=0)', () => {
  // 2026-07-06 is a Monday, 2026-07-11 is a Saturday.
  const es = [E('2026-07-06', 120, 1), E('2026-07-11', 60, 1), E('2026-07-06', 30, 2)];
  const dow = IC.byDayOfWeek(es);
  assert.strictEqual(dow[1], 150, 'Monday total');   // 120 + 30
  assert.strictEqual(dow[6], 60,  'Saturday total');
  assert.strictEqual(dow[0], 0,   'Sunday empty');
});

test('byHourOfDay distributes punched minutes across the hours spanned', () => {
  // 09:00 → 11:30 = 60 min in hour 9, 60 in hour 10, 30 in hour 11.
  const es = [E('2026-07-06', 150, 1, [{ clock_in: '09:00', clock_out: '11:30' }])];
  const h = IC.byHourOfDay(es);
  assert.strictEqual(h[9], 60);
  assert.strictEqual(h[10], 60);
  assert.strictEqual(h[11], 30);
  assert.strictEqual(h[8], 0);
});

test('byHourOfDay wraps overnight rows past midnight and skips unpunched rows', () => {
  const es = [E('2026-07-06', 0, 1, [
    { clock_in: '23:30', clock_out: '00:30' },  // 30 min in hr23, 30 in hr0
    { clock_in: '10:00' },                       // no clock_out — skipped
    { label: 'desc only' },                      // no times — skipped
  ])];
  const h = IC.byHourOfDay(es);
  assert.strictEqual(h[23], 30);
  assert.strictEqual(h[0], 30);
  assert.strictEqual(h[10], 0);
});

test('earningsByCompany multiplies hours by rate, skipping rate-less companies', () => {
  const es = [E('2026-07-01', 120, 1), E('2026-07-02', 90, 2), E('2026-07-03', 60, 3)];
  const earn = IC.earningsByCompany(es, { 1: 30, 2: 0, 3: 40 });
  assert.strictEqual(earn[1], 60);   // 2h × 30
  assert.strictEqual(earn[3], 40);   // 1h × 40
  assert.ok(!(2 in earn), 'rate 0 → excluded');
});

test('trendBuckets(month) fills empty months between first and last', () => {
  const es = [E('2026-01-10', 60, 1), E('2026-03-05', 120, 1)];
  const b = IC.trendBuckets(es, 'month');
  assert.deepStrictEqual(b.map(x => x.key), ['2026-01', '2026-02', '2026-03']);
  assert.deepStrictEqual(b.map(x => x.mins), [60, 0, 120]);
});

test('trendBuckets(week) buckets by local Monday and fills the gap', () => {
  // 2026-07-06 (Mon) and 2026-07-20 (Mon) — one empty week between.
  const es = [E('2026-07-07', 60, 1), E('2026-07-20', 30, 1)];
  const b = IC.trendBuckets(es, 'week');
  assert.deepStrictEqual(b.map(x => x.key), ['2026-07-06', '2026-07-13', '2026-07-20']);
  assert.deepStrictEqual(b.map(x => x.mins), [60, 0, 30]);
});

test('trendBuckets on empty input returns []', () => {
  assert.deepStrictEqual(IC.trendBuckets([], 'week'), []);
});

test('movingAverage is a trailing mean over the window', () => {
  assert.deepStrictEqual(IC.movingAverage([2, 4, 6], 1), [2, 4, 6]);
  assert.deepStrictEqual(IC.movingAverage([2, 4, 6, 8], 2), [2, 3, 5, 7]);
  // window larger than index → mean of everything so far
  assert.deepStrictEqual(IC.movingAverage([3, 5, 10], 5), [3, 4, 6]);
});
