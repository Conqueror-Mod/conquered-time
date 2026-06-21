'use strict';

const Shell = (() => {

  const NAV = [
    { id: 'dashboard',  icon: '◈', label: 'Dashboard'   },
    { id: 'companies',  icon: '◉', label: 'Companies'   },
    { id: 'tracker',    icon: '⏱', label: 'Time Tracker' },
    { id: 'reports',    icon: '↗', label: 'Reports'     },
    { id: 'global-log', icon: '≡', label: 'Global Log'  },
  ];

  function buildTitlebar(pageLabel) {
    return `
    <div class="titlebar">
      <div class="titlebar-left">
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
         onclick="api.send('navigate', '${n.id}')">
        <span class="nav-icon">${n.icon}</span>
        ${n.label}
      </a>`).join('');

    return `
    <div class="sidebar" id="app-sidebar">
      <div class="sidebar-section">
        <div class="sidebar-label">Navigation</div>
        ${navItems}
      </div>
      <div class="sidebar-spacer"></div>

      <div class="sidebar-section" style="margin-bottom:0;">
        <div class="sidebar-label">Session</div>
        <a class="nav-item" onclick="api.send('session:request-lock')">
          <span class="nav-icon">🔒</span> Lock
        </a>
      </div>

      <div style="border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:10px 0;margin-bottom:0;">
        <button class="settings-trigger" id="settings-trigger-btn" onclick="openSettingsModal()" title="Settings (Ctrl+,)">
          <span>⚙</span> Settings
        </button>
      </div>

      <div class="sidebar-user">
        <div class="sidebar-user-name">${user?.username || '—'}</div>
        <div class="sidebar-user-label">Active Session</div>
      </div>
    </div>`;
  }

  function buildSettingsModal() {
    return `
    <div id="settings-modal" onclick="handleModalBackdrop(event)">
      <div class="settings-modal-box">
        <div class="settings-modal-header">
          <div class="settings-modal-title">⚙ Settings</div>
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
                <div class="toggle-label">High Contrast</div>
                <div class="toggle-desc">Increases border and text visibility</div>
              </div>
              <button class="toggle-switch" id="toggle-contrast"
                onclick="applyToggle('highContrast', this)"></button>
            </div>
            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Colorblind Mode</div>
                <div class="toggle-desc">Deuteranopia-safe color palette</div>
              </div>
              <button class="toggle-switch" id="toggle-colorblind"
                onclick="applyToggle('colorblind', this)"></button>
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

    const pageLabels = {
      dashboard:    'Dashboard',
      companies:    'Company Network',
      tracker:      'Time Tracker',
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

    // Close modal on Escape, open on Ctrl+,
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSettingsModal();
      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openSettingsModal();
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
  const tc = document.getElementById('toggle-contrast');
  const tcb = document.getElementById('toggle-colorblind');
  if (tm)  tm.classList.toggle('on',  s.reducedMotion);
  if (tc)  tc.classList.toggle('on',  s.highContrast);
  if (tcb) tcb.classList.toggle('on', s.colorblind);
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
