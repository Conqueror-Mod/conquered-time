'use strict';

// Reports page logic. Externalized from an inline <script> so the page runs under
// a strict script-src 'self' CSP. Depends on globals injected by shell.js (Shell,
// Store, escapeHtml, api) — must load after shell.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

type TaskCounts = { break_count: number; lunch_count: number };
interface AuditRow extends EntryRow { req_breaks?: number; has_breaks?: number; }
interface AuditItem {
  date: string; company: string; entryId: number; rowIdx: number;
  type: string; dKey: string; r: AuditRow;
}

let companies: Company[] = [], allEntries: TimeEntry[] = [];
let companyMap: Record<number, Company> = {};
let taskMap: Record<string, TaskCounts> = {};
let auditPolicy: AuditPolicy | null = null;

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $field = (id: string): HTMLInputElement | HTMLSelectElement =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

function localRequiredBreaks(totalMins: number, policy: AuditPolicy | null): number {
  const thresholds: Array<[number | null, number]> =
    policy?.breakThresholds || [[210,0],[360,1],[600,2],[null,3]];
  for (const [threshold, count] of thresholds) {
    if (threshold === null || totalMins < threshold) return count;
  }
  return 0;
}
let currentTab = 'period';
let barResizeObserver: ResizeObserver | null = null;
let dismissedSet = new Set<string>();
let emailedSet = new Set<string>();   // dKeys the user was emailed about (acknowledged but kept visible)
let showDismissed = false;

// Build dismissedSet + emailedSet from audit:get-dismissed rows.
function applyDismissedRows(rows: AuditDismissedRow[] | null): void {
  dismissedSet = new Set((rows || []).map(d => `${d.entry_id}:${d.row_idx}:${d.type}`));
  emailedSet   = new Set((rows || []).filter(d => d.emailed_at).map(d => `${d.entry_id}:${d.row_idx}:${d.type}`));
}

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('reports');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'hidden'; }

  await loadData();
  // Load dismissed audit items
  applyDismissedRows(await api.invoke('audit:get-dismissed'));

  setupTabs();
  initPeriodFilter();

  // Unified audit wizard — one window that shows the suggested fix (with an
  // Apply Fix button when the issue is auto-fixable) AND lets you acknowledge.
  // (Replaces the old split acknowledge-mode / fix-mode buttons.)
  $id('btn-review-wizard').addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme') || 'memoria';
    api.invoke('audit:open-wizard', { theme });
  });

  // Audit toolbar + row actions (CSP-safe; replaces inline on* handlers)
  $id('btn-toggle-dismissed').addEventListener('click', toggleShowDismissed);
  $id('btn-clear-dismissed').addEventListener('click', clearAllDismissed);
  $id('audit-tbody').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.audit-row-btn');
    if (!btn) return;
    const { act, dkey, eid, ridx, type, fix } = btn.dataset;
    if (act === 'restore')      undismissAuditItem(dkey!, eid!, ridx!, type!);
    else if (act === 'fix')     applyAuditFix(eid!, ridx!, fix!, dkey!);
    else if (act === 'dismiss') dismissAuditItem(dkey!, eid!, ridx!, type!);
    else if (act === 'email')   emailAuditItem(dkey!, eid!, ridx!, type!);
  });

  api.on('audit:wizard-done', async () => {
    Store.invalidate('entries');  // audit wizard may have applied fixes
    [allEntries, taskMap] = await Promise.all([
      Store.getEntries(),
      api.invoke('tasks:summary'),
    ]);
    allEntries = allEntries || [];
    taskMap    = taskMap    || {};
    applyDismissedRows(await api.invoke('audit:get-dismissed'));
    renderAuditLog();
  });

  // If navigated here from audit warning, jump straight to audit tab
  const jumpTab = sessionStorage.getItem('reports_open_tab');
  if (jumpTab) { sessionStorage.removeItem('reports_open_tab'); switchTab(jumpTab); }
  renderPeriod();
  renderCompanyBreakdown();
  renderAuditLog();

  // Redraw bar chart on resize
  barResizeObserver = new ResizeObserver(() => { if (currentTab === 'period') drawBarChart(getFilteredEntries()); });
  const wrap = document.getElementById('bar-svg-wrap');
  if (wrap) barResizeObserver.observe(wrap);
});

