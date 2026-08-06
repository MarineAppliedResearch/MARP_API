/**
 * The core playback engine: two decoupled loops (decode-ahead, and a
 * requestAnimationFrame-paced render loop), plus seek handling shared by
 * every `currentTime` write.
 *
 * A 1-frame key-nudge and a slider-release seek both go through the exact
 * same seek path, resolving near-instantly whenever the target segment is
 * already buffered (always true for a small nudge). Does NOT force a
 * pause on seek: confirmed against the real app's skipFrames() key
 * handler, which nudges Position while playback may still be active. If
 * playing, the render loop simply re-anchors its wall-clock reference to
 * the new position and continues from there.
 *
 * @fileoverview Forward/reverse playback pacing, seeking, and lookahead-prefetch orchestration.
 * @author Isaac Travers
 * @module video-engine/scheduler
 */

import { findSegmentForTime } from './playlist-manager.js';

/** Decode-ahead window, in seconds at 1x -- scaled by |playbackRate| at higher speeds. */
const LOOKAHEAD_SECONDS = 2.0;

/** Reverse-playback prefetch margin, in seconds at 1x -- scaled by |playbackRate|. */
const REVERSE_PREFETCH_MARGIN_SECONDS = 0.5;

/**
 * Wider, network-only prefetch window (raw bytes only, no demux/decode),
 * in seconds at 1x -- scaled by |playbackRate|, deliberately larger than
 * LOOKAHEAD_SECONDS. A slow network's fetch time is independent of local
 * decode speed, so once decode catches up to the LOOKAHEAD_SECONDS
 * radius it would otherwise have to wait on a fetch that hasn't even
 * started yet -- this radius exists purely to have already-fetched bytes
 * sitting in SegmentFetcher's raw-bytes cache by the time decode needs them.
 */
const NETWORK_PREFETCH_SECONDS = 8.0;

/**
 * Drives forward/reverse pacing, seeking, and lookahead prefetch against
 * a FrameStore, rendering through a CanvasRenderer.
 *
 * @class Scheduler
 */
export class Scheduler {
    /**
     * @param {Object} params
     * @param {Object} params.segmentIndex - SegmentIndex from {@link module:video-engine/playlist-manager.loadSegmentIndex}.
     * @param {Object} params.frameStore - {@link module:video-engine/frame-store.FrameStore} instance.
     * @param {Object} params.canvasRenderer - {@link module:video-engine/canvas-renderer.CanvasRenderer} instance.
     * @param {function(string, Error=): void} params.emit - Callback for shim event dispatch (e.g. `emit('seeking')`, `emit('error', err)`).
     */
    constructor({ segmentIndex, frameStore, canvasRenderer, emit }) {
        this.segmentIndex = segmentIndex;
        this.frameStore = frameStore;
        this.canvasRenderer = canvasRenderer;
        this.emit = emit;

        this.playbackRate = 1;
        this.playing = false;
        this.seekingFlag = false;

        // Current frame is always an exact (segmentIndex, frameIdx) pair,
        // never a floating-point time re-snapped each tick -- avoids the
        // rounding drift that would otherwise accumulate across many steps.
        this.currentSegmentIndex = 0;
        this.currentFrameIdx = 0;

        this._anchorWallClockMs = 0;
        this._anchorTime = 0;
        this._rafHandle = null;
        this._frameCallbacks = [];
        this._presentedFrameCount = 0;

        // Bumped on every seek() call; a seek that's still awaiting decode
        // when a newer one starts checks this after the await to detect
        // it's been superseded, and abandons its own (now-stale) result
        // instead of clobbering the newer seek's state -- confirmed live
        // that two overlapping seeks (a slow cold-segment one racing a
        // fast already-buffered one) can otherwise complete out of order.
        this._seekGeneration = 0;

        canvasRenderer.onFramePresented(() => this._dispatchFrameCallbacks());
    }

    /** @returns {number} Total stream duration, in seconds. */
    get duration() {
        return this.segmentIndex.totalDuration;
    }

    /** @returns {number} Presentation time of the currently displayed frame, in seconds. */
    get currentTime() {
        const buffer = this.frameStore.buffers.get(this.currentSegmentIndex);
        const frame = buffer && buffer.frames[this.currentFrameIdx];
        return frame ? frame.timestamp / 1e6 : this._anchorTime;
    }

