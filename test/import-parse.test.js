'use strict';

// Unit tests for the CSV import parser/mapper (src/renderer/import-parse.js).
// Pure functions, no DOM — required directly like row-utils/time-parse.

const { test } = require('node:test');
const assert   = require('node:assert');
const IP = require('../src/renderer/import-parse.js');

// ── parseCSV ────────────────────────────────────────────────────────────────
test('parseCSV: basic headers + rows', () => {
  const { headers, rows } = IP.parseCSV('a,b,c\n1,2,3\n4,5,6');
  assert.deepStrictEqual(headers, ['a', 'b', 'c']);
  assert.deepStrictEqual(rows, [['1', '2', '3'], ['4', '5', '6']]);
});

test('parseCSV: quoted fields with commas, quotes and newlines', () => {
  const { headers, rows } = IP.parseCSV('name,note\n"Smith, Jr.","he said ""hi""\nsecond line"');
  assert.deepStrictEqual(headers, ['name', 'note']);
  assert.strictEqual(rows[0][0], 'Smith, Jr.');
  assert.strictEqual(rows[0][1], 'he said "hi"\nsecond line');
});

test('parseCSV: CRLF line endings and a leading BOM', () => {
  const { headers, rows } = IP.parseCSV('﻿a,b\r\n1,2\r\n');
  assert.deepStrictEqual(headers, ['a', 'b']);
  assert.deepStrictEqual(rows, [['1', '2']]);
});

test('parseCSV: fully-blank rows are dropped', () => {
  const { rows } = IP.parseCSV('a,b\n1,2\n,\n3,4');
  assert.deepStrictEqual(rows, [['1', '2'], ['3', '4']]);
});

// ── autoMap ─────────────────────────────────────────────────────────────────
test('autoMap: matches labels + aliases case-insensitively, no double-use', () => {
  const headers = ['Client Name', 'PROJECT', 'Hourly Rate', 'Mystery'];
  const m = IP.autoMap(headers, IP.COMPANY_FIELDS);
  assert.strictEqual(m.name, 0);
  assert.strictEqual(m.hier_project, 1);
  assert.strictEqual(m.pay_rate, 2);
  assert.strictEqual(m.location, -1); // unmapped stays -1
});

// ── normalizeDate ─────────────────────────────────────────────────────────────
test('normalizeDate: accepts ISO, US slash, and rejects junk', () => {
  assert.strictEqual(IP.normalizeDate('2026-07-13'), '2026-07-13');
  assert.strictEqual(IP.normalizeDate('2026/7/3'), '2026-07-03');
  assert.strictEqual(IP.normalizeDate('7/3/2026'), '2026-07-03');   // US month-first
  assert.strictEqual(IP.normalizeDate('13/40/2026'), null);         // out of range
  assert.strictEqual(IP.normalizeDate('next tuesday'), null);
  assert.strictEqual(IP.normalizeDate(''), null);
});

// ── buildCompanies ────────────────────────────────────────────────────────────
test('buildCompanies: maps fields, parses rate, flags missing name', () => {
  const { headers, rows } = IP.parseCSV(
    'Company Name,Project,Pay Rate\nZenith,Phoenix,$42.50\n,Orphan,10');
  const map = IP.autoMap(headers, IP.COMPANY_FIELDS);
  const { companies, errors } = IP.buildCompanies(rows, map);
  assert.strictEqual(companies.length, 1);
  assert.deepStrictEqual(companies[0], { name: 'Zenith', hier_project: 'Phoenix', pay_rate: 42.5 });
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0].msg, /Missing company name/);
  assert.strictEqual(errors[0].row, 3);
});

// ── buildEntries ──────────────────────────────────────────────────────────────
test('buildEntries: groups rows into sessions and derives duration', () => {
  const csv = [
    'Company,Date,Session,Task Label,Task Name,Clock In,Clock Out',
    'Zenith,2026-07-13,Morning,Annotation,Batch A,09:00,10:30',
    'Zenith,2026-07-13,Morning,QA,Review,10:30,11:00',
    'Zenith,2026-07-13,Afternoon,Annotation,Batch B,1:00 PM,2:00 PM',
  ].join('\n');
  const { headers, rows } = IP.parseCSV(csv);
  const map = IP.autoMap(headers, IP.ENTRY_FIELDS);
  const { sessions, companies, errors } = IP.buildEntries(rows, map);
  assert.strictEqual(errors.length, 0);
  assert.deepStrictEqual(companies, ['Zenith']);
  assert.strictEqual(sessions.length, 2);                 // Morning + Afternoon
  const morning = sessions.find((s) => s.session_label === 'Morning');
  assert.strictEqual(morning.rows.length, 2);
  assert.strictEqual(morning.rows[0].total_mins, 90);     // 09:00→10:30
  assert.strictEqual(morning.total_mins, 120);            // 90 + 30
  const pm = sessions.find((s) => s.session_label === 'Afternoon');
  assert.strictEqual(pm.rows[0].clock_in, '13:00');       // 12h → 24h
  assert.strictEqual(pm.rows[0].total_mins, 60);
});

test('buildEntries: explicit duration wins; midnight wrap; bad rows skipped', () => {
  const csv = [
    'Company,Date,Duration (mins),Clock In,Clock Out',
    'A,2026-07-13,45,,',              // explicit duration, no clocks
    'B,2026-07-13,,23:30,00:15',      // midnight wrap → 45
    'C,not-a-date,,09:00,10:00',      // bad date → error
    ',2026-07-13,10,,',               // missing company → error
    'D,2026-07-13,,09:00,25:00',      // bad clock-out → error
  ].join('\n');
  const { headers, rows } = IP.parseCSV(csv);
  const map = IP.autoMap(headers, IP.ENTRY_FIELDS);
  const { sessions, errors } = IP.buildEntries(rows, map);
  assert.strictEqual(sessions.length, 2);
  assert.strictEqual(sessions.find((s) => s.company === 'A').total_mins, 45);
  assert.strictEqual(sessions.find((s) => s.company === 'B').total_mins, 45);
  assert.strictEqual(errors.length, 3);
});
