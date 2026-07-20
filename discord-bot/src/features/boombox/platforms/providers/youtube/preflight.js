/**
 * YouTube Preflight — Fast metadata check sebelum download dimulai.
 *
 * Menjalankan yt-dlp dengan --skip-download untuk mendapatkan:
 *   - video ID, title, duration, availability (public/private/unavailable)
 *
 * Tujuan:
 *   1. Tolak video private/unavailable lebih awal (hindari buang waktu 60-120s)
 *   2. Dapatkan durasi sebelum download → dynamic timeout untuk yt-dlp
 *   3. Pass metadata ke semua provider via ctx → mengisi `duration: 0` dari API providers
 *
 * Timeout: 10s. Jika preflight gagal (network, ENOENT, dll.) → return null.
 * Hanya throws jika video JELAS tidak tersedia (private, deleted, dll.).
 */

import { spawn }      from 'child_process';
import { YTDLP_BIN } from './ytdlp-bin.js';

const PREFLIGHT_TIMEOUT_MS = 10_000;

// Keyword di stderr yang menandakan video tidak tersedia — bukan error sementara
const UNAVAIL_PATTERNS = [
  /This video is private/i,
  /Video unavailable/i,
  /Private video/i,
  /This video has been removed/i,
  /This video is not available/i,
  /Requested format is not available/i,
];

const BOT_CHECK_PATTERNS = [
  /Sign in to confirm/i,
  /captcha/i,
  /challenge/i,
];

/**
 * Cek metadata YouTube sebelum download.
 *
 * @param {string} url
 * @returns {Promise<{id:string, title:string, duration:number}|null>}
 *   Returns null  jika preflight tidak bisa diselesaikan (timeout, jaringan, dll.)
 *   Throws Error  jika video jelas tidak tersedia (private, dihapus, dll.)
 */
export async function preflightYouTube(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    const args = [
      '--skip-download',
      '--no-warnings',
      '--quiet',
      '--print', 'id',
      '--print', 'title',
      '--print', 'duration',
      url,
    ];

    let proc;
    try {
      proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      // yt-dlp binary tidak tersedia — skip preflight, proceed anyway
      return resolve(null);
    }

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      // Timeout bukan error fatal — proceed tanpa ctx
      settle(() => resolve(null));
    }, PREFLIGHT_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      // Binary error — proceed tanpa ctx
      settle(() => resolve(null));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;

      // Cek apakah video jelas tidak tersedia
      const stderrText = stderr.trim();
      for (const p of UNAVAIL_PATTERNS) {
        if (p.test(stderrText)) {
          return settle(() => reject(new Error(
            `Video tidak tersedia: ${stderrText.split('\n').pop().slice(0, 150)}`
          )));
        }
      }

      // Bot check — jangan tolak, biarkan provider chain yang handle
      const isBotCheck = BOT_CHECK_PATTERNS.some(p => p.test(stderrText));

      if (code !== 0 || isBotCheck) {
        // Error tidak fatal — proceed tanpa ctx
        return settle(() => resolve(null));
      }

      const lines    = stdout.trim().split('\n');
      const id       = lines[0]?.trim();
      const title    = lines[1]?.trim();
      const duration = parseInt(lines[2], 10) || 0;

      if (!id) return settle(() => resolve(null));

      settle(() => resolve({ id, title: title || `YouTube ${id}`, duration }));
    });
  });
}

/**
 * Hitung timeout yt-dlp yang tepat berdasarkan durasi video.
 * Digunakan oleh ytdlpProvider dan oembed untuk set internal timer.
 *
 * @param {number} duration  Durasi video dalam detik (0 = tidak diketahui)
 * @returns {number} Timeout dalam milidetik
 */
export function ytdlpTimeout(duration) {
  if (!duration || duration <= 0) return 30_000;   // tidak diketahui: 30s
  if (duration <   180)           return 20_000;   // < 3 menit: 20s
  if (duration <   600)           return 35_000;   // < 10 menit: 35s
  if (duration < 1_800)           return 70_000;   // < 30 menit: 70s
  if (duration < 3_600)           return 100_000;  // < 60 menit: 100s
  return 120_000;                                  // ≥ 60 menit: 120s
}
