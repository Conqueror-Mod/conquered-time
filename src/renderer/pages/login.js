'use strict';

// Login screen logic. Externalized from two inline <script> blocks (the main auth
// flow + the pre-auth settings modal) so the page runs under a strict
// script-src 'self' CSP. Standalone window (no shell.js); uses the preload `api`
// bridge. All interactive elements use data-action (no inline on* handlers),
// routed through one document-level delegated dispatcher.

// Standalone window (no shell.js) — local HTML-escape for user-controlled text.
function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Event delegation (CSP: no inline on* handlers) ───────────────────────────
function installLoginDelegation() {
  if (window.__loginDelegated) return;
  window.__loginDelegated = true;

  const ACTIONS = {
    winMinimize:            ()      => api.send('win:minimize'),
    winClose:               ()      => api.send('win:close'),
    setMode:                a       => setMode(a),
    doSafeLogin:            ()      => doSafeLogin(),
    doQuickUnlock:          ()      => doQuickUnlock(),
    useFullLogin:           ()      => { hideSafeLoginUI(); document.getElementById('login-password').focus(); },
    doLogin:                ()      => doLogin(),
    goBackToSelector:       ()      => goBackToSelector(),
    generateTOTP:           ()      => generateTOTP(),
    doSetup:                ()      => doSetup(),
    showRecMode:            a       => showRecMode(a),
    doRecovery:             ()      => doRecovery(),
    doPasswordReset:        ()      => doPasswordReset(),
    doBrowseRestore:        ()      => doBrowseRestore(),
    showRecovery:           ()      => showRecovery(),
    // pre-auth settings
    openPreauthSettings:    ()      => openPreauthSettings(),
    closePreauthSettings:   ()      => closePreauthSettings(),
    paSwitchTab:            a       => paSwitchTab(a),
    paApplyTheme:           a       => paApplyTheme(a),
    paApplyScale:           a       => paApplyScale(a),
    paApplyToggle:          (a, el) => paApplyToggle(a, el),
    paApplyColorblind:      a       => paApplyColorblind(a),
    paApplyWinToggle:       (a, el) => paApplyWinToggle(a, el),
    paApplyLaunchStartup:   (a, el) => paApplyLaunchStartup(el),
    paApplyCloseToTray:     (a, el) => paApplyCloseToTray(el),
    paApplyStartMinimized:  (a, el) => paApplyStartMinimized(el),
    paApplyPreferredDisplay:a       => paApplyPreferredDisplay(a),
    paArmDelete:            a       => paArmDelete(Number(a)),
    paExecuteDelete:        a       => paExecuteDelete(Number(a)),
    paDisarmDelete:         a       => paDisarmDelete(Number(a)),
    // beta gate
    redeemBeta:             ()      => redeemBeta(),
    betaRequestKey:         ()      => api.send('shell:open-external', 'https://github.com/Conqueror-Mod/conquered-time'),
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el.dataset.arg, el);
  });
}

// ═══════════════════════════════════════════════════════
//  INTERACTIVE GRID
// ═══════════════════════════════════════════════════════

const CELL_SIZE  = 40;
const HOVER_FADE = 0.18;   // seconds to fade out glow

let canvas, ctx, cols, rows;
let hoverCell   = { c: -1, r: -1 };
let glowCells   = {};      // key: "c,r" → { alpha, color }
let animFrame;

function initGrid() {
  canvas = document.getElementById('grid-canvas');
  ctx    = canvas.getContext('2d');
  resizeGrid();
  window.addEventListener('resize', resizeGrid);

  canvas.addEventListener('mousemove', onGridHover);
  canvas.addEventListener('mouseleave', () => { hoverCell = { c: -1, r: -1 }; });

  animateGrid();
}

function resizeGrid() {
  // Read parent dimensions BEFORE touching canvas.width/height, which would change offsetWidth
  const w = canvas.parentElement ? canvas.parentElement.clientWidth  : window.innerWidth;
  const h = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
  canvas.width  = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  // setTransform instead of scale() so repeated resizes don't stack the DPR multiplier
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  cols = Math.ceil(w / CELL_SIZE) + 1;
  rows = Math.ceil(h / CELL_SIZE) + 1;
}

function onGridHover(e) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left)  / CELL_SIZE);
  const r = Math.floor((e.clientY - rect.top)   / CELL_SIZE);
  if (c !== hoverCell.c || r !== hoverCell.r) {
    hoverCell = { c, r };
    // Trigger a subtle hover glow
    const key = `${c},${r}`;
    if (!glowCells[key]) glowCells[key] = { alpha: 0, color: 'accent', decay: true };
    glowCells[key].alpha = Math.max(glowCells[key].alpha, 0.25);
    glowCells[key].decay = true;
  }
}

function animateGrid() {
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  ctx.clearRect(0, 0, W, H);

  // Draw grid lines — tinted per theme family
  const th = document.documentElement.getAttribute('data-theme') || 'memoria';
  ctx.strokeStyle = th === 'rabanastre'
    ? 'rgba(120,70,10,0.35)'
    : (th === 'treno' || th === 'nibelheim' || th === 'zanarkand')
      ? 'rgba(200,190,220,0.10)'
      : 'rgba(80,80,160,0.18)';
  ctx.lineWidth   = 0.5;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL_SIZE, 0); ctx.lineTo(c * CELL_SIZE, H); ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL_SIZE); ctx.lineTo(W, r * CELL_SIZE); ctx.stroke();
  }

  // Draw glow cells
  for (const key of Object.keys(glowCells)) {
    const g = glowCells[key];
    if (g.alpha <= 0) { delete glowCells[key]; continue; }

    const [c, r] = key.split(',').map(Number);
    const x = c * CELL_SIZE;
    const y = r * CELL_SIZE;

    const color = g.color === 'red'
      ? `rgba(255,75,110,${g.alpha * 0.18})`
      : `rgba(0,200,160,${g.alpha * 0.18})`;
    const border = g.color === 'red'
      ? `rgba(255,75,110,${g.alpha * 0.6})`
      : `rgba(0,200,160,${g.alpha * 0.6})`;

    ctx.fillStyle   = color;
    ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
    ctx.strokeStyle = border;
    ctx.lineWidth   = 0.8;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);

    if (g.decay) g.alpha -= 0.015;
  }

  animFrame = requestAnimationFrame(animateGrid);
}

