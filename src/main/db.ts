'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  db.ts — sql.js lifecycle + query helpers (Phase 2 extraction from main.ts).
//
//  Owns the module state the whole main process shares: the sql.js module
//  (SQL), the live Database handle (db), and the on-disk vault path (dbFile).
//  Nothing else may hold a raw Database reference across calls — handlers go
//  through dbGet/dbAll/dbRun/dbInsert, and lifecycle changes (open/replace/
//  close/adopt) go through the functions here so the handle can never desync.
//
//  Rowid discipline (CLAUDE.md gotcha #1): sql.js does not reliably populate
//  the `id` AUTOINCREMENT column through query helpers. Every read that needs
//  an ID must SELECT `rowid as rid` and the caller uses Number(row.rid).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');

let SQL: any = null;      // sql.js module (WASM, loaded once)
let db: any = null;       // live sql.js Database instance
let dbFile: string | null = null;  // on-disk vault path for persistDB()

// Load the sql.js WASM module once. Idempotent; must resolve before any
// Database can be constructed.
async function loadSqlJs(): Promise<void> {
  if (!SQL) SQL = await require('sql.js')();
}

function getSql(): any { return SQL; }

// Construct a throwaway Database NOT adopted as the live handle — for peek
// reads (startup settings, migration checks, backup previews). Caller closes.
function newDatabase(buf?: Buffer): any {
  return buf ? new SQL.Database(buf) : new SQL.Database();
}

// Open (or create) the live vault handle.
function openDb(buf?: Buffer): void {
  db = newDatabase(buf);
}

// Swap the live handle for one loaded from `buf` (backup restore).
function replaceDb(buf: Buffer): void {
  try { if (db) db.close(); } catch {}
  db = new SQL.Database(buf);
}

// Close and drop the live handle (profile deselect/delete). Safe when null.
function closeDb(): void {
  try { if (db) db.close(); } catch {}
  db = null;
}

function hasDb(): boolean { return !!db; }
function getDb(): any { return db; }

// Adopt a handle produced elsewhere — used by reEncryptVault, whose rollback
// path returns a fresh instance restored from the pre-write snapshot.
function adoptDb(handle: any): void { db = handle; }

function setDbFile(p: string | null): void { dbFile = p; }
function getDbFile(): string | null { return dbFile; }

// ── Persist sql.js DB to disk ──────────────────────────────────────────────
// Atomic write: dump to a sibling temp file, flush it to disk, then rename
// over the live vault. rename(2) is atomic on the same volume (and Windows
// MoveFileEx replaces atomically), so a crash or power loss mid-write can
// never leave the vault truncated — on disk you always have either the
// complete old file or the complete new one, never a half-written blob.
function persistDB(): void {
  if (!db || !dbFile) return;
  const data = Buffer.from(db.export());
  const tmp  = dbFile + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);       // force kernel buffers to physical disk before swap
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, dbFile);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}  // don't leave a stale .tmp behind
    throw e;
  }
}

// ── Query helpers ──────────────────────────────────────────────────────────
function dbGet(sql: string, params: unknown[] = []): Record<string, any> | null {
  const result = db.exec(sql, params);
  if (result && result[0] && result[0].values && result[0].values[0]) {
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const row: Record<string, any> = {};
    cols.forEach((col, i) => { row[col] = vals[i] !== undefined ? vals[i] : null; });
    return row;
  }
  return null;
}

function dbAll(sql: string, params: unknown[] = []): Array<Record<string, any>> {
  const result = db.exec(sql, params);
  if (!result || !result[0]) return [];
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const row: Record<string, any> = {};
    cols.forEach((col, i) => { row[col] = vals[i] !== undefined ? vals[i] : null; });
    return row;
  });
}

function dbRun(sql: string, params: unknown[] = []): number {
  db.run(sql, params);
  return db.getRowsModified();
}

function dbInsert(sql: string, params: unknown[] = []): number | null {
  db.run(sql, params);
  // sql.js last_insert_rowid() can be unreliable — use max(id) from the table instead
  // Extract the table name from the INSERT statement
  const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
  if (tableMatch) {
    const table = tableMatch[1];
    const result = db.exec(`SELECT MAX(id) as id FROM ${table}`);
    if (result && result[0] && result[0].values && result[0].values[0]) {
      return Number(result[0].values[0][0]);
    }
  }
  return null;
}

module.exports = {
  loadSqlJs, getSql, newDatabase,
  openDb, replaceDb, closeDb, hasDb, getDb, adoptDb,
  setDbFile, getDbFile, persistDB,
  dbGet, dbAll, dbRun, dbInsert,
};