// ── Data ──
async function loadData(): Promise<void> {
  [companies, allEntries, taskMap] = await Promise.all([
    Store.getCompanies(),
    Store.getEntries(),
    api.invoke('tasks:summary'),
  ]);
  try { auditPolicy = await api.invoke('audit:get-policy'); } catch(e) { auditPolicy = null; }
  companies  = companies  || [];
  allEntries = allEntries || [];
  taskMap    = taskMap    || {};
  companyMap = {};
  companies.forEach(c => { companyMap[Number(c.id)] = c; });

  const sel = $id('period-company');
  companies.forEach(c => {
    const o = document.createElement('option');
    o.value = String(c.id); o.textContent = c.name;
    sel.appendChild(o);
  });
}

// ── Tabs ──
function switchTab(tab: string): void {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) panel.classList.add('active');
  const pdfBtn   = document.getElementById('btn-export-pdf');
  const csvBtn   = document.getElementById('btn-export-csv');
  const emailBtn = document.getElementById('btn-email-report');
  if (pdfBtn)   pdfBtn.style.display   = tab === 'audit' ? 'none' : '';
  if (csvBtn)   csvBtn.style.display   = tab === 'audit' ? '' : 'none';
  if (emailBtn) emailBtn.style.display = tab === 'period' ? '' : 'none';
}

function setupTabs(): void {
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab!));
  });
  $id('btn-export-pdf').addEventListener('click', exportPDF);
  $id('btn-export-csv').addEventListener('click', exportCSV);
  $id('btn-email-report').addEventListener('click', openEmailModal);
}

// ── Period filter ──
function initPeriodFilter(): void {
  const to = new Date(), from = new Date();
  from.setDate(from.getDate() - 29);
  $field('period-to').value   = RowUtils.localDateStr(to);   // local, not toISOString (UTC)
  $field('period-from').value = RowUtils.localDateStr(from);
  $id('btn-apply').addEventListener('click', renderPeriod);
}

function getFilteredEntries(): TimeEntry[] {
  const from = $field('period-from').value;
  const to   = $field('period-to').value;
  const coId = $field('period-company').value;
  return allEntries.filter(e => {
    if (from && e.log_date < from) return false;
    if (to   && e.log_date > to)   return false;
    if (coId && String(e.company_id) !== String(coId)) return false;
    return true;
  });
}

// ── Helpers ──
function fmtH(mins: number): string { return mins ? (mins/60).toFixed(1)+'h' : '0.0h'; }
function fmtM(mins: number | undefined): string {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins/60), m = mins%60;
  return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m`;
}

// ── Period Summary ──
function renderPeriod(): void {
  const entries    = getFilteredEntries();
  const totalMins  = entries.reduce((s,e) => s + (e.total_mins||0), 0);
  const from       = new Date($field('period-from').value);
  const to         = new Date($field('period-to').value);
  const daySpan    = Math.max(1, Math.round((to.getTime()-from.getTime())/86400000)+1);

  const byCompany: Record<string, number> = {};
  entries.forEach(e => { const k = String(e.company_id); byCompany[k] = (byCompany[k]||0)+(e.total_mins||0); });
  const topEntry  = Object.entries(byCompany).sort((a,b)=>b[1]-a[1])[0];
  const topCoName = topEntry ? (companyMap[Number(topEntry[0])]?.name || '—') : '—';
  const topCoMins = topEntry?.[1] || 0;

  $id('period-chips').innerHTML = `
    <div class="summary-chip">
      <div class="chip-label">Total Hours</div>
      <div class="chip-value">${fmtH(totalMins)}</div>
      <div class="chip-sub">${entries.length} session${entries.length!==1?'s':''}</div>
    </div>
    <div class="summary-chip violet">
      <div class="chip-label">Avg / Day</div>
      <div class="chip-value">${fmtH(totalMins/daySpan)}</div>
      <div class="chip-sub">over ${daySpan} days</div>
    </div>
    <div class="summary-chip yellow">
      <div class="chip-label">Top Company</div>
      <div class="chip-value" style="font-size:13px;line-height:1.5;">${topCoName}</div>
      <div class="chip-sub">${fmtH(topCoMins)}</div>
    </div>
    <div class="summary-chip green">
      <div class="chip-label">Active Clients</div>
      <div class="chip-value">${Object.keys(byCompany).length}</div>
      <div class="chip-sub">in period</div>
    </div>
  `;

  drawBarChart(entries);
  renderLabelBreakdown(entries, totalMins);
}

function drawBarChart(entries: TimeEntry[]): void {
  const wrap = document.getElementById('bar-svg-wrap');
  const svg  = document.getElementById('bar-svg');
  if (!wrap || !svg) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;

  const from = new Date($field('period-from').value);
  const to   = new Date($field('period-to').value);

  const byDate: Record<string, number> = {};
  entries.forEach(e => { byDate[e.log_date] = (byDate[e.log_date]||0)+(e.total_mins||0); });

  const dates: string[] = [];
  const cur = new Date(from);
  while (cur <= to) { dates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }

  const maxMins = Math.max(...dates.map(d => byDate[d]||0), 60);
  const pL=40, pR=8, pT=8, pB=28;
  const cW=W-pL-pR, cH=H-pT-pB;
  const slotW = cW/dates.length;
  const barW  = Math.max(2, Math.min(slotW-2, 24));

  let out = '';

  // Y-axis grid + labels
  for (let i=0; i<=4; i++) {
    const y   = pT + cH - (cH*i/4);
    const val = ((maxMins/60)*i/4).toFixed(1);
    out += `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${pL+cW}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>`;
    out += `<text x="${pL-5}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${val}h</text>`;
  }

  const today = RowUtils.localDateStr(); // local — highlights the real "today" bar
  const labelStep = dates.length <= 14 ? 1 : dates.length <= 31 ? 7 : Math.ceil(dates.length/8);

  dates.forEach((date, i) => {
    const mins  = byDate[date]||0;
    const bH    = mins > 0 ? Math.max(2, (mins/maxMins)*cH) : 0;
    const x     = pL + i*slotW + (slotW-barW)/2;
    const y     = pT + cH - bH;
    const isT   = date === today;
    const fill  = isT ? 'var(--accent)' : 'var(--accent-dim)';
    const strk  = mins > 0 ? 'var(--accent)' : 'none';
    if (mins > 0 || isT) {
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(bH,2).toFixed(1)}"
        fill="${fill}" stroke="${strk}" stroke-width="1" rx="2" opacity="${isT?1:0.7}">
        <title>${date}: ${fmtM(mins)}</title></rect>`;
    }
    if (i % labelStep === 0 || i === dates.length-1) {
      const lx = x + barW/2;
      out += `<text x="${lx.toFixed(1)}" y="${(pT+cH+18).toFixed(1)}" text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--mono)">${date.slice(5)}</text>`;
    }
  });

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = out;
}

