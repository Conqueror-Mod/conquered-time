# Conquered Time
### Professional Time Intelligence System

> Steam-aesthetic, TOTP-secured, AES-256-GCM encrypted time tracker for remote professionals.

---

## Features

- **TOTP MFA login** — works with Google Authenticator, no external servers
- **AES-256-GCM encryption** — all PPI (logins, emails, URLs) encrypted at rest
- **PBKDF2 key derivation** — encryption key derived from password + TOTP code
- **3-attempt lockout** — 24-hour lockout with countdown display
- **Local recovery code** — one-time printable backup key generated at setup
- **Company spiderweb** — force-graph visualization with click-to-navigate nodes
- **15-row time tracker** — clock in/out with task labels, per-company sessions
- **Global log** — filterable history across all companies
- **PDF export** — formal timesheet format (NavID excluded from printouts)
- **CSV export** — full data export for spreadsheets
- **Auto-backup** — dated `.db` copy on every save and app close (last 30 kept)
- **Electron security** — contextIsolation, nodeIntegration disabled, sandboxed renderers

---

## Tech Stack

- **Electron** v29 (Windows 11 x64)
- **better-sqlite3** — local encrypted database
- **speakeasy** — TOTP generation and verification
- **qrcode** — QR code generation for TOTP setup
- **bcryptjs** — password hashing
- **electron-builder** — NSIS installer

---

## Project Structure

```
conquered-time/
├── src/
│   ├── main/
│   │   ├── main.js          # Main process: window, IPC, DB, crypto
│   │   └── preload.js       # Secure contextBridge API whitelist
│   ├── renderer/
│   │   ├── pages/
│   │   │   ├── login.html   # TOTP login, setup wizard, recovery
│   │   │   ├── dashboard.html
│   │   │   ├── companies.html  # Spiderweb force graph
│   │   │   ├── tracker.html    # 15-row time log
│   │   │   └── global-log.html
│   │   ├── components/
│   │   │   └── shell.js     # Shared titlebar, sidebar, toast
│   │   └── styles/
│   │       └── design-system.css
│   └── shared/
├── assets/
│   └── icon.ico             # App icon (add your own)
├── build/
├── package.json
└── README.md
```

---

## Setup & Build

### Prerequisites

- Node.js 18+ (LTS)
- Windows 11 x64 (target platform)

### Install

```bash
cd conquered-time
npm install
```

### Run (development)

```bash
npm start
```

### Build installer (.exe + NSIS setup wizard)

```bash
npm run build
```

Output: `dist/Conquered Time Setup.exe`

---

## First Run

1. Launch the app
2. The **Setup** tab will appear automatically on first run
3. Enter a username and strong password
4. Click **Generate TOTP QR Code** — scan with Google Authenticator
5. **Write down your recovery code** — this is the only copy
6. Enter the 6-digit TOTP code to verify, then click **Create Account**
7. Login with username + password + TOTP code on every subsequent launch

---

## Data Location

All data is stored locally at:
```
%APPDATA%\conquered-time\conquered-data\
  vault.db           ← encrypted SQLite database
  backups\           ← dated backup copies (last 30)
```

---

## Security Model

```
Login: password + TOTP code
         ↓
    PBKDF2 (310,000 iterations, SHA-256)
         ↓
    32-byte AES-256-GCM key (held in memory only)
         ↓
    Decrypts PPI fields on access
    Cleared on app close / lock
```

- Sensitive fields (platform logins, emails, URLs) encrypted individually
- NavID never appears on exported PDFs — session display only
- 3 failed TOTP attempts → 24-hour lockout with countdown
- Recovery code unlocks account locally (no network required)
- Auto-backup runs on every save and on app close

---

## Adding an Icon

Place a 256×256 `.ico` file at `assets/icon.ico` before building.
Free tools: [convertio.co](https://convertio.co) or [icoconvert.com](https://icoconvert.com)

---

*Conquered Time — Built for remote professionals who take their work seriously.*
