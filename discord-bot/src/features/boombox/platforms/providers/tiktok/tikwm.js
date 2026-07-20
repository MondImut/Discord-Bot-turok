/**
 * TikTok Provider: tikwm.com
 *
 * Primary provider. Returns audioUrl (video file) for Downloader to fetch.
 * Uses real numeric video ID from API response for reliable caching.
 * Timeout: 15s (fast-fail).
 */

const TIKWM_API  = 'https://www.tikwm.com/api/';
const TIMEOUT_MS = 15_000;

export async function tikwmProvider(url, ctx = {}) {
  const apiUrl = `${TIKWM_API}?url=${encodeURIComponent(url)}&hd=0`;  // hd=0 → lower quality, faster

  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)' },
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`TikWM API HTTP ${res.status}`);

  const json = await res.json().catch(() => null);
  if (!json?.data || json.code !== 0) {
    throw new Error(json?.msg ?? 'TikTok extraction gagal (tikwm).');
  }

  const d = json.data;
  // Prefer hdplay > play > wmplay — all watermark-free via hd=0
  const videoUrl = d.hdplay || d.play || d.wmplay;
  if (!videoUrl) throw new Error('TikWM: URL video tidak ditemukan dalam respons.');

  // Use real numeric video ID from API response (not URL regex match)
  const realId = String(d.id || '').trim() || url;

  return {
    platform:     'tiktok',
    id:           realId,
    title:        d.title || `TikTok oleh ${d.author?.nickname ?? 'Unknown'}`,
    duration:     typeof d.duration === 'number' ? d.duration : 0,
    audioUrl:     videoUrl,
    urlExpiresAt: null,
  };
}