function renderLabelBreakdown(entries: TimeEntry[], totalMins: number): void {
  const byLabel: Record<string, number> = {};
  entries.forEach(e => {
    try {
      (JSON.parse(e.rows_json||'[]') as EntryRow[]).forEach(r => {
        if (r.total_mins && r.total_mins > 0) { const l=r.label||'Other'; byLabel[l]=(byLabel[l]||0)+r.total_mins; }
      });
    } catch {}
  });

  const sorted = Object.entries(byLabel).sort((a,b)=>b[1]-a[1]);
  const panel  = $id('label-breakdown');
  const maxV   = sorted[0]?.[1] || 1;

  panel.innerHTML = `<div class="panel-title">Task Breakdown</div>
    ${sorted.length ? sorted.map(([label,mins]) => `
      <div class="label-row">
        <div class="label-row-hdr">
          <span class="label-name">${label}</span>
          <span class="label-hours">${fmtM(mins)}</span>
        </div>
        <div class="label-track"><div class="label-fill" style="width:${Math.round(mins/maxV*100)}%"></div></div>
        <span class="label-pct">${totalMins ? Math.round(mins/totalMins*100) : 0}% of period</span>
      </div>`).join('') : '<div class="empty-state">No task data in this period.</div>'}`;
}

// ── Company Breakdown ──
function renderCompanyBreakdown(): void {
  const cards = $id('company-cards');
  if (!companies.length) { cards.innerHTML = '<div class="empty-state">No companies yet.</div>'; return; }

  cards.innerHTML = companies.map(co => {
    const ces      = allEntries.filter(e => Number(e.company_id) === Number(co.id));
    const totMins  = ces.reduce((s,e) => s+(e.total_mins||0), 0);
    const sorted   = [...ces].sort((a,b) => b.log_date.localeCompare(a.log_date));
    const lastDate = sorted[0]?.log_date || null;

    const byLabel: Record<string, number> = {};
    ces.forEach(e => {
      try { (JSON.parse(e.rows_json||'[]') as EntryRow[]).forEach(r => { if (r.total_mins && r.total_mins>0) { const l=r.label||'Other'; byLabel[l]=(byLabel[l]||0)+r.total_mins; } }); } catch {}
    });
    const chips = Object.entries(byLabel).sort((a,b)=>b[1]-a[1])
      .map(([l,m]) => `<span class="cc-chip">${l} <span>${fmtM(m)}</span></span>`).join('');
    const hier = [co.hier_company, co.hier_project, co.hier_platform].filter(Boolean).join(' › ');

    return `<div class="company-card">
      <div>
        <div class="cc-name">${escapeHtml(co.name)}</div>
        ${hier ? `<div class="cc-hier">${escapeHtml(hier)}</div>` : ''}
      </div>
      <div class="cc-stats">
        <div class="cc-stat"><div class="cc-stat-val">${fmtH(totMins)}</div><div class="cc-stat-lbl">Total</div></div>
        <div class="cc-stat"><div class="cc-stat-val">${ces.length}</div><div class="cc-stat-lbl">Sessions</div></div>
        <div class="cc-stat"><div class="cc-stat-val" style="font-size:13px;">${lastDate ? lastDate.slice(5) : '—'}</div><div class="cc-stat-lbl">Last Active</div></div>
      </div>
      ${chips ? `<div class="cc-chips">${chips}</div>` : ''}
    </div>`;
  }).join('');
}

