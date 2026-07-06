'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  Differential audit oracle — Phase B-2 of docs/PLAN-property-testing.md.
//
//  Mechanically enforces the sync contract documented at the top of
//  src/main/audit.ts: computeExpectedDiscrepancies() (the independent mirror
//  in test/vault-fixture.js, also used by seed-dev.js's self-check) must agree
//  with the REAL countAuditDiscrepancies() engine on ANY vault. Randomized
//  vaults mix missing punches, zero/huge durations, desc-only and whitespace
//  rows, legacy plaintext + corrupt rows_json, breaks/lunches (incl. orphans
//  and other-user rows), dismissals, and all three policy tiers.
//
//  Scope guard (per the plan): the engine detects exactly 6 discrepancy types
//  and deliberately does NOT flag row overlaps or stored-vs-span drift. This
//  oracle asserts AGREEMENT, not new detections — do not "improve" either side
//  here.
//
//  Seam: the engine reads through the dist-main db/session singletons, so the
//  test adopts each generated vault via db.adoptDb() and sets session.key/user
//  directly — no production wiring is touched.
// ════════════════════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert   = require('node:assert');
const fc       = require('fast-check');
const fixture  = require('./vault-fixture');

const dbMod      = require('../dist-main/main/db.js');
const { session } = require('../dist-main/main/session.js');
const { countAuditDiscrepancies } = require('../dist-main/main/audit.js');

const KEY = fixture.deriveKey('oracle-pw', 'oracle-salt');
const AUDIT_TYPES = ['no_clock_in', 'no_clock_out', 'zero_duration', 'over_12h', 'missing_break', 'missing_lunch'];

// ── Arbitraries ─────────────────────────────────────────────────────────────

// Text fields: empty / whitespace-only / real content (the predicate boundary).
const arbText = fc.constantFrom('', '  ', '\t', 'X', 'work item', '<b>x</b> 🚀');
// Punch fields: missing or a plausible HH:MM.
const arbClock = fc.constantFrom('', '', '08:00', '12:30', '23:59', '00:00');
// Row-level minutes: falsy, normal, and both sides of the 720 boundary.
const arbRowMins = fc.constantFrom(0, 1, 30, 719, 720, 721, 1440);

const arbRow = fc.record({
  label:      arbText,
  name:       arbText,
  desc:       arbText,
  description:arbText,   // legacy alias — exercises the dual-desc predicate
  clock_in:   arbClock,
  clock_out:  arbClock,
  total_mins: arbRowMins,
});

// Entry-level minutes: hits every policy-tier threshold from both sides.
const arbEntryMins = fc.constantFrom(0, 100, 119, 120, 121, 209, 210, 211, 299, 300, 301, 359, 360, 361, 599, 600, 601, 900);

const arbEntry = fc.record({
  rows:     fc.array(arbRow, { maxLength: 5 }),
  totalMins: arbEntryMins,
  // enc = normal encrypted; legacy = plaintext rows_json; corrupt = unparsable
  // or non-array rows_json (engine's catch{} path — row flags skipped, the
  // entry-level break/lunch checks still run).
  kind:     fc.constantFrom('enc', 'enc', 'enc', 'legacy', 'legacy-empty', 'corrupt-json', 'corrupt-shape'),
  breaks:   fc.integer({ min: 0, max: 3 }),
  lunches:  fc.integer({ min: 0, max: 1 }),
});

const arbDismissal = fc.record({
  entrySeed: fc.nat(),
  rowIdx:    fc.constantFrom(-1, 0, 1, 2, 3, 4),
  type:      fc.constantFrom(...AUDIT_TYPES),
});

const arbVault = fc.record({
  workState: fc.constantFrom(undefined, 'TX', 'CA', 'WA', 'NY', 'CT', 'ZZ'),
  entries:   fc.array(arbEntry, { maxLength: 6 }),
  dismissals:fc.array(arbDismissal, { maxLength: 8 }),
  orphanTasks: fc.integer({ min: 0, max: 2 }),
});

