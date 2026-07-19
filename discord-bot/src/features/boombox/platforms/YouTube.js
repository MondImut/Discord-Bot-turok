/**
 * YouTube Platform — Multi-provider extraction via ProviderRegistry.
 *
 * Provider order (tried in sequence):
 *   1. yt-dlp      — binary, most reliable, downloads to local file
 *   2. Kaizen      — kaizenapi.my.id, no key required
 *   3. y2mp3       — hub.y2mp3.co (ytmp3.gg backend), no key required
 *   4. Cobalt      — cobalt.tools, skips if JWT required
 *
 * Note: ytdl-core removed — frequently blocked by YouTube bot-check.
 * All providers return { audioUrl } or { filePath }; Downloader handles
 * the download → ffmpeg → Top4Top pipeline.
 */

import { ProviderRegistry }                          from './ProviderRegistry.js';
import { ytdlpProvider, ytdlpCookiesProvider }       from './providers/youtube/ytdlp.js';
import { kaizenProvider }                            from './providers/youtube/kaizen.js';
import { y2mp3Provider  }                            from './providers/youtube/y2mp3.js';
import { cobaltProvider }                            from './providers/youtube/cobalt.js';
import { URL_PATTERNS }                              from '../constants.js';

// Module-level singleton — created once, survives for the life of the plugin.
let _registry = null;

export function getYouTubeRegistry(logger) {
  if (!_registry) {
    _registry = new ProviderRegistry('YouTube', logger);
    _registry.register('yt-dlp',         ytdlpProvider);         // 1. yt-dlp (no cookies)
    _registry.register('yt-dlp+cookies', ytdlpCookiesProvider);  // 2. yt-dlp with cookies file
    _registry.register('kaizen',         kaizenProvider);        // 3. kaizenapi.my.id
    _registry.register('y2mp3',          y2mp3Provider);         // 4. hub.y2mp3.co
    _registry.register('cobalt',         cobaltProvider);        // 5. cobalt.tools (if accessible)
  }
  return _registry;
}

/** Return provider status only if the registry was already initialized. Safe at any time. */
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

/** Resolve a YouTube URL via the provider chain. */
export async function resolveYouTube(url, logger) {
  return getYouTubeRegistry(logger).resolve(url);
}

/** Format seconds → mm:ss or hh:mm:ss */
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
