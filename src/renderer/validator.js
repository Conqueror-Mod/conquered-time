'use strict';

// Input validation/normalization before IPC mutations.
// Returns { ok: true } or { ok: false, error: string }.
window.Validator = (() => {
  const TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

  function pad(t) {
    if (!t) return t;
    const [h, m] = t.split(':');
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function validateCompany(data) {
    if (!data || !data.name || !data.name.trim()) {
      return { ok: false, error: 'Company name is required.' };
    }
    data.name = data.name.trim();
    if (data.project)  data.project  = data.project.trim();
    if (data.platform) data.platform = data.platform.trim();
    if (data.nav_id)   data.nav_id   = data.nav_id.trim();
    return { ok: true };
  }

  function validateEntry(data) {
    if (data.clock_in  && !TIME_RE.test(data.clock_in))  return { ok: false, error: 'clock_in must be HH:MM (24-hour).' };
    if (data.clock_out && !TIME_RE.test(data.clock_out)) return { ok: false, error: 'clock_out must be HH:MM (24-hour).' };
    if (data.clock_in)  data.clock_in  = pad(data.clock_in);
    if (data.clock_out) data.clock_out = pad(data.clock_out);
    if (data.total_mins != null && (isNaN(data.total_mins) || data.total_mins < 0)) {
      return { ok: false, error: 'Duration must be a non-negative number.' };
    }
    return { ok: true };
  }

  return { validateCompany, validateEntry };
})();
