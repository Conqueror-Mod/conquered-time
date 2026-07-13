'use strict';

// CSV import parsing / mapping / validation for the Data Import feature.
// Pure + UMD: `window.ImportParse` for the renderer (import.html), and
// require()-able for test/import-parse.test.js. No DOM, no IPC.
//
// Turns a raw CSV string + a header→field mapping into validated Company and
// time-Session records ready for the `import:commit` IPC. Time parsing reuses
// time-parse.js (parseClockInput / computeDiffMins) so import matches exactly
// what the tracker accepts and stores (24h HH:MM, midnight-wrap durations).
(function (root) {

  // In Node (tests) require the sibling; in the renderer both are window globals
  // (import.html loads time-parse.js before this file).
  const TP = (typeof module !== 'undefined' && module.exports)
    ? require('./time-parse.js')
    : { parseClockInput: root.parseClockInput, computeDiffMins: root.computeDiffMins };

  // ── Target field schemas ───────────────────────────────────────────────────
  // `aliases` are lowercased header spellings we auto-map from. Keep the labels
  // aligned with the Global Log CSV *export* header so export→import round-trips.
  const COMPANY_FIELDS = [
    { key: 'name',            label: 'Company Name',    required: true, aliases: ['company', 'client', 'company name', 'name', 'client name'] },
    { key: 'hier_company',    label: 'Company Group',   aliases: ['group', 'parent', 'company group', 'hier company'] },
    { key: 'hier_project',    label: 'Project',         aliases: ['project'] },
    { key: 'hier_platform',   label: 'Platform',        aliases: ['platform'] },
    { key: 'nav_id',          label: 'Navigator ID',    aliases: ['navigator id', 'nav id', 'navid', 'worker id'] },
    { key: 'job_title',       label: 'Job Title',       aliases: ['title', 'role', 'job title', 'job'] },
    { key: 'work_type',       label: 'Work Type',       aliases: ['type', 'work type'] },
    { key: 'location',        label: 'Location',        aliases: ['location'] },
    { key: 'pay_rate',        label: 'Pay Rate',        aliases: ['rate', 'pay rate', 'hourly rate', 'hourly'] },
    { key: 'currency',        label: 'Currency',        aliases: ['currency'] },
    { key: 'billing_address', label: 'Billing Address', aliases: ['billing address', 'address', 'bill to'] },
    { key: 'date_start',      label: 'Start Date',      aliases: ['start', 'start date', 'started'] },
    { key: 'date_end',        label: 'End Date',        aliases: ['end', 'end date', 'ended'] },
    { key: 'platform_login',  label: 'Platform Login',  aliases: ['login', 'username', 'platform login'] },
    { key: 'platform_email',  label: 'Platform Email',  aliases: ['platform email', 'work email'] },
    { key: 'platform_url',    label: 'Platform URL',    aliases: ['url', 'platform url', 'website', 'link'] },
    { key: 'supervisors',     label: 'Supervisors',     aliases: ['supervisor', 'supervisors', 'manager'] },
    { key: 'notes',           label: 'Notes',           aliases: ['notes', 'note', 'comments'] },
  ];

  const ENTRY_FIELDS = [
    { key: 'company',       label: 'Company',          required: true, aliases: ['company', 'client', 'company name', 'client name'] },
    { key: 'log_date',      label: 'Date',             required: true, aliases: ['date', 'day', 'log date', 'work date'] },
    { key: 'session_label', label: 'Session',          aliases: ['session', 'session label', 'shift'] },
    { key: 'task_label',    label: 'Task Label',       aliases: ['task label', 'label', 'category'] },
    { key: 'task_name',     label: 'Task Name',        aliases: ['task name', 'task', 'name', 'activity'] },
    { key: 'description',   label: 'Description',       aliases: ['description', 'desc', 'details'] },
    { key: 'clock_in',      label: 'Clock In',         aliases: ['clock in', 'start time', 'time in', 'in'] },
    { key: 'clock_out',     label: 'Clock Out',        aliases: ['clock out', 'end time', 'time out', 'out'] },
    { key: 'duration_mins', label: 'Duration (mins)',  aliases: ['duration (mins)', 'duration', 'minutes', 'mins', 'total mins'] },
  ];

  const pad = (v) => String(v).padStart(2, '0');
  const rowNonEmpty = (r) => r.some((c) => String(c || '').trim() !== '');

  // "$42.50", "1,250" → number; '' / junk → NaN.
  function parseNum(v) {
    const s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
    if (s === '') return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // ── CSV parser (RFC-4180-ish) ──────────────────────────────────────────────
  // Handles quoted fields, embedded commas/quotes ("") /newlines, CRLF or LF,
  // and a leading BOM. First non-blank row = headers; fully-blank rows dropped.
  function parseCSV(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let field = '', row = [], inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // ignore; the paired \n (or EOF) closes the row
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter(rowNonEmpty);
    if (!nonEmpty.length) return { headers: [], rows: [] };
    return { headers: nonEmpty[0].map((h) => String(h).trim()), rows: nonEmpty.slice(1) };
  }

  // ── Auto-map headers → fields (case-insensitive, one header per field) ──────
  function autoMap(headers, fields) {
    const norm = (h) => String(h || '').trim().toLowerCase();
    const map = {};
    const used = new Set();
    for (const f of fields) {
      const cand = [f.label.toLowerCase(), ...(f.aliases || [])];
      let idx = -1;
      for (let h = 0; h < headers.length; h++) {
        if (used.has(h)) continue;
        if (cand.includes(norm(headers[h]))) { idx = h; break; }
      }
      map[f.key] = idx;
      if (idx >= 0) used.add(idx);
    }
    return map;
  }

  // ── Date normalization → 'YYYY-MM-DD' (US MM/DD assumption), else null ──────
  function normalizeDate(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let m, y, mo, d;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) {
      mo = +m[1]; d = +m[2]; y = +m[3];   // US month-first
    } else {
      return null;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  const getter = (r, mapping) => (key) =>
    (mapping[key] != null && mapping[key] >= 0) ? String(r[mapping[key]] == null ? '' : r[mapping[key]]).trim() : '';

  // ── Build Company records ───────────────────────────────────────────────────
  // Returns { companies, errors }. Row numbers are 1-based data rows + header.
  function buildCompanies(rows, mapping) {
    const companies = [], errors = [];
    rows.forEach((r, i) => {
      if (!rowNonEmpty(r)) return;
      const get = getter(r, mapping);
      const name = get('name');
      if (!name) { errors.push({ row: i + 2, msg: 'Missing company name' }); return; }
      const co = { name };
      for (const f of COMPANY_FIELDS) {
        if (f.key === 'name') continue;
        const v = get(f.key);
        if (!v) continue;
        if (f.key === 'pay_rate') { const n = parseNum(v); if (Number.isFinite(n)) co.pay_rate = n; }
        else co[f.key] = v;
      }
      companies.push(co);
    });
    return { companies, errors };
  }

  // ── Build time Sessions ─────────────────────────────────────────────────────
  // Rows sharing company+date+session collapse into one multi-row session
  // (mirrors tracker storage). Returns { sessions, companies (distinct names to
  // ensure exist), errors }. Bad rows are collected in errors and skipped.
  function buildEntries(rows, mapping) {
    const byKey = new Map();
    const sessions = [], errors = [];
    const companyNames = new Set();
    rows.forEach((r, i) => {
      const rownum = i + 2;
      if (!rowNonEmpty(r)) return;
      const get = getter(r, mapping);
      const company = get('company');
      if (!company) { errors.push({ row: rownum, msg: 'Missing company' }); return; }
      const dateRaw = get('log_date');
      const log_date = normalizeDate(dateRaw);
      if (!log_date) { errors.push({ row: rownum, msg: `Unrecognized date: "${dateRaw}"` }); return; }

      let clock_in = '', clock_out = '';
      const ci = get('clock_in'), co = get('clock_out');
      if (ci) { const p = TP.parseClockInput(ci); if (!p.ok) { errors.push({ row: rownum, msg: `Unrecognized clock-in: "${ci}"` }); return; } clock_in = p.hhmm; }
      if (co) { const p = TP.parseClockInput(co); if (!p.ok) { errors.push({ row: rownum, msg: `Unrecognized clock-out: "${co}"` }); return; } clock_out = p.hhmm; }

      let total_mins = parseNum(get('duration_mins'));
      if (!(total_mins > 0) && clock_in && clock_out) total_mins = TP.computeDiffMins(clock_in, clock_out);
      total_mins = Math.max(0, Math.round(Number.isFinite(total_mins) ? total_mins : 0));

      const rowObj = {
        label: get('task_label'), name: get('task_name'), desc: get('description'),
        clock_in, clock_out, total_mins,
      };
      const session_label = get('session_label');
      const key = `${company}||${log_date}||${session_label}`;
      companyNames.add(company);
      let sess = byKey.get(key);
      if (!sess) { sess = { company, log_date, session_label, rows: [] }; byKey.set(key, sess); sessions.push(sess); }
      sess.rows.push(rowObj);
    });
    sessions.forEach((s) => { s.total_mins = s.rows.reduce((t, r) => t + (r.total_mins || 0), 0); });
    return { sessions, companies: [...companyNames], errors };
  }

  const api = { parseCSV, autoMap, normalizeDate, buildCompanies, buildEntries, COMPANY_FIELDS, ENTRY_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImportParse = api;
})(this);
