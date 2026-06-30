'use strict';

// Time Tracker page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, IPC, Validator, Settings, escapeHtml, api) — must load after
// shell.js.

let companies = [], currentCompany = null, currentEntryId = null;
let rowsData = [];          // [{label,name,desc,clock_in,clock_out,total_mins}]
let selectedIndex = null;
let autoSaveTimer = null;
const MIN_ROWS = 5;

// ── Break & Lunch (relocated from Dispatch) ──────────────────────────────────
// Stored as task_items (entry_id-scoped, item_type 'break'|'lunch') — same data
// model as before; only the controls + compliance display now live here.
let taskItems     = [];     // task_items for the current entry (breaks/lunches/tasks)
let activeBreakId = null;   // in-progress break task_item id, or null
let activeLunchId = null;   // in-progress lunch task_item id, or null
let auditPolicy   = null;   // US-state break/lunch policy from audit:get-policy
let complianceTimer = null; // 60s tick refreshing the compliance status lines

// Display-only 12h/24h formatting. Stored/internal value is always 24h HH:MM
// (gotcha #8); this only affects how an already-stored time is shown.
function fmtClock(hhmm) {
  // Settings is a top-level const (not a window property) — guard via typeof.
  return (hhmm && typeof Settings !== 'undefined') ? Settings.formatTime(hhmm) : hhmm;
}

document.getElementById('log-date').valueAsDate = new Date();

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('tracker');
  document.documentElement.style.visibility = '';
  await loadCompanies();

  document.getElementById('company-select').addEventListener('change', onCompanyChange);
  document.getElementById('btn-clock-in').addEventListener('click', clockIn);
  document.getElementById('btn-clock-out').addEventListener('click', clockOut);
  document.getElementById('btn-manual-entry').addEventListener('click', addManualRow);
  document.getElementById('btn-clear-row').addEventListener('click', clearSelectedRow);
  document.getElementById('btn-clear-all').addEventListener('click', () => clearAll());
  document.getElementById('btn-save-session').addEventListener('click', () => saveSession());
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
  document.getElementById('btn-break').addEventListener('click', () => togglePunch('break'));
  document.getElementById('btn-lunch').addEventListener('click', () => togglePunch('lunch'));
  document.getElementById('log-date').addEventListener('change', () => { if (currentCompany) loadTodayEntry(); });

  // Break/lunch compliance policy + status ticker
  try { auditPolicy = await api.invoke('audit:get-policy'); } catch { auditPolicy = null; }
  setInterval(renderCompliance, 60000);

  ['log-date','log-notes','input-name','input-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.userSelect='text'; el.style.webkitUserSelect='text'; }
  });

  // Event delegation for row selection + inline editing
  const tbody = document.getElementById('tbody');
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    selectRow(parseInt(tr.dataset.idx));
  });
  tbody.addEventListener('dblclick', e => {
    const td = e.target.closest('td[data-field]');
    if (!td || !td.classList.contains('editable')) return;
    const tr = td.closest('tr');
    startEdit(td, parseInt(tr.dataset.idx), td.dataset.field);
  });

  // Live 12h/24h switch — re-render already-drawn rows in place (no reload).
  document.addEventListener('ct:settings-changed', e => {
    if (e.detail?.key === 'timeFormat') { renderTable(); updateTotals(); }
  });

  await initColResize();

  window.addEventListener('beforeunload', clearAutoSaveTimer);

  // Date must be applied before onCompanyChange(), which loads the entry for log-date.value.
  const targetDate = sessionStorage.getItem('tracker_date');
  if (targetDate) {
    document.getElementById('log-date').value = targetDate;
    sessionStorage.removeItem('tracker_date');
  }

  const saved = sessionStorage.getItem('active_company');
  if (saved) {
    try {
      const co = JSON.parse(saved);
      document.getElementById('company-select').value = co.id;
      await onCompanyChange();
      sessionStorage.removeItem('active_company');
    } catch {}
  }

  buildRows();
});

// ── Companies ──
async function loadCompanies() {
  companies = await Store.getCompanies();
  const sel = document.getElementById('company-select');
  sel.innerHTML = '<option value="">— Select Company —</option>';
  companies.forEach(co => {
    const id = Number(co.id);
    if (!id || isNaN(id)) return;
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = co.name || `Company #${id}`;
    sel.appendChild(opt);
  });
}

