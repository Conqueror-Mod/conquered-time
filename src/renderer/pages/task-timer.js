'use strict';

// Dispatch (task timer) page logic. Externalized from an inline <script> so the
// page runs under a strict script-src 'self' CSP. Depends on globals injected by
// shell.js (Shell, api, Settings, escapeHtml) — must load after shell.js.
//
// Break/lunch punches moved to the Time Tracker (v3.6) — Dispatch is now purely
// task timing + counting. Break/lunch are still task_items, just managed there.

// ── State ──────────────────────────────────────────────────────────────────
let activeEntry   = null;   // full entry object from entries:get-active
let taskItems     = [];     // current session task_items
let activeTaskId  = null;   // task_item id of the in-progress task (or null)
let timerStart    = null;   // Date.now() when current task started
let timerInterval = null;   // setInterval handle for stopwatch
let sessionStartMs = null;  // ms when the active row clocked in (for banner duration)

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
  return `[${completed.length} task${completed.length===1?'':'s'}] ${parts.join(', ')}`;
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
// Quick-picks / datalist for "Log a Task" draw from the active Time Tracker
// session's Task Names (the `name` field of its saved rows), so Dispatch times
// the tasks you've defined for today. Falls back to recent history when the
// session has no named rows yet.
async function loadTaskNameOptions() {
  let labels = [];
  try {
    const rows = JSON.parse(activeEntry?.rows_json || '[]');
    labels = [...new Set(rows.map(r => (r.name || '').trim()).filter(Boolean))];
  } catch {}
  if (!labels.length) labels = await api.invoke('tasks:recent-labels') || [];

  const datalist = document.getElementById('recent-labels-list');
  const row = document.getElementById('quickpick-row');
  // escapeHtml — labels are user-controlled (row names / history)
  datalist.innerHTML = labels.map(l => `<option value="${escapeHtml(l)}">`).join('');
  row.innerHTML = labels.map(l =>
    `<button class="tt-quick-chip" data-label="${escapeHtml(l)}">${escapeHtml(l)}</button>`
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
  await writeDescToEntry();
}

// ── Main init ─────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await Shell.init('task-timer');
  document.documentElement.style.visibility = '';

  // Load active entry
  activeEntry = await api.invoke('entries:get-active');
  await updateBanner();

  if (!activeEntry) {
    // Wire button to show error — don't silently swallow clicks
    document.getElementById('btn-start').addEventListener('click', () => {
      Shell.toast('No active punch. Go to Time Tracker and clock in first.', 'error');
    });
    return;
  }

  // Load tasks and recent labels
  taskItems = await api.invoke('tasks:list', activeEntry.id);

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
  await loadTaskNameOptions();

  // ── Banner duration ticker ──
  setInterval(updateBannerDuration, 30000);

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
    await writeDescToEntry();
    await loadTaskNameOptions();

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

  // ── Enter key on label input starts timer ──
  document.getElementById('task-label-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !activeTaskId) document.getElementById('btn-start').click();
  });
});
