'use strict';

// Run: npm test   (node --test; test script builds dist-main first)
//
// Guards the optimistic-concurrency control on the entries:save IPC handler.
// Before this, the UPDATE branch was a blind last-write-wins keyed only on
// rowid+user_id: a stale concurrent writer could silently clobber a newer save.
// The handler now compares the client's last-known updated_at against the stored
// row and rejects with { ok:false, stale:true } instead of overwriting.
//
// We exercise the REAL compiled handler (dist-main/main/ipc/entries.js) with a
// mocked electron so ipcMain.handle records the handler, plus the real db /
// session / cache / crypto modules the handler pulls in.

const { test } = require('node:test');
const assert   = require('node:assert');
const crypto   = require('node:crypto');
const Module   = /** @type {any} */ (require('node:module'));

// ── Mock electron so ipcMain.handle records handlers we can invoke directly ──
const handlers = {};
const electronMock = { ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } } };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.apply(this, arguments);
};

const db        = require('../dist-main/main/db.js');
const { session } = require('../dist-main/main/session.js');
const entries   = require('../dist-main/main/ipc/entries.js');

Module._load = origLoad; // restore once modules are loaded

entries.register(); // populates `handlers`
const save = handlers['entries:save'];
const list = handlers['entries:list'];

function freshDb() {
  db.dbRun(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      company_id    INTEGER NOT NULL,
      log_date      TEXT    NOT NULL,
      session_label TEXT,
      rows_json     TEXT    NOT NULL,
      rows_enc      TEXT, rows_iv TEXT, rows_tag TEXT,
      total_mins    INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  db.dbRun('DELETE FROM time_entries');
}

async function setup() {
  await db.loadSqlJs();
  db.openDb();
  freshDb();
  session.key = crypto.randomBytes(32);      // stable AES-256-GCM key for the test
  session.user = { id: 1 };
  session.profileDir = 'test-profile';
  session.activeEntryId = null;
}

test('entries:save rejects a stale write instead of clobbering a newer one', async () => {
  await setup();

  // Insert (no id) → returns the new rowid + its fresh updated_at token.
  const ins = save(null, {
    company_id: 5, log_date: '2026-07-10', session_label: 'A',
    rows_json: JSON.stringify([{ clock_in: '09:00', clock_out: '10:00', total_mins: 60 }]),
    total_mins: 60,
  });
  assert.strictEqual(ins.ok, true);
  assert.ok(ins.id != null, 'insert returns the new rowid');
  assert.strictEqual(typeof ins.updated_at, 'number', 'insert returns an updated_at token');

  const id = ins.id;
  const staleToken = ins.updated_at;

  // A concurrent writer saves a NEWER version. Force a distinct updated_at so the
  // guard has something to compare (strftime granularity is whole seconds).
  db.dbRun('UPDATE time_entries SET updated_at=? WHERE rowid=?', [staleToken + 100, id]);

  // Now a stale writer (still holding the OLD token) tries to save. Must be
  // rejected, and must NOT have overwritten the row.
  const stale = save(null, {
    id, updated_at: staleToken,
    company_id: 5, log_date: '2026-07-10', session_label: 'STALE-OVERWRITE',
    rows_json: JSON.stringify([{ clock_in: '00:00', clock_out: '00:00', total_mins: 0 }]),
    total_mins: 0,
  });
  assert.strictEqual(stale.ok, false, 'stale write is rejected');
  assert.strictEqual(stale.stale, true, 'rejection is flagged as stale');

  // The row is untouched: still the newer label/total, not the stale payload.
  const rows = list(null, 5);
  const row = rows.find(r => r.id === id);
  assert.strictEqual(row.session_label, 'A', 'stale write did not clobber the label');
  assert.strictEqual(row.total_mins, 60, 'stale write did not clobber the total');
});

test('entries:save with the current token succeeds and advances the token', async () => {
  await setup();

  const ins = save(null, {
    company_id: 7, log_date: '2026-07-10', session_label: 'first',
    rows_json: '[]', total_mins: 0,
  });
  const id = ins.id;

  // Bump updated_at to a distinct value so we can prove the token advances.
  db.dbRun('UPDATE time_entries SET updated_at=? WHERE rowid=?', [ins.updated_at + 5, id]);
  const current = ins.updated_at + 5;

  const ok = save(null, {
    id, updated_at: current,
    company_id: 7, log_date: '2026-07-10', session_label: 'second',
    rows_json: '[]', total_mins: 30,
  });
  assert.strictEqual(ok.ok, true, 'matching token is accepted');
  assert.strictEqual(ok.stale, undefined, 'not flagged stale');
  assert.strictEqual(typeof ok.updated_at, 'number', 'returns a fresh token');

  const row = list(null, 7).find(r => r.id === id);
  assert.strictEqual(row.session_label, 'second', 'the write applied');
  assert.strictEqual(row.total_mins, 30);
});

test('entries:save without an updated_at token falls back to blind update (legacy callers)', async () => {
  await setup();

  const ins = save(null, {
    company_id: 9, log_date: '2026-07-10', session_label: 'x',
    rows_json: '[]', total_mins: 0,
  });
  const id = ins.id;
  db.dbRun('UPDATE time_entries SET updated_at=? WHERE rowid=?', [ins.updated_at + 100, id]);

  // No updated_at supplied → the guard is skipped, the write applies.
  const res = save(null, {
    id, company_id: 9, log_date: '2026-07-10', session_label: 'legacy',
    rows_json: '[]', total_mins: 15,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.stale, undefined);
  const row = list(null, 9).find(r => r.id === id);
  assert.strictEqual(row.session_label, 'legacy', 'legacy no-token write still applies');
});

test('entries:save on a missing row reports not found', async () => {
  await setup();
  const res = save(null, {
    id: 999999, updated_at: 123,
    company_id: 1, log_date: '2026-07-10', session_label: 'ghost',
    rows_json: '[]', total_mins: 0,
  });
  assert.strictEqual(res.ok, false);
  assert.ok(/not found/i.test(res.error || ''), 'missing row yields a not-found error');
});
