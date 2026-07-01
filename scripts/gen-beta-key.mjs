// Mint Conquered Time beta keys (run privately — needs src/shared/beta-secret.js).
//
//   node scripts/gen-beta-key.mjs --expires 2026-09-30
//   node scripts/gen-beta-key.mjs --expires 2026-09-30 --count 10 --label "Wave 1"
//
// --expires YYYY-MM-DD  (required) key works through the end of this day (UTC)
// --count N             (optional) mint N keys (default 1)
// --label "text"        (optional) printed alongside for your own record-keeping
//                       (NOT embedded in the key)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeKey } = require('../src/main/beta-keys.js');

let secret;
try { secret = require('../src/shared/beta-secret.js'); }
catch {
  console.error('ERROR: src/shared/beta-secret.js not found.');
  console.error('Copy src/shared/beta-secret.example.js to beta-secret.js and set a random secret.');
  process.exit(1);
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const expires = arg('expires');
if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
  console.error('Usage: node scripts/gen-beta-key.mjs --expires YYYY-MM-DD [--count N] [--label "text"]');
  process.exit(1);
}
const count = Math.max(1, parseInt(arg('count', '1'), 10) || 1);
const label = arg('label', '');

try {
  console.log(`# ${count} beta key(s), expire end of ${expires} (UTC)${label ? ` — ${label}` : ''}`);
  for (let i = 0; i < count; i++) console.log(makeKey(secret, expires));
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