async function onCompanyChange() {
  const id = parseInt(document.getElementById('company-select').value);
  if (!id) { currentCompany = null; clearAutoSaveTimer(); updateHierarchyBar(); return; }
  currentCompany = companies.find(c => parseInt(c.id) === id) || null;
  currentEntryId = null;
  updateHierarchyBar();
  if (!document.getElementById('log-date').value)
    document.getElementById('log-date').valueAsDate = new Date();
  if (currentCompany) { await loadTodayEntry(); startAutoSaveTimer(); }
}

function updateHierarchyBar() {
  const bar = document.getElementById('hierarchy-bar');
  if (!currentCompany) { bar.innerHTML=''; return; }
  const co = currentCompany;
  const parts = [];
  if (co.hier_company)  parts.push(`<span class="hier-seg">${escapeHtml(co.hier_company)}</span>`);
  if (co.hier_project)  parts.push(`<span class="hier-sep">›</span><span class="hier-seg">${escapeHtml(co.hier_project)}</span>`);
  if (co.hier_platform) parts.push(`<span class="hier-sep">›</span><span class="hier-seg">${escapeHtml(co.hier_platform)}</span>`);
  if (co.nav_id)        parts.push(`<span class="hier-sep">›</span><span class="hier-navid">${escapeHtml(co.nav_id)}</span>`);
  bar.innerHTML = parts.length ? parts.join('') : `<span class="hier-seg">${escapeHtml(co.name)}</span>`;
}

async function loadTodayEntry() {
  if (!currentCompany) return;
  const today   = document.getElementById('log-date').value;
  const entries = await api.invoke('entries:list', currentCompany.id);
  const existing = entries.find(e => e.log_date === today);
  if (existing) {
    currentEntryId = existing.id;
    document.getElementById('log-notes').value = existing.session_label || '';
    restoreRows(JSON.parse(existing.rows_json || '[]'));
    document.getElementById('session-status').textContent = 'Session loaded';
    await loadTaskItems(existing.id);
  } else {
    currentEntryId = null;
    clearAll(true);
    await loadTaskItems(null);
  }
}

// Load the current entry's task_items (Dispatch tasks + break/lunch punches),
// derive active break/lunch state, and refresh both the Dispatch chip and the
// break/lunch strip. Single fetch shared by both UIs.
async function loadTaskItems(entryId) {
  taskItems = entryId ? (await api.invoke('tasks:list', entryId) || []) : [];
  activeBreakId = taskItems.find(t => t.item_type === 'break' && !t.stopped_at)?.id || null;
  activeLunchId = taskItems.find(t => t.item_type === 'lunch' && !t.stopped_at)?.id || null;
  updateDispatchChip();
  updateBreakButtons();
  renderCompliance();
}

// Footer Dispatch preview — task count + per-label chips (break/lunch now live
// in the control-panel strip, not here).
function updateDispatchChip() {
  const preview = document.getElementById('dispatch-preview');
  if (!preview) return;
  if (!currentEntryId) { preview.style.display = 'none'; return; }

  const completed = taskItems.filter(t => t.item_type === 'task' && t.stopped_at);
  preview.style.display = 'block';

  const countLabel = document.getElementById('dispatch-count-label');
  countLabel.textContent = completed.length > 0
    ? `${completed.length} task${completed.length === 1 ? '' : 's'}`
    : 'Dispatch';

  const chipsEl = document.getElementById('dispatch-task-chips');
  if (completed.length > 0) {
    const counts = {};
    completed.forEach(t => { counts[t.label] = (counts[t.label] || 0) + 1; });
    chipsEl.innerHTML = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([l, c]) => `<span class="breakdown-chip">${l}<span class="bc-time">${c > 1 ? ' ×' + c : ''}</span></span>`)
      .join('');
  } else {
    chipsEl.innerHTML = '';
  }
}

// ── Break & Lunch ────────────────────────────────────────────────────────────
// ms at the start of the active (clocked-in, not clocked-out) row, used as the
// "since clock-in" anchor for compliance. null when nothing is clocked in.
function sessionStartMs() {
  const active = rowsData.find(r => r.clock_in && !r.clock_out);
  if (!active) return null;
  const [h, m] = active.clock_in.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d.getTime();
}

