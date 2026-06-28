'use strict';

// Escape user-controlled text before it is interpolated into an innerHTML / HTML
// template string. Prevents stored values (company names, task labels, session
// notes, etc.) from injecting markup or executing as script. Use everywhere a
// `${userField}` lands inside an HTML string; not needed for textContent or
// plain-text contexts (toast, confirm, <input>.value).
window.escapeHtml = function (v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

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
    profile:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="8" cy="5.5" r="2.8"/><path d="M2 14c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/></svg>`,
  };

  const NAV = [
    { id: 'dashboard',  icon: IC.dashboard,  label: 'Dashboard'    },
    { id: 'profile',    icon: IC.profile,    label: 'Profile'      },
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
        <button class="titlebar-btn" data-action="winMinimize">─</button>
        <button class="titlebar-btn" data-action="winMaximize">□</button>
        <button class="titlebar-btn close" data-action="winClose">✕</button>
      </div>
    </div>`;
  }

  function buildSidebar(activeId, user, profile) {
    const navItems = NAV.map(n => `
      <a class="nav-item ${n.id === activeId ? 'active' : ''}"
         tabindex="0"
         data-action="navigate" data-arg="${n.id}">
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
        <a class="nav-item" tabindex="0" data-action="requestLock">
          <span class="nav-icon">${IC.lock}</span> Lock
        </a>
      </div>

      <div style="border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:10px 0;margin-bottom:0;">
        <button class="settings-trigger" id="settings-trigger-btn" data-action="openSettings" title="Settings (Ctrl+,)">
          <span style="display:inline-flex;align-items:center;">${IC.settings}</span> Settings
        </button>
      </div>

      <div class="sidebar-user">
        <div class="sidebar-user-identity">
          <div class="sidebar-avatar" id="sidebar-avatar"></div>
          <div class="sidebar-user-text">
            <div class="sidebar-user-name">${user?.display_name || user?.username || '—'}</div>
            ${user?.display_name ? `<div class="sidebar-user-sub">${user.username}</div>` : ''}
          </div>
        </div>
        <div class="sidebar-active-badge">Active Session</div>
      </div>
    </div>`;
  }

  function buildSettingsModal() {
    const NAV_ITEMS = [
      { id: 'appearance',   label: 'Appearance',    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>' },
      { id: 'window',       label: 'Window',         icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><path d="M7 4v5"/></svg>' },
      { id: 'security',     label: 'Security',       icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
      { id: 'data',         label: 'Data',           icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>' },
      { id: 'reports',      label: 'Reports',        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' },
      { id: 'accessibility',label: 'Accessibility',  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' },
      { id: 'about',        label: 'About',          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' },
    ];

    const navHTML = NAV_ITEMS.map(n => `
      <button class="sn-item${n.id === 'appearance' ? ' active' : ''}" data-cat="${n.id}" data-action="switchCat" data-arg="${n.id}">
        <span class="sn-icon">${n.icon}</span>
        <span class="sn-label">${n.label}</span>
      </button>`).join('');

    return `
    <div id="settings-modal">
      <div class="settings-modal-box">

        <div class="settings-modal-header">
          <div class="settings-modal-title" style="display:flex;align-items:center;gap:8px;">${IC.settings} Settings</div>
          <button class="settings-modal-close" data-action="closeSettings">✕</button>
        </div>

        <div class="settings-layout">

          <!-- Left nav -->
          <nav class="settings-nav">${navHTML}</nav>

          <!-- Right content -->
          <div class="settings-content">

            <!-- ── APPEARANCE ───────────────────────────────── -->
            <div id="settings-cat-appearance" class="settings-cat-panel">
              <div class="sc-title">Appearance</div>

              <div class="settings-group">
                <div class="settings-group-title">Theme</div>
                <div class="theme-cards" id="theme-cards">
                  <div class="theme-card" data-t="zanarkand"  data-action="applyTheme" data-arg="zanarkand"><div class="theme-swatch" data-t="zanarkand"></div><div class="theme-card-name">Zanarkand</div></div>
                  <div class="theme-card" data-t="memoria"    data-action="applyTheme" data-arg="memoria"><div class="theme-swatch" data-t="memoria"></div><div class="theme-card-name">Memoria</div></div>
                  <div class="theme-card" data-t="rabanastre" data-action="applyTheme" data-arg="rabanastre"><div class="theme-swatch" data-t="rabanastre"></div><div class="theme-card-name">Rabanastre</div></div>
                  <div class="theme-card" data-t="treno"      data-action="applyTheme" data-arg="treno"><div class="theme-swatch" data-t="treno"></div><div class="theme-card-name">Treno</div></div>
                  <div class="theme-card" data-t="nibelheim"  data-action="applyTheme" data-arg="nibelheim"><div class="theme-swatch" data-t="nibelheim"></div><div class="theme-card-name">Nibelheim</div></div>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">UI Scale</div>
                <div class="settings-row-label">Scales all app content proportionally</div>
                <div class="settings-btn-group" id="scale-btns" style="margin-top:8px;">
                  <button class="s-btn" data-s="compact"     data-action="applyScale" data-arg="compact">Compact</button>
                  <button class="s-btn" data-s="normal"      data-action="applyScale" data-arg="normal">Normal</button>
                  <button class="s-btn" data-s="comfortable" data-action="applyScale" data-arg="comfortable">Comfortable</button>
                  <button class="s-btn" data-s="large"       data-action="applyScale" data-arg="large">Large</button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Clock Format</div>
                <div class="settings-row-label">How times are shown throughout the app</div>
                <div class="settings-btn-group" id="time-btns" style="margin-top:8px;">
                  <button class="s-btn" data-tf="24h" data-action="applyTimeFormat" data-arg="24h">24-Hour (14:30)</button>
                  <button class="s-btn" data-tf="12h" data-action="applyTimeFormat" data-arg="12h">12-Hour (2:30 PM)</button>
                </div>
              </div>
            </div>

            <!-- ── WINDOW ────────────────────────────────────── -->
            <div id="settings-cat-window" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Window</div>

              <div class="settings-group">
                <div class="settings-group-title">Preferred Display</div>
                <div class="settings-row-label">Which monitor the app opens on</div>
                <div id="display-picker" style="margin-top:8px;"></div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Start Maximized</div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Launch maximized</div>
                    <div class="toggle-desc">Opens the app filling the full display on startup</div>
                  </div>
                  <button class="toggle-switch" id="toggle-start-maximized" data-action="applyWinToggle" data-arg="win_startMaximized"></button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Remember Last Position</div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Restore window position</div>
                    <div class="toggle-desc">Reopens the app at the same size and position as last time</div>
                  </div>
                  <button class="toggle-switch" id="toggle-remember-position" data-action="applyWinToggle" data-arg="win_rememberPosition"></button>
                </div>
              </div>
            </div><!-- /settings-cat-window -->

            <!-- ── DATA ─────────────────────────────────────── -->
            <div id="settings-cat-data" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Data</div>

              <div class="settings-group">
                <div class="settings-group-title">Auto-Save</div>
                <div class="settings-row-label">How often active sessions are automatically saved</div>
                <div class="settings-btn-group" id="autosave-btns" style="margin-top:8px;">
                  <button class="s-btn" data-asi="0"   data-action="applyAutoSave" data-arg="0">Off</button>
                  <button class="s-btn" data-asi="30"  data-action="applyAutoSave" data-arg="30">30 sec</button>
                  <button class="s-btn" data-asi="60"  data-action="applyAutoSave" data-arg="60">1 min</button>
                  <button class="s-btn" data-asi="300" data-action="applyAutoSave" data-arg="300">5 min</button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Database Clear</div>
                <div class="settings-row-label">Permanently remove data. These actions cannot be undone.</div>

                <div class="dba-cards">

                  <div class="dba-card" id="dba-card-timeclock">
                    <div class="dba-card-header">
                      <div>
                        <div class="dba-card-title">Time Clock Clear</div>
                        <div class="dba-card-desc">Removes all time entries and Dispatch task records. Companies are kept.</div>
                      </div>
                      <button class="dba-trigger-btn" data-action="showDbaConfirm" data-arg="timeclock">Clear</button>
                    </div>
                    <div class="dba-confirm" id="dba-confirm-timeclock" style="display:none;">
                      <div class="dba-confirm-warning">⚠ This will permanently delete all time entries and task records for your account.</div>
                      <div class="dba-confirm-row">
                        <input class="dba-confirm-input" id="dba-input-timeclock" placeholder='Type CONFIRM to proceed' autocomplete="off">
                        <button class="dba-confirm-btn danger" data-action="executeDbaClear" data-arg="timeclock">Delete</button>
                        <button class="dba-confirm-btn" data-action="hideDbaConfirm" data-arg="timeclock">Cancel</button>
                      </div>
                    </div>
                  </div>

                  <div class="dba-card" id="dba-card-companies">
                    <div class="dba-card-header">
                      <div>
                        <div class="dba-card-title">Companies Clear</div>
                        <div class="dba-card-desc">Removes all companies and their associated time entries and tasks.</div>
                      </div>
                      <button class="dba-trigger-btn" data-action="showDbaConfirm" data-arg="companies">Clear</button>
                    </div>
                    <div class="dba-confirm" id="dba-confirm-companies" style="display:none;">
                      <div class="dba-confirm-warning">⚠ This will permanently delete all companies, time entries, and task records for your account.</div>
                      <div class="dba-confirm-row">
                        <input class="dba-confirm-input" id="dba-input-companies" placeholder='Type CONFIRM to proceed' autocomplete="off">
                        <button class="dba-confirm-btn danger" data-action="executeDbaClear" data-arg="companies">Delete</button>
                        <button class="dba-confirm-btn" data-action="hideDbaConfirm" data-arg="companies">Cancel</button>
                      </div>
                    </div>
                  </div>

                  <div class="dba-card dba-card-full" id="dba-card-full">
                    <div class="dba-card-header">
                      <div>
                        <div class="dba-card-title">Full Database Clear</div>
                        <div class="dba-card-desc">Wipes everything — account, companies, all data. Resets app to first-run state.</div>
                      </div>
                      <button class="dba-trigger-btn danger" data-action="showDbaConfirm" data-arg="full">Wipe</button>
                    </div>
                    <div class="dba-confirm" id="dba-confirm-full" style="display:none;">
                      <div class="dba-confirm-warning">⚠ DESTRUCTIVE — This permanently deletes your account and all data. You will be logged out and returned to setup.</div>
                      <div class="dba-confirm-row">
                        <input class="dba-confirm-input" id="dba-input-full" placeholder='Type CONFIRM to proceed' autocomplete="off">
                        <button class="dba-confirm-btn danger" data-action="executeDbaClear" data-arg="full">Wipe Everything</button>
                        <button class="dba-confirm-btn" data-action="hideDbaConfirm" data-arg="full">Cancel</button>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Backup Library</div>
                <div class="settings-row-label">Restore from a previous automatic backup. Your current data is saved first as a safety checkpoint before any restore.</div>
                <div id="backup-list-area" style="margin-top:10px;">
                  <button class="s-btn" data-action="loadBackupList">Load Backups</button>
                </div>
              </div>



            </div><!-- /settings-cat-data -->

            <!-- ── REPORTS ───────────────────────────────────── -->
            <div id="settings-cat-reports" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Reports</div>

              <div class="settings-group" id="sg-email-reports">
                <div class="settings-group-title">Email Reports</div>
                <div class="settings-row-label">Configure SMTP to send reports to your inbox as PDF + CSV attachments.</div>
                <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;" id="email-cfg-grid">
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">SMTP Host</div>
                    <input class="sc-input" id="email-host" type="text" placeholder="smtp.gmail.com" autocomplete="off">
                  </div>
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">Port</div>
                    <input class="sc-input" id="email-port" type="number" placeholder="587" style="width:100%">
                  </div>
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">Username / Email</div>
                    <input class="sc-input" id="email-user" type="text" placeholder="you@example.com" autocomplete="off">
                  </div>
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">Password / App Password</div>
                    <div style="position:relative;">
                      <input class="sc-input" id="email-pass" type="password" placeholder="•••••••••" autocomplete="new-password" style="padding-right:36px;width:100%;">
                      <button id="email-pass-toggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:0;color:var(--text-muted);" title="Show/hide">
                        <svg id="email-eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </div>
                  </div>
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">From Name (optional)</div>
                    <input class="sc-input" id="email-from-name" type="text" placeholder="Conquered Time" autocomplete="off">
                  </div>
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">Default Recipient(s)</div>
                    <input class="sc-input" id="email-default-to" type="text" placeholder="you@work.com" autocomplete="off">
                  </div>
                </div>
                <div style="margin-top:14px;display:flex;gap:8px;align-items:center;">
                  <button class="s-btn s-btn-primary" id="email-save-btn" data-action="saveEmailConfig">Save Config</button>
                  <button class="s-btn" id="email-test-btn" data-action="testEmailConfig">Test SMTP</button>
                  <span id="email-status-text" style="font-size:11px;color:var(--text-muted);margin-left:4px;"></span>
                </div>
              </div>

              <div class="settings-group" id="sg-scheduled-reports">
                <div class="settings-group-title">Scheduled Reports</div>
                <div class="settings-row-label">Automatically email reports on a recurring schedule using the SMTP config above.</div>
                <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">Frequency</div>
                    <select class="sc-input" id="sched-freq" data-action-change="saveScheduleConfig">
                      <option value="off">Off</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly (Monday)</option>
                      <option value="monthly">Monthly (1st)</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annually">Annually</option>
                    </select>
                  </div>
                  <div>
                    <div class="settings-row-label" style="margin-bottom:4px;">Send At</div>
                    <input class="sc-input" id="sched-time" type="time" value="08:00" data-action-change="saveScheduleConfig">
                  </div>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
                  <button class="s-btn" id="sched-send-now-btn" data-action="sendScheduledNow">Send Now</button>
                  <span id="sched-send-status" style="font-size:11px;color:var(--text-muted);"></span>
                </div>
                <div id="sched-next-send" style="margin-top:10px;font-size:11px;color:var(--text-muted);"></div>
              </div>

            </div><!-- /settings-cat-reports -->

            <!-- ── SECURITY ──────────────────────────────────── -->
            <div id="settings-cat-security" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Security</div>

              <div class="settings-group">
                <div class="settings-group-title">Auto-Lock</div>
                <div class="settings-row-label">Lock the app after a period of inactivity</div>
                <div class="settings-btn-group" id="autolock-btns" style="margin-top:8px;">
                  <button class="s-btn" data-al="0"  data-action="applyAutoLock" data-arg="0">Off</button>
                  <button class="s-btn" data-al="5"  data-action="applyAutoLock" data-arg="5">5 min</button>
                  <button class="s-btn" data-al="15" data-action="applyAutoLock" data-arg="15">15 min</button>
                  <button class="s-btn" data-al="30" data-action="applyAutoLock" data-arg="30">30 min</button>
                  <button class="s-btn" data-al="60" data-action="applyAutoLock" data-arg="60">1 hour</button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Windows Hello / Secure Sign-in</div>
                <div class="settings-row-label">Sign in without your password using your Windows account credentials</div>
                <div id="safe-storage-status" style="margin-top:12px;">
                  <div class="settings-row-label" style="color:var(--text-muted)">Checking availability…</div>
                </div>
              </div>
            </div>

            <!-- ── ACCESSIBILITY ─────────────────────────────── -->
            <div id="settings-cat-accessibility" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Accessibility</div>

              <div class="settings-group">
                <div class="settings-group-title">Motion & Focus</div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Reduce Motion</div>
                    <div class="toggle-desc">Disables animations and transitions</div>
                  </div>
                  <button class="toggle-switch" id="toggle-motion" data-action="applyToggle" data-arg="reducedMotion"></button>
                </div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">High Contrast</div>
                    <div class="toggle-desc">Increases border and text contrast across all themes</div>
                  </div>
                  <button class="toggle-switch" id="toggle-highcontrast" data-action="applyToggle" data-arg="highContrast"></button>
                </div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Focus Indicators</div>
                    <div class="toggle-desc">Shows visible outlines for keyboard navigation</div>
                  </div>
                  <button class="toggle-switch" id="toggle-focus" data-action="applyToggle" data-arg="focusIndicators"></button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Color Vision</div>
                <div class="settings-row-label">Adjust colors for color vision deficiencies</div>
                <div class="settings-btn-group" id="colorblind-btns" style="margin-top:8px;">
                  <button class="s-btn" data-cb="off"          data-action="applyColorblind" data-arg="off">Off</button>
                  <button class="s-btn" data-cb="deuteranopia" data-action="applyColorblind" data-arg="deuteranopia">Deuteranopia</button>
                  <button class="s-btn" data-cb="protanopia"   data-action="applyColorblind" data-arg="protanopia">Protanopia</button>
                </div>
              </div>
            </div>

            <!-- ── ABOUT ─────────────────────────────────────── -->
            <div id="settings-cat-about" class="settings-cat-panel about-panel" style="display:none;">
              <div class="sc-title">About</div>

              <div class="about-hero">
                <img class="about-icon" src="../../../assets/icon-256.png" alt="Conquered Time icon">
                <div class="about-wordmark">Conquered Time</div>
                <div class="about-version-badge" id="about-version-badge">v—</div>
              </div>

              <div class="about-tagline">"Take back your time."</div>

              <div class="about-section">
                <div class="about-section-title">Build Info</div>
                <div class="about-build-grid">
                  <span class="about-build-label">Version</span><span class="about-build-value" id="ab-version">—</span>
                  <span class="about-build-label">Electron</span><span class="about-build-value" id="ab-electron">—</span>
                  <span class="about-build-label">Node</span><span class="about-build-value" id="ab-node">—</span>
                  <span class="about-build-label">Platform</span><span class="about-build-value" id="ab-platform">—</span>
                </div>
              </div>

              <div class="about-section">
                <div class="about-section-title">Credits</div>
                <div class="about-credit-block">
                  <div class="about-credit-role">Created by</div>
                  <div class="about-credit-name">Chris Bowles — The Conqueror</div>
                </div>
                <div class="about-credit-block">
                  <div class="about-credit-role">Co-Author</div>
                  <div class="about-credit-name">Vincent Vathan</div>
                </div>
                <div class="about-copyright">Copyright © 2026 Chris Bowles - The Conqueror. All rights reserved.</div>
              </div>

              <div class="about-section">
                <div class="about-section-title">What's New — v3.6</div>
                <ul class="about-changelog">
                  <li>Hardened security — every screen now blocks inline scripts at the browser level (strict Content-Security-Policy), shrinking the attack surface for injected code</li>
                  <li>Snappier navigation — your data is decrypted once and reused as you move between pages, so the dashboard, companies, and reports load faster</li>
                  <li>Under the hood — each page's code is now a separate file, making the app easier to maintain and verify</li>
                </ul>
              </div>
              <div class="about-section">
                <div class="about-section-title">v3.5</div>
                <ul class="about-changelog">
                  <li>Crash-safe saves — your vault is now written atomically, so a power loss or crash can never corrupt your data mid-write</li>
                  <li>Safer password changes — changing or recovering your password re-encrypts everything as all-or-nothing, rolling back cleanly if anything goes wrong</li>
                  <li>Stronger data protection — company names, task labels, and notes are fully sanitized everywhere they're shown or exported (XSS and spreadsheet-formula safety)</li>
                  <li>Faster dashboard & company views — these pages no longer decrypt your entire history on every visit</li>
                  <li>Automated test coverage — the encryption, migration, and recovery paths are now backed by an automated test suite</li>
                </ul>
              </div>
              <div class="about-section">
                <div class="about-changelog-more">
                  Showing the two most recent releases. Older release notes are available on
                  <button class="about-changelog-link" data-action="openExternal" data-arg="github">GitHub</button>.
                </div>
              </div>

              <div class="about-section">
                <div class="about-section-title">Updates</div>
                <div class="about-update-row">
                  <button class="about-update-btn" id="about-check-update-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    Check for Updates
                  </button>
                  <span class="about-update-result" id="about-update-result"></span>
                </div>
              </div>

              <div class="about-section">
                <div class="about-section-title">Links</div>
                <div class="about-links">
                  <button class="about-link-btn" data-action="openExternal" data-arg="github">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                    GitHub
                    <span class="about-link-placeholder">Coming soon</span>
                  </button>
                  <button class="about-link-btn" data-action="openExternal" data-arg="donate">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                    Support / Donate
                    <span class="about-link-placeholder">Coming soon</span>
                  </button>
                </div>
              </div>
            </div>

          </div><!-- /settings-content -->
        </div><!-- /settings-layout -->
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

  function setSidebarAvatar(profile, displayName, username) {
    const el = document.getElementById('sidebar-avatar');
    if (!el) return;
    const name = displayName || username || '?';
    const initials = (() => {
      const parts = name.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
    })();
    if (profile?.avatar) {
      const isAnimated = profile.avatar.startsWith('data:image/gif') ||
                         profile.avatar.startsWith('data:image/apng') ||
                         profile.avatar.startsWith('data:image/webp');
      el.innerHTML = `<img src="${profile.avatar}" alt="">`;
      if (isAnimated) {
        const img = el.querySelector('img');
        // Restart GIF/APNG from frame 1 on hover (Discord-style idle→animate)
        img.addEventListener('mouseenter', () => { const s = img.src; img.src = ''; img.src = s; });
      }
    } else {
      el.textContent = initials;
    }
  }

  function _injectScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init(activePage) {
    await Promise.all([
      _injectScript('../ipc.js'),
      _injectScript('../validator.js'),
    ]);
    await _injectScript('../store.js'); // store.js depends on IPC

    const [user, profile] = await Promise.all([
      api.invoke('session:get'),
      api.invoke('profile:get').catch(() => null)
    ]);
    if (!user) { api.send('navigate', 'login'); return; }
    window.__currentUsername = user?.username || 'YOU';

    const pageLabels = {
      dashboard:    'Dashboard',
      profile:      'Profile',
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
          ${buildSidebar(activePage, user, profile)}
          <div class="main-content" id="main-content">
            ${existingContent}
          </div>
        </div>
      </div>
      ${buildSettingsModal()}
      ${buildAuditWarningModal()}
      <div id="toast-container"></div>
    `;

    setSidebarAvatar(profile, user.display_name, user.username);

    // Wire delegated handlers (CSP-safe; replaces inline on* attributes).
    installShellDelegation();
    // Backdrop close is special — must fire only when the modal element itself
    // (not its box children) is clicked, so it can't use the closest() dispatcher.
    document.getElementById('settings-modal')?.addEventListener('click', handleModalBackdrop);

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
          const secs = Math.floor((Date.now() - active.started_at * 1000) / 1000);
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

  // ── Sidebar timer controls (callable by any page) ────────────────────────
  let _sidebarTimerInterval = null;

  function showSidebarTimer(startedAtMs) {
    const wrapper = document.getElementById('sidebar-task-timer');
    const display = document.getElementById('sidebar-task-time');
    if (!wrapper || !display) return;
    clearInterval(_sidebarTimerInterval);
    wrapper.style.display = 'flex';
    function tick() {
      const secs = Math.floor((Date.now() - startedAtMs) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      display.textContent = h > 0
        ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
        : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    tick();
    _sidebarTimerInterval = setInterval(tick, 1000);
  }

  function hideSidebarTimer() {
    clearInterval(_sidebarTimerInterval);
    _sidebarTimerInterval = null;
    const wrapper = document.getElementById('sidebar-task-timer');
    if (wrapper) wrapper.style.display = 'none';
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

  return { init, toast, showSidebarTimer, hideSidebarTimer, setSidebarAvatar };
})();

// ── Settings modal controls (global scope) ────────────────────────────────────

function openSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (m) { m.classList.add('open'); syncSettingsModal(); }
}

function closeSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (m) m.classList.remove('open');
  // Reset lazy-load flags so tabs refresh on next open
  _safeStorageLoaded  = false;
  _windowSettingsLoaded = false;
  _emailCfgLoaded     = false;
}

let _aboutInfoLoaded = false;
let _windowSettingsLoaded = false;
let _safeStorageLoaded = false;
async function switchSettingsCategory(cat) {
  document.querySelectorAll('.sn-item').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  document.querySelectorAll('.settings-cat-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById(`settings-cat-${cat}`);
  if (panel) panel.style.display = '';

  if (cat === 'reports') loadEmailConfig();

  if (cat === 'window' && !_windowSettingsLoaded) {
    _windowSettingsLoaded = true;
    loadDisplayPicker();
  }

  if (cat === 'security' && !_safeStorageLoaded) {
    _safeStorageLoaded = true;
    loadSafeStorageStatus();
  }

  if (cat === 'about' && !_aboutInfoLoaded) {
    _aboutInfoLoaded = true;
    try {
      const info = await api.invoke('app:get-info');
      document.getElementById('about-version-badge').textContent = `v${info.version}`;
      document.getElementById('ab-version').textContent  = info.version;
      document.getElementById('ab-electron').textContent = info.electronVersion;
      document.getElementById('ab-node').textContent     = info.nodeVersion;
      document.getElementById('ab-platform').textContent = `${info.platform} (${info.arch})`;
    } catch {}

    document.getElementById('about-check-update-btn')?.addEventListener('click', async () => {
      const btn    = document.getElementById('about-check-update-btn');
      const result = document.getElementById('about-update-result');
      btn.disabled = true;
      result.className = 'about-update-result';
      result.textContent = 'Checking…';
      try {
        const res = await api.invoke('app:check-update');
        if (!res.ok) {
          result.className = 'about-update-result update-error';
          result.textContent = res.error;
        } else if (res.hasUpdate) {
          result.className = 'about-update-result update-available';
          result.innerHTML = `v${res.latest} available — <a class="update-download-link" href="#">Download</a>`;
          result.querySelector('.update-download-link').addEventListener('click', e => {
            e.preventDefault();
            Shell._openUpdateUrl(res.downloadUrl);
          });
        } else {
          result.className = 'about-update-result update-current';
          result.textContent = `You're up to date (v${res.current}).`;
        }
      } catch {
        result.className = 'about-update-result update-error';
        result.textContent = 'Update check failed.';
      } finally {
        btn.disabled = false;
      }
    });
  }
}

