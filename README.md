# Conquered Time
### Professional Time Intelligence System

A secure, locally-encrypted desktop time tracker built for remote professionals managing multiple clients and companies.

---

## Features

- **TOTP MFA login** — Google Authenticator compatible, no external servers
- **AES-256-GCM encryption** — all PPI fields and time entries encrypted at rest with PBKDF2 key derivation
- **Windows Hello / Quick Unlock** — fast login via biometric or PIN after first session; password fallback always available
- **3-attempt lockout** — 24-hour lockout with live countdown display
- **Local recovery code** — one-time printable backup key; enables full password reset with automatic key re-encryption, no data loss
- **Multi-user profile selector** — isolated per-user vaults; avatar cards on login screen; auto-migration from legacy single-vault layout
- **Splash screen** — branded startup screen, theme-aware
- **Company spiderweb** — force-graph visualization of your client network with inline detail pane and hover tooltips; guaranteed clean spacing (spheres never overlap, even in a dense network). The Dashboard mini-web mirrors the full Companies web.
- **Live session indicators** — a `LIVE` badge lights up while a punch is open (clocked in, not out); the sidebar shows two labeled counters, **Active Punch** (the open session clock) and **Dispatch Timer** (the running task)
- **Dynamic time tracker** — two-module control panel: a Session Clock (Clock In/Out + Break/Lunch) beside task inputs (label, name, description); the entry table auto-grows as needed
- **Inline editing** — double-click any field to edit; duration recalculates automatically. The Description field opens a multi-line editor for longer notes (kept tidy in the table, flattened in exports)
- **Resizable tracker columns** — drag the column dividers to set widths; double-click to reset. Your layout is remembered per profile
- **Manual Entry** — backfill a session you forgot to clock live by adding an editable row and typing the times directly
- **User Profile** — avatar upload with manual crop modal (drag-to-pan, zoom, circular preview); animated formats (GIF, APNG, WebP) preserved
- **Dispatch (Task Timer)** — dedicated task timing/counting module with sidebar live timer and description writeback to the tracker; the task list draws from the active session's task names, and the timer field pre-fills with your current task so restarting it is one click
- **Break & Lunch punches** — Start/End break and lunch from the Time Tracker's Session Clock module, with inline US-state compliance status (California, New York, federal default); also surfaced in Reports/Audit
- **Global log** — filterable history across all companies with expandable session detail
- **Reports & Audit** — period summary, company breakdown, audit log with per-row dismiss/fix/suggest/**email**; dismissed & emailed items persisted (emailed stay visible, badged); a discrepancy notice is shown at login; US state policy named in suggestion text
- **PDF & CSV export** — clean timesheet format; work type, location, supervisors in header; per-label subtotals; Export All includes summary section; NavID excluded from all exports
- **Email Reports** — send PDF + CSV directly via SMTP from the Reports page; scheduled delivery (daily/weekly/monthly/quarterly/annual). Note: scheduled sends fire only while the app is open and unlocked — a missed send is caught up on next sign-in (any login method)
- **Auto-save & backup** — configurable autosave interval; dated `.db` backups on every save (last 30 kept)
- **Backup Library** — browse, preview, and restore from any saved backup in Settings; current data safety-saved before any restore
- **Session auto-lock** — configurable idle timeout (Off / 5 / 15 / 30 / 60 min)
- **5 themes** — Final Fantasy city palettes: Memoria (default, light), Zanarkand (dark), Rabanastre (light), Treno (dark), Nibelheim (dark). The startup splash always uses Zanarkand as a brand moment regardless of the selected theme.
- **Steam-style Settings** — split-panel layout with left category nav (Appearance, Window, Security, Data, Reports, Accessibility, About)
- **Manual DB clear** — scoped wipes with typed CONFIRM confirmation: a single company's time clock, all companies' time clock, all companies, or the full database
- **Keyboard navigation** — Ctrl+1–5 to switch modules, Ctrl+, for Settings, full modal tab-trapping
- **Electron security** — contextIsolation enabled, nodeIntegration disabled, sandboxed renderers, whitelisted IPC channels, strict Content-Security-Policy (`script-src 'self'` on every page — no inline scripts or event handlers)
- **Centralized data layer** — shared Store / IPC / Validator modules give the renderer one source of truth for fetching, record-ID normalization, and input validation
- **Cross-navigation caching** — a main-process read cache reuses decrypted company/entry data across page navigations, so the dashboard, companies, and reports don't re-decrypt your history on every visit


---

## Tech Stack

- **Electron** v29 (Windows 11 x64 primary target; macOS & Linux on the roadmap)
- **TypeScript** (dev-only) — the main process is `strict` TS compiled to `dist-main/`; renderer pages are TS compiled to sibling `.js`; the hand-written shell/login/settings/about stay JSDoc-typed JS. `npm run typecheck` gates all of it. No bundler, no runtime TS.
- **sql.js** — pure JS/WASM SQLite, no native compilation required
- **speakeasy** — TOTP generation and verification
- **qrcode** — QR code generation for TOTP setup
- **bcryptjs** — password hashing
- **nodemailer** — SMTP email delivery for reports
- **electron-builder** — NSIS installer
- **Node.js v20.11.1** via NVM for Windows (required — v24 breaks Electron prebuilds)

A companion **Discord community bot** (discord.js + TypeScript) handles beta-key distribution, welcome/roles, bug & feedback intake, and release announcements. It's private operational tooling and is not part of this repository.

---

## Project Structure

```
conquered-time/
├── seed-dev.js                   # Dev seed script (bypasses TOTP) — 10-company / 103-entry stress fixture
├── version.json                  # Version manifest read by Check for Updates
├── tsconfig.json                 # checkJs project (renderer JS + types/)
├── tsconfig.main.json            # main-process TS build → dist-main/ (strict)
├── tsconfig.renderer.json        # renderer page TS → sibling .js
├── dist-main/                    # compiled main process (generated; gitignored; ships in builds)
├── types/
│   ├── globals.d.ts              # renderer globals, data shapes, IPC channel source of truth
│   └── phase1-dom-compat.d.ts    # DOM-narrowing shim (removed as pages finish converting)
├── src/
│   ├── main/                     # TypeScript (strict), compiled by `npm run build:main`
│   │   ├── main.ts               # App lifecycle: window/splash/tray/menu, app-prefs, profile boot
│   │   ├── preload.ts            # contextBridge — whitelisted IPC channels only
│   │   ├── db.ts                 # sql.js lifecycle + query helpers; owns handle + vault path
│   │   ├── session.ts            # session key/user/activeEntry, idle lock, orphan sweep
│   │   ├── cache.ts              # main-process read cache singleton
│   │   ├── policies.ts           # break/lunch compliance tiers (pure data)
│   │   ├── audit.ts backups.ts email.ts   # audit counting, backups, SMTP + schedule engine
│   │   ├── vault-crypto.js       # Pure AES-256-GCM / PBKDF2 + atomic re-encryption (unit-tested)
│   │   ├── read-cache.js         # Pure main-process read cache (owner-keyed; unit-tested)
│   │   ├── beta-keys.js          # Pure beta-key mint/verify (HMAC; unit-tested)
│   │   └── ipc/                  # one register(ctx) module per surface
│   │       ├── auth.ts           # profiles/auth/totp/beta:*, profile get/save
│   │       ├── companies.ts entries.ts audit.ts settings.ts email.ts
│   ├── renderer/                 # pages are TS → sibling .js (loaded directly, no bundler)
│   │   ├── pages/                # <name>.html + <name>.ts (compiled to <name>.js); strict CSP, no inline scripts
│   │   │   ├── splash · login · dashboard · companies · tracker
│   │   │   ├── task-timer (Dispatch) · global-log · reports · profile · audit-wizard
│   │   │   └── theme-init / login-theme-init / audit-theme-init  # pre-paint theme guards
│   │   ├── components/
│   │   │   ├── shell.js          # Titlebar, sidebar, toast, settings modal, backup library, delegated dispatcher
│   │   │   ├── settings.js       # Theme, scale, accessibility, time format, auto-lock engine
│   │   │   └── about.js          # Shared About panel — mounted by BOTH login & in-app settings
│   │   └── styles/               # design-system.css entry + themes.css (5 FF palettes) + partials + bundled fonts
│   └── shared/
│       ├── beta-secret.example.js # template (real beta-secret.js is gitignored)
│       └── BETA-KEYS.md          # beta-key scheme + minting docs
├── assets/                       # icon set (icon.ico / .icns / icon-16…1024.png) + installer bitmaps
├── test/                         # node --test suites (unit + fast-check property tests):
│                                 #   vault-crypto, read-cache, beta-keys, canvas-text,
│                                 #   row-utils, time-parse, audit-oracle, vault-fixture
├── .claude/skills/run-app/       # Playwright REPL driver for launching/driving the app (dev tooling)
├── CLAUDE.md · DEV_NOTES.md      # full context + quick-reference dev docs
├── package.json
└── README.md
```

---

## Setup

### Prerequisites

- Node.js v20.11.1 via [NVM for Windows](https://github.com/coreybutler/nvm-windows)
- Windows 11 x64

### Install

```bash
npm install
```

### Run (development)

```bash
npm start
```

### Seed dev database (bypasses TOTP for fast testing)

```bash
npm run seed
```

Credentials: `devuser` / `devpass123`

### Run tests

```bash
npm test
```

Uses the built-in `node --test` runner, plus `npm run typecheck` (both TS
projects + the checkJs renderer). Suites cover the security-critical paths in
`src/main/vault-crypto.js` (AES-256-GCM round-trips, PBKDF2 key separation,
and the all-or-nothing re-encryption used by password change / recovery), the
main-process read cache in `src/main/read-cache.js` (memoization, invalidation,
owner-change auto-clear against cross-profile leaks), the beta-key mint/verify
scheme (`beta-keys`), and the shared renderer utilities (`canvas-text`,
`row-utils`, `time-parse`).

On top of the example-based suites, **property-based tests** (`fast-check`)
assert the same contracts across the whole input space, and a **differential
audit oracle** (`test/audit-oracle.props.test.js`) generates randomized vaults
through `test/vault-fixture.js` (the same builders `seed-dev.js` uses) to
mechanically enforce that the audit engine and the seed's expected-count
mirror never drift apart. `npm run coverage:critical` prints a scoped `c8`
branch-coverage report over the two security-critical modules (report, not a
gate). See `docs/PLAN-property-testing.md` for the full design.

### Build installer

```bash
npm run build
```

Output: `dist/Conquered Time Setup <version>.exe` (NSIS). `npm run build` runs `npm run compile` (both TS projects) first. Signed installers for each version are published on GitHub Releases.

---

## Beta access & community

The app is in **private beta**. New installs open a beta-gate screen and require a redeemable key before account setup; existing installs and dev runs are never gated (see `src/shared/BETA-KEYS.md`). Keys are offline-verifiable — a signed HMAC blob, no server.

A Discord community bot distributes keys (`/betakey`), greets and roles new members, collects `/bug` and `/feedback`, and announces new releases from GitHub. The bot is private operational tooling, maintained outside this repository.

---

## First Run

1. Launch the app — branded splash screen displays
2. The **Setup** tab appears automatically on first run
3. Enter a username and strong password
4. Scan the **TOTP QR code** with Google Authenticator
5. **Write down your recovery code** — shown once, never again
6. Enter the 6-digit code to verify and create your account
7. Every subsequent login requires username + password + TOTP code
8. Optionally enroll **Windows Hello / Quick Unlock** in Settings → Security for fast re-entry after locking

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Dashboard |
| `Ctrl+2` | Companies |
| `Ctrl+3` | Time Tracker |
| `Ctrl+4` | Reports |
| `Ctrl+5` | Global Log |
| `Ctrl+,` | Open Settings |
| `Ctrl+L` | Lock session |
| `F12` | Toggle DevTools |
| `Escape` | Close modal |
| `Arrow keys` | Navigate sidebar |
| `Tab / Shift+Tab` | Cycle focus in modals |
| `Alt+F4` | Close app (triggers audit check) |
| `↑↑↓↓←→←→BA↵` | ??? (profile selector only) |

---

## Data Location

```
%APPDATA%\conquered-time\conquered-data\profiles\<username>\
  vault.db               - encrypted SQLite database
  backups\               - dated backup copies (last 30 retained)
  profile-manifest.json  - profile metadata (display name, avatar, auth methods)
```

---

## Security Model

```
Login: password + TOTP code
         |
    PBKDF2 (310,000 iterations, SHA-256)
         |
    32-byte AES-256-GCM key (memory only)
         |
    Decrypts company fields, profile, and time entries on access
    Cleared on lock or app close
```

- All time entry data (task labels, clock times, descriptions) encrypted at rest — AES-256-GCM, transparent one-time migration on first login after upgrade
- PPI fields (platform logins, Navigator IDs, URLs) encrypted individually per company record
- NavID never appears on exported PDFs — in-session display only
- 3 failed TOTP attempts triggers a 24-hour lockout with countdown
- Recovery code enables full password reset with automatic re-encryption of all data under the new key
- Windows Hello / Quick Unlock uses Electron safeStorage (DPAPI-backed) to persist the session key securely across locks
- Auto-backup on every save and on close; restore via Settings → Data → Backup Library
- Session auto-lock on configurable idle timeout
- Strict Content-Security-Policy on every page: `script-src 'self'` with no inline scripts or `on*` event handlers (all logic in external `.js`, all handlers via delegated dispatchers) — defense-in-depth against script injection, on top of `escapeHtml()` output sanitization

---

## Known console messages

- **`network_service_instance_impl.cc(...) Network service crashed, restarting service`** at startup is a benign Chromium-internal message (the network utility process restarts itself). It is not an app error, recovers automatically, and does not affect functionality. Safe to ignore.
- All fonts are bundled locally — DM Sans and JetBrains Mono ship as `.woff2` under `src/renderer/styles/fonts/`, and Inter (for PDF export) is base64-inlined. **The app makes no outbound network requests** and renders identically offline.

---

*Conquered Time — Built for remote professionals who take their work seriously.*
