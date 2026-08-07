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
        // a request at all -- FrameStore's reference-counted wanters
        // (ensureSegment()) depend on this to actually free bandwidth when
        // a scrub-drag abandons a segment before its fetch finishes.
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
