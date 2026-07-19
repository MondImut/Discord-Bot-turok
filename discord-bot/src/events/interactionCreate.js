/**
 * src/events/interactionCreate.js — interactionCreate event handler.
 *
 * Interaction prefix routing:
 *   bb:        BoomBox v1.5 (Turok) — all buttons, selects, modals, channel selects
 *   ps:        Premium Stats dashboard
 *   ticket:    Ticket system
 *   bug:       Bug Report system
 *   sk:        Scanner (scan again, full preview, etc.)
 *   cp:        CPanel role-button panels
 *   help:      Help command category select
 *   db:        Database system (Bot Setting, Backup, Console, Member List)
 *   setup:     Unified /setup dropdown interactions
 *
 * Removed (old Fandli BoomBox):
 *   bm:        (was BoomBox queue controls — retired)
 *   bblog:     (was BoomBox Log dashboard — retired, PanelManager handles now)
 *   bbsetup:   (was BoomBox setup — retired, SetupManager handles via bb: prefix)
 */

import { logger }                      from '../utils/logger.js';
import { logError }                    from '../utils/errorLogger.js';
import { handlePremStatsInteraction }  from '../features/premium/statsInteraction.js';
import { handleTicketInteraction }     from '../features/ticket/interaction.js';
import { handleBugReportInteraction }  from '../features/bugreport/interaction.js';
import { handleScanButtonInteraction } from '../handlers/scanInteractionHandler.js';
import { handleCpanelInteraction }     from '../features/setup/cpanel/interaction.js';
import { handleHelpInteraction }       from '../features/help/handler.js';
import { handleDatabaseInteraction }   from '../features/database/interaction.js';
import { handleSetupInteraction }      from '../commands/setup.js';
import { getBoomBoxInteractionHandler } from '../features/boombox/index.js';

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {Map<string,any>} commands   Loaded slash command map
 * @param {import('discord.js').Client} client
 */
export async function handleInteractionCreate(interaction, commands, client) {
  try {
    // ── Slash commands ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Slash command tidak dikenal: /${interaction.commandName}`);
        await interaction.reply({ content: '❌ Perintah tidak dikenal.', ephemeral: true }).catch(() => {});
        return;
      }
      await command.execute(interaction, { commands });
      return;
    }

    const isBtn       = interaction.isButton();
    const isSelect    = interaction.isStringSelectMenu();
    const isChanSel   = interaction.isChannelSelectMenu();
    const isAnySelect = isSelect || isChanSel;
    const isModal     = interaction.isModalSubmit();
    if (!isBtn && !isAnySelect && !isModal) return;

    const id = interaction.customId ?? '';

    // ── BoomBox v1.5 (Turok) — handles all bb: prefixed interactions ────────
    if (id.startsWith('bb:')) {
      const bbHandler = getBoomBoxInteractionHandler();
      if (bbHandler) {
        await bbHandler.handle(interaction);
      }
      return;
    }

    // ── Unified /setup dropdown ──────────────────────────────────────────────
    if (id.startsWith('setup:')) {
      await handleSetupInteraction(interaction, client);
      return;
    }

    // ── Premium Stats dashboard ─────────────────────────────────────────────
    if (id.startsWith('ps:')) {
      await handlePremStatsInteraction(interaction, client);
      return;
    }

    // ── Ticket system ────────────────────────────────────────────────────────
    if (id.startsWith('ticket:')) {
      await handleTicketInteraction(interaction);
      return;
    }

    // ── Bug Report system ────────────────────────────────────────────────────
    if (id.startsWith('bug:')) {
      await handleBugReportInteraction(interaction);
      return;
    }

    // ── Scanner ──────────────────────────────────────────────────────────────
    if (isBtn && id.startsWith('sk:')) {
      await handleScanButtonInteraction(interaction);
      return;
    }

    // ── CPanel ───────────────────────────────────────────────────────────────
    if (id.startsWith('cp:')) {
      await handleCpanelInteraction(interaction);
      return;
    }

    // ── Help command category select ─────────────────────────────────────────
    if (id === 'help:category') {
      await handleHelpInteraction(interaction);
      return;
    }

    // ── Database system ──────────────────────────────────────────────────────
    if (id.startsWith('db:')) {
      await handleDatabaseInteraction(interaction);
      return;
    }

  } catch (err) {
    logger.error('Kesalahan tak terduga saat memproses interaksi', err);
    await logError({
      feature: interaction.isChatInputCommand() ? 'Commands' : 'Interaction',
      command: interaction.isChatInputCommand()
        ? `/${interaction.commandName}`
        : interaction.customId,
      reason:  err?.message ?? String(err),
      stage:   'interactionCreate',
      user:    interaction.user?.id,
      guild:   interaction.guildId,
      channel: interaction.channelId,
      error:   err,
    }).catch(() => {});
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Terjadi kesalahan saat menjalankan perintah ini.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
}
