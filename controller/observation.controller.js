/**
 * Controller layer for observation API endpoints.
 *
 * Delegates incoming requests to the observation service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview Observation request delegation.
 * @author Isaac Travers
 * @module controller/observation
 */

const observationService  = require('../service/observation.service');
const logger = require('../logger/api.logger');

/**
 * Handles observation HTTP request delegation.
 *
 * @class ObservationController
 */
class ObservationController {

    /**
     * Fetch every observation record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All observation records ordered by
     * ascending `obsID`. Resolves to an empty array when none exist or the
     * underlying query fails.
     */
    async getObservations() {
        logger.info('Controller: getObservations');
        return await observationService.getObservations();
    }


    /**
     * Fetch the video location and position info for the highest-numbered
     * observation in a session.
     *
     * @async
     * @param {number|string} session_id - Session identifier whose latest
     * observation's video info should be retrieved.
     * @returns {Promise<Array<Object>>} The observation record(s) matching
     * the session's maximum `observation_id`. Resolves to an empty array
     * when the session has no observations or the underlying query fails.
     */
    async getLastVideoInfo(session_id){
        logger.info('Controller: getLastVideoInfo');
        return await observationService.getLastVideoInfo(session_id);
    }


    /**
     * Fetch the observation with the largest `observation_id` associated
     * with a specific video source.
     *
     * @async
     * @param {string} video_source - Video source value to match.
     * @returns {Promise<Array<Object>>} The observation record(s) matching
     * the video's maximum `observation_id`. Resolves to an empty array when
     * no observations match or the underlying query fails.
     */
    async getMaxObservationFromVideo(video_source){
        logger.info('Controller: getMaxObservationFromVideo');
        return await observationService.getMaxObservationFromVideo(video_source);
    }


    /**
     * Update the `count` field of a specific observation within a session.
     *
     * @async
     * @param {number|string} session_id - Session identifier used together
     * with `obsID` to locate the target observation.
     * @param {number|string} obsID - Per-session sequential observation
     * identifier (distinct from the `observation_id` primary key) to update.
     * @param {number|string} count - New count value to persist.
     * @returns {Promise<number>} `1` if the update statement executed
     * without throwing, or `0` if it failed. This does not indicate whether
     * any row actually matched `session_id`/`obsID`; a mismatched identifier
     * silently updates zero rows and still resolves to `1`.
     */
    async updateObservationWithCount(session_id, obsID, count){
        logger.info('Controller: updateObservationWithCount');
        return await observationService.updateObservationWithCount(session_id, obsID, count);
    }

    /**
     * Update the `coarsesize` field of a specific observation within a
     * session.
     *
     * @async
     * @param {number|string} session_id - Session identifier used together
     * with `obsID` to locate the target observation.
     * @param {number|string} obsID - Per-session sequential observation
     * identifier (distinct from the `observation_id` primary key) to update.
     * @param {number|string} size - New coarse-size value to persist.
     * @returns {Promise<number>} `1` if the update statement executed
     * without throwing, or `0` if it failed. This does not indicate whether
     * any row actually matched `session_id`/`obsID`; a mismatched identifier
     * silently updates zero rows and still resolves to `1`.
     */
    async updateObservationWithSize(session_id, obsID, size){
        logger.info('Controller: updateObservationWithSize');
        return await observationService.updateObservationWithSize(session_id, obsID, size);
    }

    /**
     * Fetch every observation belonging to a session, including associated
     * keyframes.
     *
     * @async
     * @param {number|string} session_id - Session identifier to match.
     * @returns {Promise<Array<Object>>} Matching observations with their
     * keyframes (if any). Resolves to an empty array when none exist or the
     * underlying query fails.
     */
    async getObservationsBySessionID(session_id) {
        logger.info('Controller: getObservations');
        return await observationService.getObservationsBySessionID(session_id);
    }


