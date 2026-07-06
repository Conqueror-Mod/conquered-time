'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  reEncryptVault / migrateTimeEntries whole-vault-space properties —
//  Phase B-3 of docs/PLAN-property-testing.md (B1–B4). The example-based
//  suite (vault-crypto.test.js) proves specific cases; these prove the
//  all-or-nothing contract on RANDOM vaults: arbitrary company/entry/profile/
//  SMTP blob combinations, arbitrary corruption target, arbitrary content.
// ════════════════════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert   = require('node:assert');
const fc       = require('fast-check');
const initSqlJs = require('sql.js');
const fixture  = require('./vault-fixture');
const { encrypt, decrypt, reEncryptVault, migrateTimeEntries } = require('../src/main/vault-crypto');

const KEY_A = fixture.deriveKey('old-password', 'salt-A');
const KEY_B = fixture.deriveKey('new-password', 'salt-B');

let SQL;

// Blob-bearing content: unicode, empty-ish, JSON-looking.
const arbContent = fc.string({ unit: 'binary', minLength: 1, maxLength: 200 });

const arbVaultSpec = fc.record({
  companies: fc.array(arbContent, { maxLength: 4 }),
  entries:   fc.array(arbContent, { maxLength: 4 }),
  profile:   fc.option(arbContent, { nil: null }),
  smtp:      fc.option(arbContent, { nil: null }),
});

