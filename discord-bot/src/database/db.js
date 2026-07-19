/**
 * src/database/db.js — Shared singleton exports.
 *
 * BoomBox database (SQLite, Turok system) lives inside
 * src/features/boombox/ and is accessed via getBoomBoxDB().
 *
 * This file exports only the JSON-backed singletons used by non-BoomBox
 * features: Premium, Ticket, Bug Report, CPanel, Database, Thread.
 */

import { PremiumDB } from './premiumDB.js';

export const premDB = new PremiumDB();
