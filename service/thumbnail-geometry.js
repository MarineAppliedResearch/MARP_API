/**
 * The thumbnail geometry: which box, and which pixels.
 *
 * **Pure functions, no video, no database, no filesystem.** That is the whole
 * point of the file. This is the part of Phase 6 most likely to be silently
 * wrong -- every failure here produces a *valid JPEG of the wrong part of the
 * seabed*, which a reviewer reads as a bad detection rather than as a bug -- and
 * it is the only part that can be proven in a second by a unit test rather than
 * by looking at pictures.
 *
 * Three facts it is built on, none of them obvious and all of them checked:
 *
 * - **The box is normalised** -- `x`, `y`, `width`, `height` on `keyframes` are
 *   fractions of the frame, not pixels. So the crop needs the decoded frame's own
 *   pixel dimensions, which the keyframe does not carry (R6).
 * - **The box is centre-origin** (F1). `x, y` is the middle, not the top-left,
 *   confirmed three times in two other repositories and then confirmed by eye in
 *   the spike: the centre-origin box sits on the animal, the top-left box is
 *   shifted half a box right and down and contains bare rubble.
 * - **Boxes run off the frame edge** (F3). Measured over 78 real keyframes the
 *   box spans `[-0.0105, 1.0275]` horizontally, so the crop clamps (R7). No real
 *   extraction has yet produced one -- 0 of 6 in the spike -- which is exactly
 *   why R22 requires the clamp to be proven by a test rather than by a run.
 *
 * The geometry is the spike's (`scripts/thumbnail-spike.js`), whose output the
 * human reviewed and approved. It is lifted here rather than shared with it: the
 * spike is the manual verification tool and stays runnable on its own.
 *
 * Refs #118.
 *
 * @fileoverview Pure box interpolation and crop-rectangle geometry for thumbnails.
 * @author Isaac Travers
 * @module service/thumbnail-geometry
 */

'use strict';

const { PAD_FRACTION } = require('../config/thumbnails');

/**
 * Linear interpolation between two numbers.
 *
 * @param {number} from - Value at ratio 0.
 * @param {number} to - Value at ratio 1.
 * @param {number} ratio - Where between them, 0..1.
 * @returns {number} The interpolated value.
 */
function lerp(from, to, ratio) {
    return from + ((to - from) * ratio);
}

/**
 * Groups an observation's keyframes by `subset`, each group ordered by framenum.
 *
 * `keyframes.subset` distinguishes independently tracked items inside one
 * observation -- the worker keys its lists `observation_id_subset` and the ingest
 * defaults it to `"1"`. **Interpolating across two subsets would interpolate
 * between two different animals' boxes**, which is precisely the silent
 * wrong-picture failure this module exists to prevent, so the groups are never
 * mixed.
 *
 * On every observation MARP holds today there is exactly one subset, so this is a
 * one-group operation in practice and matters only for legacy rows.
 *
 * @param {Array<Object>} keyframes - Keyframes for one observation.
 * @returns {Map<string, Array<Object>>} subset to its keyframes, ascending by framenum.
 */
function groupBySubset(keyframes) {
    const groups = new Map();

    for (const keyframe of keyframes) {
        const subset = keyframe.subset == null ? '' : String(keyframe.subset);

        if (!groups.has(subset)) {
            groups.set(subset, []);
        }

        groups.get(subset).push(keyframe);
    }

    for (const group of groups.values()) {
        group.sort((a, b) => Number(a.framenum) - Number(b.framenum));
    }

    return groups;
}

/**
 * Picks the two keyframes bracketing a frame and interpolates the box between
 * them.
 *
 * Linear on `x`, `y`, `width` and `height` against `framenum`. This is A4's
 * answer, and it is **not one of the four candidates that assumption listed** --
 * all four picked an existing keyframe, and the human's answer was to extract the
 * frame at the observation's own time and compute its box: *"we want to use a
 * frame at the observation time even if it's not a key frame, because we can
 * extrapolate where the frames are in between key frames."*
 *
 * That is the only path on real data and it is always available on it: measured
 * over the first real run, **0 of 6** observations have a keyframe at their own
 * frame and **6 of 6** fall inside their keyframe span.
 *
 * An exact hit returns that keyframe unchanged. A frame outside the span returns
 * null rather than extrapolating off the end of the track, so the caller can fall
 * back to the stated fallback instead of inventing a box.
 *
 * @param {Array<Object>} keyframes - Keyframes of one subset, any order.
 * @param {number} frame - The observation's own absolute frame.
 * @returns {Object|null} `{ before, after, ratio, box }`, or null when the frame is outside the span.
 */
