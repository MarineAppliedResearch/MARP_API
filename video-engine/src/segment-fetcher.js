/**
 * Tier 1 of the two-tier cache: raw, undecoded HLS segment bytes as
 * fetched from the network, plus the init segment (once, cached forever).
 *
 * Owns the raw-bytes cache tier -- deliberately separate from and much
 * larger than the decoded-frame LRU in frame-store.js, since raw HLS
 * segments are ~150x cheaper to hold than their decoded frames (~1.5MB vs
 * ~223MB per 3s/1080p segment) but expensive to re-fetch over the network.
 * Tier 1 never decodes anything -- that's Tier 2's (frame-store.js) job,
 * and it only ever decodes what Tier 1 has already fetched.
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

/** Backoff delay before the first automatic retry of a raw fetch that just failed, in ms. */
const INITIAL_FETCH_RETRY_BACKOFF_MS = 200;

/** Ceiling on raw-fetch backoff delay, however many consecutive failures a segment has had, in ms. */
const MAX_FETCH_RETRY_BACKOFF_MS = 8000;

/** Raw-fetch backoff grows by this factor after each consecutive failure, until MAX_FETCH_RETRY_BACKOFF_MS. */
const FETCH_RETRY_BACKOFF_MULTIPLIER = 2;

/** Max time to wait for a single segment fetch, in ms -- generous, since a real transcode segment fetch over a slow connection has been observed taking 30s+; the point is only to fail loudly, not to be a strict SLA. */
const FETCH_TIMEOUT_MS = 60000;

