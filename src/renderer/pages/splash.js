'use strict';

// Apply theme before render to prevent a flash of the wrong palette.
// Externalized from an inline <script> so the page can run under a strict
// script-src 'self' CSP (no 'unsafe-inline').
(function () {
  const params = new URLSearchParams(window.location.search);
  const theme  = params.get('theme') || 'memoria';
  document.documentElement.setAttribute('data-theme', theme);
})();
