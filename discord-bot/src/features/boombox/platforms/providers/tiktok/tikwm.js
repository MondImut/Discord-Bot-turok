/**
 * TikTok Provider: tikwm.com
 * Primary provider. Returns audioUrl (video file) for Downloader to fetch.
 */

const TIKWM_API = 'https://www.tikwm.com/api/';

export async function tikwmProvider(url) {
  const apiUrl = `${TIKWM_API}?url=${encodeURIComponent(url)}&hd=0`;  // hd=0 → lower quality, faster

  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)' },
    signal:  AbortSignal.timeout(13_000),
  });

  if (!res.ok) throw new Error(`TikWM API ${res.status}`);

  const json = await res.json();
  if (!json?.data || json.code !== 0) {
    throw new Error(json?.msg ?? 'TikTok extraction gagal (tikwm).');
  }

  const d        = json.data;
  const videoUrl = d.hdplay || d.play || d.wmplay;
  if (!videoUrl) throw new Error('TikWM: URL video tidak ditemukan.');

  return {
    platform:     'tiktok',
    id:           String(d.id),
    title:        d.title || `TikTok oleh ${d.author?.nickname ?? 'Unknown'}`,
    duration:     d.duration || 0,
    audioUrl:     videoUrl,   // CDN URL — Downloader will download → ffmpeg → Top4Top
    urlExpiresAt: null,
  };
}
