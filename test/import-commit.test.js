'use strict';

// Run: npm test   (node --test; the test script builds dist-main first)
//
// Exercises the REAL compiled import:commit handler (dist-main/main/ipc/import.js)
// with a mocked electron, plus the real db / session / cache / crypto / backups
// modules it pulls in. Verifies: explicit companies created + matched, sessions
// auto-create their company by name and insert, and a re-run of the same payload
// is deduped (companies matched, sessions skipped — no doubled history).

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
const { decrypt } = require('../dist-main/main/vault-crypto.js');
const imp         = require('../dist-main/main/ipc/import.js');

Module._load = origLoad;

imp.register();
const commit = handlers['import:commit'];

function freshDb() {
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
}

async function setup() {
  await db.loadSqlJs();
  db.openDb();
  freshDb();
  session.key = crypto.randomBytes(32);
  session.user = { id: 1 };
  session.profileDir = null;   // no on-disk profile → persist/backup/snapshot no-op safely
  session.activeEntryId = null;
}

const PAYLOAD = {
  companies: [{ name: 'Alpha', pay_rate: 20 }],
  sessions: [
    { company: 'Beta', log_date: '2026-07-01', session_label: 'Morning', total_mins: 90,
      rows: [{ label: 'Task', name: 'Batch', desc: 'note', clock_in: '09:00', clock_out: '10:30', total_mins: 90 }] },
    { company: 'Alpha', log_date: '2026-07-02', session_label: '', total_mins: 30,
      rows: [{ label: 'QA', name: 'Review', desc: '', clock_in: '', clock_out: '', total_mins: 30 }] },
  ],
};

test('import:commit creates companies (explicit + auto) and sessions', async () => {
  await setup();
  const res = commit(null, PAYLOAD);
  assert.strictEqual(res.ok, true);
  // Alpha (explicit) + Beta (auto from its session) = 2 created; none pre-existing.
  assert.strictEqual(res.companiesCreated, 2);
  assert.strictEqual(res.companiesMatched, 0);
  assert.strictEqual(res.sessionsCreated, 2);
  assert.strictEqual(res.sessionsSkipped, 0);
  assert.strictEqual(res.rowsCreated, 2);

  assert.strictEqual(db.dbAll('SELECT rowid FROM companies WHERE user_id=1', []).length, 2);
  const entries = db.dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=1', []);
  assert.strictEqual(entries.length, 2);

  // The Alpha session links to the existing Alpha company (not a 3rd company).
  const alpha = db.dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=1', [])
    .find(r => JSON.parse(decrypt({ iv: r.data_iv, tag: r.data_tag, data: r.data_enc }, session.key)).name === 'Alpha');
  const alphaEntry = entries.find(e => e.company_id === Number(alpha.rid));
  assert.ok(alphaEntry, 'Alpha session linked to the Alpha company');
  assert.strictEqual(alphaEntry.total_mins, 30);

  // rows_enc decrypts back to the imported rows.
  const beta = entries.find(e => e.session_label === 'Morning');
  const rows = JSON.parse(decrypt({ iv: beta.rows_iv, tag: beta.rows_tag, data: beta.rows_enc }, session.key));
  assert.strictEqual(rows[0].clock_in, '09:00');
  assert.strictEqual(rows[0].total_mins, 90);
});

test('import:commit re-run is deduped (companies matched, sessions skipped)', async () => {
  await setup();
  commit(null, PAYLOAD);           // first import
  const res = commit(null, PAYLOAD); // identical re-run
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.companiesCreated, 0, 'no new companies on re-run');
  assert.strictEqual(res.companiesMatched, 1, 'explicit Alpha matched an existing company');
  assert.strictEqual(res.sessionsCreated, 0, 'identical sessions are skipped');
  assert.strictEqual(res.sessionsSkipped, 2);

  assert.strictEqual(db.dbAll('SELECT rowid FROM companies WHERE user_id=1', []).length, 2, 'still only 2 companies');
  assert.strictEqual(db.dbAll('SELECT rowid FROM time_entries WHERE user_id=1', []).length, 2, 'still only 2 sessions');
});

test('import:commit rejects an empty payload', async () => {
  await setup();
  const res = commit(null, { companies: [], sessions: [] });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /nothing to import/i);
});
