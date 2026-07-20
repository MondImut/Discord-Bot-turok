/**
 * Spotify Provider: oEmbed metadata + YouTube Music search via yt-dlp
 *
 * Flow:
 *   1. Fetch Spotify oEmbed → title + author_name (artist) only
 *   2. Search YouTube Music (ytmsearch1:) → fallback YouTube (ytsearch1:) via yt-dlp
 *   3. Download full-duration audio to local temp file
 *
 * TIDAK menggunakan Spotify preview_url / p.scdn.co / audio preview endpoint.
 * Spotify hanya dipakai untuk metadata; audio diambil penuh dari YouTube.
 *
 * Internal yt-dlp timeout: 40s < 50s registry timeout → proses selalu ter-kill
 * sebelum ProviderRegistry timeout; tidak ada orphan process atau temp file leak.
 */

import { spawn }        from 'child_process';
import { readdirSync }  from 'fs';
import { tmpdir }       from 'os';
import { join }         from 'path';
import { randomBytes }  from 'crypto';
import { URL_PATTERNS } from '../../../constants.js';
import { YTDLP_BIN }    from '../youtube/ytdlp.js';

const OEMBED_TIMEOUT_MS = 10_000;
const YTDLP_SEARCH_MS   = 40_000;  // < 50s registry timeout

function extractSpotifyId(url) {
  const m = url.match(URL_PATTERNS.spotify);
  return m ? { type: m[1], id: m[2] } : null;
}

/** Ambil title + artist dari Spotify oEmbed — tidak ada audio dari Spotify. */
async function fetchSpotifyMeta(url) {
  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoomBox/2.0)' },
      signal:  AbortSignal.timeout(OEMBED_TIMEOUT_MS),
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
 * Jalankan yt-dlp dengan search URL (ytmsearch1: atau ytsearch1:).
 * Timeout: YTDLP_SEARCH_MS (lebih panjang karena mencakup search + download).
 */
function runYtdlpSearch(searchUrl, label) {
  const uid    = randomBytes(6).toString('hex');
  const prefix = join(tmpdir(), `boombox_sp_${uid}`);

  const args = [
    '-x',
    '-f', 'worstaudio/worst',
    '--audio-quality', '9',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '-o', `${prefix}.%(ext)s`,
    '--print', '%(title)s',
    '--print', '%(id)s',
    '--print', '%(duration)s',
    searchUrl,
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    let proc;
    try {
      proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new Error(`${label}: gagal menjalankan yt-dlp — ${err.message}`));
    }

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      settle(() => reject(new Error(`${label}: timeout ${YTDLP_SEARCH_MS / 1000}s.`)));
    }, YTDLP_SEARCH_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`${label}: ${err.message}`)));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;

      let matches = [];
      try {
        const fileBase = `boombox_sp_${uid}.`;
        matches = readdirSync(tmpdir()).filter(
          (f) => f.startsWith(fileBase) && !f.endsWith('.part')
        );
      } catch {}

      const lines    = stdout.trim().split('\n');
      const ytTitle  = lines[0]?.trim() || '';
      const duration = parseInt(lines[2], 10) || 0;

      if (code === 0 || (matches.length && ytTitle)) {
        if (!matches.length) {
          return settle(() => reject(new Error(`${label}: file audio tidak ditemukan setelah download.`)));
        }
        return settle(() => resolve({
          filePath: join(tmpdir(), matches[0]),
          ytTitle,
          duration,
        }));
      }

      const isBotCheck = /Sign in to confirm|captcha|challenge/i.test(stderr);
      if (isBotCheck) {
        return settle(() => reject(new Error(`${label}: YouTube meminta verifikasi bot.`)));
      }

      const detail = stderr.slice(-400).trim();
      settle(() => reject(new Error(`${label} [exit ${code}]: ${detail || 'Download gagal.'}`)));
    });
  });
}

export async function oembedProvider(url, ctx = {}) {
  const meta = extractSpotifyId(url);
  if (!meta) throw new Error('URL Spotify tidak valid.');
  if (meta.type !== 'track') throw new Error('Hanya Spotify Track yang didukung saat ini.');

  // ── Step 1: metadata dari Spotify (judul + artis saja, TANPA audio) ──────
  const { title, artist } = await fetchSpotifyMeta(url);
  const query = artist ? `${title} ${artist}` : title;

  // ── Step 2: cari & download audio penuh dari YouTube Music / YouTube ─────
  const attempts = [
    { searchUrl: `ytmsearch1:${query}`, label: 'Spotify→YTMusic' },
    { searchUrl: `ytsearch1:${query}`,  label: 'Spotify→YouTube' },
  ];

  let dlResult;
  let lastError;
  for (const { searchUrl, label } of attempts) {
    try {
      dlResult = await runYtdlpSearch(searchUrl, label);
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!dlResult) {
    throw new Error(
      `Spotify: tidak dapat menemukan "${query}" di YouTube Music/YouTube. ` +
      (lastError?.message ?? '')
    );
  }

  return {
    platform:     'spotify',
    id:           meta.id,
    title:        dlResult.ytTitle || title,
    duration:     dlResult.duration,
    filePath:     dlResult.filePath,
    urlExpiresAt: null,
  };
}
