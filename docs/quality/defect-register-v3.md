# Crucible III — 2026-07-19

> Campaign register. Method: RCA › DMAIC › PDCA (see IGNORE/The Crucible/README.md).
> First campaign to test the paper's two open claims: absorbing external field
> reports into Define, and the layout linter as a register-grade detector.

## Define

- **Scope**: everything shipped since v3.24.2, plus the beta-soak field-report stream:
  - [x] Report redesign + identity-color module (v3.25.0)
  - [x] Icon vector family + toast fix (v3.24.3)
  - [x] Installer art; IGNORE/dev-data relocation (tooling)
  - [x] Insights flex-collapse fix + axis decimals (PR #169, unreleased)
  - [x] App-wide gotcha-#7 hardening + `sweep` instrument (PR #170, unreleased)
  - [x] Field reports: Discord #bugs / #feedback during the soak (since 2026-07-16)
- **Instrument**: seed v4 stress fixture + adversarial probes + probe-layout.js
  (now with `flex-squeeze`) + driver `sweep` (10 pages × 3 window sizes)
- **Pre-registered linter findings** (from calibration run, admitted at Define):
  - D-301 (High): Reports page active tab ~1.65:1 contrast (Zanarkand)
  - D-302 (Low): app-wide muted-text token (`--text-dim` cluster) ≈ 2.4:1 —
    token-level decision, not per-element fixes
- **Out of scope / cosmetic → notes backlog**: golden-screenshot tier (deferred
  to Crucible IV); multi-profile battery (needs non-dev harness); seed v5 and
  battery decks 1–6 (planned instrument, not yet built — this run uses the
  existing instrument per the 2026-07-19 pre-campaign update in the plan).

## Measure

- [x] Baseline: `npm test` green (record count: **119/119**, typecheck clean, 2026-07-19)
- [x] Field-report intake: #bugs since 2026-07-16 triaged — 2 reports, both RCA'd
  (D-303 + a field confirmation of pre-registered D-302); none resisted
  reproduction → the method's absorption claim held on this (small) sample
- [x] Adversarial probes on new pure modules (scratchpad scripts):
  - identity-color.js — 26 probes → 2 defects (D-304, D-305); hostile hex,
    unknown-company fallback, hostile log_dates, groupKey abuse, parity,
    empty-world all held
  - report-html.ts — hostile entries (XSS canary, `=HYPERLINK`, Feb 31,
    year 9999, −50 and 1e9 mins, broken rows_json, hostile companyColors):
    HTML escaping / CSV formula guard / quote balance / aggregate all held;
    one micro-defect (D-306 `fmtMins(NaN)`)
- [x] `npm run seed` → live driver: XSS canary title checked on all 10 pages,
  verify-cursed-path, `sweep` 10 pages × 3 sizes (results below)

## Defects (Analyze — RCA required before a row lands here)

| ID | Sev | Surface | Defect (root cause) | Verified how |
|----|-----|---------|---------------------|--------------|
| D-301 | High | Reports (Zanarkand) | Active tab contrast ~1.65:1 (pre-registered from linter calibration) | probe-layout low-contrast |
| D-302 | Low | App-wide | `--text-dim` muted-text token ≈ 2.4:1 across chips/hints/labels — token decision needed. **Field-confirmed** during the soak: Georgia (2026-07-19 #bugs) reports Busiest Days value labels "very difficult to make out" in all size modes — that label uses the muted token | probe-layout low-contrast (75 hits / 30 sweep cells) + field report |
| D-303 | — | Companies (Galaxy) | Field report: "new company goes directly to archive." Root cause: pre-#165 archive rule had no created-date grace, so a zero-entry company was idle-archived at birth. Reporter runs v3.25.0 (2026-07-16); the grace fix (PR #165, `createdDays` in bubble-web.ts:304-321) merged 2026-07-19, after her build. **Already fixed on master; ships in today's release** | release-timeline diff + code inspection; grace covered by seed's Pristine Control Co probe |
| D-304 | Low | identity-color.js | With two rows carrying *different* manual Edit Color overrides in one galaxy, `rows.find(r => r.color)` made the winning color a fact of iteration order, not of the data — a latent cross-surface drift (galaxy write-all makes it rare; a per-system edit makes it reachable) | probe: reversed row order flipped hue 0↔240; fixed → min-rowid override wins; regression test |
| D-305 | Low | identity-color.js | Non-finite company id (undefined/NaN from a malformed row) indexed `pal[NaN]` → `hsl(undefined, …)` — invalid CSS the browser silently drops, rendering the identity dot/bar invisible | probe; fixed → pinned to palette slot 0; regression test |
| D-306 | Low | report-html.ts | `fmtMins(NaN)` printed "NaNm" into the emailed report if `total_mins` was ever non-numeric | probe; fixed → guards to 0m |

## Verified clean
- **XSS canary**: `document.title` clean on all 10 inner pages against the seed's
  hostile-company fixture (`<script>` names, onerror probes) — no sink fired.
- **Gotcha #6** (autosave duplication): verify-cursed-path — 4 saves on one
  session → exactly 1 row (Pristine Control Co).
- **Layout structure**: `sweep` 10 pages × 3 window sizes (down to 950×620) —
  zero flex-squeeze / collapsed / overlap / offscreen faults after the PR #169/
  #170 hardening. Only findings: the D-302 contrast cluster (78 hits, one root
  cause). The linter's `collapsed` check was tightened during the run (a 3px
  "›" separator glyph false-positived; now requires content > box).
