/**
 * ffmpeg.js — Thin wrapper around system ffmpeg.
 *
 * Converts any audio/video input to MP3 at 64 kbps.
 * - Strips all metadata (title, artist, cover art).
 * - Uses libmp3lame codec.
 * - Returns path to the converted file.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

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

const FFMPEG_BIN = findFfmpeg();

/**
 * Convert an audio/video file to 64 kbps MP3.
 *
 * @param {string} inputPath  - Path to the source file.
 * @param {string} outputPath - Desired output .mp3 path (must differ from input).
 * @param {object} [opts]
 * @param {number} [opts.bitrate=64]  - Audio bitrate in kbps.
 * @param {number} [opts.timeout=120] - Timeout in seconds.
 * @returns {string} The resolved outputPath.
 * @throws {Error} If ffmpeg exits with non-zero code.
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

  const result = spawnSync(FFMPEG_BIN, args, {
    timeout: timeout * 1000,
    stdio:   ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().slice(-500) ?? '';
    throw new Error(`ffmpeg exited ${result.status}: ${stderr}`);
  }

  return path.resolve(outputPath);
}

export { FFMPEG_BIN };