    /**
     * Registers a one-shot callback for the next presented frame,
     * matching the real requestVideoFrameCallback contract (callers must
     * re-register themselves each time to keep receiving frames).
     *
     * @param {function(number, Object): void} callback - Invoked with `(now, metadata)` on the next presented frame.
     * @returns {symbol} Handle usable with {@link Scheduler#cancelVideoFrameCallback}.
     */
    requestVideoFrameCallback(callback) {
        const handle = Symbol('marpVideoFrameCallback');
        this._frameCallbacks.push({ handle, callback });
        return handle;
    }

    /**
     * Cancels a pending frame callback registered via
     * {@link Scheduler#requestVideoFrameCallback}.
     *
     * @param {symbol} handle - Handle returned by requestVideoFrameCallback.
     * @returns {void}
     */
    cancelVideoFrameCallback(handle) {
        this._frameCallbacks = this._frameCallbacks.filter((entry) => entry.handle !== handle);
    }

    /**
     * Fires every pending frame callback exactly once, with metadata
     * describing the just-presented frame. The single choke point for
     * requestVideoFrameCallback dispatch, regardless of which mode
     * (forward/reverse/step/seek) presented the frame.
     *
     * @returns {void}
     */
    _dispatchFrameCallbacks() {
        if (this._frameCallbacks.length === 0) {
            return;
        }

        const toFire = this._frameCallbacks;
        this._frameCallbacks = [];
        this._presentedFrameCount += 1;

        const metadata = {
            mediaTime: this.currentTime,
            presentedFrames: this._presentedFrameCount,
            expectedDisplayTime: performance.now() + 16.6,
            presentationTime: performance.now(),
            width: this.canvasRenderer.canvas.width,
            height: this.canvasRenderer.canvas.height,
            // Not part of the real requestVideoFrameCallback contract --
            // an additive extra field (like marpVideo.fps) purely for
            // diagnostics, so callers can tell which segment is currently
            // driving playback without reaching into engine internals.
            segmentIndex: this.currentSegmentIndex,
        };

        const now = performance.now();
        for (const { callback } of toFire) {
            callback(now, metadata);
        }
    }

    /**
     * Starts (or resumes) playback at the current `playbackRate`.
     *
     * @returns {void}
     */
    play() {
        if (this.playing) {
            return;
        }
        this.playing = true;
        this._anchorWallClockMs = performance.now();
        this._anchorTime = this.currentTime;
        this.emit('playing');
        this._scheduleTick();
    }

