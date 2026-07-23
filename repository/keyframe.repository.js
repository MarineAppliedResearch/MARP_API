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
     * Update an existing keyframe record.
     *
     * This method is currently a no-op: its Sequelize update logic is
     * entirely commented out (and, as written, references an
     * `observations` model rather than `keyframes`), so calling this
     * method neither reads nor writes the database — it simply resolves
     * to the empty object `data` was initialized to.
     *
     * @async
     * @param {Object} keyframe - Keyframe fields intended to be updated. Currently unused.
     * @returns {Promise<Object>} Always resolves to an empty object.
     */
    async updateKeyframe(keyframe) {
        let data = {};

        /*
        try {
            observation.updateddate = new Date().toISOString();
            data = await this.db.observations.update({...observation}, {
                where: {
                    observation_id: observation.observation_id
                },
                raw: true
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
            */


        return data;
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