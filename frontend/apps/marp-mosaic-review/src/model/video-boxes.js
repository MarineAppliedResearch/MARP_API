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
 * How far from a keyframe's time a picture still counts as that keyframe's: half a frame, of
 * the coarser of the video's rate and 25 (#181).
 *
 * A row without a GPU job counts its frames at 25 whatever the video's rate, so on a 29.97
 * video its keyframe can sit up to half a 25-frame -- 20 ms -- from the picture it was drawn
 * on. Within a millionth of a second, a box just added, or the last of a merged track, was not
 * drawn on the very frame it was made on, depending on which frame that was.
 */
export function trackTolerance(frameRate) {
  return 0.5 / Math.min(Number(frameRate) || 25, 25);
}

/**
 * Whether a track has no `end` keyframe, so it is still being made and is drawn forward.
 *
 * @param {Array<Object>} track - One track's keyframes.
 * @returns {boolean}
 */
export function isUnfinished(track) {
  return Boolean(track && track.length && track[track.length - 1].type !== 'end');
}

/**
 * The box of each observation whose track spans time `t`, interpolated between the
 * keyframes either side. Linear interpolation is what the keyframe reduction was built
 * to reproduce. A track is drawn only within its own span: before its first keyframe
 * or after its last, the animal is not in the record, and a box there would be a guess.
 */
export function boxesAt(observations, t, tolerance = EDGE) {
  const out = [];
  for (const observation of observations || []) {
    // Tracks sorted once when the keyframes arrived, where the caller has them: sorting
    // on every frame was a cost paid for every observation held, every frame.
    for (const track of observation.tracks || tracksOf(observation.keyframes)) {
      const box = boxOnTrack(track, t, tolerance);
      if (box) {
        // The track's subset and keyframes go with the box, so an edit knows which track
        // it is on and whether the picture is on one of its keyframes.
        out.push({
          observation_id: observation.observation_id,
          obs_id: observation.obs_id,
          comname: observation.comname,
          subset: track[0].subset == null ? null : String(track[0].subset),
          keyframes: track,
          ...box
        });
      }
    }
  }
  return out;
}

/** One observation's keyframes as tracks, one per subset, each in time order. */
export function tracksOf(keyframes) {
  const bySubset = new Map();
  for (const keyframe of keyframes || []) {
    const key = keyframe.subset == null ? '' : String(keyframe.subset);
    if (!bySubset.has(key)) bySubset.set(key, []);
    bySubset.get(key).push(keyframe);
  }
  return [...bySubset.values()].map((track) => track.slice().sort((a, b) => a.t - b.t));
}

/* A box narrower and shorter than this share of the picture is a click, not a drawn box. */
const POINT = 0.01;

/* How long a click is shown, centred on its moment (Isaac, 2026-11-23). */
export const POINT_SHOWN = 1;

/**
 * Whether a track is a single click with no end: one keyframe, a dot rather than a box. The
 * annotation GUI records one when an annotator clicks instead of drawing, and never ends it,
 * so drawn forward like an unfinished track it stayed on screen to the end of the video.
 */
export function isClick(track) {
  if (!track || track.length !== 1 || track[0].type === 'end') return false;
  return track[0].width < POINT && track[0].height < POINT;
}

/* The box on one track at `t`, or null outside its span. */
function boxOnTrack(track, t, tolerance) {
  if (!track.length) return null;
  // A click is shown for about a second around its moment, then gone. A drawn box with no end
  // is still drawn forward below: that is how a box just started on the page stays up.
  if (isClick(track)) {
    const k = track[0];
    return Math.abs(t - k.t) <= POINT_SHOWN / 2 + tolerance
      ? { x: k.x, y: k.y, width: k.width, height: k.height } : null;
  }
  if (t < track[0].t - tolerance) return null;
  const last = track[track.length - 1];
  if (t > last.t + tolerance) {
    // Past the last keyframe. A track with an `end` stops there -- after it the animal is
    // not in the record. A track with no end yet is unfinished, and the annotation GUI goes
    // on drawing its last box forward until somebody sets the end
    // (`VideoPlayer.xaml.cs`: previous != null && next == null && previous.type != "end").
    // Without this a new observation vanished on the next frame and could not be moved or
    // ended at all (2026-10-14).
    if (last.type === 'end') return null;
    return { x: last.x, y: last.y, width: last.width, height: last.height, unfinished: true };
  }
  for (let index = 0; index < track.length; index += 1) {
    const after = track[index];
    if (after.t < t && index < track.length - 1) continue;
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

/**
 * The quality a video opens at, by device (#181), or null for the player's own choice.
 *
 * A desktop plays the original file, as it always has. Anything else opens a 720p
 * transcode: the original is 1080p with a keyframe every ten seconds, and the player
 * decodes a whole keyframe interval at a time -- about 742 MB a unit, three held at
 * once -- which ran a phone out of memory and took its other apps down with it. The
 * transcode starts every three-second segment on a keyframe, so a unit is a tenth of
 * that. The name must be one of the player's own tiers: its quality menu matches on it.
 * The menu is still there to choose another.
 */
export function openingQuality({ desktop }) {
  return desktop ? null : { name: '720p, 4 Mbps', maxStreamingBitrate: 4_000_000, maxWidth: 1280, maxHeight: 720 };
}

/**
 * When the picture on screen was really taken, from the player's frame metadata.
 *
 * A transcode's segment grid runs ahead of its pictures -- six seconds by ten minutes into
 * one dive -- so `mediaTime` names a moment the picture is not from. `rawFrameTime` is the
 * decoded frame's own timestamp, which the burned-in dive clock agrees with. On the
 * original file the two are the same.
 */
export function pictureTime(metadata) {
  return Number.isFinite(metadata.rawFrameTime) ? metadata.rawFrameTime : metadata.mediaTime;
}

/**
 * Where the first seek goes: one frame short of the moment.
 *
 * The player opens on the moment and paints it before the page is watching, and it
 * reports a frame only when it paints a new one -- so a seek to the moment itself
 * paints nothing, reports nothing, and the page never learns what it is showing. That
 * left the status reading "Seeking…" for good. A frame short always paints, and the
 * landing correction then steps onto the moment.
 */
export function firstSeekTarget(moment, fps = 25) {
  // From the frame the moment is in, not the moment: one a millisecond short of a frame
  // stepped back onto the frame already shown, which painted nothing (Isaac, 2026-11-20).
  const frame = Math.floor(moment * fps + 1e-6);
  return frame >= 1 ? (frame - 1) / fps : (frame + 1) / fps;
}

/**
 * The moment as the frame it falls in (2026-11-20). A position recorded in milliseconds, as
 * the annotation GUI writes them, is seldom exactly on a frame: 1027.599 s is a millisecond short
 * of frame 25690 at 25 a second. The page opens and steps on whole frames, so it is given one --
 * the frame a habitat stretch's start is drawn on (`absoluteFrame`, which also rounds down).
 *
 * @param {number} moment - Seconds.
 * @param {number} [fps]
 * @returns {number} The start of the frame it is in, in seconds.
 */
export function frameTime(moment, fps = 25) {
  return Math.floor(moment * fps + 1e-6) / fps;
}
