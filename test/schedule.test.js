'use strict';

// Unit + property tests for the recurring-schedule helpers (src/renderer/schedule.js).

const { test } = require('node:test');
const assert   = require('node:assert');
const fc       = require('fast-check');
const S = require('../src/renderer/schedule.js');

const TODAY = '2026-10-23';            // a Friday
const SUNDAY = '2026-10-18';           // start of TODAY's Sun–Sat week

const shift = (cid, date, inT, outT, label = 'QA', name = 'Shift') =>
  ({ company_id: cid, log_date: date, total_mins: 0, rows: [{ label, name, clock_in: inT, clock_out: outT }] });
const jit = (t, d) => S.fromMin(S.toMin(t) + d);

// Chris's example: Mon 14:00–17:00, Wed–Fri 09:00–12:00, over 8 weeks, with
// ±10-min punch jitter, one missed Wednesday, and one extra Saturday shift.
function exampleHistory() {
  const es = [];
  for (let w = 0; w < 8; w++) {
    const sun = S.addDays(SUNDAY, -7 * w);
    const j = [-10, 5, 0, 10, -5, 8, -8, 3][w];
    es.push(shift(1, S.addDays(sun, 1), jit('14:00', j), jit('17:00', -j)));      // Mon
    for (const off of [3, 4, 5]) {                                                // Wed–Fri
      const date = S.addDays(sun, off);
      if (date > TODAY) continue;
      if (w === 3 && off === 3) continue;                                         // missed Wed
      es.push(shift(1, date, jit('09:00', j), jit('12:00', j)));
    }
  }
  es.push(shift(1, S.addDays(SUNDAY, -8), '10:00', '15:00'));                      // one extra Sat
  return es;
}

test('detects the Mon 14–17 / Wed–Fri 9–12 example through noise', () => {
  const slots = S.detectSchedule(exampleHistory(), { today: TODAY });
  const got = slots.map(s => `${s.weekday} ${s.start}-${s.end}`);
  assert.deepStrictEqual(got, ['1 14:00-17:00', '3 09:00-12:00', '4 09:00-12:00', '5 09:00-12:00']);
  const wed = slots.find(s => s.weekday === 3);
  assert.strictEqual(wed.weeksSeen, 7);
  assert.strictEqual(wed.weeksTotal, 8);
  assert.strictEqual(wed.label, 'QA');
  assert.strictEqual(wed.name, 'Shift');
  assert.strictEqual(wed.mins, 180);
});

test('a one-off extra shift is not a pattern', () => {
  const slots = S.detectSchedule(exampleHistory(), { today: TODAY });
  assert.ok(!slots.some(s => s.weekday === 6));
});

test('day span merges a mid-shift break into one slot', () => {
  const es = [];
  for (let w = 0; w < 4; w++) {
    const mon = S.addDays(SUNDAY, 1 - 7 * w);
    es.push({ company_id: 2, log_date: mon, rows: [
      { label: 'A', name: 'B', clock_in: '09:00', clock_out: '10:30' },
      { label: 'A', name: 'B', clock_in: '10:45', clock_out: '12:00' },
    ] });
  }
  const slots = S.detectSchedule(es, { today: TODAY });
  assert.deepStrictEqual(slots.map(s => `${s.start}-${s.end}`), ['09:00-12:00']);
});

test("today's not-yet-worked shift is not counted as a miss", () => {
  // Fri pattern for 3 prior weeks; today (Fri) not logged yet → 3/3, not 3/4.
  const es = [1, 2, 3].map(w => shift(3, S.addDays(TODAY, -7 * w), '09:00', '12:00'));
  const [slot] = S.detectSchedule(es, { today: TODAY });
  assert.strictEqual(slot.weeksTotal, 3);
});

test('a pattern that stopped falls below the ratio and is dropped', () => {
  // Tuesdays for weeks 8..5 ago, then nothing for 4 weeks → 4/8 = 50%.
  const es = [4, 5, 6, 7].map(w => shift(4, S.addDays(SUNDAY, 2 - 7 * w), '13:00', '15:00'));
  assert.deepStrictEqual(S.detectSchedule(es, { today: TODAY }), []);
});

