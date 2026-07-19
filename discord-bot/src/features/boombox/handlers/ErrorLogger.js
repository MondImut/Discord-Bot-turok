/**
 * ErrorLogger — Sends categorized error embeds to the guild's BoomBox Error Logs channel.
 *
 * Features:
 * - No-op when ch_errors is not configured (backward compatible).
 * - Graceful: never throws, always catches Discord API errors.
 * - Categorizes errors with suggested solutions.
 * - Rate-limit safe: uses a simple in-memory throttle per guild (max 1 error/5s).
 * - Rich embed: platform, provider chain, system info, stack trace.
 */

import { errorLogEmbed } from '../ui/Embeds.js';

/** Minimum ms between error log messages per guild to avoid spam. */
const ERROR_THROTTLE_MS = 5_000;

export class ErrorLogger {
  #client;
  #db;
  #logger;
  /** Map<guildId, lastSentMs> */
  #lastSent = new Map();

  constructor(client, db, logger) {
    this.#client = client;
    this.#db     = db;
    this.#logger = logger;
  }

  /**
   * Post an error embed to the guild's Error Logs channel.
   * @param {string}  guildId
   * @param {object}  data
   * @param {string}  data.category         - One of ERROR_TYPES values
   * @param {string}  data.errorMessage
   * @param {string}  [data.stack]
   * @param {string}  [data.platform]       - 'youtube' | 'tiktok' | 'spotify'
   * @param {string}  [data.channelId]
   * @param {string}  [data.userId]
   * @param {string}  [data.originalUrl]    - Original link sent by user
   * @param {string}  [data.queueId]        - UUID of the queue job
   * @param {number}  [data.elapsedMs]      - Time elapsed before failure
   * @param {string}  [data.lastProvider]   - Last provider attempted
   * @param {Array}   [data.triedProviders] - [{name, reason}] all providers tried
   * @param {string}  [data.providerDetail] - Short provider error summary
   * @param {string}  [data.nodeVersion]    - process.version
   * @param {number}  [data.memoryMB]       - RSS memory in MB
   * @param {string}  [data.environment]    - Hosting environment name
   */
  async log(guildId, data) {
    if (!guildId) return;

    // Throttle: skip if we just sent one
    const now = Date.now();
    const last = this.#lastSent.get(guildId) ?? 0;
    if (now - last < ERROR_THROTTLE_MS) return;
    this.#lastSent.set(guildId, now);

    try {
      const config = this.#db.getConfig(guildId);
      if (!config?.ch_errors) return;

      const channelId = config.ch_errors;
      if (!channelId) return;

      const guild   = this.#client.guilds.cache.get(guildId);
      const channel = await this.#client.channels.fetch(channelId).catch(() => null);
      if (!channel) return;

      const embed = errorLogEmbed({
        ...data,
        guildName: guild?.name ?? guildId,
        guildId,
        time: new Date().toLocaleString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }),
      });

      await channel.send({ embeds: [embed] });
    } catch (err) {
      // Never propagate — ErrorLogger must never be the source of more errors
      this.#logger.warn(`ErrorLogger failed to post: ${err.message}`, 'ErrorLogger');
    }
  }
}
