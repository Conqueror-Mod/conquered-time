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
      String(rowDesc(r)).trim()
    );
  }

  const api = { rowHasContent, rowDesc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RowUtils = api;
})(this);