function elapsedSince(ms) {
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function togglePunch(type) {
  if (!currentCompany) { Shell.toast('Select a company first.', 'warning'); return; }
  if (sessionStartMs() === null && !(type === 'break' ? activeBreakId : activeLunchId)) {
    Shell.toast('Clock in before starting a break or lunch.', 'warning');
    return;
  }
  // Break/lunch are scoped to an entry — make sure the session is saved first.
  if (!currentEntryId) { await saveSession(true); if (!currentEntryId) return; }

  const activeId = type === 'break' ? activeBreakId : activeLunchId;
  const label = type === 'break' ? 'Break' : 'Lunch';
  if (activeId) {
    const item = taskItems.find(t => t.id === activeId);
    const durationSecs = item ? Math.max(0, Math.floor((Date.now() - item.started_at) / 1000)) : 0;
    await api.invoke('tasks:save', { id: activeId, label, item_type: type, stopped_at: Date.now(), duration_secs: durationSecs });
    Shell.toast(`${label} ended.`, 'success');
  } else {
    await api.invoke('tasks:save', { entry_id: currentEntryId, label, item_type: type, started_at: Date.now(), duration_secs: 0 });
    Shell.toast(`${label} started.`, 'success');
  }
  await loadTaskItems(currentEntryId);
}

function updateBreakButtons() {
  const b = document.getElementById('btn-break');
  const l = document.getElementById('btn-lunch');
  if (b) { b.textContent = activeBreakId ? '✓ End Break' : '☕ Break'; b.classList.toggle('bl-active', !!activeBreakId); }
  if (l) { l.textContent = activeLunchId ? '✓ End Lunch' : '🍽 Lunch';  l.classList.toggle('bl-active', !!activeLunchId); }
}

// Returns 'ok' | 'warn' | 'over' for break/lunch relative to the US-state policy.
function checkComplianceStatus(type) {
  const p = auditPolicy;
  let thresholdMs, warnMs;
  if (type === 'break') {
    const rawDue  = p?.breakThresholds?.[0]?.[0];
    thresholdMs   = (rawDue != null) ? rawDue * 60000 : Infinity;
    const rawWarn = p?.dispatchBreakWarnMins;
    warnMs        = (rawWarn != null) ? rawWarn * 60000 : Infinity;
  } else {
    thresholdMs   = p ? p.lunchThreshMins * 60000 : 5 * 3600000;
    const rawWarn = p?.dispatchLunchWarnMins;
    warnMs        = (rawWarn != null) ? rawWarn * 60000 : 4.5 * 3600000;
  }
  if ((type === 'break' ? activeBreakId : activeLunchId)) return 'ok'; // currently on it
  const relevant = taskItems.filter(t => t.item_type === type && t.stopped_at);
  const start = sessionStartMs();
  const lastStop = relevant.length ? Math.max(...relevant.map(t => t.stopped_at)) : (start || Date.now());
  const elapsed = Date.now() - lastStop;
  if (elapsed >= thresholdMs) return 'over';
  if (elapsed >= warnMs) return 'warn';
  return 'ok';
}

const DOT_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>';

function renderCompliance() {
  renderComplianceFor('break');
  renderComplianceFor('lunch');
}

function renderComplianceFor(type) {
  const el = document.getElementById(`compliance-${type}`);
  if (!el) return;
  const status = checkComplianceStatus(type);
  el.className = `bl-compliance ${status}`;

  const activeId = type === 'break' ? activeBreakId : activeLunchId;
  if (activeId) {
    el.innerHTML = `${DOT_SVG} ${type === 'break' ? 'On break' : 'On lunch'}`;
    return;
  }
  const start = sessionStartMs();
  if (start === null) { el.innerHTML = `${DOT_SVG} ${type === 'break' ? 'Break' : 'Lunch'}: clock in to track`; return; }

  const relevant = taskItems.filter(t => t.item_type === type && t.stopped_at);
  if (!relevant.length) {
    const elStr = elapsedSince(start);
    if (status === 'over')      el.innerHTML = `${DOT_SVG} ⚠ No ${type} taken — ${elStr} since clock-in`;
    else if (status === 'warn') el.innerHTML = `${DOT_SVG} Approaching ${type} time (${elStr})`;
    else                        el.innerHTML = `${DOT_SVG} No ${type} yet — ${elStr} since clock-in`;
    return;
  }
  const elStr = elapsedSince(Math.max(...relevant.map(t => t.stopped_at)));
  el.innerHTML = status === 'over'
    ? `${DOT_SVG} ⚠ ${type === 'break' ? 'Break' : 'Lunch'} overdue — last ${type} ${elStr} ago`
    : `${DOT_SVG} Last ${type}: ${elStr} ago ✓`;
}

// ── Row data helpers ──
function emptyRow() { return { label:'', name:'', desc:'', clock_in:'', clock_out:'', total_mins:0 }; }
// _manual rows are backfill entries: editable + retained even before any field is
// filled, so the user can type in a session they forgot to clock live.
function isRowFilled(r) { return !!(r._manual || r.label || r.name || r.desc || r.clock_in || r.total_mins > 0); }

// Ensure: minimum MIN_ROWS rows, exactly one trailing empty "buffer" row, no runs of unused empty rows
function normalizeRows() {
  while (rowsData.length < MIN_ROWS) rowsData.push(emptyRow());
  // Trim extra trailing empty rows beyond a single buffer (never below MIN_ROWS)
  while (rowsData.length > MIN_ROWS) {
    const last = rowsData[rowsData.length-1];
    const secondLast = rowsData[rowsData.length-2];
    if (!isRowFilled(last) && !isRowFilled(secondLast)) rowsData.pop();
    else break;
  }
  // Ensure last row is always an empty buffer row ready for new entries
  if (isRowFilled(rowsData[rowsData.length-1])) rowsData.push(emptyRow());
}

// ── Build / render ──
function buildRows() {
  rowsData = [];
  normalizeRows();
  renderTable();
  updateTotals();
}

function renderTable() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = rowsData.map((r, idx) => rowHTML(r, idx)).join('');
}

