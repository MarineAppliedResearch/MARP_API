/**
 * Tests for the thumbnail geometry (#118).
 *
 * **One tier, `unit`, and deliberately so.** This is the part of Phase 6 most
 * likely to be silently wrong and the only part a test can see cheaply: every
 * failure here produces a *valid JPEG of the wrong part of the seabed*, which a
 * reviewer reads as a bad detection rather than as a bug. No video, no database,
 * no filesystem; the whole file runs in under a second.
 *
 * **R22 is the reason this file exists.** F37 recorded that after the spike's own
 * clamp-detection defect was fixed, **0 of 6** real boxes clamped -- every one sat
 * well inside the frame -- while F3 measured, over 78 real keyframes, a box
 * spanning `[-0.0105, 1.0275]` horizontally. So out-of-frame boxes exist and no
 * real extraction has yet produced one, which means the clamp path is completely
 * unexercised by any run and will stay that way until real data happens to
 * contain one. *"Do not read 0 of 6 clamped as clamping works."* The boxes below
 * are constructed to overhang each of the four edges and both diagonal corners,
 * and each asserts the **intersection** rather than merely that nothing threw.
 *
 * The other half is F1, centre-origin. The spike confirmed it by eye -- the
 * centre-origin box sits on the animal, the top-left box is shifted half a box
 * right and down and contains bare rubble -- and this asserts the arithmetic that
 * reading implies, so a later refactor cannot quietly reintroduce the top-left
 * reading.
 *
 * Refs #118.
 *
 * @fileoverview Unit tests for thumbnail box interpolation and crop geometry.
 * @module tests/thumbnail-geometry
 */

const {
    chooseBox,
    cropRectangle,
    groupBySubset,
    interpolateBox,
    largestKeyframe,
} = require('../service/thumbnail-geometry');

const { PAD_FRACTION } = require('../config/thumbnails');

/** The real source dimensions the spike measured. */
const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;

/**
 * A keyframe, with only the fields the geometry reads.
 *
 * @param {number} framenum - Absolute frame number.
 * @param {Object} box - `{x, y, width, height}` normalised, centre-origin.
 * @param {string} [subset] - Which track.
 * @returns {Object} The keyframe row.
 */
const keyframe = (framenum, box, subset = '1') => ({ framenum, subset, ...box });

