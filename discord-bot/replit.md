# Pangeran Assistant AI — Discord Bot

## Project Overview

Unified Discord bot that merges **Bot Fandli** (base platform) with **Bot Turok's BoomBox v1.5.0** plugin.

### Features

| Feature | Source | Status |
|---|---|---|
| BoomBox v1.5.0 (multi-guild audio converter) | Turok | ✅ Merged |
| Keylogger/Malware Scanner | Fandli | ✅ Present |
| Ticket System | Fandli | ✅ Present |
| Bug Report Center | Fandli | ✅ Present |
| Premium & Limit System | Fandli | ✅ Present |
| CPanel (role-button panels) | Fandli | ✅ Present |
| Auto Thread | Fandli | ✅ Present |
| Database Manager | Fandli | ✅ Present |
| Help System | Fandli | ✅ Present |
| Unified `/setup` command | New | ✅ Built |

### Architecture

- **Foundation**: Bot Fandli (`discord.js v14`, ESM, JSON databases for most features)
- **BoomBox**: Turok's plugin fully replaced Fandli's old BoomBox; uses `better-sqlite3` SQLite DB at `data/database/boombox.db`
- **Dual DB**: JSON files (`data/*.json`) for Premium/Ticket/Bug/CPanel/Thread/Database; SQLite for BoomBox only
- **No PluginBase/Application framework**: BoomBox initialized directly via `src/features/boombox/index.js` shim

### Commands

**User-facing**: `/help`

**Staff/Owner**: `/setup`, `/addprem`, `/removeprem`, `/setlimit`, `/resetlimit`, `/premstats`, `/thread`, `/cpanel`, `/cc`, `/deploy`, `/cticket`, `/cbug`, `/setclaimticket`, `/delcticket`, `/delcbug`

**Text command**: `!hesu` (bot status)

### Setup

1. Set `BOT_TOKEN` secret (Discord bot token)
2. Set `SCAN_CHANNEL_ID` secret (channel ID for malware scanner)
3. Run `/deploy` once after startup to register slash commands
4. Run `/setup` to configure BoomBox, Database, Ticket, Bug Report, Thread channels

### Structure

```
discord-bot/
  src/
    index.js              — Entry point; setup server if no token
    events/               — ready, messageCreate, interactionCreate
    commands/             — All slash commands + deploy logic
    features/
      boombox/            — Turok BoomBox v1.5.0 (full plugin)
      scanner/            — Keylogger/Malware scanner
      ticket/             — Ticket system
      bugreport/          — Bug report center
      premium/            — Premium & limit management
      cpanel/             — (empty; files live in setup/cpanel/)
      database/           — Database Manager panels
      help/               — Help command
      queue/              — Legacy Fandli queue (used by !hesu status only)
      setup/
        cpanel/           — CPanel interaction handlers
        setupServer.js    — HTTP server for initial token setup
    database/             — JSON DB singletons (premDB, ticketDB, etc.)
    handlers/             — Message/scan/interaction routers
    middleware/           — Permission checks
    utils/                — Logger, errorLogger, etc.
  config/                 — Bot constants, settings, roles, channels
  data/                   — Runtime data (JSON + SQLite, gitignored)
```

## User Preferences

- Language: Indonesian (Bahasa Indonesia) for all user-facing text
- Keep Bot Fandli as the base; only BoomBox is from Turok
- Do not add features not present in either original project
- User-facing commands must not change (only `/setup` is new/consolidated)
