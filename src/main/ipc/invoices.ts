'use strict';

// ── IPC: Invoices ────────────────────────────────────────────────────────────
// Phase 3 of the invoicing feature (docs/PLAN-invoicing.md): the ledger + the
// generate → preview → issue flow, plus PDF export and email.
//
// Design principle — SNAPSHOT AT ISSUE. Preview recomputes live from current
// entries/rate; issuing freezes a full InvoiceDoc into the encrypted `invoices`
// row. Later edits to time entries or a company's rate never mutate an issued
// invoice. The frozen doc is the source of truth for list/PDF/email.

const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const { session, decryptEntry } = require('../session');
const { dbAll, dbGet, dbRun, persistDB } = require('../db');
const { encrypt, decrypt } = require('../vault-crypto');
const { performBackup } = require('../backups');
const { localDateStr } = require('../../renderer/row-utils');
const { computeInvoice, computeDueDate, buildInvoiceHTML } = require('../invoice-html');
const { loadPdfFontCss, getEmailSmtpConfig, generatePDF, sendInvoiceEmail } = require('../email');

function authed(): boolean { return !!(session.key && session.user); }

function setting(key: string, dflt: string): string {
  const r = dbGet('SELECT value FROM app_settings WHERE key=?', [key]);
  return r && r.value != null ? String(r.value) : dflt;
}
function setSetting(key: string, val: string | number): void {
  dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [key, String(val)]);
}

const invPrefix = () => setting('invoice_prefix', 'INV-');
const invPad = () => Math.max(1, parseInt(setting('invoice_pad', '4'), 10) || 4);
function nextSeq(): number {
  const configured = parseInt(setting('invoice_next', '1'), 10) || 1;
  const maxRow = dbGet('SELECT MAX(seq) as m FROM invoices WHERE user_id=?', [session.user.id]);
  const floor = maxRow && maxRow.m ? Number(maxRow.m) + 1 : 1; // never reuse a number
  return Math.max(configured, floor);
}
const fmtNumber = (seq: number) => invPrefix() + String(seq).padStart(invPad(), '0');

// Invoice "Bill From" — from the encrypted profile blob, with sensible fallbacks.
function getBillFrom() {
  const u = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [session.user.id]);
  let p: Record<string, any> = {};
  if (u && u.profile_enc && u.profile_iv && u.profile_tag) {
    try { p = JSON.parse(decrypt({ data: u.profile_enc, iv: u.profile_iv, tag: u.profile_tag }, session.key)); } catch {}
  }
  return {
    name: p.business_name || (u && u.display_name) || '',
    address: p.business_address || '',
    email: p.business_email || p.email || '',
    taxId: p.tax_id || '',
    paymentInstructions: p.payment_instructions || '',
    defaultCurrency: (p.default_currency || 'USD'),
  };
}

// Decrypt one company by rowid (for name / rate / currency / billing address).
function getCompany(companyId: number) {
  const row = dbGet('SELECT rowid as rid, * FROM companies WHERE user_id=? AND rowid=?', [session.user.id, Number(companyId)]);
  if (!row) return null;
  try { return { ...JSON.parse(decrypt({ data: row.data_enc, iv: row.data_iv, tag: row.data_tag }, session.key)), id: Number(row.rid) }; }
  catch { return null; }
}

// Per-day billable minutes come from the plaintext aggregate columns. When the
// invoice includes per-punch detail we additionally decrypt rows_json (task
// label/name, description, clock in/out) — the only path here that pays AES-GCM,
// and it's scoped to one company + date range, not the whole history.
function scopedEntries(companyId: number, from: string, to: string, withDetail: boolean) {
  const cols = withDetail
    ? 'rowid as rid, company_id, log_date, total_mins, rows_json, rows_enc, rows_iv, rows_tag'
    : 'company_id, log_date, total_mins';
  const rows = dbAll(
    `SELECT ${cols} FROM time_entries WHERE user_id=? AND company_id=? AND log_date>=? AND log_date<=? ORDER BY log_date`,
    [session.user.id, Number(companyId), from, to]
  );
  if (withDetail) rows.forEach((r: any) => decryptEntry(r));
  return rows;
}

