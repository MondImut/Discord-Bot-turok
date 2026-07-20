/**
 * Downloader — Converts a URL to a permanent BoomBox URL via Top4Top.
 *
 * Pipeline for each job:
 *   1. SmartCache check (in-memory, O(1))
 *   2. In-flight dedup (concurrent requests share one promise)
 *   3. [YouTube only] Preflight — fast metadata check (title, duration, availability)
 *      → rejects private/deleted videos early (saves 60-120s of wasted processing)
 *      → ctx { id, title, duration } forwarded to all providers
 *   4. Platform provider chain → { audioUrl | filePath, title, id, duration, ... }
 *   5. Max-duration enforcement (uses preflight duration if available)
 *   6. If filePath: already on disk (yt-dlp). Otherwise STREAM audioUrl → temp file.
 *   7. ffmpeg → 64 kbps MP3 (async, does NOT block event loop)
 *   8. Upload to Top4Top → permanent BoomBox URL
 *   9. Clean up all temp files
 *  10. Persist to DB + SmartCache
 *
 * Streaming download (#fetchToFile):
 *   Uses ReadableStream → createWriteStream instead of arrayBuffer().
 *   Prevents OOM for large audio files from API providers.
 *
 * Debug checkpoints:
 *   [BoomBox] Preflight OK    — metadata fetched for YouTube
 *   [BoomBox] Download OK     — provider chain resolved
 *   [BoomBox] Upload OK       — Top4Top upload done
 *   [BoomBox] Database Saved  — DB + cache persisted
 */

import { randomBytes }        from 'crypto';
import { tmpdir }             from 'os';
import { join }               from 'path';
import { createWriteStream }  from 'fs';

import { resolveUrl, getAllProviderStatus } from '../platforms/index.js';
import { preflightYouTube }                from '../platforms/providers/youtube/preflight.js';
import { convertToMp3 }                    from '../utils/ffmpeg.js';
import { uploadToTop4Top }                 from '../upload/top4top.js';
import { TempCleaner }                     from '../utils/TempCleaner.js';

const DOWNLOAD_TIMEOUT_MS  = 120_000;   // 2 min for CDN fetch (long videos from API providers)

export class Downloader {
  #db;
  #cache;
  #logger;

  /** Map<dedup_key, Promise<result>> */
  #inFlight = new Map();

  constructor(db, cache, logger) {
    this.#db     = db;
    this.#cache  = cache;
    this.#logger = logger;
  }

