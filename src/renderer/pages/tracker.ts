'use strict';

// Time Tracker page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, IPC, Validator, Settings, escapeHtml, api) — must load after
// shell.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json. The two shell
// hooks (onExportPDF, onAutoSaveSettingChanged) that shell.js probes as globals
// are assigned onto window explicitly at the end.
(() => {

interface RowData {
  label: string; name: string; desc: string;
  clock_in: string; clock_out: string; total_mins: number;
  _manual?: boolean;
  /** Precise epoch-ms captured at clock-in so the live timer starts at 0:00
   *  instead of the seconds already elapsed in the current minute (clock_in is
   *  minute-truncated HH:MM). Trusted only while it still matches clock_in's
   *  minute; edits/legacy rows fall back to the HH:MM computation. */
  clock_in_ms?: number;
}
// Editable string-valued fields (duration is display-only, never edited).
type StrField = 'label' | 'name' | 'desc' | 'clock_in' | 'clock_out';

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

let companies: Company[] = [], currentCompany: Company | null = null;
let currentEntryId: number | null = null;
// Optimistic-concurrency token: the `updated_at` we last read/saved for
// currentEntryId. Sent with every save so entries:save can reject a stale write
// (a concurrent writer saved a newer version) instead of clobbering it.
let currentEntryUpdatedAt: number | null = null;
let rowsData: RowData[] = [];          // [{label,name,desc,clock_in,clock_out,total_mins}]
let selectedIndex: number | null = null;
let autoSaveTimer: ReturnType<typeof setInterval> | null = null;
const MIN_ROWS = 5;

// ── Break & Lunch (relocated from Dispatch) ──────────────────────────────────
// Stored as task_items (entry_id-scoped, item_type 'break'|'lunch') — same data
// model as before; only the controls + compliance display now live here.
let taskItems: TaskItem[] = [];     // task_items for the current entry (breaks/lunches/tasks)
let activeBreakId: number | null = null;   // in-progress break task_item id, or null
let activeLunchId: number | null = null;   // in-progress lunch task_item id, or null
let auditPolicy: AuditPolicy | null = null;   // US-state break/lunch policy from audit:get-policy

// Display-only 12h/24h formatting. Stored/internal value is always 24h HH:MM
// (gotcha #8); this only affects how an already-stored time is shown.
function fmtClock(hhmm: string | undefined): string {
  // Settings is a top-level const (not a window property) — guard via typeof.
  return (hhmm && typeof Settings !== 'undefined') ? Settings.formatTime(hhmm) : (hhmm || '');
}

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('tracker');
  document.documentElement.style.visibility = '';
  // Default the log date AFTER Shell.init — its innerHTML swap discards
  // JS-set input values, so a pre-init default never survives. LOCAL date,
  // not valueAsDate: valueAsDate treats the Date as UTC, so any evening use
  // (US timezones) defaulted the tracker to TOMORROW and filed punches under
  // a future date (the v3.13 stale-punch / negative-timer bug).
  if (!$input('log-date').value) $input('log-date').value = RowUtils.localDateStr();
  await loadCompanies();

  $id('company-select').addEventListener('change', onCompanyChange);
  $id('btn-clock-in').addEventListener('click', clockIn);
  $id('btn-clock-out').addEventListener('click', () => clockOut());
  $id('btn-manual-entry').addEventListener('click', addManualRow);
  $id('btn-clear-row').addEventListener('click', clearSelectedRow);
  $id('btn-clear-all').addEventListener('click', () => clearAllPrompt());
  $id('btn-save-session').addEventListener('click', () => saveSession());
  $id('btn-export-pdf').addEventListener('click', exportPDF);
  $id('btn-break').addEventListener('click', () => togglePunch('break'));
  $id('btn-lunch').addEventListener('click', () => togglePunch('lunch'));
  $id('log-date').addEventListener('change', () => { if (currentCompany) loadTodayEntry(); });
  $id('btn-switch-session').addEventListener('click', switchSession); // C6 (D-005)

  // Break/lunch compliance policy + status ticker
  try { auditPolicy = await api.invoke('audit:get-policy'); } catch { auditPolicy = null; }
  setInterval(renderCompliance, 60000);

  ['log-date','log-notes','input-name','input-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.userSelect='text'; el.style.webkitUserSelect='text'; }
  });

  // Event delegation for row selection + inline editing
  const tbody = $id('tbody');
  tbody.addEventListener('click', e => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr');
    if (!tr) return;
    selectRow(parseInt(tr.dataset.idx || ''));
  });
  tbody.addEventListener('dblclick', e => {
    const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-field]');
    if (!td || !td.classList.contains('editable')) return;
    const tr = td.closest('tr') as HTMLElement;
    startEdit(td, parseInt(tr.dataset.idx || ''), td.dataset.field as StrField);
  });
  // Right-click a filled row → Edit / Duplicate / Clear (shared Shell.contextMenu).
  tbody.addEventListener('contextmenu', e => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-idx]');
    if (!tr) return;
    const idx = parseInt(tr.dataset.idx || '');
    if (isNaN(idx) || !rowsData[idx] || !isRowFilled(rowsData[idx])) return;
    selectRow(idx);
    rowContextMenu(e as MouseEvent, idx);
  });

  // Live 12h/24h switch — re-render already-drawn rows in place (no reload).
  document.addEventListener('ct:settings-changed', e => {
    if ((e as CustomEvent).detail?.key === 'timeFormat') { renderTable(); updateTotals(); }
  });

  // External punch (tray menu / global hotkey) — main wrote the entry behind
  // our back, so our in-memory rows AND concurrency token are stale (the next
  // autosave would be rejected). Reload the affected session in place.
  api.on('punch:changed', async (payload: any) => {
    const entryId   = Number(payload?.entry_id || 0);
    const companyId = Number(payload?.company_id || 0);
    if (!currentCompany) return;
    const sameEntry   = entryId && entryId === currentEntryId;
    const sameCompany = companyId && Number(currentCompany.id) === companyId
      && $input('log-date').value === RowUtils.localDateStr();
    if (!sameEntry && !sameCompany) return;
    if (sameEntry) {
      const fresh = await api.invoke('entries:get', entryId);
      if (fresh) await loadEntryIntoTracker(fresh as TimeEntry);
    } else {
      sessionStorage.setItem('tracker_entry', String(entryId)); // land on the punched session
      await loadTodayEntry();
    }
    Shell.toast('Session updated by a tray/hotkey punch.', 'info');
  });

  await initColResize();

  window.addEventListener('beforeunload', clearAutoSaveTimer);

  // Date must be applied before onCompanyChange(), which loads the entry for log-date.value.
  const targetDate = sessionStorage.getItem('tracker_date');
  if (targetDate) {
    $input('log-date').value = targetDate;
    sessionStorage.removeItem('tracker_date');
  }

  const saved = sessionStorage.getItem('active_company');
  if (saved) {
    try {
      const co = JSON.parse(saved);
      $input('company-select').value = co.id;
      await onCompanyChange();
      sessionStorage.removeItem('active_company');
    } catch {}
  }

  // No explicit handoff (sessionStorage) restored a session? If there's an
  // active punch, land on ITS session instead of an empty "Select a company"
  // page — finishing a task elsewhere and returning here to clock out used to
  // require re-selecting the company by hand (user report 2026-07-19).
  if (!currentEntryId) {
    try {
      const act = await api.invoke('entries:get-active') as TimeEntry | null;
      if (act && act.company_id) {
        $input('company-select').value = String(act.company_id);
        $input('log-date').value = act.log_date || RowUtils.localDateStr();
        sessionStorage.setItem('tracker_entry', String(act.id)); // land on the punched session
        await onCompanyChange();
      }
    } catch {}
  }

  // Only build the blank 5-row table when nothing was restored above —
  // buildRows() unconditionally wipes rowsData, which erased the loaded
  // session on the Global-Log-Open / dashboard-node path (found during C6).
  if (!currentEntryId) buildRows();
});

