/**
 * InteractionHandler — Routes all 'bb:' and 'bb:mgr:' / 'bb:urllogs:' interactions.
 *
 * v1.5 — Added BoomBox Manager panel routing + URL Logs panel routing.
 *        Setup wizard removed (remains absent). New SetupManager handles all
 *        manager panel interactions and /setupboombox slash command execution.
 *
 * Active routes:
 * - Success embed buttons  (bb:success:*)
 * - Archive panel          (bb:archive:*, bb:list:*, bb:preview:*)
 * - BoomBox Settings panel (bb:s2:*, bb:settings:* legacy)
 * - BoomBox Manager panel  (bb:mgr:*)
 * - URL Logs panel         (bb:urllogs:*)
 * - Delete confirmation    (bb:del:*)
 * - Initial setup          (bb:setup:*)
 * - Search / page modals
 */

import { MessageFlags } from 'discord.js';
import { CID, MCID } from '../constants.js';
import { previewEmbed } from '../ui/Embeds.js';
import { previewActionRow } from '../ui/Components.js';

export class InteractionHandler {
  #archive;
  #settings;
  #db;
  #logger;
  #setupManager;   // NEW
  #urlLogsHandler; // NEW

  constructor(archiveHandler, settingsHandler, db, logger, setupManager = null, urlLogsHandler = null) {
    this.#archive        = archiveHandler;
    this.#settings       = settingsHandler;
    this.#db             = db;
    this.#logger         = logger;
    this.#setupManager   = setupManager;
    this.#urlLogsHandler = urlLogsHandler;
  }

  async handle(interaction) {
    const id = interaction.customId;
    if (!id?.startsWith('bb:')) return;

    try {
      if      (interaction.isButton())             await this.#handleButton(interaction, id);
      else if (interaction.isStringSelectMenu())   await this.#handleSelect(interaction, id);
      else if (interaction.isModalSubmit())        await this.#handleModal(interaction, id);
      else if (interaction.isChannelSelectMenu())  await this.#handleChannelSelect(interaction, id);
    } catch (err) {
      this.#logger.error(`InteractionHandler [${id}]: ${err.message}`, 'InteractionHandler');
      await this.#safeError(interaction, err.message);
    }
  }

  // ─── Button Router ────────────────────────────────────────────────────────

  async #handleButton(interaction, id) {
    // ── Success embed buttons: bb:success:{action}:{mediaId} ──────────────
    if (id.startsWith('bb:success:')) {
      const parts   = id.split(':');
      const action  = parts[2];
      const mediaId = +parts[3];
      return this.#handleSuccessButton(interaction, action, mediaId);
    }

    // ── Archive panel: bb:archive:{sub} ───────────────────────────────────
    if (id.startsWith('bb:archive:')) {
      const sub = id.split(':')[2];
      return this.#archive.showFromPanel(interaction, sub);
    }

    // ── List navigation: bb:list:{action}:{p}:{s}:{pg}:{f} ────────────────
    if (id.startsWith('bb:list:')) {
      const parts  = id.split(':');
      const action = parts[2];
      const [p, s, pg, f] = [parts[3], +parts[4], +parts[5], +parts[6]];

      if (['first', 'prev', 'next', 'last'].includes(action))
        return this.#archive.navigate(interaction, p, s, pg, f);
      if (action === 'page')   return this.#archive.showPageModal(interaction, p, s, pg, f);
      if (action === 'search') return this.#archive.showSearchModal(interaction, p, s, pg, f);
      if (action === 'sort')   return this.#archive.handleSort(interaction, p, s, pg, f);
      if (action === 'fav')    return this.#archive.navigate(interaction, p, s, 0, f);
      if (action === 'home')   return this.#archive.navigate(interaction, p, s, 0, 0);
    }

    // ── Preview buttons: bb:preview:{action}:{mediaId}:{p}:{s}:{pg}:{f} ───
    if (id.startsWith('bb:preview:')) {
      const parts   = id.split(':');
      const action  = parts[2];
      const mediaId = +parts[3];
      const [p, s, pg, f] = [parts[4], +parts[5], +parts[6], +parts[7]];
      return this.#archive.handlePreview(interaction, action, mediaId, p, s, pg, f);
    }

    // ── BoomBox Settings panel (legacy bb:settings:* CIDs) ─────────────────
    if (id === CID.SETTINGS_AUTODEL)     return this.#settings.toggleAutoDelete(interaction);
    if (id === CID.SETTINGS_REPLY_MODE)  return this.#settings.toggleReplyMode(interaction);
    if (id === CID.SETTINGS_CLEAR_CACHE) return this.#settings.clearCache(interaction);

