'use strict';

const { ipcMain } = require('electron');
const nodemailer = require('nodemailer');
const { session, decryptEntry } = require('../session');
const { dbAll, dbGet, dbRun, persistDB } = require('../db');
const { performBackup } = require('../backups');
const { encrypt } = require('../vault-crypto');
const { getPolicy, STATE_POLICY, STATE_NAMES, getPomodoroPreset } = require('../policies');
const { countAuditDiscrepancies } = require('../audit');
const { getProfileEmail, getEmailSmtpConfig } = require('../email');

// ctx.createAuditWizardWindow — window creation stays in main.
function register(ctx: Record<string, any>) {
  const { createAuditWizardWindow } = ctx;
// ── IPC: Audit policy ────────────────────────────────────────────────────
ipcMain.handle('audit:get-policy', () => {
  const stateCode = session.user?.work_state || null;
  const policy    = getPolicy(stateCode);
  const stateName = stateCode ? (STATE_NAMES[stateCode] || stateCode) : null;
  // Replace Infinity with null so serialization is safe across IPC boundary
  const safeThresholds = policy.breakThresholds.map(([t, c]: [any, any]) => [isFinite(t) ? t : null, c]);
  return {
    stateCode, stateName, policyLabel: policy.label,
    // C5 (D-007): true only when the state has its OWN policy tier. Default-
    // tier states (e.g. TX) must not get "<State> law requires…" copy — that
    // implies a legal mandate that doesn't exist.
    hasStatePolicy: !!(stateCode && STATE_POLICY[stateCode]),
    breakThresholds: safeThresholds,
    lunchThreshMins: policy.lunchThreshMins,
    dispatchBreakWarnMins: isFinite(policy.dispatchBreakWarnMins) ? policy.dispatchBreakWarnMins : null,
    dispatchLunchWarnMins: isFinite(policy.dispatchLunchWarnMins) ? policy.dispatchLunchWarnMins : null,
    // Break-style preference (Profile page). 'pomodoro' swaps the LIVE cadence
    // warnings/timer for the preset below; the audit fields above stay state-
    // policy-driven regardless — compliance is never judged by Pomodoro.
    breakStyle: session.user?.break_style === 'pomodoro' ? 'pomodoro' : 'state',
    pomodoroPreset: session.user?.pomodoro_preset || 'classic',
    pomodoro: getPomodoroPreset(session.user?.pomodoro_preset),
  };
});

// ── IPC: Audit dismissed ──────────────────────────────────────────────────
ipcMain.handle('audit:get-dismissed', () => {
  if (!session.user) return [];
  return dbAll('SELECT entry_id, row_idx, type, emailed_at FROM audit_dismissed WHERE user_id=?', [session.user.id]);
});

ipcMain.handle('audit:dismiss', (_: unknown, { entry_id, row_idx, type }: Record<string, any>) => {
  if (!session.user) return { ok: false };
  dbRun(
    'INSERT OR IGNORE INTO audit_dismissed (user_id, entry_id, row_idx, type) VALUES (?,?,?,?)',
    [session.user.id, Number(entry_id), Number(row_idx), type]
  );
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:undismiss', (_: unknown, { entry_id, row_idx, type }: Record<string, any>) => {
  if (!session.user) return { ok: false };
  dbRun('DELETE FROM audit_dismissed WHERE user_id=? AND entry_id=? AND row_idx=? AND type=?',
    [session.user.id, Number(entry_id), Number(row_idx), type]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:clear-dismissed', () => {
  if (!session.user) return { ok: false };
  dbRun('DELETE FROM audit_dismissed WHERE user_id=?', [session.user.id]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('audit:apply-fix', (_: unknown, { entry_id, row_idx, fix_type, updated_at }: Record<string, any>) => {
  if (!session.key || !session.user) return { ok: false };
  // Only these discrepancy types have an automated fix. Everything else
  // (e.g. missing_break / missing_lunch) is acknowledge-only by design — reject
  // explicitly so the dismiss-only guarantee can't be bypassed by a forged call.
  const ALLOWED_FIXES = ['set_clock_out', 'recalc_duration'];
  if (!ALLOWED_FIXES.includes(fix_type)) {
    return { ok: false, error: `No automated fix for "${fix_type}" — this discrepancy is acknowledge-only.` };
  }
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(entry_id), session.user.id]);
  if (!row) return { ok: false, error: 'Entry not found' };
  // Optimistic-concurrency guard (mirrors entries:save). Apply Fix operates on a
  // row_idx and a discrepancy the audit view captured from an entries:all
  // snapshot; if that row was saved by another writer (the tracker) since, the
  // index/discrepancy may no longer be valid and applying blindly could target
  // the wrong row or re-apply a stale fix. When the caller supplies the
  // updated_at it last read, reject a stale apply so the audit view re-fetches.
  if (updated_at != null && Number(row.updated_at) !== Number(updated_at)) {
    return { ok: false, stale: true };
  }
  try {
    decryptEntry(row);
    const rows = JSON.parse(row.rows_json || '[]');
    const r = rows[row_idx];
    if (!r) return { ok: false, error: 'Row not found' };

    if (fix_type === 'set_clock_out') {
      // Set clock-out to clock-in + 8h, capped at 23:59
      if (!r.clock_in) return { ok: false, error: 'No clock-in to base fix on' };
      const [h, m] = r.clock_in.split(':').map(Number);
      const outMins = Math.min(h * 60 + m + 480, 23 * 60 + 59);
      const outH = String(Math.floor(outMins / 60)).padStart(2, '0');
      const outM = String(outMins % 60).padStart(2, '0');
      r.clock_out  = `${outH}:${outM}`;
      r.total_mins = outMins - (h * 60 + m);
    } else if (fix_type === 'recalc_duration') {
      if (!r.clock_in || !r.clock_out) return { ok: false, error: 'Need both clock-in and clock-out' };
      const [ih, im] = r.clock_in.split(':').map(Number);
      const [oh, om] = r.clock_out.split(':').map(Number);
      r.total_mins = (oh * 60 + om) - (ih * 60 + im);
    }

    rows[row_idx] = r;
    const newJson  = JSON.stringify(rows);
    const newTotal = rows.reduce((s: any, row: any) => s + (row.total_mins || 0), 0);
    const enc      = encrypt(newJson, session.key);
    dbRun(
      'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
      [enc.data, enc.iv, enc.tag, '', newTotal, Number(entry_id), session.user.id]
    );
    persistDB(); performBackup();
    // Return the fresh updated_at so a caller applying SEVERAL fixes to the
    // same entry (the wizard) can keep its concurrency token current — without
    // this, fix #2 on the same entry would be stale-rejected by fix #1's bump.
    const after = dbGet('SELECT updated_at FROM time_entries WHERE rowid=? AND user_id=?',
      [Number(entry_id), session.user.id]);
    return { ok: true, updated_at: after ? Number(after.updated_at) : null };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('audit:open-wizard', (_: unknown, { mode, theme }: { mode?: string; theme?: string } = {}) => {
  createAuditWizardWindow(mode, theme);
  return { ok: true };
});

// Count of non-dismissed audit discrepancies — used for the at-login notice.
ipcMain.handle('audit:count', () => countAuditDiscrepancies());

// Consent-gated audit notification: email the user about a discrepancy (never
// modifies a punch — fixes still require an explicit Apply Fix). On success the
// discrepancy is recorded as emailed (emailed_at) so it's silenced on close/lock
// but kept visible in the audit log.
ipcMain.handle('audit:email-notify', async (_: unknown, { entry_id, row_idx, type, subject, message }: Record<string, any> = {}) => {
  if (!session.key || !session.user) return { ok: false, error: 'Not logged in.' };
  const to = getProfileEmail();
  if (!to) return { ok: false, error: 'Add an email to your profile first (Profile screen).' };
  const cfg = getEmailSmtpConfig();
  if (!cfg.host || !cfg.username || !cfg.password) {
    return { ok: false, error: 'Email not configured. Open Settings → Reports to add SMTP credentials.' };
  }
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.port === 465,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      auth: { user: cfg.username, pass: cfg.password },
    });
    const fromAddr = cfg.fromName ? `"${cfg.fromName}" <${cfg.username}>` : cfg.username;
    const safeMsg  = String(message || 'A timesheet discrepancy needs your attention.')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    await transport.sendMail({
      from: fromAddr, to,
      subject: subject || 'Conquered Time — timesheet discrepancy',
      html: `<p>${safeMsg}</p>
             <p style="color:#374151;font-size:13px">Review it in Conquered Time under <strong>Reports &rarr; Audit</strong>. No changes were made to your timesheet — applying a fix always requires your confirmation in the app.</p>
             <p style="color:#9ca3af;font-size:12px">Sent ${new Date().toLocaleString()} · CONFIDENTIAL</p>`,
    });
    // Record as emailed/acknowledged (silenced on close, kept in the log).
    const args = [session.user.id, Number(entry_id), Number(row_idx), type];
    dbRun('INSERT OR IGNORE INTO audit_dismissed (user_id, entry_id, row_idx, type) VALUES (?,?,?,?)', args);
    dbRun('UPDATE audit_dismissed SET emailed_at=strftime(\'%s\',\'now\') WHERE user_id=? AND entry_id=? AND row_idx=? AND type=?', args);
    persistDB();
    return { ok: true, to };
  } catch (e) { return { ok: false, error: e.message }; }
});
}

module.exports = { register };
