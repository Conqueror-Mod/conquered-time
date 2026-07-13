'use strict';

// Audit wizard window logic. Externalized from an inline <script> so the window
// runs under a strict script-src 'self' CSP. Standalone window (no shell.js);
// uses the preload `api` bridge and settings.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json. The local
// escapeHtml below shadows the ambient global for this standalone window.
(() => {

interface AuditRow extends EntryRow { req_breaks?: number; has_breaks?: number; }
interface WizardIssue {
  date: string; company: string; entryId: number; rowIdx: number;
  type: string; dKey: string; r: AuditRow;
  /** updated_at the wizard read for this entry (optimistic-concurrency token). */
  updatedAt?: number;
}
interface AuditMeta { flag: string; cls: string; suggestion: string; fix: string | null; }

const $id = (id: string): HTMLElement => document.getElementById(id)!;

// Standalone window (no shell.js) — local HTML-escape for user-controlled text.
function escapeHtml(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const params   = new URLSearchParams(window.location.search);
// Unified review wizard: one window that both suggests the auto-fix (when the
// issue is fixable) AND lets you acknowledge. The old ?mode=fix|acknowledge
// split is gone — every issue shows Apply Fix (if available) + Acknowledge.
const WIZARD_TITLE = 'Review Discrepancies';

let issues: WizardIssue[] = [];
let current = 0;
let acted   = 0; // issues acted on (applied or acknowledged — not skipped)

// ── Audit logic (mirrors reports.html) ──────────────────────────────────
function getAuditType(r: EntryRow): string {
  if (!r.clock_in)        return 'no_clock_in';
  if (!r.clock_out)       return 'no_clock_out';
  if (!r.total_mins)      return 'zero_duration';
  if (r.total_mins > 720) return 'over_12h';
  return 'ok';
}

let auditPolicy: AuditPolicy | null = null; // loaded on DOMContentLoaded

function policyBreakHours(policy: AuditPolicy | null): number {
  // break first required once session crosses breakThresholds[0][0]
  const t0 = policy?.breakThresholds?.[0]?.[0];
  return t0 != null ? Math.round(t0 / 60 * 10) / 10 : 3.5;
}

function localRequiredBreaks(totalMins: number, policy: AuditPolicy | null): number {
  const thresholds: Array<[number | null, number]> =
    policy?.breakThresholds || [[210,0],[360,1],[600,2],[null,3]];
  for (const [threshold, count] of thresholds) {
    if (threshold === null || totalMins < threshold) return count;
  }
  return 0;
}

function auditMeta(type: string, r: AuditRow): AuditMeta {
  const p         = auditPolicy;
  const stateName = (p?.hasStatePolicy && p.stateName) || null; // C5 (D-007): law wording only for state-tier policies
  const lunchH    = p ? Math.round(p.lunchThreshMins / 60 * 10) / 10 : 5;
  const breakH    = policyBreakHours(p);
  const breakSugg = stateName
    ? `${stateName} law requires a rest break for shifts over ${breakH}h. Log break(s) in Dispatch.`
    : `Standard practice recommends a rest break for shifts over ${breakH}h. Log break(s) in Dispatch.`;
  const lunchSugg = stateName
    ? `A meal break is required after ${lunchH}h worked (${stateName}). Log a lunch in Dispatch.`
    : `Standard practice recommends a meal break after ${lunchH}h worked. Log a lunch in Dispatch.`;
  switch (type) {
    case 'no_clock_in':   return { flag: '⚠ No clock-in',     cls: 'flag-error', suggestion: 'Enter a clock-in time in the Time Tracker.',        fix: null };
    case 'no_clock_out':  return { flag: '● No clock-out',     cls: 'flag-error', suggestion: 'Auto-set clock-out to clock-in + 8h.',              fix: 'set_clock_out' };
    case 'zero_duration': return { flag: '⚠ Zero duration',    cls: 'flag-warn',  suggestion: 'Recalculate duration from clock-in / clock-out.',   fix: (r.clock_in && r.clock_out) ? 'recalc_duration' : null };
    case 'over_12h':      return { flag: '⚠ Over 12h',         cls: 'flag-warn',  suggestion: 'Review clock-out — session exceeds 12 hours.',      fix: null };
    case 'missing_break': return { flag: '⚠ Break(s) missing', cls: 'flag-warn',  suggestion: breakSugg,                                           fix: null };
    case 'missing_lunch': return { flag: '⚠ No lunch logged',  cls: 'flag-warn',  suggestion: lunchSugg,                                           fix: null };
    default:              return { flag: '✓ OK',                cls: 'flag-ok',    suggestion: '',                                                  fix: null };
  }
}

// ── Load data and build issue list ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  $id('titlebar-label').textContent = WIZARD_TITLE;
  $id('btn-titlebar-close').addEventListener('click', () => window.close());

  // Apply settings (scale only — theme already set via query param).
  // settings:get requires a key and returns the raw stored string; UI prefs
  // are persisted under the `ui_` prefix (see settings.js).
  const scale = await api.invoke('settings:get', 'ui_scale');
  if (scale) document.documentElement.setAttribute('data-scale', scale);

  const [allEntries, dismissedRows, taskSummary, policy] = await Promise.all([
    api.invoke('entries:all'),
    api.invoke('audit:get-dismissed'),
    api.invoke('tasks:summary'),
    api.invoke('audit:get-policy'),
  ]);
  auditPolicy = policy;
  const taskMap = taskSummary || {};

  const entries     = allEntries    || [];
  const dismissed   = dismissedRows || [];
  const dismissedSet = new Set(dismissed.map(d => `${d.entry_id}:${d.row_idx}:${d.type}`));

  // Build companies map for display
  const companies = await api.invoke('companies:list') || [];
  const companyMap: Record<number, Company> = {};
  companies.forEach(c => { companyMap[Number(c.id)] = c; });

  entries.forEach(e => {
    const co      = companyMap[Number(e.company_id)];
    const entryId = Number(e.id);
    try {
      (JSON.parse(e.rows_json || '[]') as EntryRow[]).forEach((r, idx) => {
        if (!r.clock_in && !r.clock_out && !r.label && !r.name) return;
        const type = getAuditType(r);
        if (type === 'ok') return;
        const dKey = `${entryId}:${idx}:${type}`;
        if (dismissedSet.has(dKey)) return;
        issues.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: idx, type, dKey, r, updatedAt: e.updated_at });
      });
    } catch {}

    const totalMins  = Number(e.total_mins || 0);
    const tsk        = taskMap[entryId] || { break_count: 0, lunch_count: 0 };
    const reqBreaks  = localRequiredBreaks(totalMins, auditPolicy);
    if (reqBreaks > 0 && tsk.break_count < reqBreaks) {
      const bKey = `${entryId}:-1:missing_break`;
      if (!dismissedSet.has(bKey))
        issues.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: -1, type: 'missing_break', dKey: bKey, r: { clock_in: '—', clock_out: '—', total_mins: totalMins, label: '(session)', req_breaks: reqBreaks, has_breaks: tsk.break_count } });
    }
    const lunchThresh = auditPolicy?.lunchThreshMins || 300;
    if (totalMins > lunchThresh && tsk.lunch_count < 1) {
      const lKey = `${entryId}:-1:missing_lunch`;
      if (!dismissedSet.has(lKey))
        issues.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: -1, type: 'missing_lunch', dKey: lKey, r: { clock_in: '—', clock_out: '—', total_mins: totalMins, label: '(session)' } });
    }
  });

  issues.sort((a, b) => b.date !== a.date ? b.date.localeCompare(a.date) : (a.r.clock_in || '').localeCompare(b.r.clock_in || ''));

  document.documentElement.style.visibility = '';
  renderStep();
});