    // ── BoomBox Settings panel (new bb:s2:* CIDs) ─────────────────────────
    if (id === CID.S2_AUTODEL)       return this.#settings.toggleAutoDelete(interaction);
    if (id === CID.S2_REPLY_MODE)    return this.#settings.toggleReplyMode(interaction);
    if (id === CID.S2_WORKERS_INC)   return this.#settings.incrementWorkers(interaction);
    if (id === CID.S2_WORKERS_DEC)   return this.#settings.decrementWorkers(interaction);
    if (id === CID.S2_CACHE_CLEAR)   return this.#settings.clearCache(interaction);
    if (id === CID.S2_CACHE_REBUILD) return this.#settings.rebuildCache(interaction);
    if (id === CID.S2_DB_REBUILD)    return this.#settings.rebuildDatabase(interaction);
    if (id === CID.S2_STATS_RESET)   return this.#settings.resetStats(interaction);
    if (id === CID.S2_REFRESH)       return this.#settings.refresh(interaction);

    // ── BoomBox Manager panel buttons ─────────────────────────────────────
    if (this.#setupManager) {
      if (id === MCID.REFRESH)      return this.#setupManager.handleRefresh(interaction);
      if (id === MCID.WORKER_PAGE)  return this.#setupManager.handleWorkerPage(interaction);
      if (id === MCID.CLEAR_CACHE)  return this.#setupManager.handleClearCache(interaction);
      if (id === MCID.SAVE)         return this.#setupManager.handleSave(interaction);
      if (id === MCID.BACK)         return this.#setupManager.handleBack(interaction);

      // Worker sub-page buttons
      if (id === MCID.WORKER_MINUS) return this.#setupManager.handleWorkerMinus(interaction);
      if (id === MCID.WORKER_PLUS)  return this.#setupManager.handleWorkerPlus(interaction);
      if (id === MCID.WORKER_AUTO)  return this.#setupManager.handleWorkerAutoToggle(interaction);
      if (id === MCID.WORKER_LIMITS)return this.#setupManager.showWorkerLimitsModal(interaction);

      // Platform toggles
      if (id === MCID.YT_TOGGLE)    return this.#setupManager.handlePlatformToggle(interaction, 'yt');
      if (id === MCID.TK_TOGGLE)    return this.#setupManager.handlePlatformToggle(interaction, 'tk');
      if (id === MCID.SP_TOGGLE)    return this.#setupManager.handlePlatformToggle(interaction, 'sp');

      // Platform media settings modal launchers
      if (id === MCID.YT_MEDIA)     return this.#setupManager.showMediaModal(interaction, 'yt');
      if (id === MCID.TK_MEDIA)     return this.#setupManager.showMediaModal(interaction, 'tk');
      if (id === MCID.SP_MEDIA)     return this.#setupManager.showMediaModal(interaction, 'sp');

      // Platform save buttons: bb:mgr:plat:save:{p}
      if (id.startsWith('bb:mgr:plat:save:')) {
        const p = id.split(':')[4];
        return this.#setupManager.handlePlatformSave(interaction, p);
      }

      // Error/URLLogs save buttons
      if (id === 'bb:mgr:error:save')   return this.#setupManager.handleErrorSave(interaction);
      if (id === 'bb:mgr:urllogs:save') return this.#setupManager.handleUrlLogsSave(interaction);

      // Initial setup
      if (id === MCID.SETUP_SAVE)    return this.#setupManager.handleSetupSave(interaction);

      // Delete confirmation
      if (id === MCID.DEL_CONFIRM)   return this.#setupManager.handleDeleteConfirm(interaction);
      if (id === MCID.DEL_CANCEL)    return this.#setupManager.handleDeleteCancel(interaction);
    }

