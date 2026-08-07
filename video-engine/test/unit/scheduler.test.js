/**
 * Unit tests for Scheduler's pure/mockable logic: frame-lookup math
 * (#_locateFrameIndex), lookahead/prefetch orchestration
 * (#_kickLookahead), and segment-state reporting (#getSegmentStates).
 *
 * Play/pause pacing and real seek races depend on requestAnimationFrame,
 * performance.now(), and real decoded segments, and are exercised instead
 * by the E2E suite against the real running engine.
 *
 * @fileoverview Unit tests for Scheduler's frame-locating, lookahead, and segment-state logic.
 * @author Isaac Travers
 * @module video-engine/test/unit/scheduler.test
 */

const { Scheduler } = require('../../src/scheduler.js');
const { FrameStore } = require('../../src/frame-store.js');

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

    test('uses segment-relative timeline when raw frame timestamps are offset from segment start time', () => {
        // Regression test for post-seek stutter: some streams expose per-
        // segment sample timestamps offset from playlist time (for
        // example, segment 41's decoded timestamps may still sit near
        // segment 40's range). Frame lookup must compare target time in
        // that segment's LOCAL timeline, not the stream-absolute target
        // value directly, or forward playback keeps landing on each
        // segment's edge frame.
        const scheduler = makeScheduler();
        const offsetBuffer = {
            frames: [{ timestamp: 120_080_000 }, { timestamp: 121_080_000 }, { timestamp: 122_080_000 }, { timestamp: 123_000_000 }],
        };

        // Segment metadata says this segment covers [123, 126). A target
        // at t=124 should land ~1s into this buffer (index 1), not on the
        // last frame (index 3).
        expect(scheduler._locateFrameIndex(offsetBuffer, 124.0, 'atOrBefore', 123.0)).toBe(1);
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
 * @param {Set<number>} [backoffIndices] - Segment indices isInBackoff() should report true for; empty by default so existing tests are unaffected.
 * @returns {Object} A fake FrameStore.
 */
function makeRecordingFrameStore(backoffIndices = new Set()) {
    return {
        ensuredIndices: [],
        prefetchedIndices: [],
        pinned: null,
        has: () => false,
        isInBackoff: (index) => backoffIndices.has(index),
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

    test('skips ensureSegment/prefetchRawBytes for segments currently in backoff', () => {
        // Regression test: _kickLookahead/_kickNetworkPrefetch run
        // unconditionally on every render-loop tick, so without this
        // check a segment that just failed would get an identical retry
        // attempt on every tick -- dozens of times a second -- instead of
        // waiting out FrameStore's backoff window.
        const frameStore = makeRecordingFrameStore(new Set([2, 8]));
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {} },
            emit: () => {},
        });
        scheduler.playbackRate = 8;

        scheduler._kickLookahead(0);

        // Decode range is 0-5, network-prefetch range is 6-19 (see the
        // tests above) -- segment 2 (in the decode range) and segment 8
        // (in the network range) are both in backoff and must be skipped.
        expect(frameStore.ensuredIndices).not.toContain(2);
        expect(frameStore.ensuredIndices).toEqual([0, 1, 3, 4, 5]);
        expect(frameStore.prefetchedIndices).not.toContain(8);
    });

    test('does not call emit("error", ...) itself when ensureSegment/prefetchRawBytes reject -- FrameStore reports failures, not the per-call site', async () => {
        // Regression test for a real duplicate-error-burst bug: this
        // method runs on every render-loop tick, so wrapping its
        // ensureSegment()/prefetchRawBytes() calls in their own
        // .catch((err) => emit('error', err)) meant every tick that ran
        // while a segment was still in flight attached ANOTHER rejection
        // handler to the same shared promise -- confirmed live as
        // hundreds of duplicate "error" events firing together the
        // instant one real 20-second decoder stall finally settled. Error
        // reporting now happens exactly once, from inside FrameStore
        // itself (see its onError), so this call site must swallow
        // rejections silently instead of re-reporting them.
        const emitSpy = jest.fn();
        const frameStore = {
            ensuredIndices: [],
            has: () => false,
            isInBackoff: () => false,
            ensureSegment: (index) => Promise.reject(new Error(`segment ${index} failed`)),
            prefetchRawBytes: (index) => Promise.reject(new Error(`segment ${index} failed`)),
            setPinned: () => {},
        };
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {} },
            emit: emitSpy,
        });
        scheduler.playbackRate = 8;

        scheduler._kickLookahead(0);
        // Let every rejected promise's microtask settle.
        await new Promise((resolve) => setImmediate(resolve));

        expect(emitSpy).not.toHaveBeenCalledWith('error', expect.anything());
    });
});