function showDbaConfirm(type) {
  // Hide all other confirms first
  ['timeclock','companies','full'].forEach(t => {
    if (t !== type) hideDbaConfirm(t);
  });
  const el = document.getElementById(`dba-confirm-${type}`);
  if (el) { el.style.display = ''; document.getElementById(`dba-input-${type}`)?.focus(); }
}

function hideDbaConfirm(type) {
  const el = document.getElementById(`dba-confirm-${type}`);
  if (el) el.style.display = 'none';
  const inp = document.getElementById(`dba-input-${type}`);
  if (inp) inp.value = '';
}

async function executeDbaClear(type) {
  const inp = document.getElementById(`dba-input-${type}`);
  if (!inp || inp.value.trim() !== 'CONFIRM') {
    inp?.classList.add('dba-input-shake');
    setTimeout(() => inp?.classList.remove('dba-input-shake'), 600);
    Shell.toast('Type CONFIRM exactly to proceed.', 'error', 3000);
    return;
  }
  const channel = type === 'full' ? 'db:clear-full' : type === 'companies' ? 'db:clear-companies' : 'db:clear-timeclock';
  try {
    const res = await api.invoke(channel);
    if (!res?.ok) { Shell.toast('Clear failed — check console.', 'error'); return; }
    hideDbaConfirm(type);
    closeSettingsModal();
    if (type === 'full') {
      Shell.toast('Profile wiped. Returning to profile selector…', 'info', 2000);
      setTimeout(() => api.send('navigate', 'login'), 2000);
    } else {
      Shell.toast(type === 'companies' ? 'All companies and time data cleared.' : 'Time clock data cleared.', 'success', 3000);
      setTimeout(() => location.reload(), 1500);
    }
  } catch(e) { Shell.toast('Error: ' + e.message, 'error'); }
}

