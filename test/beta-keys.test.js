'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { makeKey, verifyKey, base32Decode } = require('../src/main/beta-keys.js');

const SECRET = 'a'.repeat(64);
const future = () => { const d = new Date(Date.now() + 90 * 86400000); return d.toISOString().slice(0, 10); };
const past   = () => { const d = new Date(Date.now() - 5 * 86400000);  return d.toISOString().slice(0, 10); };

test('a freshly minted key verifies', () => {
  const key = makeKey(SECRET, future());
  const res = verifyKey(SECRET, key);
  assert.equal(res.valid, true);
  assert.ok(res.expiry instanceof Date);
});

test('key format is CONQ-prefixed, grouped', () => {
  const key = makeKey(SECRET, future());
  assert.match(key, /^CONQ-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
});

test('an expired key is rejected with reason "expired"', () => {
  const key = makeKey(SECRET, past());
  const res = verifyKey(SECRET, key);
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'expired');
  assert.equal(res.expired, true);
});

test('a key minted with a different secret is rejected', () => {
  const key = makeKey('b'.repeat(64), future());
  const res = verifyKey(SECRET, key);
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'invalid');
});

test('a tampered key is rejected', () => {
  const key = makeKey(SECRET, future());
  // flip a character in the last group (the MAC region)
  const chars = key.split('');
  const i = chars.length - 2;
  chars[i] = chars[i] === 'A' ? 'B' : 'A';
  const res = verifyKey(SECRET, chars.join(''));
  assert.equal(res.valid, false);
  assert.ok(res.reason === 'invalid' || res.reason === 'malformed');
});

test('garbage / malformed input is rejected, not thrown', () => {
  for (const junk of ['', 'hello', 'CONQ-????', '12345']) {
    const res = verifyKey(SECRET, junk);
    assert.equal(res.valid, false);
  }
});

test('input is forgiving of case, spaces, missing prefix, and O/I/L aliases', () => {
  const key = makeKey(SECRET, future());
  const messy = key.replace('CONQ-', '').toLowerCase().replace(/-/g, ' ');
  assert.equal(verifyKey(SECRET, messy).valid, true);
});

test('expiry round-trips to the encoded day', () => {
  const day = future();
  const key = makeKey(SECRET, day);
  const res = verifyKey(SECRET, key);
  assert.equal(res.expiry.toISOString().slice(0, 10), day);
});

test('missing secret fails closed without throwing', () => {
  assert.equal(verifyKey('', makeKey(SECRET, future())).valid, false);
});

test('decodes to the expected 15-byte length', () => {
  const key = makeKey(SECRET, future());
  const raw = base32Decode(key.replace(/^CONQ-/, '').replace(/-/g, ''));
  assert.equal(raw.length, 15);
});
