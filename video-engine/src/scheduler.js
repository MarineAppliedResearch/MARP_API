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

/** Hard cap for paused network prefetch horizon growth, in seconds. */
const MAX_PAUSED_NETWORK_PREFETCH_SECONDS = 60.0;

/** Max number of new raw-prefetch requests to launch per scheduler pass. */
const MAX_NETWORK_PREFETCH_REQUESTS_PER_TICK = 1;

/** Paused-background prefetch cadence, in ms. */
const PAUSED_PREFETCH_INTERVAL_MS = 500;

/** How far paused decode may expand beyond the protected playhead neighborhood, in segments per side. */
const PAUSED_DECODE_EXPANSION_RADIUS = 6;

/** Always protect the current segment plus one neighbor on each side. */
const PROTECTED_PLAYHEAD_SEGMENT_RADIUS = 1;

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
     * @param {function(string, Error=): void} params.emit - Callback for shim event dispatch (e.g. `emit('seeking')`, `emit('playing')`). NOT used for segment fetch/decode failures -- those are reported once each via FrameStore's own `onError` (see its constructor doc comment for why), not through here.
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
        this._presentedMediaTime = 0;
        this._pausedFreezeTime = null;
        this._rafHandle = null;
        this._pausedPrefetchIntervalHandle = null;
        this._pausedPrefetchAnchorWallClockMs = 0;
        this._pausedPrefetchAnchorTime = 0;
        this._lastReverseShownTime = null;
        this._lastReversePresentedSegmentIndex = null;
        this._lastReversePresentedFrameIdx = null;
        this._reverseHoldTickCount = 0;
        this._frameCallbacks = [];
        this._presentedFrameCount = 0;

        // Bumped on every seek() call; a seek that's still awaiting decode
        // when a newer one starts checks this after the await to detect
        // it's been superseded, and abandons its own (now-stale) result
        // instead of clobbering the newer seek's state -- confirmed live
        // that two overlapping seeks (a slow cold-segment one racing a
        // fast already-buffered one) can otherwise complete out of order.
        this._seekGeneration = 0;

        // The previous seek()'s own AbortController, aborted the instant a
        // newer seek() call starts -- releases that seek's "want" on
        // whatever segment it was fetching (see FrameStore.ensureSegment's
        // reference-counted wanters), so a segment nothing else still
        // wants gets its in-flight fetch cancelled immediately instead of
        // completing uselessly. Confirmed live this is the actual cause
        // of a scrub-drag "backlog": every intermediate position used to
        // kick off a real, uncancellable fetch regardless of whether the
        // drag had already moved past it.
        this._seekFetchAbort = null;

        canvasRenderer.onFramePresented(() => this._dispatchFrameCallbacks());
    }

    /** @returns {number} Total stream duration, in seconds. */
    get duration() {
        return this.segmentIndex.totalDuration;
    }

    /** @returns {number} Presentation time of the currently displayed frame, in seconds. */
    get currentTime() {
        if (this._pausedFreezeTime !== null && !this.playing && !this.seekingFlag) {
            return this._pausedFreezeTime;
        }
        return this._presentedMediaTime;
    }

    /**
     * Maps a decoded frame timestamp onto the stream's media timeline for
     * the segment it belongs to.
     *
     * Some streams expose sample timestamps that are offset from HLS
     * segment start times (for example by one full segment duration), so
     * comparing raw frame timestamps directly against playlist time can
     * pin playback to a segment's edge frame after seek. This mapping
     * aligns each decoded segment's first frame to that segment's own
     * startTime, preserving within-segment frame spacing while staying in
     * the playlist timeline the scheduler uses everywhere else.
     *
     * @param {number} segmentIndexNumber - Segment index the frame came from.
     * @param {number} frameTimestampMicros - Decoded frame timestamp, in microseconds.
     * @returns {number} Frame time in the playlist/media timeline, in seconds.
     */
    _frameTimestampToMediaTimeSeconds(segmentIndexNumber, frameTimestampMicros) {
        const segment = this.segmentIndex.segments[segmentIndexNumber];
        const buffer = this.frameStore.buffers.get(segmentIndexNumber);
        const firstFrame = buffer && buffer.frames[0];

        if (!segment || !firstFrame) {
            return frameTimestampMicros / 1e6;
        }

        const offsetMicros = frameTimestampMicros - firstFrame.timestamp;
        return segment.startTime + offsetMicros / 1e6;
    }

    /**
     * Reports every segment's current fetch/decode/pin status, for a
     * scrub-bar visualization -- one entry per segment, in order.
     *
     * @returns {Array<{index: number, startTime: number, endTime: number, fetched: boolean, decoded: boolean, pinned: boolean}>} Per-segment state.
     */
    getSegmentStates() {
        return this.segmentIndex.segments.map((segment) => ({
            index: segment.index,
            startTime: segment.startTime,
            endTime: segment.endTime,
            fetched: this.frameStore.segmentFetcher.hasRawBytes(segment.index),
            decoded: this.frameStore.has(segment.index),
            pinned: this.frameStore.pinned.has(segment.index),
        }));
    }

    /**
     * Returns exact scheduler playhead internals for diagnostics.
     *
     * @returns {{currentSegmentIndex: number, currentFrameIdx: number, currentRawFrameTime: (number|null), currentTime: number, pausedAnchorTime: number, playing: boolean, seeking: boolean}}
     */
    getDebugState() {
        const buffer = this.frameStore.buffers.get(this.currentSegmentIndex);
        const frame = buffer && buffer.frames[this.currentFrameIdx];
        return {
            currentSegmentIndex: this.currentSegmentIndex,
            currentFrameIdx: this.currentFrameIdx,
            currentRawFrameTime: frame ? frame.timestamp / 1e6 : null,
            currentTime: this.currentTime,
            pausedAnchorTime: this._pausedPrefetchAnchorTime,
            playing: this.playing,
            seeking: this.seekingFlag,
        };
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

        // Read the currently presented frame directly from scheduler state.
        const currentBuffer = this.frameStore.buffers.get(this.currentSegmentIndex);
        const currentFrame = currentBuffer && currentBuffer.frames[this.currentFrameIdx];

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
            frameIndex: this.currentFrameIdx,
            rawFrameTime: currentFrame ? currentFrame.timestamp / 1e6 : NaN,
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
        this._stopPausedPrefetchWorker();
        this.playing = true;
        this._anchorWallClockMs = performance.now();
        this._anchorTime = this.currentTime;
        this._pausedFreezeTime = null;
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

        // Freeze paused playhead time immediately.
        this._pausedFreezeTime = this._presentedMediaTime;

        // Freeze paused lookahead around the frame we actually paused on.
        this._resetPausedPrefetchAnchor();

        // Run the same lookahead pipeline playback uses.
        // Start from zero elapsed expansion immediately.
        // Do not wait for the first interval tick.
        this._kickPausedNeighborhoodLookahead(0);
        this._startPausedPrefetchWorker();

        this.emit('pause');
    }

    /**
     * Starts paused background prefetch.
     *
     * @returns {void}
     */
    _startPausedPrefetchWorker() {
        if (this._pausedPrefetchIntervalHandle !== null) {
            return;
        }

        this._pausedPrefetchIntervalHandle = setInterval(() => {
            if (this.playing) {
                this._stopPausedPrefetchWorker();
                return;
            }

            // Expand outward from the paused anchor over wall-clock time.
            // Use the same shared lookahead logic in both directions.
            const elapsedSeconds = (performance.now() - this._pausedPrefetchAnchorWallClockMs) / 1000;
            this._kickPausedNeighborhoodLookahead(elapsedSeconds);
        }, PAUSED_PREFETCH_INTERVAL_MS);
    }

    /**
     * Runs paused lookahead through the shared playback pipeline.
     *
     * This keeps pause/play behavior aligned.
     * Pause expands outward from a fixed center over time.
     *
     * @param {number} elapsedSeconds - Virtual elapsed time since pause.
     * @returns {void}
     */
    _kickPausedNeighborhoodLookahead(elapsedSeconds) {
        const centerTime = this._pausedPrefetchAnchorTime;
        const pausedDecodeSeconds = LOOKAHEAD_SECONDS + elapsedSeconds * 0.5;
        const pausedNetworkSeconds = Math.min(
            MAX_PAUSED_NETWORK_PREFETCH_SECONDS,
            NETWORK_PREFETCH_SECONDS + elapsedSeconds * 2,
        );

        const reversePinned = this._kickLookahead(centerTime, {
            virtualPlaybackRate: -1,
            suppressPinnedUpdate: true,
            protectedCenterTime: centerTime,
            decodeSeconds: pausedDecodeSeconds,
            reverseDecodeSeconds: pausedDecodeSeconds,
            networkSeconds: pausedNetworkSeconds,
            requireRawBytesForExpansion: true,
        }) || [];
        const forwardPinned = this._kickLookahead(centerTime, {
            virtualPlaybackRate: 1,
            suppressPinnedUpdate: true,
            protectedCenterTime: centerTime,
            decodeSeconds: pausedDecodeSeconds,
            networkSeconds: pausedNetworkSeconds,
            requireRawBytesForExpansion: true,
        }) || [];

        const pinned = [...new Set([...reversePinned, ...forwardPinned])].sort((a, b) => a - b);
        this.frameStore.setPinned(pinned);
        if (this.frameStore.segmentFetcher && typeof this.frameStore.segmentFetcher.setProtectedRawSegments === 'function') {
            this.frameStore.segmentFetcher.setProtectedRawSegments(pinned);
        }
    }

    /**
     * Runs lookahead with an explicit virtual direction/magnitude,
     * without mutating live playback state.
     *
     * @param {number} targetTime - Target presentation time, in seconds.
     * @param {number} virtualPlaybackRate - Positive for forward lookahead, negative for reverse lookahead.
     * @returns {void}
     */
    _kickLookaheadWithVirtualRate(targetTime, virtualPlaybackRate) {
        this._kickLookahead(targetTime, { virtualPlaybackRate });
    }

    /**
    * Re-centers paused lookahead around the current media position.
     *
     * @returns {void}
     */
    _resetPausedPrefetchAnchor() {
        this._pausedPrefetchAnchorWallClockMs = performance.now();
        this._pausedPrefetchAnchorTime = this.currentTime;
    }

    /**
     * Stops the paused background prefetch worker, if running.
     *
     * @returns {void}
     */
    _stopPausedPrefetchWorker() {
        if (this._pausedPrefetchIntervalHandle !== null) {
            clearInterval(this._pausedPrefetchIntervalHandle);
            this._pausedPrefetchIntervalHandle = null;
        }
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

        // Guard against pause races mid-tick.
        if (!this.playing) {
            return;
        }

        if (targetTime >= this.duration) {
            targetTime = this.duration;
            hitBoundary = this.playbackRate > 0;
        } else if (targetTime <= 0) {
            targetTime = 0;
            hitBoundary = this.playbackRate < 0;
        }

        const rendered = this._renderAtTime(targetTime, this.playbackRate >= 0 ? 'atOrBefore' : 'atOrAfter');

        // Debug: log only on a stall/resume TRANSITION (not every tick,
        // which would flood the console) -- this pinpoints exactly which
        // segment a stall started/ended on and what's pinned at that
        // moment, for diagnosing the "stops during decode" report without
        // guessing.
        if (rendered !== this._wasRenderedLastTick) {
            const segment = findSegmentForTime(this.segmentIndex, targetTime);
            this.frameStore._logDebug(
                `${rendered ? 'RESUMED' : 'STALLED'} at t=${targetTime.toFixed(2)} segment=${segment.index} ` +
                    `pinned=[${[...this.frameStore.pinned].join(',')}] hasSegment=${this.frameStore.has(segment.index)}`
            );
        }
        this._wasRenderedLastTick = rendered;

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

        // Reverse anomaly trace: emit only on true discontinuities while
        // rewinding, so logs stay low-noise during healthy playback.
        if (this.playbackRate < 0 && rendered) {
            if (typeof this.frameStore._logDebug === 'function') {
                const shownTime = this.currentTime;
                const currentBuffer = this.frameStore.buffers.get(this.currentSegmentIndex);
                const currentFrame = currentBuffer && currentBuffer.frames[this.currentFrameIdx];
                const rawFrameTime = currentFrame ? currentFrame.timestamp / 1e6 : NaN;
                const mapDelta = Number.isFinite(rawFrameTime) ? shownTime - rawFrameTime : NaN;

                if (this._lastReverseShownTime !== null) {
                    const shownDelta = shownTime - this._lastReverseShownTime;

                    // True reverse anomaly signals:
                    // 1) shown time moved forward while rewinding, or
                    // 2) shown time dropped too far in one step.
                    if (shownDelta > 0.005 || shownDelta < -0.20) {
                        this.frameStore._logDebug(
                            `reverse-jump prevShown=${this._lastReverseShownTime.toFixed(3)} ` +
                                `shown=${shownTime.toFixed(3)} shownDelta=${shownDelta.toFixed(3)} ` +
                                `expected=${targetTime.toFixed(3)} raw=${Number.isFinite(rawFrameTime) ? rawFrameTime.toFixed(3) : 'na'} ` +
                                `mapDelta=${Number.isFinite(mapDelta) ? mapDelta.toFixed(3) : 'na'} ` +
                                `segment=${this.currentSegmentIndex} frameIdx=${this.currentFrameIdx}`
                        );
                    }
                }

                this._lastReverseShownTime = shownTime;
            }
        } else if (this.playbackRate >= 0) {
            this._lastReverseShownTime = null;
        }

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
            // isInBackoff() check: this is the actual primary render
            // target, checked on every tick -- confirmed live as the real
            // dominant cause of a retry storm (57 failures in ~2s for one
            // persistently-failing segment) when this was the one call
            // site left un-gated after adding backoff to
            // _kickLookahead/_kickNetworkPrefetch. A stall here already
            // degrades gracefully (last frame stays on screen, see the
            // caller), so skipping a retry while backed off just extends
            // that same graceful stall instead of hammering the request.
            if (!this.frameStore.isInBackoff(segment.index)) {
                // Deliberately NOT .catch((err) => this.emit('error', err))
                // here -- FrameStore reports each real failure exactly once
                // itself (via its own onError, see its constructor doc
                // comment). This call site runs every tick and would
                // otherwise attach a fresh rejection handler to the same
                // shared in-flight promise on each one, all firing together
                // the instant it finally settles.
                this.frameStore.ensureSegment(segment.index).catch(() => {});
            }
            return false;
        }

        const gopBuffer = this.frameStore.buffers.get(segment.index);
        const frameIdx = this._locateFrameIndex(gopBuffer, targetTime, direction, segment.startTime);

        if (segment.index === this.currentSegmentIndex && frameIdx === this.currentFrameIdx) {
            // Reverse playback naturally reuses a frame for a few rAF ticks.
            // Log only when the hold lasts long enough to look suspicious.
            if (direction === 'atOrAfter' && this.playbackRate < 0) {
                this._reverseHoldTickCount += 1;
                if (this._reverseHoldTickCount === 6 && typeof this.frameStore._logDebug === 'function') {
                    this.frameStore._logDebug(
                        `reverse-hold shown=${this.currentTime.toFixed(3)} expected=${targetTime.toFixed(3)} ` +
                            `segment=${segment.index} frameIdx=${frameIdx} holdTicks=${this._reverseHoldTickCount}`
                    );
                }
            }
            return true;
        }

        // Any actual frame change clears the same-frame hold counter.
        this._reverseHoldTickCount = 0;

        const frame = gopBuffer.frames[frameIdx];
        const presented = this.canvasRenderer.render(frame);

        if (presented) {
            // Capture the previous presented frame before updating state.
            const previousSegmentIndex = this.currentSegmentIndex;
            const previousFrameIdx = this.currentFrameIdx;

            this.currentSegmentIndex = segment.index;
            this.currentFrameIdx = frameIdx;
            this._presentedMediaTime = this._frameTimestampToMediaTimeSeconds(segment.index, frame.timestamp);

            // Reverse should usually step backward by one frame at a time.
            // Log larger skips so we can see whether the selector is jumping.
            if (direction === 'atOrAfter' && this.playbackRate < 0 && typeof this.frameStore._logDebug === 'function') {
                if (previousSegmentIndex === segment.index) {
                    const frameIdxDelta = frameIdx - previousFrameIdx;
                    if (frameIdxDelta >= 0 || frameIdxDelta < -3) {
                        this.frameStore._logDebug(
                            `reverse-step expected=${targetTime.toFixed(3)} shown=${this.currentTime.toFixed(3)} ` +
                                `segment=${segment.index} prevFrameIdx=${previousFrameIdx} frameIdx=${frameIdx} ` +
                                `frameIdxDelta=${frameIdxDelta}`
                        );
                    }
                }

                this._lastReversePresentedSegmentIndex = segment.index;
                this._lastReversePresentedFrameIdx = frameIdx;
            }
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
    _locateFrameIndex(gopBuffer, targetTimeSeconds, direction, segmentStartTimeSeconds = 0) {
        // Rounded to the nearest whole microsecond -- frame timestamps are
        // always integers (see demuxer.js), but repeated floating-point
        // arithmetic on targetTimeSeconds (e.g. successive +-1/fps steps)
        // can leave it a fraction of a microsecond above or below an exact
        // frame timestamp. Left unrounded, that tiny overshoot is harmless
        // for an atOrBefore ('<=') comparison but silently breaks an
        // atOrAfter ('>=') comparison exactly on the target frame,
        // confirmed live: stepping back onto an exact prior frame landed
        // one frame later than intended until this rounding was added.
        const firstFrameTimestamp = gopBuffer.frames[0] ? gopBuffer.frames[0].timestamp : 0;
        const targetMicros = firstFrameTimestamp + Math.round((targetTimeSeconds - segmentStartTimeSeconds) * 1e6);
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
     * Returns the fixed decoded neighborhood that must remain protected
     * around a media time's current playhead segment.
     *
     * @param {number} centerTime - Media time to protect around.
     * @returns {number[]} Protected segment indices.
     */
    _getProtectedNeighborhoodIndices(centerTime) {
        const centerSegment = findSegmentForTime(this.segmentIndex, centerTime);
        const indices = [];

        // Keep the current segment.
        // Also keep one segment on either side when available.
        for (
            let index = Math.max(0, centerSegment.index - PROTECTED_PLAYHEAD_SEGMENT_RADIUS);
            index <= Math.min(this.segmentIndex.segments.length - 1, centerSegment.index + PROTECTED_PLAYHEAD_SEGMENT_RADIUS);
            index++
        ) {
            indices.push(index);
        }

        return indices;
    }

    /**
     * Computes the directional decode window for one target time/rate.
     *
     * @param {number} targetTime - Target presentation time, in seconds.
     * @param {number} effectivePlaybackRate - Direction/magnitude for this pass.
     * @returns {{decodeStartIndex: number, decodeEndIndex: number}} Decode window bounds.
     */
    _getDecodeWindowBounds(
        targetTime,
        effectivePlaybackRate,
        lookaheadSeconds = LOOKAHEAD_SECONDS,
        reverseLookaheadSeconds = REVERSE_PREFETCH_MARGIN_SECONDS,
    ) {
        const rateMagnitude = Math.max(1, Math.abs(effectivePlaybackRate));
        const segment = findSegmentForTime(this.segmentIndex, targetTime);

        if (effectivePlaybackRate >= 0) {
            const aheadTime = Math.min(this.duration, targetTime + lookaheadSeconds * rateMagnitude);
            return {
                decodeStartIndex: segment.index,
                decodeEndIndex: findSegmentForTime(this.segmentIndex, aheadTime).index,
            };
        }

        const behindTime = Math.max(0, targetTime - reverseLookaheadSeconds * rateMagnitude);
        return {
            // Reverse playback still needs the prior segment ready first.
            decodeStartIndex: Math.max(0, findSegmentForTime(this.segmentIndex, behindTime).index - 1),
            decodeEndIndex: segment.index,
        };
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
    _kickLookahead(
        targetTime,
        {
            virtualPlaybackRate,
            suppressPinnedUpdate = false,
            protectedCenterTime,
            decodeSeconds = LOOKAHEAD_SECONDS,
            reverseDecodeSeconds = REVERSE_PREFETCH_MARGIN_SECONDS,
            networkSeconds = NETWORK_PREFETCH_SECONDS,
            requireRawBytesForExpansion = false,
        } = {},
    ) {
        const effectivePlaybackRate = virtualPlaybackRate !== undefined ? virtualPlaybackRate : this.playbackRate;
        const rateMagnitude = Math.max(1, Math.abs(effectivePlaybackRate));
        const { decodeStartIndex, decodeEndIndex } = this._getDecodeWindowBounds(
            targetTime,
            effectivePlaybackRate,
            decodeSeconds,
            reverseDecodeSeconds,
        );

        // The protected core stays centered on the current playhead.
        // Expansion beyond it may use only surplus decoded budget.
        const protectionCenterTime = Number.isFinite(protectedCenterTime) ? protectedCenterTime : targetTime;
        const protectedIndices = this._getProtectedNeighborhoodIndices(protectionCenterTime);
        const protectedIndexSet = new Set(protectedIndices);

        // Real FrameStore always exposes maxSegmentsBuffered.
        // Test doubles may omit it, so fall back to "no artificial cap"
        // for those narrow harnesses.
        const maxDecodedBudget = Number.isFinite(this.frameStore.maxSegmentsBuffered)
            ? this.frameStore.maxSegmentsBuffered
            : Number.MAX_SAFE_INTEGER;
        const surplusBudget = Math.max(0, maxDecodedBudget - protectedIndices.length);

        const expansionIndices = [];
        for (let index = decodeStartIndex; index <= decodeEndIndex; index++) {
            if (protectedIndexSet.has(index)) {
                continue;
            }
            expansionIndices.push(index);
        }

        const ensuredIndices = [...protectedIndices, ...expansionIndices.slice(0, surplusBudget)];
        for (const index of ensuredIndices) {
            // isInBackoff() skip: this runs unconditionally on every
            // render-loop tick (dozens of times a second), so a segment
            // that just failed (e.g. a transient upstream 500 before
            // Jellyfin's transcoder finished generating it) would
            // otherwise get hammered with an identical retry on every
            // single tick -- confirmed live this turned one transient
            // failure into 70+ rapid-fire error events. A deliberate
            // seek() to this same segment is unaffected, since it calls
            // ensureSegment() directly rather than through here.
            //
            // Deliberately NOT .catch((err) => this.emit('error', err))
            // -- see _renderAtTime()'s identical comment: FrameStore
            // reports each real failure exactly once itself.
            if (!this.frameStore.has(index) && !this.frameStore.isInBackoff(index)) {
                if (requireRawBytesForExpansion && !protectedIndexSet.has(index)) {
                    const hasRawBytes =
                        this.frameStore.segmentFetcher &&
                        typeof this.frameStore.segmentFetcher.hasRawBytes === 'function' &&
                        this.frameStore.segmentFetcher.hasRawBytes(index);
                    if (!hasRawBytes) {
                        continue;
                    }
                }
                this.frameStore.ensureSegment(index).catch(() => {});
            }
        }
        if (!suppressPinnedUpdate) {
            // Pin only the protected core around the playhead.
            // Expansion segments are opportunistic surplus.
            this.frameStore.setPinned(protectedIndices);

            // Keep raw protection aligned with the active playback window.
            // This prevents local bytes from being aged out underneath decode.
            if (this.frameStore.segmentFetcher && typeof this.frameStore.segmentFetcher.setProtectedRawSegments === 'function') {
                this.frameStore.segmentFetcher.setProtectedRawSegments(protectedIndices);
            }
        }

        this._kickNetworkPrefetch(targetTime, rateMagnitude, decodeStartIndex, decodeEndIndex, effectivePlaybackRate, networkSeconds);
        return protectedIndices;
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
    _kickNetworkPrefetch(targetTime, rateMagnitude, decodeStartIndex, decodeEndIndex, effectivePlaybackRate = this.playbackRate, networkPrefetchSeconds = NETWORK_PREFETCH_SECONDS) {
        let issued = 0;
        if (effectivePlaybackRate >= 0) {
            const networkAheadTime = Math.min(this.duration, targetTime + networkPrefetchSeconds * rateMagnitude);
            const networkEndIndex = findSegmentForTime(this.segmentIndex, networkAheadTime).index;
            for (let index = decodeEndIndex + 1; index <= networkEndIndex; index++) {
                if (!this.frameStore.isInBackoff(index)) {
                    // Deliberately NOT .catch((err) => this.emit('error', err))
                    // -- see _renderAtTime()'s comment: FrameStore reports
                    // each real failure exactly once itself.
                    this.frameStore.prefetchRawBytes(index).catch(() => {});
                    issued++;
                    if (issued >= MAX_NETWORK_PREFETCH_REQUESTS_PER_TICK) {
                        break;
                    }
                }
            }
        } else {
            const networkBehindTime = Math.max(0, targetTime - networkPrefetchSeconds * rateMagnitude);
            const networkStartIndex = Math.max(0, findSegmentForTime(this.segmentIndex, networkBehindTime).index);
            for (let index = decodeStartIndex - 1; index >= networkStartIndex; index--) {
                if (!this.frameStore.isInBackoff(index)) {
                    // Deliberately NOT .catch((err) => this.emit('error', err))
                    // -- see _renderAtTime()'s comment: FrameStore reports
                    // each real failure exactly once itself.
                    this.frameStore.prefetchRawBytes(index).catch(() => {});
                    issued++;
                    if (issued >= MAX_NETWORK_PREFETCH_REQUESTS_PER_TICK) {
                        break;
                    }
                }
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

        // Stop paused filling while we pivot to a new seek target.
        // Otherwise it can keep touching the old neighborhood mid-seek.
        this._stopPausedPrefetchWorker();

        this.seekingFlag = true;
        this.emit('seeking');

        const direction = clamped >= this.currentTime ? 'atOrBefore' : 'atOrAfter';
        const segment = findSegmentForTime(this.segmentIndex, clamped);

        // Register THIS seek's want before releasing the PREVIOUS seek's
        // want -- not the other way around. If both target the same
        // segment (very likely during a real drag, since many pointermove
        // events land within the same ~1-3s segment), releasing the old
        // want first would drop that shared entry's wanter count to zero
        // and cancel its fetch right as this seek was about to depend on
        // it -- confirmed live: this caused spurious "error" events during
        // ordinary drags, since the fetch this seek needed got aborted out
        // from under it by its own predecessor. ensureSegment() runs its
        // registration synchronously (no await before it), so calling it
        // first and aborting the previous controller immediately after,
        // still in the same synchronous tick, guarantees the new want is
        // already counted before the old one can zero it out.
        const seekFetchAbort = new AbortController();
        const previousSeekFetchAbort = this._seekFetchAbort;
        this._seekFetchAbort = seekFetchAbort;

        const ensurePromise = this.frameStore.ensureSegment(segment.index, { signal: seekFetchAbort.signal });
        if (previousSeekFetchAbort) {
            previousSeekFetchAbort.abort();
        }

        try {
            await ensurePromise;
        } catch (err) {
            if (seekFetchAbort.signal.aborted) {
                // Superseded by a newer seek before this one's fetch
                // finished -- abandon silently, not a real failure.
                return;
            }
            throw err;
        }

        if (seekToken !== this._seekGeneration) {
            // A newer seek was requested while this one was awaiting decode
            // -- abandon this now-stale result rather than overwriting the
            // newer seek's (possibly already-applied) state.
            return;
        }

        const gopBuffer = this.frameStore.buffers.get(segment.index);
        const frameIdx = this._locateFrameIndex(gopBuffer, clamped, direction, segment.startTime);
        const frame = gopBuffer.frames[frameIdx];

        this.canvasRenderer.render(frame);
        this.currentSegmentIndex = segment.index;
        this.currentFrameIdx = frameIdx;
        this._presentedMediaTime = this._frameTimestampToMediaTimeSeconds(segment.index, frame.timestamp);
        if (!this.playing) {
            this._pausedFreezeTime = this._presentedMediaTime;
        }

        // Re-anchor so continued playback (if active) resumes from here.
        this._anchorWallClockMs = performance.now();
        this._anchorTime = this.currentTime;

        // After the seek lands, update the paused anchor immediately.
        this._resetPausedPrefetchAnchor();

        if (!this.playing) {
            this._pausedFreezeTime = this._presentedMediaTime;
            // While paused, keep using the shared lookahead pipeline.
            // The paused anchor stays fixed while the virtual targets expand.
            this._kickPausedNeighborhoodLookahead(0);
        } else {
            this._pausedFreezeTime = null;
            // While playing, resume ordinary directional lookahead.
            // Seek should not switch us into paused-fill behavior.
            this._kickLookahead(this.currentTime);
        }

        if (!this.playing) {
            this._startPausedPrefetchWorker();
        }

        this.seekingFlag = false;
        this.emit('seeked');
    }

    /**
     * Stops playback. Called when the engine is torn down.
     *
     * @returns {void}
     */
    close() {
        this._stopPausedPrefetchWorker();
        this.pause();
    }
}
