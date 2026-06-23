# Conquered Time
### Professional Time Intelligence System

A secure, locally-encrypted desktop time tracker built for remote professionals managing multiple clients and companies.

---

## Features

- **TOTP MFA login** — Google Authenticator compatible, no external servers
- **AES-256-GCM encryption** — all PPI fields encrypted at rest with PBKDF2 key derivation
- **3-attempt lockout** — 24-hour lockout with live countdown display
- **Local recovery code** — one-time printable backup key generated at setup
- **Splash screen** — branded 3-second startup screen, theme-aware
- **Company spiderweb** — force-graph visualization of your client network
- **Dynamic time tracker** — clock in/out with task labels and per-company sessions, auto-grows as needed
- **Inline editing** — double-click any field to edit; duration recalculates automatically
- **User Profile** — avatar upload with manual crop modal (drag-to-pan, zoom in/out, circular preview); animated formats (GIF, APNG, WebP) preserved with Discord-style hover animation on sidebar
- **Dispatch (Task Timer)** — dedicated task timing module with break/lunch compliance, description writeback, and sidebar live timer
- **Global log** — filterable history across all companies with expandable session detail
- **Reports & Audit** — time summaries, label breakdowns, audit log with per-row dismiss/fix/suggest actions, dismissed items persisted across sessions
- **PDF & CSV export** — clean timesheet format; NavID excluded from all exports
- **Auto-save & backup** — configurable autosave interval, dated `.db` backups on every save (last 30 kept)
- **Backup Library** — browse, preview, and restore from any saved backup directly in Settings; current data safety-saved before any restore
- **Session auto-lock** — configurable idle timeout (Off / 5 / 15 / 30 / 60 min)
- **5 themes** — Arctic (default), Void, Slate, Paper, Quartz
- **Steam-style Settings** — split-panel layout with left category nav (Appearance, Time & Display, Data, Security, Accessibility, About)
- **Manual DB clear** — three-level wipe (Time Clock, Companies, Full) with typed CONFIRM confirmation
- **Keyboard navigation** — Ctrl+1–5 to switch modules, Ctrl+, for Settings, full modal tab-trapping
- **Electron security** — contextIsolation enabled, nodeIntegration disabled, sandboxed renderers

---

## Tech Stack

- **Electron** v29 (Windows 11 x64)
- **sql.js** — pure JS/WASM SQLite, no native compilation required
- **speakeasy** — TOTP generation and verification
- **qrcode** — QR code generation for TOTP setup
- **bcryptjs** — password hashing
- **electron-builder** — NSIS installer
- **Node.js v20.11.1** via NVM for Windows (required — v24 breaks Electron prebuilds)

---

## Project Structure

```
conquered-time/
├── push.bat                      # One-click git commit and push
├── seed-dev.js                   # Dev seed script (bypasses TOTP)
├── src/
│   ├── main/
│   │   ├── main.js               # Main process: window, IPC, DB, crypto, TOTP, backup, audit
│   │   └── preload.js            # Secure contextBridge API whitelist
│   └── renderer/
│       ├── pages/
│       │   ├── splash.html       # Branded startup splash (3s, theme-aware)
│       │   ├── login.html        # TOTP login, setup wizard, recovery, easter eggs
│       │   ├── dashboard.html    # Stats, mini spiderweb, recent activity
│       │   ├── companies.html    # Full spiderweb force graph, company CRUD
│       │   ├── tracker.html      # Dynamic time entry table, clock in/out
│       │   ├── task-timer.html   # Dispatch: task timer, break compliance, live sidebar timer
│       │   ├── global-log.html   # Cross-company history, CSV/PDF export
│       │   └── reports.html      # Audit log with dismiss/fix/suggest, charts, summaries
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

### Build installer

```bash
npm run build
```

Output: `dist/Conquered Time Setup.exe`

---

## First Run

1. Launch the app — branded splash screen displays for 3 seconds
2. The **Setup** tab appears automatically on first run
3. Enter a username and strong password
4. Scan the **TOTP QR code** with Google Authenticator
5. **Write down your recovery code** — shown once, never again
6. Enter the 6-digit code to verify and create your account
7. Every subsequent login requires username + password + TOTP code

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

---

## Data Location

```
%APPDATA%\conquered-time\conquered-data\
  vault.db        - encrypted SQLite database
  backups\        - dated backup copies (last 30 retained)
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
    Decrypts company/entry fields on access
    Cleared on lock or app close
```

- PPI fields (platform logins, Navigator IDs, URLs) encrypted individually per record
- NavID never appears on exported PDFs — in-session display only
- 3 failed TOTP attempts triggers a 24-hour lockout with countdown
- Recovery code unlocks account locally — no network call required
- Auto-backup on every save and on close; restore via Settings → Data → Backup Library
- Session auto-lock on configurable idle timeout

---

## Pushing Changes to GitHub

Double-click `push.bat` in the project root. It will ask what you worked on, then commit and push automatically.

---

*Conquered Time — Built for remote professionals who take their work seriously.*
