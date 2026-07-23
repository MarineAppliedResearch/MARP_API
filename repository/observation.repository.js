/**
 * Repository module for observation-related database operations.
 *
 * This file contains Sequelize queries used to retrieve, filter, aggregate,
 * create, update, and remove observation records and their related data.
 *
 * Observation queries may join projects, sessions, users, species, keyframes,
 * and other associated models depending on the operation being performed.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior belongs
 * in services.
 *
 * @fileoverview Observation database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/observation
 */


/**
 * Shared database registry containing the configured Sequelize connection,
 * initialized models, and model associations.
 *
 * @constant
 * @type {Object}
 */
const db = require('../model');


/**
 * Application logger used to record repository errors, warnings, and
 * diagnostic information.
 *
 * @constant
 * @type {Object}
 */
const logger = require('../logger/api.logger');


/**
 * Sequelize classes and data-type definitions used by repository queries
 * and model-related operations.
 *
 * @constant
 * @type {Object}
 */
const { Sequelize, Model, DataTypes } = require('sequelize');


/**
 * Session controller used by observation operations that depend on
 * session-level application behavior.
 *
 * Database repositories should generally depend on models or other
 * repositories rather than controllers. This dependency should remain only
 * where the repository currently requires controller behavior.
 *
 * @constant
 * @type {Object}
 */
const sessionController = require('../controller/session.controller');


/**
 * Observation controller used by repository operations that invoke existing
 * observation-level application behavior.
 *
 * A repository importing its own corresponding controller creates a circular
 * dependency risk. This import should be retained only when required by an
 * existing function.
 *
 * @constant
 * @type {Object}
 */
const observationController = require('../controller/observation.controller');


/**
 * User controller used by observation operations that require user-related
 * application behavior.
 *
 * Database repositories should generally access user data through models or
 * repositories rather than through controllers.
 *
 * @constant
 * @type {Object}
 */
const userController = require('../controller/user.controller');



/**
 * Date and time utility used to parse, compare, format, and manipulate
 * observation-related timestamps.
 *
 * @constant
 * @type {Function}
 */
const moment = require('moment');


/**
 * Sequelize query helpers used for operators, aggregate functions, and
 * database-column references.
 *
 * `Op` provides query operators such as `in`, `between`, and comparison
 * operators. `fn` creates SQL function expressions, and `col` references
 * database columns in joins and aggregate queries.
 *
 * @constant
 * @type {Object}
 */
const { Op, fn, col } = require('sequelize');



class ObservationRepository {

    db = {};

    // Track the first and last observation of a specific session for a day
    firstLastSessionObsPerDay = {};

    // don't track per day, but we'll use this to record the first and/or last observation of a session_id
    firstLastSessionObs = {};
    
    

    constructor() {
        this.db = db;
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    /**
     * Fetch every observation record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero observations and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All observation records ordered by
     * ascending `obsID`. Returns an empty array when none exist or when the
     * database query fails.
     */
    async getObservations() {

        try {
            const observations = await this.db.observations.findAll({
                order: [
                    ['obsID', 'ASC'],
                ]
        });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);

            return [];
        }
    }

    /**
     * Fetch the videoLocation, mediaPosition, and actualPosition of the
     * observation with the maximum `observation_id` within a session.
     *
     * This is implemented as two sequential queries: the first computes the
     * max `observation_id` for the session, and the second fetches the full
     * observation row(s) matching that ID. This is not done in a single
     * query/transaction, so it is possible (if rare) for a new observation
     * to be inserted between the two queries.
     *
     * Database errors from either query are logged and converted to an
     * empty array. As a result, callers cannot distinguish between "the
     * session has no observations" and "the database query failed".
     *
     * @async
     * @param {number|string} session_id - Session identifier whose latest
     * observation's video info should be retrieved.
     * @returns {Promise<Array<Object>>} The observation record(s) matching
     * the session's maximum `observation_id`. Returns an empty array when
     * the session has no observations or when either query fails.
     */
    async getLastVideoInfo(session_id){

        let maxObservation_id = {};
        let maxObservation = {};

        try {
            maxObservation_id = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true
            });
            //console.log('observations:::', maxObservation_id);
            maxObservation_id = maxObservation_id[0].max;

