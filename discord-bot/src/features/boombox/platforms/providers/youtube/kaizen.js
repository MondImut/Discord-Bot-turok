/**
 * YouTube Provider: kaizenapi.my.id
 *
 * Fast API provider — no API key required.
 * Returns audioUrl for Downloader to fetch + ffmpeg + Top4Top upload.
 * Timeout: 10s (fast-fail, move to next provider quickly).
 *
 * ctx.duration injected into result so Downloader can enforce max-duration.
 */

const API_BASE = 'https://kaizenapi.my.id/downloader/youtube';
const TIMEOUT_MS = 10_000;

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

export async function kaizenProvider(url, ctx = {}) {
  const apiUrl = `${API_BASE}?url=${encodeURIComponent(url)}`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)',
      'Accept':     'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Kaizen API HTTP ${res.status}`);

  const json = await res.json().catch(() => null);
  if (!json?.status || !json?.result) {
    throw new Error('Kaizen: respons tidak valid atau status gagal.');
  }

  const data     = json.result;
  const audioUrl = data.audio_mp3 ?? data.audio;
  if (!audioUrl) throw new Error('Kaizen: URL audio tidak ditemukan dalam respons.');

  const videoId = ctx.id ?? extractVideoId(url);

  return {
    platform:     'youtube',
    id:           videoId ?? url,
    title:        ctx.title || data.title || `YouTube ${videoId ?? 'Video'}`,
    duration:     ctx.duration || (typeof data.duration === 'number' ? data.duration : 0),
    audioUrl,
    urlExpiresAt: null,
  };
}
