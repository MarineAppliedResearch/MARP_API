/**
 * Unit tests for Scheduler#_locateFrameIndex -- the pure frame-lookup
 * math shared by every render-loop tick, step, and seek.
 *
 * Only this one method is covered here: the rest of Scheduler (play/pause
 * pacing, lookahead prefetch, seek races) depends on requestAnimationFrame,
 * performance.now(), and real decoded segments, and is exercised instead
 * by the E2E suite against the real running engine.
 *
 * @fileoverview Unit tests for Scheduler's frame-locating logic.
 * @author Isaac Travers
 * @module video-engine/test/unit/scheduler.test
 */

const { Scheduler } = require('../../src/scheduler.js');

/**
 * Builds a Scheduler with the minimal fakes its constructor needs, none of
 * which are exercised by the pure frame-locating logic under test here.
 *
 * @returns {Scheduler} A Scheduler instance safe to call `_locateFrameIndex` on.
 */
function makeScheduler() {
    return new Scheduler({
        segmentIndex: { totalDuration: 0, segments: [] },
        frameStore: { buffers: new Map() },
        canvasRenderer: { onFramePresented: () => {}, canvas: { width: 0, height: 0 } },
        emit: () => {},
    });
}

describe('Scheduler#_locateFrameIndex', () => {
    // Whole-microsecond timestamps, matching how the real demuxer always
    // stores them (see demuxer.js's Math.round(... * 1e6)).
    const gopBuffer = {
        frames: [{ timestamp: 0 }, { timestamp: 1_000_000 }, { timestamp: 2_000_000 }],
    };

    test('atOrBefore lands on the exact frame when the target matches a timestamp exactly', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.0, 'atOrBefore')).toBe(1);
    });

    test('atOrBefore lands on the earlier frame when the target falls between two frames', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.5, 'atOrBefore')).toBe(1);
    });

    test('atOrAfter lands on the exact frame when the target matches a timestamp exactly', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.0, 'atOrAfter')).toBe(1);
    });

    test('atOrAfter lands on the later frame when the target falls between two frames', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.5, 'atOrAfter')).toBe(2);
    });

    test('atOrAfter is not thrown off by a sub-microsecond float overshoot past an exact frame timestamp', () => {
        // Regression guard: repeated +-1/fps arithmetic on targetTimeSeconds
        // can leave it a fraction of a microsecond past an exact frame
        // timestamp -- harmless for atOrBefore, but silently breaks a
        // naive atOrAfter ('>=') comparison exactly on the target frame.
        const scheduler = makeScheduler();
        const justPastOneSecond = 1.0000000004;
        expect(scheduler._locateFrameIndex(gopBuffer, justPastOneSecond, 'atOrAfter')).toBe(1);
    });
});

/**
 * Builds a uniform SegmentIndex of `count` segments, each `duration`
 * seconds long -- enough for _kickLookahead's lookahead/network windows
 * to span several segments at a high |playbackRate|.
 *
 * @param {number} count - Number of segments.
 * @param {number} duration - Duration of each segment, in seconds.
 * @returns {Object} A SegmentIndex, matching playlist-manager.js's shape.
 */
function makeUniformSegmentIndex(count, duration) {
    const segments = Array.from({ length: count }, (_, index) => ({
        index,
        startTime: index * duration,
        endTime: (index + 1) * duration,
        duration,
    }));
    return { segments, totalDuration: count * duration };
}

/**
 * Builds a fake FrameStore that records every ensureSegment/prefetchRawBytes
 * call and the most recent setPinned() call, with has() always false so
 * _kickLookahead always attempts to ensure/prefetch every segment in range.
 *
 * @returns {Object} A fake FrameStore.
 */
function makeRecordingFrameStore() {
    return {
        ensuredIndices: [],
        prefetchedIndices: [],
        pinned: null,
        has: () => false,
        ensureSegment(index) {
            this.ensuredIndices.push(index);
            return Promise.resolve();
        },
        prefetchRawBytes(index) {
            this.prefetchedIndices.push(index);
            return Promise.resolve();
        },
        setPinned(indices) {
            this.pinned = [...indices];
        },
    };
}

describe('Scheduler#_kickLookahead', () => {
    test('forward: ensures and pins every segment between current and the lookahead edge, not just the endpoints', () => {
        // Regression test: at 8x forward, the 2s (at 1x) lookahead window
        // scales to 16s, spanning segments 0 through 5 at 3s/segment --
        // the original bug only ensured/pinned segment 0 and segment 5,
        // leaving 1-4 an unpinned, un-decoded gap.
        const frameStore = makeRecordingFrameStore();
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {} },
            emit: () => {},
        });
        scheduler.playbackRate = 8;

        scheduler._kickLookahead(0);

        expect(frameStore.pinned).toEqual([0, 1, 2, 3, 4, 5]);
        expect(frameStore.ensuredIndices).toEqual([0, 1, 2, 3, 4, 5]);
    });

    test('reverse: ensures and pins every segment between one before the reverse-margin edge and the current segment', () => {
        const frameStore = makeRecordingFrameStore();
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {} },
            emit: () => {},
        });
        scheduler.playbackRate = -8;

        // t=20 is segment 6 ([18, 21)); the 0.5s*8=4s reverse margin lands
        // at t=16, segment 5 ([15, 18)) -- one segment earlier is 4.
        scheduler._kickLookahead(20);

        expect(frameStore.pinned).toEqual([4, 5, 6]);
        expect(frameStore.ensuredIndices).toEqual([4, 5, 6]);
    });

    test('forward: prefetches raw bytes only (no decode) for the wider network radius beyond the decode range', () => {
        const frameStore = makeRecordingFrameStore();
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {} },
            emit: () => {},
        });
        scheduler.playbackRate = 8;

        scheduler._kickLookahead(0);

        // Decode range covers 0-5 (see the forward lookahead test above);
        // the network-only radius (8s at 1x * 8 = 64s, clamped to the
        // 60s stream) extends to the last segment, 19 -- none of 6-19
        // should have gone through ensureSegment (decode), only prefetchRawBytes.
        expect(frameStore.prefetchedIndices).toEqual(Array.from({ length: 14 }, (_, i) => i + 6));
        expect(frameStore.ensuredIndices).not.toContain(6);
    });
});
