'use strict';

// ═════════════════════════════════════════════════════════════════════════════
//  probe-layout.js — The Crucible's layout linter (Measure layer 2d).
//
//  Injected into a live page by the run-app driver (`lint` command). Sweeps the
//  DOM for GEOMETRICALLY PROVABLE layout faults — the mechanically-detectable
//  subclass of "user-observed" visual bugs — and returns a JSON fault list.
//  Deterministic and reproducible, so findings meet the RCA admission standard
//  and are register-grade (unlike screenshot-diff or rubric findings).
//
//  Fault types:
//    clipped-text   — element's own text overflows its box with no ellipsis/scroll
//    collapsed      — visible element with text but ~zero rendered size
//                     (the historical flex-shrink class, gotcha #7)
//    overlap        — two interactive controls materially overlapping
//    offscreen      — visible interactive control outside the document bounds
//    low-contrast   — text below ~2.5:1 WCAG ratio on a solid background
//    invisible-text — text color ≈ background color
//
//  Noise controls: skips hidden elements, [data-lint-ignore] subtrees, ellipsis
//  truncation (intentional), transient toasts/tooltips, and non-solid (image /
//  gradient) backgrounds where contrast can't be computed honestly. Faults are
//  deduped by (type, structural selector) and capped per type.
//
//  Usage (browser context): runLayoutLint() → { faults, counts, scanned, ... }
// ═════════════════════════════════════════════════════════════════════════════
(function (root) {

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TITLE', 'META', 'LINK', 'OPTION', 'BR', 'CANVAS', 'SVG', 'PATH']);
  const SKIP_IDS = new Set(['toast-container', 'ct-tooltip', 'ct-context-menu']);
  const INTERACTIVE = 'button, a[href], input, select, textarea, [data-action], [role="button"]';
  const CAP_PER_TYPE = 40;

  function isSkipped(el) {
    for (let n = el; n; n = n.parentElement) {
      if (SKIP_IDS.has(n.id) || n.hasAttribute?.('data-lint-ignore')) return true;
    }
    return false;
  }

  function visible(el) {
    if (!el.getClientRects().length) return false;
    // checkVisibility handles ancestor display/visibility/opacity — a control
    // inside a CLOSED (opacity:0) modal is invisible even though its own
    // computed style looks fine. Fall back to per-element checks if absent.
    if (el.checkVisibility) {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  // True if the point is reachable by scrolling some ancestor (the app shell
  // scrolls inside #main-content, not the document — below-the-fold there is
  // NOT offscreen).
  function scrollReachable(el, r) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) continue;
      const nr = n.getBoundingClientRect();
      // Within the ancestor's scrollable extent (its box grown by its scroll room)?
      if (r.left >= nr.left - n.scrollLeft - 2 && r.top >= nr.top - n.scrollTop - 2 &&
          r.right <= nr.left - n.scrollLeft + n.scrollWidth + 2 &&
          r.bottom <= nr.top - n.scrollTop + n.scrollHeight + 2) return true;
    }
    return false;
  }

  // Direct text of the element itself (not descendants) — anchors most checks
  // to the element that OWNS the text, keeping container noise down.
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.trim();
  }

  // Short structural selector for the register; strips list positions so the
  // same fault across 50 rows dedupes to one finding.
  function sel(el) {
    const bits = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 3; n = n.parentElement, i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) { bits.unshift(`#${n.id}`); break; }
      const cls = [...n.classList].slice(0, 2).join('.');
      if (cls) s += '.' + cls;
      bits.unshift(s);
    }
    return bits.join('>');
  }

  function parseColor(str) {
    const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/.exec(str || '');
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function luminance({ r, g, b }) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(c1, c2) {
    const l1 = luminance(c1), l2 = luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // Effective solid background: walk ancestors to the first opaque color;
  // return null (skip contrast) if any layer has an image/gradient.
  function effectiveBg(el) {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a >= 0.95) return c;
      // semi-transparent layers make honest math hard — skip.
      if (c && c.a > 0.05 && c.a < 0.95) return null;
    }
    return parseColor('rgb(255,255,255)');
  }

  function runLayoutLint(opts = {}) {
    const t0 = performance.now();
    const faults = [];
    const seen = new Set();
    const counts = {};
    const add = (type, el, detail) => {
      const s = sel(el);
      const key = type + '|' + s;
      if (seen.has(key)) return;
      counts[type] = (counts[type] || 0) + 1;
      if (counts[type] > CAP_PER_TYPE) return;
      seen.add(key);
      faults.push({ type, sel: s, detail, text: (ownText(el) || el.textContent || '').trim().slice(0, 60) });
    };

    const all = [...document.body.querySelectorAll('*')].filter(el =>
      !SKIP_TAGS.has(el.tagName) && !isSkipped(el) && visible(el)
      // SVG has its own layout model — scrollWidth/Height are meaningless there.
      && !(el.namespaceURI && el.namespaceURI.includes('svg')));

    for (const el of all) {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const text = ownText(el);

      // clipped-text: own text overflows, and it isn't an intentional ellipsis
      // or a scroll container.
      if (text && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        const clipStyles = ['visible', 'clip'];
        if (clipStyles.includes(cs.overflowX) && cs.textOverflow !== 'ellipsis') {
          add('clipped-text', el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
        }
      }
      if (text && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0
          && ['visible', 'clip'].includes(cs.overflowY) && cs.webkitLineClamp === 'none') {
        add('clipped-text', el, `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight} (vertical)`);
      }

      // collapsed: has text, effectively zero box (gotcha #7 class).
      if (text && (rect.height < 4 || rect.width < 4)) {
        add('collapsed', el, `rendered ${Math.round(rect.width)}x${Math.round(rect.height)} with text`);
      }

      // contrast (own text on a computable solid background)
      if (text && text.length >= 2) {
        const fg = parseColor(cs.color);
        const bg = effectiveBg(el);
        if (fg && bg && fg.a > 0.9) {
          const r = ratio(fg, bg);
          if (r < 1.15) add('invisible-text', el, `contrast ${r.toFixed(2)}:1`);
          else if (r < (opts.contrastMin || 2.5)) add('low-contrast', el, `contrast ${r.toFixed(2)}:1`);
        }
      }
    }

    // interactive-only passes: overlap + offscreen
    const inter = [...document.body.querySelectorAll(INTERACTIVE)].filter(el =>
      !isSkipped(el) && visible(el));
    const rects = inter.map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(x => x.r.width > 2 && x.r.height > 2);

    const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight);
    for (const { el, r } of rects) {
      if ((r.right < -2 || r.bottom < -2 || r.left > docW + 2 || r.top > docH + 2)
          && !scrollReachable(el, r)) {
        add('offscreen', el, `at ${Math.round(r.left)},${Math.round(r.top)} (doc ${docW}x${docH})`);
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix <= 0 || iy <= 0) continue;
        const inter_ = ix * iy;
        const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if (smaller > 0 && inter_ / smaller > 0.3) {
          add('overlap', a.el, `${Math.round(inter_ / smaller * 100)}% with ${sel(b.el)}`);
        }
      }
    }

    return {
      url: location.pathname.split(/[\\/]/).pop(),
      theme: document.documentElement.getAttribute('data-theme') || '(default)',
      viewport: `${innerWidth}x${innerHeight}`,
      scanned: all.length,
      ms: Math.round(performance.now() - t0),
      counts,
      faults,
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { runLayoutLint };
  else root.runLayoutLint = runLayoutLint;
})(this);
