/**
 * Unit tests for SegmentFetcher#hasRawBytes -- the raw-bytes-cached check
 * getSegmentStates() relies on for scrub-bar visualization. Mocks the
 * global fetch() (available natively in the Node version this project
 * targets) rather than hitting a real server, since only the cache-status
 * bookkeeping is under test here, not real network behavior.
 *
 * @fileoverview Unit tests for SegmentFetcher's raw-bytes cache status.
 * @author Isaac Travers
 * @module video-engine/test/unit/segment-fetcher.test
 */

const { SegmentFetcher } = require('../../src/segment-fetcher.js');

const SEGMENT_INDEX = {
    initSegmentUrl: 'https://jellyfin.example.com/videos/init.mp4',
    segments: [
        { index: 0, url: 'https://jellyfin.example.com/videos/seg0.m4s', duration: 3, startTime: 0, endTime: 3 },
        { index: 1, url: 'https://jellyfin.example.com/videos/seg1.m4s', duration: 3, startTime: 3, endTime: 6 },
    ],
};

let previousFetch;

beforeEach(() => {
    previousFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
});

afterEach(() => {
    global.fetch = previousFetch;
});

describe('SegmentFetcher#fetchSegment abort signal', () => {
    test('rejects with AbortError when the passed signal fires before the fetch resolves', async () => {
        // Regression test: fetchSegment() used to accept no way to cancel
        // a request at all -- SegmentFetcher's own reference-counted
        // wanters (ensureRawBytes()) depend on this to actually free
        // bandwidth when a scrub-drag abandons a segment before its fetch finishes.
        global.fetch = jest.fn(
            (url, { signal }) =>
                new Promise((resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                })
        );

        const fetcher = new SegmentFetcher(SEGMENT_INDEX);
        const controller = new AbortController();

        const promise = fetcher.fetchSegment(0, { signal: controller.signal });
        controller.abort();

        await expect(promise).rejects.toThrow(/aborted/i);
    });

    test('a real (non-aborted) fetch still resolves normally when a signal is passed but never fires', async () => {
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);
        const controller = new AbortController();

        const buffer = await fetcher.fetchSegment(0, { signal: controller.signal });

        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect(fetcher.hasRawBytes(0)).toBe(true);
    });
});

describe('SegmentFetcher#hasRawBytes', () => {
    test('is false before a segment is fetched, true after', async () => {
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);

        expect(fetcher.hasRawBytes(0)).toBe(false);
        expect(fetcher.hasRawBytes(1)).toBe(false);

        await fetcher.fetchSegment(0);

        expect(fetcher.hasRawBytes(0)).toBe(true);
        expect(fetcher.hasRawBytes(1)).toBe(false);
    });

    test('does not consider the init segment a media segment', async () => {
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);
        await fetcher.fetchInitSegment();

        expect(fetcher.hasRawBytes(0)).toBe(false);
    });
});

describe('SegmentFetcher#getCachedRawBytes', () => {
    test('returns cached bytes without fetching, and throws when nothing is cached', async () => {
        // Tier 2 (frame-store.js) is only allowed to read raw bytes through
        // this accessor, never fetchSegment() -- it must never trigger a
        // network fetch, even via a race between its own hasRawBytes()
        // check and the next call.
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);

        expect(() => fetcher.getCachedRawBytes(0)).toThrow(/not cached/);

        await fetcher.fetchSegment(0);
        const fetchCallsBefore = global.fetch.mock.calls.length;

        const buffer = fetcher.getCachedRawBytes(0);

        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect(global.fetch.mock.calls.length).toBe(fetchCallsBefore);
    });
});

describe('SegmentFetcher#ensureRawBytes reference-counted cancellation', () => {
    /**
     * Makes global.fetch() hang until its AbortSignal fires, so tests can
     * inspect whether ensureRawBytes()'s reference counting actually
     * cancels the underlying request.
     *
     * @returns {void}
     */
    function makeFetchHangUntilAborted() {
        global.fetch = jest.fn(
            (url, { signal }) =>
                new Promise((resolve, reject) => {
                    const onAbort = () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    };
                    if (signal.aborted) {
                        onAbort();
                    } else {
                        signal.addEventListener('abort', onAbort);
                    }
                })
        );
    }

    test('aborts the underlying fetch once the only wanter releases before it resolves', async () => {
        // Regression test: Scheduler.seek() needs a way to cancel a stale
        // segment's raw-byte fetch, so scrubbing over N segments doesn't
        // queue N uncancellable real fetches.
        makeFetchHangUntilAborted();
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);
        const controller = new AbortController();

        const promise = fetcher.ensureRawBytes(0, { signal: controller.signal });
        promise.catch(() => {});

        const entry = fetcher._inFlightFetches.get(0);
        expect(entry.abortController.signal.aborted).toBe(false);

        controller.abort();

        expect(entry.abortController.signal.aborted).toBe(true);
        await expect(promise).rejects.toThrow();
    });

    test('does not abort the fetch while another caller (e.g. opportunistic prefetch, no signal) still wants the same segment', async () => {
        makeFetchHangUntilAborted();
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);
        const controller = new AbortController();

        const seekPromise = fetcher.ensureRawBytes(0, { signal: controller.signal });
        seekPromise.catch(() => {});
        // No signal -- matches how the scheduler's cache pass calls
        // ensureRawBytes(), a want that lasts as long as the request is in flight.
        const prefetchPromise = fetcher.ensureRawBytes(0);

        const entry = fetcher._inFlightFetches.get(0);
        controller.abort();

        expect(entry.abortController.signal.aborted).toBe(false);
        expect(fetcher._inFlightFetches.get(0)).toBe(entry);

        void prefetchPromise;
    });

    test('serves cached bytes without starting a new fetch when already cached', async () => {
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);
        await fetcher.fetchSegment(0);
        const fetchCallsBefore = global.fetch.mock.calls.length;

        const buffer = await fetcher.ensureRawBytes(0);

        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect(global.fetch.mock.calls.length).toBe(fetchCallsBefore);
    });
});

describe('SegmentFetcher fetch retry backoff', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('a real failure enters backoff, a success clears it, and a cancellation does not count as a failure', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('upstream 500')));
        const fetcher = new SegmentFetcher(SEGMENT_INDEX);

        expect(fetcher.isFetchInBackoff(0)).toBe(false);

        await expect(fetcher.ensureRawBytes(0)).rejects.toThrow('upstream 500');
        expect(fetcher.isFetchInBackoff(0)).toBe(true);

        jest.advanceTimersByTime(199);
        expect(fetcher.isFetchInBackoff(0)).toBe(true);
        jest.advanceTimersByTime(2);
        expect(fetcher.isFetchInBackoff(0)).toBe(false);

        fetcher._recordFetchOutcome(0, new Error('boom'));
        expect(fetcher.isFetchInBackoff(0)).toBe(true);
        fetcher._recordFetchOutcome(0, null);
        expect(fetcher.isFetchInBackoff(0)).toBe(false);

        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        fetcher._recordFetchOutcome(0, abortErr);
        expect(fetcher.isFetchInBackoff(0)).toBe(false);
    });
});

describe('SegmentFetcher onError callback', () => {
    test('fires exactly once per real failure, even when many callers share the same in-flight request', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('upstream 500')));
        const errors = [];
        const fetcher = new SegmentFetcher(SEGMENT_INDEX, { onError: (err) => errors.push(err) });

        const calls = Array.from({ length: 20 }, () => fetcher.ensureRawBytes(0).catch(() => {}));
        await Promise.all(calls);

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('upstream 500');
    });
});
