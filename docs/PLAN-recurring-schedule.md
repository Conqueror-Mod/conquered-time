# PLAN — Recurring Schedule (detect → confirm → fill) + Pay Periods

**Status:** built 2026-10-26 on `feat/recurring-schedule` — option B, all recommended decisions (see "As built" at the end)
**Note:** the desktop app is in maintenance mode; this is an owner-requested exception. The
detection core is a pure JS module, so it ports to Android unchanged.

## Problem

Insights shows charts but nothing you can act on. Meanwhile most logging time goes into
re-entering the same hours every week — e.g. **Mon 14:00–17:00, Wed–Fri 09:00–12:00** — with
the odd extra shift. The app already has the data to see that pattern; it should offer to
log it for you.

## Concept in one line

Insights **spots** the repeating weekly pattern → you **confirm** it as a saved Schedule →
the app **offers to log** scheduled shifts as each day comes due, scoped to your pay period.

## The key design call — how "future" hours are represented

The app treats future-dated entries as suspect (C6 / D-009: Global Log badges them FUTURE,
Recent Activity hides them, the seed carries a future entry as a probe). Three options:

| | Option | Pros | Cons |
|---|---|---|---|
| A | **Write real future-dated entries** (literal ask) | Simple; one click fills the whole period | Unworked hours sit in the vault as fact — they flow into invoices, emailed reports, Insights, week totals. A sick day means finding and deleting entries. Fights the existing FUTURE rules. |
| **B** | **Saved Schedule + fill-when-due** *(recommended)* | Vault only ever holds hours for days that have arrived. Future shifts are shown as **ghost blocks** drawn from the schedule (Week view, pay-period card), not stored. Days off = just don't confirm. | Not literally pre-filled; needs a small prompt (one click per visit). |
| C | Stored "planned" entries with a status flag | Real rows you can see/edit ahead of time | New plaintext column + every consumer (summary, invoices, email, audit, Insights, week view, oracle mirror) must learn to exclude planned rows. Largest blast radius; easiest to get subtly wrong. |

**Recommendation: B.** You get the "it's already filled in" feel (ghosts on the week view,
one-click confirm) without the vault ever claiming hours that haven't happened.

## Pieces

### 1. Detection — `src/renderer/schedule-detect.js` (pure, UMD, unit + property tested)
- Input: `entries:all` (decrypted rows) over a lookback window (default **8 weeks**).
- Per **company + date**, take the day's span (earliest clock-in → latest clock-out) and
  total minutes. Day-level span (not per-row) so a mid-shift break doesn't split the slot.
- Round span edges to **15 min**; key = `(company, weekday, start, end)`.
- A key is a **recurring slot** when it appears in **≥ 3 weeks and ≥ 60 %** of the weeks since
  it first appeared. Also carries the most common **Task Label + Name** seen on that slot
  (needed — clock-in rules require both).
- Output: `{ slots: [{companyId, weekday, start, end, mins, label, name, weeksSeen, weeksTotal}] }`.
  Confidence = `weeksSeen / weeksTotal`, shown to the user.
- Uses local dates only (`parseLocalDate` — the UTC trap from global rules).

### 2. Schedule (user-owned, editable)
- Detection only **suggests**. Accepting saves a **Schedule**: the slot list, per company,
  editable (add/remove/adjust a slot, set an end date, pause).
- Stored **encrypted** — in the company blob (`schedule: [...]`), alongside `pay_rate` etc.
  No new table; rides the existing AES-GCM path.
- If later weeks drift from the saved schedule, Insights shows "your pattern changed — update?"
  It never edits the schedule on its own.

### 3. Pay period
- Setting per **company** (pay schedules are per employer/client; invoicing is already
  per-company): `weekly` · `biweekly` (needs an anchor date) · `semimonthly` (1–15 / 16–end) ·
  `monthly`. Default: none (falls back to calendar week).
- Pure helper `periodFor(date, config) → {start, end}` (unit-tested, incl. month ends and
  biweekly anchors across DST — all local dates).
- Uses beyond this feature: **invoice "Generate" can default its date range to the current
  pay period**, and Insights gets a "This pay period" range. (Cheap wins once the helper exists.)

### 4. Fill — `entries:fill-schedule` IPC (`src/main/ipc/entries.ts`)
- Input: list of `{companyId, date, slotId}` the user confirmed. **Dates must be ≤ today**
  (enforced main-side, local date).
