'use strict';

// Global Log page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, escapeHtml, api) — must load after shell.js.

let allEntries=[], companies=[], filtered=[], compMap={};

// Display-only 12h/24h formatting for on-screen times. Stored value is always
// 24h HH:MM (gotcha #8); PDF/CSV exports stay raw 24h by design.
function fmtClock(hhmm) {
  // Settings is a top-level const (not a window property) — guard via typeof.
  return (hhmm && typeof Settings !== 'undefined') ? Settings.formatTime(hhmm) : hhmm;
}

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('global-log');
  document.documentElement.style.visibility = '';
  await loadData();
  applyFilters();

  // ── Static control wiring (CSP-safe; replaces inline on* handlers) ──────
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-pdf').addEventListener('click', exportAllPDF);
  document.getElementById('btn-clear-filters').addEventListener('click', clearFilters);
  document.getElementById('filter-company').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);
  document.getElementById('filter-range').addEventListener('change', applyQuickRange);

  // Table — delegated so dynamically-rendered rows need no re-wiring.
  document.getElementById('log-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.btn-xs');
    if (btn) {
      e.stopPropagation();
      if (btn.dataset.act === 'open') openInTracker(Number(btn.dataset.co), btn.dataset.date, Number(btn.dataset.entry)||0);
      else if (btn.dataset.act === 'pdf') exportSessionPDF(Number(btn.dataset.idx));
      return;
    }
    const tr = e.target.closest('tr[data-idx]');
    if (tr) toggleDetail(Number(tr.dataset.idx));
  });

  // Live 12h/24h switch — re-render expandable detail times in place (no reload).
  document.addEventListener('ct:settings-changed', e => {
    if (e.detail?.key === 'timeFormat') {
      const open = [...document.querySelectorAll('tr.detail-row.open')].map(r => r.id);
      renderTable();
      open.forEach(id => { const m = id.match(/detail-(\d+)/); if (m) toggleDetail(Number(m[1])); });
    }
  });
});

async function loadData() {
  companies  = await Store.getCompanies();
  allEntries = await Store.getEntries();
  compMap    = {};
  companies.forEach(c => compMap[c.id] = c);
  const sel = document.getElementById('filter-company');
  companies.forEach(co => {
    const opt=document.createElement('option');
    opt.value=co.id; opt.textContent=co.name;
    sel.appendChild(opt);
  });
}

function applyQuickRange() {
  const val=document.getElementById('filter-range').value;
  if (!val||val==='all') {
    document.getElementById('filter-from').value='';
    document.getElementById('filter-to').value='';
  } else {
    const to=new Date(), from=new Date(Date.now()-parseInt(val)*86400000);
    document.getElementById('filter-from').value=from.toISOString().slice(0,10);
    document.getElementById('filter-to').value=to.toISOString().slice(0,10);
  }
  applyFilters();
}

function clearFilters() {
  document.getElementById('filter-company').value='';
  document.getElementById('filter-from').value='';
  document.getElementById('filter-to').value='';
  document.getElementById('filter-range').value='';
  applyFilters();
}

function applyFilters() {
  const coId=parseInt(document.getElementById('filter-company').value)||null;
  const from=document.getElementById('filter-from').value;
  const to=document.getElementById('filter-to').value;
  filtered=allEntries.filter(e => {
    if (coId&&e.company_id!==coId) return false;
    if (from&&e.log_date<from) return false;
    if (to&&e.log_date>to) return false;
    return true;
  }).sort((a,b)=>b.log_date.localeCompare(a.log_date));
  renderTable(); renderSummary();
}

function renderSummary() {
  const totalMins=filtered.reduce((s,e)=>s+e.total_mins,0);
  const coSet=new Set(filtered.map(e=>e.company_id));
  const avgMins=filtered.length?totalMins/filtered.length:0;
  document.getElementById('chip-sessions').textContent=filtered.length;
  document.getElementById('chip-hours').textContent=fmtH(totalMins);
  document.getElementById('chip-companies').textContent=coSet.size;
  document.getElementById('chip-avg').textContent=fmtH(avgMins);
}

