'use strict';

// Dispatch (task timer) page logic. Externalized from an inline <script> so the
// page runs under a strict script-src 'self' CSP. Depends on globals injected by
// shell.js (Shell, api, Settings, escapeHtml) — must load after shell.js.

// ── State ──────────────────────────────────────────────────────────────────
let activeEntry   = null;   // full entry object from entries:get-active
let taskItems     = [];     // current session task_items
let activeTaskId  = null;   // task_item id of the in-progress task (or null)
let timerStart    = null;   // Date.now() when current task started
let timerInterval = null;   // setInterval handle for stopwatch

let activeBreakId  = null;  // task_item id of in-progress break
let activeLunchId  = null;  // task_item id of in-progress lunch
let sessionStartMs = null;  // ms when the active row clocked in (for compliance calc)
let dispatchPolicy = null;  // loaded from audit:get-policy on init

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtSecs(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtDurSecs(secs) {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtTime(hhmm) {
  if (!hhmm) return '—';
  if (Settings.get('timeFormat') === '12h') {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }
  return hhmm;
}

function parseHHMMtoMs(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const today = new Date();
  today.setHours(h, m, 0, 0);
  return today.getTime();
}

function buildDescString(tasks) {
  const completed = tasks.filter(t => t.item_type === 'task' && t.stopped_at);
  if (!completed.length) return '';
  const counts = {};
  completed.forEach(t => { counts[t.label] = (counts[t.label] || 0) + 1; });
  const parts = Object.entries(counts)
    .sort((a,b) => b[1]-a[1])
    .map(([l,c]) => c > 1 ? `${l} ×${c}` : l);
  const hasBreakOverdue  = checkComplianceStatus('break')  === 'over';
  const hasLunchOverdue  = checkComplianceStatus('lunch')  === 'over';
  const warnings = [
    hasBreakOverdue  && '⚠ Break overdue',
    hasLunchOverdue  && '⚠ Lunch overdue',
  ].filter(Boolean);
  const warnStr = warnings.length ? ` | ${warnings.join(', ')}` : '';
  return `[${completed.length} task${completed.length===1?'':'s'}${warnStr}] ${parts.join(', ')}`;
}

function checkComplianceStatus(type) {
  // Returns 'ok', 'warn' (approaching), or 'over'
  const p = dispatchPolicy;
  let thresholdMs, warnMs;
  if (type === 'break') {
    // Break is "overdue" once the session crosses breakThresholds[0][0] (transition from 0→1+ required).
    // null threshold means no break requirement (meal_only) → treat as Infinity → never overdue.
    const rawDue = p?.breakThresholds?.[0]?.[0];
    thresholdMs = (rawDue != null) ? rawDue * 60000 : Infinity;
    const rawWarn = p?.dispatchBreakWarnMins;
    warnMs = (rawWarn != null) ? rawWarn * 60000 : Infinity;
  } else {
    thresholdMs = p ? p.lunchThreshMins * 60000 : 5 * 3600000;
    const rawLunchWarn = p?.dispatchLunchWarnMins;
    warnMs = (rawLunchWarn != null) ? rawLunchWarn * 60000 : 4.5 * 3600000;
  }
  const relevant = taskItems.filter(t => t.item_type === type && t.stopped_at);
  const activeItem = taskItems.find(
    t => t.item_type === type && !t.stopped_at
  );
  if (activeItem) return 'ok'; // currently on break/lunch
  const lastStop = relevant.length
    ? Math.max(...relevant.map(t => t.stopped_at))
    : (sessionStartMs || Date.now());
  const elapsed = Date.now() - lastStop;
  if (elapsed >= thresholdMs) return 'over';
  if (elapsed >= warnMs) return 'warn';
  return 'ok';
}

function elapsedSinceMs(ms) {
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Banner ─────────────────────────────────────────────────────────────────
async function updateBanner() {
  const banner = document.getElementById('session-banner');
  if (!activeEntry) {
    banner.classList.add('no-session');
    document.getElementById('no-session-msg').style.display = '';
    document.getElementById('tt-main').style.display        = 'none';
    document.getElementById('live-badge').style.display     = 'none';
    return;
  }
  banner.classList.remove('no-session');
  document.getElementById('no-session-msg').style.display = 'none';
  document.getElementById('tt-main').style.display        = 'grid';
  document.getElementById('live-badge').style.display     = '';

  // Find active row (clocked in, not clocked out)
  const rows = JSON.parse(activeEntry.rows_json || '[]');
  const activeRow = rows.find(r => r.clock_in && !r.clock_out);
  const clockIn = activeRow?.clock_in || null;
  if (clockIn) sessionStartMs = parseHHMMtoMs(clockIn);

  document.getElementById('banner-company').textContent = activeEntry.company_name || activeEntry.session_label || 'Session';
  document.getElementById('banner-date').textContent    = activeEntry.log_date || '—';
  document.getElementById('banner-clock-in').textContent = clockIn ? fmtTime(clockIn) : '—';
  updateBannerDuration();
}

function updateBannerDuration() {
  if (!sessionStartMs) return;
  const el = document.getElementById('banner-duration');
  if (el) el.textContent = elapsedSinceMs(sessionStartMs);
}

// ── Recent labels ──────────────────────────────────────────────────────────
async function loadRecentLabels() {
  const labels = await api.invoke('tasks:recent-labels');
  const datalist = document.getElementById('recent-labels-list');
  const row = document.getElementById('quickpick-row');
  datalist.innerHTML = labels.map(l => `<option value="${l}">`).join('');
  row.innerHTML = labels.map(l =>
    `<button class="tt-quick-chip" data-label="${l}">${l}</button>`
  ).join('');
  row.querySelectorAll('.tt-quick-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('task-label-input').value = btn.dataset.label;
      document.getElementById('task-label-input').focus();
    });
  });
}

