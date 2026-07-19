/**
 * YouTube Provider: hub.y2mp3.co (ytmp3.gg backend)
 * No API key required. Returns audioUrl for Downloader to fetch.
 * Reference: ytmp3gg.js (provided by user).
 */

const HUB_API = 'https://hub.y2mp3.co';
const UA      = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

export async function y2mp3Provider(url) {
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
      audioBitrate: '64',   // low bitrate for speed
    }),
    signal: AbortSignal.timeout(13_000),
  });

  if (!res.ok) throw new Error(`y2mp3 API ${res.status}`);

  const data = await res.json();
  if (!data?.url) throw new Error('y2mp3: respons tidak mengandung URL.');

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
    urlExpiresAt: null,
  };
}
