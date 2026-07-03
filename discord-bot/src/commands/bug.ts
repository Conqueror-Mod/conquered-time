import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, type ChatInputCommandInteraction, type TextChannel } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';

// Best-effort platform detection from the reporter's roles, so a member with a
// "Windows"/"macOS"/"Linux" role doesn't have to repeat it. Matched by role
// name (case-insensitive), so it works without hardcoding role IDs.
function inferPlatformFromRoles(interaction: ChatInputCommandInteraction): string | null {
  if (!interaction.inCachedGuild()) return null;
  const names = interaction.member.roles.cache.map((r) => r.name.toLowerCase());
  if (names.some((n) => n.includes('windows'))) return 'Windows';
  if (names.some((n) => n === 'mac' || n.includes('macos') || n.includes('mac os'))) return 'macOS';
  if (names.some((n) => n.includes('linux'))) return 'Linux';
  return null;
}

// /bug — structured bug report posted to the bug channel. Captures a short
// title, a description, and optional app version + severity + platform so
// triage is easy.
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bug')
    .setDescription('Report a bug in Conquered Time.')
    .addStringOption((o) =>
      o.setName('title').setDescription('Short summary of the bug.').setRequired(true).setMaxLength(100))
    .addStringOption((o) =>
      o.setName('description').setDescription('What happened? Steps to reproduce, what you expected.').setRequired(true).setMaxLength(1500))
    .addStringOption((o) =>
      o.setName('version').setDescription('App version (see Settings → About), e.g. 3.11.4.'))
    .addStringOption((o) =>
      o.setName('severity').setDescription('How bad is it?')
        .addChoices(
          { name: 'Low — minor / cosmetic', value: 'Low' },
          { name: 'Medium — annoying but workable', value: 'Medium' },
          { name: 'High — blocks a feature', value: 'High' },
          { name: 'Critical — data loss / crash', value: 'Critical' },
        ))
    .addStringOption((o) =>
      o.setName('platform').setDescription('Which OS were you on? (auto-detected from your platform role if left blank)')
        .addChoices(
          { name: 'Windows', value: 'Windows' },
          { name: 'macOS', value: 'macOS' },
          { name: 'Linux', value: 'Linux' },
        )),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!config.bugChannelId) {
      await interaction.reply({ content: '⚠️ Bug reporting isn’t set up yet (no bug channel configured).', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = await interaction.client.channels.fetch(config.bugChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '⚠️ Couldn’t find the bug channel. Ping an admin.', flags: MessageFlags.Ephemeral });
      return;
    }

    const severity = interaction.options.getString('severity') ?? 'Unspecified';
    const version  = interaction.options.getString('version') ?? '—';
    // Platform: use the explicit choice, else infer from the reporter's platform
    // role (Windows / macOS / Linux) if they have one.
    const platform = interaction.options.getString('platform') ?? inferPlatformFromRoles(interaction) ?? '—';

    const embed = new EmbedBuilder()
      .setColor(0xe8564a)
      .setTitle(`🐞 ${interaction.options.getString('title', true)}`)
      .setDescription(interaction.options.getString('description', true))
      .addFields(
        { name: 'Severity', value: severity, inline: true },
        { name: 'Platform', value: platform, inline: true },
        { name: 'Version', value: version, inline: true },
      )
      .setFooter({ text: `Reported by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
    await interaction.reply({ content: '🐞 Thanks — your bug report was filed. We’ll take a look!', flags: MessageFlags.Ephemeral });
  },
};