// ── Audit Log ──
function getAuditType(r: EntryRow): string {
  if (!r.clock_in)          return 'no_clock_in';
  if (!r.clock_out)         return 'no_clock_out';
  if (!r.total_mins)        return 'zero_duration';
  if (r.total_mins > 720)   return 'over_12h';
  return 'ok';
}

interface AuditMeta { flag: string; cls: string; suggestion: string; fix: string | null; }
function auditMeta(type: string, r: AuditRow): AuditMeta {
  switch(type) {
    case 'no_clock_in':    return { flag:'⚠ No clock-in',   cls:'flag-error',  suggestion:'Enter a clock-in time in the Time Tracker.',            fix: null };
    case 'no_clock_out':   return { flag:'● No clock-out',   cls:'flag-error',  suggestion:'Auto-set clock-out to clock-in + 8h.',                  fix: 'set_clock_out' };
    case 'zero_duration':  return { flag:'⚠ Zero duration',  cls:'flag-warn',   suggestion:'Recalculate duration from clock-in / clock-out.',        fix: (r.clock_in && r.clock_out) ? 'recalc_duration' : null };
    case 'over_12h':       return { flag:'⚠ Over 12h',       cls:'flag-warn',   suggestion:'Review clock-out — session exceeds 12 hours.',           fix: null };
    case 'missing_break': { const sn = auditPolicy?.hasStatePolicy ? auditPolicy.stateName : null, t0 = auditPolicy?.breakThresholds?.[0]?.[0], bh = t0 != null ? Math.round(t0/60*10)/10 : 3.5; return { flag:'⚠ Break(s) missing', cls:'flag-warn', suggestion: sn ? `${sn} law requires a rest break for shifts over ${bh}h. Log break(s) in Dispatch.` : `Standard practice recommends a rest break for shifts over ${bh}h. Log break(s) in Dispatch.`, fix: null }; }
    case 'missing_lunch': { const sn = auditPolicy?.hasStatePolicy ? auditPolicy.stateName : null, lh = Math.round((auditPolicy?.lunchThreshMins||300)/60*10)/10; return { flag:'⚠ No lunch logged', cls:'flag-warn', suggestion: sn ? `A meal break is required after ${lh}h worked (${sn}). Log a lunch in Dispatch.` : `Standard practice recommends a meal break after ${lh}h worked. Log a lunch in Dispatch.`, fix: null }; }
    default:               return { flag:'✓ OK',              cls:'flag-ok',     suggestion:'',                                                       fix: null };
  }
}

