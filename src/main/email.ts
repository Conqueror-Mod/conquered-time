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
const { session } = require('./session');
const { decrypt } = require('./vault-crypto');
const { rowHasContent } = require('../renderer/row-utils');

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
  const get = k => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
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
        .then(buf => { win.close(); cleanup(); resolve(buf); })
        .catch(e  => { win.close(); cleanup(); reject(e); });
    });
    win.webContents.once('did-fail-load', (_, code, desc) => {
      win.close(); cleanup(); reject(new Error(`PDF window failed to load: ${desc} (${code})`));
    });
  });
}

// Render and email a report PDF+CSV via the configured SMTP transport.
// entriesOverride is only set by the scheduled-report path; the manual
// email:send-report path omits it.
async function doSendReport({ htmlContent, subject, recipients, entriesOverride }: {
  htmlContent: string; subject?: string; recipients?: string | string[]; entriesOverride?: Array<Record<string, any>>;
}) {
  const cfg = getEmailSmtpConfig();
  if (!cfg.host || !cfg.username || !cfg.password) throw new Error('Email not configured. Open Settings → Data to add SMTP credentials.');

  const toList = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : (recipients || cfg.defaultTo || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!toList.length) throw new Error('No recipients specified.');

  const entries = entriesOverride || dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [session.user.id])
    .map(r => ({ ...r, id: Number(r.rid) }));
  const companies = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [session.user.id])
    .reduce((m, co) => {
      try { const d = JSON.parse(decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, session.key)); m[Number(co.rid)] = d.name || ''; } catch {} return m;
    }, {});

  const csvHeader = ['Date','Company','Session','Task Label','Task Name','Description','Clock In','Clock Out','Minutes'];
  const csvRows = [];
  entries.forEach(e => {
    try {
      JSON.parse(e.rows_json || '[]').forEach(r => {
        if (!rowHasContent(r)) return; // C3 (D-011): desc-only rows export too
        // Flatten multi-line descriptions so the CSV column stays single-line.
        const descFlat = String(r.desc || r.description || '').replace(/\s+/g, ' ').trim();
        csvRows.push([e.log_date, companies[Number(e.company_id)] || '', e.session_label || '', r.label || '', r.name || '', descFlat, r.clock_in || '', r.clock_out || '', r.total_mins || 0]);
      });
    } catch {}
  });
  // Quote every field, double embedded quotes, and neutralize CSV formula
  // injection (leading = + - @ tab CR) by prefixing a single quote.
  const csvCell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [csvHeader, ...csvRows].map(r => r.map(csvCell).join(',')).join('\n');

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
    const get = k => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
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
    const fromDate = lastSent ? lastSent.slice(0, 10) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate   = new Date().toISOString().slice(0, 10);

    const entries: Array<Record<string, any>> = dbAll(
      'SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND log_date>=? AND log_date<=? ORDER BY log_date',
      [session.user.id, fromDate, toDate]
    ).map(r => ({ ...r, id: Number(r.rid) }));

    const companyRows = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [session.user.id]);
    const companies = {};
    companyRows.forEach(co => {
      try { companies[Number(co.rid)] = JSON.parse(decrypt({ data: co.data_enc, iv: co.data_iv, tag: co.data_tag }, session.key)).name || ''; } catch {}
    });

    const totalMins = entries.reduce((s, e) => s + (e.total_mins || 0), 0);
    const fmtM = m => { const h = Math.floor(m/60), mn = m%60; return `${h}h ${mn}m`; };

    const byLabel: Record<string, number> = {};
    entries.forEach(e => { try { JSON.parse(e.rows_json||'[]').forEach(r => { if (r.total_mins > 0) { const l = r.label||'Other'; byLabel[l]=(byLabel[l]||0)+r.total_mins; } }); } catch {} });
    const labelRows = Object.entries(byLabel).sort((a,b)=>b[1]-a[1])
      .map(([l,m]) => `<tr><td>${l}</td><td style="text-align:right">${fmtM(m)}</td></tr>`).join('');

    const htmlContent = `<!DOCTYPE html><html><head><title>Scheduled Report</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:40px;max-width:900px;margin:0 auto;}
h1{font-size:20px;font-weight:600;margin:0 0 4px;}h2{font-size:13px;font-weight:600;color:#374151;margin:20px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;}
.meta{color:#666;font-size:11px;margin-bottom:20px;}table{width:100%;border-collapse:collapse;}
th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:8px;text-align:left;font-size:11px;font-weight:600;}
td{padding:7px 8px;border-bottom:1px solid #e5e7eb;}
.footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;}
</style></head><body>
<h1>Conquered Time — Scheduled Report</h1>
<div class="meta">Period: ${fromDate} → ${toDate} · Total: ${fmtM(totalMins)}</div>
<h2>Task Label Breakdown</h2>
<table><thead><tr><th>Label</th><th style="text-align:right">Duration</th></tr></thead>
<tbody>${labelRows}</tbody></table>
<div class="footer">Generated by Conquered Time · ${new Date().toLocaleString()} · CONFIDENTIAL</div>
</body></html>`;

    const cfg = getEmailSmtpConfig();
    if (!cfg.host || !cfg.password) throw new Error('SMTP not configured.');
    const toList = (cfg.defaultTo || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!toList.length) throw new Error('No default recipient set. Add one in Settings → Data → Email Reports.');

    await doSendReport({
      htmlContent,
      subject: `Conquered Time Scheduled Report — ${toDate}`,
      recipients: toList,
      entriesOverride: entries,
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
  generatePDF, doSendReport, computeNextSendDate, runScheduledEmailCheck,
};