test('scheduleDiffers ignores labels, catches time changes', () => {
  const a = [{ weekday: 1, start: '09:00', end: '12:00', label: 'x' }];
  assert.strictEqual(S.scheduleDiffers(a, [{ weekday: 1, start: '09:00', end: '12:00', label: 'y' }]), false);
  assert.strictEqual(S.scheduleDiffers(a, [{ weekday: 1, start: '09:00', end: '13:00' }]), true);
  assert.strictEqual(S.scheduleDiffers(a, []), true);
});

// ── Pay periods ──────────────────────────────────────────────────────────────
test('periodFor: weekly defaults to Sun–Sat, or the anchor weekday', () => {
  assert.deepStrictEqual(S.periodFor(TODAY, null), { start: '2026-10-18', end: '2026-10-24' });
  assert.deepStrictEqual(S.periodFor(TODAY, { kind: 'weekly', anchor: '2026-01-05' }), // a Monday
    { start: '2026-10-19', end: '2026-10-25' });
});

test('periodFor: biweekly counts 14-day blocks from the anchor, both directions', () => {
  const pp = { kind: 'biweekly', anchor: '2026-10-05' };
  assert.deepStrictEqual(S.periodFor('2026-10-05', pp), { start: '2026-10-05', end: '2026-10-18' });
  assert.deepStrictEqual(S.periodFor('2026-10-19', pp), { start: '2026-10-19', end: '2026-11-01' });
  assert.deepStrictEqual(S.periodFor('2026-10-04', pp), { start: '2026-09-21', end: '2026-10-04' });
  // Across the US DST change (Nov 1 2026) — still exact days.
  assert.deepStrictEqual(S.periodFor('2026-11-10', pp), { start: '2026-11-02', end: '2026-11-15' });
});

test('periodFor: semimonthly and monthly handle month ends and leap day', () => {
  assert.deepStrictEqual(S.periodFor('2028-02-20', { kind: 'semimonthly' }), { start: '2028-02-16', end: '2028-02-29' });
  assert.deepStrictEqual(S.periodFor('2026-02-15', { kind: 'semimonthly' }), { start: '2026-02-01', end: '2026-02-15' });
  assert.deepStrictEqual(S.periodFor('2026-12-31', { kind: 'monthly' }), { start: '2026-12-01', end: '2026-12-31' });
});

// ── Applying a saved schedule ────────────────────────────────────────────────
const CO = {
  id: 7, name: 'Acme',
  schedule: S.makeSchedule([
    { weekday: 1, start: '14:00', end: '17:00', label: 'QA', name: 'Shift' },
    { weekday: 3, start: '09:00', end: '12:00', label: 'QA', name: 'Shift' },
    { weekday: 5, start: '09:00', end: '12:00', label: 'QA', name: 'Shift' },
  ], null, '2026-10-21'),   // saved on a Wed → since = Sun 2026-10-18
};

test('makeSchedule sets since to the current pay period start', () => {
  assert.strictEqual(CO.schedule.since, '2026-10-18');
});

test('dueShifts: past unlogged days, skips logged + dismissed, today only once ended', () => {
  const sessions = [{ company_id: 7, log_date: '2026-10-19' }];              // Mon logged
  const before = S.dueShifts([CO], sessions, { today: TODAY, nowMins: 11 * 60 });
  assert.deepStrictEqual(before.map(d => d.date), ['2026-10-21']);          // Wed only; Fri not over
  const after = S.dueShifts([CO], sessions, { today: TODAY, nowMins: 12 * 60 });
  assert.deepStrictEqual(after.map(d => d.date), ['2026-10-21', '2026-10-23']);
  const dis = S.dueShifts([CO], sessions, { today: TODAY, nowMins: 12 * 60, dismissed: ['7|2026-10-21'] });
  assert.deepStrictEqual(dis.map(d => d.date), ['2026-10-23']);
});

