/**
 * ConversionLogger — Posts a compact success log to the BoomBox Logs channel (ch_logs)
 * after every successful conversion.
 *
 * Log contains ONLY:
 *   - Judul
 *   - Platform
 *   - BoomBox URL
 *   - Tanggal
 *
 * No user mention. No queue ID. No stack trace. No errors.
 *
 * This is separate from ErrorLogger (which handles failures → ch_errors).
 */

import { EmbedBuilder } from 'discord.js';
import { COLORS, PLATFORM_META, FOOTER_TEXT } from '../constants.js';

function ts() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildLogEmbed({ title, platform, boomboxUrl }) {
  const pm   = PLATFORM_META[platform] ?? { label: platform, emoji: '🎵', color: COLORS.SUCCESS };
  const date = new Date().toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return new EmbedBuilder()
    .setColor(pm.color ?? COLORS.SUCCESS)
    .setTitle(`${pm.emoji ?? '🎵'} BoomBox Berhasil`)
    .addFields(
      { name: 'Judul',       value: (title?.slice(0, 256) || 'Tanpa Judul'), inline: false },
      { name: 'Platform',    value: pm.label,   inline: true },
      { name: 'Tanggal',     value: date,        inline: true },
      { name: 'BoomBox URL', value: boomboxUrl?.slice(0, 500) || '—', inline: false },
    )
    .setFooter({ text: `${FOOTER_TEXT} • ${ts()}` });
}

export class ConversionLogger {
  #client;
  #db;
  #logger;

  constructor(client, db, logger) {
    this.#client = client;
    this.#db     = db;
    this.#logger = logger;
  }

  /**
   * Post a success log to ch_logs.
   * Never throws — any failure is swallowed and logged internally.
   *
   * @param {string} guildId
   * @param {{ title: string, platform: string, boomboxUrl: string }} data
   */
  /**
   * No-op: ConversionLogger previously sent new embeds to ch_logs via channel.send()
   * after every successful conversion. All log updates now go exclusively through
   * PanelManager.updateLogsPanel() (message.edit() on the permanent Logs Panel).
   *
   * Kept for backward compatibility — calling this method intentionally does nothing.
   */
  async log(_guildId, _data) {
    // Intentionally empty — no channel.send() ever.
  }
}
