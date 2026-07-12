'use strict';

// Company Galaxy — the packed-bubble company web, v3 (docs/PLAN-company-galaxy.md).
// Shared by the Companies page (full web) and the Dashboard (mini web).
//
// v2 (packed bubbles, PRs #133/#134) flattened every company row into one
// bubble. v3 goes hierarchical using the hierarchy the rows already carry
// (hier_company › hier_project › hier_platform › nav_id):
//
//   GALAXY        = rows grouped by hier_company (hours rolled up)
//   SOLAR SYSTEM  = one company row (Project › Platform)
//   PLANET        = row detail (Platform · Navigator ID · login)
//
// Interaction (left-click = navigation; context menus live on right-click):
//   L0  galaxies packed on the canvas; multi-project galaxy click → expands
//       IN PLACE into its systems (pin + relax, neighbours slide aside —
//       never a full repack, so bubbles keep their homes). Single-project
//       galaxy click → onOpenTracker (exactly the old behavior).
//   L0→L1  click a system inside an expanded galaxy → ZOOM: that galaxy
//       becomes the canvas (≈200 ms tween, reduced-motion gated); breadcrumb
//       "← All Galaxies › X" backs out.
//   L1  click a system → its planets fan out inside; click again collapses.
//   Vaults with exactly one multi-project galaxy skip L0 entirely.
//   mini (dashboard): galaxies only, no drill — multi-project click →
//       onGalaxyNavigate (Companies page pre-zoomed), single → onOpenTracker.
//
// HARNESSED sizing at every level (same rules as v2): the pack claims ≤~40%
// of its container, per-bubble floor + ceiling — a 5,000h whale project can't
// drown its siblings any more than a whale client can. Sizes stay
// ordinal-honest; tooltips carry exact numbers.
//
// Identity color lives at GALAXY level: stable hue from the group's minimum
// rowid (rename-proof), saturation eased by recency, colorblind-safe palette
// when the a11y mode is on. Systems inherit stepped shades of the parent hue
// (the "Identity path"). A user override (`color` on the rows — a galaxy
// Edit Color writes the same value to every row of the group) wins over the
// hash; the recency fade still applies.
//
// Ended (`date_end` on every row) or window-idle galaxies fold into the grey
// Archive satellite at L0 (click to expand/collapse, as in v2).
//
// Classic script (CSP: script-src 'self') — exposes window.BubbleWeb.
// Depends on CanvasText and RowUtils loading first.
(() => {

interface SystemModel {
  co: Company;
  hours: number;      // hours (not minutes) within the active window
  lastDays: number;   // days since last worked (Infinity = never)
}
interface GalaxyModel {
  key: string;
  name: string;
  rows: Company[];
  systems: SystemModel[];
  hours: number;
  lastDays: number;
  archived: boolean;
}
interface Node {
  kind: 'galaxy' | 'system' | 'planet' | 'archive' | 'arch-galaxy';
  x: number; y: number; r: number;
  pinned?: boolean;
  dimmed?: boolean;
  gal?: GalaxyModel;
  sys?: SystemModel;
  sysIdx?: number;
  planetLabel?: string;   // planet value text
  planetClass?: string;   // planet category ("Platform" / "Navigator ID" / "Login")
  kids?: Node[];
}

interface BubbleWebOpts {
  canvas: HTMLCanvasElement;
  wrap: HTMLElement;
  tooltip: { root: HTMLElement; name: HTMLElement; hier: HTMLElement; detail: HTMLElement };
  /** "← All Galaxies › X" chip; engine toggles visibility and binds click. */
  breadcrumb?: { root: HTMLElement; name: HTMLElement };
  /** Dashboard variant: galaxies only, no drill. */
  mini?: boolean;
  /** Single-project galaxy clicked (or ctx "Open Tracker"). */
  onOpenTracker?: (co: Company) => void;
  /** mini only — multi-project galaxy clicked: navigate to the full web pre-zoomed. */
  onGalaxyNavigate?: (galaxy: { key: string; name: string; rows: Company[] }) => void;
  /** Right-click a galaxy bubble (L0). */
  onGalaxyContext?: (galaxy: { key: string; name: string; rows: Company[] }, ev: MouseEvent) => void;
  /** Right-click a system bubble (expanded L0 kid or L1). */
  onSystemContext?: (co: Company, ev: MouseEvent) => void;
}

// Identity palettes (v2) — hues tuned for both grounds; the CB variant avoids
// red↔green confusable pairs (deutan/protan). Names always carry identity too.
const PALETTE = [187, 262, 43, 12, 152, 210, 322, 88, 280, 335];
const PALETTE_CB = [210, 40, 285, 65, 235, 320, 20, 190];

function isLightTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme') || 'memoria';
  return theme === 'memoria' || theme === 'rabanastre';
}
function isColorblind(): boolean {
  return (document.documentElement.getAttribute('data-colorblind') || 'off') !== 'off';
}
function reducedMotion(): boolean {
  return document.documentElement.getAttribute('data-reduced-motion') === 'true';
}
function paletteHue(id: number): number {
  const pal = isColorblind() ? PALETTE_CB : PALETTE;
  return pal[Math.abs(id) % pal.length];
}
function hexToHS(hex: string): { h: number; s: number } | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2, sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: Math.round(sat * 100) };
}
/** 1 = worked today → 0 = 60d+ idle; drives the saturation fade. */
function recencyT(lastDays: number): number {
  if (!isFinite(lastDays)) return 0;
  return Math.max(0, Math.min(1, 1 - lastDays / 60));
}

