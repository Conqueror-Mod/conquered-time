'use strict';

/**
 * Conquered Time — Settings Engine
 * Manages theme, scale, accessibility, and time format preferences.
 * Applied via data-* attributes on <html> element → CSS variable overrides cascade automatically.
 */
const Settings = (() => {

  const DEFAULTS = {
    theme:            'memoria',  // memoria | treno | nibelheim | lindblum | rabanastre
    scale:            'normal',
    reducedMotion:    false,
    highContrast:     false,
    colorblind:       'off',
    focusIndicators:  false,
    timeFormat:       '24h',
    autoLockMinutes:   0,         // 0 = disabled
    autoSaveInterval:  60,        // seconds; 0 = disabled
  };

  let current = { ...DEFAULTS };

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
    // Cache to sessionStorage for login page pre-load
    try {
      sessionStorage.setItem('ct_theme', settings.theme);
      sessionStorage.setItem('ct_scale', settings.scale);
    } catch(e) {}
  }

  // ── Load from DB and apply ─────────────────────────────────────────────────
  async function load() {
    try {
      const keys = ['theme','scale','reducedMotion','highContrast','colorblind','focusIndicators','timeFormat','autoLockMinutes','autoSaveInterval'];
      for (const key of keys) {
        const val = await api.invoke('settings:get', `ui_${key}`);
        if (val !== null && val !== undefined) {
          if (key === 'autoLockMinutes' || key === 'autoSaveInterval') current[key] = parseInt(val, 10);
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
