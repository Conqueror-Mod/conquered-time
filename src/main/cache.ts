'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  cache.ts — the main-process read cache singleton (Phase 2 extraction).
//
//  Memoizes decrypted session-wide reads (companies:list / entries:all /
//  entries:summary) across page navigations — see read-cache.js. Keyed on
//  the owner token; mutations invalidate, session resets clear().
// ════════════════════════════════════════════════════════════════════════════

const { createReadCache } = require('./read-cache');
const { session } = require('./session');

const readCache = createReadCache();

// Cache owner token. NOTE: session.user.id is the user's rowid, which is 1 in
// every profile vault — so it alone can't tell two profiles apart. Compose it
// with the profile dir (unique per profile) so switching profiles changes
// the owner and the cache auto-clears before serving another profile's data.
const cacheOwner = () => `${session.profileDir}#${session.user && session.user.id}`;

// Both entry views (full + summary) go stale together — mirrors the renderer
// Store's coupled invalidation (store.js).
const invalidateEntriesCache = () => readCache.invalidate('entriesAll', 'entriesSummary');

module.exports = { readCache, cacheOwner, invalidateEntriesCache };
