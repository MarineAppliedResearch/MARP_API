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

/**
 * Builds a FrameStore whose segmentFetcher.fetchSegment() never resolves
 * on its own -- only rejects if its signal fires -- so tests can inspect
 * whether ensureSegment()'s reference counting actually aborts the
 * underlying fetch, without needing demuxSegment()/gopDecoder to ever run.
 *
 * @returns {FrameStore} A FrameStore backed by a fake, never-resolving fetch.
 */
function makeFrameStoreWithPendingFetch() {
    return new FrameStore({
        segmentFetcher: {
            fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
            fetchSegment: (index, { signal } = {}) =>
                new Promise((resolve, reject) => {
                    const onAbort = () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    };
                    if (!signal) {
                        return;
                    }
                    // Matches the real fetchWithTimeout()'s own defensive
                    // check in segment-fetcher.js: the signal can already
                    // be aborted by the time this runs (ensureSegment's
                    // synchronous prefix sets up the AbortController before
                    // _decode() ever reaches this call, so an abort fired
                    // in that gap would otherwise never be observed --
                    // 'abort' is a one-time event, not a retroactive one).
                    if (signal.aborted) {
                        onAbort();
                    } else {
                        signal.addEventListener('abort', onAbort);
                    }
                }),
        },
        gopDecoder: {},
        width: 1920,
        height: 1080,
        fps: 30,
        segmentDuration: 3,
        cacheBudgetBytes: 1,
    });
}

describe('FrameStore.ensureSegment reference-counted cancellation', () => {
    test('aborts the underlying fetch once the only wanter releases before it resolves', async () => {
        // Regression test: Scheduler.seek() used to have no way to cancel
        // a stale segment's fetch, so scrubbing over N segments before
        // releasing queued real fetch/decode work for every one of them.
        const frameStore = makeFrameStoreWithPendingFetch();
        const controller = new AbortController();

        const promise = frameStore.ensureSegment(0, { signal: controller.signal });
        promise.catch(() => {}); // expected to reject once aborted below

        const entry = frameStore._inFlight.get(0);
        expect(entry.fetchAbortController.signal.aborted).toBe(false);

        controller.abort();

        expect(entry.fetchAbortController.signal.aborted).toBe(true);
        await expect(promise).rejects.toThrow();
    });

    test('does not abort the fetch while another caller (e.g. lookahead, no signal) still wants the same segment', async () => {
        const frameStore = makeFrameStoreWithPendingFetch();
        const controller = new AbortController();

        const seekPromise = frameStore.ensureSegment(0, { signal: controller.signal });
        seekPromise.catch(() => {});
        // No signal -- matches how _kickLookahead calls ensureSegment(),
        // a want that lasts as long as the request is in flight.
        const lookaheadPromise = frameStore.ensureSegment(0);

        const entry = frameStore._inFlight.get(0);
        controller.abort();

        expect(entry.fetchAbortController.signal.aborted).toBe(false);
        expect(frameStore._inFlight.get(0)).toBe(entry);

        void lookaheadPromise;
    });

    test('a later release against an already-superseded entry is harmless', async () => {
        // If segmentIndexNumber's entry was already replaced (e.g. the
        // request settled and a fresh one started), a delayed release
        // from an old signal must not reach into the new entry.
        const frameStore = makeFrameStoreWithPendingFetch();
        const controller = new AbortController();

        const promise = frameStore.ensureSegment(0, { signal: controller.signal });
        promise.catch(() => {});
        const firstEntry = frameStore._inFlight.get(0);

        // Simulate the entry having already moved on (e.g. removed after
        // settling) before this stale release fires.
        frameStore._inFlight.delete(0);

        expect(() => frameStore._releaseWanter(0, firstEntry)).not.toThrow();
        expect(firstEntry.fetchAbortController.signal.aborted).toBe(false);
    });
});