function interpolateBox(keyframes, frame) {
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
        return null;
    }

    let before = null;
    let after = null;

    for (const keyframe of keyframes) {
        const framenum = Number(keyframe.framenum);

        if (framenum <= frame && (!before || framenum > Number(before.framenum))) {
            before = keyframe;
        }

        if (framenum >= frame && (!after || framenum < Number(after.framenum))) {
            after = keyframe;
        }
    }

    if (!before || !after) {
        return null;
    }

    const span = Number(after.framenum) - Number(before.framenum);
    const ratio = span === 0 ? 0 : (frame - Number(before.framenum)) / span;

    return {
        before,
        after,
        ratio,
        box: {
            x: lerp(Number(before.x), Number(after.x), ratio),
            y: lerp(Number(before.y), Number(after.y), ratio),
            width: lerp(Number(before.width), Number(after.width), ratio),
            height: lerp(Number(before.height), Number(after.height), ratio),
        },
    };
}

/**
 * The largest box in a set of keyframes, by normalised area.
 *
 * A4's stated fallback: *"if that's too hard at the moment... then just use the
 * largest keyframe."* Deliberately **not** highest-confidence, which was A4's
 * option (iv) -- `keyframes.confidence` is NULL on every row the reduction writes
 * and will stay that way until `marp-inference-worker#9` lands, so choosing it
 * would silently degrade to picking an arbitrary row.
 *
 * On machine-written data this is dead code that still has to exist, because a
 * legacy observation whose counted frame sits outside its keyframe span reaches
 * it.
 *
 * @param {Array<Object>} keyframes - Keyframes to choose between.
 * @returns {Object|null} The chosen keyframe, or null when there are none.
 */
function largestKeyframe(keyframes) {
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
        return null;
    }

    // Ties broken by the lower framenum, so the choice is deterministic. Page
    // membership being query-derived makes non-determinism expensive everywhere
    // in this subsystem, and a picture that changes on re-extraction for no
    // reason is the same class of problem.
    return keyframes.reduce((best, candidate) => {
        const bestArea = Number(best.width) * Number(best.height);
        const area = Number(candidate.width) * Number(candidate.height);

        if (area > bestArea) {
            return candidate;
        }

        if (area === bestArea && Number(candidate.framenum) < Number(best.framenum)) {
            return candidate;
        }

        return best;
    });
}

/**
 * Orders subset labels the way they are numbered, lowest first.
 *
 * `subset` is a `varchar`, so a plain string sort puts `"10"` before `"2"`. The
 * labels are numbers, so they are compared as numbers. A label that is not a
 * number sorts after every label that is, rather than throwing -- legacy data is
 * not obliged to be tidy, and picking *something* deterministically beats failing.
 *
 * @param {string} a - One subset label.
 * @param {string} b - The other.
 * @returns {number} Negative when `a` comes first.
 */
function compareSubsets(a, b) {
    const na = Number(a);
    const nb = Number(b);
    const aNumeric = a !== '' && Number.isFinite(na);
    const bNumeric = b !== '' && Number.isFinite(nb);

    if (aNumeric && bNumeric) {
        return na - nb;
    }

    if (aNumeric !== bNumeric) {
        return aNumeric ? -1 : 1;
    }

    return a < b ? -1 : (a > b ? 1 : 0);
}

/**
 * Chooses the frame and the box to cut a thumbnail from.
 *
 * The whole of A4 in one place: **the first subset**, then interpolate at the
 * observation's own frame where that subset brackets it, otherwise fall back to
 * its largest box.
 *
 * **The subset is chosen before the box, and nothing about the box can change
 * it.** Answered by the human, 2026-09-09: *"if it has more than one subset it
 * should always be the subset first, subsets are labeled by number starting at
 * 0."* An earlier rule here asked every subset and preferred whichever bracketed
 * the counted frame, breaking ties by area -- that let a picture come from a
 * track nobody chose, and it is gone.
 *
 * @param {Array<Object>} keyframes - Every keyframe of one observation.
 * @param {number} observationFrame - The observation's own absolute frame.
 * @returns {Object|null} `{ box, framenum, subset, source, before, after }`, or null when there are no keyframes at all.
 */
function chooseBox(keyframes, observationFrame) {
    const groups = groupBySubset(keyframes);

    if (groups.size === 0) {
        return null;
    }

    // The first subset, and only the first. Everything after this point reads one
    // group, so a second subset cannot contribute a box or a frame.
    const first = [...groups.keys()].sort(compareSubsets)[0];
    const group = groups.get(first);

    let interpolatedChoice = null;
    let fallbackChoice = null;

    const interpolated = interpolateBox(group, observationFrame);

    if (interpolated) {
        interpolatedChoice = {
            box: interpolated.box,
            framenum: observationFrame,
            subset: group[0].subset == null ? null : String(group[0].subset),
            source: 'interpolated',
            before: interpolated.before,
            after: interpolated.after,
        };
    } else {
        const largest = largestKeyframe(group);

        fallbackChoice = {
            box: {
                x: Number(largest.x),
                y: Number(largest.y),
                width: Number(largest.width),
                height: Number(largest.height),
            },
            framenum: Number(largest.framenum),
            subset: largest.subset == null ? null : String(largest.subset),
            source: 'largest-keyframe',
            before: largest,
            after: largest,
        };
    }

    return interpolatedChoice || fallbackChoice;
}

