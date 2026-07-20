/**
 * ffmpeg.js — Thin async wrapper around system ffmpeg.
 *
 * Converts any audio/video input to MP3 at 64 kbps.
 * - Strips all metadata (title, artist, cover art).
 * - Uses libmp3lame codec.
 * - ASYNC: does NOT block the Node.js event loop (uses spawn, not spawnSync).
 */

import { spawn }       from 'child_process';
import { existsSync }  from 'fs';
import path            from 'path';

/** Preferred ffmpeg binary paths (check in order). */
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  '/nix/store/yi0six5hxxh2z6g1ahh9b9j3jxr73d50-replit-runtime-path/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  'ffmpeg', // PATH lookup
].filter(Boolean);

function findFfmpeg() {
  for (const p of FFMPEG_CANDIDATES) {
    if (!p.includes('/') || existsSync(p)) return p;
  }
  return 'ffmpeg';
}

export const FFMPEG_BIN = findFfmpeg();

/**
 * Convert an audio/video file to 64 kbps MP3 asynchronously.
 * Does NOT block the Node.js event loop — safe to call from concurrent workers.
 *
 * @param {string} inputPath  - Path to the source file.
 * @param {string} outputPath - Desired output .mp3 path (must differ from input).
 * @param {object} [opts]
 * @param {number} [opts.bitrate=64]  - Audio bitrate in kbps.
 * @param {number} [opts.timeout=120] - Timeout in seconds.
 * @returns {Promise<string>} Resolves with resolved outputPath.
 * @throws {Error} If ffmpeg exits with non-zero code or times out.
 */
export function convertToMp3(inputPath, outputPath, { bitrate = 64, timeout = 120 } = {}) {
  const args = [
    '-y',                          // overwrite output without asking
    '-i', inputPath,               // input file
    '-vn',                         // drop video stream
    '-acodec', 'libmp3lame',       // MP3 codec
    '-ab', `${bitrate}k`,          // audio bitrate
    '-map_metadata', '-1',         // strip all metadata
    '-id3v2_version', '3',         // write minimal ID3v2 header
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    let proc;
    try {
      proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new Error(`ffmpeg spawn gagal: ${err.message}`));
    }

    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      settle(() => reject(new Error(`ffmpeg timeout ${timeout}s`)));
    }, timeout * 1000);

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`ffmpeg error: ${err.message}`)));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code === 0) {
        settle(() => resolve(path.resolve(outputPath)));
      } else {
        settle(() => reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500).trim()}`)));
      }
    });
  });
}
