'use strict';

// Dashboard page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, escapeHtml) — must load after ../components/shell.js.
//
// IIFE-wrapped (Phase 3 pattern): tsc compiles all renderer pages in one
// project as classic scripts sharing a global scope, so page-local helpers
// (getCanvasColors, drawSphereNode, ...) must not leak as globals.
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

let companies: Company[] = [], allEntries: EntrySummary[] = [];
let nodes: WebNode[] = [];
let miniAnimFrame: number | null = null;
let miniResizeObserver: ResizeObserver | null = null;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('dashboard');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'hidden'; }

  // Backup Now — page-specific action (the nav buttons use the shell's
  // delegated data-action="navigate" handler instead).
  document.getElementById('btn-backup-now')?.addEventListener('click', () => {
    api.invoke('settings:set', { key: 'backup_trigger', value: Date.now().toString() })
      .then(() => Shell.toast('Backup saved', 'success'));
  });

  await loadData();
  drawMiniWeb();
});

async function loadData(): Promise<void> {
  companies  = await Store.getCompanies();
  allEntries = await Store.getEntriesSummary();

  // LOCAL dates — toISOString is UTC and bucketed evening hours into tomorrow.
  const today   = RowUtils.localDateStr();
  const weekAgo = RowUtils.localDateStr(new Date(Date.now() - 7*86400000));

  const todayMins   = allEntries.filter(e => e.log_date === today).reduce((a,e) => a+e.total_mins, 0);
  const weekMins    = allEntries.filter(e => e.log_date >= weekAgo).reduce((a,e) => a+e.total_mins, 0);
  const allTimeMins = allEntries.reduce((a,e) => a+e.total_mins, 0);

  document.getElementById('stat-today')!.textContent     = fmtH(todayMins);
  document.getElementById('stat-week')!.textContent      = fmtH(weekMins);
  document.getElementById('stat-alltime')!.textContent   = fmtH(allTimeMins);
  document.getElementById('stat-companies')!.textContent = String(companies.length);

  const compMap: Record<number, string> = {};
  companies.forEach(c => compMap[c.id] = c.name || '—');

  // C6 (D-009): future-dated entries don't belong in "Recent Activity" —
  // they'd headline the list indefinitely. They stay visible (badged) in the
  // Global Log instead.
  const recent = allEntries.filter(e => e.log_date <= today)
    .sort((a,b) => b.log_date.localeCompare(a.log_date)).slice(0, 8);
  const list   = document.getElementById('activity-list');
  if (recent.length === 0 || !list) return;

  list.innerHTML = recent.map(e => `
    <div class="activity-row">
      <div class="activity-company">${escapeHtml(compMap[e.company_id]) || '—'}</div>
      <div class="activity-date">${escapeHtml(e.log_date)}${e.session_label ? ' · ' + escapeHtml(e.session_label) : ''}</div>
      <div class="activity-hours">${fmtH(e.total_mins)}</div>
    </div>
  `).join('');
}

function fmtH(mins: number): string {
  if (!mins) return '0h';
  return (mins / 60).toFixed(1) + 'h';
}

// Per-company total minutes (from the plaintext summary rows) — feeds the
// per-node hour labels + tooltip, mirroring the Companies page web.
function compMinsMap(): Record<number, number> {
  const m: Record<number, number> = {};
  allEntries.forEach(e => { m[e.company_id] = (m[e.company_id] || 0) + (e.total_mins || 0); });
  return m;
}

