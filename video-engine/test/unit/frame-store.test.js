/**
 * Unit tests for FrameStore's segment-granularity LRU eviction and
 * pinning logic.
 *
 * Exercises `buffers`/`pinned`/`_evictIfNeeded`/`_touch` directly with
 * fake GopBuffers rather than going through `ensureSegment()`'s real
 * fetch/demux/decode pipeline (segment-fetcher.js and demuxer.js are
 * network/mp4box-dependent and covered instead by the E2E suite) -- the
 * eviction/pinning bookkeeping under test here is independent of how a
 * GopBuffer was produced.
 *
 * @fileoverview Unit tests for FrameStore's LRU eviction and pinning.
 * @author Isaac Travers
 * @module video-engine/test/unit/frame-store.test
 */

const { FrameStore } = require('../../src/frame-store.js');

/**
 * Builds a FrameStore with a tiny cache budget so maxSegmentsBuffered
 * always lands on the MIN_SEGMENTS_BUFFERED floor (3) regardless of the
 * nominal width/height/fps -- keeps eviction thresholds deterministic
 * without needing to know the module's private budget formula exactly.
 *
 * @returns {FrameStore} A FrameStore instance with maxSegmentsBuffered pinned to 3.
 */
function makeFrameStore() {
    return new FrameStore({
        segmentFetcher: {},
        gopDecoder: {},
        width: 1920,
        height: 1080,
        fps: 30,
        segmentDuration: 3,
        cacheBudgetBytes: 1,
    });
}

/**
 * Builds a fake GopBuffer with `count` frames, each carrying a jest.fn()
 * spy in place of a real VideoFrame's close(), so eviction tests can
 * assert exactly which segments got their frames closed.
 *
 * @param {number} count - Number of fake frames to include.
 * @returns {{frames: Array<{close: jest.Mock}>}} A fake GopBuffer.
 */
function makeGopBuffer(count) {
    return { frames: Array.from({ length: count }, () => ({ close: jest.fn() })) };
}

describe('FrameStore eviction', () => {
    test('evicts least-recently-inserted unpinned segments first, closing every frame they held', () => {
        const frameStore = makeFrameStore();
        const buffers = { 0: makeGopBuffer(2), 1: makeGopBuffer(2), 2: makeGopBuffer(2), 3: makeGopBuffer(2), 4: makeGopBuffer(2) };

        for (let i = 0; i <= 4; i++) {
            frameStore.buffers.set(i, buffers[i]);
        }
        frameStore.setPinned([2]);

        frameStore._evictIfNeeded();

        expect([...frameStore.buffers.keys()]).toEqual([2, 3, 4]);
        buffers[0].frames.forEach((frame) => expect(frame.close).toHaveBeenCalledTimes(1));
        buffers[1].frames.forEach((frame) => expect(frame.close).toHaveBeenCalledTimes(1));
        buffers[3].frames.forEach((frame) => expect(frame.close).not.toHaveBeenCalled());
        buffers[4].frames.forEach((frame) => expect(frame.close).not.toHaveBeenCalled());
    });

    test('never evicts a pinned segment even when the cache is over budget', () => {
        const frameStore = makeFrameStore();
        const buffers = { 0: makeGopBuffer(1), 1: makeGopBuffer(1), 2: makeGopBuffer(1), 3: makeGopBuffer(1), 4: makeGopBuffer(1) };

        for (let i = 0; i <= 4; i++) {
            frameStore.buffers.set(i, buffers[i]);
        }
        frameStore.setPinned([0, 1, 2, 3, 4]);

        frameStore._evictIfNeeded();

        expect(frameStore.buffers.size).toBe(5);
        Object.values(buffers).forEach((gopBuffer) => gopBuffer.frames.forEach((frame) => expect(frame.close).not.toHaveBeenCalled()));
    });

    test('_touch re-inserts a segment as most-recently-used, protecting it from the next eviction pass', () => {
        const frameStore = makeFrameStore();
        const buffers = { 0: makeGopBuffer(1), 1: makeGopBuffer(1), 2: makeGopBuffer(1), 3: makeGopBuffer(1), 4: makeGopBuffer(1) };

        for (let i = 0; i <= 4; i++) {
            frameStore.buffers.set(i, buffers[i]);
        }
        // Touching segment 0 moves it to the end of Map iteration order,
        // so it should survive this eviction pass instead of being the
        // first thing dropped.
        frameStore._touch(0);

        frameStore._evictIfNeeded();

        expect([...frameStore.buffers.keys()]).toEqual([3, 4, 0]);
    });
});
