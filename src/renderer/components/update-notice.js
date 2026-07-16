'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  update-notice.js — user-facing surface for the auto-updater.
//
//  The updater (src/main/updater.ts) does a silent check ~10s after launch and
//  pushes state on the 'update:status' channel, but on its own that only shows
//  up if the user opens Settings → About. This makes it visible where it counts:
//
//   1. When an update is available/staged, a sticky ACTIONABLE toast appears —
//      "Download & Install" then "Install & Restart" (opt-in; nothing downloads
//      until the user clicks). Shown on BOTH the profile selector (login.js) and
//      inside the app (injected by Shell.init) so a long-running session sees it
//      too.
//   2. After a completed self-update, a one-time "✓ Updated to vX" confirmation
//      — because the install/restart is otherwise silent and the user couldn't
//      tell it worked without checking the About version.
//
//  CSP-safe: builds its own DOM and wires buttons with addEventListener (no
//  inline handlers). Reuses the .update-toast action-toast style so the upcoming
//  larger-toast restyle flows through automatically.
// ════════════════════════════════════════════════════════════════════════════

const UpdateNotice = (() => {
  /** @type {HTMLElement|null} the single persistent sticky toast (rebuilt per STATE
   *  change only — progress ticks update it in place, see 'download-progress'). */
  let el = null;
  /** Which state `el` was built for; lets a same-state tick reuse the node. */
  let elState = null;
  /** The state the user last dismissed with "Later"; re-shown when state changes. */
  let dismissedFor = null;
  let wired = false;

  function container() { return document.getElementById('toast-container'); }

  // Transient toast (confirmation / errors) — mirrors the per-page toast() both
  // login.js and shell.js provide, but self-contained so this runs on either.
  function flash(msg, type = 'success') {
    const c = container();
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  function clearSticky() { if (el) { el.remove(); el = null; elState = null; } }

  /**
   * @param {string} msg
   * @param {Array<{label: string, fn: () => void, primary?: boolean}>} actions
   * @param {{state?: string, progress?: number}} [opts] - `state` keys the node for
   *   in-place reuse; `progress` (0-100) renders a fill bar under the message.
   */
  function renderSticky(msg, actions, opts = {}) {
    const c = container();
    if (!c) return;
    // Same-state re-render (e.g. each download-progress tick): mutate the live
    // node instead of remove+append — recreating it replays the .toast entry
    // animation on every tick, which reads as a translucent flicker for the
    // whole download.
    if (el && opts.state && elState === opts.state) {
      const t = el.querySelector('.update-toast-msg');
      if (t) t.textContent = msg;
      const fill = el.querySelector('.update-toast-fill');
      if (fill && typeof opts.progress === 'number') {
        fill.style.width = `${Math.max(0, Math.min(100, opts.progress))}%`;
      }
      return;
    }
    clearSticky();
    el = document.createElement('div');
    elState = opts.state || null;
    el.className = 'toast info update-toast';
    const text = document.createElement('div');
    text.className = 'update-toast-msg';
    text.textContent = msg;
    el.appendChild(text);
    if (typeof opts.progress === 'number') {
      const bar = document.createElement('div');
      bar.className = 'update-toast-bar';
      const fill = document.createElement('div');
      fill.className = 'update-toast-fill';
      fill.style.width = `${Math.max(0, Math.min(100, opts.progress))}%`;
      bar.appendChild(fill);
      el.appendChild(bar);
    }
    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'update-toast-btns';
      actions.forEach(a => {
        const b = document.createElement('button');
        b.className = a.primary ? 'btn-primary' : 'btn-neutral';
        b.textContent = a.label;
        b.addEventListener('click', a.fn);
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    c.appendChild(el);
  }

  function laterAction(state) {
    return { label: 'Later', fn: () => { dismissedFor = state; clearSticky(); } };
  }

  function handle(status) {
    if (!status || typeof status !== 'object') return;
    const st = status.state;
    // A fresh state supersedes a previous "Later" dismissal.
    if (st !== dismissedFor) dismissedFor = null;
    if (dismissedFor === st) return;

    const ver = status.version ? `v${status.version}` : 'a new version';
    switch (st) {
      case 'available':
        renderSticky(`Update available — ${ver}.`, [
          { label: '⭳ Download & Install', primary: true, fn: () => { void api.invoke('update:download'); } },
          laterAction('available'),
        ]);
        break;
      case 'download-progress': {
        const pct = Math.round(status.percent || 0);
        renderSticky(`Downloading update… ${pct}%`, [], { state: 'download-progress', progress: pct });
        break;
      }
      case 'downloaded':
        renderSticky(`Update ready — ${ver}. Restart to finish installing.`, [
          { label: '⟳ Install & Restart', primary: true, fn: () => { void api.invoke('update:install'); } },
          laterAction('downloaded'),
        ]);
        break;
      case 'error':
        // Don't hijack the screen with a sticky for a background-check failure;
        // a transient note is enough (the About panel shows detail on demand).
        if (status.error) flash(`Update check failed: ${status.error}`, 'error');
        clearSticky();
        break;
      default:
        // idle / checking / not-available / dev → nothing to act on.
        clearSticky();
    }
  }

  async function init() {
    if (typeof api === 'undefined' || !api.invoke) return;
    // One-time post-update confirmation (consume-once from main).
    try {
      const ju = await api.invoke('update:just-updated');
      if (ju && ju.updated) flash(`✓ Updated to v${ju.to}. You're on the latest version.`, 'success');
    } catch { /* no-op */ }

    // Reflect whatever the silent launch check already found (invoke returns the
    // last status), then keep in sync with live pushes.
    try { handle(await api.invoke('update:status')); } catch { /* no-op */ }
    if (!wired) { api.on('update:status', handle); wired = true; }
  }

  // _handle mirrors shell.js's _-prefixed exports: test/driver access only.
  return { init, _handle: handle };
})();

window.UpdateNotice = UpdateNotice;
