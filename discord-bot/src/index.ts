import { Client, GatewayIntentBits, Events, MessageFlags, ActivityType } from 'discord.js';
import { config } from './config.js';
import { commandMap } from './commands/index.js';
import { startWelcome } from './features/welcome.js';
import { startReleaseWatcher } from './features/releases.js';
import { hasSecret } from './betakeys.js';

// GuildMembers is a PRIVILEGED intent — enable it in the Developer Portal
// (Bot → Privileged Gateway Intents → Server Members Intent) or guildMemberAdd
// won't fire and welcome/role assignment won't work.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✓ Logged in as ${c.user.tag}`);
  console.log(`  Beta key signing: ${hasSecret() ? 'enabled' : 'DISABLED (src/shared/beta-secret.js missing)'}`);
  c.user.setActivity('the Conquered Time beta', { type: ActivityType.Watching });
  startWelcome(client);
  startReleaseWatcher(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const content = '⚠️ Something went wrong running that command.';
    // editReply keeps the ephemeral state chosen at reply/defer time; only the
    // initial reply carries the Ephemeral flag.
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(config.token);

// Graceful shutdown so the process exits cleanly under a supervisor.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} received — shutting down.`);
    client.destroy();
    process.exit(0);
  });
}
