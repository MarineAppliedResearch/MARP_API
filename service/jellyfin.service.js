/**
 * Service layer for Jellyfin operations.
 *
 * Coordinates between the jellyfin controller and the jellyfin repository.
 * Browsing, search, playback-report relaying, images, and trickplay are
 * direct pass-throughs (plus threading `clientIdentity` through so the
 * repository can attribute the right Jellyfin session -- see the
 * repository's file-level doc comment for why that matters). The real
 * orchestration lives in `getStreamRedirectUrl`, which dispatches on
 * playback mode: `Original`/`Auto` negotiate direct playback and redirect
 * to Jellyfin's direct-stream URL (unchanged from the first V2 increment);
 * `Transcode` negotiates a real constrained transcode via PlaybackInfo +
 * DeviceProfile and redirects to Jellyfin's own negotiated `transcodingUrl`
 * instead. Either way, the route layer only ever has to redirect -- MARP
 * never proxies video bytes.
 *
 * @fileoverview Jellyfin service operations.
 * @author Isaac Travers
 * @module service/jellyfin
 */

const jellyfinRepository = require('../repository/jellyfin.repository');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');

/**
 * Coordinates Jellyfin operations between the controller and repository
 * layers.
 *
 * @class JellyfinService
 */
class JellyfinService {

    /**
     * Fetch the top-level libraries visible to MARP's Jellyfin service account.
     *
     * @async
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getLibraries(clientIdentity) {
        return await jellyfinRepository.getLibraries(clientIdentity);
    }

    /**
     * Fetch one folder level of child items under a Jellyfin parent item.
     *
     * @async
     * @param {string} parentItemId - Jellyfin id of the parent folder/library.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getChildItems(parentItemId, clientIdentity) {
        return await jellyfinRepository.getChildItems(parentItemId, clientIdentity);
    }

    /**
     * Search Jellyfin video items by text.
     *
     * @async
     * @param {string} query - Filename or title search term.
     * @param {number} [limit] - Maximum number of matches to return.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async searchItems(query, limit, clientIdentity) {
        return await jellyfinRepository.searchVideoItems(query, limit, clientIdentity);
    }

    /**
     * Build the quality menu (Auto/Original/transcode tiers) for an item.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to build a quality menu for.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Playback options.
     */
    async getPlaybackOptions(itemId, clientIdentity) {
        return await jellyfinRepository.getPlaybackOptions(itemId, clientIdentity);
    }

    /**
     * Resolve a Jellyfin item to a stream URL to redirect a caller to.
     *
     * `mode: 'Original'` (default) or `'Auto'`: negotiates direct playback
     * via PlaybackInfo first -- this both validates the item exists/is
     * playable (a bad id throws 404 here, before any redirect is issued)
     * and is the "proper" Jellyfin negotiation step the very first version
     * of this endpoint skipped -- then builds the direct-stream URL. `Auto`
     * is accepted but currently resolves identically to `Original`: there
     * is no adaptive-quality decision procedure yet, matching the same
     * simplification jellyfin_client.cs itself currently ships.
     *
     * `mode: 'Transcode'`: negotiates a real constrained transcode (a
     * DeviceProfile-driven PlaybackInfo call) and redirects to Jellyfin's
     * own negotiated `transcodingUrl` instead of a manually-built query
     * string. Throws if Jellyfin's response has no usable transcoding URL
     * for this item.
     *
     * MARP never fetches or proxies the video bytes itself in either case.
     *
     * The negotiated `mediaSourceId`/`playSessionId`/`playMethod` are
     * returned alongside the URL, not just the URL alone -- confirmed
     * against Jellyfin's own live `/Sessions` listing that reporting
     * `playback/progress`/`stopped` with anything other than the exact
     * `playSessionId` a real negotiation call issued gets silently ignored
     * (Jellyfin's session PlayState never updates), so a caller has no way
     * to use the playback-report endpoints correctly unless this endpoint
     * hands these back. `Original`/`Auto`'s negotiation and `Transcode`'s
     * negotiation are two different PlaybackInfo calls and get two
     * different `playSessionId`s from Jellyfin -- callers must use
     * whichever this call returns for the mode they actually requested.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to resolve playback for.
     * @param {Object} [options] - Playback options.
     * @param {string} [options.mode='Original'] - 'Original', 'Auto', or 'Transcode'.
     * @param {number} [options.maxBitrate] - Bitrate ceiling for Transcode mode.
     * @param {number} [options.maxWidth] - Width ceiling for Transcode mode.
     * @param {number} [options.maxHeight] - Height ceiling for Transcode mode.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} `{ url, mediaSourceId, playSessionId, playMethod }`.
     * @throws {ApiError} 502/UPSTREAM_ERROR when Transcode mode negotiates no usable transcoding URL.
     */
    async getStreamRedirectUrl(itemId, options = {}, clientIdentity) {
        const mode = options.mode || 'Original';

        if (mode === 'Transcode') {
            const playbackInfo = await jellyfinRepository.getTranscodePlaybackInfo(
                itemId,
                {
                    maxStreamingBitrate: options.maxBitrate,
                    maxWidth: options.maxWidth,
                    maxHeight: options.maxHeight,
                },
                clientIdentity
            );

            const mediaSource = playbackInfo.mediaSources[0];
            const transcodingUrl = mediaSource && mediaSource.transcodingUrl;

            if (!transcodingUrl) {
                throw new ApiError(
                    502,
                    ERROR_CODES.UPSTREAM_ERROR,
                    'Jellyfin did not return a transcoding URL for this item.'
                );
            }

            return {
                url: jellyfinRepository.buildAbsoluteUrl(transcodingUrl),
                mediaSourceId: mediaSource.id,
                playSessionId: playbackInfo.playSessionId,
                playMethod: 'Transcode',
            };
        }

        const playbackInfo = await jellyfinRepository.getPlaybackInfo(itemId, {}, clientIdentity);
        const mediaSource = playbackInfo.mediaSources[0];
        const url = await jellyfinRepository.buildDirectStreamUrl(itemId, clientIdentity);

        return {
            url,
            mediaSourceId: mediaSource && mediaSource.id,
            playSessionId: playbackInfo.playSessionId,
            playMethod: 'DirectStream',
        };
    }

