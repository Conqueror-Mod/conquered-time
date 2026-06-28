'use strict';

// Run: npm test   (node --test, no extra deps)
//
// Covers the main-process read cache: hit/miss memoization, targeted and full
// invalidation, owner-change auto-clear (the cross-profile leak guard), and the
// "compute runs exactly once per miss" contract the perf win depends on.

const { test } = require('node:test');
const assert   = require('node:assert');
const { createReadCache } = require('../src/main/read-cache');

// A compute fn that counts calls and returns a tagged value.
function counter(value) {
  let calls = 0;
  const fn = () => { calls++; return value; };
  fn.calls = () => calls;
  return fn;
}

test('miss computes, hit reuses without recomputing', () => {
  const c = createReadCache();
  const compute = counter(['a', 'b']);
  assert.deepStrictEqual(c.get('companies', 1, compute), ['a', 'b']);
  assert.strictEqual(compute.calls(), 1);
  c.get('companies', 1, compute);
  c.get('companies', 1, compute);
  assert.strictEqual(compute.calls(), 1, 'compute must run once for repeated hits');
});

test('distinct keys are cached independently', () => {
  const c = createReadCache();
  const companies = counter('CO');
  const entries   = counter('EN');
  assert.strictEqual(c.get('companies', 1, companies), 'CO');
  assert.strictEqual(c.get('entries',   1, entries),   'EN');
  c.get('companies', 1, companies);
  c.get('entries',   1, entries);
  assert.strictEqual(companies.calls(), 1);
  assert.strictEqual(entries.calls(), 1);
});

test('invalidate drops only named keys', () => {
  const c = createReadCache();
  const companies = counter('CO');
  const entries   = counter('EN');
  c.get('companies', 1, companies);
  c.get('entries',   1, entries);

  c.invalidate('entries');
  c.get('companies', 1, companies);  // still cached
  c.get('entries',   1, entries);    // recomputed
  assert.strictEqual(companies.calls(), 1);
  assert.strictEqual(entries.calls(), 2);
});

test('invalidate accepts multiple keys and ignores unknown ones', () => {
  const c = createReadCache();
  const a = counter('A');
  const b = counter('B');
  c.get('a', 1, a);
  c.get('b', 1, b);
  c.invalidate('a', 'b', 'does-not-exist');
  c.get('a', 1, a);
  c.get('b', 1, b);
  assert.strictEqual(a.calls(), 2);
  assert.strictEqual(b.calls(), 2);
});

test('clear drops everything', () => {
  const c = createReadCache();
  const compute = counter('X');
  c.get('k', 1, compute);
  c.clear();
  c.get('k', 1, compute);
  assert.strictEqual(compute.calls(), 2);
});

test('owner change auto-clears before serving (cross-profile guard)', () => {
  const c = createReadCache();
  const userA = counter('A-data');
  const userB = counter('B-data');

  assert.strictEqual(c.get('companies', 1, userA), 'A-data');
  // Same key, different owner → must NOT serve user 1's cached value.
  assert.strictEqual(c.get('companies', 2, userB), 'B-data');
  assert.strictEqual(userA.calls(), 1);
  assert.strictEqual(userB.calls(), 1);

  // Switching back to user 1 recomputes (cache was wiped on the owner switch).
  c.get('companies', 1, userA);
  assert.strictEqual(userA.calls(), 2);
});

test('owner change wipes ALL keys, not just the requested one', () => {
  const c = createReadCache();
  const companies = counter('CO');
  const entries   = counter('EN');
  c.get('companies', 1, companies);
  c.get('entries',   1, entries);

  // Request a different key under a new owner — should still wipe companies+entries.
  c.get('settings', 2, counter('S'));
  c.get('companies', 2, companies);
  c.get('entries',   2, entries);
  assert.strictEqual(companies.calls(), 2);
  assert.strictEqual(entries.calls(), 2);
});

test('null owner is a valid distinct owner', () => {
  const c = createReadCache();
  const compute = counter('V');
  c.get('k', null, compute);
  c.get('k', null, compute);
  assert.strictEqual(compute.calls(), 1, 'null owner should cache like any other');
  c.get('k', 1, compute);
  assert.strictEqual(compute.calls(), 2, 'switching from null owner recomputes');
});
