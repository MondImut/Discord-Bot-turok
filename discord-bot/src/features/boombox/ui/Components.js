/**
 * BoomBox Components — Button, select menu, and action row builders.
 *
 * v1.5 — Added BoomBox Manager panel components:
 *   managerMainRows()        — main monitoring panel rows
 *   managerPlatformPageRows() — platform (yt/tk/sp) setup page rows
 *   managerChannelPageRows()  — error/urllogs channel-only setup page rows
 *   managerWorkerPageRows()   — worker settings page rows
 *   urlLogsPanelRows()        — URL Logs public panel rows
 *
 * Existing components (success, archive, settings, list, preview, sort) unchanged.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
} from 'discord.js';
import { CID, MCID, SORT_OPTIONS, PERFORMANCE_MODES, PLATFORM_META } from '../constants.js';

// ─── State helpers ────────────────────────────────────────────────────────────

export function encodeState(p, s, pg, f) { return `${p ?? 'a'}:${s ?? 0}:${pg ?? 0}:${f ?? 0}`; }
export function decodeState(str) {
  const [p = 'a', s = '0', pg = '0', f = '0'] = (str || 'a:0:0:0').split(':');
  return { p, s: +s, pg: +pg, f: +f };
}
export function listCid(action, p, s, pg, f) { return `bb:list:${action}:${p}:${s}:${pg}:${f}`; }
export function platLabel(p) { return { y: 'YouTube', t: 'TikTok', s: 'Spotify', a: 'Semua' }[p] ?? 'Semua'; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDur(s) {
  if (!s || s <= 0) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

// ─── BoomBox Manager Main Panel ───────────────────────────────────────────────

/**
 * Main manager panel action rows:
 *   Row 1: [🔄 Refresh] [⚙️ Worker] [🗃️ Clear Cache] [💾 Save]
 *   Row 2: [StringSelect: Setup BoomBox]
 */
export function managerMainRows() {
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(MCID.REFRESH)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MCID.WORKER_PAGE)
      .setLabel('⚙️ Worker')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(MCID.CLEAR_CACHE)
      .setLabel('🗃️ Clear Cache')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MCID.SAVE)
      .setLabel('💾 Save')
      .setStyle(ButtonStyle.Success),
  );

  const r2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MCID.DROPDOWN)
      .setPlaceholder('⚙️ Setup BoomBox — Pilih konfigurasi…')
      .addOptions([
        { label: '▶️ Setup YouTube',  value: 'yt_setup',      description: 'Atur channel, GIF, dan status YouTube' },
        { label: '🎵 Setup TikTok',   value: 'tk_setup',      description: 'Atur channel, GIF, dan status TikTok'  },
        { label: '🎧 Setup Spotify',  value: 'sp_setup',      description: 'Atur channel, GIF, dan status Spotify' },
        { label: '🚨 BoomBox Error',  value: 'error_setup',   description: 'Atur channel Error Logs'               },
        { label: '📜 URL Logs',       value: 'urllogs_setup', description: 'Atur channel dan buat Panel URL Logs'  },
      ])
  );

  return [r1, r2];
}

// ─── Platform Setup Page ──────────────────────────────────────────────────────

/**
 * Platform setup page rows (YouTube / TikTok / Spotify).
 *   Row 1: ChannelSelectMenu (pick channel for this platform)
 *   Row 2: [Status Toggle] [🎬 Media Settings] [💾 Simpan] [⬅️ Kembali]
 *
 * @param {object} config — DB config row
 * @param {string} platformCode — 'yt' | 'tk' | 'sp'
 */
export function managerPlatformPageRows(config, platformCode) {
  const p       = platformCode;
  const enabled = (config?.[`${p}_enabled`] ?? 1);

  const chSelectId = { yt: MCID.CH_YT, tk: MCID.CH_TK, sp: MCID.CH_SP }[p] ?? MCID.CH_YT;
  const toggleId   = { yt: MCID.YT_TOGGLE, tk: MCID.TK_TOGGLE, sp: MCID.SP_TOGGLE }[p] ?? MCID.YT_TOGGLE;
  const mediaId    = { yt: MCID.YT_MEDIA,  tk: MCID.TK_MEDIA,  sp: MCID.SP_MEDIA  }[p] ?? MCID.YT_MEDIA;
  const saveId     = `bb:mgr:plat:save:${p}`;

  const platLabel  = { yt: 'YouTube', tk: 'TikTok', sp: 'Spotify' }[p] ?? p.toUpperCase();

  const r1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(chSelectId)
      .setPlaceholder(`Pilih channel ${platLabel}…`)
      .addChannelTypes(ChannelType.GuildText)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(toggleId)
      .setLabel(enabled ? `✅ ${platLabel}: Aktif` : `❌ ${platLabel}: Nonaktif`)
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(mediaId)
      .setLabel('🎬 Media Settings')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(saveId)
      .setLabel('💾 Simpan')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(MCID.BACK)
      .setLabel('⬅️ Kembali')
      .setStyle(ButtonStyle.Secondary),
  );

  return [r1, r2];
}

