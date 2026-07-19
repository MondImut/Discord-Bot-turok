/**
 * YouTube Provider: kaizenapi.my.id
 * No API key required. Returns audioUrl for Downloader to fetch.
 */

const API_BASE = 'https://kaizenapi.my.id/downloader/youtube';

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

export async function kaizenProvider(url) {
  const apiUrl = `${API_BASE}?url=${encodeURIComponent(url)}`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)',
      'Accept':     'application/json',
    },
    signal: AbortSignal.timeout(13_000),
  });

  if (!res.ok) throw new Error(`Kaizen API ${res.status}`);

  const json = await res.json();
  if (!json?.status || !json?.result) {
    throw new Error('Kaizen: gagal mendapatkan data video.');
  }

  const data     = json.result;
  const audioUrl = data.audio_mp3;
  if (!audioUrl) throw new Error('Kaizen: URL audio tidak ditemukan.');

  const videoId = extractVideoId(url);

  return {
    platform:     'youtube',
    id:           videoId ?? url,
    title:        data.title ?? `YouTube ${videoId ?? 'Video'}`,
    duration:     0,
    audioUrl,            // CDN URL — Downloader will download → ffmpeg → Top4Top
    urlExpiresAt: null,
  };
}
