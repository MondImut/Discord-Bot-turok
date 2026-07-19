/**
 * MP4 Direct-Link Platform
 *
 * Handles direct MP4 attachments and URLs — bypasses YouTube/TikTok/Spotify providers.
 * Supported sources:
 *   - Discord CDN attachment URLs  (cdn.discordapp.com / media.discordapp.net)
 *   - GitHub Raw                   (raw.githubusercontent.com)
 *   - Top4Top MP4                  (top4top.io)
 *   - MediaFire direct             (mediafire.com ... .mp4)
 *   - Any URL whose pathname ends in .mp4
 *
 * Flow: URL → Downloader downloads → ffmpeg → Top4Top → BoomBox URL
 * No provider registry needed — single-step direct download.
 */

import { createHash } from 'crypto';

/**
 * Detect whether a URL points to a direct MP4 file.
 * Strips query string before checking extension.
 * @param {string} url
 * @returns {boolean}
 */
export function isMp4Url(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.mp4');
  } catch {
    return false;
  }
}

/**
 * Generate a stable dedup ID for an MP4 URL.
 * Query string is stripped so Discord CDN links with different expiry tokens
 * still hit the cache if it's the same file.
 * @param {string} url
 * @returns {string}  16-char hex ID
 */
export function extractMp4Id(url) {
  const base = url.split('?')[0];
  return createHash('sha256').update(base).digest('hex').slice(0, 16);
}

/**
 * "Resolve" an MP4 URL — just passes it through as audioUrl for Downloader.
 * Downloader will fetch → ffmpeg → Top4Top normally.
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function resolveMp4(url) {
  // Infer a human-friendly title from the filename
  let title = 'MP4 Upload';
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() ?? '';
    if (filename) title = decodeURIComponent(filename.replace(/\.[^.]+$/, '')) || title;
  } catch {}

  return {
    platform:     'mp4',
    id:           extractMp4Id(url),
    title,
    duration:     0,        // Unknown until ffmpeg probes it
    audioUrl:     url,      // Downloader downloads this → ffmpeg → Top4Top
    urlExpiresAt: null,
  };
}

/** isMp4Url covers detection — no separate check needed. */
export function isMp4Platform(url) { return isMp4Url(url); }

/** MP4 has no provider registry — return empty status. */
export function getMp4ProviderStatus() { return []; }
