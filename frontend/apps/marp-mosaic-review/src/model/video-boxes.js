/**
 * Pure rules for the source-video inspector (#181): which boxes to draw at a moment,
 * and where a letterboxed picture sits on screen.
 *
 * Times arrive in seconds, already decided by the API from who wrote each row, so
 * nothing here knows a frame rate.
 */

/* Allowance for float noise at a track's ends, far below one frame. */
const EDGE = 1e-6;

/**
 * The box of each observation whose track spans time `t`, interpolated between the
 * keyframes either side. Linear interpolation is what the keyframe reduction was built
 * to reproduce. A track is drawn only within its own span: before its first keyframe
 * or after its last, the animal is not in the record, and a box there would be a guess.
 */
export function boxesAt(observations, t) {
  const out = [];
  for (const observation of observations || []) {
    for (const track of tracksOf(observation.keyframes)) {
      const box = boxOnTrack(track, t);
      if (box) {
        out.push({ observation_id: observation.observation_id, comname: observation.comname, ...box });
      }
    }
  }
  return out;
}

/* One observation's keyframes as tracks, one per subset, each in time order. */
function tracksOf(keyframes) {
  const bySubset = new Map();
  for (const keyframe of keyframes || []) {
    const key = keyframe.subset == null ? '' : String(keyframe.subset);
    if (!bySubset.has(key)) bySubset.set(key, []);
    bySubset.get(key).push(keyframe);
  }
  return [...bySubset.values()].map((track) => track.slice().sort((a, b) => a.t - b.t));
}

/* The box on one track at `t`, or null outside its span. */
function boxOnTrack(track, t) {
  if (!track.length || t < track[0].t - EDGE || t > track[track.length - 1].t + EDGE) return null;
  for (let index = 0; index < track.length; index += 1) {
    const after = track[index];
    if (after.t + EDGE < t) continue;
    const before = index > 0 ? track[index - 1] : after;
    const span = after.t - before.t;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - before.t) / span)) : 0;
    const mix = (key) => before[key] + (after[key] - before[key]) * f;
    return { x: mix('x'), y: mix('y'), width: mix('width'), height: mix('height') };
  }
  return null;
}

/**
 * Where a picture drawn with `object-fit: contain` sits inside its element, in the
 * element's own pixels: the player's canvas is stretched to its box and letterboxes the
 * frame, and a box drawn against the whole element would miss the animal by the bars.
 */
export function contentRect(elementWidth, elementHeight, pictureWidth, pictureHeight) {
  const width = Math.max(0, Number(elementWidth) || 0);
  const height = Math.max(0, Number(elementHeight) || 0);
  const aspect = (Number(pictureWidth) || 16) / (Number(pictureHeight) || 9);
  if (width / Math.max(height, 1e-9) > aspect) {
    const shown = height * aspect;
    return { left: (width - shown) / 2, top: 0, width: shown, height };
  }
  const shown = width / aspect;
  return { left: 0, top: (height - shown) / 2, width, height: shown };
}

/**
 * Why this browser cannot play video in the inspector, or null when it can.
 *
 * The player decodes with WebCodecs, and signs in to Jellyfin with `crypto.randomUUID`,
 * and a browser offers neither on a page that is not a secure context: plain `http://`
 * anywhere but `localhost`. Found by using it at the development server's public address,
 * where signing in failed with "crypto.randomUUID is not a function".
 */
export function playbackBlocker({ secureContext, hasVideoDecoder }) {
  if (!secureContext) {
    return 'Video playback needs a secure address. This page was opened over plain http, where '
      + 'the browser turns off the video decoder the player needs. Open MARP over https, or on '
      + 'this machine at localhost.';
  }
  if (!hasVideoDecoder) {
    return 'This browser has no WebCodecs video decoder, which the player needs. Use a current '
      + 'Chrome or Edge.';
  }
  return null;
}

/**
 * How much memory the player may hold, by device (#181), or null for its own defaults.
 *
 * A desktop keeps the player's own settings, which were tuned on one: 3 GiB of raw video
 * and 3 GiB of decoded frames. Everything else -- a phone, a tablet -- is held small,
 * with the player's Advanced settings there to raise it: such a browser is killed rather
 * than slowed when it runs out, and those desktop defaults killed one on first use. A
 * decoded 1080p frame is about 3 MB, so 256 MB is some eighty frames, a few seconds
 * around the moment -- which is what reviewing an observation needs.
 */
export function cacheBudgets({ desktop }) {
  return desktop ? null : { rawGiB: 0.125, decodedGiB: 0.25 };
}
