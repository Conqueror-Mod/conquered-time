'use strict';

const { ipcMain } = require('electron');
const nodemailer = require('nodemailer');
const { session } = require('../session');
const { dbGet, dbRun, persistDB, hasDb } = require('../db');
const { encrypt } = require('../vault-crypto');
const { getEmailSmtpConfig, doSendReport, runScheduledEmailCheck, computeNextSendDate } = require('../email');

function register() {
ipcMain.handle('email:save-config', (_: unknown, { host, port, username, password, fromName, defaultTo }: Record<string, any>) => {
  if (!session.key) return { ok: false, error: 'Not logged in.' };
  try {
    const set = (k: string, v: any) => dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', [k, String(v || '')]);
    set('email_smtp_host', host);
    set('email_smtp_port', port || 587);
    set('email_smtp_username', username);
    set('email_smtp_from_name', fromName);
    set('email_smtp_default_to', defaultTo);
    if (password) {
      const enc = encrypt(password, session.key);
      set('email_smtp_password_enc', enc.data);
      set('email_smtp_password_iv',  enc.iv);
      set('email_smtp_password_tag', enc.tag);
    }
    persistDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:get-config', () => {
  if (!hasDb()) return {};
  const get = (k: string) => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
  const hasPassword = !!(get('email_smtp_password_enc'));
  return {
    host:       get('email_smtp_host'),
    port:       get('email_smtp_port') || '587',
    username:   get('email_smtp_username'),
    fromName:   get('email_smtp_from_name'),
    defaultTo:  get('email_smtp_default_to'),
    configured: !!(get('email_smtp_host') && get('email_smtp_username') && hasPassword),
    hasPassword,
  };
});

ipcMain.handle('email:test-smtp', async () => {
  if (!session.key) return { ok: false, error: 'Not logged in.' };
  try {
    const cfg = getEmailSmtpConfig();
    if (!cfg.host || !cfg.username) return { ok: false, error: 'SMTP host and username are required.' };
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port,
      secure: cfg.port === 465,
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     10000,
      auth: { user: cfg.username, pass: cfg.password },
    });
    await Promise.race([
      transport.verify(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connection timed out after 10 seconds')), 10000)),
    ]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// doSendReport lives in ./email.

ipcMain.handle('email:send-report', async (_: unknown, { htmlContent, subject, recipients }: Record<string, any>) => {
  if (!session.key || !session.user) return { ok: false, error: 'Not logged in.' };
  try {
    await doSendReport({ htmlContent, subject, recipients });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:trigger-schedule-check', async () => {
  await runScheduledEmailCheck();
  return { ok: true };
});

ipcMain.handle('email:send-scheduled-now', async () => {
  if (!session.key || !session.user) return { ok: false, error: 'Not logged in.' };
  try {
    const result = await runScheduledEmailCheck(true);
    if (result === false) return { ok: false, error: 'Schedule is set to Off — enable a frequency first.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('email:get-schedule-status', () => {
  if (!hasDb()) return {};
  const get = (k: string) => (dbGet('SELECT value FROM app_settings WHERE key=?', [k]) || {}).value || '';
  const freq      = get('email_schedule_freq') || 'off';
  const lastSent  = get('email_schedule_last_sent') || null;
  const lastError = get('email_schedule_last_error') || null;
  const sendTime  = get('email_schedule_time') || '08:00';
  const next      = freq !== 'off' ? computeNextSendDate(freq, lastSent) : null;
  if (next) {
    const [sh, sm] = sendTime.split(':').map(Number);
    next.setHours(sh, sm, 0, 0);
  }
  return { freq, lastSent, lastError, nextSend: next ? next.toISOString() : null };
});
}

module.exports = { register };
