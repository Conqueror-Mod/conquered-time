'use strict';

// Thin wrapper around window.api.invoke — single call-site for all IPC channels.
// Normalizes errors consistently so pages never need try/catch around invoke calls.
window.IPC = (() => {
  // Read calls: return null on failure (callers guard with `|| []` / null-checks).
  async function call(channel: keyof IpcInvokeMap, ...args: any[]): Promise<any> {
    try {
      // any-cast: the generic PreloadApi.invoke signature can't accept a spread —
      // per-channel typing is enforced at the IpcWrapper surface instead.
      return await (window.api as any).invoke(channel, ...args);
    } catch (err) {
      console.error('[IPC]', channel, err);
      return null;
    }
  }

  // Mutation calls: always resolve to an { ok, ... } object so callers can safely
  // do `if (res.ok)` without risking a `null.ok` TypeError when the invoke rejects
  // or a handler returns nothing.
  async function callMut(channel: keyof IpcInvokeMap, ...args: any[]): Promise<MutResult> {
    try {
      const res = await (window.api as any).invoke(channel, ...args);
      return (res && typeof res === 'object') ? res : { ok: false, error: 'No response from ' + channel };
    } catch (err: any) {
      console.error('[IPC]', channel, err);
      return { ok: false, error: err?.message || ('IPC call failed: ' + channel) };
    }
  }

  return {
    companies: {
      list:   ()                  => call('companies:list'),
      save:   (data: any)         => callMut('companies:save', data),
      delete: (id: number)        => callMut('companies:delete', id),
    },
    entries: {
      list:    (compId: number)   => call('entries:list', compId),
      all:     ()                 => call('entries:all'),
      summary: ()                 => call('entries:summary'),
      save:    (entry: any)       => callMut('entries:save', entry) as Promise<EntrySaveResult>,
      active:  ()                 => call('entries:get-active'),
    },
    tasks: {
      list:    (entryId: number)  => call('tasks:list', entryId),
      summary: (entryId?: number) => call('tasks:summary', entryId),
    },
    settings: {
      get: (key: string)             => call('settings:get', key),
      set: (key: string, value: any) => call('settings:set', { key, value }),
    },
    audit: {
      list:         ()            => call('audit:list'),
      getDismissed: ()            => call('audit:get-dismissed'),
      dismiss:      (id: any)     => call('audit:dismiss', id),
      applyFix:     (id: any)     => call('audit:apply-fix', id),
      getPolicy:    ()            => call('audit:get-policy'),
    },
    session: {
      get: () => call('session:get'),
    },
  } as IpcWrapper;
})();
