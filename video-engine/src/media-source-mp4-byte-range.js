/**
 * Shared base for sources that read one MP4 by byte range.
 *
 * Everything about playing a whole MP4 lives here -- reading the index
 * prefix, grouping the sample table into GOP units, and assembling chunks
 * by slicing already-fetched bytes. Subclasses supply only a URL, because
 * that is genuinely all that differs: Jellyfin Direct Play points at
 * `/Videos/{id}/stream?static=true`, a local file at its own object URL,
 * and Chromium honours Range requests against both (verified: a blob URL
 * returns 206 with a correct Content-Range).
 *
 * Units are GOPs from the file's own sample table rather than fixed-length
 * HLS segments, so their timing is authoritative rather than derived from
 * playlist durations. Since the sample table carries every sample's offset,
 * size and timestamp, chunk assembly needs no per-unit container parsing at
 * all -- unlike the transcode path, which demuxes init+media for every
 * segment.
 *
 * @fileoverview Shared byte-range MP4 media source.
 * @module video-engine/media-source-mp4-byte-range
 */

import { createFile, DataStream } from 'mp4box';
import { SegmentFetcher } from './segment-fetcher.js';

/** ftyp+moov measured at ~1.03MB on the reference 1080p item; a little headroom over that. */
const DEFAULT_INDEX_PREFIX_BYTES = 1_100_000;

/**
 * Supplies the unit index and decoder chunks for one byte-range MP4.
 *
 * @class Mp4ByteRangeMediaSource
 */
export class Mp4ByteRangeMediaSource {
    /**
     * @param {Object} params
     * @param {Object} [params.fetchOptions] - Extra fetch() options applied to every request this source makes.
     * @param {number} [params.rawSegmentCacheBudgetBytes] - Raw-bytes cache budget, in bytes.
     * @param {number} [params.indexPrefixBytes] - How much of the file's head to read looking for `moov`.
     * @param {function(string): void} [params.onDebug] - Progress messages.
     * @param {function(Error): void} [params.onError] - Called once per real fetch failure.
     */
    constructor({ fetchOptions, rawSegmentCacheBudgetBytes, indexPrefixBytes, onDebug, onError } = {}) {
        this.fetchOptions = fetchOptions;
        this.rawSegmentCacheBudgetBytes = rawSegmentCacheBudgetBytes;
        this.indexPrefixBytes = indexPrefixBytes || DEFAULT_INDEX_PREFIX_BYTES;
        this.onDebug = onDebug;
        this.onError = onError;

        // All built by load(), which must run before anything else.
        this.segmentFetcher = null;
        this._segmentIndex = null;
        this._samples = null;
        this._config = null;
        this._track = null;
    }

    /**
     * The URL this source reads byte ranges from. Subclasses must override.
     *
     * @returns {string} A URL that honours HTTP Range requests.
     */
    get streamUrl() {
        throw new Error('streamUrl is not implemented for this media source.');
    }

    /**
     * Reads the file's index prefix, builds the GOP unit list from its
     * sample table, and prepares Tier 1 over the same byte ranges.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} When the file has no `moov` in its prefix (non-faststart) or carries no video track.
     */
    async load() {
        const prefix = await this._fetchRange(0, this.indexPrefixBytes - 1);

        const iso = createFile();
        let info = null;
        iso.onReady = (parsed) => {
            info = parsed;
        };
        prefix.fileStart = 0;
        iso.appendBuffer(prefix);
        iso.flush();

        if (!info) {
            throw new Error(`No moov box within the first ${this.indexPrefixBytes} bytes -- this file is not faststart.`);
        }

        const track = info.tracks.find((candidate) => candidate.type === 'video');
        if (!track) {
            throw new Error('Direct Play source has no video track.');
        }

        this._track = track;
        this._samples = iso.getTrackSamplesInfo(track.id);
        if (!this._samples.length) {
            throw new Error('Direct Play source has an empty sample table.');
        }
        this._config = { codec: track.codec, description: this._descriptionBytes(iso, track.id) };
        this._segmentIndex = this._buildUnitIndex();

        this.segmentFetcher = new SegmentFetcher(this._segmentIndex, {
            maxRawCacheBytes: this.rawSegmentCacheBudgetBytes,
            onDebug: this.onDebug,
            onError: this.onError,
        });

        this._logDebug(
            `indexed ${this._samples.length} samples into ${this._segmentIndex.segments.length} GOPs ` +
                `(${track.video.width}x${track.video.height}, ${(track.duration / track.timescale).toFixed(1)}s)`,
        );
    }

