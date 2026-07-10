# PLAN — Billable Rates & Invoicing

Design confirmed with Chris 2026-07-10. Turns the hours Conquered Time already
tracks into client invoices. Design-first per project pattern; each phase is its
own PR, run-app verified, suite green.

## Confirmed decisions

- **Stored ledger** (not stateless) — a new encrypted `invoices` table records
  every issued invoice; enables an invoice history, paid/unpaid tracking, and a
  foundation for later revenue reporting / monetization.
- **Per-day line items** — one line per work day (date · hours · rate · amount).
  Hook left to add a "group by task label" per-invoice toggle later.
- **Optional tax + terms** — tax rate % (off by default; VAT/GST/sales) and net
  payment terms (Net 15/30/on-receipt → computed due date).
- **One invoice = one company + one date range.** Companies are separate clients.
- **Rate granularity: per-company only** for MVP (the Company › Project ›
  Platform hierarchy stores one company row per project, so this is already
  per-project). Per-task-label rate overrides deferred.
- **Currency:** profile default (default USD) + optional per-company override;
  formatted by ISO code, no live FX conversion.
- **UI:** a new top-level **Invoices** sidebar page (peer of Global Log), not
  buried under Reports.

## The critical principle — snapshot at issue

Issuing an invoice **freezes** its line items, rate, and totals into the ledger
row. Later edits to time entries or a company's rate MUST NOT mutate an
already-issued invoice. History stays correct and auditable. Preview is
stateless (recomputed live); only **Issue** persists a frozen snapshot.

## Flow

1. **Generate** — pick company + date range → live preview (no number yet),
   per-day hours from the same aggregation `report-html.ts` uses.
2. **Issue** — assign next number, freeze totals, save to ledger as **Unpaid**.
3. **Later** — Mark Paid (paid date) · Void · Re-download PDF · Email (reuse the
   scheduled-report SMTP path → company `report_email`, fallback default).

## Data model

- **Company blob** (+ fields): reuse the **existing `pay_rate`** (already wired
  in the modal as "Pay Rate ($/hr)", saved/loaded/shown as a chip) as the
  billing rate — do NOT add a parallel `rate` field. Add `billing_address`
  (multi-line) and optional `currency`.
- **Profile blob** (new "Billing" section = invoice "Bill From"): business name,
  address, email, optional tax ID, payment instructions, default currency.
- **`invoices` table** (encrypted blob per row, AES-256-GCM like `companies`):
  number, company_id + name snapshot, issue_date, due_date, period from/to,
  frozen line items, subtotal, tax_rate, tax_amount, total, currency, status
  (`unpaid`/`paid`/`void`), paid_date, notes.
- **`app_settings`:** invoice counter + prefix (default `INV-`, zero-padded),
  editable next-number.

## Phasing

1. **Data layer (this PR)** — company `rate`/`billing_address`/`currency` fields
   in the modal; profile Billing section; invoice counter + prefix settings.
   Form/persistence only, no invoice UI yet.
2. **Engine** — pure `src/main/invoice-html.ts` + compute (per-day lines, tax,
   terms, totals), unit-tested, mirroring `report-html.ts` + its test.
3. **Invoices page** ✅ — new `invoices` table + `ipc/invoices.ts` (context /
   preview / issue / list / get / set-status / save-pdf / email / counter); a
   top-level Invoices page with generate → preview → issue and a ledger (mark
   paid/unpaid/void, save PDF, email). Snapshot-at-issue enforced (frozen
   encrypted doc). PDF reuses email.ts `generatePDF`; email reuses the report
   SMTP path (`sendInvoiceEmail`) → company `report_email` fallback default.
4. **Polish** — seed fixture invoices ✅ (2 demo invoices + billing profile in
   the seed; fixture schema mirror + `insertInvoice`; self-check asserts
   `invoices.count`), version bump to **v3.16.0** ✅ (package.json, version.json,
   About changelog), README/CLAUDE.md docs ✅. **GitHub release cut is deferred**
   until the PDF-save-dialog + SMTP-email buttons get a real-app smoke test.

## Notes / open for later

- Per-task-label rate overrides.
- "Group by task label" invoice layout toggle.
- Recurring/auto invoices (parallels scheduled reports).
- Revenue dashboard (ties into the planned analytics work).
