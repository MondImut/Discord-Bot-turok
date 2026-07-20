/**
 * YouTube Platform — Multi-provider extraction via ProviderRegistry.
 *
 * Provider order (tried in sequence):
 *   1. yt-dlp           — binary; most reliable; dynamic timeout based on duration
 *   2. yt-dlp+cookies   — skips if no cookies.txt found
 *   3. kaizen           — kaizenapi.my.id; fast API (10s timeout)
 *   4. y2mp3            — hub.y2mp3.co (ytmp3.gg backend); fast API (10s timeout)
 *   5. cobalt           — cobalt.tools; skips if JWT required (10s timeout)
 *
 * Per-provider timeouts:
 *   yt-dlp / yt-dlp+cookies — 120s registry timeout; internal dynamic timer fires first
 *   API providers           — 15s registry timeout; internal 10s AbortSignal fires first
 *
 * Preflight:
 *   Runs before the registry to get { id, title, duration } quickly.
 *   Allows early rejection of private/unavailable videos.
 *   Passes ctx to all providers for dynamic timeout + duration enforcement.
 */

import { ProviderRegistry }                          from './ProviderRegistry.js';
import { ytdlpProvider, ytdlpCookiesProvider }       from './providers/youtube/ytdlp.js';
import { kaizenProvider }                            from './providers/youtube/kaizen.js';
import { y2mp3Provider }                             from './providers/youtube/y2mp3.js';
import { cobaltProvider }                            from './providers/youtube/cobalt.js';
import { preflightYouTube }                          from './providers/youtube/preflight.js';
import { URL_PATTERNS }                              from '../constants.js';

// Module-level singleton — created once, survives for the life of the plugin.
let _registry = null;

export function getYouTubeRegistry(logger) {
  if (!_registry) {
    // Default registry timeout is 120s (safety net for long yt-dlp runs).
    // Each provider configures its own per-provider timeout below.
    _registry = new ProviderRegistry('YouTube', logger, { timeoutMs: 120_000 });

    // yt-dlp: 120s registry timeout; internal dynamic timer (20-120s) fires first
    _registry.register('yt-dlp',         ytdlpProvider,        { timeoutMs: 120_000 });
    // yt-dlp+cookies: skips immediately if no cookies.txt → near-zero overhead
    _registry.register('yt-dlp+cookies', ytdlpCookiesProvider, { timeoutMs: 120_000 });
    // API providers: 15s registry timeout; internal 10s AbortSignal fires first
    _registry.register('kaizen',         kaizenProvider,       { timeoutMs: 15_000  });
    _registry.register('y2mp3',          y2mp3Provider,        { timeoutMs: 15_000  });
    _registry.register('cobalt',         cobaltProvider,       { timeoutMs: 15_000  });
  }
  return _registry;
}

/** Return provider status only if the registry was already initialized. */
export function getYouTubeProviderStatus() {
  return _registry?.getStatus() ?? [];
}

/** Check whether a URL looks like a YouTube URL. */
export function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(url);
}

/** Extract video ID from any YouTube URL variant. */
export function extractYouTubeId(url) {
  const m = url.match(URL_PATTERNS.youtube);
  return m ? m[1] : null;
}

/**
 * Resolve a YouTube URL via preflight → provider chain.
 *
 * @param {string} url
 * @param {object} logger
 * @param {object} [ctx={}]   Pre-fetched ctx (e.g. from Downloader's preflight).
 *                            If present, skips the internal preflight.
 * @returns {Promise<object>} Platform result
 */
export async function resolveYouTube(url, logger, ctx = {}) {
  return getYouTubeRegistry(logger).resolve(url, ctx);
}

/** Format seconds → mm:ss or hh:mm:ss */
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Re-export preflight for use in Downloader
export { preflightYouTube };
