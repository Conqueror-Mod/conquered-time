'use strict';

// Invoices page — the generate → preview → issue flow plus the ledger.
// Externalized from inline script for CSP; depends on globals from shell.js
// (Shell, Store, api, escapeHtml). Phase 3 renderer pattern (IIFE, strict TS).
(() => {

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $in = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const $sel = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const $ta = (id: string): HTMLTextAreaElement => document.getElementById(id) as HTMLTextAreaElement;

let companies: Company[] = [];
let defaultCurrency = 'USD';
/** companyId → identity color (BubbleWeb.colorMap), set when companies load. */
let colorFor: (companyId: number) => string = () => 'var(--border-light)';
let pendingParams: InvoicePreviewParams | null = null; // params behind the open preview

// Local date string (NEVER toISOString — that's UTC; see the UTC date gotcha).
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function firstOfMonth(): string {
  const d = new Date(); return localDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(Number(amount) || 0); }
  catch { return `${(currency || 'USD').toUpperCase()} ${(Number(amount) || 0).toFixed(2)}`; }
}

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('invoices');
  document.documentElement.style.visibility = '';

  // Defaults
  $in('gen-from').value  = firstOfMonth();
  $in('gen-to').value    = localDate();
  $in('gen-issue').value = localDate();

  await loadContext();
  await loadCompanies();
  await loadLedger();

  // Wiring (after Shell.init — the innerHTML swap preserves #main-content markup)
  $id('gen-preview-btn').addEventListener('click', doPreview);
  $sel('gen-company').addEventListener('change', updateRateHint);
  $id('preview-issue').addEventListener('click', doIssue);
  $id('preview-cancel').addEventListener('click', closePreview);
  $id('preview-close').addEventListener('click', closePreview);
  $id('numbering-btn').addEventListener('click', openNumbering);
  $id('num-save').addEventListener('click', saveNumbering);
  $id('num-cancel').addEventListener('click', () => $id('numbering-modal').classList.remove('show'));
  $id('num-close').addEventListener('click', () => $id('numbering-modal').classList.remove('show'));
  $in('num-prefix').addEventListener('input', syncNumPreview);
  $in('num-next').addEventListener('input', syncNumPreview);

  // Ledger row actions — delegated so re-rendered rows need no re-wiring.
  $id('ledger-tbody').addEventListener('click', onLedgerClick);
  $id('ledger-tbody').addEventListener('contextmenu', onLedgerContext);

  // Backdrop click closes modals.
  for (const mid of ['preview-modal', 'numbering-modal']) {
    $id(mid).addEventListener('click', e => { if (e.target === e.currentTarget) $id(mid).classList.remove('show'); });
  }
});

async function loadContext(): Promise<void> {
  const ctx = await api.invoke('invoices:context');
  if (!ctx || !ctx.ok) return;
  defaultCurrency = (ctx.billFrom && ctx.billFrom.defaultCurrency) || 'USD';
  $id('next-number-tag').textContent = ctx.nextNumber ? `Next: ${ctx.nextNumber}` : '';
  $id('billing-warn').classList.toggle('show', !ctx.billFromReady);
}

async function loadCompanies(): Promise<void> {
  companies = await Store.getCompanies();
  colorFor  = BubbleWeb.colorMap(companies, await Store.getEntriesSummary()).colorFor;
  const sel = $sel('gen-company');
  const opts = ['<option value="">— Select a company —</option>'];
  for (const co of companies) opts.push(`<option value="${co.id}">${escapeHtml(co.name)}</option>`);
  sel.innerHTML = opts.join('');
  updateRateHint();
}

function selectedCompany(): Company | undefined {
  const id = Number($sel('gen-company').value);
  return companies.find(c => c.id === id);
}

function updateRateHint(): void {
  const co = selectedCompany();
  const hint = $in('gen-rate-hint');
  if (!co) { hint.value = '—'; return; }
  const cur = (co.currency && co.currency.trim()) ? co.currency : defaultCurrency;
  const rate = Number(co.pay_rate) || 0;
  hint.value = rate > 0 ? `${money(rate, cur)}/hr` : 'No rate set — add one in Companies';
}

