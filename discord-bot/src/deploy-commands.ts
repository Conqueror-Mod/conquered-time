import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';

// Register all slash commands to the beta guild (instant, unlike global
// commands which can take up to an hour). Run this once, and again whenever you
// add/change a command:  npm run deploy
async function main(): Promise<void> {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.token);

  console.log(`Registering ${body.length} command(s) to guild ${config.guildId}…`);
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body },
  );
  console.log('✓ Commands registered:', commands.map((c) => `/${c.data.name}`).join(', '));
}

main().catch((e) => {
  console.error('Command registration failed:', e);
  process.exit(1);
});
