/**
 * ArchiveHandler — Handles archive browsing: list, preview, search, sort, favorites.
 *
 * State encoding inside customIds:  p:s:pg:f
 *   p  = 'y'|'t'|'s'|'a'   (youtube / tiktok / spotify / all)
 *   s  = 0-5                (index into SORT_OPTIONS)
 *   pg = page number        (0-based)
 *   f  = 0|1|2              (no-filter / favorites / search)
 *
 * v1.2: #searchMap capped at MAX_SEARCH_ENTRIES (200) to prevent unbounded growth.
 * v1.3 fixes:
 * - handlePageSubmit: page number clamped to valid range before calling showList.
 * - All error paths reply with proper ephemeral error messages.
 */

import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { SORT_OPTIONS, PAGE_SIZE, CID } from '../constants.js';
import { listEmbed, previewEmbed, statsEmbed } from '../ui/Embeds.js';
import { listNavRow1, listNavRow2, listSelectRow, previewActionRow, platLabel } from '../ui/Components.js';

const PLAT_MAP  = { y: 'youtube', t: 'tiktok', s: 'spotify', a: null };
const PLAT_CHAR = { youtube: 'y', tiktok: 't', spotify: 's' };

/** Maximum number of concurrent user search queries stored in memory. */
const MAX_SEARCH_ENTRIES = 200;

export class ArchiveHandler {
  #db;
  #logger;
  /** Map<userId, string> — Search query per user (size-capped). */
  #searchMap = new Map();

  constructor(db, logger) {
    this.#db     = db;
    this.#logger = logger;
  }

  // ─── Search map helpers (size-capped) ────────────────────────────────────