Shell._openExternal = function(type) {
  Shell.toast('Link coming soon — stay tuned!', 'info', 2500);
};

Shell._openUpdateUrl = function(url) {
  if (!url) { Shell.toast('No download URL configured yet.', 'info', 2500); return; }
  api.send('shell:open-external', url);
};

// ── Backup Library ────────────────────────────────────────────────────────────
let _backupFiles = []; // cache so indices stay stable
let _backupPreviewOpen = null; // index of currently expanded preview

async function loadBackupList() {
  const area = document.getElementById('backup-list-area');
  if (!area) return;
  area.innerHTML = '<span style="font-family:var(--sans);font-size:12px;color:var(--text-muted);">Loading…</span>';
  try {
    _backupFiles = await api.invoke('backup:list');
    if (!_backupFiles.length) {
      area.innerHTML = '<span style="font-family:var(--sans);font-size:12px;color:var(--text-muted);">No backups found. Backups are created automatically on each save and app close.</span>';
      return;
    }
    const rows = _backupFiles.map((b, i) => {
      const dt = (b.timestamp || '').replace('T', ' ');
      return `
        <div class="backup-row" id="brow-${i}" style="flex-shrink:0;">
          <div class="backup-row-main">
            <div>
              <div class="backup-row-ts">${dt}</div>
              <div class="backup-row-size">${b.sizeKB} KB</div>
            </div>
            <button class="backup-preview-btn" data-idx="${i}">Preview</button>
          </div>
          <div class="backup-preview-panel" id="bpanel-${i}" style="display:none;"></div>
        </div>`;
    }).join('');
    area.innerHTML = `<div class="backup-list">${rows}</div>`;
    // Wire preview buttons after innerHTML set
    area.querySelectorAll('.backup-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleBackupPreview(Number(btn.dataset.idx)));
    });
    _backupPreviewOpen = null;
  } catch(e) {
    area.innerHTML = `<span style="font-family:var(--sans);font-size:12px;color:var(--red);">Failed to load backups: ${e.message}</span>`;
  }
}