function renderAuditLog(): void {
  const tbody = $id('audit-tbody');
  const items: AuditItem[] = [];

  allEntries.forEach(e => {
    const co = companyMap[Number(e.company_id)];
    const entryId = Number(e.id);
    try {
      (JSON.parse(e.rows_json||'[]') as EntryRow[]).forEach((r, idx) => {
        if (!RowUtils.rowHasContent(r)) return; // C3: keep in lockstep with src/main/audit.ts countAuditDiscrepancies
        const type = getAuditType(r);
        const dKey = `${entryId}:${idx}:${type}`;
        items.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: idx, type, dKey, r });
      });
    } catch {}

    // Entry-level break/lunch flags
    const totalMins = Number(e.total_mins || 0);
    const tsk       = taskMap[entryId] || { break_count: 0, lunch_count: 0 };
    const reqBreaks = localRequiredBreaks(totalMins, auditPolicy);
    if (reqBreaks > 0 && tsk.break_count < reqBreaks) {
      const bKey = `${entryId}:-1:missing_break`;
      items.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: -1, type: 'missing_break', dKey: bKey, r: { clock_in: '—', clock_out: '—', total_mins: totalMins, label: '(session)', req_breaks: reqBreaks, has_breaks: tsk.break_count } });
    }
    const lunchThresh = auditPolicy?.lunchThreshMins || 300;
    if (totalMins > lunchThresh && tsk.lunch_count < 1) {
      const lKey = `${entryId}:-1:missing_lunch`;
      items.push({ date: e.log_date, company: co?.name || `#${e.company_id}`, entryId, rowIdx: -1, type: 'missing_lunch', dKey: lKey, r: { clock_in: '—', clock_out: '—', total_mins: totalMins, label: '(session)' } });
    }
  });

  items.sort((a,b) => b.date !== a.date ? b.date.localeCompare(a.date) : (a.r.clock_in||'').localeCompare(b.r.clock_in||''));

  // Emailed (acknowledged) items stay visible by default — only manually-dismissed
  // items are hidden unless "Show Dismissed" is on.
  const visible = showDismissed ? items : items.filter(i => i.type === 'ok' || !dismissedSet.has(i.dKey) || emailedSet.has(i.dKey));
  const flagged  = items.filter(i => i.type !== 'ok' && !dismissedSet.has(i.dKey)).length;
  const totalDismissed = items.filter(i => i.type !== 'ok' && dismissedSet.has(i.dKey)).length;

  // Update toolbar label
  const label = document.getElementById('audit-count-label');
  if (label) {
    label.textContent = flagged
      ? `${flagged} issue${flagged !== 1 ? 's' : ''} found${totalDismissed ? ` · ${totalDismissed} dismissed` : ''}`
      : `No issues${totalDismissed ? ` · ${totalDismissed} dismissed` : ''}`;
    label.style.color = flagged ? 'var(--yellow)' : 'var(--green)';
  }
  const clearBtn = document.getElementById('btn-clear-dismissed');
  if (clearBtn) clearBtn.style.display = totalDismissed ? '' : 'none';
  const reviewBtn = document.getElementById('btn-review-wizard') as HTMLButtonElement | null;
  if (reviewBtn) reviewBtn.disabled = flagged === 0;

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:32px;">No audit entries found.</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(({ date, company, entryId, rowIdx, type, dKey, r }) => {
    const isEmailed   = type !== 'ok' && emailedSet.has(dKey);
    const isDismissed = type !== 'ok' && dismissedSet.has(dKey) && !isEmailed;
    const { flag, cls, suggestion, fix } = auditMeta(type, r);
    const rowCls = (isDismissed || isEmailed) ? ' class="audit-dismissed-row"' : '';
    const flagCls = isEmailed ? 'flag-dismissed' : isDismissed ? 'flag-dismissed' : cls;
    const flagText = isEmailed ? '✉ emailed' : isDismissed ? '— dismissed' : flag;

    const actionBtns = type === 'ok' ? '' : (isDismissed || isEmailed)
      ? `<button class="audit-row-btn dismiss" data-act="restore" data-dkey="${dKey}" data-eid="${entryId}" data-ridx="${rowIdx}" data-type="${type}">Restore</button>`
      : [
          fix ? `<button class="audit-row-btn fix" data-act="fix" data-eid="${entryId}" data-ridx="${rowIdx}" data-fix="${fix}" data-dkey="${dKey}">Apply Fix</button>` : '',
          `<button class="audit-row-btn email" data-act="email" data-dkey="${dKey}" data-eid="${entryId}" data-ridx="${rowIdx}" data-type="${type}">Email Me</button>`,
          `<button class="audit-row-btn dismiss" data-act="dismiss" data-dkey="${dKey}" data-eid="${entryId}" data-ridx="${rowIdx}" data-type="${type}">Dismiss</button>`
        ].filter(Boolean).join(' ');

    return `<tr${rowCls}>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted);white-space:nowrap;">${date}</td>
      <td style="font-family:var(--sans);font-size:12px;font-weight:500;color:var(--accent);">${escapeHtml(company)}</td>
      <td style="font-family:var(--sans);font-size:12px;color:var(--text-bright);">${escapeHtml(r.label)||'—'}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted);">${r.clock_in||'—'}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted);">${r.clock_out||'—'}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--yellow);text-align:center;">${r.total_mins ? fmtM(r.total_mins) : '—'}</td>
      <td style="text-align:center;"><span class="audit-flag ${flagCls}">${flagText}</span></td>
      <td><span class="audit-suggest" title="${suggestion}">${isDismissed ? '' : suggestion}</span></td>
      <td style="text-align:center;white-space:nowrap;">${actionBtns}</td>
    </tr>`;
  }).join('');
}

