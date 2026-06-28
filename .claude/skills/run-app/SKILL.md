---
name: run-app
description: Launch and drive the Conquered Time Electron app to confirm a change works in the real UI. Use when asked to run/start the app, screenshot it, or verify a fix end-to-end (login, tracker, global log, etc.) rather than just at the unit level.
---

Conquered Time is an Electron desktop app (vanilla HTML/CSS/JS per page, full
`loadFile()` navigation — not a SPA). The only way to truly "run" it for an
agent is to launch it under Playwright and drive the DOM. This skill provides a
REPL driver at `.claude/skills/run-app/driver.mjs`.

The host is **Windows with a real display — no xvfb needed.** The driver
launches with `--dev`, which skips the profile selector and loads
`dev-data/dev-vault.db` directly. The seeded `devuser` has `dev_mode=1`, so TOTP
is bypassed at login.

All paths below are relative to the repo root.

## Prerequisites

```bash
npm install            # if node_modules is missing
npm install --save-dev playwright-core   # only if not already a devDependency
npm run seed           # creates devuser/devpass123 + sample companies/entries (dev-data/, gitignored)
```

`npm run seed` resets the dev vault to a known state — run it before a verify run
so counts are predictable. It does NOT touch real profile data under
`conquered-data/`.

## Run (agent path)

```bash
node .claude/skills/run-app/driver.mjs
```

Then type commands at the `driver>` prompt. A full verification of the
historically-cursed autosave path (gotcha #6) is three lines:

```
launch
login
verify-cursed-path
```

Driving it programmatically (e.g. piping commands) — feed lines on stdin:

```bash
printf 'launch\nlogin\nverify-cursed-path\nss after\nquit\n' | node .claude/skills/run-app/driver.mjs
```

Screenshots land in `.tmp-shots/` (override with `SCREENSHOT_DIR`). `.tmp-shots/`
is throwaway — don't commit it.

### Commands

| command | what it does |
|---|---|
| `launch` | launch app with `--dev`, wait for the login screen |
| `login [user] [pass]` | log in (defaults `devuser` / `devpass123`); waits for dashboard |
| `nav <dest>` | navigate via app IPC: `dashboard`, `companies`, `tracker`, `global-log`, `reports`, `task-timer` |
| `ss [name]` | screenshot → `.tmp-shots/<name>.png` |
| `eval <expr>` | evaluate an async expression in the page, print JSON (e.g. `eval await api.invoke('entries:all')`) |
| `verify-cursed-path [companyValue]` | gotcha #6 check — 4 saves on one session must yield exactly 1 row |
| `url` / `windows` | print current URL / list windows |
| `quit` | close app and exit |

## Run (human path)

```bash
npm start          # opens a window against real profile data (no --dev)
npm run dev        # opens against the dev-data sandbox (--dev)
```

## What "verify-cursed-path" proves

Picks a company with no entry today, fills the task fields, then fires
`clockIn → saveSession → clockOut → saveSession` (4 save ops on ONE session) and
asserts exactly **one** new row appears in `entries:all`. This exercises both
fragile paths at once: rowid→id normalization (gotcha #1) and the INSERT→capture
`currentEntryId`→UPDATE autosave loop (gotcha #6). Historically this produced 4
duplicate sessions in the Global Log.

## Gotchas

- **Use `--dev`, not `npm start`,** when driving — otherwise you hit the profile
  selector and real-user vault, and TOTP is enforced. The driver always passes
  `--dev`.
- **A splash screen precedes login.** The driver waits on the `login` URL +
  `#login-username`, not `firstWindow()` content, so it rides through the splash.
- **Form fields aren't all text inputs** — `#input-label` is a `<select>`. Set
  selects via `value` + dispatch `change`, not `fill()`. The driver handles this
  inside `verify-cursed-path`; do the same in any custom `eval`.
- **`loadFile()` navigation** replaces the whole page; the Playwright `page`
  object follows the same window, so you keep using it across `nav`.
- **Counts depend on the seed.** If `verify-cursed-path` reports an unexpected
  delta, re-run `npm run seed` first — a company may already have today's entry,
  in which case saves correctly UPDATE it (delta 0) rather than insert.

## Troubleshooting

- **`Cannot find package 'playwright-core'`** — run from the repo root (so Node
  resolves the repo's `node_modules`), and ensure it's installed.
- **Launch timeout** — confirm `node_modules/electron/dist/electron.exe` exists
  (`node -e "console.log(require('electron'))"`).
- **Login never reaches dashboard** — the dev vault may be missing; run
  `npm run seed`.
