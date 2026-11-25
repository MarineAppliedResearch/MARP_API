/**
 * Reviewing a built dataset (#271): what a tile's pictures are, and what a commit says
 * about each of them.
 *
 * Settled with Isaac on 2026-11-24. A tile is one track of the dataset; its pictures are the
 * frames the dataset took from it. **The unit of a decision is the picture**: one is flagged
 * with a reason saying what is wrong, and only it is left out of new datasets. Committing a
 * page promotes every picture nobody flagged. There is no third state: a flag stays until a
 * reviewer promotes the picture again.
 *
 * A tile's mark carries `pictures`, a map of the frames flagged on it to their reason, once
 * the reviewer has opened it. A mark without one -- seeded from the record -- means the
 * frames the record already flags.
 *
 * No DOM, no network.
 */

import { MARK_ACCEPT, MARK_EXCEPT, markKind } from './modes.js';

/** A track with a flagged picture, and one whose every picture is decided and none flagged. */
export const PICTURE_FLAGGED = 'picture-flagged';
export const PICTURE_CHECKED = 'picture-checked';

/** The frames the record flags on a row, with their reasons. */
export function recordedFlags(row) {
  return new Map((row && row.pictures || [])
    .filter((p) => p.decision === 'flagged')
    .map((p) => [p.framenum, p.reason || null]));
}

/**
 * The frames flagged on a row as things stand: the reviewer's own choice where they made one,
 * otherwise what the record says. An accept mark flags nothing: "every picture is right".
 *
 * @param {Object} row - A row with `pictures`.
 * @param {?Object} mark - Its mark, if any.
 * @returns {Map<number, ?string>} Frame to reason.
 */
export function flaggedFrames(row, mark) {
  if (mark && mark.pictures) return new Map(mark.pictures);
  if (mark && markKind(mark) === MARK_ACCEPT) return new Map();
  if (mark) return recordedFlags(row);
  return new Map();
}

/**
 * The mark a tile has after one of its pictures is flagged or unflagged.
 *
 * Flagging every picture off leaves an accept mark where the record had flags -- the reviewer
 * is promoting them again -- and no mark where it had none.
 *
 * @param {Object} row - The tile's row.
 * @param {?Object} mark - Its mark now.
 * @param {number} frame - The picture.
 * @param {?string} reason - The reason to flag it with; null unflags it.
 * @returns {?Object} The new mark, or null for none.
 */
export function withPicture(row, mark, frame, reason) {
  const pictures = flaggedFrames(row, mark);
  if (reason == null) pictures.delete(frame);
  else pictures.set(frame, reason);

  if (!pictures.size) return recordedFlags(row).size ? { kind: MARK_ACCEPT, pictures } : null;

  return { kind: MARK_EXCEPT, reason: [...pictures.values()][0], pictures };
}

/**
 * What a commit records about one row's pictures: only what differs from the record, so a
 * picture already promoted is not promoted again.
 *
 * @param {Object} row - The row as it was sent: `observation_id` and `pictures`.
 * @param {?Object} mark - Its mark. Unmarked, every picture is promoted.
 * @returns {Array<Object>} `{observation_id, framenum, decision, reason}`.
 */
export function pictureDecisions(row, mark) {
  const flagged = flaggedFrames(row, mark);
  const out = [];

  for (const picture of row.pictures || []) {
    const reason = flagged.get(picture.framenum);
    const decision = flagged.has(picture.framenum) ? 'flagged' : 'promoted';

    if (picture.decision === decision && (decision === 'promoted' || picture.reason === reason)) continue;
    out.push({ observation_id: row.observation_id, framenum: picture.framenum, decision, reason: decision === 'flagged' ? reason : null });
  }

  return out;
}

/** Taking a row back: every decided picture of it is undecided again. */
export function withdrawals(row) {
  return (row.pictures || [])
    .filter((p) => p.decision)
    .map((p) => ({ observation_id: row.observation_id, framenum: p.framenum, decision: 'withdrawn', reason: null }));
}

/**
 * A dataset commit, answered in the shape the page commit answers, so everything after it --
 * the outcomes on the tiles, the marks that stay -- is the code every other mode runs.
 *
 * @param {Array<Object>} rows - The rows sent.
 * @param {Map} marks - Their marks.
 * @param {Array<number>} withdraw - The ids taken back.
 * @returns {{decisions: Array<Object>, result: Object}}
 */
export function pictureCommit(rows, marks, withdraw = []) {
  const back = new Set(withdraw);
  const decisions = [];
  const result = { reviewed: [], flagged: [], reverted: [], skipped: [], conflicted: [] };

  for (const row of rows) {
    const id = row.observation_id;

    if (back.has(id)) {
      decisions.push(...withdrawals(row));
      result.reverted.push({ observation_id: id, outcome: 'withdrawn' });
      continue;
    }

    const mark = marks.get(id) || null;
    decisions.push(...pictureDecisions(row, mark));

    if (flaggedFrames(row, mark).size) result.flagged.push({ observation_id: id, outcome: PICTURE_FLAGGED });
    else result.reviewed.push({ observation_id: id, outcome: PICTURE_CHECKED });
  }

  return { decisions, result };
}