async function dismissAuditItem(dKey: string, entryId: string | number, rowIdx: string | number, type: string): Promise<void> {
  await api.invoke('audit:dismiss', { entry_id: Number(entryId), row_idx: Number(rowIdx), type });
  dismissedSet.add(dKey);
  renderAuditLog();
}

async function emailAuditItem(dKey: string, entryId: string | number, rowIdx: string | number, type: string): Promise<void> {
  const { suggestion } = auditMeta(type, {});
  const res = await api.invoke('audit:email-notify', {
    entry_id: Number(entryId), row_idx: Number(rowIdx), type,
    subject: 'Conquered Time — timesheet discrepancy',
    message: `A timesheet discrepancy was flagged in your audit log. ${suggestion || ''}`.trim(),
  });
  if (!res?.ok) { Shell.toast('Could not send email: ' + (res?.error || 'unknown error'), 'error'); return; }
  // Mark as emailed locally (silenced on close, kept visible in the log).
  dismissedSet.add(dKey);
  emailedSet.add(dKey);
  Shell.toast(`Emailed ${res.to} — discrepancy acknowledged.`, 'success');
  renderAuditLog();
}

async function undismissAuditItem(dKey: string, entryId: string | number, rowIdx: string | number, type: string): Promise<void> {
  await api.invoke('audit:undismiss', { entry_id: Number(entryId), row_idx: Number(rowIdx), type });
  dismissedSet.delete(dKey);
  emailedSet.delete(dKey);
  renderAuditLog();
}

async function clearAllDismissed(): Promise<void> {
  await api.invoke('audit:clear-dismissed');
  dismissedSet.clear();
  emailedSet.clear();
  renderAuditLog();
}

function toggleShowDismissed(): void {
  showDismissed = !showDismissed;
  const btn = document.getElementById('btn-toggle-dismissed');
  if (btn) btn.textContent = showDismissed ? 'Hide Dismissed' : 'Show Dismissed';
  renderAuditLog();
}

async function applyAuditFix(entryId: string | number, rowIdx: string | number, fixType: string, dKey: string): Promise<void> {
  // Optimistic-concurrency token: the updated_at the audit view read for this
  // entry (from the entries:all snapshot in allEntries).
  const entry = allEntries.find(e => Number(e.id) === Number(entryId));
  const res = await api.invoke('audit:apply-fix', {
    entry_id: Number(entryId), row_idx: Number(rowIdx), fix_type: fixType, updated_at: entry?.updated_at,
  });
  if (res?.stale) {
    // The entry changed elsewhere (e.g. the tracker saved it) since audit loaded
    // it — the row index / discrepancy may be stale. Re-fetch and re-render
    // rather than applying against outdated data.
    Shell.toast('This entry changed elsewhere — refreshing the audit log.', 'warning');
    Store.invalidate('entries');
    allEntries = await Store.getEntries();
    renderAuditLog();
    return;
  }
  if (!res?.ok) { Shell.toast('Fix could not be applied: ' + (res?.error || 'unknown error'), 'error'); return; }
  // Reload entries so the fix is reflected
  Store.invalidate('entries');
  allEntries = await Store.getEntries();
  // Auto-dismiss the fixed item
  await api.invoke('audit:dismiss', { entry_id: Number(entryId), row_idx: Number(rowIdx), type: fixType === 'set_clock_out' ? 'no_clock_out' : 'zero_duration' });
  dismissedSet.add(dKey);
  Shell.toast('Fix applied and entry updated.', 'success');
  renderAuditLog();
}

// ── PDF Export ──
function exportPDF(): void {
  if (currentTab === 'period')  exportPeriodPDF();
  if (currentTab === 'company') exportCompanyPDF();
}

