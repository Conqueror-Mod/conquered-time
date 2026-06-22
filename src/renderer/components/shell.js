'use strict';

const Shell = (() => {

  const IC = {
    dashboard: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" fill-opacity="0.22" stroke="currentColor"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`,
    companies: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" style="display:block"><circle cx="8" cy="8" r="2.5" fill="currentColor" fill-opacity="0.28"/><line x1="8" y1="5.5" x2="8" y2="2.2"/><circle cx="8" cy="1.5" r="1.3" fill="currentColor" fill-opacity="0.7"/><line x1="8" y1="10.5" x2="8" y2="13.8"/><circle cx="8" cy="14.5" r="1.3" fill="currentColor" fill-opacity="0.7"/><line x1="5.5" y1="8" x2="2.2" y2="8"/><circle cx="1.5" cy="8" r="1.3" fill="currentColor" fill-opacity="0.7"/><line x1="10.5" y1="8" x2="13.8" y2="8"/><circle cx="14.5" cy="8" r="1.3" fill="currentColor" fill-opacity="0.7"/></svg>`,
    tracker:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="8" cy="8" r="6.5"/><polyline points="8,3.5 8,8 11,10"/></svg>`,
    reports:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:block"><rect x="1" y="10" width="3.5" height="5" rx="0.5" fill="currentColor" fill-opacity="0.45"/><rect x="6.25" y="6.5" width="3.5" height="8.5" rx="0.5" fill="currentColor" fill-opacity="0.45"/><rect x="11.5" y="3.5" width="3.5" height="11.5" rx="0.5" fill="currentColor" fill-opacity="0.45"/><polyline points="2.75,10 8,6.5 13.25,3.5" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5" stroke-linecap="round" fill="none"/></svg>`,
    globallog: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="display:block"><line x1="1" y1="3.5" x2="15" y2="3.5"/><line x1="2.5" y1="7" x2="13.5" y2="7"/><line x1="4.5" y1="10.5" x2="11.5" y2="10.5"/><line x1="6.5" y1="14" x2="9.5" y2="14"/></svg>`,
    lock:      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M8 1.5 L13.5 4 L13.5 9 Q13.5 14 8 15.5 Q2.5 14 2.5 9 L2.5 4 Z"/><circle cx="8" cy="8.5" r="1.8" fill="currentColor" fill-opacity="0.45"/><line x1="8" y1="10.3" x2="8" y2="12.5" stroke-width="1.8"/></svg>`,
    settings:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" style="display:block"><line x1="1" y1="4" x2="15" y2="4"/><circle cx="5" cy="4" r="2" fill="currentColor" fill-opacity="0.22"/><line x1="1" y1="8" x2="15" y2="8"/><circle cx="10.5" cy="8" r="2" fill="currentColor" fill-opacity="0.22"/><line x1="1" y1="12" x2="15" y2="12"/><circle cx="6" cy="12" r="2" fill="currentColor" fill-opacity="0.22"/></svg>`,
    tasktimer: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="8" cy="9" r="5.5"/><line x1="8" y1="9" x2="8" y2="5.8"/><line x1="8" y1="9" x2="10.2" y2="10.3"/><line x1="6.5" y1="1.5" x2="9.5" y2="1.5"/><line x1="8" y1="1.5" x2="8" y2="3.5"/><line x1="13" y1="5" x2="14" y2="4"/></svg>`,
  };

  const NAV = [
    { id: 'dashboard',  icon: IC.dashboard,  label: 'Dashboard'    },
    { id: 'companies',  icon: IC.companies,  label: 'Companies'    },
    { id: 'tracker',    icon: IC.tracker,    label: 'Time Tracker' },
    { id: 'task-timer', icon: IC.tasktimer,  label: 'Dispatch'     },
    { id: 'reports',    icon: IC.reports,    label: 'Reports'      },
    { id: 'global-log', icon: IC.globallog,  label: 'Global Log'   },
  ];

  function buildTitlebar(pageLabel) {
    return `
    <div class="titlebar">
      <div class="titlebar-left">
        <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:3px;"><defs><radialGradient id="tb-bg" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="#1a1a3a"/><stop offset="100%" stop-color="#020408"/></radialGradient></defs><circle cx="256" cy="256" r="250" fill="url(#tb-bg)"/><circle cx="256" cy="256" r="244" fill="none" stroke="#d4a030" stroke-width="6"/><path d="M110 82 L402 82 L256 256 L402 430 L110 430 L256 256 Z" fill="none" stroke="#b07818" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M110 82 L402 82 L256 256 L402 430 L110 430 L256 256 Z" fill="none" stroke="#f0d060" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><line x1="110" y1="82" x2="402" y2="82" stroke="#f0c060" stroke-width="16" stroke-linecap="round"/><line x1="110" y1="430" x2="402" y2="430" stroke="#f0c060" stroke-width="16" stroke-linecap="round"/><path d="M118 90 L394 90 L256 248 Z" fill="#7c3aed" fill-opacity="0.35"/><path d="M256 264 L384 422 L128 422 Z" fill="#0ea5e9" fill-opacity="0.4"/><circle cx="256" cy="256" r="10" fill="#fff4c0" opacity="0.95"/></svg>
        <span class="titlebar-logo">Conquered</span>
        <div class="titlebar-divider"></div>
        <span class="titlebar-page">${pageLabel}</span>
      </div>
      <div class="titlebar-controls">
        <button class="titlebar-btn" onclick="api.send('win:minimize')">─</button>
        <button class="titlebar-btn" onclick="api.send('win:maximize')">□</button>
        <button class="titlebar-btn close" onclick="api.send('win:close')">✕</button>
      </div>
    </div>`;
  }

  function buildSidebar(activeId, user) {
    const navItems = NAV.map(n => `
      <a class="nav-item ${n.id === activeId ? 'active' : ''}"
         tabindex="0"
         onclick="api.send('navigate', '${n.id}')"
         onkeydown="if(event.key==='Enter')api.send('navigate','${n.id}')">
        <span class="nav-icon">${n.icon}</span>
        ${n.label}
      </a>`).join('');

    return `
    <div class="sidebar" id="app-sidebar">
      <div class="sidebar-section">
        <div class="sidebar-label">Navigation</div>
        ${navItems}
      </div>
      <div class="sidebar-spacer">
        <div id="sidebar-task-timer" style="display:none;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 0;">
          <div class="sidebar-timer-dot"></div>
          <div id="sidebar-task-time" class="sidebar-timer-display">00:00</div>
        </div>
      </div>

      <div class="sidebar-section" style="margin-bottom:0;">
        <div class="sidebar-label">Session</div>
        <a class="nav-item" onclick="api.send('session:request-lock')">
          <span class="nav-icon">${IC.lock}</span> Lock
        </a>
      </div>

      <div style="border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:10px 0;margin-bottom:0;">
        <button class="settings-trigger" id="settings-trigger-btn" onclick="openSettingsModal()" title="Settings (Ctrl+,)">
          <span style="display:inline-flex;align-items:center;">${IC.settings}</span> Settings
        </button>
      </div>

      <div class="sidebar-user">
        <div class="sidebar-user-name">${user?.username || '—'}</div>
        <div class="sidebar-active-badge">Active Session</div>
      </div>
    </div>`;
  }

  function buildSettingsModal() {
    return `
    <div id="settings-modal" onclick="handleModalBackdrop(event)">
      <div class="settings-modal-box">
        <div class="settings-modal-header">
          <div class="settings-modal-title" style="display:flex;align-items:center;gap:8px;">${IC.settings} Settings</div>
          <button class="settings-modal-close" onclick="closeSettingsModal()">✕</button>
        </div>
        <div class="settings-modal-body">

          <!-- Appearance -->
          <div class="settings-group">
            <div class="settings-group-title">Appearance</div>

            <div class="settings-row">
              <div class="settings-row-label">Theme</div>
              <div class="theme-cards" id="theme-cards">
                <div class="theme-card" data-t="ember"  onclick="applyTheme('ember')">
                  <div class="theme-swatch" data-t="ember"></div>
                  <div class="theme-card-name">Ember</div>
                </div>
                <div class="theme-card" data-t="void"   onclick="applyTheme('void')">
                  <div class="theme-swatch" data-t="void"></div>
                  <div class="theme-card-name">Void</div>
                </div>
                <div class="theme-card" data-t="arctic" onclick="applyTheme('arctic')">
                  <div class="theme-swatch" data-t="arctic"></div>
                  <div class="theme-card-name">Arctic</div>
                </div>
                <div class="theme-card" data-t="paper"  onclick="applyTheme('paper')">
                  <div class="theme-swatch" data-t="paper"></div>
                  <div class="theme-card-name">Paper</div>
                </div>
                <div class="theme-card" data-t="quartz" onclick="applyTheme('quartz')">
                  <div class="theme-swatch" data-t="quartz"></div>
                  <div class="theme-card-name">Quartz</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Scale -->
          <div class="settings-group">
            <div class="settings-group-title">Display Scale</div>
            <div class="settings-row">
              <div class="settings-row-label">UI Size — affects all elements proportionally</div>
              <div class="settings-btn-group" id="scale-btns">
                <button class="s-btn" data-s="compact"     onclick="applyScale('compact')">Compact</button>
                <button class="s-btn" data-s="normal"      onclick="applyScale('normal')">Normal</button>
                <button class="s-btn" data-s="comfortable" onclick="applyScale('comfortable')">Comfortable</button>
                <button class="s-btn" data-s="large"       onclick="applyScale('large')">Large</button>
              </div>
            </div>
          </div>

          <!-- Time Format -->
          <div class="settings-group">
            <div class="settings-group-title">Time Format</div>
            <div class="settings-row">
              <div class="settings-row-label">Clock display preference</div>
              <div class="settings-btn-group" id="time-btns">
                <button class="s-btn" data-tf="24h" onclick="applyTimeFormat('24h')">24-Hour (14:30)</button>
                <button class="s-btn" data-tf="12h" onclick="applyTimeFormat('12h')">12-Hour (2:30 PM)</button>
              </div>
            </div>
          </div>

          <!-- Auto-Save -->
          <div class="settings-group">
            <div class="settings-group-title">Data</div>
            <div class="settings-row">
              <div class="settings-row-label">Auto-Save interval</div>
              <div class="settings-btn-group" id="autosave-btns">
                <button class="s-btn" data-asi="0"  onclick="applyAutoSave(0)">Off</button>
                <button class="s-btn" data-asi="30" onclick="applyAutoSave(30)">30 sec</button>
                <button class="s-btn" data-asi="60" onclick="applyAutoSave(60)">1 min</button>
                <button class="s-btn" data-asi="300" onclick="applyAutoSave(300)">5 min</button>
              </div>
            </div>
          </div>

          <!-- Auto-Lock -->
          <div class="settings-group">
            <div class="settings-group-title">Security</div>
            <div class="settings-row">
              <div class="settings-row-label">Auto-Lock after inactivity</div>
              <div class="settings-btn-group" id="autolock-btns">
                <button class="s-btn" data-al="0"  onclick="applyAutoLock(0)">Off</button>
                <button class="s-btn" data-al="5"  onclick="applyAutoLock(5)">5 min</button>
                <button class="s-btn" data-al="15" onclick="applyAutoLock(15)">15 min</button>
                <button class="s-btn" data-al="30" onclick="applyAutoLock(30)">30 min</button>
                <button class="s-btn" data-al="60" onclick="applyAutoLock(60)">1 hour</button>
              </div>
            </div>
          </div>

          <!-- Accessibility -->
          <div class="settings-group">
            <div class="settings-group-title">Accessibility</div>
            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Reduce Motion</div>
                <div class="toggle-desc">Disables animations and transitions</div>
              </div>
              <button class="toggle-switch" id="toggle-motion"
                onclick="applyToggle('reducedMotion', this)"></button>
            </div>
            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Focus Indicators</div>
                <div class="toggle-desc">Shows visible outlines for keyboard navigation</div>
              </div>
              <button class="toggle-switch" id="toggle-focus"
                onclick="applyToggle('focusIndicators', this)"></button>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">Colorblind mode</div>
              <div class="settings-btn-group" id="colorblind-btns">
                <button class="s-btn" data-cb="off"           onclick="applyColorblind('off')">Off</button>
                <button class="s-btn" data-cb="deuteranopia"  onclick="applyColorblind('deuteranopia')">Deuteranopia</button>
                <button class="s-btn" data-cb="protanopia"    onclick="applyColorblind('protanopia')">Protanopia</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>`;
  }

  function buildAuditWarningModal() {
    return `
    <div id="audit-warning-modal" style="display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.75);display:none;align-items:center;justify-content:center;">
      <div style="background:var(--surface-3);border:1px solid var(--border-light);border-radius:var(--radius-xl);padding:28px 32px;max-width:420px;width:90%;box-shadow:var(--shadow-3);display:flex;flex-direction:column;gap:18px;position:relative;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:22px;line-height:1;">⚠</span>
          <div style="font-family:var(--sans);font-size:15px;font-weight:600;color:var(--text-white);">Audit Notice</div>
        </div>
        <div id="audit-warning-body" style="font-family:var(--sans);font-size:13px;color:var(--text);line-height:1.6;"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button id="audit-warn-dismiss" style="font-family:var(--sans);font-size:12px;font-weight:500;padding:8px 16px;border-radius:var(--radius);border:1px solid var(--border-light);background:transparent;color:var(--text-muted);cursor:pointer;transition:all var(--transition);">Continue Anyway</button>
          <button id="audit-warn-view" style="font-family:var(--sans);font-size:12px;font-weight:600;padding:8px 16px;border-radius:var(--radius);border:none;background:var(--accent);color:#fff;cursor:pointer;transition:all var(--transition);">View Audit Log</button>
        </div>
      </div>
    </div>`;
  }

  async function init(activePage) {
    const user = await api.invoke('session:get');
    if (!user) { api.send('navigate', 'login'); return; }
    window.__currentUsername = user?.username || 'YOU';

    const pageLabels = {
      dashboard:    'Dashboard',
      companies:    'Company Network',
      tracker:      'Time Tracker',
      'task-timer': 'Dispatch',
      reports:      'Reports',
      'global-log': 'Global Log',
    };

    const existingContent = document.body.innerHTML;
    document.body.innerHTML = `
      <div class="app-shell">
        ${buildTitlebar(pageLabels[activePage] || activePage)}
        <div class="app-body">
          ${buildSidebar(activePage, user)}
          <div class="main-content" id="main-content">
            ${existingContent}
          </div>
        </div>
      </div>
      ${buildSettingsModal()}
      ${buildAuditWarningModal()}
      <div id="toast-container"></div>
    `;

    // Load settings and sync UI
    await Settings.load();
    syncSettingsModal();

    // Global keyboard navigation
    document.addEventListener('keydown', e => {
      const auditOpen    = document.getElementById('audit-warning-modal')?.style.display !== 'none';
      const settingsOpen = document.getElementById('settings-modal')?.classList.contains('open');

      // ── Escape: close whichever modal is open ─────────────────────────────
      if (e.key === 'Escape') {
        if (settingsOpen) { closeSettingsModal(); return; }
        if (auditOpen)    { document.getElementById('audit-warn-dismiss')?.click(); return; }
      }

      // ── Settings modal: Ctrl+, ─────────────────────────────────────────────
      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openSettingsModal();
        return;
      }

      // ── While a modal is open: trap Tab focus inside it ───────────────────
      if (e.key === 'Tab' && (auditOpen || settingsOpen)) {
        const modalId = auditOpen ? 'audit-warning-modal' : 'settings-modal';
        const modal   = document.getElementById(modalId);
        const focusable = Array.from(modal.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
        if (!focusable.length) return;
        const idx = focusable.indexOf(document.activeElement);
        e.preventDefault();
        if (e.shiftKey) {
          focusable[idx <= 0 ? focusable.length - 1 : idx - 1].focus();
        } else {
          focusable[idx >= focusable.length - 1 ? 0 : idx + 1].focus();
        }
        return;
      }

      // ── Module switching: Ctrl+1–6 ─────────────────────────────────────────
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const pages = ['dashboard', 'companies', 'tracker', 'task-timer', 'reports', 'global-log'];
        const idx   = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < pages.length) {
          e.preventDefault();
          api.send('navigate', pages[idx]);
          return;
        }
      }

      // ── Audit modal: arrow keys move between the two buttons ─────────────
      if (auditOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const btns = [
          document.getElementById('audit-warn-dismiss'),
          document.getElementById('audit-warn-view'),
        ].filter(Boolean);
        const idx = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowLeft')  btns[Math.max(0, idx <= 0 ? btns.length - 1 : idx - 1)].focus();
        if (e.key === 'ArrowRight') btns[idx >= btns.length - 1 ? 0 : idx + 1].focus();
        return;
      }

      // ── Sidebar arrow-key nav ──────────────────────────────────────────────
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !auditOpen && !settingsOpen) {
        const items = Array.from(document.querySelectorAll('.nav-item'));
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        if (idx === -1) {
          // Nothing focused yet — focus the active item or first item
          (document.querySelector('.nav-item.active') || items[0]).focus();
          e.preventDefault();
          return;
        }
        e.preventDefault();
        if (e.key === 'ArrowUp')   items[Math.max(0, idx - 1)].focus();
        if (e.key === 'ArrowDown') items[Math.min(items.length - 1, idx + 1)].focus();
      }
    });

    // Idle detection — send heartbeat to main process on activity, throttled to once per 30s
    let lastHeartbeat = 0;
    function onActivity() {
      const now = Date.now();
      if (now - lastHeartbeat > 30000) {
        lastHeartbeat = now;
        api.invoke('session:heartbeat');
      }
    }
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
      document.addEventListener(evt, onActivity, { passive: true })
    );

    api.on('toast', ({ msg, type }) => toast(msg, type));
    api.on('menu:export-pdf', () => { if (typeof onExportPDF === 'function') onExportPDF(); });
    api.on('menu:export-csv', () => { if (typeof onExportCSV === 'function') onExportCSV(); });
    api.on('audit:close-warning', ({ count, action }) => showAuditWarning(count, action));

    // ── Sidebar active-task timer ──────────────────────────────────────────
    (async () => {
      try {
        const entry = await api.invoke('entries:get-active');
        if (!entry) return;
        const tasks = await api.invoke('tasks:list', entry.id);
        const active = tasks.find(t => t.item_type === 'task' && t.started_at && !t.stopped_at);
        if (!active) return;

        const wrapper = document.getElementById('sidebar-task-timer');
        const display = document.getElementById('sidebar-task-time');
        if (!wrapper || !display) return;
        wrapper.style.display = 'flex';

        function tickTimer() {
          const secs = Math.floor((Date.now() - active.started_at) / 1000);
          const h = Math.floor(secs / 3600);
          const m = Math.floor((secs % 3600) / 60);
          const s = secs % 60;
          display.textContent = h > 0
            ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
            : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
        tickTimer();
        setInterval(tickTimer, 1000);
      } catch {}
    })();

    return user;
  }

  function toast(msg, type = 'success', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  return { init, toast };
})();

// ── Settings modal controls (global scope) ────────────────────────────────────

function openSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (m) { m.classList.add('open'); syncSettingsModal(); }
}

function closeSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (m) m.classList.remove('open');
}

function handleModalBackdrop(e) {
  if (e.target.id === 'settings-modal') closeSettingsModal();
}

function syncSettingsModal() {
  const s = Settings.current;

  // Theme cards
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.t === s.theme);
  });

  // Scale buttons
  document.querySelectorAll('[data-s]').forEach(b => {
    b.classList.toggle('active', b.dataset.s === s.scale);
  });

  // Time format buttons
  document.querySelectorAll('[data-tf]').forEach(b => {
    b.classList.toggle('active', b.dataset.tf === s.timeFormat);
  });

  // Auto-lock buttons
  document.querySelectorAll('[data-al]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.al, 10) === s.autoLockMinutes);
  });

  // Auto-save buttons
  document.querySelectorAll('[data-asi]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.asi, 10) === s.autoSaveInterval);
  });

  // Toggles
  const tm = document.getElementById('toggle-motion');
  const tf = document.getElementById('toggle-focus');
  if (tm) tm.classList.toggle('on', s.reducedMotion);
  if (tf) tf.classList.toggle('on', s.focusIndicators);

  // Colorblind selector
  document.querySelectorAll('[data-cb]').forEach(b => {
    b.classList.toggle('active', b.dataset.cb === s.colorblind);
  });
}

async function applyTheme(theme) {
  await Settings.set('theme', theme);
  syncSettingsModal();
}

async function applyScale(scale) {
  await Settings.set('scale', scale);
  syncSettingsModal();
}

async function applyTimeFormat(fmt) {
  await Settings.set('timeFormat', fmt);
  syncSettingsModal();
}

async function applyToggle(key, btn) {
  const newVal = !Settings.get(key);
  await Settings.set(key, newVal);
  btn.classList.toggle('on', newVal);
}

async function applyColorblind(mode) {
  await Settings.set('colorblind', mode);
  syncSettingsModal();
}

async function applyAutoSave(seconds) {
  await Settings.set('autoSaveInterval', seconds);
  syncSettingsModal();
  // Notify the tracker page to restart its interval if it's listening
  if (typeof onAutoSaveSettingChanged === 'function') onAutoSaveSettingChanged(seconds);
}

function showAuditWarning(count, action) {
  const modal = document.getElementById('audit-warning-modal');
  const body  = document.getElementById('audit-warning-body');
  const viewBtn    = document.getElementById('audit-warn-view');
  const dismissBtn = document.getElementById('audit-warn-dismiss');
  if (!modal || !body) return;

  const noun = count === 1 ? 'discrepancy' : 'discrepancies';
  const verb = action === 'close' ? 'closing' : 'locking';
  body.innerHTML = `<strong style="color:var(--text-white);">${count} audit ${noun}</strong> detected in your session log — entries with missing clock-outs, zero duration, or unusual hours.<br><br>Review before ${verb}?`;
  dismissBtn.textContent = action === 'close' ? 'Close Anyway' : 'Lock Anyway';

  modal.style.display = 'flex';
  setTimeout(() => viewBtn?.focus(), 50);

  const cleanup = () => { modal.style.display = 'none'; viewBtn.onclick = null; dismissBtn.onclick = null; };

  viewBtn.onclick = () => {
    cleanup();
    sessionStorage.setItem('reports_open_tab', 'audit');
    api.send('navigate', 'reports');
  };

  dismissBtn.onclick = () => {
    cleanup();
    if (action === 'close') api.send('session:confirm-close');
    else                    api.send('session:confirm-lock');
  };
}

async function applyAutoLock(minutes) {
  await Settings.set('autoLockMinutes', minutes);
  // Immediately inform main process so the timer resets with the new value
  await api.invoke('session:heartbeat');
  syncSettingsModal();
}
