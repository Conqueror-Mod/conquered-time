'use strict';

// Run: npm test   (node --test; the test script builds dist-main first)
//
// Exercises the REAL compiled entries:fill-schedule handler with a mocked
// electron (same harness as import-commit.test.js). Verifies rows are rebuilt
// main-side from the encrypted schedule, future dates are refused, existing
// company+date sessions are never doubled, and a re-run is a no-op.

const { test } = require('node:test');
const assert   = require('node:assert');
const crypto   = require('node:crypto');
const Module   = /** @type {any} */ (require('node:module'));

const handlers = {};
const electronMock = {
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  app: { getPath: () => require('node:os').tmpdir(), isPackaged: false },
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronMock;
  return origLoad.apply(this, arguments);
};

const db          = require('../dist-main/main/db.js');
const { session } = require('../dist-main/main/session.js');
const { encrypt, decrypt } = require('../dist-main/main/vault-crypto.js');
const entries     = require('../dist-main/main/ipc/entries.js');
const S           = require('../src/renderer/schedule.js');
const { localDateStr } = require('../src/renderer/row-utils.js');

Module._load = origLoad;

entries.register();
const fill = handlers['entries:fill-schedule'];

const TODAY = localDateStr();
const daysAgo = n => S.addDays(TODAY, -n);

async function setup(schedule) {
  await db.loadSqlJs();
  db.openDb();
  db.dbRun(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    data_enc TEXT, data_iv TEXT, data_tag TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));`);
  db.dbRun(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_id INTEGER NOT NULL,
    log_date TEXT NOT NULL, session_label TEXT, rows_json TEXT NOT NULL,
    rows_enc TEXT, rows_iv TEXT, rows_tag TEXT, total_mins INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));`);
  db.dbRun('DELETE FROM companies');
  db.dbRun('DELETE FROM time_entries');
  session.key = crypto.randomBytes(32);
  session.user = { id: 1 };
  session.profileDir = null;   // persist/backup/snapshot no-op safely
  session.activeEntryId = null;
  const e = encrypt(JSON.stringify({ name: 'Acme', schedule }), session.key);
  db.dbRun('INSERT INTO companies (user_id,data_enc,data_iv,data_tag) VALUES (?,?,?,?)', [1, e.data, e.iv, e.tag]);
  return Number(db.dbGet('SELECT MAX(rowid) as rid FROM companies', []).rid);
}

// A slot on every weekday, so any date has exactly one scheduled shift.
const EVERY_DAY = {
  since: daysAgo(30),
  slots: [0, 1, 2, 3, 4, 5, 6].map(wd => ({ weekday: wd, start: '09:00', end: '12:00', label: 'QA', name: 'Shift' })),
};

const sessions = () => db.dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=1', []);

test('fill-schedule creates one Scheduled session with rows built from the saved schedule', async () => {
  const cid = await setup(EVERY_DAY);
  const res = fill(null, { items: [{ companyId: cid, date: daysAgo(2) }] });
  assert.deepStrictEqual(res, { ok: true, created: 1, skipped: 0 });
  const [s] = sessions();
  assert.strictEqual(s.session_label, 'Scheduled');
  assert.strictEqual(s.log_date, daysAgo(2));
  assert.strictEqual(s.total_mins, 180);
  assert.strictEqual(s.rows_json, '', 'rows stored encrypted only');
  const rows = JSON.parse(decrypt({ iv: s.rows_iv, tag: s.rows_tag, data: s.rows_enc }, session.key));
  assert.deepStrictEqual(rows.map(r => [r.clock_in, r.clock_out, r.label, r.name]), [['09:00', '12:00', 'QA', 'Shift']]);
});

test('fill-schedule refuses future dates and bad input', async () => {
  const cid = await setup(EVERY_DAY);
  const res = fill(null, { items: [
    { companyId: cid, date: S.addDays(TODAY, 1) },
    { companyId: cid, date: 'not-a-date' },
    { companyId: 999, date: daysAgo(1) },
  ] });
  assert.deepStrictEqual(res, { ok: true, created: 0, skipped: 3 });
  assert.strictEqual(sessions().length, 0);
});

test('fill-schedule never doubles a day that already has a session, and re-runs are no-ops', async () => {
  const cid = await setup(EVERY_DAY);
  db.dbRun("INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,total_mins) VALUES (1,?,?,'Hand',?,60)",
    [cid, daysAgo(1), '[]']);
  const items = [{ companyId: cid, date: daysAgo(1) }, { companyId: cid, date: daysAgo(3) }, { companyId: cid, date: daysAgo(3) }];
  assert.deepStrictEqual(fill(null, { items }), { ok: true, created: 1, skipped: 2 });
  assert.deepStrictEqual(fill(null, { items }), { ok: true, created: 0, skipped: 3 });
  assert.strictEqual(sessions().length, 2);
});

test('fill-schedule skips days the schedule does not cover (paused / before since)', async () => {
  const cid = await setup({ ...EVERY_DAY, since: daysAgo(2) });
  assert.strictEqual(fill(null, { items: [{ companyId: cid, date: daysAgo(5) }] }).created, 0);
  const cid2 = await setup({ ...EVERY_DAY, paused: true });
  assert.strictEqual(fill(null, { items: [{ companyId: cid2, date: daysAgo(1) }] }).created, 0);
});
