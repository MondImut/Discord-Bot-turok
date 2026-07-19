/**
 * YouTube Provider: yt-dlp
 *
 * Two exported providers:
 *   1. ytdlpProvider        — runs WITHOUT cookies first (fastest path)
 *   2. ytdlpCookiesProvider — runs WITH cookies; skips immediately if no cookies file found
 *
 * Provider order in YouTube.js:
 *   yt-dlp → yt-dlp+cookies → Kaizen → Y2MP3 → Cobalt
 *
 * Quality: worstaudio — lowest possible audio quality for maximum speed.
 * Timeout: 13 s (fits safely inside ProviderRegistry.PROVIDER_TIMEOUT_MS = 15 s).
 *
 * IMPORTANT: uses async spawn (not spawnSync) to avoid blocking the Node.js
 * event loop. spawnSync would freeze all workers and Discord events for 13 s.
 */

import { spawn }                     from 'child_process';
import { existsSync, readdirSync }   from 'fs';
import { tmpdir }                    from 'os';
import { join }                      from 'path';
import { randomBytes }               from 'crypto';

const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH,
  '/home/runner/workspace/.pythonlibs/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/usr/bin/yt-dlp',
  'yt-dlp',
].filter(Boolean);

function findYtdlp() {
  for (const p of YTDLP_CANDIDATES) {
    if (!p.includes('/') || existsSync(p)) return p;
  }
  return 'yt-dlp';
}

export const YTDLP_BIN = findYtdlp();

function extractVideoId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

/**
 * Find cookies file for yt-dlp (bot-check bypass).
 * Returns path string or null if not found.
 */
function findCookiesFile() {
  const candidates = [
    join(process.cwd(), 'cookies.txt'),
    join(process.cwd(), 'data', 'cookies.txt'),
    join(process.cwd(), 'youtube_cookies.txt'),
    join(process.cwd(), 'Pangeran-Assistant', 'cookies.txt'),
    join(process.cwd(), 'Pangeran-Assistant', 'data', 'cookies.txt'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Build yt-dlp args with worstaudio quality.
 * @param {string}      url
 * @param {string}      prefix     — output path prefix (no extension)
 * @param {string|null} cookiesFile — if set, adds --cookies arg
 */
function buildArgs(url, prefix, cookiesFile = null) {
  const args = [
    '-x',
    '-f', 'worstaudio/worst',        // lowest quality for speed
    '--audio-quality', '9',          // yt-dlp 0=best 9=worst
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '-o', `${prefix}.%(ext)s`,
    '--print', '%(title)s',
    '--print', '%(id)s',
    '--print', '%(duration)s',
  ];

  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  }

  args.push(url);
  return args;
}

function buildResult(lines, filename, videoId) {
  const title    = lines[0]?.trim() || `YouTube ${videoId ?? 'Video'}`;
  const id       = lines[1]?.trim() || videoId || 'unknown';
  const duration = parseInt(lines[2], 10) || 0;

  return {
    platform:     'youtube',
    id,
    title,
    duration,
    filePath:     join(tmpdir(), filename),
    urlExpiresAt: null,
  };
}

/**
 * Run yt-dlp asynchronously — does NOT block the Node.js event loop.
 * Resolves with media result or rejects with a clear error so ProviderRegistry
 * can fall through to the next provider immediately.
 *
 * @param {string}      url
 * @param {string|null} cookiesFile
 * @param {string}      label        — used in error messages
 */
function runYtdlp(url, cookiesFile, label) {
  const videoId = extractVideoId(url);
  const uid     = randomBytes(6).toString('hex');
  const prefix  = join(tmpdir(), `boombox_yt_${uid}`);
  const args    = buildArgs(url, prefix, cookiesFile);

  return new Promise((resolve, reject) => {
    // Guard against double-settle (timer + close racing each other)
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
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    // Hard timeout — kill process, then reject so next provider is tried immediately
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      settle(() => reject(
        new Error(`${label}: timeout 13s — terlalu lambat. Fallback ke provider berikutnya.`)
      ));
    }, 13_000);

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`${label}: gagal menjalankan yt-dlp — ${err.message}`)));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return; // Timeout already fired

      const stdoutTrim  = stdout.trim();
      const isBotCheck  = stderr.includes('Sign in to confirm') ||
                          stderr.includes('bot') ||
                          stderr.includes('captcha');
      const isTimedOut  = signal === 'SIGTERM';

      // Check if output file was actually written (yt-dlp quirk on non-zero exit)
      let matches = [];
      try {
        const fileBase = `boombox_yt_${uid}.`;
        matches = readdirSync(tmpdir()).filter(
          (f) => f.startsWith(fileBase) && !f.endsWith('.part')
        );
      } catch {}

      const lines = stdoutTrim.split('\n');

      // Success path: exit 0 OR file written with title in stdout
      if (code === 0 || (matches.length && lines[0]?.trim())) {
        if (!matches.length) {
          return settle(() => reject(
            new Error(`${label}: file audio tidak ditemukan setelah download.`)
          ));
        }
        return settle(() => resolve(buildResult(lines, matches[0], videoId)));
      }

      // Hard failures — throw immediately so ProviderRegistry tries next provider
      if (isTimedOut) {
        return settle(() => reject(
          new Error(`${label}: timeout — terlalu lambat. Fallback ke provider berikutnya.`)
        ));
      }
      if (isBotCheck) {
        return settle(() => reject(
          new Error(`${label}: YouTube meminta verifikasi bot. Fallback ke provider berikutnya.`)
        ));
      }

      const detail = stderr.slice(-300).trim();
      settle(() => reject(
        new Error(`${label} [exit ${code}]: ${detail || 'Download gagal.'}`)
      ));
    });
  });
}

// ─── Provider 1: yt-dlp without cookies ──────────────────────────────────────

/**
 * Primary yt-dlp provider — no cookies.
 * If YouTube returns bot-check, throws immediately so ytdlpCookiesProvider is tried next.
 */
export async function ytdlpProvider(url) {
  return runYtdlp(url, null, 'yt-dlp');
}

// ─── Provider 2: yt-dlp with cookies ─────────────────────────────────────────

/**
 * yt-dlp fallback with cookies file.
 * Skips immediately if no cookies file is found (throw → ProviderRegistry tries Kaizen next).
 */
export async function ytdlpCookiesProvider(url) {
  const cookiesFile = findCookiesFile();
  if (!cookiesFile) {
    throw new Error('yt-dlp+cookies: file cookies tidak ditemukan. Skip ke provider berikutnya.');
  }
  return runYtdlp(url, cookiesFile, 'yt-dlp+cookies');
}
