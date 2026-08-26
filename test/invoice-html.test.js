'use strict';

// Unit tests for the pure invoice engine (src/main/invoice-html.ts, compiled to
// dist-main). Covers the money math contract (per-day aggregation, per-line
// rounding that sums to the subtotal, tax, totals), due-date math, currency
// formatting fallback, and the branded HTML builder's escaping + optional
// sections.

const { test } = require('node:test');
const assert   = require('node:assert');
const {
  computeInvoice, computeDueDate, formatMoney, buildInvoiceHTML, round2,
} = require('../dist-main/main/invoice-html.js');

const entries = [
  { company_id: 1, log_date: '2026-07-02', total_mins: 390 }, // 6.50h
  { company_id: 1, log_date: '2026-07-03', total_mins: 480 }, // 8.00h
  { company_id: 1, log_date: '2026-07-03', total_mins: 30 },  // same day → 8.50h total
  { company_id: 1, log_date: '2026-07-05', total_mins: 255 }, // 4.25h
  { company_id: 1, log_date: '2026-07-06', total_mins: 0 },   // zero → skipped
];

test('computeInvoice: per-day aggregation, sorted, zero days skipped', () => {
  const inv = computeInvoice({ entries, rate: 40 });
  assert.strictEqual(inv.lineItems.length, 3);
  assert.deepStrictEqual(inv.lineItems.map(l => l.date), ['2026-07-02', '2026-07-03', '2026-07-05']);
  assert.deepStrictEqual(inv.lineItems.map(l => l.hours), [6.5, 8.5, 4.25]);
  assert.strictEqual(inv.totalMinutes, 1155);
  assert.strictEqual(inv.totalHours, 19.25);
});

test('computeInvoice: line amounts sum exactly to subtotal', () => {
  const inv = computeInvoice({ entries, rate: 40 });
  assert.deepStrictEqual(inv.lineItems.map(l => l.amount), [260, 340, 170]);
  const summed = round2(inv.lineItems.reduce((s, l) => s + l.amount, 0));
  assert.strictEqual(inv.subtotal, summed);
  assert.strictEqual(inv.subtotal, 770);
});

test('computeInvoice: tax and total', () => {
  const inv = computeInvoice({ entries, rate: 40, taxRate: 20 });
  assert.strictEqual(inv.subtotal, 770);
  assert.strictEqual(inv.taxAmount, 154);      // 20% of 770
  assert.strictEqual(inv.total, 924);
});

test('computeInvoice: no tax by default', () => {
  const inv = computeInvoice({ entries, rate: 40 });
  assert.strictEqual(inv.taxRate, 0);
  assert.strictEqual(inv.taxAmount, 0);
  assert.strictEqual(inv.total, inv.subtotal);
});

test('computeInvoice: fractional-hour rounding stays 2dp', () => {
  // 50 min = 0.833… h → 0.83; × 33.33 = 27.66 (rounded per line)
  const inv = computeInvoice({ entries: [{ log_date: '2026-07-01', total_mins: 50 }], rate: 33.33 });
  assert.strictEqual(inv.lineItems[0].hours, 0.83);
  assert.strictEqual(inv.lineItems[0].amount, 27.66);
  assert.strictEqual(inv.subtotal, 27.66);
});

test('computeInvoice: empty entries → empty invoice, zero totals', () => {
  const inv = computeInvoice({ entries: [], rate: 40, taxRate: 10 });
  assert.deepStrictEqual(inv.lineItems, []);
  assert.strictEqual(inv.subtotal, 0);
  assert.strictEqual(inv.taxAmount, 0);
  assert.strictEqual(inv.total, 0);
});

test('computeDueDate: adds net days in UTC, month rollover', () => {
  assert.strictEqual(computeDueDate('2026-07-06', 30), '2026-08-05');
  assert.strictEqual(computeDueDate('2026-07-06', 0), '2026-07-06');
  assert.strictEqual(computeDueDate('2026-12-20', 15), '2027-01-04'); // year rollover
});

test('computeDueDate: invalid date returns input unchanged', () => {
  assert.strictEqual(computeDueDate('not-a-date', 30), 'not-a-date');
});

test('formatMoney: known currencies and fallback', () => {
  assert.strictEqual(formatMoney(1234.5, 'USD'), '$1,234.50');
  assert.strictEqual(formatMoney(1000, 'GBP'), '£1,000.00');
  // JPY has no minor units.
  assert.strictEqual(formatMoney(1000, 'JPY'), '¥1,000');
  // Malformed code (Intl throws only for non-3-letter codes) → graceful
  // fallback, never throws.
  assert.strictEqual(formatMoney(12.3, 'US'), 'US 12.30');
  assert.doesNotThrow(() => formatMoney(5, ''));
});

