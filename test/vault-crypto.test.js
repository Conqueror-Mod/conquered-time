'use strict';

// Run: npm test   (node --test, no extra deps)
//
// Covers the security-critical paths that were historically verified only by
// hand: AES-256-GCM round-trips, PBKDF2 key separation, and the atomic
// re-encryption used by password change / recovery (the "no mixed-key
// corruption" guarantee).

const { test } = require('node:test');
const assert   = require('node:assert');
const initSqlJs = require('sql.js');
const { encrypt, decrypt, deriveKey, reEncryptVault, migrateTimeEntries } = require('../src/main/vault-crypto');

let SQL;
async function getSQL() { return SQL || (SQL = await initSqlJs()); }

// ── Build an in-memory vault seeded with blobs encrypted under `key` ────────
function makeVault(key, { companies = ['Co A', 'Co B'], entries = ['[{"x":1}]'], profile = 'PROFILE', smtp = 'smtp-pass' } = {}) {
  const db = new SQL.Database();
  db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY, password_hash TEXT, profile_enc TEXT, profile_iv TEXT, profile_tag TEXT);
          CREATE TABLE companies (id INTEGER PRIMARY KEY, user_id INTEGER, data_enc TEXT, data_iv TEXT, data_tag TEXT);
          CREATE TABLE time_entries (id INTEGER PRIMARY KEY, user_id INTEGER, rows_enc TEXT, rows_iv TEXT, rows_tag TEXT);
          CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);`);

  const pe = profile ? encrypt(profile, key) : { data: null, iv: null, tag: null };
  db.run('INSERT INTO users (id, password_hash, profile_enc, profile_iv, profile_tag) VALUES (1, ?, ?, ?, ?)',
    ['oldhash', pe.data, pe.iv, pe.tag]);

  companies.forEach(name => {
    const e = encrypt(name, key);
    db.run('INSERT INTO companies (user_id, data_enc, data_iv, data_tag) VALUES (1, ?, ?, ?)', [e.data, e.iv, e.tag]);
  });
  entries.forEach(json => {
    const e = encrypt(json, key);
    db.run('INSERT INTO time_entries (user_id, rows_enc, rows_iv, rows_tag) VALUES (1, ?, ?, ?)', [e.data, e.iv, e.tag]);
  });
  if (smtp) {
    const e = encrypt(smtp, key);
    db.run("INSERT INTO app_settings (key, value) VALUES ('email_smtp_password_enc', ?)", [e.data]);
    db.run("INSERT INTO app_settings (key, value) VALUES ('email_smtp_password_iv', ?)",  [e.iv]);
    db.run("INSERT INTO app_settings (key, value) VALUES ('email_smtp_password_tag', ?)", [e.tag]);
  }
  return db;
}

function companyBlobs(db) {
  const res = db.exec('SELECT data_enc, data_iv, data_tag FROM companies ORDER BY id');
  return (res[0]?.values || []).map(v => ({ data: v[0], iv: v[1], tag: v[2] }));
}

// ════════════════════════════════════════════════════════════════════════════
//  Primitives
// ════════════════════════════════════════════════════════════════════════════

test('encrypt → decrypt round-trips arbitrary text', () => {
  const key = deriveKey('pw', 'salt-1234567890');
  const samples = ['', 'hello', JSON.stringify({ a: 1, b: [2, 3] }), '🔐 unicode ✓', 'x'.repeat(5000)];
  for (const s of samples) assert.strictEqual(decrypt(encrypt(s, key), key), s);
});

test('encrypt uses a fresh IV each call (no deterministic ciphertext)', () => {
  const key = deriveKey('pw', 'salt-abcdefabcdef');
  const a = encrypt('same plaintext', key);
  const b = encrypt('same plaintext', key);
  assert.notStrictEqual(a.iv, b.iv);
  assert.notStrictEqual(a.data, b.data);
});

test('decrypt throws on the wrong key', () => {
  const k1 = deriveKey('pw1', 'salt-xxxxxxxxxxxx');
  const k2 = deriveKey('pw2', 'salt-xxxxxxxxxxxx');
  const blob = encrypt('secret', k1);
  assert.throws(() => decrypt(blob, k2));
});

test('decrypt throws on a tampered auth tag', () => {
  const key = deriveKey('pw', 'salt-yyyyyyyyyyyy');
  const blob = encrypt('secret', key);
  const tampered = { ...blob, tag: (blob.tag[0] === 'a' ? 'b' : 'a') + blob.tag.slice(1) };
  assert.throws(() => decrypt(tampered, key));
});

test('deriveKey is deterministic and salt-separated', () => {
  assert.deepStrictEqual(deriveKey('pw', 'salt-aaaaaaaaaaaa'), deriveKey('pw', 'salt-aaaaaaaaaaaa'));
  assert.notDeepStrictEqual(deriveKey('pw', 'salt-aaaaaaaaaaaa'), deriveKey('pw', 'salt-bbbbbbbbbbbb'));
  assert.notDeepStrictEqual(deriveKey('pw1', 'salt-same12345678'), deriveKey('pw2', 'salt-same12345678'));
  assert.strictEqual(deriveKey('pw', 'salt-len32check00').length, 32);
});

// ════════════════════════════════════════════════════════════════════════════
//  Atomic re-encryption
// ════════════════════════════════════════════════════════════════════════════

test('reEncryptVault: happy path re-encrypts every blob under the new key', async () => {
  await getSQL();
  const oldKey = deriveKey('old', 'salt-0000000000aa');
  const newKey = deriveKey('new', 'salt-0000000000aa');
  let db = makeVault(oldKey);
  const user = db.exec('SELECT * FROM users WHERE id=1')[0];
  const userRow = { profile_enc: user.values[0][2], profile_iv: user.values[0][3], profile_tag: user.values[0][4] };

  let committed = false;
  const res = reEncryptVault({
    SQL, db, oldKey, newKey, userId: 1, user: userRow,
    onCommit: (d) => { committed = true; d.run('UPDATE users SET password_hash=? WHERE id=1', ['newhash']); },
  });
  db = res.db;

  assert.strictEqual(res.ok, true);
  assert.strictEqual(committed, true);
  // Everything now decrypts under newKey, and not the old one.
  for (const b of companyBlobs(db)) {
    assert.doesNotThrow(() => decrypt(b, newKey));
    assert.throws(() => decrypt(b, oldKey));
  }
  const ent = db.exec('SELECT rows_enc, rows_iv, rows_tag FROM time_entries')[0].values[0];
  assert.strictEqual(decrypt({ data: ent[0], iv: ent[1], tag: ent[2] }, newKey), '[{"x":1}]');
  assert.strictEqual(db.exec('SELECT password_hash FROM users')[0].values[0][0], 'newhash');
});

test('reEncryptVault: read-phase abort leaves every row and the commit untouched', async () => {
  await getSQL();
  const oldKey = deriveKey('old', 'salt-1111111111bb');
  const newKey = deriveKey('new', 'salt-1111111111bb');
  let db = makeVault(oldKey, { companies: ['Good Co', 'Bad Co'] });

  // Corrupt the SECOND company's tag so it cannot be decrypted.
  const bad = db.exec('SELECT id, data_tag FROM companies ORDER BY id')[0].values[1];
  const flipped = (bad[1][0] === 'a' ? 'b' : 'a') + String(bad[1]).slice(1);
  db.run('UPDATE companies SET data_tag=? WHERE id=?', [flipped, bad[0]]);

  const before = companyBlobs(db);
  let committed = false;
  const res = reEncryptVault({
    SQL, db, oldKey, newKey, userId: 1, user: {},
    onCommit: () => { committed = true; },
  });
  db = res.db;

  assert.strictEqual(res.ok, false);
  assert.match(res.error, /aborted/);
  assert.strictEqual(committed, false, 'onCommit must not run when read phase aborts');
  // No blob mutated: the good company still decrypts under the OLD key.
  const after = companyBlobs(db);
  assert.deepStrictEqual(after, before, 'rows must be byte-identical after an abort');
  assert.doesNotThrow(() => decrypt(after[0], oldKey));
});

test('reEncryptVault: write-phase failure rolls the db back to pre-write state', async () => {
  await getSQL();
  const oldKey = deriveKey('old', 'salt-2222222222cc');
  const newKey = deriveKey('new', 'salt-2222222222cc');
  let db = makeVault(oldKey);
  const before = companyBlobs(db);

  const res = reEncryptVault({
    SQL, db, oldKey, newKey, userId: 1, user: {},
    onCommit: () => { throw new Error('simulated commit failure'); },
  });
  db = res.db;

  assert.strictEqual(res.ok, false);
  assert.match(res.error, /rolled back/);
  // Rollback restored the snapshot: all companies decrypt under the OLD key,
  // none under the new — no mixed-key state survived.
  const after = companyBlobs(db);
  assert.deepStrictEqual(after, before, 'db must be restored to its pre-write bytes');
  for (const b of after) {
    assert.doesNotThrow(() => decrypt(b, oldKey));
    assert.throws(() => decrypt(b, newKey));
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Time-entry encryption migration
// ════════════════════════════════════════════════════════════════════════════

// Vault with `plaintext` rows_json entries (rows_enc NULL) and optionally some
// rows already encrypted under `key`.
function makeMigrationVault(key, { plaintext = [], encrypted = [] } = {}) {
  const db = new SQL.Database();
  db.run('CREATE TABLE time_entries (id INTEGER PRIMARY KEY, user_id INTEGER, rows_json TEXT, rows_enc TEXT, rows_iv TEXT, rows_tag TEXT);');
  for (const json of plaintext) {
    db.run('INSERT INTO time_entries (user_id, rows_json, rows_enc, rows_iv, rows_tag) VALUES (1, ?, NULL, NULL, NULL)', [json]);
  }
  for (const json of encrypted) {
    const e = encrypt(json, key);
    db.run('INSERT INTO time_entries (user_id, rows_json, rows_enc, rows_iv, rows_tag) VALUES (1, ?, ?, ?, ?)', ['', e.data, e.iv, e.tag]);
  }
  return db;
}

function entryRows(db) {
  const res = db.exec('SELECT rows_json, rows_enc, rows_iv, rows_tag FROM time_entries ORDER BY id');
  return (res[0]?.values || []).map(v => ({ rows_json: v[0], rows_enc: v[1], rows_iv: v[2], rows_tag: v[3] }));
}

test('migrateTimeEntries: encrypts plaintext rows and blanks the plaintext column', async () => {
  await getSQL();
  const key = deriveKey('pw', 'salt-mig00000000a');
  const payloads = ['[{"label":"task"}]', '[]', '[{"a":1},{"b":2}]'];
  const db = makeMigrationVault(key, { plaintext: payloads });

  const n = migrateTimeEntries({ db, key, userId: 1 });

  assert.strictEqual(n, 3);
  for (const [i, row] of entryRows(db).entries()) {
    assert.strictEqual(row.rows_json, '', 'plaintext column must be blanked');
    assert.ok(row.rows_enc && row.rows_iv && row.rows_tag, 'ciphertext columns populated');
    assert.strictEqual(decrypt({ data: row.rows_enc, iv: row.rows_iv, tag: row.rows_tag }, key), payloads[i]);
  }
});

test('migrateTimeEntries: is idempotent — a second pass migrates nothing and touches nothing', async () => {
  await getSQL();
  const key = deriveKey('pw', 'salt-mig11111111b');
  const db = makeMigrationVault(key, { plaintext: ['[{"x":1}]', '[{"y":2}]'] });

  assert.strictEqual(migrateTimeEntries({ db, key, userId: 1 }), 2);
  const afterFirst = entryRows(db);
  assert.strictEqual(migrateTimeEntries({ db, key, userId: 1 }), 0, 'second pass migrates 0 rows');
  assert.deepStrictEqual(entryRows(db), afterFirst, 'already-encrypted rows are byte-identical after a re-run');
});

test('migrateTimeEntries: only touches plaintext rows in a mixed vault', async () => {
  await getSQL();
  const key = deriveKey('pw', 'salt-mig22222222c');
  const db = makeMigrationVault(key, { plaintext: ['[{"new":1}]'], encrypted: ['[{"old":1}]'] });
  const before = entryRows(db);

  const n = migrateTimeEntries({ db, key, userId: 1 });

  assert.strictEqual(n, 1, 'only the single plaintext row is migrated');
  const after = entryRows(db);
  // The pre-encrypted row (id 2) is unchanged; both rows decrypt to their payloads.
  assert.deepStrictEqual(after[1], before[1], 'pre-encrypted row untouched');
  assert.strictEqual(decrypt({ data: after[0].rows_enc, iv: after[0].rows_iv, tag: after[0].rows_tag }, key), '[{"new":1}]');
  assert.strictEqual(decrypt({ data: after[1].rows_enc, iv: after[1].rows_iv, tag: after[1].rows_tag }, key), '[{"old":1}]');
});

test('migrateTimeEntries: scopes to the given user', async () => {
  await getSQL();
  const key = deriveKey('pw', 'salt-mig33333333d');
  const db = makeMigrationVault(key, { plaintext: ['[{"mine":1}]'] });
  // Add a second user's plaintext row that must be left alone.
  db.run("INSERT INTO time_entries (user_id, rows_json, rows_enc, rows_iv, rows_tag) VALUES (2, '[{\"theirs\":1}]', NULL, NULL, NULL)");

  const n = migrateTimeEntries({ db, key, userId: 1 });

  assert.strictEqual(n, 1);
  const other = db.exec('SELECT rows_json, rows_enc FROM time_entries WHERE user_id=2')[0].values[0];
  assert.strictEqual(other[0], '[{"theirs":1}]', "other user's plaintext untouched");
  assert.strictEqual(other[1], null, "other user's row not encrypted");
});
