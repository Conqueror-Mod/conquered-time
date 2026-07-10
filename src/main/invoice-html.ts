'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  invoice-html.ts — pure invoice compute + PDF-HTML builder.
//
//  Phase 2 of the invoicing feature (docs/PLAN-invoicing.md). Electron-free and
//  unit-testable (test/invoice-html.test.js), mirroring report-html.ts.
//
//  Two exports do the work:
//    • computeInvoice()  — turns scoped time entries + a rate into per-day line
//      items and the subtotal/tax/total. This is the number-crunching the ledger
//      (Phase 3) freezes into an issued invoice's snapshot, so it lives apart
//      from rendering and is tested independently.
//    • buildInvoiceHTML() — renders a branded, print-safe invoice document from
//      a fully-resolved invoice object (computed numbers + parties + metadata).
//      The caller injects Inter @font-face CSS (base64) exactly as the report
//      export does.
//
//  Money: exact decimal hours (minutes/60, 2dp) × rate, rounded per line so the
//  line amounts always sum to the subtotal a client will re-add by hand. NavIDs
//  never appear on an invoice (project rule).
// ════════════════════════════════════════════════════════════════════════════

interface InvoiceEntry {
  company_id?: number | string;
  log_date?: string;
  total_mins?: number;
}

interface LineItem {
  date: string;
  minutes: number;
  hours: number;
  rate: number;
  amount: number;
}

interface ComputeInput {
  /** Scoped entries for one company + date range (plaintext aggregate cols are
   *  enough — no rows_json decryption needed; total_mins is the billable total). */
  entries: InvoiceEntry[];
  /** Hourly billing rate. */
  rate: number;
  /** Tax rate as a percentage (0 = no tax). */
  taxRate?: number;
}

interface ComputedInvoice {
  lineItems: LineItem[];
  totalMinutes: number;
  totalHours: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Aggregate entries into one per-day line item and roll up the money. */
function computeInvoice(input: ComputeInput): ComputedInvoice {
  const rate = Number(input.rate) || 0;
  const taxRate = Number(input.taxRate) || 0;

  const byDate: Record<string, number> = {};
  for (const e of input.entries || []) {
    const mins = Number(e.total_mins || 0);
    if (mins <= 0) continue;              // skip empty/zero days
    const d = e.log_date || '';
    byDate[d] = (byDate[d] || 0) + mins;
  }

  const lineItems: LineItem[] = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => {
      const hours = round2(minutes / 60);
      return { date, minutes, hours, rate, amount: round2(hours * rate) };
    });

  const totalMinutes = lineItems.reduce((s, li) => s + li.minutes, 0);
  // Subtotal is the sum of the (already-rounded) line amounts so the printed
  // lines always add up to it — clients re-check this arithmetic.
  const subtotal = round2(lineItems.reduce((s, li) => s + li.amount, 0));
  const taxAmount = round2((subtotal * taxRate) / 100);
  const total = round2(subtotal + taxAmount);

  return { lineItems, totalMinutes, totalHours: round2(totalMinutes / 60), subtotal, taxRate, taxAmount, total };
}

