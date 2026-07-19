/**
 * YouTube Provider: cobalt.tools
 * Free public API — no key required. Returns audioUrl for Downloader to fetch.
 * JWT check: if Cobalt demands JWT, skip gracefully (throw).
 * API spec: https://github.com/imputnet/cobalt
 */

const COBALT_API = 'https://api.cobalt.tools/';
const TTL_MS     = 60 * 60 * 1000; // ~1 h conservative estimate

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

export async function cobaltProvider(url) {
  const res = await fetch(COBALT_API, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body:   JSON.stringify({ url, downloadMode: 'audio', audioFormat: 'mp3', audioBitrate: '64' }),
    signal: AbortSignal.timeout(13_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Cobalt sometimes returns 401/403 when JWT is required — skip immediately
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Cobalt membutuhkan JWT (${res.status}) — skip.`);
    }
    throw new Error(`Cobalt API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();

  // Skip if Cobalt reports JWT/auth error in body
  if (data.status === 'error') {
    const code = data.error?.code ?? '';
    if (code.includes('auth') || code.includes('jwt')) {
      throw new Error(`Cobalt JWT diperlukan: ${code}`);
    }
    throw new Error(`Cobalt: ${code || 'unknown error'}`);
  }

  if (!data.url) {
    throw new Error('Cobalt: respons tidak mengandung URL.');
  }

  const videoId = extractVideoId(url);
  const title   = data.filename
    ? data.filename.replace(/\.[^.]+$/, '')
    : `YouTube ${videoId ?? 'Video'}`;

  return {
    platform:     'youtube',
    id:           videoId ?? url,
    title,
    duration:     0,
    audioUrl:     data.url,   // CDN URL — Downloader will download → ffmpeg → Top4Top
    urlExpiresAt: Math.floor((Date.now() + TTL_MS) / 1000),
  };
}
