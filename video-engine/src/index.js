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
import { SegmentFetcher } from './segment-fetcher.js';
import { demuxSegment } from './demuxer.js';
import { GopDecoder } from './gop-decoder.js';
import { FrameStore } from './frame-store.js';
import { Scheduler } from './scheduler.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { MarpVideoShim } from './marp-video-shim.js';
import { attachWebView2Bridge } from './webview2-bridge.js';

export { attachWebView2Bridge };

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
 * @param {number} [options.cacheBudgetBytes] - Decoded-frame LRU cache budget in bytes. Default 1 GiB.
 * @returns {Promise<Object>} A {@link module:video-engine/marp-video-shim.MarpVideoShim} instance.
 * @throws {Error} When the stream can't be loaded or the first segment decodes zero frames.
 */
export async function createMarpVideoEngine(canvas, options) {
    const { streamUrl, fetchOptions, cacheBudgetBytes } = options;

    // Logged at each stage (not just on final success/failure) so a stall
    // in any one step -- e.g. a hung fetch() -- is immediately localized
    // instead of looking like total silence.
    console.log('[video-engine] loading playlist...');
    const segmentIndex = await loadSegmentIndex(streamUrl, { fetchOptions });
    console.log(`[video-engine] playlist loaded: ${segmentIndex.segments.length} segments, ${segmentIndex.totalDuration.toFixed(3)}s`);

    const segmentFetcher = new SegmentFetcher(segmentIndex);
    const gopDecoder = new GopDecoder();

    // Demux+decode the first segment up front, both to display an initial
    // frame and to learn the real negotiated width/height/fps the LRU
    // cache's memory-budget formula needs -- never guessed/hardcoded.
    console.log('[video-engine] fetching init + first segment...');
    const initBuffer = await segmentFetcher.fetchInitSegment();
    const firstSegmentBuffer = await segmentFetcher.fetchSegment(0);

    console.log('[video-engine] demuxing first segment...');
    const firstDemux = await demuxSegment(initBuffer, firstSegmentBuffer);

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

    let shim = null;
    const frameStore = new FrameStore({
        segmentFetcher,
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
        emit: (type, err) => {
            if (err) {
                console.error(`Scheduler emitted "${type}" with error`, err);
            }
            if (shim) {
                // Forward the real error through to listeners (e.g. the
                // WebView2 bridge) -- background lookahead/prefetch
                // failures dispatch 'error' this way too, not just a
                // direct currentTime-setter rejection.
                shim._dispatch(type, err ? { error: err } : undefined);
            }
        },
    });

    shim = new MarpVideoShim(scheduler, { videoWidth, videoHeight, fps });

    // Prime the first displayed frame and fire the initial metadata
    // events, matching a real <video> element's loadedmetadata/
    // durationchange/resize timing on first load.
    await scheduler.seek(0);
    shim._dispatch('loadedmetadata');
    shim._dispatch('durationchange');
    shim._dispatch('resize');

    return shim;
}
