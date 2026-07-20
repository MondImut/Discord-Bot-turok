/**
 * YouTube Provider: yt-dlp
 *
 * Two exported providers:
 *   1. ytdlpProvider        — runs WITHOUT cookies (primary)
 *   2. ytdlpCookiesProvider — runs WITH cookies; skips immediately if no file found
 *
 * Dynamic timeout: computed from ctx.duration so short videos (< 3 min) get 20s,
 * long videos (60 min+) get 120s — never times out unnecessarily on real content.
 *
 * Context (ctx):
 *   ctx.duration — video duration in seconds from preflight (0 = unknown)
 *   ctx.id       — video ID from preflight (avoids regex re-extraction)
 *
 * Quality: worstaudio — lowest possible audio quality for maximum speed.
 * Uses async spawn — does NOT block the Node.js event loop.
 */

import { spawn }          from 'child_process';
import { readdirSync }    from 'fs';
import { tmpdir }         from 'os';
import { join }           from 'path';
import { randomBytes }    from 'crypto';
import { YTDLP_BIN }      from './ytdlp-bin.js';
import { ytdlpTimeout }   from './preflight.js';

export { YTDLP_BIN };

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
 * Build yt-dlp args.
 * @param {string}      url
 * @param {string}      prefix     — output path prefix (no extension)
 * @param {string|null} cookiesFile
 */
/**
 * Build yt-dlp args.
 * Uses ios player_client to bypass YouTube bot-checks (works without cookies in many cases).
 * @param {string}      url
 * @param {string}      prefix     — output path prefix (no extension)
 * @param {string|null} cookiesFile
 */
function buildArgs(url, prefix, cookiesFile = null) {
  const args = [
    '-x',
    '-f', 'worstaudio/worst',        // lowest quality for speed
    '--audio-quality', '9',          // yt-dlp 0=best 9=worst
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    // Use iOS client to bypass bot-checks without cookies in most cases
    '--extractor-args', 'youtube:player_client=ios,mweb',
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

function buildResult(lines, filename, videoId, ctx) {
  const title    = lines[0]?.trim() || ctx?.title || `YouTube ${videoId ?? 'Video'}`;
  const id       = lines[1]?.trim() || videoId || ctx?.id || 'unknown';
  // Prefer preflight duration (exact) over yt-dlp printed duration (can differ by 1s)
  const duration = ctx?.duration || parseInt(lines[2], 10) || 0;

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
 * Run yt-dlp asynchronously.
 *
 * @param {string}      url
 * @param {string|null} cookiesFile
 * @param {string}      label
 * @param {object}      ctx         — { id, title, duration } from preflight
 */
function runYtdlp(url, cookiesFile, label, ctx) {
  const videoId   = ctx?.id ?? extractVideoId(url);
  const timeout   = ytdlpTimeout(ctx?.duration ?? 0);
  const uid       = randomBytes(6).toString('hex');
  const prefix    = join(tmpdir(), `boombox_yt_${uid}`);
  const args      = buildArgs(url, prefix, cookiesFile);

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
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    // Dynamic timeout based on video duration from preflight
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      settle(() => reject(
        new Error(`${label}: timeout ${timeout / 1000}s — video mungkin terlalu besar. Fallback ke provider berikutnya.`)
      ));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`${label}: gagal menjalankan yt-dlp — ${err.message}`)));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;

      const stdoutTrim  = stdout.trim();
      const isBotCheck  = /Sign in to confirm|captcha|challenge/i.test(stderr);
      const isTimedOut  = signal === 'SIGTERM';

      // Cek apakah output file berhasil ditulis
      let matches = [];
      try {
        const fileBase = `boombox_yt_${uid}.`;
        matches = readdirSync(tmpdir()).filter(
          (f) => f.startsWith(fileBase) && !f.endsWith('.part')
        );
      } catch {}

      const lines = stdoutTrim.split('\n');

      // File scan: file harus ada setelah yt-dlp selesai
      if (matches.length && lines[0]?.trim()) {
        // File ada DAN stdout berisi metadata — sukses
        return settle(() => resolve(buildResult(lines, matches[0], videoId, ctx)));
      }

      if (isTimedOut) {
        return settle(() => reject(
          new Error(`${label}: timeout ${timeout / 1000}s. Fallback ke provider berikutnya.`)
        ));
      }
      if (isBotCheck) {
        return settle(() => reject(
          new Error(`${label}: YouTube meminta verifikasi bot. Fallback ke provider berikutnya.`)
        ));
      }

      if (code === 0 && !matches.length) {
        // Exit 0 tapi tidak ada file = YouTube memblokir stream download secara diam-diam
        return settle(() => reject(
          new Error(`${label}: YouTube memblokir download (exit 0, tidak ada file). Bot-check atau IP diblokir. Fallback ke provider berikutnya.`)
        ));
      }

      const detail = stderr.slice(-400).trim();
      settle(() => reject(
        new Error(`${label} [exit ${code}]: ${detail || 'Download gagal.'}`)
      ));
    });
  });
}

// ─── Provider 1: yt-dlp without cookies ──────────────────────────────────────

export async function ytdlpProvider(url, ctx = {}) {
  return runYtdlp(url, null, 'yt-dlp', ctx);
}

// ─── Provider 2: yt-dlp with cookies ─────────────────────────────────────────

export async function ytdlpCookiesProvider(url, ctx = {}) {
  const cookiesFile = findCookiesFile();
  if (!cookiesFile) {
    throw new Error('yt-dlp+cookies: file cookies tidak ditemukan. Skip ke provider berikutnya.');
  }
  return runYtdlp(url, cookiesFile, 'yt-dlp+cookies', ctx);
}
