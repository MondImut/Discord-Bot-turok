/**
 * BoomBox — Constants, performance modes, platform configs, error types.
 * v1.4: added Settings2 CIDs for the comprehensive BoomBox Settings panel.
 */

export const PLUGIN_NAME    = 'BoomBox';
export const PLUGIN_VERSION = '1.4.0';
export const FOOTER_TEXT    = 'Powered by Pangeran Assistant';

// ─── Platform identifiers ─────────────────────────────────────────────────────
export const PLATFORMS = {
  YOUTUBE: 'youtube',
  TIKTOK:  'tiktok',
  SPOTIFY: 'spotify',
};

// ─── Platform URL patterns ────────────────────────────────────────────────────
export const URL_PATTERNS = {
  youtube:    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|music\/watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  tiktok:     /(?:https?:\/\/)?(?:www\.)?(?:vm\.tiktok\.com|tiktok\.com\/@[^/]+\/video)\/([0-9]+)/,
  tiktokShort:/(?:https?:\/\/)?(?:vm\.tiktok\.com|vt\.tiktok\.com)\/([a-zA-Z0-9]+)/,
  spotify:    /(?:https?:\/\/)?open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/,
};

// ─── Performance modes ────────────────────────────────────────────────────────
export const PERFORMANCE_MODES = {
  eco: {
    name: 'Eco',
    workers: 1,
    timeout: 60_000,
    retries: 3,
    description: 'Hemat sumber daya, 1 worker aktif.',
  },
  balanced: {
    name: 'Balanced',
    workers: 3,
    timeout: 30_000,
    retries: 3,
    description: 'Keseimbangan kecepatan dan sumber daya (default).',
  },
  performance: {
    name: 'Performance',
    workers: 6,
    timeout: 20_000,
    retries: 3,
    description: 'Maksimum 6 worker, cocok untuk server aktif.',
  },
  custom: {
    name: 'Custom',
    workers: null,
    timeout: null,
    retries: null,
    description: 'Konfigurasi manual oleh admin.',
  },
};

// ─── Error categories ─────────────────────────────────────────────────────────
export const ERROR_TYPES = {
  SETUP:      'Setup',
  QUEUE:      'Queue',
  WORKER:     'Worker',
  DOWNLOADER: 'Downloader',
  PROVIDER:   'Provider',
  CACHE:      'Cache',
  DATABASE:   'Database',
  ARCHIVE:    'Archive',
  SETTINGS:   'Settings',
  PANEL:      'Panel',
  UNKNOWN:    'Unknown',
};

// ─── Suggested solutions per category ────────────────────────────────────────
export const ERROR_SOLUTIONS = {
  Setup:      'Jalankan `/setupboombox` ulang dan pastikan bot memiliki akses ke semua channel.',
  Queue:      'Restart bot jika antrian macet. Cek kapasitas worker di BoomBox Settings.',
  Worker:     'Periksa koneksi internet bot. Coba ganti mode performa ke Eco di BoomBox Settings.',
  Downloader: 'Provider mungkin down. Bot akan otomatis mencoba provider lain secara berurutan.',
  Provider:   'Semua provider gagal. Tunggu beberapa menit lalu coba lagi — cooldown aktif otomatis.',
  Cache:      'Hapus cache di BoomBox Settings, lalu coba konversi ulang.',
  Database:   'Periksa status bot dan storage. Gunakan Rebuild Database di BoomBox Settings.',
  Archive:    'Coba refresh Archive Panel. Jika tetap error, hubungi admin.',
  Settings:   'Coba interaksi ulang Settings Panel.',
  Panel:      'Jalankan `/setupboombox` → Rebuild Panel untuk memulihkan panel.',
  Unknown:    'Error tidak diketahui. Detail teknis tersedia di stack trace di atas.',
};

