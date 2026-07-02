'use strict';

// Dashboard page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, escapeHtml) — must load after ../components/shell.js.

let companies = [], allEntries = [];
let miniAnimFrame = null, miniResizeObserver = null;

window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('dashboard');
  document.documentElement.style.visibility = '';
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; mc.style.overflow = 'hidden'; }

  // Backup Now — page-specific action (the nav buttons use the shell's
  // delegated data-action="navigate" handler instead).
  document.getElementById('btn-backup-now')?.addEventListener('click', () => {
    api.invoke('settings:set', { key: 'backup_trigger', value: Date.now().toString() })
      .then(() => Shell.toast('Backup saved', 'success'));
  });

  await loadData();
  drawMiniWeb();
});

async function loadData() {
  companies  = await Store.getCompanies();
  allEntries = await Store.getEntriesSummary();

  const today   = new Date().toISOString().slice(0,10);
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);

  const todayMins   = allEntries.filter(e => e.log_date === today).reduce((a,e) => a+e.total_mins, 0);
  const weekMins    = allEntries.filter(e => e.log_date >= weekAgo).reduce((a,e) => a+e.total_mins, 0);
  const allTimeMins = allEntries.reduce((a,e) => a+e.total_mins, 0);

  document.getElementById('stat-today').textContent     = fmtH(todayMins);
  document.getElementById('stat-week').textContent      = fmtH(weekMins);
  document.getElementById('stat-alltime').textContent   = fmtH(allTimeMins);
  document.getElementById('stat-companies').textContent = companies.length;

  const compMap = {};
  companies.forEach(c => compMap[c.id] = c.name || '—');

  // C6 (D-009): future-dated entries don't belong in "Recent Activity" —
  // they'd headline the list indefinitely. They stay visible (badged) in the
  // Global Log instead.
  const recent = allEntries.filter(e => e.log_date <= today)
    .sort((a,b) => b.log_date.localeCompare(a.log_date)).slice(0, 8);
  const list   = document.getElementById('activity-list');
  if (recent.length === 0) return;

  list.innerHTML = recent.map(e => `
    <div class="activity-row">
      <div class="activity-company">${escapeHtml(compMap[e.company_id]) || '—'}</div>
      <div class="activity-date">${escapeHtml(e.log_date)}${e.session_label ? ' · ' + escapeHtml(e.session_label) : ''}</div>
      <div class="activity-hours">${fmtH(e.total_mins)}</div>
    </div>
  `).join('');
}

function fmtH(mins) {
  if (!mins) return '0h';
  return (mins / 60).toFixed(1) + 'h';
}

function drawMiniWeb() {
  const canvas = document.getElementById('web-canvas');
  const wrap   = document.getElementById('web-canvas-wrap');
  if (!canvas || !wrap) return;
  const ctx = canvas.getContext('2d');

  if (miniAnimFrame) cancelAnimationFrame(miniAnimFrame);
  if (miniResizeObserver) miniResizeObserver.disconnect();

  function resizeCanvas() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  resizeCanvas();
  miniResizeObserver = new ResizeObserver(() => {
    if (miniAnimFrame) cancelAnimationFrame(miniAnimFrame);
    resizeCanvas(); startRender();
  });
  miniResizeObserver.observe(wrap);
  startRender();

  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const cx = W/2, cy = H/2;
    const count = companies.length;
    const ringFrac = count <= 2 ? 0.30 : count <= 4 ? 0.34 : count <= 7 ? 0.38 : 0.42;
    const radius = Math.min(W, H) * ringFrac;
    const step = (Math.PI*2) / count;
    companies.forEach((co,i) => {
      const a = step*i - Math.PI/2;
      const nx = cx + Math.cos(a)*radius, ny = cy + Math.sin(a)*radius;
      if (Math.hypot(mx-nx, my-ny) < 24) {
        sessionStorage.setItem('active_company', JSON.stringify(co));
        api.send('navigate','tracker');
      }
    });
  });
}

