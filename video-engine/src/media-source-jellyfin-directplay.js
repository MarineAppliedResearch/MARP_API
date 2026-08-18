/**
 * Media source for Jellyfin Direct Play: the original file, fetched by HTTP
 * byte range straight off the server.
 *
 * No transcoder, so none of the transcode path's session machinery applies
 * -- `/Videos/{id}/stream?static=true` is stateless, honours ranges and has
 * no restart cost, which is why this source installs no behind sessions and
 * lets fetches run at the engine's full concurrency.
 *
 * Everything about reading and indexing the MP4 lives in the shared base;
 * all this adds is where the bytes are.
 *
 * @fileoverview The Jellyfin Direct Play media source.
 * @module video-engine/media-source-jellyfin-directplay
 */

import { Mp4ByteRangeMediaSource } from './media-source-mp4-byte-range.js';

/**
 * Plays a Jellyfin item as its original file.
 *
 * @class JellyfinDirectPlayMediaSource
 * @augments Mp4ByteRangeMediaSource
 */
export class JellyfinDirectPlayMediaSource extends Mp4ByteRangeMediaSource {
    /**
     * @param {Object} params
     * @param {import('./jellyfin-client.js').JellyfinClient} params.client - An authenticated client, for the server URL and token.
     * @param {string} params.itemId - Jellyfin item id to play.
     * @param {Object} [params.options] - Remaining options, forwarded to {@link Mp4ByteRangeMediaSource}.
     */
    constructor({ client, itemId, ...options }) {
        super(options);
        this.client = client;
        this.itemId = itemId;
    }

    /** The stateless Direct Play URL: no session, no transcoder, honours ranges. */
    get streamUrl() {
        return `${this.client.serverUrl}/Videos/${encodeURIComponent(this.itemId)}/stream?static=true&api_key=${encodeURIComponent(this.client.accessToken)}`;
    }
}
