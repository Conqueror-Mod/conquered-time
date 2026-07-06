'use strict';

// Shared "is this row real?" predicate (defect cluster C3, D-004/D-011).
// Historically each sink hand-rolled its own filter (`label||name`, sometimes
// +clock) and NONE considered the description — so a desc-only row (user
// content, no punch) was silently unaudited, invisible in the Global Log
// detail, and absent from every CSV/PDF export. This is the single source of
// truth: a row counts if ANY user-visible field holds content.
//
// UMD-ish: classic <script> for the renderer (window.RowUtils) AND
// require()-able from main.js and the unit tests.
(function (root) {

  /**
   * @param {EntryRow | null | undefined} r
   * @returns {string}
   */
  function rowDesc(r) {
    return (r && (r.desc || r.description)) || '';
  }

  // True when the row carries any user content: a punch, a label, a name, or
  // a description. Whitespace-only strings don't count.
  /**
   * @param {EntryRow | null | undefined} r
   * @returns {boolean}
   */
  function rowHasContent(r) {
    if (!r) return false;
    return !!(
      (r.clock_in  && String(r.clock_in).trim())  ||
      (r.clock_out && String(r.clock_out).trim()) ||
      (r.label     && String(r.label).trim())     ||
      (r.name      && String(r.name).trim())      ||
      // Check BOTH desc fields independently — rowDesc()'s desc-first
      // fallback would let a whitespace-only `desc` shadow a legacy
      // `description` that holds real content (found by fast-check,
      // seed 1046959924).
      (r.desc        && String(r.desc).trim())        ||
      (r.description && String(r.description).trim())
    );
  }

  // LOCAL calendar date as YYYY-MM-DD. The app's log_date values are local
  // dates, but `new Date().toISOString().slice(0,10)` is UTC — in the evening
  // (US timezones) that's already TOMORROW, which filed punches under the
  // wrong date and made "today" comparisons miss (the v3.13 stale-punch /
  // negative-timer bug). Every date-input default and "today" comparison must
  // go through this instead of toISOString.
  /**
   * @param {Date} [d]
   * @returns {string}
   */
  function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const api = { rowHasContent, rowDesc, localDateStr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RowUtils = api;
})(this);