// Minimal structural shape for identity-color computation — GalaxyModel
// satisfies it, and outside consumers (the Dashboard week band) can build one
// from a plain row group without the full model. Exposed via the BubbleWeb
// export so the band and the web can never drift on what a company's color is.
interface IdentityGroup { rows: Array<{ id: number; color?: string }>; lastDays: number; }

interface HueSpec { h: number; s: number; boost: number; }
function galaxyHue(g: IdentityGroup): HueSpec {
  const t = recencyT(g.lastDays);
  const ovRow = g.rows.find(r => r.color);
  const ov = ovRow?.color ? hexToHS(ovRow.color) : null;
  if (ov) return { h: ov.h, s: Math.max(30, Math.min(85, ov.s)) * (0.55 + 0.45 * t), boost: 0.65 + 0.55 * t };
  const minId = Math.min(...g.rows.map(r => r.id));
  return { h: paletteHue(minId), s: 28 + 44 * t, boost: 0.65 + 0.55 * t };
}

// The galaxy grouping key — rows sharing it form one identity family. Module
// scope (not attach-local) so identity consumers group exactly like the web.
const groupKey = (co: Company): string => (co.hier_company || co.name || '—').trim() || '—';

// Ready-to-use CSS color for flat UI surfaces (week-band blocks, list dots)
// carrying the same identity as the web's bubbles. The web itself keeps its
// gradient recipes (themeColors) — this is the solid-fill rendition: same hue,
// a legibility floor on saturation (a long-idle company still needs a readable
// block even though its bubble fades toward grey), lightness tuned per ground
// so white block labels pass on light themes too.
function identityCss(g: IdentityGroup): string {
  const spec = galaxyHue(g);
  const s = Math.max(38, Math.round(spec.s));
  const l = isLightTheme() ? 44 : 52;
  return `hsl(${spec.h}, ${s}%, ${l}%)`;
}
// Identity path: systems keep the parent hue, stepped saturation/boost.
function systemHue(g: GalaxyModel, idx: number): HueSpec {
  const c = galaxyHue(g);
  const n = g.systems.length;
  const step = n > 1 ? idx / (n - 1) : 0;
  return { h: c.h, s: Math.max(22, c.s - 8 + step * 16), boost: c.boost * (1.05 - step * 0.35) };
}