// Full-parity port of the Companies-page web (force-simulated layout,
// labels+sublabel rendered inside the spheres, per-node hour labels, hover
// tooltip). Kept behaviourally identical so the two webs read the same; the
// only dashboard-specific bit is the click handler (navigate to that company's
// tracker) instead of the Companies context menu.
function drawMiniWeb(): void {
  const canvas = document.getElementById('web-canvas') as HTMLCanvasElement | null;
  const wrap   = document.getElementById('web-canvas-wrap');
  if (!canvas || !wrap) return;
  const ctx = canvas.getContext('2d')!;

  if (miniAnimFrame) cancelAnimationFrame(miniAnimFrame);
  if (miniResizeObserver) miniResizeObserver.disconnect();

  const mins = compMinsMap();

  function initNodes(W: number, H: number): WebNode[] {
    const cx = W / 2, cy = H / 2;
    const count = companies.length;

    const nodeR    = count === 0 ? 28 : Math.max(16, Math.round(32 - count * 1.2));
    const ringFrac = count <= 1  ? 0.36 : count <= 3 ? 0.38 : count <= 6 ? 0.43 : 0.47;
    const LINK     = count <= 1  ? 270  : count <= 3 ? 240  : count <= 6 ? 245  : 275;
    const REPEL    = count <= 1  ? 500  : count <= 3 ? 3500 : count <= 6 ? 6500 : 9500;
    const steps    = count <= 2  ? 60   : count <= 5 ? 160  : 260;

    const ns: WebNode[] = [{
      x: cx, y: cy, vx: 0, vy: 0, r: 36,
      label: (window.__currentUsername || 'YOU'), sublabel: '',
      isCenter: true, co: null, fixed: true,
    }];
    const mctx = canvas!.getContext('2d')!;
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
    const W = wrap!.clientWidth, H = wrap!.clientHeight;
    if (!W || !H) return;
    canvas!.width  = W * devicePixelRatio;
    canvas!.height = H * devicePixelRatio;
    canvas!.style.width  = W + 'px';
    canvas!.style.height = H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    nodes = initNodes(W, H);
  }
  resizeCanvas();

  miniResizeObserver = new ResizeObserver(() => {
    if (miniAnimFrame) cancelAnimationFrame(miniAnimFrame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resizeCanvas();
    startRender();
  });
  miniResizeObserver.observe(wrap);
  startRender();

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const tt = document.getElementById('node-tooltip');
    if (!tt) return;
    let hit = false;
    nodes.slice(1).forEach(n => {
      if (Math.hypot(mx - n.x, my - n.y) < n.r + 10) {
        const wr = wrap.getBoundingClientRect();
        tt.style.left = (e.clientX - wr.left + 16) + 'px';
        tt.style.top  = (e.clientY - wr.top  - 12) + 'px';
        tt.style.display = 'block';
        document.getElementById('tt-name')!.textContent = n.co!.name;
        const hierParts = [n.co!.hier_company, n.co!.hier_project, n.co!.hier_platform].filter(Boolean);
        document.getElementById('tt-hier')!.textContent   = hierParts.length > 1 ? hierParts.join(' › ') : '';
        document.getElementById('tt-detail')!.textContent = [
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
        sessionStorage.setItem('active_company', JSON.stringify(n.co));
        api.send('navigate', 'tracker');
      }
    });
  });
}

function startRender(): void {
  const canvas = document.getElementById('web-canvas') as HTMLCanvasElement | null;
  const wrap   = document.getElementById('web-canvas-wrap');
  if (!canvas || !wrap) return;
  const ctx = canvas.getContext('2d')!;
  let pulse = 0;

  function render(): void {
    const W = wrap!.clientWidth, H = wrap!.clientHeight;
    if (!W || !H) { miniAnimFrame = requestAnimationFrame(render); return; }
    const cx = W / 2, cy = H / 2;
    const c = getCanvasColors();
    if (nodes[0]) { nodes[0].x = cx; nodes[0].y = cy; }
    pulse += 0.025;
    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = c.grid; ctx.lineWidth = 0.5;
    for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    // Empty state — pulsing center only + a hint
    if (companies.length === 0) {
      const pR = 28 + 4 * Math.sin(pulse);
      drawSphereNode(ctx, cx, cy, pR, true, (window.__currentUsername || 'YOU'), '');
      ctx.fillStyle = c.node.label;
      ctx.globalAlpha = 0.4;
      ctx.font = '12px DM Sans, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('No companies yet', cx, cy + 44);
      ctx.globalAlpha = 1;
      miniAnimFrame = requestAnimationFrame(render);
      return;
    }

    // Edges
    nodes.slice(1).forEach(n => {
      const grad = ctx.createLinearGradient(cx, cy, n.x, n.y);
      grad.addColorStop(0, c.edge1); grad.addColorStop(1, c.edge2);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(n.x, n.y);
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.stroke();
    });

    // Company nodes — label + sublabel inside; hours below
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

    miniAnimFrame = requestAnimationFrame(render);
  }
  miniAnimFrame = requestAnimationFrame(render);
}

function getCanvasColors(): WebColors {
  const theme = document.documentElement.getAttribute('data-theme') || 'memoria';
  const isLight = theme === 'memoria' || theme === 'rabanastre';
  if (isLight) return {
    center: { g1: 'rgba(30,58,138,0.95)', g2: 'rgba(15,23,80,0.9)', border: '#1d4ed8', label: '#ffffff', sublabel: 'rgba(255,255,255,0.7)', glow: 'rgba(29,78,216,0.18)', rim: 'rgba(8,18,70,1)' },
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

})();
