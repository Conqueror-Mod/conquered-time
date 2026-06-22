'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of allowed channels — renderer cannot call anything else
const ALLOWED_INVOKE = new Set([
  'auth:check-setup', 'auth:setup', 'auth:login', 'auth:recover',
  'totp:generate',
  'session:get', 'session:heartbeat',
  'companies:list', 'companies:save', 'companies:delete',
  'entries:list', 'entries:save', 'entries:all', 'entries:get-active', 'entries:get',
  'tasks:list', 'tasks:save', 'tasks:delete', 'tasks:recent-labels',
  'settings:get', 'settings:set',
  'app:get-info',
  'db:clear-timeclock', 'db:clear-companies', 'db:clear-full',
  'audit:get-dismissed', 'audit:dismiss', 'audit:clear-dismissed', 'audit:apply-fix'
]);

const ALLOWED_SEND = new Set([
  'win:minimize', 'win:maximize', 'win:close', 'navigate',
  'session:request-lock', 'session:confirm-close', 'session:confirm-lock'
]);

const ALLOWED_RECEIVE = new Set([
  'menu:export-pdf', 'menu:export-csv', 'toast', 'modal:security-info',
  'audit:close-warning'
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