describe('thumbnail geometry (#118)', () => {

    describe('the box is centre-origin (F1)', () => {

        it('puts the box centre at x, y rather than its corner', () => {
            // A box half the frame wide and half high, centred exactly.
            const { raw } = cropRectangle(
                { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            // Centre-origin: left = (0.5 - 0.25) * 1920 = 480.
            // Top-left would put it at 0.5 * 1920 = 960, half a box further
            // right, which is the reading that lands on bare rubble.
            expect(raw.left).toBe(480);
            expect(raw.top).toBe(270);
            expect(raw.width).toBe(960);
            expect(raw.height).toBe(540);
        });

        it('is off by half a box in both axes if read as top-left', () => {
            const box = { x: 0.3, y: 0.7, width: 0.1222, height: 0.0999 };
            const { raw } = cropRectangle(box, SOURCE_WIDTH, SOURCE_HEIGHT);

            const asTopLeft = { left: box.x * SOURCE_WIDTH, top: box.y * SOURCE_HEIGHT };

            // The median fixture box is 0.1222 wide, which is 235 px at 1920 --
            // so the mistake is 117 px horizontally, the organism half out of
            // the picture.
            expect(asTopLeft.left - raw.left).toBeCloseTo((box.width * SOURCE_WIDTH) / 2, 6);
            expect(asTopLeft.top - raw.top).toBeCloseTo((box.height * SOURCE_HEIGHT) / 2, 6);
        });
    });

    describe('padding and the square expansion (A5, F12)', () => {

        it('pads by 10% of the box on each side before squaring', () => {
            // Square already, so the square step changes nothing and the padding
            // is the only thing under test.
            const { square } = cropRectangle(
                { x: 0.5, y: 0.5, width: 0.1, height: 0.1 * (SOURCE_WIDTH / SOURCE_HEIGHT) },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            const boxSide = 0.1 * SOURCE_WIDTH;

            expect(PAD_FRACTION).toBe(0.10);
            expect(square.width).toBeCloseTo(boxSide * (1 + (2 * PAD_FRACTION)), 6);
            expect(square.height).toBeCloseTo(square.width, 6);
        });

        it('expands a wide box to a square about the same centre', () => {
            // The median real box is about 2.2 : 1. The client's tile is
            // aspect-ratio 1 with object-fit: cover, so a wide crop has its ends
            // cut off by the browser -- exactly the part an elongated organism is
            // identified by. Squaring here is what stops that.
            const box = { x: 0.5, y: 0.5, width: 0.22, height: 0.1 };
            const { raw, square } = cropRectangle(box, SOURCE_WIDTH, SOURCE_HEIGHT);

            expect(square.width).toBe(square.height);
            expect(square.width).toBeGreaterThan(raw.width);

            // Same centre, so nothing shifts off the animal.
            expect(square.left + (square.width / 2)).toBeCloseTo(raw.left + (raw.width / 2), 6);
            expect(square.top + (square.height / 2)).toBeCloseTo(raw.top + (raw.height / 2), 6);
        });
    });

    describe('the clamp (R7, R22)', () => {

        // Every case here asserts the intersection, not merely that the call
        // returned. A clamp that silently produced the whole frame, or a
        // one-pixel sliver, would pass "it did not throw" for ever.

        it('clamps a box overhanging the left edge to the frame', () => {
            const { clamped, wasClamped } = cropRectangle(
                { x: 0.01, y: 0.5, width: 0.10, height: 0.10 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(true);
            expect(clamped.left).toBe(0);

            // Centre 19.2 px in, padded square side 0.10 * 1920 * 1.2 = 230.4,
            // so the square runs from -96 to 134.4 and the intersection ends at
            // ceil(134.4) = 135.
            expect(clamped.width).toBe(135);
            expect(clamped.left + clamped.width).toBeLessThanOrEqual(SOURCE_WIDTH);
        });

        it('clamps a box overhanging the right edge to the frame', () => {
            const { clamped, wasClamped } = cropRectangle(
                { x: 0.99, y: 0.5, width: 0.10, height: 0.10 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(true);
            expect(clamped.left + clamped.width).toBe(SOURCE_WIDTH);

            // Mirror of the left case: centre at 1900.8, square from 1785.6 to
            // 2016, intersection from floor(1785.6) = 1785 to 1920.
            expect(clamped.left).toBe(1785);
            expect(clamped.width).toBe(135);
        });

        it('clamps a box overhanging the top edge to the frame', () => {
            const { clamped, wasClamped } = cropRectangle(
                { x: 0.5, y: 0.01, width: 0.05, height: 0.05 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(true);
            expect(clamped.top).toBe(0);
            expect(clamped.height).toBeGreaterThan(0);
            expect(clamped.top + clamped.height).toBeLessThanOrEqual(SOURCE_HEIGHT);
        });

        it('clamps a box overhanging the bottom edge to the frame', () => {
            // The survey convention counts an animal as it crosses near the
            // bottom of the frame, so this is the overhang most likely to occur
            // for real: the fixture's boxes at the observation frame sit at
            // y ~ 0.80.
            const { clamped, wasClamped } = cropRectangle(
                { x: 0.5, y: 0.99, width: 0.05, height: 0.05 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(true);
            expect(clamped.top + clamped.height).toBe(SOURCE_HEIGHT);
            expect(clamped.top).toBeLessThan(SOURCE_HEIGHT);
        });

        it('clamps a box overhanging the top-left corner in both axes', () => {
            const { clamped, wasClamped } = cropRectangle(
                { x: 0.005, y: 0.005, width: 0.08, height: 0.08 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(true);
            expect(clamped.left).toBe(0);
            expect(clamped.top).toBe(0);
            expect(clamped.width).toBeGreaterThan(0);
            expect(clamped.height).toBeGreaterThan(0);
        });

        it('clamps a box overhanging the bottom-right corner in both axes', () => {
            const { clamped, wasClamped } = cropRectangle(
                { x: 0.995, y: 0.995, width: 0.08, height: 0.08 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(true);
            expect(clamped.left + clamped.width).toBe(SOURCE_WIDTH);
            expect(clamped.top + clamped.height).toBe(SOURCE_HEIGHT);
        });

        it('never returns a negative offset or a zero dimension, for the real measured span', () => {
            // F3: over 78 real keyframes the box spans [-0.0105, 1.0275]
            // horizontally read centre-origin. Both extremes, plus a box entirely
            // outside the frame, which is degenerate rather than an error.
            const boxes = [
                { x: -0.0105, y: 0.5, width: 0.12, height: 0.10 },
                { x: 1.0275, y: 0.5, width: 0.12, height: 0.10 },
                { x: -0.5, y: -0.5, width: 0.10, height: 0.10 },
                { x: 1.5, y: 1.5, width: 0.10, height: 0.10 },
            ];

            for (const box of boxes) {
                const { clamped } = cropRectangle(box, SOURCE_WIDTH, SOURCE_HEIGHT);

                expect(clamped.left).toBeGreaterThanOrEqual(0);
                expect(clamped.top).toBeGreaterThanOrEqual(0);
                expect(clamped.width).toBeGreaterThan(0);
                expect(clamped.height).toBeGreaterThan(0);
                expect(clamped.left + clamped.width).toBeLessThanOrEqual(SOURCE_WIDTH);
                expect(clamped.top + clamped.height).toBeLessThanOrEqual(SOURCE_HEIGHT);
            }
        });

        it('does not report a clamp for a box well inside the frame', () => {
            // The spike had this defect: it compared the clamped size against the
            // square side, which floor/ceil widens by a pixel, so it reported a
            // clamp on all six real crops. Named here because "0 of 6 clamped" is
            // only meaningful if a false positive would be caught.
            const { wasClamped } = cropRectangle(
                { x: 0.5, y: 0.5, width: 0.1222, height: 0.0999 },
                SOURCE_WIDTH,
                SOURCE_HEIGHT
            );

            expect(wasClamped).toBe(false);
        });
    });

    describe('the source dimensions are required (R6)', () => {

        // A normalised box multiplied by the wrong dimensions is a silent crop
        // of the wrong part of the seabed, and it reads as a bad detection
        // rather than as a bug -- the most expensive failure this phase can
        // have. So a missing size throws rather than defaulting.

        it.each([
            ['undefined', undefined, undefined],
            ['null', null, null],
            ['zero', 0, 0],
            ['NaN', Number.NaN, Number.NaN],
        ])('refuses to crop when the source size is %s', (label, width, height) => {
            expect(() => cropRectangle({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, width, height))
                .toThrow(/Source frame dimensions are required/);
        });
    });

    describe('interpolation between bracketing keyframes (A4)', () => {

        it('interpolates linearly at the midpoint', () => {
            const track = [
                keyframe(100, { x: 0.2, y: 0.4, width: 0.10, height: 0.08 }),
                keyframe(200, { x: 0.4, y: 0.6, width: 0.20, height: 0.12 }),
            ];

            const result = interpolateBox(track, 150);

            expect(result.ratio).toBeCloseTo(0.5, 9);
            expect(result.box.x).toBeCloseTo(0.3, 9);
            expect(result.box.y).toBeCloseTo(0.5, 9);
            expect(result.box.width).toBeCloseTo(0.15, 9);
            expect(result.box.height).toBeCloseTo(0.10, 9);
        });

        it('uses the nearest bracketing pair, not the outermost', () => {
            const track = [
                keyframe(100, { x: 0.0, y: 0.0, width: 0.10, height: 0.10 }),
                keyframe(150, { x: 0.5, y: 0.5, width: 0.10, height: 0.10 }),
                keyframe(200, { x: 1.0, y: 1.0, width: 0.10, height: 0.10 }),
            ];

            const result = interpolateBox(track, 175);

            expect(result.before.framenum).toBe(150);
            expect(result.after.framenum).toBe(200);
            expect(result.box.x).toBeCloseTo(0.75, 9);
        });

        it('returns the keyframe unchanged on an exact hit', () => {
            const track = [
                keyframe(100, { x: 0.2, y: 0.4, width: 0.10, height: 0.08 }),
                keyframe(200, { x: 0.4, y: 0.6, width: 0.20, height: 0.12 }),
            ];

            const result = interpolateBox(track, 100);

            expect(result.ratio).toBe(0);
            expect(result.box).toEqual({ x: 0.2, y: 0.4, width: 0.10, height: 0.08 });
        });

        it('refuses to extrapolate off either end of the track', () => {
            const track = [
                keyframe(100, { x: 0.2, y: 0.4, width: 0.10, height: 0.08 }),
                keyframe(200, { x: 0.4, y: 0.6, width: 0.20, height: 0.12 }),
            ];

            // Off the end is a fallback, never a guess: extrapolating puts the
            // box where the animal is not, with nothing saying so.
            expect(interpolateBox(track, 99)).toBeNull();
            expect(interpolateBox(track, 201)).toBeNull();
            expect(interpolateBox([], 150)).toBeNull();
        });

        it('interpolates the real measured span the way the spike did', () => {
            // The shape of the first real run: keyframes 18000 and 18013, an
            // observation counted at 18007. 0 of 6 observations had a keyframe at
            // their own frame and 6 of 6 fell inside their span, so this is the
            // only path real data ever takes.
            const track = [
                keyframe(18000, { x: 0.500, y: 0.800, width: 0.120, height: 0.100 }),
                keyframe(18013, { x: 0.526, y: 0.826, width: 0.146, height: 0.126 }),
            ];

            const result = interpolateBox(track, 18007);

            expect(result.ratio).toBeCloseTo(7 / 13, 9);
            expect(result.box.x).toBeGreaterThan(0.500);
            expect(result.box.x).toBeLessThan(0.526);
        });
    });

    describe('choosing which box (A4, and its fallback)', () => {

        it('interpolates at the observation frame when the track brackets it', () => {
            const track = [
                keyframe(100, { x: 0.2, y: 0.4, width: 0.10, height: 0.08 }),
                keyframe(200, { x: 0.4, y: 0.6, width: 0.20, height: 0.12 }),
            ];

            const choice = chooseBox(track, 150);

            expect(choice.source).toBe('interpolated');
            expect(choice.framenum).toBe(150);
            expect(choice.subset).toBe('1');
            expect(choice.box.x).toBeCloseTo(0.3, 9);
        });

        it('falls back to the largest box when the frame is outside the span', () => {
            // A4's stated fallback, in the human's words: "if that's too hard at
            // the moment... then just use the largest keyframe." Deliberately not
            // highest-confidence, which A4 listed as option (iv) -- keyframes.
            // confidence is NULL on every row the reduction writes.
            const track = [
                keyframe(100, { x: 0.2, y: 0.4, width: 0.10, height: 0.08 }),
                keyframe(200, { x: 0.4, y: 0.6, width: 0.30, height: 0.20 }),
                keyframe(300, { x: 0.6, y: 0.8, width: 0.12, height: 0.09 }),
            ];

            const choice = chooseBox(track, 900);

            expect(choice.source).toBe('largest-keyframe');
            expect(choice.framenum).toBe(200);
            expect(choice.box.width).toBeCloseTo(0.30, 9);
        });

        it('is null when the observation has no keyframes at all (F6)', () => {
            // No box, so no cropped tile, ever. This is what makes a permanent
            // failure state necessary rather than tidy.
            expect(chooseBox([], 150)).toBeNull();
        });

        it('breaks a size tie in the fallback by the lower framenum', () => {
            const track = [
                keyframe(300, { x: 0.6, y: 0.8, width: 0.10, height: 0.10 }),
                keyframe(100, { x: 0.2, y: 0.4, width: 0.10, height: 0.10 }),
            ];

            expect(largestKeyframe(track).framenum).toBe(100);
        });
    });

    describe('subsets are never mixed', () => {

        it('groups keyframes by subset, each ordered by framenum', () => {
            const groups = groupBySubset([
                keyframe(200, { x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, '1'),
                keyframe(100, { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }, '1'),
                keyframe(150, { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }, '2'),
            ]);

            expect([...groups.keys()].sort()).toEqual(['1', '2']);
            expect(groups.get('1').map((k) => k.framenum)).toEqual([100, 200]);
            expect(groups.get('2').map((k) => k.framenum)).toEqual([150]);
        });

        it('never interpolates across two subsets', () => {
            // Two independently tracked items in one observation. Interpolating
            // between them would interpolate between two different animals'
            // boxes and land on the seabed between them -- a valid JPEG of
            // nothing, which is the failure this whole module exists to prevent.
            const keyframes = [
                keyframe(100, { x: 0.10, y: 0.10, width: 0.10, height: 0.10 }, '1'),
                keyframe(200, { x: 0.20, y: 0.20, width: 0.10, height: 0.10 }, '1'),
                keyframe(100, { x: 0.90, y: 0.90, width: 0.10, height: 0.10 }, '2'),
                keyframe(200, { x: 0.80, y: 0.80, width: 0.10, height: 0.10 }, '2'),
            ];

            const choice = chooseBox(keyframes, 150);

            // Whichever subset wins, the box must be one track's own midpoint --
            // 0.15 or 0.85 -- and never the 0.5 a mixed interpolation gives.
            expect([0.15, 0.85].some((expected) => Math.abs(choice.box.x - expected) < 1e-9)).toBe(true);
            expect(Math.abs(choice.box.x - 0.5)).toBeGreaterThan(0.3);
        });

        it('prefers a subset that brackets the frame over one that does not', () => {
            const keyframes = [
                // Brackets 150, but small.
                keyframe(100, { x: 0.10, y: 0.10, width: 0.05, height: 0.05 }, '1'),
                keyframe(200, { x: 0.20, y: 0.20, width: 0.05, height: 0.05 }, '1'),
                // Much larger, but the counted moment is not on this track.
                keyframe(800, { x: 0.90, y: 0.90, width: 0.40, height: 0.40 }, '2'),
            ];

            const choice = chooseBox(keyframes, 150);

            expect(choice.source).toBe('interpolated');
            expect(choice.subset).toBe('1');
        });
    });
});
