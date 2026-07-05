# DEV_NOTES.md

Quick-reference companion to `CLAUDE.md`. Read `CLAUDE.md` first for full context — this file is for fast lookup while actively coding.

---

## Setup From Scratch

```bash
# 1. Install Node 20.11.1 via nvm-windows (required — Node 24 breaks Electron)
nvm install 20.11.1
nvm use 20.11.1
node --version    # confirm v20.11.1

# 2. Install deps
cd conquered-time
npm install

# 3. Seed a dev account (wipes dev-data/, creates devuser/devpass123, dev_mode=1;
#    v4.0 stress fixture: 10 companies + 103 entries incl. a 6-discrepancy audit
#    session (fixture-wide audit total = 7), unicode/emoji/XSS-canary companies,
#    edge-probe entries; prints a self-check ledger + verification packet)
npm run seed

# 4. Launch
npm start
```

If `npm start` throws `Electron failed to install correctly`:
```bash
rmdir /s /q node_modules\electron
npm install
```

To wipe all local data and start completely fresh:
```bash
rmdir /s /q "%APPDATA%\conquered-time"
```

---

## Dev Login (after `npm run seed`)

| Field | Value |
|---|---|
| Username | `devuser` |
| Password | `devpass123` |
| TOTP | leave blank — `dev_mode=1` bypasses it |

