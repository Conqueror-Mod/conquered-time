'use strict';

// Apply pre-auth preferences from localStorage before first paint (login screen
// only — no vault loaded yet, so these are the ct_pa_* localStorage keys, not the
// sessionStorage ones used by inner pages). Externalized from an inline <script>
// so login can run under a strict script-src 'self' CSP.
(function () {
  const theme = localStorage.getItem('ct_pa_theme') || 'zanarkand';
  const scale = localStorage.getItem('ct_pa_scale') || 'normal';
  const rm    = localStorage.getItem('ct_pa_reducedMotion')  || 'false';
  const hc    = localStorage.getItem('ct_pa_highContrast')   || 'false';
  const cb    = localStorage.getItem('ct_pa_colorblind')     || 'off';
  const fi    = localStorage.getItem('ct_pa_focusIndicators')|| 'false';
  const root  = document.documentElement;
  root.setAttribute('data-theme',           theme);
  root.setAttribute('data-scale',           scale);
  root.setAttribute('data-reduced-motion',  rm);
  root.setAttribute('data-high-contrast',   hc);
  root.setAttribute('data-colorblind',      cb);
  root.setAttribute('data-focus-indicators',fi);
})();
