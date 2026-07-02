'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  Read cache — pure, Electron-free, unit-testable.
//
//  The renderer's per-page Store (src/renderer/store.js) is recreated empty on
//  every loadFile() navigation, so it only dedups reads WITHIN a page. The data
//  itself lives in the main process for the whole session, and the cost that
//  repeats on every navigation is the AES-256-GCM decryption inside the
//  companies:list / entries:all / entries:summary handlers.
//
//  This cache memoizes those decrypted results in the main process so repeated
//  reads across navigations are free, until a mutation invalidates them.
//
//  Owner-keying (ownerId = sessionUser.id) is a defensive guard: if the owner
//  changes, the whole cache auto-clears before serving — so a missed clear on a
//  session reset can never leak one profile's plaintext into another's session.
// ════════════════════════════════════════════════════════════════════════════

/**
 * @returns {{ get: <T>(key: string, ownerId: unknown, compute: () => T) => T,
 *             invalidate: (...keys: string[]) => void,
 *             clear: () => void }}
 */
function createReadCache() {
  let owner = null;   // ownerId the cached values belong to
  let store = {};     // key → memoized value

  // Return the cached value for `key`, computing (and storing) it on a miss.
  // If `ownerId` differs from the cached owner, drop everything first.
  /**
   * @template T
   * @param {string} key
   * @param {unknown} ownerId
   * @param {() => T} compute
   * @returns {T}
   */
  function get(key, ownerId, compute) {
    if (ownerId !== owner) { store = {}; owner = ownerId; }
    if (!(key in store)) store[key] = compute();
    return store[key];
  }

  // Drop specific keys (next read recomputes). Unknown keys are ignored.
  /** @param {...string} keys */
  function invalidate(...keys) {
    for (const k of keys) delete store[k];
  }

  // Drop everything and forget the owner — use on session lifecycle resets
  // (login, lock, logout, profile delete) and whole-DB swaps (restore).
  function clear() {
    store = {};
    owner = null;
  }

  return { get, invalidate, clear };
}

module.exports = { createReadCache };
