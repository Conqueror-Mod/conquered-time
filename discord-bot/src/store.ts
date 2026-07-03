import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Tiny flat-file persistence (JSON). No DB dependency — the beta community's
// state is small (who claimed a key, which release we last announced). Files
// live in discord-bot/data/ (gitignored).

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/ (tsx) or dist/ (built) → one level up is discord-bot/.
const DATA_DIR = join(__dirname, '..', 'data');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function load<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function save(file: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── Beta-key claims ──────────────────────────────────────────────────────────
export interface Claim {
  key: string;
  expiry: string;   // YYYY-MM-DD baked into the key
  mintedAt: string; // ISO timestamp
  username: string; // for the audit trail
}

const CLAIMS_FILE = 'claims.json';
type ClaimMap = Record<string, Claim>; // discordUserId -> Claim

export function getClaim(userId: string): Claim | undefined {
  return load<ClaimMap>(CLAIMS_FILE, {})[userId];
}

export function setClaim(userId: string, claim: Claim): void {
  const map = load<ClaimMap>(CLAIMS_FILE, {});
  map[userId] = claim;
  save(CLAIMS_FILE, map);
}

export function claimCount(): number {
  return Object.keys(load<ClaimMap>(CLAIMS_FILE, {})).length;
}

// ── Release-announcement state ───────────────────────────────────────────────
const STATE_FILE = 'state.json';
interface BotState { lastAnnouncedTag?: string }

export function getLastAnnouncedTag(): string | undefined {
  return load<BotState>(STATE_FILE, {}).lastAnnouncedTag;
}

export function setLastAnnouncedTag(tag: string): void {
  const s = load<BotState>(STATE_FILE, {});
  s.lastAnnouncedTag = tag;
  save(STATE_FILE, s);
}