The TOTP bypass is gated on `IS_DEV && user.dev_mode` (so it can't work in a packaged build). The old hidden grid backdoor / `Ctrl+Shift+D` overlay were removed in session 9 — they no longer exist.

---

## Build for Distribution

```bash
npm run build
```
Output: `dist/Conquered Time Setup <version>.exe` (NSIS installer). `npm run build` runs `npm run compile` (both TS projects) first. `IS_DEV` is `--dev && !app.isPackaged`, so a packaged build ignores `--dev` and never enters the dev-data sandbox or honors `dev_mode`.

**Cutting a release:** bump `package.json` + `package-lock.json` + `version.json` (the last is what in-app *Check for Updates* reads) and add a `CHANGELOG` entry in `src/renderer/components/about.js`. Then `npm run build` and publish a GitHub Release with the `.exe` attached (`gh release create v<x.y.z> "dist/Conquered Time Setup <x.y.z>.exe" ...`). Installer bitmaps are regenerated with `node scripts/gen-installer-art.mjs` when brand art changes.

---

## Beta Keys & Discord Bot

- **Beta gate** (`src/main/ipc/auth.ts` + `beta-keys.js`): new installs must redeem a key before setup. Gate is required only when `!IS_DEV && secret present && no profiles && no valid stored key`. A redeemed key lives in `<ROOT_DATA_DIR>/app-prefs.json` under `betaKey`. Signing secret is `src/shared/beta-secret.js` (gitignored; gate fails **open** if absent). Mint with `node scripts/gen-beta-key.mjs --expires YYYY-MM-DD`. Full scheme: `src/shared/BETA-KEYS.md`.
- **Community bot** (private — NOT in this repo; `discord-bot/` is gitignored and lives only on the host machine): reuses `beta-keys.js` + the same secret so keys validate byte-for-byte. Commands `/betakey /mintkeys /bug /feedback /version /help /faq`; welcome/roles (screening-aware); GitHub release announcements. Runs 24/7 under pm2; setup/hosting notes live in the bot's own README on the host.
- **Clear a tester's key:** delete `%APPDATA%\conquered-time\conquered-data\app-prefs.json` (or just its `betaKey` entry). An uninstall does NOT remove it — user data is intentionally left behind.

---

## File-to-Concern Map

| If you're touching... | Read this gotcha first |
|---|---|
| Any DB query in `src/main/db.ts` / `ipc/*` | #1 — always `rowid`, never trust `id` |
| Anything involving `session.key` / encryption | #2 — TOTP must never touch key derivation |
| `package.json` deps | #3 — no native-compiled packages |
| Spiderweb canvas in `dashboard.ts` / `companies.ts` | #4 — `ResizeObserver`, recalc center live; also runs collision resolution so nodes never overlap (update BOTH files — engine is duplicated) |
| `design-system.css` scale rules | #5 — `zoom` on `#main-content` only |
| `entries:save` in `ipc/entries.ts` or `saveSession()` in `tracker.ts` | #6 — must return/capture new row ID |
| Any time input/display | #7 — internal format always 24h `HH:MM` |
| Adding a button/input to any inner page | Wire via `addEventListener` after `Shell.init()`, never inline `onclick` in static HTML |

(Full explanations of each gotcha are in `CLAUDE.md` → "Known Architecture Gotchas")

**Note:** the TypeScript refactor is complete — the main process is `.ts` under `src/main/` (compiled to `dist-main/`), IPC handlers live in `src/main/ipc/*.ts`, and renderer pages are `.ts` compiled to sibling `.js`. The hand-written `shell.js` / `login.js` / `settings.js` / `about.js` stay JSDoc-typed JS by design.

---

## IPC Channel Cheat Sheet

```js
// Renderer side (after preload.ts whitelist)
await api.invoke('auth:check-setup')
await api.invoke('auth:setup', { username, password, totpSecret, totpCode, recoveryCode })
await api.invoke('auth:login', { username, password, totpCode })
await api.invoke('auth:recover', { username, recoveryCode })
await api.invoke('totp:generate')                     // -> { secret, qrUrl }
await api.invoke('session:get')                        // -> { id, username } | null
await api.invoke('companies:list')                      // -> Company[]
await api.invoke('companies:save', companyData)         // -> { ok, id? }
await api.invoke('companies:delete', id)
await api.invoke('entries:list', companyId)              // -> Entry[]
await api.invoke('entries:save', entryData)              // -> { ok, id? }  <- capture id!
await api.invoke('entries:all')                          // -> Entry[]
await api.invoke('settings:get', key)
await api.invoke('settings:set', { key, value })

api.send('win:minimize' | 'win:maximize' | 'win:close')
api.send('navigate', 'dashboard' | 'companies' | 'tracker' | 'task-timer' | 'global-log' | 'reports' | 'profile' | 'login')

// App-behavior settings (app-global, not per-profile vault):
await api.invoke('win:get-launch-at-startup')          // OS login item is source of truth
await api.invoke('win:set-launch-at-startup', bool)
await api.invoke('win:get-close-to-tray')              // <ROOT_DATA_DIR>/app-prefs.json
await api.invoke('win:set-close-to-tray', bool)

api.on('toast', ({ msg, type }) => {...})
api.on('menu:export-pdf', () => {...})
api.on('menu:export-csv', () => {...})
```

To add a new channel: whitelist it in `src/main/preload.ts`'s `ALLOWED_INVOKE`/`ALLOWED_SEND`/`ALLOWED_RECEIVE` sets, add its type to the `IpcInvokeMap` in `types/globals.d.ts`, and implement the handler in the relevant `src/main/ipc/*.ts` module (`register(ctx)`).

---

## Page Lifecycle Pattern (copy this for any new page)

```js
window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('pageName');     // injects titlebar/sidebar, loads settings — MUST be awaited first
  // NOW wire all interactive elements — never inline onclick in the HTML above
  document.getElementById('some-btn').addEventListener('click', someHandler);
  // ...fetch data, render, etc.
});
```

`Shell.init()` does `document.body.innerHTML = ...` internally to wrap the page's existing content with the shell. Any event listeners attached via inline HTML attributes before this point are destroyed. This has caused real bugs in this project — see gotcha in `CLAUDE.md`.

---

## Theme System Quick Reference

5 Final Fantasy themes via `document.documentElement.setAttribute('data-theme', 'memoria'|'zanarkand'|'rabanastre'|'treno'|'nibelheim')`, applied by `settings.js`'s `apply()`. **Default is `memoria`** (settings.js). The splash always uses `zanarkand` as a brand moment. All theme tokens are CSS custom properties defined once per `[data-theme="x"]` block in `themes.css` (imported by `design-system.css`) — components reference `var(--accent)`, `var(--surface-1)`, etc., never hardcoded colors, so new themes drop in cleanly.

Canvas-drawn elements (spiderweb nodes) **cannot** use CSS variables directly — they read the active theme via `document.documentElement.getAttribute('data-theme')` and branch through a local `getCanvasColors()` helper (duplicated in both `dashboard.js` and `companies.js` — if you change node colors, update both places).

Typography rule: **DM Sans** (`var(--sans)`) for all UI text, **JetBrains Mono** (`var(--mono)`) only for data values (timestamps/durations/IDs/numbers). Inter is used **only** for PDF export (base64-inlined). Don't violate this — it was a deliberate full-project fix after user feedback that all-mono was unreadable.

---

## Things The User Has Explicitly Rejected (don't re-propose without new reasoning)

- Sidebar-embedded settings panel (wants centered modal instead) ✅ already built correctly
- `font-size`-based UI scaling (didn't actually scale anything visually — switched to `zoom`)
- `better-sqlite3` (native compilation requirement)
- Deriving encryption keys from TOTP
- (Historical, pre-FF-rename theme experiments — all superseded by the current 5 Final Fantasy themes; don't resurrect the old names: "Ember" amber/orange "ugly", "Dusk" violet "derivative", an earlier all-white "Paper" "too blinding". The old Slate/Void/Arctic/Paper/Quartz set no longer exists.)
- Light-theme polish / theme reordering / ASCII-egg redesign — dropped as irrelevant (2026-06-29); do not reintroduce as open items

---

## PPI / Privacy Reminder

A real personal Navigator ID (`D406943`) leaked into example data/docs multiple times during development before being fully scrubbed. **Always use obviously-fake placeholders** (`A123456`, `X192847`, etc.) in any new example code, seed data, or documentation. Never use real names, IDs, or company-identifying info as placeholder content anywhere in this repo.
