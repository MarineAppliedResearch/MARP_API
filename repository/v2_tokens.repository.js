/**
 * Repository module for V2 service-application (bearer token) database
 * operations.
 *
 * Owns `service_clients` (the "app"), `service_tokens` (its bearer
 * credentials), and `service_token_permissions` together -- the same
 * one-domain-owns-its-related-tables shape as `repository/v2_users.repository.js`
 * owning `users` + `user_permissions`.
 *
 * Raw tokens are generated and SHA-256 hashed here; only the hash and a
 * short, non-secret prefix are ever persisted. SHA-256 (a fast hash) is
 * deliberately used instead of Argon2 (used for user passwords): Argon2's
 * slowness defends against brute-forcing a low-entropy human-chosen
 * password, but a 256-bit random token has no such weakness, so a fast
 * hash is the correct, standard choice here.
 *
 * @fileoverview V2 service-application/token persistence operations.
 * @author Isaac Travers
 * @module repository/v2_tokens
 */

const crypto = require('crypto');
const db = require('../model');
const logger = require('../logger/api.logger');

/**
 * Generate a new raw bearer token. Never persisted -- only its hash is
 * stored, and the raw value is returned to the caller exactly once.
 *
 * @returns {string} A new raw token, e.g. `svc_<43 base64url characters>`.
 */
