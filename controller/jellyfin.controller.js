/**
 * Controller layer for Jellyfin API endpoints.
 *
 * Delegates incoming requests to the jellyfin service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; the Jellyfin HTTP client lives in the repository, and
 * playback orchestration lives in the service.
 *
 * Every method threads through an optional `clientIdentity` -- the
 * downstream client's own name/version, extracted by the route layer from
 * request headers -- so the repository can mint a distinct Jellyfin login
 * session per real caller instead of one undifferentiated "MARP API"
 * session (see repository/jellyfin.repository.js's file-level doc comment
 * for why a shared token can't do this).
 *
 * @fileoverview Jellyfin request delegation.
 * @author Isaac Travers
 * @module controller/jellyfin
 */

const jellyfinService = require('../service/jellyfin.service');
const logger = require('../logger/api.logger');

/**
 * Handles Jellyfin HTTP request delegation.
 *
 * @class JellyfinController
 */
class JellyfinController {

    /**
     * Fetch the top-level libraries visible to MARP's Jellyfin service account.
     *
     * @async
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getLibraries(clientIdentity) {
        logger.info('Controller: getLibraries', { clientIdentity });
        return await jellyfinService.getLibraries(clientIdentity);
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
        logger.info('Controller: getChildItems', { parentItemId, clientIdentity });
        return await jellyfinService.getChildItems(parentItemId, clientIdentity);
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
        logger.info('Controller: searchItems', { query, limit, clientIdentity });
        return await jellyfinService.searchItems(query, limit, clientIdentity);
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
        logger.info('Controller: getPlaybackOptions', { itemId, clientIdentity });
        return await jellyfinService.getPlaybackOptions(itemId, clientIdentity);
    }

    /**
     * Resolve a Jellyfin item to a stream URL for the route to redirect to.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to resolve playback for.
     * @param {Object} [options] - Playback options (mode, maxBitrate, maxWidth, maxHeight).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} `{ url, mediaSourceId, playSessionId, playMethod }`.
     */
    async getStreamRedirectUrl(itemId, options, clientIdentity) {
        logger.info('Controller: getStreamRedirectUrl', { itemId, options, clientIdentity });
        return await jellyfinService.getStreamRedirectUrl(itemId, options, clientIdentity);
    }

    /**
     * Resolve a saved database video_source value to the best-matching Jellyfin item.
     *
     * @async
     * @param {string} videoSource - Saved filename, path, or other free-text video reference.
     * @param {number} [minScore] - Minimum acceptable match score (0-100).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} `{ item, score, searchTerm }` for the best match.
     */
    async resolveVideoSource(videoSource, minScore, clientIdentity) {
        logger.info('Controller: resolveVideoSource', { videoSource, minScore, clientIdentity });
        return await jellyfinService.resolveVideoSource(videoSource, minScore, clientIdentity);
    }

    /**
     * Relay a playback-started report to Jellyfin.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} report - Report fields.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackStarted(itemId, report, clientIdentity) {
        logger.info('Controller: reportPlaybackStarted', { itemId, clientIdentity });
        await jellyfinService.reportPlaybackStarted(itemId, report, clientIdentity);
    }

    /**
     * Relay a playback-progress report to Jellyfin.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} report - Report fields.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackProgress(itemId, report, clientIdentity) {
        logger.info('Controller: reportPlaybackProgress', { itemId, clientIdentity });
        await jellyfinService.reportPlaybackProgress(itemId, report, clientIdentity);
    }

    /**
     * Relay a playback-stopped report to Jellyfin.
     *
     * @async
     * @param {string} itemId - Jellyfin item id that was being played.
     * @param {Object} report - Report fields.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackStopped(itemId, report, clientIdentity) {
        logger.info('Controller: reportPlaybackStopped', { itemId, clientIdentity });
        await jellyfinService.reportPlaybackStopped(itemId, report, clientIdentity);
    }

    /**
     * Build a redirect URL to a Jellyfin item image.
     *
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @param {string} imageType - Jellyfin image type, e.g. 'Primary', 'Thumb'.
     * @param {Object} [options] - Image options (maxWidth, quality).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<string>} Absolute Jellyfin image URL.
     */
    async getImageRedirectUrl(itemId, imageType, options, clientIdentity) {
        logger.info('Controller: getImageRedirectUrl', { itemId, imageType, options, clientIdentity });
        return await jellyfinService.getImageRedirectUrl(itemId, imageType, options, clientIdentity);
    }

    /**
     * Load trickplay scrubbing-preview tile metadata for an item.
     *
     * @async
     * @param {string} itemId - Jellyfin item id.
     * @param {number} [width] - Requested tile-sheet width. Omit to auto-select the largest available width.
     * @param {Object} [options] - Additional options (mediaSourceId, runTimeTicks).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} Trickplay metadata.
     */
    async getTrickplayInfo(itemId, width, options, clientIdentity) {
        logger.info('Controller: getTrickplayInfo', { itemId, width, options, clientIdentity });
        return await jellyfinService.getTrickplayInfo(itemId, width, options, clientIdentity);
    }
}

module.exports = new JellyfinController();
