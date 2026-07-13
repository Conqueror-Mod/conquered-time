'use strict';

// Global Log page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, escapeHtml, api) — must load after shell.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

let allEntries: TimeEntry[] = [], filtered: TimeEntry[] = [];
let companies: Company[] = [];
let compMap: Record<number, Company> = {};
/** companyId → identity color (BubbleWeb.colorMap), set on data load. */
let colorFor: (companyId: number) => string = () => 'var(--border-light)';

// Static markup lookups — a missing id is a programming error.
const $id = (id: string): HTMLElement => document.getElementById(id)!;
// Filter controls are a mix of <input> and <select>; both carry .value.
const $field = (id: string): HTMLInputElement | HTMLSelectElement =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

// Display-only 12h/24h formatting for on-screen times. Stored value is always
// 24h HH:MM (gotcha #8); PDF/CSV exports stay raw 24h by design.
function fmtClock(hhmm: string | undefined): string {
  // Settings is a top-level const (not a window property) — guard via typeof.
  return (hhmm && typeof Settings !== 'undefined') ? Settings.formatTime(hhmm) : (hhmm || '');
}

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('global-log');
  document.documentElement.style.visibility = '';
  await loadData();
  consumeInsightsHandoff();   // Insights "view in Global Log" → pre-set filters
  applyFilters();

  // ── Static control wiring (CSP-safe; replaces inline on* handlers) ──────
  $id('btn-export-csv').addEventListener('click', exportCSV);
  $id('btn-export-pdf').addEventListener('click', exportAllPDF);
  $id('btn-clear-filters').addEventListener('click', clearFilters);
  $id('filter-company').addEventListener('change', applyFilters);
  $id('filter-from').addEventListener('change', applyFilters);
  $id('filter-to').addEventListener('change', applyFilters);
  $id('filter-range').addEventListener('change', applyQuickRange);

  // Table — delegated so dynamically-rendered rows need no re-wiring.
  $id('log-tbody').addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('.btn-xs');
    if (btn) {
      e.stopPropagation();
      if (btn.dataset.act === 'open') openInTracker(Number(btn.dataset.co), btn.dataset.date || '', Number(btn.dataset.entry)||0);
      else if (btn.dataset.act === 'pdf') exportSessionPDF(Number(btn.dataset.idx));
      return;
    }
    const tr = target.closest<HTMLElement>('tr[data-idx]');
    if (tr) toggleDetail(Number(tr.dataset.idx));
  });

  // Right-click a session row → quick actions (shared Shell.contextMenu).
  $id('log-tbody').addEventListener('contextmenu', e => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-idx]');
    if (!tr) return;
    rowContextMenu(e as MouseEvent, Number(tr.dataset.idx));
  });

  // Live 12h/24h switch — re-render expandable detail times in place (no reload).
  document.addEventListener('ct:settings-changed', e => {
    if ((e as CustomEvent).detail?.key === 'timeFormat') {
      const open = [...document.querySelectorAll('tr.detail-row.open')].map(r => r.id);
      renderTable();
      open.forEach(id => { const m = id.match(/detail-(\d+)/); if (m) toggleDetail(Number(m[1])); });
    }
  });
});

async function loadData(): Promise<void> {
  companies  = await Store.getCompanies();
  allEntries = await Store.getEntries();
  compMap    = {};
  companies.forEach(c => compMap[c.id] = c);
  colorFor   = BubbleWeb.colorMap(companies, allEntries).colorFor;
  const sel = $id('filter-company');
  companies.forEach(co => {
    const opt = document.createElement('option');
    opt.value = String(co.id); opt.textContent = co.name;
    sel.appendChild(opt);
  });
}

function applyQuickRange(): void {
  const val = $field('filter-range').value;
  if (!val||val==='all') {
    $field('filter-from').value='';
    $field('filter-to').value='';
  } else {
    const to=new Date(), from=new Date(Date.now()-parseInt(val)*86400000);
    $field('filter-from').value=RowUtils.localDateStr(from); // local, not toISOString (UTC)
    $field('filter-to').value=RowUtils.localDateStr(to);
  }
  applyFilters();
}

function clearFilters(): void {
  $field('filter-company').value='';
  $field('filter-from').value='';
  $field('filter-to').value='';
  $field('filter-range').value='';
  applyFilters();
}