function renderTable() {
  const tbody=document.getElementById('log-tbody');
  document.getElementById('row-count').textContent=`Showing ${filtered.length} session${filtered.length!==1?'s':''}`;
  if (filtered.length===0) {
    tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state">No sessions match the current filters.</div></td></tr>`;
    return;
  }
  const todayStr=new Date().toISOString().slice(0,10); // C6 (D-009): badge future-dated sessions
  tbody.innerHTML=filtered.map((e,idx) => {
    const co=compMap[e.company_id];
    const rows=safeParseRows(e.rows_json);
    const hasDetail=rows.some(r=>RowUtils.rowHasContent(r));
    return `
      <tr data-idx="${idx}" style="cursor:pointer;">
        <td><span class="expand-arrow" id="arrow-${idx}">${hasDetail?'▶':''}</span></td>
        <td class="log-company">${escapeHtml(co?.name)||'—'}</td>
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

function toggleDetail(idx) {
  const row=document.getElementById(`detail-${idx}`);
  if (!row) return;
  row.classList.toggle('open');
  const arrow=document.getElementById(`arrow-${idx}`);
  if (arrow) arrow.textContent=row.classList.contains('open')?'▼':'▶';
}

function openInTracker(companyId, date, entryId) {
  const co=compMap[companyId];
  if (!co) return;
  sessionStorage.setItem('active_company',JSON.stringify(co));
  sessionStorage.setItem('tracker_date',date);
  // C6 (D-005): open THIS session, not just the first one on the date
  if (entryId) sessionStorage.setItem('tracker_entry',String(entryId));
  api.send('navigate','tracker');
}

function exportSessionPDF(idx) {
  const e=filtered[idx];
  const co=compMap[e.company_id];
  printTimesheet(co,e.log_date,e.session_label,safeParseRows(e.rows_json),e.total_mins);
}

function exportAllPDF() {
  if (filtered.length===0) { Shell.toast('No sessions to export.','warning'); return; }
  const coId=parseInt(document.getElementById('filter-company').value)||null;
  if (!coId) { Shell.toast('Select a company filter for PDF export.','warning'); return; }
  const co=compMap[coId];
  const sessions=[...filtered].reverse(); // chronological order
  const grandTotal=filtered.reduce((s,e)=>s+e.total_mins,0);
  const dateFrom=sessions[0]?.log_date;
  const dateTo=sessions[sessions.length-1]?.log_date;
  const allRows=[];
  sessions.forEach(e=>safeParseRows(e.rows_json).forEach(r=>{if(RowUtils.rowHasContent(r))allRows.push(r);}));
  const hierParts=co?[co.hier_company,co.hier_project,co.hier_platform,co.name].filter(Boolean).join(' › '):'—';
  const summaryBreakdown=buildLabelBreakdown(allRows);
  const summaryBdHtml=summaryBreakdown.length>=2?`
    <h2 style="font-size:13px;font-weight:600;color:#374151;margin:20px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">Time by Label</h2>
    <table style="width:260px;">
      <thead><tr><th>Label</th><th style="text-align:right;">Total</th></tr></thead>
      <tbody>${summaryBreakdown.map(([lbl,mins])=>`<tr><td>${escapeHtml(lbl)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtHFull(mins)}</td></tr>`).join('')}
      <tr class="total-row"><td>Total</td><td style="text-align:right;">${fmtHFull(grandTotal)}</td></tr></tbody>
    </table>`:'';
  const sessionBlocks=sessions.map(e=>{
    const sRows=safeParseRows(e.rows_json).filter(r=>RowUtils.rowHasContent(r));
    const taskRows=sRows.map((r,i)=>`<tr>
      <td>${String(i+1).padStart(2,'0')}</td>
      <td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(flattenText(r.desc||r.description))}</td>
      <td>${r.clock_in||''}</td><td>${r.clock_out||''}</td>
      <td>${fmtHFull(r.total_mins)}</td>
    </tr>`).join('');
    const bd=buildLabelBreakdown(sRows);
    const bdHtml=bd.length>=2?`
      <div style="margin-top:8px;">
        <table style="width:260px;">
          <thead><tr><th>Label</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${bd.map(([lbl,mins])=>`<tr><td>${escapeHtml(lbl)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtHFull(mins)}</td></tr>`).join('')}</tbody>
        </table>
      </div>`:'';
    return `<div class="session-block">
      <div class="session-header">${escapeHtml(e.log_date)}${e.session_label?' · '+escapeHtml(e.session_label):''}</div>
      <table>
        <thead><tr><th>#</th><th>Label</th><th>Name</th><th>Description</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
        <tbody>${taskRows}<tr class="total-row"><td colspan="6" style="text-align:right;">Session Total</td><td>${fmtHFull(e.total_mins)}</td></tr></tbody>
      </table>${bdHtml}
    </div>`;
  }).join('');
  const metaLines=[
    co.job_title?`<div class="meta">${escapeHtml(co.job_title)}</div>`:'',
    co.work_type?`<div class="meta">Work type: ${escapeHtml(co.work_type)}</div>`:'',
    co.location?`<div class="meta">Location: ${escapeHtml(co.location)}</div>`:'',
    co.supervisors?`<div class="meta">Submitted to: ${escapeHtml(co.supervisors)}</div>`:'',
  ].join('');
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Timesheet</title>
  <style>${window.PDF_FONT_CSS || ''}</style>
  <style>
    body{font-family:Inter,system-ui,sans-serif;font-size:12px;color:#111;padding:40px;max-width:960px;margin:0 auto;}
    h1{font-size:20px;font-weight:600;margin:0 0 3px;}
    .meta{color:#666;font-size:11px;margin-bottom:3px;}
    .hier{color:#2563eb;font-size:11px;font-weight:500;margin-bottom:4px;}
    .summary-period{font-size:11px;color:#374151;margin-bottom:4px;}
    table{width:100%;border-collapse:collapse;margin-top:8px;}
    th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:9px 8px;text-align:left;font-size:11px;font-weight:600;color:#374151;}
    td{padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;}
    .total-row{font-weight:600;background:#f9fafb;}
    .session-block{margin-top:28px;page-break-inside:avoid;}
    .session-header{font-size:12px;font-weight:600;color:#374151;border-bottom:2px solid #2563eb;padding-bottom:4px;margin-bottom:0;}
    .footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;}
  </style></head><body>
  <h1>${escapeHtml(co.name)}</h1>
  ${metaLines}
  <div class="hier">${escapeHtml(hierParts)}</div>
  <div class="summary-period">Period: ${dateFrom} – ${dateTo} &nbsp;·&nbsp; ${sessions.length} session${sessions.length!==1?'s':''} &nbsp;·&nbsp; Grand total: ${fmtHFull(grandTotal)}</div>
  ${summaryBdHtml}
  ${sessionBlocks}
  <div class="footer"><span>Generated by Conquered Time · ${new Date().toLocaleString()}</span><span>CONFIDENTIAL</span></div>
  </body></html>`);
  win.document.close(); win.print();
}

