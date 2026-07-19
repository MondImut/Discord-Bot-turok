/**
 * SmartCache — In-memory URL cache backed by the DB.
 *
 * Improvements over v1.0:
 * - `preload` capped at maxEntries (default 500) sorted by most-recently-used
 *   to prevent loading 9999 rows into RAM.
 * - `set` evicts the oldest entry when the overall map exceeds maxSize (2000).
 * - `clearGuild` removes all entries for a specific guild.
 * - TTL-aware: expired entries return null and are evicted lazily.
 */

export class SmartCache {
  static DEFAULT_MAX_SIZE   = 2_000;  // max total entries across all guilds
  static DEFAULT_MAX_PRELOAD = 500;   // max entries loaded from DB per guild on startup

  /** Map<key, { url: string, expiresAt: number|null }> */
  #map;
  #maxSize;

  constructor(maxSize = SmartCache.DEFAULT_MAX_SIZE) {
    this.#map     = new Map();
    this.#maxSize = maxSize;
  }

  /** Build cache key. */
  static key(guildId, platform, videoId) {
    return `${guildId}:${platform}:${videoId}`;
  }

  /**
   * Preload valid (non-expired) entries from the DB for one guild.
   * Loads the most-recently-used rows first, capped at `maxEntries`.
   * @returns {number} Number of entries loaded.
   */
  preload(db, guildId, maxEntries = SmartCache.DEFAULT_MAX_PRELOAD) {
    const now  = Math.floor(Date.now() / 1000);
    const { rows } = db.listMedia(guildId, {
      limit:  maxEntries,
      offset: 0,
      sort:   'last_used DESC',
    });
    let loaded = 0;
    for (const row of rows) {
      if (row.url_expires_at && row.url_expires_at < now) continue; // expired
      const k = SmartCache.key(guildId, row.platform, row.video_id);
      this.#map.set(k, { url: row.boombox_url, expiresAt: row.url_expires_at ?? null });
      loaded++;
    }
    return loaded;
  }

  /**
   * Get a cached URL. Returns null if missing or TTL-expired (evicts lazily).
   */
  get(guildId, platform, videoId) {
    const k     = SmartCache.key(guildId, platform, videoId);
    const entry = this.#map.get(k);
    if (!entry) return null;
    if (entry.expiresAt && Math.floor(Date.now() / 1000) >= entry.expiresAt) {
      this.#map.delete(k);
      return null;
    }
    return entry.url;
  }

  /**
   * Store / update a cache entry.
   * Evicts the oldest entry if the map is at capacity.
   */
  set(guildId, platform, videoId, url, expiresAt = null) {
    const k = SmartCache.key(guildId, platform, videoId);
    // Only evict if this is a NEW key and we're at capacity
    if (!this.#map.has(k) && this.#map.size >= this.#maxSize) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
    this.#map.set(k, { url, expiresAt });
  }

  /** Invalidate a single entry (e.g. after URL refresh). */
  invalidate(guildId, platform, videoId) {
    this.#map.delete(SmartCache.key(guildId, platform, videoId));
  }

  /**
   * Remove ALL cache entries belonging to a guild.
   * Called when a guild's BoomBox config is deleted.
   */
  clearGuild(guildId) {
    const prefix = `${guildId}:`;
    for (const key of this.#map.keys()) {
      if (key.startsWith(prefix)) this.#map.delete(key);
    }
  }

  get size() { return this.#map.size; }
}
