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

/** Marks are keyed by observation, so they survive paging and re-queries. */
export function toggleMark(marks, id) {
  const next = new Map(marks);
  if (next.has(id)) next.delete(id); else next.set(id, { reason: null });
  return next;
}

/** Choosing the same reason twice clears it: a bare mark is always valid. */
export function setReason(marks, id, reason) {
  if (!marks.has(id)) return marks;
  const next = new Map(marks);
  const cur = next.get(id);
  next.set(id, { ...cur, reason: cur.reason === reason ? null : reason });
  return next;
}

/** The scope is the page. Never the whole query. */
export function markAll(marks, rows) {
  const next = new Map(marks);
  rows.forEach((r) => { if (!next.has(r.observation_id)) next.set(r.observation_id, { reason: null }); });
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

export const pinnedIds = (members) => {
  const all = new Set();
  members.forEach((ids) => ids.forEach((id) => all.add(id)));
  return all;
};

/** Changing what is being asked for retires the pins: they belonged to the old query. */
export const clearPins = () => new Map();

/**
 * Fold a commit response into the outcome map. Reverted entries carry the outcome
 * they were changed to, not a separate label, so the tile shows the current truth.
 */
export function applyCommit(outcomes, result) {
  const next = new Map(outcomes);
  (result.reviewed || []).forEach((r) => next.set(r.id, r.outcome));
  (result.flagged || []).forEach((r) => next.set(r.id, r.outcome));
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