/**
 * Turns a normalised centre-origin box into the pixel rectangle to cut (R7).
 *
 * Four steps, in this order, and the order is the requirement:
 *
 * 1. **Centre-origin** (F1): `left = (x - width/2) * source_width`. A reading that
 *    treats `x, y` as the top-left is off by half a box in both axes, which on the
 *    median box is 118 px at 1920 wide -- the organism half out of the picture,
 *    silently.
 * 2. **Pad** by {@link PAD_FRACTION} of the box on each side (A5), knowingly a
 *    *second* application: the worker already velocity-pads a machine-written box
 *    before it is stored.
 * 3. **Expand to square** about the same centre. The tile is `aspect-ratio: 1`
 *    with `object-fit: cover`, so a wide crop -- the median box is 2.2 : 1 -- has
 *    its left and right ends cut off by the browser, which for an elongated
 *    organism removes exactly the part a reviewer identifies it by. Doing it
 *    server-side is what stops the client throwing half the picture away.
 * 4. **Clamp** to the frame. An overhanging box yields a smaller crop, never a
 *    negative offset and never an error.
 *
 * @param {Object} box - Normalised `{x, y, width, height}`, centre-origin.
 * @param {number} sourceWidth - Decoded frame width, in pixels.
 * @param {number} sourceHeight - Decoded frame height, in pixels.
 * @returns {Object} `{ raw, square, clamped, wasClamped }`, all rectangles in pixels.
 * @throws {Error} If the source dimensions are not usable. R6: extraction fails rather than guessing.
 */
function cropRectangle(box, sourceWidth, sourceHeight) {
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)
        || sourceWidth < 1 || sourceHeight < 1) {
        throw new Error(
            `Source frame dimensions are required to crop a normalised box, and were ${sourceWidth}x${sourceHeight}. `
            + 'A normalised box multiplied by the wrong dimensions is a silent crop of the wrong part of the frame.'
        );
    }

    const centreX = box.x * sourceWidth;
    const centreY = box.y * sourceHeight;
    const boxWidth = box.width * sourceWidth;
    const boxHeight = box.height * sourceHeight;

    // The box as drawn, before any of this phase's own padding. Kept because it
    // is what an annotated verification frame draws.
    const raw = {
        left: centreX - (boxWidth / 2),
        top: centreY - (boxHeight / 2),
        width: boxWidth,
        height: boxHeight,
    };

    const paddedWidth = boxWidth * (1 + (2 * PAD_FRACTION));
    const paddedHeight = boxHeight * (1 + (2 * PAD_FRACTION));

    const side = Math.max(paddedWidth, paddedHeight);

    const square = {
        left: centreX - (side / 2),
        top: centreY - (side / 2),
        width: side,
        height: side,
    };

    // Intersect with the frame. The origin is clamped to the *last* pixel as
    // well as the first, which is the half the spike's version left out: a box
    // whose centre is off the frame entirely -- `x = 1.5` -- gave a left of 2765
    // against a 1920-wide frame, and the one-pixel floor below then produced a
    // rectangle ending at 2766. `sharp.extract` refuses that, so a degenerate box
    // would have failed the extraction rather than yielded an edge sliver. Found
    // by this module's own test, which is precisely the point of R22 -- no real
    // extraction has ever produced an out-of-frame box.
    const left = Math.min(Math.max(0, Math.floor(square.left)), sourceWidth - 1);
    const top = Math.min(Math.max(0, Math.floor(square.top)), sourceHeight - 1);
    const right = Math.min(sourceWidth, Math.max(left + 1, Math.ceil(square.left + square.width)));
    const bottom = Math.min(sourceHeight, Math.max(top + 1, Math.ceil(square.top + square.height)));

    const clamped = {
        left,
        top,
        // At least one pixel: a box entirely outside the frame is degenerate
        // rather than an error, and `sharp` refuses a zero-width extract.
        width: right - left,
        height: bottom - top,
    };

    // Whether the square genuinely overhung the frame, asked of the square
    // itself. Comparing the clamped size against `side` instead reports a
    // spurious clamp on every crop, because floor(left) and ceil(right) widen it
    // by a pixel -- a defect the spike had and that made "0 of 6 clamped" look
    // like "6 of 6 clamped" until it was fixed.
    const wasClamped = square.left < 0
        || square.top < 0
        || (square.left + square.width) > sourceWidth
        || (square.top + square.height) > sourceHeight;

    return { raw, square, clamped, wasClamped };
}

module.exports = {
    chooseBox,
    cropRectangle,
    groupBySubset,
    interpolateBox,
    largestKeyframe,
};
