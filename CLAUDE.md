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

4. **Design philosophy has shifted over the project's life**: it started as a "Steam meets professional timesheet" HUD aesthetic (heavy monospace, glowing teal, corner brackets) and was deliberately matured into a professional, restrained, DM-Sans-typography design system with five selectable **Final Fantasy city themes** (see Design System section). The original glowing-HUD spirit survives mainly in the dark **Zanarkand** theme, not the default (Memoria).

---

## Tech Stack

- **Electron** v29, Windows 11 x64 target
- **sql.js** (pure JS/WASM SQLite) — NOT `better-sqlite3` (see gotchas below for why)
- **speakeasy** — TOTP generation/verification
- **qrcode** — QR generation for TOTP setup
- **bcryptjs** — password hashing
- **electron-builder** — NSIS installer for distribution
- **Node v20.11.1 via NVM for Windows** — required; Node v24 breaks Electron's prebuilt binary downloads
- **TypeScript (devDependency only)** — the main process is `.ts` under `strict: true`, compiled by `tsc -p tsconfig.main.json` → `dist-main/` (package.json `main` points there; `npm start`/`dev`/`build` run `build:main` first). The renderer stays plain JS checked via `checkJs` (root `tsconfig.json` + `types/globals.d.ts`); `npm run typecheck` covers both projects and is part of `npm test`. No bundler, no runtime deps — see docs/refactor-plan.md and docs/ts-phase1-error-inventory.md.
- No frontend framework — vanilla HTML/CSS/JS per page, loaded via `mainWindow.loadFile()` per-page navigation (not a SPA)

---

## Project Structure

```
conquered-time/
├── seed-dev.js                       # Dev-only DB seeder — bypasses TOTP for fast testing
├── package.json
├── tsconfig.json                     # checkJs project: renderer JS + types/ (noEmit gate)
├── tsconfig.main.json                # main-process TS build → dist-main/ (strict: true)
├── types/
│   ├── globals.d.ts                  # renderer globals, data shapes, IpcInvokeMap (channel source of truth)
│   └── phase1-dom-compat.d.ts        # DOM-narrowing shim — DELETE as renderer pages convert to .ts
├── dist-main/                        # compiled main process (generated; gitignored; ships in builds)
├── README.md
├── src/
│   ├── main/                         # TypeScript (strict: true), compiled by `npm run build:main`
│   │   ├── main.ts                   # App lifecycle ONLY: window/splash/tray/menu, app-prefs, profile boot
│   │   ├── preload.ts                # contextBridge — whitelisted IPC channels only
│   │   ├── db.ts                     # sql.js lifecycle + dbGet/dbAll/dbRun/dbInsert; owns handle + vault path
│   │   ├── session.ts                # session.key/.user/.activeEntryId/.profileDir, idle lock, orphan sweep
│   │   ├── cache.ts                  # main-process read cache singleton + owner token
│   │   ├── policies.ts               # break/lunch policy tiers (pure data)
│   │   ├── audit.ts                  # countAuditDiscrepancies + dismissed set
│   │   ├── backups.ts                # performBackup + backups-dir state
│   │   ├── email.ts                  # SMTP config, doSendReport, schedule engine (gotcha #9)
│   │   ├── vault-crypto.js           # AES-256-GCM/PBKDF2 primitives (pure, unit-tested)
│   │   ├── read-cache.js             # cache factory (pure, unit-tested)
│   │   ├── beta-keys.js              # beta-key mint/verify (pure, unit-tested)
│   │   └── ipc/                      # all IPC handlers, one register(ctx) module per surface
│   │       ├── auth.ts               # profiles:*, auth:*, totp, beta:*, profile:get/save
│   │       ├── companies.ts          # companies:*
│   │       ├── entries.ts            # entries:*, tasks:*
│   │       ├── audit.ts              # audit:*
│   │       ├── settings.ts           # settings:*, win:* prefs, app:*, db:clear-*, backup:*
│   │       └── email.ts              # email:*
│   ├── renderer/                     # plain JS — loaded directly by loadFile(), no build step
│   │   ├── pages/
│   │   │   ├── login.html            # TOTP login/setup/recovery + profile selector + cosmetic grid background
│   │   │   ├── dashboard.html        # Stat chips, mini spiderweb, recent activity, quick actions
│   │   │   ├── companies.html        # Full spiderweb (force-graph), company CRUD modal
│   │   │   ├── tracker.html          # Dynamic time-entry table, clock in/out, inline editing
│   │   │   └── global-log.html       # Filterable cross-company history, CSV/PDF export
│   │   ├── components/
│   │   │   ├── shell.js              # Injects titlebar/sidebar/toast into every inner page; settings modal logic
│   │   │   └── settings.js           # Settings engine: theme/scale/accessibility, persisted to DB
│   │   └── styles/
│   │       └── design-system.css     # All themes, typography, elevation system, component styles
│   └── shared/                       # beta-secret.js (gitignored HMAC secret; .example.js tracked)
├── assets/                           # icon.ico goes here (not yet added)
└── build/                            # electron-builder output reserved dir
```

---

## Architecture Decisions & Why