// ═══════════════════════════════════════════════════════
//  EASTER EGG — KONAMI CODE
// ═══════════════════════════════════════════════════════

const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown',
                'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
                'b','a','Enter'];
let konamiIdx = 0;
let eggActive = false;

const EGG_ART = `\
(0RGSDOFCJftli;.:.)
+==================+
|;,. . .     .   ,;|
 \\;,. . .     . ,;/
  \\;,. . .   . ,;/
   \\;,. . . . ,;/
    \\;,. .  .,;/
     \\;,.  .,;/
      \\;,  ,;/
       \\;  ;/
        \\;;/
         lf
         ||
         ;l
        /;;\\
       /;  ;\\
      /;,  ,;\\
     /;,.  .,;\\
    /;,. .  .,;\\
   /;,. . . . ,;\\
  /;,. . .   . ,;\\
 /;,. . .     . ,;\\
|;,. . .     .   ,;|
+==================+
(QB0ZDOLC7itz!;.:.)  `;

function showEasterEgg() {
  if (eggActive) return;
  eggActive = true;

  const overlay = document.createElement('div');
  overlay.id = 'egg-overlay';
  const art = document.createElement('pre');
  art.id = 'egg-art';
  art.textContent = EGG_ART;
  overlay.appendChild(art);
  document.body.appendChild(overlay);

  // Force reflow so the transition fires
  overlay.getBoundingClientRect();
  overlay.classList.add('visible');

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', () => { overlay.remove(); eggActive = false; }, { once: true });
  }

  const autoTimer = setTimeout(dismiss, 4500);

  overlay.addEventListener('click', () => { clearTimeout(autoTimer); dismiss(); });
  document.addEventListener('keydown', function onKey() {
    clearTimeout(autoTimer);
    dismiss();
    document.removeEventListener('keydown', onKey);
  }, { once: true });
}

document.addEventListener('keydown', function(e) {
  // Only active on the profile selector screen
  if (!profileMode) { konamiIdx = 0; return; }

  if (e.key === KONAMI[konamiIdx]) {
    konamiIdx++;
    if (konamiIdx === KONAMI.length) {
      konamiIdx = 0;
      showEasterEgg();
    }
  } else {
    // Wrong key — reset, but re-check index 0 in case this key starts a fresh sequence
    konamiIdx = (e.key === KONAMI[0]) ? 1 : 0;
  }
});

// ═══════════════════════════════════════════════════════
//  STANDARD AUTH
// ═══════════════════════════════════════════════════════

let currentMode = 'login';
let totpSecret  = '';
let recoveryCode = '';
let lockoutEnd  = 0;
let lockoutInterval = null;

// ── Profile selector state ──────────────────────────────
let selectedProfile = null;   // { username, display_name, avatar_thumb_48 }
let profileMode     = false;  // true when profile selector is active (not dev/legacy)
let safeCheckPending = false; // true while auth:safe-check is resolving after a profile is picked
                              // — suppresses the global Enter→doLogin (empty password) flash

function avatarInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function buildAvatarEl(el, profile, size) {
  if (profile.avatar_thumb_48) {
    el.innerHTML = `<img src="${escapeHtml(profile.avatar_thumb_48)}" alt="">`;
  } else {
    el.textContent = avatarInitials(profile.display_name || profile.username);
  }
}

async function showProfileSelector() {
  selectedProfile = null;
  document.getElementById('login-card').style.display = 'none';
  resetAuthUiState();

  const profiles = await api.invoke('profiles:list');
  const grid = document.getElementById('ps-grid');
  grid.innerHTML = '';

  profiles.forEach(p => {
    const card = document.createElement('div');
    card.className = 'ps-card';
    card.title = p.username;
    const av = document.createElement('div');
    av.className = 'ps-avatar';
    buildAvatarEl(av, p);
    const dn = document.createElement('div');
    dn.className = 'ps-display-name';
    dn.textContent = p.display_name || p.username;
    const un = document.createElement('div');
    un.className = 'ps-username';
    un.textContent = p.username;
    card.append(av, dn, un);
    card.addEventListener('click', () => loadProfile(p));
    grid.appendChild(card);
  });

  // Add Profile card
  const addCard = document.createElement('div');
  addCard.className = 'ps-card add-card';
  addCard.title = 'Add new profile';
  addCard.innerHTML = `<div class="ps-add-icon">+</div><div class="ps-add-label">Add Profile</div>`;
  addCard.addEventListener('click', startNewProfile);
  grid.appendChild(addCard);

  document.getElementById('profile-selector').style.display = 'block';
}

async function loadProfile(profile) {
  selectedProfile = profile;
  const res = await api.invoke('profiles:load', { username: profile.username });
  if (!res.ok) { toast(res.error || 'Could not load profile.', 'error'); return; }
  showLoginCard(profile);
}

