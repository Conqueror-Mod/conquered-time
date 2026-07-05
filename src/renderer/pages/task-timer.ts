'use strict';

// Dispatch (task timer) page logic. Externalized from an inline <script> so the
// page runs under a strict script-src 'self' CSP. Depends on globals injected by
// shell.js (Shell, api, Settings, escapeHtml) — must load after shell.js.
//
// Break/lunch punches moved to the Time Tracker (v3.6) — Dispatch is now purely
// task timing + counting. Break/lunch are still task_items, just managed there.
//
// IIFE-wrapped (Phase 3 pattern) — see tsconfig.renderer.json.
(() => {

type ActiveEntry = TimeEntry & { company_name?: string };

// ── State ──────────────────────────────────────────────────────────────────
let activeEntry: ActiveEntry | null = null;   // full entry object from entries:get-active
let taskItems: TaskItem[] = [];               // current session task_items
let activeTaskId: number | null = null;       // task_item id of the in-progress task (or null)
let timerStart: number | null = null;         // Date.now() when current task started
let timerInterval: ReturnType<typeof setInterval> | null = null; // stopwatch handle
let sessionStartMs: number | null = null;     // ms when the active row clocked in (for banner duration)

// ── DOM helpers ────────────────────────────────────────────────────────────
// The page's elements are static markup — a missing id is a programming error,
// so the non-null lookup is the correct contract here.
const $id = (id: string): HTMLElement => document.getElementById(id)!;
const $input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtSecs(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtDurSecs(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtTime(hhmm: string | null): string {
  if (!hhmm) return '—';
  if (Settings.get('timeFormat') === '12h') {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }
  return hhmm;
}

function parseHHMMtoMs(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const today = new Date();
  today.setHours(h, m, 0, 0);
  return today.getTime();
}

function buildDescString(tasks: TaskItem[]): string {
  const completed = tasks.filter(t => t.item_type === 'task' && t.stopped_at);
  if (!completed.length) return '';
  const counts: Record<string, number> = {};
  completed.forEach(t => { counts[t.label] = (counts[t.label] || 0) + 1; });
  const parts = Object.entries(counts)
    .sort((a,b) => b[1]-a[1])
    .map(([l,c]) => c > 1 ? `${l} ×${c}` : l);
  return `[${completed.length} task${completed.length===1?'':'s'}] ${parts.join(', ')}`;
}

function elapsedSinceMs(ms: number): string {
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Banner ─────────────────────────────────────────────────────────────────
async function updateBanner(): Promise<void> {
  const banner = $id('session-banner');
  if (!activeEntry) {
    banner.classList.add('no-session');
    $id('no-session-msg').style.display = '';
    $id('tt-main').style.display        = 'none';
    $id('live-badge').style.display     = 'none';
    return;
  }
  banner.classList.remove('no-session');
  $id('no-session-msg').style.display = 'none';
  $id('tt-main').style.display        = 'grid';
  $id('live-badge').style.display     = '';

  // Find active row (clocked in, not clocked out)
  const rows: EntryRow[] = JSON.parse(activeEntry.rows_json || '[]');
  const activeRow = rows.find(r => r.clock_in && !r.clock_out);
  const clockIn = activeRow?.clock_in || null;
  if (clockIn) sessionStartMs = parseHHMMtoMs(clockIn);

  $id('banner-company').textContent  = activeEntry.company_name || activeEntry.session_label || 'Session';
  $id('banner-date').textContent     = activeEntry.log_date || '—';
  $id('banner-clock-in').textContent = clockIn ? fmtTime(clockIn) : '—';
  updateBannerDuration();
}

function updateBannerDuration(): void {
  if (!sessionStartMs) return;
  const el = document.getElementById('banner-duration');
  if (el) el.textContent = elapsedSinceMs(sessionStartMs);
}

// ── Recent labels ──────────────────────────────────────────────────────────
// Quick-picks / datalist for "Log a Task" draw from the active Time Tracker
// session's Task Names (the `name` field of its saved rows), so Dispatch times
// the tasks you've defined for today. Falls back to recent history when the
// session has no named rows yet.
async function loadTaskNameOptions(): Promise<void> {
  let labels: string[] = [];
  try {
    const rows: EntryRow[] = JSON.parse(activeEntry?.rows_json || '[]');
    labels = [...new Set(rows.map(r => (r.name || '').trim()).filter(Boolean))];
  } catch {}
  if (!labels.length) labels = await api.invoke('tasks:recent-labels') || [];

  const datalist = $id('recent-labels-list');
  const row = $id('quickpick-row');
  // escapeHtml — labels are user-controlled (row names / history)
  datalist.innerHTML = labels.map(l => `<option value="${escapeHtml(l)}">`).join('');
  row.innerHTML = labels.map(l =>
    `<button class="tt-quick-chip" data-label="${escapeHtml(l)}">${escapeHtml(l)}</button>`
  ).join('');
  row.querySelectorAll<HTMLElement>('.tt-quick-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      $input('task-label-input').value = btn.dataset.label || '';
      $input('task-label-input').focus();
    });
  });
}

// The active session's "current" Task Name: the in-progress (clocked-in, not
// clocked-out) row's name, else the most recently named row. Used to pre-fill
// the timer field so restarting the same task doesn't require re-selecting it.
function getCurrentSessionTaskName(): string {
  try {
    const rows: EntryRow[] = JSON.parse(activeEntry?.rows_json || '[]');
    const active = rows.find(r => r.clock_in && !r.clock_out && (r.name || '').trim());
    if (active) return active.name!.trim();
    const named = rows.filter(r => (r.name || '').trim());
    if (named.length) return named[named.length - 1].name!.trim();
  } catch {}
  return '';
}

// Pre-fill the timer field (when no task is running). Prefers an explicit value
// (e.g. the task just stopped, for quick restart), falling back to the session's
// current Task Name. The datalist/quick-picks remain for switching tasks.
function prefillTaskInput(preferred?: string): void {
  const input = document.getElementById('task-label-input') as HTMLInputElement | null;
  if (!input || input.disabled) return;
  const val = (preferred && preferred.trim()) || getCurrentSessionTaskName();
  if (val) input.value = val;
}

// ── Task list render ───────────────────────────────────────────────────────
function renderTaskList(): void {
  const list = $id('task-list');
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
    list.querySelectorAll<HTMLElement>('.tt-task-del').forEach(btn => {
      btn.addEventListener('click', () => deleteTask(Number(btn.dataset.id)));
    });
  }
  const count = completed.length;
  $id('counter-num').textContent = String(count);

  const preview = $id('desc-preview');
  const previewText = $id('desc-preview-text');
  const desc = buildDescString(taskItems);
  if (desc) {
    preview.style.display = '';
    previewText.textContent = desc;
  } else {
    preview.style.display = 'none';
  }
}

// ── Timer controls ─────────────────────────────────────────────────────────
function startStopwatch(startedAtMs?: number): void {
  timerStart = startedAtMs || Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - timerStart!) / 1000);
    $id('stopwatch').textContent = fmtSecs(elapsed);
    $id('stopwatch').classList.add('running');
  }, 1000);
  // Render first tick immediately so the display isn't 00:00 for a second
  const elapsed = Math.floor((Date.now() - timerStart) / 1000);
  $id('stopwatch').textContent = fmtSecs(elapsed);
  $id('stopwatch').classList.add('running');
}

