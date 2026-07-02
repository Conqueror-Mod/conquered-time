# TypeScript Phase 1 — Surfaced-Error Inventory

Deliverable of Phase 1 (docs/refactor-plan.md). First full `tsc --noEmit` run
against v3.10.0 surfaced **367 distinct errors**; final state is **0 errors,
suite green (38 pass)**. This document is the triage record and the input to
the Phase 3 go/no-go decision.

## Headline numbers

| Category | Count | Resolution |
|---|---|---|
| (a) Real latent bugs | **1** | Fixed immediately (below) |
| (b) Type-declaration gaps | ~30 | Fixed in `types/globals.d.ts` |
| (c1) DOM-narrowing noise | ~305 | `types/phase1-dom-compat.d.ts` shim (delete in Phase 3) |
| (c2) Benign coercion noise | 17 | Targeted `@ts-ignore` + reason comment |
| (c3) JSDoc-precision noise | ~14 | Structural types / JSDoc any-casts |

The shared modules (`row-utils`, `time-parse`, `canvas-text`, `store`, `ipc`,
`validator`, `vault-crypto`, `read-cache`, `beta-keys`, `preload`) surfaced
**zero** errors — the quality campaign's extraction work paid off. All noise
lives in the page files, which is exactly the Phase 3 scope.

## (a) Real latent bug — fixed

**Menu "Lock Session" silently bypassed the audit warning** ([main.js:507](../src/main/main.js#L507)).
`click: lockSession` let Electron pass the `MenuItem` object as the first
argument, which `lockSession(skipAuditCheck = false)` read as a *truthy*
`skipAuditCheck` — so locking via File → Lock Session or its `Ctrl+L`
accelerator skipped the unresolved-discrepancy warning that every other lock
path (tray, sidebar, idle timeout) shows. Fixed by wrapping:
`click: () => lockSession()`. This is the classic bug class the plan cites
(C6-adjacent: an edge path behaving differently from the main path).

Worth carrying to Phase 2: `wc.getOwnerBrowserWindow()` ([main.js:1942](../src/main/main.js#L1942))
works at runtime but is absent from Electron 29's typings — switch to
`BrowserWindow.fromWebContents(wc)` during the main-process split.

## (b) Declaration gaps found while typing the IPC surface

Writing `IpcInvokeMap` against the *actual* handlers exposed a set of
renderer/main shape mismatches that were invisible before — all were the
declaration being wrong, not the code, but several are one-typo-away bugs
Phase 2 will lock down:

- `profiles:select/load/delete` take `{ username }` / `{ password }` objects, not bare strings.
- `auth:login` payload is `{ username, password, totpCode }` (not `totp`).
- `totp:generate` returns `qrUrl`, not `qr`.
- `auth:check-setup` returns `{ needsSetup }`, not `{ setup }`.
- `tasks:summary` ignores its argument and returns `{ break_count, lunch_count }` per entry — the `ipc.js` wrapper still forwards an `entryId` that the handler drops.
- `profile:get` includes `work_state` only because `profile:save` tucks it into the encrypted blob — undocumented until now.
- Login/lockout flags (`attemptsLeft`, `locked`, `hoursRemaining`, `quickUnlock`, `passwordReset`, `noKeyPacket`, `canceled`) now typed as `AuthResult`.
- `shell.js` reads `c.rid` as a fallback for company IDs, but `companies:list` never returns `rid` (the blob is decrypted JSON) — dead defensive code, documented on the `Company` type.

## (c) Noise classes and how each was handled

1. **DOM narrowing (~305 total across runs)** — `document.getElementById(...).value`,
   `.disabled`, `.dataset`, `.closest` on `EventTarget`, etc. Handled by
   `types/phase1-dom-compat.d.ts`, which widens the base DOM interfaces with
   truthfully-typed optional members instead of ~240 scattered casts. **This
   file is scaffolding: Phase 3 must delete it** and replace with per-page
   `as HTMLInputElement` casts as pages convert.
2. **Benign coercions (17 `@ts-ignore`s)** — `el.textContent = someNumber`,
   `opt.value = numericId`, Date subtraction, a guarded `input.select()`.
   All stringify/coerce correctly at runtime; each suppression carries a
   reason comment and is a trivial mechanical fix during Phase 3 conversion.
3. **JSDoc precision** — the CanvasText unit tests pass a stub ctx, so the
   param type is the structural `MeasuringCtx`, not `CanvasRenderingContext2D`;
   `ipc.js`'s generic spread needs an any-cast at its two `window.api.invoke`
   call sites (per-channel typing is enforced at the `IPC.*` wrapper surface).

## Phase 3 recommendation

**Go.** The inventory found exactly one real bug and zero structural surprises;
the page files' noise is mechanical (DOM casts + number-to-string coercions),
which is the cheap kind to burn down during per-page `.ts` conversion. Suggested
order: start with the smallest pages (dashboard, task-timer) to establish the
pattern, save `shell.js`/`login.js` (the two largest error sources, 101/85
initial errors) for last. Each converted page shrinks
`phase1-dom-compat.d.ts`'s justification; deleting it is the Phase 3
definition-of-done tripwire.

## Gate

- `npm run typecheck` = `tsc --noEmit` (new).
- `npm test` = `node --test && npm run typecheck` — type errors now fail the suite.
- `strict` remains `false`; tightening (`noImplicitAny` first) is a Phase 2/3 lever.
