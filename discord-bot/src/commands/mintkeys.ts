import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';
import { hasSecret, mintKey } from '../betakeys.js';
import { isAdmin } from '../util.js';

// /mintkeys count:[1-50] [expiry] — admin-only bulk minting for manual
// distribution (giveaways, partners, etc.). Does NOT record per-user claims;
// these keys aren't tied to a member. Reply is ephemeral so the batch stays
// private to the admin.
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mintkeys')
    .setDescription('Admin: mint a batch of beta keys for manual distribution.')
    .addIntegerOption((o) =>
      o.setName('count').setDescription('How many keys (1–50).').setMinValue(1).setMaxValue(50).setRequired(true))
    .addStringOption((o) =>
      o.setName('expiry').setDescription('Expiry date YYYY-MM-DD (UTC). Defaults to the configured expiry.'))
    .setDefaultMemberPermissions(0), // hidden from non-admins by default; still re-checked below

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: '🔒 This command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!hasSecret()) {
      await interaction.reply({ content: '⚠️ The signing secret isn’t configured, so keys can’t be minted.', flags: MessageFlags.Ephemeral });
      return;
    }

    const count = interaction.options.getInteger('count', true);
    const expiry = interaction.options.getString('expiry') ?? config.betaKeyExpiry;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      await interaction.reply({ content: '⚠️ Expiry must be in YYYY-MM-DD format.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const keys: string[] = [];
      for (let i = 0; i < count; i++) keys.push(mintKey(expiry));
      await interaction.reply({
        content: `🔑 **${count}** key(s), valid through **${expiry}** (UTC):\n\`\`\`\n${keys.join('\n')}\n\`\`\``,
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      await interaction.reply({ content: `⚠️ Mint failed: ${(e as Error).message}`, flags: MessageFlags.Ephemeral });
    }
  },
};
