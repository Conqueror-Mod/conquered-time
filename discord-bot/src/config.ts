import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env by ABSOLUTE path (relative to this file), not the current working
// directory — so the bot finds it whether launched from discord-bot/ by hand or
// from elsewhere by a background service / Task Scheduler. src/ (tsx) and dist/
// (built) are both one level under discord-bot/, where .env lives.
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

// Centralised, validated configuration. Required values throw at startup with a
// clear message; optional values are typed as `string | undefined` so callers
// must decide how to degrade when a channel/role isn't configured.

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`\n[config] Missing required env var ${name}. Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return v.trim();
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function intOr(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export const config = {
  token:    required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId:  required('DISCORD_GUILD_ID'),

  betaRoleId:    optional('BETA_ROLE_ID'),
  adminRoleId:   optional('ADMIN_ROLE_ID'),
  betaKeyRoleId: optional('BETA_KEY_ROLE_ID'),

  welcomeChannelId:  optional('WELCOME_CHANNEL_ID'),
  bugChannelId:      optional('BUG_CHANNEL_ID'),
  feedbackChannelId: optional('FEEDBACK_CHANNEL_ID'),
  announceChannelId: optional('ANNOUNCE_CHANNEL_ID'),

  betaKeyExpiry: optional('BETA_KEY_EXPIRY') ?? '2026-12-31',

  githubRepo:        optional('GITHUB_REPO') ?? 'Conqueror-Mod/conquered-time',
  githubToken:       optional('GITHUB_TOKEN'),
  releasePollMinutes: intOr('RELEASE_POLL_MINUTES', 10),

  // Brand accent used for embeds (Zanarkand aqua).
  embedColor: 0x10d6e8,
} as const;

export type Config = typeof config;
