/**
 * Media source for Jellyfin's on-the-fly HLS transcode path.
 *
 * Owns everything HLS-specific: loading the playlist, the per-segment URLs
 * and the raw-byte fetcher that uses them, the shared init segment, mp4box
 * demuxing, and the keyframe-continuity fallback. The engine above sees
 * only ordered units with real start/end times and asks for their chunks,
 * so a source whose units are byte ranges of one file (Direct Play, local
 * files) can answer the same questions with no playlist and no init
 * segment existing at all.
 *
 * @fileoverview The Jellyfin HLS transcode media source.
 * @module video-engine/media-source-jellyfin-transcode
 */

import { demuxSegment } from './demuxer.js';
import { loadSegmentIndex } from './playlist-manager.js';
import { SegmentFetcher } from './segment-fetcher.js';

/**
 * Supplies the unit index and decoder chunks for a Jellyfin HLS stream.
 *
 * @class JellyfinTranscodeMediaSource
 */
export class JellyfinTranscodeMediaSource {
    /**
     * @param {Object} params
     * @param {string} params.streamUrl - MARP/Jellyfin stream-negotiation URL.
     * @param {Object} [params.fetchOptions] - Extra fetch() options applied to every request this source makes.
     * @param {number} [params.rawSegmentCacheBudgetBytes] - Tier 1 raw-segment cache budget in bytes.
     * @param {function(string): void} [params.onDebug] - Called with progress messages, e.g. when the continuity fallback fires.
     * @param {function(Error): void} [params.onError] - Called once per real raw-fetch failure.
     */
    constructor({ streamUrl, fetchOptions, rawSegmentCacheBudgetBytes, onDebug, onError }) {
        this.streamUrl = streamUrl;
        this.fetchOptions = fetchOptions;
        this.rawSegmentCacheBudgetBytes = rawSegmentCacheBudgetBytes;
        this.onDebug = onDebug;
        this.onError = onError;

        // Both created by load(), which must run before anything else.
        this.segmentFetcher = null;
        this._segmentIndex = null;
    }

    /**
     * Loads the playlist and builds this source's Tier 1 fetcher over it.
     *
     * Tier 1 lives here rather than in the engine because everything it
     * does is HLS-specific -- one URL per segment, behind-session routing,
     * a concurrency ceiling sized for a sequential transcoder. The engine
     * still drives it (hasRawBytes/ensureRawBytes/preemptInFlightFetches),
     * it just no longer constructs it.
     *
     * @async
     * @returns {Promise<void>}
     */
    async load() {
        this._segmentIndex = await loadSegmentIndex(this.streamUrl, { fetchOptions: this.fetchOptions });
        this.segmentFetcher = new SegmentFetcher(this._segmentIndex, {
            maxRawCacheBytes: this.rawSegmentCacheBudgetBytes,
            // A raw fetch a seek is awaiting can be in flight for many
            // seconds with no other visible signal that anything is
            // happening at all.
            onDebug: this.onDebug,
            onError: this.onError,
        });
    }

    /**
     * The engine-facing unit index: ordered decodable units with real
     * start/end times, and no URLs -- how a unit's bytes are located is
     * this source's business alone.
     *
     * @returns {{segments: Array<{index: number, startTime: number, endTime: number, duration: number}>, totalDuration: number}} Ordered units and total duration.
     */
    getUnitIndex() {
        return {
            segments: this._segmentIndex.segments.map(({ index, startTime, endTime, duration }) => ({
                index,
                startTime,
                endTime,
                duration,
            })),
            totalDuration: this._segmentIndex.totalDuration,
        };
    }

    /**
     * Demuxes one unit's already-fetched bytes into decoder chunks.
     *
     * Requires the unit's raw bytes to be present in Tier 1 -- this never
     * fetches them. The one exception is the continuity fallback below,
     * which needs the PRECEDING unit's bytes to make decode possible at
     * all; that is an implementation detail of decoding this unit, not a
     * scheduling decision.
     *
     * @async
     * @param {number} unitIndex - Index of the unit to demux.
     * @returns {Promise<{codec: string, description: (Uint8Array|null), chunks: Array<Object>, unitFirstTimestampMicros: (number|null)}>} Chunks in decode order, plus this unit's own first presentation timestamp so merged-in frames can be trimmed after decode.
     * @throws {Error} When unit 0 itself does not start with a keyframe (unrecoverable).
     */
    async fetchChunks(unitIndex) {
        const initBuffer = await this.segmentFetcher.fetchInitSegment();
        const segmentBuffer = this.segmentFetcher.getCachedRawBytes(unitIndex);

        let demuxResult = await demuxSegment(initBuffer, segmentBuffer);

        // Captured before any merge, so the caller can trim prepended
        // frames back out after decode.
        const unitFirstTimestampMicros = demuxResult.chunks.length > 0 ? demuxResult.chunks[0].timestamp : null;

        if (demuxResult.chunks.length === 0 || demuxResult.chunks[0].type !== 'key') {
            // Defensive: this unit's first sample isn't a keyframe, contrary
            // to Jellyfin's BreakOnNonKeyFrames=False guarantee. Merge the
            // previous unit's chunks so decode has a real keyframe to start
            // from, rather than corrupting output or throwing.
            this._logDebug(`unit ${unitIndex}: non-key start, merging previous unit for decode continuity`);
            if (unitIndex === 0) {
                throw new Error('First segment does not start with a keyframe -- cannot recover.');
            }

            const previousBuffer = await this.segmentFetcher.ensureRawBytes(unitIndex - 1);
            const previousDemux = await demuxSegment(initBuffer, previousBuffer);

            demuxResult = {
                codec: demuxResult.codec,
                description: demuxResult.description,
                chunks: [...previousDemux.chunks, ...demuxResult.chunks].sort((a, b) => a.timestamp - b.timestamp),
            };
        }

        return { ...demuxResult, unitFirstTimestampMicros };
    }

    /**
     * @param {string} message - Message text, without the module prefix (added here).
     * @returns {void}
     */
    _logDebug(message) {
        const prefixed = `[media-source-jellyfin-transcode] ${message}`;
        console.log(prefixed);
        if (this.onDebug) {
            this.onDebug(prefixed);
        }
    }
}
