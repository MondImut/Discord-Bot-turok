/**
 * YouTube Provider: hub.y2mp3.co (ytmp3.gg backend)
 *
 * Fast API provider — no API key required.
 * Returns audioUrl for Downloader to fetch + ffmpeg + Top4Top upload.
 * Timeout: 10s (fast-fail, move to next provider quickly).
 *
 * ctx.duration injected into result so Downloader can enforce max-duration.
 */

const HUB_API    = 'https://hub.y2mp3.co';
const TIMEOUT_MS = 10_000;
const UA         = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

export async function y2mp3Provider(url, ctx = {}) {
  const res = await fetch(HUB_API, {
    method:  'POST',
    headers: {
      'User-Agent':   UA,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'origin':       'https://ytmp3.gg',
      'referer':      'https://ytmp3.gg/',
    },
    body: JSON.stringify({
      url,
      downloadMode: 'audio',
      brandName:    'ytmp3.gg',
      audioFormat:  'mp3',
      audioBitrate: '64',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`y2mp3 API HTTP ${res.status}`);

  const data = await res.json().catch(() => null);
  if (!data?.url) throw new Error('y2mp3: respons tidak mengandung URL audio.');

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
    urlExpiresAt: null,
  };
}
