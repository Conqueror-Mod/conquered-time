'use strict';

// Run: npm test   (node --test; test script builds dist-main first)
//
// Regression guard for the v3.11.8 hotfix. sql.js's db.run(sql, params) uses the
// prepared-statement path when `params` is truthy — and an empty array is
// truthy — which runs ONLY the first statement of a multi-statement string.
// initProfileDB creates the entire schema in one multi-statement dbRun(), so the
// bug silently created only the `users` table on fresh vaults, surfacing as
// "no such table: app_settings" (and companies/time_entries/...) on first use.
// dbRun must run EVERY statement of a no-param DDL block, and still bind params
// for parameterized single statements.

const { test } = require('node:test');
const assert   = require('node:assert');
const db       = require('../dist-main/main/db.js');

test('dbRun executes all statements of a multi-statement DDL block', async () => {
  await db.loadSqlJs();
  db.openDb();
  db.dbRun(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS task_items (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS audit_dismissed (id INTEGER PRIMARY KEY);
  `);
  const tables = db.dbAll("SELECT name FROM sqlite_master WHERE type='table'")
    .map((r) => r.name).sort();
  assert.deepStrictEqual(
    tables,
    ['app_settings', 'audit_dismissed', 'companies', 'task_items', 'time_entries', 'users'],
    'every CREATE TABLE statement must execute, not just the first',
  );

  // The parameterized single-statement path must still bind + run.
  db.dbRun('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)', ['ui_autoLockMinutes', '15']);
  assert.strictEqual(
    db.dbGet('SELECT value FROM app_settings WHERE key=?', ['ui_autoLockMinutes']).value,
    '15',
  );
  db.closeDb();
});