function startRender() {
  const canvas = document.getElementById('web-canvas');
  const wrap   = document.getElementById('web-canvas-wrap');
  if (!canvas || !wrap) return;
  const ctx = canvas.getContext('2d');
  let pulse = 0;

  // Get accent color from CSS
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  function render() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) { miniAnimFrame = requestAnimationFrame(render); return; }
    const cx = W/2, cy = H/2;
    const c = getCanvasColors();
    pulse += 0.025;
    ctx.clearRect(0,0,W,H);

    // Grid
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 0.5;
    for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke(); }

    if (companies.length === 0) {
      drawSphereNode(ctx, cx, cy, 28, true, pulse, (window.__currentUsername || 'YOU'));
      ctx.fillStyle = c.node.label;
      ctx.globalAlpha = 0.4;
      ctx.font = '12px DM Sans, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('No companies yet', cx, cy + 40);
      ctx.globalAlpha = 1;
      miniAnimFrame = requestAnimationFrame(render);
      return;
    }

    const count = companies.length;
    const nodeR    = Math.max(11, Math.round(20 - count * 0.7));
    const ringFrac = count <= 2 ? 0.30 : count <= 4 ? 0.34 : count <= 7 ? 0.38 : 0.42;
    const radius   = Math.min(W, H) * ringFrac;
    const step = (Math.PI*2) / count;

    // Edges
    companies.forEach((co,i) => {
      const a = step*i - Math.PI/2;
      const nx = cx + Math.cos(a)*radius, ny = cy + Math.sin(a)*radius;
      const grad = ctx.createLinearGradient(cx,cy,nx,ny);
      grad.addColorStop(0, c.edge1); grad.addColorStop(1, c.edge2);
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(nx,ny);
      ctx.strokeStyle = grad; ctx.lineWidth = 1.5; ctx.stroke();
    });

    // Company nodes
    companies.forEach((co,i) => {
      const a = step*i - Math.PI/2;
      const nx = cx + Math.cos(a)*radius, ny = cy + Math.sin(a)*radius;
      drawSphereNode(ctx, nx, ny, nodeR, false, pulse, co.name || '?');
    });

    // Center node on top
    drawSphereNode(ctx, cx, cy, 28, true, pulse, (window.__currentUsername || 'YOU'));

    miniAnimFrame = requestAnimationFrame(render);
  }
  miniAnimFrame = requestAnimationFrame(render);
}

function getCanvasColors() {
  const theme = document.documentElement.getAttribute('data-theme') || 'memoria';
  const isLight = theme === 'memoria' || theme === 'rabanastre';
  if (isLight) return {
    center: { g1:'rgba(30,58,138,0.95)', g2:'rgba(15,23,80,0.9)', border:'#1d4ed8', label:'#ffffff', glow:'rgba(29,78,216,0.2)' },
    node:   { g1:'rgba(49,46,129,0.95)', g2:'rgba(30,27,90,0.9)', border:'#4338ca', label:'#ffffff' },
    edge1:'rgba(29,78,216,0.7)', edge2:'rgba(67,56,202,0.2)',
    grid:'rgba(0,0,0,0.06)', hours:'#92400e'
  };
  return {
    center: { base:'#0f2060', g1:'rgba(80,130,255,1)', g2:'rgba(25,55,175,1)', border:'#3b82f6', label:'#bfdbfe', glow:'rgba(59,130,246,0.12)' },
    node:   { g1:'rgba(129,140,248,0.22)', g2:'rgba(67,56,202,0.14)', border:'#6366f1', label:'#e0e7ff' },
    edge1:'rgba(59,130,246,0.5)', edge2:'rgba(99,102,241,0.08)',
    grid:'rgba(255,255,255,0.025)', hours:'rgba(245,158,11,0.9)'
  };
}

function drawSphereNode(ctx, x, y, r, isCenter, pulse, label) {
  const c = getCanvasColors();
  const nc = isCenter ? c.center : c.node;
  const pR = isCenter ? r + 3*Math.sin(pulse) : r;

  if (isCenter) {
    ctx.beginPath(); ctx.arc(x,y,pR+10,0,Math.PI*2);
    ctx.fillStyle = nc.glow || 'rgba(59,130,246,0.12)'; ctx.fill();
    if (nc.base) {
      ctx.beginPath(); ctx.arc(x,y,pR,0,Math.PI*2);
      ctx.fillStyle = nc.base; ctx.fill();
    }
  }
  const grad = ctx.createRadialGradient(x-pR*0.3,y-pR*0.3,pR*0.1,x,y,pR);
  grad.addColorStop(0, nc.g1); grad.addColorStop(0.6, nc.g2); grad.addColorStop(1, isCenter ? 'rgba(8,18,70,1)' : 'rgba(0,0,0,0.35)');
  ctx.beginPath(); ctx.arc(x,y,pR,0,Math.PI*2);
  ctx.fillStyle=grad; ctx.fill();
  ctx.strokeStyle=nc.border; ctx.lineWidth=isCenter?2:1.5; ctx.stroke();
  const hl=ctx.createRadialGradient(x-pR*0.35,y-pR*0.35,0,x-pR*0.35,y-pR*0.35,pR*0.6);
  hl.addColorStop(0,'rgba(255,255,255,0.14)'); hl.addColorStop(1,'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(x,y,pR,0,Math.PI*2); ctx.fillStyle=hl; ctx.fill();
  // D-003: company nodes label ONCE below the node (the old code drew the same
  // clipped text twice — inside AND below), ellipsized instead of char-sliced.
  ctx.textAlign='center';
  if (isCenter) {
    ctx.fillStyle=nc.label;
    ctx.font='600 10px DM Sans, system-ui, sans-serif';
    ctx.textBaseline='middle';
    ctx.fillText(CanvasText.ellipsizeToWidth(ctx, label, 2*pR-6), x, y);
  } else {
    ctx.fillStyle=nc.label; ctx.font='10px DM Sans, system-ui, sans-serif';
    ctx.textBaseline='top';
    ctx.fillText(CanvasText.ellipsizeToWidth(ctx, label, 84), x, y+pR+5);
  }
}
