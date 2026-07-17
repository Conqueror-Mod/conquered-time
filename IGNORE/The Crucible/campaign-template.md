# Crucible N — <date>

> Copy this file to `docs/quality/defect-register-vN.md` when the Crucible run
> starts. It doubles as the checklist and the register.

## Define
- **Scope**: everything shipped since v<last-campaign-release> — list:
  - [ ] <feature> (v<x.y>)
- **Instrument**: seed v<N> stress fixture + adversarial probes
- **Out of scope / cosmetic → notes backlog**:

## Measure
- [ ] Baseline: `npm test` green (record count: ___/___)
- [ ] Adversarial probes on new pure modules (scratchpad script):
  - [ ] impossible values · boundaries · injection strings · unicode · structural abuse
  - [ ] interplay pass: for every accepted-garbage finding, trace who reads it
- [ ] `npm run seed` → live driver sweep (`.claude/skills/run-app/driver.mjs`):
  - [ ] close the installed app first (single-instance lock), relaunch after
  - [ ] every in-scope surface: screenshot + XSS canary title check
  - [ ] hostile commits through real IPC → inspect what landed in the vault
  - [ ] re-seed when done (test pollution)

## Defects (Analyze — RCA required before a row lands here)

| ID | Sev | Surface | Defect (root cause) | Verified how |
|----|-----|---------|---------------------|--------------|
| D-N01 | | | | |

## Verified clean
- (everything attacked that held — as valuable as the defect list)

## Improve — fix clusters (PDCA)

| Cluster | Defects | Fix | PR | Checked by |
|---------|---------|-----|----|-----------|
| C1 | | | | original probe re-run + suite + live pass |

## Control — close-out
- [ ] All register rows fixed or explicitly deferred (with reason)
- [ ] Regression test per defect (rejection + adjacent legal behavior)
- [ ] Release cut: v___
- [ ] Lessons made permanent: CLAUDE.md gotcha / seed probe / test oracle / memory
- [ ] Crucible history table in `The Crucible/README.md` updated