// Build a vault whose every blob is encrypted under KEY_A. Returns handles +
// the plaintext expectations.
function buildVault(spec) {
  const db = fixture.createVaultSchema(SQL);
  const prof = spec.profile !== null ? encrypt(spec.profile, KEY_A) : null;
  const userId = fixture.insertUser(db, {
    username: 'reenc', passwordHash: 'oldhash',
    profileEnc: prof?.data ?? null, profileIv: prof?.iv ?? null, profileTag: prof?.tag ?? null,
  });
  const companyId = spec.companies.length
    ? spec.companies.map(c => fixture.insertCompany(db, KEY_A, userId, { name: c }))[0]
    : fixture.insertCompany(db, KEY_A, userId, { name: 'anchor' });
  // (the map above already inserted them; anchor company only exists when none)
  spec.entries.forEach((content, i) => {
    const enc = encrypt(content, KEY_A);
    db.run(
      `INSERT INTO time_entries (user_id, company_id, log_date, session_label, rows_json, rows_enc, rows_iv, rows_tag, total_mins)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [userId, companyId, '2026-07-01', `S${i}`, '', enc.data, enc.iv, enc.tag, 60]
    );
  });
  if (spec.smtp !== null) {
    const e = encrypt(spec.smtp, KEY_A);
    db.run("INSERT INTO app_settings (key,value) VALUES ('email_smtp_password_enc',?),('email_smtp_password_iv',?),('email_smtp_password_tag',?)",
      [e.data, e.iv, e.tag]);
  }
  return { db, userId };
}

// Decrypt every blob in the vault under `key`; throws if any blob fails.
function readAllBlobs(db, key) {
  const rows = (sql) => { const r = db.exec(sql); return r.length ? r[0].values : []; };
  const out = { companies: [], entries: [], profile: null, smtp: null };
  for (const [d, i, t] of rows('SELECT data_enc, data_iv, data_tag FROM companies ORDER BY id')) {
    out.companies.push(JSON.parse(decrypt({ data: d, iv: i, tag: t }, key)).name);
  }
  for (const [d, i, t] of rows('SELECT rows_enc, rows_iv, rows_tag FROM time_entries WHERE rows_enc IS NOT NULL ORDER BY id')) {
    out.entries.push(decrypt({ data: d, iv: i, tag: t }, key));
  }
  const u = rows('SELECT profile_enc, profile_iv, profile_tag FROM users')[0];
  if (u && u[0]) out.profile = decrypt({ data: u[0], iv: u[1], tag: u[2] }, key);
  const s = (k) => { const v = rows(`SELECT value FROM app_settings WHERE key='email_smtp_password_${k}'`); return v.length ? v[0][0] : null; };
  if (s('enc')) out.smtp = decrypt({ data: s('enc'), iv: s('iv'), tag: s('tag') }, key);
  return out;
}

function expectedOf(spec) {
  return {
    companies: spec.companies.length ? spec.companies : ['anchor'],
    entries: spec.entries,
    profile: spec.profile,
    smtp: spec.smtp,
  };
}

function getUserRow(db) {
  const v = db.exec('SELECT rowid as rid, password_hash, profile_enc, profile_iv, profile_tag FROM users')[0].values[0];
  return { rid: Number(v[0]), password_hash: v[1], profile_enc: v[2], profile_iv: v[3], profile_tag: v[4] };
}

test('B1: success path — every blob re-keys A→B, none readable under A, onCommit applied', async () => {
  SQL = SQL || await initSqlJs();
  fc.assert(
    fc.property(arbVaultSpec, spec => {
      const { db, userId } = buildVault(spec);
      const res = reEncryptVault({
        SQL, db, oldKey: KEY_A, newKey: KEY_B, userId,
        user: getUserRow(db),
        onCommit: (d) => d.run("UPDATE users SET password_hash='newhash'"),
      });
      assert.strictEqual(res.ok, true, res.error);
      assert.deepStrictEqual(readAllBlobs(res.db, KEY_B), expectedOf(spec), 'all blobs decrypt under the new key');
      assert.throws(() => readAllBlobs(res.db, KEY_A), 'nothing decrypts under the old key');
      assert.strictEqual(getUserRow(res.db).password_hash, 'newhash', 'onCommit applied atomically with the re-encrypt');
      res.db.close();
    }),
    { numRuns: 40 }
  );
});

test('B2: read-phase abort — one corrupted blob anywhere → ok:false and ZERO mutation', async () => {
  SQL = SQL || await initSqlJs();
  fc.assert(
    fc.property(arbVaultSpec, fc.nat(), fc.constantFrom('enc', 'iv', 'tag'), (spec, targetSeed, part) => {
      const { db, userId } = buildVault(spec);
      // Enumerate corruptible blob sites present in this vault.
      const sites = [];
      const count = (sql) => { const r = db.exec(sql); return r.length ? Number(r[0].values[0][0]) : 0; };
      for (let i = 0; i < count('SELECT COUNT(*) FROM companies'); i++) sites.push(['companies', i]);
      for (let i = 0; i < count('SELECT COUNT(*) FROM time_entries'); i++) sites.push(['time_entries', i]);
      if (spec.profile !== null) sites.push(['users', 0]);
      if (spec.smtp !== null) sites.push(['app_settings', 0]);
      const [table, idx] = sites[targetSeed % sites.length];

      // Flip the first hex nibble of the chosen blob part.
      const colOf = { companies: `data_${part}`, time_entries: `rows_${part}`, users: `profile_${part}` };
      if (table === 'app_settings') {
        const key = `email_smtp_password_${part}`;
        const cur = db.exec(`SELECT value FROM app_settings WHERE key='${key}'`)[0].values[0][0];
        db.run('UPDATE app_settings SET value=? WHERE key=?', [(cur[0] === 'f' ? '0' : 'f') + cur.slice(1), key]);
      } else {
        const col = colOf[table];
        const rid = Number(db.exec(`SELECT rowid FROM ${table} LIMIT 1 OFFSET ${idx}`)[0].values[0][0]);
        const cur = db.exec(`SELECT ${col} FROM ${table} WHERE rowid=${rid}`)[0].values[0][0];
        db.run(`UPDATE ${table} SET ${col}=? WHERE rowid=?`, [(cur[0] === 'f' ? '0' : 'f') + cur.slice(1), rid]);
      }

      const snapshot = Buffer.from(db.export());
      const res = reEncryptVault({ SQL, db, oldKey: KEY_A, newKey: KEY_B, userId, user: getUserRow(db) });
      assert.strictEqual(res.ok, false);
      assert.ok(res.db === db, 'read-phase abort keeps the original handle');
      assert.ok(snapshot.equals(Buffer.from(res.db.export())), 'database byte-identical — zero mutation');
      res.db.close();
    }),
    { numRuns: 40 }
  );
});

test('B3: write-phase rollback — onCommit throws → ok:false, restored db intact under A', async () => {
  SQL = SQL || await initSqlJs();
  fc.assert(
    fc.property(arbVaultSpec, spec => {
      const { db, userId } = buildVault(spec);
      const before = Buffer.from(db.export());
      const res = reEncryptVault({
        SQL, db, oldKey: KEY_A, newKey: KEY_B, userId,
        user: getUserRow(db),
        onCommit: () => { throw new Error('simulated commit failure'); },
      });
      assert.strictEqual(res.ok, false);
      assert.ok(before.equals(Buffer.from(res.db.export())), 'rolled back to the pre-write snapshot');
      assert.deepStrictEqual(readAllBlobs(res.db, KEY_A), expectedOf(spec), 'fully intact under the ORIGINAL key');
      res.db.close();
    }),
    { numRuns: 30 }
  );
});

test('B4: migrateTimeEntries — migrates exactly the plaintext rows, idempotent, content preserved', async () => {
  SQL = SQL || await initSqlJs();
  const arbMixed = fc.array(
    fc.record({
      json: fc.oneof(fc.constant(''), fc.constant('[]'), arbContent),
      legacy: fc.boolean(),
    }),
    { maxLength: 6 }
  );
  fc.assert(
    fc.property(arbMixed, entries => {
      const db = fixture.createVaultSchema(SQL);
      const userId = fixture.insertUser(db, { username: 'mig', passwordHash: 'x' });
      const companyId = fixture.insertCompany(db, KEY_A, userId, { name: 'Co' });
      for (const e of entries) {
        if (e.legacy) fixture.insertLegacyEntry(db, userId, { companyId, logDate: '2026-07-01', rowsJson: e.json });
        else fixture.insertEntry(db, KEY_A, userId, { companyId, logDate: '2026-07-01', rows: [{ name: e.json }] });
      }
      const plainCount = entries.filter(e => e.legacy).length;

      const migrated = migrateTimeEntries({ db, key: KEY_A, userId });
      assert.strictEqual(migrated, plainCount, 'migrates exactly the plaintext rows');

      // Every row now encrypted; migrated rows decrypt to their original
      // rows_json (empty/null becomes '[]'); plaintext column blanked.
      const rows = db.exec('SELECT rows_enc, rows_iv, rows_tag, rows_json FROM time_entries ORDER BY id');
      const values = rows.length ? rows[0].values : [];
      const legacyExpected = entries.filter(e => e.legacy).map(e => e.json || '[]');
      let li = 0;
      for (const [enc, iv, tag, json] of values) {
        assert.ok(enc && iv && tag, 'every row encrypted after migration');
        assert.strictEqual(json, '', 'plaintext column blanked');
        const plain = decrypt({ data: enc, iv, tag }, KEY_A);
        if (li < legacyExpected.length && plain === legacyExpected[li]) li++;
      }
      assert.strictEqual(li, legacyExpected.length, 'every migrated row decrypts to its original rows_json');

      // Idempotence: second pass migrates nothing and changes nothing.
      const snap = Buffer.from(db.export());
      assert.strictEqual(migrateTimeEntries({ db, key: KEY_A, userId }), 0);
      assert.ok(snap.equals(Buffer.from(db.export())), 'second pass is a no-op');
      db.close();
    }),
    { numRuns: 40 }
  );
});
