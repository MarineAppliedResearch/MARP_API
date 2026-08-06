/**
 * The window.marpVideo facade -- implements the exact surface
 * MareMediaElement.xaml.cs drives today, verbatim, backed by the
 * Scheduler/CanvasRenderer/FrameStore pipeline instead of a real
 * HTMLVideoElement.
 *
 * A plain JS object with a minimal custom EventTarget-like implementation,
 * not a real DOM node -- the engine renders to <canvas>, so there's no
 * underlying element to inherit real EventTarget/HTMLMediaElement
 * behavior from.
 *
 * @fileoverview window.marpVideo-compatible facade over the Scheduler.
 * @author Isaac Travers
 * @module video-engine/marp-video-shim
 */

/**
 * @class MarpVideoShim
 */
export class MarpVideoShim {
    /**
     * @param {Object} scheduler - {@link module:video-engine/scheduler.Scheduler} instance.
     * @param {Object} streamInfo
     * @param {number} streamInfo.videoWidth - Real negotiated video width.
     * @param {number} streamInfo.videoHeight - Real negotiated video height.
     * @param {number} streamInfo.fps - Real negotiated frame rate, measured from the first decoded segment -- not a HTMLVideoElement-standard property, but callers (e.g. a frame-step control) need it and it must never be guessed/hardcoded.
     */
    constructor(scheduler, { videoWidth, videoHeight, fps }) {
        this._scheduler = scheduler;
        this._listeners = new Map();

        this.videoWidth = videoWidth;
        this.videoHeight = videoHeight;
        this.fps = fps;
        this.volume = 1;
        this.muted = false;

        // Audio decode/playback isn't implemented yet (planned as its own
        // later phase: plain playback at 1x forward, muted at any other
        // rate, since reverse/time-shifted audio isn't meaningful the way
        // reverse video is) -- these exist only so C#'s
        // `window.marpVideo.volume = ...; window.marpVideo.muted = ...;`
        // calls don't throw in the meantime. Otherwise inert until then.

        // Simplified: the shim is only ever constructed once the first
        // segment is already decoded and displayed, so it's always
        // "ready enough" -- there's no partial-load state to model.
        this.readyState = 4;
    }

    /** @returns {number} Current displayed frame's presentation time, in seconds. */
    get currentTime() {
        return this._scheduler.currentTime;
    }

    /** @param {number} value - Seek target, in seconds. */
    set currentTime(value) {
        this._scheduler.seek(value).catch((err) => this._dispatchError(err));
    }

    /** @returns {number} Total stream duration, in seconds. */
    get duration() {
        return this._scheduler.duration;
    }

    /** @returns {boolean} True if playback is paused. */
    get paused() {
        return !this._scheduler.playing;
    }

    /** @returns {boolean} True while a seek is in progress. */
    get seeking() {
        return this._scheduler.seekingFlag;
    }

    /** @returns {number} Current playback rate. */
    get playbackRate() {
        return this._scheduler.playbackRate;
    }

    /** @param {number} rate - New playback rate; negative values play in reverse. */
    set playbackRate(rate) {
        this._scheduler.setPlaybackRate(rate);
    }

    /**
     * Starts or resumes playback.
     *
     * @returns {void}
     */
    play() {
        this._scheduler.play();
    }

    /**
     * Pauses playback deterministically.
     *
     * @returns {void}
     */
    pause() {
        this._scheduler.pause();
    }

    /**
     * Registers a one-shot callback for the next presented frame,
     * matching the real HTMLVideoElement API -- callers must re-register
     * themselves each time to keep receiving frames.
     *
     * @param {function(number, Object): void} callback - Invoked with `(now, metadata)`.
     * @returns {symbol} Handle usable with {@link MarpVideoShim#cancelVideoFrameCallback}.
     */
    requestVideoFrameCallback(callback) {
        return this._scheduler.requestVideoFrameCallback(callback);
    }

    /**
     * Cancels a pending frame callback.
     *
     * @param {symbol} handle - Handle returned by requestVideoFrameCallback.
     * @returns {void}
     */
    cancelVideoFrameCallback(handle) {
        this._scheduler.cancelVideoFrameCallback(handle);
    }

    /**
     * Registers an event listener. Supported types: loadedmetadata,
     * durationchange, resize, error, playing, pause, seeking, seeked.
     *
     * @param {string} type - Event type.
     * @param {function(Object): void} callback - Listener, invoked with `{type, target}`.
     * @returns {void}
     */
    addEventListener(type, callback) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(callback);
    }

    /**
     * Removes a previously registered event listener.
     *
     * @param {string} type - Event type.
     * @param {function(Object): void} callback - Listener to remove.
     * @returns {void}
     */
    removeEventListener(type, callback) {
        if (this._listeners.has(type)) {
            this._listeners.get(type).delete(callback);
        }
    }

    /**
     * Dispatches an event to every listener registered for `type`.
     *
     * @param {string} type - Event type to dispatch.
     * @returns {void}
     */
    _dispatch(type) {
        const set = this._listeners.get(type);
        if (!set) {
            return;
        }
        for (const callback of set) {
            try {
                callback({ type, target: this });
            } catch (err) {
                console.error(`marpVideo listener for "${type}" threw`, err);
            }
        }
    }

    /**
     * Logs an internal error and dispatches the `error` event.
     *
     * @param {Error} err - The error that occurred.
     * @returns {void}
     */
    _dispatchError(err) {
        console.error('MarpVideoShim error', err);
        this._dispatch('error');
    }

    /**
     * Tears down the underlying playback engine.
     *
     * @returns {void}
     */
    close() {
        this._scheduler.close();
    }
}
