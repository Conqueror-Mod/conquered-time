import { SlashCommandBuilder, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';
import { commands } from './index.js';

// /help — lists every command the bot serves, built dynamically from the
// registry so it never drifts out of date. Ephemeral (only the caller sees it).
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List everything the Conquered Time bot can do.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lines = commands.map((c) => {
      const json = c.data.toJSON() as { name: string; description: string };
      return `**/${json.name}** — ${json.description}`;
    });
    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('⌛ Conquered Time — bot commands')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'New here? Try /faq for common questions.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
