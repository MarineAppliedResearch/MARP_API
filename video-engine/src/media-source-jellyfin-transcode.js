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
import { MediaSource } from './media-source.js';
import { getQualityOptions } from './quality-options.js';

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

/**
 * Plays directly from a Jellyfin server -- no MARE_API involvement. Wraps a
 * logged-in JellyfinClient for negotiation and playback reporting.
 */
export class JellyfinMediaSource extends MediaSource {
    /**
     * @param {import('./jellyfin-client.js').JellyfinClient} jellyfinClient - An already-authenticated client.
     */
    constructor(jellyfinClient) {
        super();
        this.client = jellyfinClient;
        this._negotiation = null;
    }

    /**
     * Probes the item's source characteristics and builds its quality-tier
     * menu (see quality-options.js for the tier scheme).
     *
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @returns {Promise<Array<Object>>} Quality options, or [] if this item can't be transcoded at all.
     */
    async probeQualityOptions(itemId) {
        const source = await this.client.probeMediaSource(itemId);
        return getQualityOptions(source);
    }

    /**
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @param {Object} qualityOption - A tier from {@link JellyfinMediaSource#probeQualityOptions}.
     * @returns {Promise<string>} Absolute Jellyfin HLS master playlist URL.
     */
    async resolveStreamUrl(itemId, qualityOption) {
        this._negotiation = await this.client.getPlaybackInfo(itemId, qualityOption);
        return this._negotiation.streamUrl;
    }

    /**
     * Negotiates a second, independent Jellyfin transcode session (its
     * own PlaySessionId/ffmpeg process), started at `startTimeSeconds`
     * (earlier than the seek anchor) via StartTimeTicks, so its ffmpeg
     * process only ever sweeps FORWARD through the anchor's behind-region
     * -- never restarting -- instead of being asked to move backward.
     * Confirmed live: even a session fully dedicated to serving segments
     * behind the anchor still restarts (multi-second cost, real 404/500s
     * under load) if asked in decreasing order; the fix is a session that
     * itself never needs to move backward, achieved by starting it
     * earlier and only ever requesting increasing indices from it (see
     * SegmentFetcher#setBehindSession/_resolveSegmentUrl).
     *
     * Not used for playback reporting -- `_negotiation` (from
     * resolveStreamUrl) remains the one Jellyfin considers "the" playback
     * session for resume-position/now-playing purposes; this second
     * session exists purely to pre-cache bytes.
     *
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @param {Object} qualityOption - Same tier passed to {@link JellyfinMediaSource#resolveStreamUrl}.
     * @param {number} startTimeSeconds - Absolute position (seconds) to start this session's own transcode from.
     * @returns {Promise<string>} Absolute Jellyfin HLS master playlist URL for the second session.
     */
    async resolveBehindStreamUrl(itemId, qualityOption, startTimeSeconds) {
        const behindNegotiation = await this.client.getPlaybackInfo(itemId, { ...qualityOption, startTimeSeconds });
        return behindNegotiation.streamUrl;
    }

    /**
     * Two in flight PER LIVE SESSION (the engine applies this ceiling per
     * session, not across all of them -- see SegmentFetcher#sessionKeyFor).
     *
     * Confirmed live against Jellyfin's own
     * DynamicHlsController.GetDynamicSegment that its on-the-fly HLS
     * transcoder is a single sequential ffmpeg process per PlaySessionId,
     * not a randomly-addressable file store: a request for a segment
     * behind that session's current transcoding index, or more than ~24s
     * ahead of it, kills and restarts its job. This was originally
     * serialized to 1 for that reason.
     *
     * Two is safe enough to be worth the throughput, because of two later
     * measurements. First, a segment the transcoder has ALREADY written is
     * served straight off disk -- ~59ms, no index check, no restart -- and
     * the large majority of prefetch requests are for exactly those, since
     * each behind session sweeps forward through ground the playhead is
     * about to revisit. Only not-yet-produced segments can trigger a
     * restart at all. Second, the restart is keyed on PlaySessionId (see
     * TranscodeManager.KillTranscodingJobs), so sessions cannot restart
     * each other, and the risk is confined to two requests within one
     * session both landing on unproduced segments.
     *
     * Sized at 2 rather than higher so three live sessions stay within the
     * browser's own ~6 connections-per-origin limit; beyond that, extra
     * requests would queue in the browser instead of actually running,
     * which is the same problem DEFAULT_MAX_CONCURRENT_TIER1_FETCHES
     * exists to avoid.
     *
     * Known residual cost, accepted deliberately: two concurrent requests
     * for segments a freshly re-anchored session has not produced yet can
     * still race its restart and return a transient 500 (seen live on
     * segments 147/148 against a session anchored at 146). SegmentFetcher's
     * backoff retries and playback continues, so this is log noise rather
     * than a break -- but if it ever becomes disruptive, dropping back to
     * 1 is the first thing to try.
     *
     * @returns {number} 2.
     */
    get maxConcurrentFetches() {
        return 2;
    }

    /**
     * Builds the report body shared by all three playback-reporting calls,
     * filling in the mediaSourceId/playSessionId from the negotiation that
     * produced the currently-playing stream.
     *
     * @param {Object} context - Playback context.
     * @param {number} [context.positionTicks] - Current position, in Jellyfin ticks.
     * @param {boolean} [context.isPaused] - Whether playback is currently paused.
     * @returns {Object} Report body for JellyfinClient's reporting methods.
     */
    _buildReport(context = {}) {
        return {
            mediaSourceId: this._negotiation && this._negotiation.mediaSourceId,
            playSessionId: this._negotiation && this._negotiation.playSessionId,
            positionTicks: context.positionTicks,
            isPaused: context.isPaused,
        };
    }

    async reportPlaybackStarted(itemId, context) {
        await this.client.reportPlaybackStarted(itemId, this._buildReport(context));
    }

    async reportPlaybackProgress(itemId, context) {
        await this.client.reportPlaybackProgress(itemId, this._buildReport(context));
    }

    async reportPlaybackStopped(itemId, context) {
        await this.client.reportPlaybackStopped(itemId, this._buildReport(context));
    }
}