function collectParams(): InvoicePreviewParams | null {
  const co = selectedCompany();
  if (!co) { Shell.toast('Select a company first.', 'error'); return null; }
  if (!(Number(co.pay_rate) > 0)) { Shell.toast('This company has no pay rate. Set one in the Companies page.', 'error'); return null; }
  const fromDate = $in('gen-from').value, toDate = $in('gen-to').value;
  if (!fromDate || !toDate) { Shell.toast('Choose a period.', 'error'); return null; }
  if (fromDate > toDate) { Shell.toast('“Period From” must be on or before “Period To”.', 'error'); return null; }
  return {
    companyId: co.id, fromDate, toDate,
    taxRate: parseFloat($in('gen-tax').value) || 0,
    netDays: $sel('gen-terms').value,
    issueDate: $in('gen-issue').value || localDate(),
    notes: $ta('gen-notes').value.trim(),
  };
}

async function doPreview(): Promise<void> {
  const params = collectParams();
  if (!params) return;
  const res = await api.invoke('invoices:preview', params);
  if (!res || !res.ok || !res.doc) { Shell.toast(res?.error || 'Could not build preview.', 'error'); return; }
  if (!res.doc.lineItems.length) { Shell.toast('No billable time in that period for this company.', 'error'); return; }
  pendingParams = params;
  renderPreview(res.doc);
  $id('preview-modal').classList.add('show');
}

function renderPreview(doc: InvoiceDoc): void {
  const cur = doc.currency;
  const rows = doc.lineItems.map(li =>
    `<tr><td>${escapeHtml(li.date)}</td><td class="num">${li.hours.toFixed(2)}</td>` +
    `<td class="num">${escapeHtml(money(li.rate, cur))}</td><td class="num">${escapeHtml(money(li.amount, cur))}</td></tr>`).join('');
  const taxLine = doc.taxRate > 0
    ? `<div><span>Tax (${escapeHtml(String(doc.taxRate))}%)</span><span class="mono">${escapeHtml(money(doc.taxAmount, cur))}</span></div>` : '';
  const dueBit = doc.dueDate ? `<div>Due <b>${escapeHtml(doc.dueDate)}</b>${doc.terms ? ` · ${escapeHtml(doc.terms)}` : ''}</div>` : '';

  $id('preview-body').innerHTML = `
    <div class="pv-parties">
      <div><div class="pv-lbl">From</div><div class="pv-who">${escapeHtml(doc.billFrom.name || '—')}</div>
        <div class="pv-addr">${escapeHtml(doc.billFrom.address || '')}</div></div>
      <div><div class="pv-lbl">Bill To</div><div class="pv-who">${escapeHtml(doc.billTo.name || '—')}</div>
        <div class="pv-addr">${escapeHtml(doc.billTo.address || '')}</div></div>
      <div class="pv-meta"><div><b>${escapeHtml(doc.number)}</b></div>
        <div>Issued ${escapeHtml(doc.issueDate)}</div>${dueBit}
        <div>${escapeHtml(doc.periodFrom)} → ${escapeHtml(doc.periodTo)}</div></div>
    </div>
    <table class="pv"><thead><tr><th>Date</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="pv-totals">
      <div><span>Subtotal</span><span class="mono">${escapeHtml(money(doc.subtotal, cur))}</span></div>
      ${taxLine}
      <div class="grand"><span>Total Due</span><span class="mono">${escapeHtml(money(doc.total, cur))}</span></div>
    </div>`;
}

function closePreview(): void { $id('preview-modal').classList.remove('show'); pendingParams = null; }

async function doIssue(): Promise<void> {
  if (!pendingParams) return;
  const btn = $id('preview-issue') as HTMLButtonElement;
  btn.disabled = true;
  const res = await api.invoke('invoices:issue', pendingParams);
  btn.disabled = false;
  if (!res || !res.ok) { Shell.toast(res?.error || 'Could not issue invoice.', 'error'); return; }
  Shell.toast(`Invoice ${res.number} issued.`, 'success');
  closePreview();
  await loadContext();
  await loadLedger();
}