- `persistDB(); performSafetySnapshot('before-schedule-fill')` first — undoable from the
  Backup Library, same as import.
- Creates one session per company+date with session label **"Scheduled"**, one row with the
  slot's clock in/out + label/name. Goes through the normal encrypt path, so audit sees a
  clean row (0 discrepancies).
- **Skip** a date that already has any session for that company (you logged it by hand, or
  an extra shift) — never doubles hours. Re-running is a no-op.
- Returns `{created, skipped}`; renderer invalidates `entries`.

### 5. Where you see it
- **Insights → new top card "Your schedule"** — the detected pattern as a small weekly grid,
  confidence per slot, **[Save as schedule]** / **[Edit]**. This is what makes Insights
  actionable.
- **Pay-period card** (Insights, and a compact version on the Dashboard): "Pay period
  Oct 20 – Nov 2 · 9.0 h logged · 6.0 h scheduled ahead", with past-due unlogged shifts
  listed and a **[Log 2 shifts]** button.
- **Week view ghosts:** scheduled-but-not-yet-logged shifts render as dashed/outlined blocks
  in the Dashboard week band. Purely visual, from the schedule — no stored data.
- **On-login catch-up prompt** (same spirit as the scheduled-email catch-up): if shifts came
  due since your last visit, a single in-DOM prompt (`Shell.confirm`-style, never native)
  "3 scheduled shifts since Thursday — log them?" with a review list where you can untick
  a day you didn't work. Opt-out toggle in Settings.

## Out of scope (v1)
- Auto-logging with no confirmation. Always one confirm step — it's your timesheet.
- Pattern detection across companies / rotating shifts (e.g. alternating weeks). Biweekly
  *pay* periods are supported; biweekly *schedules* are not, in v1.
- Holidays calendar.

## Tests
- `schedule-detect` unit tests: the example schedule (Mon 14–17, Wed–Fri 9–12) recovered
  from 8 weeks of data with noise (1 missed week, 1 extra shift, ±10-min punch jitter).
- Property tests: detection is stable under row order; never yields a slot below threshold;
  fill never creates a second session for an existing company+date; fill rejects future dates.
- `periodFor` tests across month ends, leap day, DST, biweekly anchor before/after date.
- Seed: give one fixture company a clean recurring pattern so detection has a probe; update
  the seed ledger. Audit count unaffected (filled rows are clean).

## Open decisions
1. **Representation** — B (recommended), A, or C?
2. **Pay period scope** — per company (recommended) or one profile-wide setting?
3. **Catch-up prompt** — on login (recommended), or only from the Insights/Dashboard card?
4. **Detection threshold** — 3 weeks / 60 % over 8 weeks OK as a starting point?
5. **Session label** for filled sessions — "Scheduled", or reuse the label from history?

## As built (2026-10-26)

Decisions taken: **B**, pay period **per company**, catch-up **on sign-in**, detection
**3 weeks / 60 % over 8 weeks** (±20-min clustering, edges rounded to 15 min), filled
sessions labelled **"Scheduled"**.

- `src/renderer/schedule.js` — pure helpers (detect, periodFor, slotsOn/slotRows,
  dueShifts, periodSummary, makeSchedule). Shared with main via `tsconfig.main.json`.
- `entries:fill-schedule` (`src/main/ipc/entries.ts`) — renderer sends only
  `{companyId, date}`; rows are rebuilt main-side from the encrypted schedule. Refuses
  future dates, skips any company+date that already has a session, safety snapshot
  (`before-schedule-fill`) before writing.
- `components/schedule-catchup.js` — the prompt. Runs at sign-in before the audit notice
  (after the tour on first login). Unticked days → `app_settings.schedule_dismissed`
  (pruned after 60 days). "Not now" remembers nothing.
- Insights "Your Schedule" card + editor; Dashboard week band ghosts (+ "scheduled"
  total in the header); company modal Pay Period field. `saveCompany()` carries
  `schedule` through form saves (same trap as `color`).

Deviations from the draft:
- The sign-in opt-out lives **in the prompt itself** ("Ask me when I sign in"), not a
  Settings tab — it's where the user meets it.
- No separate Dashboard pay-period card; the pay-period summary is on the Insights card,
  and the week band shows scheduled hours. Easy to add later if wanted.
- No seed probe: adding entries would shift the seed's asserted counts. Detection is
  covered by `test/schedule.test.js`; the real handler by `test/fill-schedule.test.js`.
  (The seed's 92 Meridian volume entries make a useful negative probe — no false pattern.)
