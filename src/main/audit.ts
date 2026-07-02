'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  audit.ts — discrepancy detection + dismissed-set (Phase 2 extraction).
//
//  The audit engine detects exactly 6 discrepancy types: no_clock_in,
//  no_clock_out, zero_duration, over_12h, missing_break, missing_lunch.
//  It does NOT flag row overlaps or stored-vs-span mismatches.
//  seed-dev.js's computeExpectedDiscrepancies() mirrors this logic — keep
//  them in sync.
// ════════════════════════════════════════════════════════════════════════════

const { dbGet, dbAll } = require('./db');
const { getPolicy, requiredBreaks } = require('./policies');
const { session, decryptEntry } = require('./session');
const { rowHasContent } = require('../renderer/row-utils');

// Dismissed/acknowledged items as "entryId:rowIdx:type" keys.
function getDismissedSet(): Set<string> {
  if (!session.user) return new Set();
  return new Set(
    dbAll('SELECT entry_id, row_idx, type FROM audit_dismissed WHERE user_id=?', [session.user.id])
      .map(d => `${d.entry_id}:${d.row_idx}:${d.type}`)
  );
}

function countAuditDiscrepancies(): number {
  if (!session.user) return 0;
  const dismissed = getDismissedSet();
  const entries = dbAll('SELECT rowid as rid, rows_json, rows_enc, rows_iv, rows_tag, total_mins FROM time_entries WHERE user_id=?', [session.user.id]);
  let count = 0;
  entries.forEach(e => {
    decryptEntry(e);
    const entryId = Number(e.rid);
    try {
      JSON.parse(e.rows_json || '[]').forEach((r, idx) => {
        // C3 (D-004): shared predicate includes desc — a desc-only row holds
        // user content with no punch and now flags (no_clock_in) instead of
        // being silently unaudited.
        if (!rowHasContent(r)) return;
        if (!r.clock_in) {
          if (!dismissed.has(`${entryId}:${idx}:no_clock_in`)) count++;
        } else if (!r.clock_out) {
          if (!dismissed.has(`${entryId}:${idx}:no_clock_out`)) count++;
        } else if (!r.total_mins) {
          if (!dismissed.has(`${entryId}:${idx}:zero_duration`)) count++;
        } else if (r.total_mins > 720) {
          if (!dismissed.has(`${entryId}:${idx}:over_12h`)) count++;
        }
      });
    } catch {}

    const totalMins = Number(e.total_mins || 0);
    const policy = getPolicy(session.user.work_state);
    const reqBreaks = requiredBreaks(totalMins, policy);
    if (reqBreaks > 0) {
      const breakCount = (dbGet('SELECT COUNT(*) as c FROM task_items WHERE entry_id=? AND user_id=? AND item_type=?',
        [entryId, session.user.id, 'break']) || {}).c || 0;
      if (breakCount < reqBreaks && !dismissed.has(`${entryId}:-1:missing_break`)) count++;
    }
    if (totalMins > policy.lunchThreshMins) {
      const hasLunch = dbGet('SELECT id FROM task_items WHERE entry_id=? AND user_id=? AND item_type=? LIMIT 1',
        [entryId, session.user.id, 'lunch']);
      if (!hasLunch && !dismissed.has(`${entryId}:-1:missing_lunch`)) count++;
    }
  });
  return count;
}

module.exports = { getDismissedSet, countAuditDiscrepancies };