// ── Packing (mock-proven) ────────────────────────────────────────────────────
// Spiral first; grid-scan fallback; shrink-and-retry last. Bubbles never
// silently stack — the three mock layout bugs live here as regression rules.
function findSpot(it: Node, placed: Node[], cx: number, cy: number, W: number, H: number): { x: number; y: number } | null {
  for (let a = 0; a < Math.PI * 40; a += 0.22) {
    const d = 8 + a * 7.2;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.72;
    if (x - it.r < 14 || x + it.r > W - 14 || y - it.r < 14 || y + it.r > H - 14) continue;
    if (placed.every(p => Math.hypot(x - p.x, y - p.y) >= it.r + p.r + 10)) return { x, y };
  }
  const cells: Array<{ x: number; y: number; d: number }> = [];
  for (let x = 14 + it.r; x <= W - 14 - it.r; x += 18)
    for (let y = 14 + it.r; y <= H - 14 - it.r; y += 18)
      cells.push({ x, y, d: Math.hypot(x - cx, y - cy) });
  cells.sort((a, b) => a.d - b.d);
  for (const c of cells)
    if (placed.every(p => Math.hypot(c.x - p.x, c.y - p.y) >= it.r + p.r + 8)) return { x: c.x, y: c.y };
  return null;
}
function pack(items: Node[], cx: number, cy: number, W: number, H: number): void {
  const placed: Node[] = [];
  for (const it of items) {
    if (placed.length === 0) { it.x = cx; it.y = cy; placed.push(it); continue; }
    let spot = findSpot(it, placed, cx, cy, W, H);
    while (!spot && it.r > 10) { it.r *= 0.85; spot = findSpot(it, placed, cx, cy, W, H); }
    if (spot) { it.x = spot.x; it.y = spot.y; } else { it.x = cx; it.y = cy; }
    placed.push(it);
  }
}
// Children inside a parent circle — shrink until they fit, never stack.
function packInside(items: Node[], px: number, py: number, pr: number): void {
  const placed: Node[] = [];
  const tryFit = (it: Node): { x: number; y: number } | null => {
    for (let a = 0; a < Math.PI * 30; a += 0.25) {
      const d = a * 3.0, x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
      if (Math.hypot(x - px, y - py) + it.r > pr - 8) continue;
      if (placed.every(p => Math.hypot(x - p.x, y - p.y) >= it.r + p.r + 4)) return { x, y };
    }
    return null;
  };
  for (const it of items) {
    let spot = tryFit(it);
    while (!spot && it.r > 6) { it.r *= 0.85; spot = tryFit(it); }
    if (spot) { it.x = spot.x; it.y = spot.y; } else { it.x = px; it.y = py; }
    placed.push(it);
  }
}
// After an in-place expansion the enlarged (pinned) bubble pushes neighbours
// aside — never a repack, so bubbles keep their homes across clicks.
function separate(items: Node[], W: number, H: number, passes = 140): void {
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const minD = a.r + b.r + 10;
      if (d < minD) {
        if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.01; }
        const ux = dx / d, uy = dy / d, ov = minD - d;
        const wa = a.pinned ? 0 : (b.pinned ? 1 : 0.5), wb = a.pinned ? 1 : (b.pinned ? 0 : 0.5);
        a.x -= ux * ov * wa; a.y -= uy * ov * wa;
        b.x += ux * ov * wb; b.y += uy * ov * wb;
      }
    }
    for (const n of items) {
      if (n.pinned) continue;
      n.x = Math.max(n.r + 14, Math.min(W - n.r - 14, n.x));
      n.y = Math.max(n.r + 14, Math.min(H - n.r - 14, n.y));
    }
  }
}
// Harnessed radii: share of hours within the budget, clamped floor/ceiling.
function harness(items: Array<Node & { hours?: number }>, budget: number, Rmin: number, Rmax: number): void {
  const total = items.reduce((t, i) => t + (i.hours || 0), 0) || 1;
  for (const i of items) i.r = Math.max(Rmin, Math.min(Rmax, Math.sqrt(budget * ((i.hours || 0) / total) / Math.PI)));
  items.sort((a, b) => b.r - a.r);
}

