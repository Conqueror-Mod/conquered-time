'use strict';

// In-memory data cache with pub/sub invalidation.
// All ID normalization (rowid → .id as Number) happens here — nowhere else.
//
// Usage:
//   const companies = await Store.getCompanies();
//   await Store.invalidate('companies');          // clears companies cache
//   Store.subscribe('companies', () => refresh()); // called after invalidate
window.Store = (() => {
  const _cache = { companies: null, entries: null };
  const _listeners = { companies: [], entries: [] };

  function _normalizeCompany(row) {
    if (row && row.rid != null) row.id = Number(row.rid);
    return row;
  }

  function _normalizeEntry(row) {
    if (row && row.rid != null) row.id = Number(row.rid);
    return row;
  }

  async function getCompanies() {
    if (!_cache.companies) {
      const raw = await window.IPC.companies.list() || [];
      _cache.companies = raw.map(_normalizeCompany);
    }
    return _cache.companies;
  }

  async function getEntries() {
    if (!_cache.entries) {
      const raw = await window.IPC.entries.all() || [];
      _cache.entries = raw.map(_normalizeEntry);
    }
    return _cache.entries;
  }

  function invalidate(key) {
    if (key === 'all') {
      _cache.companies = null;
      _cache.entries = null;
      _emit('companies');
      _emit('entries');
    } else if (key === 'companies' || key === 'entries') {
      _cache[key] = null;
      _emit(key);
    }
  }

  function subscribe(event, fn) {
    if (_listeners[event]) _listeners[event].push(fn);
  }

  function unsubscribe(event, fn) {
    if (_listeners[event]) _listeners[event] = _listeners[event].filter(f => f !== fn);
  }

  function _emit(event) {
    (_listeners[event] || []).forEach(fn => { try { fn(); } catch(e) { console.error('[Store] listener error', e); } });
  }

  return { getCompanies, getEntries, invalidate, subscribe, unsubscribe };
})();
