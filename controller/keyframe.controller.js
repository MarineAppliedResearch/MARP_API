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
     * Update an existing keyframe record.
     *
     * @async
     * @param {Object} keyframe - Keyframe fields to update.
     * @returns {Promise<Object>} Always resolves to an empty object; the
     * underlying repository method's update logic is commented out, so
     * this is currently a no-op that does not touch the database. Not
     * currently wired to any route in server.js.
     */
    async updateKeyframe(keyframe) {
        logger.info('Controller: updateKeyframe', keyframe);
        return await keyframeService.updateKeyframe(keyframe);
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