async function toggleBackupPreview(idx) {
  const panel = document.getElementById(`bpanel-${idx}`);
  if (!panel) return;

  // Close any other open preview
  if (_backupPreviewOpen !== null && _backupPreviewOpen !== idx) {
    const prev = document.getElementById(`bpanel-${_backupPreviewOpen}`);
    if (prev) prev.style.display = 'none';
  }

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    _backupPreviewOpen = null;
    return;
  }

  _backupPreviewOpen = idx;
  panel.style.display = '';
  panel.innerHTML = '<div style="padding:10px 14px;font-family:var(--sans);font-size:12px;color:var(--text-muted);">Loading preview…</div>';

  const filename = _backupFiles[idx]?.filename;
  if (!filename) return;

  const info = await api.invoke('backup:preview', filename);
  if (info.error) {
    panel.innerHTML = `<div style="padding:10px 14px;font-family:var(--sans);font-size:12px;color:var(--red);">Preview failed: ${info.error}</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="backup-preview-content">
      <div class="backup-preview-grid">
        <span class="bp-label">Account</span>   <span class="bp-value">${info.username}</span>
        <span class="bp-label">Companies</span>  <span class="bp-value">${info.companyCount}</span>
        <span class="bp-label">Time Entries</span><span class="bp-value">${info.entryCount}</span>
        <span class="bp-label">Date Range</span> <span class="bp-value">${info.dateFrom} → ${info.dateTo}</span>
      </div>
      <div id="brestore-row-${idx}">
        <button class="backup-restore-btn" data-action="showBackupConfirm" data-arg="${idx}">Restore This Backup</button>
      </div>
      <div class="backup-confirm-area" id="bconfirm-${idx}" style="display:none;">
        <div class="backup-confirm-warning">⚠ This will replace your live database with this backup and log you out. Your current data is saved as a safety checkpoint first.</div>
        <div class="backup-confirm-row">
          <input class="dba-confirm-input" id="binput-${idx}" placeholder="Type CONFIRM to restore" autocomplete="off">
          <button class="dba-confirm-btn danger" data-action="executeBackupRestore" data-arg="${idx}">Restore</button>
          <button class="dba-confirm-btn" data-action="hideBackupConfirm" data-arg="${idx}">Cancel</button>
        </div>
      </div>
    </div>`;
}

