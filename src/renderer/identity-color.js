'use strict';

// Company identity color — the single source of truth for "what color is this
// company?" across every surface: galaxy bubbles, week-band blocks, list dots,
// Insights donuts, and the emailed report.
//
// Extracted from bubble-web.ts (v3.25) so the MAIN process can require it too
// (the emailed report colors its bars/dots with the same identities the app
// shows). Pure + UMD like row-utils.js: no DOM — environment facts the renderer
// used to read off <html> attributes (light theme, colorblind palette, today's
// date) are passed as an `opts` argument instead. bubble-web.ts delegates here,
// so the app and the report can never drift.
//
// opts (all optional): { lightTheme: boolean, colorblind: boolean, today: 'YYYY-MM-DD' }
(function (root) {

  const RU = (typeof module !== 'undefined' && module.exports)
    ? require('./row-utils.js')
    : root.RowUtils;

  // Curated identity hues (deutan/protan-safe alternate). Order matters — a
  // company's hue is pal[minRowid % len]; reordering recolors every vault.
  const PALETTE = [187, 262, 43, 12, 152, 210, 322, 88, 280, 335];
  const PALETTE_CB = [210, 40, 285, 65, 235, 320, 20, 190];

  function paletteHue(id, colorblind) {
    const pal = colorblind ? PALETTE_CB : PALETTE;
    // Non-finite ids (undefined/NaN from a malformed row) would index pal[NaN]
    // → hue undefined → `hsl(undefined, …)` — an invalid color the browser
    // silently drops. Pin them to slot 0 instead (D-305, Crucible III).
    const n = Number(id);
    return pal[Number.isFinite(n) ? Math.abs(Math.round(n)) % pal.length : 0];
  }

  function hexToHS(hex) {
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
  function recencyT(lastDays) {
    if (!isFinite(lastDays)) return 0;
    return Math.max(0, Math.min(1, 1 - lastDays / 60));
  }

  // g: { rows: [{ id, color? }], lastDays } — a manual Edit Color override on
  // any row wins; otherwise the min-rowid hash into the curated palette.
  function galaxyHue(g, opts) {
    const t = recencyT(g.lastDays);
    // When several rows carry (different) manual overrides, pick by min rowid —
    // the same anchor the palette hash uses — so the winning color is a fact of
    // the data, not of whatever order this surface iterated rows (D-304).
    const ovRow = g.rows.filter((r) => r.color)
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))[0];
    const ov = ovRow && ovRow.color ? hexToHS(ovRow.color) : null;
    if (ov) return { h: ov.h, s: Math.max(30, Math.min(85, ov.s)) * (0.55 + 0.45 * t), boost: 0.65 + 0.55 * t };
    const minId = Math.min(...g.rows.map((r) => r.id));
    return { h: paletteHue(minId, !!(opts && opts.colorblind)), s: 28 + 44 * t, boost: 0.65 + 0.55 * t };
  }

  // The galaxy grouping key — rows sharing it form one identity family.
  const groupKey = (co) => (co.hier_company || co.name || '—').trim() || '—';

  // Solid-fill CSS rendition of the identity (dots, blocks, report bars): same
  // hue, saturation floor for legibility, lightness tuned per ground.
  function identityCss(g, opts) {
    const spec = galaxyHue(g, opts);
    const s = Math.max(38, Math.round(spec.s));
    const l = (opts && opts.lightTheme) ? 44 : 52;
    return `hsl(${spec.h}, ${s}%, ${l}%)`;
  }

  // companyId → identity CSS color lookup. Groups by groupKey, recency from the
  // latest worked log_date. Unknown/deleted companies get `fallback`
  // (default: the renderer's neutral border token).
  function colorMap(companies, entries, opts) {
    const o = opts || {};
    const today = o.today || RU.localDateStr();
    const fallback = o.fallback || 'var(--border-light)';
    const lastByCo = {};
    for (const e of entries) {
      if (e.log_date <= today && (!lastByCo[e.company_id] || e.log_date > lastByCo[e.company_id]))
        lastByCo[e.company_id] = e.log_date;
    }
    const dayMs = 86400000;
    const groups = new Map();
    const coById = {};
    for (const co of companies) {
      coById[co.id] = co;
      const key = groupKey(co);
      let g = groups.get(key);
      if (!g) { g = { rows: [], lastDays: Infinity }; groups.set(key, g); }
      g.rows.push(co);
      const lastDays = lastByCo[co.id]
        ? Math.max(0, Math.round((new Date(today + 'T00:00').getTime() - new Date(lastByCo[co.id] + 'T00:00').getTime()) / dayMs))
        : Infinity;
      g.lastDays = Math.min(g.lastDays, lastDays);
    }
    return {
      colorFor(companyId) {
        const co = coById[companyId];
        const g = co ? groups.get(groupKey(co)) : null;
        return g ? identityCss(g, o) : fallback;
      },
    };
  }

  const api = { PALETTE, PALETTE_CB, paletteHue, hexToHS, recencyT, galaxyHue, groupKey, identityCss, colorMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IdentityColor = api;
})(this);