describe('Scheduler#getSegmentStates', () => {
    test('reports fetched/decoded/pinned per segment, independently of each other', () => {
        // Deliberately mixed states -- segment 1 is fetched but not
        // decoded (still just raw bytes), segment 2 is decoded but not
        // pinned (already evicted from the lookahead window), matching
        // real states a scrub-bar visualization needs to tell apart.
        const frameStore = {
            segmentFetcher: { hasRawBytes: (index) => index === 1 || index === 2 },
            has: (index) => index === 2,
            pinned: new Set([0]),
        };
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(3, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {} },
            emit: () => {},
        });

        expect(scheduler.getSegmentStates()).toEqual([
            { index: 0, startTime: 0, endTime: 3, fetched: false, decoded: false, pinned: true },
            { index: 1, startTime: 3, endTime: 6, fetched: true, decoded: false, pinned: false },
            { index: 2, startTime: 6, endTime: 9, fetched: true, decoded: true, pinned: false },
        ]);
    });
});

/**
 * Builds a fake FrameStore whose ensureSegment() never resolves on its
 * own -- it only settles when the test explicitly resolves/rejects a
 * captured call, or when the passed AbortSignal fires -- so a test can
 * assert exactly when Scheduler.seek() aborts a still-pending call
 * without needing a real fetch/demux/decode pipeline.
 *
 * @returns {{frameStore: Object, calls: Array<{index: number, signal: (AbortSignal|undefined), resolve: Function, reject: Function}>}} The fake FrameStore and the list of ensureSegment() calls it's received, in order, each with its own resolve/reject.
 */
function makeControllableFrameStore() {
    const calls = [];
    const frameStore = {
        buffers: new Map(),
        // Not exercised by these tests, but seek() now also calls
        // _kickLookahead() on success (see the "kicks off lookahead
        // immediately" describe block below) -- these no-op stubs just
        // keep that call from throwing here, since this suite's own
        // assertions only care about calls[]/the seek's own outcome.
        has: () => true,
        isInBackoff: () => false,
        setPinned: () => {},
        prefetchRawBytes: () => Promise.resolve(),
        ensureSegment(index, { signal } = {}) {
            return new Promise((resolve, reject) => {
                calls.push({ index, signal, resolve, reject });
                if (signal) {
                    signal.addEventListener('abort', () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                }
            });
        },
    };
    return { frameStore, calls };
}

describe('Scheduler#seek supersession', () => {
    test('a new seek() aborts the previous one\'s still-pending ensureSegment(), which abandons silently instead of throwing', async () => {
        // Regression test for the real "scrub-drag backlog" bug: every
        // seek() used to kick off an uncancellable ensureSegment() call,
        // so dragging over many segments before releasing queued real
        // fetch/decode work for every one of them. seek() must now cancel
        // its own previous call's want the instant a newer one starts.
        const { frameStore, calls } = makeControllableFrameStore();
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {}, render: () => true },
            emit: () => {},
        });

        const firstSeekPromise = scheduler.seek(10); // segment 3 ([9, 12))
        await Promise.resolve(); // let seek()'s microtasks run up to its ensureSegment() call
        expect(calls).toHaveLength(1);
        expect(calls[0].signal.aborted).toBe(false);

        const secondSeekPromise = scheduler.seek(50); // segment 16 ([48, 51)) -- supersedes the first
        await Promise.resolve();

        expect(calls[0].signal.aborted).toBe(true);
        // The superseded seek must resolve quietly, not reject/throw --
        // its own ensureSegment() rejected internally, but seek() catches
        // that specific (aborted) case and abandons rather than
        // propagating it as a real error.
        await expect(firstSeekPromise).resolves.toBeUndefined();

        // Let the second (real, current) seek's ensureSegment resolve
        // normally, and confirm it completes and applies its result.
        const gopBuffer = { frames: [{ timestamp: 50_000_000 }] };
        frameStore.buffers.set(calls[1].index, gopBuffer);
        calls[1].resolve(gopBuffer);
        await secondSeekPromise;

        expect(scheduler.currentSegmentIndex).toBe(calls[1].index);
    });

    test('two consecutive seeks landing in the SAME segment do not abort each other\'s shared fetch', async () => {
        // Regression test for a real bug the fix above introduced: seek()
        // used to release the previous seek's want BEFORE registering the
        // new one. When both seeks target the same segment (very likely
        // mid-drag, since many pointermove events land within one ~1-3s
        // segment), that ordering let the shared entry's wanter count
        // touch zero in between, aborting the fetch the new seek was
        // about to depend on -- confirmed live as a burst of spurious
        // "error" events during ordinary dragging. seek() must register
        // its own want first, so the shared entry's count never drops to
        // zero while still genuinely wanted.
        let capturedSignal = null;
        const frameStore = new FrameStore({
            segmentFetcher: {
                fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
                fetchSegment: (index, { signal } = {}) => {
                    capturedSignal = signal;
                    return new Promise(() => {}); // never resolves -- only test whether it gets aborted
                },
            },
            gopDecoder: {},
            width: 1920,
            height: 1080,
            fps: 30,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
        });
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 3),
            frameStore,
            canvasRenderer: { onFramePresented: () => {}, render: () => true },
            emit: () => {},
        });

        scheduler.seek(10.0); // segment 3
        await Promise.resolve();
        await Promise.resolve();
        const entry = frameStore._inFlight.get(3);
        expect(entry).toBeDefined();
        expect(capturedSignal.aborted).toBe(false);

        scheduler.seek(10.5); // still segment 3 ([9, 12)) -- same underlying fetch
        await Promise.resolve();
        await Promise.resolve();

        // The shared entry's fetch must still be alive -- both seeks want
        // segment 3, so releasing the first one's want must not have
        // dropped the count to zero.
        expect(capturedSignal.aborted).toBe(false);
        expect(frameStore._inFlight.get(3)).toBe(entry);
    });
});

