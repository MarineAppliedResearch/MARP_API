/**
 * Repository module for keyframe database operations.
 *
 * This file contains Sequelize queries used to retrieve, bulk-create,
 * update, and delete frame-specific annotation records tied to
 * observations.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview Keyframe database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/keyframe
 */

const db = require('../model');
const logger = require('../logger/api.logger');
const { Sequelize, Model, DataTypes } = require("sequelize");
const { Op } = require("sequelize");
const sessionController = require('../controller/session.controller');
const observationController = require('../controller/observation.controller');
const userController = require('../controller/user.controller');
const moment = require('moment'); // For date manipulation


/**
 * Repository for keyframe database operations.
 *
 * @class KeyframeRepository
 */
class KeyframeRepository {

    db = {};



    constructor() {
        this.db = db;
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }


    /**
     * Fetch every keyframe record, ordered by `observation_id`, `subset`,
     * then `keyframe_id` (all ascending).
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero keyframes and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All keyframe records. Returns an
     * empty array when none exist or when the database query fails.
     */
    async getKeyframes() {

        try {
            const keyframes = await this.db.keyframes.findAll({
                order: [
                    ['observation_id', 'ASC'],
                    ['subset', 'ASC'],
                    ['keyframe_id', 'ASC'],
                ]
        });
            //console.log('observations:::', observations);
            return keyframes;
        } catch (err) {
            console.log(err);

            return [];
        }
    }



    /**
     * Create one or more keyframe records in bulk within a single
     * transaction.
     *
     * Only a fixed whitelist of fields is copied from each input keyframe
     * (observation_id, x, y, width, height, subset, type, comname,
     * framenum) before insert; any other fields on the input objects are
     * ignored.
     *
     * If the bulk insert fails, the transaction is rolled back and the
     * error is only logged — it is not re-thrown. As a result, `data`
     * remains the empty array it was initialized to, so callers cannot
     * distinguish "nothing to insert" from "the insert failed and was
     * rolled back" by inspecting the return value alone.
     *
     * @async
     * @param {Object} newKeyFrames - Array of keyframe fields to insert (observation_id, x, y, width, height, subset, type, comname, framenum).
     * @returns {Promise<Array<Object>>} The created keyframe records, or an
     * empty array if the bulk insert failed.
     */
    async createKeyframes(newKeyFrames) {
        let data = [];


        const transaction = await this.db.sequelize.transaction(); // Start a new transaction
        try {
            // Prepare the list of keyframes data
            const keyframesData = newKeyFrames.map(keyframe => ({
                observation_id: keyframe.observation_id,
                x: keyframe.x,
                y: keyframe.y,
                width: keyframe.width,
                height: keyframe.height,
                subset: keyframe.subset,
                type: keyframe.type,
                comname: keyframe.comname,
                framenum: keyframe.framenum
            }));

            // Use bulkCreate to add all keyframes within the transaction
            data = await this.db.keyframes.bulkCreate(keyframesData, { transaction });

            // Commit the transaction if everything went fine
            await transaction.commit();
            console.log('Keyframes saved successfully.');
        } catch (error) {
            // Rollback the transaction in case of any errors
            await transaction.rollback();
            console.error('Error saving keyframes:', error);
        }

        return data;
    }

    /**
     * Fetch a single keyframe record by its keyframe_id.
     *
     * Unlike most methods on this class, a database failure here is logged
     * and re-thrown rather than swallowed to a fallback value, so callers
     * must catch/handle a rejected promise. A "not found" result, by
     * contrast, resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} keyframeId - keyframe_id of the keyframe to fetch.
     * @returns {Promise<Object|null>} The matching keyframe record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getKeyframeById(keyframeId) {
        try {
            const keyframe = await this.db.keyframes.findByPk(keyframeId);
            return keyframe || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Fields an update is allowed to change: where the box is, what kind of
     * keyframe it is, and which frame it sits on.
     *
     * `observation_id` and `subset` identify what the annotation belongs to
     * and must not move -- an update that could change them would let a
     * client reassign a keyframe to a different observation. `comname`
     * follows the observation's species rather than the keyframe.
     *
     * @constant
     * @type {Array<string>}
     */
    static get UPDATABLE_FIELDS() {
        return ['x', 'y', 'width', 'height', 'type', 'framenum'];
    }

    /**
     * Update an existing keyframe record by id.
     *
     * Only the fields in {@link KeyframeRepository.UPDATABLE_FIELDS} are
     * written; anything else on `newData` is ignored rather than rejected,
     * matching how `createKeyframes` copies a fixed set of fields.
     *
     * @async
     * @param {number|string} keyframeId - keyframe_id of the keyframe to update.
     * @param {Object} newData - Keyframe fields to update. Only the updatable ones are used.
     * @returns {Promise<Object|null>} The updated keyframe record, or null
     * if no row matched `keyframeId` or `newData` held nothing updatable. A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to an error value.
     */
    async updateKeyframe(keyframeId, newData) {
        try {
            const fields = {};
            for (const field of KeyframeRepository.UPDATABLE_FIELDS) {
                if (newData && newData[field] !== undefined) {
                    fields[field] = newData[field];
                }
            }

            // Nothing to write. Sequelize would issue an empty UPDATE and
            // report zero rows, which reads as "no such keyframe" and is a
            // different problem to report.
            if (Object.keys(fields).length === 0) {
                return null;
            }

            const [rowsUpdated, [updatedKeyframe]] = await this.db.keyframes.update(
                fields,
                { where: { keyframe_id: keyframeId }, returning: true }
            );

            if (rowsUpdated === 0) {
                return null;
            }

            return updatedKeyframe;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Delete a keyframe record by id.
     *
     * Database errors are logged (not re-thrown) and `data` is left as the
     * empty object it was initialized to, so a failed delete resolves to
     * `{}` rather than throwing or returning a distinguishable error
     * value.
     *
     * @async
     * @param {Object} keyframeID - Identifier (`keyframe_id`) of the keyframe to delete.
     * @returns {Promise<Object>} The number of rows destroyed (as returned
     * by Sequelize), or an empty object if the delete failed.
     */
    async deleteKeyframe(keyframeID) {
        let data = {};
        try {
            data = await this.db.keyframes.destroy({
                where: {
                    keyframe_id: keyframeID
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        //return {status: `${data.deletedCount > 0 ? true : false}`};
    }

}

module.exports = new KeyframeRepository();