function buildPeriodReportHTML(): { html: string; from: string; to: string; coLabel: string } {
  const entries   = getFilteredEntries();
  const from      = $field('period-from').value;
  const to        = $field('period-to').value;
  const coSel     = document.getElementById('period-company') as HTMLSelectElement;
  const coLabel   = coSel.value ? coSel.options[coSel.selectedIndex].text : 'All Companies';
  const totalMins = entries.reduce((s,e) => s+(e.total_mins||0), 0);

  const byDate: Record<string, number> = {};
  entries.forEach(e => { byDate[e.log_date]=(byDate[e.log_date]||0)+(e.total_mins||0); });
  const byLabel: Record<string, number> = {};
  entries.forEach(e => { try { (JSON.parse(e.rows_json||'[]') as EntryRow[]).forEach(r => { if(r.total_mins&&r.total_mins>0){const l=r.label||'Other';byLabel[l]=(byLabel[l]||0)+r.total_mins;} }); } catch {} });

  const dateRows  = Object.entries(byDate).sort(([a],[b])=>a.localeCompare(b))
    .map(([d,m])=>`<tr><td>${d}</td><td style="text-align:right">${fmtM(m)}</td></tr>`).join('');
  const labelRows = Object.entries(byLabel).sort((a,b)=>b[1]-a[1])
    .map(([l,m])=>`<tr><td>${l}</td><td style="text-align:right">${fmtM(m)}</td></tr>`).join('');

  return { html: `<!DOCTYPE html><html><head><title>Period Report</title>
  <style>body{font-family:DM Sans,Arial,sans-serif;font-size:12px;color:#111;padding:40px;max-width:900px;margin:0 auto;}
  h1{font-size:20px;font-weight:600;margin:0 0 4px;}h2{font-size:13px;font-weight:600;color:#374151;margin:24px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;}
  .meta{color:#666;font-size:11px;margin-bottom:20px;}table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:8px;text-align:left;font-size:11px;font-weight:600;color:#374151;}
  td{padding:7px 8px;border-bottom:1px solid #e5e7eb;}tr.total{font-weight:600;background:#f9fafb;}
  .footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;}</style>
  </head><body>
  <h1>Period Report</h1>
  <div class="meta">${from} → ${to} · ${coLabel} · Total: ${fmtM(totalMins)}</div>
  <h2>Daily Hours</h2>
  <table><thead><tr><th>Date</th><th style="text-align:right">Hours</th></tr></thead>
  <tbody>${dateRows}<tr class="total"><td>Total</td><td style="text-align:right">${fmtM(totalMins)}</td></tr></tbody></table>
  <h2>Task Label Breakdown</h2>
  <table><thead><tr><th>Task Label</th><th style="text-align:right">Hours</th></tr></thead>
  <tbody>${labelRows}</tbody></table>
  <div class="footer"><span>Generated by Conquered Time · ${new Date().toLocaleString()}</span><span>CONFIDENTIAL</span></div>
  </body></html>`, from, to, coLabel };
}

function exportPeriodPDF(): void {
  const { html } = buildPeriodReportHTML();
  const win = window.open('','_blank')!;
  win.document.write(html);
  win.document.close(); win.print();
}

