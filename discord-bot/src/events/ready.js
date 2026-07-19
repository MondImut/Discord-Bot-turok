/**
 * src/events/ready.js — clientReady event handler.
 *
 * Initialises all persistent services once the bot is logged in.
 * BoomBox v1.5.0 (Turok) is now the active BoomBox system; the old
 * JSON-based BoomBox and its migration are removed.
 */

import { logger }                        from '../utils/logger.js';
import { initErrorLogger, logError }     from '../utils/errorLogger.js';
import { loadCommands }                  from '../commands/index.js';
import { deployCommands }                from '../commands/deploy.js';
import { startPremiumSweep }             from '../features/premium/sweep.js';
import { updatePremStatsDashboard }      from '../features/premium/statsDashboard.js';
import { updateTicketDashboard }         from '../features/ticket/dashboard.js';
import { ticketDB }                      from '../database/ticketDB.js';
import { IDS }                           from '../../config/constants.js';
import { initConsole, consoleLog }       from '../features/database/console.js';
import { refreshPanelsOnStartup }        from '../features/database/interaction.js';
import { initBoomBox }                   from '../features/boombox/index.js';

/**
 * @param {import('discord.js').Client} client
 * @param {{ botToken: string, scanChannelId: string }} secrets
 * @param {{ commands: Map<string,any> }} state  Shared mutable state object
 */
export async function handleReady(client, secrets, state) {
  logger.info(`Login berhasil sebagai ${client.user.tag}`);
  logger.info(`Memantau channel scan: ${secrets.scanChannelId}`);

  initErrorLogger(client);

  // Initialise database console logger and log "Bot Online"
  initConsole(client);
  consoleLog('online', 'Bot Online', `${client.user.tag} berhasil login dan siap.`).catch(() => {});

  // Load and deploy slash commands
  try {
    state.commands = await loadCommands();
    await deployCommands(client, state.commands);
    client._helpCommands = state.commands;
  } catch (err) {
    logger.error('Gagal memuat/mendaftarkan slash command', err);
    await logError({
      feature: 'Commands',
      reason:  err?.message ?? String(err),
      stage:   'Startup Registration',
      guild:   IDS.GUILD_ID,
      error:   err,
    }).catch(() => {});
  }

  // Premium sweep (expiry checks)
  startPremiumSweep(client);

  // Refresh Database Manager panels (edit in-place, no new messages)
  const guild = client.guilds.cache.get(IDS.GUILD_ID);
  if (guild) {
    refreshPanelsOnStartup(client, guild).catch((err) => {
      logger.warn(`[Database] Startup panel refresh gagal (non-fatal): ${err?.message}`);
    });
  }

  // Premium stats dashboard
  updatePremStatsDashboard(client).catch((err) => {
    logger.warn('PremStats dashboard init failed on startup:', err?.message);
  });

  // Ticket dashboard
  if (ticketDB.getConfig().logsChannelId) {
    updateTicketDashboard(client).catch((err) => {
      logger.warn('Ticket dashboard init failed on startup:', err?.message);
    });
  }

  // BoomBox v1.5.0 (Turok) — initialise last so guild cache is fully populated
  initBoomBox(client).catch((err) => {
    logger.error(`[BoomBox] Initialization failed (non-fatal): ${err?.message}`, err);
  });
}
