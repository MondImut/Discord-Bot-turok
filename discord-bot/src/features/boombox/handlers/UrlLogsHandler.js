/**
 * UrlLogsHandler — URL Logs panel interactions.
 *
 * The URL Logs panel is a PUBLIC panel with 3 buttons: YouTube, TikTok, Spotify.
 * When a button is clicked, the bot sends an EPHEMERAL paginated embed to ONLY
 * the user who clicked — other users are not affected.
 *
 * Pagination: 5 URLs per page, Previous / Next buttons.
 * Each user has independent pagination state embedded in the button customId.
 * Navigation customId: bb:urllogs:nav:{platform}:{page}
 */

import { MessageFlags } from 'discord.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import { MCID, FOOTER_TEXT, PLATFORM_META, PAGE_SIZE } from '../constants.js';

const PLAT_MAP = { yt: 'youtube', tk: 'tiktok', sp: 'spotify' };

export class UrlLogsHandler {
  #db;
  #logger;

  constructor(db, logger) {
    this.#db     = db;
    this.#logger = logger;
  }

  /** Called when a platform button (YouTube/TikTok/Spotify) is pressed. */
  async handlePlatformButton(interaction, platCode) {
    await this.#showPage(interaction, platCode, 0, true);
  }

  /** Called for pagination buttons: bb:urllogs:nav:{platCode}:{page} */
  async handleNav(interaction, platCode, page) {
    await this.#showPage(interaction, platCode, page, false);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async #showPage(interaction, platCode, page, isFirst) {
    const guildId  = interaction.guildId;
    const platform = PLAT_MAP[platCode];
    if (!platform) return;

    const config = this.#db.getConfig(guildId);
    if (!config) {
      const msg = { content: '❌ BoomBox belum dikonfigurasi.', flags: MessageFlags.Ephemeral };
      return isFirst ? interaction.reply(msg) : interaction.update(msg);
    }

    const pm      = PLATFORM_META[platform] ?? { label: platform, emoji: '🎵', color: 0x5865F2 };
    const offset  = page * PAGE_SIZE;

    const { rows, total } = this.#db.listMedia(guildId, {
      platform,
      limit:  PAGE_SIZE,
      offset,
      sort:   'created_at DESC',
    });

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);

    const embed = this.#buildEmbed(rows, pm, total, currentPage, totalPages);
    const components = this.#buildNav(platCode, currentPage, totalPages, total);

    try {
      if (isFirst) {
        await interaction.reply({
          embeds:     [embed],
          components,
          flags:      MessageFlags.Ephemeral,
        });
      } else {
        // interaction.update() does not accept flags — the message is already ephemeral.
        await interaction.update({
          embeds:     [embed],
          components,
        });
      }
    } catch (err) {
      this.#logger.warn(`UrlLogsHandler page failed: ${err.message}`, 'UrlLogsHandler');
    }
  }

  #buildEmbed(rows, pm, total, page, totalPages) {
    const lines = rows.length > 0
      ? rows.map((m, i) => {
          const num  = page * PAGE_SIZE + i + 1;
          const title = (m.title || 'Tanpa Judul').slice(0, 50);
          const url   = m.boombox_url?.length > 60
            ? m.boombox_url.slice(0, 57) + '...'
            : m.boombox_url;
          return `**${num}. ${title}**\n\`${url}\``;
        }).join('\n\n')
      : '_Belum ada URL yang tersimpan._';

    return new EmbedBuilder()
      .setColor(pm.color)
      .setTitle(`${pm.emoji} BoomBox URL — ${pm.label}`)
      .setDescription(
        `Total **${total}** URL tersimpan.\n\n${lines}`.slice(0, 4096)
      )
      .setFooter({
        text: `${FOOTER_TEXT} • Hal. ${page + 1} / ${totalPages}`,
      });
  }

  #buildNav(platCode, page, totalPages, total) {
    if (total === 0) return [];

    const prevId = `${MCID.URLLOGS_NAV}:${platCode}:${Math.max(0, page - 1)}`;
    const nextId = `${MCID.URLLOGS_NAV}:${platCode}:${Math.min(totalPages - 1, page + 1)}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(prevId)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(nextId)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages - 1),
    );

    return [row];
  }
}
