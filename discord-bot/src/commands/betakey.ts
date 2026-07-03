import { SlashCommandBuilder, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';
import { hasSecret, mintKey } from '../betakeys.js';
import { getClaim, setClaim } from '../store.js';
import { hasRole } from '../util.js';

// /betakey — gives the member a beta key. One key per user: repeat calls return
// the same key. Optionally gated behind BETA_KEY_ROLE_ID. The key is delivered
// ephemerally (only the requester sees it) and also DM'd for their records.
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('betakey')
    .setDescription('Get your Conquered Time beta access key.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!hasSecret()) {
      await interaction.reply({ content: '⚠️ Beta keys aren’t available right now — the signing secret isn’t configured. Ping an admin.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (config.betaKeyRoleId && !hasRole(interaction, config.betaKeyRoleId)) {
      await interaction.reply({ content: '🔒 You don’t have access to request a beta key yet.', flags: MessageFlags.Ephemeral });
      return;
    }

    const userId = interaction.user.id;
    let claim = getClaim(userId);
    let reused = true;

    if (!claim) {
      try {
        const key = mintKey(config.betaKeyExpiry);
        claim = { key, expiry: config.betaKeyExpiry, mintedAt: new Date().toISOString(), username: interaction.user.tag };
        setClaim(userId, claim);
        reused = false;
      } catch (e) {
        await interaction.reply({ content: `⚠️ Couldn’t mint a key: ${(e as Error).message}`, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('🔑 Your Conquered Time beta key')
      .setDescription(`\`\`\`\n${claim.key}\n\`\`\``)
      .addFields(
        { name: 'How to use', value: 'Open Conquered Time on first launch and paste this key on the beta gate screen.' },
        { name: 'Valid through', value: `${claim.expiry} (UTC)`, inline: true },
      )
      .setFooter({ text: reused ? 'You already had a key — here it is again.' : 'Keep this private — it’s tied to you.' });

    let dmed = false;
    try {
      await interaction.user.send({ embeds: [embed] });
      dmed = true;
    } catch {
      // DMs closed — the ephemeral reply below still delivers the key.
    }

    await interaction.reply({
      content: dmed ? '📬 Sent your beta key to your DMs (also shown below, only visible to you):' : 'Here’s your beta key (only visible to you):',
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
