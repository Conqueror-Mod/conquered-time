'use strict';

// Property-based tests (fast-check) for clock-input parsing and duration math
// — Phase A of docs/PLAN-property-testing.md (A11–A12). computeDiffMins was
// extracted verbatim from tracker.ts into time-parse.js for this suite (the
// tracker now uses the shared copy).

const { test } = require('node:test');
const assert   = require('node:assert');
const fc       = require('fast-check');
const { parseClockInput, computeDiffMins } = require('../src/renderer/time-parse.js');

const HHMM_24 = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const arbHour = fc.integer({ min: 0, max: 23 });
const arbMin  = fc.integer({ min: 0, max: 59 });
const pad = n => String(n).padStart(2, '0');
const arbHHMM = fc.tuple(arbHour, arbMin).map(([h, m]) => `${pad(h)}:${pad(m)}`);

test('A11: valid HH:MM pairs never yield negative durations (midnight wrap)', () => {
  fc.assert(
    fc.property(arbHour, arbMin, arbHour, arbMin, (ih, im, oh, om) => {
      const diff = computeDiffMins(`${pad(ih)}:${pad(im)}`, `${pad(oh)}:${pad(om)}`);
      assert.ok(Number.isInteger(diff) && diff >= 0 && diff <= 1439, `diff=${diff}`);
      // Oracle: minutes-of-day difference mod one day.
      const expected = ((oh * 60 + om) - (ih * 60 + im) + 1440) % 1440;
      assert.strictEqual(diff, expected);
    })
  );
  // The canonical midnight crossing from the seed's edge-probe session.
  assert.strictEqual(computeDiffMins('23:30', '00:15'), 45);
  assert.strictEqual(computeDiffMins('00:00', '23:59'), 1439);
  assert.strictEqual(computeDiffMins('12:00', '12:00'), 0);
});

test('A12: parseClockInput normalization is idempotent and strictly 24h zero-padded', () => {
  // Accepted inputs in every tolerated shape: 24h (padded or not) and 12h
  // with all the meridiem spellings the regex allows.
  const arbMeridiemHour = fc.integer({ min: 1, max: 12 });
  const arbInput = fc.oneof(
    fc.tuple(arbHour, arbMin, fc.boolean()).map(([h, m, padHour]) =>
      `${padHour ? pad(h) : h}:${pad(m)}`),
    fc.tuple(arbMeridiemHour, arbMin, fc.constantFrom('AM', 'PM', 'am', 'pm', 'a', 'p', 'A.M.', 'p.m.'), fc.constantFrom('', ' ', '  '))
      .map(([h, m, mer, gap]) => `${h}:${pad(m)}${gap}${mer}`)
  );
  fc.assert(
    fc.property(arbInput, input => {
      const r = parseClockInput(input);
      assert.strictEqual(r.ok, true, `${JSON.stringify(input)} should parse`);
      assert.match(r.hhmm, HHMM_24, 'output is zero-padded 24h');
      // Idempotence: re-parsing the normalized output is a fixed point.
      const r2 = parseClockInput(r.hhmm);
      assert.strictEqual(r2.ok, true);
      assert.strictEqual(r2.hhmm, r.hhmm);
    })
  );
  // Total function: arbitrary garbage never throws, and anything it does
  // accept still normalizes to a fixed point.
  fc.assert(
    fc.property(fc.string({ unit: 'binary', maxLength: 20 }), s => {
      const r = parseClockInput(s);
      if (r.ok) {
        assert.match(r.hhmm, HHMM_24);
        assert.strictEqual(parseClockInput(r.hhmm).hhmm, r.hhmm);
      }
    })
  );
});