// ─── Embed colors ─────────────────────────────────────────────────────────────
export const COLORS = {
  YOUTUBE: 0xFF0000,
  TIKTOK:  0x010101,
  SPOTIFY: 0x1DB954,
  SUCCESS: 0x57F287,
  ERROR:   0xED4245,
  WARNING: 0xFEE75C,
  INFO:    0x5865F2,
  NEUTRAL: 0x2B2D31,
  PANEL:   0x23272A,
};

// ─── Platform emojis & labels ─────────────────────────────────────────────────
export const PLATFORM_META = {
  youtube: { label: 'YouTube',   emoji: '▶️', color: COLORS.YOUTUBE },
  tiktok:  { label: 'TikTok',   emoji: '🎵', color: COLORS.TIKTOK  },
  spotify: { label: 'Spotify',  emoji: '🎧', color: COLORS.SPOTIFY },
  mp4:     { label: 'MP4 File', emoji: '🎬', color: COLORS.INFO    },
};

// ─── Pagination ───────────────────────────────────────────────────────────────
export const PAGE_SIZE   = 5;
export const SELECT_SIZE = 25;

// ─── Custom IDs (prefix: bb:) ─────────────────────────────────────────────────
export const CID = {
  // ── Success result buttons ────────────────────────────────────────────────
  SUCCESS_COPY:    'bb:success:copy',
  SUCCESS_PREVIEW: 'bb:success:preview',

  // ── Archive panel buttons ─────────────────────────────────────────────────
  ARCHIVE_YT:    'bb:archive:youtube',
  ARCHIVE_TK:    'bb:archive:tiktok',
  ARCHIVE_SP:    'bb:archive:spotify',
  ARCHIVE_SEARCH:'bb:archive:search',
  ARCHIVE_FAV:   'bb:archive:fav',
  ARCHIVE_STATS: 'bb:archive:stats',

  // ── List navigation ───────────────────────────────────────────────────────
  LIST_FIRST:  'bb:list:first',
  LIST_PREV:   'bb:list:prev',
  LIST_PAGE:   'bb:list:page',
  LIST_NEXT:   'bb:list:next',
  LIST_LAST:   'bb:list:last',
  LIST_SEARCH: 'bb:list:search',
  LIST_SORT:   'bb:list:sort',
  LIST_FAV:    'bb:list:fav',
  LIST_HOME:   'bb:list:home',
  LIST_SELECT: 'bb:list:select',

  // ── Preview ───────────────────────────────────────────────────────────────
  PREVIEW_COPY: 'bb:preview:copy',
  PREVIEW_FAV:  'bb:preview:fav',
  PREVIEW_BACK: 'bb:preview:back',

  // ── Modals ────────────────────────────────────────────────────────────────
  MODAL_PAGE:         'bb:modal:page',
  MODAL_SEARCH:       'bb:modal:search',
  MODAL_SEARCH_INPUT: 'bb:modal:search:input',
  MODAL_PAGE_INPUT:   'bb:modal:page:input',
  // ── BoomBox Logs Panel (Archive, Search, Favorite, Stats) ─────────────────
  // These route to ArchiveHandler, same as before.
  SETTINGS_AUTODEL:    'bb:settings:autodel',
  SETTINGS_REPLY_MODE: 'bb:settings:replymode',
  SETTINGS_PERF:       'bb:settings:perf',
  SETTINGS_CLEAR_CACHE:'bb:settings:clearcache',

  // ── BoomBox Settings Panel (new comprehensive panel) ──────────────────────
  // General
  S2_AUTODEL:       'bb:s2:autodel',       // Toggle Auto Delete
  S2_REPLY_MODE:    'bb:s2:replymode',     // Toggle Reply Mode

  // Performance
  S2_PERF:          'bb:s2:perf',          // StringSelect: performance mode

  // Worker
  S2_WORKERS_INC:   'bb:s2:workers:inc',   // +1 worker
  S2_WORKERS_DEC:   'bb:s2:workers:dec',   // -1 worker

  // Cache
  S2_CACHE_CLEAR:   'bb:s2:cache:clear',   // Clear in-memory cache
  S2_CACHE_REBUILD: 'bb:s2:cache:rebuild', // Rebuild cache from DB

  // Maintenance
  S2_DB_REBUILD:    'bb:s2:db:rebuild',    // Rebuild DB (vacuum + checkpoint)
  S2_STATS_RESET:   'bb:s2:stats:reset',   // Reset conversion stats

  // Retry / Timeout tabs (info only — changed via perf mode)
  S2_REFRESH:       'bb:s2:refresh',       // Refresh settings display
};