    /**
     * Create a new observation record, generating its `observation_id`,
     * `obsID`, and `PobsID` values from existing data.
     *
     * @async
     * @param {Object} observation - Observation fields to insert, including
     * `session_id` and optional nested `keyframes`. `observation_id`,
     * `obsID`, `PobsID`, and `createdate` are computed and overwritten by the
     * service/repository regardless of any values supplied here.
     * @returns {Promise<Object>} The created observation record. If the
     * underlying insert fails, resolves to an empty object rather than
     * throwing or returning null, so callers cannot detect failure from the
     * return value alone.
     */
    async createObservation(observation) {
        logger.info('Controller: createObservation', observation);
        return await observationService.createObservation(observation);
    }

    /**
     * Fetch a single observation record by its observation_id.
     *
     * @async
     * @param {number|string} observationId - observation_id of the observation to fetch, taken from `req.params.id` by the caller in app.js.
     * @returns {Promise<Object|null>} The matching observation record, or
     * null if not found. Rejects if the underlying query fails.
     */
    async getObservationById(observationId) {
        logger.info('Controller: getObservationById', observationId);
        return await observationService.getObservationById(observationId);
    }

    /**
     * Update an existing observation, propagating a changed `comname` to
     * its associated keyframes within the same transaction.
     *
     * @async
     * @param {Object} observation - Observation fields to update; must
     * include `observation_id` identifying the record to modify.
     * @returns {Promise<Object>} The Sequelize update result (affected row
     * count array). Throws (after rolling back the transaction) if the
     * observation does not exist or if the update fails.
     */
    async updateObservation(observation) {
        logger.info('Controller: updateObservation', observation);
        return await observationService.updateObservation(observation);
    }

    /**
     * Delete an observation by its `observation_id`.
     *
     * @async
     * @param {number|string} observationId - `observation_id` of the record
     * to delete.
     * @returns {Promise<number>} The number of rows deleted, or an empty
     * object if the delete failed; the error is logged rather than
     * propagated, so callers cannot distinguish "zero rows matched" from
     * "the query failed" in that case.
     */
    async deleteObservation(observationId) {
        logger.info('Controller: deleteObservation', observationId);
        return await observationService.deleteObservation(observationId);
    }

    /**
     * Fetch the maximum `PobsID` across all sessions sharing a project and
     * type.
     *
     * @async
     * @param {number|string} project_id - Project identifier used to locate
     * candidate sessions.
     * @param {string} type - Session type used together with `project_id`
     * to locate candidate sessions.
     * @returns {Promise<number>} The highest `PobsID` found, or `-1` if no
     * observations match or the underlying query fails.
     */
    async getMaxPobsID(project_id, type){
        logger.info('Controller: getMaxPobsID', project_id+' '+type);
        return await observationService.getMaxPobsID(project_id, type);
    }

    /**
     * Fetch observations for a specific video source, including keyframes.
     *
     * @async
     * @param {string} videoName - Exact value to match against the
     * observation `video_source` field.
     * @returns {Promise<Array<Object>>} Matching observations with
     * associated keyframes, ordered by ascending `mediaPosition`. Only
     * observations that have at least one keyframe are returned. Resolves
     * to an empty array when no observations match or the underlying query
     * fails.
     */
    async getObservationsByVideo(videoName){
        logger.info('Controller: getObservationsByVideo', videoName);
        return await observationService.getObservationsByVideo(videoName);
    }

    /**
     * Fetch grouped video summaries (species/session counts and
     * representative session metadata) for a project.
     *
     * @async
     * @param {number|string} project_id - Project identifier matched
     * against the associated session's `project_id` field.
     * @returns {Promise<Array<Object>>} Grouped video-summary objects.
     * Resolves to an empty array when no records match or the underlying
     * query fails.
     */
    async getVideoSummariesByProject(project_id){
        logger.info('Controller: getVideoSummariesByProject', project_id);
        return await observationService.getVideoSummariesByProject(project_id);
    }



    /**
     * Returns all observations associated with video videoName that have a comname in comnameList
     *
     * @async
     * @param {string} req.query.videoName - The name of the video
     * @param {string[]} req.query.comnameList - An array of comname strings to filter observations
     * @returns {Promise<Array<Object>>} Matching observations with associated
     * keyframes, ordered by ascending `mediaPosition`. Resolves to an empty
     * array when no observations match or the underlying query fails.
     */
    async getObservationsByVideoAndComnames(videoName, comnameList){
        logger.info('Controller: getObservationsByVideoAndComnames', videoName);
        return await observationService.getObservationsByVideoAndComnames(videoName, comnameList);
    }


