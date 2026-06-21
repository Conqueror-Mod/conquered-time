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

# 3. Seed a dev account (wipes DB, creates devuser/devpass123, dev_mode=1, sample company+entry)
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

Or use the hidden grid backdoor sequence on the login screen (press `Ctrl+Shift+D` to reveal target cells, then click the 5 red-outlined cells in order D1→D5).

---

## Build for Distribution

```bash
npm run build
```
Output: `dist/Conquered Time Setup.exe` (NSIS installer, requires `assets/icon.ico` — not yet added as of this handoff).

---

## File-to-Concern Map

| If you're touching... | Read this gotcha first |
|---|---|
| Any DB query in `main.js` | #1 — always `rowid`, never trust `id` |
| Anything involving `sessionKey` / encryption | #2 — TOTP must never touch key derivation |
| `package.json` deps | #3 — no native-compiled packages |
| Spiderweb canvas in `dashboard.html` / `companies.html` | #4 — `ResizeObserver`, recalc center live |
| `design-system.css` scale rules | #5 — `zoom` on `#main-content` only |
| `entries:save` in `main.js` or `saveSession()` in `tracker.html` | #6 — must return/capture new row ID |
| Any time input/display | #7 — internal format always 24h `HH:MM` |
| Adding a button/input to any inner page | Wire via `addEventListener` after `Shell.init()`, never inline `onclick` in static HTML |

(Full explanations of each gotcha are in `CLAUDE.md` → "Known Architecture Gotchas")

---

## IPC Channel Cheat Sheet

```js
// Renderer side (after preload.js whitelist)
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
api.send('navigate', 'dashboard' | 'companies' | 'tracker' | 'global-log' | 'login')

api.on('toast', ({ msg, type }) => {...})
api.on('menu:export-pdf', () => {...})
api.on('menu:export-csv', () => {...})
```

To add a new channel: whitelist it in `src/main/preload.js`'s `ALLOWED_INVOKE`/`ALLOWED_SEND`/`ALLOWED_RECEIVE` sets, implement the handler in `src/main/main.js`.

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

5 themes via `document.documentElement.setAttribute('data-theme', 'arctic'|'slate'|'void'|'paper'|'quartz')`, applied by `settings.js`'s `apply()` function. All theme tokens are CSS custom properties defined once per `[data-theme="x"]` block in `design-system.css` — components should only ever reference `var(--accent)`, `var(--surface-1)`, etc., never hardcoded colors, so new themes drop in cleanly.

Canvas-drawn elements (spiderweb nodes) **cannot** use CSS variables directly — they read the active theme via `document.documentElement.getAttribute('data-theme')` and branch through a local `getCanvasColors()` helper (duplicated in both `dashboard.html` and `companies.html` — if you change node colors, update both places).

Typography rule: Inter (`var(--sans)`) for all UI text, Share Tech Mono (`var(--mono)`) only for data values (timestamps/durations/IDs/numbers). Don't violate this — it was a deliberate full-project fix after user feedback that all-mono was unreadable.

---

## Things The User Has Explicitly Rejected (don't re-propose without new reasoning)

- Sidebar-embedded settings panel (wants centered modal instead) ✅ already built correctly
- `font-size`-based UI scaling (didn't actually scale anything visually — switched to `zoom`)
- `better-sqlite3` (native compilation requirement)
- Deriving encryption keys from TOTP
- "Ember" (amber/orange) theme — called "ugly," replaced
- "Dusk" (violet) theme proposal — called "derivative," not built; Quartz used instead
- Pure-white Paper theme — too blinding, softened to blue-grey-white

---

## PPI / Privacy Reminder

A real personal Navigator ID (`D406943`) leaked into example data/docs multiple times during development before being fully scrubbed. **Always use obviously-fake placeholders** (`A123456`, `X192847`, etc.) in any new example code, seed data, or documentation. Never use real names, IDs, or company-identifying info as placeholder content anywhere in this repo.
