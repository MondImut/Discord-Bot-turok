/**
 * BoomBox Embeds — All EmbedBuilder factories.
 * Footer: "Powered by Pangeran Assistant • HH:MM:SS"
 * Design: modern, compact, minimal emoji, consistent.
 *
 * v1.5 changes:
 * - processingEmbed(): accepts config + user; GIF at bottom; "Requested by" footer.
 * - successEmbed(): thumbnail top-right; "Requested by" footer.
 * - errorEmbed(): accepts platform + reason for user-facing message.
 * - NEW: managerEmbed(), managerSetupPageEmbed(), managerWorkerPageEmbed()
 * - NEW: urlLogsPanelEmbed()
 */

import { EmbedBuilder } from 'discord.js';
import {
  FOOTER_TEXT, COLORS, PLATFORM_META, SORT_OPTIONS, PERFORMANCE_MODES,
  PAGE_SIZE, ERROR_SOLUTIONS,
} from '../constants.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function footer() {
  return { text: `${FOOTER_TEXT} • ${ts()}` };
}
function fmtDur(s) {
  if (!s || s <= 0) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtDate(unix) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function fmtUptime(startMs) {
  if (!startMs) return '—';
  const s = Math.floor((Date.now() - startMs) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m ${s % 60}d`;
}
function chVal(id) { return id ? `<#${id}>` : '—'; }

// ─── Conversion ───────────────────────────────────────────────────────────────

/**
 * processingEmbed — v1.5
 * Shows platform, "Mohon tunggu. Sedang membuat BoomBox."
 * GIF (if configured) as image at the bottom.
 * Footer: "Requested by @User • Powered by Pangeran Assistant"
 *
 * @param {string} platform
 * @param {object} [config]   — DB config row (for GIF URLs)
 * @param {object} [user]     — Discord user object
 */
export function processingEmbed(platform, config = null, user = null) {
  const pm = PLATFORM_META[platform] ?? { label: 'Media', color: COLORS.INFO };

  const platCode = { youtube: 'yt', tiktok: 'tk', spotify: 'sp' }[platform];
  const gifUrl   = platCode && config ? (config[`${platCode}_gif_processing`] ?? null) : null;

  const footerParts = [];
  if (user) footerParts.push(`Requested by ${user.username}`);
  footerParts.push(FOOTER_TEXT);

  const embed = new EmbedBuilder()
    .setColor(pm.color)
    .setTitle(`${pm.emoji ?? '🎵'} Mohon Tunggu…`)
    .addFields(
      { name: 'Platform', value: pm.label,             inline: true },
      { name: 'Status',   value: 'Sedang membuat BoomBox…', inline: true },
    )
    .setFooter({ text: footerParts.join(' • ') });

  if (gifUrl) embed.setImage(gifUrl);

  return embed;
}

/**
 * successEmbed — v1.5
 * Thumbnail (top-right) from media / constructed URL.
 * Fields: Judul, Durasi, BoomBox URL.
 * Footer: "Requested by @User • Powered by Pangeran Assistant"
 *
 * @param {object} media       — DB media row
 * @param {boolean} cacheHit
 * @param {number|null} elapsedMs
 * @param {object} [config]    — DB config row (for GIF success)
 * @param {object} [user]      — Discord user object
 */
export function successEmbed(media, cacheHit = false, elapsedMs = null, config = null, user = null) {
  const pm = PLATFORM_META[media.platform] ?? { label: media.platform, emoji: '🎵', color: COLORS.SUCCESS };

  const urlDisplay = media.boombox_url?.length > 900
    ? media.boombox_url.slice(0, 897) + '...'
    : media.boombox_url;

  // Build thumbnail URL
  let thumbnailUrl = null;
  if (media.platform === 'youtube' && media.video_id) {
    thumbnailUrl = `https://img.youtube.com/vi/${media.video_id}/mqdefault.jpg`;
  }

  // GIF success
  const platCode = { youtube: 'yt', tiktok: 'tk', spotify: 'sp' }[media.platform];
  const gifSuccess = platCode && config ? (config[`${platCode}_gif_success`] ?? null) : null;

  const footerParts = [];
  if (user) footerParts.push(`Requested by ${user.username}`);
  footerParts.push(FOOTER_TEXT);
  if (elapsedMs !== null) footerParts.push(cacheHit ? `Cache ⚡ ${fmtMs(elapsedMs)}` : fmtMs(elapsedMs));

  const embed = new EmbedBuilder()
    .setColor(cacheHit ? COLORS.INFO : pm.color)
    .setTitle('✅ BoomBox URL Siap')
    .addFields(
      { name: 'Judul',      value: (media.title?.slice(0, 200) || 'Tanpa Judul'), inline: false },
      { name: 'Platform',   value: pm.label,           inline: true  },
      { name: 'Durasi',     value: fmtDur(media.duration), inline: true },
      { name: 'BoomBox URL', value: `\`\`\`\n${urlDisplay}\n\`\`\``, inline: false },
    )
    .setFooter({ text: footerParts.join(' • ') });

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (gifSuccess)   embed.setImage(gifSuccess);

  return embed;
}

/**
 * errorEmbed — PUBLIC CHANNEL VERSION (v1.5).
 * Shows platform and a generic user-friendly reason.
 * NO stack traces, NO URLs, NO provider names, NO technical info.
 *
 * @param {string} [platform]   — 'youtube' | 'tiktok' | 'spotify'
 * @param {object} [user]       — Discord user object
 */
export function errorEmbed(platform = null, user = null) {
  const pm = platform ? (PLATFORM_META[platform] ?? null) : null;
  const footerParts = [];
  if (user) footerParts.push(`Requested by ${user.username}`);
  footerParts.push(FOOTER_TEXT);

  return new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle('❌ BoomBox Gagal')
    .addFields(
      ...(pm ? [{ name: 'Platform', value: pm.label, inline: true }] : []),
      { name: 'Alasan', value: 'Konversi tidak berhasil. Silakan cek kembali link Anda.', inline: false },
    )
    .setFooter({ text: footerParts.join(' • ') });
}

// ─── Monitor Panel (old) ──────────────────────────────────────────────────────

/**
 * @param {object}      stats
 * @param {object}      workerStatus   — { activeWorkers, queueSize }
 * @param {string}      perfMode
 * @param {object}      config
 * @param {object|null} providerStatus — getAllProviderStatus() or null
 * @param {number|null} uptimeStart    — Date.now() at bot start
 * @param {number}      retryCount     — in-memory retry counter
 * @param {number}      inFlightCount  — in-flight promise count
 */
export function monitorEmbed(stats, workerStatus, perfMode, config, providerStatus = null, uptimeStart = null, retryCount = 0, inFlightCount = 0) {
  const pm      = PERFORMANCE_MODES[perfMode] ?? PERFORMANCE_MODES.balanced;
  const total   = stats.total_convert || 0;
  const hitRate = total > 0 ? `${((stats.cache_hit / total) * 100).toFixed(1)}%` : '0%';

  let statusLine = '🟢 Operasional';
  if (providerStatus) {
    const allProviders = Object.values(providerStatus).flat();
    const offlineCount = allProviders.filter((p) => !p.enabled).length;
    if (offlineCount >= allProviders.length && allProviders.length > 0) statusLine = '🔴 Semua Provider Offline';
    else if (offlineCount > 0) statusLine = `⚠️ ${offlineCount} Provider Offline`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.PANEL)
    .setTitle('BoomBox Monitor')
    .addFields(
      { name: 'Status',         value: statusLine,                                        inline: false },
      { name: 'Mode Performa',  value: `${pm.name} — ${pm.description}`,                 inline: false },
      { name: 'Worker',         value: `${workerStatus.activeWorkers}/${config.worker_count ?? pm.workers} aktif`, inline: true },
      { name: 'Antrian',        value: String(workerStatus.queueSize),                   inline: true },
      { name: 'In-Flight',      value: String(inFlightCount),                            inline: true },
      { name: 'Cache Hit',      value: hitRate,                                           inline: true },
      { name: 'Sukses',         value: String(stats.success_count ?? 0),                 inline: true },
      { name: 'Gagal',          value: String(stats.failed_count ?? 0),                  inline: true },
      { name: 'Retry',          value: String(retryCount),                               inline: true },
      { name: 'Total Konversi', value: String(total),                                    inline: true },
      { name: 'Uptime',         value: fmtUptime(uptimeStart),                           inline: true },
    );

  if (providerStatus) {
    const lines = [];
    for (const [platform, providers] of Object.entries(providerStatus)) {
      if (!providers?.length) continue;
      const parts = providers.map((p) => {
        const icon = p.enabled ? '🟢' : '🔴';
        const rate = p.total > 0 ? ` ${p.successRate}` : '';
        const ms   = p.total > 0 ? ` ${p.avgLatencyMs}ms` : '';
        return `${icon} \`${p.name}\`${rate}${ms}`;
      });
      lines.push(`**${platform.charAt(0).toUpperCase() + platform.slice(1)}:** ${parts.join(' • ')}`);
    }
    if (lines.length) {
      embed.addFields({ name: 'Provider Status', value: lines.join('\n').slice(0, 1024), inline: false });
    }
  }

  return embed.setFooter(footer());
}

// ─── BoomBox Manager Panel (new) ─────────────────────────────────────────────

/**
 * managerEmbed — Main BoomBox Manager monitoring view.
 * Shows all key metrics in one embed.
 *
 * @param {object} stats         — boombox_stats row
 * @param {object} counts        — { total, yt, tk, sp } from countByPlatform
 * @param {object} workerStatus  — { activeWorkers, queueSize, cacheSize }
 * @param {object} config        — boombox_config row
 * @param {number|null} uptimeStart — bot start timestamp
 */
export function managerEmbed(stats, counts, workerStatus, config, uptimeStart = null) {
  const pm        = PERFORMANCE_MODES[config?.perf_mode] ?? PERFORMANCE_MODES.balanced;
  const total     = stats?.total_convert ?? 0;
  const totalMs   = stats?.total_convert_ms ?? 0;
  const avgMs     = total > 0 ? Math.round(totalMs / total) : 0;

  // Provider status text
  let statusLine = '🟢 Operasional';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎵 BoomBox Manager')
    .setDescription('Pusat kontrol dan monitoring BoomBox. Gunakan dropdown **Setup BoomBox** untuk konfigurasi.')
    .addFields(
      // Status row
      { name: '📡 Status BoomBox',    value: statusLine,                                         inline: true  },
      { name: '⚙️ Mode',              value: pm.name,                                            inline: true  },
      { name: '⏱️ Uptime',            value: fmtUptime(uptimeStart),                             inline: true  },
      // Workers
      { name: '👷 Worker Aktif',      value: `${workerStatus.activeWorkers} / ${config?.worker_count ?? pm.workers}`, inline: true },
      { name: '📋 Queue',             value: String(workerStatus.queueSize),                     inline: true  },
      { name: '🗃️ Cache',             value: String(workerStatus.cacheSize ?? 0),                inline: true  },
      // URL counts
      { name: '▶️ YouTube URL',        value: String(counts?.yt ?? 0),                           inline: true  },
      { name: '🎵 TikTok URL',         value: String(counts?.tk ?? 0),                           inline: true  },
      { name: '🎧 Spotify URL',        value: String(counts?.sp ?? 0),                           inline: true  },
      { name: '📦 Total URL',          value: String(counts?.total ?? 0),                        inline: true  },
      // Daily stats
      { name: '📊 Request Hari Ini',   value: String(stats?.daily_requests ?? 0),                inline: true  },
      { name: '✅ Success Hari Ini',   value: String(stats?.daily_success  ?? 0),                inline: true  },
      { name: '❌ Failed Hari Ini',    value: String(stats?.daily_failed   ?? 0),                inline: true  },
      { name: '⚡ Avg Convert Time',   value: avgMs > 0 ? fmtMs(avgMs) : '—',                   inline: true  },
      // Channels configured
      { name: '📺 Channel YouTube',    value: chVal(config?.ch_youtube),                          inline: true  },
      { name: '🎵 Channel TikTok',     value: chVal(config?.ch_tiktok),                           inline: true  },
      { name: '🎧 Channel Spotify',    value: chVal(config?.ch_spotify),                          inline: true  },
      { name: '🚨 Error Logs',         value: chVal(config?.ch_errors),                           inline: true  },
      { name: '📜 URL Logs',           value: chVal(config?.ch_url_logs),                         inline: true  },
    )
    .setFooter({ text: `${FOOTER_TEXT} • ${ts()}` });

  return embed;
}

/**
 * managerSetupPageEmbed — Setup sub-page embed.
 * Shown when owner selects an option from the Setup dropdown.
 *
 * @param {object} config       — boombox_config row
 * @param {string} page         — 'yt' | 'tk' | 'sp' | 'error' | 'urllogs'
 */
export function managerSetupPageEmbed(config, page) {
  const PLAT = {
    yt: { label: 'YouTube', emoji: '▶️', color: COLORS.YOUTUBE, ch: 'ch_youtube', pfx: 'yt' },
    tk: { label: 'TikTok',  emoji: '🎵', color: COLORS.TIKTOK,  ch: 'ch_tiktok',  pfx: 'tk' },
    sp: { label: 'Spotify', emoji: '🎧', color: COLORS.SPOTIFY, ch: 'ch_spotify',  pfx: 'sp' },
  };

  if (PLAT[page]) {
    const p   = PLAT[page];
    const pfx = p.pfx;
    const enabled    = (config?.[`${pfx}_enabled`]        ?? 1) ? '✅ Aktif' : '❌ Nonaktif';
    const gifProc    = config?.[`${pfx}_gif_processing`]  ?? '—';
    const gifSucc    = config?.[`${pfx}_gif_success`]     ?? '—';
    const maxDur     = config?.[`${pfx}_max_duration`]    ?? 0;
    const channel    = config?.[p.ch];

    return new EmbedBuilder()
      .setColor(p.color)
      .setTitle(`${p.emoji} Setup ${p.label}`)
      .setDescription(`Konfigurasi channel dan pengaturan konversi **${p.label}**.`)
      .addFields(
        { name: 'Channel',         value: chVal(channel),              inline: true  },
        { name: 'Status',          value: enabled,                     inline: true  },
        { name: 'Max Durasi',      value: maxDur > 0 ? `${maxDur}s` : 'Tidak ada batas', inline: true },
        { name: 'GIF Processing',  value: gifProc.length > 60 ? gifProc.slice(0, 57) + '...' : (gifProc || '—'), inline: false },
        { name: 'GIF Success',     value: gifSucc.length > 60 ? gifSucc.slice(0, 57) + '...' : (gifSucc || '—'), inline: false },
      )
      .setFooter({ text: `${FOOTER_TEXT} • Pilih channel di bawah, lalu klik Simpan` });
  }

  if (page === 'error') {
    return new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('🚨 BoomBox Error Logs')
      .setDescription(
        'Pilih channel yang akan menerima laporan error konversi.\n\n' +
        'Setiap error konversi (YouTube, TikTok, Spotify) akan otomatis dilaporkan ke channel ini dengan detail lengkap:\n' +
        'Platform, User, Guild, Channel, Link, Alasan Error, Worker, Queue, Timestamp, Stack Trace.'
      )
      .addFields(
        { name: 'Channel Error Logs Saat Ini', value: chVal(config?.ch_errors), inline: false },
      )
      .setFooter({ text: `${FOOTER_TEXT} • Pilih channel di bawah, lalu klik Simpan` });
  }

  if (page === 'urllogs') {
    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('📜 URL Logs Panel')
      .setDescription(
        'Pilih channel untuk Panel URL Logs.\n\n' +
        'Panel URL Logs bersifat **publik** — siapa saja dapat menggunakannya untuk mencari URL BoomBox yang pernah dibuat.\n\n' +
        'Panel berisi tombol: YouTube, TikTok, Spotify. Setiap tombol menampilkan daftar URL dengan paginasi (5 per halaman).'
      )
      .addFields(
        { name: 'Channel URL Logs Saat Ini', value: chVal(config?.ch_url_logs), inline: false },
      )
      .setFooter({ text: `${FOOTER_TEXT} • Pilih channel di bawah, lalu klik Simpan` });
  }

  return new EmbedBuilder()
    .setColor(COLORS.NEUTRAL)
    .setTitle('⚙️ Setup BoomBox')
    .setFooter(footer());
}

/**
 * managerWorkerPageEmbed — Worker settings sub-page.
 */
export function managerWorkerPageEmbed(config, workerPool = null) {
  const pm          = PERFORMANCE_MODES[config?.perf_mode] ?? PERFORMANCE_MODES.balanced;
  const workerCount = config?.worker_count    ?? pm.workers ?? 3;
  const autoMode    = !!(config?.worker_auto_mode);
  const queueLimit  = config?.queue_limit     ?? 50;
  const cacheLimit  = config?.cache_limit     ?? 2000;
  const autoRestart = !!(config?.auto_restart_worker ?? 1);
  const active      = workerPool?.activeCount ?? 0;
  const queue       = workerPool?.queueSize   ?? 0;

  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('👷 Worker Settings')
    .setDescription(
      '**Rekomendasi konfigurasi:**\n' +
      '• Server kecil (<50 anggota): 1–2 worker, Queue 20\n' +
      '• Server sedang (50–200): 3 worker, Queue 50\n' +
      '• Server aktif (200+): 5–8 worker, Queue 100\n' +
      '• Jangan melebihi 10 worker — dapat menyebabkan rate-limit.'
    )
    .addFields(
      { name: '👷 Worker Aktif',      value: `${active} / ${workerCount}`,                      inline: true  },
      { name: '📋 Queue Saat Ini',    value: String(queue),                                      inline: true  },
      { name: '⚙️ Worker Maks',       value: String(workerCount),                               inline: true  },
      { name: '🤖 Mode Auto',         value: autoMode ? '✅ Aktif' : '❌ Nonaktif',              inline: true  },
      { name: '📦 Queue Limit',       value: String(queueLimit),                                inline: true  },
      { name: '🗃️ Cache Limit',       value: String(cacheLimit),                                inline: true  },
      { name: '♻️ Auto Restart',      value: autoRestart ? '✅ Aktif' : '❌ Nonaktif',           inline: true  },
    )
    .setFooter({ text: `${FOOTER_TEXT} • Gunakan tombol di bawah untuk mengubah pengaturan` });
}

// ─── URL Logs Panel ───────────────────────────────────────────────────────────

/**
 * urlLogsPanelEmbed — Public panel shown in the URL Logs channel.
 */
export function urlLogsPanelEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.PANEL)
    .setTitle('📜 BoomBox URL Logs')
    .setDescription(
      'Cari URL BoomBox yang pernah dibuat.\n\n' +
      'Silakan pilih platform di bawah untuk melihat daftar URL yang tersimpan.\n' +
      'Hasil ditampilkan hanya untuk Anda (tidak terlihat oleh pengguna lain).'
    )
    .setFooter({ text: `${FOOTER_TEXT} • 5 URL per halaman` });
}

// ─── Archive Panel ────────────────────────────────────────────────────────────

export function archivePanelEmbed(counts) {
  return new EmbedBuilder()
    .setColor(COLORS.PANEL)
    .setTitle('BoomBox Logs')
    .setDescription(`**${counts.total}** URL tersimpan di database.`)
    .addFields(
      { name: 'YouTube', value: String(counts.yt ?? 0), inline: true },
      { name: 'TikTok',  value: String(counts.tk ?? 0), inline: true },
      { name: 'Spotify', value: String(counts.sp ?? 0), inline: true },
    )
    .setFooter(footer());
}

// ─── Settings Panel (comprehensive BoomBox Settings) ─────────────────────────

export function settingsEmbed(config, extra = {}) {
  const pm          = PERFORMANCE_MODES[config?.perf_mode] ?? PERFORMANCE_MODES.balanced;
  const replyMode   = config?.reply_mode === 'standalone' ? 'Pesan Baru' : 'Reply';
  const autoDelOn   = !!config?.delete_msgs;
  const workerCount = config?.worker_count ?? pm.workers ?? 3;
  const timeoutSec  = Math.round((config?.timeout_ms ?? pm.timeout ?? 30_000) / 1000);
  const retries     = Math.max(3, config?.retries ?? pm.retries ?? 3);

  const activeW     = extra.activeWorkers ?? '—';
  const queueSz     = extra.queueSize     ?? '—';
  const cacheSz     = extra.cacheSize     ?? '—';

  return new EmbedBuilder()
    .setColor(COLORS.PANEL)
    .setTitle('⚙️ BoomBox Settings')
    .addFields(
      { name: '── General ──', value: '\u200B', inline: false },
      { name: 'Auto Delete',  value: autoDelOn ? '✅ Aktif' : '❌ Nonaktif', inline: true },
      { name: 'Reply Mode',   value: replyMode,                               inline: true },
      { name: '\u200B',       value: '\u200B',                                inline: true },

      { name: '── Performance ──', value: '\u200B', inline: false },
      { name: 'Mode',          value: `${pm.name}`,                     inline: true },
      { name: 'Worker Count',  value: `${activeW} aktif / ${workerCount} maks`, inline: true },
      { name: 'Antrian',       value: String(queueSz),                   inline: true },
      { name: 'Timeout',       value: `${timeoutSec}s per attempt`,      inline: true },
      { name: 'Retries',       value: `${retries}x per job`,             inline: true },
      { name: 'CPU Mode',      value: 'Low-bitrate audio ✅',             inline: true },

      { name: '── Cache ──', value: '\u200B', inline: false },
      { name: 'Cache Entries', value: String(cacheSz), inline: true },
      { name: 'Cache TTL',     value: `${config?.cache_ttl ?? 300}s`,   inline: true },
      { name: '\u200B',        value: '\u200B',                          inline: true },

      { name: '── Provider Order (YouTube) ──', value: '① ytdl-core → ② Kaizen → ③ y2mp3 → ④ Cobalt', inline: false },

      { name: '── Maintenance ──', value: '\u200B', inline: false },
      { name: 'Health Monitor', value: '✅ Aktif (tiap 5 menit)', inline: true },
      { name: 'Auto Retry',     value: `✅ Aktif (${retries}x)`,  inline: true },
      { name: 'Fallback',       value: '✅ Aktif',                  inline: true },
    )
    .setFooter(footer());
}

// ─── Error Log (ch_errors only — full technical detail) ───────────────────────

export function errorLogEmbed(data) {
  const {
    category = 'Unknown',
    errorMessage = 'Tidak ada pesan error.',
    stack,
    platform,
    channelId,
    userId,
    originalUrl,
    queueId,
    elapsedMs,
    lastProvider,
    triedProviders = [],
    providerDetail,
    nodeVersion,
    memoryMB,
    environment,
    guildName,
    guildId,
    time,
    // New fields
    mediaTitle,
    cacheHit,
    workerActive,
    workerMax,
  } = data;

  const solution = ERROR_SOLUTIONS[category] ?? ERROR_SOLUTIONS.Unknown;

  const fields = [
    { name: '🗂️ Category',  value: category,                                          inline: true  },
    { name: '🔌 Plugin',    value: 'BoomBox',                                         inline: true  },
    { name: '🕐 Waktu',     value: time ?? ts(),                                      inline: true  },
    { name: '🏠 Guild',     value: guildName ? `${guildName} (${guildId})` : (guildId ?? '—'), inline: false },
  ];

  if (platform)   fields.push({ name: '📡 Platform',  value: (PLATFORM_META[platform]?.label ?? platform), inline: true });
  if (channelId)  fields.push({ name: '📢 Channel',   value: `<#${channelId}>`,  inline: true });
  if (userId)     fields.push({ name: '👤 User',       value: `<@${userId}>`,     inline: true });
  if (queueId)    fields.push({ name: '🔑 Queue ID',   value: `\`${queueId}\``,   inline: false });
  if (mediaTitle) fields.push({ name: '🎵 Nama Lagu',  value: mediaTitle.slice(0, 200), inline: false });

  if (originalUrl) {
    fields.push({ name: '🔗 Link Asli', value: `\`${originalUrl.slice(0, 300)}\``, inline: false });
  }

  // Cache & Worker info
  const cacheVal  = cacheHit != null ? (cacheHit ? '✅ Hit' : '❌ Miss') : '—';
  const workerVal = (workerActive != null && workerMax != null)
    ? `${workerActive} aktif / ${workerMax} maks`
    : (workerActive != null ? `${workerActive} aktif` : '—');

  fields.push({ name: '🗃️ Cache Status', value: cacheVal,  inline: true });
  fields.push({ name: '👷 Worker',        value: workerVal, inline: true });

  if (elapsedMs !== undefined && elapsedMs !== null) {
    fields.push({ name: '⏱️ Durasi', value: fmtMs(elapsedMs), inline: true });
  }

  if (lastProvider) {
    fields.push({ name: '⚡ Last Provider', value: lastProvider, inline: true });
  }

  if (triedProviders.length > 0) {
    const provLines = triedProviders.map((p, i) =>
      `\`${i + 1}. ${p.name}\` — ${(p.reason ?? 'Unknown').slice(0, 150)}`
    ).join('\n');
    fields.push({
      name:   '🔄 Provider yang Dicoba',
      value:  provLines.slice(0, 1024),
      inline: false,
    });
  } else if (providerDetail) {
    fields.push({ name: '🔄 Provider Detail', value: providerDetail.slice(0, 512), inline: false });
  }

  fields.push({ name: '❌ Penyebab', value: errorMessage.slice(0, 800), inline: false });

  // Stack trace — truncated to fit Discord field limit
  if (stack) {
    const stackTrimmed = stack.slice(0, 900);
    fields.push({
      name:  '📋 Stack Trace',
      value: `\`\`\`\n${stackTrimmed}\n\`\`\``,
      inline: false,
    });
  }

  fields.push({ name: '💡 Saran', value: solution, inline: false });

  // System info line
  const sysLine = [
    environment    ? `Env: ${environment}` : null,
    nodeVersion    ? `Node: ${nodeVersion}` : null,
    memoryMB != null ? `RAM: ${memoryMB} MB` : null,
  ].filter(Boolean).join(' • ');

  if (sysLine) {
    fields.push({ name: '🖥️ System', value: sysLine, inline: false });
  }

  return new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle(`⚠️ BoomBox Error — ${category}`)
    .addFields(...fields)
    .setTimestamp()
    .setFooter({ text: FOOTER_TEXT });
}

// ─── List (paginated) ─────────────────────────────────────────────────────────

export function listEmbed(rows, { platformLabel, sortName, page, totalPages, total, isFav, search }) {
  const title = isFav
    ? 'Favorit Saya'
    : search
      ? `Hasil Pencarian: "${search}"`
      : `Daftar ${platformLabel}`;

  const desc = rows.length === 0
    ? '_Tidak ada URL yang ditemukan._'
    : rows.map((m, i) => {
        const pm  = PLATFORM_META[m.platform] ?? { emoji: '🎵' };
        const num = page * PAGE_SIZE + i + 1;
        return `\`${String(num).padStart(3)}\` ${pm.emoji} **${(m.title || 'Tanpa Judul').slice(0, 55)}** — ${fmtDur(m.duration)}`;
      }).join('\n');

  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: `${FOOTER_TEXT} • Hal. ${page + 1}/${totalPages || 1} • ${total} URL • ${sortName}` });
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export function previewEmbed(media, isFav = false) {
  const pm = PLATFORM_META[media.platform] ?? { label: media.platform, emoji: '🎵', color: COLORS.INFO };
  const urlDisplay = media.boombox_url?.length > 800
    ? media.boombox_url.slice(0, 797) + '...'
    : media.boombox_url;

  return new EmbedBuilder()
    .setColor(pm.color)
    .setTitle((media.title || 'Tanpa Judul').slice(0, 200))
    .addFields(
      { name: 'Platform',         value: pm.label,                    inline: true },
      { name: 'Durasi',           value: fmtDur(media.duration),      inline: true },
      { name: 'Favorit',          value: isFav ? 'Ya' : 'Tidak',      inline: true },
      { name: 'Dibuat',           value: fmtDate(media.created_at),   inline: true },
      { name: 'Terakhir Dipakai', value: fmtDate(media.last_used),    inline: true },
      { name: 'Total Dipakai',    value: String(media.total_used),    inline: true },
      { name: 'BoomBox URL',      value: `\`\`\`\n${urlDisplay}\n\`\`\``, inline: false },
    )
    .setFooter(footer());
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export function statsEmbed(stats, counts) {
  const total    = stats.total_convert || 0;
  const hitRate  = total > 0 ? `${((stats.cache_hit  / total) * 100).toFixed(1)}%` : '0%';
  const missRate = total > 0 ? `${((stats.cache_miss / total) * 100).toFixed(1)}%` : '0%';

  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('BoomBox Statistics')
    .addFields(
      { name: 'Total URL',      value: String(counts.total),        inline: true },
      { name: 'YouTube',        value: String(counts.yt),           inline: true },
      { name: 'TikTok',         value: String(counts.tk),           inline: true },
      { name: 'Spotify',        value: String(counts.sp),           inline: true },
      { name: 'Total Convert',  value: String(total),               inline: true },
      { name: 'Cache Hit',      value: `${stats.cache_hit} (${hitRate})`,   inline: true },
      { name: 'Cache Miss',     value: `${stats.cache_miss} (${missRate})`, inline: true },
      { name: 'Sukses',         value: String(stats.success_count), inline: true },
      { name: 'Gagal',          value: String(stats.failed_count),  inline: true },
      { name: 'Retry',          value: String(stats.retry_count ?? 0), inline: true },
    )
    .setFooter(footer());
}

// ─── Recent Logs Panel ────────────────────────────────────────────────────────

export function recentLogsEmbed(entries) {
  const lines = entries.length > 0
    ? entries.map((e, i) => {
        const pm   = PLATFORM_META[e.platform] ?? { emoji: '🎵' };
        const date = e.created_at
          ? new Date(e.created_at * 1000).toLocaleString('id-ID', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })
          : '—';
        const title = (e.title || 'Tanpa Judul').slice(0, 45);
        return `\`${String(i + 1).padStart(2)}\` ${pm.emoji} **${title}**\n└ ${date}`;
      }).join('\n')
    : '_Belum ada konversi yang tercatat._';

  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('📋 BoomBox Logs Terbaru')
    .setDescription(lines.slice(0, 4096))
    .setFooter({ text: `${FOOTER_TEXT} • Update otomatis • ${ts()}` });
}

// ─── Legacy (unused but kept for safety) ─────────────────────────────────────

export function perfSelectEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('Pilih Mode Performa')
    .setDescription(
      Object.entries(PERFORMANCE_MODES)
        .filter(([k]) => k !== 'custom')
        .map(([, v]) => `**${v.name}** — ${v.description}`)
        .join('\n')
    )
    .setFooter(footer());
}
