/**
 * YouTube Provider: @distube/ytdl-core
 * Direct extraction — metadata + audio URL.
 * Primary provider; first tried.
 *
 * Audio quality: always selects the LOWEST valid bitrate to conserve
 * RAM, CPU, and bandwidth on Replit. Falls back gracefully if formats
 * are unavailable — never throws when a URL can be returned.
 */

import ytdl from '@distube/ytdl-core';

const URL_TTL_MS = 6 * 60 * 60 * 1000; // YouTube CDN URLs expire ~6 h

/**
 * Score a format for "lowest valid audio" selection.
 * Lower score = preferred (we want the smallest valid file).
 * @param {object} fmt
 * @returns {number}
 */
function audioScore(fmt) {
  // Prefer audio-only streams
  const isAudioOnly = fmt.hasAudio && !fmt.hasVideo;
  // Prefer lower bitrate (smaller = better for Replit)
  const bitrate = fmt.audioBitrate ?? fmt.bitrate ?? 9999;
  // Penalise video streams heavily
  return (isAudioOnly ? 0 : 100_000) + bitrate;
}

export async function ytdlProvider(url) {
  const info    = await ytdl.getInfo(url);
  const details = info.videoDetails;

  // Collect all formats that have audio
  const formats = info.formats.filter((f) => f.hasAudio && f.url);

  if (!formats.length) {
    throw new Error('ytdl-core: tidak ada format audio yang tersedia untuk video ini.');
  }

  // Sort ascending by audioScore → pick the lowest (smallest/cheapest)
  formats.sort((a, b) => audioScore(a) - audioScore(b));
  const chosen = formats[0];

  if (!chosen?.url) {
    throw new Error('ytdl-core: format audio tidak memiliki URL yang valid.');
  }

  return {
    platform:     'youtube',
    id:           details.videoId,
    title:        details.title,
    duration:     parseInt(details.lengthSeconds, 10) || 0,
    boomboxUrl:   chosen.url,
    urlExpiresAt: Math.floor((Date.now() + URL_TTL_MS) / 1000),
  };
}