/** issueDate (YYYY-MM-DD) + netDays → due date (YYYY-MM-DD). UTC math only. */
function computeDueDate(issueDate: string, netDays: number): string {
  const d = new Date(`${issueDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return issueDate;
  d.setUTCDate(d.getUTCDate() + (Number(netDays) || 0));
  return d.toISOString().slice(0, 10);
}

/** Format a money amount in the given ISO currency; falls back to "CODE 0.00". */
function formatMoney(amount: number, currency: string): string {
  const code = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount) || 0);
  } catch {
    return `${code} ${(Number(amount) || 0).toFixed(2)}`;
  }
}

function escapeHtml(v: unknown): string {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Preserve author line breaks in address / instruction blocks after escaping.
function nl2br(v: unknown): string {
  return escapeHtml(v).replace(/\n/g, '<br>');
}

interface Party {
  name?: string;
  address?: string;
  email?: string;
  taxId?: string;
  paymentInstructions?: string;
}

interface InvoiceDoc {
  /** Frozen snapshots issued by ipc/invoices.ts store this as `number`; the
   *  builder tolerates both keys (see the buildInvoiceHTML normalization). */
  invoiceNumber?: string;
  number?: string;
  issueDate: string;
  dueDate?: string;
  /** Display label for terms, e.g. "Net 30" or "Due on receipt". */
  terms?: string;
  periodFrom: string;
  periodTo: string;
  currency: string;
  billFrom: Party;
  billTo: Party;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string;
  /** Optional @font-face CSS (Inter base64) injected into the document. */
  fontCss?: string;
}

const HOURGLASS_SVG =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M6 2h12v2.5c0 2.6-2.1 4.8-4.2 6.6l-1 .9 1 .9c2.1 1.8 4.2 4 4.2 6.6V22H6v-2.5c0-2.6 2.1-4.8 4.2-6.6l1-.9-1-.9C8.1 9.3 6 7.1 6 4.5V2z" ' +
  'stroke="#0d9488" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M8.5 19.5c.7-1.9 2-3.1 3.5-3.1s2.8 1.2 3.5 3.1z" fill="#0d9488"/></svg>';

/** Render a branded, print-safe invoice HTML document. */
function buildInvoiceHTML(doc: InvoiceDoc): string {
  const cur = doc.currency || 'USD';
  const money = (n: number) => escapeHtml(formatMoney(n, cur));
  // Issued snapshots carry the number under `number`; the live preview/tests use
  // `invoiceNumber`. Accept either so exported/emailed PDFs never render blank.
  const invNo = doc.invoiceNumber || doc.number || '';

  const lineRows = doc.lineItems.length
    ? doc.lineItems.map((li) =>
        `<tr><td class="mono">${escapeHtml(li.date)}</td>` +
        `<td class="num mono">${li.hours.toFixed(2)}</td>` +
        `<td class="num mono">${money(li.rate)}</td>` +
        `<td class="num mono">${money(li.amount)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No billable time in this period.</td></tr>';

  const taxRow = doc.taxRate > 0
    ? `<tr><td class="tk">Tax (${escapeHtml(String(doc.taxRate))}%)</td><td class="num mono">${money(doc.taxAmount)}</td></tr>`
    : '';

  const fromBits = [
    doc.billFrom.address ? `<div class="addr">${nl2br(doc.billFrom.address)}</div>` : '',
    doc.billFrom.email ? `<div class="addr">${escapeHtml(doc.billFrom.email)}</div>` : '',
    doc.billFrom.taxId ? `<div class="addr">Tax ID: ${escapeHtml(doc.billFrom.taxId)}</div>` : '',
  ].join('');
  const toBits = [
    doc.billTo.address ? `<div class="addr">${nl2br(doc.billTo.address)}</div>` : '',
  ].join('');

  const dueLine = doc.dueDate
    ? `<div><span class="mk">Due</span><span class="mv mono">${escapeHtml(doc.dueDate)}${doc.terms ? ` · ${escapeHtml(doc.terms)}` : ''}</span></div>`
    : (doc.terms ? `<div><span class="mk">Terms</span><span class="mv">${escapeHtml(doc.terms)}</span></div>` : '');

  const payBlock = doc.billFrom.paymentInstructions
    ? `<div class="pay"><div class="pay-h">Payment Instructions</div><div>${nl2br(doc.billFrom.paymentInstructions)}</div></div>`
    : '';
  const notesBlock = doc.notes
    ? `<div class="pay"><div class="pay-h">Notes</div><div>${nl2br(doc.notes)}</div></div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(invNo)}</title>
<style>
${doc.fontCss || ''}
:root{color-scheme:light;}
*{box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:12px;color:#1f2937;margin:0;padding:44px 48px;max-width:860px;margin:0 auto;background:#fff;}
.mono{font-variant-numeric:tabular-nums;}
.brand{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:3px solid #0d9488;}
.brand-left{display:flex;align-items:center;gap:10px;}
.wordmark{font-size:15px;font-weight:600;letter-spacing:3px;color:#0f172a;}
.wordmark span{color:#0d9488;}
.doc-title{text-align:right;}
.doc-title h1{font-size:22px;font-weight:600;margin:0;color:#0f172a;letter-spacing:1px;}
.doc-title .num{font-size:12px;color:#64748b;margin-top:2px;}
.parties{display:flex;justify-content:space-between;gap:24px;margin:24px 0 6px;}
.party{flex:1;}
.party .lbl{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:#0d9488;font-weight:600;margin-bottom:5px;}
.party .who{font-size:14px;font-weight:600;color:#0f172a;}
.party .addr{font-size:11px;color:#475569;margin-top:2px;line-height:1.5;}
.meta{min-width:220px;}
.meta>div{display:flex;justify-content:space-between;gap:16px;padding:3px 0;font-size:11.5px;}
.meta .mk{color:#64748b;}
.meta .mv{font-weight:600;color:#0f172a;}
table{width:100%;border-collapse:collapse;margin-top:22px;}
th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#475569;border-bottom:2px solid #0d9488;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11.5px;}
.num{text-align:right;}th.num{text-align:right;}
.empty{color:#94a3b8;text-align:center;padding:16px;}
.totals{margin-top:14px;margin-left:auto;width:300px;}
.totals table{margin:0;}
.totals td{border:none;padding:5px 10px;}
.totals .tk{color:#64748b;}
.totals tr.grand td{font-size:15px;font-weight:700;color:#0f172a;border-top:2px solid #0d9488;padding-top:9px;}
.pay{margin-top:26px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;color:#475569;line-height:1.5;}
.pay-h{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:#0d9488;font-weight:600;margin-bottom:4px;}
.footer{margin-top:36px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9.5px;color:#94a3b8;}
</style></head><body>
<div class="brand">
  <div class="brand-left">${HOURGLASS_SVG}<div class="wordmark">CONQUERED <span>TIME</span></div></div>
  <div class="doc-title"><h1>INVOICE</h1><div class="num mono">${escapeHtml(invNo)}</div></div>
</div>
<div class="parties">
  <div class="party">
    <div class="lbl">From</div>
    <div class="who">${escapeHtml(doc.billFrom.name || '—')}</div>
    ${fromBits}
  </div>
  <div class="party">
    <div class="lbl">Bill To</div>
    <div class="who">${escapeHtml(doc.billTo.name || '—')}</div>
    ${toBits}
  </div>
  <div class="party meta">
    <div><span class="mk">Invoice #</span><span class="mv mono">${escapeHtml(invNo)}</span></div>
    <div><span class="mk">Issued</span><span class="mv mono">${escapeHtml(doc.issueDate)}</span></div>
    ${dueLine}
    <div><span class="mk">Period</span><span class="mv mono">${escapeHtml(doc.periodFrom)} → ${escapeHtml(doc.periodTo)}</span></div>
  </div>
</div>
<table><thead><tr><th>Date</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
<tbody>${lineRows}</tbody></table>
<div class="totals"><table><tbody>
  <tr><td class="tk">Subtotal</td><td class="num mono">${money(doc.subtotal)}</td></tr>
  ${taxRow}
  <tr class="grand"><td>Total Due</td><td class="num mono">${money(doc.total)}</td></tr>
</tbody></table></div>
${payBlock}
${notesBlock}
<div class="footer">
  <span>Generated by Conquered Time · ${escapeHtml(new Date().toLocaleDateString())}</span>
  <span>Thank you for your business</span>
</div>
</body></html>`;
}

module.exports = { computeInvoice, computeDueDate, formatMoney, buildInvoiceHTML, round2 };
