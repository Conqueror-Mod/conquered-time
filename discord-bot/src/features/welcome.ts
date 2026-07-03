import { EmbedBuilder, ChannelType, type Client, type GuildMember, type TextChannel } from 'discord.js';
import { config } from '../config.js';

// Welcome new members: assign the Beta Tester role and greet them (in the
// welcome channel if configured, otherwise via DM). Wired on the client's
// guildMemberAdd event by startWelcome().

async function onMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  // Assign the beta role.
  if (config.betaRoleId) {
    try {
      await member.roles.add(config.betaRoleId, 'Auto-assigned on join');
    } catch (e) {
      console.warn(`[welcome] couldn't assign beta role to ${member.user.tag}: ${(e as Error).message}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`Welcome to the Conquered Time beta, ${member.displayName}! ⌛`)
    .setDescription(
      'Glad to have you. A few quick pointers:\n\n' +
      '• Run `/betakey` to get your access key for first launch.\n' +
      '• Hit a problem? File it with `/bug`.\n' +
      '• Got an idea? `/feedback` sends it straight to us.\n' +
      '• `/version` shows the latest build and download link.\n\n' +
      'Thanks for helping shape the app. 🙌',
    )
    .setThumbnail(member.user.displayAvatarURL());

  // Prefer the welcome channel; fall back to a DM.
  if (config.welcomeChannelId) {
    const channel = await member.client.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (channel && channel.type === ChannelType.GuildText) {
      await (channel as TextChannel).send({ content: `${member}`, embeds: [embed] }).catch(() => {});
      return;
    }
  }
  await member.send({ embeds: [embed] }).catch(() => {
    console.warn(`[welcome] couldn't DM ${member.user.tag} (DMs closed) and no welcome channel available.`);
  });
}

export function startWelcome(client: Client): void {
  client.on('guildMemberAdd', (member) => void onMemberAdd(member));
  console.log('[welcome] listening for new members.');
}
