/**
 * Composes the video-engine pipeline (playlist -> segment fetch -> demux
 * -> decode -> frame cache -> scheduler -> canvas render) and returns a
 * window.marpVideo-compatible facade over it.
 *
 * @fileoverview Public entry point: createMarpVideoEngine().
 * @author Isaac Travers
 * @module video-engine
 */

import { loadSegmentIndex } from './playlist-manager.js';
import { JellyfinTranscodeMediaSource, JellyfinMediaSource } from './media-source-jellyfin-transcode.js';
import { GopDecoder } from './gop-decoder.js';
import { FrameStore } from './frame-store.js';
import { Scheduler } from './scheduler.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { MarpVideoShim } from './marp-video-shim.js';
import { attachWebView2Bridge } from './webview2-bridge.js';
import { JellyfinClient } from './jellyfin-client.js';
import { MediaSource } from './media-source.js';
import { getQualityOptions } from './quality-options.js';

export { attachWebView2Bridge, JellyfinClient, MediaSource, JellyfinMediaSource, getQualityOptions };

/**
 * Creates a frame-accurate bidirectional playback engine over a Jellyfin
 * HLS/CMAF stream, backed by WebCodecs + a <canvas>, exposing a
 * window.marpVideo-compatible surface.
 *
 * @async
 * @param {HTMLCanvasElement} canvas - Render target.
 * @param {Object} options
 * @param {string} options.streamUrl - MARP stream-negotiation URL, e.g. `/api/v2/jellyfin/items/:id/stream?mode=Transcode`.
 * @param {Object} [options.fetchOptions] - Extra fetch() options (e.g. `{headers: {Authorization: 'Bearer ...'}}`) applied to every request this engine makes.
 * @param {number} [options.cacheBudgetBytes] - Decoded-frame LRU cache budget in bytes. Default 3 GiB.
 * @param {number} [options.rawSegmentCacheBudgetBytes] - Raw-segment cache budget in bytes. Default 3 GiB.
 * @param {number} [options.maxConcurrentFetches] - Ceiling on simultaneously in-flight raw segment fetches. Default 6, suitable for a source that supports true random access (e.g. a static file server). A source backed by a single sequential live producer (e.g. Jellyfin's on-the-fly HLS transcoder) should pass a much lower value -- see scheduler.js's DEFAULT_MAX_CONCURRENT_TIER1_FETCHES doc comment for why.
 * @returns {Promise<Object>} A {@link module:video-engine/marp-video-shim.MarpVideoShim} instance, with an added `setBehindSession(behindStreamUrl, behindStartTimeSeconds)` method -- see its own doc comment below.
 * @throws {Error} When the stream can't be loaded or the first segment decodes zero frames.
 */
