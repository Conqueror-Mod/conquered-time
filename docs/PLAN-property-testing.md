# PLAN — Property-Based Testing + Differential Audit Oracle

**Status:** Proposed (sketch confirmed with Chris 2026-07-05; build not yet started)
**Origin:** Adapted from aerospace-QA suggestions (formal verification, design-by-contract,
MC/DC coverage, load testing) contributed by a friend with an aerospace background. The
standards themselves don't fit a JS/TS Electron desktop app; this plan keeps the *methods*
and swaps in tooling native to this stack.

---

## Goal

Deep-reaching correctness assurance for the app's security-critical and logic-dense pure
modules, using **property-based testing** (`fast-check`) integrated into the existing
`node --test` suite, plus a **differential oracle** that mechanically enforces the
audit-engine ↔ seed-mirror sync contract that today relies on discipline alone.

## Tool choice: `fast-check`

- One **devDependency**, pure JS — no native compilation (hard project rule: no
  `better-sqlite3`-style deps).
- Works directly inside `node --test`; property tests are just more `test/*.test.js`
  files. `npm test` needs **no pipeline changes**.
- On failure, fast-check **shrinks** to the minimal counterexample and prints the run
  seed, so failures are small, readable, and exactly reproducible
  (`fc.assert(..., { seed })`).
- Default ~100 runs per property; crank per-property where cheap, reduce where expensive
  (see PBKDF2 constraint below).

---

## Phase A — Tier-1 properties on existing pure modules

No refactoring. New test files alongside the existing 8 suites in `test/`.

### `src/main/vault-crypto.js` → `test/vault-crypto.props.test.js`
| # | Property |
|---|----------|
| A1 | **Round-trip:** `decrypt(encrypt(p, k), k) === p` for arbitrary full-unicode strings (incl. `''`, emoji, CJK, control chars, multi-KB) and arbitrary 32-byte keys. |
| A2 | **Wrong key always throws:** for any plaintext and any two distinct keys, decrypting under the wrong key throws — never returns silent garbage. |
| A3 | **Tamper detection:** flipping any single bit/nibble of `data`, `iv`, or `tag` makes `decrypt` throw (the GCM auth-tag contract callers rely on to detect undecryptable blobs). |
| A4 | **`deriveKey` determinism + salt sensitivity:** same password+salt → identical key; differing salt (or password) → differing key. Run count kept low or iterations reduced via a test-only parameter — see constraints. |

