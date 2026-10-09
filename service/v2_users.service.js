/**
 * Service layer for V2 user-management operations.
 *
 * Coordinates password hashing and validation around the persistence
 * methods in `repository/v2_users.repository.js`. Permission enforcement
 * itself lives in `middleware/require-permission.middleware.js`, which
 * runs before any of these methods are ever called.
 *
 * @fileoverview V2 user-management service logic.
 * @author Isaac Travers
 * @module service/v2_users
 */

const argon2 = require('argon2');
const usersRepository = require('../repository/v2_users.repository');

/**
 * Service for V2 user-management operations.
 *
 * @class UsersService
 */
class UsersService {
    /**
     * Fetch every user with their granted permissions.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every user, each with a `permissions: string[]`.
     */
    async getAllUsers() {
        return usersRepository.getAllUsers();
    }

    /**
     * Fetch one user by id with their granted permissions.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Object|null>} The user, or null when not found.
     */
    async getUserById(userId) {
        return usersRepository.getUserById(userId);
    }

    /**
     * Create a new user with real local login credentials.
     *
     * @async
     * @param {Object} params - New user fields.
     * @param {string} params.name - Display name.
     * @param {string} params.username - Local sign-in username.
     * @param {string} params.password - Plaintext initial password, hashed here before it ever reaches the repository/database.
     * @param {string} [params.status] - Initial account status.
     * @returns {Promise<Object>} The created user, with an empty `permissions` array.
     */
    async createUser({ name, username, password, status }) {
        const passwordHash = await argon2.hash(String(password));

        return usersRepository.createUser({ name, username, passwordHash, status });
    }

    /**
     * Update a user's editable profile fields.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {Object} fields - `{name, username, status}`; only defined keys are applied.
     * @returns {Promise<Object|null>} The updated user, or null when not found.
     */
    async updateUser(userId, fields) {
        return usersRepository.updateUser(userId, fields);
    }

    /**
     * Soft-delete a user (`status='deleted'`); the row and everything they
     * created is preserved.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Object|null>} The updated user, or null when not found.
     */
    async softDeleteUser(userId) {
        return usersRepository.softDeleteUser(userId);
    }

    /**
     * Fetch the full permission catalog.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every permission definition.
     */
    async getPermissionsCatalog() {
        return usersRepository.getPermissionsCatalog();
    }

    /**
     * Replace a user's entire permission set.
     *
     * @async
     * @param {number} userId - User identifier whose permissions are being replaced.
     * @param {Array<string>} permissionKeys - Full desired set of permission keys.
     * @param {number} grantedByUserId - Admin performing the change (`req.user.user_id`).
     * @returns {Promise<Array<string>>} The user's resulting permission keys.
     */
    async setUserPermissions(userId, permissionKeys, grantedByUserId) {
        return usersRepository.setUserPermissions(userId, permissionKeys, grantedByUserId);
    }

    /**
     * Set a new password for a user's local credential.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {string} newPassword - Plaintext new password, hashed here before it ever reaches the repository/database.
     * @returns {Promise<void>}
     */
    async setUserPassword(userId, newPassword) {
        const passwordHash = await argon2.hash(String(newPassword));

        return usersRepository.setUserPassword(userId, passwordHash);
    }
}

module.exports = new UsersService();
