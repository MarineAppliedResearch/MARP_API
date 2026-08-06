/**
 * Decoded-frame LRU cache, at whole-segment granularity, plus the
 * fetch->demux->decode orchestration needed to fill it.
 *
 * Partial-GOP retention is pointless: decode is always forward-from-
 * keyframe, so evicting part of a segment's frames still requires a full
 * re-decode of that segment to get any of them back. Eviction therefore
 * always drops one whole segment's GopBuffer at a time, explicitly
 * close()-ing every VideoFrame it held (WebCodecs frames hold external
 * memory that ordinary GC won't reclaim promptly).
 *
 * @fileoverview Segment-granularity decoded-frame LRU cache and its fetch/demux/decode orchestration.
 * @author Isaac Travers
 * @module video-engine/frame-store
 */

import { demuxSegment } from './demuxer.js';

/** Uncompressed 8-bit 4:2:0: full-res Y plane plus quarter-res U/V planes. */
const BYTES_PER_PIXEL_420_8BIT = 1.5;

/** Default decoded-frame cache budget: 1 GiB. */
const DEFAULT_CACHE_BUDGET_BYTES = 1024 * 1024 * 1024;

/** Floor on buffered segments: current + one prefetch each direction. */
const MIN_SEGMENTS_BUFFERED = 3;

/**
 * Caches decoded segments (GopBuffers) with LRU eviction, and knows how
 * to produce one on demand.
 *
 * @class FrameStore
 */
export class FrameStore {
    /**
     * @param {Object} params
     * @param {Object} params.segmentFetcher - {@link module:video-engine/segment-fetcher.SegmentFetcher} instance.
     * @param {Object} params.gopDecoder - {@link module:video-engine/gop-decoder.GopDecoder} instance.
     * @param {number} params.width - Real negotiated video width, used to size the cache budget.
     * @param {number} params.height - Real negotiated video height, used to size the cache budget.
     * @param {number} params.fps - Real negotiated frame rate, used to size the cache budget.
     * @param {number} params.segmentDuration - Nominal segment duration in seconds.
     * @param {number} [params.cacheBudgetBytes] - Decoded-frame cache budget in bytes. Default 1 GiB.
     */
    constructor({ segmentFetcher, gopDecoder, width, height, fps, segmentDuration, cacheBudgetBytes }) {
        this.segmentFetcher = segmentFetcher;
        this.gopDecoder = gopDecoder;

        const bytesPerFrame = width * height * BYTES_PER_PIXEL_420_8BIT;
        const framesPerSegment = Math.ceil(segmentDuration * fps);
        const bytesPerSegment = bytesPerFrame * framesPerSegment;
        const budget = cacheBudgetBytes || DEFAULT_CACHE_BUDGET_BYTES;

        this.maxSegmentsBuffered = Math.max(MIN_SEGMENTS_BUFFERED, Math.floor(budget / bytesPerSegment));

        // segmentIndex -> GopBuffer, insertion order doubles as LRU order.
        this.buffers = new Map();
        this.pinned = new Set();
        this._inFlight = new Map(); // segmentIndex -> Promise<GopBuffer>
    }

    /**
     * Marks segments the scheduler's current lookahead window needs as
     * exempt from eviction.
     *
     * @param {Iterable<number>} indices - Segment indices to pin.
     * @returns {void}
     */
    setPinned(indices) {
        this.pinned = new Set(indices);
    }

    /**
     * Reports whether a segment is already decoded and cached.
     *
     * @param {number} segmentIndexNumber - Segment index to check.
     * @returns {boolean} True if cached.
     */
    has(segmentIndexNumber) {
        return this.buffers.has(segmentIndexNumber);
    }

    /**
     * Ensures a segment's frames are decoded and cached, fetching,
     * demuxing, and decoding it if not already present. Concurrent calls
     * for the same segment share one in-flight promise rather than
     * duplicating work.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index to ensure.
     * @returns {Promise<Object>} The segment's GopBuffer.
     */
    async ensureSegment(segmentIndexNumber) {
        if (this.buffers.has(segmentIndexNumber)) {
            this._touch(segmentIndexNumber);
            return this.buffers.get(segmentIndexNumber);
        }

        if (this._inFlight.has(segmentIndexNumber)) {
            return this._inFlight.get(segmentIndexNumber);
        }

        const promise = this._decode(segmentIndexNumber).finally(() => {
            this._inFlight.delete(segmentIndexNumber);
        });

        this._inFlight.set(segmentIndexNumber, promise);
        return promise;
    }

