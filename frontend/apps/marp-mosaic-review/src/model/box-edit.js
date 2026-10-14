/**
 * Pure rules for editing boxes on the video page (#181): the annotation GUI's controls,
 * `AnnotationRectangle.xaml.cs`, in a browser.
 *
 * Isaac, 2026-10-05: "the same exact controls" -- a click selects a box, dragging its body
 * moves it, a corner grip on the selected box resizes it, a double click pins an
 * in-between box as a keyframe or takes a keyframe away, and a right click opens the
 * GUI's menu. Releasing a drag is what saves it; a click that moved nothing saves nothing.
 *
 * Boxes are the record's: centre and size as fractions of the picture. Everything on
 * screen is in the overlay's CSS pixels. Nothing here touches the DOM or the network.
 */

import { windowsAround } from './video-review.js';

/* The GUI's grips are 16 pixels across; a finger needs more, so the target is wider than
   what is drawn. */
export const GRIP_RADIUS = 8;
const GRIP_REACH = 18;

/* The smallest box a drag can leave, as the GUI's MinimumSize: 10 pixels. */
export const MINIMUM_SIZE = 10;

/* A press that moves less than this is a click, not a drag (touch is never perfectly still). */
export const DRAG_SLOP = 4;

/* Two presses on one box within this long are a double click, or a double tap. */
export const DOUBLE_PRESS_MS = 350;

/* A touch held this long opens the menu: a phone's right click (A10). */
export const LONG_PRESS_MS = 500;

/** An observation's track key, as the GUI's: observation and subset. */
export function trackKey(box) {
  return `${box.observation_id}_${box.subset == null ? '' : box.subset}`;
}

/** A record box on screen, in the picture area's pixels. */
export function toScreen(box, area) {
  return {
    left: area.left + (box.x - box.width / 2) * area.width,
    top: area.top + (box.y - box.height / 2) * area.height,
    width: box.width * area.width,
    height: box.height * area.height
  };
}

/** A screen rectangle back as a record box. */
export function toRecord(rect, area) {
  return {
    x: (rect.left + rect.width / 2 - area.left) / area.width,
    y: (rect.top + rect.height / 2 - area.top) / area.height,
    width: rect.width / area.width,
    height: rect.height / area.height
  };
}

const CORNERS = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };

/** The four grips of a screen rectangle, by corner. */
export function gripsOf(rect) {
  return Object.entries(CORNERS).map(([corner, [fx, fy]]) => ({
    corner, x: rect.left + fx * rect.width, y: rect.top + fy * rect.height
  }));
}

/**
 * What a press at `point` lands on: a grip of the selected box first -- they are drawn
 * over everything -- then the topmost box whose body holds the point. `rects` is in draw
 * order, so the last is on top. Null when the press is on the picture and no box.
 *
 * @param {Array<{key: string, rect: Object}>} rects
 * @param {{x: number, y: number}} point
 * @param {string|null} selectedKey
 * @returns {{key: string, part: 'body'|'tl'|'tr'|'bl'|'br'}|null}
 */
export function hitTest(rects, point, selectedKey) {
  const selected = rects.find((entry) => entry.key === selectedKey);
  if (selected) {
    // The nearest grip in reach, not the first: on a small box -- any box on a phone --
    // every corner is in reach of a press on one, and taking the first moved the wrong one.
    let nearest = null;
    for (const grip of gripsOf(selected.rect)) {
      const distance = Math.hypot(point.x - grip.x, point.y - grip.y);
      if (distance <= GRIP_REACH && (!nearest || distance < nearest.distance)) nearest = { corner: grip.corner, distance };
    }
    if (nearest) return { key: selected.key, part: nearest.corner };
  }
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const { key, rect } = rects[index];
    if (point.x >= rect.left && point.x <= rect.left + rect.width
      && point.y >= rect.top && point.y <= rect.top + rect.height) {
      return { key, part: 'body' };
    }
  }
  return null;
}

/**
 * A rectangle after a drag of (dx, dy) on one part of it, inside the picture.
 *
 * The body moves whole and stops at the picture's edges. A corner moves and the opposite
 * one stays where it is, as the GUI's grips do; a corner dragged past its opposite stops
 * at the smallest box worth having rather than turning the box inside out.
 */
