/**
 * Controller layer for session (dive/transect) API endpoints.
 *
 * Delegates incoming requests to the session service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview Session, dive, and transect request delegation.
 * @author Isaac Travers
 * @module controller/session
 */

const sessionService  = require('../service/session.service');
const logger = require('../logger/api.logger');

/**
 * Handles session, dive, and transect HTTP request delegation.
 *
 * @class SessionController
 */
class SessionController {

    /**
     * Fetch every session record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All session records, each including
     * its associated `user`. Resolves to an empty array when none exist or
     * the underlying query fails.
     */
    async getSessions() {
        logger.info('Controller: getSessions');
        return await sessionService.getSessions();
    }

    /**
     * Fetch the project id associated with a session.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<number|Array>} The `project_id` of the matching
     * session record. Resolves to an empty array instead of a number when
     * the session does not exist or the underlying query fails, so callers
     * cannot reliably distinguish "not found" from "found with no project"
     * from the return value alone.
     */
    async getProjectIDFromSessionID(session_id){
        logger.info('Controller: getProjectIDFromSessionID');
        return await sessionService.getProjectIDFromSessionID(session_id);
    }

    /**
     * Fetch the type of a session.
     *
     * NOTE: This method is declared twice in this class with an identical
     * body (see the second declaration below); this first declaration is
     * dead code, silently shadowed by the later one.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<string|Array>} The `type` of the matching session
     * record. Resolves to an empty array instead of a string when the
     * session does not exist or the underlying query fails.
     */
    async getTypeFromSessionID(session_id){
        logger.info('Controller: getTypeFromSessionID');
        return await sessionService.getTypeFromSessionID(session_id);
    }

    /**
     * Fetch the type of a session.
     *
     * Duplicate declaration of {@link SessionController#getTypeFromSessionID}
     * above; this is the definition actually used, since it overwrites the
     * earlier one on the class prototype.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<string|Array>} The `type` of the matching session
     * record. Resolves to an empty array instead of a string when the
     * session does not exist or the underlying query fails.
     */
    async getTypeFromSessionID(session_id){
        logger.info('Controller: getTypeFromSessionID');
        return await sessionService.getTypeFromSessionID(session_id);
    }

    /**
     * Fetch every session belonging to a project.
     *
     * @async
     * @param {number|string} project_id - Identifier of the project whose sessions should be fetched.
     * @returns {Promise<Array<Object>>} Sessions belonging to the project,
     * each including its associated `project`. Resolves to an empty array
     * when none exist or the underlying query fails.
     */
    async getSessionsByProjectID(project_id){
        logger.info('Controller: getSessionsByProjectID');
        return await sessionService.getSessionsByProjectID(project_id);
    }

    /**
     * Fetch every session belonging to a given user within a given project.
     *
     * @async
     * @param {number|string} userID - Identifier of the user whose sessions should be fetched.
     * @param {number|string} projectID - Identifier of the project to scope the sessions to.
     * @returns {Promise<Array<Object>>} Sessions matching the user and
     * project, each including its associated `user` and `project`. Resolves
     * to an empty array when none exist or the underlying query fails.
     */
    async getSessionsByUserIdAndProjectId(userID, projectID) {
        logger.info('Controller: getSessionsByUserIdAndProjectId');
        return await sessionService.getSessionsByUserIdAndProjectId(userID, projectID);
    }

    /**
     * Create a new session record.
     *
     * @async
     * @param {Object} session - Session fields to insert directly (e.g. user_id, project_id, dive, line, lineId, type). A `createdate` timestamp is added by the service/repository before insert.
     * @returns {Promise<Object>} The created session record, or the caught
     * Error object if the insert failed (the repository returns the error
     * itself rather than throwing or rejecting).
     */
    async createSession(session) {
        logger.info('Controller: createSession', session);
        return await sessionService.createSession(session);
    }

    /**
     * Find-or-create a processor (user), project, and session all in one
     * call, returning the resulting session.
     *
     * Looks up (or creates) a user by `processorName` and a project by
     * `projectName`, then looks up (or creates) a session matching the
     * resolved user/project plus the supplied dive/line/type. See
     * {@link SessionRepository#createSessionAndProjectandProcessor} for the
     * full lookup/creation logic and known fragility notes.
     *
     * @async
     * @param {string} processorName - Name of the user who ran the session; used to find or create the corresponding user record.
     * @param {string} projectName - Name of the project the session belongs to; used to find or create the corresponding project record.
     * @param {string} line - Transect line identifier for the new session.
     * @param {string} dive - Dive identifier for the new session.
     * @param {string} lineID - Survey line id for the new session (stored as `lineId`).
     * @param {string} type - Session type/category for the new session.
     * @returns {Promise<Object>} The existing or newly created session
     * record, or the caught Error object if resolving/creating the
     * user, project, or session failed.
     */
    async createSessionAndProjectandProcessor( processorName, projectName, line, dive, lineID, type){
        logger.info('Controller: createSessionAndProjectandProcessor', processorName+":"+projectName+":"+line+":"+dive+":"+lineID+":"+type);
        return await sessionService.createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type);
    }

    /**
     * Update an existing session record.
     *
     * @async
     * @param {Object} session - Session fields to update; must include `session_id` identifying the record to update. An `updateddate` field is added by the service/repository before update, though it is not a defined model attribute and so has no persisted effect.
     * @returns {Promise<Array<number>|Object>} Sequelize's update result
     * (an array whose first element is the number of affected rows) on
     * success. On failure the error is only logged, and this resolves to
     * `{}` instead of throwing or reflecting the failure.
     */
    async updateSession(session) {
        logger.info('Controller: updateSession', session);
        return await sessionService.updateSession(session);
    }

    /**
     * Delete a session record by id.
     *
     * @async
     * @param {number|string} sessionId - Identifier of the session to delete.
     * @returns {Promise<number|Object>} The number of destroyed rows (0 or
     * 1) on success. On failure the error is only logged, and this resolves
     * to `{}` instead of throwing or reflecting the failure.
     */
    async deleteSession(sessionId) {
        logger.info('Controller: deleteSession', sessionId);
        return await sessionService.deleteSession(sessionId);
    }

    /**
     * Fetch the session ids for a project restricted to a given session type.
     *
     * @async
     * @param {number|string} project_id - Identifier of the project to scope the search to.
     * @param {string} type - Session type/category to filter by.
     * @returns {Promise<Array<Object>>} Records containing only the
     * `session_id` attribute for matching sessions. Resolves to an empty
     * array when none exist or the underlying query fails.
     */
    async getSessionIDsWithProjectAndType(project_id, type){
        logger.info('Controller: getSessionIDsWithProjectAndType', project_id + ' ' + type);
        return await sessionService.getSessionIDsWithProjectAndType(project_id, type);
    }


    /**
     * Fetch session counts grouped by user and date within a date range.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive) to filter sessions' `createdAt` by.
     * @param {string|Date} endDate - End of the date range (inclusive) to filter sessions' `createdAt` by.
     * @returns {Promise<Array<Object>>} Raw rows of `{ user_id, date,
     * sessionCount }` for each user/date combination in range. Resolves to
     * an empty array when none exist or the underlying query fails.
     */
    async getSessionsGroupedByUserAndDate(startDate, endDate){
        logger.info('Controller: getSessionsGroupedByUserAndDate');
        return await sessionService.getSessionsGroupedByUserAndDate(startDate, endDate);
    }
}
module.exports = new SessionController();