export async function createMarpVideoEngine(canvas, options) {
    const { streamUrl, fetchOptions, cacheBudgetBytes, rawSegmentCacheBudgetBytes, maxConcurrentFetches } = options;

    let shim = null;

    // Which source is plugged in decides where bytes come from and how they
    // become decoder chunks; everything below this is source-agnostic.
    const mediaSource = new JellyfinTranscodeMediaSource({
        streamUrl,
        fetchOptions,
        rawSegmentCacheBudgetBytes,
        // Forwards progress/failure messages to a 'debug' event on the shim
        // -- deferred `shim` reference since the source is constructed
        // before the shim exists (same pattern FrameStore/Scheduler's
        // callbacks use below).
        onDebug: (message) => {
            if (shim) {
                shim._dispatch('debug', { message });
            }
        },
        onError: (err) => {
            console.error('Media source reported a raw-fetch failure', err);
            if (shim) {
                shim._dispatch('error', { error: err });
            }
        },
    });

    // Logged at each stage (not just on final success/failure) so a stall
    // in any one step -- e.g. a hung fetch() -- is immediately localized
    // instead of looking like total silence.
    console.log('[video-engine] loading media source...');
    await mediaSource.load();
    const segmentIndex = mediaSource.getUnitIndex();
    console.log(`[video-engine] source loaded: ${segmentIndex.segments.length} units, ${segmentIndex.totalDuration.toFixed(3)}s`);
    console.log(`[video-engine] max concurrent segment fetches: ${maxConcurrentFetches || '(engine default)'}`);

    const segmentFetcher = mediaSource.segmentFetcher;
    const gopDecoder = new GopDecoder();

    // Demux+decode the first segment up front, both to display an initial
    // frame and to learn the real negotiated width/height/fps the LRU
    // cache's memory-budget formula needs -- never guessed/hardcoded.
    console.log('[video-engine] fetching first segment...');
    await segmentFetcher.fetchSegment(0);

    console.log('[video-engine] demuxing first segment...');
    const { unitFirstTimestampMicros: _firstUnitStart, ...firstDemux } = await mediaSource.fetchChunks(0);

    console.log('[video-engine] decoding first segment...');
    const firstGopBuffer = await gopDecoder.decodeSegment(0, firstDemux);
    console.log(`[video-engine] first segment decoded: ${firstGopBuffer.frames.length} frames`);

    if (firstGopBuffer.frames.length === 0) {
        throw new Error('First segment decoded zero frames.');
    }

    const firstFrame = firstGopBuffer.frames[0];
    const videoWidth = firstFrame.displayWidth;
    const videoHeight = firstFrame.displayHeight;
    const fps = Math.round(firstGopBuffer.frames.length / segmentIndex.segments[0].duration);

    const frameStore = new FrameStore({
        segmentFetcher,
        mediaSource,
        gopDecoder,
        width: videoWidth,
        height: videoHeight,
        fps,
        segmentDuration: segmentIndex.segments[0].duration,
        cacheBudgetBytes,
        // Forwards fetch/decode progress/failure messages to a 'debug'
        // event on the shim, so a consumer can surface them without
        // needing DevTools open -- deferred `shim` reference since
        // FrameStore is constructed before the shim exists (same pattern
        // Scheduler's own `emit` callback already uses below).
        onDebug: (message) => {
            if (shim) {
                shim._dispatch('debug', { message });
            }
        },
        // Reports each real segment failure exactly once (see FrameStore's
        // own constructor doc comment for why per-caller reporting used to
        // fire many duplicate times for a single failure).
        onError: (err) => {
            console.error('FrameStore reported a segment failure', err);
            if (shim) {
                shim._dispatch('error', { error: err });
            }
        },
    });

    // Seed the cache with the segment already decoded above rather than
    // discarding it and re-decoding on the first seek(0) below.
    frameStore.buffers.set(0, firstGopBuffer);

    const canvasRenderer = new CanvasRenderer(canvas);

    const scheduler = new Scheduler({
        segmentIndex,
        frameStore,
        canvasRenderer,
        maxConcurrentTier1Fetches: maxConcurrentFetches,
        emit: (type, detail) => {
            if (type === 'error') {
                console.error('Scheduler emitted "error"', detail && detail.error);
            }
            if (shim) {
                // Forwards whatever detail the scheduler attached (e.g.
                // seeking/seeked's targetTime/segmentIndex, debug's
                // message) straight through to listeners like the
                // WebView2 bridge or the test harness's log panel.
                shim._dispatch(type, detail);
            }
        },
    });

    shim = new MarpVideoShim(scheduler, { videoWidth, videoHeight, fps });

    /**
     * Negotiates (or replaces) the "behind" session -- a second,
     * independent Jellyfin transcode session started earlier than the
     * current seek anchor via StartTimeTicks, so its own ffmpeg process
     * only ever sweeps forward through the anchor's behind-region instead
     * of restarting on every backward segment request (confirmed live:
     * even one segment behind an already-warm session's position costs a
     * multi-second restart, regardless of session dedication -- the fix
     * is a session that never itself needs to move backward).
     *
     * Call this once per seek (e.g. from a 'seeked' listener), after the
     * seek has already landed -- this only affects opportunistic
     * background fetches for indices below the anchor, never the seek's
     * own target-segment fetch. Safe to call repeatedly; a newer call's
     * result simply replaces the previous behind session once it
     * resolves (callers should discard a stale in-flight call themselves
     * if a newer seek has already superseded it, the same way
     * Scheduler#seek's own generation counter works).
     *
     * @async
     * @param {string} behindStreamUrl - A second stream-negotiation URL, negotiated with StartTimeTicks = behindStartTimeSeconds.
     * @param {number} behindStartTimeSeconds - The exact start time (in seconds) that URL was negotiated with. NOT an index translation -- segment indices are absolute in every session (see SegmentFetcher#setBehindSession) -- this only marks how far back this session's own transcode can serve from without being forced to seek backward.
     * @param {function(): boolean} [isStillWanted] - Checked immediately before applying the result (after this call's own playlist fetch, which can take a real, variable amount of time) -- if it returns false, the result is discarded instead of being applied. Without this, an OLDER negotiation whose own playlist fetch happens to resolve AFTER a newer one's can silently overwrite the newer (correct) behind session with stale routing data -- confirmed live as the actual cause of a segment's decoded content coming from a completely different, much-earlier point in the stream than its own timecode. The caller's own generation-counter check before starting this call is not enough by itself, since nothing re-checks it after this call's async work completes and right before the mutation below.
     * @returns {Promise<void>}
     */
    // Behind sessions currently installed, keyed by role ('close' /
    // 'extended'), so each can be re-anchored independently: the close one
    // re-anchors often as the playhead moves, the extended one rarely.
    const behindSessionsByRole = new Map();

    shim.setBehindSession = async (behindStreamUrl, behindStartTimeSeconds, isStillWanted) => {
        await shim.setBehindSessionForRole('close', behindStreamUrl, behindStartTimeSeconds, isStillWanted);
    };

    /**
     * Negotiates (or replaces) one named behind session, leaving the
     * others in place.
     *
     * Two roles are used today. 'close' sits just behind the playhead and
     * is re-anchored often -- a forward-sweeping transcode produces the
     * segment nearest its own anchor first and the furthest one last, so
     * only a session anchored very close delivers what reverse playback
     * needs soonest. 'extended' owns the deeper section the playhead is
     * heading into, and is re-anchored rarely; by the time the playhead
     * arrives, its segments are already written to disk and serve
     * immediately (~59ms measured, versus a multi-second restart).
     *
     * @async
     * @param {string} role - Session role, e.g. 'close' or 'extended'.
     * @param {string} behindStreamUrl - Stream-negotiation URL for this session, negotiated with StartTimeTicks = behindStartTimeSeconds.
     * @param {number} behindStartTimeSeconds - The exact start time (seconds) that URL was negotiated with.
     * @param {function(): boolean} [isStillWanted] - Checked immediately before applying the result; see setBehindSession's own note on why a pre-call generation check is not enough.
     * @returns {Promise<void>}
     */
    shim.setBehindSessionForRole = async (role, behindStreamUrl, behindStartTimeSeconds, isStillWanted) => {
        const behindSegmentIndex = await loadSegmentIndex(behindStreamUrl, { fetchOptions });
        if (isStillWanted && !isStillWanted()) {
            return;
        }
        behindSessionsByRole.set(role, {
            segments: behindSegmentIndex.segments,
            startTimeSeconds: behindStartTimeSeconds,
        });
        segmentFetcher.setBehindSessions([...behindSessionsByRole.values()]);
    };

    // Prime the first displayed frame and fire the initial metadata
    // events, matching a real <video> element's loadedmetadata/
    // durationchange/resize timing on first load.
    await scheduler.seek(0);
    shim._dispatch('loadedmetadata');
    shim._dispatch('durationchange');
    shim._dispatch('resize');

    return shim;
}