// ─── Channel-only Setup Page (Error Logs / URL Logs) ─────────────────────────

/**
 * Channel-only setup page (no toggle/media button).
 *   Row 1: ChannelSelectMenu
 *   Row 2: [💾 Simpan] [⬅️ Kembali]
 *
 * @param {'error'|'urllogs'} type
 */
export function managerChannelPageRows(type) {
  const chSelectId = type === 'error' ? MCID.CH_ERRORS : MCID.CH_URLLOGS;
  const saveId     = type === 'error' ? 'bb:mgr:error:save' : 'bb:mgr:urllogs:save';
  const placeholder = type === 'error'
    ? 'Pilih channel Error Logs…'
    : 'Pilih channel URL Logs…';

  const r1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(chSelectId)
      .setPlaceholder(placeholder)
      .addChannelTypes(ChannelType.GuildText)
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(saveId)
      .setLabel('💾 Simpan')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(MCID.BACK)
      .setLabel('⬅️ Kembali')
      .setStyle(ButtonStyle.Secondary),
  );

  return [r1, r2];
}

// ─── Worker Settings Page ─────────────────────────────────────────────────────

/**
 * Worker settings page rows.
 *   Row 1: [👷 −1] [👷 +1] [🤖 Auto Mode]
 *   Row 2: [📝 Edit Limits] [💾 Simpan] [⬅️ Kembali]
 *
 * @param {number} workerCount
 * @param {object} config
 */
export function managerWorkerPageRows(workerCount, config) {
  const autoMode = !!(config?.worker_auto_mode);

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(MCID.WORKER_MINUS)
      .setLabel('👷 −1 Worker')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(workerCount <= 1),
    new ButtonBuilder()
      .setCustomId(MCID.WORKER_PLUS)
      .setLabel('👷 +1 Worker')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(workerCount >= 10),
    new ButtonBuilder()
      .setCustomId(MCID.WORKER_AUTO)
      .setLabel(autoMode ? '🤖 Auto Mode: ON' : '🤖 Auto Mode: OFF')
      .setStyle(autoMode ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(MCID.WORKER_LIMITS)
      .setLabel('📝 Edit Limits')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MCID.SAVE)
      .setLabel('💾 Simpan & Kembali')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(MCID.BACK)
      .setLabel('⬅️ Kembali')
      .setStyle(ButtonStyle.Secondary),
  );

  return [r1, r2];
}

// ─── URL Logs Public Panel ────────────────────────────────────────────────────

/**
 * URL Logs panel rows — public panel with platform buttons.
 *   Row 1: [▶️ YouTube] [🎵 TikTok] [🎧 Spotify]
 */
export function urlLogsPanelRows() {
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(MCID.URLLOGS_YT)
      .setLabel('▶️ YouTube')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(MCID.URLLOGS_TK)
      .setLabel('🎵 TikTok')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MCID.URLLOGS_SP)
      .setLabel('🎧 Spotify')
      .setStyle(ButtonStyle.Success),
  );

  return [r1];
}

// ─── Success Result Buttons ───────────────────────────────────────────────────

export function successActionRow(mediaId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CID.SUCCESS_COPY}:${mediaId}`)
      .setLabel('Copy URL')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${CID.SUCCESS_PREVIEW}:${mediaId}`)
      .setLabel('Preview')
      .setStyle(ButtonStyle.Secondary),
  )];
}

// ─── BoomBox Logs Panel (Archive, Search, Favorite, Stats) ────────────────────

export function archivePanelRows() {
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID.ARCHIVE_YT).setLabel('▶️ YouTube').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CID.ARCHIVE_TK).setLabel('🎵 TikTok').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CID.ARCHIVE_SP).setLabel('🎧 Spotify').setStyle(ButtonStyle.Success),
  );
  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID.ARCHIVE_SEARCH).setLabel('🔍 Cari').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CID.ARCHIVE_FAV).setLabel('⭐ Favorit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CID.ARCHIVE_STATS).setLabel('📊 Statistik').setStyle(ButtonStyle.Secondary),
  );
  return [r1, r2];
}

// ─── BoomBox Settings Panel (comprehensive) ───────────────────────────────────

