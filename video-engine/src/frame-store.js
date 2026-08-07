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

/** Backoff delay before the first automatic retry of a segment that just failed, in ms. */
const INITIAL_RETRY_BACKOFF_MS = 200;

/** Ceiling on backoff delay, however many consecutive failures a segment has had, in ms. */
const MAX_RETRY_BACKOFF_MS = 8000;

/** Backoff grows by this factor after each consecutive failure, until MAX_RETRY_BACKOFF_MS. */
const RETRY_BACKOFF_MULTIPLIER = 2;

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
     * @param {function(string): void} [params.onDebug] - Called with the same fetch/decode progress messages this class already logs to the console -- lets a consumer (e.g. the test harness's on-page log panel) surface them without needing DevTools open.
     * @param {function(Error): void} [params.onError] - Called exactly once per real (non-cancelled) segment failure, regardless of how many callers (lookahead, network-prefetch, the render loop) share the same in-flight request -- see ensureSegment()'s own doc comment for why per-caller error reporting used to fire many duplicate times for a single failure.
     */
    constructor({ segmentFetcher, gopDecoder, width, height, fps, segmentDuration, cacheBudgetBytes, onDebug, onError }) {
        this.segmentFetcher = segmentFetcher;
        this.gopDecoder = gopDecoder;
        this.onDebug = onDebug;
        this.onError = onError;

        const bytesPerFrame = width * height * BYTES_PER_PIXEL_420_8BIT;
        const framesPerSegment = Math.ceil(segmentDuration * fps);
        const bytesPerSegment = bytesPerFrame * framesPerSegment;
        const budget = cacheBudgetBytes || DEFAULT_CACHE_BUDGET_BYTES;

        this.maxSegmentsBuffered = Math.max(MIN_SEGMENTS_BUFFERED, Math.floor(budget / bytesPerSegment));

        // segmentIndex -> GopBuffer, insertion order doubles as LRU order.
        this.buffers = new Map();
        this.pinned = new Set();
        this._inFlight = new Map(); // segmentIndex -> {promise, wanterCount, fetchAbortController}

        // segmentIndex -> {nextAttemptAtMs, delayMs} -- tracks a segment
        // that failed (not merely got cancelled) recently, so the
        // scheduler's automatic lookahead/prefetch passes (which run
        // unconditionally on every render-loop tick) can skip retrying it
        // until the backoff window elapses, rather than hammering a
        // transient failure (e.g. Jellyfin's transcoder not having
        // generated that segment yet) dozens of times a second. A
        // deliberate, explicit seek() to that same segment is NOT gated
        // by this -- only the passive, automatic retry paths are.
        this._retryBackoff = new Map();
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
     * Logs a fetch/decode progress or failure message to the console and,
     * if supplied, to the `onDebug` callback -- the latter lets a
     * consumer (e.g. the test harness's on-page log panel) see exactly
     * which segment is being fetched/decoded/failed without needing
     * DevTools open.
     *
     * @param {string} message - Message text, without the "[frame-store]" prefix (added here).
     * @returns {void}
     */
    _logDebug(message) {
        const prefixed = `[frame-store] ${message}`;
        console.log(prefixed);
        if (this.onDebug) {
            this.onDebug(prefixed);
        }
    }

    /**
     * Reports whether a segment failed recently enough that automatic
     * retry passes (lookahead/network-prefetch) should skip it until its
     * backoff window elapses -- an explicit seek() to this same segment
     * is NOT gated by this, since that's a deliberate request the caller
     * wants attempted right away regardless of recent failures.
     *
     * @param {number} segmentIndexNumber - Segment index to check.
     * @returns {boolean} True if a recent failure's backoff window hasn't elapsed yet.
     */
    isInBackoff(segmentIndexNumber) {
        const backoff = this._retryBackoff.get(segmentIndexNumber);
        return !!backoff && Date.now() < backoff.nextAttemptAtMs;
    }

    /**
     * Records a segment's fetch/decode outcome for backoff purposes: a
     * real failure grows that segment's backoff delay (exponentially, up
     * to MAX_RETRY_BACKOFF_MS); a success clears it entirely. A
     * cancellation (this segment's fetch was aborted because nothing
     * wants it anymore) is deliberately NOT treated as a failure -- it
     * says nothing about whether the segment is actually fetchable.
     *
     * @param {number} segmentIndexNumber - Segment index the outcome applies to.
     * @param {(Error|null)} err - The rejection reason, or null on success.
     * @returns {void}
     */
    _recordOutcome(segmentIndexNumber, err) {
        if (!err) {
            this._retryBackoff.delete(segmentIndexNumber);
            return;
        }
        if (err.name === 'AbortError') {
            return; // cancelled, not a real failure -- leave any existing backoff as-is
        }

        const previous = this._retryBackoff.get(segmentIndexNumber);
        const delayMs = previous ? Math.min(MAX_RETRY_BACKOFF_MS, previous.delayMs * RETRY_BACKOFF_MULTIPLIER) : INITIAL_RETRY_BACKOFF_MS;
        this._retryBackoff.set(segmentIndexNumber, { nextAttemptAtMs: Date.now() + delayMs, delayMs });

        // Reported from here, exactly once per real failure, rather than
        // by each caller wrapping its own ensureSegment()/prefetchRawBytes()
        // call in a .catch(). Confirmed live that per-caller reporting
        // fires once per caller sharing the same in-flight request -- a
        // 20-second decoder stall, retried by both the render loop and
        // lookahead on every tick before it finally settled, produced
        // hundreds of duplicate "error" events for what was really one
        // failure. _recordOutcome() only ever runs once per entry
        // (created once per distinct decode attempt), so this is the
        // correct single point to report from.
        if (this.onError) {
            this.onError(err);
        }
    }

    /**
     * Ensures a segment's frames are decoded and cached, fetching,
     * demuxing, and decoding it if not already present. Concurrent calls
     * for the same segment share one in-flight promise rather than
     * duplicating work.
     *
     * Callers that only transiently want a segment (chiefly Scheduler.seek(),
     * which calls this again for a new target on every drag movement) can
     * pass `signal` to release their want when it fires -- if no other
     * caller (e.g. the lookahead prefetcher, which never passes a signal)
     * still wants this segment, its underlying fetch is cancelled
     * immediately rather than completing uselessly. Confirmed live this is
     * the real fix for a "backlog": every segment scrubbed over during a
     * drag used to kick off a real, uncancellable fetch+decode regardless
     * of whether the drag had already moved on.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index to ensure.
     * @param {Object} [options]
     * @param {AbortSignal} [options.signal] - Releases this specific call's "want" when it fires; the underlying fetch is only actually cancelled once every wanter has released.
     * @returns {Promise<Object>} The segment's GopBuffer.
     */
    async ensureSegment(segmentIndexNumber, { signal } = {}) {
        if (this.buffers.has(segmentIndexNumber)) {
            this._touch(segmentIndexNumber);
            return this.buffers.get(segmentIndexNumber);
        }

        let entry = this._inFlight.get(segmentIndexNumber);
        if (!entry) {
            const fetchAbortController = new AbortController();
            const promise = this._decode(segmentIndexNumber, fetchAbortController.signal)
                .then(
                    (result) => {
                        this._recordOutcome(segmentIndexNumber, null);
                        return result;
                    },
                    (err) => {
                        this._recordOutcome(segmentIndexNumber, err);
                        if (err.name !== 'AbortError') {
                            this._logDebug(`segment ${segmentIndexNumber}: FAILED -- ${err.message}`);
                        }
                        throw err;
                    }
                )
                .finally(() => {
                    this._inFlight.delete(segmentIndexNumber);
                });
            entry = { promise, wanterCount: 0, fetchAbortController };
            this._inFlight.set(segmentIndexNumber, entry);
        }

        entry.wanterCount += 1;
        if (signal) {
            const release = () => this._releaseWanter(segmentIndexNumber, entry);
            if (signal.aborted) {
                release();
            } else {
                signal.addEventListener('abort', release, { once: true });
            }
        }

        return entry.promise;
    }

    /**
     * Releases one caller's "want" on an in-flight segment request,
     * cancelling its underlying fetch if that was the last remaining
     * wanter and it hasn't resolved yet -- a no-op otherwise (e.g. if the
     * lookahead prefetcher still wants the same segment a transient seek
     * abandoned, or if the request already settled).
     *
     * @param {number} segmentIndexNumber - Segment index whose want is being released.
     * @param {Object} entry - The `_inFlight` entry this release applies to (captured at call time, so a stale release against an already-superseded entry is harmless).
     * @returns {void}
     */
    _releaseWanter(segmentIndexNumber, entry) {
        entry.wanterCount -= 1;
        if (entry.wanterCount <= 0 && this._inFlight.get(segmentIndexNumber) === entry) {
            entry.fetchAbortController.abort();
        }
    }

    /**
     * Fetches (and caches) a segment's raw bytes only, without demuxing
     * or decoding it -- used for a wider, network-only prefetch pass
     * beyond the decode lookahead radius, so a slow network has already
     * fetched a segment's bytes into SegmentFetcher's raw-bytes cache by
     * the time decode is ready to consume it, rather than only starting
     * that fetch once decode catches up and asks for it.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index to prefetch raw bytes for.
     * @returns {Promise<void>}
     */
    async prefetchRawBytes(segmentIndexNumber) {
        try {
            await this.segmentFetcher.fetchInitSegment();
            await this.segmentFetcher.fetchSegment(segmentIndexNumber);
            // Shares ensureSegment()'s backoff state (same segmentIndexNumber
            // key) -- a segment failing to fetch here is the same
            // underlying failure ensureSegment() would hit, so they should
            // back off together rather than each independently hammering
            // the same broken/not-yet-ready segment.
            this._recordOutcome(segmentIndexNumber, null);
        } catch (err) {
            this._recordOutcome(segmentIndexNumber, err);
            throw err;
        }
    }

    /**
     * Fetches, demuxes, and decodes one segment, with a defensive
     * keyframe-merge fallback if Jellyfin's keyframe-alignment guarantee
     * is ever violated in practice.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index to decode.
     * @param {AbortSignal} [fetchSignal] - Cancels the raw-bytes fetch if every wanter releases before it resolves (see ensureSegment()); has no effect once the fetch has already completed (decode itself is never aborted here).
     * @returns {Promise<Object>} The segment's GopBuffer.
     * @throws {Error} When segment 0 itself doesn't start with a keyframe (unrecoverable).
     */
    async _decode(segmentIndexNumber, fetchSignal) {
        // Background lookahead/prefetch decode is otherwise invisible from
        // the outside -- a real fetch/decode in progress and a genuine
        // stall both just look like nothing is happening. Logging start
        // and completion here gives an at-a-glance answer to "is it still
        // working" without needing to add a debugger or guess.
        this._logDebug(`segment ${segmentIndexNumber}: fetching...`);
        const initBuffer = await this.segmentFetcher.fetchInitSegment();
        const segmentBuffer = await this.segmentFetcher.fetchSegment(segmentIndexNumber, { signal: fetchSignal });

        this._logDebug(`segment ${segmentIndexNumber}: demuxing + decoding...`);
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
        this._logDebug(`segment ${segmentIndexNumber}: ready (${gopBuffer.frames.length} frames)`);

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
