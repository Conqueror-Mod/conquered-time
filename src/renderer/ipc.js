'use strict';

// Thin wrapper around window.api.invoke — single call-site for all IPC channels.
// Normalizes errors consistently so pages never need try/catch around invoke calls.
window.IPC = (() => {
  // Read calls: return null on failure (callers guard with `|| []` / null-checks).
  async function call(channel, ...args) {
    try {
      return await window.api.invoke(channel, ...args);
    } catch (err) {
      console.error('[IPC]', channel, err);
      return null;
    }
  }

  // Mutation calls: always resolve to an { ok, ... } object so callers can safely
  // do `if (res.ok)` without risking a `null.ok` TypeError when the invoke rejects
  // or a handler returns nothing.
  async function callMut(channel, ...args) {
    try {
      const res = await window.api.invoke(channel, ...args);
      return (res && typeof res === 'object') ? res : { ok: false, error: 'No response from ' + channel };
    } catch (err) {
      console.error('[IPC]', channel, err);
      return { ok: false, error: err?.message || ('IPC call failed: ' + channel) };
    }
  }

  return {
    companies: {
      list:   ()       => call('companies:list'),
      save:   (data)   => callMut('companies:save', data),
      delete: (id)     => callMut('companies:delete', id),
    },
    entries: {
      list:    (compId) => call('entries:list', compId),
      all:     ()       => call('entries:all'),
      summary: ()       => call('entries:summary'),
      save:    (entry)  => callMut('entries:save', entry),
      active:  ()       => call('entries:get-active'),
    },
    tasks: {
      list:    (entryId) => call('tasks:list', entryId),
      summary: (entryId) => call('tasks:summary', entryId),
    },
    settings: {
      get: (key)        => call('settings:get', key),
      set: (key, value) => call('settings:set', { key, value }),
    },
    audit: {
      list:         ()      => call('audit:list'),
      getDismissed: ()      => call('audit:get-dismissed'),
      dismiss:      (id)    => call('audit:dismiss', id),
      applyFix:     (id)    => call('audit:apply-fix', id),
      getPolicy:    ()      => call('audit:get-policy'),
    },
    session: {
      get: () => call('session:get'),
    },
  };
})();
