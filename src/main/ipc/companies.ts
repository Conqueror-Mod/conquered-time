'use strict';

const { ipcMain } = require('electron');
const { session } = require('../session');
const { dbAll, dbRun, persistDB } = require('../db');
const { readCache, cacheOwner, invalidateEntriesCache } = require('../cache');
const { performBackup } = require('../backups');
const { encrypt, decrypt } = require('../vault-crypto');

function register() {
// ── IPC: Companies ─────────────────────────────────────────────────────────
ipcMain.handle('companies:list', () => {
  if (!session.key || !session.user) return [];
  return readCache.get('companies', cacheOwner(), () => {
    const rows = dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=? ORDER BY rowid ASC', [session.user.id]);
    return rows.map(r => {
      const id = (r.id != null && r.id !== 0) ? Number(r.id) : Number(r.rid);
      try {
        const plain = decrypt({ iv: r.data_iv, tag: r.data_tag, data: r.data_enc }, session.key);
        const parsed = JSON.parse(plain);
        // Ensure id is never null/NaN — always a real positive integer
        const finalId = (id && !isNaN(id)) ? id : Number(r.rid);
        return { ...parsed, id: finalId };
      } catch { return { id: Number(r.rid), name: '[Decryption Error]' }; }
    });
  });
});

ipcMain.handle('companies:save', (_, data) => {
  if (!session.key || !session.user) return { ok: false, error: 'Not authenticated' };
  try {
    const { iv, tag, data: enc } = encrypt(JSON.stringify(data), session.key);
    if (data.id) {
      dbRun('UPDATE companies SET data_enc=?,data_iv=?,data_tag=?,updated_at=strftime(\'%s\',\'now\') WHERE rowid=? AND user_id=?',
        [enc, iv, tag, data.id, session.user.id]);
    } else {
      dbRun('INSERT INTO companies (user_id,data_enc,data_iv,data_tag) VALUES (?,?,?,?)',
        [session.user.id, enc, iv, tag]);
    }
    persistDB(); performBackup();
    readCache.invalidate('companies');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('companies:delete', (_, id) => {
  if (!session.key || !session.user) return { ok: false };
  const numId = Number(id);
  // task_items are entry_id-scoped — delete them via subquery BEFORE the
  // entries are removed, otherwise the company's break/lunch/Dispatch tasks
  // are orphaned in the DB.
  dbRun(
    'DELETE FROM task_items WHERE user_id=? AND entry_id IN (SELECT rowid FROM time_entries WHERE user_id=? AND company_id=?)',
    [session.user.id, session.user.id, numId]
  );
  dbRun('DELETE FROM time_entries WHERE company_id=? AND user_id=?', [numId, session.user.id]);
  dbRun('DELETE FROM companies WHERE rowid=? AND user_id=?', [numId, session.user.id]);
  persistDB(); performBackup();
  // Deletes the company AND its time_entries → both caches go stale.
  readCache.invalidate('companies');
  invalidateEntriesCache();
  return { ok: true };
});

}

module.exports = { register };