// ── Resizable columns ──
// Widths are stored as percentages summing to 100 so the table keeps its
// overall size and dragging a divider redistributes width with its neighbour
// (internal widths change, total stays fixed). Persisted per-profile under
// ui_trackerColWidths; double-click a divider resets to defaults.
const COLW_KEY      = 'ui_trackerColWidths';
const DEFAULT_COLPX = [36, 24, 120, 140, 220, 85, 85, 80]; // #, dot, Label, Name, Desc, In, Out, Total
const MIN_COL_PCT   = 3;
let colPcts = null;

function pxToPct(arr) {
  const sum = arr.reduce((a, b) => a + b, 0);
  return arr.map(w => (w / sum) * 100);
}

function applyColWidths() {
  const cols = document.querySelectorAll('#tracker-table colgroup col');
  cols.forEach((c, i) => { if (colPcts[i] != null) c.style.width = colPcts[i] + '%'; });
}

async function initColResize() {
  let pcts = null;
  try {
    const saved = await api.invoke('settings:get', COLW_KEY);
    if (saved) pcts = JSON.parse(saved);
  } catch {}
  if (!Array.isArray(pcts) || pcts.length !== DEFAULT_COLPX.length) pcts = pxToPct(DEFAULT_COLPX);
  colPcts = pcts;
  applyColWidths();
  installColResizers();
}

function installColResizers() {
  const ths = document.querySelectorAll('#tracker-table thead th');
  ths.forEach((th, i) => {
    if (i >= ths.length - 1) return;              // last column has no right divider
    if (th.querySelector('.col-resizer')) return; // idempotent
    const h = document.createElement('div');
    h.className = 'col-resizer';
    h.title = 'Drag to resize · double-click to reset';
    h.addEventListener('mousedown', e => startColDrag(e, i, h));
    h.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); resetColWidths(); });
    th.appendChild(h);
  });
}

