/**
 * YouTube Provider: cobalt.tools
 *
 * Free public API — no key required (skips gracefully if JWT demanded).
 * Returns audioUrl for Downloader to fetch + ffmpeg + Top4Top upload.
 * Timeout: 10s (fast-fail).
 *
 * ctx.duration injected into result so Downloader can enforce max-duration.
 * API spec: https://github.com/imputnet/cobalt
 */

const COBALT_API = 'https://api.cobalt.tools/';
const TIMEOUT_MS = 10_000;

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

export async function cobaltProvider(url, ctx = {}) {
  const res = await fetch(COBALT_API, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body:   JSON.stringify({ url, downloadMode: 'audio', audioFormat: 'mp3', audioBitrate: '64' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Cobalt membutuhkan JWT (HTTP ${res.status}) — skip.`);
    }
    if (res.status === 429) {
      throw new Error('Cobalt rate limit — skip.');
    }
    throw new Error(`Cobalt API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);
  if (!data) throw new Error('Cobalt: respons JSON tidak valid.');

  if (data.status === 'error') {
    const code = data.error?.code ?? '';
    if (code.includes('auth') || code.includes('jwt')) {
      throw new Error(`Cobalt JWT diperlukan: ${code} — skip.`);
    }
    throw new Error(`Cobalt error: ${code || 'unknown'}`);
  }

  if (!data.url) throw new Error('Cobalt: respons tidak mengandung URL.');

  const videoId = ctx.id ?? extractVideoId(url);
  const title   = ctx.title || (data.filename
    ? data.filename.replace(/\.[^.]+$/, '')
    : `YouTube ${videoId ?? 'Video'}`);

  return {
    platform:     'youtube',
    id:           videoId ?? url,
    title,
    duration:     ctx.duration || 0,
    audioUrl:     data.url,
    // Cobalt CDN URLs expire — use conservative estimate
    urlExpiresAt: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
  };
}