    /**
     * Groups the sample table into GOPs at sync samples, with the byte
     * range each occupies.
     *
     * Byte bounds come from the samples' own extents rather than assuming
     * they are contiguous, since storage order need not match presentation
     * order.
     *
     * @returns {{segments: Array<Object>, totalDuration: number}} Unit index in SegmentFetcher's shape.
     */
    _buildUnitIndex() {
        const url = this.streamUrl;
        const segments = [];
        let current = null;

        const finish = (unit, endSampleIndex) => {
            const span = this._samples.slice(unit.firstSample, endSampleIndex + 1);
            const timescale = span[0].timescale;
            let byteStart = Infinity;
            let byteEnd = -Infinity;
            for (const sample of span) {
                if (sample.offset < byteStart) byteStart = sample.offset;
                if (sample.offset + sample.size > byteEnd) byteEnd = sample.offset + sample.size;
            }
            const last = span[span.length - 1];
            segments.push({
                index: unit.index,
                url,
                firstSample: unit.firstSample,
                lastSample: endSampleIndex,
                startTime: span[0].cts / timescale,
                endTime: (last.cts + last.duration) / timescale,
                duration: (last.cts + last.duration - span[0].cts) / timescale,
                // Exclusive end: buildRangeHeaderOptions converts to HTTP's
                // inclusive form itself.
                byteRangeStart: byteStart,
                byteRangeEnd: byteEnd,
            });
        };

        for (let i = 0; i < this._samples.length; i++) {
            if (this._samples[i].is_sync || current === null) {
                if (current !== null) {
                    finish(current, i - 1);
                }
                current = { index: segments.length, firstSample: i };
            }
        }
        if (current !== null) {
            finish(current, this._samples.length - 1);
        }

        return { segments, totalDuration: this._track.duration / this._track.timescale };
    }

    /**
     * The engine-facing unit index: ordered units with real start/end
     * times, and no URLs or byte ranges -- locating bytes is this source's
     * business alone.
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
     * Assembles one unit's decoder chunks from its already-fetched bytes.
     *
     * No container parsing happens here: the sample table from load()
     * already gives every sample's offset, size, timestamp and sync flag,
     * so this is pure slicing. A unit always begins on a sync sample by
     * construction, so the transcode path's keyframe-continuity merge has
     * no counterpart here.
     *
     * @async
     * @param {number} unitIndex - Index of the unit to assemble.
     * @returns {Promise<{codec: string, description: (Uint8Array|null), chunks: Array<Object>, unitFirstTimestampMicros: (number|null)}>} Chunks in decode order.
     */
    async fetchChunks(unitIndex) {
        const unit = this._segmentIndex.segments[unitIndex];
        if (!unit) {
            throw new Error(`No unit at index ${unitIndex}`);
        }

        const bytes = this.segmentFetcher.getCachedRawBytes(unitIndex);
        const view = new Uint8Array(bytes);
        const chunks = [];

        for (let i = unit.firstSample; i <= unit.lastSample; i++) {
            const sample = this._samples[i];
            const start = sample.offset - unit.byteRangeStart;
            chunks.push({
                type: sample.is_sync ? 'key' : 'delta',
                timestamp: Math.round((sample.cts / sample.timescale) * 1e6),
                duration: Math.round((sample.duration / sample.timescale) * 1e6),
                data: view.subarray(start, start + sample.size),
            });
        }

        return {
            codec: this._config.codec,
            description: this._config.description,
            chunks,
            unitFirstTimestampMicros: chunks.length ? chunks[0].timestamp : null,
        };
    }

    /**
     * Extracts the avcC/hvcC payload VideoDecoder.configure() needs.
     *
     * @param {Object} iso - mp4box ISOFile, after onReady.
     * @param {number} trackId - Video track id.
     * @returns {Uint8Array|null} Codec description bytes, or null if absent.
     */
    _descriptionBytes(iso, trackId) {
        const trak = iso.getTrackById(trackId);
        for (const entry of trak.mdia.minf.stbl.stsd.entries) {
            const box = entry.avcC || entry.hvcC;
            if (box) {
                const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
                box.write(stream);
                return new Uint8Array(stream.buffer, 8); // skip the box header
            }
        }
        return null;
    }

    /**
     * @async
     * @param {number} start - Inclusive start offset.
     * @param {number} endInclusive - Inclusive end offset.
     * @returns {Promise<ArrayBuffer>} The requested bytes.
     * @throws {Error} When the server does not honour the range.
     */
    async _fetchRange(start, endInclusive) {
        const options = { ...(this.fetchOptions || {}) };
        options.headers = { ...(options.headers || {}), Range: `bytes=${start}-${endInclusive}` };
        const response = await fetch(this.streamUrl, options);
        if (response.status !== 206) {
            throw new Error(`Direct Play byte-range request was not honored (got ${response.status}, expected 206).`);
        }
        return await response.arrayBuffer();
    }

    /**
     * @param {string} message - Message text, without the module prefix.
     * @returns {void}
     */
    _logDebug(message) {
        const prefixed = `[${this.constructor.name}] ${message}`;
        console.log(prefixed);
        if (this.onDebug) {
            this.onDebug(prefixed);
        }
    }
}
