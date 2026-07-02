'use strict';

// Regression lock for defect cluster C1 / D-002: the tracker's inline time
// editor must accept both 24-hour and 12-hour input, normalizing to 24h.

const { test } = require('node:test');
const assert = require('node:assert');
const { parseClockInput } = require('../src/renderer/time-parse.js');

const ok  = (input, hhmm) => {
  const r = parseClockInput(input);
  assert.equal(r.ok, true, `${input} should parse`);
  assert.equal(r.hhmm, hhmm, `${input} → ${hhmm}`);
};
const bad = (input) => assert.equal(parseClockInput(input).ok, false, `${input} should be rejected`);

test('24-hour input passes through zero-padded', () => {
  ok('14:30', '14:30');
  ok('9:05', '09:05');
  ok('09:05', '09:05');
  ok('0:00', '00:00');
  ok('23:59', '23:59');
});

test('12-hour input with meridiem converts to 24h', () => {
  ok('2:30 PM', '14:30');
  ok('2:30 pm', '14:30');
  ok('2:30PM', '14:30');
  ok('2:30p', '14:30');
  ok('2:30 p.m.', '14:30');
  ok('9:15 AM', '09:15');
  ok('11:59 pm', '23:59');
});

test('12 AM / 12 PM boundary handling', () => {
  ok('12:00 AM', '00:00');   // midnight
  ok('12:00 PM', '12:00');   // noon
  ok('12:30 am', '00:30');
  ok('12:30 pm', '12:30');
});

test('hour out of range for the given form is rejected', () => {
  bad('24:00');      // 24h form: max 23
  bad('25:10');
  bad('13:00 PM');   // meridiem form: max 12
  bad('0:30 AM');    // meridiem form: min 1
});

test('malformed input is rejected, never throws', () => {
  for (const junk of ['', '  ', 'abc', '2:5', '2:75', ':30', '14', '14:', '2:30 XM', '1430', null, undefined]) {
    assert.equal(parseClockInput(junk).ok, false, `${junk} rejected`);
  }
});

test('whitespace tolerance', () => {
  ok('  14:30  ', '14:30');
  ok(' 2:30 pm ', '14:30');
});