describe('FrameStore retry backoff', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /**
     * Builds a FrameStore whose segmentFetcher.fetchSegment() always
     * rejects with a real (non-abort) error -- for exercising the
     * failure/backoff bookkeeping without needing a real demux/decode
     * pipeline to run.
     *
     * @returns {FrameStore} A FrameStore backed by an always-failing fetch.
     */
    function makeFrameStoreWithFailingFetch() {
        return new FrameStore({
            segmentFetcher: {
                fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
                fetchSegment: () => Promise.reject(new Error('upstream 500')),
            },
            gopDecoder: {},
            width: 1920,
            height: 1080,
            fps: 30,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
        });
    }

    test('is not in backoff before any attempt', () => {
        const frameStore = makeFrameStoreWithFailingFetch();
        expect(frameStore.isInBackoff(0)).toBe(false);
    });

    test('a real failure enters backoff for INITIAL_RETRY_BACKOFF_MS (200ms)', async () => {
        // Regression test: the scheduler's lookahead/prefetch passes run
        // unconditionally on every render-loop tick (dozens of times a
        // second) -- without backoff, one transient failure (e.g. a
        // segment Jellyfin's transcoder hadn't finished generating yet)
        // got retried on every single tick, confirmed live as 70+ rapid
        // "error" events from what was really one passing condition.
        const frameStore = makeFrameStoreWithFailingFetch();

        await expect(frameStore.ensureSegment(5)).rejects.toThrow('upstream 500');

        expect(frameStore.isInBackoff(5)).toBe(true);
        jest.advanceTimersByTime(199);
        expect(frameStore.isInBackoff(5)).toBe(true);
        jest.advanceTimersByTime(2);
        expect(frameStore.isInBackoff(5)).toBe(false);
    });

    test('consecutive failures grow the backoff delay exponentially, capped at MAX_RETRY_BACKOFF_MS (8000ms)', async () => {
        const frameStore = makeFrameStoreWithFailingFetch();

        // 1st failure: 200ms. 2nd: 400ms. 3rd: 800ms.
        await expect(frameStore.ensureSegment(5)).rejects.toThrow();
        jest.advanceTimersByTime(200);
        await expect(frameStore.ensureSegment(5)).rejects.toThrow();
        jest.advanceTimersByTime(400);
        await expect(frameStore.ensureSegment(5)).rejects.toThrow();

        jest.advanceTimersByTime(799);
        expect(frameStore.isInBackoff(5)).toBe(true);
        jest.advanceTimersByTime(2);
        expect(frameStore.isInBackoff(5)).toBe(false);

        // Keep failing until the delay caps out, instead of growing forever.
        for (let i = 0; i < 10; i++) {
            await expect(frameStore.ensureSegment(5)).rejects.toThrow();
            jest.advanceTimersByTime(8000);
        }
        // One more failure right after the cap: still exactly 8000ms, not more.
        await expect(frameStore.ensureSegment(5)).rejects.toThrow();
        jest.advanceTimersByTime(7999);
        expect(frameStore.isInBackoff(5)).toBe(true);
        jest.advanceTimersByTime(2);
        expect(frameStore.isInBackoff(5)).toBe(false);
    });

    test('a success clears any existing backoff', async () => {
        const frameStore = makeFrameStoreWithFailingFetch();
        await expect(frameStore.ensureSegment(5)).rejects.toThrow();
        expect(frameStore.isInBackoff(5)).toBe(true);

        frameStore._recordOutcome(5, null);

        expect(frameStore.isInBackoff(5)).toBe(false);
    });

    test('a cancellation (AbortError) does not count as a failure', () => {
        const frameStore = makeFrameStoreWithFailingFetch();
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';

        frameStore._recordOutcome(5, abortErr);

        expect(frameStore.isInBackoff(5)).toBe(false);
    });
});

describe('FrameStore onDebug callback', () => {
    test('reports the real failure message when a segment fails, not just that something failed', async () => {
        // Directly addresses wanting more than a bare "event: error" --
        // the on-page log panel needs the actual reason (e.g. an upstream
        // 500, which segment, fetch vs decode) to tell one failure apart
        // from another.
        const messages = [];
        const frameStore = new FrameStore({
            segmentFetcher: {
                fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
                fetchSegment: () => Promise.reject(new Error('upstream 500')),
            },
            gopDecoder: {},
            width: 1920,
            height: 1080,
            fps: 30,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
            onDebug: (message) => messages.push(message),
        });

        await expect(frameStore.ensureSegment(9)).rejects.toThrow();

        expect(messages).toContainEqual(expect.stringMatching(/segment 9: fetching/));
        expect(messages).toContainEqual(expect.stringMatching(/segment 9: FAILED -- upstream 500/));
    });

    test('does not report a cancelled (superseded) request as a failure', async () => {
        const messages = [];
        const frameStore = new FrameStore({
            segmentFetcher: {
                fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
                fetchSegment: (index, { signal } = {}) =>
                    new Promise((resolve, reject) => {
                        const onAbort = () => {
                            const err = new Error('aborted');
                            err.name = 'AbortError';
                            reject(err);
                        };
                        // Same defensive check as the real fetchWithTimeout()
                        // in segment-fetcher.js: the signal can already be
                        // aborted by the time _decode() reaches this call
                        // (ensureSegment()'s synchronous prefix runs before
                        // _decode() gets here), and 'abort' never fires
                        // retroactively for a listener added after the fact.
                        if (signal.aborted) {
                            onAbort();
                        } else {
                            signal.addEventListener('abort', onAbort);
                        }
                    }),
            },
            gopDecoder: {},
            width: 1920,
            height: 1080,
            fps: 30,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
            onDebug: (message) => messages.push(message),
        });

        const controller = new AbortController();
        const promise = frameStore.ensureSegment(9, { signal: controller.signal });
        promise.catch(() => {});
        controller.abort();
        await promise.catch(() => {});

        expect(messages.some((m) => m.includes('FAILED'))).toBe(false);
    });
});

describe('FrameStore onError callback', () => {
    test('fires exactly once per real failure, even when many callers share the same in-flight request', async () => {
        // Regression test for the actual duplicate-error-burst bug: with
        // per-caller error reporting, a segment that stayed in flight for
        // a while (e.g. a 20-second decoder stall) got a fresh
        // ensureSegment() call -- and, in the old design, a fresh
        // rejection handler -- from every render-loop tick that ran
        // before it settled. onError must fire exactly once regardless of
        // how many times ensureSegment() was called against the same
        // still-pending entry.
        const errors = [];
        const frameStore = new FrameStore({
            segmentFetcher: {
                fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
                fetchSegment: () => Promise.reject(new Error('upstream 500')),
            },
            gopDecoder: {},
            width: 1920,
            height: 1080,
            fps: 30,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
            onError: (err) => errors.push(err),
        });

        // Simulates many ticks all calling ensureSegment() for the same
        // segment while the first attempt is still pending.
        const calls = Array.from({ length: 50 }, () => frameStore.ensureSegment(7).catch(() => {}));
        await Promise.all(calls);

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('upstream 500');
    });

    test('does not call onError for a cancelled (superseded) request', () => {
        const errors = [];
        const frameStore = new FrameStore({
            segmentFetcher: {},
            gopDecoder: {},
            width: 1920,
            height: 1080,
            fps: 30,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
            onError: (err) => errors.push(err),
        });
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';

        frameStore._recordOutcome(7, abortErr);

        expect(errors).toHaveLength(0);
    });
});