function showBackupConfirm(idx) {
  const el = document.getElementById(`bconfirm-${idx}`);
  if (el) { el.style.display = ''; document.getElementById(`binput-${idx}`)?.focus(); }
}
function hideBackupConfirm(idx) {
  const el = document.getElementById(`bconfirm-${idx}`);
  if (el) el.style.display = 'none';
  const inp = document.getElementById(`binput-${idx}`);
  if (inp) inp.value = '';
}

async function executeBackupRestore(idx) {
  const inp = document.getElementById(`binput-${idx}`);
  if (!inp || inp.value.trim() !== 'CONFIRM') {
    inp?.classList.add('dba-input-shake');
    setTimeout(() => inp?.classList.remove('dba-input-shake'), 600);
    Shell.toast('Type CONFIRM exactly to restore.', 'error', 3000);
    return;
  }
  const filename = _backupFiles[idx]?.filename;
  if (!filename) { Shell.toast('Backup reference lost — reload the list and try again.', 'error'); return; }
  const res = await api.invoke('backup:restore', filename);
  if (!res?.ok) { Shell.toast('Restore failed: ' + (res?.error || 'unknown'), 'error'); return; }
  // main process navigates to login after successful restore
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
  const tm  = document.getElementById('toggle-motion');
  const thc = document.getElementById('toggle-highcontrast');
  const tf  = document.getElementById('toggle-focus');
  if (tm)  tm.classList.toggle('on', s.reducedMotion);
  if (thc) thc.classList.toggle('on', s.highContrast);
  if (tf)  tf.classList.toggle('on', s.focusIndicators);


  // Colorblind selector
  document.querySelectorAll('[data-cb]').forEach(b => {
    b.classList.toggle('active', b.dataset.cb === s.colorblind);
  });
}

