/**
 * Repository module for V2 user-management database operations.
 *
 * Owns the whole "manage users" surface used by the admin page: creating
 * users with real login credentials, updating/soft-deleting them, and
 * reading/writing their permission grants. Deliberately separate from the
 * V1 `user.repository.js` (legacy, display-name-only, several documented
 * bugs) rather than extending it.
 *
 * @fileoverview V2 user-management persistence operations.
 * @author Isaac Travers
 * @module repository/v2_users
 */

const db = require('../model');
const logger = require('../logger/api.logger');

/**
 * Flatten a `users` instance (fetched with its `userPermissions` ->
 * `permission` association included) into a plain object with a `permissions`
 * string array instead of the raw nested association data.
 *
 * @param {Object} userInstance - Sequelize `users` instance, with `userPermissions` included.
 * @returns {Object} Plain user object with a flat `permissions: string[]`.
 */
function toUserWithPermissions(userInstance) {
    const user = userInstance.get({ plain: true });
    const permissions = (user.userPermissions || [])
        .map((grant) => grant.permission && grant.permission.key)
        .filter(Boolean);

    delete user.userPermissions;

    return { ...user, permissions };
}

/**
 * Repository for V2 user-management data access.
 *
 * @class UsersRepository
 */
class UsersRepository {
    db = {};

    constructor() {
        this.db = db;
    }