function startColDrag(e, i, handle) {
  e.preventDefault(); e.stopPropagation();
  const table  = document.getElementById('tracker-table');
  const tableW = table.getBoundingClientRect().width;
  const startX = e.clientX;
  const a0 = colPcts[i], b0 = colPcts[i + 1];
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const move = ev => {
    let d = ((ev.clientX - startX) / tableW) * 100;
    // Clamp so neither the dragged column nor its neighbour drops below the min.
    d = Math.max(d, MIN_COL_PCT - a0);
    d = Math.min(d, b0 - MIN_COL_PCT);
    colPcts[i] = a0 + d;
    colPcts[i + 1] = b0 - d;
    applyColWidths();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveColWidths();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function resetColWidths() {
  colPcts = pxToPct(DEFAULT_COLPX);
  applyColWidths();
  saveColWidths();
  Shell.toast('Column widths reset.', 'info', 2000);
}

function saveColWidths() {
  try { api.invoke('settings:set', { key: COLW_KEY, value: JSON.stringify(colPcts) }); } catch {}
}

function rowHTML(r, idx) {
  const filled = isRowFilled(r);
  const editableText = filled ? 'editable' : '';
  const editableIn    = (r.clock_in  || r._manual) ? 'editable' : '';
  const editableOut   = (r.clock_out || r._manual) ? 'editable' : '';
  const dotClass = (r.clock_in && !r.clock_out) ? 'status-dot active' : (filled ? 'status-dot done' : 'status-dot');
  const activeCls = selectedIndex === idx ? 'row-active' : '';
  return `<tr data-idx="${idx}" class="${activeCls}">
    <td class="row-num">${String(idx+1).padStart(2,'0')}</td>
    <td style="text-align:center;"><span class="${dotClass}"></span></td>
    <td class="${r.label?'cell-label':'cell-empty'} ${editableText}" data-field="label" title="${filled?'Double-click to edit':''}">${escapeHtml(r.label)||'—'}</td>
    <td class="${r.name?'cell-text':'cell-empty'} ${editableText}" data-field="name" title="${filled?'Double-click to edit':''}">${escapeHtml(r.name)||'—'}</td>
    <td class="${r.desc?'cell-desc':'cell-empty'} ${editableText}" data-field="desc" title="${r.desc?escapeHtml(r.desc):(filled?'Double-click to edit':'')}">${r.desc?`<span class="desc-clamp">${escapeHtml(r.desc)}</span>`:'—'}</td>
    <td class="cell-time ${r.clock_in?'has-time':''} ${editableIn}" data-field="clock_in" title="${r.clock_in?'Double-click to edit':''}">${fmtClock(r.clock_in)||'—'}</td>
    <td class="cell-time ${r.clock_out?'has-time':''} ${editableOut}" data-field="clock_out" title="${r.clock_out?'Double-click to edit':''}">${fmtClock(r.clock_out)||'—'}</td>
    <td class="cell-duration" data-field="duration">${r.total_mins>0?formatMins(r.total_mins):'—'}</td>
  </tr>`;
}

function restoreRows(rows) {
  rowsData = (rows||[]).map(r => ({
    label: r.label||'', name: r.name||'', desc: r.desc||'',
    clock_in: r.clock_in||'', clock_out: r.clock_out||'', total_mins: r.total_mins||0,
    _manual: !!r._manual
  }));
  normalizeRows();
  selectedIndex = null;
  renderTable();
  updateTotals();
}

function selectRow(idx) {
  selectedIndex = idx;
  document.querySelectorAll('#tbody tr').forEach(tr => {
    tr.classList.toggle('row-active', parseInt(tr.dataset.idx) === idx);
  });
}

function nowTime() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

function formatMins(total) {
  if (total <= 0) return '—';
  const h = Math.floor(total/60), m = total%60;
  return h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m`;
}

function computeDiffMins(inT, outT) {
  const [ih,im] = inT.split(':').map(Number);
  const [oh,om] = outT.split(':').map(Number);
  let diff = (oh*60+om) - (ih*60+im);
  if (diff < 0) diff += 1440;
  return diff;
}

// ── Clock in/out ──
function clockIn() {
  if (!currentCompany) { Shell.toast('Select a company first.', 'warning'); return; }
  const label = document.getElementById('input-label').value;
  const name  = document.getElementById('input-name').value.trim();
  const desc  = document.getElementById('input-desc').value.trim();
  // Both a Task Label and a Task Name are required to clock in. Clock Out is
  // implicitly covered (it acts on a row that was clocked in with both). Only
  // "+ Manual Entry" bypasses this, for backfilling a forgotten session.
  if (!label || !name) {
    Shell.toast('A Task Label and Task Name are required to clock in.', 'warning');
    if (!label) document.getElementById('input-label').focus();
    else document.getElementById('input-name').focus();
    return;
  }
  const t = nowTime();

  let idx = -1;
  if (selectedIndex != null && rowsData[selectedIndex] && !isRowFilled(rowsData[selectedIndex])) idx = selectedIndex;
  if (idx === -1) idx = rowsData.findIndex(r => !isRowFilled(r));
  if (idx === -1) { rowsData.push(emptyRow()); idx = rowsData.length - 1; }

  const row = rowsData[idx];
  row.label = label; row.name = name; row.desc = desc; row.clock_in = t;
  selectedIndex = idx;

  normalizeRows();
  renderTable();
  updateTotals();
  autoSave();
}

function clockOut() {
  let idx = -1;
  if (selectedIndex != null && rowsData[selectedIndex] && rowsData[selectedIndex].clock_in && !rowsData[selectedIndex].clock_out) idx = selectedIndex;
  if (idx === -1) idx = rowsData.findIndex(r => r.clock_in && !r.clock_out);
  if (idx === -1) { Shell.toast('No active clock-in found.', 'warning'); return; }

  const row = rowsData[idx];
  const t = nowTime();
  const diff = computeDiffMins(row.clock_in, t);
  row.clock_out = t;
  row.total_mins = (row.total_mins||0) + diff;
  selectedIndex = idx;

  normalizeRows();
  renderTable();
  updateTotals();
  autoSave();
}

// Backfill a session that wasn't clocked live: add an editable row and open the
// label cell for immediate entry. The row persists (isRowFilled treats _manual
// as filled) so the dynamic table won't trim it before the user types.
function addManualRow() {
  if (!currentCompany) { Shell.toast('Select a company first.', 'warning'); return; }
  const row = emptyRow();
  row._manual = true;
  rowsData.push(row);
  normalizeRows();
  selectedIndex = rowsData.indexOf(row);
  renderTable();
  updateTotals();
  const cell = document.querySelector(`#tbody tr[data-idx="${selectedIndex}"] td[data-field="label"]`);
  if (cell) startEdit(cell, selectedIndex, 'label');
}

// ── Inline editing ──
function startEdit(cell, idx, field) {
  const row = rowsData[idx];
  if (!row) return;
  const isTime  = field === 'clock_in' || field === 'clock_out';
  // Time cells display in the 12h/24h preference, but editing is always raw 24h
  // HH:MM (gotcha #8) — seed from the stored value, not the formatted cell text.
  const current = isTime ? (row[field] || '')
                : cell.textContent === '—' ? '' : cell.textContent;
  const isLabel = field === 'label';
  const isDesc  = field === 'desc';
  // Description seeds from the raw stored value (may contain newlines), not the
  // clamped/escaped cell text.
  const seed = isDesc ? (row.desc || '') : current;
  const original = cell.innerHTML;

  let input;
  if (isLabel) {
    input = document.createElement('select');
    input.style.cssText = 'font-family:var(--sans);font-size:12px;background:var(--surface-2);color:var(--text-bright);border:1px solid var(--accent);border-radius:4px;width:100%;';
    ['Training','Evaluation','Review','Annotation','QA','Research','Admin','Communication','Other'].forEach(opt => {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (opt === current) o.selected = true;
      input.appendChild(o);
    });
  } else if (isDesc) {
    // Multi-line, auto-growing editor (Companies-notes style). Enter inserts a
    // newline; Ctrl/Cmd+Enter or blur commits; Escape cancels.
    input = document.createElement('textarea');
    input.value = seed;
    input.rows = Math.min(8, Math.max(2, seed.split('\n').length));
    input.placeholder = 'Description… (Enter for new line, Ctrl+Enter to save)';
    input.style.cssText = 'font-family:var(--sans);font-size:12px;line-height:1.5;background:var(--surface-2);color:var(--text-bright);border:1px solid var(--accent);border-radius:4px;width:100%;padding:4px 6px;resize:vertical;min-height:48px;user-select:text;-webkit-user-select:text;';
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(200, input.scrollHeight) + 'px'; };
    input.addEventListener('input', grow);
    setTimeout(grow, 0);
  } else {
    input = document.createElement('input');
    input.type = 'text'; input.value = current;
    if (isTime) {
      input.placeholder = 'HH:MM'; input.maxLength = 5;
      input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9:]/g,''); });
    }
    input.style.cssText = 'font-family:var(--sans);font-size:12px;background:var(--surface-2);color:var(--text-bright);border:1px solid var(--accent);border-radius:4px;width:100%;padding:2px 6px;user-select:text;-webkit-user-select:text;';
  }

  cell.innerHTML = ''; cell.appendChild(input);
  input.focus(); if (input.select) input.select();

  const commit = () => {
    const val = input.value.trim();
    if (isTime) {
      if (!val) { cell.innerHTML = original; return; }
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(val)) {
        Shell.toast('Use HH:MM 24-hour format', 'error');
        cell.innerHTML = original; return;
      }
      const [h,m] = val.split(':');
      const norm = `${String(parseInt(h)).padStart(2,'0')}:${m}`;
      row[field] = norm;
      if (row.clock_in && row.clock_out) {
        row.total_mins = computeDiffMins(row.clock_in, row.clock_out);
      }
    } else if (val) {
      row[field] = val;
    } else {
      cell.innerHTML = original; return;
    }
    normalizeRows();
    renderTable();
    updateTotals();
    autoSave();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    // Description is multi-line: plain Enter inserts a newline, Ctrl/Cmd+Enter
    // commits. Single-line fields commit on plain Enter.
    if (e.key === 'Enter') {
      if (isDesc && !(e.ctrlKey || e.metaKey)) return;   // let the newline through
      e.preventDefault();
      input.removeEventListener('blur', commit); commit();
    }
    // Detach the blur handler first — reverting innerHTML removes the input,
    // which would otherwise fire blur → commit and save the cancelled value.
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cell.innerHTML = original; }
  });
}

