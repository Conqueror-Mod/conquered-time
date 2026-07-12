'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  backups.ts — vault backup writer + directory state (Phase 2 extraction).
//
//  Owns the active profile's backups/ directory path (mirrors the dbFile
//  ownership in ./db). Two backup classes live side by side in backups/:
//
//    vault-<stamp>.db          routine autosave copies (performBackup), kept
//                              as a 30-file ring — pruned freely.
//    safety-<stamp>__<slug>.db pre-destructive-action snapshots
//                              (performSafetySnapshot), a SEPARATE protected
//                              set kept to SAFETY_CAP. The two prune passes
//                              only ever touch their own class, so a snapshot
//                              taken before "Clear all companies" can't be
//                              evaporated by 30 subsequent autosaves.
//
//  The stamp is the same ISO-derived form in both; the safety slug records
//  WHY the snapshot was taken and is shown, humanized, in the Backup Library.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { getDbFile } = require('./db');

let backupDir: string | null = null;

const AUTO_CAP   = 30;
const SAFETY_CAP = 15;
// `__` separates stamp from slug and appears in neither (the ISO stamp has no
// underscore; the slug is [a-z0-9-] only) — so filenames parse unambiguously.
const SAFETY_SEP = '__';

function setBackupDir(p: string | null): void { backupDir = p; }
function getBackupDir(): string | null { return backupDir; }

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function slugifyReason(reason: string): string {
  return String(reason || 'action')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'action';
}

// Prune a backup class (by filename prefix) to `cap`, deleting the oldest.
function pruneClass(prefix: string, cap: number): void {
  if (!backupDir) return;
  const files = fs.readdirSync(backupDir)
    .filter((f: any) => f.startsWith(prefix) && f.endsWith('.db')).sort();
  if (files.length > cap)
    files.slice(0, files.length - cap)
      .forEach((f: any) => { try { fs.unlinkSync(path.join(backupDir, f)); } catch {} });
}

// Routine autosave copy — call AFTER persistDB. 30-file ring.
function performBackup(): void {
  const dbFile = getDbFile();
  if (!backupDir || !dbFile || !fs.existsSync(dbFile)) return;
  fs.copyFileSync(dbFile, path.join(backupDir, `vault-${stampNow()}.db`));
  pruneClass('vault-', AUTO_CAP);
}

// Pre-destructive-action snapshot — call BEFORE the mutation (the caller should
// persistDB() first so any pending in-memory changes are captured). Protected
// from the autosave ring; kept as its own capped set. Returns the created path,
// or null if no vault is on disk yet. Never throws — a failed snapshot must not
// block the user's action, but the failure is logged.
function performSafetySnapshot(reason: string): string | null {
  const dbFile = getDbFile();
  if (!backupDir || !dbFile || !fs.existsSync(dbFile)) return null;
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const dest = path.join(backupDir, `safety-${stampNow()}${SAFETY_SEP}${slugifyReason(reason)}.db`);
    fs.copyFileSync(dbFile, dest);
    pruneClass('safety-', SAFETY_CAP);
    return dest;
  } catch (e) {
    console.error('[safety-snapshot] failed:', e.message);
    return null;
  }
}

module.exports = { setBackupDir, getBackupDir, performBackup, performSafetySnapshot };
