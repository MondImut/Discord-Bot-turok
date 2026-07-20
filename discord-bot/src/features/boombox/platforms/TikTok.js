/**
 * TikTok Platform — Multi-provider extraction via ProviderRegistry.
 *
 * Provider order:
 *   1. tikwm.com   — primary, free public API
 *   2. ssstik.io   — scrape-based fallback
 *
 * ctx is accepted for API compatibility but not used (TikTok has no preflight).
 */

import { ProviderRegistry } from './ProviderRegistry.js';
import { tikwmProvider }    from './providers/tiktok/tikwm.js';
import { ssstikProvider }   from './providers/tiktok/ssstik.js';
import { URL_PATTERNS }     from '../constants.js';

let _registry = null;

export function getTikTokRegistry(logger) {
  if (!_registry) {
    _registry = new ProviderRegistry('TikTok', logger, { timeoutMs: 20_000 });
    _registry.register('tikwm',  tikwmProvider,  { timeoutMs: 15_000 });
    _registry.register('ssstik', ssstikProvider, { timeoutMs: 20_000 });
  }
  return _registry;
}

/** Return provider status only if the registry was already initialized. */
export function getTikTokProviderStatus() {
  return _registry?.getStatus() ?? [];
}

/** Check whether a URL looks like a TikTok URL. */
export function isTikTokUrl(url) {
  return /tiktok\.com/i.test(url);
}

/** Extract numeric video ID from a TikTok URL. */
export function extractTikTokId(url) {
  const direct = url.match(URL_PATTERNS.tiktok);
  if (direct) return direct[1];
  const short = url.match(URL_PATTERNS.tiktokShort);
  return short ? short[1] : null;
}

/**
 * Resolve a TikTok URL via the provider chain.
 * @param {string} url
 * @param {object} logger
 * @param {object} [ctx={}]   (unused for TikTok, kept for interface consistency)
 */
export async function resolveTikTok(url, logger, ctx = {}) {
  return getTikTokRegistry(logger).resolve(url, ctx);
}
