/**
 * Pure rules for the video page's habitat timeline (#287, R3-R5): the annotation GUI's strip
 * of a habitat session's stretches, in its lanes and colours, showing what has been reviewed,
 * with ends that can be dragged.
 *
 * Its lanes and colours are the GUI's (`HabitatTimelineWindow.xaml.cs`, its #205), so a
 * strip here and a strip there read the same: Cobble; Boulder; Sand and Mud; Rock; Stop, Pull
 * and Off Transect. Anything not named goes in one more lane on top, drawn only when
 * something is in it. Taller lanes than the GUI's 5 px, so an end can be grabbed (A6).
 */

/** Top to bottom, as Isaac laid them out for the GUI on 2026-10-08. */
export const LANES = Object.freeze([
  ['Cobble'],
  ['Boulder'],
  ['Sand', 'Mud'],
  ['Rock'],
  ['Stop', 'Pull', 'Off Transect']
]);

/** Each substrate's colour, the GUI's. */
export const COLOURS = Object.freeze({
  cobble: '#f28fb8',
  boulder: '#9e9e9e',
  sand: '#f2d45c',
  mud: '#c9a227',
  rock: '#8b5a2b',
  pull: '#e04f45',
  stop: '#a81c1c',
  'off transect': '#ff8570'
});

/** Anything the GUI names no colour for. */
const OTHER_COLOUR = '#6fb1ff';

const key = (name) => String(name || '').trim().toLowerCase();

/**
 * The fixed lane a substrate belongs in, or -1 for the lane that holds anything else.
 *
 * @param {string} name
 * @returns {number}
 */
export function laneOf(name) {
  return LANES.findIndex((lane) => lane.some((item) => key(item) === key(name)));
}

/** @param {string} name @returns {string} */
export function colourOf(name) {
  return COLOURS[key(name)] || OTHER_COLOUR;
}

/**
 * What the scientific review says about a stretch, as the strip shows it (R4).
 *
 * @param {Object} stretch - `review_decision`, as the video read gives it.
 * @returns {'reviewed'|'flagged'|'unreviewed'}
 */
export function reviewOf(stretch) {
  return stretch.review_decision === 'reviewed' ? 'reviewed'
    : stretch.review_decision === 'flagged' ? 'flagged' : 'unreviewed';
}

/**
 * The strip's rows and bars (R3).
 *
 * @param {Array<Object>} stretches - The session's stretches, as the video read gives them.
 * @returns {{rows: Array<number>, bars: Array<Object>}} The lanes on show top to bottom, as
 *   `laneOf` keys, and a bar per stretch: its row, span, colour, review and whether it can be
 *   dragged -- not one with no end yet.
 */
export function stripLayout(stretches) {
  const list = (stretches || []).filter((s) => Number.isFinite(s.start_s));
  const other = list.some((s) => laneOf(s.comname) < 0);
  const rows = [...(other ? [-1] : []), ...LANES.map((_, index) => index)];
  const bars = list
    .map((s) => ({
      id: s.observation_id,
      speciesId: s.species_id,
      name: s.comname || 'Unnamed',
      obsId: s.obs_id ?? null,
      row: rows.indexOf(laneOf(s.comname)),
      start: s.start_s,
      end: s.open_ended || !Number.isFinite(s.end_s) ? s.start_s : s.end_s,
      colour: colourOf(s.comname),
      review: reviewOf(s),
      reason: s.flag_reason || null,
      version: s.version,
      draggable: !s.open_ended && Number.isFinite(s.end_s)
    }))
    // Earliest first, so bars sharing a lane are drawn in order, as the GUI does.
    .sort((a, b) => a.start - b.start || a.id - b.id);
  return { rows, bars };
}

/**
 * Where a drag of one end puts a stretch: that end at `t`, kept inside the video and at
 * least `minLength` from the other end.
 *
 * @param {{start: number, end: number}} bar
 * @param {'start'|'end'} edge
 * @param {number} t - Seconds the pointer is at.
 * @param {number} duration - The video's length in seconds.
 * @param {number} [minLength] - The shortest a stretch may become, in seconds.
 * @returns {{start: number, end: number}}
 */
export function dragTo(bar, edge, t, duration, minLength = 1) {
  const within = (value) => Math.min(Math.max(value, 0), duration);
  if (edge === 'start') return { start: Math.min(within(t), bar.end - minLength), end: bar.end };
  return { start: bar.start, end: Math.max(within(t), bar.start + minLength) };
}

