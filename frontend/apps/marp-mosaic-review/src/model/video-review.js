/**
 * Pure rules for the video page (#181): which keyframe windows to hold around the
 * playhead, which observations a window needs, and the colour a species is drawn in.
 *
 * The page loads every observation the Mosaic's query matches in the video once, each with
 * the span its keyframes cover, and asks for keyframes a window of seconds at a time
 * (A9, 2026-10-05): the busiest video holds 47,736 keyframes, too many to load at once on
 * a phone. A 20-second window of it is about 700 keyframes and 100 KB.
 */

/** Seconds per keyframe window. */
export const WINDOW_SECONDS = 20;

/**
 * The windows to hold for a playhead at `t`: its own and the next, so playing forward finds
 * the next one already loaded, and the previous, so a step back does too.
 *
 * @param {number} t - Seconds.
 * @param {number} [size] - Window length in seconds.
 * @returns {Array<number>} Window indices, the playhead's own first.
 */
export function windowsAround(t, size = WINDOW_SECONDS) {
  const own = Math.max(0, Math.floor(t / size));
  return own > 0 ? [own, own + 1, own - 1] : [own, own + 1];
}

/**
 * A window's time range in seconds, `[from, to)`.
 *
 * @param {number} index - Window index.
 * @param {number} [size] - Window length in seconds.
 * @returns {{from: number, to: number}}
 */
export function windowRange(index, size = WINDOW_SECONDS) {
  return { from: index * size, to: (index + 1) * size };
}

/**
 * The observations whose keyframe span reaches into a window -- the ones to ask for its
 * keyframes. An observation spanning the whole window is included even though it has no
 * keyframe inside it: the API returns its keyframes either side, so its box is drawn.
 *
 * @param {Array<{observation_id: number, start_s: number, end_s: number}>} observations
 * @param {{from: number, to: number}} range - The window.
 * @returns {Array<number>} Observation ids, ascending.
 */
export function observationsIn(observations, { from, to }) {
  return (observations || [])
    .filter((observation) => observation.start_s < to && observation.end_s >= from)
    .map((observation) => observation.observation_id)
    .sort((a, b) => a - b);
}

/**
 * Keyframe windows the playhead has moved away from, to let go of: anything more than one
 * window from those it should hold. A phone holds a few hundred keyframes, not a dive's.
 *
 * @param {Iterable<number>} loaded - Windows currently held.
 * @param {Array<number>} wanted - From {@link windowsAround}.
 * @returns {Array<number>}
 */
export function windowsToDrop(loaded, wanted) {
  const keep = new Set(wanted);
  return [...loaded].filter((index) => !keep.has(index));
}

/** The golden angle, so successive names land far apart on the colour circle. */
const GOLDEN_ANGLE_DEGREES = 137.50776405003785;

/**
 * The colour a species is drawn in -- the annotation GUI's `speciesColor`, ported exactly
 * (`AnnotationRectangle.xaml.cs`), so a species looks the same in both: FNV-1a over the
 * trimmed, lower-cased name, the hue spread by the golden angle, then HSL(h, 0.72, 0.58).
 * C#'s `Math.Round` rounds a half to even, and so does this.
 *
 * @param {string|null} name - The species name.
 * @returns {string} `rgb(r, g, b)`; white for no name.
 */
export function speciesColour(name) {
  if (!name || !String(name).trim()) return 'rgb(255, 255, 255)';
  let hash = 2166136261;
  for (const ch of String(name).trim().toLowerCase()) {
    for (let i = 0; i < ch.length; i += 1) {
      hash = Math.imul((hash ^ ch.charCodeAt(i)) >>> 0, 16777619) >>> 0;
    }
  }
  let hue = (hash % 3600) / 10;
  hue = (hue * GOLDEN_ANGLE_DEGREES) % 360;
  const [r, g, b] = fromHsl(hue, 0.72, 0.58);
  return `rgb(${r}, ${g}, ${b})`;
}

/* The GUI's HSL conversion, rounding as C# does. */
function fromHsl(hue, saturation, lightness) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r, g, b].map((v) => roundHalfEven((v + m) * 255));
}

/* C#'s default Math.Round. */
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) > 1e-9) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}