function attach(opts: BubbleWebOpts): BubbleWebController {
  const { canvas, wrap, tooltip } = opts;
  const ctx = canvas.getContext('2d')!;

  let companies: Company[] = [];
  let entries: EntrySummary[] = [];
  let range: '30' | '90' | 'all' = '90';
  let matcher: ((co: Company) => boolean) | null = null;

  let galaxies: GalaxyModel[] = [];
  let level: 0 | 1 = 0;
  let currentKey: string | null = null;    // L1 galaxy key
  let soloMode = false;                    // one-galaxy vault: L0 is skipped
  let openGalaxyKey: string | null = null; // L0 in-place expanded galaxy
  let openSystemIdx: number | null = null; // L1 expanded system
  let archiveOpen = false;
  let nodes: Node[] = [];
  let hoverKey: string | null = null;

  // ── Model ──────────────────────────────────────────────────────────────────
  // (groupKey lives at module scope beside the identity-color helpers.)

  function buildModel(): void {
    const cutoff = range === 'all' ? '' : RowUtils.localDateStr(new Date(Date.now() - Number(range) * 86400000));
    const today = RowUtils.localDateStr();
    const mins: Record<number, number> = {};
    const last: Record<number, string> = {};
    for (const e of entries) {
      if (!cutoff || e.log_date >= cutoff) mins[e.company_id] = (mins[e.company_id] || 0) + (e.total_mins || 0);
      if (e.log_date <= today && (!last[e.company_id] || e.log_date > last[e.company_id])) last[e.company_id] = e.log_date;
    }
    const dayMs = 86400000;
    const byKey = new Map<string, GalaxyModel>();
    for (const co of companies) {
      const key = groupKey(co);
      let g = byKey.get(key);
      if (!g) { g = { key, name: key, rows: [], systems: [], hours: 0, lastDays: Infinity, archived: false }; byKey.set(key, g); }
      const hours = (mins[co.id] || 0) / 60;
      const lastDays = last[co.id]
        ? Math.max(0, Math.round((new Date(today + 'T00:00').getTime() - new Date(last[co.id] + 'T00:00').getTime()) / dayMs))
        : Infinity;
      g.rows.push(co);
      g.systems.push({ co, hours, lastDays });
      g.hours += hours;
      g.lastDays = Math.min(g.lastDays, lastDays);
    }
    galaxies = [...byKey.values()];
    for (const g of galaxies) {
      g.systems.sort((a, b) => b.hours - a.hours);
      // Archive rule: every row ended, or no work in the selected window.
      g.archived = g.rows.every(r => !!r.date_end) || g.hours <= 0;
    }
    // One-galaxy vault (full web only): skip L0, land on its systems.
    const active = galaxies.filter(g => !g.archived);
    soloMode = !opts.mini && active.length === 1 && active[0].systems.length > 1;
    if (soloMode) { level = 1; currentKey = active[0].key; }
    else if (level === 1 && currentKey && !galaxies.some(g => g.key === currentKey)) {
      level = 0; currentKey = null;   // zoomed galaxy no longer exists
    }
  }

  const sysLabel = (s: SystemModel): string =>
    s.co.hier_project || s.co.name || '—';
  const sysSub = (s: SystemModel): string => s.co.hier_platform || '';

  function planetsOf(s: SystemModel): Array<{ cls: string; label: string }> {
    const out: Array<{ cls: string; label: string }> = [];
    if (s.co.hier_platform) out.push({ cls: 'Platform', label: s.co.hier_platform });
    if (s.co.nav_id) out.push({ cls: 'Navigator ID', label: s.co.nav_id });
    if (s.co.platform_login) out.push({ cls: 'Login', label: s.co.platform_login });
    return out;
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  function layout(): void {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    canvas.width = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    nodes = [];
    hoverKey = null;

    if (opts.breadcrumb) {
      const showCrumb = level === 1 && !soloMode;
      opts.breadcrumb.root.style.display = showCrumb ? 'flex' : 'none';
      if (level === 1) opts.breadcrumb.name.textContent = currentKey || '';
    }

    const Rmin = opts.mini ? 18 : 24;

    if (level === 0) {
      const active = galaxies.filter(g => !g.archived);
      const archived = galaxies.filter(g => g.archived);
      const items: Node[] = active.map(g => ({ kind: 'galaxy' as const, gal: g, hours: g.hours, x: 0, y: 0, r: 0 }));
      harness(items as any, W * H * 0.40, Rmin + 6, H * 0.26);
      if (archived.length > 0) items.push({ kind: 'archive', x: 0, y: 0, r: Math.min(52, H * 0.18) });
      // Deterministic base layout, then in-place expansion (pin + relax).
      pack(items, W / 2, H / 2, W, H);
      let expanded = false;
      for (const it of items) {
        if (it.kind === 'galaxy' && !opts.mini && openGalaxyKey === it.gal!.key && it.gal!.systems.length > 1) {
          it.r = Math.max(it.r, Math.min(150, H * 0.30, W * 0.20)); it.pinned = true; expanded = true;
        }
        if (it.kind === 'archive' && archiveOpen) {
          it.r = Math.min(110, H * 0.30, W * 0.20); it.pinned = true; expanded = true;
        }
      }
      if (expanded) separate(items, W, H);
      nodes = items;
      for (const it of items) {
        if (it.kind === 'galaxy' && !opts.mini && openGalaxyKey === it.gal!.key && it.gal!.systems.length > 1) {
          const kids: Node[] = it.gal!.systems.map((s, i) => ({
            kind: 'system' as const, gal: it.gal, sys: s, sysIdx: i, hours: s.hours, x: 0, y: 0, r: 0,
          }));
          harness(kids as any, Math.PI * it.r * it.r * 0.52, 13, it.r * 0.46);
          packInside(kids, it.x, it.y, it.r);
          it.kids = kids;
        }
        if (it.kind === 'archive' && archiveOpen && archived.length > 0) {
          const maxH = Math.max(...archived.map(g => g.hours), ...archived.map(() => 0.001), 0.001);
          const totals = archived.map(g => allTimeHours(g));
          const maxT = Math.max(...totals, 0.001);
          const kids: Node[] = archived
            .map((g, i) => ({ kind: 'arch-galaxy' as const, gal: g, x: 0, y: 0, r: Math.max(6, it.r * 0.24 * Math.sqrt(totals[i] / maxT)) }))
            .sort((a, b) => b.r - a.r);
          void maxH;
          packInside(kids, it.x, it.y, it.r);
          it.kids = kids;
        }
      }
    } else {
      const g = galaxies.find(x => x.key === currentKey);
      if (!g) { level = 0; layout(); return; }
      const items: Node[] = g.systems.map((s, i) => ({
        kind: 'system' as const, gal: g, sys: s, sysIdx: i, hours: s.hours, x: 0, y: 0, r: 0,
      }));
      harness(items as any, W * H * 0.40, Rmin + 10, H * 0.26);
      pack(items, W / 2, H / 2, W, H);
      let expanded = false;
      for (const it of items) {
        if (openSystemIdx === it.sysIdx && planetsOf(it.sys!).length > 0) {
          it.r = Math.max(it.r, Math.min(130, H * 0.26, W * 0.20)); it.pinned = true; expanded = true;
        }
      }
      if (expanded) separate(items, W, H);
      nodes = items;
      for (const it of items) {
        if (openSystemIdx === it.sysIdx) {
          const pls = planetsOf(it.sys!);
          if (pls.length === 0) continue;
          const kids: Node[] = pls.map(p => ({
            kind: 'planet' as const, planetClass: p.cls, planetLabel: p.label,
            x: 0, y: 0, r: Math.max(16, it.r * 0.26),
          }));
          packInside(kids, it.x, it.y, it.r);
          it.kids = kids;
        }
      }
    }
    applyDim();
    draw();
  }

  function allTimeHours(g: GalaxyModel): number {
    let m = 0;
    const ids = new Set(g.rows.map(r => r.id));
    for (const e of entries) if (ids.has(e.company_id)) m += e.total_mins || 0;
    return m / 60;
  }

  function applyDim(): void {
    const fn = matcher;
    for (const n of nodes) {
      if (n.kind === 'galaxy' || n.kind === 'arch-galaxy') n.dimmed = !!fn && !n.gal!.rows.some(fn);
      if (n.kind === 'system') n.dimmed = !!fn && !fn(n.sys!.co);
      if (n.kids) for (const k of n.kids) {
        if (k.kind === 'system') k.dimmed = !!fn && !fn(k.sys!.co);
        if (k.kind === 'arch-galaxy') k.dimmed = !!fn && !k.gal!.rows.some(fn);
      }
    }
  }

  // ── Theme-aware drawing (v2 fills) ─────────────────────────────────────────
  function themeColors() {
    if (isLightTheme()) return {
      grid: 'rgba(0,0,0,0.05)',
      hours: 'rgba(255,255,255,0.92)',   // renders INSIDE the solid light-theme fills
      archLabel: '#475569', archSub: '#64748b',
      archFill1: 'rgba(100,116,139,0.16)', archFill2: 'rgba(100,116,139,0.10)', archStroke: '#94a3b8',
      empty: 'rgba(30,36,56,0.45)', caption: '#475569',
      fill: (c: HueSpec) => ({
        g1: `hsla(${c.h},${Math.min(80, c.s + 18)}%,52%,${0.88 * c.boost + 0.1})`,
        g2: `hsla(${c.h},${Math.min(80, c.s + 12)}%,38%,${0.85 * c.boost + 0.1})`,
        rim: `hsla(${c.h},${c.s}%,24%,0.5)`,
        stroke: `hsla(${c.h},${Math.min(85, c.s + 20)}%,34%,${0.6 + 0.4 * c.boost})`,
        text: '#ffffff', sub: 'rgba(255,255,255,0.72)',
      }),
    };
    return {
      grid: 'rgba(255,255,255,0.025)',
      hours: 'rgba(230,184,78,0.95)',
      archLabel: '#a8c2e0', archSub: '#7e9cc0',
      archFill1: 'rgba(126,156,192,0.30)', archFill2: 'rgba(84,113,154,0.18)', archStroke: '#54719a',
      empty: 'rgba(224,231,255,0.4)', caption: '#a8c2e0',
      fill: (c: HueSpec) => ({
        g1: `hsla(${c.h},${c.s}%,64%,${0.34 * c.boost})`,
        g2: `hsla(${c.h},${c.s}%,42%,${0.26 * c.boost})`,
        rim: 'rgba(0,0,0,0.40)',
        stroke: `hsla(${c.h},${Math.min(80, c.s + 15)}%,62%,${0.55 + 0.45 * c.boost})`,
        text: '#e0e7ff', sub: 'rgba(214,236,248,0.55)',
      }),
    };
  }

  function sphere(x: number, y: number, r: number, dim: boolean,
                  fill: { g1: string; g2: string; rim: string; stroke: string }): void {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, fill.g1); g.addColorStop(0.6, fill.g2); g.addColorStop(1, fill.rim);
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = fill.stroke; ctx.lineWidth = 1.5; ctx.stroke();
    const hl = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x - r * 0.35, y - r * 0.35, r * 0.6);
    hl.addColorStop(0, 'rgba(255,255,255,0.14)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = hl; ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Caption above the bubble, or below when clamped against the top edge.
  const capY = (n: Node): number => {
    const above = n.y - n.r - 12;
    return above >= 14 ? above : n.y + n.r + 14;
  };

  function fmtHours(h: number): string {
    return (h >= 100 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  function draw(): void {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const tc = themeColors();
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = tc.grid; ctx.lineWidth = 0.5;
    for (let g = 0; g < W; g += 40) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke(); }
    for (let g = 0; g < H; g += 40) { ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    if (companies.length === 0) {
      ctx.fillStyle = tc.empty;
      ctx.font = '12px DM Sans, system-ui, sans-serif';
      ctx.fillText('No companies yet', W / 2, H / 2);
      return;
    }

    const archFill = { g1: tc.archFill1, g2: tc.archFill2, rim: 'rgba(0,0,0,0.30)', stroke: tc.archStroke };

    const drawSystemBubble = (n: Node, col: HueSpec): void => {
      const fill = tc.fill(col);
      sphere(n.x, n.y, n.r, !!n.dimmed, fill);
      if (n.kids) return;   // expanded: planets own the interior, caption carries the name
      ctx.globalAlpha = n.dimmed ? 0.15 : 1;
      const nameSize = Math.max(10, Math.min(15, n.r / 4.2));
      ctx.fillStyle = fill.text;
      ctx.font = `600 ${nameSize}px DM Sans, system-ui, sans-serif`;
      ctx.fillText(CanvasText.ellipsizeToWidth(ctx, sysLabel(n.sys!), n.r * 1.7), n.x, n.y - 2);
      ctx.fillStyle = tc.hours;
      ctx.font = `500 ${Math.max(9, nameSize - 3)}px JetBrains Mono, monospace`;
      ctx.fillText(fmtHours(n.sys!.hours), n.x, n.y + nameSize);
      if (n.r > 44 && sysSub(n.sys!)) {
        ctx.fillStyle = fill.sub;
        ctx.font = `500 ${Math.max(8, nameSize - 4)}px DM Sans, system-ui, sans-serif`;
        ctx.fillText(CanvasText.ellipsizeToWidth(ctx, sysSub(n.sys!), n.r * 1.6), n.x, n.y + nameSize * 2);
      }
      ctx.globalAlpha = 1;
    };

    for (const n of nodes) {
      if (n.kind === 'archive') {
        sphere(n.x, n.y, n.r, false, archFill);
        ctx.fillStyle = tc.archLabel;
        if (archiveOpen && n.kids) {
          for (const k of n.kids) sphere(k.x, k.y, k.r, !!k.dimmed, archFill);
          ctx.font = '600 11px DM Sans, system-ui, sans-serif';
          ctx.fillText('Archive — click to collapse', n.x, capY(n));
        } else {
          ctx.font = '600 12px DM Sans, system-ui, sans-serif';
          ctx.fillText('⊕ Archive', n.x, n.y - 4);
          ctx.fillStyle = tc.archSub;
          ctx.font = '500 10px JetBrains Mono, monospace';
          const count = galaxies.filter(g => g.archived).length;
          ctx.fillText(count + ' inactive', n.x, n.y + 11);
        }
        continue;
      }
      if (n.kind === 'galaxy') {
        const col = galaxyHue(n.gal!);
        const open = !!n.kids;
        sphere(n.x, n.y, n.r, !!n.dimmed, tc.fill(col));
        if (open) {
          for (const k of n.kids!) {
            const kcol = systemHue(k.gal!, k.sysIdx!);
            const kfill = tc.fill(kcol);
            sphere(k.x, k.y, k.r, !!k.dimmed, kfill);
            if (k.r > 18) {
              ctx.globalAlpha = k.dimmed ? 0.15 : 1;
              ctx.fillStyle = kfill.text;
              ctx.font = `600 ${Math.max(9, Math.min(12, k.r / 3.4))}px DM Sans, system-ui, sans-serif`;
              ctx.fillText(CanvasText.ellipsizeToWidth(ctx, sysLabel(k.sys!), k.r * 1.7), k.x, k.y);
              ctx.globalAlpha = 1;
            }
          }
          ctx.fillStyle = tc.caption;
          ctx.font = '600 12px DM Sans, system-ui, sans-serif';
          ctx.fillText(CanvasText.ellipsizeToWidth(ctx, n.gal!.name, W * 0.6) + ' — click a project to zoom in', n.x, capY(n));
        } else {
          ctx.globalAlpha = n.dimmed ? 0.15 : 1;
          const fill = tc.fill(col);
          const nameSize = Math.max(10, Math.min(15, n.r / 4.2));
          ctx.fillStyle = fill.text;
          ctx.font = `600 ${nameSize}px DM Sans, system-ui, sans-serif`;
          ctx.fillText(CanvasText.ellipsizeToWidth(ctx, n.gal!.name, n.r * 1.7), n.x, n.y - 2);
          ctx.fillStyle = tc.hours;
          ctx.font = `500 ${Math.max(9, nameSize - 3)}px JetBrains Mono, monospace`;
          ctx.fillText(fmtHours(n.gal!.hours), n.x, n.y + nameSize);
          if (n.r > 44) {
            ctx.fillStyle = fill.sub;
            ctx.font = `500 ${Math.max(8, nameSize - 4)}px DM Sans, system-ui, sans-serif`;
            const np = n.gal!.systems.length;
            ctx.fillText(np === 1 ? '1 project' : np + ' projects', n.x, n.y + nameSize * 2);
          }
          ctx.globalAlpha = 1;
        }
        continue;
      }
      if (n.kind === 'system') {   // L1 full-canvas systems
        const col = systemHue(n.gal!, n.sysIdx!);
        drawSystemBubble(n, col);
        if (n.kids) {
          const fill = tc.fill({ h: col.h, s: col.s * 0.7, boost: col.boost * 0.9 });
          for (const k of n.kids) {
            sphere(k.x, k.y, k.r, false, fill);
            ctx.fillStyle = fill.text;
            ctx.font = `600 ${Math.max(8, Math.min(11, k.r / 2.6))}px JetBrains Mono, monospace`;
            ctx.fillText(CanvasText.ellipsizeToWidth(ctx, k.planetLabel!, k.r * 1.8), k.x, k.y);
          }
          ctx.fillStyle = tc.caption;
          ctx.font = '600 11px DM Sans, system-ui, sans-serif';
          ctx.fillText(CanvasText.ellipsizeToWidth(ctx, sysLabel(n.sys!) + (sysSub(n.sys!) ? ' › ' + sysSub(n.sys!) : ''), W * 0.6)
            + ' — click again to collapse', n.x, capY(n));
        }
      }
    }
  }

  // ── Zoom tween (reduced-motion gated) ──────────────────────────────────────
  function withZoom(zoomIn: boolean, apply: () => void): void {
    if (reducedMotion()) { apply(); return; }
    canvas.style.transition = 'transform 120ms ease-in, opacity 120ms ease-in';
    canvas.style.transform = zoomIn ? 'scale(1.12)' : 'scale(0.9)';
    canvas.style.opacity = '0';
    setTimeout(() => {
      apply();
      canvas.style.transition = 'none';
      canvas.style.transform = zoomIn ? 'scale(0.9)' : 'scale(1.12)';
      // Force style flush so the next transition animates from the reset state.
      void canvas.offsetWidth;
      canvas.style.transition = 'transform 120ms ease-out, opacity 120ms ease-out';
      canvas.style.transform = 'scale(1)';
      canvas.style.opacity = '1';
    }, 125);
  }

  // ── Hit testing & interaction ──────────────────────────────────────────────
  function hitTest(mx: number, my: number): { node: Node; parent: Node | null } | null {
    for (const n of nodes) {
      if (!n.kids) continue;
      for (const k of n.kids) if (Math.hypot(mx - k.x, my - k.y) < Math.max(k.r, 8)) return { node: k, parent: n };
    }
    for (const n of nodes) if (Math.hypot(mx - n.x, my - n.y) < n.r) return { node: n, parent: null };
    return null;
  }
  const mousePos = (e: MouseEvent): { mx: number; my: number } => {
    const r = canvas.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  };

  // Tooltip anchors to the BUBBLE (v2 #134 rule) — repositions only when the
  // hover target changes, never follows the cursor.
  const onMove = (e: MouseEvent): void => {
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (!hit) {
      hoverKey = null;
      tooltip.root.style.display = 'none';
      canvas.style.cursor = 'default';
      return;
    }
    canvas.style.cursor = 'pointer';
    const n = hit.node;
    const key = [n.kind, n.gal?.key ?? '', n.sys?.co.id ?? '', n.planetLabel ?? '', archiveOpen, openGalaxyKey, openSystemIdx, level].join('|');
    if (key === hoverKey) return;
    hoverKey = key;
    const windowTxt = range === 'all' ? ' all-time' : ` in ${range}d`;
    if (n.kind === 'galaxy' || n.kind === 'arch-galaxy') {
      const g = n.gal!;
      tooltip.name.textContent = g.name;
      tooltip.hier.textContent = '';
      const np = g.systems.length;
      const lastTxt = !isFinite(g.lastDays) ? 'never worked' : g.lastDays === 0 ? 'worked today' : `last worked ${g.lastDays}d ago`;
      const action = n.kind === 'arch-galaxy' ? 'inactive'
        : opts.mini ? (np > 1 ? 'click to open in Companies' : 'click → tracker')
        : (np > 1 ? 'click to open' : 'click → tracker');
      tooltip.detail.textContent = [`${np} ${np === 1 ? 'project' : 'projects'}`, fmtHours(g.hours) + windowTxt, lastTxt, action]
        .filter(Boolean).join(' · ');
    } else if (n.kind === 'system') {
      const s = n.sys!;
      tooltip.name.textContent = sysLabel(s);
      const trail = [s.co.hier_company, s.co.hier_project, s.co.hier_platform].filter(Boolean);
      tooltip.hier.textContent = trail.length > 1 ? trail.join(' › ') : '';
      const lastTxt = !isFinite(s.lastDays) ? 'never worked' : s.lastDays === 0 ? 'worked today' : `last worked ${s.lastDays}d ago`;
      tooltip.detail.textContent = [
        s.co.work_type, fmtHours(s.hours) + windowTxt, lastTxt,
        s.co.date_end ? 'ended' : '',
        level === 0 ? 'click to zoom in' : (planetsOf(s).length ? 'click for detail' : ''),
      ].filter(Boolean).join(' · ');
    } else if (n.kind === 'planet') {
      tooltip.name.textContent = n.planetClass!;
      tooltip.hier.textContent = '';
      tooltip.detail.textContent = n.planetLabel! + (n.planetClass === 'Navigator ID' ? ' · in-session only, never exported' : '');
    } else {   // archive
      const count = galaxies.filter(g => g.archived).length;
      tooltip.name.textContent = 'Archive';
      tooltip.hier.textContent = '';
      tooltip.detail.textContent = `${count} inactive ${count === 1 ? 'company' : 'companies'} · click to ${archiveOpen ? 'collapse' : 'expand'}`;
    }
    tooltip.root.style.display = 'block';
    const pad = 8;
    const tw = tooltip.root.offsetWidth || 200, th = tooltip.root.offsetHeight || 60;
    let tx = n.x + n.r * 0.72, ty = n.y - n.r * 0.72 - th;
    tx = Math.max(pad, Math.min(tx, wrap.clientWidth - tw - pad));
    ty = Math.max(pad, Math.min(ty, wrap.clientHeight - th - pad));
    tooltip.root.style.left = tx + 'px';
    tooltip.root.style.top = ty + 'px';
  };

  const onClick = (e: MouseEvent): void => {
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (!hit) return;
    const n = hit.node;
    tooltip.root.style.display = 'none';
    if (n.kind === 'archive') { archiveOpen = !archiveOpen; layout(); return; }
    if (n.kind === 'arch-galaxy') {
      // Inactive galaxy: single row → tracker; multi → zoom in read-only.
      if (n.gal!.systems.length === 1) opts.onOpenTracker?.(n.gal!.rows[0]);
      else if (!opts.mini) { currentKey = n.gal!.key; openSystemIdx = null; withZoom(true, () => { level = 1; layout(); }); }
      return;
    }
    if (n.kind === 'galaxy') {
      const g = n.gal!;
      if (g.systems.length === 1) { opts.onOpenTracker?.(g.rows[0]); return; }
      if (opts.mini) { opts.onGalaxyNavigate?.({ key: g.key, name: g.name, rows: g.rows }); return; }
      openGalaxyKey = openGalaxyKey === g.key ? null : g.key;
      layout();
      return;
    }
    if (n.kind === 'system') {
      if (level === 0) {   // system inside an expanded L0 galaxy → zoom
        currentKey = n.gal!.key;
        openGalaxyKey = null;
        openSystemIdx = null;
        withZoom(true, () => { level = 1; layout(); });
        return;
      }
      openSystemIdx = openSystemIdx === n.sysIdx ? null : (planetsOf(n.sys!).length ? n.sysIdx! : null);
      layout();
      return;
    }
    // planets: informational only
  };

  const onContext = (e: MouseEvent): void => {
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (!hit) return;
    const n = hit.node;
    if ((n.kind === 'galaxy' || n.kind === 'arch-galaxy') && opts.onGalaxyContext) {
      e.preventDefault();
      opts.onGalaxyContext({ key: n.gal!.key, name: n.gal!.name, rows: n.gal!.rows }, e);
    } else if (n.kind === 'system' && opts.onSystemContext) {
      e.preventDefault();
      opts.onSystemContext(n.sys!.co, e);
    }
  };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', onContext);
  const crumbClick = (): void => {
    if (level === 1 && !soloMode) { openSystemIdx = null; withZoom(false, () => { level = 0; currentKey = null; layout(); }); }
  };
  opts.breadcrumb?.root.addEventListener('click', crumbClick);

  const ro = new ResizeObserver(() => layout());
  ro.observe(wrap);
  const onSettings = (): void => draw();
  window.addEventListener('ct:settings-changed', onSettings);

  return {
    update(cos: Company[], ents: EntrySummary[], r: '30' | '90' | 'all'): void {
      companies = cos; entries = ents; range = r;
      buildModel();
      layout();
    },
    setMatcher(fn: ((co: Company) => boolean) | null): void {
      matcher = fn;
      applyDim();
      draw();
    },
    redraw(): void { draw(); },
    /** Jump straight into a galaxy (dashboard → Companies pre-zoom handoff). */
    zoomTo(key: string): void {
      const g = galaxies.find(x => x.key === key);
      if (!g || g.systems.length < 2) return;
      currentKey = key;
      openGalaxyKey = null;
      openSystemIdx = null;
      withZoom(true, () => { level = 1; layout(); });
    },
    destroy(): void {
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContext);
      opts.breadcrumb?.root.removeEventListener('click', crumbClick);
      window.removeEventListener('ct:settings-changed', onSettings);
    },
  };
}

(window as any).BubbleWeb = { attach, groupKey, identityHue: galaxyHue, identityCss };

})();
