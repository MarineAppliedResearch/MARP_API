/**
 * Service layer for Jellyfin operations.
 *
 * Coordinates between the jellyfin controller and the jellyfin repository.
 * Browsing and search are direct pass-throughs; the one piece of real
 * orchestration here is `getStreamRedirectUrl`, which composes two
 * repository calls to implement the signed-redirect playback pattern
 * (negotiate via PlaybackInfo, then hand back Jellyfin's own direct-stream
 * URL) so the route layer only has to redirect, never proxy bytes.
 *
 * @fileoverview Jellyfin service operations.
 * @author Isaac Travers
 * @module service/jellyfin
 */

const jellyfinRepository = require('../repository/jellyfin.repository');

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
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getLibraries() {
        return await jellyfinRepository.getLibraries();
    }

    /**
     * Fetch one folder level of child items under a Jellyfin parent item.
     *
     * @async
     * @param {string} parentItemId - Jellyfin id of the parent folder/library.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items.
     */
    async getChildItems(parentItemId) {
        return await jellyfinRepository.getChildItems(parentItemId);
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
        return await jellyfinRepository.searchVideoItems(query, limit);
    }

    /**
     * Resolve a Jellyfin item to a direct stream URL.
     *
     * Negotiates playback via PlaybackInfo first -- this both validates the
     * item exists/is playable (a bad id throws 404 here, before any
     * redirect is issued) and is the "proper" Jellyfin negotiation step the
     * old direct-URL-only approach skipped -- then builds the direct-stream
     * URL the caller should redirect to. MARP never fetches or proxies the
     * video bytes itself.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to resolve playback for.
     * @returns {Promise<string>} Absolute Jellyfin stream URL to redirect to.
     */
    async getStreamRedirectUrl(itemId) {
        await jellyfinRepository.getPlaybackInfo(itemId);
        return await jellyfinRepository.buildDirectStreamUrl(itemId);
    }
}

module.exports = new JellyfinService();
