/**
 * commands/setup.js — Unified /setup command.
 *
 * Replaces the old standalone commands:
 *   /setupboombox   → BoomBox tab (Turok's SetupManager)
 *   /setup          → Database tab (DB Manager wizard)
 *   /cticket        → Ticket tab (quick config summary)
 *   /cbug           → Bug Report tab (quick config summary)
 *   thread config   → Thread tab (summary)
 *
 * Flow:
 *   1. /setup → ephemeral overview embed + StringSelectMenu
 *   2. User picks a feature → embed updated in-place (interaction.update)
 *   3. Feature-specific sub-UIs (channel selects, modals, buttons) are handled
 *      by each feature's own interaction handler (bb:, db:, ticket:, bug:, etc.)
 *
 * Exported:
 *   data, execute      — slash command entry (loaded by commands/index.js)
 *   handleSetupInteraction — routes setup: customId interactions
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { denyIfNotStaff }     from '../middleware/permissions.js';
import { databaseDB }         from '../database/databaseDB.js';
import { ticketDB }           from '../database/ticketDB.js';
import { bugReportDB }        from '../database/bugReportDB.js';
import { threadDB }           from '../database/threadDB.js';
import {
  buildSetupWizardEmbed,
  buildSetupWizardComponents,
  buildSetupManageEmbed,
  buildSetupManageComponents,
} from '../features/database/embed.js';
import { getBoomBoxDB, getBoomBoxSetupManager } from '../features/boombox/index.js';
import { MCID } from '../features/boombox/constants.js';

// ── Slash command definition ────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Buka panel konfigurasi terpadu — BoomBox, Database, Ticket, Bug Report, Thread');

// ── Helpers ──────────────────────────────────────────────────────────────────

const COLOR_PANEL = 0x5865f2;
const FOOTER_TEXT = 'Pangeran Assistant AI • Setup Panel';

/** Build the main overview embed. */
function buildOverviewEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR_PANEL)
    .setTitle('🛠️ Setup & Konfigurasi')
    .setDescription(
      '━━━━━━━━━━━━━━━━━━\n\n' +
      'Pilih fitur yang ingin dikonfigurasi dari menu dropdown di bawah.\n\n' +
      '**Fitur yang tersedia:**\n' +
      '🎵 **BoomBox** — Setup BoomBox Manager v1.5 (channel, monitoring, arsip)\n' +
      '📊 **Database** — Bot Setting, Backup, Console, Member List\n' +
      '🎫 **Ticket** — Konfigurasi sistem tiket\n' +
      '🐞 **Bug Report** — Konfigurasi sistem laporan bug\n' +
      '🧵 **Auto Thread** — Status channel auto-thread\n\n' +
      '━━━━━━━━━━━━━━━━━━',
    )
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();
}

/** Build the main StringSelectMenu dropdown. */
function buildOverviewSelect(currentValue = null) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup:select')
      .setPlaceholder('⚙️ Pilih fitur untuk dikonfigurasi…')
      .addOptions([
        {
          label:       '🎵 BoomBox Manager',
          description: 'Setup channel, monitoring, dan konfigurasi BoomBox v1.5',
          value:       'boombox',
          default:     currentValue === 'boombox',
        },
        {
          label:       '📊 Database Manager',
          description: 'Bot Setting, Backup, Console, Member List',
          value:       'database',
          default:     currentValue === 'database',
        },
        {
          label:       '🎫 Ticket System',
          description: 'Konfigurasi channel panel tiket, log, dan mention role',
          value:       'ticket',
          default:     currentValue === 'ticket',
        },
        {
          label:       '🐞 Bug Report',
          description: 'Konfigurasi panel bug report dan feature request',
          value:       'bugreport',
          default:     currentValue === 'bugreport',
        },
        {
          label:       '🧵 Auto Thread',
          description: 'Lihat status channel yang menggunakan auto-thread',
          value:       'thread',
          default:     currentValue === 'thread',
        },
      ]),
  );
}

// ── Feature sub-panels ────────────────────────────────────────────────────────