// ── Render current step ──────────────────────────────────────────────────
function renderStep(): void {
  const body = $id('wizard-body');

  if (!issues.length) {
    body.innerHTML = `
      <div class="completion-screen">
        <div class="completion-icon">✓</div>
        <div class="completion-title">No active discrepancies</div>
        <div class="completion-sub">All audit issues have already been addressed.</div>
        <button class="btn-wiz-close-final" id="btn-final-close">Close</button>
      </div>`;
    $id('btn-final-close').addEventListener('click', () => window.close());
    return;
  }

  if (current >= issues.length) {
    renderCompletion();
    return;
  }

  const { date, company, type, r } = issues[current];
  const { flag, cls, suggestion, fix } = auditMeta(type, r);
  const total = issues.length;

  // Apply Fix appears whenever the issue is auto-fixable — no mode gating.
  const showFix    = fix !== null;
  const pct        = Math.round((current / total) * 100);

  body.innerHTML = `
    <div class="wizard-header">
      <div class="wizard-mode-title">${WIZARD_TITLE}</div>
      <div class="wizard-counter">Issue ${current + 1} of ${total}</div>
    </div>

    <div class="wizard-progress-track">
      <div class="wizard-progress-fill" style="width:${pct}%"></div>
    </div>

    <div class="issue-card ${cls}">
      <div class="issue-meta">
        <span class="issue-badge ${cls}">${flag}</span>
        <span class="issue-date">${date}</span>
        <span class="issue-company">${company}</span>
      </div>

      <div class="issue-detail">
        <div class="detail-field">
          <div class="detail-label">Task Label</div>
          <div class="detail-value task-label">${escapeHtml(r.label) || '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Task Name</div>
          <div class="detail-value task-label">${escapeHtml(r.name) || '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Clock In</div>
          <div class="detail-value">${r.clock_in || '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Clock Out</div>
          <div class="detail-value">${r.clock_out || '—'}</div>
        </div>
      </div>

      ${suggestion ? `
      <div class="suggestion-block">
        <div class="suggestion-label">${showFix ? 'Suggested Fix' : 'Note'}</div>
        <div class="suggestion-text">${suggestion}</div>
      </div>` : ''}
    </div>

    <div class="wizard-footer">
      ${showFix ? `<button class="btn-wiz-primary" id="btn-apply-fix">Apply Fix</button>` : ''}
      <button class="btn-wiz-${showFix ? 'secondary' : 'primary'}" id="btn-acknowledge">Acknowledge</button>
      <button class="btn-wiz-secondary" id="btn-skip">Skip</button>
      <div class="spacer"></div>
      <button class="btn-wiz-done" id="btn-done">Done</button>
    </div>`;

  if (showFix) {
    $id('btn-apply-fix').addEventListener('click', applyFix);
  }
  $id('btn-acknowledge').addEventListener('click', acknowledge);
  $id('btn-skip').addEventListener('click', skip);
  $id('btn-done').addEventListener('click', () => window.close());
}

