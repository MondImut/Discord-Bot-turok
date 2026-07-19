/**
 * Spotify Platform — Single provider via ProviderRegistry.
 *
 * Provider:
 *   1. oembed — oEmbed metadata + page scrape for 30-sec preview URL
 *      (Only free option without a Spotify API key)
 */

import { ProviderRegistry } from './ProviderRegistry.js';
import { oembedProvider }   from './providers/spotify/oembed.js';
import { URL_PATTERNS }     from '../constants.js';

let _registry = null;

export function getSpotifyRegistry(logger) {
  if (!_registry) {
    _registry = new ProviderRegistry('Spotify', logger);
    _registry.register('oembed', oembedProvider);
  }
  return _registry;
}

/** Return provider status only if the registry was already initialized. Safe at any time. */
export function getSpotifyProviderStatus() {
  return _registry?.getStatus() ?? [];
}

/** Check whether a URL looks like a Spotify URL. */
export function isSpotifyUrl(url) {
  return /open\.spotify\.com/i.test(url);
}

/** Extract track/album/playlist type and ID from Spotify URL. */
export function extractSpotifyId(url) {
  const m = url.match(URL_PATTERNS.spotify);
  return m ? { type: m[1], id: m[2] } : null;
}

/**
 * Resolve a Spotify track URL via the provider chain.
 * @param {string} url
 * @param {object} logger
 */
export async function resolveSpotify(url, logger) {
  return getSpotifyRegistry(logger).resolve(url);
}
