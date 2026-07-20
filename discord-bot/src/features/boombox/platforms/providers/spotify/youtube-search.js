/**
 * Spotify Fallback Provider: YouTube Search (non-yt-dlp)
 *
 * Digunakan jika yt-dlp tidak tersedia atau gagal.
 * Flow:
 *   1. Spotify oEmbed → title, artist (metadata only)
 *   2. Scrape YouTube search page → video ID pertama
 *   3. Resolve via YouTube provider chain (Kaizen → y2mp3 → Cobalt)
 *   4. Return result dengan platform: 'spotify' + Spotify track ID
 *
 * Tidak menggunakan yt-dlp sama sekali.
 */

import { URL_PATTERNS } from '../../../constants.js';
import { getYouTubeRegistry } from '../../YouTube.js';

function extractSpotifyId(url) {
  const m = url.match(URL_PATTERNS.spotify);
  return m ? { type: m[1], id: m[2] } : null;
}

/** Ambil title + artist dari Spotify oEmbed */
async function fetchSpotifyMeta(url) {
  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)' },
      signal:  AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`Spotify oEmbed gagal: HTTP ${res.status}`);
  const data   = await res.json();
  const title  = data.title       || '';
  const artist = data.author_name || '';
  if (!title) throw new Error('Spotify oEmbed: judul lagu tidak ditemukan.');
  return { title, artist };
}

/**
 * Cari video ID pertama dari YouTube Music search.
 * Scrape halaman results — tidak butuh API key.
 */
async function searchYouTubeMusicId(query) {
  // Coba YouTube Music dulu
  for (const baseUrl of [
    `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  ]) {
    try {
      const res = await fetch(baseUrl, {
        headers: {
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      // YouTube embeds video IDs inside ytInitialData JSON
      const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      if (match?.[1]) return match[1];
    } catch { /* try next */ }
  }
  return null;
}

export async function youtubeSearchProvider(url) {
  const meta = extractSpotifyId(url);
  if (!meta) throw new Error('URL Spotify tidak valid.');
  if (meta.type !== 'track') throw new Error('Hanya Spotify Track yang didukung saat ini.');

  // Step 1: metadata dari Spotify (judul + artis, TANPA audio)
  const { title, artist } = await fetchSpotifyMeta(url);
  const query = artist ? `${title} ${artist}` : title;

  // Step 2: cari video ID dari YouTube Music / YouTube
  const videoId = await searchYouTubeMusicId(query);
  if (!videoId) {
    throw new Error(`Spotify→YouTube: tidak menemukan video untuk "${query}".`);
  }

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Step 3: resolve via YouTube provider chain (Kaizen → y2mp3 → Cobalt)
  // getYouTubeRegistry adalah singleton; logger null aman karena sudah init sebelumnya
  const registry = getYouTubeRegistry(null);
  const ytResult = await registry.resolve(ytUrl);

  // Step 4: return dengan identity Spotify (untuk caching per track ID)
  return {
    ...ytResult,
    platform:     'spotify',
    id:           meta.id,        // Spotify track ID untuk cache key
    title:        ytResult.title || title,
    urlExpiresAt: null,
  };
}
