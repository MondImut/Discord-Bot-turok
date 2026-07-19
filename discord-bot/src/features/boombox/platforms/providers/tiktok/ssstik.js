/**
 * TikTok Provider: ssstik.io
 * Fallback provider. Returns audioUrl for Downloader to fetch.
 */

export async function ssstikProvider(url) {
  // Step 1: get the token from ssstik.io
  const pageRes = await fetch('https://ssstik.io/en', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':     'text/html',
    },
    signal: AbortSignal.timeout(6_000),
  });

  if (!pageRes.ok) throw new Error(`ssstik page ${pageRes.status}`);
  const pageHtml = await pageRes.text();

  const tokenMatch = pageHtml.match(/s_tt\s*=\s*['"]([^'"]+)['"]/);
  if (!tokenMatch) throw new Error('ssstik: token tidak ditemukan.');
  const token = tokenMatch[1];

  // Step 2: request download
  const body = new URLSearchParams({ id: url, locale: 'en', tt: token });
  const dlRes = await fetch('https://ssstik.io/abc?url=dl', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer':      'https://ssstik.io/en',
      'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body:   body.toString(),
    signal: AbortSignal.timeout(7_000),
  });

  if (!dlRes.ok) throw new Error(`ssstik download ${dlRes.status}`);
  const html = await dlRes.text();

  // Extract direct MP4 link
  const videoMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/);
  if (!videoMatch) throw new Error('ssstik: URL video tidak ditemukan dalam respons.');

  // Extract title
  const titleMatch = html.match(/<p[^>]*class="[^"]*maintext[^"]*"[^>]*>([^<]+)<\/p>/i)
    ?? html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'TikTok Video';

  return {
    platform:     'tiktok',
    id:           url,
    title,
    duration:     0,
    audioUrl:     videoMatch[1],  // CDN URL — Downloader will download → ffmpeg → Top4Top
    urlExpiresAt: null,
  };
}
