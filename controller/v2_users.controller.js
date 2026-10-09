/**
 * Controller layer for V2 user-management routes.
 *
 * Thin request-level delegation to the users service, matching the style
 * of `controller/auth.controller.js`.
 *
 * @fileoverview V2 user-management request delegation.
 * @author Isaac Travers
 * @module controller/v2_users
 */

const usersService = require('../service/v2_users.service');
const logger = require('../logger/api.logger');

/**
 * Controller for V2 user-management route operations.
 *
 * @class UsersController
 */
class UsersController {
    /**
     * List every user with their granted permissions.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every user.
     */
    async getAllUsers() {
        logger.info('Controller: getAllUsers');
        return usersService.getAllUsers();
    }

    /**
     * Get one user by id with their granted permissions.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Object|null>} The user, or null when not found.
     */
    async getUserById(userId) {
        logger.info('Controller: getUserById', userId);
        return usersService.getUserById(userId);
    }

    /**
     * Create a new user with local login credentials.
     *
     * @async
     * @param {Object} params - `{name, username, password, status}`.
     * @returns {Promise<Object>} The created user.
     */
    async createUser(params) {
        logger.info('Controller: createUser', { name: params.name, username: params.username });
        return usersService.createUser(params);
    }

    /**
     * Update a user's editable profile fields.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {Object} fields - `{name, username, status}`.
     * @returns {Promise<Object|null>} The updated user, or null when not found.
     */
    async updateUser(userId, fields) {
        logger.info('Controller: updateUser', userId);
        return usersService.updateUser(userId, fields);
    }

    /**
     * Soft-delete a user.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Object|null>} The updated user, or null when not found.
     */
    async softDeleteUser(userId) {
        logger.info('Controller: softDeleteUser', userId);
        return usersService.softDeleteUser(userId);
    }

    /**
     * List the full permission catalog.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every permission definition.
     */
    async getPermissionsCatalog() {
        logger.info('Controller: getPermissionsCatalog');
        return usersService.getPermissionsCatalog();
    }

    /**
     * Replace a user's entire permission set.
     *
     * @async
     * @param {number} userId - User identifier whose permissions are being replaced.
     * @param {Array<string>} permissionKeys - Full desired set of permission keys.
     * @param {number} grantedByUserId - Admin performing the change.
     * @returns {Promise<Array<string>>} The user's resulting permission keys.
     */
    async setUserPermissions(userId, permissionKeys, grantedByUserId) {
        logger.info('Controller: setUserPermissions', userId);
        return usersService.setUserPermissions(userId, permissionKeys, grantedByUserId);
    }

    /**
     * Set a new password for a user.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {string} newPassword - Plaintext new password.
     * @returns {Promise<void>}
     */
    async setUserPassword(userId, newPassword) {
        logger.info('Controller: setUserPassword', userId);
        return usersService.setUserPassword(userId, newPassword);
    }
}

module.exports = new UsersController();