// ── Totals + breakdown ──
function updateTotals() {
  let total = 0;
  const byLabel = {};
  rowsData.forEach(r => {
    if (r.total_mins > 0) {
      total += r.total_mins;
      const l = r.label || 'Other';
      byLabel[l] = (byLabel[l]||0) + r.total_mins;
    }
  });
  document.getElementById('total-time').textContent = total>0 ? formatMins(total) : '0h 00m';
  document.getElementById('rows-done').textContent  = rowsData.filter(isRowFilled).length;
  document.getElementById('rows-total').textContent = rowsData.length;

  const breakdownEl = document.getElementById('breakdown-row');
  const entries = Object.entries(byLabel);
  breakdownEl.innerHTML = entries.length
    ? entries.map(([l,m]) => `<span class="breakdown-chip">${l} <span class="bc-time">${formatMins(m)}</span></span>`).join('')
    : '';
}

// ── Auto-save timer ──
function startAutoSaveTimer() {
  clearAutoSaveTimer();
  const secs = parseInt(Settings.get('autoSaveInterval') ?? 60, 10);
  if (!secs || !currentCompany) { updateStatusDot(); return; }
  autoSaveTimer = setInterval(async () => {
    await autoSave(true);
  }, secs * 1000);
  updateStatusDot();
}

