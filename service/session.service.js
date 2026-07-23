/**
 * Service layer for session (dive/transect) operations.
 *
 * Coordinates between the session controller and the session repository.
 * This layer currently passes all calls through directly; additional
 * business logic (validation, coordination across repositories, etc.)
 * should be added here rather than in the controller or repository.
 *
 * @fileoverview Session, dive, and transect service operations.
 * @author Isaac Travers
 * @module service/session
 */

const sessionRepository  = require('../repository/session.repository');

/**
 * Coordinates session, dive, and transect operations between the
 * controller and repository layers.
 *
 * @class SessionService
 */
class SessionService {

    constructor() {}

    /**
     * Fetch every session record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All session records, each including
     * its associated `user`. Resolves to an empty array when none exist or
     * the underlying query fails.
     */
    async getSessions() {
        return await sessionRepository.getSessions();
    }

    /**
     * Fetch the project id associated with a session.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<number|Array>} The `project_id` of the matching
     * session record. Resolves to an empty array instead of a number when
     * the session does not exist or the underlying query fails.
     */
    async  getProjectIDFromSessionID(session_id){
        return await sessionRepository.getProjectIDFromSessionID(session_id);
    }

    /**
     * Fetch the type of a session.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<string|Array>} The `type` of the matching session
     * record. Resolves to an empty array instead of a string when the
     * session does not exist or the underlying query fails.
     */
    async getTypeFromSessionID(session_id){
        return await sessionRepository.getTypeFromSessionID(session_id);
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
        return await sessionRepository.getSessionsByProjectID(project_id);
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
        return await sessionRepository.getSessionsByUserIdAndProjectId(userID, projectID);
    }

    /**
     * Create a new session record.
     *
     * @async
     * @param {Object} session - Session fields to insert directly (e.g. user_id, project_id, dive, line, lineId, type).
     * @returns {Promise<Object>} The created session record, or the caught
     * Error object if the insert failed (the repository returns the error
     * itself rather than throwing or rejecting).
     */
    async createSession(session) {
        return await sessionRepository.createSession(session);
    }

    /**
     * Find-or-create a processor (user), project, and session all in one
     * call, returning the resulting session.
     *
     * @async
     * @param {string} processorName - Name of the user who ran the session; used to find or create the corresponding user record.
     * @param {string} projectName - Name of the project the session belongs to; used to find or create the corresponding project record.
     * @param {string} line - Transect line identifier for the new session.
     * @param {string} dive - Dive identifier for the new session.
     * @param {string} lineID - Survey line id for the new session (stored as `lineId`).
     * @param {string} type - Session type/category for the new session.
     * @returns {Promise<Object>} The existing or newly created session
     * record, or the caught Error object if resolving/creating the user,
     * project, or session failed.
     */
    async createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type){
        return await sessionRepository.createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type);
    }

    /**
     * Update an existing session record.
     *
     * @async
     * @param {Object} session - Session fields to update; must include `session_id` identifying the record to update.
     * @returns {Promise<Array<number>|Object>} Sequelize's update result
     * (an array whose first element is the number of affected rows) on
     * success. On failure the error is only logged, and this resolves to
     * `{}` instead of throwing or reflecting the failure.
     */
    async updateSession(session) {
        return await sessionRepository.updateSession(session);
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
        return await sessionRepository.deleteSession(sessionId);
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
        return await sessionRepository.getSessionIDsWithProjectAndType(project_id, type);
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
        return await sessionRepository.getSessionsGroupedByUserAndDate(startDate, endDate);
    }

}


module.exports = new SessionService();
