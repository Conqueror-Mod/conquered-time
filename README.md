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
- **Company spiderweb** — force-graph visualization of your client network with inline detail pane
- **Dynamic time tracker** — two-module control panel: a Session Clock (Clock In/Out + Break/Lunch) beside task inputs (label, name, description); the entry table auto-grows as needed
- **Inline editing** — double-click any field to edit; duration recalculates automatically
- **Manual Entry** — backfill a session you forgot to clock live by adding an editable row and typing the times directly
- **User Profile** — avatar upload with manual crop modal (drag-to-pan, zoom, circular preview); animated formats (GIF, APNG, WebP) preserved
- **Dispatch (Task Timer)** — dedicated task timing/counting module with sidebar live timer and description writeback to the tracker; the task list draws from the active session's task names
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
- **Manual DB clear** — three-level wipe (Time Clock, Companies, Full) with typed CONFIRM confirmation
- **Keyboard navigation** — Ctrl+1–5 to switch modules, Ctrl+, for Settings, full modal tab-trapping
- **Electron security** — contextIsolation enabled, nodeIntegration disabled, sandboxed renderers, whitelisted IPC channels, strict Content-Security-Policy (`script-src 'self'` on every page — no inline scripts or event handlers)
- **Centralized data layer** — shared Store / IPC / Validator modules give the renderer one source of truth for fetching, record-ID normalization, and input validation
- **Cross-navigation caching** — a main-process read cache reuses decrypted company/entry data across page navigations, so the dashboard, companies, and reports don't re-decrypt your history on every visit
- **Easter egg** — Konami code on the profile selector reveals a hidden ASCII hourglass

---

## Tech Stack

- **Electron** v29 (Windows 11 x64)
- **sql.js** — pure JS/WASM SQLite, no native compilation required
- **speakeasy** — TOTP generation and verification
- **qrcode** — QR code generation for TOTP setup
- **bcryptjs** — password hashing
- **nodemailer** — SMTP email delivery for reports
- **electron-builder** — NSIS installer
- **Node.js v20.11.1** via NVM for Windows (required — v24 breaks Electron prebuilds)

---

## Project Structure

```
conquered-time/
├── seed-dev.js                   # Dev seed script (bypasses TOTP)
├── version.json                  # Version manifest for Check for Updates
├── src/
│   ├── main/
│   │   ├── main.js               # Main process: window, IPC, DB, TOTP, backup, audit
│   │   ├── vault-crypto.js       # Pure AES-256-GCM / PBKDF2 + atomic re-encryption (unit-tested)
│   │   ├── read-cache.js         # Pure main-process read cache (owner-keyed; unit-tested)
│   │   └── preload.js            # Secure contextBridge API whitelist
│   └── renderer/
│       ├── store.js              # In-memory data cache + pub/sub invalidation, ID normalization
│       ├── ipc.js                # Thin typed wrapper over the preload IPC channels
│       ├── validator.js          # Input validation/normalization before save
│       ├── pages/
│       │   │                     # Each page is <name>.html + a sibling <name>.js
│       │   │                     # (no inline scripts/handlers — strict CSP)
│       │   ├── splash.html/.js   # Branded startup splash (theme-aware)
│       │   ├── login.html/.js    # Profile selector, TOTP login, setup wizard, recovery, pre-auth settings
│       │   ├── dashboard.html/.js# Stats, mini spiderweb, recent activity
│       │   ├── companies.html/.js# Full spiderweb force graph, company CRUD
│       │   ├── tracker.html/.js  # Dynamic time entry table, clock in/out
│       │   ├── task-timer.html/.js # Dispatch: task timer, break compliance, live sidebar timer
│       │   ├── global-log.html/.js # Cross-company history, CSV/PDF export
│       │   ├── reports.html/.js  # Audit log with dismiss/fix/suggest, period summary, email
│       │   ├── audit-wizard.html/.js # Step-through discrepancy resolution wizard
│       │   ├── profile.html/.js  # Avatar upload, display name, password change, work state
│       │   ├── theme-init.js     # Pre-paint theme guard (inner pages, sessionStorage)
│       │   ├── login-theme-init.js  # Pre-paint theme guard (login, localStorage ct_pa_*)
│       │   └── audit-theme-init.js  # Pre-paint theme guard (audit wizard, query-param)
│       ├── components/
│       │   ├── shell.js          # Titlebar, sidebar, toast, settings modal, backup library, delegated event dispatcher
│       │   └── settings.js       # Theme, scale, accessibility, time format, auto-lock engine
│       └── styles/
│           ├── design-system.css # Entry point — imports all partials
│           ├── themes.css        # FF city theme token sets — 5 selectable + Lindblum (defined, not exposed); imports fonts-local.css
│           ├── fonts-local.css   # @font-face for bundled DM Sans + JetBrains Mono
│           ├── fonts/            # Bundled .woff2 files (no remote fetch)
│           ├── base.css          # Scale, accessibility, reset
│           ├── shell.css         # Titlebar, sidebar, layout
│           ├── components.css    # Shared UI components
│           ├── settings-modal.css # Steam-style split settings, backup library, DB clear
│           ├── login.css
│           └── print.css
├── assets/
│   └── icon.ico                  # App icon
├── test/
│   ├── vault-crypto.test.js      # node --test suite for crypto + re-encryption
│   └── read-cache.test.js        # node --test suite for the main-process read cache
├── .claude/skills/run-app/       # Playwright REPL driver for launching/driving the app (dev tooling)
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

Uses the built-in `node --test` runner (no extra dependencies). Covers the
security-critical paths in `src/main/vault-crypto.js` (AES-256-GCM round-trips,
PBKDF2 key separation, and the all-or-nothing re-encryption used by password
change / recovery — read-phase abort and write-phase rollback) and the
main-process read cache in `src/main/read-cache.js` (hit/miss memoization,
targeted/full invalidation, and the owner-change auto-clear that prevents
cross-profile data leaks).

### Build installer

```bash
npm run build
```

Output: `dist/Conquered Time Setup.exe`

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