async function showLoginCard(profile) {
  document.getElementById('profile-selector').style.display = 'none';
  resetAuthUiState();  // don't carry another profile's attempts/lockout warning in

  // Show profile banner in place of the username field
  const banner = document.getElementById('profile-banner');
  if (profile) {
    banner.classList.add('visible');
    document.getElementById('pb-display-name').textContent = profile.display_name || profile.username;
    document.getElementById('pb-username').textContent = profile.username;
    const pbAv = document.getElementById('pb-avatar');
    buildAvatarEl(pbAv, profile);
    document.getElementById('login-username').closest('.field-group').style.display = 'none';
  } else {
    banner.classList.remove('visible');
    document.getElementById('login-username').closest('.field-group').style.display = '';
  }

  document.getElementById('login-card').style.display = 'block';
  document.getElementById('tab-setup').style.display = 'none';
  setMode('login');

  // Check for safeStorage fast-path enrollment
  hideSafeLoginUI();
  if (profile) {
    safeCheckPending = true;
    try {
      const safe = await api.invoke('auth:safe-check');
      if (safe.available && safe.enrolled) {
        showSafeLoginUI();
        document.getElementById('safe-login-btn')?.focus();
        return;
      }
    } catch {}
    finally { safeCheckPending = false; }
  }
  document.getElementById('login-password').focus();
}

function showSafeLoginUI(quickUnlock = false) {
  document.getElementById('safe-login-section').style.display = 'flex';
  document.getElementById('login-password').closest('.field-group').style.display = 'none';
  document.getElementById('login-totp').closest('.field-group').style.display = 'none';
  document.getElementById('login-btn').style.display = 'none';
  if (quickUnlock) {
    document.getElementById('safe-login-btn').style.display = 'none';
    document.getElementById('quick-unlock-section').style.display = 'flex';
    document.getElementById('quick-unlock-pw').focus();
  } else {
    document.getElementById('safe-login-btn').style.display = '';
    document.getElementById('quick-unlock-section').style.display = 'none';
    document.getElementById('safe-login-btn').focus();
  }
}

function hideSafeLoginUI() {
  document.getElementById('safe-login-section').style.display = 'none';
  document.getElementById('login-password').closest('.field-group').style.display = '';
  document.getElementById('login-totp').closest('.field-group').style.display = '';
  document.getElementById('login-btn').style.display = '';
  const qpw = document.getElementById('quick-unlock-pw');
  if (qpw) qpw.value = '';
}

async function doSafeLogin() {
  const btn = document.getElementById('safe-login-btn');
  if (btn) btn.disabled = true;
  const res = await api.invoke('auth:safe-login');
  if (btn) btn.disabled = false;
  if (res.ok) {
    postLoginNavigate(res);
  } else if (res.quickUnlock) {
    // Biometric not available — switch to quick unlock password form
    showSafeLoginUI(true);
  } else {
    hideSafeLoginUI();
    document.getElementById('login-password').focus();
    const errEl = document.getElementById('login-error');
    showErr(errEl, res.error || 'Secure sign-in failed. Enter your password.');
  }
}

async function doQuickUnlock() {
  const pw    = document.getElementById('quick-unlock-pw')?.value || '';
  const errEl = document.getElementById('quick-unlock-error');
  if (!pw) { showErr(errEl, 'Password required.'); return; }
  const res = await api.invoke('auth:quick-unlock', { password: pw });
  if (res.ok) {
    postLoginNavigate(res);
  } else {
    showErr(errEl, res.error || 'Incorrect password.');
    const inp = document.getElementById('quick-unlock-pw');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

async function goBackToSelector() {
  await api.invoke('profiles:deselect');
  document.getElementById('login-password').value = '';
  document.getElementById('login-totp').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('setup-back-row').style.display = 'none';
  document.getElementById('tab-login').style.display = '';
  showProfileSelector();
}

function startNewProfile() {
  selectedProfile = null;
  profileMode = true;
  document.getElementById('profile-selector').style.display = 'none';
  resetAuthUiState();  // a fresh profile must not inherit a prior one's lockout warning
  document.getElementById('setup-back-row').style.display = '';
  document.getElementById('profile-banner').classList.remove('visible');
  document.getElementById('login-username').closest('.field-group').style.display = '';
  document.getElementById('login-card').style.display = 'block';
  document.getElementById('tab-setup').style.display = '';
  document.getElementById('tab-login').style.display = 'none';
  setMode('setup');
  document.getElementById('gen-totp-btn').style.display = '';
  document.getElementById('setup-username').focus();
}

window.addEventListener('DOMContentLoaded', async () => {
  initGrid();
  installLoginDelegation();
  // Auto-updater surface: post-update confirmation + actionable "update available"
  // toast right here on the profile selector (no-op in dev / when up to date).
  window.UpdateNotice?.init();
  // Apply the stored pre-auth UI scale as an app-wide zoom, so the login screen
  // matches the in-app scale (and doesn't inherit a leftover zoom from a prior
  // in-app session after logout). login-theme-init already set data-scale.
  paApplyZoom(localStorage.getItem('ct_pa_scale') || 'normal');
  // Pre-auth settings modal backdrop — fire only on the overlay itself.
  document.getElementById('preauth-settings-modal').addEventListener('click', handlePreauthBackdrop);

  document.getElementById('pb-back-btn').addEventListener('click', goBackToSelector);

  // Quick unlock password toggle
  document.getElementById('quick-unlock-toggle').addEventListener('click', () => {
    const input = document.getElementById('quick-unlock-pw');
    const icon  = document.getElementById('quick-unlock-icon');
    const show  = input.type === 'password';
    input.type  = show ? 'text' : 'password';
    const eyeOpen   = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const eyeClosed = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.innerHTML = show ? eyeClosed : eyeOpen;
  });
  document.getElementById('quick-unlock-pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doQuickUnlock(); }
  });

  // Setup form password toggles
  [['setup-pw-toggle', 'setup-password', 'setup-pw-icon'],
   ['setup-pw2-toggle', 'setup-password2', 'setup-pw2-icon']].forEach(([btnId, inputId, iconId]) => {
    document.getElementById(btnId).addEventListener('click', () => {
      const input = document.getElementById(inputId);
      const icon  = document.getElementById(iconId);
      const show  = input.type === 'password';
      input.type  = show ? 'text' : 'password';
      const eyeOpen   = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
      const eyeClosed = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.innerHTML = show ? eyeClosed : eyeOpen;
    });
  });

  // Setup form field navigation — Enter advances through fields in order
  document.getElementById('setup-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('setup-password').focus(); }
  });
  document.getElementById('setup-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('setup-password2').focus(); }
  });
  document.getElementById('setup-password2').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('setup-totp').focus(); }
  });

  document.getElementById('login-pw-toggle').addEventListener('click', () => {
    const input = document.getElementById('login-password');
    const icon  = document.getElementById('login-pw-icon');
    const show  = input.type === 'password';
    input.type  = show ? 'text' : 'password';
    const eyeOpen  = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const eyeClosed = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.innerHTML = show ? eyeClosed : eyeOpen;
  });

  // Beta gate (new installs only) — a fresh machine must redeem a key before
  // the setup form is offered. Existing installs / dev runs are never gated.
  const beta = await api.invoke('beta:status');
  if (beta && beta.required) {
    showBetaGate();
  } else {
    await routeInitialScreen();
  }

  // Single unified keydown handler
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // If safe-login UI is visible, fall through to normal form rather than going back
      const safeSection = document.getElementById('safe-login-section');
      if (safeSection && safeSection.style.display !== 'none') {
        hideSafeLoginUI(); document.getElementById('login-password').focus(); return;
      }
      if (currentMode === 'setup' && profileMode) { goBackToSelector(); return; }
    }
    if (e.key === 'Enter') {
      // Beta gate has priority while it's the visible card.
      const betaGate = document.getElementById('beta-gate');
      if (betaGate && betaGate.style.display !== 'none') { redeemBeta(); return; }
      if (currentMode === 'login') {
        // Quick Unlock / safe-login has its own Enter handling — don't let the
        // global handler also fire doLogin() against the empty full-login fields
        const safeSection = document.getElementById('safe-login-section');
        const safeVisible = safeSection && safeSection.style.display !== 'none';
        if (!safeVisible && !safeCheckPending) doLogin();
      }
      // Skip global doSetup() if focus is on a field that has its own Enter handler
      if (currentMode === 'setup') {
        const nav = ['setup-username', 'setup-password', 'setup-password2'];
        if (!nav.includes(document.activeElement?.id)) doSetup();
      }
      if (currentMode === 'recovery-unlock') doRecovery();
      if (currentMode === 'recovery-reset')  doPasswordReset();
    }
  });
});

