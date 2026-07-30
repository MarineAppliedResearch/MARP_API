/**
 * Controller layer for Jellyfin API endpoints.
 *
 * Delegates incoming requests to the jellyfin service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; the Jellyfin HTTP client lives in the repository, and
 * playback orchestration lives in the service.
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
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getLibraries() {
        logger.info('Controller: getLibraries');
        return await jellyfinService.getLibraries();
    }

    /**
     * Fetch one folder level of child items under a Jellyfin parent item.
     *
     * @async
     * @param {string} parentItemId - Jellyfin id of the parent folder/library.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getChildItems(parentItemId) {
        logger.info('Controller: getChildItems', { parentItemId });
        return await jellyfinService.getChildItems(parentItemId);
    }

    /**
     * Search Jellyfin video items by text.
     *
     * @async
     * @param {string} query - Filename or title search term.
     * @param {number} [limit] - Maximum number of matches to return.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async searchItems(query, limit) {
        logger.info('Controller: searchItems', { query, limit });
        return await jellyfinService.searchItems(query, limit);
    }

    /**
     * Resolve a Jellyfin item to a direct stream URL for the route to redirect to.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to resolve playback for.
     * @returns {Promise<string>} Absolute Jellyfin stream URL.
     */
    async getStreamRedirectUrl(itemId) {
        logger.info('Controller: getStreamRedirectUrl', { itemId });
        return await jellyfinService.getStreamRedirectUrl(itemId);
    }
}

module.exports = new JellyfinController();