// ── Email config ─────────────────────────────────────────────────────────────

let _emailCfgLoaded = false;

async function loadEmailConfig() {
  if (_emailCfgLoaded) return;
  _emailCfgLoaded = true;
  try {
    const cfg = await api.invoke('email:get-config');
    if (!cfg) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('email-host',       cfg.host);
    set('email-port',       cfg.port || '587');
    set('email-user',       cfg.username);
    set('email-from-name',  cfg.fromName);
    set('email-default-to', cfg.defaultTo);
    const passEl = document.getElementById('email-pass');
    if (passEl && cfg.hasPassword) passEl.placeholder = '••••••••• (saved)';

    // Eye toggle for password field
    const toggle = document.getElementById('email-pass-toggle');
    const icon   = document.getElementById('email-eye-icon');
    if (toggle && passEl) {
      toggle.addEventListener('click', () => {
        const show = passEl.type === 'password';
        passEl.type = show ? 'text' : 'password';
        icon.innerHTML = show
          ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
          : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
      });
    }

    // Schedule fields
    const freq = await api.invoke('settings:get', 'email_schedule_freq') || 'off';
    const time = await api.invoke('settings:get', 'email_schedule_time') || '08:00';
    const freqEl = document.getElementById('sched-freq');
    const timeEl = document.getElementById('sched-time');
    if (freqEl) freqEl.value = freq;
    if (timeEl) timeEl.value = time;
    updateNextSendLabel();
  } catch {}
}

async function updateNextSendLabel() {
  const el = document.getElementById('sched-next-send');
  if (!el) return;
  try {
    const status = await api.invoke('email:get-schedule-status');
    if (!status || status.freq === 'off') { el.innerHTML = ''; return; }
    const parts = [];
    if (status.lastSent) parts.push(`Last sent: <strong>${new Date(status.lastSent).toLocaleString()}</strong>`);
    if (status.nextSend) parts.push(`Next send: <strong>${new Date(status.nextSend).toLocaleString()}</strong>`);
    el.innerHTML = parts.join(' &nbsp;·&nbsp; ');
    if (status.lastError) {
      el.innerHTML += `<div style="color:var(--error,#e05252);margin-top:6px;">⚠ Last error: ${status.lastError}</div>`;
    }
  } catch { el.textContent = ''; }
}

async function saveEmailConfig() {
  const get = id => (document.getElementById(id) || {}).value || '';
  const password = get('email-pass');
  const statusEl = document.getElementById('email-status-text');
  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    const res = await api.invoke('email:save-config', {
      host:       get('email-host'),
      port:       parseInt(get('email-port') || '587', 10),
      username:   get('email-user'),
      password:   password || undefined,
      fromName:   get('email-from-name'),
      defaultTo:  get('email-default-to'),
    });
    if (statusEl) statusEl.textContent = '';
    Shell.toast(res.ok ? 'Email config saved.' : `Save failed: ${res.error}`, res.ok ? 'success' : 'error');
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    Shell.toast(`Error: ${e.message}`, 'error');
  }
}