/**
 * The stretches a new span would merge (A4), the same rule the server applies: same
 * substrate, reached by the new span and not already overlapped by the old one, and any the
 * grown span then reaches in turn. Shown while dragging, so a merge is never a surprise.
 *
 * @param {Array<Object>} bars - From `stripLayout`.
 * @param {Object} bar - The one being dragged, as it was.
 * @param {{start: number, end: number}} span - Where the drag has it now.
 * @returns {Array<number>} Ids, ascending.
 */
export function mergesInto(bars, bar, span) {
  const overlaps = (a, b) => a.start < b.end && a.end > b.start;
  const candidates = bars.filter((b) => b.id !== bar.id && b.speciesId === bar.speciesId && !overlaps(b, bar));
  const grown = { ...span };
  const absorbed = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of candidates) {
      if (absorbed.includes(b.id) || !overlaps(b, grown)) continue;
      absorbed.push(b.id);
      grown.start = Math.min(grown.start, b.start);
      grown.end = Math.max(grown.end, b.end);
      grew = true;
    }
  }
  return absorbed.sort((a, b) => a - b);
}

/**
 * Which end of a bar a press is on, or null for its middle: the nearer end, when the press
 * is within `grab` pixels of it. A bar narrower than two grabs is all ends.
 *
 * @param {{left: number, right: number}} rect - The bar on screen.
 * @param {number} x - The press.
 * @param {number} grab - Pixels either side of an end that pick it up.
 * @returns {'start'|'end'|null}
 */
export function edgeAt(rect, x, grab) {
  const fromStart = Math.abs(x - rect.left);
  const fromEnd = Math.abs(rect.right - x);
  if (Math.min(fromStart, fromEnd) > grab) return null;
  return fromStart <= fromEnd ? 'start' : 'end';
}

/* ------------------------------------------------------------------ zoom (R6, R7) */

/** The shortest stretch of video the strip zooms in to, in seconds. */
export const MIN_VIEW_SECONDS = 10;

/** The whole video: what the strip shows until it is zoomed. */
export function wholeView(duration) {
  return { from: 0, to: duration };
}

/** Kept inside the video, its length unchanged where it fits. */
function inside(view, duration) {
  const span = Math.min(view.to - view.from, duration);
  const from = Math.min(Math.max(view.from, 0), duration - span);
  return { from, to: from + span };
}

/**
 * Zoom around a moment (R6): the moment under the pointer stays under the pointer, as a map
 * zooms. Never closer than `min` seconds, never further out than the whole video.
 *
 * @param {{from: number, to: number}} view - What the strip shows now, in seconds.
 * @param {number} duration - The video's length.
 * @param {number} anchor - The moment to zoom around.
 * @param {number} factor - Below 1 zooms in, above 1 out.
 * @param {number} [min]
 * @returns {{from: number, to: number}}
 */
export function zoomView(view, duration, anchor, factor, min = MIN_VIEW_SECONDS) {
  const span = Math.min(duration, Math.max(Math.min(min, duration), (view.to - view.from) * factor));
  const along = (anchor - view.from) / (view.to - view.from);
  const from = anchor - along * span;
  return inside({ from, to: from + span }, duration);
}

/** Moved along by `seconds` (R6), stopping at either end of the video. */
export function panView(view, duration, seconds) {
  return inside({ from: view.from + seconds, to: view.to + seconds }, duration);
}

/**
 * Kept on the playhead while the video plays (R7). Unchanged while `t` is on screen; once it
 * runs off an end, the strip moves so it is a tenth of the way in from the side it was going,
 * as a video editor pages along.
 */
export function followView(view, duration, t) {
  if (t >= view.from && t <= view.to) return view;
  const span = view.to - view.from;
  const from = t > view.to ? t - span * 0.1 : t - span * 0.9;
  return inside({ from, to: from + span }, duration);
}

/** Whether a view is the whole video, to the frame. */
export function isWhole(view, duration) {
  return view.from <= 0.04 && view.to >= duration - 0.04;
}

/**
 * A bar's right-click menu, as the GUI's strip has it (#353): the stretch named first -- the
 * strip carries no labels, so this is where it says what it is -- then its two ends.
 *
 * @param {Object} bar - From `stripLayout`.
 * @returns {Array<{label: string, t?: number}>} An entry with no `t` is a heading.
 */
export function stretchMenu(bar) {
  const name = `${bar.obsId != null ? `${bar.obsId} · ` : ''}${bar.name}`;
  const items = [{ label: name }, { label: 'Go to start', t: bar.start }];
  // One with no end yet has nowhere to go but its start.
  if (bar.draggable) items.push({ label: 'Go to end', t: bar.end });
  return items;
}
