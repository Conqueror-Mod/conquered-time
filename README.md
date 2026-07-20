# Conquered Time

### Professional Time Intelligence System

A secure, locally-encrypted desktop time tracker built for remote professionals managing multiple clients and companies. Everything lives in an AES-256-encrypted vault on your machine — no cloud, no account server, no outbound network requests.

**Windows 11 x64 · currently in private beta**

---

## Install

1. Download the latest `Conquered-Time-Setup-<version>.exe` from **[Releases](https://github.com/Conqueror-Mod/conquered-time/releases/latest)**.
2. Run the installer (unsigned during beta — SmartScreen will warn on first install; choose *More info → Run anyway*).
3. On first launch, redeem your **beta key** (distributed through the community Discord's `/betakey`), then create your account: username + strong password, scan the TOTP QR with Google Authenticator, and **write down your recovery code** — it's shown once.

That's it. The app **updates itself** from GitHub Releases: it checks shortly after launch, downloads with a progress bar when you approve, and installs on restart (Settings → About → Updates to check manually). You never need to come back here for new versions.

---

## What it does

### Track
- **Time Tracker** — clock in/out with a Session Clock, task label/name/description per row, auto-growing entry table, inline double-click editing (multi-line descriptions supported), resizable columns, manual entry for backfill
- **Tray punch + global hotkey** — Clock In/Out from the system tray or anywhere with `Ctrl+Alt+P` (configurable), without opening the window; repeats your last task
- **Dispatch (Task Timer)** — time individual tasks with a sidebar live timer and description writeback; break & lunch punches with US-state compliance status (or Pomodoro-style cadence if you prefer)
- **Idle punch reminder** (opt-in) — nudges you if you walk away while clocked in
- **Week view** — a Sunday-start week band on the Dashboard showing daily volume at a glance

### Organize
- **Company Galaxy** — your client network as an interactive packed-bubble map: companies group into galaxies, drill into projects and platforms, fly-through zoom, stable identity colors that follow each company across the whole app (activity feeds, logs, ledger, charts)
- **Global Log** — filterable cross-company history with expandable per-session detail, right-click actions (open in tracker, export, delete), and CSV/PDF export
- **Global search** — `Ctrl+K` omnibox to jump to any company or page
- **CSV import** — bring existing clients and tracked time in from a spreadsheet via a guided mapping wizard (Settings → Data); re-imports dedupe safely

### Report & bill
- **Reports & Audit** — period summaries, company breakdowns, and an audit engine that flags punch discrepancies (missing clock-outs, overlong sessions, …) with per-row dismiss / suggested fix / email-me; discrepancy notice at login
- **Insights** — interactive charts: client mix, label breakdowns, trends, with click-through to the filtered Global Log
- **Invoicing** — turn tracked hours into numbered client invoices: preview, issue (frozen into an encrypted ledger), mark Paid/Unpaid/Void, export branded PDFs, or email directly
- **PDF & CSV export** — clean timesheet formats with per-label subtotals; sensitive IDs never appear on exports
- **Emailed reports** — send PDF + CSV via your own SMTP, on demand or scheduled (daily → annual), scoped to one company, each company separately, or all combined

### Protect
- **Encryption at rest** — companies, time entries, profile, and invoices encrypted with AES-256-GCM; the key is derived from your password (PBKDF2, 310k iterations) and held in memory only
- **TOTP MFA** — Google Authenticator-compatible login gate with 3-attempt / 24-hour lockout; **Windows Hello / Quick Unlock** for fast re-entry
- **Recovery** — one-time recovery code, recovery file, and device-bound reset paths that restore access with full re-encryption and zero data loss
- **Data safety net** — automatic dated backups (last 30), pre-action safety snapshots before every destructive operation, a browsable Backup Library with preview + restore, and portable encrypted vault export
- **Session auto-lock** on idle; scoped manual data clears with typed confirmation
- **Hardened Electron** — sandboxed renderers, context isolation, whitelisted IPC, strict CSP (`script-src 'self'`, no inline scripts)

### Make it yours
- **Multi-user profiles** — isolated encrypted vaults per user with an avatar profile selector at login
- **5 Final Fantasy city themes** — Memoria (default, light), Zanarkand, Rabanastre, Treno, Nibelheim — plus 4 UI scale steps, 12/24-hour display, and accessibility modes (reduced motion, high contrast, colorblind-safe palette)
- **Steam-style Settings**, first-run onboarding tour, tooltips, close-to-tray, launch-at-startup, start-minimized

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+P` | Clock in / out (system-wide, configurable) |
| `Ctrl+K` | Global search |
| `Ctrl+1–5` | Dashboard · Companies · Tracker · Reports · Global Log |
| `Ctrl+,` | Settings |
| `Ctrl+L` | Lock session |
| `↑↑↓↓←→←→BA↵` | ??? (profile selector only) |

The full list lives in Settings → Shortcuts.

---

## Where your data lives

```
%APPDATA%\conquered-time\conquered-data\profiles\<username>\
  vault.db               - encrypted SQLite database
  backups\               - dated backups + pre-action safety snapshots
  profile-manifest.json  - profile metadata (display name, avatar, auth methods)
```

The app makes **no outbound network requests** in normal use (fonts are bundled; the only network touchpoints are the ones you configure: SMTP report sending and the GitHub Releases update check).

### Security model

```
Login: password + TOTP code
         |
    PBKDF2 (310,000 iterations, SHA-256)
         |
    32-byte AES-256-GCM key (memory only)
         |
    Decrypts companies, time entries, profile, invoices on access
    Cleared on lock or app close
```

---

## Community

The beta runs through a private Discord: beta keys (`/betakey`), bug reports (`/bug`), feedback (`/feedback`), and release announcements. The community bot is private operational tooling maintained outside this repository.

---

## Development

You do **not** need to build from source to use the app — installers are on the Releases page. This section is for working on the code.

- **Stack:** Electron 29 · sql.js (pure WASM SQLite, no native deps) · TypeScript (strict main process compiled to `dist-main/`; renderer pages TS → sibling `.js`, no bundler) · speakeasy · bcryptjs · nodemailer · electron-builder
- **Node v20.11.1** via NVM for Windows is required (v24 breaks Electron prebuilds)

```bash
npm install       # once
npm run seed      # dev vault with stress fixture (devuser / devpass123, TOTP bypassed)
npm run dev       # compile + launch in dev mode
npm test          # node --test suites + typecheck (unit + fast-check property tests)
```

Tests cover the security-critical paths (vault crypto round-trips, all-or-nothing re-encryption, read-cache isolation, beta keys) plus a differential audit oracle over randomized vaults; `npm run coverage:critical` prints a scoped c8 report.

Releases are cut with `npm run release` (electron-builder → GitHub Releases, needs `GH_TOKEN`), which feeds the in-app auto-updater. `CLAUDE.md` holds the full architecture context and gotchas; `android/` is a backburnered native companion viewer (see its README).

---

*Conquered Time — Built for remote professionals who take their work seriously.*
