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
            this._initSegmentPromise = fetch(this.segmentIndex.initSegmentUrl)
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
     * @returns {Promise<ArrayBuffer>} Raw segment bytes.
     * @throws {Error} When segmentIndexNumber is out of range or the fetch fails.
     */
    async fetchSegment(segmentIndexNumber) {
        if (this._rawSegmentCache.has(segmentIndexNumber)) {
            const buffer = this._rawSegmentCache.get(segmentIndexNumber);
            this._touch(segmentIndexNumber, buffer);
            return buffer;
        }

        const segment = this.segmentIndex.segments[segmentIndexNumber];
        if (!segment) {
            throw new Error(`No segment at index ${segmentIndexNumber}`);
        }

        const response = await fetch(segment.url);
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
