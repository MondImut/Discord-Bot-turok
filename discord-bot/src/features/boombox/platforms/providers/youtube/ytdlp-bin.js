/**
 * ytdlp-bin.js — Shared yt-dlp binary path resolution.
 *
 * Extracted to its own module so both ytdlp.js and preflight.js can import
 * YTDLP_BIN without creating a circular dependency.
 */

import { existsSync } from 'fs';

const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH,
  '/nix/store/am2x1y1qyja0hbyjpffj7rcvycp9d644-yt-dlp-2025.6.30/bin/yt-dlp',
  '/home/runner/workspace/.pythonlibs/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/usr/bin/yt-dlp',
  'yt-dlp',
].filter(Boolean);

function findYtdlp() {
  for (const p of YTDLP_CANDIDATES) {
    // PATH-only (no slash) entries: rely on shell PATH lookup
    if (!p.includes('/') || existsSync(p)) return p;
  }
  return 'yt-dlp';
}

export const YTDLP_BIN = findYtdlp();
