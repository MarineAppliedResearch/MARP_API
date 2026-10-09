/**
 * Service layer for keyframe operations.
 *
 * Coordinates between the keyframe controller and the keyframe repository.
 * This layer currently passes all calls through directly; additional
 * business logic (validation, coordination across repositories, etc.)
 * should be added here rather than in the controller or repository.
 *
 * @fileoverview Keyframe service operations.
 * @author Isaac Travers
 * @module service/keyframe
 */

const keyframeRepository  = require('../repository/keyframe.repository');

/**
 * Coordinates keyframe operations between the controller and repository
 * layers.
 *
 * @class KeyframeService
 */
class KeyframeService {

    constructor() {}

    /**
     * Fetch every keyframe record, ordered by observation, subset, then
     * keyframe id.
     *
     * @async
     * @returns {Promise<Array<Object>>} All keyframe records. Resolves to
     * an empty array when none exist or the underlying query fails.
     *
     * Note: `KeyframeController.getKeyframes()` does not call this
     * method — it calls a non-existent `getObservations()` on this
     * service instead, which throws a `TypeError`. This method is
     * otherwise unused/unreferenced.
     */
    async getKeyframes() {
        return await keyframeRepository.getKeyframes();
    }

    /**
     * Create one or more keyframe records in bulk.
     *
     * @async
     * @param {Object} keyframes - Array of keyframe fields to insert (observation_id, x, y, width, height, subset, type, comname, framenum).
     * @returns {Promise<Array<Object>>} The created keyframe records, or an
     * empty array if the bulk insert failed. A failed insert resolves
     * rather than throwing.
     */
    async createKeyframes(keyframes) {
        return await keyframeRepository.createKeyframes(keyframes);
    }

    /**
     * Fetch a single keyframe record by its keyframe_id.
     *
     * @async
     * @param {number|string} keyframeId - keyframe_id of the keyframe to fetch.
     * @returns {Promise<Object|null>} The matching keyframe record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getKeyframeById(keyframeId) {
        return await keyframeRepository.getKeyframeById(keyframeId);
    }

    /**
     * Update an existing keyframe record by id.
     *
     * @async
     * @param {number|string} keyframeId - keyframe_id of the keyframe to update.
     * @param {Object} newData - Keyframe fields to update.
     * @returns {Promise<Object|null>} The updated keyframe record, or null
     * if no row matched the given id. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateKeyframe(keyframeId, newData) {
        return await keyframeRepository.updateKeyframe(keyframeId, newData);
    }

    /**
     * Delete a keyframe record by id.
     *
     * @async
     * @param {Object} keyframeID - Identifier of the keyframe to delete.
     * @returns {Promise<Object>} The number of rows destroyed (as returned
     * by Sequelize), or an empty object if the delete failed. A failed
     * delete resolves rather than throwing.
     */
    async deleteKeyframe(keyframeID) {
        return await keyframeRepository.deleteKeyframe(keyframeID);
    }


}

module.exports = new KeyframeService();