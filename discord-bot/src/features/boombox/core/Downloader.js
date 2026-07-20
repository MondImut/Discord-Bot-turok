/**
 * Downloader — Converts a URL to a permanent BoomBox URL via Top4Top.
 *
 * Pipeline for each job:
 *   1. SmartCache check (in-memory, O(1))
 *   2. In-flight dedup (concurrent requests share one promise)
 *   3. Platform provider chain → { audioUrl | filePath, title, id, ... }
 *   4. If filePath: already on disk (yt-dlp). Otherwise fetch audioUrl → temp file.
 *   5. ffmpeg → 64 kbps MP3 temp file
 *   6. Upload to Top4Top → permanent BoomBox URL
 *   7. Clean up all temp files
 *   8. Persist to DB + SmartCache
 *
 * Debug checkpoints:
 *   [BoomBox] Download Success  — provider chain resolved
 *   [BoomBox] Upload Success    — Top4Top upload done
 *   [BoomBox] Database Saved    — DB + cache persisted
 */

import { randomBytes }        from 'crypto';
import { tmpdir }             from 'os';
import { join }               from 'path';
import { writeFile }          from 'fs/promises';

import { resolveUrl, getAllProviderStatus } from '../platforms/index.js';
import { convertToMp3 }                    from '../utils/ffmpeg.js';
import { uploadToTop4Top }                 from '../upload/top4top.js';
import { TempCleaner }                     from '../utils/TempCleaner.js';

const DOWNLOAD_TIMEOUT_MS = 90_000;

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

    // ── 3. Provider chain ─────────────────────────────────────────────────
    let resolved;
    try {
      resolved = await resolveUrl(url, platform, this.#logger);
    } catch (err) {
      err.isPlatformError = true;
      throw err;
    }

    // ── [BoomBox] Download Success ─────────────────────────────────────────
    this.#logger.info(
      `[BoomBox] Download Success — platform=${platform} provider=${resolved._provider ?? 'unknown'} elapsed=${Date.now() - t0}ms`,
      'Downloader',
    );

    // ── 3b. Max-duration enforcement (pre-download) ───────────────────────
    // Check BEFORE heavy download/ffmpeg/upload to avoid wasted processing.
    const config = this.#db.getConfig(guildId);
    const platCode = { youtube: 'yt', tiktok: 'tk', spotify: 'sp' }[platform];
    const maxDur = platCode && config ? (config[`${platCode}_max_duration`] ?? 0) : 0;
    if (maxDur > 0 && resolved.duration > 0 && resolved.duration > maxDur) {
      const durErr = new Error(
        `Durasi media (${resolved.duration}s) melebihi batas maksimum yang dikonfigurasi (${maxDur}s).`
      );
      durErr.isMaxDurationError = true;
      durErr.duration = resolved.duration;
      durErr.maxDuration = maxDur;
      throw durErr;
    }

    // ── 4-7. Download → ffmpeg → Top4Top upload → cleanup ────────────────
    const uid     = randomBytes(6).toString('hex');
    const cleaner = new TempCleaner(this.#logger);
    let boomboxUrl;

    try {
      let rawFile = resolved.filePath ?? null;

      // 4. Fetch audioUrl to disk (if provider didn't already download)
      if (!rawFile) {
        if (!resolved.audioUrl) {
          throw new Error(`Provider '${resolved.platform}' tidak menghasilkan audioUrl maupun filePath.`);
        }
        rawFile = await this.#fetchToFile(resolved.audioUrl, uid, platform);
        cleaner.track(rawFile);
      } else {
        cleaner.track(rawFile); // yt-dlp file — delete after upload
      }

      // 5. ffmpeg → 64 kbps MP3 (async — does not block event loop)
      const mp3Path = join(tmpdir(), `boombox_${uid}.mp3`);
      cleaner.track(mp3Path);
      this.#logger.debug(`ffmpeg: ${rawFile} → ${mp3Path}`, 'Downloader');
      await convertToMp3(rawFile, mp3Path);

      // 6. Upload to Top4Top
      this.#logger.debug(`Top4Top upload: ${mp3Path}`, 'Downloader');
      const { url: t4tUrl } = await uploadToTop4Top(mp3Path);
      boomboxUrl = t4tUrl;

      // ── [BoomBox] Upload Success ─────────────────────────────────────────
      this.#logger.info(
        `[BoomBox] Upload Success — platform=${platform} url=${boomboxUrl?.slice(0, 60)} elapsed=${Date.now() - t0}ms`,
        'Downloader',
      );

    } catch (err) {
      err.isPlatformError = true;
      throw err;
    } finally {
      // 7. Always clean up temp files
      await cleaner.flush();
    }

    // ── 8. Persist + cache ────────────────────────────────────────────────
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

    // ── [BoomBox] Database Saved ─────────────────────────────────────────
    this.#logger.info(
      `[BoomBox] Database Saved — platform=${platform} id=${resolved.id} elapsed=${Date.now() - t0}ms`,
      'Downloader',
    );

    return { media, cacheHit: false };
  }

  /**
   * Download a CDN URL to a local temp file.
   * Follows up to 3 redirects (Node.js fetch does this automatically).
   */
  async #fetchToFile(audioUrl, uid, platform) {
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

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(filePath, buffer);
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
