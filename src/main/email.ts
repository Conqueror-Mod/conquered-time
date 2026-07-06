'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  email.ts — SMTP config, report sending, schedule engine (Phase 2 extraction).
//
//  Gotcha #9 lives here: scheduled reports only run while the app is open AND
//  unlocked (needs session.key to decrypt), driven by the 5-minute poller in
//  main plus an on-launch catch-up setTimeout in EVERY login handler. The >=
//  comparison in runScheduledEmailCheck means a missed window is caught up on
//  the next eligible check rather than skipped.
//
//  The main window (for success toasts) is injected via initEmail() — email
//  must not require main.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { app, BrowserWindow } = require('electron');
const { dbGet, dbAll, dbRun, persistDB, hasDb } = require('./db');
const { session, decryptEntry } = require('./session');
const { decrypt } = require('./vault-crypto');
const { localDateStr } = require('../renderer/row-utils');
const { buildEmailReportHTML, buildReportCSV } = require('./report-html');

// Inter base64 @font-face CSS for the emailed PDF — reuses the renderer's
// pdf-fonts.js bundle (window.PDF_FONT_CSS) so the emailed report matches the
// in-app PDF exports typographically. Evaluated with a stub window; falls
// back to the system font stack if the file is missing.
let pdfFontCssCache: string | null = null;
function loadPdfFontCss(): string {
  if (pdfFontCssCache !== null) return pdfFontCssCache;
  try {
    const code = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'pages', 'pdf-fonts.js'), 'utf8');
    const w: Record<string, any> = {};
    new Function('window', code)(w);
    pdfFontCssCache = String(w.PDF_FONT_CSS || '');
  } catch { pdfFontCssCache = ''; }
  return pdfFontCssCache;
}

// Decrypted company-name map for the logged-in user (rowid → name).
function getCompanyNames(): Record<number, string> {
  const map: Record<number, string> = {};
  dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [session.user.id]).forEach((co: any) => {
    try { map[Number(co.rid)] = JSON.parse(decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, session.key)).name || ''; } catch {}
  });
  return map;
}

let getMainWindow: () => any = () => null;
function initEmail(d: { getMainWindow: () => any }): void { getMainWindow = d.getMainWindow; }

// The logged-in user's profile email (decrypted from the profile blob).
function getProfileEmail(): string {
  if (!session.key || !session.user) return '';
  try {
    const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [session.user.id]);
    if (!user || !user.profile_enc) return '';
    const data = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, session.key));
    return (data?.email || '').trim();
  } catch { return ''; }
}

// Returns true when the logged-in user has no email saved in their profile blob.
function profileEmailMissing(): boolean {
  if (!session.key || !session.user) return false;
  try {
    const user = dbGet('SELECT rowid as rid, * FROM users WHERE rowid=?', [session.user.id]);
    if (!user || !user.profile_enc) return true;
    const data = JSON.parse(decrypt({ data: user.profile_enc, iv: user.profile_iv, tag: user.profile_tag }, session.key));
    return !data?.email?.trim();
  } catch { return true; }
}

function getEmailSmtpConfig() {
  const get = (k: string) => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
  const host     = get('email_smtp_host');
  const port     = parseInt(get('email_smtp_port') || '587', 10);
  const username = get('email_smtp_username');
  const fromName = get('email_smtp_from_name');
  const defaultTo = get('email_smtp_default_to');
  const enc  = get('email_smtp_password_enc');
  const iv   = get('email_smtp_password_iv');
  const tag  = get('email_smtp_password_tag');
  let password = '';
  if (enc && iv && tag && session.key) {
    try { password = decrypt({ data: enc, iv, tag }, session.key); } catch {}
  }
  return { host, port, username, password, fromName, defaultTo };
}

// Render HTML to a PDF buffer via a hidden window (used for the emailed report).
function generatePDF(htmlContent: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tmp = path.join(app.getPath('temp'), `ct-report-${Date.now()}.html`);
    fs.writeFileSync(tmp, htmlContent, 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    // Use loadFile() — avoids Windows backslash issues with file:// URLs
    win.loadFile(tmp);
    const cleanup = () => { try { fs.unlinkSync(tmp); } catch {} };
    win.webContents.once('did-finish-load', () => {
      win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' })
        .then((buf: Buffer) => { win.close(); cleanup(); resolve(buf); })
        .catch((e: any)  => { win.close(); cleanup(); reject(e); });
    });
    win.webContents.once('did-fail-load', (_: any, code: any, desc: any) => {
      win.close(); cleanup(); reject(new Error(`PDF window failed to load: ${desc} (${code})`));
    });
  });
}

// Render and email a report PDF+CSV via the configured SMTP transport.
// `entries` is the SCOPED, decrypted entry set the report covers — the CSV is
// built from exactly this set, so it can never cover more than the PDF shows
// (the old manual path dumped the entire vault into the CSV regardless of the
// chosen period/company filter).
async function doSendReport({ htmlContent, subject, recipients, entries, fromDate, toDate }: {
  htmlContent: string; subject?: string; recipients?: string | string[];
  entries: Array<Record<string, any>>; fromDate: string; toDate: string;
}) {
  const cfg = getEmailSmtpConfig();
  if (!cfg.host || !cfg.username || !cfg.password) throw new Error('Email not configured. Open Settings → Data to add SMTP credentials.');

  const toList = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : (recipients || cfg.defaultTo || '').split(/[,;\s]+/).map((s: any) => s.trim()).filter(Boolean);
  if (!toList.length) throw new Error('No recipients specified.');

  const csv = buildReportCSV({ entries, companyNames: getCompanyNames(), fromDate, toDate });

  const pdfBuf = await generatePDF(htmlContent);
  const dateTag = new Date().toISOString().slice(0, 10);
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.username, pass: cfg.password },
  });
  const fromAddr = cfg.fromName ? `"${cfg.fromName}" <${cfg.username}>` : cfg.username;
  await transport.sendMail({
    from: fromAddr, to: toList.join(', '),
    subject: subject || `Conquered Time Report — ${dateTag}`,
    html: `<p>Please find your Conquered Time report attached.</p><p style="color:#6b7280;font-size:12px">Generated ${new Date().toLocaleString()} · CONFIDENTIAL</p>`,
    attachments: [
      { filename: `conquered-time-report-${dateTag}.pdf`, content: pdfBuf, contentType: 'application/pdf' },
      { filename: `conquered-time-report-${dateTag}.csv`, content: csv,    contentType: 'text/csv' },
    ],
  });
}

