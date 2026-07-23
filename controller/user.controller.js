/**
 * Controller layer for user API endpoints.
 *
 * Delegates incoming requests to the user service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview User request delegation.
 * @author Isaac Travers
 * @module controller/user
 */

const userService  = require('../service/user.service');
const logger = require('../logger/api.logger');

/**
 * Handles user HTTP request delegation.
 *
 * @class UserController
 */
class UserController {

    /**
     * Fetch every user record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All user records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getUsers() {
        logger.info('Controller: getUsers')
        return await userService.getUsers();
    }

    /**
     * Fetch user record(s) by display name.
     *
     * @async
     * @param {string} userName - Name of the user to look up; the server.js route (`GET /api/user/:name`) supplies this from `req.params.name`. Note the log message below reads "getUserIDByName", left over from an earlier version of this method; it is a stale log label, not an indication that lookup is by id.
     * @returns {Promise<Array<Object>>} Matching user record(s). Resolves to
     * an empty array when no user has that name or the underlying query
     * fails.
     */
    async getUserByName(userName){
        logger.info('Controller: getUserIDByName');
        return await userService.getUserByName(userName);
    }

    /**
     * Create a new user record.
     *
     * @async
     * @param {Object} user - Fields for the new user record (see the User schema); the server.js route (`POST /api/user`) supplies this from `req.body.user`.
     * @returns {Promise<Object>} The created user record, or `{}` if the
     * insert failed. A failed insert resolves rather than throwing, so
     * callers cannot distinguish failure from a genuinely empty result
     * without inspecting the returned object's fields.
     */
    async createUser(user) {
        logger.info('Controller: createUser', user);
        return await userService.createUser(user);
    }

    /**
     * Create a new user record given only a display name.
     *
     * @async
     * @param {string} userName - Name to assign to the new user; the server.js route (`POST /api/user/createUserByName/:userName`) supplies this from `req.params.userName`.
     * @returns {Promise<Object>} The created user record, or `{}` if the
     * insert failed (e.g. the name already exists and violates the unique
     * constraint on `users.name`).
     */
    async createUserByName(userName){
        logger.info('Controller: createUserByName', userName);
        return await userService.createUserByName(userName);
    }

    /**
     * Update an existing user record.
     *
     * @async
     * @param {Object} user - Fields to update, including `user_id` identifying which row to update; the app.js route (`PUT /api/user`) supplies this from `req.body.user`.
     * @returns {Promise<Object>} Sequelize's update result (typically
     * `[affectedCount]`), or `{}` if the update failed. A failed update
     * resolves rather than throwing.
     */
    async updateUser(user) {
        logger.info('Controller: updateUser', user);
        return await userService.updateUser(user);
    }

    /**
     * Delete a user record by id.
     *
     * @async
     * @param {string|number} user_id - Identifier of the user to delete; the app.js route (`DELETE /api/user/:id`) supplies this from `req.params.id`.
     * @returns {Promise<Object>} The number of rows deleted, or `{}` if the
     * delete failed. A failed delete resolves rather than throwing.
     */
    async deleteUser(user_id) {
        logger.info('Controller: deleteUser', user_id);
        return await userService.deleteUser(user_id);
    }

    /**
     * Fetch a single user record by id.
     *
     * @async
     * @param {number|string} userId - ID of the user to fetch, taken from `req.params.id` by the caller in app.js.
     * @returns {Promise<Object|null>} The matching user record, or null if
     * not found. Rejects if the underlying query fails.
     */
    async getUserById(userId) {
        logger.info('Controller: getUserById', userId);
        return await userService.getUserById(userId);
    }

    /**
     * Fetch a user's display name by id.
     *
     * @async
     * @param {string|number} user_id - Identifier of the user whose name should be returned; the server.js route (`GET /api/user/getUserNameByID/:userID`) supplies this from `req.params.userID`.
     * @returns {Promise<string>} The user's name. CAUTION: if no user
     * matches `user_id`, or the underlying query fails, the repository
     * layer throws (`Cannot read properties of ... 'dataValues'`) rather
     * than resolving to `null`/`''`, so this promise rejects in those
     * cases; the calling route has no `.catch()`, so a not-found id
     * currently hangs the request instead of returning a 404/500.
     */
    async getUserNameByID(user_id){
        logger.info('Controller: getUserNameByID', user_id);
        return await userService.getUserNameByID(user_id);
    }
}
module.exports = new UserController();