'use strict';

// Profile page logic. Externalized from an inline <script> so the page runs under
// a strict script-src 'self' CSP. Depends on globals injected by shell.js (Shell,
// api) — must load after shell.js.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

let avatarDataUrl: string | null = null;
let dirty = false;
let originalValues: Record<string, string | null> = {};
let sessionInfo: SessionInfo | null = null;

const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $field = (id: string): HTMLInputElement | HTMLSelectElement =>
  document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('profile');
  document.documentElement.style.visibility = '';

  // Build state dropdown options via JS to avoid a large static option list
  (function buildStateDropdown() {
    const states: Array<[string, string]> = [
      ['','Not specified (general recommendations)'],
      ['AK','Alaska'],['AL','Alabama'],['AR','Arkansas'],['AZ','Arizona'],
      ['CA','California'],['CO','Colorado'],['CT','Connecticut'],
      ['DC','Washington D.C.'],['DE','Delaware'],['FL','Florida'],
      ['GA','Georgia'],['HI','Hawaii'],['IA','Iowa'],['ID','Idaho'],
      ['IL','Illinois'],['IN','Indiana'],['KS','Kansas'],['KY','Kentucky'],
      ['LA','Louisiana'],['MA','Massachusetts'],['MD','Maryland'],['ME','Maine'],
      ['MI','Michigan'],['MN','Minnesota'],['MO','Missouri'],['MS','Mississippi'],
      ['MT','Montana'],['NC','North Carolina'],['ND','North Dakota'],['NE','Nebraska'],
      ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NV','Nevada'],
      ['NY','New York'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],
      ['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
      ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
      ['VA','Virginia'],['VT','Vermont'],['WA','Washington'],['WI','Wisconsin'],
      ['WV','West Virginia'],['WY','Wyoming'],
    ];
    const sel = $id('field-work-state');
    states.forEach(([code, name]) => {
      const opt = document.createElement('option');
      opt.value = code; opt.textContent = name;
      sel.appendChild(opt);
    });
  })();

  const profile = await api.invoke('profile:get');
  sessionInfo = await api.invoke('session:get');

  // Populate identity sidebar
  const username = sessionInfo?.username || '—';
  $id('identity-username-value').textContent = username;

  const displayName = profile?.display_name || '';
  $field('field-display-name').value = displayName;
  $id('identity-display-name-view').textContent = displayName || username;
  updateAvatarPreview(profile?.avatar || null, displayName || username);

  // Populate personal details
  $field('field-full-name').value  = profile?.full_name  || '';
  $field('field-job-title').value  = profile?.job_title  || '';
  $field('field-work-state').value = profile?.work_state || '';
  $field('field-email').value      = profile?.email      || '';
  $field('field-phone').value      = profile?.phone      || '';

  avatarDataUrl = profile?.avatar || null;

  // Snapshot original values for dirty tracking
  snapshotOriginal();

  // ── Email-required gate ───────────────────────────────────────────────
  const requireEmail = sessionStorage.getItem('require_email') === '1';
  if (requireEmail) {
    const banner = document.getElementById('email-required-banner');
    if (banner) banner.style.display = 'flex';
    // Focus email field so user knows exactly where to go
    setTimeout(() => document.getElementById('field-email')?.focus(), 100);
    // Block sidebar nav links until email is saved
    document.addEventListener('click', function emailGate(e) {
      const navLink = (e.target as HTMLElement).closest('.nav-item, .sidebar-nav a, [data-page]');
      if (navLink && !navLink.closest('#profile-layout')) {
        if (!($field('field-email')?.value || '').trim()) {
          e.stopImmediatePropagation();
          e.preventDefault();
          Shell.toast('Add an email address and save your profile before navigating away.', 'error');
        }
      }
    }, true);
  }

  // ── Event listeners ──────────────────────────────────────────────────
  const trackableInputs = [
    'field-display-name', 'field-full-name', 'field-job-title',
    'field-work-state', 'field-email', 'field-phone'
  ];
  trackableInputs.forEach(id => {
    $id(id).addEventListener('input', () => {
      markDirty();
      // Live-update the identity preview from display name
      if (id === 'field-display-name') {
        const dn = $field('field-display-name').value.trim();
        $id('identity-display-name-view').textContent = dn || username;
        updateAvatarInitials(dn || username);
      }
    });
  });

  // Avatar upload
  $id('avatar-wrap').addEventListener('click', () => {
    $id('avatar-file-input').click();
  });
  $id('avatar-file-input').addEventListener('change', handleAvatarUpload);

  // Save
  $id('btn-save').addEventListener('click', saveProfile);

  // Password panel toggle
  $id('pw-toggle').addEventListener('click', () => {
    const body    = $id('pw-body');
    const chevron = $id('pw-chevron');
    const isOpen  = body.classList.toggle('open');
    chevron.classList.toggle('open', isOpen);
  });

  // Change password
  $id('btn-change-password').addEventListener('click', changePassword);

  // Crop modal
  initCropModal();
});

// ── Avatar helpers ───────────────────────────────────────────────────────
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function updateAvatarInitials(name: string): void {
  if (avatarDataUrl) return; // avatar image takes precedence
  $id('avatar-initials').textContent = getInitials(name);
}