async function testEmailConfig() {
  const btn      = document.getElementById('email-test-btn');
  const statusEl = document.getElementById('email-status-text');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Testing…';
  try {
    const res = await api.invoke('email:test-smtp');
    Shell.toast(res.ok ? 'SMTP connection successful!' : `SMTP test failed: ${res.error}`, res.ok ? 'success' : 'error');
  } catch (e) {
    Shell.toast(`Error: ${e.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (statusEl) statusEl.textContent = '';
  }
}

async function sendScheduledNow() {
  const btn      = document.getElementById('sched-send-now-btn');
  const statusEl = document.getElementById('sched-send-status');
  if (btn) btn.disabled = true;
  if (statusEl) { statusEl.textContent = 'Sending…'; statusEl.style.color = 'var(--text-muted)'; }
  try {
    const res = await api.invoke('email:send-scheduled-now');
    if (res.ok) {
      Shell.toast('Scheduled report sent successfully!', 'success');
      updateNextSendLabel();
    } else {
      if (statusEl) { statusEl.textContent = res.error || 'Send failed.'; statusEl.style.color = 'var(--error,#e05252)'; }
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = e.message; statusEl.style.color = 'var(--error,#e05252)'; }
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 5000);
  }
}

async function saveScheduleConfig() {
  const freq = (document.getElementById('sched-freq') || {}).value || 'off';
  const time = (document.getElementById('sched-time') || {}).value || '08:00';
  await Promise.all([
    api.invoke('settings:set', { key: 'email_schedule_freq', value: freq }),
    api.invoke('settings:set', { key: 'email_schedule_time', value: time }),
  ]);
  api.invoke('email:trigger-schedule-check');
  updateNextSendLabel();
  Shell.toast('Schedule saved.', 'success');
}

async function loadDisplayPicker() {
  const area = document.getElementById('display-picker');
  if (!area) return;
  const [displays, savedDisp, savedMax, savedRemember] = await Promise.all([
    api.invoke('win:get-displays'),
    api.invoke('settings:get', 'win_preferredDisplay'),
    api.invoke('settings:get', 'win_startMaximized'),
    api.invoke('settings:get', 'win_rememberPosition'),
  ]);
  const saved = savedDisp || 'primary';
  const btns = [
    `<button class="s-btn${saved === 'primary' ? ' active' : ''}" data-action="applyPreferredDisplay" data-arg="primary">Primary Display</button>`
  ];
  displays.filter(d => !d.isPrimary).forEach(d => {
    const id = String(d.id);
    btns.push(`<button class="s-btn${saved === id ? ' active' : ''}" data-action="applyPreferredDisplay" data-arg="${id}">Display ${d.index} — ${d.width}×${d.height}</button>`);
  });
  area.innerHTML = `<div class="settings-btn-group">${btns.join('')}</div>`;
  const tsm = document.getElementById('toggle-start-maximized');
  const trp = document.getElementById('toggle-remember-position');
  if (tsm) tsm.classList.toggle('on', savedMax !== 'false'); // default on
  if (trp) trp.classList.toggle('on', savedRemember === 'true');
}

async function applyPreferredDisplay(displayId) {
  await api.invoke('settings:set', { key: 'win_preferredDisplay', value: displayId });
  await api.invoke('win:move-to-display', displayId);
  loadDisplayPicker();
}

async function applyWinToggle(key, btn) {
  const newVal = !btn.classList.contains('on');
  await api.invoke('settings:set', { key, value: String(newVal) });
  btn.classList.toggle('on', newVal);
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

// ── Safe Storage (Windows Hello bridge) ──────────────────────────────────────

async function loadSafeStorageStatus() {
  const area = document.getElementById('safe-storage-status');
  if (!area) return;
  try {
    const { available, enrolled } = await api.invoke('auth:safe-check');

    if (!available) {
      area.innerHTML = `<div class="settings-row-label" style="color:var(--text-muted);font-style:italic;">Secure sign-in is not available on this device.</div>`;
      return;
    }

    if (enrolled) {
      area.innerHTML = `
        <div class="toggle-row" style="align-items:flex-start;gap:12px;">
          <div class="toggle-info">
            <div class="toggle-label" style="color:var(--success,#4caf7d);">✓ Enabled</div>
            <div class="toggle-desc">Sign in without your password using your Windows account</div>
          </div>
        </div>
        <div class="dba-card" style="margin-top:12px;border-color:var(--border);">
          <div class="dba-card-header">
            <div>
              <div class="dba-card-title">Disable Secure Sign-in</div>
              <div class="dba-card-desc">You will need your password and TOTP to sign in again</div>
            </div>
            <button class="dba-trigger-btn danger" data-action="armSafeDisable">Disable</button>
          </div>
          <div id="safe-disable-confirm" style="display:none;padding:0 0 4px;">
            <div class="dba-confirm-warning" style="margin-bottom:8px;">Enter your password to confirm.</div>
            <div class="dba-confirm-row">
              <input type="password" class="dba-confirm-input" id="safe-disable-pw" placeholder="Current password" autocomplete="current-password">
              <button class="dba-confirm-btn danger" data-action="executeSafeDisable">Confirm</button>
              <button class="dba-confirm-btn" data-action="disarmSafeDisable">Cancel</button>
            </div>
            <div class="error-msg" id="safe-disable-err" style="display:none;margin-top:6px;"></div>
          </div>
        </div>`;
    } else {
      area.innerHTML = `
        <div class="dba-card" style="border-color:var(--border);">
          <div class="dba-card-header">
            <div>
              <div class="dba-card-title">Enable Secure Sign-in</div>
              <div class="dba-card-desc">Skip password &amp; TOTP — your Windows account protects the vault</div>
            </div>
            <button class="dba-trigger-btn" data-action="armSafeSetup">Enable</button>
          </div>
          <div id="safe-setup-confirm" style="display:none;padding:0 0 4px;">
            <div class="dba-confirm-warning" style="margin-bottom:8px;">Enter your current password to enroll.</div>
            <div class="dba-confirm-row">
              <input type="password" class="dba-confirm-input" id="safe-setup-pw" placeholder="Current password" autocomplete="current-password">
              <button class="dba-confirm-btn" data-action="executeSafeSetup">Enroll</button>
              <button class="dba-confirm-btn" data-action="disarmSafeSetup">Cancel</button>
            </div>
            <div class="error-msg" id="safe-setup-err" style="display:none;margin-top:6px;"></div>
          </div>
        </div>`;
    }
  } catch (e) {
    area.innerHTML = `<div class="settings-row-label" style="color:var(--danger,#e05555);">Could not load status: ${e.message}</div>`;
  }
}

function armSafeSetup() {
  document.getElementById('safe-setup-confirm').style.display = 'block';
  document.getElementById('safe-setup-pw')?.focus();
}
function disarmSafeSetup() {
  document.getElementById('safe-setup-confirm').style.display = 'none';
  const pw = document.getElementById('safe-setup-pw'); if (pw) pw.value = '';
  const err = document.getElementById('safe-setup-err'); if (err) err.style.display = 'none';
}
async function executeSafeSetup() {
  const pw  = document.getElementById('safe-setup-pw')?.value || '';
  const err = document.getElementById('safe-setup-err');
  if (!pw) { err.textContent = 'Password required.'; err.style.display = 'block'; return; }
  const res = await api.invoke('auth:safe-setup', { password: pw });
  if (!res.ok) {
    err.textContent = res.error || 'Enrollment failed.';
    err.style.display = 'block';
    const inp = document.getElementById('safe-setup-pw'); if (inp) { inp.value = ''; inp.focus(); }
    return;
  }
  Shell.toast('Secure sign-in enabled.', 'success');
  _safeStorageLoaded = false;
  loadSafeStorageStatus();
}

function armSafeDisable() {
  document.getElementById('safe-disable-confirm').style.display = 'block';
  document.getElementById('safe-disable-pw')?.focus();
}
function disarmSafeDisable() {
  document.getElementById('safe-disable-confirm').style.display = 'none';
  const pw = document.getElementById('safe-disable-pw'); if (pw) pw.value = '';
  const err = document.getElementById('safe-disable-err'); if (err) err.style.display = 'none';
}
async function executeSafeDisable() {
  const pw  = document.getElementById('safe-disable-pw')?.value || '';
  const err = document.getElementById('safe-disable-err');
  if (!pw) { err.textContent = 'Password required.'; err.style.display = 'block'; return; }
  const res = await api.invoke('auth:safe-disable', { password: pw });
  if (!res.ok) {
    err.textContent = res.error || 'Failed to disable.';
    err.style.display = 'block';
    const inp = document.getElementById('safe-disable-pw'); if (inp) { inp.value = ''; inp.focus(); }
    return;
  }
  Shell.toast('Secure sign-in disabled.', 'success');
  _safeStorageLoaded = false;
  loadSafeStorageStatus();
}

async function applyAutoLock(minutes) {
  minutes = Number(minutes);
  await Settings.set('autoLockMinutes', minutes);
  // Immediately inform main process so the timer resets with the new value
  await api.invoke('session:heartbeat');
  syncSettingsModal();
}

// ── Event delegation (CSP: no inline on* handlers) ────────────────────────────
// Every interactive element rendered by shell.js uses data-action (click) or
// data-action-change (change) instead of an inline handler, so the pages can run
// under a strict script-src 'self' CSP. A single document-level dispatcher routes
// to the named handler — this also covers dynamically-injected HTML (backup list,
// display picker, safe-storage panel) without re-wiring after each innerHTML.
function installShellDelegation() {
  if (window.__shellDelegated) return;
  window.__shellDelegated = true;

  const ACTIONS = {
    navigate:              a       => api.send('navigate', a),
    winMinimize:           ()      => api.send('win:minimize'),
    winMaximize:           ()      => api.send('win:maximize'),
    winClose:              ()      => api.send('win:close'),
    requestLock:           ()      => api.send('session:request-lock'),
    openSettings:          ()      => openSettingsModal(),
    closeSettings:         ()      => closeSettingsModal(),
    switchCat:             a       => switchSettingsCategory(a),
    applyTheme:            a       => applyTheme(a),
    applyScale:            a       => applyScale(a),
    applyTimeFormat:       a       => applyTimeFormat(a),
    applyAutoSave:         a       => applyAutoSave(Number(a)),
    applyAutoLock:         a       => applyAutoLock(Number(a)),
    applyColorblind:       a       => applyColorblind(a),
    applyToggle:           (a, el) => applyToggle(a, el),
    applyWinToggle:        (a, el) => applyWinToggle(a, el),
    applyPreferredDisplay: a       => applyPreferredDisplay(a),
    showDbaConfirm:        a       => showDbaConfirm(a),
    hideDbaConfirm:        a       => hideDbaConfirm(a),
    executeDbaClear:       a       => executeDbaClear(a),
    loadBackupList:        ()      => loadBackupList(),
    showBackupConfirm:     a       => showBackupConfirm(Number(a)),
    hideBackupConfirm:     a       => hideBackupConfirm(Number(a)),
    executeBackupRestore:  a       => executeBackupRestore(Number(a)),
    saveEmailConfig:       ()      => saveEmailConfig(),
    testEmailConfig:       ()      => testEmailConfig(),
    sendScheduledNow:      ()      => sendScheduledNow(),
    saveScheduleConfig:    ()      => saveScheduleConfig(),
    openExternal:          a       => Shell._openExternal(a),
    armSafeSetup:          ()      => armSafeSetup(),
    disarmSafeSetup:       ()      => disarmSafeSetup(),
    executeSafeSetup:      ()      => executeSafeSetup(),
    armSafeDisable:        ()      => armSafeDisable(),
    disarmSafeDisable:     ()      => disarmSafeDisable(),
    executeSafeDisable:    ()      => executeSafeDisable(),
  };

  const run = el => { const fn = ACTIONS[el.dataset.action]; if (fn) fn(el.dataset.arg, el); };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el) run(el);
  });

  document.addEventListener('change', e => {
    const el = e.target.closest('[data-action-change]');
    if (el) { const fn = ACTIONS[el.dataset.actionChange]; if (fn) fn(el.dataset.arg, el); }
  });

  // Enter activates a focused sidebar nav item (replaces its old inline onkeydown).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const el = e.target.closest('.nav-item[data-action]');
    if (el) { e.preventDefault(); run(el); }
  });
}