export function dragged(start, part, dx, dy, area) {
  const right = area.left + area.width;
  const bottom = area.top + area.height;
  if (part === 'body') {
    const left = Math.min(Math.max(start.left + dx, area.left), right - start.width);
    const top = Math.min(Math.max(start.top + dy, area.top), bottom - start.height);
    return { left, top, width: start.width, height: start.height };
  }
  let l = start.left;
  let t = start.top;
  let r = start.left + start.width;
  let b = start.top + start.height;
  const movesLeft = part === 'tl' || part === 'bl';
  const movesTop = part === 'tl' || part === 'tr';
  if (movesLeft) l = Math.max(area.left, Math.min(l + dx, r - MINIMUM_SIZE));
  else r = Math.min(right, Math.max(r + dx, l + MINIMUM_SIZE));
  if (movesTop) t = Math.max(area.top, Math.min(t + dy, b - MINIMUM_SIZE));
  else b = Math.min(bottom, Math.max(b + dy, t + MINIMUM_SIZE));
  return { left: l, top: t, width: r - l, height: b - t };
}

/**
 * The keyframe a track has on the picture being shown, or null when the box there is an
 * in-between one.
 *
 * A keyframe's time is its frame number over its row's rate, which need not land on one of
 * this video's frames -- a GUI row counts at 25 on a 29.97 video -- so "on the picture" is
 * within half of one of the video's frames.
 */
export function keyframeShown(keyframes, t, frameRate) {
  const half = 0.5 / (frameRate || 25);
  let best = null;
  for (const keyframe of keyframes || []) {
    const off = Math.abs(keyframe.t - t);
    if (off <= half && (!best || off < Math.abs(best.t - t))) best = keyframe;
  }
  return best;
}

/**
 * The GUI's right-click menu for one box, in the GUI's order. A keyframe is not offered
 * "Set As Keyframe", and neither an end nor a start is offered "Set As End Keyframe";
 * "Delete Keyframe" is only for a keyframe.
 *
 * @param {{keyframe: Object|null}} box - The box's keyframe on this picture, if it has one.
 * @returns {Array<{action: string, label: string, disabled?: boolean}>}
 */
export function menuFor({ observation_id, subset, keyframe, t }) {
  const type = keyframe ? keyframe.type : 'interpolated';
  const items = [{
    action: 'info',
    label: `${keyframe ? `keyframe ${keyframe.keyframe_id}` : 'between keyframes'} · ${type}`
      + ` · ${Number(t).toFixed(3)} s · observation ${observation_id}:${subset == null ? '' : subset}`,
    disabled: true
  }];
  if (!keyframe) items.push({ action: 'pin', label: 'Set As Keyframe' });
  // Not on the start either: that would leave the observation without one (Isaac,
  // 2026-10-05). The GUI offers it there; this page does not.
  if (type !== 'end' && type !== 'start') items.push({ action: 'end', label: 'Set As End Keyframe' });
  items.push({ action: 'back', label: 'Send To Back' });
  items.push({ action: 'deleteObservation', label: 'Delete Entire Observation' });
  if (keyframe) items.push({ action: 'deleteKeyframe', label: 'Delete Keyframe' });
  return items;
}

/**
 * The held keyframe windows after an edit's answer: deleted keyframes gone, changed ones
 * replaced where they are held, and a new one added to every held window it falls in.
 *
 * @param {Map<number, Object[]>} held - Keyframes by window index.
 * @param {{changed: Object[], deleted: number[]}} answer - The edit route's answer.
 * @returns {Map<number, Object[]>} A new map; `held` is not changed.
 */
export function withEdit(held, { changed = [], deleted = [] }) {
  const gone = new Set(deleted);
  const byId = new Map(changed.map((keyframe) => [keyframe.keyframe_id, keyframe]));
  const out = new Map();
  for (const [index, keyframes] of held) {
    const placed = new Set();
    const next = [];
    for (const keyframe of keyframes) {
      if (gone.has(keyframe.keyframe_id)) continue;
      const update = byId.get(keyframe.keyframe_id);
      if (update) placed.add(update.keyframe_id);
      next.push(update || keyframe);
    }
    out.set(index, next);
  }
  // A keyframe no window holds yet -- one just added -- goes into each held window
  // around its time, where the reads would have put it.
  for (const keyframe of changed) {
    if ([...out.values()].some((list) => list.some((k) => k.keyframe_id === keyframe.keyframe_id))) continue;
    for (const index of windowsAround(keyframe.t)) {
      if (out.has(index)) out.get(index).push(keyframe);
    }
  }
  return out;
}