// ── Companies ──
async function loadCompanies(): Promise<void> {
  companies = await Store.getCompanies();
  const sel = $id('company-select');
  sel.innerHTML = '<option value="">— Select Company —</option>';
  companies.forEach(co => {
    const id = Number(co.id);
    if (!id || isNaN(id)) return;
    const opt = document.createElement('option');
    opt.value = String(id); opt.textContent = co.name || `Company #${id}`;
    sel.appendChild(opt);
  });
}

async function onCompanyChange(): Promise<void> {
  const id = parseInt($input('company-select').value);
  if (!id) { currentCompany = null; clearAutoSaveTimer(); updateHierarchyBar(); return; }
  currentCompany = companies.find(c => Number(c.id) === id) || null;
  currentEntryId = null;
  currentEntryUpdatedAt = null;
  updateHierarchyBar();
  if (!$input('log-date').value)
    $input('log-date').value = RowUtils.localDateStr(); // local, never valueAsDate (UTC)
  if (currentCompany) { await loadTodayEntry(); startAutoSaveTimer(); }
}

function updateHierarchyBar(): void {
  const bar = $id('hierarchy-bar');
  if (!currentCompany) { bar.innerHTML=''; return; }
  const co = currentCompany;
  const parts: string[] = [];
  if (co.hier_company)  parts.push(`<span class="hier-seg">${escapeHtml(co.hier_company)}</span>`);
  if (co.hier_project)  parts.push(`<span class="hier-sep">›</span><span class="hier-seg">${escapeHtml(co.hier_project)}</span>`);
  if (co.hier_platform) parts.push(`<span class="hier-sep">›</span><span class="hier-seg">${escapeHtml(co.hier_platform)}</span>`);
  if (co.nav_id)        parts.push(`<span class="hier-sep">›</span><span class="hier-navid">${escapeHtml(co.nav_id)}</span>`);
  bar.innerHTML = parts.length ? parts.join('') : `<span class="hier-seg">${escapeHtml(co.name)}</span>`;
}

// C6 (D-005): the data model allows several sessions on the same date, but the
// tracker used to load the FIRST match only — the second session was
// unreachable. Now: an explicit target (Global Log "Open" → tracker_entry)
// wins; otherwise multiple matches open a session picker; a "Switch session"
// button re-opens it after load.
let sameDateEntries: TimeEntry[] = [];