// Consume a one-shot handoff from Insights (click-through on a client chart):
// pre-set the company + date-range filters, then clear the keys so a manual
// revisit isn't re-filtered.
function consumeInsightsHandoff(): void {
  const co = sessionStorage.getItem('glog_company');
  if (!co) return;
  sessionStorage.removeItem('glog_company');
  const from = sessionStorage.getItem('glog_from') || '';
  const to = sessionStorage.getItem('glog_to') || '';
  sessionStorage.removeItem('glog_from');
  sessionStorage.removeItem('glog_to');
  const sel = $field('filter-company') as HTMLSelectElement;
  if ([...sel.options].some(o => o.value === co)) sel.value = co;
  $field('filter-from').value = from;
  $field('filter-to').value = to;
  $field('filter-range').value = 'custom';
}

function applyFilters(): void {
  const coId=parseInt($field('filter-company').value)||null;
  const from=$field('filter-from').value;
  const to=$field('filter-to').value;
  filtered=allEntries.filter(e => {
    if (coId&&e.company_id!==coId) return false;
    if (from&&e.log_date<from) return false;
    if (to&&e.log_date>to) return false;
    return true;
  }).sort((a,b)=>b.log_date.localeCompare(a.log_date));
  renderTable(); renderSummary();
}

function renderSummary(): void {
  const totalMins=filtered.reduce((s,e)=>s+e.total_mins,0);
  const coSet=new Set(filtered.map(e=>e.company_id));
  const avgMins=filtered.length?totalMins/filtered.length:0;
  $id('chip-sessions').textContent=String(filtered.length);
  $id('chip-hours').textContent=fmtH(totalMins);
  $id('chip-companies').textContent=String(coSet.size);
  $id('chip-avg').textContent=fmtH(avgMins);
}

