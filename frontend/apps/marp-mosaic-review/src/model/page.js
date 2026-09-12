/**
 * Pages, and what a reviewer has done to them.
 *
 * No DOM, no network. Three related ideas live here:
 *
 *   marks       what the reviewer has marked but not yet committed
 *   members     which observations a committed page holds, so returning to it
 *               shows what was submitted rather than what the filter now matches
 *   outcomes    what the last commit did to each observation
 */

import { MARK_EXCEPT, MARK_ACCEPT, markKind } from './modes.js';

/**
 * Marks are keyed by observation, so they survive paging and re-queries.
 *
 * **The same gesture twice takes the mark off; the other gesture replaces it** (#126 R7).
 * A left click carries `except` and a right click `accept`, so clicking accept on a tile
 * that is already excepted leaves it accepted rather than unmarked -- the later mark wins,
 * and neither gesture has to be preceded by undoing the other.
 *
 * The reason does not travel between kinds. `flag_reason` is an exception vocabulary; an
 * acceptance has nothing to explain, and carrying a stale one across would put "Wrong
 * species" on a record that says the species was right.
 */
export function toggleMark(marks, id, kind = MARK_EXCEPT) {
  const next = new Map(marks);
  if (next.has(id) && markKind(next.get(id)) === kind) next.delete(id);
  else next.set(id, { kind, reason: null });
  return next;
}

/**
 * Choosing the same reason twice clears it: a bare mark is always valid.
 *
 * **Only an exception carries one.** The reason lists are the flag and exclusion
 * vocabularies, and the commit routes refuse a reason on anything else -- so an accept
 * mark is left exactly as it was rather than given a field the record cannot store.
 */
export function setReason(marks, id, reason) {
  if (!marks.has(id) || markKind(marks.get(id)) !== MARK_EXCEPT) return marks;
  const next = new Map(marks);
  const cur = next.get(id);
  next.set(id, { ...cur, reason: cur.reason === reason ? null : reason });
  return next;
}

/**
 * The scope is the page. Never the whole query.
 *
 * "Flag all on page" means every tile ends up **excepted**, so it overwrites an accept mark
 * rather than stepping around it -- it is the later gesture, and R7's rule is that the later
 * mark wins. An exception mark is left alone so its reason survives.
 */
export function markAll(marks, rows) {
  const next = new Map(marks);
  rows.forEach((r) => {
    const cur = next.get(r.observation_id);
    if (cur && markKind(cur) === MARK_EXCEPT) return;
    next.set(r.observation_id, { kind: MARK_EXCEPT, reason: null });
  });
  return next;
}

/**
 * A committed page keeps the exact observations it held, so the reviewer can see
 * what they submitted and change it. Pages still to be done must not repeat them.
 */
export function pinPage(members, page, ids) {
  const next = new Map(members);
  next.set(page, ids.slice());
  return next;
}

/**
 * Remember the rows a page was committed with, keyed by id.
 *
 * Merged rather than replaced: a reviewer commits several pages in a session and each
 * one's rows have to survive the next.
 *
 * @param {Map} held - `state.pinnedRows`.
 * @param {Array<Object>} rows - The page as it was committed.
 * @returns {Map} A new map, so subscribers see the change.
 */
export function pinRows(held, rows) {
  const next = new Map(held);
  for (const row of rows) next.set(row.observation_id, row);
  return next;
}

/**
 * The rows a pinned page named, in the order it named them, or null if any is missing.
 *
 * Null rather than a short page, for the same reason `cache.rowsFor` does it: a hole and a
 * suppression look identical on screen and mean opposite things.
 *
 * @param {Map} held - `state.pinnedRows`.
 * @param {Array<number>} ids - The page's membership.
 * @returns {Array<Object>|null} The rows, or null.
 */
