// ── About — shared, self-contained module ────────────────────────────────────
// One source of truth for the About panel, mounted in BOTH the pre-auth login
// settings modal and the post-login in-app settings modal, so the two can never
// drift again. The module owns its markup, its changelog data, its outbound
// links, and its own event wiring (it attaches listeners directly to the
// buttons it renders — it does NOT rely on either page's data-action
// dispatcher, which keeps it drop-in for any container).
//
// Usage:
//   container.innerHTML = About.buildPanel();      // or About.mount(container)
//   About.wire({ api, toast });                    // fills build info + wires buttons
//
// CSP note: no inline handlers, no inline <script> — wiring is addEventListener
// inside wire(). Styling reuses the existing `about-*` classes in
// design-system.css, which both the login page and inner pages already load.
const About = (() => {
  // Public outbound links — opened in the user's browser via shell:open-external
  // (main validates https?:// before shell.openExternal).
  const URLS = {
    github: 'https://github.com/Conqueror-Mod/conquered-time',
    donate: 'https://ko-fi.com/christheconqueror',
  };

  // Changelog — newest first. Edit HERE and both About surfaces update. The two
  // most recent entries render in-panel; older notes live on GitHub Releases.
  const CHANGELOG = [
    { version: 'v3.21.0', items: [
      'Punch from the tray or a global hotkey — Clock In / Clock Out without opening the app. Right-click the tray icon to punch, or press the hotkey (default Ctrl+Alt+P) from anywhere: it clocks in on your last task if you\'re out, clocks out if you\'re in, even while the app is hidden in the tray. Rebind or disable it under Settings → Window',
      'Week view — the Dashboard now shows your week at a glance: a seven-day band of session blocks (colored per company, sized by hours) with day totals and prev/next week paging. Click any block to jump to that session in the Tracker',
      'Data safety net — before any destructive action (deleting a company, clearing time data, or restoring a backup) the app now saves a protected safety snapshot, kept separately from the routine backups so a busy day can\'t prune it away and labelled with what it was taken before. Plus a new Export Vault button (Settings → Data) saves a portable, still-encrypted copy of your whole vault anywhere you like, and Full Database Clear offers to export first before it wipes everything',
    ] },
    { version: 'v3.20.1', items: [
      'Window placement fix — the app now reopens on the display it was closed on, and remembers its last size and position more reliably',
    ] },
    { version: 'v3.20.0', items: [
      'Company Galaxy — the company web, reimagined. Companies are packed bubbles sized by hours (over a 30-day / 90-day / all-time window), with idle and ended companies folding into an expandable Archive cluster and per-company identity colors that fade as a client goes idle (colorblind-safe palette + right-click color picker)',
      'It also went hierarchical: each company is a galaxy that opens into its projects and platforms, which break down into their IDs and logins — click to expand in place, click deeper to zoom (a breadcrumb backs you out), right-click for galaxy- and project-level menus',
      'The company list gained matching company › project grouping, and the dashboard mini-web jumps you straight into a company\'s galaxy',
    ] },
    { version: 'v3.19.1', items: [
      'Profile moved — it now lives behind your avatar in the bottom-left corner (click it → Edit Profile) and under Settings → Profile, instead of taking a slot in the navigation. (Community request)',
      'Setup guide polish — the Profile step now points at your avatar and walks through saving your billing details, a new Insights step explains the analytics page, and the flash between tour steps is gone (the dim now carries smoothly across pages)',
      'Multi-monitor fix — the audit wizard and the startup splash now open on the monitor the app is actually on, instead of always the primary display',
    ] },
    { version: 'v3.19.0', items: [
      'New Insights page — an analytics dashboard with hours trends over time, busiest days & times, client mix, and estimated earnings (hours × each client\'s rate). Pick a range: 30 days, 90 days, 1 year, or all time',
      'Company search & filters — find a client fast on the Companies page: live search across names, projects and roles, plus Active/Ended and work-type filters. The company web dims non-matching companies so the graph follows your filter',
      'Redesigned exports — the tracker and Global Log PDF timesheets now match the branded report style (with a summary band and label breakdown), and the Global Log CSV gains a totals summary at the end',
      'Bigger toast notifications — all in-app notices are ~35% larger and easier to catch',
      'Reliability: two save paths that could silently overwrite a newer change (session autosave and the audit Apply Fix) now detect the conflict and refresh instead of losing data',
    ] },
    { version: 'v3.18.2', items: [
      'Maintenance release — verifies the new in-app update notice end to end. No feature changes',
    ] },
    { version: 'v3.18.1', items: [
      'Updates are easier to notice — when a new version is available you now get a clear notice on the sign-in screen (and inside the app) with a one-click Download & Install, instead of it only showing under Settings → About',
      'After an update installs, the app confirms it on next launch with a "Updated to vX" message, so you can tell the update actually went through',
    ] },
    { version: 'v3.18.0', items: [
      'Proactive punch reminder — if you leave a session running and step away, Conquered Time can now nudge you to trim or close the punch before it turns into an audit discrepancy. Turn it on under Settings → Security → Idle Punch Reminder (off by default; choose 10 / 15 / 30 / 60 minutes). The reminder offers to clock out at the time you actually went idle, clock out now, or keep working — it never punches for you',
    ] },
    { version: 'v3.17.0', items: [
      'Automatic updates — the app now checks GitHub for new versions, downloads the update in the background with a progress bar, and installs it on restart. Check anytime under Settings → About → Updates',
      'Fixed: exported and emailed invoice PDFs were missing the invoice number in the header — they now show it correctly',
      'Fixed: the active-session timer sometimes started a few seconds in (5, 12, 24s…) instead of at 0:00',
      'Fixed: a stray default window could pop up first when the app auto-launched at Windows login — it now opens straight to the app',
      'Tidied the About page spacing',
    ] },
    { version: 'v3.16.0', items: [
      'New Invoices tab — turn your tracked hours into client invoices. Pick a company and date range, preview, and issue a numbered invoice with per-day line items built from your logged time',
      'Set an hourly rate and currency per company, and add your business details (name, address, tax ID, payment instructions) on the Profile page — they become the invoice’s “Bill From” block',
      'Each invoice supports optional tax and payment terms (Net 15/30/etc. with a due date), and lives in a ledger you can mark Paid, Unpaid, or Void',
      'Save any invoice as a branded PDF or email it straight to the company’s Report Recipient',
      'The window titlebar now shows the current app icon (it was still using an older one)',
    ] },
    { version: 'v3.15.0', items: [
      'Scheduled reports can now be scoped by company: one combined report (as before), a single company only, or one report per company — pick under Settings → Reports → Scheduled Reports → Companies',
      'New Report Recipient field on each company — per-company scheduled reports are emailed there instead of your default recipient, so each client can get their own report automatically',
      'In per-company mode, companies with no work in the period are skipped — clients never receive an empty report',
      'Dropdown menus now open with the theme’s colors on dark themes instead of a white popup with washed-out text',
    ] },
    { version: 'v3.14.1', items: [
      'Scheduled email reports are skipped when there was no work in the period — no more empty reports the morning after a day off (manual Send Now still always sends)',
      'The display picker in Settings → Window now highlights the monitor the app is actually on, and dragging the window to another monitor updates the preference — the app reopens on that monitor next launch',
    ] },
    { version: 'v3.14.0', items: [
      'Emailed reports redesigned — a branded, professional PDF with a summary band (total time, days worked, sessions, companies) plus Daily Hours, By Company, and Task Label breakdowns. Scheduled and Send Now reports now share the exact same layout',
      'The CSV attachment now covers exactly the period and company you selected (it previously included your entire history regardless of the filter) and ends with a totals summary — per company and per task label',
      'Reliability hardening under the hood: a property-based test suite now exercises the encryption, audit, and re-encryption engines against thousands of randomized inputs — one long-standing edge case in row detection was found and fixed along the way',
    ] },
    { version: 'v3.13.1', items: [
      'Emailed reports (scheduled and Send Now) carry your full task data again — labels, punches, and descriptions were coming through blank in the CSV and PDF',
      'Setup guide polish: cards now sit beside the content they explain, going Back through the Reports steps lands on the right tab, steps appear instantly, and the example data no longer flickers',
      'The About page spacing between the version badge and tagline is now consistent everywhere (it collapsed to nothing on the login screen)',
      'Updated the Ko-fi link',
    ] },
    { version: 'v3.13.0', items: [
      'Hover help everywhere it matters — tooltips on the tracker fields, Profile settings, Dispatch, and every Dashboard button. Hover (or keyboard-focus) a control for a hint',
      'New Break Style on your Profile: keep your state’s break/lunch rules, or switch to Pomodoro focus/break cycles (Classic 25/5, Extended 50/10, or Gentle 90/15)',
      'Pomodoro mode runs a live cycle on the Dispatch page with a countdown in the sidebar; break alerts offer a one-click punch — nothing is ever logged automatically, and audits still follow your state’s rules',
      'New here? A first-login setup guide now walks you through your profile, first company, clocking in, and Dispatch — replay it anytime from Settings → About',
    ] },
    { version: 'v3.12.0', items: [
      'UI Scale now zooms the whole window uniformly — sidebar, title bar, menus, and content together — and updates instantly, so changing it in Settings gives immediate visible feedback (previously only the main content scaled, behind the Settings window)',
    ] },
    { version: 'v3.11.9', items: [
      'Fixed a lockout / "attempts remaining" warning from one profile showing on another profile’s login or new-account screen',
      'The account-creation screen now scrolls on smaller monitors, so the buttons are always reachable',
      'The "Scan with Google Authenticator" caption above the setup QR is now legible on the default theme',
    ] },
    { version: 'v3.11.8', items: [
      'Critical fix: brand-new accounts created since v3.10.1 were missing part of their database and hit a "no such table" error on login or when adding data. Fresh accounts now build their full database correctly, and existing affected accounts self-repair on next login — no data loss',
    ] },
    { version: 'v3.11.7', items: [
      'The installer’s welcome screen now shows the new app icon, matching the splash',
    ] },
    { version: 'v3.11.6', items: [
      'Fixed a blank screen after redeeming a beta key on a fresh install — new users now land on the account-setup screen as expected',
    ] },
    { version: 'v3.11.5', items: [
      'A sharper startup — the splash screen now uses the full-resolution app icon',
    ] },
    { version: 'v3.11.4', items: [
      'The company web never lets spheres overlap now — even a busy network (or a small panel) lays out with clean gaps between every node, on both the Dashboard and the Companies page',
    ] },
    { version: 'v3.11.3', items: [
      'The two sidebar counters are now labelled — “Active Punch” (your live session clock) and “Dispatch Timer” (the running task) — so it’s clear at a glance which is which',
    ] },
    { version: 'v3.11.2', items: [
      'The Dashboard’s company web now matches the full Companies web — organic force-simulated layout, names and roles rendered inside each sphere, hours below, and hover tooltips',
      'The About page is now one shared panel — the login screen and the in-app Settings show identical version notes, Check for Updates, and GitHub / Ko-fi links',
    ] },
    { version: 'v3.11.1', items: [
      'The LIVE badge now means what it says — it lights up only while a session is genuinely running (clocked in, not yet out), instead of the moment you pick a company',
      'A matching LIVE indicator now sits in the sidebar and counts up in real time, right above the Dispatch timer',
    ] },
    { version: 'v3.11', items: [
      'A sleeker look — all five themes redesigned with real depth, frosted-glass panels, and a soft glow tuned to each theme’s own color',
      'Dark themes (Zanarkand, Treno, Nibelheim) now glow from within; the light themes (Memoria, Rabanastre) gained crisp, refined depth without the glare',
      'Focused fields, the active menu item, and primary buttons now light up in your theme’s accent — the app feels alive',
      'Under the hood: the entire app was rebuilt on TypeScript for reliability — same features, fewer bugs',
    ] },
    { version: 'v3.10', items: [
      'Company web nodes now grow to fit long company names — no more clipped labels on either web',
      'Type times the way you read them — the tracker’s inline time editor accepts 2:30 PM when you’re in 12-hour mode',
      'Two sessions on one date? A picker now lets you choose, and the Global Log opens the exact session you clicked',
      'Rows holding only a description are no longer invisible — they show in the Global Log, exports, and the audit',
      'A task or break left running after its session ended is now stopped automatically at your next sign-in',
      'Future-dated sessions are badged in the Global Log and no longer crowd Recent Activity',
    ] },
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function changelogHTML() {
    // Render the two most recent releases; the first is the headline "What's New".
    const shown = CHANGELOG.slice(0, 2);
    const blocks = shown.map((rel, i) => {
      const title = i === 0 ? `What's New — ${esc(rel.version)}` : esc(rel.version);
      const lis = rel.items.map(t => `<li>${esc(t)}</li>`).join('');
      return `
        <div class="about-section">
          <div class="about-section-title">${title}</div>
          <ul class="about-changelog">${lis}</ul>
        </div>`;
    }).join('');
    return blocks + `
      <div class="about-section">
        <div class="about-changelog-more">
          Showing the two most recent releases. Older release notes are available on
          <button class="about-changelog-link" id="about-more-github">GitHub</button>.
        </div>
      </div>`;
  }

  function buildPanel() {
    return `
      <div class="sc-title">About</div>

      <div class="about-hero">
        <img class="about-icon" src="../../../assets/icon-256.png" alt="Conquered Time icon">
        <div class="about-wordmark">Conquered Time</div>
        <div class="about-version-badge" id="about-version-badge">v—</div>
        <div class="about-tagline">"Take back your time."</div>
      </div>

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

      ${changelogHTML()}

      <div class="about-section">
        <div class="about-section-title">Updates</div>
        <div class="about-update-row">
          <button class="about-update-btn" id="about-check-update-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Check for Updates
          </button>
          <button class="about-update-btn" id="about-update-action-btn" style="display:none;"></button>
          <span class="about-update-result" id="about-update-result"></span>
        </div>
        <div class="about-update-progress" id="about-update-progress" style="display:none;">
          <div class="about-update-bar" id="about-update-bar" style="width:0%;"></div>
        </div>
      </div>

      <div class="about-section" id="about-guide-section">
        <div class="about-section-title">Setup Guide</div>
        <div class="about-update-row">
          <button class="about-update-btn" id="about-replay-guide-btn"
                  data-tip="Runs the first-login walkthrough again — profile, companies, tracker, Dispatch.">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
            Replay setup guide
          </button>
        </div>
      </div>

      <div class="about-section">
        <div class="about-section-title">Links</div>
        <div class="about-links">
          <button class="about-link-btn" id="about-link-github">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </button>
          <button class="about-link-btn" id="about-link-donate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            Support on Ko-fi
          </button>
        </div>
      </div>`;
  }

  function mount(container) {
    if (container) container.innerHTML = buildPanel();
  }

  // Wire the panel that's currently in the DOM. Idempotent-ish: safe to call
  // once per time the About tab is shown. `api` is the preload bridge; `toast`
  // is optional (falls back to a no-op).
  /** @param {{ api?: any, toast?: Function }} [opts] */
  async function wire({ api, toast } = {}) {
    if (!api) return;
    const notify = typeof toast === 'function' ? toast : () => {};
    const openExternal = (type) => {
      const url = URLS[type];
      if (!url) { notify('Link coming soon — stay tuned!', 'info', 2500); return; }
      api.send('shell:open-external', url);
    };

    // Build info
    try {
      const info = await api.invoke('app:get-info');
      if (info) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('about-version-badge', `v${info.version}`);
        set('ab-version',  info.version);
        set('ab-electron', info.electronVersion);
        set('ab-node',     info.nodeVersion);
        set('ab-platform', info.arch ? `${info.platform} (${info.arch})` : info.platform);
      }
    } catch {}

    // Replay setup guide — in-app only (the pre-auth login About has no tour
    // engine, so hide the whole section there).
    const guideSection = document.getElementById('about-guide-section');
    if (window.Onboarding) {
      document.getElementById('about-replay-guide-btn')
        ?.addEventListener('click', () => window.Onboarding.replay());
    } else if (guideSection) {
      guideSection.style.display = 'none';
    }

    // Outbound links
    document.getElementById('about-link-github')?.addEventListener('click', () => openExternal('github'));
    document.getElementById('about-link-donate')?.addEventListener('click', () => openExternal('donate'));
    document.getElementById('about-more-github')?.addEventListener('click', () => openExternal('github'));

    // Check for updates — real electron-updater flow (packaged builds). The main
    // process streams status through the 'update:status' event; every UI state
    // (checking / available / downloading / downloaded / error) is driven by
    // renderStatus below rather than the return value of a single call.
    wireUpdates({ api, notify });
  }

  // ── Auto-updater UI ─────────────────────────────────────────────────────────
  // Idempotent: safe to call each time the About tab mounts. Keeps a single
  // 'update:status' subscription per module load (see _updateSub).
  let _updateSub = null;

  function wireUpdates({ api, notify }) {
    const checkBtn  = document.getElementById('about-check-update-btn');
    const actionBtn = document.getElementById('about-update-action-btn');
    const result    = document.getElementById('about-update-result');
    const progress  = document.getElementById('about-update-progress');
    const bar       = document.getElementById('about-update-bar');
    if (!checkBtn || !actionBtn || !result) return;

    let latestVersion = '';

    const setResult = (cls, text) => { result.className = `about-update-result ${cls || ''}`.trim(); result.textContent = text; };
    const showAction = (label, handler) => {
      actionBtn.style.display = '';
      actionBtn.textContent = label;
      actionBtn.onclick = handler;
    };
    const hideAction = () => { actionBtn.style.display = 'none'; actionBtn.onclick = null; };
    const showProgress = (pct) => { if (progress) { progress.style.display = ''; if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`; } };
    const hideProgress = () => { if (progress) progress.style.display = 'none'; };

    function renderStatus(s) {
      if (!s || !s.state) return;
      switch (s.state) {
        case 'checking':
          checkBtn.disabled = true; hideAction(); hideProgress();
          setResult('', 'Checking for updates…');
          break;
        case 'available':
          checkBtn.disabled = false; hideProgress();
          latestVersion = s.version || '';
          setResult('update-available', `v${esc(latestVersion)} available.`);
          showAction('Download', async () => {
            actionBtn.disabled = true;
            setResult('', 'Starting download…');
            const r = await api.invoke('update:download');
            if (r && !r.ok) { actionBtn.disabled = false; setResult('update-error', r.error || 'Download failed.'); }
          });
          break;
        case 'download-progress':
          checkBtn.disabled = true; actionBtn.disabled = true;
          showProgress(s.percent || 0);
          setResult('', `Downloading… ${Math.round(s.percent || 0)}%`);
          break;
        case 'downloaded':
          checkBtn.disabled = false; hideProgress();
          setResult('update-available', `v${esc(s.version || latestVersion)} ready to install.`);
          showAction('Restart & Install', async () => {
            actionBtn.disabled = true;
            await api.invoke('update:install');
          });
          break;
        case 'not-available':
          checkBtn.disabled = false; hideAction(); hideProgress();
          setResult('update-current', `You're up to date (v${esc(s.version || '')}).`);
          break;
        case 'error':
          checkBtn.disabled = false; actionBtn.disabled = false; hideProgress();
          setResult('update-error', s.error || 'Update check failed.');
          break;
        case 'dev':
          checkBtn.disabled = false; hideAction(); hideProgress();
          setResult('', 'Auto-update runs in installed builds only.');
          break;
        default:
          break;
      }
    }

    // Single live subscription to main → renderer status pushes.
    if (_updateSub) { try { _updateSub(); } catch {} _updateSub = null; }
    if (typeof api.on === 'function') _updateSub = api.on('update:status', renderStatus);

    // Reflect any status already known (e.g. the on-launch check found one).
    api.invoke('update:status').then(renderStatus).catch(() => {});

    checkBtn.onclick = async () => {
      hideAction();
      setResult('', 'Checking for updates…');
      checkBtn.disabled = true;
      try { renderStatus(await api.invoke('update:check')); }
      catch { setResult('update-error', 'Update check failed.'); }
      finally { checkBtn.disabled = false; }
    };
  }

  return { buildPanel, mount, wire, URLS, CHANGELOG };
})();

// Expose for classic-script consumers (shell.js, login.js).
if (typeof window !== 'undefined') window.About = About;
