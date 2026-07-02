'use strict';

// Offline beta-key minting + verification (pure, no Electron — unit-tested).
//
// A key carries a tiny signed payload so the app can validate it with no server:
//   payload (5 bytes): version(1) | expiryDays uint16 LE (2) | nonce (2)
//   mac    (10 bytes): HMAC-SHA256(secret, MAGIC || payload) truncated
//   keyBytes = payload || mac  (15 bytes) -> Crockford base32 (24 chars)
//   formatted: CONQ-XXXXXX-XXXXXX-XXXXXX-XXXXXX
//
// Security note: this is a shared-secret (HMAC) scheme, so the secret ships
// inside the app. It makes keys tamper-evident and unforgeable WITHOUT the
// secret (80-bit MAC), which is the right bar for a free beta gate — not
// hardened DRM. Keep src/shared/beta-secret.js out of the public repo.

const crypto = require('crypto');

const MAGIC      = Buffer.from('CTBK1');   // domain separation for the MAC
const VERSION    = 1;
const MAC_LEN    = 10;
const PAYLOAD_LEN = 5;
const MS_PER_DAY = 86400000;

// Crockford base32 (no I, L, O, U — avoids look-alike confusion on entry).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE = (() => {
  const m = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]] = i;
  // forgiving aliases
  m['O'] = 0; m['I'] = 1; m['L'] = 1;
  return m;
})();

/**
 * @param {Buffer | Uint8Array} buf
 * @returns {string}
 */
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * @param {string} str
 * @returns {Buffer}
 */
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str) {
    const v = DECODE[ch];
    if (v === undefined) throw new Error('bad character');
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function macFor(secret, payload) {
  return crypto.createHmac('sha256', secret)
    .update(MAGIC).update(payload)
    .digest().subarray(0, MAC_LEN);
}

function format(b32) {
  // 24 chars -> 4 groups of 6, prefixed.
  const groups = b32.match(/.{1,6}/g) || [b32];
  return 'CONQ-' + groups.join('-');
}

function normalize(keyStr) {
  return String(keyStr || '')
    .toUpperCase()
    .replace(/^CONQ-?/i, '')          // drop optional prefix
    .replace(/[^0-9A-Z]/g, '');       // strip dashes/spaces/etc.
}

// Convert a Date or 'YYYY-MM-DD' string to whole days since the unix epoch (UTC).
/**
 * @param {Date | string} expiry
 * @returns {number}
 */
function toExpiryDays(expiry) {
  const d = expiry instanceof Date ? expiry : new Date(`${expiry}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new Error('invalid expiry date');
  const days = Math.floor(d.getTime() / MS_PER_DAY);
  if (days < 0 || days > 0xffff) throw new Error('expiry out of range');
  return days;
}

// Mint a key valid through the end of the given expiry day.
/**
 * @param {string | Buffer} secret
 * @param {Date | string} expiry
 * @param {Buffer} [nonce] 2 bytes; random when omitted
 * @returns {string} formatted CONQ-XXXXXX-XXXXXX-XXXXXX-XXXXXX key
 */
function makeKey(secret, expiry, nonce) {
  if (!secret) throw new Error('missing secret');
  const days = toExpiryDays(expiry);
  const rnd = nonce || crypto.randomBytes(2);
  const payload = Buffer.from([VERSION, days & 0xff, (days >> 8) & 0xff, rnd[0], rnd[1]]);
  const keyBytes = Buffer.concat([payload, macFor(secret, payload)]);
  return format(base32Encode(keyBytes));
}

// Verify a key. Returns { valid, reason?, expiry?(Date), expired? }.
/**
 * @param {string | Buffer | null | undefined} secret
 * @param {unknown} keyStr
 * @returns {{ valid: boolean, reason?: string, expiry?: Date, expired?: boolean }}
 */
function verifyKey(secret, keyStr) {
  if (!secret) return { valid: false, reason: 'no-secret' };
  let bytes;
  try { bytes = base32Decode(normalize(keyStr)); }
  catch { return { valid: false, reason: 'malformed' }; }
  if (bytes.length !== PAYLOAD_LEN + MAC_LEN) return { valid: false, reason: 'malformed' };

  const payload = bytes.subarray(0, PAYLOAD_LEN);
  const mac     = bytes.subarray(PAYLOAD_LEN);
  if (payload[0] !== VERSION) return { valid: false, reason: 'version' };

  const expected = macFor(secret, payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) {
    return { valid: false, reason: 'invalid' };
  }

  const days = payload[1] | (payload[2] << 8);
  const expiry = new Date(days * MS_PER_DAY);
  // Valid through the END of the expiry day (UTC).
  const expired = Date.now() >= (days + 1) * MS_PER_DAY;
  if (expired) return { valid: false, reason: 'expired', expiry, expired: true };

  return { valid: true, expiry };
}

module.exports = { makeKey, verifyKey, base32Encode, base32Decode, toExpiryDays };
