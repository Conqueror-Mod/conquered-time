# Conquered Time — Roadmap

This is the living roadmap for Conquered Time. It's the single source of truth
for what's shipped, what's being built, and what's on deck — the community
Discord's **#roadmap** channel mirrors this file automatically.

**Status legend:** ✅ Shipped · 🔨 In progress · 🗓️ Planned · 💡 Under consideration

_Last curated: 2026-07-10_

## 🔨 In progress

- **Billable rates & invoicing** — turning the hours you already track into
  client invoices. Set an hourly rate and currency per company, add your
  business "bill-from" details, then generate numbered invoice PDFs for a
  company + date range with per-day line items, optional tax, payment terms, and
  a running paid/unpaid ledger. **Now building:** the billing setup — per-company
  rate/currency, client billing address, and your business details on the
  Profile page — is the first piece landing. The invoice generator + ledger
  follow.

## 🗓️ Planned (next up)

- **Company search / filter** — a search box on the Companies tab to filter the
  list and spiderweb as you type; grows unwieldy past a handful of companies.
  _(First community feature request — thank you!)_
- **Analytics & insights dashboard** — put the captured time series to work: an
  hours-over-time trend, per-company distribution, busiest days, and task-label
  breakdowns, so the dashboard shows insight, not just identity.
- **Proactive punch detection** — catch a forgotten running punch *before* it
  becomes an audit issue: a gentle idle-based prompt ("still working?") that
  offers to trim or close the session.
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
