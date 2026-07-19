/**
 * src/features/boombox/index.js — BoomBox v1.5.0 initialization.
 *
 * Adapts Turok's BoomBox plugin to run standalone (without PluginBase).
 * Call initBoomBox(client) from the Discord ready event handler.
 *
 * Exports:
 *   initBoomBox(client)            — boot BoomBox, restore panels
 *   shutdownBoomBox()              — graceful drain + DB close
 *   getBoomBoxMessageHandler()     — Turok's MessageHandler instance
 *   getBoomBoxInteractionHandler() — Turok's InteractionHandler instance
 *   getBoomBoxSetupManager()       — Turok's SetupManager instance
 *   getBoomBoxDB()                 — Turok's BoomBoxDB instance
 */

import { BoomBoxDB }          from './database/BoomBoxDB.js';
import { SmartCache }         from './core/SmartCache.js';
import { QueueManager }       from './core/QueueManager.js';
import { WorkerPool }         from './core/WorkerPool.js';
import { Downloader }         from './core/Downloader.js';
import { HealthMonitor }      from './core/HealthMonitor.js';
import { PanelManager }       from './handlers/PanelManager.js';
import { MessageHandler }     from './handlers/MessageHandler.js';
import { ArchiveHandler }     from './handlers/ArchiveHandler.js';
import { SettingsHandler }    from './handlers/SettingsHandler.js';
import { InteractionHandler } from './handlers/InteractionHandler.js';
import { ErrorLogger }        from './handlers/ErrorLogger.js';
import { ConversionLogger }   from './handlers/ConversionLogger.js';
import { SetupManager }       from './handlers/SetupManager.js';
import { UrlLogsHandler }     from './handlers/UrlLogsHandler.js';
import { PERFORMANCE_MODES }  from './constants.js';
import { logger as baseLogger } from '../../utils/logger.js';

// ── Logger adapter (Turok expects: info/debug/warn/error/success(msg, ctx)) ──

function makeLog(base) {
  const fmt = (msg, ctx) => ctx ? `[BoomBox:${ctx}] ${msg}` : `[BoomBox] ${msg}`;
  return {
    info:    (msg, ctx) => base.info(fmt(msg, ctx)),
    debug:   (msg, ctx) => base.debug ? base.debug(fmt(msg, ctx)) : void 0,
    warn:    (msg, ctx) => base.warn(fmt(msg, ctx)),
    error:   (msg, ctx) => base.error(fmt(msg, ctx)),
    success: (msg, ctx) => base.info(`✓ ${fmt(msg, ctx)}`),
  };
}

// ── Singletons (set during initBoomBox) ──────────────────────────────────────

let _messageHandler     = null;
let _interactionHandler = null;
let _setupManager       = null;
let _db                 = null;
let _pool               = null;

export function getBoomBoxMessageHandler()     { return _messageHandler; }
export function getBoomBoxInteractionHandler() { return _interactionHandler; }
export function getBoomBoxSetupManager()       { return _setupManager; }
export function getBoomBoxDB()                 { return _db; }

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Boot the BoomBox system. Must be called from the Discord 'clientReady' handler
 * after the client's guild cache is populated.
 *
 * @param {import('discord.js').Client} client
 */
export async function initBoomBox(client) {
  const log = makeLog(baseLogger);
  log.info('Initializing BoomBox v1.5.0...');

  // 1. SQLite database
  _db = new BoomBoxDB(log);
  _db.open('./data/database/boombox.db');

  // 2. In-memory smart cache (max 2 000 entries total)
  const cache = new SmartCache();

  // 3. FIFO job queue
  const queue = new QueueManager();

  // 4. Platform converter — cache-first, in-flight dedup, multi-provider fallback
  const downloader = new Downloader(_db, cache, log);

  // 5. Concurrent worker pool (defaults from balanced mode)
  const defPm = PERFORMANCE_MODES.balanced;
  _pool = new WorkerPool(queue, downloader, log, {
    workers: defPm.workers,
    timeout: defPm.timeout,
    retries: defPm.retries,
  });

  // 6. Permanent 4-panel manager (monitor / archive / settings / logs)
  const panelManager = new PanelManager(_db, log);
  panelManager.setPool(_pool);
  panelManager.setDownloader(downloader);
  panelManager.setUptimeStart(Date.now());

  // 7. Feature handlers
  const archiveHandler  = new ArchiveHandler(_db, log);
  const settingsHandler = new SettingsHandler(_db, cache, _pool, panelManager, log);

  // 8. BoomBox Manager (setup + monitoring panel, new in v1.5)
  _setupManager = new SetupManager(_db, cache, _pool, panelManager, log);

  // 9. URL Logs Handler
  const urlLogsHandler = new UrlLogsHandler(_db, log);
  _setupManager.setUrlLogsHandler(urlLogsHandler);

  // 10. Error + Conversion loggers (client is first arg per Turok's API)
  const errorLogger      = new ErrorLogger(client, _db, log);
  const conversionLogger = new ConversionLogger(client, _db, log);

  // 11. Message handler
  _messageHandler = new MessageHandler(
    _db, _pool, log,
    errorLogger, conversionLogger,
    panelManager, _setupManager,
  );

  // 12. Interaction handler
  _interactionHandler = new InteractionHandler(
    archiveHandler, settingsHandler, _db, log,
    _setupManager, urlLogsHandler,
  );

  // 13. Health monitor — every 5 minutes, isolated per guild
  const healthMonitor = new HealthMonitor(_pool, panelManager, _db, log);
  healthMonitor.setClient(client);
  // Simple scheduler shim (Turok uses a cron scheduler; we use setInterval)
  const scheduler = {
    register: (_name, _cron, fn) => {
      setInterval(fn, 5 * 60 * 1_000).unref?.();
    },
  };
  healthMonitor.schedule(scheduler);

  // 14. Restore panels for all guilds that already have a saved config
  const configuredIds = _db.getAllGuildIds();
  log.info(`Restoring panels for ${configuredIds.length} configured guild(s)...`);

  await Promise.allSettled(
    configuredIds.map(async (guildId) => {
      const guild  = client.guilds.cache.get(guildId);
      const config = _db.getConfig(guildId);
      if (!guild || !config) return;

      // Apply saved performance mode to the pool
      const pm = PERFORMANCE_MODES[config.perf_mode] ?? PERFORMANCE_MODES.balanced;
      _pool.updateConfig({ workers: pm.workers, timeout: pm.timeout, retries: pm.retries });

      // Preload SmartCache from DB (most-recently-used 500 entries)
      const loaded = cache.preload(_db, guildId);
      log.debug(`Cache preloaded: ${loaded} entries`, `guild:${guildId}`);

      // Restore 4-panel system (monitor / archive / settings / logs)
      await panelManager.initGuild(guild, config, _db).catch((err) =>
        log.warn(`PanelManager init failed for ${guildId}: ${err.message}`),
      );

      // Restore BoomBox Manager panel + URL Logs panel (v1.5)
      if (config.ch_monitor) {
        await _setupManager.initGuild(guild, config).catch((err) =>
          log.warn(`SetupManager init failed for ${guildId}: ${err.message}`),
        );
      }
    }),
  );

  log.success('BoomBox v1.5.0 is fully operational! 🎵');
}

// ── Shutdown ─────────────────────────────────────────────────────────────────

/** Graceful drain + DB close. Call before process.exit(). */
export async function shutdownBoomBox() {
  if (_pool) {
    await _pool.drain(15_000).catch(() => {});
    _pool = null;
  }
  if (_db) {
    _db.close();
    _db = null;
  }
}
