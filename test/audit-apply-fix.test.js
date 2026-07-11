'use strict';

// Run: npm test   (node --test; test script builds dist-main first)
//
// Guards the optimistic-concurrency control on the audit:apply-fix IPC handler.
// Apply Fix operates on a row_idx + discrepancy the audit view captured from an
// entries:all snapshot; a concurrent writer (the tracker) can change that row in
// between, making the index/discrepancy stale. The handler now compares the
// caller's last-known updated_at against the stored row and rejects with
// { ok:false, stale:true } instead of applying against outdated data.
//
// Exercises the REAL compiled handler (dist-main/main/ipc/audit.js) with a
// mocked electron + a stub ctx.

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

const db          = require('../dist-main/main/db.js');
const { session } = require('../dist-main/main/session.js');
const { encrypt } = require('../dist-main/main/vault-crypto.js');
const audit       = require('../dist-main/main/ipc/audit.js');

Module._load = origLoad; // restore once modules are loaded

audit.register({ createAuditWizardWindow: () => {} }); // populates `handlers`
const applyFix = handlers['audit:apply-fix'];

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

// Insert one entry whose only row has a clock_in but no clock_out → the
// `no_clock_out` discrepancy, fixable via `set_clock_out`.
function seedFixableEntry() {
  const rows = [{ label: 'Work', name: 'Task', clock_in: '09:00', clock_out: '', total_mins: 0 }];
  const enc  = encrypt(JSON.stringify(rows), session.key);
  db.dbRun(
    'INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,rows_enc,rows_iv,rows_tag,total_mins) VALUES (?,?,?,?,?,?,?,?,?)',
    [session.user.id, 3, '2026-07-10', '', '', enc.data, enc.iv, enc.tag, 0]
  );
  const row = db.dbGet('SELECT MAX(rowid) as rid FROM time_entries WHERE user_id=?', [session.user.id]);
  return Number(row.rid);
}

async function setup() {
  await db.loadSqlJs();
  db.openDb();
  freshDb();
  session.key = crypto.randomBytes(32);
  session.user = { id: 1 };
  session.profileDir = 'test-profile';
  session.activeEntryId = null;
}

function currentUpdatedAt(id) {
  return Number(db.dbGet('SELECT updated_at FROM time_entries WHERE rowid=?', [id]).updated_at);
}

test('audit:apply-fix rejects a stale apply instead of touching the row', async () => {
  await setup();
  const id = seedFixableEntry();
  const staleToken = currentUpdatedAt(id);

  // A concurrent writer saved a newer version (distinct updated_at).
  db.dbRun('UPDATE time_entries SET updated_at=? WHERE rowid=?', [staleToken + 100, id]);

  const res = applyFix(null, { entry_id: id, row_idx: 0, fix_type: 'set_clock_out', updated_at: staleToken });
  assert.strictEqual(res.ok, false, 'stale apply is rejected');
  assert.strictEqual(res.stale, true, 'rejection is flagged as stale');

  // Row untouched: still no clock_out, still zero total.
  const row = db.dbGet('SELECT total_mins FROM time_entries WHERE rowid=?', [id]);
  assert.strictEqual(row.total_mins, 0, 'stale apply did not modify the entry');
});

test('audit:apply-fix with the current token applies the fix', async () => {
  await setup();
  const id = seedFixableEntry();
  const token = currentUpdatedAt(id);

  const res = applyFix(null, { entry_id: id, row_idx: 0, fix_type: 'set_clock_out', updated_at: token });
  assert.strictEqual(res.ok, true, 'matching token is accepted');
  assert.strictEqual(res.stale, undefined, 'not flagged stale');
  // Fresh token returned so multi-fix callers (the wizard) can re-arm — a
  // second fix on the SAME entry must succeed with it, not stale-reject.
  assert.strictEqual(typeof res.updated_at, 'number', 'returns the fresh updated_at');
  const res2 = applyFix(null, { entry_id: id, row_idx: 0, fix_type: 'recalc_duration', updated_at: res.updated_at });
  assert.strictEqual(res2.ok, true, 'second fix with the refreshed token succeeds');

  // set_clock_out = clock_in + 8h → 17:00, total 480.
  const row = db.dbGet('SELECT total_mins FROM time_entries WHERE rowid=?', [id]);
  assert.strictEqual(row.total_mins, 480, 'the fix applied (8h)');
});

test('audit:apply-fix without a token falls back to applying (legacy callers)', async () => {
  await setup();
  const id = seedFixableEntry();
  db.dbRun('UPDATE time_entries SET updated_at=? WHERE rowid=?', [currentUpdatedAt(id) + 100, id]);

  // No updated_at → guard skipped, fix applies.
  const res = applyFix(null, { entry_id: id, row_idx: 0, fix_type: 'set_clock_out' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.stale, undefined);
  const row = db.dbGet('SELECT total_mins FROM time_entries WHERE rowid=?', [id]);
  assert.strictEqual(row.total_mins, 480, 'legacy no-token apply still works');
});

test('audit:apply-fix still rejects a disallowed fix type before the guard', async () => {
  await setup();
  const id = seedFixableEntry();
  const res = applyFix(null, { entry_id: id, row_idx: 0, fix_type: 'delete_everything', updated_at: currentUpdatedAt(id) });
  assert.strictEqual(res.ok, false);
  assert.ok(/acknowledge-only/i.test(res.error || ''), 'unknown fix type is rejected as acknowledge-only');
});
