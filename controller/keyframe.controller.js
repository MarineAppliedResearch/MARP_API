/**
 * Controller layer for keyframe API endpoints.
 *
 * Delegates incoming requests to the keyframe service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview Keyframe request delegation.
 * @author Isaac Travers
 * @module controller/keyframe
 */

const keyframeService  = require('../service/keyframe.service');
const logger = require('../logger/api.logger');

/**
 * Handles keyframe HTTP request delegation.
 *
 * @class KeyframeController
 */
class KeyframeController {

    /**
     * Fetch every keyframe record, ordered by observation, subset, then
     * keyframe id.
     *
     * @async
     * @returns {Promise<Array<Object>>} All keyframe records.
     *
     * BUG: this method calls `keyframeService.getObservations()`, but
     * `KeyframeService` defines no `getObservations` method (only
     * `getKeyframes`, `createKeyframes`, `updateKeyframe`, and
     * `deleteKeyframe` exist on it). Calling this method throws a
     * `TypeError: keyframeService.getObservations is not a function`
     * rather than returning keyframe data. It is also not currently wired
     * to any route in server.js, so this bug is latent/unused.
     */
    async getKeyframes() {
        logger.info('Controller: getKeyframes');
        return await keyframeService.getObservations();
    }

    /**
     * Create one or more keyframe records in bulk.
     *
     * @async
     * @param {Object} keyframes - Array of keyframe fields to insert (observation_id, x, y, width, height, subset, type, comname, framenum), taken from `req.body` directly by the caller in server.js.
     * @returns {Promise<Array<Object>>} The created keyframe records, or an
     * empty array if the bulk insert failed. A failed insert resolves
     * rather than throwing, since the transaction is rolled back and the
     * error is only logged.
     */
    async createKeyframes(keyframes) {
        logger.info('Controller: createKeyFrames', keyframes);
        return await keyframeService.createKeyframes(keyframes);
    }

    /**
     * Fetch a single keyframe record by its keyframe_id.
     *
     * @async
     * @param {number|string} keyframeId - keyframe_id of the keyframe to fetch, taken from `req.params.keyframe_id` by the caller in app.js.
     * @returns {Promise<Object|null>} The matching keyframe record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getKeyframeById(keyframeId) {
        logger.info('Controller: getKeyframeById', keyframeId);
        return await keyframeService.getKeyframeById(keyframeId);
    }

    /**
     * Update an existing keyframe record by id.
     *
     * @async
     * @param {number|string} keyframeId - keyframe_id of the keyframe to update, taken from `req.params.keyframe_id` by the caller in app.js.
     * @param {Object} newData - Keyframe fields to update, taken from `req.body.keyframe` by the caller in app.js.
     * @returns {Promise<Object|null>} The updated keyframe record, or null
     * if no row matched the given id. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateKeyframe(keyframeId, newData) {
        logger.info('Controller: updateKeyframe', keyframeId);
        return await keyframeService.updateKeyframe(keyframeId, newData);
    }

    /**
     * Delete a keyframe record by id.
     *
     * @async
     * @param {Object} keyframeID - Identifier of the keyframe to delete, taken from `req.params.keyframe_id` by the caller in server.js.
     * @returns {Promise<Object>} The number of rows destroyed (as returned
     * by Sequelize), or an empty object if the delete failed. A failed
     * delete resolves rather than throwing.
     */
    async deleteKeyframe(keyframeID) {
        logger.info('Controller: deleteKeyframe', keyframeID);
        return await keyframeService.deleteKeyframe(keyframeID);
    }



}
module.exports = new KeyframeController();