test('buildInvoiceHTML: renders numbers, parties, and escapes user strings', () => {
  const inv = computeInvoice({ entries, rate: 40, taxRate: 20 });
  const html = buildInvoiceHTML({
    invoiceNumber: 'INV-0007',
    issueDate: '2026-07-06',
    dueDate: '2026-08-05',
    terms: 'Net 30',
    periodFrom: '2026-07-01', periodTo: '2026-07-07',
    currency: 'USD',
    billFrom: { name: 'Conqueror Studio', address: 'A St\nCity', email: 'me@x.com', taxId: 'VAT-1', paymentInstructions: 'PayPal <me@x.com>' },
    billTo: { name: '<script>alert(1)</script> Corp', address: 'Client Rd' },
    ...inv,
  });
  assert.match(html, /INV-0007/);
  assert.match(html, /Conqueror Studio/);
  assert.match(html, /\$924\.00/);                 // total due
  assert.match(html, /Tax \(20%\)/);
  assert.match(html, /A St<br>City/);              // newline → <br> in address
  // XSS canary company name must be escaped, never a live tag.
  assert.ok(!html.includes('<script>alert(1)</script> Corp'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Corp/);
});

test('buildInvoiceHTML: omits tax row and payment block when absent', () => {
  const inv = computeInvoice({ entries, rate: 40 });
  const html = buildInvoiceHTML({
    invoiceNumber: 'INV-0008', issueDate: '2026-07-06',
    periodFrom: '2026-07-01', periodTo: '2026-07-07', currency: 'EUR',
    billFrom: { name: 'Me' }, billTo: { name: 'Client' }, ...inv,
  });
  assert.ok(!/Tax \(/.test(html));
  assert.ok(!/Payment Instructions/.test(html));
  assert.match(html, /No billable time in this period\.|€770\.00/); // has the subtotal
  assert.match(html, /€770\.00/);
});

// ── Per-punch task detail (task name/label, description, clock times) ────────
const detailEntries = [
  {
    log_date: '2026-07-01', total_mins: 120,
    rows_json: JSON.stringify([
      { label: 'Dispatch', name: 'Route audit', desc: 'Checked\nthe   manifest', clock_in: '08:00', clock_out: '09:00', total_mins: 60 },
      { label: 'Dispatch', name: 'Callbacks', desc: '', clock_in: '09:00', clock_out: '10:00', total_mins: 60 },
      { label: '', name: '', desc: '', clock_in: '', clock_out: '', total_mins: 0 },   // blank row: dropped
    ]),
  },
  // Second session on the same date — its punches append to the same day line.
  { log_date: '2026-07-01', total_mins: 30, rows_json: JSON.stringify([{ label: 'Admin', name: 'Invoicing', desc: '<b>x</b>', clock_in: '13:00', clock_out: '13:30', total_mins: 30 }]) },
];

test('computeInvoice: builds per-punch detail and drops empty rows', () => {
  const inv = computeInvoice({ entries: detailEntries, rate: 50 });
  assert.equal(inv.lineItems.length, 1);
  const li = inv.lineItems[0];
  assert.equal(li.minutes, 150);
  assert.equal(li.detail.length, 3);                        // blank row filtered out
  assert.equal(li.detail[0].name, 'Route audit');
  assert.equal(li.detail[0].desc, 'Checked the manifest');  // whitespace flattened
  assert.equal(li.detail[0].clockIn, '08:00');
  assert.equal(li.detail[2].label, 'Admin');                // second session appended
});

test('computeInvoice: tolerates missing/invalid rows_json', () => {
  const inv = computeInvoice({ entries: [{ log_date: '2026-07-01', total_mins: 60 }, { log_date: '2026-07-02', total_mins: 60, rows_json: 'not json' }], rate: 10 });
  assert.deepEqual(inv.lineItems[0].detail, []);
  assert.deepEqual(inv.lineItems[1].detail, []);
  assert.equal(inv.subtotal, 20);
});

test('buildInvoiceHTML: renders detail sub-rows, escaped; includeDetail:false suppresses them', () => {
  const inv = computeInvoice({ entries: detailEntries, rate: 50 });
  const base = {
    invoiceNumber: 'INV-0009', issueDate: '2026-07-06',
    periodFrom: '2026-07-01', periodTo: '2026-07-07', currency: 'USD',
    billFrom: { name: 'Me' }, billTo: { name: 'Client' }, ...inv,
  };
  const html = buildInvoiceHTML(base);
  assert.match(html, /Dispatch · Route audit/);
  assert.match(html, /Checked the manifest/);
  assert.match(html, /08:00 → 09:00 · 1h 0m/);
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);

  const plain = buildInvoiceHTML({ ...base, includeDetail: false });
  assert.ok(!/Route audit/.test(plain));
  assert.match(plain, /\$125\.00/);   // money unchanged
});
