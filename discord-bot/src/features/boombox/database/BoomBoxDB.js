/**
 * BoomBoxDB — Dedicated SQLite database for the BoomBox plugin.
 * Uses better-sqlite3 for synchronous SQLite access on Node.js 18–22.
 *
 * v1.3 additions:
 * - ch_monitor, ch_settings, ch_errors columns in boombox_config.
 * - retry_count column in boombox_stats.
 * - recordRetry(guildId) method.
 * - updateChannels(guildId, data) convenience method.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
import path from 'path';
import fs from 'fs';

export class BoomBoxDB {
  #db = null;
  #logger;

  constructor(logger) {
    this.#logger = logger;
  }

  open(dbPath = './data/database/boombox.db') {
    const absPath = path.resolve(process.cwd(), dbPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    this.#db = new Database(absPath);

    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec('PRAGMA temp_store = MEMORY');
    this.#db.exec('PRAGMA cache_size = -16000');

    this.#migrate();
    this.#logger.success('BoomBox database ready.', 'BoomBoxDB');
  }

  close() {
    if (this.#db) {
      try { this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
      this.#db.close();
      this.#db = null;
      this.#logger.info('BoomBox database closed.', 'BoomBoxDB');
    }
  }

  // ─── Transaction helper ───────────────────────────────────────────────────

  transaction(fn) {
    this.#db.exec('BEGIN');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.#db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }

  // ─── Schema ───────────────────────────────────────────────────────────────

  #migrate() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS boombox_config (
        guild_id         TEXT PRIMARY KEY,
        cat_id           TEXT,
        ch_youtube       TEXT,
        ch_tiktok        TEXT,
        ch_spotify       TEXT,
        ch_logs          TEXT,
        ch_monitor       TEXT,
        ch_settings      TEXT,
        ch_errors        TEXT,
        monitor_msg_id   TEXT,
        archive_msg_id   TEXT,
        settings_msg_id  TEXT,
        manager_msg_id   TEXT,
        perf_mode        TEXT    NOT NULL DEFAULT 'balanced',
        worker_count     INTEGER NOT NULL DEFAULT 3,
        timeout_ms       INTEGER NOT NULL DEFAULT 30000,
        retries          INTEGER NOT NULL DEFAULT 2,
        delete_msgs      INTEGER NOT NULL DEFAULT 0,
        reply_mode       TEXT    NOT NULL DEFAULT 'reply',
        created_at       INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS boombox_media (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id       TEXT    NOT NULL,
        platform       TEXT    NOT NULL,
        video_id       TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        duration       INTEGER NOT NULL DEFAULT 0,
        boombox_url    TEXT    NOT NULL,
        url_expires_at INTEGER,
        created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        last_used      INTEGER NOT NULL DEFAULT (unixepoch()),
        total_used     INTEGER NOT NULL DEFAULT 0,
        favorite_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(guild_id, platform, video_id)
      );

      CREATE TABLE IF NOT EXISTS boombox_favorites (
        user_id  TEXT    NOT NULL,
        media_id INTEGER NOT NULL REFERENCES boombox_media(id) ON DELETE CASCADE,
        added_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, media_id)
      );

      CREATE TABLE IF NOT EXISTS boombox_stats (
        guild_id      TEXT    PRIMARY KEY,
        total_convert INTEGER NOT NULL DEFAULT 0,
        cache_hit     INTEGER NOT NULL DEFAULT 0,
        cache_miss    INTEGER NOT NULL DEFAULT 0,
        yt_count      INTEGER NOT NULL DEFAULT 0,
        tk_count      INTEGER NOT NULL DEFAULT 0,
        sp_count      INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failed_count  INTEGER NOT NULL DEFAULT 0,
        retry_count   INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_media_guild_platform ON boombox_media(guild_id, platform);
      CREATE INDEX IF NOT EXISTS idx_media_video_id       ON boombox_media(guild_id, video_id);
      CREATE INDEX IF NOT EXISTS idx_media_last_used      ON boombox_media(guild_id, last_used);
      CREATE INDEX IF NOT EXISTS idx_favorites_user       ON boombox_favorites(user_id);
    `);

    // Safe ALTER TABLE — no-op if column already exists
    const safeAlter = (sql) => { try { this.#db.exec(sql); } catch (_) {} };
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN settings_msg_id TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'reply'`);
    // v1.3 additions
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN ch_monitor TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN ch_settings TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN ch_errors TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN manager_msg_id TEXT`);
    safeAlter(`ALTER TABLE boombox_stats  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
    // v1.4 additions — live update logs panel
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN logs_msg_id TEXT`);
    // v1.5 additions — BoomBox Manager system
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN ch_url_logs TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN url_logs_msg_id TEXT`);
    // Per-platform settings
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN yt_enabled INTEGER NOT NULL DEFAULT 1`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN yt_gif_processing TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN yt_gif_success TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN yt_max_duration INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN tk_enabled INTEGER NOT NULL DEFAULT 1`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN tk_gif_processing TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN tk_gif_success TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN tk_max_duration INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN sp_enabled INTEGER NOT NULL DEFAULT 1`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN sp_gif_processing TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN sp_gif_success TEXT`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN sp_max_duration INTEGER NOT NULL DEFAULT 0`);
    // Worker/queue settings
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN worker_auto_mode INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN queue_limit INTEGER NOT NULL DEFAULT 50`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN cache_limit INTEGER NOT NULL DEFAULT 2000`);
    safeAlter(`ALTER TABLE boombox_config ADD COLUMN auto_restart_worker INTEGER NOT NULL DEFAULT 1`);
    // Daily stats tracking
    safeAlter(`ALTER TABLE boombox_stats ADD COLUMN daily_requests INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_stats ADD COLUMN daily_success  INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_stats ADD COLUMN daily_failed   INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_stats ADD COLUMN total_convert_ms INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE boombox_stats ADD COLUMN last_reset_date TEXT`);
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  getConfig(guildId) {
    return this.#db.prepare('SELECT * FROM boombox_config WHERE guild_id = ?').get(guildId) ?? null;
  }

  upsertConfig(guildId, data) {
    const existing = this.getConfig(guildId);
    if (!existing) {
      this.#db.prepare(`
        INSERT INTO boombox_config
          (guild_id, cat_id, ch_youtube, ch_tiktok, ch_spotify, ch_logs,
           ch_monitor, ch_settings, ch_errors,
           perf_mode, worker_count, timeout_ms, retries, delete_msgs, reply_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        guildId,
        data.catId       ?? null,
        data.chYoutube   ?? null,
        data.chTiktok    ?? null,
        data.chSpotify   ?? null,
        data.chLogs      ?? null,
        data.chMonitor   ?? null,
        data.chSettings  ?? null,
        data.chErrors    ?? null,
        data.perfMode    ?? 'balanced',
        data.workerCount ?? 3,
        data.timeoutMs   ?? 30_000,
        data.retries     ?? 2,
        data.deleteMsgs  ? 1 : 0,
        data.replyMode   ?? 'reply',
      );
    } else {
      const fields = {
        cat_id:          data.catId,
        ch_youtube:      data.chYoutube,
        ch_tiktok:       data.chTiktok,
        ch_spotify:      data.chSpotify,
        ch_logs:         data.chLogs,
        ch_monitor:      data.chMonitor,
        ch_settings:     data.chSettings,
        ch_errors:       data.chErrors,
        perf_mode:       data.perfMode,
        worker_count:    data.workerCount,
        timeout_ms:      data.timeoutMs,
        retries:         data.retries,
        delete_msgs:     data.deleteMsgs !== undefined ? (data.deleteMsgs ? 1 : 0) : undefined,
        reply_mode:      data.replyMode,
        monitor_msg_id:  data.monitorMsgId,
        archive_msg_id:  data.archiveMsgId,
        settings_msg_id: data.settingsMsgId,
        manager_msg_id:  data.managerMsgId,
        logs_msg_id:     data.logsMsgId,
      };
      const sets = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (sets.length === 0) return;
      const sql = `UPDATE boombox_config SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE guild_id = ?`;
      this.#db.prepare(sql).run(...sets.map(([, v]) => v), guildId);
    }
  }

  setPanelIds(guildId, { monitorMsgId, archiveMsgId, settingsMsgId, managerMsgId } = {}) {
    const fields = {
      monitor_msg_id:  monitorMsgId,
      archive_msg_id:  archiveMsgId,
      settings_msg_id: settingsMsgId,
      manager_msg_id:  managerMsgId,
    };
    const sets = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!sets.length) return;
    const sql = `UPDATE boombox_config SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE guild_id = ?`;
    this.#db.prepare(sql).run(...sets.map(([, v]) => v), guildId);
  }

  /**
   * Delete the config row for a guild.
   * Media archive (boombox_media, boombox_favorites, boombox_stats) is preserved.
   */
  deleteGuildConfig(guildId) {
    this.#db.prepare('DELETE FROM boombox_config WHERE guild_id = ?').run(guildId);
  }

  // ─── Platform settings ────────────────────────────────────────────────────

  updatePlatformSettings(guildId, platformCode, { enabled, gifProcessing, gifSuccess, maxDuration, channel } = {}) {
    // platformCode: 'yt' | 'tk' | 'sp'
    const p = platformCode;
    const fields = {};
    if (enabled       !== undefined) fields[`${p}_enabled`]        = enabled ? 1 : 0;
    if (gifProcessing !== undefined) fields[`${p}_gif_processing`]  = gifProcessing ?? null;
    if (gifSuccess    !== undefined) fields[`${p}_gif_success`]     = gifSuccess ?? null;
    if (maxDuration   !== undefined) fields[`${p}_max_duration`]    = maxDuration ?? 0;
    if (channel !== undefined) {
      const chCol = { yt: 'ch_youtube', tk: 'ch_tiktok', sp: 'ch_spotify' }[p];
      if (chCol) fields[chCol] = channel ?? null;
    }
    const sets = Object.entries(fields);
    if (!sets.length) return;
    this.#db.prepare(
      `UPDATE boombox_config SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE guild_id = ?`
    ).run(...sets.map(([, v]) => v), guildId);
  }

  updateWorkerSettings(guildId, { workerCount, autoMode, queueLimit, cacheLimit, autoRestart } = {}) {
    const fields = {};
    if (workerCount !== undefined) fields.worker_count        = workerCount;
    if (autoMode    !== undefined) fields.worker_auto_mode    = autoMode ? 1 : 0;
    if (queueLimit  !== undefined) fields.queue_limit         = queueLimit;
    if (cacheLimit  !== undefined) fields.cache_limit         = cacheLimit;
    if (autoRestart !== undefined) fields.auto_restart_worker = autoRestart ? 1 : 0;
    const sets = Object.entries(fields);
    if (!sets.length) return;
    this.#db.prepare(
      `UPDATE boombox_config SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE guild_id = ?`
    ).run(...sets.map(([, v]) => v), guildId);
  }

  setUrlLogsChannel(guildId, channelId) {
    this.#db.prepare('UPDATE boombox_config SET ch_url_logs = ? WHERE guild_id = ?').run(channelId ?? null, guildId);
  }

  setUrlLogsMsgId(guildId, msgId) {
    this.#db.prepare('UPDATE boombox_config SET url_logs_msg_id = ? WHERE guild_id = ?').run(msgId ?? null, guildId);
  }

  setManagerMsgId(guildId, msgId) {
    this.#db.prepare('UPDATE boombox_config SET manager_msg_id = ? WHERE guild_id = ?').run(msgId ?? null, guildId);
  }

  setErrorsChannel(guildId, channelId) {
    this.#db.prepare('UPDATE boombox_config SET ch_errors = ? WHERE guild_id = ?').run(channelId ?? null, guildId);
  }

  // ─── Daily stats tracking ─────────────────────────────────────────────────

  /**
   * Record a conversion with both global and daily stats.
   * Auto-resets daily counters when the calendar date changes.
   */
  recordConversionFull(guildId, { platform, cacheHit, success, elapsedMs = 0 }) {
    this.ensureStats(guildId);
    const today  = new Date().toISOString().slice(0, 10);
    const row    = this.#db.prepare('SELECT last_reset_date FROM boombox_stats WHERE guild_id = ?').get(guildId);
    const isNew  = row?.last_reset_date !== today;
    const platCol = { youtube: 'yt_count', tiktok: 'tk_count', spotify: 'sp_count' }[platform] ?? 'yt_count';

    if (isNew) {
      this.#db.prepare(`
        UPDATE boombox_stats SET
          total_convert    = total_convert + 1,
          cache_hit        = cache_hit     + ?,
          cache_miss       = cache_miss    + ?,
          ${platCol}       = ${platCol}    + 1,
          success_count    = success_count + ?,
          failed_count     = failed_count  + ?,
          total_convert_ms = total_convert_ms + ?,
          daily_requests   = 1,
          daily_success    = ?,
          daily_failed     = ?,
          last_reset_date  = ?
        WHERE guild_id = ?
      `).run(
        cacheHit ? 1 : 0, cacheHit ? 0 : 1,
        success  ? 1 : 0, success  ? 0 : 1,
        elapsedMs,
        success ? 1 : 0, success ? 0 : 1,
        today, guildId,
      );
    } else {
      this.#db.prepare(`
        UPDATE boombox_stats SET
          total_convert    = total_convert + 1,
          cache_hit        = cache_hit     + ?,
          cache_miss       = cache_miss    + ?,
          ${platCol}       = ${platCol}    + 1,
          success_count    = success_count + ?,
          failed_count     = failed_count  + ?,
          total_convert_ms = total_convert_ms + ?,
          daily_requests   = daily_requests + 1,
          daily_success    = daily_success  + ?,
          daily_failed     = daily_failed   + ?
        WHERE guild_id = ?
      `).run(
        cacheHit ? 1 : 0, cacheHit ? 0 : 1,
        success  ? 1 : 0, success  ? 0 : 1,
        elapsedMs,
        success ? 1 : 0, success ? 0 : 1,
        guildId,
      );
    }
  }

  // ─── Media ────────────────────────────────────────────────────────────────

  findMedia(guildId, platform, videoId) {
    return this.#db.prepare(
      'SELECT * FROM boombox_media WHERE guild_id = ? AND platform = ? AND video_id = ?'
    ).get(guildId, platform, videoId) ?? null;
  }

  upsertMedia(guildId, { platform, videoId, title, duration, boomboxUrl, urlExpiresAt }) {
    const now = Math.floor(Date.now() / 1000);
    this.#db.prepare(`
      INSERT OR IGNORE INTO boombox_media
        (guild_id, platform, video_id, title, duration, boombox_url, url_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, platform, videoId, title, duration, boomboxUrl, urlExpiresAt ?? null);

    this.#db.prepare(`
      UPDATE boombox_media
      SET boombox_url = ?, url_expires_at = ?, last_used = ?, total_used = total_used + 1
      WHERE guild_id = ? AND platform = ? AND video_id = ?
    `).run(boomboxUrl, urlExpiresAt ?? null, now, guildId, platform, videoId);

    return this.findMedia(guildId, platform, videoId);
  }

  touchMedia(id) {
    const now = Math.floor(Date.now() / 1000);
    this.#db.prepare(
      'UPDATE boombox_media SET last_used = ?, total_used = total_used + 1 WHERE id = ?'
    ).run(now, id);
  }

  listMedia(guildId, { platform = null, sort = 'created_at DESC', limit = 5, offset = 0, search = '' } = {}) {
    let where = 'guild_id = ?';
    const params = [guildId];
    if (platform) { where += ' AND platform = ?'; params.push(platform); }
    if (search)   { where += ' AND title LIKE ?';  params.push(`%${search}%`); }

    const rows  = this.#db.prepare(`SELECT * FROM boombox_media WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = this.#db.prepare(`SELECT COUNT(*) AS c FROM boombox_media WHERE ${where}`)
      .get(...params).c;

    return { rows, total };
  }

  countByPlatform(guildId) {
    const row = this.#db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN platform = 'youtube' THEN 1 ELSE 0 END) AS yt,
        SUM(CASE WHEN platform = 'tiktok'  THEN 1 ELSE 0 END) AS tk,
        SUM(CASE WHEN platform = 'spotify' THEN 1 ELSE 0 END) AS sp
      FROM boombox_media WHERE guild_id = ?
    `).get(guildId);
    return { total: row.total ?? 0, yt: row.yt ?? 0, tk: row.tk ?? 0, sp: row.sp ?? 0 };
  }

  getMediaById(id) {
    return this.#db.prepare('SELECT * FROM boombox_media WHERE id = ?').get(id) ?? null;
  }

  /**
   * Get the N most recent media entries for the live logs panel.
   * @param {string} guildId
   * @param {number} limit   — default 5
   */
  getRecentMedia(guildId, limit = 5) {
    return this.#db.prepare(
      'SELECT * FROM boombox_media WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(guildId, limit);
  }

  // ─── Favorites ────────────────────────────────────────────────────────────

  getFavorites(userId, guildId, { sort = 'bm.created_at DESC', limit = 5, offset = 0 } = {}) {
    const rows = this.#db.prepare(`
      SELECT bm.* FROM boombox_favorites bf
      JOIN boombox_media bm ON bm.id = bf.media_id
      WHERE bf.user_id = ? AND bm.guild_id = ?
      ORDER BY ${sort} LIMIT ? OFFSET ?
    `).all(userId, guildId, limit, offset);

    const total = this.#db.prepare(`
      SELECT COUNT(*) AS c FROM boombox_favorites bf
      JOIN boombox_media bm ON bm.id = bf.media_id
      WHERE bf.user_id = ? AND bm.guild_id = ?
    `).get(userId, guildId).c;

    return { rows, total };
  }

  isFavorite(userId, mediaId) {
    return !!this.#db.prepare(
      'SELECT 1 FROM boombox_favorites WHERE user_id = ? AND media_id = ?'
    ).get(userId, mediaId);
  }

  toggleFavorite(userId, mediaId) {
    if (this.isFavorite(userId, mediaId)) {
      this.#db.prepare('DELETE FROM boombox_favorites WHERE user_id = ? AND media_id = ?').run(userId, mediaId);
      this.#db.prepare('UPDATE boombox_media SET favorite_count = MAX(0, favorite_count - 1) WHERE id = ?').run(mediaId);
      return false;
    }
    this.#db.prepare('INSERT OR IGNORE INTO boombox_favorites (user_id, media_id) VALUES (?, ?)').run(userId, mediaId);
    this.#db.prepare('UPDATE boombox_media SET favorite_count = favorite_count + 1 WHERE id = ?').run(mediaId);
    return true;
  }

  // ─── Guild list ───────────────────────────────────────────────────────────

  getAllGuildIds() {
    return this.#db.prepare('SELECT guild_id FROM boombox_config').all().map((r) => r.guild_id);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  ensureStats(guildId) {
    this.#db.prepare('INSERT OR IGNORE INTO boombox_stats (guild_id) VALUES (?)').run(guildId);
  }

  getStats(guildId) {
    this.ensureStats(guildId);
    return this.#db.prepare('SELECT * FROM boombox_stats WHERE guild_id = ?').get(guildId);
  }

  recordConversion(guildId, { platform, cacheHit, success }) {
    this.ensureStats(guildId);
    const platCol = { youtube: 'yt_count', tiktok: 'tk_count', spotify: 'sp_count' }[platform] ?? 'yt_count';
    this.#db.prepare(`
      UPDATE boombox_stats SET
        total_convert = total_convert + 1,
        cache_hit     = cache_hit     + ?,
        cache_miss    = cache_miss    + ?,
        ${platCol}    = ${platCol}    + 1,
        success_count = success_count + ?,
        failed_count  = failed_count  + ?
      WHERE guild_id = ?
    `).run(
      cacheHit ? 1 : 0,
      cacheHit ? 0 : 1,
      success  ? 1 : 0,
      success  ? 0 : 1,
      guildId,
    );
  }

  /** Increment retry counter for a guild. Called by WorkerPool on each retry attempt. */
  recordRetry(guildId) {
    if (!guildId) return;
    this.ensureStats(guildId);
    this.#db.prepare(
      'UPDATE boombox_stats SET retry_count = retry_count + 1 WHERE guild_id = ?'
    ).run(guildId);
  }

  /**
   * Reset all stats counters for a guild back to zero.
   * Used by BoomBox Settings → Reset Statistik.
   */
  resetStats(guildId) {
    this.ensureStats(guildId);
    this.#db.prepare(`
      UPDATE boombox_stats SET
        total_convert = 0, cache_hit = 0, cache_miss = 0,
        yt_count = 0, tk_count = 0, sp_count = 0,
        success_count = 0, failed_count = 0, retry_count = 0
      WHERE guild_id = ?
    `).run(guildId);
  }

  /**
   * Run VACUUM and WAL checkpoint to compact and clean the database.
   * Used by BoomBox Settings → Rebuild Database.
   * This is synchronous (better-sqlite3); safe to call from async context.
   */
  vacuum() {
    try { this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
    this.#db.exec('VACUUM');
  }
}