function buildLabelBreakdown(rows) {
  const map={};
  rows.filter(r=>r.label).forEach(r=>{ map[r.label]=(map[r.label]||0)+(r.total_mins||0); });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

function printTimesheet(co,dateStr,sessionLabel,rows,totalMins) {
  const hierParts=co?[co.hier_company,co.hier_project,co.hier_platform,co.name].filter(Boolean).join(' › '):'—';
  const filledRows=rows.filter(r=>RowUtils.rowHasContent(r));
  const taskRows=filledRows.map((r,i)=>`<tr>
    <td>${String(i+1).padStart(2,'0')}</td>
    <td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.name)}</td>
    <td>${escapeHtml(flattenText(r.desc||r.description))}</td>
    <td>${r.clock_in||''}</td><td>${r.clock_out||''}</td>
    <td>${fmtHFull(r.total_mins)}</td>
  </tr>`).join('');
  const breakdown=buildLabelBreakdown(filledRows);
  const bdHtml=breakdown.length>=2?`
    <h2 style="font-size:12px;font-weight:600;color:#374151;margin:20px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">Time by Label</h2>
    <table style="width:260px;">
      <thead><tr><th>Label</th><th style="text-align:right;">Total</th></tr></thead>
      <tbody>${breakdown.map(([lbl,mins])=>`<tr><td>${escapeHtml(lbl)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtHFull(mins)}</td></tr>`).join('')}</tbody>
    </table>`:'';
  const metaLines=[
    co?.job_title?`<div class="meta">${escapeHtml(co.job_title)}${sessionLabel?' · '+escapeHtml(sessionLabel):''}</div>`:(sessionLabel?`<div class="meta">${escapeHtml(sessionLabel)}</div>`:''),
    co?.work_type?`<div class="meta">Work type: ${escapeHtml(co.work_type)}</div>`:'',
    co?.location?`<div class="meta">Location: ${escapeHtml(co.location)}</div>`:'',
    co?.supervisors?`<div class="meta">Submitted to: ${escapeHtml(co.supervisors)}</div>`:'',
  ].join('');
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Timesheet</title>
  <style>${window.PDF_FONT_CSS || ''}</style>
  <style>
    body{font-family:Inter,system-ui,sans-serif;font-size:12px;color:#111;padding:40px;max-width:960px;margin:0 auto;}
    h1{font-size:20px;font-weight:600;margin:0 0 3px;}
    .meta{color:#666;font-size:11px;margin-bottom:3px;}
    .hier{color:#2563eb;font-size:11px;font-weight:500;margin-bottom:20px;}
    table{width:100%;border-collapse:collapse;margin-top:12px;}
    th{background:#f1f5f9;border-bottom:2px solid #2563eb;padding:9px 8px;text-align:left;font-size:11px;font-weight:600;color:#374151;}
    td{padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;}
    .total-row{font-weight:600;background:#f9fafb;}
    .footer{margin-top:32px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;}
  </style></head><body>
  <h1>${escapeHtml(co?.name)||'Timesheet'}</h1>
  ${metaLines}
  <div class="hier">${escapeHtml(hierParts)}</div>
  <div class="meta">Period: ${escapeHtml(dateStr)}</div>
  <table>
    <thead><tr><th>#</th><th>Label</th><th>Name</th><th>Description</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
    <tbody>${taskRows}<tr class="total-row"><td colspan="6" style="text-align:right;">Total</td><td>${fmtHFull(totalMins)}</td></tr></tbody>
  </table>
  ${bdHtml}
  <div class="footer"><span>Generated by Conquered Time · ${new Date().toLocaleString()}</span><span>CONFIDENTIAL</span></div>
  </body></html>`);
  win.document.close(); win.print();
}

// Safely encode a value as a CSV field: double embedded quotes, always quote,
// and neutralize formula injection — a leading =, +, -, @, tab or CR makes
// Excel/Sheets evaluate the cell as a formula, so prefix those with a single
// quote. (e.g. a company named "=cmd|'/c calc'!A1" must not execute on open.)
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function exportCSV() {
  if (filtered.length===0) { Shell.toast('No data to export.','warning'); return; }
  const lines=['Company,Date,Session,Task Label,Task Name,Description,Clock In,Clock Out,Duration (mins)'];
  filtered.forEach(e => {
    const co=compMap[e.company_id];
    safeParseRows(e.rows_json).filter(r=>RowUtils.rowHasContent(r)).forEach(r => {
      lines.push([csvCell(co?.name),csvCell(e.log_date),csvCell(e.session_label),
        csvCell(r.label),csvCell(r.name),csvCell(flattenText(r.desc||r.description)),
        csvCell(r.clock_in),csvCell(r.clock_out),r.total_mins||0].join(','));
    });
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`conquered-time-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  Shell.toast('CSV exported.','success');
}

function safeParseRows(json) { try{return JSON.parse(json)||[];}catch{return[];} }
function fmtH(mins)     { return mins?(mins/60).toFixed(1)+'h':'0h'; }
function fmtHFull(mins) {
  if (!mins||mins<=0) return '—';
  const h=Math.floor(mins/60), m=mins%60;
  return h>0?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;
}
