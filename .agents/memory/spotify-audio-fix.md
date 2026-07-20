---
name: Spotify audio source fix
description: Spotify oEmbed dipakai hanya untuk metadata; audio full-duration diambil dari YouTube Music/YouTube via yt-dlp search.
---

# Spotify audio source fix

Spotify provider (`discord-bot/src/features/boombox/platforms/providers/spotify/oembed.js`) sebelumnya mengambil `preview_url` (p.scdn.co/mp3-preview/) sebagai sumber audio, menghasilkan output 30 detik.

**Rule:** Spotify hanya boleh dipakai untuk metadata (title, author_name via oEmbed). Audio diambil penuh dari YouTube Music (`ytmsearch1:title artist`) dengan fallback ke YouTube (`ytsearch1:title artist`) melalui yt-dlp.

**Why:** Spotify Free/Web tidak menyediakan akses audio penuh tanpa API key premium. Semua provider audio Spotify yang tidak butuh key hanya bisa mengambil 30-detik preview.

**How to apply:** Kalau ada perubahan pada Spotify provider, pastikan tidak ada referensi ke `p.scdn.co`, `audioPreview`, `preview_url`, atau `scrapePreview`. Provider harus mengembalikan `filePath` (dari yt-dlp search), bukan `audioUrl` ke Spotify CDN.
