/**
 * The two keyframes an annotated habitat stretch is treated as having (#287, A20 and A22).
 *
 * Settled with Isaac on 2026-11-12: every habitat observation has a first keyframe at its
 * start and a last at its end, with the habitat crop as the box, so an annotator's stretch
 * has a picture in the Mosaic and is reviewed like any other. A model's stretches are given
 * these two at ingest. An annotator's have none in `keyframes`, and **none are written**
 * (A22): they are worked out here whenever something needs them.
 *
 * The positions are the annotator's, so the frames are on the 25-a-second scale that
 * `keyframes.framenum` uses for every row not made by a model (`absoluteFrame`).
 *
 * @fileoverview Derived start and end keyframes for annotated habitat stretches.
 * @module db/habitat-keyframes
 */

'use strict';

const {
    parseTimeSpan, formatTimeSpan, absoluteFrame, deriveTc, deriveFrame, shiftTruncated, ASSUMED_FPS,
} = require('./timecode');

/** The session type whose observations are habitat stretches. */
const HABITAT_SESSION_TYPE = 'Habitat';

/**
 * The habitat crop as a keyframe box: centre-origin and normalised, as keyframes are.
 * x 0.25-0.75 and y 0.5-1.0 of the frame, kept by Isaac on 2026-11-10.
 */
const HABITAT_BOX = Object.freeze({ x: 0.5, y: 0.75, width: 0.5, height: 0.5 });

/**
 * The start and end keyframes of an annotated habitat stretch.
 *
 * @param {Object} row - `{observation_id, comname, mediaPosition, tc, etc}`.
 * @returns {Array<Object>} Keyframe-shaped rows, start then end, with `derived: true` and no
 *   `keyframe_id`; one when the stretch has no usable end, none without a position.
 */
function derivedKeyframes(row) {
    const media = parseTimeSpan(row.mediaPosition);
    if (media === null) return [];

    const keyframe = (type, framenum) => ({
        observation_id: row.observation_id, subset: '1', comname: row.comname, type, framenum,
        ...HABITAT_BOX, confidence: null, derived: true,
    });

    const start = absoluteFrame(media);
    const tc = parseTimeSpan(row.tc);
    const etc = parseTimeSpan(row.etc);
    if (tc === null || etc === null || etc <= tc) return [keyframe('start', start)];
    return [keyframe('start', start), keyframe('end', absoluteFrame(media + (etc - tc)))];
}

/**
 * The columns that change when a habitat stretch is given a new start and end (#287, R5).
 *
 * A stretch states its start in `mediaPosition`, `actualPosition`, `tc`, `frame` and
 * `observed_at`, and its end in `etc`; a model's stretch also in its start and end keyframes.
 * They all move together, by the same rules that wrote them:
 *
 * - **The start moves every start column by the same amount**, so a row keeps its own clock:
 *   whatever lay between its position in the video and its `actualPosition` still does.
 *   `tc` and `frame` are worked out again where the row's own values were worked out that way
 *   (`classifyRow`'s test); where something else wrote them they are shifted, never replaced
 *   with a guess.
 * - **The end is `etc`.** A model's is `actualPosition` plus the length, as the ingest wrote
 *   it. An annotator's is read back as its start plus `etc - tc` (`derivedKeyframes`), and
 *   both are whole seconds, so its length is kept to the nearest whole second -- the
 *   resolution the annotation was recorded at.
 *
 * @param {Object} row - `mediaPosition`, `actualPosition`, `tc`, `etc`, `frame`, `observed_at`.
 * @param {Object} change
 * @param {number} change.startMs - The new start, in milliseconds of the video.
 * @param {number} change.endMs - The new end, in milliseconds of the video.
 * @param {boolean} change.keyed - A model's stretch, with keyframes of its own.
 * @param {number} [change.fps] - The rate its frames count at.
 * @returns {{columns: Object, startFrame: number, endFrame: number}} The columns to write, and
 *   the keyframe frames a keyed stretch's start and end move to.
 * @throws {Error} When the row has no readable position to move from.
 */
function retimedColumns(row, { startMs, endMs, keyed, fps = ASSUMED_FPS }) {
    const mediaMs = parseTimeSpan(row.mediaPosition);
    if (mediaMs === null) throw new Error('The stretch has no readable position in the video.');
    const shift = startMs - mediaMs;
    const lengthMs = endMs - startMs;
    const columns = { mediaPosition: formatTimeSpan(startMs) };

    const actualMs = parseTimeSpan(row.actualPosition);
    const actualNow = actualMs === null ? null : actualMs + shift;
    if (actualNow !== null) columns.actualPosition = formatTimeSpan(actualNow);

    // Worked out again only where the row's own value was worked out this way.
    const tcDerived = actualMs !== null && deriveTc(actualMs) === row.tc;
    columns.tc = tcDerived ? deriveTc(actualNow) : shiftTruncated(row.tc, shift);
    const frame = row.frame == null ? null : String(row.frame);
    if (actualMs !== null && frame !== null && deriveFrame(actualMs, fps) === frame) {
        columns.frame = deriveFrame(actualNow, fps);
    }
    if (row.observed_at) columns.observed_at = new Date(new Date(row.observed_at).getTime() + shift);

    if (keyed && actualNow !== null) {
        columns.etc = deriveTc(actualNow + lengthMs);
    } else {
        const tcMs = parseTimeSpan(columns.tc);
        if (tcMs === null) throw new Error('The stretch has no readable tc to measure its end from.');
        columns.etc = deriveTc(tcMs + Math.round(lengthMs / 1000) * 1000);
    }

    return {
        columns,
        startFrame: Math.round((startMs * fps) / 1000),
        endFrame: Math.round((endMs * fps) / 1000),
    };
}

module.exports = { HABITAT_SESSION_TYPE, HABITAT_BOX, derivedKeyframes, retimedColumns };
