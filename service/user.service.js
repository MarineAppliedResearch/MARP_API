/**
 * Service layer for user operations.
 *
 * Coordinates between the user controller and the user repository. This
 * layer currently passes most calls through directly; additional business
 * logic (validation, coordination across repositories, etc.) should be
 * added here rather than in the controller or repository.
 *
 * @fileoverview User service operations.
 * @author Isaac Travers
 * @module service/user
 */

const userRepository  = require('../repository/user.repository');

/**
 * Coordinates user operations between the controller and repository
 * layers.
 *
 * @class UserService
 */
class UserService {

    constructor() {}

    /**
     * Fetch every user record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All user records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getUsers() {
        return await userRepository.getUsers();
    }

    /**
     * Fetch user record(s) by display name.
     *
     * @async
     * @param {string} userName - Name of the user to look up.
     * @returns {Promise<Array<Object>>} Matching user record(s). Resolves to
     * an empty array when no user has that name or the underlying query
     * fails.
     */
    async getUserByName(userName) {
        return await userRepository.getUserByName(userName);
    }

    /**
     * Create a new user record.
     *
     * @async
     * @param {Object} user - Fields for the new user record (see the User schema).
     * @returns {Promise<Object>} The created user record, or `{}` if the
     * insert failed. A failed insert resolves rather than throwing, so
     * callers cannot distinguish failure from a genuinely empty result
     * without inspecting the returned object's fields.
     */
    async createUser(user) {
        return await userRepository.createUser(user);
    }

    /**
     * Create a new user record given only a display name.
     *
     * @async
     * @param {string} userName - Name to assign to the new user.
     * @returns {Promise<Object>} The created user record, or `{}` if the
     * insert failed (e.g. the name already exists and violates the unique
     * constraint on `users.name`).
     */
    async createUserByName(userName){
        return await userRepository.createUserByName(userName);
    }

    /**
     * Update an existing user record.
     *
     * @async
     * @param {Object} user - Fields to update, including `user_id` identifying which row to update.
     * @returns {Promise<Object>} Intended to resolve with the update result.
     * CAUTION: this method calls `userRepository.updateUser`, which does
     * not exist on UserRepository — that class only defines the plural
     * `updateUsers`. As written, this line throws a `TypeError`
     * (`userRepository.updateUser is not a function`), so this promise
     * rejects rather than resolving, and the intended update never runs.
     */
    async updateUser(user) {
        return await userRepository.updateUser(user);
    }

    /**
     * Delete a user record by id.
     *
     * @async
     * @param {string|number} userId - Identifier of the user to delete.
     * @returns {Promise<Object>} Intended to resolve with the deletion
     * result. CAUTION: this method calls `userRepository.deleteUsers`,
     * which does not exist on UserRepository — that class only defines the
     * singular `deleteUser`. As written, this line throws a `TypeError`
     * (`userRepository.deleteUsers is not a function`), so this promise
     * rejects rather than resolving, and the intended delete never runs.
     */
    async deleteUser(userId) {
        return await userRepository.deleteUsers(userId);
    }

    /**
     * Fetch a user's display name by id.
     *
     * @async
     * @param {string|number} userId - Identifier of the user whose name should be returned.
     * @returns {Promise<string>} The user's name. CAUTION: if no user
     * matches `userId`, or the underlying query fails, the repository layer
     * throws rather than resolving to `null`/`''`, so this promise rejects
     * in those cases.
     */
    async getUserNameByID(userId){
        return await userRepository.getUserNameByID(userId);
    }

}

module.exports = new UserService();