async function loadTodayEntry(): Promise<void> {
  if (!currentCompany) return;
  const today   = $input('log-date').value;
  const entries = await api.invoke('entries:list', currentCompany.id) || [];
  const matches = entries.filter(e => e.log_date === today);
  sameDateEntries = matches;

  let existing: TimeEntry | null = null;
  const preferId = Number(sessionStorage.getItem('tracker_entry') || 0);
  sessionStorage.removeItem('tracker_entry'); // one-shot, like tracker_date
  if (preferId) existing = matches.find(e => e.id === preferId) || null;
  if (!existing && matches.length > 1) existing = await pickSession(matches);
  if (!existing) existing = matches[0] || null;

  await loadEntryIntoTracker(existing);
}

async function loadEntryIntoTracker(existing: TimeEntry | null): Promise<void> {
  if (existing) {
    currentEntryId = existing.id;
    currentEntryUpdatedAt = existing.updated_at ?? null;
    $input('log-notes').value = existing.session_label || '';
    restoreRows(JSON.parse(existing.rows_json || '[]'));
    $id('session-status').textContent =
      sameDateEntries.length > 1
        ? `Session ${sameDateEntries.findIndex(e => e.id === existing!.id) + 1} of ${sameDateEntries.length} loaded`
        : 'Session loaded';
    await loadTaskItems(existing.id);
  } else {
    currentEntryId = null;
    currentEntryUpdatedAt = null;
    clearAll();
    await loadTaskItems(null);
  }
  const sw = document.getElementById('btn-switch-session');
  if (sw) sw.style.display = sameDateEntries.length > 1 ? '' : 'none';
  // Reflect whether the loaded session already has an open punch (e.g. the app
  // was reopened mid-session) in both the header and sidebar LIVE badges.
  updateStatusDot();
}

// Modal session picker for same-date sessions. Resolves with the chosen entry
// (or the first one if dismissed). Built via DOM + addEventListener (CSP-safe).
function pickSession(matches: TimeEntry[]): Promise<TimeEntry> {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-panel,var(--bg-card,#111));border:1px solid var(--border);border-radius:var(--radius-lg,10px);box-shadow:var(--shadow-3);padding:18px 20px;min-width:340px;max-width:460px;';
    const h = document.createElement('div');
    h.textContent = `${matches.length} sessions on this date`;
    h.style.cssText = 'font-family:var(--sans);font-size:14px;font-weight:600;color:var(--text-bright);margin-bottom:4px;';
    const sub = document.createElement('div');
    sub.textContent = 'Choose which session to open in the tracker.';
    sub.style.cssText = 'font-family:var(--sans);font-size:11px;color:var(--text-muted);margin-bottom:12px;';
    card.append(h, sub);
    const done = (entry: TimeEntry) => { backdrop.remove(); resolve(entry); };
    matches.forEach((e, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'display:flex;justify-content:space-between;gap:14px;width:100%;text-align:left;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:6px;padding:9px 12px;margin-bottom:8px;cursor:pointer;color:var(--text);font-family:var(--sans);font-size:12px;flex-shrink:0;';
      const lbl = document.createElement('span');
      lbl.textContent = e.session_label || `(no label — session ${i + 1})`;
      const dur = document.createElement('span');
      dur.textContent = `${((e.total_mins || 0) / 60).toFixed(1)}h`;
      dur.style.cssText = 'font-family:var(--mono);color:var(--text-muted);flex-shrink:0;';
      btn.append(lbl, dur);
      btn.addEventListener('click', () => done(e));
      card.appendChild(btn);
    });
    backdrop.appendChild(card);
    backdrop.addEventListener('click', ev => { if (ev.target === backdrop) done(matches[0]); });
    document.body.appendChild(backdrop);
  });
}

// "Switch session" button (visible only when the date has >1 session).
async function switchSession(): Promise<void> {
  if (sameDateEntries.length < 2) return;
  await saveSession(true);
  const chosen = await pickSession(sameDateEntries);
  await loadEntryIntoTracker(chosen);
}

// Load the current entry's task_items (Dispatch tasks + break/lunch punches),
// derive active break/lunch state, and refresh both the Dispatch chip and the
// break/lunch strip. Single fetch shared by both UIs.
async function loadTaskItems(entryId: number | null): Promise<void> {
  taskItems = entryId ? (await api.invoke('tasks:list', entryId) || []) : [];
  activeBreakId = taskItems.find(t => t.item_type === 'break' && !t.stopped_at)?.id || null;
  activeLunchId = taskItems.find(t => t.item_type === 'lunch' && !t.stopped_at)?.id || null;
  updateDispatchChip();
  updateBreakButtons();
  renderCompliance();
}

