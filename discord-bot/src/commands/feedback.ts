import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, type ChatInputCommandInteraction, type TextChannel } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';

// /feedback — general feedback / feature requests posted to the feedback channel.
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Share feedback or a feature idea for Conquered Time.')
    .addStringOption((o) =>
      o.setName('message').setDescription('Your feedback or idea.').setRequired(true).setMaxLength(1500))
    .addStringOption((o) =>
      o.setName('category').setDescription('What’s it about?')
        .addChoices(
          { name: 'Feature request', value: 'Feature request' },
          { name: 'UI / design', value: 'UI / design' },
          { name: 'Performance', value: 'Performance' },
          { name: 'General', value: 'General' },
        )),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!config.feedbackChannelId) {
      await interaction.reply({ content: '⚠️ Feedback isn’t set up yet (no feedback channel configured).', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = await interaction.client.channels.fetch(config.feedbackChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '⚠️ Couldn’t find the feedback channel. Ping an admin.', flags: MessageFlags.Ephemeral });
      return;
    }

    const category = interaction.options.getString('category') ?? 'General';
    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('💡 Feedback')
      .setDescription(interaction.options.getString('message', true))
      .addFields({ name: 'Category', value: category, inline: true })
      .setFooter({ text: `From ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
    await interaction.reply({ content: '💡 Thanks for the feedback — much appreciated!', flags: MessageFlags.Ephemeral });
  },
};
