# Plan — Pomodoro Break Mode, Tooltip System, First-Time Onboarding Wizard

**Status:** Approved design (2026-07-04), not yet built.
**Decisions below were confirmed with Chris via Q&A — do not re-litigate without asking.**

The three features ship as one coherent onboarding/usability story, in this build order:
**Phase A: Tooltips → Phase B: Pomodoro → Phase C: Wizard** (the wizard references both, so it goes last).

---

## Confirmed design decisions

| Question | Decision |
|---|---|
| Pomodoro scope | **Warnings only** — Pomodoro replaces the live break-cadence warnings/rhythm; the audit engine keeps judging against the state policy (legal compliance untouched) |
| Selector location | **Profile page**, sibling to Work State |
| Cadence config | **Presets**: Classic 25/5, Extended 50/10, Gentle 90/15 (long break every 4th cycle for Classic) |
| Break → punches | **Prompt to punch** — break alert offers one-click "Start Break" that creates the real break `task_item` in the active session; never auto-punches |
| Pomodoro UI | **Dispatch page (full cycle display) + compact sidebar chip** (alongside the existing live task timer) |
| Alerts | **In-app toast when visible; Windows native notification when hidden/tray'd** (click restores window) |
| Tooltip style | **Hover tooltips** — shared component, `data-tip` attribute, shows on hover *and keyboard focus* after a short delay |
| Tooltip v1 scope | **Listed surfaces only**: Tracker (Task Name, Session Label, Description incl. Dispatch-writeback note), Profile (Work State, Break Style/Pomodoro, Email), Dispatch (Log a Task), Dashboard (all buttons) |
| Wizard style | **Guided coach-marks** — anchored popups spotlighting real UI, Next/Skip |
| Wizard trigger | **First login per profile + re-runnable** ("Replay setup guide" in Settings → About) |
| Wizard content | **Integrates the other two features**: profile step includes Work State + break-style choice; final step points out hover tooltips |

---

## Phase A — Tooltip system

### Component
- New `src/renderer/components/tooltip.js` (or fold into `shell.js` if <100 lines): a single document-level `mouseover`/`focusin` delegated listener (CSP-safe, survives `innerHTML` swaps — same pattern as `installShellDelegation`).
- Markup contract: `data-tip="text"` (+ optional `data-tip-pos="top|bottom|left|right"`, default top). One shared floating `<div class="ct-tooltip">` element repositioned per target; ~400 ms show delay, instant hide on `mouseout`/`focusout`/`Escape`.
- Styling in `design-system.css`: themed via existing CSS variables (surface/elevation/`--shadow-2`), DM Sans, max-width ~280 px, respects reduced-motion (no fade when `data-reduced-motion`).
- Viewport-edge flipping (if the preferred side would clip, flip). Never obstruct the hovered element.
- Login page can reuse it later, but v1 targets inner pages only (component injected by `Shell.init()`).