/** BoomBox sub-panel: setup flow or already-configured status. */
async function showBoomBoxPanel(interaction) {
  const db = getBoomBoxDB();
  if (!db) {
    return interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('❌ BoomBox Belum Siap')
        .setDescription(
          'BoomBox belum selesai diinisialisasi.\n\n' +
          'Tunggu beberapa detik lalu coba lagi.',
        )
        .setFooter({ text: FOOTER_TEXT })],
      components: [buildOverviewSelect('boombox')],
    });
  }

  const config = db.getConfig(interaction.guildId);

  if (config && config.ch_monitor) {
    // Already configured — show status with Reset button
    const chMonitor = config.ch_monitor ? `<#${config.ch_monitor}>` : '❌ Belum diatur';
    const chYT      = config.ch_youtube  ? `<#${config.ch_youtube}>`  : '❌ Belum diatur';
    const chTK      = config.ch_tiktok   ? `<#${config.ch_tiktok}>`   : '❌ Belum diatur';
    const chSP      = config.ch_spotify  ? `<#${config.ch_spotify}>`  : '❌ Belum diatur';
    const chErr     = config.ch_errors   ? `<#${config.ch_errors}>`   : '❌ Belum diatur';

    return interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🎵 BoomBox Manager — Terkonfigurasi')
        .setDescription(
          'BoomBox sudah aktif di server ini.\n\n' +
          'Gunakan **Panel Manager** di channel monitoring untuk mengelola semua pengaturan.\n\n' +
          '⚠️ Klik **Reset** untuk menghapus konfigurasi dan memulai setup ulang.',
        )
        .addFields(
          { name: '📡 Monitoring', value: chMonitor, inline: true },
          { name: '▶️ YouTube',    value: chYT,       inline: true },
          { name: '🎵 TikTok',     value: chTK,       inline: true },
          { name: '🎧 Spotify',    value: chSP,       inline: true },
          { name: '🚨 Error Logs', value: chErr,       inline: true },
        )
        .setFooter({ text: FOOTER_TEXT })
        .setTimestamp()],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('setup:boombox:delete')
            .setLabel('🗑️ Reset Konfigurasi')
            .setStyle(ButtonStyle.Danger),
        ),
        buildOverviewSelect('boombox'),
      ],
    });
  }

  // Not configured — render channel picker in-place using update()
  // IMPORTANT: do NOT call deferUpdate() + handleSetupCommand() — that path
  // triggers interaction.reply() on an already-deferred interaction and crashes.
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_PANEL)
      .setTitle('⚙️ Setup BoomBox Manager')
      .setDescription(
        'Pilih channel yang akan dijadikan **BoomBox Monitoring**.\n\n' +
        'Panel BoomBox Manager akan dikirim ke channel tersebut setelah disimpan.',
      )
      .setFooter({ text: FOOTER_TEXT })],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(MCID.SETUP_CH)
          .setPlaceholder('Pilih channel untuk BoomBox Monitoring…')
          .addChannelTypes(ChannelType.GuildText),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(MCID.SETUP_SAVE)
          .setLabel('💾 Simpan')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
      ),
    ],
  });
}

/** Database sub-panel: wizard or manager. */
async function showDatabasePanel(interaction) {
  if (databaseDB.isSetup()) {
    return interaction.update({
      embeds:     [buildSetupManageEmbed(databaseDB.get())],
      components: [...buildSetupManageComponents(), buildOverviewSelect('database')],
    });
  }
  return interaction.update({
    embeds:     [buildSetupWizardEmbed()],
    components: [...buildSetupWizardComponents(), buildOverviewSelect('database')],
  });
}

/** Ticket sub-panel: current config summary. */
async function showTicketPanel(interaction) {
  try {
    // Try to use a ticket setup embed if it exists
    const { buildCticketEmbed: tcEmbed, buildCticketComponents: tcComp } =
      await import('../features/ticket/setupEmbed.js').catch(() => ({ buildCticketEmbed: null, buildCticketComponents: null }));

    if (tcEmbed && tcComp) {
      return interaction.update({
        embeds:     [tcEmbed(ticketDB.getConfig())],
        components: [tcComp(ticketDB.getConfig()), buildOverviewSelect('ticket')],
      });
    }
  } catch (_) {}

  const config = ticketDB.getConfig();
  const panelCh  = config.panelChannelId   ? `<#${config.panelChannelId}>`   : '❌ Belum diatur';
  const logsCh   = config.logsChannelId    ? `<#${config.logsChannelId}>`    : '❌ Belum diatur';
  const mention  = config.mentionRoleId    ? `<@&${config.mentionRoleId}>`   : '❌ Belum diatur';
  const claimCh  = config.claimChannelId   ? `<#${config.claimChannelId}>`   : '❌ Belum diatur';

  return interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_PANEL)
      .setTitle('🎫 Ticket System — Konfigurasi')
      .setDescription(
        'Gunakan `/cticket` untuk mengatur panel tiket.\n' +
        'Gunakan `/setclaimticket` untuk atur channel Staff Control.\n' +
        'Gunakan `/delcticket` untuk menghapus konfigurasi.',
      )
      .addFields(
        { name: '📋 Panel Channel',   value: panelCh,  inline: true },
        { name: '📜 Logs Channel',    value: logsCh,   inline: true },
        { name: '🔔 Mention Role',    value: mention,  inline: true },
        { name: '🎯 Staff Control',   value: claimCh,  inline: true },
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()],
    components: [buildOverviewSelect('ticket')],
  });
}

