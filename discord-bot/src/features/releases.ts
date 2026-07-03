import { EmbedBuilder, ChannelType, type Client, type TextChannel } from 'discord.js';
import { config } from '../config.js';
import { fetchLatestRelease, type Release } from '../github.js';
import { getLastAnnouncedTag, setLastAnnouncedTag } from '../store.js';

// Trim release notes to fit an embed description (4096 hard cap; keep it short).
function shortenNotes(body: string): string {
  const clean = body.replace(/\r/g, '').trim();
  if (!clean) return '_No notes provided._';
  return clean.length > 1500 ? clean.slice(0, 1500).trimEnd() + '\n…' : clean;
}

function formatBytes(n: number): string {
  return n > 1_000_000 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/** Build the announcement/`/version` embed for a release. */
export function buildReleaseEmbed(release: Release, isNew: boolean): EmbedBuilder {
  const installer = release.assets.find((a) => /\.exe$/i.test(a.name)) ?? release.assets[0];
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`${isNew ? '🚀 New release — ' : '📦 '}${release.name}`)
    .setURL(release.htmlUrl)
    .setDescription(shortenNotes(release.body))
    .addFields({ name: 'Version', value: release.tag, inline: true });
  if (installer) {
    embed.addFields({
      name: 'Download',
      value: `[${installer.name}](${installer.url}) · ${formatBytes(installer.size)}`,
      inline: true,
    });
  }
  embed.setFooter({ text: 'Conquered Time' }).setTimestamp(new Date(release.publishedAt));
  return embed;
}

async function checkOnce(client: Client): Promise<void> {
  if (!config.announceChannelId) return;
  const release = await fetchLatestRelease();
  if (!release) return;
  if (getLastAnnouncedTag() === release.tag) return;

  const channel = await client.channels.fetch(config.announceChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.warn('[releases] announce channel not found or not a text channel.');
    return;
  }

  // First run seeds the baseline WITHOUT announcing, so we don't spam the
  // channel with whatever the current latest release happens to be on boot.
  const first = getLastAnnouncedTag() === undefined;
  setLastAnnouncedTag(release.tag);
  if (first) {
    console.log(`[releases] baseline set to ${release.tag} (no announcement on first run).`);
    return;
  }

  await (channel as TextChannel).send({ content: '@here A new version of Conquered Time is out!', embeds: [buildReleaseEmbed(release, true)] });
  console.log(`[releases] announced ${release.tag}.`);
}

/** Start polling GitHub for new releases and announce them. */
export function startReleaseWatcher(client: Client): void {
  if (!config.announceChannelId) {
    console.log('[releases] no ANNOUNCE_CHANNEL_ID set — release announcements disabled.');
    return;
  }
  const everyMs = config.releasePollMinutes * 60_000;
  void checkOnce(client);
  setInterval(() => void checkOnce(client), everyMs);
  console.log(`[releases] watching ${config.githubRepo} every ${config.releasePollMinutes} min.`);
}