    /**
     * Fetches, demuxes, and decodes one segment, with a defensive
     * keyframe-merge fallback if Jellyfin's keyframe-alignment guarantee
     * is ever violated in practice.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index to decode.
     * @returns {Promise<Object>} The segment's GopBuffer.
     * @throws {Error} When segment 0 itself doesn't start with a keyframe (unrecoverable).
     */
    async _decode(segmentIndexNumber) {
        // Background lookahead/prefetch decode is otherwise invisible from
        // the outside -- a real fetch/decode in progress and a genuine
        // stall both just look like nothing is happening. Logging start
        // and completion here gives an at-a-glance answer to "is it still
        // working" without needing to add a debugger or guess.
        console.log(`[frame-store] segment ${segmentIndexNumber}: fetching...`);
        const initBuffer = await this.segmentFetcher.fetchInitSegment();
        const segmentBuffer = await this.segmentFetcher.fetchSegment(segmentIndexNumber);

        console.log(`[frame-store] segment ${segmentIndexNumber}: demuxing + decoding...`);
        let demuxResult = await demuxSegment(initBuffer, segmentBuffer);

        if (demuxResult.chunks.length === 0 || demuxResult.chunks[0].type !== 'key') {
            // Defensive fallback: this segment's first sample isn't a
            // keyframe, contrary to Jellyfin's BreakOnNonKeyFrames=False
            // guarantee. Merge in the previous segment's chunks so decode
            // has a real keyframe to start from, rather than corrupting
            // output or throwing on a healthy stream.
            if (segmentIndexNumber === 0) {
                throw new Error('First segment does not start with a keyframe -- cannot recover.');
            }

            const prevBuffer = await this.segmentFetcher.fetchSegment(segmentIndexNumber - 1);
            const prevDemux = await demuxSegment(initBuffer, prevBuffer);

            demuxResult = {
                codec: demuxResult.codec,
                description: demuxResult.description,
                chunks: [...prevDemux.chunks, ...demuxResult.chunks].sort((a, b) => a.timestamp - b.timestamp),
            };
        }

        const gopBuffer = await this.gopDecoder.decodeSegment(segmentIndexNumber, demuxResult);
        console.log(`[frame-store] segment ${segmentIndexNumber}: ready (${gopBuffer.frames.length} frames)`);

        this.buffers.set(segmentIndexNumber, gopBuffer);
        this._touch(segmentIndexNumber);
        this._evictIfNeeded();

        return gopBuffer;
    }

    /**
     * Marks a cached GopBuffer as most-recently-used by re-inserting it.
     *
     * @param {number} segmentIndexNumber - Segment index to bump.
     * @returns {void}
     */
    _touch(segmentIndexNumber) {
        const buffer = this.buffers.get(segmentIndexNumber);
        this.buffers.delete(segmentIndexNumber);
        this.buffers.set(segmentIndexNumber, buffer);
    }

    /**
     * Evicts least-recently-used, unpinned GopBuffers until the cache is
     * back within `maxSegmentsBuffered`, closing every evicted VideoFrame.
     *
     * @returns {void}
     */
    _evictIfNeeded() {
        if (this.buffers.size <= this.maxSegmentsBuffered) {
            return;
        }

        for (const [index, gopBuffer] of this.buffers) {
            if (this.buffers.size <= this.maxSegmentsBuffered) {
                break;
            }
            if (this.pinned.has(index)) {
                continue;
            }
            for (const frame of gopBuffer.frames) {
                frame.close();
            }
            this.buffers.delete(index);
        }
    }

    /**
     * Closes every cached VideoFrame and clears the cache. Called when
     * the engine is torn down.
     *
     * @returns {void}
     */
    close() {
        for (const gopBuffer of this.buffers.values()) {
            for (const frame of gopBuffer.frames) {
                frame.close();
            }
        }
        this.buffers.clear();
    }
}
