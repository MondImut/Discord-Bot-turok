/**
 * Platforms — Unified entry point for all supported platforms.
 *
 * Each platform uses a ProviderRegistry for multi-provider fallback.
 * ctx (pre-fetched metadata) is forwarded to the registry and all providers:
 *   { id, title, duration }  — from YouTube preflight or TikTok/Spotify oEmbed.
 */

import { isYouTubeUrl, resolveYouTube, extractYouTubeId, getYouTubeProviderStatus } from './YouTube.js';
import { isTikTokUrl,  resolveTikTok,  extractTikTokId,  getTikTokProviderStatus  } from './TikTok.js';
import { isSpotifyUrl, resolveSpotify, extractSpotifyId, getSpotifyProviderStatus  } from './Spotify.js';
import { isMp4Url,     resolveMp4,     extractMp4Id,     getMp4ProviderStatus      } from './Mp4.js';

export { isMp4Url, extractMp4Id };

export const Platforms = {
  youtube: { detect: isYouTubeUrl, resolve: resolveYouTube, extractId: extractYouTubeId },
  tiktok:  { detect: isTikTokUrl,  resolve: resolveTikTok,  extractId: extractTikTokId  },
  spotify: { detect: isSpotifyUrl, resolve: resolveSpotify, extractId: (u) => extractSpotifyId(u)?.id },
  mp4:     { detect: isMp4Url,     resolve: resolveMp4,     extractId: extractMp4Id     },
};

/**
 * Detect the platform for a given URL.
 * @param {string} url
 * @returns {'youtube'|'tiktok'|'spotify'|'mp4'|null}
 */
export function detectPlatform(url) {
  for (const [name, p] of Object.entries(Platforms)) {
    if (p.detect(url)) return name;
  }
  return null;
}

/**
 * Extract the unique media ID from a URL.
 * @param {string} url
 * @param {string} platform
 * @returns {string|null}
 */
export function extractMediaId(url, platform) {
  const p = Platforms[platform];
  if (!p) return null;
  const result = p.extractId(url);
  return typeof result === 'string' ? result : null;
}

/**
 * Resolve a URL to metadata + BoomBox URL.
 *
 * @param {string} url
 * @param {string} platform
 * @param {object} logger
 * @param {object} [ctx={}]   Pre-fetched metadata { id, title, duration } — forwarded to providers.
 */
export async function resolveUrl(url, platform, logger, ctx = {}) {
  const p = Platforms[platform];
  if (!p) throw new Error(`Platform tidak dikenal: ${platform}`);
  return p.resolve(url, logger, ctx);
}

/**
 * Combined health snapshot for all platform registries.
 * Safe to call at any time — returns empty arrays for uninitialised registries.
 */
export function getAllProviderStatus() {
  return {
    youtube: getYouTubeProviderStatus(),
    tiktok:  getTikTokProviderStatus(),
    spotify: getSpotifyProviderStatus(),
    mp4:     getMp4ProviderStatus?.() ?? [],
  };
}