async function loadLedger(): Promise<void> {
  const rows = await api.invoke('invoices:list');
  const tb = $id('ledger-tbody');
  $id('ledger-count').textContent = rows.length ? `${rows.length} invoice${rows.length === 1 ? '' : 's'}` : '';
  if (!rows.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">${Shell.emptyState({
      icon: 'invoices',
      title: 'No invoices yet',
      body: 'Pick a company and date range above, preview, then issue your first invoice. Issued invoices land here as a paid / unpaid ledger you can save as a PDF or email.',
    })}</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(r => {
    const period = `${escapeHtml(r.period_from)} → ${escapeHtml(r.period_to)}`;
    const paidBtn = r.status === 'paid'
      ? `<button class="mini-btn" data-act="unpaid" data-id="${r.id}">Mark Unpaid</button>`
      : (r.status === 'void' ? '' : `<button class="mini-btn" data-act="paid" data-id="${r.id}">Mark Paid</button>`);
    const voidBtn = r.status === 'void' ? '' : `<button class="mini-btn danger" data-act="void" data-id="${r.id}">Void</button>`;
    return `<tr data-id="${r.id}" data-status="${r.status}">
      <td class="mono">${escapeHtml(r.number)}</td>
      <td>${r.company_id != null ? `<span class="co-dot" style="background:${colorFor(r.company_id)}"></span>` : ''}${escapeHtml(r.company_name || '—')}</td>
      <td class="mono">${period}</td>
      <td class="num mono">${escapeHtml(money(r.total, r.currency))}</td>
      <td><span class="status-pill status-${r.status}">${r.status === 'unpaid' ? 'Unpaid' : r.status === 'paid' ? 'Paid' : 'Void'}</span></td>
      <td><div class="row-actions">
        <button class="mini-btn" data-act="pdf" data-id="${r.id}">PDF</button>
        <button class="mini-btn" data-act="email" data-id="${r.id}">Email</button>
        ${paidBtn}${voidBtn}
      </div></td>
    </tr>`;
  }).join('');
}

async function onLedgerClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!btn) return;
  btn.disabled = true;
  try { await runLedgerAction(Number(btn.dataset.id), btn.dataset.act || ''); }
  finally { btn.disabled = false; }
}

// Shared by the row buttons and the right-click menu.
async function runLedgerAction(id: number, act: string): Promise<void> {
  if (act === 'pdf') {
    const res = await api.invoke('invoices:save-pdf', id);
    if (res.ok) Shell.toast('Invoice PDF saved.', 'success');
    else if (!res.canceled) Shell.toast(res.error || 'Could not save PDF.', 'error');
  } else if (act === 'email') {
    const res = await api.invoke('invoices:email', id);
    if (res.ok) Shell.toast(`Invoice emailed to ${res.to}.`, 'success');
    else Shell.toast(res.error || 'Could not email invoice.', 'error');
  } else if (act === 'paid' || act === 'unpaid' || act === 'void') {
    if (act === 'void') {
      const ok = await Shell.confirm({
        title: 'Void this invoice?',
        message: 'It stays in the ledger but is marked void.',
        confirmLabel: 'Void Invoice',
      });
      if (!ok) return;
    }
    const status = act === 'unpaid' ? 'unpaid' : act;
    const res = await api.invoke('invoices:set-status', { id, status });
    if (res.ok) await loadLedger();
    else Shell.toast(res.error || 'Could not update status.', 'error');
  }
}

// Right-click an invoice row → the same actions as its row buttons.
function onLedgerContext(e: MouseEvent): void {
  const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
  if (!tr || !tr.dataset.id) return;
  const id = Number(tr.dataset.id);
  const status = tr.dataset.status || '';
  Shell.contextMenu(e, [
    { label: '📄 Save PDF', action: () => void runLedgerAction(id, 'pdf') },
    { label: '✉ Email', action: () => void runLedgerAction(id, 'email') },
    { separator: true },
    { label: '✓ Mark Paid', hidden: status !== 'unpaid', action: () => void runLedgerAction(id, 'paid') },
    { label: '↺ Mark Unpaid', hidden: status !== 'paid', action: () => void runLedgerAction(id, 'unpaid') },
    { label: '⦸ Void', danger: true, hidden: status === 'void', action: () => void runLedgerAction(id, 'void') },
  ]);
}

// ── Numbering ──
async function openNumbering(): Promise<void> {
  const c = await api.invoke('invoices:get-counter');
  if (c.ok) {
    $in('num-prefix').value = c.prefix || 'INV-';
    $in('num-next').value = String(c.next || 1);
    syncNumPreview();
  }
  $id('numbering-modal').classList.add('show');
}
function syncNumPreview(): void {
  const prefix = $in('num-prefix').value || 'INV-';
  const n = Math.max(1, parseInt($in('num-next').value, 10) || 1);
  $in('num-preview').value = prefix + String(n).padStart(4, '0');
}
async function saveNumbering(): Promise<void> {
  const prefix = $in('num-prefix').value.trim() || 'INV-';
  const next = Math.max(1, parseInt($in('num-next').value, 10) || 1);
  const res = await api.invoke('invoices:set-counter', { prefix, next });
  if (res.ok) { Shell.toast('Numbering updated.', 'success'); $id('numbering-modal').classList.remove('show'); await loadContext(); }
  else Shell.toast('Could not update numbering.', 'error');
}

})();
