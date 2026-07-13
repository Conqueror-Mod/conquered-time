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

// Collapse newlines + runs of whitespace into single spaces. Used to flatten
// multi-line Description text for PDF/CSV/email exports so the fixed-layout
// report tables never break on a long or multi-line description. The stored
// value keeps its newlines; only the exported rendering is flattened.
window.flattenText = function (v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
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
    invoices:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M3.5 1.5h6.5l2.5 2.5v10.5l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1V1.5z"/><line x1="5.5" y1="5.5" x2="9.5" y2="5.5"/><line x1="5.5" y1="8" x2="10.5" y2="8"/><line x1="5.5" y1="10.5" x2="8.5" y2="10.5"/></svg>`,
    insights:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="1.5,10.5 5.5,6.5 8.5,9 14.5,3" fill="none"/><polyline points="10.5,3 14.5,3 14.5,7" fill="none"/><line x1="1.5" y1="14.5" x2="14.5" y2="14.5" stroke-opacity="0.5"/></svg>`,
  };

  // Profile is deliberately NOT in the nav (community request, v3.19.x): it
  // lives behind the sidebar avatar (bottom-left) and Settings → Profile.
  const NAV = [
    { id: 'dashboard',  icon: IC.dashboard,  label: 'Dashboard'    },
    { id: 'companies',  icon: IC.companies,  label: 'Companies'    },
    { id: 'tracker',    icon: IC.tracker,    label: 'Time Tracker' },
    { id: 'task-timer', icon: IC.tasktimer,  label: 'Dispatch'     },
    { id: 'reports',    icon: IC.reports,    label: 'Reports'      },
    { id: 'insights',   icon: IC.insights,   label: 'Insights'     },
    { id: 'invoices',   icon: IC.invoices,   label: 'Invoices'     },
    { id: 'global-log', icon: IC.globallog,  label: 'Global Log'   },
  ];

  function buildTitlebar(pageLabel) {
    return `
    <div class="titlebar">
      <div class="titlebar-left">
        <img src="../../../assets/icon-48.png" width="20" height="20" alt="Conquered Time" style="flex-shrink:0;border-radius:3px;display:block;">
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
        <div id="sidebar-live-badge" class="sidebar-live-badge" style="display:none;">
          <div class="sidebar-live-pill">
            <span class="sidebar-live-dot"></span>
            <span class="sidebar-live-label">Live</span>
          </div>
          <span id="sidebar-live-time" class="sidebar-live-time">00:00</span>
          <span class="sidebar-timer-caption">Active Punch</span>
        </div>
        <div id="sidebar-task-timer" style="display:none;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 0;">
          <div class="sidebar-timer-dot"></div>
          <div id="sidebar-task-time" class="sidebar-timer-display">00:00</div>
          <span class="sidebar-timer-caption">Dispatch Timer</span>
        </div>
        <div id="sidebar-pomo" style="display:none;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 0;"
             data-tip="Your Pomodoro cycle — phase and time remaining. Manage it on the Dispatch page.">
          <div id="sidebar-pomo-phase" class="sidebar-timer-caption">Focus</div>
          <div id="sidebar-pomo-time" class="sidebar-timer-display">25:00</div>
          <span class="sidebar-timer-caption">Pomodoro</span>
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
        <!-- Profile lives here (not in the nav): clicking the identity block
             opens a small menu with Edit Profile. Keyboard: Enter/Space via
             the delegated dispatcher (it's a focusable data-action element). -->
        <div class="sidebar-user-identity sidebar-user-clickable" id="sidebar-user-identity"
             tabindex="0" role="button" aria-haspopup="menu" aria-label="Profile"
             data-action="toggleProfileMenu">
          <div class="sidebar-avatar" id="sidebar-avatar"></div>
          <div class="sidebar-user-text">
            <div class="sidebar-user-name">${user?.display_name || user?.username || '—'}</div>
            ${user?.display_name ? `<div class="sidebar-user-sub">${user.username}</div>` : ''}
          </div>
        </div>
        <div id="sidebar-profile-menu" class="sidebar-profile-menu" style="display:none;" role="menu">
          <button class="sidebar-profile-menu-item" role="menuitem" data-action="navigate" data-arg="profile">
            <span style="display:inline-flex;align-items:center;">${IC.profile}</span> Edit Profile
          </button>
        </div>
        <div class="sidebar-active-badge">Active Session</div>
      </div>
    </div>`;
  }

  function buildSettingsModal() {
    const NAV_ITEMS = [
      { id: 'profile',      label: 'Profile',        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>' },
      { id: 'appearance',   label: 'Appearance',    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>' },
      { id: 'window',       label: 'Window',         icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><path d="M7 4v5"/></svg>' },
      { id: 'shortcuts',    label: 'Shortcuts',      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>' },
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

            <!-- ── PROFILE ──────────────────────────────────── -->
            <!-- Access point only — the editor stays on the Profile page.
                 (Profile left the sidebar nav in v3.19.x; it lives behind the
                 avatar, and here, so there are two ways in.) -->
            <div id="settings-cat-profile" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Profile</div>
              <div class="settings-group">
                <div class="settings-group-title">Your Profile</div>
                <div class="settings-row-label" style="line-height:1.6;">
                  Display name, avatar, email, password, Work State &amp; break style, and your
                  business “Bill From” details for invoicing all live on the Profile page.
                  You can also open it any time by clicking your avatar in the bottom-left corner.
                </div>
                <button class="btn-primary" style="margin-top:12px;" data-action="openProfileFromSettings">Open Profile Page</button>
              </div>
            </div>

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

              <div class="settings-group">
                <div class="settings-group-title">Launch at Startup</div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Start with Windows</div>
                    <div class="toggle-desc">Automatically opens Conquered Time when you sign in to Windows</div>
                  </div>
                  <button class="toggle-switch" id="toggle-launch-startup" data-action="applyLaunchStartup"></button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Close to Tray</div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Minimize to tray on close</div>
                    <div class="toggle-desc">Closing the window hides it to the system tray and keeps your session running, instead of quitting</div>
                  </div>
                  <button class="toggle-switch" id="toggle-close-tray" data-action="applyCloseToTray"></button>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Start Minimized to Tray</div>
                <div class="toggle-row">
                  <div class="toggle-info">
                    <div class="toggle-label">Start hidden in the tray</div>
                    <div class="toggle-desc">When launched at startup, opens silently in the system tray instead of showing the window. Requires Launch at Startup.</div>
                  </div>
                  <button class="toggle-switch" id="toggle-start-minimized" data-action="applyStartMinimized"></button>
                </div>
              </div>
            </div><!-- /settings-cat-window -->

            <!-- ── SHORTCUTS ─────────────────────────────────── -->
            <div id="settings-cat-shortcuts" class="settings-cat-panel" style="display:none;">
              <div class="sc-title">Shortcuts</div>

              <div class="settings-group">
                <div class="settings-group-title">Global Hotkey</div>
                <div class="settings-row-label">Works anywhere in Windows, even while Conquered Time is hidden in the tray. Click the box, then press the keys you want.</div>
                <div class="sc-key-row" style="margin-top:10px;">
                  <div class="sc-key-info">
                    <div class="sc-key-name">Clock In / Out</div>
                    <div class="sc-key-desc">Clocks in on your last task if you're out, or clocks out if you're in.</div>
                  </div>
                  <div style="display:flex; gap:8px; align-items:center;">
                    <input type="text" id="punch-hotkey-input" readonly placeholder="Press a shortcut…"
                           style="width:190px; cursor:pointer;" data-tip="Click, then press e.g. Ctrl+Alt+P" />
                    <button class="s-btn" id="punch-hotkey-clear" data-action="clearPunchHotkey">Disable</button>
                  </div>
                </div>
                <div class="settings-row-label" id="punch-hotkey-status" style="margin-top:6px;"></div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Navigation</div>
                <div class="settings-row-label">Jump between pages from anywhere in the app.</div>
                <div id="sc-nav-list" class="sc-key-list" style="margin-top:10px;"></div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Actions</div>
                <div class="settings-row-label">Common commands. These are fixed for now — the global hotkey above is the customizable one.</div>
                <div id="sc-action-list" class="sc-key-list" style="margin-top:10px;"></div>
              </div>
            </div><!-- /settings-cat-shortcuts -->

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

                  <div class="dba-card" id="dba-card-company">
                    <div class="dba-card-header">
                      <div>
                        <div class="dba-card-title">Time Clock Clear — Single Company</div>
                        <div class="dba-card-desc">Removes time entries and Dispatch tasks for one selected company only. Other companies are untouched.</div>
                      </div>
                      <button class="dba-trigger-btn" data-action="showDbaConfirm" data-arg="company">Clear</button>
                    </div>
                    <div style="margin-top:10px;">
                      <select class="dba-confirm-input" id="dba-company-select" style="width:100%;">
                        <option value="">Select a company…</option>
                      </select>
                    </div>
                    <div class="dba-confirm" id="dba-confirm-company" style="display:none;">
                      <div class="dba-confirm-warning">⚠ This will permanently delete all time entries and task records for <strong id="dba-company-name">this company</strong>.</div>
                      <div class="dba-confirm-row">
                        <input class="dba-confirm-input" id="dba-input-company" placeholder='Type CONFIRM to proceed' autocomplete="off">
                        <button class="dba-confirm-btn danger" data-action="executeDbaClear" data-arg="company">Delete</button>
                        <button class="dba-confirm-btn" data-action="hideDbaConfirm" data-arg="company">Cancel</button>
                      </div>
                    </div>
                  </div>

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
                <div class="settings-group-title">Export Vault</div>
                <div class="settings-row-label">Save a portable copy of your entire vault to a location of your choice. The exported file stays encrypted and still needs your account password to open — safe to store on a USB drive or cloud folder.</div>
                <div style="margin-top:10px;">
                  <button class="s-btn" id="export-vault-btn" data-action="exportVault">Export Vault…</button>
                  <span id="export-vault-status" class="settings-row-label" style="margin-left:10px;"></span>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-group-title">Backup Library</div>
                <div class="settings-row-label">Restore from an automatic backup, or from a protected <strong>safety snapshot</strong> taken automatically just before a destructive action (a clear or a restore). Your current data is saved first as a safety checkpoint before any restore.</div>
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
                      <input class="sc-input" id="email-pass" type="password" placeholder="•••••••••" autocomplete="new-password" style="padding-right:36px;width:100%;"
                             data-tip="For Gmail/Outlook with 2-factor sign-in, your normal password won't work here — you need an app-specific password. In your email account's security settings, create an ‘App Password’ (Gmail: Security → App passwords) and paste that 16-character code here.">
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
                  <div style="grid-column:1 / -1;">
                    <div class="settings-row-label" style="margin-bottom:4px;">Companies</div>
                    <select class="sc-input" id="sched-scope" data-action-change="saveScheduleConfig" data-tip="One combined report, one report per company (each to its own Report Recipient when set), or a single company only">
                      <option value="">All Companies — one combined report</option>
                      <option value="each">Each company separately</option>
                    </select>
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
                <div class="settings-group-title">Idle Punch Reminder</div>
                <div class="settings-row-label">Nudge you to trim or close a running punch after a stretch of inactivity — before it becomes an audit issue</div>
                <div class="settings-btn-group" id="idlepunch-btns" style="margin-top:8px;">
                  <button class="s-btn" data-ip="0"  data-action="applyIdlePunch" data-arg="0">Off</button>
                  <button class="s-btn" data-ip="10" data-action="applyIdlePunch" data-arg="10">10 min</button>
                  <button class="s-btn" data-ip="15" data-action="applyIdlePunch" data-arg="15">15 min</button>
                  <button class="s-btn" data-ip="30" data-action="applyIdlePunch" data-arg="30">30 min</button>
                  <button class="s-btn" data-ip="60" data-action="applyIdlePunch" data-arg="60">1 hour</button>
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

            <!-- ── ABOUT (shared module — see components/about.js) ── -->
            <div id="settings-cat-about" class="settings-cat-panel about-panel" style="display:none;"></div>

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
    await _injectScript('../components/pomodoro.js'); // Pomodoro engine (chip + alerts on every page)
    await _injectScript('../components/punch-watch.js'); // idle forgotten-punch nudge
    await _injectScript('../components/update-notice.js'); // auto-updater toast (in-app)
    await _injectScript('../components/onboarding.js'); // first-run coach-mark tour

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
      invoices:     'Invoices',
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
    installTooltips();
    installContextMenu();
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

      // ── Module switching: Ctrl+1–7 ─────────────────────────────────────────
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const pages = ['dashboard', 'companies', 'tracker', 'task-timer', 'reports', 'invoices', 'global-log'];
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
        const idx = btns.indexOf(/** @type {HTMLElement} */ (document.activeElement));
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

    // ── Login-time notices ─────────────────────────────────────────────────
    // Flags are set by login.js after a successful login; shown once on the
    // first inner page. The encryption reassurance (first-run, until opted out)
    // takes precedence; the audit discrepancy reminder is deferred that one
    // login if the encryption notice is shown, to avoid stacked modals.
    // First-login surfaces: the onboarding tour (whose welcome step carries the
    // encryption-at-rest reassurance — the old standalone "Your data is
    // encrypted" modal was removed in its favor), else the audit login-notice.
    // Only one runs per login — never stack modals.
    let tourStarted = false;
    if (sessionStorage.getItem('audit_check_pending')) {
      sessionStorage.removeItem('audit_check_pending');
      let onboardDone = '1';
      try { onboardDone = await api.invoke('settings:get', 'ui_onboardingDone'); } catch {}
      if (!onboardDone) {
        window.Onboarding?.begin();
        tourStarted = true;
      } else {
        try {
          const n = await api.invoke('audit:count');
          if (n > 0) showAuditWarning(n, 'login');
        } catch {}
      }
    }

    // ── Sidebar active-task timer ──────────────────────────────────────────
    // Delegate to showSidebarTimer (the single tracked interval) — do NOT start a
    // second interval here. started_at is stored in ms (tasks save Date.now()).
    (async () => {
      try {
        const entry = await api.invoke('entries:get-active');
        if (!entry) return;
        // Sidebar LIVE badge: reflect the entry's open punch (clocked in, not
        // out) and count up from its clock-in. clock_in is HH:MM (24h, local);
        // combine with the entry's log_date for an epoch-ms start.
        try {
          const rows = JSON.parse(entry.rows_json || '[]');
          // Last open row — a stale never-clocked-out punch earlier in the
          // table must not drive the badge (mirrors tracker sessionStartMs).
          const opens = rows.filter(r => r.clock_in && !r.clock_out);
          const open = opens.length ? opens[opens.length - 1] : null;
          if (open && entry.log_date) {
            // Prefer the precise clock-in stamp (starts the badge at 0:00) when
            // it still matches the row's HH:MM minute; else fall back to the
            // minute-truncated computation (legacy rows / hand-edited times).
            let startMs = NaN;
            if (open.clock_in_ms) {
              const d = new Date(open.clock_in_ms);
              const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              if (hh === open.clock_in) startMs = open.clock_in_ms;
            }
            if (isNaN(startMs)) startMs = new Date(`${entry.log_date}T${open.clock_in}:00`).getTime();
            if (!isNaN(startMs)) showLiveBadge(startMs);
          }
        } catch {}
        const tasks = await api.invoke('tasks:list', entry.id);
        const active = tasks.find(t => t.item_type === 'task' && t.started_at && !t.stopped_at);
        if (!active) return;
        showSidebarTimer(active.started_at);
      } catch {}
    })();

    // Pomodoro engine (no-op unless the profile's break_style is 'pomodoro').
    window.Pomodoro?.init();
    // Idle forgotten-punch nudge (no-op unless ui_idlePunchMinutes > 0).
    window.PunchWatch?.init();
    // Auto-updater surface: available/staged toast + post-update confirmation.
    window.UpdateNotice?.init();
    // Resume an in-flight onboarding tour after a page swap (no-op otherwise).
    if (!tourStarted) window.Onboarding?.init();

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

  // ── Sidebar LIVE badge (open-punch session indicator) ────────────────────
  // Distinct from the task timer above: this reflects an open time-tracker punch
  // (clocked in, not clocked out) and counts up from that punch's clock-in.
  let _liveBadgeInterval = null;

  function showLiveBadge(startedAtMs) {
    const badge = document.getElementById('sidebar-live-badge');
    const display = document.getElementById('sidebar-live-time');
    if (!badge || !display) return;
    clearInterval(_liveBadgeInterval);
    badge.style.display = 'flex';
    function tick() {
      const secs = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      display.textContent = h > 0
        ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
        : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    tick();
    _liveBadgeInterval = setInterval(tick, 1000);
  }

  function hideLiveBadge() {
    clearInterval(_liveBadgeInterval);
    _liveBadgeInterval = null;
    const badge = document.getElementById('sidebar-live-badge');
    if (badge) badge.style.display = 'none';
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

  // ── Branded empty states ──────────────────────────────────────────────────
  // Line-art illustrations for first-run / no-data placeholders. Inline SVG
  // (CSP-safe, no external images); stroke uses currentColor so .ct-empty-art
  // tints them with var(--accent) and they follow the theme automatically.
  const EMPTY_ICONS = {
    // Three linked bubbles — the company-galaxy motif.
    companies: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="16" cy="18" r="8"/><circle cx="34" cy="14" r="5"/><circle cx="32" cy="33" r="6.5"/>'
      + '<path d="M23 15.5 29.5 14M21 23.5 27.5 29" stroke-dasharray="2 3"/></svg>',
    // Stopwatch — a tracked session.
    sessions: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="24" cy="27" r="14"/><path d="M24 27V19M24 27l6 4M20 7h8M24 7v6M37 15l2.5-2.5"/></svg>',
    // Document with lines — an invoice.
    invoices: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M13 6h15l7 7v29H13z"/><path d="M28 6v7h7"/><path d="M18 22h12M18 28h12M18 34h7"/></svg>',
  };

  // Returns an HTML string (drop into a container or a table cell). `opts`:
  //   icon:  key into EMPTY_ICONS ('companies' | 'sessions' | 'invoices')
  //   title, body: plain text (escaped)
  //   cta:   optional { label, action?, arg?, cta? } — action/arg route through
  //          the shell delegation (e.g. navigate); `cta` sets data-cta for a
  //          page-local delegated handler.
  function emptyState(opts) {
    const o = opts || {};
    const art = EMPTY_ICONS[o.icon] || EMPTY_ICONS.sessions;
    const body = o.body ? `<div class="ct-empty-body">${escapeHtml(o.body)}</div>` : '';
    let cta = '';
    if (o.cta && o.cta.label) {
      const attrs = [];
      if (o.cta.action) attrs.push(`data-action="${escapeHtml(o.cta.action)}"`);
      if (o.cta.arg) attrs.push(`data-arg="${escapeHtml(o.cta.arg)}"`);
      if (o.cta.cta) attrs.push(`data-cta="${escapeHtml(o.cta.cta)}"`);
      cta = `<button class="btn-primary ct-empty-cta" ${attrs.join(' ')}>${escapeHtml(o.cta.label)}</button>`;
    }
    return `<div class="ct-empty"><div class="ct-empty-art">${art}</div>`
      + `<div class="ct-empty-title">${escapeHtml(o.title || '')}</div>${body}${cta}</div>`;
  }

  return { init, toast, showSidebarTimer, hideSidebarTimer, showLiveBadge, hideLiveBadge, setSidebarAvatar, contextMenu: openContextMenu, emptyState };
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
  _dataCompaniesLoaded = false;
}

let _aboutInfoLoaded = false;
let _windowSettingsLoaded = false;
let _safeStorageLoaded = false;
let _dataCompaniesLoaded = false;
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

  if (cat === 'shortcuts') renderShortcutsTab();

  if (cat === 'security' && !_safeStorageLoaded) {
    _safeStorageLoaded = true;
    loadSafeStorageStatus();
  }

  if (cat === 'data' && !_dataCompaniesLoaded) {
    _dataCompaniesLoaded = true;
    loadDbaCompanySelect();
  }

  if (cat === 'about' && !_aboutInfoLoaded) {
    _aboutInfoLoaded = true;
    // Mount + wire the shared About module (components/about.js). Same asset the
    // pre-auth login About uses, so the two never drift.
    const panel = document.getElementById('settings-cat-about');
    if (panel && typeof About !== 'undefined') {
      About.mount(panel);
      About.wire({ api, toast: Shell.toast });
    }
  }
}

// Populate the per-company "Time Clock Clear" dropdown. Uses rowid-normalized
// company IDs (Store.getCompanies → Number(row.rid)); see gotcha #1.
async function loadDbaCompanySelect() {
  const sel = document.getElementById('dba-company-select');
  if (!sel) return;
  try {
    const companies = (window.Store ? await Store.getCompanies() : await api.invoke('companies:list')) || [];
    const opts = ['<option value="">Select a company…</option>'];
    companies.forEach(c => {
      const id = c.id ?? c.rid;
      opts.push(`<option value="${id}">${escapeHtml(c.name) || '(unnamed)'}</option>`);
    });
    sel.innerHTML = opts.join('');
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load companies</option>';
  }
}

function showDbaConfirm(type) {
  // Hide all other confirms first
  ['timeclock','company','companies','full'].forEach(t => {
    if (t !== type) hideDbaConfirm(t);
  });
  // Per-company clear requires a company to be selected first.
  if (type === 'company') {
    const sel = document.getElementById('dba-company-select');
    if (!sel || !sel.value) {
      Shell.toast('Choose a company to clear first.', 'error', 3000);
      return;
    }
    const nameEl = document.getElementById('dba-company-name');
    if (nameEl) nameEl.textContent = sel.options[sel.selectedIndex]?.text || 'this company';
  }
  const el = document.getElementById(`dba-confirm-${type}`);
  if (el) { el.style.display = ''; document.getElementById(`dba-input-${type}`)?.focus(); }
}

function hideDbaConfirm(type) {
  const el = document.getElementById(`dba-confirm-${type}`);
  if (el) el.style.display = 'none';
  const inp = document.getElementById(`dba-input-${type}`);
  if (inp) inp.value = '';
}

// Full-clear safety nudge. Resolves 'export' | 'continue' | 'cancel'. Built
// dynamically (CSP-safe: buttons wired via addEventListener, no inline
// handlers). Theme-aware through CSS variables; Escape cancels.
function showFullClearNudge() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'fullclear-nudge-overlay';
    overlay.setAttribute('style',
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);');
    overlay.innerHTML = `
      <div class="fullclear-nudge-card" style="max-width:440px;width:90%;background:var(--surface-1,#1a1d24);
           border:1px solid var(--border,#333);border-radius:12px;padding:22px 24px;box-shadow:var(--shadow-3,0 20px 60px rgba(0,0,0,.5));font-family:var(--sans);">
        <div style="font-size:16px;font-weight:700;color:var(--text,#eee);margin-bottom:10px;">⚠ Full Database Clear</div>
        <div style="font-size:13px;line-height:1.5;color:var(--text-muted,#aaa);margin-bottom:8px;">
          This permanently removes this profile and <strong>all of its backups</strong>, including the automatic safety snapshots. This cannot be undone.</div>
        <div style="font-size:13px;line-height:1.5;color:var(--text-muted,#aaa);margin-bottom:18px;">
          Export a portable, encrypted copy of your vault first?</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="dba-confirm-btn" data-nudge="cancel">Cancel</button>
          <button class="dba-confirm-btn" data-nudge="continue">Continue Anyway</button>
          <button class="dba-confirm-btn danger" data-nudge="export" style="background:var(--accent,#3a7);">Export &amp; Continue</button>
        </div>
      </div>`;
    const done = choice => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(choice);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done('cancel'); } };
    overlay.addEventListener('click', e => {
      const b = e.target.closest('[data-nudge]');
      if (b) { done(b.dataset.nudge); return; }
      if (e.target === overlay) done('cancel'); // click backdrop = cancel
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  });
}

async function executeDbaClear(type) {
  const inp = document.getElementById(`dba-input-${type}`);
  if (!inp || inp.value.trim() !== 'CONFIRM') {
    inp?.classList.add('dba-input-shake');
    setTimeout(() => inp?.classList.remove('dba-input-shake'), 600);
    Shell.toast('Type CONFIRM exactly to proceed.', 'error', 3000);
    return;
  }
  // Full Database Clear deletes the whole profile, its backups/ folder
  // included — so the automatic pre-action safety snapshots can't help here.
  // Nudge a portable export (to a location outside the app) before the wipe.
  if (type === 'full') {
    const choice = await showFullClearNudge();
    if (choice === 'cancel') return;
    if (choice === 'export') {
      const exp = await exportVault();
      // If the export didn't complete (cancelled the save dialog or errored),
      // don't proceed to the irreversible wipe — the user asked to save first.
      if (!exp || !exp.ok) { Shell.toast('Export not completed — wipe cancelled.', 'info', 3500); return; }
    }
    // choice === 'continue' falls through to the wipe with no export.
  }
  try {
    let res;
    if (type === 'company') {
      const sel = document.getElementById('dba-company-select');
      const companyId = sel ? Number(sel.value) : NaN;
      if (!companyId) { Shell.toast('Choose a company to clear first.', 'error', 3000); return; }
      res = await api.invoke('db:clear-timeclock-company', { companyId });
    } else {
      const channel = type === 'full' ? 'db:clear-full' : type === 'companies' ? 'db:clear-companies' : 'db:clear-timeclock';
      res = await api.invoke(channel);
    }
    if (!res?.ok) { Shell.toast('Clear failed — check console.', 'error'); return; }
    hideDbaConfirm(type);
    closeSettingsModal();
    if (type === 'full') {
      Shell.toast('Profile wiped. Returning to profile selector…', 'info', 2000);
      setTimeout(() => api.send('navigate', 'login'), 2000);
    } else {
      const msg = type === 'companies' ? 'All companies and time data cleared.'
                : type === 'company'   ? 'Time clock data cleared for the selected company.'
                : 'Time clock data cleared.';
      Shell.toast(msg, 'success', 3000);
      setTimeout(() => location.reload(), 1500);
    }
  } catch(e) { Shell.toast('Error: ' + e.message, 'error'); }
}

// Public outbound links, opened in the user's default browser via the
// shell:open-external IPC (which validates https?:// before shell.openExternal).
const EXTERNAL_URLS = {
  github: 'https://github.com/Conqueror-Mod/conquered-time',
  donate: 'https://ko-fi.com/christheconqueror',
  // GitHub Sponsors is pending approval — once live, add a button with
  // data-arg="sponsor" and set the verified URL here.
  // sponsor: 'https://github.com/sponsors/<handle>',
};
Shell._openExternal = function(type) {
  const url = EXTERNAL_URLS[type];
  if (!url) { Shell.toast('Link coming soon — stay tuned!', 'info', 2500); return; }
  api.send('shell:open-external', url);
};

Shell._openUpdateUrl = function(url) {
  if (!url) { Shell.toast('No download URL configured yet.', 'info', 2500); return; }
  api.send('shell:open-external', url);
};

// ── Portable vault export ──────────────────────────────────────────────────
// Copies the encrypted vault to a user-chosen location (save dialog in main).
// Returns the MutResult so callers (e.g. the full-clear nudge) can branch on
// whether the export actually completed vs. was cancelled.
async function exportVault() {
  const btn = document.getElementById('export-vault-btn');
  const status = document.getElementById('export-vault-status');
  if (btn) btn.disabled = true;
  if (status) { status.textContent = 'Choose where to save…'; status.style.color = ''; }
  try {
    const res = await api.invoke('backup:export-portable');
    if (res && res.ok) {
      if (status) status.textContent = 'Exported ✓';
      Shell.toast('Vault exported (encrypted).', 'success', 3000);
    } else if (res && res.canceled) {
      if (status) status.textContent = '';
    } else {
      if (status) { status.textContent = 'Export failed.'; status.style.color = 'var(--red)'; }
      Shell.toast('Export failed: ' + ((res && res.error) || 'unknown error'), 'error');
    }
    return res || { ok: false };
  } catch (e) {
    if (status) { status.textContent = 'Export failed.'; status.style.color = 'var(--red)'; }
    Shell.toast('Export error: ' + e.message, 'error');
    return { ok: false, error: e.message };
  } finally {
    if (btn) btn.disabled = false;
  }
}

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
      // Safety snapshots (taken just before a destructive action) get a badge
      // and their reason so they stand out from routine autosave copies.
      const badge = b.kind === 'safety'
        ? `<span class="backup-badge-safety" title="Protected snapshot taken before a destructive action">🛡 ${escapeHtml(b.reason || 'Safety Snapshot')}</span>`
        : '';
      return `
        <div class="backup-row${b.kind === 'safety' ? ' backup-row-safety' : ''}" id="brow-${i}" style="flex-shrink:0;">
          <div class="backup-row-main">
            <div>
              <div class="backup-row-ts">${dt}${badge}</div>
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

  // Idle-punch reminder buttons
  document.querySelectorAll('[data-ip]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.ip, 10) === s.idlePunchMinutes);
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
    const freq  = await api.invoke('settings:get', 'email_schedule_freq') || 'off';
    const time  = await api.invoke('settings:get', 'email_schedule_time') || '08:00';
    const scope = await api.invoke('settings:get', 'email_schedule_scope') || '';
    const freqEl = document.getElementById('sched-freq');
    const timeEl = document.getElementById('sched-time');
    if (freqEl) freqEl.value = freq;
    if (timeEl) timeEl.value = time;
    // Scope select: the two fixed options live in the markup; individual
    // companies are appended here so the list always matches the vault.
    const scopeEl = document.getElementById('sched-scope');
    if (scopeEl) {
      try {
        const companies = await Store.getCompanies();
        scopeEl.querySelectorAll('option[data-co]').forEach(o => o.remove());
        (companies || []).forEach(c => {
          const opt = document.createElement('option');
          opt.value = String(c.id);
          opt.textContent = `Only: ${c.name}`;
          opt.dataset.co = '1';
          scopeEl.appendChild(opt);
        });
      } catch {}
      scopeEl.value = scope;
      if (scopeEl.value !== scope) scopeEl.value = ''; // stored company no longer exists
    }
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
  const freq  = (document.getElementById('sched-freq') || {}).value || 'off';
  const time  = (document.getElementById('sched-time') || {}).value || '08:00';
  const scope = (document.getElementById('sched-scope') || {}).value || '';
  await Promise.all([
    api.invoke('settings:set', { key: 'email_schedule_freq', value: freq }),
    api.invoke('settings:set', { key: 'email_schedule_time', value: time }),
    api.invoke('settings:set', { key: 'email_schedule_scope', value: scope }),
  ]);
  api.invoke('email:trigger-schedule-check');
  updateNextSendLabel();
  Shell.toast('Schedule saved.', 'success');
}

async function loadDisplayPicker() {
  const area = document.getElementById('display-picker');
  if (!area) return;
  const [displays, currentDisp, savedMax, savedRemember, savedLaunch, savedCloseTray] = await Promise.all([
    api.invoke('win:get-displays'),
    // highlight from the display the window is ACTUALLY on (follows manual
    // drags), not the stored win_preferredDisplay pref
    api.invoke('win:get-current-display').catch(() => 'primary'),
    api.invoke('settings:get', 'win_startMaximized'),
    api.invoke('settings:get', 'win_rememberPosition'),
    api.invoke('win:get-launch-at-startup'),  // OS login item is source of truth
    api.invoke('win:get-close-to-tray'),       // app-global pref (not per-profile)
  ]);
  const savedStartMin = await api.invoke('win:get-start-minimized');
  const saved = currentDisp || 'primary';
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
  const tls = document.getElementById('toggle-launch-startup');
  const tct = document.getElementById('toggle-close-tray');
  if (tls) tls.classList.toggle('on', savedLaunch === true);
  if (tct) tct.classList.toggle('on', savedCloseTray === true);
  const tsmin = document.getElementById('toggle-start-minimized');
  if (tsmin) tsmin.classList.toggle('on', savedStartMin === true);
}

// ── Shortcuts tab ───────────────────────────────────────────────────────────
// Reference list of every app shortcut (grouped) + the one editable control,
// the global punch hotkey. The lists are the single source of truth for what
// the app's key bindings ARE — keep them in sync with the real handlers:
//   navigation Ctrl+1–7  → shell.js keydown (Module switching)
//   Ctrl+,               → shell.js keydown (open Settings)
//   Ctrl+L/P/Q, F12      → main.ts buildMenu accelerators
function renderShortcutsTab() {
  const nav = document.getElementById('sc-nav-list');
  const act = document.getElementById('sc-action-list');
  const kbd = (combo) => combo.split('+').map(k => `<kbd class="sc-kbd">${escapeHtml(k)}</kbd>`).join('<span class="sc-plus">+</span>');
  const row = ({ name, keys }) => `<div class="sc-key-row"><div class="sc-key-info"><div class="sc-key-name">${escapeHtml(name)}</div></div><div class="sc-key-combo">${kbd(keys)}</div></div>`;
  if (nav) nav.innerHTML = [
    { name: 'Dashboard',   keys: 'Ctrl+1' },
    { name: 'Companies',   keys: 'Ctrl+2' },
    { name: 'Time Tracker',keys: 'Ctrl+3' },
    { name: 'Dispatch',    keys: 'Ctrl+4' },
    { name: 'Reports',     keys: 'Ctrl+5' },
    { name: 'Invoices',    keys: 'Ctrl+6' },
    { name: 'Global Log',  keys: 'Ctrl+7' },
    { name: 'Open Settings', keys: 'Ctrl+,' },
  ].map(row).join('');
  if (act) act.innerHTML = [
    { name: 'Lock Session',   keys: 'Ctrl+L' },
    { name: 'Export PDF',     keys: 'Ctrl+P' },
    { name: 'Quit',           keys: 'Ctrl+Q' },
    { name: 'Toggle Developer Tools', keys: 'F12' },
  ].map(row).join('');
  loadPunchHotkey();
}

// ── Punch hotkey (app-global, like close-to-tray) ───────────────────────────
// A readonly capture box: focus it, press a combo, it's saved immediately.
// Main tries the OS registration before committing — a collision rolls back
// to the previous binding and surfaces the error here.
async function loadPunchHotkey() {
  const input = /** @type {HTMLInputElement & { __hotkeyWired?: boolean }} */ (document.getElementById('punch-hotkey-input'));
  if (!input) return;
  const current = await api.invoke('win:get-punch-hotkey').catch(() => '');
  input.value = current || '';
  input.placeholder = current ? '' : 'Disabled — click and press a shortcut';
  if (!input.__hotkeyWired) {
    input.__hotkeyWired = true; // wired once; loadDisplayPicker re-runs on each tab open
    input.addEventListener('keydown', async e => {
      e.preventDefault();
      if (e.key === 'Escape' || e.key === 'Tab') { input.blur(); return; }
      // Modifier alone isn't a binding — wait for the full chord.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const mods = [];
      if (e.ctrlKey)  mods.push('Control');
      if (e.altKey)   mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey)  mods.push('Super');
      // Require at least one modifier so a bare letter can't eat all typing OS-wide.
      if (!mods.length) { setPunchHotkeyStatus('Include Ctrl, Alt or Shift in the shortcut.', true); return; }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!/^[A-Za-z0-9]+$/.test(key)) return; // F-keys ok; skip Dead/Arrow-with-symbol etc.
      await savePunchHotkey([...mods, key].join('+'));
      input.blur();
    });
  }
}
function setPunchHotkeyStatus(msg, isError) {
  const el = document.getElementById('punch-hotkey-status');
  if (el) { el.textContent = msg || ''; el.style.color = isError ? 'var(--danger, #e5484d)' : ''; }
}
async function savePunchHotkey(accel) {
  const res = await api.invoke('win:set-punch-hotkey', accel);
  if (res && res.ok) {
    setPunchHotkeyStatus(accel ? `Saved — ${accel} now punches from anywhere.` : 'Punch hotkey disabled.');
  } else {
    setPunchHotkeyStatus((res && res.error) || 'Could not register that shortcut.', true);
  }
  await loadPunchHotkey();
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

async function applyLaunchStartup(btn) {
  const newVal = !btn.classList.contains('on');
  await api.invoke('win:set-launch-at-startup', newVal); // OS login item is the store
  btn.classList.toggle('on', newVal);
}

async function applyCloseToTray(btn) {
  const newVal = !btn.classList.contains('on');
  await api.invoke('win:set-close-to-tray', newVal); // app-global pref (not per-profile)
  btn.classList.toggle('on', newVal);
}

async function applyStartMinimized(btn) {
  const newVal = !btn.classList.contains('on');
  await api.invoke('win:set-start-minimized', newVal); // app-global pref
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

  // An exit/lock/login interrupt supersedes any transient in-page modal (e.g.
  // the invoice preview / numbering dialogs). Close open .modal-overlay layers
  // first so we never stack the audit warning on top of another modal —
  // discarding them is safe (nothing there is committed until its own action).
  document.querySelectorAll('.modal-overlay.show').forEach(el => el.classList.remove('show'));

  const noun = count === 1 ? 'discrepancy' : 'discrepancies';
  if (action === 'login') {
    body.innerHTML = `<strong style="color:var(--text-white);">${count} audit ${noun}</strong> detected in your session log — entries with missing clock-ins/outs, zero duration, unusual hours, or missing breaks.<br><br>Review now?`;
    dismissBtn.textContent = 'Dismiss';
  } else {
    const verb = action === 'close' ? 'closing' : 'locking';
    body.innerHTML = `<strong style="color:var(--text-white);">${count} audit ${noun}</strong> detected in your session log — entries with missing clock-outs, zero duration, or unusual hours.<br><br>Review before ${verb}?`;
    dismissBtn.textContent = action === 'close' ? 'Close Anyway' : 'Lock Anyway';
  }

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
    if (action === 'close')     api.send('session:confirm-close');
    else if (action === 'lock') api.send('session:confirm-lock');
    // action === 'login' → informational only; just close the modal.
  };
}

// (The standalone first-login "Your data is encrypted" modal was removed —
// the onboarding tour's welcome step now carries that reassurance. Old
// ui_encryptionNoticeAck values in existing vaults are simply ignored.)

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

async function applyIdlePunch(minutes) {
  await Settings.set('idlePunchMinutes', Number(minutes));
  // The watcher reads the live Settings value each tick, so no restart needed.
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
    applyIdlePunch:        a       => applyIdlePunch(Number(a)),
    applyColorblind:       a       => applyColorblind(a),
    applyToggle:           (a, el) => applyToggle(a, el),
    applyWinToggle:        (a, el) => applyWinToggle(a, el),
    applyLaunchStartup:    (a, el) => applyLaunchStartup(el),
    applyCloseToTray:      (a, el) => applyCloseToTray(el),
    applyStartMinimized:   (a, el) => applyStartMinimized(el),
    clearPunchHotkey:      ()      => savePunchHotkey(''),
    applyPreferredDisplay: a       => applyPreferredDisplay(a),
    showDbaConfirm:        a       => showDbaConfirm(a),
    hideDbaConfirm:        a       => hideDbaConfirm(a),
    executeDbaClear:       a       => executeDbaClear(a),
    loadBackupList:        ()      => loadBackupList(),
    exportVault:           ()      => exportVault(),
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
    toggleProfileMenu:     ()      => toggleProfileMenu(),
    openProfileFromSettings: ()    => { closeSettingsModal(); api.send('navigate', 'profile'); },
  };

  function toggleProfileMenu() {
    const menu = document.getElementById('sidebar-profile-menu');
    if (menu) menu.style.display = menu.style.display === 'none' ? '' : 'none';
  }

  const run = el => { const fn = ACTIONS[el.dataset.action]; if (fn) fn(el.dataset.arg, el); };

  document.addEventListener('click', e => {
    // Any click outside the identity block closes the profile menu (including
    // clicks on its own Edit Profile item — navigation replaces the page anyway).
    const menu = document.getElementById('sidebar-profile-menu');
    if (menu && menu.style.display !== 'none' && !e.target.closest('#sidebar-user-identity')) {
      menu.style.display = 'none';
    }
    const el = e.target.closest('[data-action]');
    if (el) run(el);
  });

  document.addEventListener('change', e => {
    const el = e.target.closest('[data-action-change]');
    if (el) { const fn = ACTIONS[el.dataset.actionChange]; if (fn) fn(el.dataset.arg, el); }
  });

  // Enter activates a focused sidebar nav item (replaces its old inline
  // onkeydown); also the avatar identity block (role="button") and its menu.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && !(e.key === ' ' && e.target.closest('[role="button"]'))) return;
    const el = e.target.closest('.nav-item[data-action], [role="button"][data-action], .sidebar-profile-menu-item[data-action]');
    if (el) { e.preventDefault(); run(el); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Hover/focus tooltips. Any element with data-tip="text" shows a themed bubble
// after a short delay (immediately on keyboard focus). One shared floating
// element + document-level delegated listeners, so it works on dynamically-
// injected markup with no re-wiring — same pattern as installShellDelegation.
// Optional data-tip-pos="top|bottom|left|right" (default top); the preferred
// side flips automatically if it would clip the viewport. Text is set via
// textContent, so tip copy can never inject markup.
// ═══════════════════════════════════════════════════════════════════════════
function installTooltips() {
  if (window.__tooltipsInstalled) return;
  window.__tooltipsInstalled = true;

  const SHOW_DELAY = 400;   // ms before a hover tip appears
  const GAP = 8;            // px between target and bubble
  const EDGE = 6;           // min px between bubble and viewport edge

  /** @type {HTMLElement|null} */ let tipEl = null;
  /** @type {Element|null} */     let currentTarget = null;
  let showTimer = 0;

  function ensureEl() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'ct-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  /** @param {Element} target */
  function place(target) {
    const el = ensureEl();
    const r  = target.getBoundingClientRect();
    const tw = el.offsetWidth, th = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;

    const fits = {
      top:    r.top - th - GAP >= EDGE,
      bottom: r.bottom + th + GAP <= vh - EDGE,
      left:   r.left - tw - GAP >= EDGE,
      right:  r.right + tw + GAP <= vw - EDGE,
    };
    const pref = target.getAttribute('data-tip-pos') || 'top';
    const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const pos = fits[pref] ? pref : (fits[flip[pref]] ? flip[pref] : (fits.top ? 'top' : 'bottom'));

    let x, y;
    if (pos === 'top' || pos === 'bottom') {
      x = r.left + r.width / 2 - tw / 2;
      y = pos === 'top' ? r.top - th - GAP : r.bottom + GAP;
    } else {
      x = pos === 'left' ? r.left - tw - GAP : r.right + GAP;
      y = r.top + r.height / 2 - th / 2;
    }
    // Clamp to the viewport (long tips near an edge).
    x = Math.max(EDGE, Math.min(x, vw - tw - EDGE));
    y = Math.max(EDGE, Math.min(y, vh - th - EDGE));
    el.style.left = `${Math.round(x)}px`;
    el.style.top  = `${Math.round(y)}px`;
  }

  /** @param {Element} target */
  function show(target) {
    if (!target.isConnected) { hide(); return; }
    // Never compete with the onboarding tour — its overlay/card is the only
    // guidance on screen while a tour step is up (autofocused fields were
    // popping their focus-tooltip over the coach-mark card).
    if (document.getElementById('ct-tour-overlay')) { hide(); return; }
    const text = target.getAttribute('data-tip');
    if (!text) return;
    const el = ensureEl();
    el.textContent = text;
    // Render invisible first so offsetWidth/Height measure the final size.
    el.classList.remove('visible');
    place(target);
    el.classList.add('visible');
  }

  function hide() {
    clearTimeout(showTimer);
    currentTarget = null;
    if (tipEl) tipEl.classList.remove('visible');
  }

  /** @param {Element} target @param {number} delay */
  function schedule(target, delay) {
    if (target === currentTarget) return;
    hide();
    currentTarget = target;
    showTimer = window.setTimeout(() => { if (currentTarget === target) show(target); }, delay);
  }

  document.addEventListener('mouseover', e => {
    const t = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (t) schedule(t, SHOW_DELAY);
  });
  document.addEventListener('mouseout', e => {
    if (!currentTarget) return;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (!to || !currentTarget.contains(to)) hide();
  });
  // Keyboard focus shows immediately (a11y); blur hides.
  document.addEventListener('focusin', e => {
    const t = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (t) schedule(t, 0);
  });
  document.addEventListener('focusout', hide);
  // Anything that changes what's under the cursor kills the tip.
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

// ── Shared context menu ──────────────────────────────────────────────────────
// One reusable floating menu any surface opens via Shell.contextMenu(ev, items).
// items: [{ label, action, danger?, disabled?, hidden? } | { separator:true } | null].
// CSP-safe (delegated click, no inline on*), positioned at the cursor and
// clamped to the viewport, dismissed on outside-click / scroll / Escape / blur.
/** @type {HTMLElement|null} */ let _ctxMenuEl = null;
/** @type {Array<any>} */       let _ctxItems = [];

function installContextMenu() {
  if (window.__ctxMenuInstalled) return;
  window.__ctxMenuInstalled = true;

  const el = document.createElement('div');
  el.id = 'ct-context-menu';
  el.setAttribute('role', 'menu');
  el.style.display = 'none';
  document.body.appendChild(el);
  _ctxMenuEl = el;

  // Delegated item dispatch — survives innerHTML rebuilds, no per-item wiring.
  el.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.ctx-item') : null;
    if (!btn || btn.hasAttribute('disabled')) return;
    const item = _ctxItems[Number(btn.getAttribute('data-i'))];
    closeContextMenu();
    if (item && typeof item.action === 'function') item.action();
  });

  // Dismissal — capture-phase so it wins over the surface underneath.
  document.addEventListener('mousedown', (e) => {
    if (el.style.display !== 'none' && !(e.target instanceof Node && el.contains(e.target))) closeContextMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); }, true);
  window.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);
  window.addEventListener('blur', closeContextMenu);
}

