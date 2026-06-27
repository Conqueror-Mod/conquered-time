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
- **Dynamic time tracker** — clock in/out with task labels and per-company sessions, auto-grows as needed
- **Inline editing** — double-click any field to edit; duration recalculates automatically
- **User Profile** — avatar upload with manual crop modal (drag-to-pan, zoom, circular preview); animated formats (GIF, APNG, WebP) preserved
- **Dispatch (Task Timer)** — dedicated task timing module with break/lunch compliance, sidebar live timer, description writeback to tracker
- **Break/lunch compliance** — US state-specific policy (California, New York, federal default); compliance checked in Dispatch and Audit
- **Global log** — filterable history across all companies with expandable session detail
- **Reports & Audit** — period summary, company breakdown, audit log with per-row dismiss/fix/suggest; dismissed items persisted; US state policy named in suggestion text
- **PDF & CSV export** — clean timesheet format; work type, location, supervisors in header; per-label subtotals; Export All includes summary section; NavID excluded from all exports
- **Email Reports** — send PDF + CSV directly via SMTP from the Reports page; scheduled delivery (daily/weekly/monthly/quarterly/annual)
- **Auto-save & backup** — configurable autosave interval; dated `.db` backups on every save (last 30 kept)
- **Backup Library** — browse, preview, and restore from any saved backup in Settings; current data safety-saved before any restore
- **Session auto-lock** — configurable idle timeout (Off / 5 / 15 / 30 / 60 min)
- **5 themes** — Zanarkand (default), Memoria, Rabanastre, Treno, Nibelheim
- **Steam-style Settings** — split-panel layout with left category nav (Appearance, Time & Display, Window, Security, Data, Reports, Accessibility, About)
- **Manual DB clear** — three-level wipe (Time Clock, Companies, Full) with typed CONFIRM confirmation
- **Keyboard navigation** — Ctrl+1–5 to switch modules, Ctrl+, for Settings, full modal tab-trapping
- **Electron security** — contextIsolation enabled, nodeIntegration disabled, sandboxed renderers, whitelisted IPC channels
- **Centralized data layer** — shared Store / IPC / Validator modules give the renderer one source of truth for fetching, record-ID normalization, and input validation
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
│   │   └── preload.js            # Secure contextBridge API whitelist
│   └── renderer/
│       ├── store.js              # In-memory data cache + pub/sub invalidation, ID normalization
│       ├── ipc.js                # Thin typed wrapper over the preload IPC channels
│       ├── validator.js          # Input validation/normalization before save
│       ├── pages/
│       │   ├── splash.html       # Branded startup splash (theme-aware)
│       │   ├── login.html        # Profile selector, TOTP login, setup wizard, recovery
│       │   ├── dashboard.html    # Stats, mini spiderweb, recent activity
│       │   ├── companies.html    # Full spiderweb force graph, company CRUD
│       │   ├── tracker.html      # Dynamic time entry table, clock in/out
│       │   ├── task-timer.html   # Dispatch: task timer, break compliance, live sidebar timer
│       │   ├── global-log.html   # Cross-company history, CSV/PDF export
│       │   ├── reports.html      # Audit log with dismiss/fix/suggest, period summary, email
│       │   ├── audit-wizard.html # Step-through discrepancy resolution wizard
│       │   └── profile.html      # Avatar upload, display name, password change, work state
│       ├── components/
│       │   ├── shell.js          # Titlebar, sidebar, toast, settings modal, backup library
│       │   └── settings.js       # Theme, scale, accessibility, time format, auto-lock engine
│       └── styles/
│           ├── design-system.css # Entry point — imports all partials
│           ├── themes.css        # 5 theme token sets + Google Fonts import
│           ├── base.css          # Scale, accessibility, reset
│           ├── shell.css         # Titlebar, sidebar, layout
│           ├── components.css    # Shared UI components
│           ├── settings-modal.css # Steam-style split settings, backup library, DB clear
│           ├── login.css
│           └── print.css
├── assets/
│   └── icon.ico                  # App icon
├── test/
│   └── vault-crypto.test.js      # node --test suite for crypto + re-encryption
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
security-critical paths in `src/main/vault-crypto.js`: AES-256-GCM round-trips,
PBKDF2 key separation, and the all-or-nothing re-encryption used by password
change / recovery (read-phase abort and write-phase rollback).

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

---

*Conquered Time — Built for remote professionals who take their work seriously.*
