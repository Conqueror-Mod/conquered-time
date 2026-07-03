# Conquered Time — Beta Community Bot

A Discord bot for the Conquered Time beta server. It handles:

- **Beta keys** — `/betakey` gives a member their access key (one per user, delivered privately); `/mintkeys` (admin) bulk-mints keys for manual distribution. Keys are generated with the app's own `beta-keys.js` + shared secret, so they validate in the app byte-for-byte.
- **Welcome & roles** — greets new members and auto-assigns the Beta Tester role.
- **Bug & feedback intake** — `/bug` and `/feedback` post structured embeds to your triage channels.
- **Release announcements** — polls GitHub Releases and posts new versions to an announcements channel; `/version` shows the latest build on demand.

It reuses `../src/main/beta-keys.js` and the gitignored `../src/shared/beta-secret.js` directly — no reimplementation, no secret duplication.

---

## Prerequisites

- **Node 18+** (Node 20 recommended, matching the app).
- A Discord application + bot: https://discord.com/developers/applications
  - **Bot → Privileged Gateway Intents → Server Members Intent: ON** (required for welcome/roles).
- The app's signing secret at `../src/shared/beta-secret.js` (same file the app uses). Without it, the bot still runs but `/betakey` and `/mintkeys` are disabled.

## Setup

```bash
cd discord-bot
npm install
cp .env.example .env      # then fill in .env (see comments in that file)
```

Invite the bot to your server with the **applications.commands** and **bot** scopes, and permissions: Manage Roles, Send Messages, Embed Links. Make sure the bot's role is **above** the Beta Tester role in the role list (so it can assign it).

## Register slash commands

Run once (and again whenever commands change):

```bash
npm run deploy
```

Commands register to the single guild in `DISCORD_GUILD_ID`, so they appear instantly.

## Run

```bash
npm run dev     # watch mode (tsx), for development
# or
npm run build && npm start   # compiled, for production
```

## Running 24/7 with pm2

For always-on hosting on your own machine, run the **compiled** bot under [pm2](https://pm2.keymetrics.io/) (auto-restarts on crash, survives closing the terminal). An `ecosystem.config.cjs` is included.

```bash
cd discord-bot
npm run build                 # compile to dist/
npm install -g pm2            # once, globally
pm2 start ecosystem.config.cjs
pm2 save                      # remember the running process list
```

Start automatically at login (Windows — pm2's native `startup` isn't supported there):

```bash
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

Day-to-day:

```bash
pm2 status                    # is it running?
pm2 logs conquered-bot        # tail logs
pm2 restart conquered-bot     # after a rebuild
pm2 stop conquered-bot        # pause it
```

**After changing code:** `npm run build && pm2 restart conquered-bot`. **After changing commands:** also `npm run deploy`.

> ⚠️ Only run **one** instance. If you were running `npm run dev`, stop it (Ctrl+C) before starting pm2 — two copies online means the bot answers every command twice.

Any other always-on Node host works too (a VPS with systemd, Railway/Fly, etc.). It needs the `.env` and — for beta-key commands — access to `../src/shared/beta-secret.js`. State (who claimed a key, last-announced release) is stored in `discord-bot/data/` (gitignored).

## Private-repo note

During beta the repo is private, so GitHub's API returns **404** without auth. Set `GITHUB_TOKEN` in `.env` to a token with **Contents: Read-only** on the repo, and release announcements + `/version` will work. This is the access gap that broke the earlier attempt.

## Commands

| Command | Who | What |
|---|---|---|
| `/betakey` | members (optionally role-gated) | Get your beta key (one per user; DM + ephemeral) |
| `/mintkeys count:[1-50] [expiry]` | admins | Bulk-mint keys for manual handout |
| `/bug title description [version] [severity]` | members | File a bug report to the bug channel |
| `/feedback message [category]` | members | Send feedback to the feedback channel |
| `/version` | members | Show the latest released version + download |
