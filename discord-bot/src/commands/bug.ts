import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, type ChatInputCommandInteraction, type TextChannel } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';

// /bug — structured bug report posted to the bug channel. Captures a short
// title, a description, and optional app version + severity so triage is easy.
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
    const embed = new EmbedBuilder()
      .setColor(0xe8564a)
      .setTitle(`🐞 ${interaction.options.getString('title', true)}`)
      .setDescription(interaction.options.getString('description', true))
      .addFields(
        { name: 'Severity', value: severity, inline: true },
        { name: 'Version', value: version, inline: true },
      )
      .setFooter({ text: `Reported by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
    await interaction.reply({ content: '🐞 Thanks — your bug report was filed. We’ll take a look!', flags: MessageFlags.Ephemeral });
  },
};
