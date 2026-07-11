# Conquered Time — Roadmap

This is the living roadmap for Conquered Time. It's the single source of truth
for what's shipped, what's being built, and what's on deck — the community
Discord's **#roadmap** channel mirrors this file automatically.

**Status legend:** ✅ Shipped · 🔨 In progress · 🗓️ Planned · 💡 Under consideration

_Last curated: 2026-07-11 (v3.19.1)_

## 🗓️ Planned (next up)

- _Nothing queued — the planned list is fully shipped as of v3.19. Community
  suggestions decide what lands here next._

## 💡 Under consideration

- **Multi-platform packaging** — macOS and Linux builds via GitHub Actions CI
  (icons are already prepared). On the backburner while feature work leads.
- **Global search** — a shell-wide omnibox (⌘/Ctrl+K) that jumps to companies
  and entries across pages, beyond the per-tab Companies filter above.
- **Multi-account (DBA) handling** — one person working several Navigator IDs /
  accounts; needs a data-model and UI decision before any build.
- **Language / internationalization** — lowest priority, highest complexity;
  slated for last.

## ✅ Recently shipped

- **Profile placement** (v3.19.1) — Profile left the navigation bar and now
  lives behind your avatar (bottom-left; click → Edit Profile) and under
  Settings → Profile. _(Community suggestion — thank you!)_ Shipped with setup-guide
  polish (avatar-anchored Profile step with billing guidance, a new Insights
  step, smooth step transitions) and a multi-monitor fix: the audit wizard and
  startup splash now open on the monitor the app is actually on.
- **Insights dashboard** (v3.19) — a new analytics page: hours trends over time
  (with a moving-average line), busiest days & times, client mix, and estimated
  earnings from each client's billing rate, across 30-day / 90-day / 1-year /
  all-time ranges.
- **Company search & filters** (v3.19) — live search across names, projects and
  roles on the Companies page, plus Active/Ended and work-type filters; the
  company web dims non-matching companies so the graph follows your filter.
  _(First community feature request — thank you!)_
- **Redesigned exports** (v3.19) — the tracker and Global Log PDF timesheets now
  carry the same branded look as the emailed reports (summary band, label
  breakdown), and the Global Log CSV ends with a totals summary. Also: larger,
  easier-to-notice toast notifications, and two save paths hardened against
  silently overwriting newer data.
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
