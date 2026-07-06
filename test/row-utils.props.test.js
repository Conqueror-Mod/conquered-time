'use strict';

// Property-based tests (fast-check) for the shared row predicate and the local
// calendar-date helper — Phase A of docs/PLAN-property-testing.md (A5–A7).
// A7 targets the UTC-rollover bug class behind the v3.13 stale-punch /
// negative-timer fix (PR #95): toISOString() dates are UTC and drift a day
// ahead of the local calendar every evening in US timezones.

const { test } = require('node:test');
const assert   = require('node:assert');
const fc       = require('fast-check');
const { rowHasContent, localDateStr } = require('../src/renderer/row-utils.js');

// A value that must NEVER count as content: empty/whitespace strings, null,
// undefined. U+00A0 (nbsp) and U+2003 (em space) are trim()-able whitespace.
const WS_CHARS = [' ', '\t', '\n', '\r', ' ', ' '];
const arbBlank = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
  fc.string({ unit: fc.constantFrom(...WS_CHARS), maxLength: 12 })
);

const FIELDS = ['clock_in', 'clock_out', 'label', 'name', 'desc', 'description'];

const arbBlankRow = fc.record(Object.fromEntries(FIELDS.map(f => [f, arbBlank])));

// Non-whitespace content: at least one char that survives String.trim().
const arbContent = fc.string({ unit: 'binary', minLength: 1, maxLength: 40 })
  .filter(s => s.trim() !== '');

test('A5: rows whose every field is blank/whitespace never have content', () => {
  fc.assert(
    fc.property(arbBlankRow, row => {
      assert.strictEqual(rowHasContent(row), false);
    })
  );
  assert.strictEqual(rowHasContent(null), false);
  assert.strictEqual(rowHasContent(undefined), false);
  assert.strictEqual(rowHasContent({}), false);
});

test('A6: any single non-whitespace field makes the row count', () => {
  fc.assert(
    fc.property(arbBlankRow, fc.constantFrom(...FIELDS), arbContent, (row, field, value) => {
      assert.strictEqual(rowHasContent({ ...row, [field]: value }), true);
    })
  );
});

test('A7: localDateStr matches the local calendar for arbitrary dates', () => {
  fc.assert(
    fc.property(
      fc.date({ min: new Date('1970-01-02T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true }),
      d => {
        const s = localDateStr(d);
        assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
        // Oracle: the string round-trips to the same local calendar day.
        const [y, m, day] = s.split('-').map(Number);
        assert.strictEqual(y,   d.getFullYear());
        assert.strictEqual(m,   d.getMonth() + 1);
        assert.strictEqual(day, d.getDate());
        // The UTC-rollover class: whenever UTC and local calendars genuinely
        // disagree for this instant, localDateStr must NOT be the UTC date.
        const utc = d.toISOString().slice(0, 10);
        const sameCalendarDay = d.getUTCFullYear() === d.getFullYear()
          && d.getUTCMonth() === d.getMonth() && d.getUTCDate() === d.getDate();
        if (!sameCalendarDay) assert.notStrictEqual(s, utc);
      }
    )
  );
  // Deterministic anchor for the exact bug shape: a late local evening.
  const evening = new Date(2026, 6, 4, 23, 30); // 2026-07-04 23:30 local
  assert.strictEqual(localDateStr(evening), '2026-07-04');
});
