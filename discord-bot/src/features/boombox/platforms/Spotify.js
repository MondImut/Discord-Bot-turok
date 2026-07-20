/**
 * Spotify Platform — Multi-provider extraction via ProviderRegistry.
 *
 * Provider order:
 *   1. oembed           — Spotify oEmbed metadata + yt-dlp YouTube Music search (full audio)
 *   2. youtube-search   — Spotify oEmbed metadata + YouTube search scrape (no yt-dlp)
 *
 * The oembed provider is the primary path and uses yt-dlp to search + download.
 * If yt-dlp is unavailable or fails, youtube-search scrapes YouTube for a video ID
 * and falls through to the YouTube provider chain (Kaizen → y2mp3 → Cobalt).
 *
 * Registry timeout: 50s (covers oembed's 40s internal yt-dlp timeout + margin).
 */

import { ProviderRegistry }      from './ProviderRegistry.js';
import { oembedProvider }        from './providers/spotify/oembed.js';
import { youtubeSearchProvider } from './providers/spotify/youtube-search.js';
import { URL_PATTERNS }          from '../constants.js';

let _registry = null;

function getSpotifyRegistry(logger) {
  if (!_registry) {
    _registry = new ProviderRegistry('Spotify', logger, { timeoutMs: 50_000 });
    _registry.register('oembed',         oembedProvider,        { timeoutMs: 50_000 }); // yt-dlp search+download
    _registry.register('youtube-search', youtubeSearchProvider, { timeoutMs: 45_000 }); // scrape fallback
  }
  return _registry;
}

/** Return provider status only if the registry was already initialized. */
export function getSpotifyProviderStatus() {
  return _registry?.getStatus() ?? [];
}

/** Check whether a URL looks like a Spotify URL. */
export function isSpotifyUrl(url) {
  return /open\.spotify\.com/i.test(url);
}

/** Extract Spotify track/album/playlist metadata from URL. */
export function extractSpotifyId(url) {
  const m = url.match(URL_PATTERNS.spotify);
  return m ? { type: m[1], id: m[2] } : null;
}

/**
 * Resolve a Spotify track URL via the provider chain.
 * @param {string} url
 * @param {object} logger
 * @param {object} [ctx={}]   (unused for Spotify, kept for interface consistency)
 */
export async function resolveSpotify(url, logger, ctx = {}) {
  return getSpotifyRegistry(logger).resolve(url, ctx);
}