### v1 copy targets
- **Tracker**: Task Name, Session Label, Description (mention Dispatch timer writeback), clock in/out buttons.
- **Profile**: Work State (what it drives — break/lunch policy + audit), Break Style selector (Phase B), Email (what it's used for — reports/audit notify).
- **Dispatch**: "Log a Task" input + quick-picks.
- **Dashboard**: every action button/stat chip.
- Copy lives inline in the page markup/JS as `data-tip` strings (no i18n layer yet — i18n is last on the roadmap).

---

## Phase B — Pomodoro break style

### Data model
- New per-profile field `break_style`: `'state'` (default) | `'pomodoro'`, plus `pomodoro_preset`: `'classic' | 'extended' | 'gentle'`. Stored alongside `work_state` in the encrypted profile blob (same save path as `profile:get/save` — see [profile.js](../src/renderer/pages/profile.js) `work_state` handling).
- Preset definitions live in `src/main/policies.ts` next to `BREAK_POLICIES` (pure data):
  - `classic`: 25 focus / 5 break, long break 15 every 4th cycle
  - `extended`: 50 / 10, long break 20 every 3rd cycle
  - `gentle`: 90 / 15, no long-break tier
- `audit:get-policy` response gains `{ breakStyle, pomodoroPreset }` so the renderer knows which rhythm to run. **The audit engine (`countAuditDiscrepancies` in `src/main/audit.ts`) is NOT touched** — state policy remains the compliance authority (confirmed decision). Same for the seed's `computeExpectedDiscrepancies()`.

### Renderer behavior
- **Tracker ticker** ([tracker.ts](../src/renderer/pages/tracker.ts) `breakStatus` around line 335): when `breakStyle === 'pomodoro'`, the warn thresholds come from the preset cadence instead of `dispatchBreakWarnMins`; lunch warning stays state-policy-driven (legal).
- **Dispatch page**: cycle display — current phase (Focus / Break / Long Break), countdown, cycle count (e.g. `●●○○`), Start/Pause/Skip-phase controls. Runs only while clocked in to a session; pauses with session lock.
- **Sidebar chip**: compact phase + countdown, added to the `#sidebar-task-timer` block area in `shell.js` (shell.js:92) so it's visible on every inner page. Timer state persists across page navs via `sessionStorage` (pages are full `loadFile()` reloads — same constraint as the task timer).
- **Break alert**: when a focus phase ends —
  - window visible → themed toast with **Start Break** button (creates the break `task_item` via the existing tracker break plumbing) and **Skip**;
  - window hidden/tray → Windows `Notification` from the main process (new IPC `pomodoro:notify` or reuse a generic `app:notify`); clicking restores the window. Never auto-punches.
- **Profile page**: Break Style selector (radio/segmented: "State policy (WORK_STATE)" vs "Pomodoro") + preset dropdown shown only when Pomodoro selected; saved with the rest of the profile form. Gets `data-tip` copy from Phase A.

### Non-goals (explicit)
- No change to audit discrepancy types or counts (seed self-check stays at 7).
- No background delivery of alerts while the app is closed (same constraint as scheduled email — gotcha #9).

---

## Phase C — First-time user wizard (coach-marks)

### Engine
- New `src/renderer/components/onboarding.js` injected by `Shell.init()`: dimmed overlay with a spotlight cutout (box-shadow trick or SVG mask) around a target element + an anchored card (title, body, step dots, Back / Next / Skip tour). CSP-safe: all handlers via the delegated `data-action` pattern.
- Because navigation is full page reloads, the tour is a **step list keyed by page**: each step declares `{ page, selector, title, body }`; advancing to a step on another page calls the normal `navigate` and the engine resumes from `sessionStorage` (`ct_tour_step`).
- Targets that don't exist yet (e.g. first company card) anchor to their creation affordance instead.

### Step sequence (v1)
1. **Welcome** (centered card, dashboard) — what Conquered Time is; mentions AES-256 encryption (subsumes/queues after the existing encryption notice — see sequencing).
2. **Profile** — spotlight sidebar user block → Profile page: set **Work State** and **Break Style (State vs Pomodoro)** (Phase B selector).
3. **Companies** — spotlight Companies nav → "Add Company" flow explained.
4. **Tracker** — spotlight clock-in area: Task Name + Session Label required to clock in; Description tips.
5. **Dispatch** — Log a Task, timer, break/lunch note.
6. **Global Log & Reports** — brief pointer (exports, audit).
7. **Finish** — "Hover any control for help" (tooltips callout) + Settings `Ctrl+,` reminder.

### Trigger & persistence
- Per-profile one-shot flag `ui_onboardingDone=1` in `app_settings` (same pattern as `ui_encryptionNoticeAck`).
- **Modal sequencing on first login** (order matters, one at a time): encryption notice → onboarding wizard → audit login-notice (deferred a login if the wizard ran, mirroring the existing encryption-notice precedence rule in `shell.js`).
- Re-run: "Replay setup guide" button in Settings → About (clears the flag then starts the tour).
- Seed (`seed-dev.js`) sets `ui_onboardingDone=1` so automated sweeps aren't blocked (same rationale as `ui_encryptionNoticeAck`).

---

## Rough sizing & PR slicing

| PR | Content | Size |
|---|---|---|
| 1 | Tooltip component + design-system styles + v1 copy sweep | S–M |
| 2 | `break_style`/preset data model + Profile selector + `audit:get-policy` plumbing | S |
| 3 | Pomodoro engine: Dispatch UI + sidebar chip + tracker ticker integration + alerts/notification IPC | M–L |
| 4 | Onboarding coach-mark engine + step content + sequencing + replay button + seed flag | M–L |

Each PR keeps `npm test` (typecheck + unit) green; Pomodoro preset math is a candidate for a small pure unit-tested module (like `read-cache.js`).
