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
  'entries:list', 'entries:save', 'entries:all', 'entries:summary', 'entries:get-active', 'entries:get',
  'tasks:list', 'tasks:save', 'tasks:delete', 'tasks:recent-labels', 'tasks:summary',
  'settings:get', 'settings:set',
  'app:get-info', 'app:check-update',
  'db:clear-timeclock', 'db:clear-companies', 'db:clear-full',
  'profile:get', 'profile:save', 'auth:change-password',
  'audit:get-policy', 'audit:get-dismissed', 'audit:dismiss', 'audit:undismiss', 'audit:clear-dismissed', 'audit:apply-fix', 'audit:open-wizard', 'audit:count', 'audit:email-notify',
  'backup:list', 'backup:preview', 'backup:restore',
  'email:save-config', 'email:get-config', 'email:test-smtp', 'email:send-report',
  'email:send-scheduled-now', 'email:get-schedule-status', 'email:trigger-schedule-check',
  'win:get-displays', 'win:move-to-display',
  'win:set-launch-at-startup', 'win:get-launch-at-startup',
  'win:get-close-to-tray', 'win:set-close-to-tray',
  'win:get-start-minimized', 'win:set-start-minimized'
]);

const ALLOWED_SEND = new Set([
  'win:minimize', 'win:maximize', 'win:close', 'navigate',
  'session:request-lock', 'session:confirm-close', 'session:confirm-lock',
  'shell:open-external'
]);

const ALLOWED_RECEIVE = new Set([
  'menu:export-pdf', 'menu:export-csv', 'toast', 'modal:security-info',
  'audit:close-warning', 'audit:wizard-done'
]);

contextBridge.exposeInMainWorld('api', {
  // Secure invoke (request/response)
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      throw new Error(`Blocked IPC invoke: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  // Secure fire-and-forget
  send: (channel, ...args) => {
    if (!ALLOWED_SEND.has(channel)) {
      throw new Error(`Blocked IPC send: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },

  // Secure event listener (main → renderer)
  on: (channel, callback) => {
    if (!ALLOWED_RECEIVE.has(channel)) {
      throw new Error(`Blocked IPC receive: ${channel}`);
    }
    const sub = (_, ...args) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  }
});