// ── Actions ──────────────────────────────────────────────────────────────
async function applyFix(): Promise<void> {
  const issue = issues[current];
  const { fix } = auditMeta(issue.type, issue.r);
  if (!fix) return;
  const res = await api.invoke('audit:apply-fix', {
    entry_id: issue.entryId, row_idx: issue.rowIdx, fix_type: fix, updated_at: issue.updatedAt,
  });
  if (res?.stale) {
    // The entry changed elsewhere since the wizard snapshotted it. The wizard is
    // a linear one-shot over that snapshot and can't safely re-index mid-flow, so
    // skip this issue (no acknowledge) — it'll resurface next time audit is run
    // against fresh data.
    advance();
    return;
  }
  if (res?.ok) {
    // Auto-acknowledge after successful fix
    await api.invoke('audit:dismiss', { entry_id: issue.entryId, row_idx: issue.rowIdx, type: issue.type });
    // The fix bumped the entry's updated_at — refresh the token on every other
    // issue of the SAME entry, or their applies would be stale-rejected.
    const freshTs = res.updated_at;
    if (freshTs != null) {
      issues.forEach(i => { if (i.entryId === issue.entryId) i.updatedAt = freshTs; });
    }
    acted++;
  }
  advance();
}

async function acknowledge(): Promise<void> {
  const issue = issues[current];
  await api.invoke('audit:dismiss', { entry_id: issue.entryId, row_idx: issue.rowIdx, type: issue.type });
  acted++;
  advance();
}

function skip(): void {
  advance();
}

function advance(): void {
  current++;
  renderStep();
}

// ── Completion ───────────────────────────────────────────────────────────
function renderCompletion(): void {
  const body   = $id('wizard-body');
  const skipped = issues.length - acted;
  body.innerHTML = `
    <div class="completion-screen">
      <div class="completion-icon">✓</div>
      <div class="completion-title">All done</div>
      <div class="completion-sub">
        ${acted} issue${acted !== 1 ? 's' : ''} resolved${skipped > 0 ? `, ${skipped} skipped` : ''}.
        The audit log will refresh when you close this window.
      </div>
      <button class="btn-wiz-close-final" id="btn-final-close">Close</button>
    </div>`;
  $id('btn-final-close').addEventListener('click', () => window.close());
}

})();
