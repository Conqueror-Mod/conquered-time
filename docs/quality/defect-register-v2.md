# Defect Register — Stress Campaign v2 (2026-07-16)

Scope: everything shipped after v3.10.0 — invoicing (3.16), updater UX (3.17/3.18),
Company Galaxy + fly-through + colors (3.20/3.23), tray punch + hotkey, data safety
net, week view (3.21), unified audit, Shortcuts, Insights (3.22), context menus,
dashboard stats (3.23), CSV import, global search, empty states (3.24).

Method: baseline suite (212/212 green) → adversarial unit probes on the new pure
modules → live UI stress via the run-app driver against seed v4 stress data
(XSS canary, unicode/emoji, overflow names, edge sessions).

## Defects

| ID | Sev | Surface | Defect | Verified how |
|----|-----|---------|--------|--------------|
| D-101 | High | CSV import (`import-parse.js normalizeDate`) | Impossible calendar dates accepted: `2/31/2025` → `2025-02-31`, `2025-02-30`, `4/31/2025` all pass validation. Committed end-to-end to the vault (`sessionsCreated:2` with a Feb-31 date, zero errors shown to the user). Downstream: Global Log displays it; Insights `parseLocalDate` silently rolls it into March (wrong bucket); string-compare range filters behave inconsistently around it. | Unit probe P1 + live `import:commit` on the dev vault |
| D-102 | High | Insights (`insights-compute.js trendBuckets`) | Gap-fill between first and last bucket is unbounded. One typo'd year (`12/31/9999`, accepted by D-101's validator; or `0209` for 2019) → **416,115 weekly buckets, 1.4 s compute** before the chart even renders; monthly mode 21,793 buckets. Renderer hang/garbage chart. | Node probe with `{2025-01-06, 9999-12-31}` entries |
| D-103 | Low | CSV import (`buildEntries`) | Explicit `Duration (mins)` column is unbounded: `1000000000` accepted silently → one row claiming ~1,900 years, poisoning totals/insights/invoices. Negative values are correctly floored to 0; only the upper bound is missing. | Unit probe P5 |
| D-104 | Low (DX) | `main.ts` single-instance lock | `if (!gotLock) { app.quit(); }` is completely silent. A `--dev` launch while the **installed** app is running (e.g. sitting in the tray) exits instantly with code 0 and no diagnostic — cost real debugging time this campaign; will cost any future driver run the same. | Reproduced: driver "Process failed to launch" until the installed app was closed |

## Verified clean (no defect found)

- **XSS canary**: escaped everywhere probed — global search results, dashboard
  Recent Activity, Global Log, galaxy labels. `document.title` never fired.
- **Unicode/emoji** (`Café Müller 東京 🚀`): search, insights donuts, invoices,
  recent activity all render correctly.
- **Global search (Ctrl+K)**: opens over any page, hostile + unicode queries fine.
- **Import dedup**: re-running the same commit → `sessionsSkipped`, zero doubles;
  within-file duplicate companies collapse to one via the live name map.
- **Invoicing**: `computeInvoice` tolerant of junk numbers; `buildInvoiceHTML`
  escapes every interpolation; ledger context menu correct (status-gated items).
- **Punch engine** (`punch.ts`): locked/no-history/midnight-wrap/auto-stop paths
  all correct by inspection; field-verified at release.
- **Week view band, dashboard stats, empty states, context menus** (Global Log /
  invoices / companies): render and dispatch correctly against stress data.
- **Import commit safety**: safety snapshot taken pre-write; `import:commit`
  correctly rejects an unauthenticated call.

## Fix plan (this campaign)

1. **C1 — Import date/duration validation** (D-101 + D-103): real-calendar check +
   sane year window (1970–2100) in `normalizeDate`; reject per-row durations
   > 1440 min with a row error. Unit tests for each rejected shape.
2. **C2 — Insights bucket cap** (D-102): cap `trendBuckets` gap-fill (~10 years);
   beyond the cap, emit only non-empty buckets (no fill). Unit test with the
   year-9999 fixture.
3. **C3 — Loud lock exit** (D-104): log a one-line reason to stderr before the
   second-instance `app.quit()`.