function updateAvatarPreview(dataUrl: string | null, fallbackName: string): void {
  const circle = $id('avatar-circle');
  const initials = $id('avatar-initials');
  if (dataUrl) {
    initials.style.display = 'none';
    let img = circle.querySelector('img');
    if (!img) { img = document.createElement('img'); circle.appendChild(img); }
    img.src = dataUrl;
  } else {
    initials.style.display = '';
    initials.textContent = getInitials(fallbackName || '?');
    const img = circle.querySelector('img');
    if (img) img.remove();
  }
}

const ANIMATED_TYPES = ['image/gif', 'image/apng', 'image/webp'];

// ── Crop state ───────────────────────────────────────────────────────────
const CROP_SIZE = 280; // canvas/viewport px
let cropImg: HTMLImageElement | null = null;
let cropMinScale = 1;
let cropScale  = 1;
let cropOx     = 0; // image draw origin X on canvas
let cropOy     = 0;
let cropDragging = false;
let cropDragStartX = 0, cropDragStartY = 0;
let cropDragOriginX = 0, cropDragOriginY = 0;

function cropClamp(): void {
  // Keep image covering the circle (no blank edges inside viewport)
  const iw = cropImg!.width  * cropScale;
  const ih = cropImg!.height * cropScale;
  cropOx = Math.min(0, Math.max(CROP_SIZE - iw, cropOx));
  cropOy = Math.min(0, Math.max(CROP_SIZE - ih, cropOy));
}

function cropDraw(): void {
  const canvas = document.getElementById('crop-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(cropImg!, cropOx, cropOy,
    cropImg!.width * cropScale, cropImg!.height * cropScale);
}

function cropSetScale(newScale: number): void {
  // Zoom around canvas center
  const cx = CROP_SIZE / 2, cy = CROP_SIZE / 2;
  const ratio = newScale / cropScale;
  cropOx = cx - (cx - cropOx) * ratio;
  cropOy = cy - (cy - cropOy) * ratio;
  cropScale = newScale;
  cropClamp();
  cropDraw();
  syncSlider();
}

function syncSlider(): void {
  const slider = $field('crop-zoom-slider');
  const maxScale = cropMinScale * 4;
  const t = (cropScale - cropMinScale) / (maxScale - cropMinScale);
  slider.value = String(Math.round(t * 100));
}

function openCropModal(img: HTMLImageElement): void {
  cropImg = img;
  // Min scale: image must cover the full CROP_SIZE circle
  cropMinScale = Math.max(CROP_SIZE / img.width, CROP_SIZE / img.height);
  cropScale    = cropMinScale;
  // Center image
  cropOx = (CROP_SIZE - img.width  * cropScale) / 2;
  cropOy = (CROP_SIZE - img.height * cropScale) / 2;
  cropClamp();
  cropDraw();
  syncSlider();
  $id('crop-modal').classList.remove('hidden');
}

function commitCrop(): void {
  const out = document.createElement('canvas');
  out.width = 200; out.height = 200;
  const ctx = out.getContext('2d')!;
  // Map the canvas viewport back to image source coords
  const srcX = -cropOx / cropScale;
  const srcY = -cropOy / cropScale;
  const srcW =  CROP_SIZE / cropScale;
  const srcH =  CROP_SIZE / cropScale;
  ctx.drawImage(cropImg!, srcX, srcY, srcW, srcH, 0, 0, 200, 200);
  avatarDataUrl = out.toDataURL('image/jpeg', 0.85);
  updateAvatarPreview(avatarDataUrl, '');
  markDirty();
  $id('crop-modal').classList.add('hidden');
}

