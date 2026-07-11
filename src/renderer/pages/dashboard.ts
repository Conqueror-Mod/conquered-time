'use strict';

// Dashboard page logic. Externalized from an inline <script> so the page runs
// under a strict script-src 'self' CSP. Depends on globals injected by shell.js
// (Shell, Store, escapeHtml) — must load after ../components/shell.js.
//
// IIFE-wrapped (Phase 3 pattern): tsc compiles all renderer pages in one
// project as classic scripts sharing a global scope, so page-local helpers
// must not leak as globals.
(() => {

let companies: Company[] = [], allEntries: EntrySummary[] = [];

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

async function loadData(): Promise<void> {
  companies  = await Store.getCompanies();
  allEntries = await Store.getEntriesSummary();

  // LOCAL dates — toISOString is UTC and bucketed evening hours into tomorrow.
  const today   = RowUtils.localDateStr();
  const weekAgo = RowUtils.localDateStr(new Date(Date.now() - 7*86400000));

  const todayMins   = allEntries.filter(e => e.log_date === today).reduce((a,e) => a+e.total_mins, 0);
  const weekMins    = allEntries.filter(e => e.log_date >= weekAgo).reduce((a,e) => a+e.total_mins, 0);
  const allTimeMins = allEntries.reduce((a,e) => a+e.total_mins, 0);

  document.getElementById('stat-today')!.textContent     = fmtH(todayMins);
  document.getElementById('stat-week')!.textContent      = fmtH(weekMins);
  document.getElementById('stat-alltime')!.textContent   = fmtH(allTimeMins);
  document.getElementById('stat-companies')!.textContent = String(companies.length);

  const compMap: Record<number, string> = {};
  companies.forEach(c => compMap[c.id] = c.name || '—');

  // C6 (D-009): future-dated entries don't belong in "Recent Activity" —
  // they'd headline the list indefinitely. They stay visible (badged) in the
  // Global Log instead.
  const recent = allEntries.filter(e => e.log_date <= today)
    .sort((a,b) => b.log_date.localeCompare(a.log_date)).slice(0, 8);
  const list   = document.getElementById('activity-list');
  if (recent.length === 0 || !list) return;

  list.innerHTML = recent.map(e => `
    <div class="activity-row">
      <div class="activity-company">${escapeHtml(compMap[e.company_id]) || '—'}</div>
      <div class="activity-date">${escapeHtml(e.log_date)}${e.session_label ? ' · ' + escapeHtml(e.session_label) : ''}</div>
      <div class="activity-hours">${fmtH(e.total_mins)}</div>
    </div>
  `).join('');
}

function fmtH(mins: number): string {
  if (!mins) return '0h';
  return (mins / 60).toFixed(1) + 'h';
}

// Mini packed-bubble web — same BubbleWeb engine as the Companies page so the
// two webs read identically. Follows the shared per-profile window preset
// (ui_webRange, set from the Companies page toggles); click → that company's
// tracker instead of the Companies context menu.
async function drawMiniWeb(): Promise<void> {
  const canvas = document.getElementById('web-canvas') as HTMLCanvasElement | null;
  const wrap   = document.getElementById('web-canvas-wrap');
  const tt     = document.getElementById('node-tooltip');
  if (!canvas || !wrap || !tt) return;
  let range: '30' | '90' | 'all' = '90';
  const saved = await api.invoke('settings:get', 'ui_webRange');
  if (saved === '30' || saved === '90' || saved === 'all') range = saved;
  const web = BubbleWeb.attach({
    canvas, wrap, mini: true,
    tooltip: {
      root: tt,
      name: document.getElementById('tt-name')!,
      hier: document.getElementById('tt-hier')!,
      detail: document.getElementById('tt-detail')!,
    },
    onCompanyClick: (co) => {
      sessionStorage.setItem('active_company', JSON.stringify(co));
      api.send('navigate', 'tracker');
    },
  });
  web.update(companies, allEntries, range);
}

})();
