'use strict';

// Audit wizard window logic. Externalized from an inline <script> so the window
// runs under a strict script-src 'self' CSP. Standalone window (no shell.js);
// uses the preload `api` bridge and settings.js.

// Standalone window (no shell.js) — local HTML-escape for user-controlled text.
function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const params   = new URLSearchParams(window.location.search);
const mode     = params.get('mode') || 'fix';
const isFix    = mode === 'fix';

let issues  = [];
let current = 0;
let acted   = 0; // issues acted on (applied or acknowledged — not skipped)

// ── Audit logic (mirrors reports.html) ──────────────────────────────────
function getAuditType(r) {
  if (!r.clock_in)        return 'no_clock_in';
  if (!r.clock_out)       return 'no_clock_out';
  if (!r.total_mins)      return 'zero_duration';
  if (r.total_mins > 720) return 'over_12h';
  return 'ok';
}

let auditPolicy = null; // loaded on DOMContentLoaded

function policyBreakHours(policy) {
  // break first required once session crosses breakThresholds[0][0]
  const t0 = policy?.breakThresholds?.[0]?.[0];
  return t0 != null ? Math.round(t0 / 60 * 10) / 10 : 3.5;
}

function localRequiredBreaks(totalMins, policy) {
  const thresholds = policy?.breakThresholds || [[210,0],[360,1],[600,2],[Infinity,3]];
  for (const [threshold, count] of thresholds) {
    if (threshold === null || totalMins < threshold) return count;
  }
  return 0;
}

function auditMeta(type, r) {
  const p         = auditPolicy;
  const stateName = p?.stateName || null;
  const lunchH    = p ? Math.round(p.lunchThreshMins / 60 * 10) / 10 : 5;
  const breakH    = policyBreakHours(p);
  const breakSugg = stateName
    ? `${stateName} law requires a rest break for shifts over ${breakH}h. Log break(s) in Dispatch.`
    : `Policy requires rest breaks for shifts over ${breakH}h. Log break(s) in Dispatch.`;
  const lunchSugg = stateName
    ? `A meal break is required after ${lunchH}h worked (${stateName}). Log a lunch in Dispatch.`
    : `A meal break is required after ${lunchH}h worked. Log a lunch in Dispatch.`;
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
  document.getElementById('titlebar-label').textContent = isFix ? 'Suggest Discrepancy Fix' : 'Acknowledge Discrepancies';
  document.getElementById('btn-titlebar-close').addEventListener('click', () => window.close());

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
  const companyMap = {};
  companies.forEach(c => { companyMap[Number(c.id)] = c; });

  entries.forEach(e => {
    const co      = companyMap[Number(e.company_id)];
    const entryId = Number(e.id);
    try {
      JSON.parse(e.rows_json || '[]').forEach((r, idx) => {
        if (!r.clock_in && !r.clock_out && !r.label && !r.name) return;
        const type = getAuditType(r);
        if (type === 'ok') return;
        const dKey = `${entryId}:${idx}:${type}`;
        if (dismissedSet.has(dKey)) return;
        issues.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: idx, type, dKey, r });
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
function renderStep() {
  const body = document.getElementById('wizard-body');

  if (!issues.length) {
    body.innerHTML = `
      <div class="completion-screen">
        <div class="completion-icon">✓</div>
        <div class="completion-title">No active discrepancies</div>
        <div class="completion-sub">All audit issues have already been addressed.</div>
        <button class="btn-wiz-close-final" id="btn-final-close">Close</button>
      </div>`;
    document.getElementById('btn-final-close').addEventListener('click', () => window.close());
    return;
  }

  if (current >= issues.length) {
    renderCompletion();
    return;
  }

  const { date, company, type, r } = issues[current];
  const { flag, cls, suggestion, fix } = auditMeta(type, r);
  const total = issues.length;

  const showFix    = isFix && fix !== null;
  const pct        = Math.round((current / total) * 100);

  body.innerHTML = `
    <div class="wizard-header">
      <div class="wizard-mode-title">${isFix ? 'Suggest Discrepancy Fix' : 'Acknowledge Discrepancies'}</div>
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
      <button class="btn-wiz-${isFix && !showFix ? 'primary' : 'secondary'}" id="btn-acknowledge">Acknowledge</button>
      <button class="btn-wiz-secondary" id="btn-skip">Skip</button>
      <div class="spacer"></div>
      <button class="btn-wiz-done" id="btn-done">Done</button>
    </div>`;

  if (showFix) {
    document.getElementById('btn-apply-fix').addEventListener('click', applyFix);
  }
  document.getElementById('btn-acknowledge').addEventListener('click', acknowledge);
  document.getElementById('btn-skip').addEventListener('click', skip);
  document.getElementById('btn-done').addEventListener('click', () => window.close());
}

// ── Actions ──────────────────────────────────────────────────────────────
async function applyFix() {
  const issue = issues[current];
  const { fix } = auditMeta(issue.type, issue.r);
  if (!fix) return;
  const res = await api.invoke('audit:apply-fix', { entry_id: issue.entryId, row_idx: issue.rowIdx, fix_type: fix });
  if (res?.ok) {
    // Auto-acknowledge after successful fix
    await api.invoke('audit:dismiss', { entry_id: issue.entryId, row_idx: issue.rowIdx, type: issue.type });
    acted++;
  }
  advance();
}

async function acknowledge() {
  const issue = issues[current];
  await api.invoke('audit:dismiss', { entry_id: issue.entryId, row_idx: issue.rowIdx, type: issue.type });
  acted++;
  advance();
}

function skip() {
  advance();
}

function advance() {
  current++;
  renderStep();
}

// ── Completion ───────────────────────────────────────────────────────────
function renderCompletion() {
  const body   = document.getElementById('wizard-body');
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
  document.getElementById('btn-final-close').addEventListener('click', () => window.close());
}
