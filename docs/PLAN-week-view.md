# PLAN — Week View (Dashboard weekly band)

**Status:** drafted 2026-07-12 · awaiting approval · targets **v3.22** (next feature after
tray-punch #139 + data-safety-net #140 land on master)
**Interactive mock:** `docs/mock-week-view.html` (self-contained; open in a browser).
Two directions were sketched in-session (volume columns vs. calendar time grid) — **Direction A
(volume columns) approved**; the time grid is explicitly not being built (see Deferred).
**Prior art:** none new — this is a rendering + layout job over data the app already computes.
Reuses `entries:summary` (no decryption) and the Galaxy identity-color logic in
`src/renderer/bubble-web.ts`.

## Concept

A "your week at a glance" band on the **Dashboard**: seven day-columns (Mon–Sun), each a
stack of session blocks sized by hours and colored per company, with the day's total beneath
it. The literal *"Tuesday was heavy, Thursday was empty"* read — column height is the signal,
empty days are obvious. Chosen over a calendar time-grid because it matches the feature's
intent, degrades gracefully on messy/backfilled times (it needs only durations, not wall-clock
placement), and is cheap to build.

## Placement (approved — Chris, 2026-07-12)

Lives on the **Dashboard**, not a new nav page. Current dashboard grid is: stat chips → a
2×2 grid (Company Network | Recent Activity on the tall first row, Quick Actions spanning the
bottom). Change:

- **Cap Recent Activity to 5 rows** so the top row no longer needs to be tall.
- Insert the Week band as a **full-width row** between the top row and Quick Actions (it wants
  all 7 columns across).
- Give the band a **fixed height** (~150px plot + labels); let the top row compress. Keep a
  **min-height on the Company Network** web so it never squashes to uselessness (its
  ResizeObserver already re-centers — gotcha #4). On very short windows the dashboard scrolls
  rather than crushing a panel.

Files: `src/renderer/pages/dashboard.html` (markup + the Recent-Activity cap), `dashboard.js`
(band render + week nav), `design-system.css`/page `<style>` (band styles).

## Approved decisions (Chris, 2026-07-12)

1. **Layout = Direction A, volume columns.** Not the calendar time grid.
2. **One block per session**, ordered by **clock-in time within the day** (three Zenith
   sessions read as three stacked blocks, not one merged slab — truer to the day, and each
   block is its own click target). *Not* merged per-company-per-day.
3. **Placement on the Dashboard**, Recent Activity capped to 5 (above).
4. **Scope = the current profile's companies**, by definition (the whole app is per-profile).
5. **Colors reuse the Galaxy identity hue** per company — `company.color` override → else the
   auto palette hue. Factor the hue logic out of `bubble-web.ts` into a shared helper so the
   band and the web can't drift (today `galaxyHue`/`paletteHue` are module-private).

## Calendar week vs. the "This Week" chip — INTENTIONAL divergence (read before building)

The existing **"This Week" stat chip** is a **rolling 7-day total** (`dashboard.js`:
`log_date >= localDateStr(now - 7d)`). The Week band is a **fixed calendar week (Mon–Sun)**
with prev/next navigation. These are **deliberately different** and their totals will not
always match:

- The chip answers "how much in the last 7 days" (always ending today).
- The band answers "how did *this calendar week* break down, day by day" (and lets you page
  back/forward through past weeks).

The band shows its **own grand total** = sum of its 7 calendar days. Do **not** try to make it
equal the chip — surfacing both is fine and expected. (Documenting this here so a future
session doesn't "fix" the mismatch as a bug, à la the gotchas in CLAUDE.md.)

Use `RowUtils.localDateStr()` for every date boundary — never `toISOString`/`valueAsDate`
(UTC = tomorrow all evening; see the UTC-date gotcha). Week start day: **Sunday** (Sun–Sat) —
Chris's expected view; shipped Monday-start in v3.21.0, corrected to Sunday-start post-release.

## Data & rendering

- **Source:** `Store.getEntriesSummary()` → `entries:summary` (plaintext aggregate columns
  `company_id`, `log_date`, `total_mins`, `session_label` — **no** `rows_json` decrypt). One
  summary row = one session. Group by `log_date` within the visible week; within a day sort by
  the session's start. (Summary has no `clock_in`; for "ordered by clock-in" we either (a) sort
  by `rowid`/`updated_at` as a proxy, or (b) if precise clock-in ordering matters, fall back to
  `entries:all` for the visible week only. **Recommend (a)** — summary is enough and stays
  decryption-free; note this as a known approximation.)
- **Company color:** shared identity-hue helper (see decision 5), keyed by the company's
  `hier_company` galaxy group (so projects under one umbrella share the family hue, matching the
  network web directly above).
- **Vertical scale:** auto-scale the tallest day in the visible week to the plot height, with a
  **minimum full-scale** (e.g. treat ≥8h as full) so a light week doesn't inflate a 1h day to a
  full column. Blocks below a legibility floor still render as a thin sliver.
- **Empty day:** a faint dashed placeholder with "—" and "0h" (as sketched).
- **Empty week:** branded empty state ("No sessions this week") — ties into the roadmap's
  "branded empty states" polish item.

## Interactions

- **‹ prev / next ›** week stepper + "This week" quick-reset; header shows the date range and
  the week's grand total.
- **Click a day column header/label** → open the Tracker on that date (`sessionStorage
  tracker_date`, the existing Global-Log→Tracker handoff).
- **Click a session block** → open that company's session on that date (`tracker_date` +
  `active_company`, same handoff the dashboard web click already uses).
- **Tooltip** on hover: company name · session label · hours (bubble/­block-anchored, not
  cursor-following — match the web's tooltip convention).
- Reduced-motion: the stepper needs no animation; if any transition is added, gate it on
  `data-reduced-motion` (gotcha).

## CSP / wiring notes

- No inline `onclick` — the band is injected after `Shell.init()`; wire via the page's
  `addEventListener`/delegated `data-action` (the shell delegation covers injected markup).
  Escape every `${company.name}` through `window.escapeHtml` (XSS-canary company in the seed).
- Block heights via inline `style="height:..."` are fine (style-src allows inline styles);
  colors as inline HSL/hex from the shared helper.
- `flex-shrink: 0` on any block inside a scrollable/flex column (gotcha #7) if the band ever
  scrolls; the fixed-height band shouldn't, but the day columns are flex.

## Build order (suggested PRs)

1. **Shared color helper** — extract the identity-hue logic from `bubble-web.ts` into a small
   reusable function (`window.CompanyColor` or a `bubble-web` export) used by both the web and
   the band. Pure refactor, no behavior change; verify the web looks identical.
2. **Week band** — `dashboard.html` markup (band + Recent-Activity 5-cap) + `dashboard.js`
   render (group summary by week, auto-scale, empty states) + week nav + click-through +
   tooltip. Vertical-fit tuning against 900×600 min window.
3. **Polish** — branded empty-week state; verify all 5 themes (light + dark block legibility,
   like the web's `themeColors()` split); reduced-motion; run-app screenshot pass.

## Deferred / explicitly not building

- **Direction B (calendar time grid)** — richer daily-rhythm view, but busier, needs an hour
  window with outlier handling, and looks ragged on rough backfilled times. Revisit only if
  requested; the volume band is the committed design.
- **A dedicated "Week" nav page** — placement is the Dashboard band. If it outgrows the band,
  a full page is the escape hatch.
- **Unifying the "This Week" chip with the band total** — intentionally separate (above).

## Verification

- `run-app` screenshot of the reworked Dashboard across ≥2 themes (Zanarkand + a light theme)
  and a resize to the 900×600 min window (band + network both survive).
- Seed already provides a good week: the galaxy trio + volume entries with staggered recency
  give multi-company days and empty days. Confirm click-through lands on the right
  Tracker date/company.
- `npm test` + typecheck (no new IPC, so no oracle/fixture impact).