    // ── URL Logs panel buttons ────────────────────────────────────────────
    if (this.#urlLogsHandler) {
      if (id === MCID.URLLOGS_YT) return this.#urlLogsHandler.handlePlatformButton(interaction, 'yt');
      if (id === MCID.URLLOGS_TK) return this.#urlLogsHandler.handlePlatformButton(interaction, 'tk');
      if (id === MCID.URLLOGS_SP) return this.#urlLogsHandler.handlePlatformButton(interaction, 'sp');

      // Pagination: bb:urllogs:nav:{platCode}:{page}
      if (id.startsWith(`${MCID.URLLOGS_NAV}:`)) {
        const parts    = id.split(':');
        const platCode = parts[3]; // 'yt' | 'tk' | 'sp'
        const page     = parseInt(parts[4] ?? '0', 10) || 0;
        return this.#urlLogsHandler.handleNav(interaction, platCode, page);
      }
    }
  }

  // ─── String Select Router ─────────────────────────────────────────────────

  async #handleSelect(interaction, id) {
    // ── Settings perf select ───────────────────────────────────────────────
    if (id === CID.SETTINGS_PERF) return this.#settings.handlePerfSelect(interaction);
    if (id === CID.S2_PERF)       return this.#settings.handlePerfSelect(interaction);

    // ── List select-menu: bb:list:select-menu:{p}:{s}:{pg}:{f} ───────────
    if (id.startsWith('bb:list:select-menu:')) {
      const parts         = id.split(':');
      const [p, s, pg, f] = [parts[4], +parts[5], +parts[6], +parts[7]];
      const mediaId       = +interaction.values[0];
      return this.#archive.showPreview(interaction, mediaId, p, s, pg, f);
    }

    // ── Sort select: bb:sort:select:{p}:{pg}:{f} ──────────────────────────
    if (id.startsWith('bb:sort:select:')) {
      const parts      = id.split(':');
      const [p, pg, f] = [parts[3], +parts[4], +parts[5]];
      const newS       = +interaction.values[0];
      return this.#archive.navigate(interaction, p, newS, 0, f);
    }

    // ── Manager dropdown ──────────────────────────────────────────────────
    if (id === MCID.DROPDOWN && this.#setupManager) {
      return this.#setupManager.handleDropdown(interaction);
    }
  }

  // ─── Channel Select Router ────────────────────────────────────────────────

  async #handleChannelSelect(interaction, id) {
    if (!this.#setupManager) return;

    if (id === MCID.SETUP_CH)      return this.#setupManager.handleSetupChannelSelect(interaction);
    if (id === MCID.CH_YT)         return this.#setupManager.handlePlatformChannelSelect(interaction, 'yt');
    if (id === MCID.CH_TK)         return this.#setupManager.handlePlatformChannelSelect(interaction, 'tk');
    if (id === MCID.CH_SP)         return this.#setupManager.handlePlatformChannelSelect(interaction, 'sp');
    if (id === MCID.CH_ERRORS)     return this.#setupManager.handleErrorChannelSelect(interaction);
    if (id === MCID.CH_URLLOGS)    return this.#setupManager.handleUrlLogsChannelSelect(interaction);
  }

  // ─── Modal Router ─────────────────────────────────────────────────────────

  async #handleModal(interaction, id) {
    // Archive modals
    if (id.startsWith(`${CID.MODAL_SEARCH}:`)) {
      const parts         = id.split(':');
      const [p, s, pg, f] = [parts[3], +parts[4], +parts[5], +parts[6]];
      return this.#archive.handleSearchSubmit(interaction, p, s, pg, f);
    }

    if (id.startsWith(`${CID.MODAL_PAGE}:`)) {
      const parts         = id.split(':');
      const [p, s, pg, f] = [parts[3], +parts[4], +parts[5], +parts[6]];
      return this.#archive.handlePageSubmit(interaction, p, s, pg, f);
    }

    // Manager media settings modals
    if (this.#setupManager) {
      if (id === MCID.MODAL_YT_MEDIA)      return this.#setupManager.handleMediaModalSubmit(interaction, 'yt');
      if (id === MCID.MODAL_TK_MEDIA)      return this.#setupManager.handleMediaModalSubmit(interaction, 'tk');
      if (id === MCID.MODAL_SP_MEDIA)      return this.#setupManager.handleMediaModalSubmit(interaction, 'sp');
      if (id === MCID.MODAL_WORKER_LIMITS) return this.#setupManager.handleWorkerLimitsSubmit(interaction);
    }
  }

  // ─── Success Embed Buttons ────────────────────────────────────────────────

  async #handleSuccessButton(interaction, action, mediaId) {
    if (action === 'copy') {
      const media = this.#db.getMediaById(mediaId);
      const url   = media?.boombox_url ?? 'URL tidak tersedia.';
      return interaction.reply({
        content: `**BoomBox URL:**\n${url.slice(0, 1900)}`,
        flags:   MessageFlags.Ephemeral,
      });
    }

    if (action === 'preview') {
      const media = this.#db.getMediaById(mediaId);
      if (!media) {
        return interaction.reply({ content: '❌ URL tidak ditemukan di database.', flags: MessageFlags.Ephemeral });
      }
      const isFav = this.#db.isFavorite(interaction.user.id, mediaId);
      return interaction.reply({
        embeds:     [previewEmbed(media, isFav)],
        components: previewActionRow(mediaId, isFav, 'a', 0, 0, 0),
        flags:      MessageFlags.Ephemeral,
      });
    }
  }

  // ─── Error helper ─────────────────────────────────────────────────────────

  async #safeError(interaction, message) {
    const payload = { content: `❌ ${message.slice(0, 500)}`, flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch { /* expired / already handled */ }
  }
}