function renderTable(): void {
  const tbody=$id('log-tbody');
  $id('row-count').textContent=`Showing ${filtered.length} session${filtered.length!==1?'s':''}`;
  if (filtered.length===0) {
    // First-run (no sessions at all) gets the branded invitation; a filtered
    // miss stays a compact one-liner (an active filter, not an empty vault).
    const cell = allEntries.length === 0
      ? Shell.emptyState({
          icon: 'sessions',
          title: 'No time logged yet',
          body: 'Clock in on the Tracker and your sessions land here — filter by company or date, expand the task detail, and export to PDF or CSV.',
          cta: { label: '⏱ Open the Tracker', action: 'navigate', arg: 'tracker' },
        })
      : `<div class="empty-state">No sessions match the current filters.</div>`;
    tbody.innerHTML=`<tr><td colspan="6">${cell}</td></tr>`;
    return;
  }
  const todayStr=RowUtils.localDateStr(); // C6 (D-009): badge future-dated sessions (LOCAL date)
  tbody.innerHTML=filtered.map((e,idx) => {
    const co=compMap[e.company_id];
    const rows=safeParseRows(e.rows_json);
    const hasDetail=rows.some(r=>RowUtils.rowHasContent(r));
    return `
      <tr data-idx="${idx}" style="cursor:pointer;">
        <td><span class="expand-arrow" id="arrow-${idx}">${hasDetail?'▶':''}</span></td>
        <td class="log-company"><span class="co-dot" style="background:${colorFor(e.company_id)}"></span>${escapeHtml(co?.name)||'—'}</td>
        <td class="log-date">${escapeHtml(e.log_date)}${e.log_date>todayStr?' <span class="future-badge" title="This session is dated in the future">FUTURE</span>':''}</td>
        <td class="log-session">${e.session_label?escapeHtml(e.session_label):'<span style="color:var(--text-dim);font-style:italic;">No label</span>'}</td>
        <td class="log-hours">${fmtHFull(e.total_mins)}</td>
        <td class="log-actions">
          <button class="btn-xs" data-act="open" data-co="${e.company_id}" data-date="${escapeHtml(e.log_date)}" data-entry="${e.id}">Open</button>
          <button class="btn-xs" data-act="pdf" data-idx="${idx}">PDF</button>
        </td>
      </tr>
      <tr class="detail-row" id="detail-${idx}">
        <td colspan="6">
          <div class="detail-inner">
            ${hasDetail ? rows.filter(r=>RowUtils.rowHasContent(r)).map(r=>`
              <div class="detail-task">
                <div class="detail-task-label">${escapeHtml(r.label)||'—'}</div>
                <div class="detail-task-name">${escapeHtml(r.name)}${r.desc?' — '+escapeHtml(flattenText(r.desc)):''}</div>
                <div class="detail-task-time">${fmtClock(r.clock_in)||''}${r.clock_in&&r.clock_out?' → ':''}${fmtClock(r.clock_out)||''}</div>
                <div class="detail-task-dur">${fmtHFull(r.total_mins)}</div>
              </div>
            `).join('') : '<span style="color:var(--text-dim);font-size:12px;">No task detail available.</span>'}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleDetail(idx: number): void {
  const row=document.getElementById(`detail-${idx}`);
  if (!row) return;
  row.classList.toggle('open');
  const arrow=document.getElementById(`arrow-${idx}`);
  if (arrow) arrow.textContent=row.classList.contains('open')?'▼':'▶';
}

// Right-click quick actions for one session row (idx into `filtered`).
function rowContextMenu(ev: MouseEvent, idx: number): void {
  const e = filtered[idx];
  if (!e) return;
  const co = compMap[e.company_id];
  Shell.contextMenu(ev, [
    { label: '⏱ Open in Tracker', action: () => openInTracker(e.company_id, e.log_date, e.id) },
    { label: '📄 Export PDF', action: () => exportSessionPDF(idx) },
    { label: '⧉ Copy summary', action: () => copySummary(e, co) },
    { separator: true },
    { label: '🗑 Delete session', danger: true, action: () => deleteSession(e) },
  ]);
}

function copySummary(e: TimeEntry, co: Company | undefined): void {
  const mins = e.total_mins || 0;
  const dur = Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  const text = [co?.name || '—', e.log_date, e.session_label || '', dur].filter(Boolean).join(' · ');
  navigator.clipboard.writeText(text).then(
    () => Shell.toast('Summary copied', 'success', 2000),
    () => Shell.toast('Copy failed', 'error', 2500),
  );
}

async function deleteSession(e: TimeEntry): Promise<void> {
  const co = compMap[e.company_id];
  if (!confirm(`Delete this session?\n\n${co?.name || '—'} · ${e.log_date}${e.session_label ? ' · ' + e.session_label : ''}\n\nA safety snapshot is saved first; this can't be undone from here.`)) return;
  const res = await api.invoke('entries:delete', e.id);
  if (!res || !res.ok) { Shell.toast('Delete failed: ' + ((res && res.error) || 'unknown'), 'error'); return; }
  await Store.invalidate('entries');
  Shell.toast('Session deleted', 'success', 2500);
  await loadData();
  applyFilters();
}

function openInTracker(companyId: number, date: string, entryId: number): void {
  const co=compMap[companyId];
  if (!co) return;
  sessionStorage.setItem('active_company',JSON.stringify(co));
  sessionStorage.setItem('tracker_date',date);
  // C6 (D-005): open THIS session, not just the first one on the date
  if (entryId) sessionStorage.setItem('tracker_entry',String(entryId));
  api.send('navigate','tracker');
}

function exportSessionPDF(idx: number): void {
  const e=filtered[idx];
  const co=compMap[e.company_id];
  printTimesheet(co,e.log_date,e.session_label,safeParseRows(e.rows_json),e.total_mins);
}

function exportAllPDF(): void {
  if (filtered.length===0) { Shell.toast('No sessions to export.','warning'); return; }
  const coId=parseInt($field('filter-company').value)||null;
  if (!coId) { Shell.toast('Select a company filter for PDF export.','warning'); return; }
  const co=compMap[coId];
  const sessions=[...filtered].reverse(); // chronological order
  const grandTotal=filtered.reduce((s,e)=>s+e.total_mins,0);

  const html = ExportHtml.buildLogExportHTML({
    companyName: co.name,
    hier: [co.hier_company, co.hier_project, co.hier_platform, co.name].filter(Boolean).join(' › '),
    metaLines: exportMeta(co),
    fromDate: sessions[0]?.log_date || '',
    toDate: sessions[sessions.length-1]?.log_date || '',
    sessions: sessions.map(e => ({
      dateLabel: e.log_date,
      sessionLabel: e.session_label || '',
      rows: toExportRows(safeParseRows(e.rows_json)),
      totalMins: e.total_mins || 0,
    })),
    grandTotalMins: grandTotal,
    fontCss: window.PDF_FONT_CSS || '',
  });
  const win=window.open('','_blank')!;
  win.document.write(html);
  win.document.close(); win.print();
}

// Shared meta lines for both export shapes (NavID deliberately excluded).
function exportMeta(co: Company | undefined): string[] {
  return [
    co?.job_title || '',
    co?.work_type ? `Work type: ${co.work_type}` : '',
    co?.location ? `Location: ${co.location}` : '',
    co?.supervisors ? `Submitted to: ${co.supervisors}` : '',
  ];
}

function toExportRows(rows: EntryRow[]): ExportRow[] {
  return rows.filter(r => RowUtils.rowHasContent(r)).map(r => ({
    label: r.label, name: r.name, desc: flattenText(r.desc || r.description),
    clock_in: r.clock_in, clock_out: r.clock_out, total_mins: r.total_mins || 0,
  }));
}

// Renders through the shared branded builder (src/renderer/export-html.js) so
// this export matches the emailed report's identity.
function printTimesheet(co: Company | undefined, dateStr: string, sessionLabel: string,
                        rows: EntryRow[], totalMins: number): void {
  const html = ExportHtml.buildSessionExportHTML({
    companyName: co?.name || 'Timesheet',
    hier: co ? [co.hier_company, co.hier_project, co.hier_platform, co.name].filter(Boolean).join(' › ') : '',
    metaLines: exportMeta(co),
    dateLabel: dateStr,
    sessionLabel,
    rows: toExportRows(rows),
    totalMins,
    fontCss: window.PDF_FONT_CSS || '',
  });
  const win=window.open('','_blank')!;
  win.document.write(html);
  win.document.close(); win.print();
}

// Safely encode a value as a CSV field: double embedded quotes, always quote,
// and neutralize formula injection — a leading =, +, -, @, tab or CR makes
// Excel/Sheets evaluate the cell as a formula, so prefix those with a single
// quote. (e.g. a company named "=cmd|'/c calc'!A1" must not execute on open.)
function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function exportCSV(): void {
  if (filtered.length===0) { Shell.toast('No data to export.','warning'); return; }
  const lines=['Company,Date,Session,Task Label,Task Name,Description,Clock In,Clock Out,Duration (mins)'];
  const byCompany: Record<string, { mins: number; sessions: number }> = {};
  const byLabel: Record<string, number> = {};
  let totalMins = 0;
  filtered.forEach(e => {
    const co=compMap[e.company_id];
    const coName = co?.name || '(unknown)';
    const agg = byCompany[coName] || (byCompany[coName] = { mins: 0, sessions: 0 });
    agg.mins += e.total_mins || 0; agg.sessions += 1;
    totalMins += e.total_mins || 0;
    safeParseRows(e.rows_json).filter(r=>RowUtils.rowHasContent(r)).forEach(r => {
      if (r.label && (r.total_mins||0) > 0) byLabel[r.label] = (byLabel[r.label]||0) + (r.total_mins||0);
      lines.push([csvCell(co?.name),csvCell(e.log_date),csvCell(e.session_label),
        csvCell(r.label),csvCell(r.name),csvCell(flattenText(r.desc||r.description)),
        csvCell(r.clock_in),csvCell(r.clock_out),r.total_mins||0].join(','));
    });
  });

  // Summary block — mirrors the emailed CSV (src/main/report-html.ts
  // buildReportCSV) so both attachments carry detail AND totals.
  const dates = filtered.map(e => e.log_date).sort();
  const from = $field('filter-from').value || dates[0] || '';
  const to   = $field('filter-to').value   || dates[dates.length-1] || '';
  lines.push('');
  lines.push(csvCell('SUMMARY'));
  lines.push([csvCell('Period'), csvCell(`${from} to ${to}`)].join(','));
  lines.push([csvCell('Total Minutes'), csvCell(String(totalMins))].join(','));
  lines.push([csvCell('Total Time'), csvCell(fmtHFull(totalMins))].join(','));
  lines.push([csvCell('Sessions'), csvCell(String(filtered.length))].join(','));
  lines.push('');
  lines.push([csvCell('BY COMPANY'), csvCell('Sessions'), csvCell('Minutes')].join(','));
  Object.entries(byCompany).sort((a,b)=>b[1].mins-a[1].mins).forEach(([name,c]) =>
    lines.push([csvCell(name), csvCell(String(c.sessions)), csvCell(String(c.mins))].join(',')));
  lines.push('');
  lines.push([csvCell('BY TASK LABEL'), csvCell('Minutes')].join(','));
  Object.entries(byLabel).sort((a,b)=>b[1]-a[1]).forEach(([l,m]) =>
    lines.push([csvCell(l), csvCell(String(m))].join(',')));

  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`conquered-time-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  Shell.toast('CSV exported.','success');
}

function safeParseRows(json: string | null | undefined): EntryRow[] { try{return JSON.parse(json || '[]')||[];}catch{return[];} }
function fmtH(mins: number): string { return mins?(mins/60).toFixed(1)+'h':'0h'; }
function fmtHFull(mins: number | undefined): string {
  if (!mins||mins<=0) return '—';
  const h=Math.floor(mins/60), m=mins%60;
  return h>0?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;
}

})();