function closeContextMenu() {
  if (_ctxMenuEl) _ctxMenuEl.style.display = 'none';
  _ctxItems = [];
}

/**
 * Open the shared context menu at the event position.
 * @param {MouseEvent} ev
 * @param {Array<{label?:string, action?:Function, danger?:boolean, disabled?:boolean, hidden?:boolean, separator?:boolean}|null>} items
 */
function openContextMenu(ev, items) {
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  if (!_ctxMenuEl) installContextMenu();
  const el = _ctxMenuEl;

  // Drop hidden entries; collapse consecutive/leading/trailing separators.
  /** @type {any[]} */
  const clean = [];
  for (const it of (items || [])) {
    if (!it || it.separator) {
      if (clean.length && !clean[clean.length - 1]._sep) clean.push({ _sep: true });
      continue;
    }
    if (it.hidden) continue;
    clean.push(it);
  }
  while (clean.length && clean[clean.length - 1]._sep) clean.pop();
  if (!clean.some(it => !it._sep)) return;   // nothing actionable
  _ctxItems = clean;

  el.innerHTML = clean.map((it, i) => it._sep
    ? '<div class="ctx-sep"></div>'
    : `<button type="button" class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}"${it.disabled ? ' disabled' : ''}>${escapeHtml(it.label || '')}</button>`
  ).join('');

  // Measure hidden, then position at the cursor and clamp to the viewport.
  el.style.visibility = 'hidden';
  el.style.display = 'block';
  el.style.left = '0px';
  el.style.top = '0px';
  const mw = el.offsetWidth, mh = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, EDGE = 6;
  let x = ev.clientX, y = ev.clientY;
  if (x + mw + EDGE > vw) x = Math.max(EDGE, x - mw);
  if (y + mh + EDGE > vh) y = Math.max(EDGE, y - mh);
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  el.style.visibility = 'visible';
}