    /**
     * Returns all observations associated with video videoName that have a comname in comnameList
     *
     * @async
     * @param {string} videoName - The name of the video
     * @param {string[]} projectName - An array of comname strings to filter observations
     * @returns {Promise<Array<Object>>} Matching observations with optional
     * keyframes, ordered by ascending `mediaPosition`. Resolves to an empty
     * array when no records match, the project is not found, or the
     * underlying query fails.
     */
    async getObservationsByVideoAndProject(videoName, projectName){
        return await observationService.getObservationsByVideoAndProject(videoName, projectName);
    }





    /**
     * Returns all observations that have associated keyframes and a comname in comnameList
     *
     * @async
     * @param {string[]} comnameList - An array of comname strings to filter observations
     * @returns {Promise<Array<Object>>} Matching observations with associated
     * keyframes, ordered by ascending `mediaPosition`. Resolves to an empty
     * array when no observations match or the underlying query fails.
     */
    async getObservationsWithKeyframesByComnames(comnameList){
        return await observationService.getObservationsWithKeyframesByComnames(comnameList);
    }

    /**
     * Retrieves all distinct comnames from observations that have associated keyframes.
     *
     * @async
     * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
     */
    async getDistinctComnamesWithKeyframes(){
        return await observationService.getDistinctComnamesWithKeyframes();
    }

    /**
     * Fetch per-user, per-date activity counts (observation totals) for a
     * dashboard view.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive)
     * used to filter observations by `createdAt`.
     * @param {string|Date} endDate - End of the date range (inclusive) used
     * to filter observations by `createdAt`.
     * @returns {Promise<Object>} An object keyed by user name, then by date,
     * containing `sessions`, `observations`, and `projects` counts
     * (`sessions` and `projects` are currently always `0`, only
     * `observations` is populated). Resolves to `undefined` if the
     * underlying query fails, since the error is logged rather than
     * converted to a fallback value.
     */
    async getUserDashboardData(startDate, endDate){
        logger.info('Controller: getUserDashboardData');
        return await observationService.getUserDashboardData(startDate, endDate);
    }

    /**
     * Fetch observation counts grouped by user and creation date.
     *
     * The underlying repository query requires a `startDate`/`endDate`
     * range to filter `createdAt`, but this controller method (and the
     * service method it calls) accepts no parameters and forwards none.
     * As written, the range filter is evaluated with both bounds
     * `undefined`, so results depend on how the database driver handles a
     * `BETWEEN undefined AND undefined` comparison rather than on any
     * caller-supplied date range.
     *
     * @async
     * @returns {Promise<Array<Object>>} Raw rows containing `user_id`,
     * `date`, and `observationCount`. Resolves to `undefined` if the
     * underlying query fails, since the error is logged rather than
     * converted to a fallback value.
     */
    async getObservationsGroupedByUserAndDate(){
        logger.info('Controller: getObservationsGroupedByUserAndDate');
        return await observationService.getObservationsGroupedByUserAndDate();
    }

    /**
     * Fetch, for each project/date/user combination, the estimated minutes
     * spent recording observations within a date range.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive)
     * used to filter observations by `createdAt`.
     * @param {string|Date} endDate - End of the date range (inclusive) used
     * to filter observations by `createdAt`.
     * @returns {Promise<Object>} An object keyed by project name, then by
     * date, then by user name, containing the estimated minutes recorded.
     * Time is estimated using a 5-minute padding heuristic around each
     * session's first/last observation of the day and the gap between
     * consecutive observations.
     */
    async getProjectTimeByDateAndUser(startDate, endDate){
        logger.info('Controller: getProjectTimeByDateAndUser');
        return await observationService.getProjectTimeByDateAndUser(startDate, endDate);
    }
}
module.exports = new ObservationController();