/**
 * What a mosaic row means, where reading it is more than reading a field.
 *
 * No DOM, no network. Two of the fields a tile draws are a *pair* rather than a value, and
 * getting the pair wrong is silent — which is why the rule lives here and is tested here
 * rather than being written out at each of the four places that needs it.
 */

import { timeOfDayMs } from './match.js';

/**
 * The species the observation **is now**.
 *
 * The row carries two names and they are deliberately different things (F6):
 *
 * - `comname` is the label the species list entry carried **when the annotator chose it**.
 *   It is never rewritten, including by a species correction, and that is what makes the
 *   drift from `species_id` auditable rather than silently tidied away.
 * - `species_comname` is the **current** catalogue name of the species the observation is
 *   now classified as, joined from `species`.
 *
 * So a corrected observation has a stale `comname` for ever. Drawing `comname` shows the
 * old animal on every reload while the species *filter* — which is `species_id` — matches
 * the new one, so a page filtered to one species renders tiles labelled as another.
 *
 * The fallback is not decoration: `species_comname` is null where the observation has no
 * species at all, which about 4% of rows legitimately do.
 *
 * @param {Object} row - A mosaic row.
 * @returns {string|null} The name to show.
 */
export const currentSpeciesName = (row) =>
  (row && (row.species_comname != null ? row.species_comname : row.comname)) || null;

/**
 * A reviewer's initials from their username, the same rule the server uses for the badge.
 *
 * @param {string} username
 * @returns {string|null}
 */
export function initialsOfUsername(username) {
  const parts = String(username || '').split(/[\s._-]+/u).filter(Boolean);
  if (!parts.length) return null;
  const firstPart = Array.from(parts[0]);
  return (parts.length > 1
    ? (firstPart[0] || '') + (Array.from(parts[parts.length - 1])[0] || '')
    : firstPart.slice(0, 2).join('')).toUpperCase();
}

/**
 * The label the annotator chose, which is what "was X" means.
 *
 * Separate from {@link currentSpeciesName} so the two can never be swapped by accident,
 * and named for what it is rather than for the column it reads.
 *
 * **This is not what the tile's "was X" chip draws.** A12 was answered against the
 * recommendation: the chip appears only after a correction made in the current session,
 * from `state.changed`, so legacy drift between the two names stays invisible and this
 * phase is a port rather than a behaviour change. This exists because the *reason* the two
 * fields differ has to be legible from the code, and because `hasDrifted` below is how a
 * later phase would surface it if the human ever asks for that.
 *
 * @param {Object} row - A mosaic row.
 * @returns {string|null} The frozen annotator label.
 */
export const annotatorSpeciesName = (row) => (row && row.comname) || null;

/**
 * Do the two names disagree — has this observation been relabelled at some point?
 *
 * Nothing draws this today, by A12's decision. It is the one-line answer if that decision
 * is ever revisited, and having it named is what stops the next person deriving it
 * differently.
 *
 * @param {Object} row - A mosaic row.
 * @returns {boolean} True when the current name differs from the annotator's.
 */
export const hasDrifted = (row) =>
  Boolean(row && row.species_comname && row.comname && row.species_comname !== row.comname);

/**
 * What a habitat stretch's caption adds to its substrate: how long it ran, and what else its
 * line recorded meanwhile (#287).
 *
 * Isaac, 2026-11-12: a reviewer judging "is this Rock?" should see at a glance that it lasted
 * two and a half minutes and that Cobble lay on top for some of it. Null for anything that is
 * not a habitat stretch.
 *
 * @param {Object} row - A mosaic row.
 * @returns {?{length: ?string, overlaps: Array<string>}}
 */
export function habitatDetail(row) {
  if (!row || row.session_type !== 'Habitat') return null;
  const start = timeOfDayMs(row.tc);
  const end = timeOfDayMs(row.etc);
  let length = null;
  if (start !== null && end !== null) {
    // A stretch across midnight ends on a smaller clock than it started.
    const seconds = Math.round(((end - start + 86400000) % 86400000) / 1000);
    const minutes = Math.floor(seconds / 60);
    // Short, because a tile's caption is a few words wide.
    length = minutes ? `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ''}` : `${seconds}s`;
  }
  return { length, overlaps: Array.isArray(row.habitat_overlaps) ? row.habitat_overlaps : [] };
}