// Query + decrypt the entries a report covers. companyId (rowid) narrows to
// one company; null/undefined means all.
function getScopedEntries(fromDate: string, toDate: string, companyId?: number | null): Array<Record<string, any>> {
  const params: unknown[] = [session.user.id, fromDate, toDate];
  let sql = 'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date>=? AND log_date<=?';
  if (companyId) { sql += ' AND company_id=?'; params.push(Number(companyId)); }
  sql += ' ORDER BY log_date';
  // decryptEntry is mandatory: time entries are encrypted at rest, so the raw
  // rows_json column is EMPTY without it.
  return dbAll(sql, params).map((r: any) => ({ ...decryptEntry(r), id: Number(r.rid) }));
}

// The one entry point both email paths use: builds the branded HTML + scoped
// CSV from the SAME entry set and sends them.
async function sendPeriodReport({ title, fromDate, toDate, companyId, subject, recipients }: {
  title: string; fromDate: string; toDate: string; companyId?: number | null;
  subject?: string; recipients?: string | string[];
}) {
  const entries = getScopedEntries(fromDate, toDate, companyId);
  const companyNames = getCompanyNames();
  const coLabel = companyId ? (companyNames[Number(companyId)] || 'Selected Company') : 'All Companies';
  const htmlContent = buildEmailReportHTML({
    title, fromDate, toDate, coLabel, entries, companyNames, fontCss: loadPdfFontCss(),
  });
  await doSendReport({ htmlContent, subject, recipients, entries, fromDate, toDate });
}

function computeNextSendDate(freq: string, lastSent: string | null): Date | null {
  const now  = new Date();
  const last = lastSent ? new Date(lastSent) : null;
  if (freq === 'daily')     return last ? new Date(last.getTime() + 86400000) : now;
  if (freq === 'weekly')    return last ? new Date(last.getTime() + 7 * 86400000) : now;
  if (freq === 'monthly') {
    const d = last ? new Date(last) : new Date(now);
    d.setMonth(d.getMonth() + 1); d.setDate(1); return d;
  }
  if (freq === 'quarterly') {
    const d = last ? new Date(last) : new Date(now);
    d.setMonth(d.getMonth() + 3); d.setDate(1); return d;
  }
  if (freq === 'annually') {
    const d = last ? new Date(last) : new Date(now);
    d.setFullYear(d.getFullYear() + 1); d.setMonth(0); d.setDate(1); return d;
  }
  return null;
}

async function runScheduledEmailCheck(force = false) {
  if (!hasDb() || !session.key || !session.user) return;
  try {
    const get = (k: string) => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
    const freq = get('email_schedule_freq');
    if (!freq || freq === 'off') return false;

    const lastSent  = get('email_schedule_last_sent') || null;
    const sendTime  = get('email_schedule_time') || '08:00';
    const nextSend  = computeNextSendDate(freq, lastSent);
    if (!nextSend) return;

    const [sh, sm] = sendTime.split(':').map(Number);
    nextSend.setHours(sh, sm, 0, 0);
    if (!force && new Date() < nextSend) return;

    // Time to send — build report covering since lastSent
    // LOCAL dates — log_date values are local; toISOString is UTC (tomorrow
    // all evening in US timezones). See the UTC date gotcha (PR #95).
    const fromDate = lastSent ? lastSent.slice(0, 10) : localDateStr(new Date(Date.now() - 30 * 86400000));
    const toDate   = localDateStr();

    const cfg = getEmailSmtpConfig();
    if (!cfg.host || !cfg.password) throw new Error('SMTP not configured.');
    const toList = (cfg.defaultTo || '').split(/[,;\s]+/).map((s: any) => s.trim()).filter(Boolean);
    if (!toList.length) throw new Error('No default recipient set. Add one in Settings → Data → Email Reports.');

    // Same branded template + scoped CSV as the manual Email Report path.
    await sendPeriodReport({
      title: 'Scheduled Report',
      fromDate, toDate,
      subject: `Conquered Time Scheduled Report — ${toDate}`,
      recipients: toList,
    });

    dbRun("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('email_schedule_last_sent',?)", [new Date().toISOString()]);
    dbRun("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('email_schedule_last_error','')", []);
    persistDB();
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', 'Scheduled report sent successfully!', 'success');
  } catch (e) {
    console.error('[schedule-email]', e.message);
    if (hasDb()) { try { dbRun("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('email_schedule_last_error',?)", [e.message]); persistDB(); } catch {} }
    throw e; // re-throw so IPC handler / interval caller can surface the error
  }
}

module.exports = {
  initEmail, getProfileEmail, profileEmailMissing, getEmailSmtpConfig,
  generatePDF, doSendReport, sendPeriodReport, computeNextSendDate, runScheduledEmailCheck,
};