/**
 * Builds a fake FrameStore whose ensureSegment() actually "succeeds" --
 * populating `buffers` with a minimal one-frame GopBuffer keyed by
 * segment index -- so a real Scheduler#seek() call can complete
 * end-to-end (render a frame, update currentSegmentIndex/currentFrameIdx),
 * while also recording every ensureSegment()/prefetchRawBytes() call so a
 * test can confirm which segments _kickLookahead() actually reached for.
 *
 * @param {number} segmentDurationSeconds - Nominal segment duration, used to synthesize each fake GopBuffer's single frame timestamp.
 * @returns {Object} A fake FrameStore usable with a real Scheduler#seek() call.
 */
function makeSeekableRecordingFrameStore(segmentDurationSeconds) {
    const buffers = new Map();
    const ensuredIndices = [];
    const prefetchedIndices = [];
    return {
        buffers,
        pinned: null,
        ensuredIndices,
        prefetchedIndices,
        has: (index) => buffers.has(index),
        isInBackoff: () => false,
        async ensureSegment(index) {
            ensuredIndices.push(index);
            if (!buffers.has(index)) {
                buffers.set(index, { frames: [{ timestamp: Math.round(index * segmentDurationSeconds * 1e6) }] });
            }
            return buffers.get(index);
        },
        prefetchRawBytes(index) {
            prefetchedIndices.push(index);
            return Promise.resolve();
        },
        setPinned(indices) {
            this.pinned = [...indices];
        },
    };
}

describe('Scheduler#seek kicks off lookahead immediately', () => {
    test('fetches the lookahead window right away, even while paused, not only once playback starts', async () => {
        // Regression test for a real, confirmed-live bug: _kickLookahead()
        // was only ever called from _tick(), which only runs while
        // scheduler.playing is true. Landing a seek while paused (a
        // completely ordinary workflow -- drag the scrub bar, release,
        // look at the frame, then decide to play) used to fetch only the
        // exact target segment and leave everything ahead of it
        // completely cold, causing a multi-second freeze the moment Play
        // was finally pressed, since the next segment's real network
        // fetch only started at that point instead of during however long
        // the player had already been sitting paused on the new position.
        // 1-second segments: the fake's synthesized frame timestamp is
        // always exactly the segment's own start (it has no way to know
        // where within the segment the real seek target landed), so a
        // segment duration comfortably smaller than LOOKAHEAD_SECONDS
        // (2.0) is needed to reliably span multiple segments regardless
        // of that simplification.
        const frameStore = makeSeekableRecordingFrameStore(1);
        const scheduler = new Scheduler({
            segmentIndex: makeUniformSegmentIndex(20, 1),
            frameStore,
            canvasRenderer: { onFramePresented: () => {}, render: () => true },
            emit: () => {},
        });
        expect(scheduler.playing).toBe(false);

        await scheduler.seek(0.5); // lands in segment 0 ([0, 1))

        // LOOKAHEAD_SECONDS (2.0) at the default 1x rate reaches to t=2.0
        // from segment 0's own start (0), i.e. segment 2 -- not just
        // segment 0, the exact seek target.
        expect(frameStore.ensuredIndices).toContain(0);
        expect(frameStore.ensuredIndices).toContain(1);
        expect(frameStore.ensuredIndices).toContain(2);
        expect(frameStore.pinned).toEqual([0, 1, 2]);
    });
});