### `src/renderer/row-utils.js` → extend `test/row-utils.test.js` (or sibling props file)
| # | Property |
|---|----------|
| A5 | **Whitespace-only never counts:** rows whose every field is `''`/whitespace/null are never `rowHasContent`. |
| A6 | **Any content always counts:** setting any single field (`clock_in`, `clock_out`, `label`, `name`, `desc`/`description`) to a non-whitespace string makes `rowHasContent` true. |
| A7 | **`localDateStr` matches the local calendar** for arbitrary `Date` values — including late-evening times (the UTC-rollover class of bug behind the v3.13 stale-punch/negative-timer fix, PR #95) and DST-transition dates. Oracle: compare against `getFullYear/getMonth/getDate` composition, and assert it never equals the `toISOString().slice(0,10)` value when the two genuinely differ. |

### `src/main/beta-keys.js` → `test/beta-keys.props.test.js`
| # | Property |
|---|----------|
| A8 | **Mint→verify round-trips** for arbitrary expiry days (uint16 range) and labels. |
| A9 | **Any single-character corruption** of a minted key fails verification. |
| A10 | **Expiry boundary exact:** key valid at `expiry`, invalid at `expiry + 1 day` (inject clock rather than sleeping). |

### Time parsing / duration math (module covered by `test/time-parse.test.js`)
| # | Property |
|---|----------|
| A11 | Valid `HH:MM` pairs never yield negative durations — including midnight crossings (e.g. 23:30→00:15 = 45). |
| A12 | Normalization is **idempotent**: `normalize(normalize(x)) === normalize(x)`; output always matches the strict 24-h regex `/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/` zero-padded form. |

**Phase A acceptance:** all properties green under `npm test` on a clean checkout; total
added wall-clock time for the suite ≲ a few seconds (excluding the PBKDF2 property, which
is bounded separately).

---

## Phase B — DevSeed library extraction + differential oracle (the deep clean)

### B-1. Extract `test/vault-fixture.js` from `seed-dev.js`

`seed-dev.js` is currently a monolithic script that builds one designed fixture on disk.
The differential oracle needs to build **arbitrary vaults in memory, hundreds per run**.
Extract the vault-building plumbing into a require-able builder module:

```
test/vault-fixture.js
  ├─ createVaultSchema(SQL)              → in-memory sql.js db with all tables
  ├─ insertUser(db, { workState, … })    → returns userId
  ├─ insertCompany(db, key, fields)      → encrypt-blob plumbing handled
  ├─ insertEntry(db, key, { rows, totalMins, logDate, … })
  └─ insertTaskItem(db, { entryId, type, … })
```

- `seed-dev.js` then **imports these builders** and keeps everything that makes it *it*:
  the designed 10-company/103-entry fixture, the XSS canary, probes P1–P12, the
  17-assert self-check ledger, the STRESS LEDGER output. **`npm run seed` behavior is
  unchanged** — verify by diffing the printed ledger before/after the refactor.
- `computeExpectedDiscrepancies()` moves to a require-able location (the fixture module
  or its own file) so both `seed-dev.js` and the oracle test import the **same** mirror.

### B-2. Differential audit oracle → `test/audit-oracle.props.test.js`

Mechanically enforces the contract documented at the top of `src/main/audit.ts`
("seed-dev.js's computeExpectedDiscrepancies() mirrors this logic — keep them in sync"),
which today is protected only by the comment and one fixed fixture:

1. **Generate** a random vault via the fixture builders: arbitrary companies; entries
   whose rows randomly mix missing punches, zero durations, >12 h spans, desc-only rows,
   whitespace-only rows, custom labels; random `task_items` (breaks/lunches, including
   orphans); random `audit_dismissed` rows; random `work_state` (policy tiers vary).
2. **Run both channels** against the same db: the seed mirror and the real
   `countAuditDiscrepancies()` (with `session.user`/db handle arranged for the test —
   see constraints).
3. **Assert equality. Always.** Any future edit to either side that forgets the other
   fails within seconds with a shrunk, minimal vault naming the divergent row shape.

Scope guard: the engine detects exactly 6 discrepancy types and deliberately does NOT
flag row overlaps or stored-vs-span drift — the oracle asserts *agreement*, not new
detections. Do not "improve" either side inside this work.

### B-3. `reEncryptVault` whole-vault-space properties → `test/vault-crypto-reencrypt.props.test.js`

The most safety-critical routine in the app, currently unit-tested on specific cases;
properties prove the contract across the input space:

| # | Property |
|---|----------|
| B1 | **Success path:** random vault under key A (random companies/entries, optional profile + SMTP blobs) → `reEncryptVault(A→B)` → `ok:true`, every blob decrypts under B, none under A. |
| B2 | **All-or-nothing (read-phase):** corrupt one randomly chosen blob → `ok:false` and the returned db still decrypts **fully and correctly under key A** (zero mutation). |
| B3 | **Rollback (write-phase):** make `onCommit` throw → `ok:false`, returned db equals the pre-write snapshot (fully intact under A). |
| B4 | **`migrateTimeEntries` idempotency:** running twice ≡ running once; return count correct; migrated rows decrypt to their original `rows_json`; plaintext column blanked. |

**Phase B acceptance:** oracle + reEncrypt properties green; `npm run seed` output ledger
byte-identical (or explained) pre/post extraction; `run-app verify` targets still pass
against a fresh seed.

---

## Phase C (optional) — scoped branch-coverage report

The honest, scoped-down nod to MC/DC: `c8` (pure-JS, wraps Node's built-in V8 coverage)
run **only** over `audit.ts` + `vault-crypto.js` test executions, emitted as a **report,
not a CI gate**. Expectation: Phases A+B push those branches to ~100% anyway; the report
just proves it. Add as `npm run coverage:critical`. Skip entirely if it drags.

---

## Constraints & gotchas

- **PBKDF2 is deliberately slow** (310k iterations, ~100 ms+ each). The `deriveKey`
  property either runs ≤5 iterations of fast-check or the function gains an optional
  test-only `iterations` parameter (default 310000 — production callers unchanged).
  Never lower the production iteration count.
- **No native deps.** `fast-check` and `c8` are both pure JS. Nothing else gets added.
- **sql.js in tests:** the fixture builders use the same in-memory `SQL.Database`
  pattern as `test/db.test.js`. All ID reads via `rowid as rid` (gotcha #1) — the
  builders must follow the same discipline as `src/main/db.ts`.
- **`audit.ts` imports `./db` and `./session`** (module-level singletons). The oracle
  test needs the same seam `test/db.test.js` uses (or a minimal injection point). If a
  small refactor is needed to point `dbGet/dbAll` + `session.user` at the test vault,
  keep it surgical — no behavior change to production wiring.
- **Reproducibility:** every `fc.assert` failure prints its seed; record the seed in the
  test-failure issue/commit when fixing a found bug.
- **Out of scope (explicitly):** k6/Artillery (no HTTP surface exists), true formal
  verification, DO-178C/DO-333 certification artifacts, and the volume/perf seed flag
  (separate roadmap item if year-three-scale performance ever needs measuring).

## Phasing & sequencing

| Phase | Contents | Depends on | Est. effort |
|-------|----------|-----------|-------------|
| A | fast-check + Tier-1 properties (A1–A12) | — | ~1 session |
| B | fixture extraction, differential oracle, reEncrypt properties (B1–B4) | A merged | ~1–2 sessions |
| C | c8 coverage report script | B (for meaningful numbers) | ~½ session |

Each phase is its own branch + PR per project convention.