    /**
     * Fetch every user, each with its granted permission keys attached.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every user, each shaped by {@link toUserWithPermissions}.
     */
    async getAllUsers() {
        try {
            const users = await this.db.users.findAll({
                include: this._permissionsInclude(),
                order: [['user_id', 'ASC']],
            });

            return users.map(toUserWithPermissions);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch one user by id, with its granted permission keys attached.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Object|null>} User shaped by {@link toUserWithPermissions}, or null when not found.
     */
    async getUserById(userId) {
        try {
            const user = await this.db.users.findByPk(userId, {
                include: this._permissionsInclude(),
            });

            return user ? toUserWithPermissions(user) : null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Create a new user together with a local login credential.
     *
     * @async
     * @param {Object} params - New user + credential fields.
     * @param {string} params.name - Display name.
     * @param {string} params.username - Local sign-in username.
     * @param {string} params.passwordHash - Already-Argon2-hashed password (hashing happens in the service layer).
     * @param {string} [params.status] - Initial account status; defaults to the column default ('active').
     * @returns {Promise<Object>} The created user, shaped by {@link toUserWithPermissions} (empty `permissions`).
     * @throws {Error} Rethrows Sequelize validation/unique-constraint errors (e.g. duplicate name/username) unchanged, so the route's error contract can map them to 409/422.
     */
    async createUser({ name, username, passwordHash, status }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const user = await this.db.users.create(
                {
                    name,
                    username,
                    ...(status ? { status } : {}),
                },
                { transaction }
            );

            await this.db.auth_identities.create(
                {
                    user_id: user.user_id,
                    provider: 'local',
                    provider_subject: null,
                    password_hash: passwordHash,
                },
                { transaction }
            );

            await transaction.commit();

            // Re-fetch through the same shape every other method returns,
            // rather than hand-assembling { ...user.get(), permissions: [] }.
            return await this.getUserById(user.user_id);
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Update a user's editable profile fields.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {Object} fields - Fields to update; only defined keys are applied.
     * @param {string} [fields.name] - New display name.
     * @param {string} [fields.username] - New local sign-in username.
     * @param {string} [fields.status] - New account status.
     * @returns {Promise<Object|null>} The updated user, shaped by {@link toUserWithPermissions}, or null when not found.
     * @throws {Error} Rethrows Sequelize validation/unique-constraint errors unchanged.
     */
    async updateUser(userId, { name, username, status }) {
        try {
            const updates = {};

            if (name !== undefined) updates.name = name;
            if (username !== undefined) updates.username = username;
            if (status !== undefined) updates.status = status;

            await this.db.users.update(updates, {
                where: { user_id: userId },
            });

            return await this.getUserById(userId);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Soft-delete a user by setting `status='deleted'`. The row is never
     * removed -- `authService` already rejects any non-'active' status on
     * login and session resumption, so this alone fully locks the account
     * out with no other change required.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Object|null>} The updated user, shaped by {@link toUserWithPermissions}, or null when not found.
     */
    async softDeleteUser(userId) {
        return this.updateUser(userId, { status: 'deleted' });
    }

    /**
     * Fetch the full permission catalog.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every row in `permissions`, ordered by key.
     */
    async getPermissionsCatalog() {
        try {
            const permissions = await this.db.permissions.findAll({
                order: [['key', 'ASC']],
            });

            return permissions.map((permission) => permission.get({ plain: true }));
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch the permission keys currently granted to one user.
     *
     * @async
     * @param {number} userId - User identifier.
     * @returns {Promise<Array<string>>} Granted permission keys; empty array if none (including for an unknown user id).
     */
    async getUserPermissions(userId) {
        try {
            const grants = await this.db.user_permissions.findAll({
                where: { user_id: userId },
                include: [{ model: this.db.permissions, as: 'permission' }],
            });

            return grants
                .map((grant) => grant.permission && grant.permission.key)
                .filter(Boolean);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Check whether a user currently holds a specific permission.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {string} key - Permission key to check (e.g. `'admin'`).
     * @returns {Promise<boolean>} True when the user has an active grant for `key`.
     */
    async userHasPermission(userId, key) {
        const permissions = await this.getUserPermissions(userId);
        return permissions.includes(key);
    }

    /**
     * Replace a user's entire permission set with exactly the given keys.
     *
     * @async
     * @param {number} userId - User identifier whose permissions are being replaced.
     * @param {Array<string>} permissionKeys - Full desired set of permission keys; any grant not in this list is revoked.
     * @param {number|null} grantedByUserId - Admin performing the change, recorded for audit on newly-added grants.
     * @returns {Promise<Array<string>>} The user's resulting permission keys (equal to `permissionKeys`, deduplicated).
     * @throws {Error} Rethrows if any requested key does not exist in the permission catalog, or on any database failure.
     */
    async setUserPermissions(userId, permissionKeys, grantedByUserId) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const desiredKeys = [...new Set(permissionKeys)];

            const matchingPermissions = await this.db.permissions.findAll({
                where: { key: desiredKeys },
                transaction,
            });

            if (matchingPermissions.length !== desiredKeys.length) {
                const knownKeys = new Set(matchingPermissions.map((permission) => permission.key));
                const unknownKeys = desiredKeys.filter((key) => !knownKeys.has(key));
                throw new Error(`Unknown permission key(s): ${unknownKeys.join(', ')}`);
            }

            await this.db.user_permissions.destroy({
                where: { user_id: userId },
                transaction,
            });

            await this.db.user_permissions.bulkCreate(
                matchingPermissions.map((permission) => ({
                    user_id: userId,
                    permission_id: permission.permission_id,
                    granted_by_user_id: grantedByUserId || null,
                })),
                { transaction }
            );

            await transaction.commit();

            return desiredKeys;
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Set a new password for a user's existing local credential.
     *
     * @async
     * @param {number} userId - User identifier.
     * @param {string} newPasswordHash - Already-Argon2-hashed new password (hashing happens in the service layer).
     * @returns {Promise<void>}
     * @throws {Error} Throws if the user has no local ('local' provider) credential row to update.
     */
    async setUserPassword(userId, newPasswordHash) {
        try {
            const [affectedCount] = await this.db.auth_identities.update(
                {
                    password_hash: newPasswordHash,
                    password_changed_at: new Date(),
                },
                {
                    where: { user_id: userId, provider: 'local' },
                }
            );

            if (affectedCount === 0) {
                throw new Error(`User ${userId} has no local credential to set a password on.`);
            }
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Shared `include` clause for attaching each user's granted permission
     * keys via the `user_permissions` -> `permissions` association chain.
     *
     * @returns {Array<Object>} Sequelize `include` array.
     */
    _permissionsInclude() {
        return [
            {
                model: this.db.user_permissions,
                as: 'userPermissions',
                include: [{ model: this.db.permissions, as: 'permission' }],
            },
        ];
    }
}

module.exports = new UsersRepository();
