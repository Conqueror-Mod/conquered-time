import type { Command } from './types.js';
import { command as betakey } from './betakey.js';
import { command as mintkeys } from './mintkeys.js';
import { command as bug } from './bug.js';
import { command as feedback } from './feedback.js';
import { command as version } from './version.js';

// Every slash command the bot serves. Used by both the runtime router
// (index.ts) and the registration script (deploy-commands.ts).
export const commands: Command[] = [betakey, mintkeys, bug, feedback, version];

export const commandMap = new Map<string, Command>(commands.map((c) => [c.data.name, c]));
