'use strict';

const { ipcMain } = require('electron');
const { session, decryptEntry } = require('../session');
const { dbAll, dbGet, dbRun, persistDB } = require('../db');
const { readCache, cacheOwner, invalidateEntriesCache } = require('../cache');
const { performBackup } = require('../backups');
const { encrypt, decrypt } = require('../vault-crypto');

function register() {
// ── IPC: Time entries ──────────────────────────────────────────────────────
ipcMain.handle('entries:list', (_: unknown, companyId: any) => {
  if (!session.key || !session.user) return [];
  return dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? AND company_id=? ORDER BY log_date DESC',
    [session.user.id, companyId]).map((r: any) => ({...decryptEntry(r), id: Number(r.rid)}));
});

ipcMain.handle('entries:save', (_: unknown, entry: any) => {
  if (!session.key || !session.user) return { ok: false };
  try {
    const enc = encrypt(entry.rows_json || '[]', session.key);
    if (entry.id) {
      // Optimistic-concurrency guard (gotcha: blind last-write-wins). The client
      // sends the `updated_at` it last read for this row; if the stored row has
      // since moved on (a concurrent writer saved a newer version), reject the
      // write as stale instead of silently clobbering that newer data. Keyed on
      // rowid (gotcha #1). The guard only engages when the client supplies
      // updated_at — legacy callers that don't fall back to the old behavior.
      const cur = dbGet('SELECT updated_at FROM time_entries WHERE rowid=? AND user_id=?',
        [Number(entry.id), session.user.id]);
      if (!cur) return { ok: false, error: 'Entry not found.' };
      if (entry.updated_at != null && Number(cur.updated_at) !== Number(entry.updated_at)) {
        return { ok: false, stale: true, updated_at: Number(cur.updated_at) };
      }
      dbRun(
        'UPDATE time_entries SET rows_enc=?,rows_iv=?,rows_tag=?,rows_json=?,total_mins=?,session_label=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [enc.data, enc.iv, enc.tag, '', entry.total_mins, entry.session_label || '', entry.id, session.user.id]
      );
      session.activeEntryId = Number(entry.id);
      persistDB(); performBackup();
      invalidateEntriesCache();
      // Return the fresh updated_at so the client can guard its NEXT save against
      // its own prior one (autosave fires repeatedly on the same row).
      const after = dbGet('SELECT updated_at FROM time_entries WHERE rowid=? AND user_id=?',
        [Number(entry.id), session.user.id]);
      return { ok: true, id: entry.id, updated_at: after ? Number(after.updated_at) : null };
    } else {
      dbRun(
        'INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,rows_enc,rows_iv,rows_tag,total_mins) VALUES (?,?,?,?,?,?,?,?,?)',
        [session.user.id, entry.company_id, entry.log_date, entry.session_label || '', '', enc.data, enc.iv, enc.tag, entry.total_mins]
      );
      const maxRow = dbGet('SELECT MAX(rowid) as rid FROM time_entries WHERE user_id=?', [session.user.id]);
      const newId = (maxRow && maxRow.rid != null) ? Number(maxRow.rid) : null;
      session.activeEntryId = newId;
      persistDB(); performBackup();
      invalidateEntriesCache();
      let newTs: number | null = null;
      if (newId != null) {
        const after = dbGet('SELECT updated_at FROM time_entries WHERE rowid=? AND user_id=?',
          [newId, session.user.id]);
        newTs = after ? Number(after.updated_at) : null;
      }
      return { ok: true, id: newId, updated_at: newTs };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('entries:all', () => {
  if (!session.key || !session.user) return [];
  return readCache.get('entriesAll', cacheOwner(), () =>
    dbAll('SELECT rowid as rid, * FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [session.user.id])
      .map((r: any) => ({...decryptEntry(r), id: Number(r.rid)})));
});

// Lightweight variant: returns only the plaintext aggregate columns and does NOT
// decrypt rows_json. Consumers that only need totals/dates/labels (dashboard,
// company hour rollups) use this so they don't pay AES-GCM decryption on the
// entire entry history every page load. Anything needing per-row clock detail
// (global log, audit, reports) must keep using entries:all.
ipcMain.handle('entries:summary', () => {
  if (!session.key || !session.user) return [];
  return readCache.get('entriesSummary', cacheOwner(), () =>
    dbAll('SELECT rowid as rid, company_id, log_date, session_label, total_mins FROM time_entries WHERE user_id=? ORDER BY log_date DESC', [session.user.id])
      .map((r: any) => ({ ...r, id: Number(r.rid) })));
});

ipcMain.handle('entries:get-active', () => {
  if (!session.key || !session.user) return null;

  // Active-punch lookup (fast path activeEntryId + today/yesterday fallback)
  // lives in ../punch so the tray/hotkey punch engine and this handler can
  // never disagree about what "the active entry" is.
  const row = require('../punch').findActiveEntry();
  if (!row) return null;

  decryptEntry(row);

  let company_name = null;
  try {
    const co = dbGet('SELECT rowid as rid, * FROM companies WHERE rowid=? AND user_id=?',
      [Number(row.company_id), session.user.id]);
    if (co) {
      const plain = decrypt({ iv: co.data_iv, tag: co.data_tag, data: co.data_enc }, session.key);
      company_name = JSON.parse(plain).name || null;
    }
  } catch {}
  return { ...row, id: Number(row.rid), company_name };
});

ipcMain.handle('entries:get', (_: unknown, id: any) => {
  if (!session.key || !session.user) return null;
  const row = dbGet('SELECT rowid as rid, * FROM time_entries WHERE rowid=? AND user_id=?',
    [Number(id), session.user.id]);
  if (!row) return null;
  return { ...decryptEntry(row), id: Number(row.rid) };
});

// ── IPC: Task items ────────────────────────────────────────────────────────
ipcMain.handle('tasks:list', (_: unknown, entryId: any) => {
  if (!session.key || !session.user) return [];
  return dbAll(
    'SELECT rowid as rid, * FROM task_items WHERE entry_id=? AND user_id=? ORDER BY started_at ASC',
    [Number(entryId), session.user.id]
  ).map((r: any) => ({ ...r, id: Number(r.rid) }));
});

ipcMain.handle('tasks:save', (_: unknown, item: any) => {
  if (!session.key || !session.user) return { ok: false };
  try {
    if (item.id) {
      dbRun(
        'UPDATE task_items SET label=?,item_type=?,stopped_at=?,duration_secs=? WHERE rowid=? AND user_id=?',
        [item.label, item.item_type || 'task', item.stopped_at ?? null,
         item.duration_secs || 0, Number(item.id), session.user.id]
      );
      persistDB();
      return { ok: true, id: Number(item.id) };
    } else {
      dbRun(
        'INSERT INTO task_items (user_id,entry_id,label,item_type,started_at,stopped_at,duration_secs) VALUES (?,?,?,?,?,?,?)',
        [session.user.id, Number(item.entry_id), item.label,
         item.item_type || 'task', item.started_at, item.stopped_at ?? null, item.duration_secs || 0]
      );
      const maxRow = dbGet('SELECT MAX(rowid) as rid FROM task_items WHERE user_id=?', [session.user.id]);
      const newId = (maxRow && maxRow.rid != null) ? Number(maxRow.rid) : null;
      persistDB();
      return { ok: true, id: newId };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('tasks:delete', (_: unknown, id: any) => {
  if (!session.key || !session.user) return { ok: false };
  dbRun('DELETE FROM task_items WHERE rowid=? AND user_id=?', [Number(id), session.user.id]);
  persistDB();
  return { ok: true };
});

ipcMain.handle('tasks:recent-labels', () => {
  if (!session.key || !session.user) return [];
  const rows = dbAll(
    `SELECT label FROM task_items
     WHERE user_id=? AND item_type='task'
     GROUP BY label
     ORDER BY MAX(started_at) DESC LIMIT 10`,
    [session.user.id]
  );
  return rows.map((r: any) => r.label);
});

ipcMain.handle('tasks:summary', () => {
  if (!session.key || !session.user) return {};
  const rows = dbAll(
    `SELECT entry_id, item_type, COUNT(*) as cnt
     FROM task_items WHERE user_id=? AND item_type IN ('break','lunch')
     GROUP BY entry_id, item_type`,
    [session.user.id]
  );
  const map: Record<string, any> = {};
  (rows || []).forEach((r: any) => {
    if (!map[r.entry_id]) map[r.entry_id] = { break_count: 0, lunch_count: 0 };
    if (r.item_type === 'break') map[r.entry_id].break_count = Number(r.cnt);
    if (r.item_type === 'lunch') map[r.entry_id].lunch_count = Number(r.cnt);
  });
  return map;
});

}

module.exports = { register };