function resolveTerms(netDaysRaw: unknown): { netDays: number | null; terms: string } {
  if (netDaysRaw === '' || netDaysRaw == null) return { netDays: null, terms: '' };
  const n = parseInt(String(netDaysRaw), 10);
  if (!Number.isFinite(n)) return { netDays: null, terms: '' };
  if (n === 0) return { netDays: 0, terms: 'Due on receipt' };
  return { netDays: n, terms: `Net ${n}` };
}

interface DocParams {
  companyId: number; fromDate: string; toDate: string;
  taxRate?: number; netDays?: unknown; issueDate?: string; notes?: string; number: string;
  /** Include per-punch task detail under each day (default true). */
  includeDetail?: boolean;
}

// Assemble a full, self-contained InvoiceDoc (the frozen snapshot shape).
function buildDoc(params: DocParams) {
  const co = getCompany(params.companyId);
  if (!co) throw new Error('Company not found.');
  const from = getBillFrom();
  const currency = (co.currency && String(co.currency).trim()) ? co.currency : (from.defaultCurrency || 'USD');
  const includeDetail = params.includeDetail !== false;
  const entries = scopedEntries(params.companyId, params.fromDate, params.toDate, includeDetail);
  const comp = computeInvoice({ entries, rate: Number(co.pay_rate) || 0, taxRate: Number(params.taxRate) || 0 });

  const issueDate = params.issueDate || localDateStr();
  const { netDays, terms } = resolveTerms(params.netDays);
  const dueDate = netDays != null ? computeDueDate(issueDate, netDays) : undefined;

  return {
    number: params.number,
    issueDate, dueDate, terms,
    periodFrom: params.fromDate, periodTo: params.toDate,
    currency,
    companyId: Number(params.companyId),
    billFrom: { name: from.name, address: from.address, email: from.email, taxId: from.taxId, paymentInstructions: from.paymentInstructions },
    billTo: { name: co.name, address: co.billing_address || '' },
    rate: Number(co.pay_rate) || 0,
    lineItems: comp.lineItems,
    totalMinutes: comp.totalMinutes, totalHours: comp.totalHours,
    subtotal: comp.subtotal, taxRate: comp.taxRate, taxAmount: comp.taxAmount, total: comp.total,
    notes: params.notes || '',
    includeDetail,
  };
}

// Decrypt one stored invoice's frozen doc by rowid.
function getStoredDoc(id: number): any | null {
  const row = dbGet('SELECT rowid as rid, * FROM invoices WHERE user_id=? AND rowid=?', [session.user.id, Number(id)]);
  if (!row) return null;
  try { const doc = JSON.parse(decrypt({ data: row.data_enc, iv: row.data_iv, tag: row.data_tag }, session.key)); return { ...doc, _row: row }; }
  catch { return null; }
}

