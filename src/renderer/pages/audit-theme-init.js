'use strict';

// Theme-flash guard for the standalone audit-wizard window, which receives its
// theme via ?theme= query param (not sessionStorage). Externalized from an inline
// <script> so the window can run under a strict script-src 'self' CSP.
(function () {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.visibility = 'hidden';
})();