// ─── BoomBox Manager Panel CIDs ───────────────────────────────────────────────
// All new manager interactions use bb:mgr: prefix to avoid conflicts.
export const MCID = {
  // Manager main panel buttons
  REFRESH:      'bb:mgr:refresh',
  WORKER_PAGE:  'bb:mgr:worker',
  CLEAR_CACHE:  'bb:mgr:cache',
  SAVE:         'bb:mgr:save',
  BACK:         'bb:mgr:back',
  DROPDOWN:     'bb:mgr:dropdown',

  // Setup page channel selects
  CH_MONITOR:   'bb:mgr:ch:monitor',
  CH_YT:        'bb:mgr:ch:yt',
  CH_TK:        'bb:mgr:ch:tk',
  CH_SP:        'bb:mgr:ch:sp',
  CH_ERRORS:    'bb:mgr:ch:errors',
  CH_URLLOGS:   'bb:mgr:ch:urllogs',

  // Platform page buttons
  YT_TOGGLE:    'bb:mgr:yt:toggle',
  TK_TOGGLE:    'bb:mgr:tk:toggle',
  SP_TOGGLE:    'bb:mgr:sp:toggle',
  YT_MEDIA:     'bb:mgr:yt:media',
  TK_MEDIA:     'bb:mgr:tk:media',
  SP_MEDIA:     'bb:mgr:sp:media',

  // Worker page buttons
  WORKER_MINUS: 'bb:mgr:wk:minus',
  WORKER_PLUS:  'bb:mgr:wk:plus',
  WORKER_AUTO:  'bb:mgr:wk:auto',
  WORKER_LIMITS:'bb:mgr:wk:limits',

  // URL Logs panel
  URLLOGS_YT:   'bb:urllogs:yt',
  URLLOGS_TK:   'bb:urllogs:tk',
  URLLOGS_SP:   'bb:urllogs:sp',
  // Pagination: bb:urllogs:nav:{plat}:{page}
  URLLOGS_NAV:  'bb:urllogs:nav',

  // Initial setup ephemeral
  SETUP_CH:     'bb:setup:initial:ch',
  SETUP_SAVE:   'bb:setup:initial:save',

  // Delete confirmation
  DEL_CONFIRM:  'bb:del:confirm',
  DEL_CANCEL:   'bb:del:cancel',

  // Modals
  MODAL_YT_MEDIA:      'bb:mgr:modal:yt:media',
  MODAL_TK_MEDIA:      'bb:mgr:modal:tk:media',
  MODAL_SP_MEDIA:      'bb:mgr:modal:sp:media',
  MODAL_WORKER_LIMITS: 'bb:mgr:modal:wk:limits',
};

// ─── Sort options ─────────────────────────────────────────────────────────────
export const SORT_OPTIONS = [
  { label: 'Terbaru',               value: 'newest',    sql: 'created_at DESC' },
  { label: 'Terlama',               value: 'oldest',    sql: 'created_at ASC'  },
  { label: 'A → Z',                 value: 'az',        sql: 'title COLLATE NOCASE ASC'  },
  { label: 'Z → A',                 value: 'za',        sql: 'title COLLATE NOCASE DESC' },
  { label: 'Paling Sering Dipakai', value: 'top_used',  sql: 'total_used DESC' },
  { label: 'Terakhir Dipakai',      value: 'last_used', sql: 'last_used DESC'  },
];
