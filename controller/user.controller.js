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
     * @param {Object} user - Fields to update, including `user_id` identifying which row to update; the server.js route (`PUT /api/user`) supplies this from `req.body.user`.
     * @returns {Promise<Object>} Intended to resolve with the update result.
     * CAUTION: as currently wired, this call is broken — it flows to
     * service/user.service.js#updateUser, which calls
     * `userRepository.updateUser`, a method that does not exist on
     * UserRepository (only the plural `updateUsers` is defined there). That
     * call throws a `TypeError`, so this promise rejects rather than
     * resolving. The `PUT /api/user` route in server.js has no `.catch()`,
     * so today this endpoint never sends a response for a valid request.
     */
    async updateUser(user) {
        logger.info('Controller: updateUser', user);
        return await userService.updateUser(user);
    }

    /**
     * Delete a user record by id.
     *
     * @async
     * @param {string|number} user_id - Identifier of the user to delete; the server.js route (`DELETE /api/user/:id`) supplies this from `req.params.id`.
     * @returns {Promise<Object>} Intended to resolve with the deletion
     * result. CAUTION: as currently wired, this call is broken — it flows
     * to service/user.service.js#deleteUser, which calls
     * `userRepository.deleteUsers`, a method that does not exist on
     * UserRepository (only the singular `deleteUser` is defined there).
     * That call throws a `TypeError`, so this promise rejects rather than
     * resolving. The `DELETE /api/user/:id` route in server.js has no
     * `.catch()`, so today this endpoint never sends a response for a
     * valid request.
     */
    async deleteUser(user_id) {
        logger.info('Controller: deleteUser', user_id);
        return await userService.deleteUser(user_id);
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