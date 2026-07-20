# Pangeran Assistant AI — Discord Bot

Discord bot gabungan (Bot Fandli + BoomBox Turok v1.5.0). Fitur: BoomBox (konversi YouTube/TikTok/Spotify ke MP3), sistem tiket, bug report, premium, CPanel, scanner keylogger/malware, auto thread, database manager.

## Run & Operate

- **Start bot**: workflow `Discord Bot` — `pnpm --filter @workspace/discord-bot run start`
- **Required secrets**: `BOT_TOKEN` (Discord bot token), `SCAN_CHANNEL_ID` (channel ID scanner)
- **Pertama kali**: jalankan `/deploy` setelah bot online untuk mendaftarkan slash commands, lalu `/setup` untuk konfigurasi channel

## Stack

- Node.js 20 (ESM), discord.js v14
- pnpm workspaces (`@workspace/discord-bot`)
- Database: JSON files (`data/*.json`) untuk fitur Fandli; SQLite (`better-sqlite3 v12`) untuk BoomBox di `data/database/boombox.db`
- Audio pipeline: yt-dlp → ffmpeg → Top4Top upload

## Where things live

- `discord-bot/src/` — source utama bot
- `discord-bot/src/features/boombox/` — BoomBox plugin (Turok)
- `discord-bot/src/features/` — semua fitur lain (scanner, ticket, premium, dll)
- `discord-bot/config/` — konstanta, channel IDs, role IDs, settings
- `discord-bot/data/` — runtime data (gitignored)

## Architecture decisions

- BoomBox diinisialisasi langsung via `src/features/boombox/index.js` — tidak ada PluginBase/Application framework
- Spotify: oEmbed hanya untuk metadata (title, artist); audio penuh diambil dari YouTube Music/YouTube via yt-dlp `ytmsearch1:` — tidak ada 30-detik preview
- `better-sqlite3` harus v12.x (v9 gagal compile di Node.js 24)
- BoomBox setup panel menggunakan `interaction.update()`, bukan `deferUpdate()` + `reply()`

## User preferences

- Bahasa Indonesia untuk semua teks user-facing
- Basis adalah Bot Fandli; hanya BoomBox yang dari Turok
- Jangan tambah fitur di luar yang ada di kedua project asli
- Perintah user-facing tidak boleh diubah (hanya `/setup` yang baru/konsolidasi)

## Pointers

- Lihat `discord-bot/replit.md` untuk dokumentasi lengkap fitur dan struktur
- Lihat `discord-bot/.agents/memory/MEMORY.md` untuk catatan keputusan teknis