  /**
   * Convert a job to a BoomBox result.
   * @param {{ guildId, url, platform, videoId }} job
   * @returns {Promise<{ media, cacheHit: boolean }>}
   */
  async convert(job) {
    const { guildId, url, platform, videoId } = job;

    // ── 1. SmartCache hit ──────────────────────────────────────────────────
    if (videoId) {
      const cachedUrl = this.#cache.get(guildId, platform, videoId);
      if (cachedUrl) {
        this.#logger.debug(`Cache hit: ${platform}/${videoId}`, 'Downloader');
        const media = this.#db.findMedia(guildId, platform, videoId);
        if (media) {
          this.#db.touchMedia(media.id);
          return { media: { ...media, boombox_url: cachedUrl }, cacheHit: true };
        }
        // Cache has URL but DB row missing — invalidate and fall through
        this.#cache.invalidate(guildId, platform, videoId);
      }
    }

    // ── 2. In-flight dedup ────────────────────────────────────────────────
    const dedupKey = `${guildId}:${platform}:${videoId ?? url}`;
    if (this.#inFlight.has(dedupKey)) {
      this.#logger.debug(`In-flight hit: ${platform}/${videoId}`, 'Downloader');
      return this.#inFlight.get(dedupKey);
    }

    const promise = this.#resolve(job).finally(() => this.#inFlight.delete(dedupKey));
    this.#inFlight.set(dedupKey, promise);
    return promise;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  async #resolve(job) {
    const { guildId, url, platform } = job;
    const t0 = Date.now();

    this.#logger.debug(`Resolving from ${platform}: ${url}`, 'Downloader');

    // ── 3. Preflight (YouTube only) ───────────────────────────────────────
    // Fast metadata check: availability + duration before provider chain runs.
    // - Private/deleted/unavailable → throws immediately (no wasted 60-120s)
    // - Duration → dynamic yt-dlp timeout; max-duration enforcement pre-download
    // - Degrades gracefully: preflight failure (timeout, ENOENT) → ctx = {}
    let ctx = {};
    if (platform === 'youtube') {
      try {
        const preflight = await preflightYouTube(url);
        if (preflight) {
          ctx = preflight;   // { id, title, duration }
          this.#logger.debug(
            `[BoomBox] Preflight OK — id=${ctx.id} duration=${ctx.duration}s title="${ctx.title?.slice(0, 50)}"`,
            'Downloader',
          );

          // Pre-check max-duration using preflight duration (avoids wasting download bandwidth)
          if (ctx.duration > 0) {
            const config  = this.#db.getConfig(guildId);
            const maxDur  = config?.yt_max_duration ?? 0;
            if (maxDur > 0 && ctx.duration > maxDur) {
              const durErr = new Error(
                `Durasi video (${ctx.duration}s ≈ ${Math.ceil(ctx.duration / 60)} menit) ` +
                `melebihi batas yang dikonfigurasi (${maxDur}s).`
              );
              durErr.isMaxDurationError = true;
              durErr.duration    = ctx.duration;
              durErr.maxDuration = maxDur;
              throw durErr;
            }
          }
        }
      } catch (err) {
        // Re-throw hard failures (private video, max-duration exceeded)
        if (err.isMaxDurationError || /tidak tersedia|private|dihapus/i.test(err.message)) {
          throw err;
        }
        // Soft failures (timeout, network) → proceed without ctx
        this.#logger.debug(`Preflight failed (non-fatal): ${err.message}`, 'Downloader');
      }
    }

    // ── 4. Provider chain ─────────────────────────────────────────────────
    let resolved;
    try {
      resolved = await resolveUrl(url, platform, this.#logger, ctx);
    } catch (err) {
      err.isPlatformError = true;
      throw err;
    }

    this.#logger.info(
      `[BoomBox] Download OK — platform=${platform} provider=${resolved._provider ?? 'unknown'} elapsed=${Date.now() - t0}ms`,
      'Downloader',
    );

    // ── 5. Max-duration enforcement (post-provider, catches API providers) ─
    // API providers (Kaizen, y2mp3) return ctx.duration; yt-dlp returns real duration.
    const config   = this.#db.getConfig(guildId);
    const platCode = { youtube: 'yt', tiktok: 'tk', spotify: 'sp' }[platform];
    const maxDur   = platCode && config ? (config[`${platCode}_max_duration`] ?? 0) : 0;
    const duration = resolved.duration ?? 0;
    if (maxDur > 0 && duration > 0 && duration > maxDur) {
      const durErr = new Error(
        `Durasi media (${duration}s ≈ ${Math.ceil(duration / 60)} menit) ` +
        `melebihi batas yang dikonfigurasi (${maxDur}s).`
      );
      durErr.isMaxDurationError = true;
      durErr.duration    = duration;
      durErr.maxDuration = maxDur;
      throw durErr;
    }