            try {
                const maxObservation = await this.db.observations.findAll({
                    where: {
                        session_id: session_id,
                        observation_id: maxObservation_id
                    }
                });
                //console.log('observations:::', maxObservation);
                return maxObservation;
            } catch (err) {
                console.log(err);
                return [];
            }

        } catch (err) {
            console.log(err);
            return [];
        }
    }



    /**
     * Fetch the observation with the largest `observation_id` associated
     * with a specific video source.
     *
     * Like {@link getLastVideoInfo}, this is implemented as two sequential
     * queries (max `observation_id` lookup, then row fetch) rather than a
     * single atomic query.
     *
     * Database errors from either query are logged and converted to an
     * empty array. As a result, callers cannot distinguish between "no
     * observations for this video" and "the database query failed".
     *
     * @async
     * @param {string} video_source - Video source value to match.
     * @returns {Promise<Array<Object>>} The observation record(s) matching
     * the video's maximum `observation_id`. Returns an empty array when no
     * observations match or when either query fails.
     */
    async getMaxObservationFromVideo(video_source){

        let maxObservation_id = {};
        let maxObservation = {};

        try {
            maxObservation_id = await this.db.observations.findAll({
                where: {
                    video_source: video_source
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true
            });
            //console.log('observations:::', maxObservation_id);
            maxObservation_id = maxObservation_id[0].max;

            try {
                const maxObservation = await this.db.observations.findAll({
                    where: {
                        video_source: video_source,
                        observation_id: maxObservation_id
                    }
                });
                //console.log('observations:::', maxObservation);
                return maxObservation;
            } catch (err) {
                console.log(err);
                return [];
            }

        } catch (err) {
            console.log(err);
            return [];
        }
    }


    /**
     * Update the `count` field of a specific observation within a session.
     *
     * Matches on both `session_id` and `obsID` (the per-session sequential
     * identifier, distinct from the `observation_id` primary key).
     *
     * Database errors are logged and converted to `0`. The success path
     * always returns `1` regardless of how many rows Sequelize actually
     * updated, so a call whose `session_id`/`obsID` combination matches no
     * row still resolves to `1` as if the update succeeded.
     *
     * @async
     * @param {number|string} session_id - Session identifier used together
     * with `obsID` to locate the target observation.
     * @param {number|string} obsID - Per-session sequential observation
     * identifier to update.
     * @param {number|string} count - New count value to persist.
     * @returns {Promise<number>} `1` if the update statement executed
     * without throwing, or `0` if it threw. Does not reflect the number of
     * rows actually affected.
     */
    async updateObservationWithCount(session_id, obsID, count){
        try {
            const result = await this.db.observations.update(
              { count: count },
              { where: { obsID: obsID, session_id: session_id} }
            )
            //handleResult(result)
            return 1;
          } catch (err) {
            console.log(err);
            return 0;
          }
    }

    /**
     * Update the `coarsesize` field of a specific observation within a
     * session.
     *
     * Matches on both `session_id` and `obsID` (the per-session sequential
     * identifier, distinct from the `observation_id` primary key).
     *
     * Database errors are logged and converted to `0`. The success path
     * always returns `1` regardless of how many rows Sequelize actually
     * updated, so a call whose `session_id`/`obsID` combination matches no
     * row still resolves to `1` as if the update succeeded.
     *
     * @async
     * @param {number|string} session_id - Session identifier used together
     * with `obsID` to locate the target observation.
     * @param {number|string} obsID - Per-session sequential observation
     * identifier to update.
     * @param {number|string} size - New coarse-size value to persist.
     * @returns {Promise<number>} `1` if the update statement executed
     * without throwing, or `0` if it threw. Does not reflect the number of
     * rows actually affected.
     */
    async updateObservationWithSize(session_id, obsID, size){
        try {
            const result = await this.db.observations.update(
              { coarsesize: size },
              { where: { obsID: obsID, session_id: session_id} }
            )
            //handleResult(result)
            return 1;
          } catch (err) {
            console.log(err);
            return 0;
          }
    }

    

    /**
     * Fetch every observation belonging to a session, including associated
     * keyframes.
     *
     * The keyframe association uses `required: false`, so observations are
     * returned whether or not they have any keyframes.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a session with no
     * observations and a database failure.
     *
     * An older version of this method (which queried observations without
     * including keyframes) is retained as a commented-out block immediately
     * below this one.
     *
     * @async
     * @param {number|string} session_id - Session identifier to match.
     * @returns {Promise<Array<Object>>} Matching observations with their
     * keyframes (if any). Returns an empty array when none exist or when
     * the database query fails.
     */
    async getObservationsBySessionID(session_id) {
        try {
            // Fetch observations along with their associated keyframes
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                },
                include: [
                    {
                        model: this.db.keyframes,  // Include keyframes related to each observation
                        as: 'keyframes',           // Alias used during association
                        required: false            // Include observations even if there are no keyframes
                    }
                ]
            });
    
            // console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }
    
    /*
    async getObservationsBySessionID(session_id) {
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                }
            });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }
    */



    /**
     * Returns the max PobsID by project
     *
     * Looks up all sessions for the project via the session controller,
     * then queries the maximum `PobsID` across observations belonging to
     * any of those sessions. This method does not currently appear to be
     * called from any controller, service, or route in this codebase.
     *
     * Database errors are logged and converted to an empty array (note:
     * unlike most other max-lookup methods in this file, which fall back to
     * `-1`, a failure here returns `[]`).
     *
     * @async
     * @param {*} project_id - Project identifier used to locate candidate
     * sessions via `sessionController.getSessionsByProjectID`.
     * @returns {Promise<Array<Object>>} A single-element array containing
     * the aggregate max `PobsID` result, or an empty array if the database
     * query fails.
     */
    async getMaxPobsIDInProject(project_id){

        // Get all the sessions involved with this project
        const sessions = await sessionController.getSessionsByProjectID(project_id);

        // Create an array of session_ids
        let session_ids = [];

        // Loop through sessions, adding all session_id to session_ids array
        for(let i in sessions){
            session_ids.push(sessions[i].session_id)
        }



        // Now we have a list of session, we can get our observations in all these sessions
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_ids
                },
                attributes: [Sequelize.fn('max', Sequelize.col('PobsID'))],
            });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }

    }

    /**
     * Returns the maximum `observation_id` within a session.
     *
     * This method does not currently appear to be called from anywhere
     * else in this file, the service layer, the controller layer, or
     * server.js; it appears to be unused/dead code.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a session with no
     * observations and a database failure.
     *
     * @async
     * @param {number|string} session_id - Session identifier to match.
     * @returns {Promise<Array<Object>>} A single-element array containing
     * the aggregate max `observation_id` result, or an empty array if the
     * database query fails.
     */
    async getMaxObservationIDInSession(session_id) {
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
            });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Create a new observation record, computing its `observation_id`,
     * `obsID`, and `PobsID` values rather than trusting any values supplied
     * by the caller.
     *
     * `observation_id` is derived from the global max `observation_id`
     * across all observations, plus one. `obsID` is derived from the max
     * `obsID` within the observation's own session, plus one. `PobsID` is
     * derived by looking up the observation's project (via its session)
     * and calling {@link getMaxPobsID}, plus one. `createdate` is always
     * overwritten with the current time.
     *
     * Error handling is layered: the two "compute max ID" lookups each have
     * their own try/catch that only logs (the computed value keeps its
     * initialized default, `-1` or unset, if the lookup fails). The actual
     * `this.db.observations.create(...)` call is wrapped in an inner
     * try/catch that logs and re-throws, and that re-thrown error is caught
     * by an outer try/catch that only logs via `logger.error` and does not
     * re-throw. As a result, if the insert itself fails, this method
     * resolves to `{}` (the initial value of `data`) instead of throwing or
     * returning `null` — callers cannot detect the failure from the return
     * value alone and must inspect the logs.
     *
     * @async
     * @param {Object} observation - Observation fields to insert, including
     * `session_id` and optional nested `keyframes` (created via the
     * `keyframes` association). `observation_id`, `obsID`, `PobsID`, and
     * `createdate` on this object are overwritten before the insert.
     * @returns {Promise<Object>} The created Sequelize observation instance
     * (with its keyframes, if supplied), or an empty object if the insert
     * failed.
     */
    /**
     * Fetch a single observation record by its observation_id.
     *
     * Unlike most methods on this class, a database failure here is logged
     * and re-thrown rather than swallowed to a fallback value, so callers
     * must catch/handle a rejected promise. A "not found" result, by
     * contrast, resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} observationId - observation_id of the observation to fetch.
     * @returns {Promise<Object|null>} The matching observation record, or
     * null if not found. Rejects if the underlying query fails.
     */
    async getObservationById(observationId) {
        try {
            const observation = await this.db.observations.findByPk(observationId);
            return observation || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    async createObservation(observation) {
        let data = {};
        let max_obs = {};
        let max_observation_id = -1;
        // let maxOBSID = observation.obsID; // don't rely on the frontend for observation id
        let maxOBSID = -1;                   // instead make sure to generate in database
        let max_PobsID = -1;

        // First we get the max observation_id for all sessions
        try {
            max_obs = await this.db.observations.findAll({
                
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true,
            }).then(function(observation_id){
                //check if observation_id[0].max is null, if it is skip setting
                if(observation_id[0].max != null){
                    max_observation_id = observation_id[0].max;
                }
                
             });
            //console.log('observations:::', max_obs);
            
        } catch (err) {
            console.log(err);
        }


        // if maxOBSID is -1 it means an obs id wasn't passed in via the gui, so find the max and create.
        if(maxOBSID == -1){
              // Now lets do the same thing, and get the max obsID for the session
            try {
                max_obs = await this.db.observations.findAll({
                    where: {
                        session_id: observation.session_id
                    },
                    attributes: [Sequelize.fn('max', Sequelize.col('obsID'))],
                    raw: true,
                }).then(function(obsID){
                    if(obsID[0].max != null){
                        maxOBSID = obsID[0].max;
                        maxOBSID = (parseInt(maxOBSID) + 1).toString();
                        //console.log("maxObsID: " + maxOBSID)
                    }
                    
                });
                //console.log('observations:::', max_obs);
                
            } catch (err) {
                console.log(err);
            }   
        }

        // Get the project ID of this observation via the session id
        let project_id = await sessionController.getProjectIDFromSessionID(observation.session_id);

        // Get the type of this observation via the session id
        let type = await sessionController.getTypeFromSessionID(observation.session_id);

        let maxPobsID = await this.getMaxPobsID(project_id, type);

        try {
             //first we need to get the max observation in the db.
            observation.createdate = new Date().toISOString();
            observation.observation_id = (parseInt(max_observation_id) + 1).toString();
            observation.obsID = (parseInt(maxOBSID)).toString();
            observation.PobsID = parseInt(maxPobsID + 1);

            console.log("Models in DB:", Object.keys(this.db));
            console.log("Associations on observations:", Object.keys(this.db.observations.associations));

            console.log("Observation payload:", Object.keys(observation));
            console.log("Keyframes length:", observation.keyframes?.length);

            try {
                data = await this.db.observations.create(observation, {
                    include: [{ model: this.db.keyframes, as: 'keyframes' }]
                });
                } catch (err) {
                console.error("Observation create failed:", err);
                throw err;
                }
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }


    /**
     * Updates an observation with new data, also updates keyframes if
     * comname has changed.
     *
     * Runs inside a Sequelize transaction. First fetches the existing
     * observation to detect whether `comname` changed; if so, the new
     * `comname` is propagated to every keyframe associated with the same
     * `observation_id` within the same transaction. `updateddate` is always
     * set to the current time before the update.
     *
     * Unlike most write methods in this file, this method does not swallow
     * errors: if the observation does not exist, or if any step fails, the
     * transaction is rolled back, the error is logged via `logger.error`,
     * and the error is re-thrown to the caller.
     *
     * An older version of this method (which did not propagate `comname`
     * changes to keyframes) is retained as a commented-out block
     * immediately below this one.
     *
     * @async
     * @param {Object} observation - Observation fields to update. Must
     * include `observation_id` (coerced to an integer) identifying the
     * record to modify. If `comname` is present and differs from the
     * stored value, associated keyframes are updated to match.
     * @returns {Promise<Array>} The Sequelize `update()` result (an array
     * whose first element is the number of affected rows). Throws if the
     * observation is not found or if the update/transaction fails.
     */
    async updateObservation(observation) {
        observation.observation_id = parseInt(observation.observation_id);

        let data = {};
        const t = await this.db.sequelize.transaction(); // transaction for safety

        try {
            // Get the existing observation
            const existingObservation = await this.db.observations.findOne({
                where: { observation_id: observation.observation_id },
                raw: true
            });

            if (!existingObservation) {
                throw new Error(`Observation with ID ${observation.observation_id} not found`);
            }

            // Check if comname changed
            const comnameChanged =
                observation.comname &&
                observation.comname !== existingObservation.comname;

            // Update the observation
            observation.updateddate = new Date().toISOString();
            data = await this.db.observations.update(
                { ...observation },
                {
                    where: { observation_id: observation.observation_id },
                    transaction: t
                }
            );

            // If comname changed, propagate to all associated keyframes
            if (comnameChanged) {
                await this.db.keyframes.update(
                    { comname: observation.comname },
                    {
                        where: { observation_id: observation.observation_id },
                        transaction: t
                    }
                );
            }

            await t.commit();

            // Optional: log for debugging
            if (comnameChanged) {
                logger.info(
                    `Observation ${observation.observation_id}: comname updated to "${observation.comname}" and propagated to keyframes.`
                );
            }

        } catch (err) {
            await t.rollback();
            logger.error('Error::' + err);
            throw err;
        }

        return data;
    }
    /* // old, doesn't update keyframes as well
    async updateObservation(observation) {
        observation.observation_id = parseInt(observation.observation_id);
        let data = {};
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
        return data;
    }*/

    /**
     * Delete an observation by its `observation_id`.
     *
     * Database errors are logged via `logger.error` and swallowed; the
     * method returns whatever `data` currently holds in that case, which is
     * `{}` (its initial value) since the failed `destroy()` call never
     * assigns to it. Callers cannot distinguish "zero rows deleted" (a
     * legitimate `0` from Sequelize) from "the delete failed" (`{}`) purely
     * by checking truthiness, since both are falsy/empty in different ways.
     *
     * There is also a `return {status: ...}` statement immediately after
     * the `return data;` statement below; it is unreachable dead code and
     * references `data.deletedCount`, a property Sequelize's `destroy()`
     * does not actually return (the real return value is a plain row
     * count), so it would have been incorrect even if reachable.
     *
     * @async
     * @param {number|string} observationId - `observation_id` of the record
     * to delete.
     * @returns {Promise<number|Object>} The number of rows deleted (from
     * Sequelize's `destroy()`), or `{}` if the delete threw an error.
     */
    async deleteObservation(observationId) {
        let data = {};
        try {
            data = await this.db.observations.destroy({
                where: {
                    observation_id: observationId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

    /*
    async getMaxPobsID(project_id, type){
         // Get a list of session_id's that share this project_id and type
        let sessionID_list = await sessionController.getSessionIDsWithProjectAndType(project_id, type);
        let observation_list = await this.getObservationsAssociatedWithSessionList(sessionID_list);

        // loop through the observation list finding the max PobsID
        let maxID = -1;

        for(let i = 0; i < observation_list.length; i++){
            var currentObs = observation_list[i];
            var PobsID = currentObs.PobsID;

            if(PobsID != null && PobsID > maxID){
                maxID = PobsID;
            }
        }

        return maxID;
    }*/

    /**
     * Fetch the maximum `PobsID` across all sessions sharing a project and
     * type.
     *
     * First looks up matching sessions via
     * `sessionController.getSessionIDsWithProjectAndType`, then queries the
     * max `PobsID` directly from the database restricted to those session
     * IDs (an improvement over the commented-out older implementation
     * immediately above, which fetched every observation for the sessions
     * into memory and computed the max in JavaScript).
     *
     * Database errors are logged and converted to `-1`, which is also the
     * value returned when no matching `PobsID` is found. As a result,
     * callers cannot distinguish "no observations have a PobsID yet" from
     * "the database query failed".
     *
     * @async
     * @param {number|string} project_id - Project identifier used together
     * with `type` to locate candidate sessions.
     * @param {string} type - Session type used together with `project_id`
     * to locate candidate sessions.
     * @returns {Promise<number>} The highest `PobsID` found, or `-1` if no
     * observations match or the database query fails.
     */
    async getMaxPobsID(project_id, type) {
        // Get a list of session_id's that share this project_id and type
        let sessionID_list = await sessionController.getSessionIDsWithProjectAndType(project_id, type);
    
        // Extract session_id values from sessionID_list
        let session_id_list = sessionID_list.map(session => session.session_id);
    
        // Query the max PobsID directly from the database for the session_id list
        try {
            const result = await this.db.observations.findOne({
                where: {
                    session_id: {
                        [Op.in]: session_id_list
                    }
                },
                attributes: [[Sequelize.fn('max', Sequelize.col('PobsID')), 'maxPobsID']],
                raw: true
            });
    
            // If no PobsID is found, return -1
            return result.maxPobsID ? parseInt(result.maxPobsID) : -1;
        } catch (err) {
            console.log(err);
            return -1;
        }
    }  

    /**
     * Fetch all observations belonging to any session in a supplied list of
     * session objects.
     *
     * This method is only referenced from the commented-out, older
     * implementation of {@link getMaxPobsID} earlier in this file, so as
     * written it does not currently appear to be reachable from any live
     * code path, controller, service, or route.
     *
     * Unlike most other methods in this file, the `catch` block here only
     * logs the error and does not return a fallback value, so a database
     * failure causes this method to resolve to `undefined` rather than an
     * empty array.
     *
     * @async
     * @param {Array<Object>} session_list - Session objects, each expected
     * to have a `session_id` property, used to build the `IN` filter.
     * @returns {Promise<Array<Object>|undefined>} Observations belonging to
     * any of the supplied sessions, or `undefined` if the database query
     * fails.
     */
    async getObservationsAssociatedWithSessionList(session_list){
        // We have a list of session
        // we need to query all observations associated with these sessions.

        var session_id_list = [];

        for(let i = 0; i < session_list.length; i++){
            session_id_list.push(session_list[i].session_id);
        }

        

        try {
            const associatedObs = await this.db.observations.findAll({
                where: {
                    session_id: {
                        [Op.in] : session_id_list 
                    }
                }
            });
            //console.log('associatedObs:::', associatedObs);

            return associatedObs;
            
        } catch (err) {
            console.log(err);
        } 
    }


    /**
     * Retrieve observations associated with a specific video source.
     *
     * The query performs an exact match against the `video_source` field. Results
     * are ordered by `mediaPosition` in ascending order so observations are
     * returned in video sequence.
     *
     * Associated keyframes are loaded with each observation. Because the keyframe
     * association uses `required: true`, Sequelize performs an inner join and
     * excludes observations that do not have at least one associated keyframe.
     *
     * Database errors are logged and converted to an empty array. As a result,
     * callers cannot distinguish between a successful query with no matching
     * observations and a database failure.
     *
     * @async
     * @param {string} videoName - Exact value to match against the observation
     * `video_source` field.
     * @returns {Promise<Array<Object>>} Matching observations with associated
     * keyframes, ordered by ascending `mediaPosition`. Returns an empty array when
     * no observations match or when the database query fails.
     */
    async getObservationsByVideo(videoName) {

        try {
            // Query the observations table for records whose video_source value
            // exactly matches the supplied video name.
            const observations = await this.db.observations.findAll({

                // Use an exact equality match. This does not perform partial,
                // case-insensitive, normalized, or filename-only matching.
                where: {
                    video_source: videoName
                },

                // Return observations in ascending media position so the records
                // follow their sequence within the source video.
                order: [
                    ['mediaPosition', 'ASC']
                ],

                // Load the keyframes associated with each returned observation.
                include: [
                    {
                        // Use the keyframe model registered on the shared db object.
                        model: this.db.keyframes,

                        // Match the alias defined by the Sequelize association.
                        as: 'keyframes',

                        // Require at least one matching keyframe. This creates an
                        // inner join and excludes observations without keyframes.
                        required: true
                    }
                ]
            });

            // Return the Sequelize observation instances, including their loaded
            // keyframe associations, directly to the calling service or controller.
            return observations;

        } catch (err) {
            // Record the database or Sequelize error in the server output.
            console.log(err);

            // Preserve the current repository contract by returning an empty array.
            // This also means callers cannot distinguish an error from no matches.
            return [];
        }
    }


    /**
     * Retrieve grouped video summaries for a specific project.
     *
     * The query selects observations whose associated session belongs to the
     * supplied project. Results are grouped by both `video_source` and
     * `videoLocation`, so the same video source may appear in more than one result
     * when its observations contain different video-location values.
     *
     * Each result includes the number of distinct observation `comname` values,
     * the number of distinct associated sessions, and representative session
     * metadata. The representative dive, line, and session type values are selected
     * independently using SQL `MIN` aggregation and therefore are not guaranteed
     * to originate from the same session record.
     *
     * The session association is required, producing an inner join that excludes
     * observations without a matching session in the requested project.
     *
     * Results are returned as plain objects because the query uses `raw: true`.
     * Database errors are logged and converted to an empty array, so callers cannot
     * distinguish a query failure from a successful query with no matching rows.
     *
     * @async
     * @param {number|string} project_id - Project identifier matched against the
     * associated session's `project_id` field.
     * @returns {Promise<Array<Object>>} Grouped video-summary objects ordered by
     * representative dive and line, or an empty array when no records match or
     * when the database query fails.
     */
    async getVideoSummariesByProject(project_id) {

        try {
            // Query observations and aggregate them into one result for each
            // distinct video_source and videoLocation combination.
            const results = await this.db.observations.findAll({
                attributes: [
                    // Preserve the database video source in each grouped result.
                    'video_source',

                    // Keep videoLocation in both the selected attributes and GROUP BY
                    // clause so separate locations produce separate summary rows.
                    'videoLocation',

                    // Count unique non-null common names represented by observations
                    // in the grouped video and location combination.
                    [
                        fn(
                            'COUNT',
                            fn('DISTINCT', col('observations.comname'))
                        ),
                        'distinct_species_count'
                    ],

                    // Count the number of distinct sessions contributing
                    // observations to the grouped result.
                    [
                        fn(
                            'COUNT',
                            fn('DISTINCT', col('observations.session_id'))
                        ),
                        'session_count'
                    ],

                    // Select the lowest dive value from all matching sessions as
                    // representative metadata for sorting and display.
                    [
                        fn('MIN', col('session.dive')),
                        'dive'
                    ],

                    // Select the lowest line value from all matching sessions.
                    // This value is aggregated independently from the dive value.
                    [
                        fn('MIN', col('session.line')),
                        'line'
                    ],

                    // Select the minimum session type value across matching sessions.
                    // For strings, MIN is determined by the database's text ordering.
                    [
                        fn('MIN', col('session.type')),
                        'session_type'
                    ]
                ],

                // Join each observation to its associated session so the query can
                // restrict results to one project and aggregate session metadata.
                include: [
                    {
                        // Use the sessions model registered on the shared db object.
                        model: this.db.sessions,

                        // Match the alias declared by the Sequelize association.
                        as: 'session',

                        // Do not include a nested session object because the required
                        // session values are selected explicitly as aggregate columns.
                        attributes: [],

                        // Restrict the joined sessions to the requested project.
                        where: {
                            project_id: project_id
                        },

                        // Require a matching session. This produces an inner join and
                        // excludes observations without a qualifying session.
                        required: true
                    }
                ],

                // Create one summary row for each unique video source and location.
                group: [
                    'observations.video_source',
                    'observations.videoLocation'
                ],

                // Order summaries first by the minimum dive value and then by the
                // minimum line value within each grouped result.
                order: [
                    [
                        fn('MIN', col('session.dive')),
                        'ASC'
                    ],
                    [
                        fn('MIN', col('session.line')),
                        'ASC'
                    ]
                ],

                // Return plain JavaScript objects rather than Sequelize model instances.
                raw: true
            });

            // Return the grouped summaries directly to the service or controller.
            return results;

        } catch (err) {
            // Log the database or Sequelize failure for server-side diagnosis.
            logger.error('Error in getVideoSummariesByProject::' + err);

            // Preserve the current repository contract by returning an empty array.
            // This makes database failures indistinguishable from no matching data.
            return [];
        }
    }


    /**
     * Retrieve observations for a specific video within a named project.
     *
     * The function first performs an exact lookup of the project `name` field.
     * It then retrieves observations whose `video_source` exactly matches the
     * supplied video source and whose associated session belongs to that project.
     *
     * The session association uses `required: true`, so observations without a
     * matching session in the selected project are excluded.
     *
     * The keyframe association uses `required: false`, so observations are returned
     * whether or not they have associated keyframes. When keyframes exist, they are
     * included under the configured `keyframes` association.
     *
     * Results are ordered by `mediaPosition` in ascending order.
     *
     * If the project is not found, accessing `project.project_id` causes an error.
     * That error, along with database and Sequelize errors, is logged and converted
     * to an empty array. Callers therefore cannot distinguish between no matching
     * observations, a missing project, and a failed query.
     *
     * @async
     * @param {string} videoSource - Exact value to match against `video_source`.
     * @param {string} projectName - Exact project name used to locate the project.
     * @returns {Promise<Array<Object>>} Matching observations with optional
     * keyframes, ordered by ascending `mediaPosition`, or an empty array when no
     * records match, the project is not found, or the query fails.
     */
    async getObservationsByVideoAndProject(videoSource, projectName) {

        try {
            // Find the project whose name exactly matches the supplied project name.
            // This lookup does not perform partial or case-insensitive matching.
            const project = await this.db.projects.findOne({
                where: {
                    name: projectName
                }
            });

            // Query observations that match the requested video source and belong
            // to a session associated with the located project.
            const observations = await this.db.observations.findAll({
                include: [
                    {
                        // Join each observation to its associated session.
                        model: this.db.sessions,

                        // Match the alias configured by the Sequelize association.
                        as: 'session',

                        // Require a matching session so only observations belonging
                        // to the selected project are included.
                        required: true,

                        // Restrict the joined session to the located project ID.
                        where: {
                            project_id: project.project_id
                        }
                    },
                    {
                        // Load keyframes associated with each observation.
                        model: this.db.keyframes,

                        // Match the alias configured by the Sequelize association.
                        as: 'keyframes',

                        // Use an optional association so observations without
                        // keyframes remain in the result.
                        required: false
                    }
                ],

                // Match the stored video_source value exactly.
                where: {
                    video_source: videoSource
                },

                // Return observations in ascending position within the video.
                order: [
                    ['mediaPosition', 'ASC']
                ]
            });

            // Return Sequelize observation instances with their associated session
            // and any available keyframes.
            return observations;

        } catch (err) {
            // Log missing-project errors and database or Sequelize failures.
            logger.error(
                'Error in getObservationsByVideoAndProject::' + err
            );

            // Preserve the current repository contract by returning an empty array.
            // This makes missing projects and query failures indistinguishable from
            // a successful query with no matching observations.
            return [];
        }
    }


    /**
     * Retrieve observations for a video whose common names belong to a supplied list.
     *
     * The query performs an exact equality match against `video_source` and uses
     * SQL `IN` matching against the observation `comname` field. Results are
     * ordered by `mediaPosition` in ascending order so they follow their sequence
     * within the source video.
     *
     * Associated keyframes are loaded with every returned observation. Because the
     * keyframe association uses `required: true`, observations without at least one
     * associated keyframe are excluded.
     *
     * The `comnameList` argument must be an array suitable for Sequelize's `Op.in`
     * operator. A comma-separated string is not converted into an array by this
     * function.
     *
     * Database errors are logged and converted to an empty array. Callers therefore
     * cannot distinguish between no matching observations and a failed query.
     *
     * @async
     * @param {string} videoName - Exact value to match against `video_source`.
     * @param {string[]} comnameList - Common names accepted by the query.
     * @returns {Promise<Array<Object>>} Matching observations with associated
     * keyframes, ordered by ascending `mediaPosition`, or an empty array when no
     * records match or the database query fails.
     */
    async getObservationsByVideoAndComnames(videoName, comnameList) {
        try {
            // Query observations matching both the exact video source and one of
            // the supplied common-name values.
            const observations = await this.db.observations.findAll({
                where: {
                    // Match the stored video_source value exactly. This does not
                    // perform partial, normalized, or case-insensitive matching.
                    video_source: videoName,

                    // Restrict results to observations whose comname is included
                    // in the supplied array.
                    comname: {
                        [Op.in]: comnameList
                    }
                },

                // Return observations in their ascending position within the video.
                order: [
                    ['mediaPosition', 'ASC']
                ],

                // Load keyframes associated with every returned observation.
                include: [
                    {
                        // Use the keyframe model registered on the shared db object.
                        model: this.db.keyframes,

                        // Match the alias defined by the Sequelize association.
                        as: 'keyframes',

                        // Require at least one associated keyframe. This produces
                        // an inner join and excludes observations without keyframes.
                        required: true
                    }
                ]
            });

            // Return Sequelize observation instances with loaded keyframe data.
            return observations;

        } catch (err) {
            // Log Sequelize or database failures for server-side diagnosis.
            console.log(err);

            // Preserve the current repository contract by returning an empty array.
            // This makes errors indistinguishable from a query with no matches.
            return [];
        }
    }


    /**
     * Retrieve observations with keyframes whose common names belong to a supplied list.
     *
     * The query uses Sequelize's `Op.in` operator to match the observation
     * `comname` field against the supplied array. Results are ordered by
     * `mediaPosition` in ascending order.
     *
     * Associated keyframes are included with every returned observation. Because
     * the keyframe association uses `required: true`, Sequelize performs an inner
     * join and excludes observations without at least one associated keyframe.
     *
     * An empty `comnameList` normally produces no matching observations. The
     * repository does not currently validate that the argument is an array.
     *
     * Database and Sequelize errors are logged and converted to an empty array.
     * Callers therefore cannot distinguish between no matching observations and a
     * failed repository query.
     *
     * @async
     * @param {string[]} comnameList - Common names accepted by the query.
     * @returns {Promise<Array<Object>>} Matching observations with associated
     * keyframes, ordered by ascending `mediaPosition`, or an empty array when no
     * observations match or the database query fails.
     */
    async getObservationsWithKeyframesByComnames(comnameList) {
        try {
            // Query observations whose comname appears in the supplied list.
            const observations = await this.db.observations.findAll({
                where: {
                    // Use SQL IN matching against the observation common-name field.
                    comname: {
                        [Op.in]: comnameList
                    }

                    // A previous review-state filter was considered here but is
                    // currently disabled.
                    // note: 'R'
                },

                // Return observations in ascending order within their source media.
                order: [
                    ['mediaPosition', 'ASC']
                ],

                // Load keyframes associated with every matching observation.
                include: [
                    {
                        // Use the keyframe model registered on the shared db object.
                        model: this.db.keyframes,

                        // Match the alias defined by the Sequelize association.
                        as: 'keyframes',

                        // Require at least one associated keyframe. This excludes
                        // observations without keyframe records.
                        required: true
                    }
                ]
            });

            // Return Sequelize observation instances with loaded keyframe data.
            return observations;

        } catch (err) {
            // Log database and Sequelize failures for server-side diagnosis.
            console.error(
                'Error in getObservationsWithKeyframesByComnames:',
                err
            );

            // Preserve the existing repository contract by returning an empty array.
            // This prevents the repository error from reaching the route's catch block.
            return [];
        }
    }


    
     /**
     * Retrieves all distinct comnames from observations that have associated keyframes.
     * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
     */
    async getDistinctComnamesWithKeyframes() {
        try {
            const comnamesData = await this.db.observations.findAll({
                attributes: [
                    [Sequelize.fn('DISTINCT', Sequelize.col('observations.comname')), 'comname']
                ],
                where: 
                Sequelize.literal(`
                    EXISTS (
                        SELECT 1 
                        FROM keyframes 
                        WHERE keyframes.observation_id = observations.observation_id
                    )
                `),
                raw: true // Return raw data without metadata
            });

            // Extract comname values from the result
            const comnames = comnamesData.map(item => item.comname);

            return comnames;
        } catch (err) {
            console.error('Error fetching distinct comnames:', err);
            throw err;
        }
    }


    


    /**
     * Returns data for a user dashboard that gives us counts on how much
     * activity a user has participated in.
     *
     * Delegates the actual aggregation to
     * {@link getObservationsGroupedByUserAndDate}, then resolves each row's
     * numeric `user_id` to a display name via
     * `userController.getUserNameByID`, building a
     * `{ [userName]: { [date]: { sessions, observations, projects } } }`
     * structure. Only the `observations` count is currently populated;
     * `sessions` and `projects` are initialized to `0` and never updated
     * (the commented-out `sessionController.getSessionsGroupedByUserAndDate`
     * call that would presumably populate `sessions` is disabled).
     *
     * If the underlying grouped-observation query fails and resolves to
     * `undefined` (see {@link getObservationsGroupedByUserAndDate}),
     * iterating over it here throws a `TypeError`, which is caught by this
     * method's own `catch` block; the error is logged and this method then
     * resolves to `undefined` as well, rather than an empty object.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive)
     * forwarded to the grouped-observation query.
     * @param {string|Date} endDate - End of the date range (inclusive)
     * forwarded to the grouped-observation query.
     * @returns {Promise<Object|undefined>} Dashboard data keyed by user name
     * then by date, or `undefined` if the underlying query fails or throws.
     */
    async getUserDashboardData(startDate, endDate) {
        // Combine all the data by user and date into a single object
        let dashboardData = {};
    
        try {
            // Get Sessions for each user, grouped by user and date
            //const sessionData = await sessionController.getSessionsGroupedByUserAndDate(startDate, endDate);
    
            // Fetch the number of observations each user made, grouped by user and date
            const observationData = await this.getObservationsGroupedByUserAndDate(startDate, endDate);
    
            // Process observation data using for...of loop
            for (const item of observationData) {
                // Await the user name retrieval
                let userName = await userController.getUserNameByID(item.user_id);
    
                if (!dashboardData[userName]) {
                    dashboardData[userName] = {};
                }
                if (!dashboardData[userName][item.date]) {
                    dashboardData[userName][item.date] = { sessions: 0, observations: 0, projects: 0 };
                }
    
                dashboardData[userName][item.date].observations = parseInt(item.observationCount);
            }
    
            return dashboardData;
        } catch (error) {
            console.log('Error fetching dashboard data:', error);
        }
    }

    
    /**
     * Fetch observation counts grouped by session owner (`user_id`) and
     * creation date within a date range.
     *
     * Joins each observation to its session (`required: true`, so
     * observations without a session are excluded) to obtain `user_id`,
     * groups by `user_id` and the date portion of `createdAt`, and counts
     * observations per group. Restricts to observations whose `createdAt`
     * falls between `startDate` and `endDate` (inclusive, via `Op.between`).
     *
     * Database errors are logged and swallowed without a `return`
     * statement in the `catch` block, so this method resolves to
     * `undefined` (not an empty array) when the query fails. Callers
     * (e.g. {@link getUserDashboardData}) must handle that case.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive)
     * used to filter observations by `createdAt`.
     * @param {string|Date} endDate - End of the date range (inclusive) used
     * to filter observations by `createdAt`.
     * @returns {Promise<Array<Object>|undefined>} Raw rows containing
     * `user_id`, `date`, and `observationCount`, or `undefined` if the
     * database query fails.
     */
    async getObservationsGroupedByUserAndDate(startDate, endDate){
        try{
            // Fetch the number of observations each user made, grouped by user and date
            const observationData = await this.db.observations.findAll({
                include: [{
                    model: this.db.sessions,
                    as: 'session',
                    attributes: ['user_id'],
                    required: true
                }],
                attributes: [
                    [Sequelize.col('session.user_id'), 'user_id'],
                    [Sequelize.fn('DATE', Sequelize.col('observations.createdAt')), 'date'],
                    [Sequelize.fn('COUNT', Sequelize.col('observation_id')), 'observationCount']
                ],
                where: {
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]
                    }
                },
                group: ['session.user_id', 'date'],
                raw: true
            });

            return observationData;
        }catch(err){
            console.log('Error getting observations grouped by user and date: ' + err);
        }
    
    }

    /**
     * Determines whether a given observation is the first observation of
     * its session on its calendar day, using a per-session/per-day memo
     * cache (`this.firstLastSessionObsPerDay`) to avoid repeating the
     * lookup query for later observations in the same session/day.
     *
     * If `obsIndex` is `0`, the observation is assumed to be first without
     * querying the database (this is only correct if the caller's
     * `observations` array is itself already sorted so that index `0` is
     * chronologically first for every session, which is the case for the
     * one caller, {@link getProjectTimeByDateAndUser}, but is not verified
     * here). Otherwise, the first observation for the session/day is looked
     * up once via a `findOne` ordered by ascending `createdAt` and cached.
     *
     * `this.firstLastSessionObsPerDay` is a plain object stored on this
     * singleton repository instance. It is never cleared, so its memory
     * usage grows for the lifetime of the process across all requests, and
     * cached values persist across unrelated calls (including calls for
     * different date ranges covering the same session/day).
     *
     * This method has no `try`/`catch`; a database failure in the
     * `findOne` call propagates as a rejected promise to the caller.
     *
     * @async
     * @param {Array<Object>} observations - The full, chronologically
     * sorted list of observations being processed by the caller. Only used
     * to detect the `obsIndex === 0` case.
     * @param {Object} observation - The observation to test. Must have
     * `session_id`, `createdAt`, and `observation_id`.
     * @param {number} obsIndex - Index of `observation` within
     * `observations`.
     * @returns {Promise<boolean>} `true` if `observation` is the first
     * observation of its session on its day, `false` otherwise.
     */
    async isFirstObservationForSessionOnDay(observations, observation, obsIndex) {
    
        let returnVal = false;
        const session_id = observation.session_id;
        const date = observation.createdAt;
        const day = moment(date).format('YYYY-MM-DD');

        

        // Track the time spent per project and user
        if (!this.firstLastSessionObsPerDay[session_id]){
            this.firstLastSessionObsPerDay[session_id] = {};
        } 

        if (!this.firstLastSessionObsPerDay[session_id][day]){
            this.firstLastSessionObsPerDay[session_id][day] = {};
        } 

        // If this is the first value in the list, it's automatically the first observation
        if (obsIndex === 0) {
            this.firstLastSessionObsPerDay[session_id][day]["first"] = observation;
            return true;
        }

        let firstObservationForSessionAndDay = {};

        // Check if we've already found a first observation for this session/day
        if (!this.firstLastSessionObsPerDay[session_id][day]["first"]){

            // we have not previously found a first observation for this session/day, go ahead and query it
             // Define the start and end of the day for the query
            const startDate = moment(day).startOf('day').toDate();   // Start of the day (00:00:00)
            const endDate = moment(day).endOf('day').toDate();       // End of the day (23:59:59)
        
            // Fetch the first observation for the given session and date
            firstObservationForSessionAndDay = await this.db.observations.findOne({
                attributes: [
                    'obsID',
                    'observation_id',
                    'createdAt',
                    [Sequelize.fn('DATE', Sequelize.col('createdAt')), 'date']
                ],
                where: {
                    session_id: session_id,  // Filter by session ID
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]  // Filter by the date range for that day
                    }
                },
                order: [
                    ['createdAt', 'ASC']  // Ensure the earliest observation is fetched
                ],
                raw: true
            });

            this.firstLastSessionObsPerDay[session_id][day]["first"] = firstObservationForSessionAndDay;

        }else{

            // we HAVE previously found a first observation for this session day.
            firstObservationForSessionAndDay = this.firstLastSessionObsPerDay[session_id][day]["first"];
        }
    
        
        // Check if the current observation matches the first one
        if (firstObservationForSessionAndDay && firstObservationForSessionAndDay.observation_id === observation.observation_id) {
            returnVal = true;  // Current observation is the first one
        }
    
        return returnVal;
    }


    /**
     * Determines whether a given observation is the last observation of
     * its session on its calendar day. Mirrors
     * {@link isFirstObservationForSessionOnDay}, but checks whether
     * `obsIndex` is the last index in `observations` and, when querying,
     * orders by descending `createdAt` and caches under the `"last"` key of
     * the same per-session/per-day memo cache
     * (`this.firstLastSessionObsPerDay`).
     *
     * The same caveats apply as for {@link isFirstObservationForSessionOnDay}:
     * the memo cache is unbounded and never cleared for the lifetime of
     * this singleton repository instance, and there is no `try`/`catch`, so
     * a database failure propagates as a rejected promise to the caller.
     *
     * @async
     * @param {Array<Object>} observations - The full, chronologically
     * sorted list of observations being processed by the caller. Only used
     * to detect whether `obsIndex` is the last index.
     * @param {Object} observation - The observation to test. Must have
     * `session_id`, `createdAt`, and `observation_id`.
     * @param {number} obsIndex - Index of `observation` within
     * `observations`.
     * @returns {Promise<boolean>} `true` if `observation` is the last
     * observation of its session on its day, `false` otherwise.
     */
    async isLastObservationForSessionOnDay(observations, observation, obsIndex) {
    
        let returnVal = false;
        const session_id = observation.session_id;
        const date = observation.createdAt;
        const day = moment(date).format('YYYY-MM-DD');

        

        // Track the time spent per project and user
        if (!this.firstLastSessionObsPerDay[session_id]) this.firstLastSessionObsPerDay[session_id] = {};
        if (!this.firstLastSessionObsPerDay[session_id][day]) this.firstLastSessionObsPerDay[session_id][day] = {};

        // If this is the first value in the list, it's automatically the first observation
        if (obsIndex == observations.length - 1) {
            this.firstLastSessionObsPerDay[session_id][day]["last"] = observation;
            return true;
        }

        let lastObservationForSessionAndDay = {};

        // Check if we've already found a first observation for this session/day
        if (!this.firstLastSessionObsPerDay[session_id][day]["last"]){

            // we have not previously found a first observation for this session/day, go ahead and query it
             // Define the start and end of the day for the query
            const startDate = moment(day).startOf('day').toDate();   // Start of the day (00:00:00)
            const endDate = moment(day).endOf('day').toDate();       // End of the day (23:59:59)
        
            // Fetch the first observation for the given session and date
            lastObservationForSessionAndDay = await this.db.observations.findOne({
                attributes: [
                    'obsID',
                    'observation_id',
                    'createdAt',
                    [Sequelize.fn('DATE', Sequelize.col('createdAt')), 'date']
                ],
                where: {
                    session_id: session_id,  // Filter by session ID
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]  // Filter by the date range for that day
                    }
                },
                order: [
                    ['createdAt', 'DESC']  // Ensure the last observation is fetched
                ],
                raw: true
            });

            this.firstLastSessionObsPerDay[session_id][day]["last"] = lastObservationForSessionAndDay;

        }else{

            // we HAVE previously found a last observation for this session day.
            lastObservationForSessionAndDay = this.firstLastSessionObsPerDay[session_id][day]["last"];
        }
    
        
        // Check if the current observation matches the last one
        if (lastObservationForSessionAndDay && lastObservationForSessionAndDay.observation_id === observation.observation_id) {
            returnVal = true;  // Current observation is the last one
        }
    
        return returnVal;
    }


    //
    /**
     * Finds the next observation in the observations list that has the same session_id and occurs on the same day as the given observation.
     * The observations list is sorted by timestamp, but multiple session_ids may be dispersed throughout the list.
     * Once a different day is encountered, the search stops.
     *
     * @param {Array} observations - List of observations, sorted by date.
     * @param {Object} observation - The observation to compare against.
     * @param {Number} obsIndex - The index of the current observation in the list.
     * @returns {Object|null} - The next observation on the same day with the same session_id, or null if none is found.
     */
    async getNextObservation(observations, observation, obsIndex) {
        // Extract session_id and day of the current observation
        const session_id = observation.session_id;
        const observationDay = moment(observation.dataValues.date).format('YYYY-MM-DD'); // Format the observation date to 'YYYY-MM-DD'

        // Start the loop from the next observation
        for (let i = obsIndex + 1; i < observations.length; i++) {
            const nextObservation = observations[i]; // Get the next observation to compare
            const nextDay = moment(nextObservation.dataValues.date).format('YYYY-MM-DD'); // Format the next observation date to 'YYYY-MM-DD'

            // If the day changes, stop searching as the list is sorted and future observations cannot match
            if (nextDay !== observationDay) {
                return null; // No further observations on the same day, so we return null
            }

            // If the session_id matches, return the current nextObservation
            if (nextObservation.session_id === session_id) {
                return nextObservation; // Found the next observation with matching session_id and day
            }

            // If the day is the same but session_id doesn't match, continue searching
        }

        // If no matching observation is found by the end of the loop, return null
        return null;
    }


    /**
     * Returns a list of projects, with a sublist of dates, and a subsublist of users, which each
     * users time on that date for that project recorded.
     *
     * Fetches every observation whose `createdAt` falls within
     * `startDate`/`endDate` (inclusive), joined through its session to the
     * recording user and project. For each observation, estimates elapsed
     * time using a 5-minute padding heuristic:
     *  - If it is the first observation of its session on that day (per
     *    {@link isFirstObservationForSessionOnDay}), the clock starts 5
     *    minutes before it; otherwise the clock starts at the observation's
     *    own timestamp.
     *  - If it is the last observation of its session on that day (per
     *    {@link isLastObservationForSessionOnDay}), the clock ends 5
     *    minutes after it. Otherwise, the next observation for the same
     *    session/day is located via {@link getNextObservation}; if the gap
     *    to it is 5 minutes or more, the clock ends 5 minutes after the
     *    current observation, otherwise it ends exactly at the next
     *    observation's timestamp.
     *
     * Note that the accumulated `timeSpent` is only added to
     * `minutes_recorded` inside the `else` branch of the "is this the last
     * observation" check (i.e. only for observations that are not the last
     * of their session/day) — the last observation of each session/day
     * therefore does not have its own time window added to the total, so
     * totals are likely undercounted by roughly one observation's worth of
     * time per session per day.
     *
     * This method has no top-level `try`/`catch`; a failure in the
     * underlying query or in any of the per-observation helper methods
     * propagates as a rejected promise to the caller.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive)
     * used to filter observations by `createdAt`.
     * @param {string|Date} endDate - End of the date range (inclusive) used
     * to filter observations by `createdAt`.
     * @returns {Promise<Object>} An object of the shape
     * `{ [project_name]: { [date]: { [user_name]: minutes } } }`. Throws if
     * the underlying query or any per-observation lookup fails.
     */
    async getProjectTimeByDateAndUser(startDate, endDate){

        // First get a list of observations grouped by session_id, that were created between startDate and endDate
        const observations = await this.db.observations.findAll({
            // join session, user and project, so we'll have observations[0].session.user, or observations[0].session.project.name, etc
            include: [
                {
                    model: this.db.sessions,
                    as: 'session',
                    include: [
                        {
                            model: this.db.users,
                            as: 'user',
                            attributes: ['user_id', 'name'] // Include user data
                        },
                        {
                            model: this.db.projects,
                            as: 'project',
                            attributes: ['project_id', 'name'] // Include project data
                        }
                    ],
                    group: ['session.project_id', 'date']
                }
            ],
            attributes: [
                [Sequelize.col('session.user_id'), 'user_id'],
                [Sequelize.col('session.user.name'), 'user_name'],
                [Sequelize.col('observations.obsID'), 'obsID'],
                [Sequelize.col('observations.observation_id'), 'observation_id'],
                [Sequelize.col('observations.createdAt'), 'createdAt'],
                [Sequelize.col('session.session_id'), 'session_id'],
                [Sequelize.col('session.project.name'), 'project_name'],
                [Sequelize.fn('DATE', Sequelize.col('observations.createdAt')), 'date']
            ],
            where: {
                createdAt: {
                    [Sequelize.Op.between]: [startDate, endDate]
                }
            },
            order: [['createdAt', 'ASC']]
        });

        // store minutes_recorded[project_name][date][user_name]
        const minutes_recorded = {};

        let obsIndex = 0;

        // loop through all observations
        for (const observation of observations) {
            const user_id = observation.user_id;
            const user_name = observation.session.user.name;
            const obsID = observation.obsID;
            const session_id = observation.session_id;
            const project_name = observation.session.project.name;
            const date = observation.dataValues.date;
            const createdAt = observation.createdAt;
            const day = moment(date).format('YYYY-MM-DD');

            // Track the time spent per project and user
            if (!minutes_recorded[project_name]) minutes_recorded[project_name] = {};
            if (!minutes_recorded[project_name][day]) minutes_recorded[project_name][day] = {};
            if (!minutes_recorded[project_name][day][user_name]) minutes_recorded[project_name][day][user_name] = 0;

            // now we decide how much time to allocate for this observation, this follows 3 rules.
            // 1. If this is the first observation, for this session, on this day, we start the clock 5 minutes before this observation.
            //    other wise we start the clock at this observation time exactly.
            // 2. If this is the last observation, for this session, on this day, we end the clock 5 minutes after this observation.
            //    other wise we continue to #3
            // 3. This is not the last observation, for this session, on this day, so we get the next observation after this one.
            //    If the next observation is more than 5 minutes after the current observation time, we end the clock 5 minutes
            //       after this observation.
            //    Else, the next observation is less than 5 minutes after the current observation time, we end the clock AT
            //       the next observation time.

            let startTime;
            let endTime;

            // we then sum all these times up for each project/day/user
            let isFirstObservation = await this.isFirstObservationForSessionOnDay(observations, observation, obsIndex);

            if(isFirstObservation){

                // this is the first observation of the day, set the start time to 5 minutes before this observation
                startTime = moment(createdAt).subtract(5, 'minutes');
            }else{

                // this is not the first observation of the day, set the start time to the observation time.
                startTime = moment(createdAt);
            }


            // we then sum all these times up for each project/day/user
            let isLastObservation = await this.isLastObservationForSessionOnDay(observations, observation, obsIndex);

            // Now check if we are the last observation for this session on this day
            if(isLastObservation){

                // this is the last observation of the day, set the end time to 5 minutes after this observation
                endTime = moment(createdAt).add(5, 'minutes');
            }else{
                // this is not the last observation of the day, we'll get the next observation for this session/day, and set the end time to
                // it's start time.
                
                // Get the next observation
                let nextObservation = await this.getNextObservation(observations, observation, obsIndex);
                
                // check if nextObservation is null, and set end to 5 minutes after this observation
                let nextCreatedAt;
                if(nextObservation == null){
                    nextCreatedAt = moment(createdAt).add(5, 'minutes');
                }else{
                    nextCreatedAt = nextObservation.createdAt;
                }
                

                // if nextCreatedAt is larger than 5 minutes after createdAt, then we'll use endtime of 5 minutes after createdAt
                const currTime = moment(createdAt);
                const nextTime = moment(nextCreatedAt);
                
                const gap_minutes = nextTime.diff(currTime, 'minutes');

                if(gap_minutes >= 5){
                    endTime = moment(createdAt).add(5, 'minutes');
                }else{
                    // else if nextCreatedAt is less than 5 minutes, we'll set end time to that.
                    endTime = moment(nextCreatedAt);
                }

                const timeSpent = endTime.diff(startTime, 'seconds');

                minutes_recorded[project_name][day][user_name] = minutes_recorded[project_name][day][user_name] + (timeSpent/60);

                

                // get the time of this observation

                // set end time to the time of this observation
            }

            // increase obsIndex
            obsIndex = obsIndex + 1;
        }

        // Return the queried values
        return minutes_recorded;

    }


    

    /**
     * Utility function to get the observation immediately preceding a given
     * observation within the same session, ordered by `createdAt`.
     *
     * Fetches every observation for the session (ordered ascending by
     * `createdAt`), then locates the given `obsID` by comparing
     * `obs.obsID === obsID` and returns the element immediately before it.
     * Only referenced from {@link getTimeSpentPerUserPerProject}, which is
     * itself not wired to any controller/service/route (see that method's
     * documentation).
     *
     * This method has no `try`/`catch`; a database failure propagates as a
     * rejected promise to the caller.
     *
     * @async
     * @param {number|string} sessionId - Session identifier whose
     * observations are searched.
     * @param {number|string} obsID - Per-session sequential observation
     * identifier identifying the reference observation. Compared with
     * strict equality (`===`) against each fetched observation's `obsID`.
     * @returns {Promise<Object|null>} The observation immediately preceding
     * the identified one, or `null` if the identified observation is the
     * first in the session or is not found at all.
     */
    async getPreviousObservation(sessionId, obsID) {
        // Fetch observations for the specified session, ordered by createdAt
        const observations = await this.db.observations.findAll({
            where: { session_id: sessionId },
            order: [['createdAt', 'ASC']] // Sort by createdAt to get them in order
        });

        // Find the index of the current observation by obsID
        const currentIndex = observations.findIndex(obs => obs.obsID === obsID);

        // If the current observation is found and it's not the first observation
        if (currentIndex > 0) {
            return observations[currentIndex - 1]; // Return the previous observation
        }

        return null; // Return null if there's no previous observation
    }

    /**
     * Group per-user, per-project time totals by month.
     *
     * Only referenced from {@link getTimeSpentPerUserPerProject}, which is
     * itself not wired to any controller/service/route.
     *
     * The month key used for every entry is `moment().format('YYYY-MM')`,
     * i.e. the current month at the time this function runs, rather than
     * the month the underlying observation data actually occurred in. As
     * written, all input data ends up grouped under a single "current
     * month" bucket regardless of when the recorded time actually took
     * place.
     *
     * @async
     * @param {Object} data - Time totals keyed as
     * `{ [userId]: { [projectId]: totalMinutes } }`.
     * @returns {Promise<Object>} Data re-keyed as
     * `{ [month]: { [userId]: { [projectId]: totalMinutes } } }`, where
     * `month` is always the current month rather than a month derived from
     * the input data.
     */
    async groupByMonth(data) {
        const groupedData = {};
        Object.keys(data).forEach(userId => {
            Object.keys(data[userId]).forEach(projectId => {
                const totalMinutes = data[userId][projectId];
                const month = moment().format('YYYY-MM'); // For example, group by current month

                if (!groupedData[month]) groupedData[month] = {};
                if (!groupedData[month][userId]) groupedData[month][userId] = {};
                if (!groupedData[month][userId][projectId]) groupedData[month][userId][projectId] = 0;

                groupedData[month][userId][projectId] += totalMinutes;
            });
        });
        return groupedData;
    }

    /**
     * Function to get the first observation (by ascending `createdAt`) for
     * a specific session ID, intended to memoize the result on
     * `this.firstLastSessionObs` so repeated calls for the same session
     * skip the database query.
     *
     * BUG: every reference to the memo cache in this method's body uses the
     * bare identifier `firstLastSessionObs` instead of
     * `this.firstLastSessionObs` (the actual class field declared near the
     * top of this class). Class bodies execute in strict mode, and no
     * top-level or outer-scope `firstLastSessionObs` variable exists in
     * this module, so every invocation of this method throws
     * `ReferenceError: firstLastSessionObs is not defined` on the first
     * line that touches it, before any query is even attempted. There is no
     * `try`/`catch`, so that error propagates directly to the caller.
     *
     * Only referenced from {@link getTimeSpentPerUserPerProject}, which is
     * itself not wired to any controller/service/route in this codebase, so
     * this bug is not currently reachable from any live API request — but
     * it will surface immediately if this method or its caller is ever
     * wired up.
     *
     * @async
     * @param {number|string} sessionId - Session identifier whose earliest
     * observation should be retrieved.
     * @returns {Promise<Object|null>} Intended to resolve to the earliest
     * observation for the session, or `null` if none exists. In its
     * current state, always throws a `ReferenceError` instead.
     */
    async getFirstObservationBySessionId(sessionId) {

        let firstObservation = null;

        // Track the time spent per project and user
        if (!firstLastSessionObs[sessionId]) firstLastSessionObs[sessionId] = {};

        if (!firstLastSessionObs[sessionId]["first"]){

            firstLastSessionObs[sessionId]["first"] = {};

            firstObservation = await this.db.observations.findOne({
                where: {
                    session_id: sessionId
                },
                order: [['createdAt', 'ASC']] // Order by createdAt ascending to get the first observation
            });

            firstLastSessionObs[sessionId]["first"] = firstObservation;

        }else{
            firstObservation = firstLastSessionObs[sessionId]["first"];
        }

        return firstObservation;
    }

    /**
     * Function to get the last observation (by descending `createdAt`) for
     * a specific session ID, intended to memoize the result on
     * `this.firstLastSessionObs` so repeated calls for the same session
     * skip the database query.
     *
     * BUG: as with {@link getFirstObservationBySessionId}, every reference
     * to the memo cache here uses the bare identifier
     * `firstLastSessionObs` instead of `this.firstLastSessionObs`. Since
     * class bodies run in strict mode and no such variable is declared in
     * this module's scope, every call to this method throws
     * `ReferenceError: firstLastSessionObs is not defined` before any query
     * runs. There is no `try`/`catch`, so the error propagates to the
     * caller.
     *
     * Only referenced from {@link getTimeSpentPerUserPerProject}, which is
     * itself not wired to any controller/service/route in this codebase.
     *
     * @async
     * @param {number|string} sessionId - Session identifier whose latest
     * observation should be retrieved.
     * @returns {Promise<Object|null>} Intended to resolve to the latest
     * observation for the session, or `null` if none exists. In its
     * current state, always throws a `ReferenceError` instead.
     */
    async getLastObservationBySessionId(sessionId) {

        let lastObservation = null;

        // Track the time spent per project and user
        if (!firstLastSessionObs[sessionId]) firstLastSessionObs[sessionId] = {};

        if (!firstLastSessionObs[sessionId]["last"]){

            firstLastSessionObs[sessionId]["last"] = {};

            lastObservation = await this.db.observations.findOne({
                where: {
                    session_id: sessionId
                },
                order: [['createdAt', 'DESC']] // Order by createdAt ascending to get the first observation
            });

            firstLastSessionObs[sessionId]["last"] = lastObservation;

        }else{
            lastObservation = firstLastSessionObs[sessionId]["last"];
        }

        return lastObservation;
    }

    /**
     * Main function to calculate time spent per user per project, across
     * all observations (not restricted to a date range), grouped by month.
     *
     * For every observation, joined to its session/user/project, this
     * computes a start/end time window using a 5-minute padding heuristic
     * around the session's first/last observation (via
     * {@link getFirstObservationBySessionId} and
     * {@link getLastObservationBySessionId}), adds a gap adjustment based
     * on {@link getPreviousObservation}, and accumulates minutes per user
     * per project. The totals are then grouped by month via
     * {@link groupByMonth}.
     *
     * This method, and everything it calls
     * ({@link getFirstObservationBySessionId},
     * {@link getLastObservationBySessionId}, {@link getPreviousObservation},
     * {@link groupByMonth}), is not currently referenced from the
     * observation service, controller, or server.js — it is unreachable
     * from any API route. It is also currently broken: because
     * {@link getFirstObservationBySessionId} and
     * {@link getLastObservationBySessionId} unconditionally throw a
     * `ReferenceError` (see their documentation), any call to this method
     * will throw as soon as it processes its first observation. There is no
     * `try`/`catch` here either, so that error (or any query failure)
     * propagates directly to the caller.
     *
     * @async
     * @returns {Promise<Object>} Intended to resolve to time totals grouped
     * as `{ [month]: { [userName]: { [projectName]: minutes } } }`. In its
     * current state, always throws before returning.
     */
    async getTimeSpentPerUserPerProject() {

        // Fetch observations along with session and user data
        const observations = await this.db.observations.findAll({
            include: [
                {
                    model: this.db.sessions,
                    as: 'session',
                    include: [
                        {
                            model: this.db.users,
                            as: 'user',
                            attributes: ['user_id', 'name'] // Include user data
                        },
                        {
                            model: this.db.projects,
                            as: 'project',
                            attributes: ['project_id', 'name'] // Include project data
                        }
                    ]
                }
            ],
            order: [['createdAt', 'ASC']] // Sort by timestamp
        });

        const userProjectTime = {}; // Store user time per project

        // Iterate over observations and calculate time
        for (const observation of observations) { // Change to for...of
            const { createdAt, session } = observation;
            const userName = session.user.name;
            const projectName = session.project.name;
            const userId = session.user_id;
            const projectId = session.project_id;
            const sessionID = session.session_id;
            const obsID = observation.obsID;

            // If this is the first observation of the session, add 5 minutes before
            const firstObservation = await this.getFirstObservationBySessionId(sessionID);
            let startTime;

            if (firstObservation && obsID == firstObservation.obsID) {
                // This is the first observation; subtract 5 minutes for the start time
                startTime = moment(createdAt).subtract(5, 'minutes');
            } else {
                // For subsequent observations, set startTime to the createdAt time
                startTime = moment(createdAt);
            }

           // If this is the first observation of the session, add 5 minutes before
           const lastObservation = await this.getLastObservationBySessionId(sessionID);
           let endTime;

           if (lastObservation && obsID == lastObservation.obsID) {
               // This is the first observation; subtract 5 minutes for the start time
               endTime = moment(createdAt).add(5, 'minutes');
           } else {
               // For subsequent observations, set startTime to the createdAt time
               endTime = moment(createdAt);
           }

            // Track the time spent per project and user
            if (!userProjectTime[userName]) userProjectTime[userName] = {};
            if (!userProjectTime[userName][projectName]) userProjectTime[userName][projectName] = 0;

            // Check if there's a gap more than 5 minutes between observations
            const previousObservation = await this.getPreviousObservation(sessionID, obsID); // Make this async if it needs to be
        
            if (previousObservation) {
                const prevEndTime = moment(previousObservation.createdAt).add(5, 'minutes');
                const gap = startTime.diff(prevEndTime, 'minutes');

                console.log("gap: " + gap.toString());
                
                if (gap > 5) {
                    // Only add 5 minutes for the gap
                    userProjectTime[userName][projectName] += 5;
                } else if (gap > 0) {
                    // Include the entire gap
                    userProjectTime[userName][projectName] += gap;
                }
            }

            // Add the time spent for this observation (5 minutes before, 5 minutes after)
            userProjectTime[userName][projectName] += endTime.diff(startTime, 'minutes');
        }

        // Group the results by month
        const results = await this.groupByMonth(userProjectTime); // Make sure this is also awaited

        return results;
    }

}

module.exports = new ObservationRepository();
