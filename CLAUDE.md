# CLAUDE.md

This file gives Claude Code full context to continue work on **Conquered Time** — a professional Electron desktop time-tracking app. Read this before making any changes.

---

## Project Identity

**Name:** Conquered Time
**Type:** Electron desktop app (Windows 11 x64 primary target)
**Owner:** Chris
**Purpose:** Secure, locally-encrypted time tracking for a remote professional working across multiple companies/clients, with a polished multi-theme professional UI.

**Origin:** This project was originally planned and partially built in a prior Claude account/session. Planning context was reconstructed from photo backups. The build then continued in a new chat (the one this file was generated from) through many rounds of testing, debugging, and iterative design work. This file captures that full history so a new Claude Code session can continue seamlessly.

---

## Critical Operating Principles (read first)

1. **Privacy/PPI discipline.** A real Navigator ID (`D406943`) belonging to the user was accidentally used as example/placeholder data multiple times during development (in docs, seed data, UI placeholders). It has since been fully scrubbed from the project. **Never reintroduce real personal/employer-identifying data as example or placeholder content.** Use clearly-fake placeholders (e.g. `A123456`, `X192847`) for all examples, docs, and seed/test data going forward.

2. **sql.js quirks are the #1 historical source of bugs in this project.** See "Known Architecture Gotchas" below before touching any database code.

3. **The user is non-technical-ish but capable** — comfortable in cmd, willing to read console errors and screenshot them, but needs exact copy-pasteable commands and plain explanations of *why* something broke, not just the fix.

4. **Design philosophy has shifted over the project's life**: it started as a "Steam meets professional timesheet" HUD aesthetic (heavy monospace, glowing teal, corner brackets) and was deliberately matured into a professional, restrained, Inter-typography design system with five selectable themes (see Design System section). The original HUD look survives only as the "Void" theme option, not the default.

---

## Tech Stack

- **Electron** v29, Windows 11 x64 target
- **sql.js** (pure JS/WASM SQLite) — NOT `better-sqlite3` (see gotchas below for why)
- **speakeasy** — TOTP generation/verification
- **qrcode** — QR generation for TOTP setup
- **bcryptjs** — password hashing
- **electron-builder** — NSIS installer for distribution
- **Node v20.11.1 via NVM for Windows** — required; Node v24 breaks Electron's prebuilt binary downloads
- No frontend framework — vanilla HTML/CSS/JS per page, loaded via `mainWindow.loadFile()` per-page navigation (not a SPA)

---

## Project Structure

```
conquered-time/
├── seed-dev.js                       # Dev-only DB seeder — bypasses TOTP for fast testing
├── package.json
├── README.md
├── src/
│   ├── main/
│   │   ├── main.js                   # Main process: window, IPC, sql.js DB, AES-256-GCM crypto, TOTP auth
│   │   └── preload.js                # contextBridge — whitelisted IPC channels only
│   ├── renderer/
│   │   ├── pages/
│   │   │   ├── login.html            # TOTP login/setup/recovery + interactive easter-egg grid + dev backdoor
│   │   │   ├── dashboard.html        # Stat chips, mini spiderweb, recent activity, quick actions
│   │   │   ├── companies.html        # Full spiderweb (force-graph), company CRUD modal
│   │   │   ├── tracker.html          # Dynamic time-entry table, clock in/out, inline editing
│   │   │   └── global-log.html       # Filterable cross-company history, CSV/PDF export
│   │   ├── components/
│   │   │   ├── shell.js              # Injects titlebar/sidebar/toast into every inner page; settings modal logic
│   │   │   └── settings.js           # Settings engine: theme/scale/accessibility, persisted to DB
│   │   └── styles/
│   │       └── design-system.css     # All themes, typography, elevation system, component styles
│   └── shared/                       # (currently empty — reserved)
├── assets/                           # icon.ico goes here (not yet added)
└── build/                            # electron-builder output reserved dir
```

---

## Architecture Decisions & Why

