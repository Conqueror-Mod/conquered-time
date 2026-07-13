# Conquered Time — Roadmap

This is the living roadmap for Conquered Time. It's the single source of truth
for what's shipped, what's being built, and what's on deck — the community
Discord's **#roadmap** channel mirrors this file automatically.

**Status legend:** ✅ Shipped · 🔨 In progress · 🗓️ Planned · 💡 Under consideration

_Last curated: 2026-07-13 (v3.22.0 — Insights overhaul, Shortcuts tab, unified audit review — released)_

## 🗓️ Planned (next up)

- **Richer right-click menus** — grow the context menus across the app
  (the Galaxy ships the first wave: galaxy- and project-level menus with
  Edit Color and quick actions where you'd expect them).

### Polish pass (smaller items, mixed in between features)

- **Company colors everywhere** — the Web v2 identity hues carried through the
  whole app: color dots on Recent Activity, the Global Log, the invoice ledger,
  and Insights' client mix. _(Ships with Company Web v2.)_
- **Smarter dashboard stats** — the Today / This Week tiles gain deltas
  ("up 1.2h vs last week") and a 7-day micro-sparkline, so the numbers tell a
  story at a glance.
- **Interactive Insights** — hover values on every chart and click-through
  (click a client's bar to jump to its filtered Global Log).
- **UI Scale & responsiveness fixes** — live feedback while changing UI Scale
  in Settings, and layouts that adapt properly to unusual window shapes.
  _(Two known beta reports.)_
- **Branded empty states** — first-run screens (no companies, no sessions, no
  invoices yet) get a proper illustration and a clear call-to-action instead of
  plain text.

## 💡 Under consideration

- **Multi-platform packaging** — macOS and Linux builds via GitHub Actions CI
  (icons are already prepared). On the backburner while feature work leads.
- **Global search** — a shell-wide omnibox (⌘/Ctrl+K) that jumps to companies
  and entries across pages, beyond the per-tab Companies filter above.
- **Multi-account (DBA) handling** — one person working several Navigator IDs /
  accounts. _(The Company Galaxy's company › project › ID grouping covers the
  visual side of this; anything beyond that still needs a data-model decision.)_
- **Language / internationalization** — lowest priority, highest complexity;
  slated for last.

## ✅ Recently shipped

- **Insights overhaul** (v3.22.0) — Client Mix and Estimated Earnings are now
  donut charts colored per client (matching the company web), the bar charts
  have real depth, and hovering any chart shows the exact value.
- **Shortcuts tab** (v3.22.0) — a new Settings tab listing every keyboard
  shortcut in one place, with the global Clock In / Out hotkey rebindable there.
- **Unified audit review** (v3.22.0) — a single "Review Discrepancies" button
  replaces the separate Acknowledge and Suggest-fix flows; apply the suggested
  fix or acknowledge each issue in one window.
- **v3.21.1 (patch)** — the week view now starts on Sunday (Sun–Sat); the live
  session timer starts at 0:00 when you clock in from the tray or hotkey; clearer
  guidance on the Reports email app-password; plus profile-card and labelling polish.
- **Punch from the tray + global hotkey** (v3.21.0) — Clock In / Clock Out
  without opening the app. Right-click the tray icon to punch, or press the
  global hotkey (default Ctrl+Alt+P) from anywhere — it clocks in on your last
  task if you're out, clocks out if you're in, even while the app is hidden in
  the tray. Rebind or disable it under Settings → Window.
- **Week view** (v3.21.0) — see your week at a glance on the Dashboard: a
  seven-day band of session blocks (colored per company, sized by hours) with
  day totals and prev/next week paging — the "Tuesday was heavy, Thursday was
  empty" view. Click any block to jump straight to that session in the Tracker.
- **Data safety net** (v3.21.0) — your history is no longer one misclick from
  gone. Before any destructive action (deleting a company, clearing time data or
  companies, restoring a backup), Conquered Time now automatically saves a
  **protected safety snapshot** — kept separately from the routine autosave
  backups so a busy day can't prune it away, and marked with what it was taken
  before (🛡 "Company Delete", "Companies Clear", …) in the Backup Library. Plus
  a new **Export Vault** button saves a portable, still-encrypted copy of your
  whole vault anywhere you like — a USB stick, a cloud folder — and Full
  Database Clear now offers to export first before it wipes everything.
- **Company Galaxy** (v3.20.0) — the company web reimagined, twice over: it
  first became packed bubbles (sized by hours in a 30d / 90d / all-time window,
  harnessed so no client can drown the rest, idle and ended companies folding
  into an expandable **Archive** cluster, and per-company **identity colors**
  that fade as a client goes idle — with a colorblind-safe palette and a
  right-click color picker), and then went **hierarchical**: each company is a
  **galaxy** that opens into its **solar systems** (projects/platforms), which
  break down into their IDs and logins. Click to expand in place, click deeper
  to zoom (breadcrumb backs out), right-click for galaxy- and project-level
  menus. The company list gains matching company › project grouping, and the
  dashboard mini-web jumps you straight into a company's galaxy.
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