function handleAvatarUpload(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    // readAsDataURL always yields a string result.
    const dataUrl = evt.target?.result as string;
    if (ANIMATED_TYPES.includes(file.type)) {
      avatarDataUrl = dataUrl;
      updateAvatarPreview(avatarDataUrl, '');
      markDirty();
    } else {
      const img = new Image();
      img.onload = () => openCropModal(img);
      img.src = dataUrl;
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// Crop modal interactions (wired after DOMContentLoaded)
function initCropModal(): void {
  const viewport = $id('crop-viewport');
  const slider   = $field('crop-zoom-slider');

  // Drag to pan
  viewport.addEventListener('mousedown', (ev: MouseEvent) => {
    cropDragging   = true;
    cropDragStartX = ev.clientX;
    cropDragStartY = ev.clientY;
    cropDragOriginX = cropOx;
    cropDragOriginY = cropOy;
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev: MouseEvent) => {
    if (!cropDragging) return;
    cropOx = cropDragOriginX + (ev.clientX - cropDragStartX);
    cropOy = cropDragOriginY + (ev.clientY - cropDragStartY);
    cropClamp();
    cropDraw();
  });
  window.addEventListener('mouseup', () => { cropDragging = false; });

  // Scroll to zoom
  viewport.addEventListener('wheel', (ev: WheelEvent) => {
    ev.preventDefault();
    const delta = ev.deltaY > 0 ? -0.05 : 0.05;
    const maxScale = cropMinScale * 4;
    cropSetScale(Math.max(cropMinScale, Math.min(maxScale, cropScale + delta * cropMinScale)));
  }, { passive: false });

  // +/- buttons
  $id('crop-zoom-in').addEventListener('click', () => {
    cropSetScale(Math.min(cropMinScale * 4, cropScale + 0.1 * cropMinScale));
  });
  $id('crop-zoom-out').addEventListener('click', () => {
    cropSetScale(Math.max(cropMinScale, cropScale - 0.1 * cropMinScale));
  });

  // Slider
  slider.addEventListener('input', () => {
    const t = Number(slider.value) / 100;
    const maxScale = cropMinScale * 4;
    const newScale = cropMinScale + t * (maxScale - cropMinScale);
    cropSetScale(newScale);
  });

  $id('crop-apply').addEventListener('click', commitCrop);
  $id('crop-cancel').addEventListener('click', () => {
    $id('crop-modal').classList.add('hidden');
  });
}

// ── Dirty tracking ───────────────────────────────────────────────────────
function snapshotOriginal(): void {
  originalValues = {
    display_name: $field('field-display-name').value,
    full_name:    $field('field-full-name').value,
    job_title:    $field('field-job-title').value,
    work_state:   $field('field-work-state').value,
    email:        $field('field-email').value,
    phone:        $field('field-phone').value,
    avatar:       avatarDataUrl,
  };
  dirty = false;
  setDirtyUI(false);
}

function markDirty(): void {
  dirty = true;
  setDirtyUI(true);
}

function setDirtyUI(isDirty: boolean): void {
  $id('unsaved-dot').classList.toggle('visible', isDirty);
  $id('unsaved-label').classList.toggle('visible', isDirty);
}

// ── Save ─────────────────────────────────────────────────────────────────
function makeThumb48(dataUrl: string | null): Promise<string | null> | null {
  if (!dataUrl) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      c.getContext('2d')!.drawImage(img, 0, 0, 48, 48);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function saveProfile(): Promise<void> {
  const payload = {
    display_name:    $field('field-display-name').value.trim(),
    full_name:       $field('field-full-name').value.trim(),
    job_title:       $field('field-job-title').value.trim(),
    work_state:      $field('field-work-state').value || null,
    email:           $field('field-email').value.trim(),
    phone:           $field('field-phone').value.trim(),
    avatar:          avatarDataUrl,
    avatar_thumb_48: await makeThumb48(avatarDataUrl),
  };
  if (sessionStorage.getItem('require_email') === '1' && !payload.email) {
    Shell.toast('Email address is required. Please add one before saving.', 'error');
    document.getElementById('field-email')?.focus();
    return;
  }
  const res = await api.invoke('profile:save', payload);
  if (res?.ok) {
    Shell.toast('Profile saved.', 'success');
    Shell.setSidebarAvatar({ avatar: avatarDataUrl }, payload.display_name, sessionInfo?.username);
    snapshotOriginal();
    // Email gate satisfied — clear flag and continue to dashboard
    if (sessionStorage.getItem('require_email') === '1') {
      sessionStorage.removeItem('require_email');
      Shell.toast('Email saved. Taking you to the dashboard.', 'success');
      setTimeout(() => api.send('navigate', 'dashboard'), 800);
    }
  } else {
    Shell.toast('Save failed: ' + (res?.error || 'unknown error'), 'error');
  }
}

// ── Change password ──────────────────────────────────────────────────────
async function changePassword(): Promise<void> {
  const result   = $id('pw-result');
  const currentPw = $field('field-current-pw').value;
  const totp      = $field('field-totp').value.trim();
  const newPw     = $field('field-new-pw').value;
  const confirmPw = $field('field-confirm-pw').value;

  result.style.display = 'none';

  if (!currentPw || !totp || !newPw || !confirmPw) {
    showPwResult('error', 'All fields are required.');
    return;
  }
  if (newPw !== confirmPw) {
    showPwResult('error', 'New passwords do not match.');
    return;
  }
  if (newPw.length < 8) {
    showPwResult('error', 'New password must be at least 8 characters.');
    return;
  }

  const btn = document.getElementById('btn-change-password') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Updating…';

  const res = await api.invoke('auth:change-password', {
    currentPassword: currentPw,
    totpCode:        totp,
    newPassword:     newPw,
  });

  btn.disabled = false;
  btn.textContent = 'Change Password';

  if (res?.ok) {
    showPwResult('success', 'Password changed successfully. All data re-encrypted with your new key.');
    // Clear fields and collapse panel on success
    ['field-current-pw', 'field-totp', 'field-new-pw', 'field-confirm-pw'].forEach(id => {
      $field(id).value = '';
    });
    setTimeout(() => {
      $id('pw-body').classList.remove('open');
      $id('pw-chevron').classList.remove('open');
      $id('pw-result').style.display = 'none';
    }, 2500);
  } else {
    showPwResult('error', res?.error || 'Password change failed.');
  }
}

function showPwResult(type: string, msg: string): void {
  const el = $id('pw-result');
  el.className = `pw-result ${type}`;
  el.textContent = msg;
  el.style.display = '';
}

})();