- **report-html.ts**: HTML escaping, CSV formula-injection guard on every
  column, quote balance, NavID exclusion, aggregate under impossible dates /
  negative / 1e9 minutes / corrupt rows_json — all held.
- **identity-color.js**: hostile hex overrides, unknown/deleted-company
  fallback, hostile log_dates, future-dated entries, whitespace/emoji group
  keys, renderer↔main parity, empty vault — all held.
- **Field-report absorption claim (paper §10)**: 2/2 soak reports mechanically
  reproduced and RCA'd; 0 sent to the backlog as irreproducible.
- **Layout-linter register-grade claim (paper §10)**: the flex-squeeze detector
  was calibrated against the reverted #169 fix (flags exactly the faulty panel
  with the remedy) and its findings are deterministic across runs — claim holds
  for the mechanical tier; one noise class found + fixed (thin-glyph collapse).

## Improve — fix clusters (PDCA)

| Cluster | Defects | Fix | PR | Checked by |
|---------|---------|-----|----|-----------|
| C1 | D-301, D-302 | **Deferred — needs owner decision**: `--text-dim` / active-tab contrast is a theme-token design call (themes.css layer). Raising the linter floor to 3:1 waits until this lands | — | re-lint all themes after |
| C2 | D-304, D-305, D-306 | identity-color: min-rowid override precedence + non-finite-id palette pin; report-html: fmtMins NaN guard. 7 regression tests (test/identity-color.test.js) | this campaign's PR | original probes re-run → ALL PASS; suite 126/126 |
| C3 | D-303 | Fixed pre-campaign by PR #165 (archive created-date grace); field report was from a pre-fix build | #165 | code + timeline; ships in today's release |

## Control — close-out
- [x] All register rows fixed or explicitly deferred (C1 deferred: theme-token
  design decision belongs to the owner; everything else fixed)
- [x] Regression test per fixed defect (rejection + adjacent legal behavior)
- [x] Crucible history table updated (README)
- [ ] Release cut (owner)

**Baseline at close: 126/126 (119 baseline + 7 new), typecheck clean.**

Campaign notes: run 2026-07-19 with the *existing* instrument per the
pre-campaign plan update (seed v4 + probes + sweep); seed v5 and battery decks
1–6 remain queued for the full Crucible III supplementary run / Crucible IV.
Reply posted to the reporter for the D-302-adjacent label complaint pends the
C1 decision.
