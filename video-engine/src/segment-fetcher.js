/**
 * Fetches the init segment (once, cached forever) and media segments (as
 * raw ArrayBuffer, on demand) for a SegmentIndex.
 *
 * Owns the raw-bytes cache tier -- deliberately separate from and much
 * larger than the decoded-frame LRU in frame-store.js, since raw HLS
 * segments are ~150x cheaper to hold than their decoded frames (~1.5MB vs
 * ~223MB per 3s/1080p segment) but expensive to re-fetch over the network.
 *
 * Every URL fetched here is a direct Jellyfin URL (already carrying its
 * own embedded API key) -- deliberately fetched with no extra options
 * (no MARP Authorization header). Sending one anyway would turn these
 * into cross-origin requests with a custom header, forcing a CORS
 * preflight Jellyfin isn't guaranteed to answer -- confirmed live to hang
 * the fetch() indefinitely with no error ever surfacing.
 *
 * @fileoverview Raw HLS segment/init-segment fetching with an LRU byte cache.
 * @author Isaac Travers
 * @module video-engine/segment-fetcher
 */

/** Max time to wait for a single segment fetch, in ms -- generous, since a real transcode segment fetch over a slow connection has been observed taking 30s+; the point is only to fail loudly, not to be a strict SLA. */
const FETCH_TIMEOUT_MS = 60000;

/**
 * Fetches a URL with a timeout, so a genuinely stuck network request fails
 * with a clear, actionable error instead of hanging forever with no signal
 * -- confirmed live that segment fetch time over a slow connection to a
 * remote Jellyfin server is highly variable (single-digit seconds to 30+),
 * so this exists purely as a last-resort backstop, not a performance target.
 *
 * @param {string} url - URL to fetch.
 * @param {AbortSignal} [externalSignal] - Caller-supplied cancellation, e.g. FrameStore releasing a fetch no caller wants anymore.
 * @returns {Promise<Response>} The fetch response.
 * @throws {Error} When the request doesn't complete within FETCH_TIMEOUT_MS.
 * @throws {DOMException} AbortError, when `externalSignal` fires (distinguished from a timeout by checking `externalSignal.aborted`).
 */
function fetchWithTimeout(url, externalSignal) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // Combines our own timeout-driven abort with the caller's cancellation
    // -- not AbortSignal.any() (would be the cleaner primitive) since this
    // engine's own target/support baseline isn't confirmed to have it.
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
        if (externalSignal.aborted) {
            controller.abort();
        } else {
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
    }

    return fetch(url, { signal: controller.signal })
        .catch((err) => {
            if (err.name === 'AbortError') {
                if (externalSignal && externalSignal.aborted) {
                    throw err; // real cancellation, not a timeout -- let callers recognize it via err.name/externalSignal.aborted
                }
                throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
            }
            throw err;
        })
        .finally(() => {
            clearTimeout(timeoutHandle);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }
        });
}

/**
 * Fetches and caches the raw bytes of a SegmentIndex's segments.
 *
 * @class SegmentFetcher
 */
export class SegmentFetcher {
    /**
     * @param {Object} segmentIndex - SegmentIndex from {@link module:video-engine/playlist-manager.loadSegmentIndex}.
     * @param {Object} [options]
     * @param {number} [options.maxRawSegmentsCached=60] - Raw-bytes LRU cap.
     */
    constructor(segmentIndex, { maxRawSegmentsCached = 60 } = {}) {
        this.segmentIndex = segmentIndex;
        this.maxRawSegmentsCached = maxRawSegmentsCached;

        // segmentIndex -> ArrayBuffer, insertion order doubles as LRU order.
        this._rawSegmentCache = new Map();
        this._initSegmentBuffer = null;
        this._initSegmentPromise = null;
    }

    /**
     * Reports whether a segment's raw bytes are already fetched and
     * cached, without fetching them if not -- used to report per-segment
     * fetch status (e.g. for a scrub-bar visualization), as distinct from
     * {@link module:video-engine/frame-store.FrameStore#has}'s decoded status.
     *
     * @param {number} segmentIndexNumber - Segment index to check.
     * @returns {boolean} True if the segment's raw bytes are cached.
     */
    hasRawBytes(segmentIndexNumber) {
        return this._rawSegmentCache.has(segmentIndexNumber);
    }

    /**
     * Fetches the shared init segment, caching it forever (it's tiny and
     * identical for every media segment in this stream).
     *
     * @async
     * @returns {Promise<ArrayBuffer>} Raw init segment bytes.
     * @throws {Error} When the fetch fails.
     */
    async fetchInitSegment() {
        if (this._initSegmentBuffer) {
            return this._initSegmentBuffer;
        }

        if (!this._initSegmentPromise) {
            this._initSegmentPromise = fetchWithTimeout(this.segmentIndex.initSegmentUrl)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch init segment (${response.status}): ${this.segmentIndex.initSegmentUrl}`);
                    }
                    return response.arrayBuffer();
                })
                .then((buffer) => {
                    this._initSegmentBuffer = buffer;
                    return buffer;
                });
        }

        return this._initSegmentPromise;
    }

    /**
     * Fetches one media segment's raw bytes, serving from the LRU cache
     * when already fetched.
     *
     * @async
     * @param {number} segmentIndexNumber - Index into `segmentIndex.segments`.
     * @param {Object} [options]
     * @param {AbortSignal} [options.signal] - Cancels the underlying fetch if it fires before this resolves -- see FrameStore's reference-counted wanter tracking, which is what actually decides when a fetch no caller wants anymore should be cancelled.
     * @returns {Promise<ArrayBuffer>} Raw segment bytes.
     * @throws {Error} When segmentIndexNumber is out of range or the fetch fails.
     * @throws {DOMException} AbortError, when `options.signal` fires before the fetch completes.
     */
    async fetchSegment(segmentIndexNumber, { signal } = {}) {
        if (this._rawSegmentCache.has(segmentIndexNumber)) {
            const buffer = this._rawSegmentCache.get(segmentIndexNumber);
            this._touch(segmentIndexNumber, buffer);
            return buffer;
        }

        const segment = this.segmentIndex.segments[segmentIndexNumber];
        if (!segment) {
            throw new Error(`No segment at index ${segmentIndexNumber}`);
        }

        const response = await fetchWithTimeout(segment.url, signal);
        if (!response.ok) {
            throw new Error(`Failed to fetch segment ${segmentIndexNumber} (${response.status}): ${segment.url}`);
        }

        const buffer = await response.arrayBuffer();
        this._touch(segmentIndexNumber, buffer);
        this._evictIfNeeded();

        return buffer;
    }

    /**
     * Marks a cache entry as most-recently-used by re-inserting it (Map
     * iteration order follows insertion order).
     *
     * @param {number} segmentIndexNumber - Segment index to bump.
     * @param {ArrayBuffer} buffer - Its cached bytes.
     * @returns {void}
     */
    _touch(segmentIndexNumber, buffer) {
        this._rawSegmentCache.delete(segmentIndexNumber);
        this._rawSegmentCache.set(segmentIndexNumber, buffer);
    }

    /**
     * Evicts the oldest cache entries until the cache is back within
     * `maxRawSegmentsCached`.
     *
     * @returns {void}
     */
    _evictIfNeeded() {
        while (this._rawSegmentCache.size > this.maxRawSegmentsCached) {
            const oldestKey = this._rawSegmentCache.keys().next().value;
            this._rawSegmentCache.delete(oldestKey);
        }
    }
}
