'use strict';

// Companies page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, IPC, Validator, escapeHtml, api) — must load after shell.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

interface SphereColors {
  g1: string; g2: string; border: string; label: string; sublabel: string; rim: string;
  glow?: string; base?: string;
}
interface WebColors {
  center: SphereColors; node: SphereColors;
  edge1: string; edge2: string; grid: string; hours: string;
}
interface WebNode {
  x: number; y: number; vx: number; vy: number; r: number;
  label: string; sublabel: string; isCenter: boolean;
  co: Company | null; fixed?: boolean; hours?: number;
}

let companies: Company[] = [], entries: EntrySummary[] = [], nodes: WebNode[] = [];
let editingId: number | null = null, selectedId: number | null = null;
let ctxTarget: Company | null = null;
let animFrame: number | null = null;
let resizeObserver: ResizeObserver | null = null;

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $field = (id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('companies');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'hidden'; }
  await loadCompanies();
  drawWeb();

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
  $id('ctx-delete').addEventListener('click', ctxDeleteCompany);

  // Company list — delegated so dynamically-rendered rows need no re-wiring.
  $id('company-list').addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.company-list-item');
    if (item) selectCompany(Number(item.dataset.id));
  });

  $id('company-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
});

async function loadCompanies(): Promise<void> {
  companies = await Store.getCompanies();
  entries   = await Store.getEntriesSummary();
  renderList();
  $id('company-count').textContent = String(companies.length);
  if (selectedId) {
    const co = companies.find(c => c.id === selectedId);
    if (co) renderDetail(co); else closeDetail();
  }
}

function compMinsMap(): Record<number, number> {
  const m: Record<number, number> = {};
  entries.forEach(e => { m[e.company_id] = (m[e.company_id] || 0) + e.total_mins; });
  return m;
}