export function settingsRows(config) {
  const autoDelOn = !!config?.delete_msgs;
  const replyMode = config?.reply_mode ?? 'reply';
  const isReply   = replyMode === 'reply';
  const pm        = PERFORMANCE_MODES[config?.perf_mode] ?? PERFORMANCE_MODES.balanced;
  const workerCount = config?.worker_count ?? pm.workers ?? 3;

  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.S2_AUTODEL)
      .setLabel(autoDelOn ? '🗑️ Auto Delete: ON' : '🗑️ Auto Delete: OFF')
      .setStyle(autoDelOn ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CID.S2_REPLY_MODE)
      .setLabel(isReply ? '💬 Mode: Reply' : '💬 Mode: Pesan Baru')
      .setStyle(isReply ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CID.S2_REFRESH)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary),
  );

  const r2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CID.S2_PERF)
      .setPlaceholder(`⚡ Mode: ${pm.name}`)
      .addOptions(
        Object.entries(PERFORMANCE_MODES)
          .filter(([k]) => k !== 'custom')
          .map(([k, v]) => ({ label: v.name, value: k, description: v.description.slice(0, 100) }))
      )
  );

  const r3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.S2_WORKERS_DEC)
      .setLabel('👷 Worker −1')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(workerCount <= 1),
    new ButtonBuilder()
      .setCustomId(CID.S2_WORKERS_INC)
      .setLabel('👷 Worker +1')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(workerCount >= 10),
    new ButtonBuilder()
      .setCustomId(CID.SETTINGS_CLEAR_CACHE)
      .setLabel('🗃️ Hapus Cache')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CID.S2_CACHE_REBUILD)
      .setLabel('♻️ Rebuild Cache')
      .setStyle(ButtonStyle.Secondary),
  );

  const r4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.S2_DB_REBUILD)
      .setLabel('🗄️ Rebuild Database')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CID.S2_STATS_RESET)
      .setLabel('📊 Reset Statistik')
      .setStyle(ButtonStyle.Danger),
  );

  return [r1, r2, r3, r4];
}

// ─── List Navigation ──────────────────────────────────────────────────────────

export function listNavRow1(p, s, pg, f, totalPages) {
  const last = Math.max(0, (totalPages || 1) - 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(listCid('first', p, s, 0,                        f)).setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(pg <= 0),
    new ButtonBuilder().setCustomId(listCid('prev',  p, s, Math.max(0, pg - 1),      f)).setLabel('◀').setStyle(ButtonStyle.Primary).setDisabled(pg <= 0),
    new ButtonBuilder().setCustomId(listCid('page',  p, s, pg,                       f)).setLabel(`${pg + 1} / ${totalPages || 1}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(listCid('next',  p, s, Math.min(last, pg + 1),   f)).setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(pg >= last),
    new ButtonBuilder().setCustomId(listCid('last',  p, s, last,                     f)).setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(pg >= last),
  );
}

export function listNavRow2(p, s, pg, f) {
  const isFav   = f === 1;
  const sortLbl = SORT_OPTIONS[s]?.label ?? 'Urut';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(listCid('search', p, s, pg, f)).setLabel('Cari').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(listCid('sort',   p, s, pg, f)).setLabel(sortLbl).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(listCid('fav',    p, s, 0, isFav ? 0 : 1)).setLabel(isFav ? 'Semua' : 'Favorit').setStyle(isFav ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(listCid('home',   p, s, 0, 0)).setLabel('Kembali').setStyle(ButtonStyle.Danger),
  );
}

export function listSelectRow(rows, p, s, pg, f) {
  if (!rows?.length) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bb:list:select-menu:${p}:${s}:${pg}:${f}`)
    .setPlaceholder('Pilih judul untuk detail...')
    .addOptions(rows.slice(0, 25).map((m) => ({
      label:       (m.title || 'Tanpa Judul').slice(0, 100),
      value:       String(m.id),
      description: `${PLATFORM_META[m.platform]?.label ?? m.platform} • ${fmtDur(m.duration)}`.slice(0, 100),
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export function previewActionRow(mediaId, isFav, p, s, pg, f) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bb:preview:copy:${mediaId}:${p}:${s}:${pg}:${f}`)
      .setLabel('Copy URL').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bb:preview:fav:${mediaId}:${p}:${s}:${pg}:${f}`)
      .setLabel(isFav ? 'Hapus Favorit' : 'Tambah Favorit')
      .setStyle(isFav ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bb:preview:back:${mediaId}:${p}:${s}:${pg}:${f}`)
      .setLabel('Kembali').setStyle(ButtonStyle.Secondary),
  )];
}

// ─── Sort Select ──────────────────────────────────────────────────────────────

export function sortSelectRow(p, pg, f) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bb:sort:select:${p}:${pg}:${f}`)
    .setPlaceholder('Pilih urutan...')
    .addOptions(SORT_OPTIONS.map((o, i) => ({ label: o.label, value: String(i) })));
  return [new ActionRowBuilder().addComponents(menu)];
}
