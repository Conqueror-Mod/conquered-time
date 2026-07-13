'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of allowed channels — renderer cannot call anything else
const ALLOWED_INVOKE = new Set([
  'profiles:list', 'profiles:select', 'profiles:load', 'profiles:deselect', 'profiles:delete',
  'auth:check-setup', 'auth:setup', 'auth:login', 'auth:recover', 'auth:browse-backup',
  'auth:safe-check', 'auth:safe-setup', 'auth:safe-login', 'auth:safe-disable', 'auth:quick-unlock',
  'totp:generate',
  'session:get', 'session:heartbeat',
  'companies:list', 'companies:save', 'companies:delete',
  'entries:list', 'entries:save', 'entries:delete', 'entries:all', 'entries:summary', 'entries:get-active', 'entries:get',
  'tasks:list', 'tasks:save', 'tasks:delete', 'tasks:recent-labels', 'tasks:summary',
  'settings:get', 'settings:set',
  'app:get-info', 'app:notify',
  'update:check', 'update:download', 'update:install', 'update:status', 'update:just-updated',
  'db:clear-timeclock', 'db:clear-timeclock-company', 'db:clear-companies', 'db:clear-full',
  'profile:get', 'profile:save', 'auth:change-password',
  'audit:get-policy', 'audit:get-dismissed', 'audit:dismiss', 'audit:undismiss', 'audit:clear-dismissed', 'audit:apply-fix', 'audit:open-wizard', 'audit:count', 'audit:email-notify',
  'backup:list', 'backup:preview', 'backup:restore', 'backup:export-portable',
  'email:save-config', 'email:get-config', 'email:test-smtp', 'email:send-report',
  'email:send-scheduled-now', 'email:get-schedule-status', 'email:trigger-schedule-check',
  'invoices:context', 'invoices:preview', 'invoices:issue', 'invoices:list', 'invoices:get',
  'invoices:set-status', 'invoices:save-pdf', 'invoices:email', 'invoices:get-counter', 'invoices:set-counter',
  'win:get-displays', 'win:move-to-display', 'win:get-current-display',
  'win:set-launch-at-startup', 'win:get-launch-at-startup',
  'win:get-close-to-tray', 'win:set-close-to-tray',
  'win:get-start-minimized', 'win:set-start-minimized',
  'win:get-punch-hotkey', 'win:set-punch-hotkey',
  'win:set-zoom',
  'beta:status', 'beta:redeem'
]);

const ALLOWED_SEND = new Set([
  'win:minimize', 'win:maximize', 'win:close', 'navigate',
  'session:request-lock', 'session:confirm-close', 'session:confirm-lock',
  'shell:open-external'
]);

const ALLOWED_RECEIVE = new Set([
  'menu:export-pdf', 'menu:export-csv', 'toast', 'modal:security-info',
  'audit:close-warning', 'audit:wizard-done', 'update:status', 'punch:changed'
]);

// The exposed surface is typed as PreloadApi in types/globals.d.ts — the
// IpcInvokeMap there is the single source of truth for channel payload shapes.
contextBridge.exposeInMainWorld('api', {
  // Secure invoke (request/response)
  /**
   * @param {string} channel
   * @param {...*} args
   */
  invoke: (channel: string, ...args: any[]) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      throw new Error(`Blocked IPC invoke: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  // Secure fire-and-forget
  /**
   * @param {string} channel
   * @param {...*} args
   */
  send: (channel: string, ...args: any[]) => {
    if (!ALLOWED_SEND.has(channel)) {
      throw new Error(`Blocked IPC send: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },

  // Secure event listener (main → renderer)
  /**
   * @param {string} channel
   * @param {(...args: any[]) => void} callback
   * @returns {() => void} unsubscribe
   */
  on: (channel: string, callback: (...a: any[]) => void) => {
    if (!ALLOWED_RECEIVE.has(channel)) {
      throw new Error(`Blocked IPC receive: ${channel}`);
    }
    const sub = (_: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  }
});
