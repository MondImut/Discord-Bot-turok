/**
 * PanelManager — Manages 4 permanent panels across dedicated channels:
 *   1. Monitor Panel   → ch_monitor  (fallback ch_logs)
 *   2. Archive Panel   → ch_logs
 *   3. Settings Panel  → ch_settings (fallback ch_logs)
 *   4. Logs Panel      → ch_logs  (live-updated list of recent conversions)
 *
 * Rules:
 * - Each panel is a single permanent message. If deleted, it is auto-recreated
 *   on the next health tick or on bot restart.
 * - All edits are in-place. No duplicate messages.
 * - Per-guild error isolation: one guild failing never breaks others.
 *
 * Live Update flow (called after each conversion from MessageHandler):
 *   updateArchivePanel(guildId)  → edit archive counts
 *   updateLogsPanel(guildId)     → edit recent conversions list
 *   updateMonitorPanel(guildId)  → edit stats/worker status
 */

import {
  monitorEmbed, archivePanelEmbed, settingsEmbed, recentLogsEmbed,
} from '../ui/Embeds.js';
import { archivePanelRows, settingsRows } from '../ui/Components.js';
import os from 'os';

/** Panel types managed per guild. */
const PANEL_TYPES = ['monitor', 'archive', 'settings', 'logs'];

export class PanelManager {
  #db;
  #logger;
  #pool        = null;
  #downloader  = null;
  #uptimeStart = null;

  /** Map<guildId, { monitorMsg, archiveMsg, settingsMsg, logsMsg }> */
  #panels = new Map();

  constructor(db, logger) {
    this.#db     = db;
    this.#logger = logger;
  }

