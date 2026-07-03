import { SlashCommandBuilder, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';
import { fetchLatestRelease } from '../github.js';
import { buildReleaseEmbed } from '../features/releases.js';

// /version — show the current released version + download link (from GitHub
// Releases). Ephemeral so it doesn't clutter channels.
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('version')
    .setDescription('Show the latest released version of Conquered Time.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const release = await fetchLatestRelease();
    if (!release) {
      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle('Version info unavailable')
        .setDescription('Couldn’t reach GitHub Releases. If the repo is private, an admin needs to set `GITHUB_TOKEN`.');
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    await interaction.editReply({ embeds: [buildReleaseEmbed(release, false)] });
  },
};
