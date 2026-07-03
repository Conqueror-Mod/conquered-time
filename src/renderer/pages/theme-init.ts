'use strict';

// Apply persisted theme/scale before first paint to avoid a flash of the wrong
// palette, and hide the document until the page's own script restores visibility
// after Shell.init(). Externalized from an inline <script> so inner pages can run
// under a strict script-src 'self' CSP. Shared by all inner pages.
(function () {
  const t = sessionStorage.getItem('ct_theme');
  const s = sessionStorage.getItem('ct_scale');
  if (t) document.documentElement.setAttribute('data-theme', t);
  if (s) document.documentElement.setAttribute('data-scale', s);
  document.documentElement.style.visibility = 'hidden';
})();
