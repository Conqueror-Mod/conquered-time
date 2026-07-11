'use strict';

// Companies page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, IPC, Validator, escapeHtml, api) — must load after shell.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

let companies: Company[] = [], entries: EntrySummary[] = [];

// ── Search / filter state ──────────────────────────────────────────────────
let searchQuery = '';                    // lowercased text query
let statusFilter: 'all' | 'active' | 'ended' = 'all';
let typeFilter = '';                     // '' = all work types
let editingId: number | null = null, selectedId: number | null = null;
let ctxTarget: Company | null = null;

// ── Packed-bubble web (Company Web v2) ─────────────────────────────────────
let web: BubbleWebController | null = null;
let webRange: '30' | '90' | 'all' = '90';

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $field = (id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('companies');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'hidden'; }
  // Range preset is per-profile and shared with the dashboard mini web.
  const savedRange = await api.invoke('settings:get', 'ui_webRange');
  if (savedRange === '30' || savedRange === '90' || savedRange === 'all') webRange = savedRange;

  web = BubbleWeb.attach({
    canvas: document.getElementById('web-canvas') as HTMLCanvasElement,
    wrap: $id('spiderweb-wrap'),
    tooltip: {
      root: $id('node-tooltip'), name: $id('tt-name'),
      hier: $id('tt-hier'), detail: $id('tt-detail'),
    },
    // Left-click opens the context menu at the cursor (same behavior the old
    // web had); right-click does too, so both gestures work.
    onCompanyClick: (co, ev) => showCtxAt(co, ev),
    onCompanyContext: (co, ev) => showCtxAt(co, ev),
  });

  await loadCompanies();
  refreshWeb();

  // 30d / 90d / All window presets for bubble sizing + the archive idle rule.
  $id('web-range').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.range-btn');
    if (!btn || !btn.dataset.range) return;
    webRange = btn.dataset.range as typeof webRange;
    document.querySelectorAll<HTMLElement>('#web-range .range-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.range === webRange));
    api.invoke('settings:set', { key: 'ui_webRange', value: webRange });
    refreshWeb();
  });
  document.querySelectorAll<HTMLElement>('#web-range .range-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.range === webRange));

  $id('det-edit-btn').addEventListener('click', () => {
    const co = companies.find(c => c.id === selectedId);
    if (co) openModal(co);
  });
  $id('det-tracker-btn').addEventListener('click', () => {
    const co = companies.find(c => c.id === selectedId);
    if (co) { sessionStorage.setItem('active_company', JSON.stringify(co)); api.send('navigate', 'tracker'); }
  });
  $id('det-delete-btn').addEventListener('click', () => deleteSelected());

  // ── Static control wiring (CSP-safe; replaces inline on* handlers) ──────
  $id('btn-add-company').addEventListener('click', () => openModal());
  $id('det-close-btn').addEventListener('click', closeDetail);
  $id('modal-cancel-btn').addEventListener('click', closeModal);
  $id('modal-save-btn').addEventListener('click', saveCompany);
  $id('delete-btn').addEventListener('click', deleteCompany);
  $id('ctx-open-tracker').addEventListener('click', ctxOpenTracker);
  $id('ctx-edit').addEventListener('click', ctxEditCompany);
  $id('ctx-edit-color').addEventListener('click', ctxEditColor);
  $id('ctx-reset-color').addEventListener('click', ctxResetColor);
  $id('ctx-delete').addEventListener('click', ctxDeleteCompany);

  // Company list — delegated so dynamically-rendered rows need no re-wiring.
  $id('company-list').addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.company-list-item');
    if (item) selectCompany(Number(item.dataset.id));
  });

  // ── Search / filter controls ───────────────────────────────────────────
  const searchInput = $field('company-search') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    ($id('company-search-clear')).style.display = searchInput.value ? '' : 'none';
    applyFilters();
  });
  $id('company-search-clear').addEventListener('click', () => {
    searchInput.value = ''; searchQuery = '';
    $id('company-search-clear').style.display = 'none';
    applyFilters();
    searchInput.focus();
  });
  ($field('company-status-filter') as HTMLSelectElement).addEventListener('change', e => {
    statusFilter = (e.target as HTMLSelectElement).value as typeof statusFilter;
    applyFilters();
  });
  ($field('company-type-filter') as HTMLSelectElement).addEventListener('change', e => {
    typeFilter = (e.target as HTMLSelectElement).value;
    applyFilters();
  });

  $id('company-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
});

