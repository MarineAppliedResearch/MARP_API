/**
 * Service layer for V2 service-application (bearer token) operations.
 *
 * Thin pass-through to `repository/v2_tokens.repository.js`, matching the
 * style of `service/v2_users.service.js`. Token generation/hashing lives in
 * the repository (parallel to password hashing living in
 * `service/auth.service.js`/`service/v2_users.service.js` for users), since
 * it is inseparable from the persistence step it protects.
 *
 * @fileoverview V2 service-application/token service logic.
 * @author Isaac Travers
 * @module service/v2_tokens
 */

const tokensRepository = require('../repository/v2_tokens.repository');

/**
 * Service for V2 service-application/token operations.
 *
 * @class TokensService
 */
class TokensService {
    /**
     * Fetch every application with its token count.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every application.
     */
    async getAllApps() {
        return tokensRepository.getAllApps();
    }

    /**
     * Fetch one application by id.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @returns {Promise<Object|null>} The application, or null when not found.
     */
    async getAppById(serviceClientId) {
        return tokensRepository.getAppById(serviceClientId);
    }

    /**
     * Register a new application.
     *
     * @async
     * @param {Object} params - `{name, description, createdByUserId}`.
     * @returns {Promise<Object>} The created application.
     */
    async createApp(params) {
        return tokensRepository.createApp(params);
    }

    /**
     * Update an application's editable fields.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @param {Object} fields - `{name, description, status}`; only defined keys are applied.
     * @returns {Promise<Object|null>} The updated application, or null when not found.
     */
    async updateApp(serviceClientId, fields) {
        return tokensRepository.updateApp(serviceClientId, fields);
    }

    /**
     * Permanently delete an application and every token under it.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @returns {Promise<boolean>} True if a row was deleted.
     */
    async deleteApp(serviceClientId) {
        return tokensRepository.deleteApp(serviceClientId);
    }

    /**
     * Fetch every token across every application.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every token.
     */
    async getAllTokens() {
        return tokensRepository.getAllTokens();
    }

    /**
     * Fetch one token by id.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier.
     * @returns {Promise<Object|null>} The token, or null when not found.
     */
    async getTokenById(serviceTokenId) {
        return tokensRepository.getTokenById(serviceTokenId);
    }

    /**
     * Issue a new token for an application. The raw secret is present
     * exactly once, in this call's return value.
     *
     * @async
     * @param {Object} params - `{serviceClientId, expiresAt, createdByUserId}`.
     * @returns {Promise<Object>} The created token plus a one-time `rawToken` field.
     */
    async createToken(params) {
        return tokensRepository.createToken(params);
    }

    /**
     * Revoke a token.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier.
     * @returns {Promise<Object|null>} The updated token, or null when not found.
     */
    async revokeToken(serviceTokenId) {
        return tokensRepository.revokeToken(serviceTokenId);
    }

    /**
     * Revoke a token and issue a brand-new one under the same application.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier to regenerate.
     * @param {number} createdByUserId - Admin performing the regeneration, for audit.
     * @returns {Promise<Object|null>} The new token (with a one-time `rawToken`), or null when the original was not found.
     */
    async regenerateToken(serviceTokenId, createdByUserId) {
        return tokensRepository.regenerateToken(serviceTokenId, createdByUserId);
    }

    /**
     * Replace a token's entire permission set.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier whose permissions are being replaced.
     * @param {Array<string>} permissionKeys - Full desired set of permission keys.
     * @param {number} grantedByUserId - Admin performing the change.
     * @returns {Promise<Array<string>>} The token's resulting permission keys.
     */
    async setTokenPermissions(serviceTokenId, permissionKeys, grantedByUserId) {
        return tokensRepository.setTokenPermissions(serviceTokenId, permissionKeys, grantedByUserId);
    }
}

module.exports = new TokensService();