  #getSearch(userId) {
    return this.#searchMap.get(userId) ?? '';
  }

  #setSearch(userId, query) {
    if (!this.#searchMap.has(userId) && this.#searchMap.size >= MAX_SEARCH_ENTRIES) {
      // Evict the oldest entry (Map preserves insertion order)
      const oldest = this.#searchMap.keys().next().value;
      this.#searchMap.delete(oldest);
    }
    this.#searchMap.set(userId, query);
  }

  // ─── Entry from Archive Panel ─────────────────────────────────────────────

  async showFromPanel(interaction, sub) {
    const userId = interaction.user.id;

    if (sub === 'search') return this.showSearchModal(interaction, 'a', 0, 0, 0);
    if (sub === 'fav')    return this.showList(interaction, 'a', 0, 0, 1, false);
    if (sub === 'stats')  return this.showStats(interaction);

    // Platform buttons: youtube / tiktok / spotify
    const p = PLAT_CHAR[sub] ?? 'a';
    // Clear stale search query when opening a platform view
    this.#searchMap.delete(userId);
    return this.showList(interaction, p, 0, 0, 0, false);
  }

  // ─── Show List ────────────────────────────────────────────────────────────

  async showList(interaction, p, s, pg, f, useUpdate = false) {
    const guildId  = interaction.guildId;
    const userId   = interaction.user.id;

    const platform      = PLAT_MAP[p] ?? null;
    const sortOpt       = SORT_OPTIONS[s] ?? SORT_OPTIONS[0];
    const sortSql       = sortOpt.sql;
    const sortName      = sortOpt.label;
    const platformLabel = platLabel(p);
    const isFav         = f === 1;
    const isSearch      = f === 2;
    const search        = isSearch ? this.#getSearch(userId) : '';

    let rows, total;
    try {
      if (isFav) {
        const res = this.#db.getFavorites(userId, guildId, {
          sort: sortSql, limit: PAGE_SIZE, offset: pg * PAGE_SIZE,
        });
        rows = res.rows; total = res.total;
      } else {
        const res = this.#db.listMedia(guildId, {
          platform, sort: sortSql, limit: PAGE_SIZE,
          offset: pg * PAGE_SIZE, search,
        });
        rows = res.rows; total = res.total;
      }
    } catch (err) {
      this.#logger.error(`ArchiveHandler.showList: ${err.message}`, 'ArchiveHandler');
      const errMsg = { content: `❌ Gagal memuat daftar: ${err.message}`, embeds: [], components: [] };
      return useUpdate
        ? interaction.update(errMsg)
        : interaction.reply({ ...errMsg, flags: MessageFlags.Ephemeral });
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    // Clamp page to valid range
    const safePg     = Math.max(0, Math.min(pg, totalPages - 1));

    const embed      = listEmbed(rows, { platformLabel, sortName, page: safePg, totalPages, total, isFav, search });
    const components = [
      listNavRow1(p, s, safePg, f, totalPages),
      listNavRow2(p, s, safePg, f),
      ...listSelectRow(rows, p, s, safePg, f),
    ];

    if (useUpdate) {
      await interaction.update({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  async navigate(interaction, p, s, pg, f) {
    await this.showList(interaction, p, s, pg, f, true);
  }

  // ─── Sort (cycle) ─────────────────────────────────────────────────────────

  async handleSort(interaction, p, s, pg, f) {
    const nextS = (s + 1) % SORT_OPTIONS.length;
    await this.showList(interaction, p, nextS, 0, f, true);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  async showPreview(interaction, mediaId, p, s, pg, f) {
    const userId = interaction.user.id;
    const media  = this.#db.getMediaById(mediaId);
    if (!media) {
      return interaction.update({ content: '❌ URL tidak ditemukan.', embeds: [], components: [] });
    }
    const isFav      = this.#db.isFavorite(userId, mediaId);
    const embed      = previewEmbed(media, isFav);
    const components = previewActionRow(mediaId, isFav, p, s, pg, f);
    await interaction.update({ embeds: [embed], components });
  }

  async handlePreview(interaction, action, mediaId, p, s, pg, f) {
    const userId = interaction.user.id;

    if (action === 'copy') {
      const media = this.#db.getMediaById(mediaId);
      const url   = media?.boombox_url ?? 'URL tidak tersedia.';
      await interaction.reply({
        content: `🔗 **BoomBox URL:**\n${url.slice(0, 1900)}`,
        flags:   MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'fav') {
      const isNowFav   = this.#db.toggleFavorite(userId, mediaId);
      const media      = this.#db.getMediaById(mediaId);
      const embed      = previewEmbed(media, isNowFav);
      const components = previewActionRow(mediaId, isNowFav, p, s, pg, f);
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (action === 'back') {
      await this.showList(interaction, p, s, pg, f, true);
    }
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async showSearchModal(interaction, p, s, pg, f) {
    const modal = new ModalBuilder()
      .setCustomId(`${CID.MODAL_SEARCH}:${p}:${s}:${pg}:${f}`)
      .setTitle('🔍 Cari URL')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CID.MODAL_SEARCH_INPUT)
            .setLabel('Kata kunci pencarian')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder('Judul lagu, video...')
        )
      );
    await interaction.showModal(modal);
  }

  async handleSearchSubmit(interaction, p, s, pg, f) {
    const query = interaction.fields.getTextInputValue(CID.MODAL_SEARCH_INPUT)?.trim();
    if (!query) {
      return interaction.reply({ content: '❌ Kata kunci tidak boleh kosong.', flags: MessageFlags.Ephemeral });
    }
    this.#setSearch(interaction.user.id, query);
    await this.showList(interaction, p, s, 0, 2, false);
  }

  // ─── Page jump ────────────────────────────────────────────────────────────

  async showPageModal(interaction, p, s, pg, f) {
    const modal = new ModalBuilder()
      .setCustomId(`${CID.MODAL_PAGE}:${p}:${s}:${pg}:${f}`)
      .setTitle('📄 Lompat ke Halaman')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CID.MODAL_PAGE_INPUT)
            .setLabel('Nomor halaman')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(6)
            .setPlaceholder('Contoh: 5')
        )
      );
    await interaction.showModal(modal);
  }

  async handlePageSubmit(interaction, p, s, pg, f) {
    const raw    = interaction.fields.getTextInputValue(CID.MODAL_PAGE_INPUT)?.trim();
    const parsed = parseInt(raw, 10);

    if (isNaN(parsed) || parsed < 1) {
      return interaction.reply({
        content: '❌ Nomor halaman tidak valid. Masukkan angka 1 atau lebih.',
        flags:   MessageFlags.Ephemeral,
      });
    }

    // Convert to 0-based index; showList's safePg will clamp to totalPages
    const requestedPg = parsed - 1;
    try {
      await this.showList(interaction, p, s, requestedPg, f, false);
    } catch (err) {
      this.#logger.error(`handlePageSubmit error: ${err.message}`, 'ArchiveHandler');
      await interaction.reply({
        content: `❌ Gagal membuka halaman: ${err.message}`,
        flags:   MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }

  // ─── Statistics ───────────────────────────────────────────────────────────

  async showStats(interaction) {
    const guildId = interaction.guildId;
    const stats   = this.#db.getStats(guildId);
    const counts  = this.#db.countByPlatform(guildId);
    await interaction.reply({ embeds: [statsEmbed(stats, counts)], flags: MessageFlags.Ephemeral });
  }
}
