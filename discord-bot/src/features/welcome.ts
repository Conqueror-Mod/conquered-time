import { EmbedBuilder, ChannelType, type Client, type GuildMember, type TextChannel } from 'discord.js';
import { config } from '../config.js';

// Welcome new members: assign the Beta Tester role and greet them (in the
// welcome channel if configured, otherwise via DM). Wired on the client's
// guildMemberAdd event by startWelcome().

// Guard against welcoming the same member twice — e.g. guildMemberAdd fires and
// then guildMemberUpdate fires again for the same person. In-memory only (a
// member joins once; a bot restart can't replay joins), so no persistence.
const welcomed = new Set<string>();

async function welcomeMember(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  if (welcomed.has(member.id)) return;
  welcomed.add(member.id);

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
  // Two paths, so this works with OR without Discord's membership-screening
  // (rules) gate:
  //   • No screening — the member is ready the instant they join, so
  //     guildMemberAdd welcomes them.
  //   • Screening ON — a joining member is "pending" until they accept the
  //     rules. We must NOT welcome/assign a role while pending; instead we wait
  //     for guildMemberUpdate to flip pending → false (they passed the gate).
  client.on('guildMemberAdd', (member) => {
    if (member.pending) return;            // screening on → defer to the update
    void welcomeMember(member);
  });

  client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (oldMember.pending && !newMember.pending) void welcomeMember(newMember);
  });

  console.log('[welcome] listening for new members (screening-aware).');
}
