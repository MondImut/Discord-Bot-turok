/**
 * HealthMonitor — Schedules periodic monitor panel updates and panel recovery.
 *
 * Optimizations:
 * - Per-guild error isolation: one guild's Discord API error never breaks
 *   the update loop for other guilds.
 * - Errors are logged with guild context for easier debugging.
 * - `status()` snapshot is always safe to call (no async side effects).
 *
 * v1.3 additions:
 * - setClient(client): store the Discord client after bot is ready.
 * - #tick() now also calls recoverPanels() per guild so deleted panels are
 *   auto-healed every 5 minutes without requiring a bot restart.
 */

export class HealthMonitor {
  #pool;
  #panelManager;
  #db;
  #logger;
  /** Discord.js Client — set via setClient() once the bot is ready. */
  #client = null;

  constructor(pool, panelManager, db, logger) {
    this.#pool         = pool;
    this.#panelManager = panelManager;
    this.#db           = db;
    this.#logger       = logger;
  }

  /**
   * Store the Discord client so the health tick can resolve Guild objects
   * and call PanelManager.recoverPanels() for auto-healing.
   * Must be called from the 'ready' event handler.
   */
  setClient(client) {
    this.#client = client;
  }

  /**
   * Register the health-check cron job using the core Scheduler.
   * Runs every 5 minutes.
   * @param {object} scheduler - core Scheduler instance
   */
  schedule(scheduler) {
    scheduler.register('boombox:health', '*/5 * * * *', () => this.#tick());
    this.#logger.info('Health monitor scheduled (every 5 min).', 'HealthMonitor');
  }

  /** Run a health tick manually (e.g. for testing). */
  async tick() { return this.#tick(); }

  async #tick() {
    const guildIds = this.#db.getAllGuildIds();
    // Run all guild panel updates in parallel; isolate errors per guild.
    await Promise.allSettled(
      guildIds.map(async (id) => {
        try {
          // 1. Update monitor + logs + archive panels (stats, recent conversions, counts)
          await Promise.allSettled([
            this.#panelManager.updateMonitorPanel(id),
            this.#panelManager.updateLogsPanel(id),
            this.#panelManager.updateArchivePanel(id),
          ]);

          // 2. Recover any panels that were deleted while the bot was running.
          //    Requires the Discord client to be ready (set via setClient).
          if (this.#client) {
            const guild  = this.#client.guilds.cache.get(id);
            const config = this.#db.getConfig(id);
            if (guild && config) {
              await this.#panelManager.recoverPanels(guild, config);
            }
          }
        } catch (err) {
          this.#logger.error(
            `Health tick failed for guild ${id}: ${err.message}`,
            'HealthMonitor',
          );
        }
      }),
    );
  }

  /** Snapshot of current worker pool status (safe, no async). */
  status() {
    return {
      activeWorkers: this.#pool.activeCount,
      queueSize:     this.#pool.queueSize,
    };
  }
}