async function loadCompanies(): Promise<void> {
  companies = await Store.getCompanies();
  entries   = await Store.getEntriesSummary();
  populateTypeFilter();
  renderList();
  updateCount();
  if (selectedId) {
    const co = companies.find(c => c.id === selectedId);
    if (co) renderDetail(co); else closeDetail();
  }
}

// Rebuild the work-type dropdown from the distinct work_type values present,
// preserving the current selection when still valid.
function populateTypeFilter(): void {
  const sel = $field('company-type-filter') as HTMLSelectElement;
  const types = [...new Set(companies.map(c => (c.work_type || '').trim()).filter(Boolean))].sort();
  const prev = typeFilter;
  sel.innerHTML = `<option value="">All types</option>` +
    types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (prev && types.includes(prev)) { sel.value = prev; }
  else if (prev) { typeFilter = ''; sel.value = ''; }   // selected type no longer exists
}

// A company matches when it passes ALL active facets: text query, status, type.
function matchesFilters(co: Company): boolean {
  if (statusFilter === 'active' && co.date_end) return false;
  if (statusFilter === 'ended'  && !co.date_end) return false;
  if (typeFilter && (co.work_type || '') !== typeFilter) return false;
  if (searchQuery) {
    const haystack = [
      co.name, co.hier_company, co.hier_project, co.hier_platform,
      co.job_title, co.work_type, co.location, co.nav_id,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(searchQuery)) return false;
  }
  return true;
}

function filteredCompanies(): Company[] {
  return companies.filter(matchesFilters);
}

const isFiltering = (): boolean => !!searchQuery || statusFilter !== 'all' || !!typeFilter;

// Re-run every filter-dependent view: list, count, web dimming.
function applyFilters(): void {
  renderList();
  updateCount();
  applyWebDimming();
}

function updateCount(): void {
  const total = companies.length;
  const shown = isFiltering() ? filteredCompanies().length : total;
  $id('company-count').textContent = isFiltering() ? `${shown}/${total}` : String(total);
}

// Fade web bubbles whose company is filtered out of the list.
function applyWebDimming(): void {
  web?.setMatcher(isFiltering() ? matchesFilters : null);
}

// Push the current data + window preset into the bubble web.
function refreshWeb(): void {
  web?.update(companies, entries, webRange);
  applyWebDimming();
}

function compMinsMap(): Record<number, number> {
  const m: Record<number, number> = {};
  entries.forEach(e => { m[e.company_id] = (m[e.company_id] || 0) + e.total_mins; });
  return m;
}

