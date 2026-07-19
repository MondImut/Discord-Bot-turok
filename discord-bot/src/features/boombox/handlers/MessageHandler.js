/**
 * MessageHandler — Listens for media links in BoomBox channels.
 * Flow: reply "Membuat BoomBox..." → worker processes → edit reply with result.
 * Respects reply_mode: 'reply' (default) or 'standalone'.
 *
 * v1.5 changes:
 * - processingEmbed() now receives config + user for GIF support and "Requested by" footer.
 * - successEmbed() now receives config + user for GIF success and thumbnail.
 * - errorEmbed() now receives platform + user for user-facing message.
 * - recordConversionFull() used for daily stats tracking.
 *
 * Error policy:
 * - Public channel ONLY shows a generic user-friendly error embed.
 * - NO stack traces, NO provider URLs, NO API responses in public channel.
 * - ALL technical details go to the ErrorLogger (ch_errors).
 */

import { detectPlatform, extractMediaId, isMp4Url, extractMp4Id } from '../platforms/index.js';
import { processingEmbed, successEmbed, errorEmbed } from '../ui/Embeds.js';
import { successActionRow } from '../ui/Components.js';
import { ERROR_TYPES } from '../constants.js';
import { randomUUID } from 'crypto';
import os from 'os';

const URL_RE = /https?:\/\/[^\s<>"\]]+/i;

/** Platform code shorthand map */
const PLAT_CODE = { youtube: 'yt', tiktok: 'tk', spotify: 'sp' };

export class MessageHandler {
  #db;
  #pool;
  #logger;
  #errorLogger;      // optional — null if not configured
  #conversionLogger; // optional — kept for backward compat, but panels are primary
  #panelManager;     // optional — null if not configured; handles live panel updates
  #setupManager;     // optional — for manager panel + daily stats updates

  constructor(db, pool, logger, errorLogger = null, conversionLogger = null, panelManager = null, setupManager = null) {
    this.#db               = db;
    this.#pool             = pool;
    this.#logger           = logger;
    this.#errorLogger      = errorLogger;
    this.#conversionLogger = conversionLogger;
    this.#panelManager     = panelManager;
    this.#setupManager     = setupManager;
  }

  async handle(message) {
    if (message.author.bot || !message.guildId) return;

    const config = this.#db.getConfig(message.guildId);
    if (!config) return;

    // Identify channel → which BoomBox channel we're in
    const ch = message.channelId;
    const channelPlatform =
      ch === config.ch_youtube ? 'youtube' :
      ch === config.ch_tiktok  ? 'tiktok'  :
      ch === config.ch_spotify ? 'spotify'  :
      null;
    if (!channelPlatform) return;

    // ── MP4 attachment / direct link detection ────────────────────────────────
    // Supports: .mp4 Discord attachments, CDN links, GitHub Raw, MediaFire, Top4Top
    const mp4Attachment = message.attachments.find(
      (a) => /\.mp4$/i.test(a.name ?? '')
    );
    const urlMatch = message.content.match(URL_RE);
    const rawUrl   = urlMatch?.[0] ?? null;
    const mp4Url   = mp4Attachment?.url
      ?? (rawUrl && isMp4Url(rawUrl) ? rawUrl : null);

    let platform, url, videoId;

    if (mp4Url) {
      // ── Direct MP4 — bypass YouTube/TikTok/Spotify provider chain ──────────
      // Respect the channel's enabled setting
      const chanCode = PLAT_CODE[channelPlatform];
      const enabled  = config[`${chanCode}_enabled`] ?? 1;
      if (!enabled) return;

      platform = 'mp4';
      url      = mp4Url;
      videoId  = extractMp4Id(mp4Url);

    } else {
      // ── Normal platform URL ─────────────────────────────────────────────────
      if (!rawUrl) return;
      url = rawUrl;

      // Validate platform matches the channel
      const detected = detectPlatform(url);
      if (!detected) return;
      if (detected !== channelPlatform) {
        await message.reply({
          content: `Link **${detected}** tidak sesuai dengan channel **${channelPlatform}** ini.`,
        }).catch((err) => {
          this.#logger.warn(`Cannot send platform mismatch reply: ${err.message}`, 'MessageHandler');
        });
        return;
      }

      platform = detected;

      // Check if platform is enabled
      const platCode = PLAT_CODE[platform];
      const enabled  = config[`${platCode}_enabled`] ?? 1;
      if (!enabled) return;

      videoId = extractMediaId(url, platform);
    }

    // Reply with processing embed (includes GIF + "Requested by" if configured)
    const startMs = Date.now();
    let reply;
    try {
      const processingPayload = {
        embeds: [processingEmbed(platform, config, message.author)],
      };
      reply = config.reply_mode === 'standalone'
        ? await message.channel.send(processingPayload)
        : await message.reply(processingPayload);
    } catch (err) {
      this.#logger.error(`Cannot send processing reply in ${ch}: ${err.message}`, 'MessageHandler');
      return;
    }

    const jobId = randomUUID();

    // Submit job to worker pool
    this.#pool.submit({
      id:       jobId,
      guildId:  message.guildId,
      userId:   message.author.id,
      url,
      platform,
      videoId,

      onRetry: () => {
        try { this.#db.recordRetry(message.guildId); } catch (_) {}
      },

      onSuccess: async ({ media, cacheHit }) => {
        const elapsed  = Date.now() - startMs;
        const guildId  = message.guildId;

        // Note: max-duration is now enforced earlier in Downloader (pre-download),
        // so media arriving here has already passed the duration gate.

        // ── Step 1: Send result to user ──────────────────────────────────
        try {
          await reply.edit({
            embeds:     [successEmbed(media, cacheHit, elapsed, config, message.author)],
            components: successActionRow(media.id),
          });
          this.#logger.info(
            `[BoomBox] User Reply Sent — platform=${platform} elapsed=${elapsed}ms`,
            'MessageHandler',
          );
        } catch (err) {
          this.#logger.warn(`Cannot edit reply after success (${platform}): ${err.message}`, 'MessageHandler');
        }

        // ── Step 2: Record daily stats ───────────────────────────────────
        try {
          this.#db.recordConversionFull(guildId, {
            platform, cacheHit, success: true, elapsedMs: elapsed,
          });
        } catch (err) {
          // Fallback to old recordConversion if new method fails
          try { this.#db.recordConversion(guildId, { platform, cacheHit, success: true }); } catch (_) {}
        }

        // ── Step 3: Live-update all panels (fire in parallel, never block user) ──
        this.#logger.info('[BoomBoxLogs] Database saved.', 'MessageHandler');
        if (this.#panelManager) {
          Promise.allSettled([
            this.#panelManager.updateLogsPanel(guildId),
            this.#panelManager.updateArchivePanel(guildId),
            this.#panelManager.updateMonitorPanel(guildId),
          ]).catch(() => {});
        }

        // Update BoomBox Manager panel if configured
        if (this.#setupManager) {
          this.#setupManager.updateManagerPanel(guildId).catch(() => {});
        }

        // ── Step 4: Auto-delete original user message if configured ──────
        if (config.delete_msgs && message.deletable) {
          await message.delete().catch((err) => {
            this.#logger.debug(`Auto-delete failed: ${err.message}`, 'MessageHandler');
          });
        }

        this.#logger.debug(`Converted: ${platform}/${videoId} cacheHit=${cacheHit}`, 'MessageHandler');
      },

      onError: async (err) => {
        const elapsed = Date.now() - startMs;

        // ─── Max-duration rejection — user-facing specific message, no error log ──
        if (err.isMaxDurationError) {
          const dur = err.duration ?? 0;
          const max = err.maxDuration ?? 0;
          const fmtDur = (s) => `${Math.floor(s / 60)}m ${s % 60}s`;
          try {
            await reply.edit({
              embeds: [{
                color: 0xED4245,
                title: '❌ Durasi Terlalu Panjang',
                description: `Media ini memiliki durasi **${fmtDur(dur)}**, melebihi batas maksimum **${fmtDur(max)}** yang dikonfigurasi server.`,
                footer: { text: 'Powered by Pangeran Assistant' },
              }],
              components: [],
            });
          } catch (_) {}
          this.#logger.debug(`Max-duration blocked: ${platform}/${videoId} dur=${dur}s max=${max}s`, 'MessageHandler');
          return;
        }

        // ─── Record daily stats ───────────────────────────────────────────
        try {
          this.#db.recordConversionFull(message.guildId, {
            platform, cacheHit: false, success: false, elapsedMs: elapsed,
          });
        } catch (_) {
          try { this.#db.recordConversion(message.guildId, { platform, cacheHit: false, success: false }); } catch (_2) {}
        }

        // ─── Public channel: generic error message ────────────────────────
        try {
          await reply.edit({
            embeds:     [errorEmbed(platform, message.author)],
            components: [],
          });
        } catch (editErr) {
          this.#logger.warn(`Cannot edit reply after error: ${editErr.message}`, 'MessageHandler');
        }

        // ─── Internal log (server-side) ───────────────────────────────────
        this.#logger.error(
          `Conversion failed [${platform}/${videoId}]: ${err.message}`,
          'MessageHandler',
        );

        // ─── Error Logs channel: full technical detail ────────────────────
        if (this.#errorLogger) {
          const errType = err.isDownloaderError ? ERROR_TYPES.DOWNLOADER
            : err.isPlatformError               ? ERROR_TYPES.PROVIDER
            : ERROR_TYPES.WORKER;

          const mem   = process.memoryUsage();
          const memMB = Math.round(mem.rss / 1024 / 1024);

          await this.#errorLogger.log(message.guildId, {
            category:        errType,
            errorMessage:    err.message,
            stack:           err.stack,
            platform,
            channelId:       ch,
            userId:          message.author.id,
            originalUrl:     url,
            queueId:         jobId,
            elapsedMs:       elapsed,
            lastProvider:    err._lastProvider   ?? null,
            triedProviders:  err._triedProviders ?? [],
            providerDetail:  err._providerDetail ?? null,
            nodeVersion:     process.version,
            memoryMB:        memMB,
            environment:     detectEnvironment(),
          });
        }
      },
    });
  }
}

/** Detect hosting environment for error logs. */
function detectEnvironment() {
  if (process.env.REPL_ID || process.env.REPL_SLUG) return 'Replit';
  if (process.env.RAILWAY_ENVIRONMENT)               return 'Railway';
  if (process.env.RENDER)                            return 'Render';
  if (process.env.HEROKU_APP_ID)                     return 'Heroku';
  if (process.env.P_SERVER_UUID)                     return 'Pterodactyl';
  if (os.platform() === 'win32')                     return 'Windows';
  return 'Linux / VPS';
}
