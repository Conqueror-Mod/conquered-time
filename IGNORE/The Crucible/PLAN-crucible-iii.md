# PLAN — Crucible III

Drafted 2026-07-17, during the beta soak (releases paused ~1 month from
2026-07-16). Runs when the soak ends. This is the first campaign to test the
method's two open claims from the paper (§10): absorbing **external field
reports** into Define, and the **visual tier** (layout linter) as a
register-grade detector. It is also the first *full-feature battery* campaign.

Copy `campaign-template.md` to `docs/quality/defect-register-v3.md` at start;
this plan feeds its Define/Measure sections.

---

## 1. Define

**Scope** — three streams, each with its own admission path:
1. **Beta field reports** (new): everything reported in Discord #feedback
   during the soak. Each report gets RCA before it lands in the register —
   user-observed symptom → mechanical reproduction → causal line. Reports that
   resist mechanical reproduction go to the notes backlog, explicitly logged
   as such (this measures the method's absorption claim).
2. **Everything shipped since v3.24.2**: report redesign + identity-color
   module (v3.25.0), icon family + toast fix (v3.24.3), installer art,
   IGNORE/dev-data relocation, plus whatever ships after the soak.
3. **The full-feature battery** (§3): first exhaustive sweep of every field,
   punch style, ruling, and setting — including features that predate
   Crucible I and were never systematically swept.

**Defect definition** — unchanged (crash, wrong/corrupt data, security
escape, hang, silent garbage acceptance) **plus, new this campaign**: layout
faults reported by the linter (mechanical tier only). The contrast findings
already queued from the linter's calibration run are pre-registered:

| Pre-reg | Sev | Finding |
|---------|-----|---------|
| D-3xx | High | Reports page active tab renders at 1.65:1 contrast (Zanarkand) |
| D-3xx | Low | App-wide muted-text token (`.chip-sub`, hints, week-block labels, row numbers) ≈ 2.4:1 — decide the `--text-dim` token deliberately, not per-element |

**Instrument** — seed v5 (§2) + the battery decks (§3) + probe-layout.js.

---

## 2. Seed v5 — state gaps to add

The seed remains the **substrate**: pathological/unreachable states, volume
data, and calibration. New fixtures (keep the self-check ledger in sync — it
must assert every addition, and `computeExpectedDiscrepancies()` in
`test/vault-fixture.js` must stay mirrored with `audit.ts` or the oracle
fails):

- **Open punch at seed time** — one entry with a clocked-in-not-out row and
  `clock_in_ms` set, so tray/hotkey/idle-nudge decks start from a live punch
  without having to create one.
- **Policy-tier profile coverage** — the seeded user is `work_state=TX`
  (default tier). Add: a state with its OWN policy tier (exercises the
  state-specific break/lunch thresholds and the `hasStatePolicy` copy gate,
  C5/D-007 class), plus `break_style=pomodoro` fixtures for each preset
  (classic/extended/gentle). Note: dev mode is single-vault — implement as a
  seed FLAG (`npm run seed -- --state=CA --pomodoro=classic`) that re-seeds
  the profile variant, not as multiple profiles.
- **Fully-populated company blob** — at least one company with EVERY field
  carrying a hostile-but-valid value: `report_email`, `currency` (non-USD),
  `billing_address` (multiline + unicode), all three platform fields,
  supervisors, notes, custom `color`. Lights up the invoice + scheduled-report
  fallback chains end to end.
- **Scheduled-report config** — SMTP settings populated (fake host — decks
  assert the attempt, not delivery), schedule enabled, scope `'each'`, and a
  `email_schedule_last_sent` two windows stale so the catch-up logic fires on
  first login. One company with `report_email` set, one without (fallback).
- **Richer invoice ledger** — add a voided invoice and a number sequence with
  a gap, so the `max(seq)+1` floor and status-gated ledger actions have real
  targets.
- **Window/app-global prefs** — a written `app-prefs.json` fixture variant
  (close-to-tray on, custom hotkey) for the decks that test app-global
  settings (these live outside the vault).

## 3. The battery decks

Data-driven driver sequences, one file per deck under
`IGNORE/The Crucible/decks/`, run by a new driver command (`deck <name>`).
Each deck ends with the standard assertions: XSS canary title, audit count
delta, layout lint on touched pages, and (where relevant) a vault-value
readback. Decks are PERMANENT instrument — Crucible IV inherits them.

**Deck 1 — field-entry sweep.** For every page with inputs (company modal,
profile, invoice generator, tracker cells, import mapping, settings, search):
enumerate `input/textarea/select/contenteditable`, type the hostile set
(XSS string, unicode/emoji, 500-char overflow, whitespace-only, quotes,
`=HYPERLINK` formula, newlines where multiline), save, reload the page, and
verify round-trip fidelity + escaping. Mechanized enumeration beats a
hand-list — new fields are swept automatically forever.

**Deck 2 — punch choreography.** Tracker clock-in/out; "+ Manual Entry"
backfill; tray punch in/out; global hotkey toggle; punch with the tracker
OPEN on the same entry (the `punch:changed` in-place reload + stale
`updated_at` guard); punch across midnight (open 23:5x, close 00:0x — assert
wrap math and `findOpenPunch`'s yesterday scan); clock-out auto-stopping
running task_items (C6 rule); locked-session punch (must open app, never
queue); no-history punch (must open tracker, never blank-punch). Each step:
audit-count + total_mins assertions.

**Deck 3 — break/lunch rulings.** For state-default tier, the seeded
own-policy state, and each pomodoro preset: simulate work spans crossing each
warning threshold and assert (a) the correct warning fires at the correct
minute, (b) warnings PROMPT to punch and never auto-punch, and (c) the audit
engine + lunch warnings stay on STATE policy regardless of pomodoro (the
documented invariant — if this fails, both `countAuditDiscrepancies` and the
fixture mirror are implicated; the oracle should scream first).

**Deck 4 — settings matrix.** Toggle EVERY control in all 8 settings tabs.
After each change: layout lint + canary + one functional spot-check per
setting (theme → computed background changes; scale → #main-content zoom,
sidebar untouched (gotcha #5); clock format → tracker cells re-render
(ct:settings-changed); idle lock → session locks at the interval; hotkey
rebind → old binding dead, new binding punches, invalid binding rolled back;
colorblind → `identityCss` palette actually swaps; reduced motion →
data-attr set). Theme×scale = 20 combos with a lint on each (~10ms/combo —
this alone would have caught the entire 2.4:1 contrast cluster per theme).
App-global prefs (tray, launch-at-startup, start-minimized) get a separate
half-manual checklist — they cross the OS boundary the driver can't assert.

**Deck 5 — organic-vs-seed differential** (the architecture experiment).
Build a nominal 3-company/10-entry world twice: once through real IPC
(`companies:save`, `entries:save`, punches), once through seed builders.
Decrypt and diff the two vaults field-by-field. Any divergence = a write-path
bug found for free. This is the first empirical test of the two-layer world
design (seed as substrate, decks as organic layer).

**Deck 6 — exports & outbound artifacts.** Against the hostile fixture:
every PDF (tracker, global-log per-session + export-all, invoice, emailed
report HTML), every CSV (global-log, reports, emailed), invoice email path
(assert compose, fake SMTP). Verify: escaping in artifacts, NavID NEVER
present, identity colors match the vault's colorMap, multiline desc
flattening, CSV formula-injection guard on every column.

## 4. Measure — run order

1. Baseline: `npm test` green (record count; ~219 at plan time).
2. Adversarial unit probes on modules new since v3.24.2 (identity-color.js
   is the big one: hue determinism, override precedence, colorblind palette,
   groupKey unification — extend the probes into permanent tests if gaps
   found).
3. Seed v5 → self-check ledger green.
4. Decks 1–6 (each is independently resumable; re-seed between decks that
   pollute).
5. Layout lint: all 11 pages × 5 themes × 4 scales (Deck 4 covers this).
6. Field-report RCA stream (§1.1) — interleave as reports are triaged.

## 5. Improve / Control

Standard PDCA clusters. Expected clusters at plan time: **C1 contrast/token**
(pre-registered linter findings — a `--text-dim` decision is a THEME-layer
fix, touch themes.css not components), **C2 whatever the battery finds**,
**C3 field-report cluster**. Close-out additionally requires:
- Every deck committed under `IGNORE/The Crucible/decks/` (permanence).
- Paper addendum or §10 update: results of the two claims under test.
- Crucible history table updated; register archived as `defect-register-v3.md`.

## 6. Open questions (decide at campaign start)

- Does the linter's contrast floor stay at 2.5:1, or move to WCAG 3:1 once
  the token decision is made? (Raising it before the fix would flood the
  register with one root cause — keep 2.5 until C1 lands, then raise.)
- Golden-screenshot tier: build now or defer to Crucible IV? (pixelmatch is
  pure JS and fits constraints; cost is baseline blessing across 220 shots.
  Lean: defer unless Deck 4 shows theme regressions the linter can't see.)
- Multi-profile battery (profile selector, quick unlock, recovery flows) —
  currently untouched by any deck; needs a non-dev harness design because
  `--dev` bypasses the profile selector entirely.