function renderList(): void {
  const el = $id('company-list');
  if (companies.length === 0) {
    el.innerHTML = `<div class="company-list-empty">No companies yet.<br>Add one to begin.</div>`;
    return;
  }
  const list = filteredCompanies();
  if (list.length === 0) {
    el.innerHTML = `<div class="company-list-empty">No companies match your filters.<br>Try a different search or clear the filters.</div>`;
    return;
  }
  const mins = compMinsMap();
  el.innerHTML = list.map(co => {
    const hier = [co.hier_project, co.hier_platform].filter(Boolean).join(' › ');
    const sub  = hier || co.job_title || co.work_type || '';
    const sel  = co.id === selectedId ? ' selected' : '';
    return `
      <div class="company-list-item${sel}" data-id="${co.id}">
        <div class="company-dot"></div>
        <div class="company-info">
          <div class="company-name">${escapeHtml(co.name) || '—'}</div>
          ${sub ? `<div class="company-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
        <div class="company-hours">${fmtH(mins[co.id] || 0)}</div>
      </div>`;
  }).join('');
}

function selectCompany(id: number): void {
  selectedId = id;
  document.querySelectorAll<HTMLElement>('.company-list-item').forEach(el =>
    el.classList.toggle('selected', parseInt(el.dataset.id || '') === id)
  );
  const co = companies.find(c => c.id === id);
  if (co) renderDetail(co);
}

function renderDetail(co: Company): void {
  const mins  = compMinsMap();
  const hours = mins[co.id] || 0;

  $id('det-panel-title').textContent = 'Details';
  $id('det-name').textContent = co.name || '—';

  const hierParts = [co.hier_company, co.hier_project, co.hier_platform].filter(Boolean);
  $id('det-breadcrumb').textContent = hierParts.join(' › ');

  const isActive = !co.date_end;
  let statsHtml = '';
  statsHtml += `<div class="det-chip yellow">${fmtH(hours)} logged</div>`;
  if (co.pay_rate) statsHtml += `<div class="det-chip accent">$${Number(co.pay_rate).toFixed(2)}/hr</div>`;
  statsHtml += `<div class="det-chip ${isActive ? 'green' : ''}">${isActive ? 'Active' : 'Ended'}</div>`;
  if (co.work_type) statsHtml += `<div class="det-chip">${escapeHtml(co.work_type)}</div>`;
  $id('det-stats').innerHTML = statsHtml;

  const fv = (v: string | null | undefined): string => v
    ? `<span class="det-field-value">${escapeHtml(v)}</span>`
    : `<span class="det-field-value empty">—</span>`;

  $id('det-fields').innerHTML = `
    <div class="det-field">
      <div class="det-field-label">Job Title</div>
      ${fv(co.job_title)}
    </div>
    <div class="det-field">
      <div class="det-field-label">Location</div>
      ${fv(co.location)}
    </div>
    <div class="det-field">
      <div class="det-field-label">Started</div>
      ${fv(co.date_start)}
    </div>
    <div class="det-field">
      <div class="det-field-label">Ended</div>
      ${fv(co.date_end || (isActive ? 'Present' : null))}
    </div>
    ${co.supervisors ? `
    <div class="det-field span-2">
      <div class="det-field-label">Supervisors</div>
      ${fv(co.supervisors)}
    </div>` : ''}
  `;

  const notesBlock = $id('det-notes-block');
  if (co.notes) {
    notesBlock.classList.add('has-notes');
    $id('det-notes-text').textContent = co.notes;
  } else {
    notesBlock.classList.remove('has-notes');
  }

  $id('company-panel').classList.add('detail-open');
}

function closeDetail(): void {
  selectedId = null;
  $id('company-panel').classList.remove('detail-open');
  document.querySelectorAll('.company-list-item').forEach(el => el.classList.remove('selected'));
}

// ── Modal ──
function openModal(co: Company | null = null): void {
  editingId = co?.id || null;
  $id('modal-title').textContent = co ? 'Edit Company' : 'Add Company';
  $id('delete-btn').style.display = co ? '' : 'none';
  const fields: Record<string, string> = {
    'f-hier-company':  co?.hier_company  || '',
    'f-hier-project':  co?.hier_project  || '',
    'f-hier-platform': co?.hier_platform || '',
    'f-navid':         co?.nav_id        || '',
    'f-name':          co?.name === co?.hier_company ? '' : (co?.name || ''),
    'f-title':         co?.job_title     || '',
    'f-work-type':     co?.work_type     || '',
    'f-location':      co?.location      || '',
    'f-payrate':       String(co?.pay_rate || ''),
    'f-currency':      co?.currency       || '',
    'f-date-start':    co?.date_start    || '',
    'f-date-end':      co?.date_end      || '',
    'f-login':         co?.platform_login  || '',
    'f-email':         co?.platform_email  || '',
    'f-report-email':  co?.report_email    || '',
    'f-billing-address': co?.billing_address || '',
    'f-url':           co?.platform_url    || '',
    'f-supervisors':   co?.supervisors     || '',
    'f-notes':         co?.notes           || '',
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (el) el.value = val;
  });
  $id('company-modal').style.display = 'flex';
  setTimeout(() => {
    const focus = document.getElementById('f-hier-company');
    if (focus) focus.focus();
  }, 50);
}

function closeModal(): void {
  $id('company-modal').style.display = 'none';
  editingId = null;
}

async function saveCompany(): Promise<void> {
  const hierCompany = $field('f-hier-company').value.trim();
  if (!hierCompany) { Shell.toast('Company field is required.', 'error'); return; }
  const alias = $field('f-name').value.trim();
  const data = {
    id:              editingId,
    name:            alias || hierCompany,
    job_title:       $field('f-title').value.trim(),
    work_type:       $field('f-work-type').value,
    location:        $field('f-location').value.trim(),
    pay_rate:        parseFloat($field('f-payrate').value) || 0,
    currency:        $field('f-currency').value,
    date_start:      $field('f-date-start').value,
    date_end:        $field('f-date-end').value,
    hier_company:    hierCompany,
    hier_project:    $field('f-hier-project').value.trim(),
    hier_platform:   $field('f-hier-platform').value.trim(),
    nav_id:          $field('f-navid').value.trim(),
    platform_login:  $field('f-login').value.trim(),
    platform_email:  $field('f-email').value.trim(),
    report_email:    $field('f-report-email').value.trim(),
    billing_address: $field('f-billing-address').value.trim(),
    platform_url:    $field('f-url').value.trim(),
    supervisors:     $field('f-supervisors').value.trim(),
    notes:           $field('f-notes').value.trim(),
    // Not a form field — carry the web's Edit Color pick through form saves,
    // otherwise editing any other field would silently wipe the override
    // (companies:save encrypts the whole payload as the new blob).
    color:           (editingId && companies.find(c => c.id === editingId)?.color) || undefined,
  };
  const valid = Validator.validateCompany(data as Partial<Company>);
  if (!valid.ok) { Shell.toast(valid.error || 'Invalid company.', 'error'); return; }
  const res = await IPC.companies.save(data as unknown as Company);
  if (res.ok) {
    Shell.toast(editingId ? 'Company updated.' : 'Company added.', 'success');
    closeModal();
    Store.invalidate('companies');
    await loadCompanies();
    refreshWeb();
  } else {
    Shell.toast(res.error || 'Save failed.', 'error');
  }
}

async function deleteCompany(): Promise<void> {
  if (!editingId || !confirm('Delete this company and all its time entries?')) return;
  await IPC.companies.delete(editingId);
  Shell.toast('Company deleted.', 'warning');
  if (selectedId === editingId) closeDetail();
  closeModal();
  Store.invalidate('all');
  await loadCompanies();
  refreshWeb();
}

async function deleteSelected(): Promise<void> {
  if (!selectedId || !confirm('Delete this company and all its time entries?')) return;
  await IPC.companies.delete(selectedId);
  Shell.toast('Company deleted.', 'warning');
  closeDetail();
  Store.invalidate('all');
  await loadCompanies();
  refreshWeb();
}

// ── Context menu ──
function showCtxAt(co: Company, ev: MouseEvent): void {
  ctxTarget = co;
  const wrap = $id('spiderweb-wrap');
  const wr = wrap.getBoundingClientRect();
  const m = $id('ctx-menu');
  // Show "Reset to auto color" only when an override exists.
  $id('ctx-reset-color').style.display = co.color ? '' : 'none';
  m.style.display = 'block';
  m.style.left = Math.min(ev.clientX - wr.left, wrap.clientWidth - m.offsetWidth - 8) + 'px';
  m.style.top  = Math.min(ev.clientY - wr.top,  wrap.clientHeight - m.offsetHeight - 8) + 'px';
}
function hideCtx(): void { $id('ctx-menu').style.display = 'none'; }
document.addEventListener('click', hideCtx);
function ctxOpenTracker(): void { if (!ctxTarget) return; sessionStorage.setItem('active_company', JSON.stringify(ctxTarget)); api.send('navigate', 'tracker'); }
function ctxEditCompany(): void { if (ctxTarget) openModal(ctxTarget); }

// 🎨 Edit Color — hidden <input type="color"> so the OS picker opens at the
// menu position; the pick persists into the company's encrypted blob.
function ctxEditColor(): void {
  if (!ctxTarget) return;
  const target = ctxTarget;
  const pick = $field('ctx-color-pick') as HTMLInputElement;
  pick.value = target.color || '#4aa8c0';
  pick.onchange = () => { void saveColor(target, pick.value); };
  pick.click();
}
function ctxResetColor(): void {
  if (ctxTarget) void saveColor(ctxTarget, null);
}
async function saveColor(co: Company, hex: string | null): Promise<void> {
  const data: Company = { ...co, color: hex || undefined };
  if (!hex) delete data.color;
  const res = await IPC.companies.save(data);
  if (!res.ok) { Shell.toast(res.error || 'Color save failed.', 'error'); return; }
  Shell.toast(hex ? 'Company color updated.' : 'Company color reset to auto.', 'success');
  Store.invalidate('companies');
  await loadCompanies();
  refreshWeb();
}
async function ctxDeleteCompany(): Promise<void> {
  if (!ctxTarget || !confirm(`Delete ${ctxTarget.name}?`)) return;
  await IPC.companies.delete(ctxTarget.id);
  Shell.toast('Company deleted.', 'warning');
  if (selectedId === ctxTarget.id) closeDetail();
  ctxTarget = null;
  Store.invalidate('all');
  await loadCompanies();
  refreshWeb();
}

function fmtH(mins: number): string { return mins ? (mins / 60).toFixed(1) + 'h' : '0h'; }

})();