/** Default raw-segment cache budget: 3 GiB. */
const DEFAULT_RAW_CACHE_BUDGET_BYTES = 3 * 1024 * 1024 * 1024;

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
     * @param {number} [options.maxRawCacheBytes=3221225472] - Raw-bytes LRU cap.
     * @param {function(Error): void} [options.onError] - Called exactly once per real (non-cancelled) raw-fetch failure, regardless of how many callers (opportunistic prefetch, render-path fallback, a seek) share the same in-flight request.
     * @param {function(string): void} [options.onDebug] - Called with the same fetch progress messages this class already logs to the console -- lets a consumer (e.g. the test harness's on-page log panel) see that a raw fetch is in flight, since it can otherwise take seconds with zero visible signal.
     */
    constructor(segmentIndex, { maxRawCacheBytes = DEFAULT_RAW_CACHE_BUDGET_BYTES, onError, onDebug } = {}) {
        this.segmentIndex = segmentIndex;
        this.maxRawCacheBytes = Math.floor(maxRawCacheBytes);
        this.onError = onError;
        this.onDebug = onDebug;

        // segmentIndex -> ArrayBuffer, insertion order doubles as LRU order.
        this._rawSegmentCache = new Map();
        this._rawSegmentBytes = 0;

        // The scheduler can mark a local neighborhood as protected.
        // Protected raw segments should survive ordinary LRU churn.
        // This matters most while paused and filling aggressively.
        // Without it, far-away background fetches age out local bytes.
        this._protectedRawSegments = new Set();

        // segmentIndex -> {promise, wanterCount, abortController}. Concurrent
        // ensureRawBytes() callers for the same segment share one in-flight
        // fetch; a caller that passes `signal` releases its own "want" when
        // it fires, and the underlying fetch is only actually cancelled once
        // every wanter has released (see ensureRawBytes()'s own doc comment).
        this._inFlightFetches = new Map();

        // Tracks recent real fetch failures per segment so automatic
        // (opportunistic) callers stop hammering a segment that just
        // failed; a deliberate seek() still bypasses this.
        this._fetchBackoff = new Map();

        // The init segment is tiny.
        // It never changes for this stream.
        // Once fetched, keep it forever.
        this._initSegmentBuffer = null;
        this._initSegmentPromise = null;
    }

    /**
     * Returns current raw-segment cache configuration/state.
     *
     * @returns {{maxRawCacheBytes: number, cachedRawBytes: number, cachedRawSegments: number, protectedRawSegments: number}} Cache config/state snapshot.
     */
    getRawCacheConfig() {
        return {
            maxRawCacheBytes: this.maxRawCacheBytes,
            cachedRawBytes: this._rawSegmentBytes,
            cachedRawSegments: this._rawSegmentCache.size,
            protectedRawSegments: this._protectedRawSegments.size,
        };
    }

    /**
     * Protects a set of segment indices from raw-cache eviction whenever
     * possible. If every cached entry is protected and eviction is still
     * required, eviction falls back to oldest-first among protected keys.
     *
     * @param {Iterable<number>} indices - Segment indices to protect.
      * @returns {{maxRawCacheBytes: number, cachedRawBytes: number, cachedRawSegments: number, protectedRawSegments: number}} Updated cache config/state snapshot.
     */
    setProtectedRawSegments(indices) {
        // Each scheduler pass supplies the full protected region.
        // Replacing atomically keeps the rule simple and predictable.
        this._protectedRawSegments = new Set(indices);

        // Reconcile immediately.
        // Do not wait for another fetch to trigger eviction.
        this._evictIfNeeded();
        return this.getRawCacheConfig();
    }

    /**
     * Updates the raw-segment LRU capacity at runtime and evicts oldest
     * entries immediately if the new cap is smaller than current usage.
     *
     * @param {number} budgetBytes - New raw-segment cache capacity in bytes.
     * @returns {{maxRawCacheBytes: number, cachedRawBytes: number, cachedRawSegments: number, protectedRawSegments: number}} Updated cache config/state snapshot.
     */
    setMaxRawCacheBytes(budgetBytes) {
        if (!Number.isFinite(budgetBytes) || budgetBytes < 1) {
            throw new Error(`Invalid raw segment cache size: ${budgetBytes}`);
        }

        this.maxRawCacheBytes = Math.floor(budgetBytes);
        this._evictIfNeeded();
        return this.getRawCacheConfig();
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
     * Reports whether a segment already has a fetch in flight (started by
     * an earlier call, not yet settled) -- so a repeat caller (e.g. the
     * scheduler's own cache pass, run on every render tick) can skip it
     * instead of burning its per-pass pacing budget on a no-op re-call
     * every single tick until the real fetch finally resolves.
     *
     * @param {number} segmentIndexNumber - Segment index to check.
     * @returns {boolean} True if a fetch for this segment is already in flight.
     */
    hasInFlightFetch(segmentIndexNumber) {
        return this._inFlightFetches.has(segmentIndexNumber);
    }

    /**
     * Returns the current count of distinct segments with a raw fetch in
     * flight -- used to cap total concurrent fetches, since the browser's
     * own per-origin connection limit means an unbounded number of
     * simultaneously in-flight requests queues newer, more urgent ones
     * (e.g. a seek's own target) behind a pile of older, lower-priority
     * opportunistic ones instead of actually running concurrently.
     *
     * @returns {number} Count of segments with an in-flight fetch.
     */
    getInFlightFetchCount() {
        return this._inFlightFetches.size;
    }

    /**
     * Forcibly cancels every currently in-flight fetch except those in
     * `keepIndices`, regardless of how many wanters each one still has --
     * unlike the ordinary wanter-refcounted release (which only cancels a
     * fetch once nothing wants it anymore), this exists for a caller with
     * a genuinely more urgent need (a seek's cold target) that shouldn't
     * have to race the browser's own per-origin connection limit against
     * a pile of already-in-flight, lower-priority background-prefetch
     * fetches that simply got there first. Preempted fetches are not
     * treated as failures (see `_recordFetchOutcome`'s AbortError
     * handling) -- a later cache pass will naturally re-request whichever
     * of them are still relevant.
     *
     * @param {Iterable<number>} keepIndices - Segment indices whose in-flight fetch should be left alone.
     * @returns {void}
     */
    preemptInFlightFetches(keepIndices) {
        const keepSet = new Set(keepIndices);
        for (const [index, entry] of this._inFlightFetches) {
            if (!keepSet.has(index)) {
                entry.abortController.abort();
            }
        }
    }

    /**
     * Returns a segment's already-cached raw bytes synchronously, never
     * fetching -- the one accessor Tier 2 (frame-store.js) is allowed to
     * use for its ordinary decode path, so decode can structurally never
     * trigger a network fetch, even via a race between a caller's own
     * hasRawBytes() check and its next call.
     *
     * @param {number} segmentIndexNumber - Segment index to read.
     * @returns {ArrayBuffer} The segment's cached raw bytes.
     * @throws {Error} When the segment's raw bytes are not cached.
     */
    getCachedRawBytes(segmentIndexNumber) {
        const buffer = this._rawSegmentCache.get(segmentIndexNumber);
        if (!buffer) {
            throw new Error(`Segment ${segmentIndexNumber} raw bytes are not cached`);
        }
        this._touch(segmentIndexNumber, buffer);
        return buffer;
    }

    /**
     * Logs a raw-fetch progress or failure message to the console and, if
     * supplied, to the `onDebug` callback -- see the constructor's own doc
     * comment for why this exists (a raw fetch can be silently in flight
     * for a long time otherwise).
     *
     * @param {string} message - Message text, without the "[segment-fetcher]" prefix (added here).
     * @returns {void}
     */
    _logDebug(message) {
        const prefixed = `[segment-fetcher] ${message}`;
        console.log(prefixed);
        if (this.onDebug) {
            this.onDebug(prefixed);
        }
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
     * Reports whether a segment's raw fetch failed recently enough that
     * automatic (opportunistic) callers should skip it until its backoff
     * window elapses -- a deliberate seek() is NOT gated by this.
     *
     * @param {number} segmentIndexNumber - Segment index to check.
     * @returns {boolean} True if a recent failure's backoff window hasn't elapsed yet.
     */
    isFetchInBackoff(segmentIndexNumber) {
        const backoff = this._fetchBackoff.get(segmentIndexNumber);
        return !!backoff && Date.now() < backoff.nextAttemptAtMs;
    }

    /**
     * Records a raw-fetch outcome for backoff purposes: a real failure
     * grows that segment's backoff delay exponentially (up to
     * MAX_FETCH_RETRY_BACKOFF_MS); a success clears it. A cancellation is
     * deliberately not treated as a failure -- it says nothing about
     * whether the segment is actually fetchable.
     *
     * @param {number} segmentIndexNumber - Segment index the outcome applies to.
     * @param {(Error|null)} err - The rejection reason, or null on success.
     * @returns {void}
     */
    _recordFetchOutcome(segmentIndexNumber, err) {
        if (!err) {
            this._fetchBackoff.delete(segmentIndexNumber);
            return;
        }
        if (err.name === 'AbortError') {
            return;
        }

        const previous = this._fetchBackoff.get(segmentIndexNumber);
        const delayMs = previous
            ? Math.min(MAX_FETCH_RETRY_BACKOFF_MS, previous.delayMs * FETCH_RETRY_BACKOFF_MULTIPLIER)
            : INITIAL_FETCH_RETRY_BACKOFF_MS;
        this._fetchBackoff.set(segmentIndexNumber, { nextAttemptAtMs: Date.now() + delayMs, delayMs });

        if (this.onError) {
            this.onError(err);
        }
    }

    /**
     * Ensures a segment's raw bytes are fetched and cached -- Tier 1's
     * single entry point for every caller (opportunistic prefetch, the
     * render-path stall fallback, and seek()) so concurrent callers for
     * the same segment share one in-flight fetch instead of duplicating
     * network work.
     *
     * Callers that only transiently want a segment (seek(), which calls
     * this again for a new target on every drag movement) can pass
     * `signal` to release their want when it fires -- if no other caller
     * (e.g. opportunistic prefetch, which never passes a signal) still
     * wants this segment, its underlying fetch is cancelled immediately.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index to ensure.
     * @param {Object} [options]
     * @param {AbortSignal} [options.signal] - Releases this specific call's "want" when it fires.
     * @returns {Promise<ArrayBuffer>} The segment's raw bytes.
     */
    async ensureRawBytes(segmentIndexNumber, { signal } = {}) {
        if (this._rawSegmentCache.has(segmentIndexNumber)) {
            const buffer = this._rawSegmentCache.get(segmentIndexNumber);
            this._touch(segmentIndexNumber, buffer);
            return buffer;
        }

        let entry = this._inFlightFetches.get(segmentIndexNumber);
        if (!entry) {
            // A real network fetch can take anywhere from under a second
            // to tens of seconds depending on the upstream transcoder/
            // network -- logging start and completion here is the only
            // signal that a raw fetch is in flight at all, as opposed to
            // having silently stalled or never having been requested.
            this._logDebug(`segment ${segmentIndexNumber}: fetching raw bytes...`);
            const abortController = new AbortController();
            const promise = this.fetchSegment(segmentIndexNumber, { signal: abortController.signal })
                .then(
                    (buffer) => {
                        this._recordFetchOutcome(segmentIndexNumber, null);
                        this._logDebug(`segment ${segmentIndexNumber}: raw bytes ready (${buffer.byteLength} bytes)`);
                        return buffer;
                    },
                    (err) => {
                        this._recordFetchOutcome(segmentIndexNumber, err);
                        if (err.name !== 'AbortError') {
                            this._logDebug(`segment ${segmentIndexNumber}: raw fetch FAILED -- ${err.message}`);
                        }
                        throw err;
                    },
                )
                .finally(() => {
                    this._inFlightFetches.delete(segmentIndexNumber);
                });
            entry = { promise, wanterCount: 0, abortController };
            this._inFlightFetches.set(segmentIndexNumber, entry);
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
     * Releases one caller's "want" on an in-flight raw fetch, cancelling
     * it if that was the last remaining wanter and it hasn't resolved yet.
     *
     * @param {number} segmentIndexNumber - Segment index whose want is being released.
     * @param {Object} entry - The `_inFlightFetches` entry this release applies to.
     * @returns {void}
     */
    _releaseWanter(segmentIndexNumber, entry) {
        entry.wanterCount -= 1;
        if (entry.wanterCount <= 0 && this._inFlightFetches.get(segmentIndexNumber) === entry) {
            entry.abortController.abort();
        }
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
        const previousBuffer = this._rawSegmentCache.get(segmentIndexNumber);
        if (previousBuffer) {
            this._rawSegmentBytes -= previousBuffer.byteLength;
        }
        this._rawSegmentCache.delete(segmentIndexNumber);
        this._rawSegmentCache.set(segmentIndexNumber, buffer);
        this._rawSegmentBytes += buffer.byteLength;
    }

    /**
     * Evicts the oldest cache entries until the cache is back within
     * `maxRawCacheBytes`.
     *
     * @returns {void}
     */
    _evictIfNeeded() {
        while (this._rawSegmentBytes > this.maxRawCacheBytes) {
            let evicted = false;

            // Prefer evicting the oldest non-protected segment first.
            // This keeps the local paused neighborhood resident longer.
            for (const key of this._rawSegmentCache.keys()) {
                if (!this._protectedRawSegments.has(key)) {
                    const buffer = this._rawSegmentCache.get(key);
                    this._rawSegmentBytes -= buffer.byteLength;
                    this._rawSegmentCache.delete(key);
                    evicted = true;
                    break;
                }
            }

            if (!evicted) {
                // If everything is protected, capacity still has to win.
                // Fall back to ordinary oldest-first eviction.
                // This avoids an infinite loop when protection is too large.
                const oldestKey = this._rawSegmentCache.keys().next().value;
                const buffer = this._rawSegmentCache.get(oldestKey);
                this._rawSegmentBytes -= buffer.byteLength;
                this._rawSegmentCache.delete(oldestKey);
            }
        }
    }
}
