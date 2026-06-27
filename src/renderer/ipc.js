'use strict';

// Thin wrapper around window.api.invoke — single call-site for all IPC channels.
// Normalizes errors consistently so pages never need try/catch around invoke calls.
window.IPC = (() => {
  async function call(channel, ...args) {
    try {
      return await window.api.invoke(channel, ...args);
    } catch (err) {
      console.error('[IPC]', channel, err);
      return null;
    }
  }

  return {
    companies: {
      list:   ()       => call('companies:list'),
      save:   (data)   => call('companies:save', data),
      delete: (id)     => call('companies:delete', id),
    },
    entries: {
      list:    (compId) => call('entries:list', compId),
      all:     ()       => call('entries:all'),
      summary: ()       => call('entries:summary'),
      save:    (entry)  => call('entries:save', entry),
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
