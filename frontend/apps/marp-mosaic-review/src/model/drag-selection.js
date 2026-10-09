/**
 * Rectangle selection and bulk mark semantics for the mosaic.
 *
 * This module is deliberately free of the DOM. Wiring supplies client rectangles; the
 * model decides which ones intersect and how one drag changes the pending marks.
 */
import { MARK_EXCEPT, markKind } from './modes.js';

/** A rectangle whose edges are ordered, regardless of the direction of the drag. */
export function normalizeRect(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Touching an edge counts: the band need only reach some part of a tile. */
export const intersects = (a, b) =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

/** Return tile ids in DOM order, so event evidence remains predictable. */
export function idsInRect(rect, tiles) {
  return tiles.filter((tile) => intersects(rect, tile.rect)).map((tile) => tile.id);
}

/**
 * Set, rather than toggle, every requested mark.
 *
 * A same-kind exception keeps its reason and note. Changing kind starts with empty detail,
 * because exception reasons do not describe acceptances. This function never creates a
 * take-back: that is an individual-click gesture owned by the store.
 */
export function setMarks(marks, ids, kind = MARK_EXCEPT) {
  const next = new Map(marks);
  for (const id of ids) {
    const current = next.get(id);
    if (current && markKind(current) === kind) continue;
    next.set(id, { kind, reason: null, note: null });
  }
  return next;
}
