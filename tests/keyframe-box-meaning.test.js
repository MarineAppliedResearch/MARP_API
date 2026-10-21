/**
 * The two readers of `keyframes.x, y` agree on what it means.
 *
 * Two pieces of this platform turn a keyframe box into a rectangle, and they are in
 * different modules written months apart:
 *
 * - `service/thumbnail-geometry.js` `cropRectangle`, which crops the picture a mosaic
 *   tile shows, reading `box.x * sourceWidth` as the **centre**;
 * - `service/dataset-build-plan.js` `boxAt`, which turns the same row into the YOLO
 *   label a model is trained on.
 *
 * **They disagreed for a day and nothing compared them.** `boxAt` added half a width and
 * half a height to a coordinate that was already the centre, so every label the builder
 * had ever written was half a box right and down of the animal it named — while the
 * thumbnail of that same observation was correctly centred on it. The answer had been
 * recorded in `thumbnail-geometry` all along (F1): *"the centre-origin box sits on the
 * animal, the top-left box is shifted half a box right and down and contains bare
 * rubble"*.
 *
 * This is the check that would have caught it, and the one that does not decay. The
 * assertion that found it in the wild — every label coordinate inside 0..1 — **cannot
 * catch it again**: the builder clips labels to the frame now, so an overflowing centre
 * is trimmed back into range before anything can see it. A comparison between the two
 * readers has no such hole, needs no video, and fails whichever side drifts.
 *
 * **Interior boxes only.** `boxAt` clips to the frame and `cropRectangle.raw` does not,
 * so at an edge they differ for a reason that is not disagreement. The clipping is
 * covered in `tests/dataset-build-plan.test.js`; what is compared here is the reading.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Cross-checks the builder's box reading against the thumbnail extractor's.
 * @author Isaac Travers
 * @module tests/keyframe-box-meaning
 */

'use strict';

const { boxAt } = require('../service/dataset-build-plan');
const { cropRectangle } = require('../service/thumbnail-geometry');

/**
 * Boxes well clear of every edge, so neither side clips and the comparison is about the
 * reading alone. Deliberately asymmetric in both position and size: a box centred at
 * 0.5, or square, would agree with itself under a swapped axis or a confused dimension.
 */
const BOXES = [
    { what: 'the fixture box', x: 0.4, y: 0.6, width: 0.2, height: 0.3 },
    { what: 'a small box high and left', x: 0.25, y: 0.3, width: 0.1, height: 0.05 },
    { what: 'a wide shallow box', x: 0.55, y: 0.45, width: 0.4, height: 0.12 },
];

/** Frame sizes to compare at. The second is not 16:9, so a swapped axis shows. */
const FRAMES = [
    { what: 'a 1080p frame', width: 1920, height: 1080 },
    { what: 'a 640x480 frame', width: 640, height: 480 },
];

/**
 * The pixel rectangle the builder's reading implies.
 *
 * `boxAt` answers in YOLO's terms -- a normalised centre and size -- so this puts it
 * back into pixels the way a trainer would, to compare with the extractor's rectangle.
 *
 * @param {Object} box - The keyframe box.
 * @param {number} width - Source frame width.
 * @param {number} height - Source frame height.
 * @returns {{left: number, top: number, width: number, height: number}} In pixels.
 */
function builderRectangle(box, width, height) {
    // One keyframe, asked for at its own frame: no interpolation, just the reading.
    const label = boxAt([{ framenum: 0, ...box }], 0);

    return {
        left: (label.cx - (label.w / 2)) * width,
        top: (label.cy - (label.h / 2)) * height,
        width: label.w * width,
        height: label.h * height,
    };
}

describe('the builder and the thumbnail extractor read a keyframe box the same way (#268)', () => {

    for (const box of BOXES) {
        for (const frame of FRAMES) {
            test(`${box.what} on ${frame.what}`, () => {
                const theirs = cropRectangle(box, frame.width, frame.height).raw;
                const ours = builderRectangle(box, frame.width, frame.height);

                /* `raw` is the box as drawn, before the tile's own padding and before
                   the square crop -- which is the only part of `cropRectangle` that is
                   about the box rather than about what a tile looks like. */
                expect(ours.left).toBeCloseTo(theirs.left, 9);
                expect(ours.top).toBeCloseTo(theirs.top, 9);
                expect(ours.width).toBeCloseTo(theirs.width, 9);
                expect(ours.height).toBeCloseTo(theirs.height, 9);
            });
        }
    }

    /* Agreement alone is not enough: both sides could flip together and still agree, and
       then every tile and every label would be wrong in the same direction with nothing
       to say so. These two anchor the shared reading to the recorded answer. */

    test('the extractor puts the box centre at x times the width', () => {
        const { raw } = cropRectangle({ x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, 1000, 1000);

        // Centre-origin: a box at 0.5 is centred on the frame, so it starts at 400.
        // Read as a top-left, it would start at 500 and the animal would be off it.
        expect(raw.left).toBeCloseTo(400, 9);
        expect(raw.left + (raw.width / 2)).toBeCloseTo(500, 9);
    });

    test('the builder writes the keyframe\'s own coordinates as the label centre', () => {
        const label = boxAt([{ framenum: 0, x: 0.4, y: 0.6, width: 0.2, height: 0.3 }], 0);

        // The numbers pass through unchanged, because YOLO wants exactly what the
        // keyframe records. Adding half a width here is the defect this file is for.
        expect(label.cx).toBeCloseTo(0.4, 9);
        expect(label.cy).toBeCloseTo(0.6, 9);
        expect(label.w).toBeCloseTo(0.2, 9);
        expect(label.h).toBeCloseTo(0.3, 9);
    });
});
