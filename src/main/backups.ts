'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  backups.ts — vault backup writer + directory state (Phase 2 extraction).
//
//  Owns the active profile's backups/ directory path (mirrors the dbFile
//  ownership in ./db). performBackup copies the on-disk vault (call after
//  persistDB) and prunes to the 30 most recent. The backup:list/preview/
//  restore IPC handlers stay in main until the ipc/ split.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { getDbFile } = require('./db');

let backupDir: string | null = null;

function setBackupDir(p: string | null): void { backupDir = p; }
function getBackupDir(): string | null { return backupDir; }

function performBackup(): void {
  const dbFile = getDbFile();
  if (!backupDir || !dbFile || !fs.existsSync(dbFile)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest  = path.join(backupDir, `vault-${stamp}.db`);
  fs.copyFileSync(dbFile, dest);
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('vault-') && f.endsWith('.db')).sort();
  if (files.length > 30)
    files.slice(0, files.length - 30).forEach(f => fs.unlinkSync(path.join(backupDir, f)));
}

module.exports = { setBackupDir, getBackupDir, performBackup };
