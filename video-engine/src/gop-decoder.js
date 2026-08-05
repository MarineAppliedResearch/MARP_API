/**
 * Owns one persistent WebCodecs VideoDecoder instance and decodes a
 * segment's demuxed chunks forward into an ordered GopBuffer of VideoFrame
 * objects.
 *
 * Decode requests are serialized through an internal queue since only one
 * VideoDecoder is used: WebCodecs decodes are strictly ordered, so mixing
 * chunks from two unrelated GOPs into the queue without a flush() barrier
 * between them would make frame-to-segment attribution ambiguous. Each
 * segment is keyframe-aligned (confirmed via Jellyfin's
 * BreakOnNonKeyFrames=False policy), so decoding segments out of order
 * through the same decoder instance is safe -- every GOP fully resets
 * decode state via its leading IDR frame.
 *
 * @fileoverview WebCodecs VideoDecoder wrapper producing one ordered GopBuffer per segment.
 * @author Isaac Travers
 * @module video-engine/gop-decoder
 */

/** Max time to wait for a segment's flush() before treating it as a stalled decoder, in ms. */
const DECODE_WATCHDOG_MS = 8000;

/**
 * Decodes segments into GopBuffers via one shared, serialized
 * VideoDecoder instance.
 *
 * @class GopDecoder
 */
export class GopDecoder {
    constructor() {
        this._decoder = null;
        this._currentConfigKey = null;
        this._currentSink = null; // (frame) => void, set per active decode call
        this._currentErrorHandler = null; // (err) => void, set per active decode call
        this._queue = Promise.resolve();
    }

    /**
     * Decodes one segment. Concurrent calls are serialized behind the
     * internal queue rather than run in parallel, since only one
     * VideoDecoder instance is used.
     *
     * @param {number} segmentIndexNumber - Segment index this GOP belongs to.
     * @param {Object} demuxResult - Result of {@link module:video-engine/demuxer.demuxSegment}.
     * @returns {Promise<{segmentIndex: number, frames: Array<VideoFrame>}>} The decoded GopBuffer.
     * @throws {Error} When the segment's first chunk is not a keyframe, or the codec config is unsupported.
     */
    decodeSegment(segmentIndexNumber, demuxResult) {
        const result = this._queue.then(() => this._decodeSegmentNow(segmentIndexNumber, demuxResult));

        // Keep the queue alive even if this segment's decode fails, so a
        // later, unrelated segment isn't blocked by this one's rejection.
        this._queue = result.then(
            () => undefined,
            () => undefined
        );

        return result;
    }

    /**
     * Performs one segment's decode -- only ever run one at a time, via
     * the queue in {@link GopDecoder#decodeSegment}.
     *
     * @async
     * @param {number} segmentIndexNumber - Segment index this GOP belongs to.
     * @param {Object} demuxResult - Result of {@link module:video-engine/demuxer.demuxSegment}.
     * @returns {Promise<{segmentIndex: number, frames: Array<VideoFrame>}>} The decoded GopBuffer.
     * @throws {Error} When the segment's first chunk is not a keyframe, the decoder reports an error, or the decoder stalls past the watchdog timeout.
     */
    async _decodeSegmentNow(segmentIndexNumber, demuxResult) {
        const { codec, description, chunks } = demuxResult;

        if (chunks.length === 0 || chunks[0].type !== 'key') {
            throw new Error(
                `Segment ${segmentIndexNumber}'s first chunk is not a keyframe -- cannot decode independently ` +
                    `(caller must merge in the previous segment's chunks first).`
            );
        }

        await this._ensureConfigured(codec, description);

        const frames = [];
        this._currentSink = (frame) => frames.push(frame);

        // A decode error asynchronously closes the decoder without ever
        // settling a pending flush() promise -- confirmed live (flush()
        // hangs forever after the error callback fires). Race flush()
        // against an error signal so a bad segment rejects instead of
        // stalling the engine forever.
        const errorPromise = new Promise((_, reject) => {
            this._currentErrorHandler = (err) => reject(err);
        });

        // Belt-and-suspenders watchdog: confirmed live that a platform's
        // WebCodecs decoder can stall on some encoded input with NEITHER a
        // resolved flush() NOR a fired error callback (observed specifically
        // with hardware-accelerated decode on at least one real machine,
        // not reproduced with software/SwiftShader decode) -- there is no
        // spec-guaranteed signal to wait for in that case, so a timeout is
        // the only way to turn a silent, permanent hang into a real,
        // actionable error instead.
        let watchdogHandle;
        const watchdogPromise = new Promise((_, reject) => {
            watchdogHandle = setTimeout(() => {
                reject(
                    new Error(
                        `VideoDecoder stalled decoding segment ${segmentIndexNumber}: flush() did not settle within ` +
                            `${DECODE_WATCHDOG_MS}ms (decodeQueueSize=${this._decoder.decodeQueueSize}, ` +
                            `state=${this._decoder.state}, framesOutputSoFar=${frames.length}). No error callback fired -- ` +
                            `this looks like a platform/hardware decoder stall, not a demux/config problem.`
                    )
                );
            }, DECODE_WATCHDOG_MS);
        });

        for (const chunk of chunks) {
            this._decoder.decode(new EncodedVideoChunk(chunk));
        }

        const flushPromise = this._decoder.flush();
        flushPromise.catch(() => {}); // avoid an unhandled rejection if it settles after we've already raced away

        try {
            await Promise.race([flushPromise, errorPromise, watchdogPromise]);
        } finally {
            clearTimeout(watchdogHandle);
            this._currentSink = null;
            this._currentErrorHandler = null;
        }

        frames.sort((a, b) => a.timestamp - b.timestamp);

        return { segmentIndex: segmentIndexNumber, frames };
    }

    /**
     * Ensures the shared VideoDecoder is configured for the given codec,
     * reconfiguring (closing and recreating) only when the config
     * actually changed.
     *
     * @async
     * @param {string} codec - RFC 6381 codec string (e.g. `avc1.4D4028`).
     * @param {Uint8Array|null} description - Codec description bytes (avcC/hvcC payload), if any.
     * @returns {Promise<void>}
     * @throws {Error} When VideoDecoder.isConfigSupported reports the config unsupported.
     */
    async _ensureConfigured(codec, description) {
        const configKey = `${codec}:${description ? description.length : 0}`;

        if (this._decoder && this._decoder.state !== 'closed' && this._currentConfigKey === configKey) {
            return;
        }

        if (this._decoder && this._decoder.state !== 'closed') {
            this._decoder.close();
        }

        const config = { codec, optimizeForLatency: true };
        if (description) {
            config.description = description;
        }

        const support = await VideoDecoder.isConfigSupported(config);
        if (!support.supported) {
            throw new Error(`VideoDecoder does not support codec config: ${JSON.stringify({ codec })}`);
        }

        this._decoder = new VideoDecoder({
            output: (frame) => {
                if (this._currentSink) {
                    this._currentSink(frame);
                } else {
                    // No active decodeSegment call wants this frame (shouldn't
                    // normally happen given the serialized queue) -- avoid
                    // leaking the underlying WebCodecs memory.
                    frame.close();
                }
            },
            error: (err) => {
                console.error('VideoDecoder error', err);
                if (this._currentErrorHandler) {
                    this._currentErrorHandler(err);
                }
            },
        });

        this._decoder.configure(config);
        this._currentConfigKey = configKey;
    }

    /**
     * Closes the underlying VideoDecoder, releasing its resources.
     *
     * @returns {void}
     */
    close() {
        if (this._decoder && this._decoder.state !== 'closed') {
            this._decoder.close();
        }
    }
}