// Decide the first screen once the beta gate (if any) is satisfied: profile
// selector for existing installs, else the setup/login form for a fresh one.
async function routeInitialScreen() {
  const profiles = await api.invoke('profiles:list');
  if (profiles.length > 0) {
    profileMode = true;
    await showProfileSelector();
  } else {
    // A fresh machine coming through the beta gate had login-card hidden by
    // showBetaGate(); the first-user setup path below never re-shows it (only
    // showLoginCard/showProfileSelector do), which left new beta users on a
    // blank screen after redeeming their key. Make the card visible here.
    document.getElementById('login-card').style.display = 'block';
    const { needsSetup } = await api.invoke('auth:check-setup');
    if (needsSetup) {
      document.getElementById('tab-setup').style.display = '';
      setMode('setup');
      document.getElementById('gen-totp-btn').style.display = '';
    } else {
      document.getElementById('tab-setup').style.display = 'none';
      showLoginCard(null);
    }
    document.getElementById('login-username').focus();
  }
}

// ── Beta gate ──────────────────────────────────────────────────────────────
function showBetaGate() {
  document.getElementById('profile-selector').style.display = 'none';
  document.getElementById('login-card').style.display = 'none';
  document.getElementById('beta-gate').style.display = '';
  setTimeout(() => document.getElementById('beta-key-input')?.focus(), 60);
}