function register() {
  // Panel context: company dropdown data + bill-from readiness + next number.
  ipcMain.handle('invoices:context', () => {
    if (!authed()) return { ok: false };
    const from = getBillFrom();
    return {
      ok: true,
      nextNumber: fmtNumber(nextSeq()),
      prefix: invPrefix(),
      next: nextSeq(),
      billFrom: from,
      billFromReady: !!(from.name && from.name.trim()),
    };
  });

  // Live, non-persisting compute for the preview modal.
  ipcMain.handle('invoices:preview', (_: unknown, params: DocParams) => {
    if (!authed()) return { ok: false, error: 'Not authenticated' };
    try { return { ok: true, doc: buildDoc({ ...params, number: fmtNumber(nextSeq()) }) }; }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // Freeze + persist. Advances the counter only on success.
  ipcMain.handle('invoices:issue', (_: unknown, params: DocParams) => {
    if (!authed()) return { ok: false, error: 'Not authenticated' };
    try {
      const seq = nextSeq();
      const number = fmtNumber(seq);
      const doc = buildDoc({ ...params, number });
      const blob = encrypt(JSON.stringify(doc), session.key);
      dbRun('INSERT INTO invoices (user_id,seq,status,issued_at,data_enc,data_iv,data_tag) VALUES (?,?,?,?,?,?,?)',
        [session.user.id, seq, 'unpaid', Math.floor(Date.now() / 1000), blob.data, blob.iv, blob.tag]);
      setSetting('invoice_next', seq + 1);
      persistDB(); performBackup();
      const idRow = dbGet('SELECT MAX(rowid) as id FROM invoices WHERE user_id=?', [session.user.id]);
      return { ok: true, id: Number(idRow.id), number };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // Ledger — newest first. Decrypts each frozen doc for the display fields.
  ipcMain.handle('invoices:list', () => {
    if (!authed()) return [];
    return dbAll('SELECT rowid as rid, * FROM invoices WHERE user_id=? ORDER BY seq DESC', [session.user.id]).map((r: any) => {
      let doc: Record<string, any> = {};
      try { doc = JSON.parse(decrypt({ data: r.data_enc, iv: r.data_iv, tag: r.data_tag }, session.key)); } catch {}
      return {
        id: Number(r.rid), seq: r.seq, status: r.status, paid_at: r.paid_at || null, issued_at: r.issued_at,
        number: doc.number || fmtNumber(r.seq),
        company_name: doc.billTo ? doc.billTo.name : '',
        company_id: typeof doc.companyId === 'number' ? doc.companyId : null,
        period_from: doc.periodFrom || '', period_to: doc.periodTo || '',
        due_date: doc.dueDate || '', total: doc.total || 0, currency: doc.currency || 'USD',
      };
    });
  });

  ipcMain.handle('invoices:get', (_: unknown, id: number) => {
    if (!authed()) return { ok: false };
    const doc = getStoredDoc(id);
    if (!doc) return { ok: false, error: 'Invoice not found.' };
    const { _row, ...clean } = doc;
    return { ok: true, doc: clean, status: _row.status, paid_at: _row.paid_at || null };
  });

  ipcMain.handle('invoices:set-status', (_: unknown, { id, status }: { id: number; status: string }) => {
    if (!authed()) return { ok: false };
    if (!['unpaid', 'paid', 'void'].includes(status)) return { ok: false, error: 'Invalid status' };
    const paidAt = status === 'paid' ? Math.floor(Date.now() / 1000) : null;
    dbRun('UPDATE invoices SET status=?, paid_at=?, updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
      [status, paidAt, Number(id), session.user.id]);
    persistDB();
    return { ok: true };
  });

  // Render the frozen doc to a PDF and save via a native dialog.
  ipcMain.handle('invoices:save-pdf', async (_: unknown, id: number) => {
    if (!authed()) return { ok: false };
    const doc = getStoredDoc(id);
    if (!doc) return { ok: false, error: 'Invoice not found.' };
    const { _row, ...clean } = doc;
    const html = buildInvoiceHTML({ ...clean, fontCss: loadPdfFontCss() });
    const res = await dialog.showSaveDialog({ defaultPath: `${clean.number}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      const buf = await generatePDF(html);
      fs.writeFileSync(res.filePath, buf);
      return { ok: true, path: res.filePath };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // Email the frozen doc's PDF to the company's report_email (or SMTP default).
  ipcMain.handle('invoices:email', async (_: unknown, id: number) => {
    if (!authed()) return { ok: false };
    const doc = getStoredDoc(id);
    if (!doc) return { ok: false, error: 'Invoice not found.' };
    const { _row, ...clean } = doc;
    try {
      const co = getCompany(clean.companyId);
      const recipient = (co && co.report_email) || getEmailSmtpConfig().defaultTo || '';
      const html = buildInvoiceHTML({ ...clean, fontCss: loadPdfFontCss() });
      const to = await sendInvoiceEmail({ htmlContent: html, recipients: recipient, invoiceNumber: clean.number });
      return { ok: true, to: (to || []).join(', ') };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

  // Read/update the numbering counter (prefix + next number).
  ipcMain.handle('invoices:get-counter', () => {
    if (!authed()) return { ok: false };
    return { ok: true, prefix: invPrefix(), pad: invPad(), next: nextSeq() };
  });
  ipcMain.handle('invoices:set-counter', (_: unknown, { prefix, next }: { prefix?: string; next?: number }) => {
    if (!authed()) return { ok: false };
    if (prefix != null) setSetting('invoice_prefix', String(prefix).slice(0, 12));
    if (next != null) {
      const n = Math.max(1, parseInt(String(next), 10) || 1);
      setSetting('invoice_next', n);
    }
    persistDB();
    return { ok: true, prefix: invPrefix(), next: nextSeq() };
  });
}

module.exports = { register };