function clearAutoSaveTimer() {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
  updateStatusDot();
}

function updateStatusDot() {
  const badge = document.getElementById('live-badge');
  if (!badge) return;
  const secs = parseInt(Settings.get('autoSaveInterval') ?? 60, 10);
  const isLive = !!(currentCompany && secs > 0 && autoSaveTimer);
  badge.style.display = isLive ? 'flex' : 'none';
}

// Called by shell.js applyAutoSave when user changes the setting
function onAutoSaveSettingChanged(seconds) {
  startAutoSaveTimer();
}

// ── Save / clear ──
async function autoSave(fromTimer = false) { if (currentCompany) await saveSession(true, fromTimer); }

async function saveSession(silent=false, fromTimer=false) {
  if (!currentCompany) { if(!silent) Shell.toast('Select a company first.','warning'); return; }
  let total = 0;
  rowsData.forEach(r => total += (r.total_mins||0));
  const entry = {
    id: currentEntryId,
    company_id: currentCompany.id,
    log_date: document.getElementById('log-date').value,
    session_label: document.getElementById('log-notes').value.trim(),
    rows_json: JSON.stringify(rowsData),
    total_mins: total
  };
  const valid = Validator.validateEntry(entry);
  if (!valid.ok) { if (!silent) Shell.toast(valid.error, 'error'); return; }
  const res = await IPC.entries.save(entry);
  if (res.ok) {
    if (!currentEntryId && res.id) currentEntryId = res.id;
    Store.invalidate('entries');
    loadTaskItems(currentEntryId);
    if (!silent) Shell.toast('Session saved.', 'success');
    const label = fromTimer ? `Auto-saved at ${nowTime()}` : `Saved at ${nowTime()}`;
    document.getElementById('session-status').textContent = label;
    // Restore live dot label after a delay if timer is active
    setTimeout(updateStatusDot, 4000);
  } else if (!silent) Shell.toast(res.error || 'Save failed.', 'error');
}

