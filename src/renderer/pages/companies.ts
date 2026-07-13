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
// Viewport coords of the last context-menu open — anchors the (position:fixed)
// color picker, so Edit Color works from both the galaxy menu and the list menu.
let ctxAnchorX = 0, ctxAnchorY = 0;

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
    breadcrumb: { root: $id('web-crumb'), name: $id('web-crumb-name') },
    // Galaxy rules: left-click is navigation (expand / zoom / tracker);
    // actions live on the right-click menus — galaxy menu vs system menu.
    onOpenTracker: (co) => { sessionStorage.setItem('active_company', JSON.stringify(co)); api.send('navigate', 'tracker'); },
    onGalaxyContext: (galaxy, ev) => showGalaxyCtx(galaxy, ev),
    onSystemContext: (co, ev) => showCtxAt(co, ev),
    onSelect: (co) => focusFromWeb(co),
    onHover: (co) => hoverFromWeb(co),
  });

  await loadCompanies();
  refreshWeb();

  // Dashboard → Companies pre-zoom handoff: land inside the clicked galaxy.
  const zoomKey = sessionStorage.getItem('web_zoom_galaxy');
  if (zoomKey) { sessionStorage.removeItem('web_zoom_galaxy'); web.zoomTo(zoomKey); }

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
  $id('gctx-open').addEventListener('click', gctxOpen);
  $id('gctx-edit-color').addEventListener('click', gctxEditColor);
  $id('gctx-reset-color').addEventListener('click', gctxResetColor);

  // Company list — delegated so dynamically-rendered rows need no re-wiring.
  // Galaxy headers toggle their accordion; project rows select as before.
  $id('company-list').addEventListener('click', e => {
    const head = (e.target as HTMLElement).closest<HTMLElement>('.galaxy-head');
    if (head) {
      const key = head.dataset.gkey || '';
      if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
      renderList();
      return;
    }
    const item = (e.target as HTMLElement).closest<HTMLElement>('.company-list-item');
    if (item && item.dataset.id) selectCompany(Number(item.dataset.id));
  });

  // Right-click a company row → the same quick actions as its galaxy bubble.
  $id('company-list').addEventListener('contextmenu', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.company-list-item[data-id]');
    if (!item || !item.dataset.id) return;
    const co = companies.find(c => c.id === Number(item.dataset.id));
    if (co) listContextMenu(e as MouseEvent, co);
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

// Galaxy grouping key — must mirror the engine's rule (bubble-web.ts).
const listGroupKey = (co: Company): string => (co.hier_company || co.name || '—').trim() || '—';
// Expanded galaxy headers (persists across re-renders within the page).
const openGroups = new Set<string>();

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
  const rowHtml = (co: Company): string => {
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
  };
  // Two-level accordion mirroring the web's galaxies: rows sharing a
  // hier_company group under one header (rolled-up hours); single-row
  // companies render flat, exactly as before. A search/filter auto-expands
  // the groups that still have matching rows.
  const groups = new Map<string, Company[]>();
  for (const co of list) {
    const key = listGroupKey(co);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(co);
  }
  const filtering = isFiltering();
  el.innerHTML = [...groups.entries()].map(([key, rows]) => {
    if (rows.length === 1) return rowHtml(rows[0]);
    const total = rows.reduce((t, c) => t + (mins[c.id] || 0), 0);
    const open = filtering || openGroups.has(key) || rows.some(c => c.id === selectedId);
    return `
      <div class="galaxy-group${open ? ' open' : ''}" data-gkey="${escapeHtml(key)}">
        <div class="company-list-item galaxy-head" data-gkey="${escapeHtml(key)}">
          <div class="galaxy-caret">▶</div>
          <div class="company-info">
            <div class="company-name">${escapeHtml(key)}</div>
            <div class="company-sub">${rows.length} projects</div>
          </div>
          <div class="company-hours">${fmtH(total)}</div>
        </div>
        <div class="galaxy-kids">${rows.map(rowHtml).join('')}</div>
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

// Clicking a system bubble in the galaxy web focuses its row on the right:
// select it, re-render so its accordion group opens (selectedId auto-expands
// the group), scroll it into view, then pulse a glow so the eye follows the
// click from the bubble to its list entry.
function focusFromWeb(co: Company): void {
  selectedId = co.id;
  renderDetail(co);
  renderList();
  const item = document.querySelector<HTMLElement>(`.company-list-item[data-id="${co.id}"]`);
  if (!item) return;
  const reduced = document.documentElement.getAttribute('data-reduced-motion') === 'true';
  item.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  item.classList.remove('glow-focus');
  void item.offsetWidth;   // restart the animation if already glowing
  item.classList.add('glow-focus');
  setTimeout(() => item.classList.remove('glow-focus'), 1400);
}

// Hovering a bubble steadily glows its matching list row, so the eye can track
// any company — including single-project / single-entry ones that never trigger
// a click-select — across to the expanded panel. Passing null clears it.
function hoverFromWeb(co: Company | null): void {
  const id = co ? co.id : null;
  document.querySelectorAll<HTMLElement>('.company-list-item.hover-glow').forEach(el => {
    if (parseInt(el.dataset.id || '') !== id) el.classList.remove('hover-glow');
  });
  if (id == null) return;
  const item = document.querySelector<HTMLElement>(`.company-list-item[data-id="${id}"]`);
  if (item) item.classList.add('hover-glow');
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
  ctxAnchorX = ev.clientX; ctxAnchorY = ev.clientY;
  const wrap = $id('spiderweb-wrap');
  const wr = wrap.getBoundingClientRect();
  const m = $id('ctx-menu');
  // Show "Reset to auto color" only when an override exists.
  $id('ctx-reset-color').style.display = co.color ? '' : 'none';
  m.style.display = 'block';
  m.style.left = Math.min(ev.clientX - wr.left, wrap.clientWidth - m.offsetWidth - 8) + 'px';
  m.style.top  = Math.min(ev.clientY - wr.top,  wrap.clientHeight - m.offsetHeight - 8) + 'px';
}
function hideCtx(): void {
  $id('ctx-menu').style.display = 'none';
  $id('galaxy-ctx-menu').style.display = 'none';
}
document.addEventListener('click', hideCtx);

// ── Galaxy context menu (right-click a galaxy bubble) ─────────────────────
let gctxTarget: BubbleGalaxy | null = null;
function showGalaxyCtx(galaxy: BubbleGalaxy, ev: MouseEvent): void {
  gctxTarget = galaxy;
  const wrap = $id('spiderweb-wrap');
  const wr = wrap.getBoundingClientRect();
  const m = $id('galaxy-ctx-menu');
  $id('gctx-title').textContent = galaxy.name;
  $id('gctx-open').style.display = galaxy.rows.length > 1 ? '' : 'none';
  $id('gctx-reset-color').style.display = galaxy.rows.some(r => r.color) ? '' : 'none';
  m.style.display = 'block';
  m.style.left = Math.min(ev.clientX - wr.left, wrap.clientWidth - m.offsetWidth - 8) + 'px';
  m.style.top  = Math.min(ev.clientY - wr.top,  wrap.clientHeight - m.offsetHeight - 8) + 'px';
}
function gctxOpen(): void {
  if (gctxTarget) web?.zoomTo(gctxTarget.key);
}
// Galaxy Edit Color writes the same color to EVERY row of the group (approved
// decision #2 — no schema change; system shades derive from it). Live preview
// while picking; `change` persists; cancel reverts.
function gctxEditColor(): void {
  if (!gctxTarget) return;
  const rows = gctxTarget.rows;
  const originals = rows.map(r => r.color);
  const pick = $field('ctx-color-pick') as HTMLInputElement;
  const menu = $id('galaxy-ctx-menu');
  pick.style.left = menu.style.left;
  pick.style.top = menu.style.top;
  pick.value = rows.find(r => r.color)?.color || '#4aa8c0';
  let committed = false;
  pick.oninput = () => { rows.forEach(r => { r.color = pick.value; }); web?.redraw(); };
  pick.onchange = () => {
    committed = true;
    rows.forEach(r => { r.color = pick.value; });
    web?.redraw();
    void saveGalaxyColor(rows, pick.value);
  };
  const onDone = (): void => {
    if (!committed) { rows.forEach((r, i) => { r.color = originals[i]; }); web?.redraw(); }
    pick.oninput = null;
    pick.removeEventListener('focusout', onDone);
  };
  pick.addEventListener('focusout', onDone);
  pick.click();
}
function gctxResetColor(): void {
  if (gctxTarget) void saveGalaxyColor(gctxTarget.rows, null);
}
async function saveGalaxyColor(rows: Company[], hex: string | null): Promise<void> {
  for (const co of rows) {
    const data: Company = { ...co, color: hex || undefined };
    if (!hex) delete data.color;
    const res = await IPC.companies.save(data);
    if (!res.ok) { Shell.toast(res.error || 'Color save failed.', 'error'); return; }
  }
  Shell.toast(hex ? 'Galaxy color updated.' : 'Galaxy color reset to auto.', 'success');
  Store.invalidate('companies');
  await loadCompanies();
  refreshWeb();
}
// Company-list right-click — reuses the galaxy menu's actions via the shared
// Shell.contextMenu (ctxTarget + ctxAnchor drive the existing ctx* handlers).
function listContextMenu(ev: MouseEvent, co: Company): void {
  ctxTarget = co;
  selectCompany(co.id);   // select so the detail panel tracks the menu target
  ctxAnchorX = ev.clientX; ctxAnchorY = ev.clientY;
  Shell.contextMenu(ev, [
    { label: '⏱ Open Time Tracker', action: ctxOpenTracker },
    { label: '✎ Edit', action: ctxEditCompany },
    { label: '🎨 Edit Color', action: ctxEditColor },
    { label: '↺ Reset to auto color', hidden: !co.color, action: ctxResetColor },
    { separator: true },
    { label: '🗑 Delete', danger: true, action: ctxDeleteCompany },
  ]);
}
function ctxOpenTracker(): void { if (!ctxTarget) return; sessionStorage.setItem('active_company', JSON.stringify(ctxTarget)); api.send('navigate', 'tracker'); }
function ctxEditCompany(): void { if (ctxTarget) openModal(ctxTarget); }

// 🎨 Edit Color — hidden <input type="color">. Chromium anchors the native
// picker popup to the input's position, so the input is moved to where the
// context menu was opened before click(). While the picker is open, `input`
// events live-preview the pick on the bubble (mutate co.color + redraw);
// `change` (picker confirmed/closed) persists it. Esc/cancel reverts.
function ctxEditColor(): void {
  if (!ctxTarget) return;
  const target = ctxTarget;
  const original = target.color;
  const pick = $field('ctx-color-pick') as HTMLInputElement;
  pick.style.left = ctxAnchorX + 'px';
  pick.style.top = ctxAnchorY + 'px';
  pick.value = target.color || '#4aa8c0';
  let committed = false;
  pick.oninput = () => {            // live preview while dragging in the picker
    target.color = pick.value;
    web?.redraw();
  };
  pick.onchange = () => {           // picker confirmed — persist
    committed = true;
    target.color = pick.value;
    web?.redraw();
    void saveColor(target, pick.value);
  };
  // Cancelled (Esc / close without confirm) — put the original color back.
  const onDone = (): void => {
    if (!committed) { target.color = original; web?.redraw(); }
    pick.oninput = null;
    pick.removeEventListener('focusout', onDone);
  };
  pick.addEventListener('focusout', onDone);
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