// ── Email modal ──
// The emailed PDF+CSV are built in MAIN from these filters (shared branded
// template with the scheduled report) — buildPeriodReportHTML() is only used
// by the in-app print/PDF path now.
async function openEmailModal(): Promise<void> {
  const from    = $field('period-from').value;
  const to      = $field('period-to').value;
  const coSel   = document.getElementById('period-company') as HTMLSelectElement;
  const coLabel = coSel.value ? coSel.options[coSel.selectedIndex].text : 'All Companies';
  const defaultSubject = `Conquered Time — Period Report — ${to}`;
  let defaultTo = '';
  try { const cfg = await api.invoke('email:get-config'); defaultTo = cfg.defaultTo || ''; } catch {}

  // Build modal
  const overlay = document.createElement('div');
  overlay.id = 'email-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:12px;padding:28px 32px;width:480px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.5);">
      <div style="font-family:var(--sans);font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Email Report</div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--text-muted);margin-bottom:20px;">${from} → ${to} · ${coLabel} · PDF + CSV attachment</div>
      <div style="margin-bottom:14px;">
        <label style="font-family:var(--sans);font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">To (comma-separated)</label>
        <input id="em-to" type="text" value="${defaultTo}" placeholder="recipient@example.com"
          style="width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg-input,var(--bg-panel));border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-family:var(--sans);font-size:12px;outline:none;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-family:var(--sans);font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Subject</label>
        <input id="em-subject" type="text" value="${defaultSubject}"
          style="width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg-input,var(--bg-panel));border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-family:var(--sans);font-size:12px;outline:none;">
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <button id="em-send-btn" style="padding:8px 20px;background:var(--accent);color:var(--bg-base,#0d0f14);border:none;border-radius:6px;font-family:var(--sans);font-size:12px;font-weight:600;cursor:pointer;">Send</button>
        <button id="em-cancel-btn" style="padding:8px 16px;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);font-family:var(--sans);font-size:12px;cursor:pointer;">Cancel</button>
        <span id="em-status" style="font-family:var(--sans);font-size:11px;color:var(--text-muted);"></span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  $id('em-cancel-btn').addEventListener('click', closeModal);
  $id('em-send-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('em-send-btn') as HTMLButtonElement;
    const statusEl = $id('em-status');
    const recips   = ((document.getElementById('em-to') as HTMLInputElement | null)?.value || '').trim();
    const subject  = ((document.getElementById('em-subject') as HTMLInputElement | null)?.value || '').trim();
    if (!recips) { statusEl.textContent = 'Enter at least one recipient.'; statusEl.style.color = 'var(--error,#e05252)'; return; }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    statusEl.textContent = 'Generating PDF…';
    statusEl.style.color = 'var(--text-muted)';
    try {
      const res = await api.invoke('email:send-report', { fromDate: from, toDate: to, companyId: coSel.value ? Number(coSel.value) : null, subject, recipients: recips });
      if (res.ok) {
        Shell.toast('Report sent successfully!', 'success');
        closeModal();
      } else {
        statusEl.textContent = res.error || 'Send failed.';
        statusEl.style.color = 'var(--error,#e05252)';
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.style.color = 'var(--error,#e05252)';
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  });
}

function exportCompanyPDF(): void {
  const grandTotal = allEntries.reduce((s,e)=>s+(e.total_mins||0),0);
  const rows = companies.map(co => {
    const ces = allEntries.filter(e=>Number(e.company_id)===Number(co.id));
    const m   = ces.reduce((s,e)=>s+(e.total_mins||0),0);
    return `<tr><td>${escapeHtml(co.name)}</td><td>${ces.length}</td><td style="text-align:right">${fmtM(m)}</td></tr>`;
  }).join('');
  const win = window.open('','_blank')!;
  win.document.write(`<!DOCTYPE html><html><head><title>Company Report</title>
  <style>body{font-family:DM Sans,Arial,sans-serif;font-size:12px;color:#111;padding:40px;max-width:900px;margin:0 auto;}
  h1{font-size:20px;font-weight:600;margin:0 0 4px;}.meta{color:#666;font-size:11px;margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;}
  th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:8px;text-align:left;font-size:11px;font-weight:600;color:#374151;}
  td{padding:7px 8px;border-bottom:1px solid #e5e7eb;}tr.total{font-weight:600;background:#f9fafb;}
  .footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;}</style>
  </head><body>
  <h1>Company Breakdown</h1>
  <div class="meta">All time · ${companies.length} companies · Grand total: ${fmtM(grandTotal)}</div>
  <table><thead><tr><th>Company</th><th>Sessions</th><th style="text-align:right">Total Hours</th></tr></thead>
  <tbody>${rows}<tr class="total"><td colspan="2">Grand Total</td><td style="text-align:right">${fmtM(grandTotal)}</td></tr></tbody></table>
  <div class="footer"><span>Generated by Conquered Time · ${new Date().toLocaleString()}</span><span>CONFIDENTIAL</span></div>
  </body></html>`);
  win.document.close(); win.print();
}

// ── CSV Export (Audit) ──
function exportCSV(): void {
  const rows: Array<Array<string | number>> = [];
  allEntries.forEach(e => {
    const co = companyMap[Number(e.company_id)];
    try {
      (JSON.parse(e.rows_json||'[]') as EntryRow[]).forEach(r => {
        if (!r.clock_in && !r.label && !r.name) return;
        rows.push([e.log_date, co?.name||`#${e.company_id}`, r.label||'', r.name||'', flattenText(r.desc), r.clock_in||'', r.clock_out||'', r.total_mins||0, fmtM(r.total_mins)]);
      });
    } catch {}
  });
  const header = ['Date','Company','Task Label','Task Name','Description','Clock In','Clock Out','Minutes','Duration'];
  // Quote, double embedded quotes, and neutralize CSV formula injection
  // (leading = + - @ tab CR) by prefixing a single quote.
  const csvCell = (v: unknown): string => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv    = [header,...rows].map(r=>r.map(csvCell).join(',')).join('\n');
  const blob   = new Blob([csv],{type:'text/csv'});
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href=url; a.download=`audit-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  Shell.toast('Audit log exported.','success');
}

})();