// Footer Dispatch preview — task count + per-label chips (break/lunch now live
// in the control-panel strip, not here).
function updateDispatchChip(): void {
  const preview = document.getElementById('dispatch-preview');
  if (!preview) return;
  if (!currentEntryId) { preview.style.display = 'none'; return; }

  const completed = taskItems.filter(t => t.item_type === 'task' && t.stopped_at);
  preview.style.display = 'block';

  const countLabel = $id('dispatch-count-label');
  countLabel.textContent = completed.length > 0
    ? `${completed.length} task${completed.length === 1 ? '' : 's'}`
    : 'Dispatch';

  const chipsEl = $id('dispatch-task-chips');
  if (completed.length > 0) {
    const counts: Record<string, number> = {};
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
function sessionStartMs(): number | null {
  // LAST open row: a stale open punch earlier in the table (never clocked out)
  // must not hijack the timers from the punch the user actually just made.
  const open = rowsData.filter(r => r.clock_in && !r.clock_out);
  const active = open.length ? open[open.length - 1] : null;
  if (!active) return null;
  const precise = preciseStartMs(active);
  if (precise != null) return precise;
  const [h, m] = active.clock_in.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d.getTime();
}

// If a row carries a precise clock_in_ms AND it still matches the row's
// (possibly hand-edited) HH:MM minute, trust it — otherwise return null so the
// caller falls back to the minute-truncated computation. This is what makes a
// fresh clock-in read 0:00 rather than the current seconds-into-the-minute.
function preciseStartMs(row: RowData): number | null {
  if (!row.clock_in_ms) return null;
  const d = new Date(row.clock_in_ms);
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return hh === row.clock_in ? row.clock_in_ms : null;
}

function elapsedSince(ms: number): string {
  // Clamp: a future-dated punch (bad data from the old UTC date bug, or a
  // hand-edited time) must read 0m, not "-46m".
  const diff = Math.max(0, Date.now() - ms);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function togglePunch(type: 'break' | 'lunch'): Promise<void> {
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
    await api.invoke('tasks:save', { entry_id: currentEntryId!, label, item_type: type, started_at: Date.now(), duration_secs: 0 });
    Shell.toast(`${label} started.`, 'success');
  }
  await loadTaskItems(currentEntryId);
}

function updateBreakButtons(): void {
  const b = document.getElementById('btn-break');
  const l = document.getElementById('btn-lunch');
  if (b) { b.textContent = activeBreakId ? '✓ End Break' : '☕ Break'; b.classList.toggle('bl-active', !!activeBreakId); }
  if (l) { l.textContent = activeLunchId ? '✓ End Lunch' : '🍽 Lunch';  l.classList.toggle('bl-active', !!activeLunchId); }
}

// Returns 'ok' | 'warn' | 'over' for break/lunch relative to the US-state policy.
function checkComplianceStatus(type: 'break' | 'lunch'): 'ok' | 'warn' | 'over' {
  const p = auditPolicy;
  let thresholdMs: number, warnMs: number;
  if (type === 'break') {
    if (p?.breakStyle === 'pomodoro') {
      // Pomodoro break style: the LIVE cadence warnings follow the preset —
      // warn once a focus block has elapsed since the last break, overdue once
      // the break you should be on has fully passed too. Lunch (below) and the
      // audit engine stay on the state policy regardless (confirmed decision).
      warnMs      = p.pomodoro.focusMins * 60000;
      thresholdMs = (p.pomodoro.focusMins + p.pomodoro.breakMins) * 60000;
    } else {
      const rawDue  = p?.breakThresholds?.[0]?.[0];
      thresholdMs   = (rawDue != null) ? rawDue * 60000 : Infinity;
      const rawWarn = p?.dispatchBreakWarnMins;
      warnMs        = (rawWarn != null) ? rawWarn * 60000 : Infinity;
    }
  } else {
    thresholdMs   = p ? p.lunchThreshMins * 60000 : 5 * 3600000;
    const rawWarn = p?.dispatchLunchWarnMins;
    warnMs        = (rawWarn != null) ? rawWarn * 60000 : 4.5 * 3600000;
  }
  if ((type === 'break' ? activeBreakId : activeLunchId)) return 'ok'; // currently on it
  const relevant = taskItems.filter(t => t.item_type === type && t.stopped_at);
  const start = sessionStartMs();
  const lastStop = relevant.length ? Math.max(...relevant.map(t => t.stopped_at as number)) : (start || Date.now());
  const elapsed = Date.now() - lastStop;
  if (elapsed >= thresholdMs) return 'over';
  if (elapsed >= warnMs) return 'warn';
  return 'ok';
}

const DOT_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>';

function renderCompliance(): void {
  renderComplianceFor('break');
  renderComplianceFor('lunch');
}

function renderComplianceFor(type: 'break' | 'lunch'): void {
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
  const elStr = elapsedSince(Math.max(...relevant.map(t => t.stopped_at as number)));
  el.innerHTML = status === 'over'
    ? `${DOT_SVG} ⚠ ${type === 'break' ? 'Break' : 'Lunch'} overdue — last ${type} ${elStr} ago`
    : `${DOT_SVG} Last ${type}: ${elStr} ago ✓`;
}

// ── Row data helpers ──
function emptyRow(): RowData { return { label:'', name:'', desc:'', clock_in:'', clock_out:'', total_mins:0 }; }
// _manual rows are backfill entries: editable + retained even before any field is
// filled, so the user can type in a session they forgot to clock live.
function isRowFilled(r: RowData): boolean { return !!(r._manual || r.label || r.name || r.desc || r.clock_in || r.total_mins > 0); }

// Ensure: minimum MIN_ROWS rows, exactly one trailing empty "buffer" row, no runs of unused empty rows
function normalizeRows(): void {
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
function buildRows(): void {
  rowsData = [];
  normalizeRows();
  renderTable();
  updateTotals();
}

function renderTable(): void {
  const tbody = $id('tbody');
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
let colPcts: number[] = [];

function pxToPct(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  return arr.map(w => (w / sum) * 100);
}

function applyColWidths(): void {
  const cols = document.querySelectorAll<HTMLElement>('#tracker-table colgroup col');
  cols.forEach((c, i) => { if (colPcts[i] != null) c.style.width = colPcts[i] + '%'; });
}

async function initColResize(): Promise<void> {
  let pcts: number[] | null = null;
  try {
    const saved = await api.invoke('settings:get', COLW_KEY);
    if (saved) pcts = JSON.parse(saved);
  } catch {}
  if (!Array.isArray(pcts) || pcts.length !== DEFAULT_COLPX.length) pcts = pxToPct(DEFAULT_COLPX);
  colPcts = pcts;
  applyColWidths();
  installColResizers();
}

function installColResizers(): void {
  const ths = document.querySelectorAll<HTMLElement>('#tracker-table thead th');
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

function startColDrag(e: MouseEvent, i: number, handle: HTMLElement): void {
  e.preventDefault(); e.stopPropagation();
  const table  = $id('tracker-table');
  const tableW = table.getBoundingClientRect().width;
  const startX = e.clientX;
  const a0 = colPcts[i], b0 = colPcts[i + 1];
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const move = (ev: MouseEvent) => {
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

function resetColWidths(): void {
  colPcts = pxToPct(DEFAULT_COLPX);
  applyColWidths();
  saveColWidths();
  Shell.toast('Column widths reset.', 'info', 2000);
}

function saveColWidths(): void {
  try { api.invoke('settings:set', { key: COLW_KEY, value: JSON.stringify(colPcts) }); } catch {}
}

function rowHTML(r: RowData, idx: number): string {
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

function restoreRows(rows: EntryRow[]): void {
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

function selectRow(idx: number): void {
  selectedIndex = idx;
  document.querySelectorAll<HTMLElement>('#tbody tr').forEach(tr => {
    tr.classList.toggle('row-active', parseInt(tr.dataset.idx || '') === idx);
  });
}

function nowTime(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

function formatMins(total: number): string {
  if (total <= 0) return '—';
  const h = Math.floor(total/60), m = total%60;
  return h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m`;
}

// ── Clock in/out ──
function clockIn(): void {
  if (!currentCompany) { Shell.toast('Select a company first.', 'warning'); return; }
  const label = $input('input-label').value;
  const name  = $input('input-name').value.trim();
  const desc  = $input('input-desc').value.trim();
  // Both a Task Label and a Task Name are required to clock in. Clock Out is
  // implicitly covered (it acts on a row that was clocked in with both). Only
  // "+ Manual Entry" bypasses this, for backfilling a forgotten session.
  if (!label || !name) {
    Shell.toast('A Task Label and Task Name are required to clock in.', 'warning');
    if (!label) $input('input-label').focus();
    else $input('input-name').focus();
    return;
  }
  const t = nowTime();

  let idx = -1;
  if (selectedIndex != null && rowsData[selectedIndex] && !isRowFilled(rowsData[selectedIndex])) idx = selectedIndex;
  if (idx === -1) idx = rowsData.findIndex(r => !isRowFilled(r));
  if (idx === -1) { rowsData.push(emptyRow()); idx = rowsData.length - 1; }

  const row = rowsData[idx];
  row.label = label; row.name = name; row.desc = desc; row.clock_in = t;
  row.clock_in_ms = Date.now();   // precise start so the live timer begins at 0:00
  selectedIndex = idx;

  normalizeRows();
  renderTable();
  updateTotals();
  updateStatusDot();
  autoSave();
}

// atTime (24h HH:MM) overrides "now" — used by punch-watch's idle nudge to trim
// a forgotten punch to when the user actually went idle. Omitted → clock out now.
function clockOut(atTime?: string): void {
  let idx = -1;
  if (selectedIndex != null && rowsData[selectedIndex] && rowsData[selectedIndex].clock_in && !rowsData[selectedIndex].clock_out) idx = selectedIndex;
  if (idx === -1) idx = rowsData.findIndex(r => r.clock_in && !r.clock_out);
  if (idx === -1) { Shell.toast('No active clock-in found.', 'warning'); return; }

  const row = rowsData[idx];
  const t = atTime || nowTime();
  const diff = computeDiffMins(row.clock_in, t);
  row.clock_out = t;
  row.total_mins = (row.total_mins||0) + diff;
  selectedIndex = idx;

  normalizeRows();
  renderTable();
  updateTotals();
  updateStatusDot();
  autoSave();

  // C6 (D-012): a task/break/lunch can't keep running once the session has no
  // open punch — it would become invisible in Dispatch (entries:get-active →
  // null) and unstoppable. If this clock-out closed the last open row, stop
  // every running task item at the punch.
  if (!rowsData.some(r => r.clock_in && !r.clock_out)) stopRunningTaskItems();
}

// C6 (D-012): stop all in-progress task_items (Dispatch task, break, lunch)
// for the current entry — called when the last open punch clocks out. The
// login-time sweep in src/main/session.ts (sweepOrphanTaskItems) is the
// backstop for crashes/quits that skip this path.
async function stopRunningTaskItems(): Promise<void> {
  if (!currentEntryId) return;
  const open = taskItems.filter(t => t.started_at && !t.stopped_at);
  if (!open.length) return;
  for (const t of open) {
    const durationSecs = Math.max(0, Math.floor((Date.now() - t.started_at) / 1000));
    await api.invoke('tasks:save', { id: t.id, label: t.label, item_type: t.item_type, stopped_at: Date.now(), duration_secs: durationSecs });
  }
  await loadTaskItems(currentEntryId);
  if (typeof Shell !== 'undefined' && Shell.hideSidebarTimer) Shell.hideSidebarTimer();
  Shell.toast(`Clock-out stopped ${open.length} running ${open.length === 1 ? 'item' : 'items'} (task/break).`, 'info');
}

// Backfill a session that wasn't clocked live: add an editable row and open the
// label cell for immediate entry. The row persists (isRowFilled treats _manual
// as filled) so the dynamic table won't trim it before the user types.
function addManualRow(): void {
  if (!currentCompany) { Shell.toast('Select a company first.', 'warning'); return; }
  const row = emptyRow();
  row._manual = true;
  rowsData.push(row);
  normalizeRows();
  selectedIndex = rowsData.indexOf(row);
  renderTable();
  updateTotals();
  const cell = document.querySelector<HTMLElement>(`#tbody tr[data-idx="${selectedIndex}"] td[data-field="label"]`);
  if (cell) startEdit(cell, selectedIndex, 'label');
}

// ── Inline editing ──
function startEdit(cell: HTMLElement, idx: number, field: StrField): void {
  const row = rowsData[idx];
  if (!row) return;
  const isTime  = field === 'clock_in' || field === 'clock_out';
  // Time cells display in the 12h/24h preference, but editing is always raw 24h
  // HH:MM (gotcha #8) — seed from the stored value, not the formatted cell text.
  const current = isTime ? (row[field] || '')
                : cell.textContent === '—' ? '' : (cell.textContent || '');
  const isLabel = field === 'label';
  const isDesc  = field === 'desc';
  // Description seeds from the raw stored value (may contain newlines), not the
  // clamped/escaped cell text.
  const seed = isDesc ? (row.desc || '') : current;
  const original = cell.innerHTML;

  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (isLabel) {
    const select = document.createElement('select');
    select.style.cssText = 'font-family:var(--sans);font-size:12px;background:var(--surface-2);color:var(--text-bright);border:1px solid var(--accent);border-radius:4px;width:100%;';
    const FIXED = ['Training','Evaluation','Review','Annotation','QA','Research','Admin','Communication','Other'];
    // D-010: a stored label that isn't in the fixed list (imported/legacy/custom
    // data) must be PRESERVED — inject it as the selected first option, otherwise
    // opening the editor silently re-labels the row to the first fixed entry.
    const opts = (current && !FIXED.includes(current)) ? [current, ...FIXED] : FIXED;
    opts.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (opt === current) o.selected = true;
      select.appendChild(o);
    });
    input = select;
  } else if (isDesc) {
    // Multi-line, auto-growing editor (Companies-notes style). Enter inserts a
    // newline; Ctrl/Cmd+Enter or blur commits; Escape cancels.
    const ta = document.createElement('textarea');
    ta.value = seed;
    ta.rows = Math.min(8, Math.max(2, seed.split('\n').length));
    ta.placeholder = 'Description… (Enter for new line, Ctrl+Enter to save)';
    ta.style.cssText = 'font-family:var(--sans);font-size:12px;line-height:1.5;background:var(--surface-2);color:var(--text-bright);border:1px solid var(--accent);border-radius:4px;width:100%;padding:4px 6px;resize:vertical;min-height:48px;user-select:text;-webkit-user-select:text;';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', grow);
    setTimeout(grow, 0);
    input = ta;
  } else {
    const text = document.createElement('input');
    text.type = 'text'; text.value = current;
    if (isTime) {
      // D-002: with the 12h display pref the cells read "2:30 PM" but the editor
      // only took raw 24h — typing "2:30" meaning PM silently stored 02:30 AM.
      // The editor now accepts BOTH forms (parseClockInput normalizes to 24h for
      // storage) and the placeholder advertises the accepted formats.
      const is12h = typeof Settings !== 'undefined' && Settings.get('timeFormat') === '12h';
      text.placeholder = is12h ? 'h:mm AM/PM or HH:MM' : 'HH:MM';
      text.maxLength = 8;
      text.addEventListener('input', () => { text.value = text.value.replace(/[^0-9:AaPpMm.\s]/g,''); });
    }
    text.style.cssText = 'font-family:var(--sans);font-size:12px;background:var(--surface-2);color:var(--text-bright);border:1px solid var(--accent);border-radius:4px;width:100%;padding:2px 6px;user-select:text;-webkit-user-select:text;';
    input = text;
  }

  cell.innerHTML = ''; cell.appendChild(input);
  input.focus();
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.select();

  const commit = () => {
    const val = input.value.trim();
    // D-010 guard: an untouched editor (open → blur, no change) must be a no-op,
    // never a write. Compare against the value the editor was seeded with.
    if (val === (isDesc ? seed : current)) { cell.innerHTML = original; return; }
    if (isTime) {
      if (!val) { cell.innerHTML = original; return; }
      const parsed = parseClockInput(val);
      if (!parsed.ok) {
        Shell.toast('Use HH:MM (24h) or h:mm AM/PM', 'error');
        cell.innerHTML = original; return;
      }
      row[field] = parsed.hhmm!;
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
    updateStatusDot();
    autoSave();
  };

  input.addEventListener('blur', commit);
  // Cast to HTMLElement: addEventListener on the input|select|textarea union
  // falls back to the generic (Event) overload, losing the KeyboardEvent map.
  (input as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
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
function updateTotals(): void {
  let total = 0;
  const byLabel: Record<string, number> = {};
  rowsData.forEach(r => {
    if (r.total_mins > 0) {
      total += r.total_mins;
      const l = r.label || 'Other';
      byLabel[l] = (byLabel[l]||0) + r.total_mins;
    }
  });
  $id('total-time').textContent = total>0 ? formatMins(total) : '0h 00m';
  $id('rows-done').textContent  = String(rowsData.filter(isRowFilled).length);
  $id('rows-total').textContent = String(rowsData.length);

  const breakdownEl = $id('breakdown-row');
  const entries = Object.entries(byLabel);
  breakdownEl.innerHTML = entries.length
    ? entries.map(([l,m]) => `<span class="breakdown-chip">${l} <span class="bc-time">${formatMins(m)}</span></span>`).join('')
    : '';
}

// ── Auto-save timer ──
function startAutoSaveTimer(): void {
  clearAutoSaveTimer();
  const secs = parseInt(Settings.get('autoSaveInterval') ?? 60, 10);
  if (!secs || !currentCompany) { updateStatusDot(); return; }
  autoSaveTimer = setInterval(async () => {
    await autoSave(true);
  }, secs * 1000);
  updateStatusDot();
}

function clearAutoSaveTimer(): void {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
  updateStatusDot();
}

// The LIVE badge reflects a genuinely running session — a row that has been
// clocked in but not yet clocked out — NOT merely "a company is selected" or
// "the autosave timer is ticking". The sidebar nav badge (Shell) mirrors the
// same open-punch state and shows the elapsed time.
function updateStatusDot(): void {
  const badge = document.getElementById('live-badge');
  // Last open row — same rationale as sessionStartMs().
  const opens = rowsData.filter(r => r.clock_in && !r.clock_out);
  const open = opens.length ? opens[opens.length - 1] : undefined;
  if (badge) badge.style.display = open ? 'flex' : 'none';
  // Drive the sidebar nav LIVE badge from the same source of truth.
  try {
    const logDate = $input('log-date')?.value;
    if (open && logDate) {
      Shell.showLiveBadge(preciseStartMs(open) ?? punchStartMs(logDate, open.clock_in));
    } else {
      Shell.hideLiveBadge();
    }
  } catch { /* Shell may not expose the badge helpers on older pages */ }
}

// Convert an entry's log_date (YYYY-MM-DD) + a row's clock_in (HH:MM, 24h,
// local) into an epoch-ms start for the elapsed-time readout.
function punchStartMs(logDate: string, clockIn: string): number {
  const t = new Date(`${logDate}T${clockIn}:00`).getTime();
  return isNaN(t) ? Date.now() : t;
}

// ── Save / clear ──
async function autoSave(fromTimer = false): Promise<void> { if (currentCompany) await saveSession(true, fromTimer); }

async function saveSession(silent = false, fromTimer = false): Promise<void> {
  if (!currentCompany) { if(!silent) Shell.toast('Select a company first.','warning'); return; }
  let total = 0;
  rowsData.forEach(r => total += (r.total_mins||0));
  const entry = {
    id: currentEntryId,
    company_id: currentCompany.id,
    log_date: $input('log-date').value,
    session_label: $input('log-notes').value.trim(),
    rows_json: JSON.stringify(rowsData),
    total_mins: total,
    // Optimistic-concurrency token from the last read/save of this row.
    updated_at: currentEntryUpdatedAt ?? undefined
  };
  const valid = Validator.validateEntry(entry as Partial<TimeEntry>);
  if (!valid.ok) { if (!silent) Shell.toast(valid.error || 'Invalid entry.', 'error'); return; }
  const res = await IPC.entries.save(entry as Partial<TimeEntry>);
  if (res.stale) {
    // A concurrent writer saved a newer version of this session. Don't clobber
    // it — surface a toast and reload the latest into the tracker (safe default;
    // no silent auto-merge for time data). The user re-applies their edit on the
    // fresh copy.
    Shell.toast('This session was updated elsewhere — reloading the latest.', 'warning');
    Store.invalidate('entries');
    await loadTodayEntry();
    return;
  }
  if (res.ok) {
    if (!currentEntryId && res.id) currentEntryId = res.id;
    // Advance our concurrency token to the server's fresh timestamp so the next
    // autosave doesn't falsely conflict with our own prior save.
    if (res.updated_at != null) currentEntryUpdatedAt = res.updated_at;
    Store.invalidate('entries');
    loadTaskItems(currentEntryId);
    if (!silent) Shell.toast('Session saved.', 'success');
    const label = fromTimer ? `Auto-saved at ${nowTime()}` : `Saved at ${nowTime()}`;
    $id('session-status').textContent = label;
    // Restore live dot label after a delay if timer is active
    setTimeout(updateStatusDot, 4000);
  } else if (!silent) Shell.toast(res.error || 'Save failed.', 'error');
}

function clearSelectedRow(): void {
  if (selectedIndex == null || !rowsData[selectedIndex]) return;
  rowsData[selectedIndex] = emptyRow();
  normalizeRows();
  renderTable();
  updateTotals();
  autoSave();
}

// Right-click quick actions for a filled tracker row.
function rowContextMenu(ev: MouseEvent, idx: number): void {
  const firstEditable = document.querySelector<HTMLElement>(`#tbody tr[data-idx="${idx}"] td.editable[data-field]`);
  Shell.contextMenu(ev, [
    { label: '✎ Edit', disabled: !firstEditable, action: () => {
      if (firstEditable) startEdit(firstEditable, idx, firstEditable.dataset.field as StrField);
    } },
    { label: '⧉ Duplicate', action: () => duplicateRow(idx) },
    { separator: true },
    { label: '🗑 Clear row', danger: true, action: () => { selectRow(idx); clearSelectedRow(); } },
  ]);
}

function duplicateRow(idx: number): void {
  const r = rowsData[idx];
  if (!r) return;
  rowsData.splice(idx + 1, 0, { ...r });
  normalizeRows();
  renderTable();
  updateTotals();
  autoSave();
}

// Kept synchronous: the silent path (session load) must clear the table before
// the caller's next statement. The interactive confirm lives in clearAllPrompt.
function clearAll(): void {
  rowsData = [];
  normalizeRows();
  selectedIndex = null;
  renderTable();
  updateTotals();
}

// Toolbar "Clear All" — confirm first, then wipe the in-memory rows.
async function clearAllPrompt(): Promise<void> {
  const ok = await Shell.confirm({
    title: 'Clear all entries?',
    message: 'This empties the tracker table for this session. Nothing is saved until you save or clock in again.',
    confirmLabel: 'Clear All',
  });
  if (ok) clearAll();
}

// ── PDF Export ──
// Renders through the shared branded builder (src/renderer/export-html.js) so
// this export matches the emailed report's identity. NavID stays excluded;
// times stay raw 24h; descriptions flattened.
function exportPDF(): void {
  if (!currentCompany) { Shell.toast('Select a company first.','warning'); return; }
  const co = currentCompany;
  const date = $input('log-date').value;
  const note = $input('log-notes').value;

  const filledRows = rowsData.filter(r => isRowFilled(r));
  const total = filledRows.reduce((s, r) => s + (r.total_mins || 0), 0);

  const html = ExportHtml.buildSessionExportHTML({
    companyName: co.name,
    hier: [co.hier_company, co.hier_project, co.hier_platform, co.name].filter(Boolean).join(' › '),
    metaLines: [
      co.job_title || '',
      co.work_type ? `Work type: ${co.work_type}` : '',
      co.location ? `Location: ${co.location}` : '',
      co.supervisors ? `Submitted to: ${co.supervisors}` : '',
    ],
    dateLabel: date,
    sessionLabel: note,
    rows: filledRows.map(r => ({
      label: r.label, name: r.name, desc: flattenText(r.desc),
      clock_in: r.clock_in, clock_out: r.clock_out, total_mins: r.total_mins || 0,
    })),
    totalMins: total,
    fontCss: window.PDF_FONT_CSS || '',
  });
  const win = window.open('','_blank')!;
  win.document.write(html);
  win.document.close(); win.print();
}

// ── Shell hooks ──
// shell.js probes these as globals (typeof onExportPDF === 'function'); since
// this module is IIFE-scoped, publish them onto window explicitly.
(window as any).onExportPDF = () => exportPDF();
(window as any).onAutoSaveSettingChanged = (_seconds: number) => startAutoSaveTimer();

// punch-watch.js hook: close the active punch from its idle nudge at an explicit
// time (ms). Routing through clockOut() keeps rowsData authoritative and reuses
// this page's autoSave — so the tracker's autosave timer can't race a separate
// entries:save and silently reopen the punch. Returns true if a punch was open.
(window as any).__trackerClockOutActive = (atMs: number): boolean => {
  if (!rowsData.some(r => r.clock_in && !r.clock_out)) return false;
  const d = new Date(atMs);
  clockOut(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
  return true;
};

})();