function showBetaError(msg) {
  const el = document.getElementById('beta-error');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

async function redeemBeta() {
  const input = document.getElementById('beta-key-input');
  const btn   = document.getElementById('beta-redeem-btn');
  const key   = (input?.value || '').trim();
  document.getElementById('beta-error').style.display = 'none';
  if (!key) { showBetaError('Enter your beta key.'); input?.focus(); return; }
  if (btn) btn.disabled = true;
  try {
    const res = await api.invoke('beta:redeem', key);
    if (!res || !res.ok) {
      showBetaError((res && res.error) || 'That key isn’t valid.');
      if (btn) btn.disabled = false;
      return;
    }
    document.getElementById('beta-gate').style.display = 'none';
    await routeInitialScreen();   // continue to account setup
  } catch (e) {
    showBetaError('Something went wrong. Please try again.');
    if (btn) btn.disabled = false;
  }
}

function setMode(mode) {
  currentMode = mode;
  const baseMode = mode.startsWith('recovery') ? 'recovery' : mode;
  ['login','setup','recovery'].forEach(m => {
    document.getElementById(`form-${m}`).style.display = m === baseMode ? 'flex' : 'none';
  });
  document.querySelectorAll('.mode-tab').forEach((t, i) => {
    t.classList.toggle('active', ['login','setup','recovery'][i] === baseMode);
  });
  if (mode === 'setup' && !totpSecret) generateTOTP();
  if (baseMode === 'recovery') showRecMode('picker');
}

function showRecMode(sub) {
  const subs = ['picker','unlock','reset','restore'];
  subs.forEach(s => {
    const el = document.getElementById(s === 'picker' ? 'rec-mode-picker' : `rec-sub-${s}`);
    if (!el) return;
    el.style.display = s === sub ? 'block' : 'none';
  });
  if (sub === 'picker') currentMode = 'recovery';
  if (sub === 'unlock') currentMode = 'recovery-unlock';
  if (sub === 'reset')  currentMode = 'recovery-reset';
  if (sub === 'restore') currentMode = 'recovery-restore';
  // Clear errors when switching
  ['rec-error','rec-reset-error','rec-restore-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showRecovery() {
  document.getElementById('lockout-screen').style.display = 'none';
  document.getElementById('login-card').style.display = 'block';
  setMode('recovery');
}

async function generateTOTP() {
  const { secret, qrUrl } = await api.invoke('totp:generate');
  totpSecret = secret;
  document.getElementById('qr-img').src = qrUrl;
  document.getElementById('qr-secret').textContent = secret;
  document.getElementById('qr-wrap').style.display = 'block';
  document.getElementById('totp-verify-field').style.display = 'flex';
  document.getElementById('setup-totp').focus();
  recoveryCode = generateRecoveryCode();
  document.getElementById('recovery-code-display').textContent = recoveryCode;
  document.getElementById('recovery-code-display').style.display = 'block';
  document.getElementById('recovery-section').style.display = 'block';
}

function generateRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

async function doSetup() {
  const u  = document.getElementById('setup-username').value.trim();
  const p  = document.getElementById('setup-password').value;
  const p2 = document.getElementById('setup-password2').value;
  const tc = document.getElementById('setup-totp').value.trim();
  const errEl = document.getElementById('setup-error');
  errEl.style.display = 'none';
  if (!u || !p || !tc || !totpSecret) { showErr(errEl, 'All fields required. Generate TOTP first.'); return; }
  if (p !== p2)     { showErr(errEl, 'Passwords do not match.'); return; }
  if (p.length < 8) { showErr(errEl, 'Password must be at least 8 characters.'); return; }
  if (tc.length !== 6) { showErr(errEl, 'TOTP code must be 6 digits.'); return; }
  document.getElementById('setup-btn').disabled = true;

  // Always call profiles:select — creates the profile folder and initialises the DB.
  // In dev mode the IPC is a no-op (DB already loaded). Required even when there
  // are no existing profiles yet, because profileMode is false in that case.
  const sel = await api.invoke('profiles:select', { username: u });
  if (!sel.ok) {
    document.getElementById('setup-btn').disabled = false;
    showErr(errEl, sel.error || 'Could not create profile folder.'); return;
  }

  const res = await api.invoke('auth:setup', { username: u, password: p, totpSecret, totpCode: tc, recoveryCode });
  document.getElementById('setup-btn').disabled = false;
  if (res.ok) {
    toast('Account created. Please log in.', 'success');
    // If we came from the profile selector, go back to it (new card will appear)
    const updatedProfiles = await api.invoke('profiles:list');
    if (updatedProfiles.length > 0) {
      await showProfileSelector();
    } else {
      setMode('login');
      document.getElementById('login-username').value = u;
      document.getElementById('tab-setup').style.display = 'none';
    }
  } else { showErr(errEl, res.error || 'Setup failed.'); }
}

async function doLogin() {
  // Ignore stray triggers while the post-selection safe-check is still resolving
  // (the password field is empty at that point — would flash a spurious error).
  if (safeCheckPending) return;
  // If a profile is pre-selected, use that username; otherwise read the field
  const u  = selectedProfile ? selectedProfile.username : document.getElementById('login-username').value.trim();
  const p  = document.getElementById('login-password').value;
  const tc = document.getElementById('login-totp').value.trim();
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!u || !p) { showErr(errEl, 'Username and password required.'); return; }
  document.getElementById('login-btn').disabled = true;
  const res = await api.invoke('auth:login', { username: u, password: p, totpCode: tc || '000000' });
  document.getElementById('login-btn').disabled = false;
  if (res.ok) {
    postLoginNavigate(res);
  } else if (res.locked) {
    showLockout(res.hoursRemaining);
  } else {
    showErr(errEl, res.error || 'Authentication failed.');
    if (res.attemptsLeft !== undefined) {
      const w = document.getElementById('attempts-warn');
      w.textContent = `⚠ ${res.attemptsLeft} attempt${res.attemptsLeft !== 1 ? 's' : ''} remaining before 24h lockout`;
      w.style.display = 'block';
    }
  }
}

async function doRecovery() {
  const u = document.getElementById('rec-username').value.trim();
  const c = document.getElementById('rec-code').value.trim();
  const errEl = document.getElementById('rec-error');
  errEl.style.display = 'none';
  const res = await api.invoke('auth:recover', { username: u, recoveryCode: c });
  if (res.ok) {
    toast('Account unlocked. Please log in.', 'success');
    setMode('login');
    document.getElementById('login-username').value = u;
  } else { showErr(errEl, res.error || 'Recovery failed.'); }
}

async function doPasswordReset() {
  const u  = document.getElementById('rec-reset-username').value.trim();
  const c  = document.getElementById('rec-reset-code').value.trim();
  const p1 = document.getElementById('rec-new-password').value;
  const p2 = document.getElementById('rec-confirm-password').value;
  const errEl = document.getElementById('rec-reset-error');
  errEl.style.display = 'none';
  if (!u || !c || !p1) return showErr(errEl, 'All fields are required.');
  if (p1 !== p2) return showErr(errEl, 'Passwords do not match.');
  if (p1.length < 8) return showErr(errEl, 'Password must be at least 8 characters.');
  const res = await api.invoke('auth:recover', { username: u, recoveryCode: c, newPassword: p1 });
  if (res.ok && res.passwordReset) {
    toast('Password reset successfully. Please log in.', 'success');
    setMode('login');
    document.getElementById('login-username').value = u;
  } else if (res.noKeyPacket) {
    showErr(errEl, res.error);
  } else {
    showErr(errEl, res.error || 'Reset failed.');
  }
}

async function doBrowseRestore() {
  const errEl = document.getElementById('rec-restore-error');
  errEl.style.display = 'none';
  const res = await api.invoke('auth:browse-backup');
  if (res?.canceled) return;
  if (!res?.ok) showErr(errEl, res?.error || 'Restore failed.');
  // On success main.js navigates to login — no JS needed here
}

// Clear transient per-attempt / lockout UI. Lockout state is per-profile (each
// vault has its own users.failed_attempts/locked_until), but the login SCREEN's
// warning elements + countdown interval are global — without resetting them on
// a profile transition, a "N attempts remaining" warning or lockout countdown
// from one profile bled onto another profile's (or a new profile's) login/setup
// card. Call this on every switch between selector / login card / setup.
function resetAuthUiState() {
  const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  hide('attempts-warn');
  hide('login-error');
  if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }
  lockoutEnd = 0;
  hide('lockout-screen');
}

