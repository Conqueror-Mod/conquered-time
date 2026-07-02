'use strict';

// Canvas label fitting for the spiderweb visualizations (defect cluster C4,
// D-003). The old code hard-sliced names to N characters with no ellipsis and
// a fixed node radius; these helpers size the node to the measured label
// (within bounds) and ellipsize anything that still can't fit.
//
// UMD-ish: classic <script> for the renderer (window.CanvasText) AND
// require()-able for the unit tests (which pass a stub ctx).
(function (root) {

  // Trim `text` so it fits maxWidth in the ctx's CURRENT font, appending a
  // real ellipsis when trimmed. Never returns a bare '…' for non-empty input.
  function ellipsizeToWidth(ctx, text, maxWidth) {
    const s = String(text == null ? '' : text);
    if (!s || ctx.measureText(s).width <= maxWidth) return s;
    const ell = '…';
    let lo = 1, hi = s.length - 1, best = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ctx.measureText(s.slice(0, mid) + ell).width <= maxWidth) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return s.slice(0, best) + ell;
  }

  // Node radius that accommodates `text` in `font`: half the measured width
  // plus padding, clamped to [baseR, maxR]. Sets and restores nothing — the
  // caller's font is temporarily switched for measurement.
  function radiusForLabel(ctx, text, font, baseR, maxR, padding) {
    const pad = padding == null ? 10 : padding;
    const prev = ctx.font;
    ctx.font = font;
    const w = ctx.measureText(String(text == null ? '' : text)).width;
    ctx.font = prev;
    return Math.max(baseR, Math.min(maxR, Math.ceil(w / 2) + pad));
  }

  const api = { ellipsizeToWidth, radiusForLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasText = api;
})(this);
