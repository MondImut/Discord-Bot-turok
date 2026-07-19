/**
 * SetupManager — Handles /setupboombox, /delsetupboombox, and the
 * BoomBox Manager panel (monitoring + all setup sub-pages).
 *
 * Setup flow:
 *   /setupboombox → if already configured: ephemeral "sudah terkonfigurasi"
 *                   else: ephemeral with ChannelSelectMenu → Simpan → panel created
 *
 * /delsetupboombox → ephemeral confirm → delete panel messages + config (keep archive)
 *
 * Manager panel state machine (per guild, in-memory):
 *   'main'         — default monitoring view
 *   'yt_setup'     — YouTube setup page
 *   'tk_setup'     — TikTok setup page
 *   'sp_setup'     — Spotify setup page
 *   'error_setup'  — Error Logs channel page
 *   'urllogs_setup'— URL Logs channel page
 *   'worker_setup' — Worker settings page
 */

import {
  MessageFlags, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { MCID, PERFORMANCE_MODES, PLATFORM_META } from '../constants.js';
import {
  managerEmbed, managerSetupPageEmbed, managerWorkerPageEmbed,
  urlLogsPanelEmbed,
} from '../ui/Embeds.js';
import {
  managerMainRows, managerPlatformPageRows,
  managerChannelPageRows, managerWorkerPageRows,
  urlLogsPanelRows,
} from '../ui/Components.js';

// ─── Temporary state ──────────────────────────────────────────────────────────
// Maps guildId → { page, selectedChannelId }
const _state   = new Map();
// Maps guildId → selected channel during initial setup
const _initCh  = new Map();

export class SetupManager {
  #db;
  #cache;
  #workerPool;
  #panelManager;    // optional — for refreshing manager panel
  #urlLogsHandler;  // optional — set after construction
  #logger;

  /** Map<guildId, { managerMsg, urlLogsMsg }> */
  #panels = new Map();

  constructor(db, cache, workerPool, panelManager, logger) {
    this.#db          = db;
    this.#cache       = cache;
    this.#workerPool  = workerPool;
    this.#panelManager = panelManager;
    this.#logger      = logger;
  }

  setUrlLogsHandler(handler) { this.#urlLogsHandler = handler; }

  // ─── Slash: /setupboombox ─────────────────────────────────────────────────

  async handleSetupCommand(interaction) {
    if (!this.#isOwner(interaction)) {
      return interaction.reply({
        content: '❌ Hanya pemilik server yang dapat menjalankan perintah ini.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const existing = this.#db.getConfig(interaction.guildId);
    if (existing) {
      return interaction.reply({
        embeds: [{
          color: 0x5865F2,
          title: '⚙️ BoomBox Sudah Dikonfigurasi',
          description:
            'BoomBox sudah dikonfigurasi di server ini.\n\n' +
            'Jika ingin membuat setup baru, hapus konfigurasi terlebih dahulu menggunakan `/delsetupboombox`.',
          footer: { text: 'Powered by Pangeran Assistant' },
        }],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Not configured — show channel select
    const row1 = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(MCID.SETUP_CH)
        .setPlaceholder('Pilih channel untuk BoomBox Monitoring…')
        .addChannelTypes(ChannelType.GuildText)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(MCID.SETUP_SAVE)
        .setLabel('💾 Simpan')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await interaction.reply({
      embeds: [{
        color: 0x5865F2,
        title: '⚙️ Setup BoomBox Manager',
        description:
          'Silakan pilih channel yang akan dijadikan **BoomBox Monitoring**.\n\n' +
          'Panel BoomBox Manager akan dikirim ke channel tersebut.',
        footer: { text: 'Powered by Pangeran Assistant' },
      }],
      components: [row1, row2],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Initial setup: channel select ────────────────────────────────────────

  async handleSetupChannelSelect(interaction) {
    const channelId = interaction.values[0];
    _initCh.set(interaction.guildId, channelId);

    const row1 = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(MCID.SETUP_CH)
        .setPlaceholder(`#${interaction.guild.channels.cache.get(channelId)?.name ?? channelId}`)
        .addChannelTypes(ChannelType.GuildText)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(MCID.SETUP_SAVE)
        .setLabel('💾 Simpan')
        .setStyle(ButtonStyle.Success),
    );

    await interaction.update({
      embeds: [{
        color: 0x5865F2,
        title: '⚙️ Setup BoomBox Manager',
        description:
          `Channel dipilih: <#${channelId}>\n\nKlik **Simpan** untuk membuat panel BoomBox Monitoring di channel tersebut.`,
        footer: { text: 'Powered by Pangeran Assistant' },
      }],
      components: [row1, row2],
    });
  }

  // ─── Initial setup: Simpan ────────────────────────────────────────────────

  async handleSetupSave(interaction) {
    const channelId = _initCh.get(interaction.guildId);
    if (!channelId) {
      return interaction.update({
        content: '❌ Pilih channel terlebih dahulu.',
        components: [],
        embeds: [],
      });
    }
    _initCh.delete(interaction.guildId);

    await interaction.deferUpdate();

    try {
      const channel = await interaction.guild.channels.fetch(channelId);
      if (!channel) throw new Error('Channel tidak ditemukan.');

      // Create config in DB
      this.#db.upsertConfig(interaction.guildId, {
        chMonitor: channelId,
      });

      // Send the Manager panel
      const config = this.#db.getConfig(interaction.guildId);
      const stats  = this.#db.getStats(interaction.guildId);
      const counts = this.#db.countByPlatform(interaction.guildId);
      const workerStatus = {
        activeWorkers: this.#workerPool?.activeCount ?? 0,
        queueSize:     this.#workerPool?.queueSize   ?? 0,
        cacheSize:     this.#cache?.size ?? 0,
      };
      const msg = await channel.send({
        embeds:     [managerEmbed(stats, counts, workerStatus, config, null)],
        components: managerMainRows(),
      });

      this.#db.setManagerMsgId(interaction.guildId, msg.id);
      this.#panels.set(interaction.guildId, { guild: interaction.guild, managerMsg: msg, urlLogsMsg: null });

      await interaction.editReply({
        embeds: [{
          color: 0x57F287,
          title: '✅ BoomBox Manager Berhasil Dibuat',
          description:
            `Panel BoomBox Manager telah dibuat di <#${channelId}>.\n\n` +
            'Gunakan dropdown **Setup BoomBox** pada panel untuk mengkonfigurasi channel YouTube, TikTok, Spotify, Error Logs, dan URL Logs.',
          footer: { text: 'Powered by Pangeran Assistant' },
        }],
        components: [],
      });
    } catch (err) {
      this.#logger.error(`Setup failed: ${err.message}`, 'SetupManager');
      await interaction.editReply({
        content: `❌ Setup gagal: ${err.message.slice(0, 200)}`,
        components: [],
        embeds: [],
      });
    }
  }

  // ─── Slash: /delsetupboombox ──────────────────────────────────────────────

  async handleDeleteCommand(interaction) {
    if (!this.#isOwner(interaction)) {
      return interaction.reply({
        content: '❌ Hanya pemilik server yang dapat menjalankan perintah ini.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const config = this.#db.getConfig(interaction.guildId);
    if (!config) {
      return interaction.reply({
        content: '❌ BoomBox belum dikonfigurasi di server ini.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(MCID.DEL_CONFIRM)
        .setLabel('✅ Ya, Hapus Konfigurasi')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(MCID.DEL_CANCEL)
        .setLabel('❌ Batal')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [{
        color: 0xED4245,
        title: '⚠️ Konfirmasi Hapus BoomBox',
        description:
          '**Yang akan dihapus:**\n' +
          '• Panel Monitoring (BoomBox Manager)\n' +
          '• Panel URL Logs\n' +
          '• Seluruh konfigurasi BoomBox (channel, pengaturan)\n\n' +
          '**TIDAK dihapus:**\n' +
          '• Database URL BoomBox (arsip tetap ada)\n' +
          '• Premium, Worker, Queue, Cache\n\n' +
          'Setelah dihapus, arsip URL tetap dapat diakses setelah setup ulang.',
        footer: { text: 'Powered by Pangeran Assistant' },
      }],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  async handleDeleteConfirm(interaction) {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    const config  = this.#db.getConfig(guildId);
    if (!config) {
      return interaction.editReply({ content: '❌ Konfigurasi tidak ditemukan.', components: [], embeds: [] });
    }

    // Delete panel messages
    const panelEntry = this.#panels.get(guildId);
    const toDelete = [
      { chId: config.ch_monitor,  msgId: config.manager_msg_id },
      { chId: config.ch_url_logs, msgId: config.url_logs_msg_id },
      { chId: config.ch_monitor,  msgId: config.monitor_msg_id },
      { chId: config.ch_logs,     msgId: config.archive_msg_id },
      { chId: config.ch_settings, msgId: config.settings_msg_id },
      { chId: config.ch_logs,     msgId: config.logs_msg_id },
    ];

    for (const { chId, msgId } of toDelete) {
      if (!chId || !msgId) continue;
      try {
        const ch  = await interaction.guild.channels.fetch(chId).catch(() => null);
        const msg = ch ? await ch.messages.fetch(msgId).catch(() => null) : null;
        if (msg?.deletable) await msg.delete();
      } catch (_) {}
    }

    // Remove from memory
    this.#panels.delete(guildId);
    _state.delete(guildId);

    // Delete config (preserve media/stats)
    this.#db.deleteGuildConfig(guildId);

    this.#logger.info(`[${guildId}] BoomBox config deleted by owner.`, 'SetupManager');

    await interaction.editReply({
      embeds: [{
        color: 0x57F287,
        title: '✅ Konfigurasi BoomBox Dihapus',
        description:
          'Semua panel dan konfigurasi telah dihapus.\n\n' +
          'Arsip URL tetap tersimpan. Jalankan `/setupboombox` untuk setup ulang.',
        footer: { text: 'Powered by Pangeran Assistant' },
      }],
      components: [],
    });
  }

  async handleDeleteCancel(interaction) {
    await interaction.update({
      embeds: [{
        color: 0x5865F2,
        title: '↩️ Dibatalkan',
        description: 'Penghapusan konfigurasi BoomBox dibatalkan.',
        footer: { text: 'Powered by Pangeran Assistant' },
      }],
      components: [],
    });
  }

  // ─── Manager Panel: Refresh ───────────────────────────────────────────────

  async handleRefresh(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    _state.set(interaction.guildId, 'main');
    await this.#updateManagerPanel(interaction.guildId, interaction);
  }

  // ─── Manager Panel: Worker page ───────────────────────────────────────────

  async handleWorkerPage(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    _state.set(interaction.guildId, 'worker_setup');

    const pm = PERFORMANCE_MODES[config.perf_mode] ?? PERFORMANCE_MODES.balanced;
    const workerCount = config.worker_count ?? pm.workers ?? 3;

    await interaction.update({
      embeds:     [managerWorkerPageEmbed(config, this.#workerPool)],
      components: managerWorkerPageRows(workerCount, config),
    });
  }

  // ─── Manager Panel: Clear Cache ───────────────────────────────────────────

  async handleClearCache(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const { rows } = this.#db.listMedia(interaction.guildId, { limit: 9999 });
    let cleared = 0;
    for (const row of rows) {
      this.#cache.invalidate(interaction.guildId, row.platform, row.video_id);
      cleared++;
    }
    this.#logger.info(`[${interaction.guildId}] Cache cleared: ${cleared} entries`, 'SetupManager');

    await interaction.reply({
      content: `✅ Cache berhasil dihapus — **${cleared}** entri dihapus dari memori.`,
      flags: MessageFlags.Ephemeral,
    });

    // Refresh manager panel in background
    this.#refreshManagerPanelSilent(interaction.guildId);
  }

  // ─── Manager Panel: Save (global save / refresh) ──────────────────────────

  async handleSave(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    _state.set(interaction.guildId, 'main');
    await this.#updateManagerPanel(interaction.guildId, interaction);
  }

  // ─── Manager Panel: Back ──────────────────────────────────────────────────

  async handleBack(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    _state.set(interaction.guildId, 'main');
    await this.#updateManagerPanel(interaction.guildId, interaction);
  }

  // ─── Manager Panel: Dropdown ──────────────────────────────────────────────

  async handleDropdown(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const value = interaction.values[0];
    _state.set(interaction.guildId, value);

    switch (value) {
      case 'yt_setup': return this.#showPlatformPage(interaction, config, 'yt');
      case 'tk_setup': return this.#showPlatformPage(interaction, config, 'tk');
      case 'sp_setup': return this.#showPlatformPage(interaction, config, 'sp');
      case 'error_setup':   return this.#showChannelPage(interaction, config, 'error');
      case 'urllogs_setup': return this.#showChannelPage(interaction, config, 'urllogs');
      default: return this.#updateManagerPanel(interaction.guildId, interaction);
    }
  }

  // ─── Platform channel selects ─────────────────────────────────────────────

  async handlePlatformChannelSelect(interaction, platformCode) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const channelId = interaction.values[0];
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    this.#db.updatePlatformSettings(interaction.guildId, platformCode, { channel: channelId });
    const updated = this.#db.getConfig(interaction.guildId);
    await interaction.update({
      embeds:     [managerSetupPageEmbed(updated, platformCode)],
      components: managerPlatformPageRows(updated, platformCode),
    });
  }

  async handleErrorChannelSelect(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const channelId = interaction.values[0];
    this.#db.setErrorsChannel(interaction.guildId, channelId);
    const config = this.#db.getConfig(interaction.guildId);

    await interaction.update({
      embeds:     [managerSetupPageEmbed(config, 'error')],
      components: managerChannelPageRows('error'),
    });
  }

  async handleUrlLogsChannelSelect(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const channelId = interaction.values[0];
    this.#db.setUrlLogsChannel(interaction.guildId, channelId);
    const config = this.#db.getConfig(interaction.guildId);

    await interaction.update({
      embeds:     [managerSetupPageEmbed(config, 'urllogs')],
      components: managerChannelPageRows('urllogs'),
    });
  }

  // ─── Platform toggles ─────────────────────────────────────────────────────

  async handlePlatformToggle(interaction, platformCode) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const col     = `${platformCode}_enabled`;
    const current = config[col] ?? 1;
    this.#db.updatePlatformSettings(interaction.guildId, platformCode, { enabled: !current });
    const updated = this.#db.getConfig(interaction.guildId);

    await interaction.update({
      embeds:     [managerSetupPageEmbed(updated, platformCode)],
      components: managerPlatformPageRows(updated, platformCode),
    });
  }

  // ─── Platform media settings modal ───────────────────────────────────────

  async showMediaModal(interaction, platformCode) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const pm    = PLATFORM_META[{ yt: 'youtube', tk: 'tiktok', sp: 'spotify' }[platformCode]];
    const label = pm?.label ?? platformCode.toUpperCase();

    const modalId = { yt: MCID.MODAL_YT_MEDIA, tk: MCID.MODAL_TK_MEDIA, sp: MCID.MODAL_SP_MEDIA }[platformCode];

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(`🎬 Media Settings — ${label}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('gif_processing')
            .setLabel('GIF Processing URL (opsional)')
            .setStyle(TextInputStyle.Short)
            .setValue(config[`${platformCode}_gif_processing`] ?? '')
            .setRequired(false)
            .setPlaceholder('https://cdn.example.com/loading.gif')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('gif_success')
            .setLabel('GIF Success URL (opsional)')
            .setStyle(TextInputStyle.Short)
            .setValue(config[`${platformCode}_gif_success`] ?? '')
            .setRequired(false)
            .setPlaceholder('https://cdn.example.com/success.gif')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('max_duration')
            .setLabel('Durasi Maksimum (detik, 0 = tidak ada batas)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config[`${platformCode}_max_duration`] ?? 0))
            .setRequired(false)
            .setPlaceholder('0')
        ),
      );

    await interaction.showModal(modal);
  }

  async handleMediaModalSubmit(interaction, platformCode) {
    const gifProcessing = interaction.fields.getTextInputValue('gif_processing').trim() || null;
    const gifSuccess    = interaction.fields.getTextInputValue('gif_success').trim()    || null;
    const maxDur        = parseInt(interaction.fields.getTextInputValue('max_duration') || '0', 10) || 0;

    this.#db.updatePlatformSettings(interaction.guildId, platformCode, {
      gifProcessing, gifSuccess, maxDuration: maxDur,
    });
    const updated = this.#db.getConfig(interaction.guildId);

    await interaction.reply({
      content: '✅ Pengaturan media berhasil disimpan.',
      flags: MessageFlags.Ephemeral,
    });

    // Refresh the manager panel page
    this.#refreshManagerPageSilent(interaction.guildId, platformCode);
  }

  // ─── Platform page Save button ────────────────────────────────────────────

  async handlePlatformSave(interaction, platformCode) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    // Validate: platform channel must be set
    const chCol = { yt: 'ch_youtube', tk: 'ch_tiktok', sp: 'ch_spotify' }[platformCode];
    if (chCol && !config[chCol]) {
      return interaction.reply({
        content: '❌ Pilih channel terlebih dahulu sebelum menyimpan.',
        flags: MessageFlags.Ephemeral,
      });
    }

    _state.set(interaction.guildId, 'main');
    await this.#updateManagerPanel(interaction.guildId, interaction);
  }

  // ─── Error Logs page Save ─────────────────────────────────────────────────

  async handleErrorSave(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    if (!config.ch_errors) {
      return interaction.reply({
        content: '❌ Pilih channel Error Logs terlebih dahulu.',
        flags: MessageFlags.Ephemeral,
      });
    }

    _state.set(interaction.guildId, 'main');
    await this.#updateManagerPanel(interaction.guildId, interaction);
  }

  // ─── URL Logs page Save ───────────────────────────────────────────────────

  async handleUrlLogsSave(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    if (!config.ch_url_logs) {
      return interaction.reply({
        content: '❌ Pilih channel URL Logs terlebih dahulu.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Create or restore URL Logs panel in the selected channel
    await this.#ensureUrlLogsPanel(interaction.guildId, interaction.guild);

    _state.set(interaction.guildId, 'main');
    await this.#updateManagerPanel(interaction.guildId, interaction);
  }

  // ─── Worker page: +/- worker ──────────────────────────────────────────────

  async handleWorkerMinus(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const pm    = PERFORMANCE_MODES[config.perf_mode] ?? PERFORMANCE_MODES.balanced;
    const cur   = config.worker_count ?? pm.workers ?? 3;
    const newW  = Math.max(1, cur - 1);
    this.#db.updateWorkerSettings(interaction.guildId, { workerCount: newW });
    this.#workerPool?.updateConfig({ workers: newW });

    const updated = this.#db.getConfig(interaction.guildId);
    await interaction.update({
      embeds:     [managerWorkerPageEmbed(updated, this.#workerPool)],
      components: managerWorkerPageRows(newW, updated),
    });
  }

  async handleWorkerPlus(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const pm    = PERFORMANCE_MODES[config.perf_mode] ?? PERFORMANCE_MODES.balanced;
    const cur   = config.worker_count ?? pm.workers ?? 3;
    const newW  = Math.min(10, cur + 1);
    this.#db.updateWorkerSettings(interaction.guildId, { workerCount: newW });
    this.#workerPool?.updateConfig({ workers: newW });

    const updated = this.#db.getConfig(interaction.guildId);
    await interaction.update({
      embeds:     [managerWorkerPageEmbed(updated, this.#workerPool)],
      components: managerWorkerPageRows(newW, updated),
    });
  }

  async handleWorkerAutoToggle(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const newAuto = !(config.worker_auto_mode ?? false);
    this.#db.updateWorkerSettings(interaction.guildId, { autoMode: newAuto });
    const updated = this.#db.getConfig(interaction.guildId);
    const wc = updated.worker_count ?? 3;

    await interaction.update({
      embeds:     [managerWorkerPageEmbed(updated, this.#workerPool)],
      components: managerWorkerPageRows(wc, updated),
    });
  }

  // ─── Worker: Limits modal ─────────────────────────────────────────────────

  async showWorkerLimitsModal(interaction) {
    if (!this.#isOwner(interaction)) return this.#replyNoPermission(interaction);
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#replyNoConfig(interaction);

    const modal = new ModalBuilder()
      .setCustomId(MCID.MODAL_WORKER_LIMITS)
      .setTitle('⚙️ Worker Limits')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('queue_limit')
            .setLabel('Queue Limit (maks job dalam antrian)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.queue_limit ?? 50))
            .setRequired(true)
            .setPlaceholder('50')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('cache_limit')
            .setLabel('Cache Limit (maks entri cache)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.cache_limit ?? 2000))
            .setRequired(true)
            .setPlaceholder('2000')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('auto_restart')
            .setLabel('Auto Restart Worker (1 = aktif, 0 = nonaktif)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(config.auto_restart_worker ?? 1))
            .setRequired(true)
            .setPlaceholder('1')
        ),
      );

    await interaction.showModal(modal);
  }

  async handleWorkerLimitsSubmit(interaction) {
    const queueLimit  = Math.max(1,  parseInt(interaction.fields.getTextInputValue('queue_limit')  || '50',   10) || 50);
    const cacheLimit  = Math.max(100, parseInt(interaction.fields.getTextInputValue('cache_limit') || '2000', 10) || 2000);
    const autoRestart = interaction.fields.getTextInputValue('auto_restart').trim() !== '0';

    this.#db.updateWorkerSettings(interaction.guildId, { queueLimit, cacheLimit, autoRestart });
    const updated = this.#db.getConfig(interaction.guildId);
    const wc = updated.worker_count ?? 3;

    await interaction.reply({
      content: `✅ Limits disimpan — Queue: **${queueLimit}**, Cache: **${cacheLimit}**, Auto Restart: **${autoRestart ? 'Aktif' : 'Nonaktif'}**.`,
      flags: MessageFlags.Ephemeral,
    });

    this.#refreshManagerPageSilent(interaction.guildId, 'worker_setup');
  }

  // ─── Panel recovery on bot ready ─────────────────────────────────────────

  async initGuild(guild, config) {
    const guildId = guild.id;

    // Restore manager panel
    let managerMsg = null;
    if (config.ch_monitor && config.manager_msg_id) {
      try {
        const ch  = await guild.channels.fetch(config.ch_monitor).catch(() => null);
        managerMsg = ch ? await ch.messages.fetch(config.manager_msg_id).catch(() => null) : null;
      } catch (_) {}
    }
    if (!managerMsg && config.ch_monitor) {
      managerMsg = await this.#createManagerPanel(guild, config);
    }

    // Restore URL logs panel
    let urlLogsMsg = null;
    if (config.ch_url_logs && config.url_logs_msg_id) {
      try {
        const ch  = await guild.channels.fetch(config.ch_url_logs).catch(() => null);
        urlLogsMsg = ch ? await ch.messages.fetch(config.url_logs_msg_id).catch(() => null) : null;
      } catch (_) {}
    }
    if (!urlLogsMsg && config.ch_url_logs) {
      urlLogsMsg = await this.#createUrlLogsPanel(guild, config);
    }

    this.#panels.set(guildId, { guild, managerMsg, urlLogsMsg });

    // Initial update
    await this.updateManagerPanel(guildId).catch(() => {});
    this.#logger.info(`Manager panels ready for guild: ${guild.name}`, 'SetupManager');
  }

  // ─── Public update methods (called after conversion) ─────────────────────

  async updateManagerPanel(guildId) {
    const entry = this.#panels.get(guildId);
    if (!entry?.managerMsg) return;

    const config = this.#db.getConfig(guildId);
    if (!config) return;

    const page  = _state.get(guildId) ?? 'main';
    if (page !== 'main') return; // Don't override setup sub-pages during refresh

    const stats  = this.#db.getStats(guildId);
    const counts = this.#db.countByPlatform(guildId);
    const workerStatus = {
      activeWorkers: this.#workerPool?.activeCount ?? 0,
      queueSize:     this.#workerPool?.queueSize   ?? 0,
      cacheSize:     this.#cache?.size ?? 0,
    };

    try {
      await entry.managerMsg.edit({
        embeds:     [managerEmbed(stats, counts, workerStatus, config, null)],
        components: managerMainRows(),
      });
    } catch (err) {
      this.#logger.warn(`Manager panel update failed (${guildId}): ${err.message}`, 'SetupManager');
      // Recreate on next tick
      if (entry) entry.managerMsg = null;
    }
  }

  getUrlLogsMsg(guildId) {
    return this.#panels.get(guildId)?.urlLogsMsg ?? null;
  }

  setUrlLogsMsg(guildId, msg) {
    const entry = this.#panels.get(guildId);
    if (entry) entry.urlLogsMsg = msg;
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  async #updateManagerPanel(guildId, interaction) {
    const config = this.#db.getConfig(guildId);
    const stats  = this.#db.getStats(guildId);
    const counts = this.#db.countByPlatform(guildId);
    const workerStatus = {
      activeWorkers: this.#workerPool?.activeCount ?? 0,
      queueSize:     this.#workerPool?.queueSize   ?? 0,
      cacheSize:     this.#cache?.size ?? 0,
    };

    await interaction.update({
      embeds:     [managerEmbed(stats, counts, workerStatus, config, null)],
      components: managerMainRows(),
    });

    // Sync stored message reference
    const entry = this.#panels.get(guildId);
    if (entry && interaction.message) entry.managerMsg = interaction.message;
  }

  async #showPlatformPage(interaction, config, platformCode) {
    await interaction.update({
      embeds:     [managerSetupPageEmbed(config, platformCode)],
      components: managerPlatformPageRows(config, platformCode),
    });
  }

  async #showChannelPage(interaction, config, type) {
    await interaction.update({
      embeds:     [managerSetupPageEmbed(config, type)],
      components: managerChannelPageRows(type),
    });
  }

  async #ensureUrlLogsPanel(guildId, guild) {
    const config = this.#db.getConfig(guildId);
    if (!config?.ch_url_logs) return;

    const entry = this.#panels.get(guildId);

    // Check if existing URL logs panel message is still alive
    if (entry?.urlLogsMsg) {
      try {
        await entry.urlLogsMsg.fetch();
        return; // still alive
      } catch (_) {
        if (entry) entry.urlLogsMsg = null;
      }
    }

    const msg = await this.#createUrlLogsPanel(guild, config);
    if (msg) {
      this.#db.setUrlLogsMsgId(guildId, msg.id);
      if (entry) entry.urlLogsMsg = msg;
      else this.#panels.set(guildId, { guild, managerMsg: null, urlLogsMsg: msg });
    }
  }

  async #createManagerPanel(guild, config) {
    if (!config.ch_monitor) return null;
    try {
      const ch     = await guild.channels.fetch(config.ch_monitor);
      const stats  = this.#db.getStats(guild.id);
      const counts = this.#db.countByPlatform(guild.id);
      const ws     = { activeWorkers: 0, queueSize: 0, cacheSize: 0 };
      const msg = await ch.send({
        embeds:     [managerEmbed(stats, counts, ws, config, null)],
        components: managerMainRows(),
      });
      this.#db.setManagerMsgId(guild.id, msg.id);
      return msg;
    } catch (err) {
      this.#logger.error(`Cannot create manager panel for ${guild.id}: ${err.message}`, 'SetupManager');
      return null;
    }
  }

  async #createUrlLogsPanel(guild, config) {
    if (!config.ch_url_logs) return null;
    try {
      const ch  = await guild.channels.fetch(config.ch_url_logs);
      const msg = await ch.send({
        embeds:     [urlLogsPanelEmbed()],
        components: urlLogsPanelRows(),
      });
      this.#db.setUrlLogsMsgId(guild.id, msg.id);
      return msg;
    } catch (err) {
      this.#logger.error(`Cannot create URL logs panel for ${guild.id}: ${err.message}`, 'SetupManager');
      return null;
    }
  }

  #refreshManagerPanelSilent(guildId) {
    this.updateManagerPanel(guildId).catch(() => {});
  }

  #refreshManagerPageSilent(guildId, pageKey) {
    // Only refresh page visuals if still on that page
    const page = _state.get(guildId);
    if (page !== `${pageKey}_setup` && page !== pageKey) return;
    const entry  = this.#panels.get(guildId);
    if (!entry?.managerMsg) return;
    const config = this.#db.getConfig(guildId);
    if (!config) return;

    // Worker page uses its own embed/components; platform pages use the platform renderer.
    if (pageKey === 'worker_setup') {
      const wc = config.worker_count ?? 3;
      entry.managerMsg.edit({
        embeds:     [managerWorkerPageEmbed(config, this.#workerPool)],
        components: managerWorkerPageRows(wc, config),
      }).catch(() => {});
    } else {
      entry.managerMsg.edit({
        embeds:     [managerSetupPageEmbed(config, pageKey)],
        components: managerPlatformPageRows(config, pageKey),
      }).catch(() => {});
    }
  }

  #isOwner(interaction) {
    return interaction.guild?.ownerId === interaction.user.id ||
           interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  }

  async #replyNoPermission(interaction) {
    const payload = { content: '❌ Hanya admin/pemilik server yang dapat menggunakan kontrol ini.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (_) {}
  }

  async #replyNoConfig(interaction) {
    const payload = { content: '❌ BoomBox belum dikonfigurasi. Jalankan `/setupboombox`.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (_) {}
  }
}