### Authentication & Encryption
- **TOTP MFA** (Google Authenticator compatible) gatekeeps login but does **NOT** factor into encryption key derivation (see gotcha #2 below — this was a real bug that was fixed).
- **Key derivation:** `PBKDF2(password, stored_random_salt, 310000, 32, sha256)` → AES-256-GCM key, held in memory only (`session.key` in `src/main/session.ts`), cleared on lock/close.
- **3 failed TOTP attempts → 24-hour lockout** with live countdown on the login screen.
- **Local-only recovery code** generated once at setup, shown once, bcrypt-hashed in DB.
- **`dev_mode` user flag** (set only by `seed-dev.js`) bypasses TOTP entirely for local dev/testing — never set this flag through the normal app UI. **The bypass is gated on `IS_DEV && user.dev_mode`** at both TOTP-verify sites (`auth:login`, `auth:change-password`), and `IS_DEV` is `--dev && !app.isPackaged`, so the bypass is **physically impossible in a packaged build** no matter what the vault contains. Belt-and-suspenders: `initProfileDB()` scrubs any `dev_mode=1` → `0` (with a logged warning) when `app.isPackaged`. Do not "simplify" the bypass back to keying on `user.dev_mode` alone — that reopens the hole.

### Database (sql.js)
- Tables: `users`, `companies`, `time_entries`, `app_settings`.
- Companies and entries store most data as **AES-256-GCM encrypted JSON blobs** (`data_enc`, `data_iv`, `data_tag` columns) — decrypted in-memory using `sessionKey` after login.
- All ID lookups use **`rowid`**, not the `id` AUTOINCREMENT column (see gotcha #1).

### IPC Surface (src/main/ipc/* ↔ preload.ts ↔ renderer)
Whitelisted channels only, enforced in `preload.js`:
- `auth:check-setup`, `auth:setup`, `auth:login`, `auth:recover`, `auth:browse-backup`
- `totp:generate`
- `session:get`
- `companies:list/save/delete`
- `entries:list/save/all/summary`
  - **Two read paths:** `entries:all` decrypts every entry's `rows_json` (per-row clock detail) — used by global log, audit, reports. `entries:summary` returns only the plaintext aggregate columns (`company_id`, `log_date`, `session_label`, `total_mins`) and does **no** decryption — used by dashboard and company hour rollups to avoid paying AES-GCM on the whole history every page load. In the renderer these are `Store.getEntries()` vs `Store.getEntriesSummary()` (separate cache slots, both invalidated together on `entries`). Do not read `rows_json` off a summary result — it isn't there.
- `settings:get/set`
- `win:minimize/maximize/close`, `navigate`

### Electron Security Hardening
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all renderer processes.
- Frameless window with custom titlebar (drag region + minimize/maximize/close).
- **CSP** (identical `<meta>` on all 10 pages): `default-src 'self'`, `script-src 'self'` (**no `'unsafe-inline'`** — hardened in v3.6), `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `img-src 'self' data:`, `object-src 'none'`, `base-uri 'self'`. Fonts are bundled locally (no `fonts.googleapis.com`/`fonts.gstatic.com` origins) — `font-src 'self'` covers the local `.woff2` files and `data:` covers the base64-inlined Inter used in the PDF-export window (which inherits the opener's CSP). `'unsafe-inline'` is **still retained for `style-src` only** — inline `style=""` attributes are pervasive, can't be nonced, and style injection is a far weaker vector; removing it was judged not worth the churn.
  - **Consequence — no inline `<script>` and no inline `on*=` handlers anywhere.** Each page's logic lives in a sibling `.js` file (`dashboard.js`, `tracker.js`, `login.js`, etc.) loaded via `<script src>`. Every interactive element uses `data-action="fnName"` (+ optional `data-arg`, and `data-action-change` for `change` events) routed through a single document-level **delegated dispatcher** — `installShellDelegation()` in `shell.js` for the 9 inner pages, `installLoginDelegation()` in `login.js` for the standalone login. Delegation covers dynamically-injected HTML automatically (no re-wiring after `innerHTML`). The settings-modal/preauth-modal backdrops keep dedicated `addEventListener` (closest() would misfire).
  - **Theme-flash guards** are externalized too: `theme-init.js` (sessionStorage `ct_theme`/`ct_scale`, inner pages), `login-theme-init.js` (localStorage `ct_pa_*`, login), `audit-theme-init.js` (query-param `theme`, audit wizard), `splash.js`. The login screen themes from the **global** pre-auth `ct_pa_*` localStorage keys (no vault loaded yet), which are distinct from the per-profile vault `ui_*` settings. To keep them from drifting, `postLoginNavigate()` (login.js) mirrors the vault's `ui_theme`/`ui_scale`/a11y settings into `ct_pa_*` on every login, so the login screen adopts the last-used profile's theme on the next logout/lock. (Before this sync the login screen could show one theme while the app showed another — e.g. login Nibelheim vs app Zanarkand; the two stores were split in the CSP refactor.)
  - **When adding UI:** never write an inline `onclick`/`<script>` — add the handler fn, register it in the page's ACTIONS map (or wire by id in the page's `DOMContentLoaded`), and use `data-action` in markup. The XSS defense remains `window.escapeHtml()` (in `shell.js`; local copies in `login.js`/`audit-wizard.js`) at every `${userField}` interpolation — don't reintroduce unescaped user data into `innerHTML`/`document.write`.

### Navigation Model
- **Not a SPA.** Each "page" (dashboard, companies, tracker, global-log, login) is a full `mainWindow.loadFile()` swap.
- `shell.js`'s `Shell.init(pageName)` runs on every inner page: fetches session, injects titlebar+sidebar+toast container around the page's existing body content, then loads/applies settings.
- **Important gotcha this causes:** any inline `onclick=` / `onchange=` HTML attributes written *before* `Shell.init()` runs get wiped out, because `Shell.init()` does `document.body.innerHTML = ...` to inject the shell around the existing content. **All interactive elements on inner pages must be wired via `addEventListener` inside the page's own `DOMContentLoaded` handler, after `await Shell.init(...)`, not via inline `onclick` attributes in the static HTML.** (The titlebar/sidebar buttons themselves are fine using inline onclick since they're generated fresh by `shell.js` after the swap.)

---

## Known Architecture Gotchas (read before touching DB or auth code)

### 1. sql.js does NOT reliably populate the `id` AUTOINCREMENT column through query helpers
sql.js's `prepare/bind/getAsObject()` API and even `db.exec('SELECT last_insert_rowid()')` were unreliable in this project — inserted rows kept coming back with `id: null`, which cascaded into "Select a company first" bugs, broken company dropdowns, and null foreign keys. **The fix that worked and must be preserved:** every read query explicitly does `SELECT rowid as rid, * FROM table` and the application code uses `Number(row.rid)` as the canonical ID everywhere — never trust the `id` column for lookups, joins, or as the value sent back to the renderer. `dbInsert`/equivalent insert helpers in `src/main/db.ts` follow the same pattern. If you ever see `id: null` show up in a renderer console log again, this is almost certainly the first place to look.

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

### 7. `flex-shrink:0` is required on items inside a scrollable flex list
When a flex column container has `max-height` and `overflow-y: auto`, its children shrink to fit the container height by default (`flex-shrink: 1`) **instead of** overflowing and triggering the scrollbar. The result is rows that collapse to near-zero height (just their border) with invisible content — extremely hard to diagnose because inline styles and CSS classes both apply correctly, but the computed height is still near zero. **The fix:** always add `flex-shrink: 0` to list item elements inside any scrollable flex column. This was discovered while building the Backup Library in Settings → Data (2026-06-22) and took significant debugging time including DevTools measurement to identify.

### 8. Time format must be validated as 24-hour HH:MM internally
Native `<input type="time">` renders in the OS locale's format (often 12-hour with AM/PM on Windows), which created inconsistent stored values. Inline time editing in the tracker uses a plain text input with regex validation (`/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/`) and normalizes to zero-padded 24-hour `HH:MM` before storing — there is also a user-facing 12h/24h **display** preference in Settings, but the stored/internal format is always 24-hour.

### 9. Scheduled email reports only run while the app is open AND unlocked
`runScheduledEmailCheck()` needs `sessionKey` (to decrypt the vault) and `sessionUser`, so it can only fire while a session is active — the app cannot send reports while closed or session-locked. Two triggers drive it: a 5-minute background poller (registered in `app.whenReady`) and an **on-launch catch-up** `setTimeout(runScheduledEmailCheck, 5000)` that must be present in **every** login handler — `auth:login`, `auth:quick-unlock`, AND `auth:safe-login`. A 2026-06-29 bug was exactly this: the catch-up lived only in `auth:login`, so Quick Unlock / Windows Hello sign-ins never caught up a report missed while the app was closed (only manual "Send Now" worked). If you add another way to establish a session, add the catch-up call there too. The gate is `computeNextSendDate(freq, lastSent)` + `setHours(sendTime)`; the `>=` comparison means a missed window is caught up on the next eligible check rather than skipped. True background/closed-app delivery would require a Windows service or background process (see the packaging discussion — not yet built).

---

## Feature Inventory (as of this handoff)

### Implemented & Tested Working
- TOTP MFA login (QR setup, Google Authenticator compatible)
- AES-256-GCM encryption of company PPI fields, PBKDF2 key derivation from password + stable salt
- 3-attempt lockout with 24h countdown UI
- Local recovery code (generated once, bcrypt-hashed) + **recovery key packet**: session key sealed under recovery code via PBKDF2+AES-256-GCM at setup time, enabling full password reset without data loss
- Full account recovery UI on login screen: three-mode picker — **Unlock account** (clears lockout), **Reset my password** (decrypts old key via recovery code, re-encrypts all data under new password, logs in), **Restore from backup** (pre-auth file dialog, no session required)
- Company CRUD with full work hierarchy: Company › Project › Platform › Navigator ID (NavID never appears on PDF exports, only in-session)
- Spiderweb company visualization (force-simulated layout, sphere-gradient nodes, theme-aware colors, ResizeObserver-based responsive redraw) on both Dashboard (mini) and Companies (full) pages
- Dynamic time-entry table: starts at 5 rows, auto-grows when the last row is used, trims unused trailing blank rows, never goes below 5
- Clock in/out with persistent timestamps (no longer auto-clear after 800ms — earlier bug, fixed)
- Inline double-click editing on **any field of any row that already contains data** (label/name/description editable regardless of clock-out status; clock_in/clock_out independently editable once they have a value) — recalculates duration automatically
- Session auto-save on every clock action and inline edit (manual "Save Session" button also present)
- PDF export (per-session and per-company-filtered in Global Log) — Inter font, NavID excluded; header shows job title, work type, location, supervisors (when populated); per-label time subtotals block rendered when ≥2 distinct labels; Export All PDF has a summary section (date range, grand total, cross-session label breakdown) + per-session blocks each with their own table and subtotals
- Right-click context menu enabled globally (Cut/Copy/Paste/Select All) via `web-contents-created` handler in `src/main/main.ts`
- CSV export from Global Log
- Global Log: filterable by company/date range, expandable per-session task detail rows showing clock in/out times
- Time summarization footer on tracker: total session time + per-task-label breakdown chips
- Full Settings system: 5 Final Fantasy themes (**Memoria** default, Zanarkand, Rabanastre, Treno, Nibelheim), 4 UI scale steps (compact/normal/comfortable/large via `#main-content`-scoped zoom), 12h/24h time display toggle, accessibility toggles (reduced motion, high contrast, colorblind-safe palette), all persisted to `app_settings` table under `ui_*` keys, applied via `data-*` attributes on `<html>` cascading through CSS custom properties
- Settings accessible via sidebar button (above username) opening a **centered modal** (not a sidebar panel — this was explicitly requested after an earlier sidebar-panel version), plus `Ctrl+,` global shortcut
- Interactive login background: canvas grid of cells with a subtle hover glow (cosmetic only). **The old hidden click-sequences were removed in session 9** — there is **no** 3-cell/5-cell sequence, **no** "Backdoor Access" screen, and **no** `Ctrl+Shift+D` debug overlay anymore (do not reintroduce them). The only surviving easter egg is the **Konami code** (↑↑↓↓←→←→BA Enter) on the **profile selector**, which shows a cosmetic ASCII-hourglass overlay (session 13).
- Dev seed script (`npm run seed`, **v4.0 — stress fixture**) — wipes `dev-data/`, creates `devuser`/`devpass123` with `dev_mode=1` (TOTP bypassed, `work_state=TX` → default policy), then seeds a designed measurement instrument: **10 companies** (2 canonical clean baselines Zenith/Apex; unicode/emoji `Café Müller 東京 🚀`; an **XSS canary** `<script>…</script>` company whose `onerror` probes set `document.title='XSS-FIRED'` if any sink is unescaped; a 120-char-name overflow probe; a name-only minimal co; whitespace-padded name; quotes `O'Brien & Sons "Quality"`; high-volume `Meridian Ops`; and **Pristine Control Co inserted LAST** — zero entries, the run-app `verify-cursed-path` target) and **103 entries** (6 canonical incl. the discrepancy session with EXACTLY 6 audit issues; an edge-probe session: desc-only row, midnight-crossing 23:30→00:15, 00:00→23:59 stored-vs-span drift, custom non-list Task Label, long multiline desc; a **legacy plaintext entry** exercising the at-login encryption migration; a future-dated entry; a same-date pair; 92 clean volume entries). **12 task_items** incl. 2 orphans (dead `entry_id`), a stale in-progress break, 0s and 25h tasks, an emoji/HTML label. 3 backup fixtures (`vault-<stamp>.db`). Settings under real `ui_*`/`win_*` keys + `ui_encryptionNoticeAck=1` (so modals don't block automated sweeps). Prints a 17-assert **self-check ledger** + a **verification packet** with a STRESS LEDGER (probes P1–P12). The discrepancy session carries EXACTLY 6 issues, but the fixture-wide audit total the seed's self-check asserts (and `audit:count` returns on a fresh seed) is **7** — the desc-only edge-probe row also flags `no_clock_in` since the C3 fix made the skip-filter desc-aware. `computeExpectedDiscrepancies()` mirrors `countAuditDiscrepancies()` in `src/main/audit.ts` — keep in sync. Never ships in production. **Note:** the audit engine detects only the 6 types — it does NOT flag row overlaps or stored-vs-span mismatches.
- **Multi-user profile container architecture** — each user gets `conquered-data/profiles/<username>/vault.db` + `backups/` + `profile-manifest.json`; dev mode uses isolated `dev-data/dev-vault.db` (unchanged); auto-migration from legacy flat `vault.db` on first launch; passkey future-proofing hooks (`auth_methods`, `key_derivation_version`, `passkey_credential_id`) baked into every manifest. Two-phase IPC login: `profiles:list` (no DB) → `profiles:load` (loads vault) → `auth:login`.
- **Profile selector login UI** — profile cards (avatar photo or initials, display name, username) + dashed "Add Profile" card; clicking a card shows auth form with profile banner + ← back arrow; ESC on setup form returns to selector; Login tab hidden in Add Profile flow. `avatar_thumb_48` in manifest drives card photos — written on profile save and backfilled from encrypted DB on each login.
- **View Password toggle** — eye icon in login password field; CSS grid overlay so the SVG sits inside the input's right edge; open/closed icon swap on click; auto-resets to hidden on navigation.

### Explicitly Deferred / On the Roadmap (not yet built)

#### Reported bugs / feature notes (from user notes, 2026-06-29 — not yet built)
- **BUG — time format doesn't re-render live.** ✅ Fixed. Two problems were found: (1) the tracker table and global-log detail rows never applied the 12h/24h preference at all — they rendered the raw stored 24h value — and (2) `Settings.set()` had no re-render hook. Fix: every on-screen `clock_in`/`clock_out` now routes through a per-page `fmtClock()` → `Settings.formatTime()` (PDF/CSV exports stay raw 24h by design), and `Settings.set()` dispatches a `ct:settings-changed` event that tracker/global-log/task-timer listen for to re-render already-drawn rows in place (global-log re-expands open detail rows). Note: `fmtClock` must guard with `typeof Settings !== 'undefined'`, NOT `window.Settings` — `Settings` is a top-level `const` and is therefore **not** a property of `window`. Inline time editing seeds its input from the raw stored value, not the formatted cell text, so the HH:MM 24h validator still applies.
- **Time Tracker DBA-deletion selector.** ✅ Done. Settings → Data → "Time Clock Clear — Single Company" card: a company dropdown (populated from `Store.getCompanies()` when the Data tab opens) + CONFIRM-gated Delete that removes only the selected company's `time_entries` and their entry-scoped `task_items`, leaving the company row and all other companies intact. IPC `db:clear-timeclock-company` ({ companyId }); deletes `task_items` via `entry_id IN (SELECT rowid FROM time_entries WHERE user_id=? AND company_id=?)` BEFORE the entries. Shares the existing `showDbaConfirm`/`executeDbaClear` plumbing (type `'company'`). Note: `companies:delete` now applies the same `task_items` cleanup, so deleting a whole company no longer orphans its break/lunch/Dispatch task rows.
- **Dispatch — auto-fill active Task Name.** ✅ Done. `task-timer.js` now pre-fills the timer field (`#task-label-input`) with the active session's current Task Name via `getCurrentSessionTaskName()` (the in-progress clocked-in row's `name`, else the most recently named row of `activeEntry.rows_json`). `prefillTaskInput(preferred)` runs on load (when not resuming an in-progress task), and — instead of clearing the field — after Stop (preferred = the just-stopped task, so restart is one click) and after Cancel (falls back to the session's current name). The datalist + quick-pick chips are unchanged for switching tasks; the resume-in-progress path is untouched.
- **Tracker table — manual cell/column resizing.** ✅ Done. The tracker table (`#tracker-table`) uses `table-layout: fixed` + a `<colgroup>`; each column header (except the last) gets a drag divider (`.col-resizer`, injected in `installColResizers()`). Widths are stored as **percentages summing to 100**, so dragging redistributes width between the divider's two adjacent columns only — the table keeps its overall size. Persisted per-profile under `ui_trackerColWidths` (JSON array), loaded/applied in `initColResize()` on tracker init; double-clicking a divider resets to `DEFAULT_COLPX`. Scoped strictly to `#tracker-table` so the shared `table`/`thead th` styles (global-log, reports) are untouched (verified: those stay `table-layout: auto`, no resizers).
- **First-login encryption acknowledgement.** ✅ Done. After sign-in, the first inner page shows a one-time modal (`buildEncryptionNoticeModal()` / `showEncryptionNotice()` in `shell.js`) reassuring the user that all profile data is encrypted at rest with AES-256-GCM. A checked-by-default "Don't show this again" checkbox persists `ui_encryptionNoticeAck=1` (per-profile vault) on dismiss so it never reappears. Reuses the existing `audit_check_pending` one-shot login flag (set in `postLoginNavigate`); the encryption notice takes precedence over the audit login-notice and defers it that one login to avoid stacked modals.
- **Richer Description field in the tracker.** ✅ Done. The tracker row Description now edits as an auto-growing multi-line `<textarea>` (Companies-notes style): plain Enter inserts a newline, Ctrl/⌘+Enter or blur commits, Escape cancels — other inline fields keep single-line Enter-to-commit. The table cell renders the value through a `.desc-clamp` span (2-line `-webkit-line-clamp` + ellipsis, `white-space:pre-line`) with the full text in the cell `title` tooltip, so a long/multi-line description never bloats the row. The stored value keeps its newlines; every export path flattens via a shared `window.flattenText()` (collapses all whitespace runs to single spaces) — applied in the tracker PDF, global-log export-all/per-session PDF + on-screen detail line, all CSV exports (global-log, reports), and the emailed-report CSV (local flatten in `main.js doSendReport`). Flattening keeps the fixed-layout report tables from breaking on multi-line text.

#### Feature Add
- **Tray + launch-at-startup** ✅ (PR #21 + PR #23 + PR #27) — system `Tray` (Open / Lock Session / Backup Now / Quit; click+dblclick restore the window), opt-in **Close to Tray** toggle (close hides the window and keeps `sessionKey`/`sessionUser` alive so the scheduled-report poller keeps firing; an `isQuitting` flag set by tray Quit / menu Quit / `before-quit` bypasses the hide; default behavior unchanged — close still quits), and **Launch at Startup** toggle (`app.setLoginItemSettings({ openAtLogin, path: process.execPath })`; `win:set-launch-at-startup` IPC). **Both settings are app-global, not per-profile** (PR #23): launch-at-startup's source of truth is the **OS login item itself** (`win:get-launch-at-startup` reads `app.getLoginItemSettings().openAtLogin` — no app storage); close-to-tray lives in **`<ROOT_DATA_DIR>/app-prefs.json`** via `getAppPref/setAppPref` (`win:get/set-close-to-tray`), read by `main.js` at window-close with no vault loaded. This is why the toggles appear and work identically in **both** the in-app Window settings tab AND the **pre-auth login settings tab** (the login screen has no vault, so per-profile vault keys would have been UI-only there). Do **not** move these back into the per-profile `app_settings` vault. **Start minimized to tray** ✅ (PR #27): when the OS auto-launches the app (login item registers a `--startup` marker arg → `STARTED_AT_LOGIN`) AND the `startMinimized` app-pref is on, `whenReady` skips the splash and leaves the window hidden in the tray; gated on `STARTED_AT_LOGIN` so manual opens are unaffected. Toggle in both Window settings surfaces (`win:get/set-start-minimized`). ✅ **Verified 2026-06-30** against the first packaged build (v3.8.0): installed from the NSIS installer, toggled launch-at-startup, and confirmed the app auto-launches on a real Windows login (packaged builds resolve `process.execPath` to the real installed `.exe`, not the dev `electron.exe`).
- **About module** ✅ — tab in Settings (Steam-style redesign); icon, wordmark, version, credits, changelog, placeholder links
- **App load/splash screen** ✅ — branded 3-second splash before login with icon, wordmark, tagline, progress bar; theme-aware
- **Audit: 'Clear Messages' and 'Suggest discrepancy fix'** ✅ — per-row Dismiss/Apply Fix buttons in audit log; dismissed items excluded from close/lock warning count; suggestion text per discrepancy type; Clear All and Show/Hide Dismissed toolbar; `audit_dismissed` table persists state
- **Audit: consent-gated "Email Me" notification** ✅ (PR #18) — per-discrepancy "Email Me" in Reports → Audit emails the user (via the Reports SMTP config) and marks the item *acknowledged* (`audit_dismissed.emailed_at`): silenced for the close/lock warning + login notice, but kept **visible** in the log (badged "✉ emailed", with Restore). Never modifies a punch — corrections still require the explicit Apply Fix button. `audit:email-notify` + single-item `audit:undismiss` IPCs; `getProfileEmail()` recipient.
- **Audit: discrepancy notice at login** ✅ (PR #17) — after sign-in, the first inner page shows the audit-warning modal (login variant: informational "Dismiss") when unresolved discrepancies exist. `audit:count` IPC + one-shot `audit_check_pending` sessionStorage flag set in `postLoginNavigate`.
- **Clock-in requires Task Label + Name** ✅ (PR #16) — `clockIn()` blocks unless both are present; "+ Manual Entry" bypasses for backfill. Clock-out implicitly covered.
- **Auto Backup UI** ✅ — Settings → Data → Backup Library; lazy-loaded list of up to 30 auto-backups; accordion preview (account, company count, entry count, date range); CONFIRM-gated restore; current data safety-saved before any restore; logs out to login after restore
- **Manual database clear** ✅ — three-option wipe in Settings → Data: Time Clock Clear, Companies Clear, Full DB Clear; inline CONFIRM-typed confirmation
- **Task Timer & Counter page** ✅ — implemented as "Dispatch" module; task timing, description writeback, sidebar live timer, Tracker footer preview. **Break/lunch were relocated to the Time Tracker in v3.7** (Dispatch is now task-only); the Dispatch "Log a Task" quick-picks source from the active session's row Task Names. Break/lunch are still `task_items` (entry_id-scoped) — only the controls moved.
- **Recovery** ✅ — full account recovery flow: recovery key packet (session key sealed under recovery code at setup), password reset with full re-encryption of all encrypted data, pre-auth backup restore via file dialog; login recovery tab redesigned with three-mode picker
- **User Profile Icon** — avatar/icon displayed in the sidebar user block and profile screen
- **User Profile Screen** — dedicated screen for user profile management (username, password change, avatar, account details)
- **Encrypt time log entries** — time data is treated as PPI (learnable information); open question: encrypt individual time entries the same way company fields are, OR lock all user data behind session encryption on session lock. Needs design decision before implementation.
- **Reports / Auditing** — larger feature, builds on clock_in/clock_out timestamp data already captured per row; includes charts, label breakdowns, and full audit log
- **Session Auto Lock/Timeout** ✅ — fully wired: idle timer in src/main/session.ts, heartbeat IPC, activity listeners in shell.js, settings UI (0/5/15/30/60 min); default corrected to Off
- **Container/store architecture refactor** ✅ — centralized `src/renderer/store.js` (in-memory cache + pub/sub invalidation + rowid→id normalization), `ipc.js` (typed wrapper over preload channels), `validator.js` (input validation); injected by `Shell.init()` on every inner page. Cache is **per-page** (full `loadFile()` reloads recreate `window.Store` each nav) so it dedups within a page, not across navigations — true session caching deferred. Validator wired into `saveCompany()` and `saveSession()`.
- **Settings redesign** ✅ — Steam-style split layout: left nav (Appearance, Window, Security, Data, Reports, Accessibility, About), scrollable right panel; 860px modal. (The "Time & Display" tab was removed in v3.7 — clock format now lives under Appearance.)
- **Language change / i18n** — lowest priority, most complex; tackle last
- The North Phoenician cipher-layer concept was discussed in depth but explicitly **deferred to theory** — only the visual grid mechanic is built; the deeper PBKDF2 factor idea remains unbuilt

#### Fun
- **Rename themes to Final Fantasy names** ✅ — the 5 themes are now Memoria/Zanarkand/Rabanastre/Treno/Nibelheim (see Design System section)
- **Final Fantasy theme variants** — optional; explore additional FF-aesthetic palettes if desired (the current set is the 5 above).

#### Final / Release
- **Package for multi-platform release** — Windows (done), macOS, Linux, iOS, Android, iOS Mobile; icon assets already prepared for Win/Mac/Linux
- **Beta Keys** ✅ — offline early-access gate. A key is a Crockford-base32 blob (`CONQ-XXXXXX-XXXXXX-XXXXXX-XXXXXX`) carrying a signed payload: `version|expiryDays(uint16 LE)|nonce` + a 10-byte HMAC-SHA256 truncation (`src/main/beta-keys.js`, pure + 10 unit tests). Shared-secret (HMAC) scheme — the secret lives in `src/shared/beta-secret.js` (**gitignored**; `beta-secret.example.js` is the tracked template) so it ships in builds but never in the public repo; `src/main/ipc/auth.ts` fails **open** (gate disabled) if the file is absent. Mint keys with `node scripts/gen-beta-key.mjs --expires YYYY-MM-DD [--count N] [--label ..]`. Gate is **new-installs-only**: `beta:status` returns `required:true` only when `!IS_DEV && secret present && no profiles exist && no redeemed key`; a redeemed key is stored in the app-global `app-prefs.json` (`betaKey`). The login screen shows a branded `#beta-gate` card (login.html/login.js `showBetaGate`/`redeemBeta`, routed through `routeInitialScreen`) before account setup; `beta:redeem` validates + reports a clear expired/invalid message. Dev runs and existing installs are never gated. Note: offline validation can't remotely revoke a single key mid-beta — expiry is the lever; and the check is bypassable by patching the binary (fine for a free beta gate, not DRM).
- **Contributions / monetization** — Patreon, app purchase, or similar; to be designed once feature set is locked

---

## Design System Reference (current state)

**Themes were renamed to Final Fantasy city palettes.** The old Slate/Void/Arctic/Paper/Quartz set no longer exists — do not reference those names.

**Default theme:** **Memoria** (`settings.js` defaults `theme: 'memoria'`). The startup **splash always uses Zanarkand** as a fixed brand moment (`createSplashWindow('zanarkand')` in `src/main/main.ts`), independent of the user's selected theme.

**Five selectable themes**, each a `[data-theme="x"]` CSS variable block in `themes.css` (imported by `design-system.css`); the picker order in `shell.js`/`login.html` is Zanarkand, Memoria, Rabanastre, Treno, Nibelheim:
1. **Memoria** (FF9) — **default**, light. Crystalline/ethereal: cool silver-white base, soft lavender/amethyst accents.
2. **Zanarkand** (FF10) — dark. The "dream city": deep twilight-ocean base with glowing bioluminescent accents (closest spiritual successor to the old "Void" HUD aesthetic).
3. **Rabanastre** (FF12) — light. Sun-baked sandstone base, deep teal oasis accents; warm without softness.
4. **Treno** (FF9) — dark. Aristocratic gas-lamp mood: warm plum-charcoal base, amber-gold + wine-burgundy accents.
5. **Nibelheim** (FF7) — dark. Cold and stark: near-black slate base, icy silver-white accent, zero warmth.

**Typography rule (strict, enforced project-wide):** **DM Sans** (`var(--sans)`) for all UI text — navigation, labels, headers, body, descriptions, buttons. **JetBrains Mono** (`var(--mono)`) is reserved exclusively for data values — timestamps, durations, IDs, numeric stats, and the brand wordmark/login ASCII art. (PDF exports use **Inter**, base64-inlined.) All three are bundled locally — see the font-bundling note in Known Non-Issues. This was a deliberate full-project sweep after the user felt the original all-monospace, heavy-letter-spacing, uppercase-everything look was unreadable and "not professional."

**Elevation system:** 3-layer shadow system (`--shadow-1/2/3` + `--shadow-inset`) gives panels/cards/modals a sense of physical depth without literal 3D. Spiderweb nodes use radial-gradient "sphere" fills (light source top-left) rather than flat circles — and are **theme-aware**: a separate `getCanvasColors()` helper function in both `dashboard.js` and `companies.js` returns different fill/border/label colors depending on whether the active theme is light (Memoria/Rabanastre) or dark (Zanarkand/Treno/Nibelheim), because the original gradient-based node fills were invisible/illegible on light backgrounds.

**UI scale:** `Compact / Normal / Comfortable / Large`, implemented via CSS `zoom` scoped to `#main-content` only (see gotcha #5).

**Login card:** Must always render as a fully opaque, isolated (`isolation: isolate`) floating layer with its own strong shadow stack — this was a real bug on light themes where the white-ish card blended into a similarly light background; fixed by darkening the `.login-body` background specifically under the **light themes** (`[data-theme="memoria"]`/`[data-theme="rabanastre"]`) so the card has guaranteed contrast against it.

**Settings UI:** Centered modal (`#settings-modal`), NOT a sidebar-embedded panel — an earlier sidebar-panel implementation was explicitly rejected by the user in favor of the modal pattern, triggered by a "⚙ Settings" button placed in the sidebar directly above the username/active-session block, separated by its own border lines.

---

## Open Conceptual Threads (discussed, not yet implemented)

These were real conversations with the user that may resurface — worth knowing about even though nothing was built:

1. **Container/Store architecture refactor.** ✅ **Built in session 14 (v3.4.0).** The centralized `store.js` + `ipc.js` + `validator.js` layer now exists in `src/renderer/`, injected by `Shell.init()` on every inner page; ID normalization (`Number(row.rid)`) lives in `store.js` as the single enforcement point for gotcha #1. **Important caveat:** because navigation is full `mainWindow.loadFile()` reloads, `window.Store` is recreated empty on each nav — so the cache dedups repeated fetches *within* a page but does NOT persist across navigations. The original "fetch once per session" goal would require a main-process store; that was deliberately deferred. If cross-nav IPC volume ever becomes a concern, that's the next step.

2. **North Phoenician cipher / hidden-grid login Easter egg.** The user has separately discussed (in another account/session) using their knowledge of the North Phoenician alphabet as a novel cryptographic input layer. The conversation in *this* project scoped that down to just a visual mechanic — a grid of hoverable cells with hidden coordinate sequences. **The click-sequence mechanic (cosmetic egg + dev backdoor) was since removed (session 9); only the cosmetic grid background remains.** The deeper idea of actually using Phoenician characters as a third key-derivation factor (`password + TOTP + Phoenician_sequence → PBKDF2`) was explicitly left as future theory, never built. If this comes up again, treat it as an optional/advanced security feature proposal, not a current requirement.

3. **Reporting/Auditing feature.** Discussed only at the concept level — the user wants a "full reporting/auditing feature" eventually, motivated specifically by wanting clock_in/clock_out to be visually/permanently tracked (which is why those fields were added to the row schema and made independently editable). No UI or spec has been designed yet.

---

## Known Non-Issues (don't chase these)

- **`network_service_instance_impl.cc(...) Network service crashed, restarting service`** in the console at startup is a benign Chromium-internal message (the network utility process restarts itself). Not caused by app code; auto-recovers; no functional impact. The only "fixes" are command-line switches that weaken the sandbox — **do not add them**. Safe to ignore.
- **Fonts are bundled locally — the app makes no outbound requests.** DM Sans + JetBrains Mono ship as `.woff2` under `src/renderer/styles/fonts/`, declared via `@font-face` in `src/renderer/styles/fonts-local.css` (`@import`ed by `themes.css`). Inter for PDF export is base64-inlined into `src/renderer/pages/pdf-fonts.js` (`window.PDF_FONT_CSS`, loaded by `tracker.html`/`global-log.html` and injected into the export window's `<style>`). The Google Fonts origins were dropped from CSP at the same time. To refresh a font, re-download the `.woff2` from Google Fonts (variable fonts: one file covers the weight range) and, for Inter, regenerate the base64 in `pdf-fonts.js`.

## Things NOT To Do

- Do not reintroduce `better-sqlite3` or any native-compiled dependency — breaks on machines without Visual Studio build tools.
- Do not derive the encryption key from TOTP — breaks decryption across sessions (gotcha #2).
- Do not trust the sql.js `id` column for anything — always use `rowid` (gotcha #1).
- Do not apply `zoom` to `<body>` — locks out the sidebar at large scale (gotcha #5).
- Do not wire new interactive elements via inline `onclick`/`onchange` HTML attributes on the static page markup — they get wiped by `Shell.init()`'s innerHTML swap. Use `addEventListener` after `Shell.init()` resolves.
- Do not use real personal data (names, IDs, emails) anywhere in example code, docs, seed data, or placeholder text — see the PPI incident at the top of this file.
- Do not reintroduce the old login backdoor / `Ctrl+Shift+D` debug-overlay / click-sequence mechanic — it was deliberately removed in session 9. (The TOTP bypass now lives only behind `IS_DEV && user.dev_mode`; see the Authentication section.)
- Do not replace the Settings UI with a sidebar-embedded panel — user explicitly prefers the centered modal.

---

## Suggested Next Steps (pick up here)

Most feature work is done (auth, recovery, encryption-at-rest, reports/audit, profiles, scheduling, tray). What remains, in rough priority:
1. **Multi-platform packaging** — Windows installer works; macOS/Linux icons are ready. This is the highest-leverage next step: beta keys, the real-world launch-at-startup test, and monetization all sit downstream of having real installers.
2. **Multi-DBA handling** (open design question) — one user working several Navigator IDs/accounts; needs a data-model + UI decision before any build.
3. **Beta keys** — early-access gating (after packaging).
4. **Contributions / monetization** — Patreon / purchase; email-vs-donation reminder logic (after packaging).
5. **Language / i18n** — lowest priority, most complex; tackle last.
6. **Auth & Encryption Reform** (backburner, design-only) — DPAPI/TPM-sealed key blob; do not start until multi-platform packaging is scoped.

Note: light-theme polish, theme reordering, and the ASCII easter-egg redesign were dropped as not relevant (2026-06-29) — do not reintroduce them as open items.

Always confirm scope and design direction with the user before building — this project's history shows a strong back-and-forth collaborative pattern where Claude proposes a plan/design rationale first and waits for explicit go-ahead before writing code.
