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

const { parseTimeSpan, absoluteFrame } = require('./timecode');

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

module.exports = { HABITAT_SESSION_TYPE, HABITAT_BOX, derivedKeyframes };