    /**
     * Pauses playback deterministically.
     *
     * @returns {void}
     */
    pause() {
        if (!this.playing) {
            return;
        }
        this.playing = false;
        if (this._rafHandle !== null) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }
        this.emit('pause');
    }

    /**
     * Sets the playback rate, accepting negative values for reverse and
     * small magnitudes for slow motion.
     *
     * Re-anchors the wall-clock reference so the new rate takes effect
     * from "now" rather than from the original anchor point, which would
     * otherwise jump the position the instant the next tick runs.
     *
     * @param {number} rate - New playback rate (negative plays in reverse).
     * @returns {void}
     */
    setPlaybackRate(rate) {
        if (this.playing) {
            this._anchorWallClockMs = performance.now();
            this._anchorTime = this.currentTime;
        }
        this.playbackRate = rate;
    }

    /**
     * Schedules the next render-loop tick.
     *
     * @returns {void}
     */
    _scheduleTick() {
        this._rafHandle = requestAnimationFrame((now) => this._tick(now));
    }

    /**
     * One render-loop tick: computes the target presentation time from
     * the wall-clock anchor and playbackRate, renders it if buffered,
     * kicks off lookahead decode, and reschedules itself.
     *
     * @param {number} now - `performance.now()`-style timestamp from requestAnimationFrame.
     * @returns {void}
     */
    _tick(now) {
        if (!this.playing) {
            return;
        }

        const elapsedSeconds = (now - this._anchorWallClockMs) / 1000;
        let targetTime = this._anchorTime + elapsedSeconds * this.playbackRate;
        let hitBoundary = false;

        if (targetTime >= this.duration) {
            targetTime = this.duration;
            hitBoundary = true;
        } else if (targetTime <= 0) {
            targetTime = 0;
            hitBoundary = true;
        }

        const rendered = this._renderAtTime(targetTime, this.playbackRate >= 0 ? 'atOrBefore' : 'atOrAfter');

        if (!rendered) {
            // Stalled: the needed segment isn't decoded yet. Re-anchor to
            // the last actually-displayed position now, rather than
            // leaving the anchor where it was -- otherwise elapsed wall-
            // clock time during the stall keeps inflating targetTime on
            // every subsequent tick, so by the time decode catches up the
            // engine believes it should already be several segments
            // further along than anything it's shown. Confirmed live:
            // without this, a single stall triggers a burst of lookahead
            // fetches for far-ahead segments instead of the next one, and
            // playback skips/stutters trying to catch up to a target that
            // was never really reachable in real time.
            this._anchorWallClockMs = now;
            this._anchorTime = this.currentTime;
        }

        this._kickLookahead(rendered ? targetTime : this.currentTime);

        if (hitBoundary) {
            this.pause();
            return;
        }

        if (this.playing) {
            this._scheduleTick();
        }
    }

    /**
     * Renders the frame at-or-before (forward) or at-or-after (reverse)
     * the given time, if its segment is already buffered.
     *
     * Never blocks the render loop on decode -- if the segment isn't
     * ready, the last displayed frame stays on screen (a graceful stall)
     * while lookahead decode catches up in the background.
     *
     * @param {number} targetTime - Target presentation time, in seconds.
     * @param {('atOrBefore'|'atOrAfter')} direction - Which side of targetTime to prefer when landing between frames.
     * @returns {boolean} False if the needed segment isn't decoded yet (a stall); true otherwise, whether or not a new frame was actually presented.
     */
    _renderAtTime(targetTime, direction) {
        const segment = findSegmentForTime(this.segmentIndex, targetTime);

        if (!this.frameStore.has(segment.index)) {
            this.frameStore.ensureSegment(segment.index).catch((err) => this.emit('error', err));
            return false;
        }

        const gopBuffer = this.frameStore.buffers.get(segment.index);
        const frameIdx = this._locateFrameIndex(gopBuffer, targetTime, direction);

        if (segment.index === this.currentSegmentIndex && frameIdx === this.currentFrameIdx) {
            return true;
        }

        const frame = gopBuffer.frames[frameIdx];
        const presented = this.canvasRenderer.render(frame);

        if (presented) {
            this.currentSegmentIndex = segment.index;
            this.currentFrameIdx = frameIdx;
        }

        return true;
    }

    /**
     * Finds the index within a GopBuffer's frames closest to a target
     * time, on the requested side (at-or-before for forward playback,
     * at-or-after for reverse) -- a deterministic tie-break so a given
     * target time always lands on the same frame regardless of how it
     * was reached.
     *
     * @param {Object} gopBuffer - Decoded segment buffer (`{segmentIndex, frames}`).
     * @param {number} targetTimeSeconds - Target time, in seconds.
     * @param {('atOrBefore'|'atOrAfter')} direction - Which side of targetTime to prefer.
     * @returns {number} Index into `gopBuffer.frames`.
     */
    _locateFrameIndex(gopBuffer, targetTimeSeconds, direction) {
        // Rounded to the nearest whole microsecond -- frame timestamps are
        // always integers (see demuxer.js), but repeated floating-point
        // arithmetic on targetTimeSeconds (e.g. successive +-1/fps steps)
        // can leave it a fraction of a microsecond above or below an exact
        // frame timestamp. Left unrounded, that tiny overshoot is harmless
        // for an atOrBefore ('<=') comparison but silently breaks an
        // atOrAfter ('>=') comparison exactly on the target frame,
        // confirmed live: stepping back onto an exact prior frame landed
        // one frame later than intended until this rounding was added.
        const targetMicros = Math.round(targetTimeSeconds * 1e6);
        const frames = gopBuffer.frames;

        if (direction === 'atOrBefore') {
            let idx = 0;
            for (let i = 0; i < frames.length; i++) {
                if (frames[i].timestamp <= targetMicros) {
                    idx = i;
                } else {
                    break;
                }
            }
            return idx;
        }

        let idx = frames.length - 1;
        for (let i = frames.length - 1; i >= 0; i--) {
            if (frames[i].timestamp >= targetMicros) {
                idx = i;
            } else {
                break;
            }
        }
        return idx;
    }

    /**
     * Kicks off decode for every segment the current playback direction
     * will need next (not just the near/far edge of the lookahead window
     * -- at high |playbackRate| the window can span several segments, and
     * every one of them needs decoding, not only the last one), updates
     * FrameStore's eviction-pinned set to match, and separately kicks off
     * a wider, network-only raw-byte prefetch beyond the decode radius.
     *
     * @param {number} targetTime - Current target presentation time, in seconds.
     * @returns {void}
     */
    _kickLookahead(targetTime) {
        const rateMagnitude = Math.max(1, Math.abs(this.playbackRate));
        const segment = findSegmentForTime(this.segmentIndex, targetTime);

        let decodeStartIndex;
        let decodeEndIndex;

        if (this.playbackRate >= 0) {
            const aheadTime = Math.min(this.duration, targetTime + LOOKAHEAD_SECONDS * rateMagnitude);
            decodeStartIndex = segment.index;
            decodeEndIndex = findSegmentForTime(this.segmentIndex, aheadTime).index;
        } else {
            const behindTime = Math.max(0, targetTime - REVERSE_PREFETCH_MARGIN_SECONDS * rateMagnitude);
            // One segment earlier than behindTime's own segment: reverse
            // playback needs the PRIOR segment decoded before arriving at
            // its boundary, not after, so decode isn't starting from zero
            // the instant playback crosses into it.
            decodeStartIndex = Math.max(0, findSegmentForTime(this.segmentIndex, behindTime).index - 1);
            decodeEndIndex = segment.index;
        }

        const pinned = [];
        for (let index = decodeStartIndex; index <= decodeEndIndex; index++) {
            pinned.push(index);
            if (!this.frameStore.has(index)) {
                this.frameStore.ensureSegment(index).catch((err) => this.emit('error', err));
            }
        }
        this.frameStore.setPinned(pinned);

        this._kickNetworkPrefetch(targetTime, rateMagnitude, decodeStartIndex, decodeEndIndex);
    }

    /**
     * Fetches raw bytes only (no demux/decode) for segments beyond the
     * decode lookahead radius already handled by _kickLookahead, up to
     * NETWORK_PREFETCH_SECONDS -- SegmentFetcher's own raw-bytes cache
     * makes repeat calls for an already-fetched segment a no-op, so this
     * is safe to call unconditionally on every tick.
     *
     * @param {number} targetTime - Current target presentation time, in seconds.
     * @param {number} rateMagnitude - |playbackRate|, floored at 1.
     * @param {number} decodeStartIndex - First segment index already covered by the decode radius.
     * @param {number} decodeEndIndex - Last segment index already covered by the decode radius.
     * @returns {void}
     */
    _kickNetworkPrefetch(targetTime, rateMagnitude, decodeStartIndex, decodeEndIndex) {
        if (this.playbackRate >= 0) {
            const networkAheadTime = Math.min(this.duration, targetTime + NETWORK_PREFETCH_SECONDS * rateMagnitude);
            const networkEndIndex = findSegmentForTime(this.segmentIndex, networkAheadTime).index;
            for (let index = decodeEndIndex + 1; index <= networkEndIndex; index++) {
                this.frameStore.prefetchRawBytes(index).catch((err) => this.emit('error', err));
            }
        } else {
            const networkBehindTime = Math.max(0, targetTime - NETWORK_PREFETCH_SECONDS * rateMagnitude);
            const networkStartIndex = Math.max(0, findSegmentForTime(this.segmentIndex, networkBehindTime).index);
            for (let index = decodeStartIndex - 1; index >= networkStartIndex; index--) {
                this.frameStore.prefetchRawBytes(index).catch((err) => this.emit('error', err));
            }
        }
    }

    /**
     * Handles a currentTime write -- shared by frame-step key nudges and
     * slider commit-on-release seeks alike (see the module doc comment).
     *
     * @async
     * @param {number} targetTimeSeconds - Requested time, in seconds (clamped to [0, duration]).
     * @returns {Promise<void>}
     */
    async seek(targetTimeSeconds) {
        const clamped = Math.max(0, Math.min(this.duration, targetTimeSeconds));
        const seekToken = ++this._seekGeneration;

        this.seekingFlag = true;
        this.emit('seeking');

        const direction = clamped >= this.currentTime ? 'atOrBefore' : 'atOrAfter';
        const segment = findSegmentForTime(this.segmentIndex, clamped);

        await this.frameStore.ensureSegment(segment.index);

        if (seekToken !== this._seekGeneration) {
            // A newer seek was requested while this one was awaiting decode
            // -- abandon this now-stale result rather than overwriting the
            // newer seek's (possibly already-applied) state.
            return;
        }

        const gopBuffer = this.frameStore.buffers.get(segment.index);
        const frameIdx = this._locateFrameIndex(gopBuffer, clamped, direction);
        const frame = gopBuffer.frames[frameIdx];

        this.canvasRenderer.render(frame);
        this.currentSegmentIndex = segment.index;
        this.currentFrameIdx = frameIdx;

        // Re-anchor so continued playback (if active) resumes from here.
        this._anchorWallClockMs = performance.now();
        this._anchorTime = this.currentTime;

        this.seekingFlag = false;
        this.emit('seeked');
    }

    /**
     * Stops playback. Called when the engine is torn down.
     *
     * @returns {void}
     */
    close() {
        this.pause();
    }
}