function clearSelectedRow() {
  if (selectedIndex == null || !rowsData[selectedIndex]) return;
  rowsData[selectedIndex] = emptyRow();
  normalizeRows();
  renderTable();
  updateTotals();
  autoSave();
}

function clearAll(silent=false) {
  if (!silent && !confirm('Clear all entries?')) return;
  rowsData = [];
  normalizeRows();
  selectedIndex = null;
  renderTable();
  updateTotals();
}

// ── PDF Export ──
function exportPDF() {
  if (!currentCompany) { Shell.toast('Select a company first.','warning'); return; }
  const co = currentCompany;
  const date = document.getElementById('log-date').value;
  const note = document.getElementById('log-notes').value;
  const hierParts = [co.hier_company,co.hier_project,co.hier_platform,co.name].filter(Boolean).join(' › ');

  const filledRows = rowsData.filter(r => isRowFilled(r));
  let rows = '', total = 0;
  filledRows.forEach((r, i) => {
    total += r.total_mins||0;
    rows += `<tr><td>${String(i+1).padStart(2,'0')}</td><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(flattenText(r.desc))}</td><td>${r.clock_in||''}</td><td>${r.clock_out||''}</td><td>${formatMins(r.total_mins||0)}</td></tr>`;
  });

  const breakdown = pdfLabelBreakdown(filledRows);
  const bdHtml = breakdown.length >= 2 ? `
    <h2 style="font-size:12px;font-weight:600;color:#374151;margin:20px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">Time by Label</h2>
    <table style="width:260px;">
      <thead><tr><th>Label</th><th style="text-align:right;">Total</th></tr></thead>
      <tbody>${breakdown.map(([lbl,mins])=>`<tr><td>${escapeHtml(lbl)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${formatMins(mins)}</td></tr>`).join('')}</tbody>
    </table>` : '';

  const metaLines = [
    `<div class="meta">${escapeHtml(co.job_title)}${note?' · '+escapeHtml(note):''}</div>`,
    co.work_type ? `<div class="meta">Work type: ${escapeHtml(co.work_type)}</div>` : '',
    co.location  ? `<div class="meta">Location: ${escapeHtml(co.location)}</div>` : '',
    co.supervisors ? `<div class="meta">Submitted to: ${escapeHtml(co.supervisors)}</div>` : '',
  ].join('');

  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Timesheet</title>
  <style>${window.PDF_FONT_CSS || ''}</style>
  <style>
    body{font-family:Inter,system-ui,sans-serif;font-size:12px;color:#111;padding:40px;max-width:960px;margin:0 auto;}
    h1{font-size:20px;font-weight:600;margin:0 0 3px;}
    .meta{color:#666;font-size:11px;margin-bottom:3px;}
    .hier{font-size:11px;color:#2563eb;margin-bottom:20px;font-weight:500;}
    table{width:100%;border-collapse:collapse;margin-top:12px;}
    th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:9px 8px;text-align:left;font-size:11px;font-weight:600;color:#374151;}
    td{padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;}
    .total-row{font-weight:600;background:#f9fafb;}
    .footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;}
  </style></head><body>
  <h1>${escapeHtml(co.name)}</h1>
  ${metaLines}
  <div class="hier">${escapeHtml(hierParts)}</div>
  <div class="meta">Date: ${escapeHtml(date)}</div>
  <table>
    <thead><tr><th>#</th><th>Task Label</th><th>Name</th><th>Description</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
    <tbody>${rows}<tr class="total-row"><td colspan="6" style="text-align:right;padding-right:12px;">Total</td><td>${formatMins(total)}</td></tr></tbody>
  </table>
  ${bdHtml}
  <div class="footer"><span>Generated by Conquered Time · ${new Date().toLocaleString()}</span><span>CONFIDENTIAL</span></div>
  </body></html>`);
  win.document.close(); win.print();
}

function pdfLabelBreakdown(rows) {
  const map = {};
  rows.filter(r => r.label).forEach(r => { map[r.label] = (map[r.label]||0) + (r.total_mins||0); });
  return Object.entries(map).sort((a,b) => b[1]-a[1]);
}

function onExportPDF() { exportPDF(); }
