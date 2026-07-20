/**
 * src/database/db.js — Shared singleton exports.
 *
 * BoomBox SQLite database (Turok system) lives inside src/features/boombox/
 * and is accessed via getBoomBoxDB() from the boombox shim.
 *
 * This file exports:
 *   - premDB   : JSON-backed PremiumDB singleton (active)
 *   - db       : Legacy stub for old Fandli BoomBox JSON references.
 *                All methods are no-ops / safe defaults. The real BoomBox
 *                data is in Turok's BoomBoxDB (SQLite).
 */

import { PremiumDB } from './premiumDB.js';

export const premDB = new PremiumDB();

/**
 * Legacy BoomBox JSON-DB stub.
 * Keeps old Fandli code (statsDashboard, hesuCommand, resetlimit, logDashboard)
 * from crashing while Turok's BoomBox handles real data internally.
 */
export const db = {
  // ── Per-user daily usage tracking (Fandli old system) ─────────────────
  getUsage:      (_userId)      => ({ used: 0, limit: Infinity }),
  resetUsage:    (_userId)      => { /* no-op — Turok manages its own rate limiting */ },

  // ── Aggregate statistics ───────────────────────────────────────────────
  getStatistics: ()             => ({ total: 0, success: 0, failed: 0, platforms: {} }),

  // ── Log dashboard state (retired — Turok uses UrlLogsHandler) ─────────
  getLogChannel: ()             => null,
  getLogState:   ()             => ({ messageId: null, entries: [] }),
  setLogState:   (_data)        => { /* no-op */ },
};