export function rowsFrom(held, ids) {
  const out = [];
  for (const id of (ids || [])) {
    const row = held.get(id);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

export const pinnedIds = (members) => {
  const all = new Set();
  members.forEach((ids) => ids.forEach((id) => all.add(id)));
  return all;
};

/** Changing what is being asked for retires the pins: they belonged to the old query. */
export const clearPins = () => new Map();

/**
 * Fold a commit response into the outcome map. A reverted entry carries what the
 * observation is now — the value it was changed to, or `withdrawn` where the decision was
 * taken off the record entirely — so the tile shows the current truth.
 *
 * **Keyed by `observation_id`, never by `id` and never by position** (F5, R8). This read
 * `r.id`, which no entry of `MosaicCommitResult` has ever carried — every one of the five
 * arrays is keyed `observation_id`. Against the endpoint that wrote one entry under the
 * key `undefined` and left **every tile on a committed page with no outcome at all**: no
 * error, no log, and a page that looks as though the commit never happened. It only
 * worked against the fixture because the fixture also said `id`.
 *
 * `conflicted` is folded in as its own outcome (R9). It means the annotation moved under
 * the reviewer and **nothing was written**, which is a different thing from a commit that
 * did nothing, and the tile has to be able to say so. The entry carries `reason` rather
 * than `outcome`, so the outcome is named here.
 */
export function applyCommit(outcomes, result) {
  const next = new Map(outcomes);
  (result.reviewed || []).forEach((r) => next.set(r.observation_id, r.outcome));
  (result.flagged || []).forEach((r) => next.set(r.observation_id, r.outcome));
  /* `reverted` is folded too (#135 R4). It used to be skipped on the grounds that its
     entries duplicate `flagged` -- true of the one that co-occurs, which carries the value
     the row was changed *to*, so setting it again changes nothing. A **withdrawal** is the
     other kind and appears in no other array: it carries `withdrawn`, which no badge
     draws, so the tile stops claiming a decision instead of going on showing the one that
     has just been taken off the record. It must land after `flagged` for the same reason
     `flagged` lands after `reviewed`. */
  (result.reverted || []).forEach((r) => next.set(r.observation_id, r.outcome));
  (result.conflicted || []).forEach((r) => next.set(r.observation_id, 'conflicted'));
  return next;
}

/**
 * Did a commit destroy this observation? (#138)
 *
 * A delete leaves nothing behind -- no provenance row, and the keyframes and the whole
 * review history go with it -- so a tile whose row has been destroyed is a picture of
 * something that no longer has a record, and no gesture may reach it. Every refusal asks
 * this one question rather than each caller spelling the outcome out.
 *
 * The outcome map is the source, and deliberately: it has exactly the lifetime of the
 * DELETED badge the tile already draws from it, so *inert* and *DELETED* are one fact
 * rather than two that can disagree. A different question clears the outcomes, empties
 * the cache (the key carries the mode and the filters) and re-queries -- and the row is
 * gone from the server, so it does not come back without its outcome.
 *
 * @param {Map} outcomes - `state.outcomes`.
 * @param {number} id - An observation id.
 * @returns {boolean} True when the last commit deleted it.
 */
export const isDestroyed = (outcomes, id) => outcomes.get(id) === 'deleted';

/**
 * The ids a commit refused for a moved version, so the page can offer a re-read (R9).
 *
 * Their marks are deliberately kept: nothing was written, so the reviewer's intention is
 * still pending rather than applied.
 */
export const conflictedIds = (result) =>
  (result && result.conflicted || []).map((r) => r.observation_id);

/**
 * Seed the marks from what the records already say.
 *
 * A mark is not decoration: at commit, whatever is marked becomes the exception and
 * whatever is not becomes accepted. So a page that arrives already holding flagged
 * observations has to arrive with them marked, or committing it would quietly clear
 * flags nobody asked to clear.
 *
 * `touched` holds what the reviewer has decided about by hand this session. Those are
 * never re-seeded — taking a flag off and paging away must not put it back.
 */
export function seedMarks(marks, touched, rows, isException) {
  const next = new Map(marks);
  rows.forEach((row) => {
    const id = row.observation_id;
    if (touched.has(id) || next.has(id) || !isException(row)) return;
    /* Seeded marks are **exceptions** and nothing else: they come from the record's own
       flagged and excluded rows. Nothing seeds an accept mark, which is what keeps the
       main button's `touched` filter meaningful -- see `selectedRows` (#126 A3). */
    next.set(id, { kind: MARK_EXCEPT, reason: row.flag_reason || row.exclusion_reason || null });
  });
  return next;
}

/**
 * What is still marked once a page has been committed.
 *
 * A commit is not the end of the page. In the review modes a mark means "this is
 * the exception", and after committing, the exceptions are exactly the tiles the
 * commit flagged or excluded — so they stay marked, and clicking one takes the
 * decision back. Clearing every mark instead left the page looking finished and
 * behaving as though a click meant the opposite of what it did.
 *
 * Reasons are carried across, because the reason belonged to the decision.
 *
 * **A `conflicted` tile keeps whatever mark it had** (R9). Nothing was written for it, so
 * the reviewer's intention is still pending rather than recorded — dropping the mark would
 * silently discard the decision the commit refused to take, which is the one thing a
 * conflict must not do. An unmarked conflicted tile stays unmarked, because "accept this"
 * is not an exception.
 */
export function marksAfterCommit(marks, outcomes, ids, exception, accepted = null) {
  const next = new Map();
  if (!exception) return next;                 // Delete Mode keeps nothing marked
  ids.forEach((id) => {
    if (!survives(marks, outcomes, id, exception, accepted)) return;
    next.set(id, { ...marks.get(id) });
  });
  return next;
}

/**
 * Whether one id's mark outlived the commit that has just landed.
 *
 * One rule, two callers, because the sweep and the selective commit must not come to
 * different conclusions about the same tile. A mark survives when the record now agrees
 * with it — an exception mark where the commit flagged, an accept mark where it accepted —
 * and a conflicted id keeps whatever it had, because nothing was written for it (R9).
 */
function survives(marks, outcomes, id, exception, accepted) {
  const mark = marks.get(id);
  if (!mark) return false;
  const outcome = outcomes.get(id);
  if (outcome === 'conflicted') return true;
  return outcome === (markKind(mark) === MARK_ACCEPT ? accepted : exception);
}

/**
 * What is still marked once a **selective** commit has landed (#126 R3).
 *
 * The difference from `marksAfterCommit` is the scope, and it is the whole reason this is
 * a second function rather than an argument. The sweep is about the page, so it rebuilds
 * the page's marks from scratch. The main button is about a *selection*, and everything it
 * did not send is untouched by definition — including the marks the page arrived with,
 * which were never committed and must still be there afterwards. Rebuilding from `ids`
 * would silently drop every one of them.
 *
 * @param {Map} marks - The marks as they were when the commit was sent.
 * @param {Map} outcomes - `state.outcomes`, after the result was folded in.
 * @param {Array<number>} ids - The ids the commit was actually sent for.
 * @param {string|null} exception - What a marked tile becomes in this mode.
 * @param {string|null} accepted - What an accepted tile becomes in this mode.
 * @returns {Map} A new Map, so subscribers see the change.
 */
export function marksAfterSelection(marks, outcomes, ids, exception, accepted = null) {
  const next = new Map(marks);
  ids.forEach((id) => {
    if (survives(marks, outcomes, id, exception, accepted)) return;
    next.delete(id);
  });
  return next;
}

/** Page numbers to show: a window around the current page, with the ends pinned. */
export function pageWindow(current, total, span = 2) {
  const out = [];
  const lo = Math.max(1, current - span);
  const hi = Math.min(total, current + span);
  if (lo > 1) { out.push(1); if (lo > 2) out.push('gap'); }
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < total) { if (hi < total - 1) out.push('gap'); out.push(total); }
  return out;
}

export const clampPage = (n, total) => Math.min(Math.max(1, Math.floor(n) || 1), Math.max(1, total));
