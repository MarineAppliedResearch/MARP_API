/**
 * MediaSource abstraction: resolves an item reference to a playable stream
 * URL (what createMarpVideoEngine actually needs) and, where applicable,
 * reports playback state back to the origin server.
 *
 * JellyfinMediaSource is the only implementation today; LocalFileMediaSource
 * (playing a user-picked local file when Jellyfin is unavailable) is a
 * planned follow-up phase, not yet built -- this interface exists so it has
 * a clean seam to slot into without touching this phase's work again.
 *
 * @fileoverview Pluggable video source abstraction for the video player.
 */

import { getQualityOptions } from './quality-options.js';

/**
 * Base interface. Subclasses override resolveStreamUrl (required) and the
 * three reporting methods (optional -- default to no-ops, since not every
 * source has a remote session to report to).
 */
export class MediaSource {
    /**
     * Resolves an item reference + quality tier to a playable stream URL.
     *
     * @async
     * @param {string} itemId - Source-specific item reference.
     * @param {Object} [qualityOption] - A tier from this source's own quality options (if any).
     * @returns {Promise<string>} A URL createMarpVideoEngine can load.
     */
    async resolveStreamUrl(itemId, qualityOption) {
        throw new Error('resolveStreamUrl is not implemented for this MediaSource.');
    }

    /**
     * Resolves a second, independent stream URL dedicated to serving
     * segments behind the current seek anchor, started at
     * `startTimeSeconds` -- optional, called once per seek by the caller
     * (see the video-engine shim's `setBehindSession`). `undefined` means
     * single-session mode: every segment is fetched from
     * `resolveStreamUrl`'s one session regardless of direction,
     * appropriate for a source that supports true random access (e.g. a
     * static file server) and so has no "direction" cost to avoid.
     *
     * @async
     * @param {string} itemId - Source-specific item reference.
     * @param {Object} [qualityOption] - A tier from this source's own quality options (if any).
     * @param {number} [startTimeSeconds] - Absolute position (seconds) the returned URL's session should start from.
     * @returns {Promise<string|undefined>} A second URL createMarpVideoEngine can load, or undefined for single-session mode.
     */
    async resolveBehindStreamUrl(itemId, qualityOption, startTimeSeconds) {
        return undefined;
    }

    /**
     * Ceiling on simultaneously in-flight raw segment fetches this source
     * can safely tolerate, passed straight through to
     * createMarpVideoEngine's own `maxConcurrentFetches` option.
     * `undefined` here means "let the engine use its own default" (full
     * concurrency), appropriate for a source that supports true random
     * access, e.g. a static file server. A source backed by a single
     * sequential live producer must override this with a much lower value
     * -- see {@link JellyfinMediaSource#maxConcurrentFetches}.
     *
     * @returns {number|undefined} Concurrent-fetch ceiling, or undefined for the engine's own default.
     */
    get maxConcurrentFetches() {
        return undefined;
    }

    /** @param {string} itemId @param {Object} context @returns {Promise<void>} */
    async reportPlaybackStarted(itemId, context) {}

    /** @param {string} itemId @param {Object} context @returns {Promise<void>} */
    async reportPlaybackProgress(itemId, context) {}

    /** @param {string} itemId @param {Object} context @returns {Promise<void>} */
    async reportPlaybackStopped(itemId, context) {}
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
     * Serialized to 1: confirmed live against Jellyfin's own
     * DynamicHlsController.GetDynamicSegment that its on-the-fly HLS
     * transcoder is a single sequential ffmpeg process per PlaySessionId,
     * not a randomly-addressable file store -- any request for a segment
     * behind its current transcoding index, or more than ~24s ahead of it,
     * kills and restarts that session's job. Firing several concurrent
     * requests spanning both directions around the playhead (this engine's
     * normal bidirectional prefetch) let two such requests race
     * conflicting restarts against each other under the same session,
     * which is what was producing transient 404/500s on real playback.
     * Serializing means Jellyfin only ever has to reconcile one request's
     * idea of "where should transcoding be" at a time.
     *
     * @returns {number} 1.
     */
    get maxConcurrentFetches() {
        return 1;
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