function stopStopwatch(): void {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  $id('stopwatch').classList.remove('running');
}

function resetStopwatch(): void {
  $id('stopwatch').textContent = '00:00';
  $id('stopwatch').classList.remove('running');
}

// ── Write description back to Time Tracker entry ──────────────────────────
async function writeDescToEntry(): Promise<void> {
  if (!activeEntry) return;
  const desc = buildDescString(taskItems);
  const rows: EntryRow[] = JSON.parse(activeEntry.rows_json || '[]');
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
async function deleteTask(id: number): Promise<void> {
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

  // Live 12h/24h switch — re-render the banner clock-in time in place.
  document.addEventListener('ct:settings-changed', e => {
    if ((e as CustomEvent).detail?.key === 'timeFormat' && activeEntry) updateBanner();
  });

  if (!activeEntry) {
    // Wire button to show error — don't silently swallow clicks
    $id('btn-start').addEventListener('click', () => {
      Shell.toast('No active punch. Go to Time Tracker and clock in first.', 'error');
    });
    return;
  }

  // Load tasks and recent labels
  taskItems = await api.invoke('tasks:list', activeEntry.id) || [];

  // Resume an in-progress task (user navigated away and returned)
  const inProgressTask = taskItems.find(t => t.item_type === 'task' && t.started_at && !t.stopped_at);
  if (inProgressTask) {
    activeTaskId = inProgressTask.id;
    $input('task-label-input').value    = inProgressTask.label;
    $input('task-label-input').disabled = true;
    $id('btn-start').style.display   = 'none';
    $id('btn-stop').style.display    = '';
    $id('btn-cancel').style.display  = '';
    startStopwatch(inProgressTask.started_at);
    Shell.showSidebarTimer(inProgressTask.started_at);
  }

  renderTaskList();
  await loadTaskNameOptions();

  // Pre-fill with the session's current Task Name so Start is one click
  // (skipped when a task is already running — that path set the field above).
  if (!inProgressTask) prefillTaskInput();

  // ── Banner duration ticker ──
  setInterval(updateBannerDuration, 30000);

  // ── Pomodoro cycle controls ──
  // The panel itself is shown/hidden and re-rendered by the engine
  // (components/pomodoro.js, injected by Shell.init) — this just wires clicks.
  $id('pomo-start').addEventListener('click', () => { void window.Pomodoro?.start(); });
  $id('pomo-pause').addEventListener('click', () => window.Pomodoro?.pause());
  $id('pomo-skip').addEventListener('click',  () => window.Pomodoro?.skipPhase());
  $id('pomo-stop').addEventListener('click',  () => window.Pomodoro?.stop());

  // ── Start Task ──
  $id('btn-start').addEventListener('click', async () => {
    const label = $input('task-label-input').value.trim();
    if (!label) {
      Shell.toast('Enter a task label first.', 'info');
      $input('task-label-input').focus();
      return;
    }
    // Save task_item as started
    const res = await api.invoke('tasks:save', {
      entry_id: activeEntry!.id,
      label,
      item_type: 'task',
      started_at: Date.now(),
      duration_secs: 0,
    });
    activeTaskId = res.id ?? null;
    startStopwatch();
    Shell.showSidebarTimer(timerStart!);

    $id('btn-start').style.display  = 'none';
    $id('btn-stop').style.display   = '';
    $id('btn-cancel').style.display = '';
    $input('task-label-input').disabled = true;
  });

  // ── Stop & Log ──
  $id('btn-stop').addEventListener('click', async () => {
    if (!activeTaskId) return;
    const durationSecs = Math.floor((Date.now() - timerStart!) / 1000);
    stopStopwatch();

    // Update the task_item with stopped_at and duration
    const label = $input('task-label-input').value.trim();
    await api.invoke('tasks:save', {
      id: activeTaskId,
      label,
      item_type: 'task',
      stopped_at: Date.now(),
      duration_secs: durationSecs,
    });

    // Refresh task list
    taskItems = await api.invoke('tasks:list', activeEntry!.id) || [];
    renderTaskList();
    await writeDescToEntry();
    await loadTaskNameOptions();

    // Reset controls
    activeTaskId = null;
    timerStart = null;
    resetStopwatch();
    Shell.hideSidebarTimer();
    $input('task-label-input').disabled = false;
    // Keep the just-stopped task in the field so restarting it is one click.
    prefillTaskInput(label);
    $input('task-label-input').focus();
    $id('btn-start').style.display  = '';
    $id('btn-stop').style.display   = 'none';
    $id('btn-cancel').style.display = 'none';
  });

  // ── Cancel ──
  $id('btn-cancel').addEventListener('click', async () => {
    if (activeTaskId) {
      await api.invoke('tasks:delete', activeTaskId);
      taskItems = taskItems.filter(t => t.id !== activeTaskId);
    }
    activeTaskId = null;
    timerStart   = null;
    stopStopwatch();
    resetStopwatch();
    Shell.hideSidebarTimer();
    $input('task-label-input').value    = '';
    $input('task-label-input').disabled = false;
    // Cancelled (abandoned), so fall back to the session's current Task Name.
    prefillTaskInput();
    $id('btn-start').style.display  = '';
    $id('btn-stop').style.display   = 'none';
    $id('btn-cancel').style.display = 'none';
  });

  // ── Enter key on label input starts timer ──
  $id('task-label-input').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !activeTaskId) $id('btn-start').click();
  });
});

})();
