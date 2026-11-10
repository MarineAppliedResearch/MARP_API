/**
 * A video's clock on the video page (#76): what to say about it, what to offer in the box,
 * and what a reading off the picture is sent as.
 *
 * Isaac, 2026-11-09: the clock is set the way the annotation GUI's Sync Time is -- pause on a
 * frame showing the clock burnt into the picture and type its date and time -- and it belongs
 * to the video, so setting it corrects every observation in it. All of it is UTC, and the
 * `datetime-local` box carries no zone, so the `Z` is added and removed here and nowhere else.
 */

/* Two digits, three for milliseconds. */
const pad = (value, width = 2) => String(value).padStart(width, '0');

/** `2021-06-14T16:40:41.000Z` as `2021-06-14 16:40:41 UTC`. */
export function clockText(iso) {
  return `${String(iso).slice(0, 10)} ${String(iso).slice(11, 19)} UTC`;
}

/**
 * The line under the title: when this video's recording started, or that it has no clock
 * and its times are positions in the video -- said, so nobody reads them as clock times.
 *
 * @param {Object|null} clock - `GET /videos/clock`'s answer, or null when it could not be read.
 * @returns {{text: string, unset: boolean}}
 */
export function clockLine(clock) {
  if (!clock) return { text: 'Clock unknown', unset: true };
  if (!clock.recorded_start) return { text: 'No clock set: times are positions in the video', unset: true };
  const how = { 'file-name': 'from the file name', entered: 'entered', synced: 'read off the picture' }[clock.start_source];
  return { text: `Recording started ${clockText(clock.recorded_start)}${how ? ` (${how})` : ''}`, unset: false };
}

/**
 * A position in the video as the API takes it, `hh:mm:ss.fff`.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function positionText(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/**
 * What the box offers at a position: the clock time there by the clock already set, or else
 * by the file name's, or nothing to offer.
 *
 * @param {Object|null} clock
 * @param {number} seconds - Where the picture is.
 * @returns {string} A `datetime-local` value, UTC, or ''.
 */
export function readingOffered(clock, seconds) {
  const start = clock && (clock.recorded_start || clock.suggested_start);
  if (!start) return '';
  return new Date(Date.parse(start) + Math.round(seconds * 1000)).toISOString().slice(0, 23);
}

/**
 * A typed reading as the request body, or null when nothing usable was typed.
 *
 * `source` is `file-name` when the reading is the one the file name offered, left as it
 * was -- accepting it -- and `synced` otherwise, a reading off the picture.
 *
 * @param {string} typed - The box's value, UTC.
 * @param {number} seconds - The position it was read at.
 * @param {Object|null} clock
 * @returns {{clock: string, at_media_position: string, source: string}|null}
 */
export function readingBody(typed, seconds, clock) {
  const value = String(typed || '').trim();
  if (!value) return null;
  const at = Date.parse(value.length === 16 ? `${value}:00Z` : `${value}Z`);
  if (!Number.isFinite(at)) return null;
  const offered = clock && !clock.recorded_start && clock.suggested_start
    ? Date.parse(clock.suggested_start) + Math.round(seconds * 1000)
    : null;
  return {
    clock: new Date(at).toISOString(),
    at_media_position: positionText(seconds),
    source: at === offered ? 'file-name' : 'synced'
  };
}
