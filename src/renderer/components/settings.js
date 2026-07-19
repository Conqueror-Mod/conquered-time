'use strict';

/**
 * Conquered Time — Settings Engine
 * Manages theme, scale, accessibility, and time format preferences.
 * Applied via data-* attributes on <html> element → CSS variable overrides cascade automatically.
 */
const Settings = (() => {

  const DEFAULTS = {
    theme:            'memoria',  // memoria | zanarkand | rabanastre | treno | nibelheim
    scale:            'normal',
    reducedMotion:    false,
    highContrast:     false,
    colorblind:       'off',
    focusIndicators:  false,
    timeFormat:       '24h',
    autoLockMinutes:   0,         // 0 = disabled
    autoSaveInterval:  60,        // seconds; 0 = disabled
    idlePunchMinutes:  0,         // idle forgotten-punch nudge; 0 = disabled
    archiveDays:       30,        // Company Galaxy: idle days before a company folds into Archive (30/90/182/365)
  };

  let current = { ...DEFAULTS };

  // UI scale → browser-style zoom factor. Applied app-wide via the main process
  // (win:set-zoom → webContents.setZoomFactor), so the WHOLE window scales
  // uniformly — sidebar, titlebar, modals, and content together. (Superseded the
  // old CSS `zoom` on #main-content, which left the chrome unscaled.)
  // Large was 1.3 but overflowed smaller screens (user report 2026-07-19,
  // dual-office-monitor setup) — cut to 1.2. Keep in sync with PA_ZOOM (login.js).
  const SCALE_ZOOM = { compact: 0.85, normal: 1.0, comfortable: 1.15, large: 1.2 };

  // ── Apply settings to DOM ──────────────────────────────────────────────────
  function apply(settings) {
    const root = document.documentElement;
    root.setAttribute('data-theme',          settings.theme);
    root.setAttribute('data-scale',          settings.scale);
    root.setAttribute('data-reduced-motion',   settings.reducedMotion  ? 'true' : 'false');
    root.setAttribute('data-high-contrast',    settings.highContrast   ? 'true' : 'false');
    root.setAttribute('data-colorblind',       settings.colorblind  || 'off');
    root.setAttribute('data-focus-indicators', settings.focusIndicators ? 'true' : 'false');
    window.__timeFormat = settings.timeFormat;
    // App-wide zoom (fire-and-forget). Guarded — apply() also runs on pages
    // where the preload bridge may not be ready yet.
    try {
      const factor = SCALE_ZOOM[settings.scale] ?? 1;
      if (typeof api !== 'undefined' && api.invoke) api.invoke('win:set-zoom', factor);
    } catch (e) {}
    // Cache to sessionStorage for login page pre-load
    try {
      sessionStorage.setItem('ct_theme', settings.theme);
      sessionStorage.setItem('ct_scale', settings.scale);
    } catch(e) {}
  }

  // ── Load from DB and apply ─────────────────────────────────────────────────
  async function load() {
    try {
      const keys = ['theme','scale','reducedMotion','highContrast','colorblind','focusIndicators','timeFormat','autoLockMinutes','autoSaveInterval','idlePunchMinutes','archiveDays'];
      for (const key of keys) {
        const val = await api.invoke('settings:get', `ui_${key}`);
        if (val !== null && val !== undefined) {
          if (key === 'autoLockMinutes' || key === 'autoSaveInterval' || key === 'idlePunchMinutes' || key === 'archiveDays') current[key] = parseInt(val, 10);
          else if (key === 'colorblind') current[key] = val;
          else if (val === 'true')  current[key] = true;
          else if (val === 'false') current[key] = false;
          else current[key] = val;
        }
      }
    } catch (e) {
      console.warn('Settings load failed, using defaults:', e);
    }
    apply(current);
    return current;
  }

  // ── Save a single setting ──────────────────────────────────────────────────
  async function set(key, value) {
    current[key] = value;
    apply(current);
    // Notify the active page so it can re-render in place (e.g. live 12h/24h
    // switch of already-drawn rows) — not a SPA, so each page wires its own listener.
    try {
      document.dispatchEvent(new CustomEvent('ct:settings-changed', { detail: { key, value } }));
    } catch (e) {}
    try {
      await api.invoke('settings:set', { key: `ui_${key}`, value: String(value) });
    } catch (e) {
      console.warn('Settings save failed:', e);
    }
  }

  // ── Get current value ──────────────────────────────────────────────────────
  function get(key) { return current[key]; }

  // ── Format time string according to preference ────────────────────────────
  function formatTime(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return timeStr;
    if (current.timeFormat === '24h') return timeStr;
    // Convert HH:MM to 12-hour
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2,'0')} ${period}`;
  }

  return { load, set, get, apply, formatTime, DEFAULTS, get current() { return { ...current }; } };
})();
