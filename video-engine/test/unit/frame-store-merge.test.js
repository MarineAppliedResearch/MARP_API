/**
 * Regression tests for merged-segment decode continuity handling.
 *
 * @fileoverview Tests that continuity-merge frames are trimmed back out of the cached segment buffer.
 */

jest.mock('../../src/demuxer.js', () => ({
    demuxSegment: jest.fn(),
}));

const { demuxSegment } = require('../../src/demuxer.js');
const { FrameStore } = require('../../src/frame-store.js');

describe('FrameStore continuity merge trimming', () => {
    test('retains only the current segment frames after merging previous-segment chunks for decode continuity', async () => {
        const segmentIndex = {
            initSegmentUrl: 'https://example.invalid/init.mp4',
            segments: [
                { index: 0, url: 'https://example.invalid/0.m4s', startTime: 0, endTime: 3, duration: 3 },
                { index: 1, url: 'https://example.invalid/1.m4s', startTime: 3, endTime: 6, duration: 3 },
            ],
        };

        const segmentFetcher = {
            segmentIndex,
            fetchInitSegment: () => Promise.resolve(new ArrayBuffer(8)),
            hasRawBytes: () => true,
            getCachedRawBytes: jest.fn(() => new ArrayBuffer(8)),
            // The continuity-merge fallback is the one place Tier 2 fetches
            // raw bytes directly (the previous segment's, needed to make
            // decode possible at all) -- see frame-store.js's module doc.
            ensureRawBytes: jest.fn(() => Promise.resolve(new ArrayBuffer(8))),
        };

        const gopDecoder = {
            decodeSegment: jest.fn(() =>
                Promise.resolve({
                    segmentIndex: 1,
                    frames: [
                        { timestamp: 80_000 },
                        { timestamp: 1_080_000 },
                        { timestamp: 3_080_000 },
                        { timestamp: 4_080_000 },
                    ],
                })
            ),
        };

        // First demux call is the current segment.
        // It starts on a delta frame, so FrameStore will merge prev.
        demuxSegment
            .mockResolvedValueOnce({
                codec: 'avc1.test',
                description: null,
                chunks: [
                    { type: 'delta', timestamp: 3_080_000, duration: 40_000, data: new Uint8Array([1]) },
                    { type: 'delta', timestamp: 4_080_000, duration: 40_000, data: new Uint8Array([2]) },
                ],
            })
            .mockResolvedValueOnce({
                codec: 'avc1.test',
                description: null,
                chunks: [
                    { type: 'key', timestamp: 80_000, duration: 40_000, data: new Uint8Array([3]) },
                    { type: 'delta', timestamp: 1_080_000, duration: 40_000, data: new Uint8Array([4]) },
                ],
            });

        const frameStore = new FrameStore({
            segmentFetcher,
            gopDecoder,
            width: 1280,
            height: 720,
            fps: 25,
            segmentDuration: 3,
            cacheBudgetBytes: 1,
        });

        const gopBuffer = await frameStore.ensureDecoded(1);

        expect(demuxSegment).toHaveBeenCalledTimes(2);
        expect(segmentFetcher.ensureRawBytes).toHaveBeenCalledWith(0);
        expect(gopBuffer.frames.map((frame) => frame.timestamp)).toEqual([3_080_000, 4_080_000]);
        expect(frameStore.buffers.get(1).frames.map((frame) => frame.timestamp)).toEqual([3_080_000, 4_080_000]);
    });
});