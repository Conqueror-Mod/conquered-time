'use strict';

// Property-based tests (fast-check) for the offline beta-key scheme — Phase A
// of docs/PLAN-property-testing.md (A8–A10). verifyKey reads the real clock
// (Date.now), so the expiry properties pin it to a chosen instant and restore
// it afterward rather than sleeping across day boundaries.

const { test } = require('node:test');
const assert   = require('node:assert');
const fc       = require('fast-check');
const { makeKey, verifyKey } = require('../src/main/beta-keys');

const MS_PER_DAY = 86400000;

const arbSecret = fc.string({ unit: 'binary', minLength: 1, maxLength: 64 });
// expiryDays is a uint16 of whole days since the unix epoch.
const arbDays   = fc.integer({ min: 0, max: 0xffff });
const arbNonce  = fc.uint8Array({ minLength: 2, maxLength: 2 }).map(a => Buffer.from(a));

function atClock(nowMs, fn) {
  const real = Date.now;
  Date.now = () => nowMs;
  try { return fn(); } finally { Date.now = real; }
}

test('A8: mint → verify round-trips across the whole expiry/nonce space', () => {
  fc.assert(
    fc.property(arbSecret, arbDays, arbNonce, (secret, days, nonce) => {
      const key = makeKey(secret, new Date(days * MS_PER_DAY), nonce);
      assert.match(key, /^CONQ-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
      // Verify at the start of the expiry day — always within validity.
      const r = atClock(days * MS_PER_DAY, () => verifyKey(secret, key));
      assert.strictEqual(r.valid, true, `reason=${r.reason}`);
      assert.strictEqual(r.expiry.getTime(), days * MS_PER_DAY);
      // And a differently-cased / undashed entry still verifies (normalize()).
      const sloppy = key.toLowerCase().replace(/-/g, ' ');
      assert.strictEqual(atClock(days * MS_PER_DAY, () => verifyKey(secret, sloppy)).valid, true);
    })
  );
});

test('A9: any single-character corruption of a minted key fails verification', () => {
  // Crockford aliases decode O→0 and I/L→1, so a corruption is only a real
  // corruption if the replacement decodes to a DIFFERENT 5-bit value.
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  fc.assert(
    fc.property(arbSecret, arbDays, arbNonce, fc.nat(), fc.nat(30), (secret, days, nonce, posSeed, repSeed) => {
      const key  = makeKey(secret, new Date(days * MS_PER_DAY), nonce);
      const body = key.slice(5).replace(/-/g, '');           // 24 base32 chars
      const pos  = posSeed % body.length;
      const cur  = ALPHABET.indexOf(body[pos]);
      const rep  = ALPHABET[(cur + 1 + (repSeed % 31)) % 32]; // different value, always
      const corrupted = body.slice(0, pos) + rep + body.slice(pos + 1);
      const r = atClock(days * MS_PER_DAY, () => verifyKey(secret, corrupted));
      assert.strictEqual(r.valid, false);
    })
  );
});

test('A10: expiry boundary is exact — valid through end of expiry day (UTC), invalid after', () => {
  fc.assert(
    fc.property(arbSecret, arbDays, arbNonce, (secret, days, nonce) => {
      const key = makeKey(secret, new Date(days * MS_PER_DAY), nonce);
      const endOfDay = (days + 1) * MS_PER_DAY;
      const lastValid = atClock(endOfDay - 1, () => verifyKey(secret, key));
      assert.strictEqual(lastValid.valid, true, 'last ms of expiry day is valid');
      const firstExpired = atClock(endOfDay, () => verifyKey(secret, key));
      assert.strictEqual(firstExpired.valid, false);
      assert.strictEqual(firstExpired.reason, 'expired');
      assert.strictEqual(firstExpired.expired, true);
    })
  );
});