  setPool(pool)               { this.#pool        = pool; }
  setDownloader(downloader)   { this.#downloader  = downloader; }
  setUptimeStart(ts)          { this.#uptimeStart = ts; }

  // ─── Init ─────────────────────────────────────────────────────────────────

  /**
   * Restore or create all 5 panels for a guild.
   * Channels: monitor → ch_monitor (fallback ch_logs), archive/manager/logs → ch_logs,
   *           settings → ch_settings (fallback ch_logs).
   */
  async initGuild(guild, config, db) {
    const guildId = guild.id;

    // Resolve channels (with fallback to ch_logs for old configs)
    const [logsChannel, monitorChannel, settingsChannel] = await Promise.all([
      this.#fetchChannel(guild, config.ch_logs),
      this.#fetchChannel(guild, config.ch_monitor ?? config.ch_logs),
      this.#fetchChannel(guild, config.ch_settings ?? config.ch_logs),
    ]);

    if (!logsChannel) {
      this.#logger.warn(`Logs channel not found for guild ${guildId}. Panels skipped.`, 'PanelManager');
      return;
    }

    // Fetch or create each panel in its channel
    const [monitorMsg, archiveMsg, settingsMsg, logsMsg] = await Promise.all([
      this.#fetchOrCreate(monitorChannel  ?? logsChannel, config.monitor_msg_id,  'monitor',  guildId, config),
      this.#fetchOrCreate(logsChannel,                    config.archive_msg_id,  'archive',  guildId, config),
      this.#fetchOrCreate(settingsChannel ?? logsChannel, config.settings_msg_id, 'settings', guildId, config),
      this.#fetchOrCreate(logsChannel,                    config.logs_msg_id,     'logs',     guildId, config),
    ]);

    this.#panels.set(guildId, { guild, monitorMsg, archiveMsg, settingsMsg, logsMsg });

    // Persist any changed message IDs
    const updated = {
      monitorMsgId:  monitorMsg?.id  ?? null,
      archiveMsgId:  archiveMsg?.id  ?? null,
      settingsMsgId: settingsMsg?.id ?? null,
      logsMsgId:     logsMsg?.id     ?? null,
    };
    if (
      updated.monitorMsgId  !== config.monitor_msg_id  ||
      updated.archiveMsgId  !== config.archive_msg_id  ||
      updated.settingsMsgId !== config.settings_msg_id ||
      updated.logsMsgId     !== (config.logs_msg_id ?? null)
    ) {
      db.upsertConfig(guildId, updated);
    }

    this.#logger.info(`Panels ready for guild: ${guild.name}`, 'PanelManager');
    await Promise.allSettled([
      this.updateMonitorPanel(guildId),
      this.updateLogsPanel(guildId),
    ]);
  }

  // ─── Panel Recovery ───────────────────────────────────────────────────────

  /**
   * Check if a panel's message still exists. If deleted, attempt recovery.
   * Called during health ticks to auto-heal missing panels.
   */
  async recoverPanels(guild, config) {
    const guildId = guild.id;
    const entry   = this.#panels.get(guildId);
    if (!entry) {
      // Not in memory at all — full re-init
      return this.initGuild(guild, config, this.#db);
    }

    let needsUpdate = false;

    const checks = [
      { key: 'monitorMsg',  chId: config.ch_monitor  ?? config.ch_logs, msgId: config.monitor_msg_id,  type: 'monitor'  },
      { key: 'archiveMsg',  chId: config.ch_logs,                        msgId: config.archive_msg_id,  type: 'archive'  },
      { key: 'settingsMsg', chId: config.ch_settings ?? config.ch_logs, msgId: config.settings_msg_id, type: 'settings' },
      { key: 'logsMsg',     chId: config.ch_logs,                        msgId: config.logs_msg_id,     type: 'logs'     },
    ];

    for (const { key, chId, msgId, type } of checks) {
      if (!entry[key] && msgId) {
        // Try to re-fetch from Discord
        const ch  = await this.#fetchChannel(guild, chId);
        const msg = ch ? await ch.messages.fetch(msgId).catch(() => null) : null;
        if (msg) {
          entry[key] = msg;
        } else if (ch) {
          // Recreate the panel
          const newMsg = await this.#createPanel(ch, type, guildId, config);
          if (newMsg) {
            entry[key] = newMsg;
            this.#db.upsertConfig(guildId, this.#msgIdsFromEntry(entry));
            needsUpdate = true;
          }
        }
      }
    }

    return needsUpdate;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async #fetchChannel(guild, channelId) {
    if (!channelId) return null;
    return guild.channels.fetch(channelId).catch(() => null);
  }

  async #fetchOrCreate(channel, msgId, type, guildId, config) {
    if (!channel) return null;

    if (msgId) {
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (msg) return msg;
      this.#logger.warn(`${type} panel missing for guild ${guildId} — recreating.`, 'PanelManager');
    }

    return this.#createPanel(channel, type, guildId, config);
  }

  async #createPanel(channel, type, guildId, config) {
    try {
      return await channel.send(this.#panelOpts(type, guildId, config));
    } catch (err) {
      this.#logger.error(`Cannot create ${type} panel for guild ${guildId}: ${err.message}`, 'PanelManager');
      return null;
    }
  }

  #panelOpts(type, guildId, config) {
    const emptyStats = {
      total_convert: 0, cache_hit: 0, success_count: 0, failed_count: 0,
      retry_count: 0, yt_count: 0, tk_count: 0, sp_count: 0,
    };
    const emptyCount = { total: 0, yt: 0, tk: 0, sp: 0 };

    switch (type) {
      case 'monitor':
        return { embeds: [monitorEmbed(emptyStats, { activeWorkers: 0, queueSize: 0 }, config.perf_mode, config)] };
      case 'archive':
        return { embeds: [archivePanelEmbed(emptyCount)], components: archivePanelRows() };
      case 'settings':
        return { embeds: [settingsEmbed(config)], components: settingsRows(config) };
      case 'logs': {
        // Show actual recent data if available, otherwise empty state
        const entries = guildId ? (this.#db.getRecentMedia?.(guildId, 5) ?? []) : [];
        return { embeds: [recentLogsEmbed(entries)] };
      }
      default:
        return { content: `BoomBox Panel (${type})` };
    }
  }

  #msgIdsFromEntry(entry) {
    return {
      monitorMsgId:  entry.monitorMsg?.id  ?? null,
      archiveMsgId:  entry.archiveMsg?.id  ?? null,
      settingsMsgId: entry.settingsMsg?.id ?? null,
      logsMsgId:     entry.logsMsg?.id     ?? null,
    };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async updateMonitorPanel(guildId) {
    const entry = this.#panels.get(guildId);
    if (!entry?.monitorMsg) return;

    const config = this.#db.getConfig(guildId);
    if (!config) return;

    const stats = this.#db.getStats(guildId);
    const workerStatus = this.#pool
      ? { activeWorkers: this.#pool.activeCount, queueSize: this.#pool.queueSize }
      : { activeWorkers: 0, queueSize: 0 };

    const providerStatus  = this.#downloader?.providerStatus ?? null;
    const retryCount      = this.#pool?.retryCount    ?? 0;
    const inFlightCount   = this.#downloader?.inFlightCount ?? 0;

    try {
      await entry.monitorMsg.edit({
        embeds: [monitorEmbed(
          stats, workerStatus, config.perf_mode, config,
          providerStatus, this.#uptimeStart, retryCount, inFlightCount,
        )],
      });
    } catch (err) {
      this.#logger.warn(`Monitor panel update failed (${guildId}): ${err.message}`, 'PanelManager');
      // Force re-init on next tick so panel is re-fetched/recreated
      if (entry) entry.monitorMsg = null;
    }
  }

  async updateArchivePanel(guildId) {
    const entry = this.#panels.get(guildId);
    if (!entry?.archiveMsg) return;

    const counts = this.#db.countByPlatform(guildId);
    try {
      await entry.archiveMsg.edit({ embeds: [archivePanelEmbed(counts)], components: archivePanelRows() });
    } catch (err) {
      this.#logger.warn(`Archive panel update failed (${guildId}): ${err.message}`, 'PanelManager');
      if (entry) entry.archiveMsg = null;
    }
  }

  /**
   * Update the live logs panel with the most recent 5 conversions.
   * Called immediately after every successful conversion.
   *
   * Recovery: if the panel message is missing (deleted), recreates ONLY the logs
   * panel, saves the new message ID to the database, and continues. Other panels
   * are never affected.
   */
  async updateLogsPanel(guildId) {
    const entry = this.#panels.get(guildId);
    if (!entry) return; // Guild not initialised — nothing to do.

    this.#logger.debug('[BoomBoxLogs] Updating panel...', 'PanelManager');

    const entries     = this.#db.getRecentMedia(guildId, 5);
    const embedPayload = { embeds: [recentLogsEmbed(entries)] };

    // ── Try to edit the existing panel in-place ────────────────────────────
    if (entry.logsMsg) {
      try {
        await entry.logsMsg.edit(embedPayload);
        this.#logger.info('[BoomBoxLogs] Panel updated successfully.', 'PanelManager');
        return;
      } catch (err) {
        this.#logger.warn(`[BoomBoxLogs] Recreating missing panel... (${err.message})`, 'PanelManager');
        entry.logsMsg = null;
        // Fall through to recreate.
      }
    } else {
      this.#logger.warn('[BoomBoxLogs] Recreating missing panel...', 'PanelManager');
    }

    // ── Panel message gone — recreate ONLY the logs panel ─────────────────
    const config = this.#db.getConfig(guildId);
    if (!config?.ch_logs || !entry.guild) return;

    const logsChannel = await this.#fetchChannel(entry.guild, config.ch_logs);
    if (!logsChannel) return;

    try {
      const newMsg   = await logsChannel.send(embedPayload);
      entry.logsMsg  = newMsg;
      this.#db.upsertConfig(guildId, { logsMsgId: newMsg.id });
      this.#logger.info(`[BoomBoxLogs] Panel updated successfully. (recreated id=${newMsg.id})`, 'PanelManager');
    } catch (err) {
      this.#logger.error(`[BoomBoxLogs] Failed to recreate logs panel: ${err.message}`, 'PanelManager');
    }
  }

  async updateSettingsPanel(guildId) {
    const entry = this.#panels.get(guildId);
    if (!entry?.settingsMsg) return;

    const config = this.#db.getConfig(guildId);
    if (!config) return;

    const extras = {
      activeWorkers: this.#pool?.activeCount ?? 0,
      queueSize:     this.#pool?.queueSize   ?? 0,
      cacheSize:     0,
      retryCount:    this.#pool?.retryCount  ?? 0,
    };

    try {
      await entry.settingsMsg.edit({
        embeds:     [settingsEmbed(config, extras)],
        components: settingsRows(config),
      });
    } catch (err) {
      this.#logger.warn(`Settings panel update failed (${guildId}): ${err.message}`, 'PanelManager');
      if (entry) entry.settingsMsg = null;
    }
  }

  /** Update all monitor panels across all guilds (called by HealthMonitor). */
  async updateAllMonitorPanels() {
    await Promise.allSettled([...this.#panels.keys()].map((id) => this.updateMonitorPanel(id)));
  }

  /** Update all logs panels across all guilds (called by HealthMonitor). */
  async updateAllLogsPanels() {
    await Promise.allSettled([...this.#panels.keys()].map((id) => this.updateLogsPanel(id)));
  }

  // ─── Error Log ────────────────────────────────────────────────────────────
  // Delegated to ErrorLogger — this stub kept for compatibility.
  // The ErrorLogger is injected into MessageHandler directly.
}
