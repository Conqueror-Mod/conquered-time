'use strict';

// Company Web v2 — packed-bubble engine shared by the Companies page (full web)
// and the Dashboard (mini web). Replaces the radial force-graph: at 25+
// companies every force node hit the radius floor and conveyed nothing. Here
// bubble area = share of hours in a selectable window, HARNESSED so the visual
// stays readable at any scale:
//   1) AREA BUDGET — all bubbles together claim at most ~40% of the canvas,
//      each taking its share of hours WITHIN that budget, so any N fits.
//   2) FLOOR & CEILING per bubble — nothing renders below a readable minimum
//      or above ~24% of canvas height. A 5,000h whale is clamped; sizes are
//      ordinal-honest, not proportional (tooltips carry exact numbers).
// Companies with an end date OR zero hours in the selected window fold into a
// single grey Archive satellite (click to expand into packed mini-bubbles).
// Layout is static (greedy spiral packing, largest-center-out) — no physics
// churn, redraw only on state change.
//
// Color = Identity: a stable hue per company (rowid → curated palette, so
// renames don't reshuffle colors), saturation eased by recency — worked
// yesterday reads vivid, 60d+ reads near-grey, archive grey is the end of the
// fade. A per-company `color` override (right-click → Edit Color on the
// Companies page) wins over the hash; the recency fade still applies. When the
// colorblind accessibility mode is on, hues come from a deutan/protan-safe
// palette (blues/oranges/purples — no red-vs-green pairs); identity is also
// always carried by the name label, never by color alone.
//
// Classic script (CSP: script-src 'self', no bundler) — exposes window.BubbleWeb.
// Depends on CanvasText (canvas-text.js) loading first.
(() => {

interface BubbleItem {
  co: Company;
  hours: number;      // minutes/60 within the active window
  lastDays: number;   // days since last worked (Infinity = never)
  r: number;
  x: number; y: number;
  dimmed?: boolean;
}
interface ArchiveInner { co: Company; r: number; x: number; y: number; hours: number; lastDays: number; dimmed?: boolean; }
interface ArchiveNode {
  x: number; y: number; r: number;
  count: number; totalHours: number;
  inner: ArchiveInner[];
}

interface BubbleWebOpts {
  canvas: HTMLCanvasElement;
  wrap: HTMLElement;
  /** #node-tooltip container + its name/hier/detail children. */
  tooltip: { root: HTMLElement; name: HTMLElement; hier: HTMLElement; detail: HTMLElement };
  /** Left-click on a company bubble (main pack or expanded archive). */
  onCompanyClick?: (co: Company, ev: MouseEvent) => void;
  /** Right-click on a company bubble. */
  onCompanyContext?: (co: Company, ev: MouseEvent) => void;
  /** Smaller floor/labels for the dashboard mini web. */
  mini?: boolean;
}

interface BubbleWebController {
  update(companies: Company[], entries: EntrySummary[], range: '30' | '90' | 'all'): void;
  /** null clears dimming; otherwise non-matching bubbles fade. */
  setMatcher(fn: ((co: Company) => boolean) | null): void;
  destroy(): void;
}

// Identity palette — hues tuned to stay distinct on both grounds.
const PALETTE = [187, 262, 43, 12, 152, 210, 322, 88, 280, 335];
// Colorblind-safe variant: avoids red↔green confusable pairs (deutan/protan) —
// blues, oranges/yellows, purples only. Names on bubbles carry identity too.
const PALETTE_CB = [210, 40, 285, 65, 235, 320, 20, 190];

function isLightTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme') || 'memoria';
  return theme === 'memoria' || theme === 'rabanastre';
}
function isColorblind(): boolean {
  const cb = document.documentElement.getAttribute('data-colorblind') || 'off';
  return cb !== 'off';
}

function paletteHue(id: number): number {
  const pal = isColorblind() ? PALETTE_CB : PALETTE;
  return pal[Math.abs(id) % pal.length];
}

/** Parse a #rrggbb override into hue+saturation. */
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

interface HueSpec { h: number; s: number; boost: number; }
function colorFor(co: Company, lastDays: number): HueSpec {
  const t = recencyT(lastDays);
  const ov = co.color ? hexToHS(co.color) : null;
  if (ov) return { h: ov.h, s: Math.max(30, Math.min(85, ov.s)) * (0.55 + 0.45 * t), boost: 0.65 + 0.55 * t };
  return { h: paletteHue(co.id), s: 28 + 44 * t, boost: 0.65 + 0.55 * t };
}

// ── Greedy spiral circle packing (largest first, center-out) ────────────────
function packSpiral<T extends { r: number; x: number; y: number }>(
  items: T[], cx: number, cy: number, W: number, H: number
): void {
  const placed: T[] = [];
  for (const it of items) {
    if (placed.length === 0) { it.x = cx; it.y = cy; placed.push(it); continue; }
    let found = false;
    for (let a = 0; a < Math.PI * 40 && !found; a += 0.22) {
      const d = 8 + a * 7.2;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.72; // slight ellipse: use wide canvas
      if (x - it.r < 14 || x + it.r > W - 14 || y - it.r < 14 || y + it.r > H - 14) continue;
      let ok = true;
      for (const p of placed) { if (Math.hypot(x - p.x, y - p.y) < it.r + p.r + 10) { ok = false; break; } }
      if (ok) { it.x = x; it.y = y; found = true; }
    }
    if (!found) { it.x = cx; it.y = cy; }
    placed.push(it);
  }
}

function attach(opts: BubbleWebOpts): BubbleWebController {
  const { canvas, wrap, tooltip } = opts;
  const ctx = canvas.getContext('2d')!;

  let companies: Company[] = [];
  let entries: EntrySummary[] = [];
  let range: '30' | '90' | 'all' = '90';
  let matcher: ((co: Company) => boolean) | null = null;
  let archiveOpen = false;
  let bubbles: BubbleItem[] = [];
  let archive: ArchiveNode | null = null;

  // ── Model: hours in window + days since last worked, per company ──────────
  function cutoffDate(): string {
    if (range === 'all') return '';
    const d = new Date(Date.now() - Number(range) * 86400000);
    return RowUtils.localDateStr(d);
  }

  function buildModel(): { active: BubbleItem[]; archived: ArchiveInner[] } {
    const cutoff = cutoffDate();
    const today = RowUtils.localDateStr();
    const mins: Record<number, number> = {};
    const last: Record<number, string> = {};
    for (const e of entries) {
      if (!cutoff || e.log_date >= cutoff) mins[e.company_id] = (mins[e.company_id] || 0) + (e.total_mins || 0);
      // Future-dated entries don't count as "worked recently".
      if (e.log_date <= today && (!last[e.company_id] || e.log_date > last[e.company_id])) last[e.company_id] = e.log_date;
    }
    const dayMs = 86400000;
    const active: BubbleItem[] = [];
    const archived: ArchiveInner[] = [];
    for (const co of companies) {
      const hours = (mins[co.id] || 0) / 60;
      const lastDays = last[co.id]
        ? Math.max(0, Math.round((new Date(today + 'T00:00').getTime() - new Date(last[co.id] + 'T00:00').getTime()) / dayMs))
        : Infinity;
      // Idle rule (confirmed 2026-07-11): ended companies AND companies with no
      // work in the selected window fold into the Archive.
      if (co.date_end || hours <= 0) archived.push({ co, r: 0, x: 0, y: 0, hours, lastDays });
      else active.push({ co, hours, lastDays, r: 0, x: 0, y: 0 });
    }
    return { active, archived };
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

    const { active, archived } = buildModel();

    // HARNESSED sizing — see file header.
    const total = active.reduce((s, b) => s + b.hours, 0) || 1;
    const budget = W * H * 0.40;
    const Rmin = opts.mini ? 18 : 24;
    const Rmax = H * 0.24;
    for (const b of active) {
      const area = budget * (b.hours / total);
      b.r = Math.max(Rmin, Math.min(Rmax, Math.sqrt(area / Math.PI)));
    }
    active.sort((a, b) => b.r - a.r);

    // Archive satellite — fixed modest size, packed last so it lands on the rim.
    const items: Array<BubbleItem | ArchiveNode & { isArchive: true }> = active.slice() as any[];
    archive = null;
    if (archived.length > 0) {
      const openR = Math.min(118, H * 0.38, W * 0.3);
      const arch: ArchiveNode & { isArchive: true } = {
        x: 0, y: 0,
        r: archiveOpen ? openR : Math.min(56, H * 0.18),
        count: archived.length,
        totalHours: archived.reduce((s, a) => s + (allTimeHours(a.co.id)), 0),
        inner: [],
        isArchive: true,
      };
      items.push(arch);
      archive = arch;
    }
    packSpiral(items as Array<{ r: number; x: number; y: number }>, W / 2, H / 2, W, H);
    bubbles = active;

    // Packed mini-bubbles inside the archive when open.
    if (archive && archiveOpen) {
      const maxH = Math.max(...archived.map(a => allTimeHours(a.co.id)), 1);
      const inner = archived
        .map(a => ({ ...a, r: Math.max(6, (archive!.r * 0.22) * Math.sqrt(allTimeHours(a.co.id) / maxH)) }))
        .sort((a, b) => b.r - a.r);
      const placed: ArchiveInner[] = [];
      for (const it of inner) {
        for (let a = 0; a < Math.PI * 30; a += 0.3) {
          const d = a * 3.4;
          const x = archive.x + Math.cos(a) * d, y = archive.y + Math.sin(a) * d;
          if (Math.hypot(x - archive.x, y - archive.y) + it.r > archive.r - 6) continue;
          if (placed.every(p => Math.hypot(x - p.x, y - p.y) >= it.r + p.r + 2)) {
            it.x = x; it.y = y; placed.push(it); break;
          }
        }
      }
      archive.inner = placed;
    }
    applyDim();
    draw();
  }

  function allTimeHours(companyId: number): number {
    let m = 0;
    for (const e of entries) if (e.company_id === companyId) m += e.total_mins || 0;
    return m / 60;
  }

  function applyDim(): void {
    const fn = matcher;
    for (const b of bubbles) b.dimmed = !!fn && !fn(b.co);
    if (archive) for (const m of archive.inner) m.dimmed = !!fn && !fn(m.co);
  }

  // ── Draw (static — redraw only on state change) ────────────────────────────
  function themeColors() {
    if (isLightTheme()) return {
      grid: 'rgba(0,0,0,0.05)',
      // hours renders INSIDE the colored bubble — on the light theme's solid
      // saturated fills only white carries; the dark theme keeps mock amber.
      label: '#1e2438', hours: 'rgba(255,255,255,0.92)',
      archLabel: '#475569', archSub: '#64748b',
      archFill1: 'rgba(100,116,139,0.16)', archFill2: 'rgba(100,116,139,0.10)', archStroke: '#94a3b8',
      empty: 'rgba(30,36,56,0.45)',
      // Light ground: solid saturated fills dark enough to carry white labels
      // (translucent glows vanish on light backgrounds — same lesson as the
      // old web's light-theme node fix).
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
      label: '#e0e7ff', hours: 'rgba(230,184,78,0.95)',
      archLabel: '#a8c2e0', archSub: '#7e9cc0',
      archFill1: 'rgba(126,156,192,0.30)', archFill2: 'rgba(84,113,154,0.18)', archStroke: '#54719a',
      empty: 'rgba(224,231,255,0.4)',
      fill: (c: HueSpec) => ({
        g1: `hsla(${c.h},${c.s}%,64%,${0.34 * c.boost})`,
        g2: `hsla(${c.h},${c.s}%,42%,${0.26 * c.boost})`,
        rim: 'rgba(0,0,0,0.40)',
        stroke: `hsla(${c.h},${Math.min(80, c.s + 15)}%,62%,${0.55 + 0.45 * c.boost})`,
        text: '#e0e7ff', sub: 'rgba(214,236,248,0.55)',
      }),
    };
  }

  function sphere(x: number, y: number, r: number, dim: boolean, fill: { g1: string; g2: string; rim: string; stroke: string }): void {
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

  function draw(): void {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const tc = themeColors();
    ctx.clearRect(0, 0, W, H);

    // Grid backdrop (carried over from the old web).
    ctx.strokeStyle = tc.grid; ctx.lineWidth = 0.5;
    for (let g = 0; g < W; g += 40) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke(); }
    for (let g = 0; g < H; g += 40) { ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke(); }

    if (companies.length === 0) {
      ctx.fillStyle = tc.empty;
      ctx.font = '12px DM Sans, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No companies yet', W / 2, H / 2);
      return;
    }

    for (const b of bubbles) {
      const fill = tc.fill(colorFor(b.co, b.lastDays));
      sphere(b.x, b.y, b.r, !!b.dimmed, fill);
      ctx.globalAlpha = b.dimmed ? 0.15 : 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const nameSize = Math.max(10, Math.min(15, b.r / 4.2));
      ctx.fillStyle = fill.text;
      ctx.font = `600 ${nameSize}px DM Sans, system-ui, sans-serif`;
      ctx.fillText(CanvasText.ellipsizeToWidth(ctx, b.co.name || '?', b.r * 1.7), b.x, b.y - 2);
      ctx.fillStyle = tc.hours;
      ctx.font = `500 ${Math.max(9, nameSize - 3)}px JetBrains Mono, monospace`;
      ctx.fillText(fmtHours(b.hours), b.x, b.y + nameSize);
      if (b.r > 46 && b.co.work_type) {
        ctx.fillStyle = fill.sub;
        ctx.font = `500 ${Math.max(8, nameSize - 4)}px DM Sans, system-ui, sans-serif`;
        ctx.fillText(CanvasText.ellipsizeToWidth(ctx, b.co.work_type, b.r * 1.6), b.x, b.y + nameSize * 2);
      }
      ctx.globalAlpha = 1;
    }

    if (archive) {
      sphere(archive.x, archive.y, archive.r, false,
        { g1: tc.archFill1, g2: tc.archFill2, rim: 'rgba(0,0,0,0.30)', stroke: tc.archStroke });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (archiveOpen) {
        const archFill = { g1: tc.archFill1, g2: tc.archFill2, rim: 'rgba(0,0,0,0.25)', stroke: tc.archStroke };
        for (const m of archive.inner) sphere(m.x, m.y, m.r, !!m.dimmed, archFill);
        ctx.fillStyle = tc.archLabel;
        ctx.font = '600 11px DM Sans, system-ui, sans-serif';
        ctx.fillText('Archive — click to collapse', archive.x, archive.y - archive.r - 10);
      } else {
        ctx.fillStyle = tc.archLabel;
        ctx.font = '600 12px DM Sans, system-ui, sans-serif';
        ctx.fillText('⊕ Archive', archive.x, archive.y - 4);
        ctx.fillStyle = tc.archSub;
        ctx.font = '500 10px JetBrains Mono, monospace';
        ctx.fillText(archive.count + ' inactive', archive.x, archive.y + 11);
      }
    }
  }

  function fmtHours(h: number): string {
    return (h >= 100 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  // ── Hit testing & interaction ──────────────────────────────────────────────
  type Hit = { kind: 'company'; co: Company; hours: number; lastDays: number }
           | { kind: 'archive' };
  function hitTest(mx: number, my: number): Hit | null {
    // Expanded-archive minis take priority (they sit inside the archive circle).
    if (archive && archiveOpen) {
      for (const m of archive.inner) {
        if (Math.hypot(mx - m.x, my - m.y) < Math.max(m.r, 8)) {
          return { kind: 'company', co: m.co, hours: m.hours, lastDays: m.lastDays };
        }
      }
    }
    if (archive && Math.hypot(mx - archive.x, my - archive.y) < archive.r) return { kind: 'archive' };
    for (const b of bubbles) {
      if (Math.hypot(mx - b.x, my - b.y) < b.r) {
        return { kind: 'company', co: b.co, hours: b.hours, lastDays: b.lastDays };
      }
    }
    return null;
  }

  function mousePos(e: MouseEvent): { mx: number; my: number } {
    const rect = canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  }

  const onMove = (e: MouseEvent): void => {
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (!hit) {
      tooltip.root.style.display = 'none';
      canvas.style.cursor = 'default';
      return;
    }
    const wr = wrap.getBoundingClientRect();
    tooltip.root.style.left = (e.clientX - wr.left + 16) + 'px';
    tooltip.root.style.top = (e.clientY - wr.top - 12) + 'px';
    tooltip.root.style.display = 'block';
    canvas.style.cursor = 'pointer';
    if (hit.kind === 'archive') {
      tooltip.name.textContent = 'Archive';
      tooltip.hier.textContent = '';
      tooltip.detail.textContent = archive!.count + ' inactive ' + (archive!.count === 1 ? 'company' : 'companies')
        + ' · ' + fmtHours(archive!.totalHours) + ' lifetime · click to ' + (archiveOpen ? 'collapse' : 'expand');
      return;
    }
    const co = hit.co;
    tooltip.name.textContent = co.name || '—';
    const hierParts = [co.hier_company, co.hier_project, co.hier_platform].filter(Boolean);
    tooltip.hier.textContent = hierParts.length > 1 ? hierParts.join(' › ') : '';
    const lastTxt = !isFinite(hit.lastDays) ? 'never worked'
      : hit.lastDays === 0 ? 'worked today'
      : `last worked ${hit.lastDays}d ago`;
    tooltip.detail.textContent = [
      co.work_type,
      fmtHours(hit.hours) + (range === 'all' ? ' all-time' : ` in ${range}d`),
      lastTxt,
      co.date_end ? 'ended' : '',
    ].filter(Boolean).join(' · ');
  };

  const onClick = (e: MouseEvent): void => {
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (!hit) return;
    if (hit.kind === 'archive') {
      archiveOpen = !archiveOpen;
      tooltip.root.style.display = 'none';
      layout();
      return;
    }
    opts.onCompanyClick?.(hit.co, e);
  };

  const onContext = (e: MouseEvent): void => {
    if (!opts.onCompanyContext) return;
    const { mx, my } = mousePos(e);
    const hit = hitTest(mx, my);
    if (hit && hit.kind === 'company') {
      e.preventDefault();
      opts.onCompanyContext(hit.co, e);
    }
  };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', onContext);

  const ro = new ResizeObserver(() => layout());
  ro.observe(wrap);

  // Theme / colorblind / a11y switches restyle the bubbles in place.
  const onSettings = (): void => draw();
  window.addEventListener('ct:settings-changed', onSettings);

  return {
    update(cos: Company[], ents: EntrySummary[], r: '30' | '90' | 'all'): void {
      companies = cos; entries = ents; range = r;
      layout();
    },
    setMatcher(fn: ((co: Company) => boolean) | null): void {
      matcher = fn;
      applyDim();
      draw();
    },
    destroy(): void {
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('ct:settings-changed', onSettings);
    },
  };
}

(window as any).BubbleWeb = { attach };

})();