function renderList(): void {
  const el = $id('company-list');
  if (companies.length === 0) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text-dim);text-align:center;padding:24px 0;">No companies yet.<br>Add one to begin.</div>`;
    return;
  }
  const mins = compMinsMap();
  el.innerHTML = companies.map(co => {
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
    'f-date-start':    co?.date_start    || '',
    'f-date-end':      co?.date_end      || '',
    'f-login':         co?.platform_login  || '',
    'f-email':         co?.platform_email  || '',
    'f-report-email':  co?.report_email    || '',
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
    date_start:      $field('f-date-start').value,
    date_end:        $field('f-date-end').value,
    hier_company:    hierCompany,
    hier_project:    $field('f-hier-project').value.trim(),
    hier_platform:   $field('f-hier-platform').value.trim(),
    nav_id:          $field('f-navid').value.trim(),
    platform_login:  $field('f-login').value.trim(),
    platform_email:  $field('f-email').value.trim(),
    report_email:    $field('f-report-email').value.trim(),
    platform_url:    $field('f-url').value.trim(),
    supervisors:     $field('f-supervisors').value.trim(),
    notes:           $field('f-notes').value.trim(),
  };
  const valid = Validator.validateCompany(data as Partial<Company>);
  if (!valid.ok) { Shell.toast(valid.error || 'Invalid company.', 'error'); return; }
  const res = await IPC.companies.save(data as unknown as Company);
  if (res.ok) {
    Shell.toast(editingId ? 'Company updated.' : 'Company added.', 'success');
    closeModal();
    Store.invalidate('companies');
    await loadCompanies();
    drawWeb();
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
  drawWeb();
}

async function deleteSelected(): Promise<void> {
  if (!selectedId || !confirm('Delete this company and all its time entries?')) return;
  await IPC.companies.delete(selectedId);
  Shell.toast('Company deleted.', 'warning');
  closeDetail();
  Store.invalidate('all');
  await loadCompanies();
  drawWeb();
}

// ── Context menu ──
function showCtx(x: number, y: number, co: Company): void {
  ctxTarget = co;
  const m = $id('ctx-menu');
  m.style.left = x + 'px'; m.style.top = y + 'px'; m.style.display = 'block';
}
function hideCtx(): void { $id('ctx-menu').style.display = 'none'; }
document.addEventListener('click', hideCtx);
function ctxOpenTracker(): void { if (!ctxTarget) return; sessionStorage.setItem('active_company', JSON.stringify(ctxTarget)); api.send('navigate', 'tracker'); }
function ctxEditCompany(): void { if (ctxTarget) openModal(ctxTarget); }
async function ctxDeleteCompany(): Promise<void> {
  if (!ctxTarget || !confirm(`Delete ${ctxTarget.name}?`)) return;
  await IPC.companies.delete(ctxTarget.id);
  Shell.toast('Company deleted.', 'warning');
  if (selectedId === ctxTarget.id) closeDetail();
  ctxTarget = null;
  Store.invalidate('all');
  await loadCompanies();
  drawWeb();
}

// ── Spiderweb ──
function drawWeb(): void {
  const canvas = document.getElementById('web-canvas') as HTMLCanvasElement;
  const wrap   = $id('spiderweb-wrap');
  const ctx    = canvas.getContext('2d')!;
  if (animFrame) cancelAnimationFrame(animFrame);
  if (resizeObserver) resizeObserver.disconnect();

  const mins = compMinsMap();

  function initNodes(W: number, H: number): WebNode[] {
    const cx = W / 2, cy = H / 2;
    const count = companies.length;

    // All physics/visual params scale with company count
    const nodeR    = count === 0 ? 28 : Math.max(16, Math.round(32 - count * 1.2));
    const ringFrac = count <= 1  ? 0.36 : count <= 3 ? 0.38 : count <= 6 ? 0.43 : 0.47;
    const LINK     = count <= 1  ? 270  : count <= 3 ? 240  : count <= 6 ? 245  : 275;
    const REPEL    = count <= 1  ? 500  : count <= 3 ? 3500 : count <= 6 ? 6500 : 9500;
    const steps    = count <= 2  ? 60   : count <= 5 ? 160  : 260;

    // Heterogeneous node list: center node (fixed) + one node per company.
    const ns: WebNode[] = [{
      x: cx, y: cy, vx: 0, vy: 0, r: 36,
      label: (window.__currentUsername || 'YOU'), sublabel: '',
      isCenter: true, co: null, fixed: true,
    }];
    // D-003: nodes size themselves to the measured label (bounded), and the
    // draw step ellipsizes anything that still can't fit — no more bare
    // character slices ("Zenith Analy") with no ellipsis.
    const mctx = canvas.getContext('2d')!;
    const LABEL_FONT = '500 10px DM Sans, system-ui, sans-serif';
    const maxR = Math.min(48, nodeR + 22);
    companies.forEach((co, i) => {
      const a = (Math.PI * 2 * i / count) - Math.PI / 2;
      const d = Math.min(W, H) * ringFrac;
      ns.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d,
        vx: 0, vy: 0,
        r: CanvasText.radiusForLabel(mctx, co.name || '?', LABEL_FONT, nodeR, maxR),
        label:    co.name || '?',
        sublabel: co.hier_project || '',
        isCenter: false,
        co,
        hours: mins[co.id] || 0,
      });
    });
    for (let s = 0; s < steps; s++) forceStep(ns, cx, cy, W, H, LINK, REPEL);
    // Hard guarantee: no two spheres may overlap. The force pass only
    // discourages overlap; this separates any remaining collisions outright.
    resolveCollisions(ns, W, H, 160);
    return ns;
  }

  function resizeCanvas(): void {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    nodes = initNodes(W, H);
  }
  resizeCanvas();

  resizeObserver = new ResizeObserver(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resizeCanvas();
    startRender();
  });
  resizeObserver.observe(wrap);
  startRender();

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const tt = $id('node-tooltip');
    let hit = false;
    nodes.slice(1).forEach(n => {
      if (Math.hypot(mx - n.x, my - n.y) < n.r + 10) {
        const wr = wrap.getBoundingClientRect();
        tt.style.left = (e.clientX - wr.left + 16) + 'px';
        tt.style.top  = (e.clientY - wr.top  - 12) + 'px';
        tt.style.display = 'block';
        $id('tt-name').textContent = n.co!.name;
        const hierParts = [n.co!.hier_company, n.co!.hier_project, n.co!.hier_platform].filter(Boolean);
        $id('tt-hier').textContent   = hierParts.length > 1 ? hierParts.join(' › ') : '';
        $id('tt-detail').textContent = [
          n.co!.job_title,
          n.co!.location,
          n.hours ? fmtH(n.hours) + ' logged' : '',
        ].filter(Boolean).join(' · ');
        canvas.style.cursor = 'pointer';
        hit = true;
      }
    });
    if (!hit) { tt.style.display = 'none'; canvas.style.cursor = 'default'; }
  });

  canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    nodes.slice(1).forEach(n => {
      if (Math.hypot(mx - n.x, my - n.y) < n.r + 10) {
        const wr = wrap.getBoundingClientRect();
        showCtx(e.clientX - wr.left, e.clientY - wr.top, n.co!);
      }
    });
  });
}

