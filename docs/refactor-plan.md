# TypeScript Refactor Plan — Conquered Time

Approved 2026-07-02 (Phases 1–2; Phase 3 held pending Phase 1 findings).
Baseline: v3.10.0, master, 49-test suite green, quality campaign closed
(docs/quality/defect-register.md).

## Goal

Type safety across the codebase — especially the IPC boundary and data-row
shapes — without sacrificing the app's no-bundler, CSP-strict architecture or
destabilizing what the quality campaign just hardened. The campaign's C3
cluster (desc-blind predicates, `desc` vs `description`, hand-rolled row
shapes) is precisely the bug class static types eliminate.

## Constraints (why not a one-shot rewrite)

- **No build step today.** Renderer pages load plain `.js` via `<script src>`
  under `script-src 'self'`; files communicate through globals (`Shell`,
  `Store`, `api`, `escapeHtml`, `RowUtils`, `CanvasText`, `Settings`).
- A full `.ts` conversion of ~11k lines in one pass is high-churn /
  high-regression-risk and hard to review.
- electron-builder packaging and `npm start` must keep working at every phase
  boundary; each phase lands as its own PR(s) with the suite green.

## Phase 1 — Types without migration (checkJs) — APPROVED

Zero runtime change; the diff is config + comments.

1. `tsconfig.json` at repo root: `allowJs: true`, `checkJs: true`,
   `noEmit: true`, `strict: false` to start (tighten later), `target/lib`
   matching Electron 29's Chromium/Node.
2. `types/globals.d.ts`:
   - Renderer globals: `Shell`, `Store`, `Settings`, `escapeHtml`,
     `flattenText`, `RowUtils`, `CanvasText`, `parseClockInput`, `api`
     (the preload surface), `PDF_FONT_CSS`.
   - Core data shapes: `EntryRow` (label/name/desc/clock_in/clock_out/
     total_mins/_manual), `TimeEntry`, `EntrySummary` (NO rows_json — enforce
     the entries:all vs entries:summary split in types), `Company`,
     `TaskItem`, `AuditPolicy` (incl. `hasStatePolicy`), `Profile`.
   - `IpcChannels` interface mapping every whitelisted channel to its
     request/response types (single source of truth for phase 2).
3. JSDoc annotations (`@param`/`@returns`/`@type`) on the shared modules
   first — `row-utils.js`, `time-parse.js`, `canvas-text.js`, `store.js`,
   `ipc.js`, `validator.js`, `vault-crypto.js`, `read-cache.js`,
   `beta-keys.js`, `preload.js` — then opportunistically on page files as
   errors surface.
4. Gate: `npm run typecheck` = `tsc --noEmit`; wire into `npm test`
   (`node --test && tsc --noEmit`). Type errors fail CI/tests.
5. Deliverable: the surfaced-error inventory. Triage into (a) real latent
   bugs — fix immediately, register style; (b) type-decl gaps — fix in
   `globals.d.ts`; (c) noise to suppress with targeted `@ts-ignore` +
   comment. This inventory decides how aggressive Phase 3 can be.

Definition of done: `tsc --noEmit` clean; suite green; zero runtime diffs
(`git diff` shows only comments/config/types).

## Phase 2 — Main process to real TypeScript + modular split — APPROVED

`src/main/` has no CSP/script-tag constraints — clean to migrate. This phase
deliberately combines the TS conversion with the long-wanted main.js split
(2,310 lines today), because moving code is the cheapest moment to type it.

Target layout (compiled output keeps the same runtime entry):

```
src/main/
├── main.ts            # app lifecycle, window, splash, tray, single-instance
├── db.ts              # sql.js open/persist (atomic write), dbAll/dbGet/dbRun/dbInsert, rowid discipline
├── session.ts         # sessionKey/sessionUser, idle lock, sweepOrphanTaskItems
├── policies.ts        # BREAK_POLICIES, STATE_POLICY, STATE_NAMES, getPolicy, requiredBreaks
├── audit.ts           # countAuditDiscrepancies, dismissed set
├── backups.ts         # performBackup, backup library, restore
├── email.ts           # nodemailer transport, doSendReport, scheduler/catch-up
├── ipc/
│   ├── auth.ts        # auth:*, totp:*, profiles:*, beta:*
│   ├── entries.ts     # entries:*, tasks:*
│   ├── companies.ts   # companies:*
│   ├── settings.ts    # settings:*, app-prefs, win:*
│   └── audit.ts       # audit:*
└── (existing pure modules become .ts: vault-crypto, read-cache, beta-keys)
```

Build plumbing:
- `tsc -p tsconfig.main.json` → `dist-main/` (CommonJS). `package.json`
  `main` → `dist-main/main.js`; `npm start` = `tsc -p ... && electron .`;
  electron-builder `files` glob adds `dist-main/`, keeps `src/renderer/`.
  **`src/shared/beta-secret.js` handling must be preserved** (gitignored,
  bundled; require stays fail-open).
- preload.js compiles too; the `IpcChannels` type from Phase 1 types both
  sides of every handler.

Sequencing inside the phase (one PR each, suite + run-app verified):
1. Build plumbing + `main.ts` rename-only compile (no split yet) — proves
   packaging/dev-loop end to end. **Cut a local NSIS build and smoke-test
   the packaged exe before proceeding.**
2. Extract `db.ts` + `policies.ts` (lowest coupling).
3. Extract `session.ts`, `audit.ts`, `backups.ts`, `email.ts`.
4. Split `ipc/*` handler modules; delete the remaining monolith.
5. Tighten tsconfig (`strict: true` for src/main).

Definition of done: main process fully `.ts` + modular; packaged NSIS build
installed and smoke-tested (login, tracker, audit, backup, tray, scheduled-
report catch-up); suite green; CLAUDE.md structure/docs updated.

## Phase 3 — Renderer pages to .ts — HELD

Not approved yet. Revisit after Phase 1's error inventory. Shape if it
proceeds: per-page `tsc` output to the same filenames the HTML already
references (no bundler, CSP untouched), one page per PR, run-app verified —
same cadence as the v3.6 CSP sweep.

## Risks / gotchas to carry through

- sql.js rowid discipline (CLAUDE.md gotcha #1) — encode in `db.ts` types
  (e.g. branded `RowId` type), keep `Number(row.rid)` the only path.
- Node v20.11.1 stays the toolchain; typescript is a devDependency only.
- No new runtime deps; no bundler; no framework.
- Every phase boundary leaves master shippable (v3.10.x could be cut at any
  point).
