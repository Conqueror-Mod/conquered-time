'use strict';

// Import Data page. Guides a CSV file through: choose → map columns → review →
// commit. Pure parsing/validation lives in import-parse.js (window.ImportParse);
// the bulk write is the import:commit IPC. CSP-safe: page actions are dispatched
// from a single delegated click handler, all file-derived text is escapeHtml'd.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

type Built = {
  // For a companies import: the Company objects. For an entries import:
  // buildEntries returns the distinct referenced company *names* (string[]).
  companies?: Array<Record<string, unknown>> | string[];
  sessions?: ImportSession[];
  errors: ImportError[];
};

let importType: 'entries' | 'companies' = 'entries';
let parsed: { headers: string[]; rows: string[][] } | null = null;
let mapping: Record<string, number> = {};
let built: Built | null = null;
let fileName = '';

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const fields = (): ImportField[] => importType === 'entries' ? ImportParse.ENTRY_FIELDS : ImportParse.COMPANY_FIELDS;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('import');
  document.documentElement.style.visibility = '';

  // Single delegated click dispatcher for this page's data-action buttons.
  // (The shell's own dispatcher no-ops on actions it doesn't know, so these
  //  page-local names don't collide.)
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    switch (act) {
      case 'set-type':        setType((el.dataset.arg as 'entries' | 'companies')); break;
      case 'download-template': e.preventDefault(); downloadTemplate(); break;
      case 'back-to-1':       showStep(1); break;
      case 'back-to-2':       showStep(2); break;
      case 'to-review':       toReview(); break;
      case 'commit':          commit(); break;
      case 'import-another':  resetAll(); break;
      case 'go-global-log':   api.send('navigate', 'global-log'); break;
      default: break; // navigate / shell actions handled by the shell dispatcher
    }
  });

  // File picker + drag-drop.
  const dz = $id('drop-zone');
  const input = $id('file-input') as HTMLInputElement;
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files && input.files[0]) onFile(input.files[0]); });
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });

  // Remap when columns change (delegated — selects are re-rendered).
  $id('map-body').addEventListener('change', e => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-field]');
    if (sel) mapping[sel.dataset.field!] = Number(sel.value);
  });
});

// ── Steps ───────────────────────────────────────────────────────────────────
function showStep(n: number): void {
  for (let i = 1; i <= 4; i++) {
    ($id('step-' + i)).hidden = i !== n;
    const ind = $id('step-ind-' + i);
    ind.classList.toggle('active', i === n);
    ind.classList.toggle('done', i < n);
  }
}

function setType(t: 'entries' | 'companies'): void {
  importType = t;
  $id('type-entries').classList.toggle('active', t === 'entries');
  $id('type-companies').classList.toggle('active', t === 'companies');
}

function resetAll(): void {
  parsed = null; mapping = {}; built = null; fileName = '';
  ($id('file-input') as HTMLInputElement).value = '';
  ($id('file-row')).hidden = true;
  showStep(1);
}

// ── Step 1 → 2: read + parse the file, auto-map ──────────────────────────────
function onFile(file: File): void {
  if (!/\.csv$/i.test(file.name)) { Shell.toast('Please choose a .csv file.', 'error'); return; }
  fileName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    parsed = ImportParse.parseCSV(text);
    if (!parsed.headers.length) { Shell.toast('That file has no readable rows.', 'error'); return; }
    mapping = ImportParse.autoMap(parsed.headers, fields());
    $id('file-name').textContent = `${fileName} — ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}`;
    ($id('file-row')).hidden = false;
    renderMap();
    showStep(2);
  };
  reader.onerror = () => Shell.toast('Could not read that file.', 'error');
  reader.readAsText(file);
}

function renderMap(): void {
  const headers = parsed!.headers;
  const opts = (selected: number) => {
    let h = `<option value="-1"${selected < 0 ? ' selected' : ''}>— skip —</option>`;
    headers.forEach((head, i) => {
      h += `<option value="${i}"${selected === i ? ' selected' : ''}>${escapeHtml(head)}</option>`;
    });
    return h;
  };
  $id('map-body').innerHTML = fields().map(f => `
    <tr>
      <td class="map-field">${escapeHtml(f.label)}${f.required ? '<span class="req">*</span>' : ''}</td>
      <td><select class="map-select sc-input" data-field="${escapeHtml(f.key)}">${opts(mapping[f.key] ?? -1)}</select></td>
    </tr>`).join('');
}

// ── Step 2 → 3: build + validate ─────────────────────────────────────────────
function toReview(): void {
  const missing = fields().filter(f => f.required && (mapping[f.key] ?? -1) < 0);
  const warn = $id('map-warn');
  if (missing.length) {
    warn.hidden = false;
    warn.textContent = `Map a column for: ${missing.map(f => f.label).join(', ')} (required).`;
    return;
  }
  warn.hidden = true;
  built = importType === 'entries'
    ? ImportParse.buildEntries(parsed!.rows, mapping)
    : ImportParse.buildCompanies(parsed!.rows, mapping);
  renderReview();
  showStep(3);
}

function chip(num: number | string, lbl: string, warnClass = false): string {
  return `<div class="rv-chip${warnClass ? ' warn' : ''}"><div class="rv-num">${num}</div><div class="rv-lbl">${escapeHtml(lbl)}</div></div>`;
}

