/**
 * Platforms — Unified entry point for all supported platforms.
 * Each platform now uses a ProviderRegistry for multi-provider fallback.
 * mp4: direct-download platform, no provider registry needed.
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
 * @returns {'youtube'|'tiktok'|'spotify'|null}
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
 * @param {string} url
 * @param {string} platform
 * @param {object} logger   — passed to ProviderRegistry for logging
 */
export async function resolveUrl(url, platform, logger) {
  const p = Platforms[platform];
  if (!p) throw new Error(`Platform tidak dikenal: ${platform}`);
  return p.resolve(url, logger);
}

/**
 * Get a combined health snapshot for all platform registries.
 * Safe to call at any time — returns empty arrays for registries not yet initialized.
 * @returns {{ youtube: ProviderStatus[], tiktok: ProviderStatus[], spotify: ProviderStatus[] }}
 */
export function getAllProviderStatus() {
  return {
    youtube: getYouTubeProviderStatus(),
    tiktok:  getTikTokProviderStatus(),
    spotify: getSpotifyProviderStatus(),
  };
}