// ── Task list render ───────────────────────────────────────────────────────
function renderTaskList() {
  const list = document.getElementById('task-list');
  const completed = taskItems.filter(t => t.item_type === 'task' && t.stopped_at);
  if (!completed.length) {
    list.innerHTML = '<div style="font-family:var(--sans);font-size:12px;color:var(--text-muted);padding:12px 0;text-align:center;">No tasks logged yet</div>';
  } else {
    list.innerHTML = completed.map((t, i) => `
      <div class="tt-task-row">
        <span class="tt-task-num">#${i+1}</span>
        <span class="tt-task-label">${escapeHtml(t.label)}</span>
        <span class="tt-task-dur">${fmtDurSecs(t.duration_secs)}</span>
        <button class="tt-task-del" data-id="${t.id}" title="Remove">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('.tt-task-del').forEach(btn => {
      btn.addEventListener('click', () => deleteTask(Number(btn.dataset.id)));
    });
  }
  const count = completed.length;
  document.getElementById('counter-num').textContent = count;

  const preview = document.getElementById('desc-preview');
  const previewText = document.getElementById('desc-preview-text');
  const desc = buildDescString(taskItems);
  if (desc) {
    preview.style.display = '';
    previewText.textContent = desc;
  } else {
    preview.style.display = 'none';
  }
}

// ── Compliance indicators ──────────────────────────────────────────────────
function renderCompliance() {
  renderComplianceFor('break');
  renderComplianceFor('lunch');
}

function renderComplianceFor(type) {
  const el = document.getElementById(`compliance-${type}`);
  if (!el) return;

  const status = checkComplianceStatus(type);
  el.className = `tt-compliance ${status}`;

  const activeItem = taskItems.find(t => t.item_type === type && !t.stopped_at);
  const relevant   = taskItems.filter(t => t.item_type === type && t.stopped_at);
  const p2 = dispatchPolicy;
  const threshLabel = type === 'break'
    ? (() => { for (const [t,c] of (p2?.breakThresholds||[[210,0],[360,1]])) { if (c===1) return `${Math.round(t/60*10)/10}h`; } return '3.5h'; })()
    : `${Math.round((p2?.lunchThreshMins||300)/60*10)/10}h`;

  if (activeItem) {
    el.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>
      ${type === 'break' ? 'On break' : 'On lunch'} since ${fmtTime(new Date(activeItem.started_at).toTimeString().slice(0,5))}`;
    return;
  }
  if (!relevant.length) {
    if (!sessionStartMs) { el.textContent = '—'; return; }
    const elapsed = Date.now() - sessionStartMs;
    const elStr = elapsedSinceMs(sessionStartMs);
    if (status === 'over')
      el.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> ⚠ No ${type} taken — ${elStr} since clock-in (over ${threshLabel})`;
    else if (status === 'warn')
      el.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> Approaching ${type} time (${elStr})`;
    else
      el.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> No ${type} yet — ${elStr} since clock-in`;
    return;
  }
  const lastStop = Math.max(...relevant.map(t => t.stopped_at));
  const elStr = elapsedSinceMs(lastStop);
  if (status === 'over')
    el.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> ⚠ ${type === 'break' ? 'Break overdue' : 'Lunch overdue'} — last ${type} ${elStr} ago`;
  else
    el.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> Last ${type}: ${elStr} ago ✓`;
}

// ── Break/Lunch buttons ────────────────────────────────────────────────────
function updateBreakButtons() {
  const btnBreak = document.getElementById('btn-break');
  const btnLunch = document.getElementById('btn-lunch');

  if (activeBreakId) {
    btnBreak.textContent = '✓ End Break';
    btnBreak.classList.add('active');
  } else {
    btnBreak.textContent = '☕ Start Break';
    btnBreak.classList.remove('active');
  }

  if (activeLunchId) {
    btnLunch.textContent = '✓ End Lunch';
    btnLunch.classList.add('active');
  } else {
    btnLunch.textContent = 'Start Lunch';
    btnLunch.classList.remove('active');
  }
}

// ── Timer controls ─────────────────────────────────────────────────────────
function startStopwatch(startedAtMs) {
  timerStart = startedAtMs || Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - timerStart) / 1000);
    document.getElementById('stopwatch').textContent = fmtSecs(elapsed);
    document.getElementById('stopwatch').classList.add('running');
  }, 1000);
  // Render first tick immediately so the display isn't 00:00 for a second
  const elapsed = Math.floor((Date.now() - timerStart) / 1000);
  document.getElementById('stopwatch').textContent = fmtSecs(elapsed);
  document.getElementById('stopwatch').classList.add('running');
}

function stopStopwatch() {
  clearInterval(timerInterval);
  timerInterval = null;
  document.getElementById('stopwatch').classList.remove('running');
}

function resetStopwatch() {
  document.getElementById('stopwatch').textContent = '00:00';
  document.getElementById('stopwatch').classList.remove('running');
}

// ── Write description back to Time Tracker entry ──────────────────────────
async function writeDescToEntry() {
  if (!activeEntry) return;
  const desc = buildDescString(taskItems);
  const rows = JSON.parse(activeEntry.rows_json || '[]');
  // Find the active row (clocked in, not clocked out)
  const activeRowIdx = rows.findIndex(r => r.clock_in && !r.clock_out);
  if (activeRowIdx === -1) return;
  rows[activeRowIdx].desc = desc;
  activeEntry.rows_json = JSON.stringify(rows);
  await api.invoke('entries:save', {
    id: activeEntry.id,
    company_id: activeEntry.company_id,
    log_date: activeEntry.log_date,
    session_label: activeEntry.session_label || '',
    rows_json: activeEntry.rows_json,
    total_mins: activeEntry.total_mins || 0,
  });
}

// ── Delete task ────────────────────────────────────────────────────────────
async function deleteTask(id) {
  await api.invoke('tasks:delete', id);
  taskItems = taskItems.filter(t => t.id !== id);
  renderTaskList();
  renderCompliance();
  await writeDescToEntry();
}

// ── Compliance check tick ─────────────────────────────────────────────────
async function complianceTick() {
  renderCompliance();
  const breakStatus = checkComplianceStatus('break');
  const lunchStatus = checkComplianceStatus('lunch');

  if (breakStatus === 'over' && !activeBreakId) {
    Shell.toast('Take a break — you\'ve been working over 2 hours.', 'info', 6000);
    await writeDescToEntry();
  }
  if (lunchStatus === 'over' && !activeLunchId) {
    Shell.toast('Time for lunch — you\'ve been working over 5 hours.', 'info', 6000);
    await writeDescToEntry();
  }
}

// ── Main init ─────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('task-timer');
  document.documentElement.style.visibility = '';

  dispatchPolicy = await api.invoke('audit:get-policy');

  // Load active entry
  activeEntry = await api.invoke('entries:get-active');
  await updateBanner();

  if (!activeEntry) {
    // Wire buttons to show error — don't silently swallow clicks
    const noSessionGuard = () => {
      Shell.toast('No active punch. Go to Time Tracker and clock in first.', 'error');
    };
    document.getElementById('btn-start').addEventListener('click', noSessionGuard);
    document.getElementById('btn-break').addEventListener('click', noSessionGuard);
    document.getElementById('btn-lunch').addEventListener('click', noSessionGuard);
    return;
  }

  // Load tasks and recent labels
  taskItems = await api.invoke('tasks:list', activeEntry.id);

  // Detect any in-progress break/lunch
  const inProgressBreak = taskItems.find(t => t.item_type === 'break' && !t.stopped_at);
  const inProgressLunch = taskItems.find(t => t.item_type === 'lunch' && !t.stopped_at);
  if (inProgressBreak) activeBreakId = inProgressBreak.id;
  if (inProgressLunch) activeLunchId = inProgressLunch.id;

  // Resume an in-progress task (user navigated away and returned)
  const inProgressTask = taskItems.find(t => t.item_type === 'task' && t.started_at && !t.stopped_at);
  if (inProgressTask) {
    activeTaskId = inProgressTask.id;
    document.getElementById('task-label-input').value    = inProgressTask.label;
    document.getElementById('task-label-input').disabled = true;
    document.getElementById('btn-start').style.display   = 'none';
    document.getElementById('btn-stop').style.display    = '';
    document.getElementById('btn-cancel').style.display  = '';
    startStopwatch(inProgressTask.started_at);
    Shell.showSidebarTimer(inProgressTask.started_at);
  }

  renderTaskList();
  renderCompliance();
  updateBreakButtons();
  await loadRecentLabels();

  // ── Banner duration ticker ──
  setInterval(updateBannerDuration, 30000);

  // ── Compliance tick every 60s ──
  setInterval(complianceTick, 60000);

  // ── Start Task ──
  document.getElementById('btn-start').addEventListener('click', async () => {
    const label = document.getElementById('task-label-input').value.trim();
    if (!label) {
      Shell.toast('Enter a task label first.', 'info');
      document.getElementById('task-label-input').focus();
      return;
    }
    // Save task_item as started
    const res = await api.invoke('tasks:save', {
      entry_id: activeEntry.id,
      label,
      item_type: 'task',
      started_at: Date.now(),
      duration_secs: 0,
    });
    activeTaskId = res.id;
    startStopwatch();
    Shell.showSidebarTimer(timerStart);

    document.getElementById('btn-start').style.display  = 'none';
    document.getElementById('btn-stop').style.display   = '';
    document.getElementById('btn-cancel').style.display = '';
    document.getElementById('task-label-input').disabled = true;
  });

  // ── Stop & Log ──
  document.getElementById('btn-stop').addEventListener('click', async () => {
    if (!activeTaskId) return;
    const durationSecs = Math.floor((Date.now() - timerStart) / 1000);
    stopStopwatch();

    // Update the task_item with stopped_at and duration
    const label = document.getElementById('task-label-input').value.trim();
    await api.invoke('tasks:save', {
      id: activeTaskId,
      label,
      item_type: 'task',
      stopped_at: Date.now(),
      duration_secs: durationSecs,
    });

    // Refresh task list
    taskItems = await api.invoke('tasks:list', activeEntry.id);
    renderTaskList();
    renderCompliance();
    await writeDescToEntry();
    await loadRecentLabels();

    // Reset controls
    activeTaskId = null;
    timerStart = null;
    resetStopwatch();
    Shell.hideSidebarTimer();
    document.getElementById('task-label-input').value    = '';
    document.getElementById('task-label-input').disabled = false;
    document.getElementById('task-label-input').focus();
    document.getElementById('btn-start').style.display  = '';
    document.getElementById('btn-stop').style.display   = 'none';
    document.getElementById('btn-cancel').style.display = 'none';
  });

  // ── Cancel ──
  document.getElementById('btn-cancel').addEventListener('click', async () => {
    if (activeTaskId) {
      await api.invoke('tasks:delete', activeTaskId);
      taskItems = taskItems.filter(t => t.id !== activeTaskId);
    }
    activeTaskId = null;
    timerStart   = null;
    stopStopwatch();
    resetStopwatch();
    Shell.hideSidebarTimer();
    document.getElementById('task-label-input').value    = '';
    document.getElementById('task-label-input').disabled = false;
    document.getElementById('btn-start').style.display  = '';
    document.getElementById('btn-stop').style.display   = 'none';
    document.getElementById('btn-cancel').style.display = 'none';
  });

  // ── Break toggle ──
  document.getElementById('btn-break').addEventListener('click', async () => {
    if (activeBreakId) {
      // End break
      const durationSecs = Math.floor((Date.now() - taskItems.find(t=>t.id===activeBreakId)?.started_at) / 1000);
      await api.invoke('tasks:save', {
        id: activeBreakId,
        label: 'Break',
        item_type: 'break',
        stopped_at: Date.now(),
        duration_secs: Math.max(0, durationSecs),
      });
      activeBreakId = null;
      Shell.toast('Break ended.', 'success');
    } else {
      // Start break
      const res = await api.invoke('tasks:save', {
        entry_id: activeEntry.id,
        label: 'Break',
        item_type: 'break',
        started_at: Date.now(),
        duration_secs: 0,
      });
      activeBreakId = res.id;
      Shell.toast('Break started.', 'success');
    }
    taskItems = await api.invoke('tasks:list', activeEntry.id);
    updateBreakButtons();
    renderCompliance();
  });

  // ── Lunch toggle ──
  document.getElementById('btn-lunch').addEventListener('click', async () => {
    if (activeLunchId) {
      const durationSecs = Math.floor((Date.now() - taskItems.find(t=>t.id===activeLunchId)?.started_at) / 1000);
      await api.invoke('tasks:save', {
        id: activeLunchId,
        label: 'Lunch',
        item_type: 'lunch',
        stopped_at: Date.now(),
        duration_secs: Math.max(0, durationSecs),
      });
      activeLunchId = null;
      Shell.toast('Lunch ended.', 'success');
    } else {
      const res = await api.invoke('tasks:save', {
        entry_id: activeEntry.id,
        label: 'Lunch',
        item_type: 'lunch',
        started_at: Date.now(),
        duration_secs: 0,
      });
      activeLunchId = res.id;
      Shell.toast('Lunch started.', 'success');
    }
    taskItems = await api.invoke('tasks:list', activeEntry.id);
    updateBreakButtons();
    renderCompliance();
  });

  // ── Enter key on label input starts timer ──
  document.getElementById('task-label-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !activeTaskId) document.getElementById('btn-start').click();
  });
});