// ── Build a vault from a spec; returns { db, userId } ───────────────────────
function buildVault(SQL, spec) {
  const db = fixture.createVaultSchema(SQL);
  const userId = fixture.insertUser(db, { username: 'oracle', passwordHash: 'x' });
  const companyId = fixture.insertCompany(db, KEY, userId, { name: 'Oracle Co' });

  const entryIds = [];
  spec.entries.forEach((e, i) => {
    const base = { companyId, logDate: '2026-07-01', label: `E${i}`, rows: e.rows, totalMins: e.totalMins };
    let id;
    if (e.kind === 'enc')          id = fixture.insertEntry(db, KEY, userId, base);
    else if (e.kind === 'legacy')  id = fixture.insertLegacyEntry(db, userId, base);
    // Fresh-entry shape: rows_json '' (engine's `rows_json || '[]'` fallback).
    else if (e.kind === 'legacy-empty')  id = fixture.insertLegacyEntry(db, userId, { ...base, rowsJson: '' });
    else if (e.kind === 'corrupt-json')  id = fixture.insertLegacyEntry(db, userId, { ...base, rowsJson: '{not json' });
    else /* corrupt-shape */             id = fixture.insertLegacyEntry(db, userId, { ...base, rowsJson: '{"a":1}' });
    entryIds.push(id);

    for (let b = 0; b < e.breaks; b++) {
      fixture.insertTaskItem(db, userId, { entryId: id, label: 'break', itemType: 'break', startedAt: 1000, stoppedAt: 1900, durationSecs: 900 });
    }
    for (let l = 0; l < e.lunches; l++) {
      fixture.insertTaskItem(db, userId, { entryId: id, label: 'lunch', itemType: 'lunch', startedAt: 2000, stoppedAt: 3800, durationSecs: 1800 });
    }
    // Decoys the engine must ignore: another user's break/lunch on this entry.
    fixture.insertTaskItem(db, userId + 1, { entryId: id, label: 'other-user break', itemType: 'break', startedAt: 1, stoppedAt: 2, durationSecs: 1 });
    fixture.insertTaskItem(db, userId + 1, { entryId: id, label: 'other-user lunch', itemType: 'lunch', startedAt: 1, stoppedAt: 2, durationSecs: 1 });
  });

  for (let o = 0; o < spec.orphanTasks; o++) {
    fixture.insertTaskItem(db, userId, { entryId: 999999 + o, label: 'orphan', itemType: 'break', startedAt: 1, stoppedAt: 2, durationSecs: 1 });
  }

  for (const d of spec.dismissals) {
    if (!entryIds.length) break;
    const entryId = entryIds[d.entrySeed % entryIds.length];
    fixture.insertDismissed(db, userId, { entryId, rowIdx: d.rowIdx, type: d.type });
  }
  return { db, userId };
}

// ── The oracle ──────────────────────────────────────────────────────────────

test('differential oracle: engine and seed mirror agree on arbitrary vaults', async () => {
  await dbMod.loadSqlJs();
  const SQL = dbMod.getSql();

  fc.assert(
    fc.property(arbVault, spec => {
      const { db: vault, userId } = buildVault(SQL, spec);
      try {
        dbMod.adoptDb(vault);
        session.key  = KEY;
        session.user = { id: userId, work_state: spec.workState };

        const engine = countAuditDiscrepancies();
        const mirror = fixture.computeExpectedDiscrepancies(vault, userId, KEY, spec.workState);
        assert.strictEqual(engine, mirror,
          `engine=${engine} mirror=${mirror} workState=${spec.workState} entries=${JSON.stringify(spec.entries)}`);
      } finally {
        session.key = null; session.user = null;
        dbMod.closeDb();
      }
    }),
    { numRuns: 150 }
  );
});

// The fixed dev-seed shape must keep producing the documented count of 7 —
// a cheap canary that the extraction didn't change fixture semantics.
test('oracle sanity: engine returns 0 with no session user', () => {
  session.user = null;
  assert.strictEqual(countAuditDiscrepancies(), 0);
});
