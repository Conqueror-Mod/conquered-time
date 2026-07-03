import { createRequire } from 'node:module';

// Reuse the app's audited, unit-tested beta-key implementation and the SAME
// shared signing secret, so keys minted here validate in the app byte-for-byte.
// beta-keys.js is CommonJS + pure; we require() it at runtime (createRequire)
// rather than TS-importing across projects. The path is relative to this file
// and resolves identically whether run from src/ (tsx) or dist/ (built), since
// both sit one level under discord-bot/.
const require = createRequire(import.meta.url);

type VerifyResult = { valid: boolean; reason?: string; expiry?: Date; expired?: boolean };
interface BetaKeysModule {
  makeKey(secret: string | Buffer, expiry: Date | string, nonce?: Buffer): string;
  verifyKey(secret: string | Buffer | null | undefined, keyStr: unknown): VerifyResult;
}

const betaKeys = require('../../src/main/beta-keys.js') as BetaKeysModule;

let secret: string | null = null;
try {
  secret = require('../../src/shared/beta-secret.js') as string;
} catch {
  secret = null;
}

const PLACEHOLDER = 'REPLACE_WITH_A_RANDOM_32_BYTE_HEX_SECRET';

/** True when a real signing secret is present (so key commands can operate). */
export function hasSecret(): boolean {
  return !!secret && secret !== PLACEHOLDER;
}

/** Mint one formatted CONQ-… key expiring at the end of `expiry` (YYYY-MM-DD, UTC). */
export function mintKey(expiry: string): string {
  if (!hasSecret()) throw new Error('Beta signing secret is not configured (src/shared/beta-secret.js).');
  return betaKeys.makeKey(secret as string, expiry);
}

/** Verify a key against the shared secret. */
export function verifyKey(key: string): VerifyResult {
  return betaKeys.verifyKey(secret, key);
}