/** Bug Report sub-panel: current config summary. */
async function showBugReportPanel(interaction) {
  try {
    const { buildCbugEmbed: bugEmbed, buildCbugComponents: bugComp } =
      await import('../features/bugreport/setupEmbed.js').catch(() => ({ buildCbugEmbed: null, buildCbugComponents: null }));

    if (bugEmbed && bugComp) {
      const bugDB = await import('../database/bugReportDB.js').then(m => m.bugReportDB);
      return interaction.update({
        embeds:     [bugEmbed(bugDB.getConfig())],
        components: [bugComp(bugDB.getConfig()), buildOverviewSelect('bugreport')],
      });
    }
  } catch (_) {}

  const { bugReportDB } = await import('../database/bugReportDB.js');
  const config = bugReportDB.getConfig();
  const panelCh = config.panelChannelId ? `<#${config.panelChannelId}>` : '❌ Belum diatur';
  const logsCh  = config.logsChannelId  ? `<#${config.logsChannelId}>`  : '❌ Belum diatur';
  const devRole = config.devRoleId      ? `<@&${config.devRoleId}>`     : '❌ Belum diatur';

  return interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_PANEL)
      .setTitle('🐞 Bug Report — Konfigurasi')
      .setDescription(
        'Gunakan `/cbug` untuk mengatur panel bug report & feature request.\n' +
        'Gunakan `/delcbug` untuk menghapus konfigurasi.',
      )
      .addFields(
        { name: '📋 Panel Channel', value: panelCh, inline: true },
        { name: '📜 Logs Channel',  value: logsCh,  inline: true },
        { name: '👨‍💻 Dev Role',      value: devRole, inline: true },
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()],
    components: [buildOverviewSelect('bugreport')],
  });
}

/** Thread sub-panel: list enabled channels. */
async function showThreadPanel(interaction) {
  const enabledChannels = threadDB.getAll(interaction.guildId) ?? [];
  const lines = enabledChannels.length > 0
    ? enabledChannels.map((ch) => `• <#${ch}>`).join('\n')
    : '❌ Tidak ada channel yang mengaktifkan Auto Thread.';

  return interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_PANEL)
      .setTitle('🧵 Auto Thread — Status')
      .setDescription(
        'Gunakan `/thread on channel:#nama` untuk mengaktifkan.\n' +
        'Gunakan `/thread off channel:#nama` untuk menonaktifkan.\n' +
        'Gunakan `/thread list` untuk melihat semua channel.\n\n' +
        '**Channel yang aktif saat ini:**\n' +
        lines,
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()],
    components: [buildOverviewSelect('thread')],
  });
}

// ── Slash command entry ───────────────────────────────────────────────────────

/**
 * /setup slash command — shows the main overview panel.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  if (await denyIfNotStaff(interaction)) return;

  await interaction.reply({
    embeds:     [buildOverviewEmbed()],
    components: [buildOverviewSelect()],
    ephemeral:  true,
  });
}

// ── Interaction handler (called from interactionCreate.js) ────────────────────

/**
 * Route setup: customId interactions.
 * @param {import('discord.js').Interaction} interaction
 */
export async function handleSetupInteraction(interaction, _client) {
  const id = interaction.customId ?? '';

  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

  // Main feature dropdown
  if (id === 'setup:select' && interaction.isStringSelectMenu()) {
    const value = interaction.values[0];
    switch (value) {
      case 'boombox':   return showBoomBoxPanel(interaction);
      case 'database':  return showDatabasePanel(interaction);
      case 'ticket':    return showTicketPanel(interaction);
      case 'bugreport': return showBugReportPanel(interaction);
      case 'thread':    return showThreadPanel(interaction);
      default:
        return interaction.update({
          embeds:     [buildOverviewEmbed()],
          components: [buildOverviewSelect()],
        });
    }
  }

  // Back to overview button
  if (id === 'setup:back') {
    return interaction.update({
      embeds:     [buildOverviewEmbed()],
      components: [buildOverviewSelect()],
    });
  }

  // BoomBox reset config button (shown on "already configured" panel)
  if (id === 'setup:boombox:delete') {
    const setupManager = getBoomBoxSetupManager();
    if (!setupManager) {
      return interaction.reply({
        content: '❌ BoomBox tidak tersedia. Coba restart bot.',
        flags: MessageFlags.Ephemeral,
      });
    }
    // handleDeleteCommand sends its own ephemeral reply with a confirmation dialog.
    // This is a fresh button interaction — interaction.reply() is valid here.
    return setupManager.handleDeleteCommand(interaction);
  }
}
