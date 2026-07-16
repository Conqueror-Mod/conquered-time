'use strict';

// Pure aggregation helpers for the Insights page. No DOM, no globals — every
// function takes plain data and returns plain data, so the numbers can be
// unit-tested independently of the rendering (mirrors row-utils.js / time-parse.js).
//
// Entry shape expected: { log_date:'YYYY-MM-DD', total_mins:number,
//   company_id:number, rows:Array<{clock_in?:string, clock_out?:string,
//   total_mins?:number}> }  — `rows` is the parsed rows_json.
//
// UMD-ish: classic <script> for the renderer (window.InsightsCompute) AND
// require()-able from the unit tests.
(function (root) {

  // Parse 'YYYY-MM-DD' as a LOCAL calendar date (never `new Date(str)` — that
  // parses as UTC midnight and can land on the previous day in western zones).
  function parseLocalDate(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  // Entries on/after cutoff (inclusive). cutoff '' / null → no filtering (All).
  // YYYY-MM-DD compares correctly as strings.
  function filterByRange(entries, cutoff) {
    if (!cutoff) return entries.slice();
    return entries.filter(e => e.log_date >= cutoff);
  }

  function sumMins(entries) {
    return entries.reduce((s, e) => s + (Number(e.total_mins) || 0), 0);
  }

  // company_id → total minutes.
  function byCompany(entries) {
    const m = {};
    entries.forEach(e => {
      const k = Number(e.company_id);
      m[k] = (m[k] || 0) + (Number(e.total_mins) || 0);
    });
    return m;
  }

  // minutes per weekday, index 0=Sun … 6=Sat (matches Date.getDay()).
  function byDayOfWeek(entries) {
    const out = [0, 0, 0, 0, 0, 0, 0];
    entries.forEach(e => {
      const dow = parseLocalDate(e.log_date).getDay();
      out[dow] += Number(e.total_mins) || 0;
    });
    return out;
  }

  // minutes per hour-of-day (0..23), distributing each punched row across the
  // hours it spans. Rows without both clock_in and clock_out are skipped (no
  // time span to place). Overnight rows (clock_out <= clock_in) wrap past
  // midnight. HH:MM only.
  function byHourOfDay(entries) {
    const out = new Array(24).fill(0);
    const toMin = t => {
      const [h, m] = String(t).split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    };
    entries.forEach(e => {
      (e.rows || []).forEach(r => {
        if (!r || !r.clock_in || !r.clock_out) return;
        let a = toMin(r.clock_in), b = toMin(r.clock_out);
        if (a == null || b == null) return;
        if (b <= a) b += 24 * 60;          // overnight
        for (let t = a; t < b; t++) {
          out[Math.floor(t / 60) % 24] += 1; // one minute into its hour bucket
        }
      });
    });
    return out;
  }

  // company_id → estimated earnings (hours × rate). rateMap: company_id → rate.
  function earningsByCompany(entries, rateMap) {
    const mins = byCompany(entries);
    const out = {};
    Object.keys(mins).forEach(k => {
      const rate = Number(rateMap[k]) || 0;
      if (rate > 0) out[k] = (mins[k] / 60) * rate;
    });
    return out;
  }

  // Monday (local) of the week containing d, as YYYY-MM-DD.
  function weekKey(d) {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (dt.getDay() + 6) % 7;   // 0 = Monday
    dt.setDate(dt.getDate() - dow);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Ordered trend buckets. bucket = 'week' | 'month'. Returns
  // [{ key, label, mins }] sorted ascending by key, with EMPTY buckets filled
  // in between the first and last so the trend line has no gaps.
  function trendBuckets(entries, bucket) {
    if (!entries.length) return [];
    const keyOf = e => {
      const d = parseLocalDate(e.log_date);
      return bucket === 'month'
        ? e.log_date.slice(0, 7)          // YYYY-MM
        : weekKey(d);
    };
    const sums = {};
    entries.forEach(e => {
      const k = keyOf(e);
      sums[k] = (sums[k] || 0) + (Number(e.total_mins) || 0);
    });
    const keys = Object.keys(sums).sort();
    const first = keys[0], last = keys[keys.length - 1];

    // Fill the gap between first and last so the series is continuous — but
    // capped: one corrupted/typo'd far-out date (e.g. year 9999) would
    // otherwise fill hundreds of thousands of empty buckets and hang the
    // renderer. Past ~10 years of span, skip the fill and plot only the
    // buckets that actually have data.
    const MAX_FILL = bucket === 'month' ? 121 : 522;
    const span = bucket === 'month'
      ? (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12
        + (Number(last.slice(5, 7)) - Number(first.slice(5, 7))) + 1
      : Math.floor((parseLocalDate(last).getTime() - parseLocalDate(first).getTime()) / (7 * 86400000)) + 1;
    if (span > MAX_FILL) {
      return keys.map(k => ({
        key: k,
        label: bucket === 'month' ? monthLabel(k) : weekLabel(k),
        mins: sums[k],
      }));
    }

    const filled = [];
    if (bucket === 'month') {
      let [y, m] = first.split('-').map(Number);
      const [ly, lm] = last.split('-').map(Number);
      while (y < ly || (y === ly && m <= lm)) {
        const k = `${y}-${String(m).padStart(2, '0')}`;
        filled.push(k);
        m++; if (m > 12) { m = 1; y++; }
      }
    } else {
      let cur = parseLocalDate(first);
      const end = parseLocalDate(last);
      while (cur <= end) {
        filled.push(weekKey(cur));
        cur.setDate(cur.getDate() + 7);
      }
    }
    return filled.map(k => ({
      key: k,
      label: bucket === 'month' ? monthLabel(k) : weekLabel(k),
      mins: sums[k] || 0,
    }));
  }

  function monthLabel(k) {
    const [y, m] = k.split('-').map(Number);
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[m - 1]} ${String(y).slice(2)}`;
  }
  function weekLabel(k) {
    const [, m, d] = k.split('-').map(Number);
    return `${m}/${d}`;
  }

  // Trailing moving average over a numeric series. window≥1. Each output[i] is
  // the mean of the up-to-`window` values ending at i.
  function movingAverage(values, window) {
    const w = Math.max(1, window | 0);
    return values.map((_, i) => {
      const start = Math.max(0, i - w + 1);
      const slice = values.slice(start, i + 1);
      return slice.reduce((s, v) => s + v, 0) / slice.length;
    });
  }

  const api = {
    parseLocalDate, filterByRange, sumMins, byCompany, byDayOfWeek,
    byHourOfDay, earningsByCompany, trendBuckets, movingAverage, weekKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InsightsCompute = api;
})(this);