    // ── 6-9. Download → ffmpeg → Top4Top upload → cleanup ────────────────
    const uid     = randomBytes(6).toString('hex');
    const cleaner = new TempCleaner(this.#logger);
    let boomboxUrl;

    try {
      let rawFile = resolved.filePath ?? null;

      // 6. Stream audioUrl to disk if provider gave CDN URL (not local file)
      if (!rawFile) {
        if (!resolved.audioUrl) {
          throw new Error(`Provider '${resolved._provider}' tidak menghasilkan audioUrl maupun filePath.`);
        }
        rawFile = await this.#streamToFile(resolved.audioUrl, uid, platform);
        cleaner.track(rawFile);
      } else {
        cleaner.track(rawFile); // yt-dlp temp file — delete after upload
      }

      // 7. ffmpeg → 64 kbps MP3 (async — does NOT block event loop)
      const mp3Path = join(tmpdir(), `boombox_${uid}.mp3`);
      cleaner.track(mp3Path);
      this.#logger.debug(`ffmpeg: ${rawFile} → ${mp3Path}`, 'Downloader');
      await convertToMp3(rawFile, mp3Path);

      // 8. Upload to Top4Top
      this.#logger.debug(`Top4Top upload: ${mp3Path}`, 'Downloader');
      const { url: t4tUrl } = await uploadToTop4Top(mp3Path);
      boomboxUrl = t4tUrl;

      this.#logger.info(
        `[BoomBox] Upload OK — platform=${platform} url=${boomboxUrl?.slice(0, 60)} elapsed=${Date.now() - t0}ms`,
        'Downloader',
      );

    } catch (err) {
      err.isPlatformError = true;
      // Attach media title for richer error logs
      err._mediaTitle = resolved.title ?? ctx.title ?? null;
      throw err;
    } finally {
      // 9. Always clean up temp files
      await cleaner.flush();
    }

    // ── 10. Persist + cache ───────────────────────────────────────────────
    let media;
    try {
      media = this.#db.upsertMedia(guildId, {
        platform:     resolved.platform,
        videoId:      resolved.id,
        title:        resolved.title,
        duration:     resolved.duration,
        boomboxUrl,
        urlExpiresAt: null,  // Top4Top URLs are permanent
      });
    } catch (err) {
      err.isDownloaderError = true;
      throw err;
    }

    // Top4Top URLs are permanent — no TTL
    this.#cache.set(guildId, resolved.platform, resolved.id, boomboxUrl, null);

    this.#logger.info(
      `[BoomBox] Database Saved — platform=${platform} id=${resolved.id} elapsed=${Date.now() - t0}ms`,
      'Downloader',
    );

    return { media, cacheHit: false };
  }

  /**
   * Stream a CDN URL to a local temp file without buffering the entire file in RAM.
   * Uses ReadableStream chunks → createWriteStream for memory-efficient downloads.
   * @param {string} audioUrl
   * @param {string} uid
   * @param {string} platform
   * @returns {Promise<string>} Local file path
   */
  async #streamToFile(audioUrl, uid, platform) {
    const ext      = this.#guessExt(audioUrl, platform);
    const filePath = join(tmpdir(), `boombox_raw_${uid}.${ext}`);

    const res = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        'Accept':     '*/*',
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Download gagal HTTP ${res.status}: ${audioUrl.slice(0, 100)}`);
    }

    if (!res.body) {
      throw new Error('Response tidak memiliki body stream.');
    }

    // Stream chunks to disk — avoids loading the entire file into memory
    const writer = createWriteStream(filePath);
    const reader = res.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Respect backpressure — wait for drain if the write buffer is full
        const ok = writer.write(value);
        if (!ok) {
          await new Promise((resolve, reject) => {
            writer.once('drain', resolve);
            writer.once('error', reject);
          });
        }
      }
    } catch (err) {
      writer.destroy(err);
      throw err;
    } finally {
      reader.releaseLock();
    }

    await new Promise((resolve, reject) => {
      writer.end();
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    return filePath;
  }

  /** Guess file extension from URL or fall back to platform default. */
  #guessExt(url, platform) {
    const urlExt = url.split('?')[0].split('.').pop()?.toLowerCase();
    if (['mp3', 'm4a', 'ogg', 'opus', 'webm', 'mp4', 'wav'].includes(urlExt)) return urlExt;
    return platform === 'youtube' ? 'm4a' : 'mp4';
  }

  /** How many in-flight platform requests are currently pending. */
  get inFlightCount() { return this.#inFlight.size; }

  /** Snapshot of all provider health stats for the monitor panel. */
  get providerStatus() { return getAllProviderStatus(); }
}
