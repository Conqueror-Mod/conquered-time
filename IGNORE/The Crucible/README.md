# The Crucible — RCA › DMAIC › PDCA

The Crucible is Conquered Time's quality methodology: a full-app stress
campaign where everything shipped is melted down to burn out the impurities
and prove what survives. It has been run twice — **Crucible I** (2026-07-01/02, 14
defects → v3.10.0) and **Crucible II** (2026-07-16, 4 defects → v3.24.2) — and
this is the playbook for running it again.

The name reads inside-out: **RCA** (Root Cause Analysis) is the discipline
applied to every individual defect, **DMAIC** is the structure of the whole
campaign, and **PDCA** is the loop each fix cluster goes through. RCA sits
inside DMAIC; DMAIC's Improve phase is made of PDCA loops.

```
DMAIC  (the campaign)
├── Define    — scope: which surfaces, since when, what "broken" means
├── Measure   — baseline suite + adversarial probes + live UI stress
├── Analyze   — RCA on every finding (root cause, not symptom)
├── Improve   — PDCA loop per fix cluster
│               ├── Plan   — cluster related defects, design the fix
│               ├── Do     — implement + regression tests
│               ├── Check  — re-probe, run suite, verify live in the app
│               └── Act    — merge the cluster PR, update the register
└── Control   — defect register closed out, release cut, lessons → memory/docs
```

---

## 1. Define — scope the campaign

Answer three questions in writing (they open the defect register):

1. **What's in scope?** Usually "everything shipped since the last campaign"
   — list the features and their versions explicitly.
2. **What counts as a defect?** Crashes, wrong data, silent data corruption,
   security escapes (XSS/injection), hangs, and "silently accepts garbage."
   Cosmetic nits go to the notes backlog, not the register.
3. **What's the measurement instrument?** For this app: the stress seed
   (`npm run seed` — see below) plus targeted adversarial inputs.

## 2. Measure — three layers, in order

### 2a. Baseline
`npm test` must be green before anything else. A failing baseline means you're
measuring old damage, not new. Record the count (e.g. "212/212, typecheck
clean") in the register.

### 2b. Adversarial unit probes (pure modules first)
Every campaign starts with the **pure, require()-able modules** touched since
the last one (`import-parse.js`, `insights-compute.js`, `invoice-html.ts`,
`report-html.ts`, …). Write a throwaway probe script (scratchpad, not the
repo) that throws hostile inputs at them:

- **Impossible values**: Feb 31, year 9999, negative durations, 1e9 minutes
- **Boundary values**: 0, exactly-at-limit (1440), equal clock in/out, midnight wrap
- **Injection strings**: `<script>`, `O"Brien`, `A||B` (delimiter chars), `=HYPERLINK`
- **Unicode/emoji**: `Café Müller 東京 🚀`
- **Structural abuse**: duplicate headers/names, whitespace-only fields, BOM,
  lone quotes mid-field, corrupt JSON

**Chase interplay, not just crashes.** Crucible II's worst find (D-102) was two
individually-defensible functions composing badly: the import validator let a
typo'd year through, and the trend chart gap-filled 416,115 empty buckets
trying to graph it. When a probe finds bad data being *accepted*, immediately
ask: *who reads this value later, and what do they do with it?*

### 2c. Live UI stress (run-app driver)
`npm run seed` resets the dev vault to the stress fixture — a designed
measurement instrument, not sample data: an XSS canary company (`onerror`
probes set `document.title='XSS-FIRED'` if any sink is unescaped),
unicode/emoji names, a 120-char overflow probe, midnight-crossing sessions, a
session with exactly 6 audit issues, orphaned task rows, and a zero-entry
control company. Then drive the real app:

```
node .claude/skills/run-app/driver.mjs
  launch / login / nav <page> / eval <expr> / ss <name>
```

Sweep every in-scope surface against the fixture: screenshot, check
`document.title` (canary), exercise context menus, search hostile strings,
commit hostile payloads through real IPC and confirm what lands in the vault.
**Gotcha:** the driver cannot launch while the installed app is running — the
single-instance lock is shared. Close it first (`Get-Process 'Conquered Time'
| Stop-Process`), relaunch it from
`%LOCALAPPDATA%\Programs\Conquered Time\Conquered Time.exe` when done.

## 3. Analyze — RCA per finding

Every finding gets a register row **only after** its root cause is understood.
The rule: reproduce it mechanically (a one-liner probe or driver script that
demonstrates it), then trace to the exact line and answer *why the code was
written that way* — most defects are a reasonable assumption invalidated by a
later feature. Symptom-level entries ("chart is slow sometimes") are not
accepted; "trendBuckets gap-fills unboundedly between first and last key, so
one far-out date allocates 416k buckets" is.

Severity: **High** = data corruption, hang, security escape, silent wrong
numbers. **Low** = guarded-but-ugly, DX friction, missing diagnostics.

## 4. Improve — PDCA per cluster

Group defects that share a fix locus into **clusters** (Crucible I: six
cluster PRs C1–C6; Crucible II: one PR covering C1–C3). Per cluster:

- **Plan** — decide the fix and its blast radius. Prefer fixing the *acceptor*
  (validate at the boundary) AND the *reader* (defensive cap) when a defect is
  an interplay — Crucible II fixed both the import validator and the chart cap.
- **Do** — implement, plus a regression test per defect that asserts the
  rejection AND that adjacent legal behavior still works (leap day accepted,
  1440 exactly allowed, normal spans still gap-fill).
- **Check** — re-run the original probe (must now pass), full suite, and a
  live driver pass on the affected surface. A fix is not "done" at green
  tests; it's done when the original reproduction no longer reproduces.
- **Act** — cluster PR with the register IDs in the description; merge;
  mark the register rows fixed.

## 5. Control — close out

- The defect register (`docs/quality/defect-register-v2.md` is the live
  example) gets a close-out section: what was fixed where, what was verified
  clean, and the fix-cluster → PR mapping.
- Cut the release; the register lists it.
- **Lessons become permanent**: anything structural goes to CLAUDE.md
  (gotchas), the seed (new probes for next time), or the test suite
  (properties/oracles). Crucible I produced the shared `row-utils.js` /
  `time-parse.js` modules and later the property-testing oracle; Crucible II
  produced calendar validation, the bucket cap, and the loud lock exit.

---

## Register format

One table row per defect:

| ID | Sev | Surface | Defect (root cause, one paragraph) | Verified how |
|----|-----|---------|-------------------------------------|--------------|

IDs are campaign-scoped (`D-1xx` for Crucible II, `D-2xx` for Crucible III, …).
Below the table, always include a **"Verified clean"** section — the things
you attacked that held. It's half the value of the campaign: the next person
should know the XSS canary was swept and passed, so they don't re-sweep it.

## Crucible history

| # | Date | Scope | Found | Fixed in | Shipped |
|---|------|-------|-------|----------|---------|
| 1 | 2026-07-01/02 | Full app (first sweep) | 14 defects (C1–C6) | PRs #41–#46 | v3.10.0 |
| 2 | 2026-07-16 | Everything since v3.10.0 | 4 defects (D-101–104) | PR #157 | v3.24.2 |

The trajectory (14 → 4 on a much larger surface) is the Crucible's own
measurement: shared modules, property tests, and the seed's canaries catch
whole defect classes before a campaign ever runs.
