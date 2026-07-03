import { SlashCommandBuilder, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './types.js';
import { config } from '../config.js';

// Frequently-asked questions. Edit these in one place; /faq surfaces them.
interface Faq { key: string; label: string; question: string; answer: string }

const FAQS: Faq[] = [
  {
    key: 'getting-started',
    label: 'Getting started',
    question: 'How do I get started?',
    answer:
      '1. Run `/betakey` in **#obtain-key** to get your access key.\n' +
      '2. Download the installer from **#app-updates**.\n' +
      '3. Run it, then paste your key on the app’s first-launch screen.',
  },
  {
    key: 'beta-key',
    label: 'Beta key',
    question: 'How do I get a beta key?',
    answer:
      'Type `/betakey` in **#obtain-key**. The bot DMs you a key and also shows it privately (only you can see it). It’s **one key per member** — running the command again just returns the same key. Paste it on the app’s beta gate at first launch.',
  },
  {
    key: 'install',
    label: 'Installing',
    question: 'How do I install the app?',
    answer:
      'Download **Conquered Time Setup x.y.z.exe** from **#app-updates** and run it. Requires **Windows 10/11 (64-bit)**. You can optionally have it launch at startup from **Settings → Window**.',
  },
  {
    key: 'updates',
    label: 'Updates',
    question: 'How do I get the latest version?',
    answer:
      'The app checks for updates itself — **Settings → About → Check for Updates**. New builds are also announced in **#app-updates**, where you can grab the installer.',
  },
  {
    key: 'data-security',
    label: 'Data & privacy',
    question: 'Is my data safe?',
    answer:
      'Yes. Everything stays **local on your machine** — the app has no server. Your data is encrypted at rest with **AES-256-GCM**, with the key derived from your password (PBKDF2). Login is protected by **TOTP two-factor authentication**.',
  },
  {
    key: 'platforms',
    label: 'Platforms',
    question: 'Which platforms are supported?',
    answer: '**Windows 10/11 (64-bit)** today. **macOS** and **Linux** are on the roadmap.',
  },
  {
    key: 'report',
    label: 'Reporting bugs',
    question: 'How do I report a bug or give feedback?',
    answer:
      'Use `/bug` for bugs — add a title, what happened, your version (**Settings → About**), and pick a severity/platform; it posts to **#bugs**. For ideas and requests, use `/feedback`.',
  },
];

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Answers to common questions about the Conquered Time beta.')
    .addStringOption((o) => {
      o.setName('topic').setDescription('Jump to a specific question.');
      for (const f of FAQS) o.addChoices({ name: f.label, value: f.key });
      return o;
    }),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const topic = interaction.options.getString('topic');

    if (topic) {
      const f = FAQS.find((x) => x.key === topic);
      if (f) {
        const embed = new EmbedBuilder()
          .setColor(config.embedColor)
          .setTitle(`❓ ${f.question}`)
          .setDescription(f.answer);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    }

    // No topic (or unknown): show the full FAQ.
    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('❓ Conquered Time — FAQ')
      .setDescription('Run `/faq topic:<name>` to jump to one, or read them all here:')
      .addFields(FAQS.map((f) => ({ name: f.question, value: f.answer })));

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