function showLockout(hoursRemaining) {
  document.getElementById('login-card').style.display = 'none';
  const ls = document.getElementById('lockout-screen');
  ls.style.display = 'flex';
  lockoutEnd = Date.now() + (hoursRemaining * 3600000);
  updateLockoutTimer();
  lockoutInterval = setInterval(updateLockoutTimer, 1000);
}

function updateLockoutTimer() {
  const diff = Math.max(0, lockoutEnd - Date.now());
  if (diff === 0) {
    clearInterval(lockoutInterval);
    document.getElementById('lockout-screen').style.display = 'none';
    document.getElementById('login-card').style.display = 'block';
    return;
  }
  const h = String(Math.floor(diff / 3600000)).padStart(2,'0');
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2,'0');
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2,'0');
  document.getElementById('lockout-timer').textContent = `${h}:${m}:${s}`;
}

function showErr(el, msg) { el.textContent = msg; el.style.display = 'block'; }

async function postLoginNavigate(res) {
  // Seed the user's actual theme/scale into sessionStorage BEFORE navigating, so
  // the first inner page's theme-init.js paints the correct palette immediately.
  // Without this, the first page falls back to the default theme (Memoria) for a
  // split second until Shell.init() loads settings from the vault.
  //
  // ALSO mirror the vault appearance settings into the pre-auth ct_pa_* keys so
  // the login screen itself adopts the profile's theme on the next logout/lock —
  // otherwise the login screen keeps a stale global pre-auth theme that can
  // diverge from the profile (e.g. login shows Nibelheim while the app is
  // Zanarkand). The pre-auth modal can still override; that override is just
  // re-synced on the next login.
  try {
    const pairs = [
      ['ui_theme',           'ct_pa_theme'],
      ['ui_scale',           'ct_pa_scale'],
      ['ui_reducedMotion',   'ct_pa_reducedMotion'],
      ['ui_highContrast',    'ct_pa_highContrast'],
      ['ui_colorblind',      'ct_pa_colorblind'],
      ['ui_focusIndicators', 'ct_pa_focusIndicators'],
    ];
    for (const [vaultKey, paKey] of pairs) {
      const v = await api.invoke('settings:get', vaultKey);
      if (v !== null && v !== undefined) localStorage.setItem(paKey, String(v));
    }
    const theme = localStorage.getItem('ct_pa_theme');
    const scale = localStorage.getItem('ct_pa_scale');
    if (theme) sessionStorage.setItem('ct_theme', theme);
    if (scale) sessionStorage.setItem('ct_scale', scale);
  } catch {}
  // Ask the first inner page (shell.js) to surface an audit notice if the
  // session log has unresolved discrepancies. One-shot per login.
  sessionStorage.setItem('audit_check_pending', '1');
  if (res.needsEmail) {
    sessionStorage.setItem('require_email', '1');
    api.send('navigate', 'profile');
  } else {
    api.send('navigate', 'dashboard');
  }
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Pre-Auth Settings ────────────────────────────────────────────────────────
// Settings are persisted to localStorage (no vault loaded at this stage).
// Keys prefixed ct_pa_. When the user logs in, vault settings take precedence.

const PA_KEYS = {
  theme: 'ct_pa_theme', scale: 'ct_pa_scale',
  reducedMotion: 'ct_pa_reducedMotion', highContrast: 'ct_pa_highContrast',
  colorblind: 'ct_pa_colorblind', focusIndicators: 'ct_pa_focusIndicators',
  winStartMaximized: 'ct_pa_winStartMaximized', winRememberPosition: 'ct_pa_winRememberPosition',
};

function paGet(key) { return localStorage.getItem(PA_KEYS[key]); }
function paSet(key, val) { localStorage.setItem(PA_KEYS[key], String(val)); }

function openPreauthSettings() {
  document.getElementById('preauth-settings-modal').style.display = 'flex';
  paSyncModal();
}
function closePreauthSettings() {
  document.getElementById('preauth-settings-modal').style.display = 'none';
}
function handlePreauthBackdrop(e) {
  if (e.target === document.getElementById('preauth-settings-modal')) closePreauthSettings();
}

function paSwitchTab(cat) {
  ['appearance','window','data','accessibility','about'].forEach(c => {
    document.getElementById(`pa-cat-${c}`).style.display = c === cat ? 'block' : 'none';
  });
  document.querySelectorAll('#preauth-settings-modal .sn-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat);
  });
  if (cat === 'about') paLoadAbout();
  if (cat === 'window') paLoadDisplayPicker();
  if (cat === 'data') paRenderDeleteUser();
}

