/**
 * Media source for Jellyfin's on-the-fly HLS transcode path.
 *
 * Owns everything about how THIS source turns a decodable unit into
 * WebCodecs chunks: the shared init segment, mp4box demuxing, and the
 * keyframe-continuity fallback. The engine above only asks for chunks, so
 * a source whose units are byte ranges of one file (Direct Play, local
 * files) can answer the same question without an init segment existing at
 * all.
 *
 * @fileoverview Chunk provision for the Jellyfin HLS transcode path.
 * @module video-engine/media-source-jellyfin-transcode
 */

import { demuxSegment } from './demuxer.js';

/**
 * Supplies decoder chunks for HLS segments already fetched by Tier 1.
 *
 * @class JellyfinTranscodeMediaSource
 */
export class JellyfinTranscodeMediaSource {
    /**
     * @param {Object} params
     * @param {Object} params.segmentFetcher - {@link module:video-engine/segment-fetcher.SegmentFetcher} instance (Tier 1).
     * @param {function(string): void} [params.onDebug] - Called with progress messages, e.g. when the continuity fallback fires.
     */
    constructor({ segmentFetcher, onDebug }) {
        this.segmentFetcher = segmentFetcher;
        this.onDebug = onDebug;
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
