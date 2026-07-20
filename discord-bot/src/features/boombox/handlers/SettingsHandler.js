/**
 * SettingsHandler — Handles interactions from the BoomBox Settings Panel.
 *
 * v1.4 — Comprehensive BoomBox Settings panel.
 * Manages:
 *  - General:     Auto Delete, Reply Mode
 *  - Performance: Mode select, Worker count (+/-)
 *  - Cache:       Clear, Rebuild from DB
 *  - Maintenance: Rebuild Database (VACUUM + WAL checkpoint), Reset Stats
 *  - Utility:     Refresh panel display
 *
 * BoomBox Logs (Archive, Search, Favorite, Stats) remain in ArchiveHandler.
 * Settings and Logs are intentionally kept separate.
 */

import { MessageFlags } from 'discord.js';
import { PERFORMANCE_MODES } from '../constants.js';
import { settingsEmbed } from '../ui/Embeds.js';
import { settingsRows } from '../ui/Components.js';

export class SettingsHandler {
  #db;
  #cache;
  #workerPool;
  #panelManager;
  #logger;

  constructor(db, cache, workerPool, panelManager, logger) {
    this.#db           = db;
    this.#cache        = cache;
    this.#workerPool   = workerPool;
    this.#panelManager = panelManager;
    this.#logger       = logger;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Build the extras payload for settingsEmbed. */
  #extras() {
    return {
      activeWorkers: this.#workerPool?.activeCount ?? 0,
      queueSize:     this.#workerPool?.queueSize   ?? 0,
      cacheSize:     this.#cache?.size             ?? 0,
      retryCount:    this.#workerPool?.retryCount  ?? 0,
    };
  }