function renderReview(): void {
  const b = built!;
  const errs = b.errors || [];
  let chips = '';
  let commitLabel: string;
  if (importType === 'entries') {
    const sessions = b.sessions || [];
    const rows = sessions.reduce((t, s) => t + (s.rows ? s.rows.length : 0), 0);
    const cos = (b.companies as unknown as string[]) || [];
    chips = chip(sessions.length, 'Sessions') + chip(rows, 'Task rows') + chip(cos.length, 'Companies referenced');
    commitLabel = `Import ${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
    if (!sessions.length) commitLabel = 'Nothing to import';
  } else {
    const cos = b.companies || [];
    chips = chip(cos.length, 'Companies');
    commitLabel = `Import ${cos.length} compan${cos.length === 1 ? 'y' : 'ies'}`;
    if (!cos.length) commitLabel = 'Nothing to import';
  }
  if (errs.length) chips += chip(errs.length, 'Rows skipped', true);
  $id('review-stats').innerHTML = chips;

  $id('review-errors').innerHTML = errs.length
    ? `<div class="import-hint" style="margin:6px 0;">These rows were skipped:</div>`
      + `<div class="error-list">${errs.slice(0, 200).map(er => `<div class="er-row"><b>Row ${er.row}</b> — ${escapeHtml(er.msg)}</div>`).join('')}</div>`
    : '';

  $id('review-preview').innerHTML = renderPreview();

  const btn = $id('btn-commit') as HTMLButtonElement;
  btn.textContent = commitLabel;
  const nothing = importType === 'entries' ? !(b.sessions && b.sessions.length) : !(b.companies && b.companies.length);
  btn.disabled = nothing;
}

function renderPreview(): string {
  if (importType === 'entries') {
    const s = (built!.sessions || []).slice(0, 8);
    if (!s.length) return '';
    const head = ['Company', 'Date', 'Session', 'Rows', 'Total'];
    const body = s.map(x => `<tr><td>${escapeHtml(x.company)}</td><td>${escapeHtml(x.log_date)}</td>`
      + `<td>${escapeHtml(x.session_label || '—')}</td><td>${x.rows.length}</td>`
      + `<td>${Math.floor((x.total_mins || 0) / 60)}h ${String((x.total_mins || 0) % 60).padStart(2, '0')}m</td></tr>`).join('');
    return table(head, body);
  }
  const c = ((built!.companies || []) as Array<Record<string, unknown>>).slice(0, 8);
  if (!c.length) return '';
  const head = ['Company', 'Project', 'Role', 'Rate'];
  const body = c.map(x => `<tr><td>${escapeHtml(String(x.name || ''))}</td><td>${escapeHtml(String(x.hier_project || '—'))}</td>`
    + `<td>${escapeHtml(String(x.job_title || '—'))}</td><td>${x.pay_rate != null ? escapeHtml(String(x.pay_rate)) : '—'}</td></tr>`).join('');
  return table(head, body);
}

function table(head: string[], body: string): string {
  return `<div class="import-hint" style="margin:14px 0 4px;">Preview (first few):</div>`
    + `<table class="preview-table"><thead><tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── Step 3 → 4: commit ────────────────────────────────────────────────────────
async function commit(): Promise<void> {
  const btn = $id('btn-commit') as HTMLButtonElement;
  btn.disabled = true;
  const payload = importType === 'entries'
    ? { sessions: built!.sessions }
    : { companies: built!.companies as Array<Record<string, unknown>> };
  const res = await api.invoke('import:commit', payload);
  btn.disabled = false;
  if (!res || !res.ok) { Shell.toast(res?.error || 'Import failed.', 'error'); return; }
  const parts: string[] = [];
  if (res.companiesCreated) parts.push(chip(res.companiesCreated, 'Companies added'));
  if (res.companiesMatched) parts.push(chip(res.companiesMatched, 'Already existed'));
  if (res.sessionsCreated != null && importType === 'entries') parts.push(chip(res.sessionsCreated || 0, 'Sessions added'));
  if (res.sessionsSkipped) parts.push(chip(res.sessionsSkipped, 'Duplicates skipped', true));
  $id('done-stats').innerHTML = parts.join('');
  showStep(4);
  Shell.toast('Import complete.', 'success');
}

// ── Template download ─────────────────────────────────────────────────────────
function downloadTemplate(): void {
  const fs = fields();
  const header = fs.map(f => csvCell(f.label)).join(',');
  const example = importType === 'entries'
    ? ['Acme Studios', '2026-07-01', 'Morning', 'Annotation', 'Batch A', 'First pass', '09:00', '10:30', '90']
    : ['Acme Studios', 'Acme Group', 'Phoenix', 'web-portal', 'A123456', 'Annotation Specialist', 'Annotation', 'Remote — USA', '25', 'USD', '', '2025-01-01', '', 'login', 'work@acme.com', 'https://portal.acme.com', 'Jane Doe', 'Notes here'];
  const csv = header + '\n' + example.map(csvCell).join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `conquered-time-${importType}-template.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvCell(v: unknown): string {
  const s = String(v == null ? '' : v);
  return `"${s.replace(/"/g, '""')}"`;
}

})();
