'use strict';

// IPC: Data Import (`import:commit`). Bulk-creates companies + time sessions
// from a prepared payload (built in the renderer by import-parse.js). Writes go
// through the same AES-GCM encryption as hand-entered data, and a safety
// snapshot is taken BEFORE any mutation (data-safety-net protected class) so an
// import can always be undone from the Backup Library.
//
// Payload: { companies: Company[], sessions: Session[] }
//   Session = { company: string, log_date: 'YYYY-MM-DD', session_label: string,
//               total_mins: number, rows: EntryRow[] }
// Sessions reference their company by NAME and auto-create any missing company.
// Dedup: a session whose company+date+label already exists is skipped, so a
// re-run of the same file never doubles history (plaintext columns — no decrypt).

const { ipcMain } = require('electron');
const { session } = require('../session');
const { dbAll, dbGet, dbRun, persistDB } = require('../db');
const { readCache, invalidateEntriesCache } = require('../cache');
const { performBackup, performSafetySnapshot } = require('../backups');
const { encrypt, decrypt } = require('../vault-crypto');

function register(): void {
  ipcMain.handle('import:commit', (_: unknown, payload: any) => {
    if (!session.key || !session.user) return { ok: false, error: 'Not authenticated' };
    const uid = session.user.id;
    const companies = Array.isArray(payload && payload.companies) ? payload.companies : [];
    const sessions  = Array.isArray(payload && payload.sessions)  ? payload.sessions  : [];
    if (!companies.length && !sessions.length) return { ok: false, error: 'Nothing to import.' };

    try {
      // Snapshot the exact pre-import state before touching anything.
      persistDB();
      performSafetySnapshot('before-import');

      // Existing company name (lowercased) → rowid. Names live in the encrypted
      // blob, so decrypt to build the lookup.
      const nameToId = new Map();
      for (const r of dbAll('SELECT rowid as rid, * FROM companies WHERE user_id=?', [uid])) {
        try {
          const plain = JSON.parse(decrypt({ iv: r.data_iv, tag: r.data_tag, data: r.data_enc }, session.key));
          const nm = String(plain.name || '').trim().toLowerCase();
          if (nm) nameToId.set(nm, Number(r.rid));
        } catch { /* skip undecryptable rows */ }
      }

      const insertCompany = (obj: any): number => {
        const e = encrypt(JSON.stringify(obj), session.key);
        dbRun('INSERT INTO companies (user_id,data_enc,data_iv,data_tag) VALUES (?,?,?,?)',
          [uid, e.data, e.iv, e.tag]);
        // rowid, not the unreliable id column (gotcha #1).
        const row = dbGet('SELECT MAX(rowid) as rid FROM companies WHERE user_id=?', [uid]);
        return row && row.rid != null ? Number(row.rid) : 0;
      };

      // 1) Explicit company import. Existing names are matched (not overwritten).
      let companiesCreated = 0, companiesMatched = 0;
      for (const c of companies) {
        const nm = String(c && c.name || '').trim();
        if (!nm) continue;
        const key = nm.toLowerCase();
        if (nameToId.has(key)) { companiesMatched++; continue; }
        const id = insertCompany(c);
        if (id) { nameToId.set(key, id); companiesCreated++; }
      }

      // Existing session identity keys (plaintext columns — no decrypt needed).
      const existingKeys = new Set();
      for (const r of dbAll('SELECT company_id, log_date, session_label FROM time_entries WHERE user_id=?', [uid])) {
        existingKeys.add(`${r.company_id}||${r.log_date}||${r.session_label || ''}`);
      }

      // 2) Time sessions. Resolve/auto-create company by name, then insert unless
      //    an identical company+date+label session already exists.
      let sessionsCreated = 0, sessionsSkipped = 0, rowsCreated = 0, companiesAuto = 0;
      for (const s of sessions) {
        const nm = String(s && s.company || '').trim();
        const date = String(s && s.log_date || '').trim();
        if (!nm || !date) continue;
        const key = nm.toLowerCase();
        let cid = nameToId.get(key);
        if (!cid) { cid = insertCompany({ name: nm }); if (!cid) continue; nameToId.set(key, cid); companiesAuto++; }

        const label = String(s.session_label || '');
        const sk = `${cid}||${date}||${label}`;
        if (existingKeys.has(sk)) { sessionsSkipped++; continue; }

        const rows = Array.isArray(s.rows) ? s.rows : [];
        const totalMins = Number(s.total_mins) || rows.reduce((t: number, r: any) => t + (Number(r.total_mins) || 0), 0);
        const e = encrypt(JSON.stringify(rows), session.key);
        dbRun('INSERT INTO time_entries (user_id,company_id,log_date,session_label,rows_json,rows_enc,rows_iv,rows_tag,total_mins) VALUES (?,?,?,?,?,?,?,?,?)',
          [uid, cid, date, label, '', e.data, e.iv, e.tag, totalMins]);
        existingKeys.add(sk);
        sessionsCreated++; rowsCreated += rows.length;
      }

      persistDB(); performBackup();
      readCache.invalidate('companies'); invalidateEntriesCache();
      return {
        ok: true,
        companiesCreated: companiesCreated + companiesAuto,
        companiesMatched,
        sessionsCreated,
        sessionsSkipped,
        rowsCreated,
      };
    } catch (e: any) {
      return { ok: false, error: (e && e.message) || 'Import failed.' };
    }
  });
}

module.exports = { register };
