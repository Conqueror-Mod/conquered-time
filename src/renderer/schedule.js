'use strict';

// Recurring schedule + pay period helpers (docs/PLAN-recurring-schedule.md).
// Pure: no DOM, no globals, no clock reads unless the caller omits `today`.
// Every date is a LOCAL 'YYYY-MM-DD' string — never toISOString (UTC trap).
//
// UMD-ish: classic <script> for the renderer (window.Schedule), require()-able
// from the unit tests AND the main process (entries:fill-schedule builds the
// filled rows through slotRows/slotsOn so renderer and main can't disagree).
(function (root) {

  const pad = n => String(n).padStart(2, '0');

  function parseLocalDate(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function dateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function isDateStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    return dateStr(parseLocalDate(s)) === s;   // rejects 2026-02-30 etc.
  }
  // Date-part arithmetic — DST-safe (a 23/25-hour day can't shift the date).
  function addDays(s, n) {
    const d = parseLocalDate(s);
    return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }
  // Whole days from a to b (b - a). UTC of the local parts, so DST never
  // produces a fractional day.
  function daysBetween(a, b) {
    const pa = parseLocalDate(a), pb = parseLocalDate(b);
    return Math.round((Date.UTC(pb.getFullYear(), pb.getMonth(), pb.getDate()) -
                       Date.UTC(pa.getFullYear(), pa.getMonth(), pa.getDate())) / 86400000);
  }
  function weekday(s) { return parseLocalDate(s).getDay(); }

  // 'HH:MM' → minutes since midnight, or null.
  function toMin(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function fromMin(m) {
    const v = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
  }
  // Slot length in minutes; an end at/before the start wraps past midnight.
  function slotMins(slot) {
    const a = toMin(slot && slot.start), b = toMin(slot && slot.end);
    if (a == null || b == null) return 0;
    return (b <= a ? b + 1440 : b) - a;
  }
  function median(nums) {
    const s = nums.slice().sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  const round15 = m => Math.round(m / 15) * 15;

  // ── Detection ────────────────────────────────────────────────────────────
  // entries: [{ company_id, log_date, rows: [{clock_in, clock_out, label, name}] }]
  // A company's day is reduced to ONE span (earliest clock-in → latest
  // clock-out) so a mid-shift break doesn't split the slot. Spans on the same
  // weekday cluster when start AND end are within `tolerance` minutes; a
  // cluster is a recurring slot when it shows up in >= minWeeks weeks and in
  // >= minRatio of the weeks since it first appeared.
  const DETECT_DEFAULTS = { weeks: 8, minWeeks: 3, minRatio: 0.6, tolerance: 20 };

  function detectSchedule(entries, opts) {
    const o = Object.assign({}, DETECT_DEFAULTS, opts || {});
    const today = o.today || dateStr(new Date());
    const from = addDays(today, -(o.weeks * 7 - 1));

    // company|date → day span
    const days = new Map();
    for (const e of entries || []) {
      if (!e || !isDateStr(e.log_date) || e.log_date < from || e.log_date > today) continue;
      const cid = Number(e.company_id);
      for (const r of e.rows || []) {
        if (!r) continue;
        const a = toMin(r.clock_in);
        let b = toMin(r.clock_out);
        if (a == null || b == null) continue;
        if (b <= a) b += 1440;                       // overnight row
        const k = `${cid}|${e.log_date}`;
        let d = days.get(k);
        if (!d) { d = { cid, date: e.log_date, start: a, end: b, pairs: new Map() }; days.set(k, d); }
        d.start = Math.min(d.start, a);
        d.end = Math.max(d.end, b);
        const label = String(r.label || '').trim(), name = String(r.name || '').trim();
        if (label || name) {
          const pk = `${label}\u0000${name}`;
          d.pairs.set(pk, (d.pairs.get(pk) || 0) + 1);
        }
      }
    }

    // company|weekday → [day spans], date-ordered
    const groups = new Map();
    for (const d of days.values()) {
      const k = `${d.cid}|${weekday(d.date)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(d);
    }

    const slots = [];
    for (const [gk, list] of groups) {
      const [cidStr, wdStr] = gk.split('|');
      const cid = Number(cidStr), wd = Number(wdStr);
      list.sort((x, y) => (x.date < y.date ? -1 : 1));
      const clusters = [];
      for (const d of list) {
        // Join the nearest cluster within tolerance (centre = running mean).
        let best = null, bestDist = Infinity;
        for (const c of clusters) {
          const ds = Math.abs(d.start - c.cs), de = Math.abs(d.end - c.ce);
          if (ds <= o.tolerance && de <= o.tolerance && ds + de < bestDist) { best = c; bestDist = ds + de; }
        }
        if (!best) { best = { members: [], cs: d.start, ce: d.end }; clusters.push(best); }
        best.members.push(d);
        best.cs = best.members.reduce((s, m) => s + m.start, 0) / best.members.length;
        best.ce = best.members.reduce((s, m) => s + m.end, 0) / best.members.length;
      }

      // Last date <= today on this weekday. If that's today and today has no
      // matching span yet, today's shift may simply still be ahead — don't
      // count it as a miss.
      const lastCandidate = addDays(today, -((weekday(today) - wd + 7) % 7));
      for (const c of clusters) {
        const first = c.members[0].date;
        const seenDates = new Set(c.members.map(m => m.date));
        let total = Math.floor(daysBetween(first, lastCandidate) / 7) + 1;
        if (lastCandidate === today && !seenDates.has(today)) total -= 1;
        const seen = seenDates.size;
        if (total < 1 || seen < o.minWeeks || seen / total < o.minRatio) continue;

        const start = round15(median(c.members.map(m => m.start)));
        let end = round15(median(c.members.map(m => m.end)));
        if (end <= start) end = start + 15;
        // Most common Task Label + Name across the occurrences.
        const tally = new Map();
        for (const m of c.members) for (const [pk, n] of m.pairs) tally.set(pk, (tally.get(pk) || 0) + n);
        let topPair = '', topN = 0;
        for (const [pk, n] of tally) if (n > topN) { topPair = pk; topN = n; }
        const [label, name] = topPair ? topPair.split('\u0000') : ['', ''];
        const slot = {
          weekday: wd, start: fromMin(start), end: fromMin(end), label, name,
          companyId: cid, weeksSeen: seen, weeksTotal: total,
          confidence: Math.min(1, seen / total),
        };
        slot.id = slotId(slot);
        slot.mins = slotMins(slot);
        slots.push(slot);
      }
    }
    slots.sort((a, b) => a.companyId - b.companyId || a.weekday - b.weekday || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return slots;
  }

  function slotId(s) { return `${s.weekday}-${s.start}-${s.end}`; }

  // True when the detected slots no longer match the saved ones (by
  // weekday + start + end). Labels don't count as drift.
  function scheduleDiffers(detected, saved) {
    const a = new Set((detected || []).map(slotId));
    const b = new Set((saved || []).map(slotId));
    if (a.size !== b.size) return true;
    for (const k of a) if (!b.has(k)) return true;
    return false;
  }

  // ── Pay periods ─────────────────────────────────────────────────────────
  // pp: { kind: 'weekly'|'biweekly'|'semimonthly'|'monthly', anchor?: 'YYYY-MM-DD' }
  // weekly: weeks start on the anchor's weekday (Sunday when no anchor —
  // matches the Dashboard week band). biweekly: 14-day blocks counted from the
  // anchor (either direction). No/unknown kind → weekly from Sunday.
  const PAY_PERIOD_KINDS = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

  function periodFor(date, pp) {
    const kind = pp && PAY_PERIOD_KINDS.includes(pp.kind) ? pp.kind : 'weekly';
    const anchor = pp && isDateStr(pp.anchor) ? pp.anchor : null;
    const d = parseLocalDate(date);
    if (kind === 'semimonthly') {
      const y = d.getFullYear(), m = d.getMonth();
      return d.getDate() <= 15
        ? { start: dateStr(new Date(y, m, 1)), end: dateStr(new Date(y, m, 15)) }
        : { start: dateStr(new Date(y, m, 16)), end: dateStr(new Date(y, m + 1, 0)) };
    }
    if (kind === 'monthly') {
      const y = d.getFullYear(), m = d.getMonth();
      return { start: dateStr(new Date(y, m, 1)), end: dateStr(new Date(y, m + 1, 0)) };
    }
    if (kind === 'biweekly' && anchor) {
      const k = Math.floor(daysBetween(anchor, date) / 14);
      const start = addDays(anchor, k * 14);
      return { start, end: addDays(start, 13) };
    }
    const startWd = anchor ? weekday(anchor) : 0;
    const start = addDays(date, -((d.getDay() - startWd + 7) % 7));
    return { start, end: addDays(start, 6) };
  }

  // ── Schedule application ───────────────────────────────────────────────
  // company.schedule: { slots: Slot[], since: 'YYYY-MM-DD', paused?: boolean }
  // Slots that apply on `date`: not paused, on/after `since`, not after the
  // company's date_end.
  function slotsOn(company, date) {
    const sch = company && company.schedule;
    if (!sch || sch.paused || !Array.isArray(sch.slots) || !isDateStr(date)) return [];
    if (sch.since && date < sch.since) return [];
    if (company.date_end && isDateStr(company.date_end) && date > company.date_end) return [];
    const wd = weekday(date);
    return sch.slots.filter(s => Number(s.weekday) === wd && slotMins(s) > 0)
      .slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  // Tracker rows for a day's slots — the exact shape a hand-punched row has.
  function slotRows(slots) {
    return (slots || []).map(s => ({
      label: String(s.label || ''), name: String(s.name || ''), desc: '',
      clock_in: s.start, clock_out: s.end, total_mins: slotMins(s), _scheduled: true,
    }));
  }

  // Scheduled days for one company in [start, end].
  function scheduledDays(company, start, end) {
    const out = [];
    if (!isDateStr(start) || !isDateStr(end) || start > end) return out;
    for (let d = start, guard = 0; d <= end && guard < 400; d = addDays(d, 1), guard++) {
      const slots = slotsOn(company, d);
      if (slots.length) out.push({ date: d, slots, mins: slots.reduce((t, s) => t + slotMins(s), 0) });
    }
    return out;
  }

  // Shifts that have come due and aren't logged yet.
  //   sessions:  [{company_id, log_date}] (entries:summary is enough)
  //   dismissed: iterable of 'companyId|date' the user said they didn't work
  //   nowMins:   minutes since midnight — today's shift is due once ALL its
  //              slots have ended (an overnight slot isn't due until tomorrow).
  function dueShifts(companies, sessions, opts) {
    const o = opts || {};
    const today = o.today || dateStr(new Date());
    const nowMins = o.nowMins != null ? o.nowMins : (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
    const lookback = o.lookbackDays != null ? o.lookbackDays : 31;
    const dismissed = new Set(o.dismissed || []);
    const logged = new Set((sessions || []).map(s => `${Number(s.company_id)}|${s.log_date}`));
    const out = [];
    for (const co of companies || []) {
      if (!co || !co.schedule) continue;
      const cid = Number(co.id);
      for (const day of scheduledDays(co, addDays(today, -lookback), today)) {
        const key = `${cid}|${day.date}`;
        if (logged.has(key) || dismissed.has(key)) continue;
        if (day.date === today && !day.slots.every(s => { const a = toMin(s.start), b = toMin(s.end); return b > a && b <= nowMins; })) continue;
        out.push({ companyId: cid, date: day.date, slots: day.slots, mins: day.mins });
      }
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.companyId - b.companyId));
    return out;
  }

  // Pay-period snapshot for one company: logged minutes in the period, and
  // minutes still scheduled ahead (unlogged scheduled days from today on).
  function periodSummary(company, sessions, opts) {
    const o = opts || {};
    const today = o.today || dateStr(new Date());
    const p = periodFor(today, company && company.pay_period);
    const cid = Number(company && company.id);
    let loggedMins = 0;
    const loggedDates = new Set();
    for (const s of sessions || []) {
      if (Number(s.company_id) !== cid || s.log_date < p.start || s.log_date > p.end) continue;
      loggedMins += Number(s.total_mins) || 0;
      loggedDates.add(s.log_date);
    }
    let aheadMins = 0;
    for (const day of scheduledDays(company, today, p.end)) {
      if (!loggedDates.has(day.date)) aheadMins += day.mins;
    }
    return { start: p.start, end: p.end, loggedMins, aheadMins };
  }

  // Build a saved schedule from detected slots. `since` = start of the
  // current pay period, so this period's earlier unlogged shifts are offered
  // for catch-up right away.
  function makeSchedule(slots, company, today) {
    const t = today || dateStr(new Date());
    return {
      slots: (slots || []).map(s => {
        const slot = { weekday: Number(s.weekday), start: s.start, end: s.end, label: s.label || '', name: s.name || '' };
        return Object.assign(slot, { id: slotId(slot) });
      }),
      since: periodFor(t, company && company.pay_period).start,
    };
  }

  const api = {
    parseLocalDate, dateStr, isDateStr, addDays, daysBetween, weekday,
    toMin, fromMin, slotMins, slotId,
    DETECT_DEFAULTS, detectSchedule, scheduleDiffers,
    PAY_PERIOD_KINDS, periodFor,
    slotsOn, slotRows, scheduledDays, dueShifts, periodSummary, makeSchedule,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schedule = api;
})(this);
