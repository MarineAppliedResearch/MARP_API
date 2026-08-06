/**
 * Minimal fake WebCodecs globals (VideoDecoder, EncodedVideoChunk,
 * VideoFrame) for unit-testing gop-decoder.js and frame-store.js under
 * plain Node/Jest, which has none of these as real globals.
 *
 * Deliberately NOT a full WebCodecs polyfill -- only the surface
 * gop-decoder.js actually calls is implemented, kept faithful to the real
 * API's async/callback shape (configure/decode/flush, output/error
 * callbacks, isConfigSupported) so the module under test can't tell the
 * difference at the call-site level.
 *
 * @fileoverview Fake WebCodecs globals for video-engine unit tests.
 * @author Isaac Travers
 * @module video-engine/test/unit/fakes/webcodecs-fakes
 */

/**
 * Fake VideoFrame -- used both for a decoder's raw output (constructed
 * directly by test fixtures) and for the plain-memory frame
 * detachFromHardwareSurface() reconstructs (constructed with the real
 * two-arg `(bufferOrData, init)` shape).
 */
class FakeVideoFrame {
    /**
     * @param {(Object|Uint8Array)} bufferOrInit - A plain fields object (decoder-output path, no second arg) or a pixel buffer (reconstruction path, used together with `init`).
     * @param {Object} [init] - Reconstruction options, matching the real `new VideoFrame(buffer, init)` two-arg form gop-decoder.js's detachFromHardwareSurface() uses.
     */
    constructor(bufferOrInit, init) {
        if (init) {
            this.format = init.format;
            this.displayWidth = init.codedWidth;
            this.displayHeight = init.codedHeight;
            this.timestamp = init.timestamp;
            this.duration = init.duration;
            this.colorSpace = init.colorSpace;
        } else {
            Object.assign(this, bufferOrInit);
        }
        this.closed = false;
    }

    /** @returns {{width: number, height: number}} Matches gop-decoder.js's visibleRect-or-displayWidth/Height fallback logic. */
    get visibleRect() {
        return { width: this.displayWidth, height: this.displayHeight };
    }

    /** @returns {number} Fake 4:2:0 8-bit buffer size, matching the real allocationSize() formula in gop-decoder.js. */
    allocationSize() {
        return Math.ceil(this.displayWidth * this.displayHeight * 1.5);
    }

    /**
     * No-op: the fake has no real pixel data to copy. Real copyTo()
     * writes pixel bytes into the caller's buffer.
     *
     * @async
     * @returns {Promise<void>}
     */
    async copyTo() {}

    /** @returns {void} Marks the fake frame closed, so tests can assert on `.closed`. */
    close() {
        this.closed = true;
    }
}

/**
 * Fake EncodedVideoChunk -- just carries through whatever chunk
 * descriptor gop-decoder.js passes in, so a fake VideoDecoder can read
 * `.timestamp`/`.type` back off it.
 */
class FakeEncodedVideoChunk {
    /** @param {Object} init - Chunk descriptor, as produced by demuxer.js. */
    constructor(init) {
        Object.assign(this, init);
    }
}

/**
 * Fake VideoDecoder. `flush()` synchronously (via a microtask) calls
 * `output(...)` once per queued chunk, using each test's configured
 * `outputForChunk` mapper to control what frame (and what order) comes
 * back out -- this is how tests simulate decode reordering the real
 * decoder would otherwise do internally.
 */
class FakeVideoDecoder {
    /**
     * @param {Object} callbacks
     * @param {function(Object): void} callbacks.output - Invoked once per decoded frame, matching the real VideoDecoder constructor dict.
     * @param {function(Error): void} callbacks.error - Invoked on decode error; unused by the fake today (no test currently forces a decoder-reported error), kept for interface parity with the real constructor dict.
     */
    constructor({ output, error }) {
        this._output = output;
        this._error = error;
        this._queue = [];
        this.state = 'unconfigured';
        this.decodeQueueSize = 0;
    }

    /**
     * Records the config, mirroring the real VideoDecoder#configure --
     * gop-decoder.js only ever checks `.state`, never the config value
     * itself, so this doesn't need to validate anything.
     *
     * @param {Object} config - Codec config, as passed to the real VideoDecoder.
     * @returns {void}
     */
    configure(config) {
        this._config = config;
        this.state = 'configured';
    }

    /**
     * Queues one chunk for the next flush() call, matching the real
     * VideoDecoder#decode's fire-and-forget signature.
     *
     * @param {Object} chunk - A FakeEncodedVideoChunk instance.
     * @returns {void}
     */
    decode(chunk) {
        this._queue.push(chunk);
    }

    /**
     * Emits one output frame per queued chunk, then resolves -- the fake
     * decoder's only real behavior. Each test can override
     * `FakeVideoDecoder.outputForChunk` to control what frame (and in
     * what order) comes back for a given chunk, e.g. to simulate decoded
     * output arriving out of presentation order.
     *
     * @async
     * @returns {Promise<void>}
     */
    async flush() {
        const chunks = this._queue;
        this._queue = [];

        for (const chunk of chunks) {
            const outputForChunk = FakeVideoDecoder.outputForChunk || ((c) => new FakeVideoFrame({ timestamp: c.timestamp, duration: c.duration, displayWidth: 16, displayHeight: 16, format: 'I420' }));
            this._output(outputForChunk(chunk));
        }
    }

    /**
     * Marks the fake decoder closed, matching the real VideoDecoder#close.
     *
     * @returns {void}
     */
    close() {
        this.state = 'closed';
    }
}

/** Static isConfigSupported, matching the real VideoDecoder's API shape -- gop-decoder.js always awaits this before configuring. */
FakeVideoDecoder.isConfigSupported = async () => ({ supported: true });

/**
 * Installs the fake WebCodecs globals, returning a restore function.
 *
 * @returns {function(): void} Call to remove the fakes and restore whatever globals existed before.
 */
function installWebCodecsFakes() {
    const previous = {
        VideoFrame: global.VideoFrame,
        EncodedVideoChunk: global.EncodedVideoChunk,
        VideoDecoder: global.VideoDecoder,
    };

    global.VideoFrame = FakeVideoFrame;
    global.EncodedVideoChunk = FakeEncodedVideoChunk;
    global.VideoDecoder = FakeVideoDecoder;

    return function restore() {
        global.VideoFrame = previous.VideoFrame;
        global.EncodedVideoChunk = previous.EncodedVideoChunk;
        global.VideoDecoder = previous.VideoDecoder;
        delete FakeVideoDecoder.outputForChunk;
    };
}

module.exports = { FakeVideoFrame, FakeEncodedVideoChunk, FakeVideoDecoder, installWebCodecsFakes };
