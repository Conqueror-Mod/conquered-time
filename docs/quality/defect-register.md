# Quality Campaign — Defect Register

Living document for the DMAIC quality campaign (started 2026-07-01).
Method: Define → Measure (seed v4 + full sweep) → Analyze (RCA clusters) →
Improve (PDCA batches) → Control (regression locks).

Severity: **S1** blocker · **S2** major (wrong behavior/data) · **S3** minor
(cosmetic, still wrong) · **S4** polish (sloppy but defensible).
Status: `open` → `confirmed` (reproduced in sweep) → `clustered` → `fixed` → `locked`.

| ID | Sev | Area | Summary | Source | Status |
|----|-----|------|---------|--------|--------|
| D-001 | S3 | Reports/Audit | "Email Me" button illegible on darker themes | user-tracked | fixed (PR #42) |
| D-006 | S4 | Reports | Company Breakdown cards don't clamp long names/hierarchy — 120-char name balloons the card and misaligns its stats row | sweep A | fixed (PR #43) |
| D-007 | S3 | Reports/Audit | Break/lunch suggestion says "Texas law requires…" for default-policy states — implies a state legal mandate that doesn't exist (TX has no such law; it's the app's default policy) | sweep A | fixed (PR #45) |
| D-002 | S3 | Tracker | 12h/24h entry mismatch: display shows "2:30 AM" but the editor accepts only raw 24h with no AM/PM affordance — typing "2:30" meaning PM silently stores 02:30 AM | user-tracked | fixed (PR #41) |
| D-010 | S2 | Tracker | SILENT DATA LOSS: double-clicking the Task Label of a row whose label isn't in the fixed list opens the select pre-set to "Training"; blurring with NO user choice commits "Training" over the original value | sweep B (probe P4) | fixed (PR #41) |
| D-003 | S3 | Companies web | Spiderweb nodes don't expand for long company names; long names render badly | user-tracked | fixed (PR #43) |
| D-004 | S3 | Reports/Audit | Audit skip-filter ignores desc-only rows (user content silently unaudited) — probe P1 | seed build | fixed (PR #44) |
| D-008 | S3 | Companies | Details pane: long unbroken strings force pane-wide horizontal scrollbar; title lines clip at pane edge with no ellipsis | sweep C | fixed (PR #43) |
| D-011 | S3 | Global Log/exports | Desc-blind row filters (cluster with D-004): a desc-only row is invisible in Global Log expanded detail AND absent from CSV export (likely PDF too — same `label\|\|name` predicate) | sweep D | fixed (PR #44) |
| D-012 | S2 | Dispatch | An in-progress task (or break) whose session has no open punch is invisible and unstoppable: entries:get-active returns null → Dispatch shows "No active punch", sidebar timer hidden — no recovery path for the running task | sweep E (probes P8/P9) | fixed (PR #46) |
| D-013 | S4 | Profile | Phone Number input is unstyled — stock white system input amid themed fields | sweep G | fixed (PR #42) |
| D-009 | S4 | Dashboard | Future-dated session headlines "Recent Activity" with no visual distinction (also floats to top of audit/global lists) | sweep C | fixed (PR #46) |
| D-005 | S3 | Tracker | Same-date sessions: tracker loads first match only; second same-day session unreachable from tracker | seed build | fixed (PR #46) |
| D-014 | S3 | Tracker | `buildRows()` at init end unconditionally wiped a session restored via Global-Log-Open / dashboard-node navigation (table showed 5 blank rows despite "Session loaded") | C6 Check | fixed (PR #46) |

## Sweep coverage & known gaps (Measure phase, honest ledger)

Swept with seed v4 via the run-app driver: Reports (all 3 tabs, 4 themes on the
audit row), Companies (full web + detail pane + XSS canary), Tracker (edge
session, inline-edit probes, manual entry), Global Log (volume, filters, detail
expansion, CSV capture via intercepted download), Dispatch (orphan-task state),
Settings (Data tab, Backup Library, Large scale), Profile. XSS canary silent on
every page swept.

NOT covered (needs manual/Tier-B or credentials):
- PDF exports (opens a native print dialog — verify visually: long/unicode
  names in headers, edge-session rows, NavID absence)
- Email/SMTP send paths (need real SMTP credentials)
- Full 5-theme × every-page matrix (spot-checked; audit buttons measured
  across 4 themes)
- Tray/lock/auto-lock interactions (verified in prior sessions)

## Analyze — root-cause clusters (RCA)

**C1. Inline-edit commit semantics** — D-010 (S2), D-002 (S3). One code site
(tracker.js startEdit/commit). The label <select> drops foreign values and
commits on blur with zero user interaction; the time editor contradicts the
12h display format with no affordance. *Why:* the editor assumes its option
list is the universe of values, and commit-on-blur has no "did anything
change?" guard. Fix: inject current value as an option; skip commit when
value === original; accept 12h input (or show format hint) when pref is 12h.

**C2. Styling omissions** — D-001 (S3), D-013 (S4). Elements shipped with no
color/style rule at all, falling back to UA defaults that only look right on
light themes. *Why:* no base fallback on shared component classes, so a missing
variant rule fails invisible-not-loud. Fix: style the two elements + add base
`color` to `.audit-row-btn` so future variants can't regress silently.

**C3. Desc-blind row predicates** — D-004, D-011 (S3). The "is this row real?"
predicate (`label||name[||clock]`) is hand-rolled in ≥4 sinks (audit engine,
global-log detail, global-log CSV, PDFs/email CSV) and none considers desc.
*Why:* no shared rowHasContent() helper. Fix: one shared predicate including
desc; audit flags desc-only rows (they hold user content with no punch);
detail/CSV/PDF include them.

**C4. Unbounded text in fixed layouts** — D-003 (S3, user-tracked), D-006,
D-008 (S3/S4). Canvas node labels hard-clip (both webs; mini-web double-draws),
breakdown cards balloon, detail pane x-scrolls on unbroken strings. *Why:* no
text-measurement/clamp discipline for user-controlled strings. Fix: shared
canvas ellipsize-to-radius helper for both webs; CSS line-clamp on card
titles; overflow-wrap + title-ellipsis in the detail pane.

**C5. Policy wording** — D-007 (S3). Default-policy states get "<State> law
requires…" copy implying a nonexistent legal mandate. Fix: policy-source-aware
wording ("Standard practice recommends…" for default tier).

**C6. Temporal/state edge semantics** — D-005, D-009, D-012 (S2–S4). States
the data model permits but the UI never planned for: same-date session pairs
(tracker loads first match, second unreachable), future-dated entries (headline
"Recent Activity"), in-progress task/break with no open punch (invisible,
unstoppable). *Why:* implicit invariants ("one session per day", "no future
dates", "tasks only run inside punches") never enforced nor handled. Each fix
needs a small design decision — options in the fix plan.

## Proposed fix order (Improve phase — awaiting approval)

1. **C1** — S2 data loss, small change, user-tracked area
2. **C2** — trivial, includes user-tracked D-001
3. **C3** — mechanical once the shared predicate exists
4. **C4** — user-tracked D-003 + the cosmetic cluster
5. **C5** — small wording fix
6. **C6** — needs design decisions first (see options), then implement

## Detail

## Observations (not defects — faithful renders of designed drift)

- **O-1:** Company Breakdown label chips can exceed the card's session total
  (Zenith: "Annotation 20h 20m" vs 18.3h total) because chips sum row
  `total_mins` while the total sums entry `total_mins` — two sources of truth
  shown side-by-side with no reconciliation. Surfaced by the seed's
  discrepancy session (rows deliberately don't sum to the entry total).
  Related probe: P3.
- **O-2:** XSS canary company name renders as escaped text everywhere visited
  so far (Reports tabs, audit) — `document.title` never fired. Good.
- **O-3:** Audit render at 103 entries ≈ 610ms; Period/Company tabs ≈ 415ms.
  Acceptable; no perf defect at this volume.
- **O-4:** Midnight-crossing duration math is CORRECT — computeDiffMins wraps
  past midnight (23:30→00:15 = 45m), and re-editing the row keeps 45m. Probe
  P2 passes; no defect.
- **O-5:** Global Log CSV is structurally sound under stress: 117 lines, 0
  unbalanced-quote lines, emoji/CJK intact, embedded quotes doubled correctly,
  custom labels present. Global Log filter counts exact at volume
  (103/4/6/1/92/0). No injection execution anywhere swept (XSS canary silent).

### D-001 — Audit "Email Me" illegibility
CONFIRMED (sweep A). Root cause: reports.js renders the button as bare
`class="audit-row-btn"` (no variant class), and the base rule sets
`background: transparent` with NO `color` — so the button falls back to the UA
default `rgb(0,0,0)`. Measured black in ALL themes (zanarkand/treno/nibelheim/
memoria); it reads on light themes only by luck. Fix shape: add an `email`
variant class + color rule (mirror `.dismiss`), consider a base `color` fallback
on `.audit-row-btn` so future variants can't regress the same way.
Screenshot: .tmp-shots/sweepA-audit-zanarkand.png.

### D-002 — Tracker manual time input idiosyncrasies
CONFIRMED (sweep B) as a 12h/24h mental-model mismatch. With the 12h display
pref, cells render "2:30 AM" but the inline editor is raw 24h HH:MM with no
AM/PM affordance and no format hint until a value is REJECTED. Measured: typing
"2:30" while meaning 2:30 PM commits 02:30 → displays "2:30 AM". Fix shape:
accept "h:mm am/pm" input when pref is 12h (normalize to 24h for storage), or
show the expected format inline. Related but distinct from D-010 (same inline-
edit family).
EXONERATED in the same pass: midnight-crossing math. computeDiffMins("23:30",
"00:15") = 45 — wrap handled correctly; editing the midnight row's clock-out
recomputes 45m, not a negative (see O-4).

### D-010 — Silent label loss on inline edit
CONFIRMED (sweep B, probe P4). rowsData label "Deep Work 🚀" → dblclick label
cell → editor is a <select> of the 9 fixed labels with "Training" preselected
(the foreign value isn't in the list) → blur with no user interaction → commit
writes "Training". Original label destroyed with zero user intent. Two roots:
(a) the select doesn't include/preserve the current foreign value; (b) blur
commits even when nothing changed. Fix shape: inject the current value as a
selected option (or skip commit when value === original).

### D-003 — Spiderweb long-name rendering
CONFIRMED (sweep C), both canvases. Node labels are hard-clipped to the fixed
node radius with NO ellipsis and NO node growth: "Zenith Analy", "Pristine Con",
"O'Brien & So", "The Extraord", "Padded Nam", sub-labels too ("Proyecto Ñ",
"ProjectNam"). The dashboard mini-web additionally draws the name twice (inside
the node AND below it) and clips both. Contrast: the Companies sidebar LIST
truncates correctly with an ellipsis — the defect is specific to the canvas
label renderers (companies.js + dashboard.js). Fix shape: measure text, either
scale node radius within bounds, or ellipsize to fit — shared helper so both
webs behave identically. Screenshots: sweepC-web-zanarkand.png,
sweepC-dash-miniweb.png.

### D-004 — Audit ignores desc-only rows
Found during seed v4 build. main.js countAuditDiscrepancies skip-filter tests
clock_in/clock_out/label/name but not desc, so a row holding only a description
is skipped. Question for Define: should it flag (probably as incomplete row)?

### D-005 — Same-date session ambiguity
Found during seed v4 build. loadTodayEntry() uses entries.find(log_date === today)
— first match wins. With two same-day sessions (seeded: Apex "Split Shift AM/PM"),
the second is visible in Global Log but can't be loaded in the tracker.
