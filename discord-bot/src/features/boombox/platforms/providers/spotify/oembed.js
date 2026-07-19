/**
 * Spotify Provider: oEmbed + page scraping
 * Only provider (no free Spotify API for audio).
 * Returns 30-second preview MP3 audioUrl for Downloader to fetch.
 */

import { URL_PATTERNS } from '../../../constants.js';

function extractSpotifyId(url) {
  const m = url.match(URL_PATTERNS.spotify);
  return m ? { type: m[1], id: m[2] } : null;
}

export async function oembedProvider(url) {
  const meta = extractSpotifyId(url);
  if (!meta) throw new Error('URL Spotify tidak valid.');
  if (meta.type !== 'track') throw new Error('Hanya Spotify Track yang didukung saat ini.');

  // Step 1: metadata via oEmbed
  const oembedRes = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)' },
      signal:  AbortSignal.timeout(10_000),
    },
  );
  if (!oembedRes.ok) throw new Error(`Spotify oEmbed ${oembedRes.status}`);
  const oembed = await oembedRes.json();

  // Step 2: preview URL via __NEXT_DATA__ scrape, with embed fallback
  let previewUrl;
  try {
    previewUrl = await scrapePreview(meta.id);
  } catch {
    previewUrl = `https://open.spotify.com/embed/track/${meta.id}`;
  }

  return {
    platform:     'spotify',
    id:           meta.id,
    title:        oembed.title || `Spotify Track ${meta.id}`,
    duration:     30,
    audioUrl:     previewUrl,  // 30s preview MP3 — Downloader will download → ffmpeg → Top4Top
    urlExpiresAt: null,
  };
}

async function scrapePreview(trackId) {
  const res = await fetch(`https://open.spotify.com/track/${trackId}`, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Spotify page ${res.status}`);
  const html = await res.text();

  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const p    = data?.props?.pageProps?.state?.data?.entity?.audioPreview?.url;
      if (p) return p;
    } catch { /* ignore */ }
  }

  const direct = html.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[a-f0-9]+[^"'\s]*/);
  if (direct) return direct[0];

  throw new Error('Spotify preview URL tidak ditemukan.');
}