function generateRawToken() {
    return 'svc_' + crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash a raw token for storage/lookup.
 *
 * @param {string} rawToken - Raw token value.
 * @returns {string} SHA-256 hex digest of `rawToken`.
 */
function hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Flatten a `service_tokens` instance (fetched with `serviceClient` and
 * `tokenPermissions` -> `permission` included) into a plain object: a flat
 * `permissions` string array instead of the raw nested association data, a
 * derived `status` ('active'/'revoked'/'expired'), and the owning app's
 * name -- never `token_hash`.
 *
 * @param {Object} tokenInstance - Sequelize `service_tokens` instance, with associations included.
 * @returns {Object} Plain, safe token object.
 */
function toSafeToken(tokenInstance) {
    const token = tokenInstance.get({ plain: true });
    const permissions = (token.tokenPermissions || [])
        .map((grant) => grant.permission && grant.permission.key)
        .filter(Boolean);

    let status = 'active';

    if (token.revoked_at) {
        status = 'revoked';
    } else if (token.expires_at && new Date(token.expires_at) < new Date()) {
        status = 'expired';
    }

    return {
        service_token_id: token.service_token_id,
        service_client_id: token.service_client_id,
        appName: token.serviceClient ? token.serviceClient.name : null,
        token_prefix: token.token_prefix,
        status,
        expires_at: token.expires_at,
        revoked_at: token.revoked_at,
        last_used_at: token.last_used_at,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
        permissions,
    };
}

/**
 * Repository for V2 service-application/token data access.
 *
 * @class TokensRepository
 */
class TokensRepository {
    db = {};

    constructor() {
        this.db = db;
    }

    /**
     * Shared `include` clause for a token's owning app and granted permissions.
     *
     * @returns {Array<Object>} Sequelize `include` array.
     */
    _tokenInclude() {
        return [
            { model: this.db.service_clients, as: 'serviceClient' },
            {
                model: this.db.service_token_permissions,
                as: 'tokenPermissions',
                include: [{ model: this.db.permissions, as: 'permission' }],
            },
        ];
    }

    /**
     * Shared `include` clause for attaching an application's token count.
     *
     * @returns {Array<Object>} Sequelize `include` array.
     */
    _appInclude() {
        return [
            {
                model: this.db.service_tokens,
                as: 'tokens',
                attributes: ['service_token_id'],
            },
        ];
    }

    /**
     * Flatten a `service_clients` instance (fetched with `tokens` included)
     * into a plain object with a `tokenCount` instead of the raw nested
     * association data.
     *
     * @param {Object} appInstance - Sequelize `service_clients` instance, with `tokens` included.
     * @returns {Object} Plain application object.
     */
    _toSafeApp(appInstance) {
        const plain = appInstance.get({ plain: true });
        const tokenCount = (plain.tokens || []).length;
        delete plain.tokens;
        return { ...plain, tokenCount };
    }

    /**
     * Fetch every application, each with its token count.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every service_clients row plus a `tokenCount`.
     */
    async getAllApps() {
        try {
            const apps = await this.db.service_clients.findAll({
                include: this._appInclude(),
                order: [['service_client_id', 'ASC']],
            });

            return apps.map((app) => this._toSafeApp(app));
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch one application by id, with its token count.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @returns {Promise<Object|null>} The application, or null when not found.
     */
    async getAppById(serviceClientId) {
        try {
            const app = await this.db.service_clients.findByPk(serviceClientId, {
                include: this._appInclude(),
            });

            return app ? this._toSafeApp(app) : null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Register a new application.
     *
     * @async
     * @param {Object} params - New application fields.
     * @param {string} params.name - Application name.
     * @param {string} [params.description] - Optional description.
     * @param {number} [params.createdByUserId] - Admin registering the application, for audit.
     * @returns {Promise<Object>} The created application, with `tokenCount: 0`.
     * @throws {Error} Rethrows Sequelize validation/unique-constraint errors (e.g. duplicate name) unchanged.
     */
    async createApp({ name, description, createdByUserId }) {
        try {
            const app = await this.db.service_clients.create({
                name,
                description,
                created_by_user_id: createdByUserId || null,
            });

            return await this.getAppById(app.service_client_id);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Update an application's editable fields.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @param {Object} fields - Fields to update; only defined keys are applied.
     * @param {string} [fields.name] - New name.
     * @param {string} [fields.description] - New description.
     * @param {string} [fields.status] - New status ('active'/'disabled').
     * @returns {Promise<Object|null>} The updated application, or null when not found.
     */
    async updateApp(serviceClientId, { name, description, status }) {
        try {
            const updates = {};

            if (name !== undefined) updates.name = name;
            if (description !== undefined) updates.description = description;
            if (status !== undefined) updates.status = status;

            await this.db.service_clients.update(updates, {
                where: { service_client_id: serviceClientId },
            });

            return await this.getAppById(serviceClientId);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Permanently delete an application and every token under it (via the
     * `service_tokens.service_client_id` FK's `ON DELETE CASCADE`). Unlike
     * users, applications don't author domain data that needs preserving,
     * so a hard delete is appropriate here.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @returns {Promise<boolean>} True if a row was deleted, false if no such application existed.
     */
    async deleteApp(serviceClientId) {
        try {
            const deletedCount = await this.db.service_clients.destroy({
                where: { service_client_id: serviceClientId },
            });

            return deletedCount > 0;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch every token across every application.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every token, shaped by {@link toSafeToken}.
     */
    async getAllTokens() {
        try {
            const tokens = await this.db.service_tokens.findAll({
                include: this._tokenInclude(),
                order: [['service_token_id', 'ASC']],
            });

            return tokens.map(toSafeToken);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch one token by id.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier.
     * @returns {Promise<Object|null>} The token, shaped by {@link toSafeToken}, or null when not found.
     */
    async getTokenById(serviceTokenId) {
        try {
            const token = await this.db.service_tokens.findByPk(serviceTokenId, {
                include: this._tokenInclude(),
            });

            return token ? toSafeToken(token) : null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Issue a new token for an application. The raw token is generated,
     * hashed, and returned exactly once here -- it is never stored or
     * retrievable again after this call returns.
     *
     * @async
     * @param {Object} params - New token fields.
     * @param {number} params.serviceClientId - Application this token authenticates as.
     * @param {Date|string} [params.expiresAt] - Optional expiration; omit/null for a non-expiring token.
     * @param {number} [params.createdByUserId] - Admin issuing the token, for audit.
     * @returns {Promise<Object>} The created token (shaped by {@link toSafeToken}) plus a one-time `rawToken` field.
     * @throws {Error} Rethrows Sequelize validation/foreign-key errors (e.g. unknown application) unchanged.
     */
    async createToken({ serviceClientId, expiresAt, createdByUserId }) {
        try {
            const rawToken = generateRawToken();
            const tokenHash = hashToken(rawToken);
            const tokenPrefix = rawToken.slice(0, 12);

            const created = await this.db.service_tokens.create({
                service_client_id: serviceClientId,
                token_prefix: tokenPrefix,
                token_hash: tokenHash,
                expires_at: expiresAt || null,
                created_by_user_id: createdByUserId || null,
            });

            const safeToken = await this.getTokenById(created.service_token_id);

            return { ...safeToken, rawToken };
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Revoke a token. The row is kept (not deleted) so its history and
     * former permissions remain visible in the admin UI; it is simply
     * rejected by every future authentication attempt.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier.
     * @returns {Promise<Object|null>} The updated token, or null when not found.
     */
    async revokeToken(serviceTokenId) {
        try {
            const [affectedCount] = await this.db.service_tokens.update(
                { revoked_at: new Date() },
                { where: { service_token_id: serviceTokenId } }
            );

            if (affectedCount === 0) {
                return null;
            }

            return await this.getTokenById(serviceTokenId);
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Regenerate a token: revoke the existing row and issue a brand-new
     * one under the same application, rather than swapping the secret in
     * place -- this preserves an audit trail of exactly which secret was
     * live over which period, the same reasoning as `password_changed_at`
     * on user credentials.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier to regenerate.
     * @param {number} [createdByUserId] - Admin performing the regeneration, for audit on the new row.
     * @returns {Promise<Object|null>} The new token (with a one-time `rawToken`), or null when the original token was not found.
     */
    async regenerateToken(serviceTokenId, createdByUserId) {
        const existing = await this.db.service_tokens.findByPk(serviceTokenId);

        if (!existing) {
            return null;
        }

        await this.revokeToken(serviceTokenId);

        return await this.createToken({
            serviceClientId: existing.service_client_id,
            createdByUserId,
        });
    }

    /**
     * Replace a token's entire permission set with exactly the given keys.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier whose permissions are being replaced.
     * @param {Array<string>} permissionKeys - Full desired set of permission keys; any grant not in this list is revoked.
     * @param {number|null} grantedByUserId - Admin performing the change, recorded for audit on newly-added grants.
     * @returns {Promise<Array<string>>} The token's resulting permission keys.
     * @throws {Error} Rethrows if any requested key does not exist in the permission catalog, or on any database failure.
     */
    async setTokenPermissions(serviceTokenId, permissionKeys, grantedByUserId) {
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

            await this.db.service_token_permissions.destroy({
                where: { service_token_id: serviceTokenId },
                transaction,
            });

            await this.db.service_token_permissions.bulkCreate(
                matchingPermissions.map((permission) => ({
                    service_token_id: serviceTokenId,
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
     * Resolve a raw bearer token presented on a request to its service
     * principal, rejecting a revoked/expired token or one whose
     * application has been disabled. Used by
     * `middleware/resolve-principal.middleware.js`.
     *
     * @async
     * @param {string} rawToken - Raw token value from the `Authorization: Bearer` header.
     * @returns {Promise<{type: string, id: number, tokenId: number, permissions: Array<string>}|null>} The resolved principal, or null if the token is missing/invalid/revoked/expired/disabled.
     */
    async resolveToken(rawToken) {
        try {
            const tokenHash = hashToken(rawToken);

            const token = await this.db.service_tokens.findOne({
                where: { token_hash: tokenHash },
                include: this._tokenInclude(),
            });

            if (!token) {
                return null;
            }

            if (token.revoked_at) {
                return null;
            }

            if (token.expires_at && new Date(token.expires_at) < new Date()) {
                return null;
            }

            if (!token.serviceClient || token.serviceClient.status !== 'active') {
                return null;
            }

            const permissions = (token.tokenPermissions || [])
                .map((grant) => grant.permission && grant.permission.key)
                .filter(Boolean);

            return {
                type: 'service',
                id: token.service_client_id,
                tokenId: token.service_token_id,
                permissions,
            };
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Stamp `last_used_at` on a token and its application after a
     * successful bearer authentication. Failures are logged, not thrown --
     * a usage-timestamp write should never block the request it's tracking.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier that was just used.
     * @param {number} serviceClientId - Owning application identifier.
     * @returns {Promise<void>}
     */
    async touchTokenUsage(serviceTokenId, serviceClientId) {
        try {
            const now = new Date();

            await this.db.service_tokens.update({ last_used_at: now }, { where: { service_token_id: serviceTokenId } });
            await this.db.service_clients.update({ last_used_at: now }, { where: { service_client_id: serviceClientId } });
        } catch (error) {
            logger.error('Error::' + error);
        }
    }
}

module.exports = new TokensRepository();