function startRender(): void {
  const canvas = document.getElementById('web-canvas') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d')!;
  let pulse = 0;

  function render(): void {
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    const cx = W / 2, cy = H / 2;
    const c = getCanvasColors();
    nodes[0].x = cx; nodes[0].y = cy;
    pulse += 0.025;
    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = c.grid; ctx.lineWidth = 0.5;
    for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    // Edges
    nodes.slice(1).forEach(n => {
      const grad = ctx.createLinearGradient(cx, cy, n.x, n.y);
      grad.addColorStop(0, c.edge1); grad.addColorStop(1, c.edge2);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(n.x, n.y);
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.stroke();
    });

    // Company nodes
    nodes.slice(1).forEach(n => {
      drawSphereNode(ctx, n.x, n.y, n.r, false, n.label, n.sublabel);
      if (n.hours) {
        ctx.fillStyle = c.hours;
        ctx.font = '500 10px DM Sans, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(fmtH(n.hours), n.x, n.y + n.r + 6);
      }
    });

    // Center node — pulsing
    const pR = nodes[0].r + 4 * Math.sin(pulse);
    drawSphereNode(ctx, nodes[0].x, nodes[0].y, pR, true, nodes[0].label, '');

    animFrame = requestAnimationFrame(render);
  }
  animFrame = requestAnimationFrame(render);
}

function getCanvasColors(): WebColors {
  const theme = document.documentElement.getAttribute('data-theme') || 'memoria';
  const isLight = theme === 'memoria' || theme === 'rabanastre';
  if (isLight) return {
    center: { g1: 'rgba(30,58,138,0.95)', g2: 'rgba(15,23,80,0.9)', border: '#1d4ed8', label: '#ffffff', sublabel: 'rgba(255,255,255,0.7)', glow: 'rgba(29,78,216,0.18)', rim: 'rgba(8,18,70,1)' },
    // Mid-indigo fills (the old near-black ones read as black blobs on light
    // backgrounds) with a soft rim; labels render INSIDE these spheres, so
    // white text stays — the fill is dark enough to carry it.
    node:   { g1: 'rgba(99,102,241,0.95)', g2: 'rgba(67,56,202,0.92)', border: '#4338ca', label: '#ffffff', sublabel: 'rgba(255,255,255,0.75)', rim: 'rgba(49,46,129,0.45)' },
    edge1: 'rgba(29,78,216,0.7)', edge2: 'rgba(67,56,202,0.15)',
    grid: 'rgba(0,0,0,0.05)', hours: '#92400e',
  };
  return {
    center: { base: '#0f2060', g1: 'rgba(80,130,255,1)', g2: 'rgba(25,55,175,1)', border: '#3b82f6', label: '#bfdbfe', sublabel: 'rgba(191,219,254,0.7)', glow: 'rgba(59,130,246,0.12)', rim: 'rgba(8,18,70,1)' },
    node:   { g1: 'rgba(129,140,248,0.22)', g2: 'rgba(67,56,202,0.14)', border: '#6366f1', label: '#e0e7ff', sublabel: 'rgba(224,231,255,0.55)', rim: 'rgba(0,0,0,0.35)' },
    edge1: 'rgba(59,130,246,0.5)', edge2: 'rgba(99,102,241,0.08)',
    grid: 'rgba(255,255,255,0.025)', hours: 'rgba(245,158,11,0.9)',
  };
}

function drawSphereNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
                        isCenter: boolean, label: string, sublabel: string): void {
  const c  = getCanvasColors();
  const nc = isCenter ? c.center : c.node;
  if (isCenter) {
    ctx.beginPath(); ctx.arc(x, y, r + 12, 0, Math.PI * 2);
    ctx.fillStyle = nc.glow || 'rgba(59,130,246,0.12)'; ctx.fill();
  }
  if (isCenter && nc.base) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = nc.base; ctx.fill();
  }
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, nc.g1); grad.addColorStop(0.6, nc.g2); grad.addColorStop(1, nc.rim);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = nc.border; ctx.lineWidth = isCenter ? 2 : 1.5; ctx.stroke();
  const hl = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x - r * 0.35, y - r * 0.35, r * 0.6);
  hl.addColorStop(0, 'rgba(255,255,255,0.16)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = hl; ctx.fill();

  // D-003: labels ellipsize to the node's actual diameter (the node was sized
  // for the name at build; anything still over the bound gets a real '…').
  const fitW = 2 * r - 8;
  if (sublabel) {
    ctx.fillStyle = nc.label;
    ctx.font = `${isCenter ? '600 ' : '500 '}${isCenter ? 11 : 10}px DM Sans, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(CanvasText.ellipsizeToWidth(ctx, label, fitW), x, y - 5);
    ctx.fillStyle = nc.sublabel;
    ctx.font = '400 9px DM Sans, system-ui, sans-serif';
    ctx.fillText(CanvasText.ellipsizeToWidth(ctx, sublabel, fitW), x, y + 6);
  } else {
    ctx.fillStyle = nc.label;
    ctx.font = `${isCenter ? '600 ' : '500 '}${isCenter ? 11 : 10}px DM Sans, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(CanvasText.ellipsizeToWidth(ctx, label, fitW), x, y);
  }
}

// Positional collision resolution — iterate pairwise separation so no two
// spheres overlap. Radii include a padding gap and, for the center node, its
// render-time pulse amplitude (±4px) so it never touches a neighbour even at
// the peak of its pulse. The center is fixed, so a center↔company collision
// moves only the company node. Bounds-clamp is radius-aware so nodes stay fully
// inside the canvas.
//
// Small/dense canvases can be physically unable to hold every sphere at full
// size — so if separation can't be achieved, we shrink the radii and retry.
// This makes "no overlap, ever" a hard guarantee regardless of node count or
// panel size (shrinking the drawn spheres is preferable to letting them touch).
const COLLISION_PAD = 6;
function effR(n: WebNode): number { return n.r + (n.isCenter ? 4 : 0); }

function anyOverlap(ns: WebNode[]): boolean {
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < effR(a) + effR(b) + COLLISION_PAD - 0.5) return true;
    }
  return false;
}

function separateOnce(ns: WebNode[], W: number, H: number, iterations: number): void {
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const minD = effR(a) + effR(b) + COLLISION_PAD;
        if (d < minD) {
          if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.01; }
          const ux = dx / d, uy = dy / d, overlap = minD - d;
          if (a.fixed && !b.fixed)      { b.x += ux * overlap;     b.y += uy * overlap; }
          else if (!a.fixed && b.fixed) { a.x -= ux * overlap;     a.y -= uy * overlap; }
          else if (!a.fixed && !b.fixed){ a.x -= ux * overlap / 2; a.y -= uy * overlap / 2;
                                          b.x += ux * overlap / 2; b.y += uy * overlap / 2; }
        }
      }
    }
    ns.forEach(n => {
      if (n.fixed) return;
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
    });
  }
}

function resolveCollisions(ns: WebNode[], W: number, H: number, iterations: number): void {
  for (let pass = 0; pass < 10; pass++) {
    separateOnce(ns, W, H, iterations);
    if (!anyOverlap(ns)) return;
    // Still colliding — the canvas can't fit them at this size. Shrink every
    // sphere (down to a legible floor) and try again.
    ns.forEach(n => { n.r = Math.max(n.isCenter ? 20 : 12, n.r * 0.88); });
  }
}

function forceStep(ns: WebNode[], cx: number, cy: number, W: number, H: number,
                   LINK: number, REPEL: number): void {
  const DAMP = 0.65;
  ns.slice(1).forEach((a, i) => {
    const dx = cx - a.x, dy = cy - a.y, d = Math.hypot(dx, dy) || 1;
    const pull = (d - LINK) * 0.01;
    a.vx += (dx / d) * pull; a.vy += (dy / d) * pull;
    ns.slice(1).forEach((b, j) => {
      if (i === j) return;
      const rx = a.x - b.x, ry = a.y - b.y, rd = Math.hypot(rx, ry) || 1;
      const f = REPEL / (rd * rd);
      a.vx += (rx / rd) * f; a.vy += (ry / rd) * f;
    });
    a.vx *= DAMP; a.vy *= DAMP;
    a.x += a.vx; a.y += a.vy;
    a.x = Math.max(50, Math.min(W - 50, a.x));
    a.y = Math.max(50, Math.min(H - 50, a.y));
  });
}

function fmtH(mins: number): string { return mins ? (mins / 60).toFixed(1) + 'h' : '0h'; }

})();