function paSyncModal() {
  const root    = document.documentElement;
  const theme   = root.getAttribute('data-theme') || 'zanarkand';
  const scale   = root.getAttribute('data-scale') || 'normal';
  const rm      = root.getAttribute('data-reduced-motion')   === 'true';
  const hc      = root.getAttribute('data-high-contrast')    === 'true';
  const cb      = root.getAttribute('data-colorblind')       || 'off';
  const fi      = root.getAttribute('data-focus-indicators') === 'true';

  // Theme cards
  document.querySelectorAll('#pa-theme-cards .theme-card').forEach(c =>
    c.classList.toggle('active', c.dataset.t === theme));
  // Scale buttons
  document.querySelectorAll('#pa-scale-btns .s-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.s === scale));
  // Accessibility toggles
  const setTog = (id, on) => document.getElementById(id)?.classList.toggle('on', on);
  setTog('pa-toggle-motion',       rm);
  setTog('pa-toggle-highcontrast', hc);
  setTog('pa-toggle-focus',        fi);
  document.querySelectorAll('#pa-colorblind-btns .s-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cb === cb));
}

// ── Appearance ───────────────────────────────────────────────────────────────
function paApplyTheme(theme) {
  paSet('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('#pa-theme-cards .theme-card').forEach(c =>
    c.classList.toggle('active', c.dataset.t === theme));
}

// UI scale → app-wide zoom factor (must match settings.js SCALE_ZOOM so the
// login screen and the in-app scale feel identical).
const PA_ZOOM = { compact: 0.85, normal: 1.0, comfortable: 1.15, large: 1.3 };
function paApplyZoom(scale) {
  try { api.invoke('win:set-zoom', PA_ZOOM[scale] ?? 1); } catch (e) {}
}

function paApplyScale(scale) {
  paSet('scale', scale);
  document.documentElement.setAttribute('data-scale', scale);
  paApplyZoom(scale);
  document.querySelectorAll('#pa-scale-btns .s-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.s === scale));
}

// ── Accessibility ─────────────────────────────────────────────────────────────
function paApplyToggle(key, btn) {
  const on = !btn.classList.contains('on');
  paSet(key, on);
  btn.classList.toggle('on', on);
  const attrMap = {
    reducedMotion:   'data-reduced-motion',
    highContrast:    'data-high-contrast',
    focusIndicators: 'data-focus-indicators',
  };
  if (attrMap[key]) document.documentElement.setAttribute(attrMap[key], String(on));
}

function paApplyColorblind(val) {
  paSet('colorblind', val);
  document.documentElement.setAttribute('data-colorblind', val);
  document.querySelectorAll('#pa-colorblind-btns .s-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cb === val));
}

// ── Window ───────────────────────────────────────────────────────────────────
async function paLoadDisplayPicker() {
  const area = document.getElementById('pa-display-picker');
  if (!area) return;
  try {
    const [displays, currentDisp, savedMax, savedRemember] = await Promise.all([
      api.invoke('win:get-displays'),
      // highlight from the display the window is actually on, not localStorage
      api.invoke('win:get-current-display').catch(() => 'primary'),
      Promise.resolve(paGet('winStartMaximized')),
      Promise.resolve(paGet('winRememberPosition')),
    ]);
    const saved = currentDisp || 'primary';
    const btns  = [
      `<button class="s-btn${saved === 'primary' ? ' active' : ''}" data-action="paApplyPreferredDisplay" data-arg="primary">Primary Display</button>`,
      ...(displays || []).filter(d => !d.isPrimary).map(d =>
        `<button class="s-btn${saved === String(d.id) ? ' active' : ''}" data-action="paApplyPreferredDisplay" data-arg="${d.id}">Display ${d.index}</button>`)
    ];
    area.innerHTML = `<div class="settings-btn-group">${btns.join('')}</div>`;
    const tsm = document.getElementById('pa-toggle-start-maximized');
    const trp = document.getElementById('pa-toggle-remember-position');
    if (tsm) tsm.classList.toggle('on', savedMax === 'true');
    if (trp) trp.classList.toggle('on', savedRemember === 'true');
    // Launch-at-startup (OS login item) + close-to-tray (app-global pref) — both
    // resolved from main, not localStorage, so they match the in-app settings.
    const [launch, closeTray, startMin] = await Promise.all([
      api.invoke('win:get-launch-at-startup').catch(() => false),
      api.invoke('win:get-close-to-tray').catch(() => false),
      api.invoke('win:get-start-minimized').catch(() => false),
    ]);
    const tls = document.getElementById('pa-toggle-launch-startup');
    const tct = document.getElementById('pa-toggle-close-tray');
    const tsm2 = document.getElementById('pa-toggle-start-minimized');
    if (tls) tls.classList.toggle('on', launch === true);
    if (tct) tct.classList.toggle('on', closeTray === true);
    if (tsm2) tsm2.classList.toggle('on', startMin === true);
  } catch(e) {
    area.innerHTML = `<div class="settings-row-label" style="color:var(--text-muted)">Display info unavailable.</div>`;
  }
}

async function paApplyPreferredDisplay(displayId) {
  paSet('winPreferredDisplay', displayId);
  try { await api.invoke('win:move-to-display', displayId); } catch {}
  paLoadDisplayPicker();
}

function paApplyWinToggle(key, btn) {
  const on  = !btn.classList.contains('on');
  const lsKey = key === 'win_startMaximized' ? 'winStartMaximized' : 'winRememberPosition';
  paSet(lsKey, on);
  btn.classList.toggle('on', on);
}

// Launch-at-startup + close-to-tray are app-global (not per-profile), so they
// persist through main (OS login item / app-prefs.json), not localStorage.
async function paApplyLaunchStartup(btn) {
  const on = !btn.classList.contains('on');
  try { await api.invoke('win:set-launch-at-startup', on); } catch {}
  btn.classList.toggle('on', on);
}
async function paApplyCloseToTray(btn) {
  const on = !btn.classList.contains('on');
  try { await api.invoke('win:set-close-to-tray', on); } catch {}
  btn.classList.toggle('on', on);
}
async function paApplyStartMinimized(btn) {
  const on = !btn.classList.contains('on');
  try { await api.invoke('win:set-start-minimized', on); } catch {}
  btn.classList.toggle('on', on);
}

// ── About ─────────────────────────────────────────────────────────────────────
// Mount + wire the shared About module (components/about.js) — the same asset
// the post-login in-app About uses, so both surfaces stay identical.
let _paAboutMounted = false;
function paLoadAbout() {
  const panel = document.getElementById('pa-cat-about');
  if (!panel || typeof About === 'undefined') return;
  if (!_paAboutMounted) {
    About.mount(panel);
    _paAboutMounted = true;
  }
  About.wire({ api, toast: (typeof toast === 'function' ? toast : undefined) });
}

// ── Data — Delete User ────────────────────────────────────────────────────────
// Lists EVERY profile on this device with its own Delete button — deletion no
// longer depends on which profile (if any) is selected on the login screen.
// (The old version only offered the selected profile and showed "select a
// profile first" from the selector, which made deletion effectively
// unreachable there.) profiles:delete operates on the LOADED profile, so
// execute loads the chosen profile just before deleting it.
/** @type {Profile[]} */
let _paDeleteProfiles = [];

async function paRenderDeleteUser() {
  const area = document.getElementById('pa-delete-user-area');
  if (!area) return;

  try { _paDeleteProfiles = (await api.invoke('profiles:list')) || []; }
  catch { _paDeleteProfiles = []; }

  if (!_paDeleteProfiles.length) {
    area.innerHTML = `<div class="pa-no-profile-msg">No profiles on this device yet.</div>`;
    return;
  }

  area.innerHTML = _paDeleteProfiles.map((p, i) => {
    const initials = (p.display_name || p.username || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const avatarHTML = p.avatar_thumb_48
      ? `<img src="${escapeHtml(p.avatar_thumb_48)}" alt="">`
      : escapeHtml(initials);
    return `
    <div class="pa-delete-card" id="pa-del-card-${i}" style="margin-bottom:10px;">
      <div class="pa-delete-header">
        <div class="pa-delete-profile">
          <div class="pa-delete-avatar">${avatarHTML}</div>
          <div>
            <div class="pa-delete-name">${escapeHtml(p.display_name || p.username)}</div>
            <div class="pa-delete-user">${escapeHtml(p.username)}</div>
          </div>
        </div>
        <button class="dba-trigger-btn danger" data-action="paArmDelete" data-arg="${i}">Delete</button>
      </div>
      <div class="pa-delete-confirm" id="pa-del-confirm-${i}" style="display:none;">
        <div class="pa-delete-warning">⚠ This permanently deletes this profile and all its data. This cannot be undone.</div>
        <div class="pa-delete-pw-row">
          <input type="password" id="pa-del-pw-${i}" placeholder="Enter this profile's password to confirm" autocomplete="current-password">
          <button class="dba-confirm-btn danger" data-action="paExecuteDelete" data-arg="${i}">Delete Profile</button>
          <button class="dba-confirm-btn" data-action="paDisarmDelete" data-arg="${i}">Cancel</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/** @param {number} i */
function paArmDelete(i) {
  document.getElementById(`pa-del-card-${i}`)?.classList.add('armed');
  const confirm = document.getElementById(`pa-del-confirm-${i}`);
  if (confirm) confirm.style.display = 'flex';
  document.getElementById(`pa-del-pw-${i}`)?.focus();
}
/** @param {number} i */
function paDisarmDelete(i) {
  document.getElementById(`pa-del-card-${i}`)?.classList.remove('armed');
  const confirm = document.getElementById(`pa-del-confirm-${i}`);
  if (confirm) confirm.style.display = 'none';
  const pw = document.getElementById(`pa-del-pw-${i}`);
  if (pw) /** @type {HTMLInputElement} */ (pw).value = '';
}

/** @param {number} i */
async function paExecuteDelete(i) {
  const p = _paDeleteProfiles[i];
  if (!p) return;
  const pwEl = /** @type {HTMLInputElement|null} */ (document.getElementById(`pa-del-pw-${i}`));
  const pw = pwEl?.value || '';
  if (!pw) { toast('Enter the profile\'s password to confirm deletion.', 'error'); return; }

  // profiles:delete removes the LOADED profile — load the chosen one first
  // (deselect any other profile the user had open behind the modal).
  try { await api.invoke('profiles:deselect'); } catch {}
  const load = await api.invoke('profiles:load', { username: p.username });
  if (!load?.ok) { toast(load?.error || 'Could not open that profile.', 'error'); return; }

  const res = await api.invoke('profiles:delete', { password: pw });
  if (!res?.ok) {
    toast(res?.error || 'Deletion failed.', 'error');
    if (pwEl) { pwEl.value = ''; pwEl.focus(); }
    return;
  }
  closePreauthSettings();
  toast('Profile deleted.', 'success');
  // Full reload — the selector rebuilds without the deleted profile, and any
  // previously-selected profile state is cleanly discarded.
  setTimeout(() => api.send('navigate', 'login'), 1200);
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('preauth-settings-modal').style.display !== 'none')
    closePreauthSettings();
});
