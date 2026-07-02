'use strict';

// Input validation/normalization before IPC mutations.
// Returns { ok: true } or { ok: false, error: string }.
window.Validator = (() => {
  const TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

  /**
   * @param {string} t
   * @returns {string}
   */
  function pad(t) {
    if (!t) return t;
    const [h, m] = t.split(':');
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Company save payload (see companies.html saveCompany). The display `name`
  // is derived from an alias or the hierarchy company field, so it must exist.
  /**
   * @param {Partial<Company>} data — trimmed in place
   * @returns {ValidatorResult}
   */
  function validateCompany(data) {
    if (!data || !data.name || !data.name.trim()) {
      return { ok: false, error: 'Company name is required.' };
    }
    data.name = data.name.trim();
    if (data.hier_company)  data.hier_company  = data.hier_company.trim();
    if (data.hier_project)  data.hier_project  = data.hier_project.trim();
    if (data.hier_platform) data.hier_platform = data.hier_platform.trim();
    if (data.nav_id)        data.nav_id        = data.nav_id.trim();
    return { ok: true };
  }

  // Time-entry save payload (see tracker.html saveSession). Per-row clock times
  // live inside rows_json — validate each row's HH:MM and the rolled-up total.
  /**
   * @param {Partial<TimeEntry>} data — rows_json re-serialized with padded times
   * @returns {ValidatorResult}
   */
  function validateEntry(data) {
    if (data.total_mins != null && (isNaN(data.total_mins) || data.total_mins < 0)) {
      return { ok: false, error: 'Session duration must be a non-negative number.' };
    }
    if (data.rows_json) {
      let rows;
      try { rows = JSON.parse(data.rows_json); }
      catch { return { ok: false, error: 'Session rows are malformed.' }; }
      for (const r of rows) {
        if (r.clock_in  && !TIME_RE.test(r.clock_in))  return { ok: false, error: `Invalid clock-in "${r.clock_in}" — must be HH:MM (24-hour).` };
        if (r.clock_out && !TIME_RE.test(r.clock_out)) return { ok: false, error: `Invalid clock-out "${r.clock_out}" — must be HH:MM (24-hour).` };
        if (r.clock_in)  r.clock_in  = pad(r.clock_in);
        if (r.clock_out) r.clock_out = pad(r.clock_out);
      }
      data.rows_json = JSON.stringify(rows);
    }
    return { ok: true };
  }

  return { validateCompany, validateEntry };
})();