test('dueShifts respects since, paused and date_end', () => {
  assert.deepStrictEqual(S.dueShifts([{ ...CO, schedule: { ...CO.schedule, paused: true } }], [], { today: TODAY, nowMins: 1439 }), []);
  assert.deepStrictEqual(S.dueShifts([{ ...CO, date_end: '2026-10-20' }], [], { today: TODAY, nowMins: 1439 }).map(d => d.date), ['2026-10-19']);
  // Nothing before since (2026-10-18), even with a long lookback.
  assert.ok(S.dueShifts([CO], [], { today: TODAY, nowMins: 1439, lookbackDays: 60 }).every(d => d.date >= '2026-10-18'));
});

test('periodSummary: logged minutes in period + unlogged minutes ahead', () => {
  const sessions = [
    { company_id: 7, log_date: '2026-10-19', total_mins: 180 },
    { company_id: 7, log_date: '2026-10-11', total_mins: 999 },             // previous period
  ];
  const p = S.periodSummary(CO, sessions, { today: '2026-10-21' });
  assert.deepStrictEqual(p, { start: '2026-10-18', end: '2026-10-24', loggedMins: 180, aheadMins: 360 }); // Wed + Fri
});

test('slotRows builds tracker rows; overnight slot wraps', () => {
  const [r] = S.slotRows([{ start: '22:00', end: '02:00', label: 'L', name: 'N' }]);
  assert.strictEqual(r.total_mins, 240);
  assert.strictEqual(r.clock_in, '22:00');
  assert.strictEqual(r._scheduled, true);
});

// ── Properties ───────────────────────────────────────────────────────────────
test('property: detection is independent of entry order', () => {
  const base = exampleHistory();
  fc.assert(fc.property(fc.shuffledSubarray(base, { minLength: base.length, maxLength: base.length }), shuffled => {
    assert.deepStrictEqual(S.detectSchedule(shuffled, { today: TODAY }), S.detectSchedule(base, { today: TODAY }));
  }), { numRuns: 50 });
});

test('property: every detected slot meets the thresholds', () => {
  const arbEntry = fc.record({
    company_id: fc.integer({ min: 1, max: 3 }),
    log_date: fc.integer({ min: 0, max: 70 }).map(n => S.addDays(TODAY, -n)),
    rows: fc.array(fc.record({
      clock_in: fc.integer({ min: 0, max: 1439 }).map(S.fromMin),
      clock_out: fc.integer({ min: 0, max: 1439 }).map(S.fromMin),
    }), { maxLength: 3 }),
  });
  fc.assert(fc.property(fc.array(arbEntry, { maxLength: 80 }), es => {
    for (const s of S.detectSchedule(es, { today: TODAY })) {
      assert.ok(s.weeksSeen >= 3);
      assert.ok(s.weeksSeen / s.weeksTotal >= 0.6);
      assert.ok(s.mins > 0);
    }
  }), { numRuns: 200 });
});

test('property: periodFor always contains the date and has the right length', () => {
  const kinds = [null, { kind: 'weekly' }, { kind: 'biweekly', anchor: '2025-03-09' }, { kind: 'semimonthly' }, { kind: 'monthly' }];
  fc.assert(fc.property(fc.integer({ min: -2000, max: 2000 }), fc.constantFrom(...kinds), (n, pp) => {
    const d = S.addDays('2026-06-15', n);
    const p = S.periodFor(d, pp);
    assert.ok(p.start <= d && d <= p.end, `${d} in ${p.start}..${p.end}`);
    const len = S.daysBetween(p.start, p.end) + 1;
    if (!pp || pp.kind === 'weekly') assert.strictEqual(len, 7);
    if (pp && pp.kind === 'biweekly') assert.strictEqual(len, 14);
    // Consecutive periods tile with no gap or overlap.
    assert.strictEqual(S.periodFor(S.addDays(p.end, 1), pp).start, S.addDays(p.end, 1));
  }), { numRuns: 500 });
});
