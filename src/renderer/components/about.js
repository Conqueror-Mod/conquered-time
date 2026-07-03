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
    donate: 'https://ko-fi.com/christheconquerorbowles',
  };

  // Changelog — newest first. Edit HERE and both About surfaces update. The two
  // most recent entries render in-panel; older notes live on GitHub Releases.
  const CHANGELOG = [
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

      ${changelogHTML()}

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

    // Outbound links
    document.getElementById('about-link-github')?.addEventListener('click', () => openExternal('github'));
    document.getElementById('about-link-donate')?.addEventListener('click', () => openExternal('donate'));
    document.getElementById('about-more-github')?.addEventListener('click', () => openExternal('github'));

    // Check for updates
    const btn = document.getElementById('about-check-update-btn');
    btn?.addEventListener('click', async () => {
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
          result.innerHTML = `v${esc(res.latest)} available — <a class="update-download-link" href="#">Download</a>`;
          result.querySelector('.update-download-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            if (res.downloadUrl) api.send('shell:open-external', res.downloadUrl);
            else notify('No download URL configured yet.', 'info', 2500);
          });
        } else {
          result.className = 'about-update-result update-current';
          result.textContent = `You're up to date (v${esc(res.current)}).`;
        }
      } catch {
        result.className = 'about-update-result update-error';
        result.textContent = 'Update check failed.';
      } finally {
        btn.disabled = false;
      }
    });
  }

  return { buildPanel, mount, wire, URLS, CHANGELOG };
})();

// Expose for classic-script consumers (shell.js, login.js).
if (typeof window !== 'undefined') window.About = About;