### Authentication & Encryption
- **TOTP MFA** (Google Authenticator compatible) gatekeeps login but does **NOT** factor into encryption key derivation (see gotcha #2 below — this was a real bug that was fixed).
- **Key derivation:** `PBKDF2(password, stored_random_salt, 310000, 32, sha256)` → AES-256-GCM key, held in memory only (`sessionKey` in `main.js`), cleared on lock/close.
- **3 failed TOTP attempts → 24-hour lockout** with live countdown on the login screen.
- **Local-only recovery code** generated once at setup, shown once, bcrypt-hashed in DB.
- **`dev_mode` user flag** (set only by `seed-dev.js`) bypasses TOTP entirely for local dev/testing — never set this flag through the normal app UI.

### Database (sql.js)
- Tables: `users`, `companies`, `time_entries`, `app_settings`.
- Companies and entries store most data as **AES-256-GCM encrypted JSON blobs** (`data_enc`, `data_iv`, `data_tag` columns) — decrypted in-memory using `sessionKey` after login.
- All ID lookups use **`rowid`**, not the `id` AUTOINCREMENT column (see gotcha #1).

### IPC Surface (main.js ↔ preload.js ↔ renderer)
Whitelisted channels only, enforced in `preload.js`:
- `auth:check-setup`, `auth:setup`, `auth:login`, `auth:recover`
- `totp:generate`
- `session:get`
- `companies:list/save/delete`
- `entries:list/save/all`
- `settings:get/set`
- `win:minimize/maximize/close`, `navigate`

### Electron Security Hardening
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all renderer processes.
- Frameless window with custom titlebar (drag region + minimize/maximize/close).

### Navigation Model
- **Not a SPA.** Each "page" (dashboard, companies, tracker, global-log, login) is a full `mainWindow.loadFile()` swap.
- `shell.js`'s `Shell.init(pageName)` runs on every inner page: fetches session, injects titlebar+sidebar+toast container around the page's existing body content, then loads/applies settings.
- **Important gotcha this causes:** any inline `onclick=` / `onchange=` HTML attributes written *before* `Shell.init()` runs get wiped out, because `Shell.init()` does `document.body.innerHTML = ...` to inject the shell around the existing content. **All interactive elements on inner pages must be wired via `addEventListener` inside the page's own `DOMContentLoaded` handler, after `await Shell.init(...)`, not via inline `onclick` attributes in the static HTML.** (The titlebar/sidebar buttons themselves are fine using inline onclick since they're generated fresh by `shell.js` after the swap.)

---

## Known Architecture Gotchas (read before touching DB or auth code)

### 1. sql.js does NOT reliably populate the `id` AUTOINCREMENT column through query helpers
sql.js's `prepare/bind/getAsObject()` API and even `db.exec('SELECT last_insert_rowid()')` were unreliable in this project — inserted rows kept coming back with `id: null`, which cascaded into "Select a company first" bugs, broken company dropdowns, and null foreign keys. **The fix that worked and must be preserved:** every read query explicitly does `SELECT rowid as rid, * FROM table` and the application code uses `Number(row.rid)` as the canonical ID everywhere — never trust the `id` column for lookups, joins, or as the value sent back to the renderer. `dbInsert`/equivalent insert helpers in `main.js` follow the same pattern. If you ever see `id: null` show up in a renderer console log again, this is almost certainly the first place to look.

### 2. TOTP code must NEVER be part of the encryption key derivation
Early in the project, the encryption key was derived from `password + TOTP_code`. Since TOTP rotates every 30 seconds, this meant data encrypted in one login session could not be decrypted in the next (`[Decryption Error]` showing up in company lists). **Fixed by:** generating a stable random 32-byte `key_salt` once at account setup, storing it in the `users` table, and deriving the key from `PBKDF2(password, key_salt, ...)` only. TOTP remains a login gate but has zero influence on the encryption key. Do not reintroduce TOTP into key derivation.

### 3. Node.js version sensitivity
Node v24 breaks Electron's prebuilt binary downloads (`Electron failed to install correctly` errors). **Required:** Node v20.11.1 via NVM for Windows. The original choice of `better-sqlite3` was abandoned specifically because it requires native compilation (Visual Studio build tools) which most users won't have — `sql.js` (pure JS/WASM) was substituted for exactly this reason and should not be reverted.

### 4. Canvas elements (spiderweb force-graphs) need `ResizeObserver`, not fixed dimensions
Both the dashboard mini-spiderweb and the full Companies page spiderweb previously failed to recenter/resize on window maximize/restore. Fixed by wrapping canvas init in a `ResizeObserver` on the parent container and recalculating `cx/cy` from live `wrap.clientWidth/clientHeight` on every animation frame — never cache the canvas center at init time.

### 5. UI scale must zoom `#main-content` only, never `<body>`
An early implementation applied CSS `zoom` to the whole `<body>`, which pushed the sidebar (and the Settings button needed to undo the scale change) off-screen at large scale settings, creating a soft-lock. **Fixed by:** scoping `zoom` exclusively to `#main-content`; the sidebar has its own much smaller font-size adjustment instead and remains fully visible/clickable at every scale level. `Ctrl+,` also opens Settings globally as a safety net regardless of scale state.

### 6. Global log session duplication
`entries:save` previously didn't return the newly-inserted row's ID to the renderer, so `currentEntryId` stayed `null` and every autosave created a brand-new row instead of updating the existing one (visible as 4x duplicate sessions in the Global Log for what was really one session). **Fixed by:** `entries:save` now returns `{ ok, id }` on insert (via `SELECT MAX(rowid)` immediately after insert, scoped to the user), and `tracker.html`'s `saveSession()` captures that ID into `currentEntryId` after the first save so all subsequent autosaves correctly `UPDATE` instead of `INSERT`.

### 7. Time format must be validated as 24-hour HH:MM internally
Native `<input type="time">` renders in the OS locale's format (often 12-hour with AM/PM on Windows), which created inconsistent stored values. Inline time editing in the tracker uses a plain text input with regex validation (`/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/`) and normalizes to zero-padded 24-hour `HH:MM` before storing — there is also a user-facing 12h/24h **display** preference in Settings, but the stored/internal format is always 24-hour.

---

## Feature Inventory (as of this handoff)

### Implemented & Tested Working
- TOTP MFA login (QR setup, Google Authenticator compatible)
- AES-256-GCM encryption of company PPI fields, PBKDF2 key derivation from password + stable salt
- 3-attempt lockout with 24h countdown UI
- Local recovery code (generated once, bcrypt-hashed)
- Company CRUD with full work hierarchy: Company › Project › Platform › Navigator ID (NavID never appears on PDF exports, only in-session)
- Spiderweb company visualization (force-simulated layout, sphere-gradient nodes, theme-aware colors, ResizeObserver-based responsive redraw) on both Dashboard (mini) and Companies (full) pages
- Dynamic time-entry table: starts at 5 rows, auto-grows when the last row is used, trims unused trailing blank rows, never goes below 5
- Clock in/out with persistent timestamps (no longer auto-clear after 800ms — earlier bug, fixed)
- Inline double-click editing on **any field of any row that already contains data** (label/name/description editable regardless of clock-out status; clock_in/clock_out independently editable once they have a value) — recalculates duration automatically
- Session auto-save on every clock action and inline edit (manual "Save Session" button also present)
- PDF export (per-session and per-company-filtered in Global Log) — clean Inter-based print stylesheet, NavID excluded
- CSV export from Global Log
- Global Log: filterable by company/date range, expandable per-session task detail rows showing clock in/out times
- Time summarization footer on tracker: total session time + per-task-label breakdown chips
- Full Settings system: 5 themes (Slate default→ now **Arctic** is default, Void, Paper, Quartz), 4 UI scale steps (compact/normal/comfortable/large via `#main-content`-scoped zoom), 12h/24h time display toggle, accessibility toggles (reduced motion, high contrast, colorblind-safe palette), all persisted to `app_settings` table, applied via `data-*` attributes on `<html>` cascading through CSS custom properties
- Settings accessible via sidebar button (above username) opening a **centered modal** (not a sidebar panel — this was explicitly requested after an earlier sidebar-panel version), plus `Ctrl+,` global shortcut
- Interactive login background: canvas grid of cells, subtle hover glow, two hidden click-sequences:
  - 3-cell sequence → ASCII cracked-hourglass easter egg (purely cosmetic, fades login card out/in)
  - 5-cell sequence → styled red "Backdoor Access" screen (username/password only, no TOTP) — intended as a dev-mode convenience, gated by the `dev_mode` DB flag set only by `seed-dev.js`
  - `Ctrl+Shift+D` toggles a debug overlay that labels the exact target cells (E1-E3 teal, D1-D5 red) for development/testing purposes — **should be removed or hidden before any real public/production build**
- Dev seed script (`npm run seed`) — wipes DB, creates `devuser`/`devpass123` with `dev_mode=1` (TOTP bypassed), one sample company (RWS/Diamond/multimango hierarchy, fake NavID), one sample time entry. Essential for fast iteration; never ships in production.

### Explicitly Deferred / On the Roadmap (not yet built)
From the user's running feature/bug list:
- **Reports / Auditing** — larger feature, would build on the clock_in/clock_out timestamp data already being captured per row
- **Session Auto Lock/Timeout** — pairs with existing lockout system but for idle-session locking, not failed-login lockout
- **Language change / i18n** — flagged as "tackle last," most complex
- **Recovery / "LOAD DBA ability for locally saved recovery option"** — user wants a way to load/restore from local backup files via UI, beyond the current automatic dated-copy backup-on-save system
- **Container/store architecture refactor** — discussed at length (see below) but deliberately **postponed** until after the core bug-fixing phase stabilized; worth revisiting now that the app is stable
- Light themes (Paper, Quartz) were explicitly called out by the user as "still very derivative" / not yet fully realized — functional but flagged for future refinement
- The North Phoenician cipher-layer concept (see below) was discussed in depth but explicitly **deferred to theory** — the user wanted only the visual hidden-grid-sequence mechanic built now, not the cryptographic layer

---

## Design System Reference (current state)

**Default theme:** Arctic (cool blue, deep navy) — changed from Slate after user feedback during theme review.

**Five themes**, all defined as `[data-theme="x"]` CSS variable blocks in `design-system.css`:
1. **Slate** — professional blue-grey, the original "matured" default
2. **Void** — the original "Steam meets professional timesheet" HUD aesthetic (teal-on-black, glow effects, corner brackets) preserved as an opt-in theme, later deliberately pushed *harder* (more teal contrast on panel borders/active nav) after feedback that it felt "too derivative" of the others
3. **Arctic** — cool blue-white on deep navy — **current default**
4. **Paper** — light mode (soft blue-grey-white, not stark white — an earlier all-white version was reported as "blindingly white," softened)
5. **Quartz** — light mode, the deliberate "polar opposite" of Paper: near-black charcoal as the primary accent (no color emotion), maximum contrast, stark/legal-document feel. Replaced an earlier "Ember" (amber/orange) theme that was scrapped as "ugly" and not fitting the set; later a "Dusk" (violet) idea was also considered and rejected as "derivative" before landing on Quartz.

**Typography rule (strict, enforced project-wide):** Inter for all UI text — navigation, labels, headers, body, descriptions, buttons. **Share Tech Mono is reserved exclusively for data values** — timestamps, durations, IDs, numeric stats, and the brand wordmark/login ASCII art. This was a deliberate full-project sweep after the user felt the original all-monospace, heavy-letter-spacing, uppercase-everything look was unreadable and "not professional."

**Elevation system:** 3-layer shadow system (`--shadow-1/2/3` + `--shadow-inset`) gives panels/cards/modals a sense of physical depth without literal 3D. Spiderweb nodes use radial-gradient "sphere" fills (light source top-left) rather than flat circles — and are **theme-aware**: a separate `getCanvasColors()` helper function in both `dashboard.html` and `companies.html` returns different fill/border/label colors depending on whether the active theme is light (Paper/Quartz) or dark, because the original gradient-based node fills were invisible/illegible on light backgrounds.

**UI scale:** `Compact / Normal / Comfortable / Large`, implemented via CSS `zoom` scoped to `#main-content` only (see gotcha #5).

**Login card:** Must always render as a fully opaque, isolated (`isolation: isolate`) floating layer with its own strong shadow stack — this was a real bug on light themes where the white-ish card blended into a similarly light background; fixed by darkening the `.login-body` background specifically under `[data-theme="paper"]`/`[data-theme="quartz"]` selectors so the card has guaranteed contrast against it.

**Settings UI:** Centered modal (`#settings-modal`), NOT a sidebar-embedded panel — an earlier sidebar-panel implementation was explicitly rejected by the user in favor of the modal pattern, triggered by a "⚙ Settings" button placed in the sidebar directly above the username/active-session block, separated by its own border lines.

---

## Open Conceptual Threads (discussed, not yet implemented)

These were real conversations with the user that may resurface — worth knowing about even though nothing was built:

1. **Container/Store architecture refactor.** The user proposed (and Claude agreed was sound) moving from the current "every page independently fetches its own data via IPC" pattern to a centralized `store.js` + `ipc.js` + `validator.js` layer that normalizes data once and shares it across page loads, specifically to prevent the class of "null ID" bugs from gotcha #1 from recurring. **This was deliberately postponed** — the agreed plan was: (1) fix the immediate bugs with targeted patches first [done], (2) verify the full flow works end-to-end [done], (3) *then* do the architecture refactor on a stable foundation [not yet done]. This is a good candidate for the next major piece of work if the user raises it again.

2. **North Phoenician cipher / hidden-grid login Easter egg.** The user has separately discussed (in another account/session) using their knowledge of the North Phoenician alphabet as a novel cryptographic input layer. The conversation in *this* project scoped that down to just the visual mechanic — a grid of hoverable/clickable cells with two hidden coordinate sequences (one cosmetic Easter egg, one dev-mode backdoor) — which **is built**. The deeper idea of actually using Phoenician characters as a third key-derivation factor (`password + TOTP + Phoenician_sequence → PBKDF2`) was explicitly left as future theory, not built. If this comes up again, treat it as a optional/advanced security feature proposal, not a current requirement.

3. **Reporting/Auditing feature.** Discussed only at the concept level — the user wants a "full reporting/auditing feature" eventually, motivated specifically by wanting clock_in/clock_out to be visually/permanently tracked (which is why those fields were added to the row schema and made independently editable). No UI or spec has been designed yet.

---

## Things NOT To Do

- Do not reintroduce `better-sqlite3` or any native-compiled dependency — breaks on machines without Visual Studio build tools.
- Do not derive the encryption key from TOTP — breaks decryption across sessions (gotcha #2).
- Do not trust the sql.js `id` column for anything — always use `rowid` (gotcha #1).
- Do not apply `zoom` to `<body>` — locks out the sidebar at large scale (gotcha #5).
- Do not wire new interactive elements via inline `onclick`/`onchange` HTML attributes on the static page markup — they get wiped by `Shell.init()`'s innerHTML swap. Use `addEventListener` after `Shell.init()` resolves.
- Do not use real personal data (names, IDs, emails) anywhere in example code, docs, seed data, or placeholder text — see the PPI incident at the top of this file.
- Do not ship the `Ctrl+Shift+D` debug-overlay code or the backdoor-login sequence to a real production/public build without explicit user sign-off — they're development conveniences.
- Do not replace the Settings UI with a sidebar-embedded panel — user explicitly prefers the centered modal.

---

## Suggested Next Steps (pick up here)

In rough priority order based on the user's own stated roadmap and the last open threads:
1. Continue refining the two light themes (Paper, Quartz) — user flagged them as still feeling "derivative"
2. Session Auto Lock/Timeout (idle-based, distinct from the failed-login lockout)
3. Local backup load/restore UI ("LOAD DBA" feature)
4. Reports/Auditing feature design + build
5. Revisit the container/store architecture refactor now that the app is stable, *especially* if any new null-ID-style bugs reappear
6. Language/i18n — lowest priority, most complex

Always confirm scope and design direction with the user before building — this project's history shows a strong back-and-forth collaborative pattern where Claude proposes a plan/design rationale first and waits for explicit go-ahead before writing code.
