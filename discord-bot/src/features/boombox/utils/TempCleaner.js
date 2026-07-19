/**
 * TempCleaner — Deletes temporary files after upload.
 *
 * Usage:
 *   const cleaner = new TempCleaner(logger);
 *   cleaner.track('/tmp/boombox_abc.mp4');
 *   cleaner.track('/tmp/boombox_abc.mp3');
 *   await cleaner.flush();
 */

import { unlink } from 'fs/promises';

export class TempCleaner {
  #paths;
  #logger;

  constructor(logger) {
    this.#paths  = [];
    this.#logger = logger;
  }

  /** Register a file path for later deletion. */
  track(filePath) {
    if (filePath) this.#paths.push(filePath);
    return this;
  }

  /**
   * Delete all tracked files. Errors are swallowed (best-effort).
   * @returns {Promise<number>} Number of files successfully deleted.
   */
  async flush() {
    let deleted = 0;
    for (const p of this.#paths) {
      try {
        await unlink(p);
        deleted++;
      } catch (e) {
        // File may not exist (already deleted, or never created) — not an error.
        if (e.code !== 'ENOENT') {
          this.#logger?.warn?.(`TempCleaner: failed to delete ${p}: ${e.message}`, 'TempCleaner');
        }
      }
    }
    this.#paths = [];
    return deleted;
  }

  /**
   * Statically delete a list of paths without creating an instance.
   */
  static async deleteAll(paths, logger) {
    const c = new TempCleaner(logger);
    for (const p of paths) c.track(p);
    return c.flush();
  }
}
