# Conquered Time — Roadmap

This is the living roadmap for Conquered Time. It's the single source of truth
for what's shipped, what's being built, and what's on deck — the community
Discord's **#roadmap** channel mirrors this file automatically.

**Status legend:** ✅ Shipped · 🔨 In progress · 🗓️ Planned · 💡 Under consideration

_Last curated: 2026-07-10_

## 🗓️ Planned (next up)

- **Company search / filter** — a search box on the Companies tab to filter the
  list and spiderweb as you type; grows unwieldy past a handful of companies.
  _(First community feature request — thank you!)_
- **Analytics & insights dashboard** — put the captured time series to work: an
  hours-over-time trend, per-company distribution, busiest days, and task-label
  breakdowns, so the dashboard shows insight, not just identity.
- **Report redesign** — the emailed CSV and PDF report layouts get a proper
  redesign (not just fixes), based on beta feedback.

## 💡 Under consideration

- **Multi-platform packaging** — macOS and Linux builds via GitHub Actions CI
  (icons are already prepared). On the backburner while feature work leads.
- **Global search** — a shell-wide omnibox (⌘/Ctrl+K) that jumps to companies
  and entries across pages, beyond the per-tab Companies filter above.
- **Profile placement** — making the Profile screen less prominent / more
  tucked-away once an account is set up, without burying the settings that
  actually get revisited (Work State, break style). _(Community suggestion.)_
- **Multi-account (DBA) handling** — one person working several Navigator IDs /
  accounts; needs a data-model and UI decision before any build.
- **Language / internationalization** — lowest priority, highest complexity;
  slated for last.

## ✅ Recently shipped

- **Proactive punch reminder** (v3.18) — leave a session running and step away,
  and Conquered Time nudges you to trim or close the punch *before* it becomes
  an audit issue. Opt-in under Settings → Security → Idle Punch Reminder; the
  prompt offers to clock out at the time you actually went idle, clock out now,
  or keep working — it never punches for you.
- **Automatic updates** (v3.17, refined v3.18.1) — the app checks GitHub
  Releases for new versions, downloads the update in the background with a
  progress bar, and installs on restart (check anytime under Settings → About →
  Updates). An available update now shows a clear one-click notice on the
  sign-in screen and in-app, and a completed update is confirmed on next launch.
  First shipped alongside fixes for the invoice-PDF number, the active-session
  timer starting a few seconds in, and a stray window on Windows auto-launch.
- **Billable rates & invoicing** (v3.16) — turn tracked hours into client
  invoices: pick a company + date range, preview, and issue a numbered invoice
  with per-day line items, optional tax, and payment terms. Set a rate/currency
  per company and your business "Bill From" details on the Profile page. Issued
  invoices live in a paid/unpaid ledger you can save as a branded PDF or email
  to the client.
- **Community roadmap channel** — this roadmap, auto-synced from the repo into
  the Discord so testers always see where things stand.
- **Per-company scheduled reports** (v3.15) — schedule one combined report, one
  report per company, or a single company; optional per-company recipient
  override.
- **Pomodoro, tooltips & onboarding** (v3.13) — optional Pomodoro break style,
  hover tooltips across the app, and a first-run guided tour.
- **Tray & launch-at-startup** — system tray, close-to-tray, launch at login,
  and start-minimized.
- **Reports & auditing** — discrepancy detection, per-row dismiss/fix, login
  notice, and consent-gated email notifications.
- **Account recovery** — recovery-code password reset with full data
  re-encryption, plus pre-auth restore from a backup file.
- **Multi-user profiles** — per-user encrypted vaults with a profile-selector
  login and avatars.
- **Beta keys** — offline-verifiable early-access gating for new installs.

---

_Have an idea? Use `/feedback` in the Discord — the best suggestions land on this
roadmap._
