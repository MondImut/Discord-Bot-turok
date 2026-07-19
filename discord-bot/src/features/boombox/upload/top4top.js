/**
 * Top4Top Uploader
 *
 * Uploads a local file to top4top.io and returns the direct URL.
 * Uses native fetch + FormData (Node.js 18+) — no external dependencies.
 *
 * Reference: top4top.js (provided by user, adapted for native APIs).
 */

import { readFile } from 'fs/promises';
import path from 'path';

const TOP4TOP_URL  = 'https://top4top.io/index.php';
const UPLOAD_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Upload a file to top4top.io.
 *
 * @param {string} filePath - Absolute path to the local file to upload.
 * @returns {Promise<{ url: string, deleteUrl: string|null }>}
 * @throws {Error} If upload fails or no URL is found in the response.
 */
export async function uploadToTop4Top(filePath) {
  const filename = path.basename(filePath);
  const buffer   = await readFile(filePath);
  const blob     = new Blob([buffer], { type: guessMime(filename) });

  const form = new FormData();
  form.append('file_0_',  blob, filename);
  form.append('submitr',  '[ رفع الملفات ]');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let html;
  try {
    const res = await fetch(TOP4TOP_URL, {
      method:  'POST',
      body:    form,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        'Accept':     'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Top4Top HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const get = (re) => { const m = html.match(re); return m?.[1] ?? null; };

  // Try to extract a direct file URL (audio/video) or page URL
  const url =
    get(/value="(https?:\/\/[a-z0-9]+\.top4top\.io\/m_[^"]+)"/) ||
    get(/(https?:\/\/[a-z0-9]+\.top4top\.io\/m_[^\s"'<>]+)/)    ||
    get(/value="(https?:\/\/[a-z0-9]+\.top4top\.io\/p_[^"]+)"/) ||
    get(/(https?:\/\/[a-z0-9]+\.top4top\.io\/p_[^\s"'<>]+)/);

  if (!url) {
    throw new Error('Top4Top: URL tidak ditemukan dalam respons. Mungkin upload gagal atau format berubah.');
  }

  const deleteUrl =
    get(/value="(https?:\/\/top4top\.io\/del[^"]+)"/) ||
    get(/(https?:\/\/top4top\.io\/del[^\s"'<>]+)/);

  return { url, deleteUrl };
}

/** Guess MIME type from file extension. */
function guessMime(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
  }[ext] ?? 'application/octet-stream';
}