    /**
     * Resolve a saved database video_source value to the best-matching
     * Jellyfin item.
     *
     * @async
     * @param {string} videoSource - Saved filename, path, or other free-text video reference.
     * @param {number} [minScore] - Minimum acceptable match score (0-100).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} `{ item, score, searchTerm }` for the best match.
     */
    async resolveVideoSource(videoSource, minScore, clientIdentity) {
        return await jellyfinRepository.resolveVideoSource(videoSource, minScore, clientIdentity);
    }

    /**
     * Relay a playback-started report to Jellyfin.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} report - Report fields (mediaSourceId, playSessionId, positionTicks, isPaused, playMethod).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackStarted(itemId, report, clientIdentity) {
        await jellyfinRepository.reportPlaybackStarted(itemId, report, clientIdentity);
    }

    /**
     * Relay a playback-progress report to Jellyfin.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} report - Report fields (mediaSourceId, playSessionId, positionTicks, isPaused, playMethod).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackProgress(itemId, report, clientIdentity) {
        await jellyfinRepository.reportPlaybackProgress(itemId, report, clientIdentity);
    }

    /**
     * Relay a playback-stopped report to Jellyfin.
     *
     * @async
     * @param {string} itemId - Jellyfin item id that was being played.
     * @param {Object} report - Report fields (mediaSourceId, playSessionId, positionTicks, playMethod).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackStopped(itemId, report, clientIdentity) {
        await jellyfinRepository.reportPlaybackStopped(itemId, report, clientIdentity);
    }

    /**
     * Build a redirect URL to a Jellyfin item image.
     *
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @param {string} imageType - Jellyfin image type, e.g. 'Primary', 'Thumb'.
     * @param {Object} [options] - Image options.
     * @param {number} [options.maxWidth] - Maximum image width.
     * @param {number} [options.quality] - JPEG quality (1-100).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<string>} Absolute Jellyfin image URL to redirect to.
     */
    async getImageRedirectUrl(itemId, imageType, options = {}, clientIdentity) {
        return await jellyfinRepository.buildImageUrl(itemId, imageType, options.maxWidth, options.quality, clientIdentity);
    }

    /**
     * Load trickplay scrubbing-preview tile metadata for an item.
     *
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @param {number} [width] - Requested tile-sheet width. Omit to auto-select the largest width Jellyfin actually generated for this item.
     * @param {Object} [options] - Additional options.
     * @param {string} [options.mediaSourceId] - Specific media source, if the item has more than one.
     * @param {number} [options.runTimeTicks] - Item runtime in Jellyfin ticks, to probe for additional tiles.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} Trickplay metadata (see {@link module:repository/jellyfin~JellyfinRepository#getTrickplayInfo}).
     */
    async getTrickplayInfo(itemId, width, options = {}, clientIdentity) {
        return await jellyfinRepository.getTrickplayInfo(itemId, width, options, clientIdentity);
    }
}

module.exports = new JellyfinService();