  /** Update the Settings panel message in-place. */
  async #refreshPanel(guildId) {
    try {
      await this.#panelManager?.updateSettingsPanel(guildId);
    } catch (e) {
      this.#logger.warn(`Settings panel refresh failed: ${e.message}`, 'SettingsHandler');
    }
  }

  // ─── Toggle Auto Delete ───────────────────────────────────────────────────

  async toggleAutoDelete(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    const newVal = !config.delete_msgs;
    this.#db.upsertConfig(interaction.guildId, { deleteMsgs: newVal });
    const updated = this.#db.getConfig(interaction.guildId);

    await interaction.update({
      embeds:     [settingsEmbed(updated, this.#extras())],
      components: settingsRows(updated),
    });
    this.#logger.info(`[${interaction.guildId}] Auto Delete → ${newVal}`, 'SettingsHandler');
  }

  // ─── Toggle Reply Mode ────────────────────────────────────────────────────

  async toggleReplyMode(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    const newMode = (config.reply_mode ?? 'reply') === 'reply' ? 'standalone' : 'reply';
    this.#db.upsertConfig(interaction.guildId, { replyMode: newMode });
    const updated = this.#db.getConfig(interaction.guildId);

    await interaction.update({
      embeds:     [settingsEmbed(updated, this.#extras())],
      components: settingsRows(updated),
    });
    this.#logger.info(`[${interaction.guildId}] Reply Mode → ${newMode}`, 'SettingsHandler');
  }

  // ─── Performance Mode Select ──────────────────────────────────────────────

  async handlePerfSelect(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    const selectedMode = interaction.values[0];
    const pm = PERFORMANCE_MODES[selectedMode] ?? PERFORMANCE_MODES.balanced;

    this.#db.upsertConfig(interaction.guildId, {
      perfMode:    selectedMode,
      workerCount: pm.workers,
      timeoutMs:   pm.timeout,
      retries:     Math.max(3, pm.retries),  // enforce min 3
    });
    this.#workerPool.updateConfig({
      workers: pm.workers,
      timeout: pm.timeout,
      retries: Math.max(3, pm.retries),
    });

    const updated = this.#db.getConfig(interaction.guildId);
    await interaction.update({
      embeds:     [settingsEmbed(updated, this.#extras())],
      components: settingsRows(updated),
    });
    this.#logger.info(`[${interaction.guildId}] Perf Mode → ${selectedMode}`, 'SettingsHandler');
  }

  // ─── Worker Count: +1 ────────────────────────────────────────────────────

  async incrementWorkers(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    const pm         = PERFORMANCE_MODES[config.perf_mode] ?? PERFORMANCE_MODES.balanced;
    const current    = config.worker_count ?? pm.workers ?? 3;
    const newCount   = Math.min(current + 1, 10);

    this.#db.upsertConfig(interaction.guildId, { workerCount: newCount, perfMode: 'custom' });
    this.#workerPool.updateConfig({ workers: newCount });

    const updated = this.#db.getConfig(interaction.guildId);
    await interaction.update({
      embeds:     [settingsEmbed(updated, this.#extras())],
      components: settingsRows(updated),
    });
    this.#logger.info(`[${interaction.guildId}] Workers → ${newCount}`, 'SettingsHandler');
  }

  // ─── Worker Count: -1 ────────────────────────────────────────────────────

  async decrementWorkers(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    const pm       = PERFORMANCE_MODES[config.perf_mode] ?? PERFORMANCE_MODES.balanced;
    const current  = config.worker_count ?? pm.workers ?? 3;
    const newCount = Math.max(current - 1, 1);

    this.#db.upsertConfig(interaction.guildId, { workerCount: newCount, perfMode: 'custom' });
    this.#workerPool.updateConfig({ workers: newCount });

    const updated = this.#db.getConfig(interaction.guildId);
    await interaction.update({
      embeds:     [settingsEmbed(updated, this.#extras())],
      components: settingsRows(updated),
    });
    this.#logger.info(`[${interaction.guildId}] Workers → ${newCount}`, 'SettingsHandler');
  }

  // ─── Clear Cache ──────────────────────────────────────────────────────────

  async clearCache(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    const { rows } = this.#db.listMedia(interaction.guildId, { limit: 9999 });
    let cleared = 0;
    for (const row of rows) {
      this.#cache.invalidate(interaction.guildId, row.platform, row.video_id);
      cleared++;
    }

    this.#logger.info(`[${interaction.guildId}] Cache cleared: ${cleared} entries`, 'SettingsHandler');

    const updated = this.#db.getConfig(interaction.guildId);

    // Refresh panel in-place, then acknowledge
    try {
      await interaction.update({
        embeds:     [settingsEmbed(updated, this.#extras())],
        components: settingsRows(updated),
      });
    } catch {
      await interaction.reply({
        content: `✅ Cache berhasil dihapus. **${cleared}** entri dihapus dari memori.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ─── Rebuild Cache from DB ────────────────────────────────────────────────

  async rebuildCache(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    // Invalidate all first, then preload from DB
    const { rows } = this.#db.listMedia(interaction.guildId, { limit: 9999 });
    for (const row of rows) {
      this.#cache.invalidate(interaction.guildId, row.platform, row.video_id);
    }

    const loaded = this.#cache.preload(this.#db, interaction.guildId);
    this.#logger.info(`[${interaction.guildId}] Cache rebuilt: ${loaded} entries preloaded`, 'SettingsHandler');

    const updated = this.#db.getConfig(interaction.guildId);
    try {
      await interaction.update({
        embeds:     [settingsEmbed(updated, this.#extras())],
        components: settingsRows(updated),
      });
    } catch {
      await interaction.reply({
        content: `✅ Cache berhasil direbuild. **${loaded}** entri dimuat dari database.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ─── Rebuild Database ─────────────────────────────────────────────────────

  async rebuildDatabase(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      this.#db.vacuum();
      await interaction.editReply({
        content: '✅ Database berhasil di-rebuild (VACUUM + WAL checkpoint selesai).',
      });
      this.#logger.info(`[${interaction.guildId}] Database rebuilt (VACUUM)`, 'SettingsHandler');

      // Refresh the settings panel
      await this.#refreshPanel(interaction.guildId);
    } catch (err) {
      await interaction.editReply({
        content: `❌ Rebuild database gagal: ${err.message.slice(0, 300)}`,
      });
      this.#logger.error(`Database rebuild failed: ${err.message}`, 'SettingsHandler');
    }
  }

  // ─── Reset Stats ──────────────────────────────────────────────────────────

  async resetStats(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    try {
      this.#db.resetStats(interaction.guildId);
      this.#logger.info(`[${interaction.guildId}] Stats reset`, 'SettingsHandler');

      const updated = this.#db.getConfig(interaction.guildId);
      await interaction.update({
        embeds:     [settingsEmbed(updated, this.#extras())],
        components: settingsRows(updated),
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Reset statistik gagal: ${err.message.slice(0, 200)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ─── Refresh (display only) ───────────────────────────────────────────────

  async refresh(interaction) {
    const config = this.#db.getConfig(interaction.guildId);
    if (!config) return this.#noConfig(interaction);

    await interaction.update({
      embeds:     [settingsEmbed(config, this.#extras())],
      components: settingsRows(config),
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async #noConfig(interaction) {
    await interaction.reply({
      content: '❌ Konfigurasi BoomBox tidak ditemukan. Gunakan `/setup` → BoomBox Manager.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
