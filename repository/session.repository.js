/**
 * Repository module for session (dive/transect) database operations.
 *
 * This file contains Sequelize queries used to retrieve, create, update,
 * and delete session records, which group the observations recorded during
 * a single dive or survey line, along with helpers used to look up derived
 * fields (owning project, session type) and aggregate session activity.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview Session, dive, and transect database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/session
 */

const db = require('../model');
const logger = require('../logger/api.logger');
const userController = require('../controller/user.controller');
const projectController = require('../controller/project.controller');
const observationController = require('../controller/observation.controller');
const { Sequelize, Model, DataTypes } = require("sequelize");



/**
 * Repository for session, dive, and transect database operations.
 *
 * @class SessionRepository
 */
class SessionRepository {

    db = {};

    constructor() {
        this.db = db;
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/


    }

    /**
     * Fetch every session record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero sessions and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All session records, each including
     * its associated `user`. Returns an empty array when none exist or
     * when the database query fails.
     */
    async getSessions() {

        try {
            const sessions = await this.db.sessions.findAll({ include: ["user"] });
            //console.log('sessions:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch the project id associated with a session.
     *
     * Database errors, and the case where no session matches `session_id`
     * (in which case `sessions` is null and `sessions.project_id` throws),
     * are both caught and converted to an empty array. As a result this
     * method returns a scalar `project_id` on success but an array on any
     * failure or not-found case, and callers cannot distinguish "not
     * found" from "database error" from the return value alone.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<number|Array>} The `project_id` of the matching
     * session record, or an empty array if the session does not exist or
     * the query fails.
     */
    async  getProjectIDFromSessionID(session_id){
        try {
            // Join Project to session
            const sessions = await this.db.sessions.findOne({
                 where: {
                    session_id: session_id
                }
              });
            //console.log('sessionsWithProject:::', sessions);
            return sessions.project_id;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch the type of a session.
     *
     * Database errors, and the case where no session matches `session_id`
     * (in which case `sessions` is null and `sessions.type` throws), are
     * both caught and converted to an empty array. As a result this method
     * returns a scalar `type` string on success but an array on any
     * failure or not-found case, and callers cannot distinguish "not
     * found" from "database error" from the return value alone.
     *
     * @async
     * @param {number|string} session_id - Identifier of the session to look up.
     * @returns {Promise<string|Array>} The `type` of the matching session
     * record, or an empty array if the session does not exist or the
     * query fails.
     */
    async getTypeFromSessionID(session_id){
        try {
            // Join Project to session
            const sessions = await this.db.sessions.findOne({
                 where: {
                    session_id: session_id
                }
              });
            //console.log('sessionsWithProject:::', sessions);
            return sessions.type;
        } catch (err) {
            console.log(err);
            return [];
        }
    }


    /**
     * Fetch every session belonging to a project.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero sessions and a database failure.
     *
     * @async
     * @param {number|string} project_id - Identifier of the project whose sessions should be fetched.
     * @returns {Promise<Array<Object>>} Sessions belonging to the project,
     * each including its associated `project`. Returns an empty array when
     * none exist or when the database query fails.
     */
    async getSessionsByProjectID(project_id){
        try {
            // Join Project to session
            const sessions = await this.db.sessions.findAll({
                include: [{
                    model: this.db.projects, as: "project",
                    required: true
                 }],
                 where: {
                    project_id: project_id
                }
              });
            //console.log('sessionsWithProject:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch every session in a project with the detail a session browser
     * needs to list them without a processor being chosen first.
     *
     * Beyond the session's own columns this carries the processor (from the
     * joined user), how many observations were recorded against the session,
     * and which videos those observations name. `video_source` lives on the
     * observation rather than the session, so it can only be derived; a
     * session whose observations name more than one video reports all of
     * them rather than picking one arbitrarily.
     *
     * The two aggregates are separate grouped queries rather than part of
     * the main one, so listing a project costs three round trips whatever
     * its size, instead of one per session. Joining them in would also
     * multiply the session rows and make the ordering meaningless.
     *
     * Database errors are logged and converted to an empty array, as
     * elsewhere in this class, so callers cannot distinguish "no sessions"
     * from "the query failed".
     *
     * @async
     * @param {number|string} project_id - Identifier of the project to list.
     * @returns {Promise<Array<Object>>} Session records ordered by dive,
     * then line, then type. Each carries its associated `user`, an
     * `observationCount`, and a `video_sources` array. Returns an empty
     * array when the project has no sessions or the query fails.
     */
    async getSessionsWithDetailByProjectID(project_id) {
        try {
            const sessions = await this.db.sessions.findAll({
                include: [{
                    model: this.db.users, as: "user",
                    // Left join deliberately: a session with no processor
                    // recorded should still appear under its dive rather
                    // than disappear from the list.
                    required: false
                }],
                where: {
                    project_id: project_id
                },
                order: [['dive', 'ASC'], ['line', 'ASC'], ['type', 'ASC']]
            });

            if (sessions.length === 0) {
                return [];
            }

            const sessionIds = sessions.map(session => session.session_id);

            const counts = await this.db.observations.findAll({
                attributes: [
                    'session_id',
                    [Sequelize.fn('COUNT', Sequelize.col('observation_id')), 'observationCount']
                ],
                where: {
                    session_id: { [Sequelize.Op.in]: sessionIds }
                },
                group: ['session_id'],
                raw: true
            });

            const sources = await this.db.observations.findAll({
                attributes: ['session_id', 'video_source'],
                where: {
                    session_id: { [Sequelize.Op.in]: sessionIds },
                    video_source: { [Sequelize.Op.ne]: null }
                },
                group: ['session_id', 'video_source'],
                order: [['video_source', 'ASC']],
                raw: true
            });

            // COUNT comes back as a string from postgres, so it is coerced
            // here rather than leaving the caller to guess at the type.
            const countBySession = new Map(
                counts.map(row => [row.session_id, Number(row.observationCount)])
            );

            const sourcesBySession = new Map();
            for (const row of sources) {
                // Empty strings survive the IS NOT NULL filter and are not
                // a video anyone can open.
                if (!row.video_source) continue;
                if (!sourcesBySession.has(row.session_id)) {
                    sourcesBySession.set(row.session_id, []);
                }
                sourcesBySession.get(row.session_id).push(row.video_source);
            }

            return sessions.map(session => ({
                ...session.toJSON(),
                observationCount: countBySession.get(session.session_id) || 0,
                video_sources: sourcesBySession.get(session.session_id) || []
            }));
        } catch (err) {
            logger.error('Error::' + err);
            return [];
        }
    }

    /**
     * Fetch every session belonging to a given user within a given project.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero sessions and a database failure.
     *
     * @async
     * @param {number|string} userID - Identifier of the user whose sessions should be fetched.
     * @param {number|string} projectID - Identifier of the project to scope the sessions to.
     * @returns {Promise<Array<Object>>} Sessions matching the user and
     * project, each including its associated `user` and `project`. Returns
     * an empty array when none exist or when the database query fails.
     */
    // THIS LOOKS LIKE WE ARE NOT LOOKING FOR USERID AND PROJECTID LIKE WE ARE SUPPOSED TO
    async getSessionsByUserIdAndProjectId(userID, projectID) {

        try {

            // First we need to get a list of

            // Join Project to session, and session to user
            const sessions = await this.db.sessions.findAll({
                include: [{
                    model: this.db.users, as: "user",
                    required: true
                 },{
                    model: this.db.projects, as: "project",
                    required: true
                 }],
                 where: {
                    user_id: userID,
                    project_id: projectID
                }
              });
            //console.log('projects:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch a single session record by its session_id.
     *
     * Unlike most methods on this class, a database failure here is logged
     * and re-thrown rather than swallowed to `[]`, so callers must
     * catch/handle a rejected promise. A "not found" result, by contrast,
     * resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} sessionId - session_id of the session to fetch.
     * @returns {Promise<Object|null>} The matching session record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getSessionById(sessionId) {
        try {
            const session = await this.db.sessions.findByPk(sessionId);
            return session || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Create a new session record.
     *
     * A `createdate` timestamp is stamped onto the record before insert.
     * Note that this is a plain property assignment, not one of the
     * `sessions` model's defined attributes (the model instead relies on
     * Sequelize's automatic `createdAt` timestamp column), so this
     * assignment has no persisted effect.
     *
     * Unlike most repository methods in this file, a failure here is not
     * converted to an empty array/object — the caught Error object itself
     * is returned (not thrown, and not re-wrapped), so callers must check
     * the resolved value's shape/type to detect failure.
     *
     * @async
     * @param {Object} session - Session fields to insert directly (e.g. user_id, project_id, dive, line, lineId, type).
     * @returns {Promise<Object|Error>} The created session record, or the
     * caught Error object if the insert failed.
     */
    async createSession(session) {
        let data = {};
        try {
            session.createdate = new Date().toISOString();
            data = await this.db.sessions.create(session);
        } catch(err) {
            logger.error('Error::' + err);
            return err;
        }
        return data;
    }

    /** checks if we have a processor of processor Name returns processorID, if not create processor, and return it
     *  then checks if we have a project of projectName and returns projectID, if not create a project, and return it
     *  then checks if we have a session with this processorname, project name, line, dive, lineid and type.
     *  If not, create the session, always return the sessions id.
     *
     *  Data Sceme    |Project|1/1 --------0/M|session|0/M ----- 1/1|user|
     *
     * Find-or-create a processor (user), project, and session all in one
     * call, returning the resulting session.
     *
     * Looks up the user by `processorName` via {@link userController#getUserByName},
     * creating one via {@link userController#createUserByName} if it does
     * not exist; then looks up the project by `projectName` via
     * {@link projectController#getProjectByName}, creating one via
     * {@link projectController#createProjectByName} if it does not exist.
     * The resolved `user_id`/`project_id` are then combined with `dive`,
     * `line`, `lineID` (stored as `lineId`), and `type` to find an existing
     * matching session, or create a new one if none matches.
     *
     * The logic that unwraps `user`/`project` from either an array (as
     * returned by the "getBy" lookups) or a single object (as apparently
     * returned by the "create" helpers) via repeated `.length`/`[0]` checks
     * is fragile: it assumes a specific shape from each collaborator
     * without validating it, and will throw if an unexpected shape is
     * returned (e.g. `user_id`/`project_id` both undefined).
     *
     * As with {@link SessionRepository#createSession}, a failure here
     * returns the caught Error object itself rather than throwing or
     * returning a fallback empty value.
     *
     * @async
     * @param {string} processorName - Name of the user who ran the session; used to find or create the corresponding user record.
     * @param {string} projectName - Name of the project the session belongs to; used to find or create the corresponding project record.
     * @param {string} line - Transect line identifier for the new/matched session.
     * @param {string} dive - Dive identifier for the new/matched session.
     * @param {string} lineID - Survey line id for the new/matched session (stored as `lineId`).
     * @param {string} type - Session type/category for the new/matched session.
     * @returns {Promise<Object|Error>} The existing matching session record
     * if one was found, the newly created session record otherwise, or the
     * caught Error object if resolving/creating the user, project, or
     * session failed.
     */
    async createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type){
        let data = {};
        let user = {};
        let project = {};

        try {
            // Get this user by name, if it exists
            user = await userController.getUserByName(processorName);

            // check if the user exists, if it does not exist, create it
            if(user == undefined || user.length <= 0){
                // Create user here
                user = await userController.createUserByName(processorName);
            }

            if(user.length >= 1) user = user[0];

            // Get this project by name, if it exists
            project = await projectController.getProjectByName(projectName);

            // Check if this project exists, if it doesn't, create it
            if(project.length <= 0){
                project = await projectController.createProjectByName(projectName);
            }

            if(project.length >= 1) project = project[0];

            let userID = -1;

            if(user[0] == undefined || user[0].user_id == undefined){
                userID = user.user_id;
            }else{
                userID = user[0].user_id;
            }

            let projectID = -1;

            if(project[0] == undefined || project[0].project_id == undefined){
                projectID = project.project_id;
            }else{
                projectID = project[0].project_id;
            }


            // Now we have all the info to build a session object. lets build one
            let session = {
                "user_id": userID,
                "project_id": projectID,
                "dive": dive,
                "line": line,
                "lineId": lineID,
                "type": type
              };

            // We'll try to find this session, if it exists in the db, we'll return that
            var currentSession = await this.db.sessions.findAll( {
                where: {
                    user_id: session.user_id,
                    project_id: session.project_id,
                    dive: session.dive,
                    line: session.line,
                    type: session.type
                }
            });

            // Check if our query has found an existing session.
            if(currentSession.length >= 1){
                // We have found a current session. unwrap it
                data = currentSession[0];
            }else{
                // We have not found a current session. create a new one.
                session.createdate = new Date().toISOString();
                data = await this.db.sessions.create(session);
            }



        } catch(err) {
            // If an error occurs, then user didn't exist.
            logger.error('Error::' + err);
            return err;
        }
        return data;
    }

    /**
     * Update an existing session record.
     *
     * An `updateddate` timestamp is stamped onto the record before update.
     * Note that this is a plain property assignment, not one of the
     * `sessions` model's defined attributes (the model instead relies on
     * Sequelize's automatic `updatedAt` timestamp column), so this
     * assignment has no persisted effect.
     *
     * On failure, the error is only logged via `logger.error` — it is
     * neither thrown nor returned — so this resolves to the initial `{}`
     * value instead of reflecting the failure in any way.
     *
     * @async
     * @param {Object} session - Session fields to update; must include `session_id` identifying the record to update.
     * @returns {Promise<Array<number>|Object>} Sequelize's update result
     * (an array whose first element is the number of affected rows) on
     * success, or `{}` if the update failed.
     */
    async updateSession(session) {
        let data = {};
        try {
            session.updateddate = new Date().toISOString();
            data = await this.db.sessions.update({...session}, {
                where: {
                    session_id: session.session_id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Delete a session record by id.
     *
     * On failure, the error is only logged via `logger.error` — it is
     * neither thrown nor returned — so this resolves to the initial `{}`
     * value instead of reflecting the failure in any way.
     *
     * Note: the final `return {status: ...}` statement below is
     * unreachable dead code, since the preceding `return data;` always
     * returns first.
     *
     * @async
     * @param {number|string} sessionId - Identifier of the session to delete.
     * @returns {Promise<number|Object>} The number of destroyed rows (0 or
     * 1) on success, or `{}` if the delete failed.
     */
    async deleteSession(sessionId) {
        let data = {};
        try {
            data = await this.db.sessions.destroy({
                where: {
                    session_id: sessionId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

    /**
     * Fetch the session ids for a project restricted to a given session type.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero sessions and a database failure.
     *
     * @async
     * @param {number|string} project_id - Identifier of the project to scope the search to.
     * @param {string} type - Session type/category to filter by.
     * @returns {Promise<Array<Object>>} Records containing only the
     * `session_id` attribute for matching sessions. Returns an empty array
     * when none exist or when the database query fails.
     */
    async getSessionIDsWithProjectAndType(project_id, type){
        try {
            const session_ids = await this.db.sessions.findAll({
                 attributes: ['session_id'],
                 where: {
                    type: type,
                    project_id: project_id
                }
              });
            return session_ids;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch session counts grouped by user and date within a date range.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero rows and a database failure.
     *
     * @async
     * @param {string|Date} startDate - Start of the date range (inclusive) to filter sessions' `createdAt` by.
     * @param {string|Date} endDate - End of the date range (inclusive) to filter sessions' `createdAt` by.
     * @returns {Promise<Array<Object>>} Raw rows of `{ user_id, date,
     * sessionCount }` for each user/date combination in range. Returns an
     * empty array when none exist or when the database query fails.
     */
    async getSessionsGroupedByUserAndDate(startDate, endDate){
        try{
            // Fetch the number of sessions each user worked on, grouped by user and date
            const sessionData = await this.db.sessions.findAll({
                attributes: [
                    'user_id',
                    [Sequelize.fn('DATE', Sequelize.col('createdAt')), 'date'],
                    [Sequelize.fn('COUNT', Sequelize.col('session_id')), 'sessionCount']
                ],
                where: {
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]
                    }
                },
                group: ['user_id', 'date'],
                raw: true
            });

            return sessionData;
        }catch(err){
            console.log(err);
            return [];
        }
    }

}



module.exports = new SessionRepository();
