/**
 * Controller layer for V2 service-application/token routes.
 *
 * Thin request-level delegation to the tokens service, matching the style
 * of `controller/v2_users.controller.js`.
 *
 * @fileoverview V2 service-application/token request delegation.
 * @author Isaac Travers
 * @module controller/v2_tokens
 */

const tokensService = require('../service/v2_tokens.service');
const logger = require('../logger/api.logger');

/**
 * Controller for V2 service-application/token route operations.
 *
 * @class TokensController
 */
class TokensController {
    /**
     * List every application with its token count.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every application.
     */
    async getAllApps() {
        logger.info('Controller: getAllApps');
        return tokensService.getAllApps();
    }

    /**
     * Get one application by id.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @returns {Promise<Object|null>} The application, or null when not found.
     */
    async getAppById(serviceClientId) {
        logger.info('Controller: getAppById', serviceClientId);
        return tokensService.getAppById(serviceClientId);
    }

    /**
     * Register a new application.
     *
     * @async
     * @param {Object} params - `{name, description, createdByUserId}`.
     * @returns {Promise<Object>} The created application.
     */
    async createApp(params) {
        logger.info('Controller: createApp', { name: params.name });
        return tokensService.createApp(params);
    }

    /**
     * Update an application's editable fields.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @param {Object} fields - `{name, description, status}`.
     * @returns {Promise<Object|null>} The updated application, or null when not found.
     */
    async updateApp(serviceClientId, fields) {
        logger.info('Controller: updateApp', serviceClientId);
        return tokensService.updateApp(serviceClientId, fields);
    }

    /**
     * Permanently delete an application and every token under it.
     *
     * @async
     * @param {number} serviceClientId - Application identifier.
     * @returns {Promise<boolean>} True if a row was deleted.
     */
    async deleteApp(serviceClientId) {
        logger.info('Controller: deleteApp', serviceClientId);
        return tokensService.deleteApp(serviceClientId);
    }

    /**
     * List every token across every application.
     *
     * @async
     * @returns {Promise<Array<Object>>} Every token.
     */
    async getAllTokens() {
        logger.info('Controller: getAllTokens');
        return tokensService.getAllTokens();
    }

    /**
     * Get one token by id.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier.
     * @returns {Promise<Object|null>} The token, or null when not found.
     */
    async getTokenById(serviceTokenId) {
        logger.info('Controller: getTokenById', serviceTokenId);
        return tokensService.getTokenById(serviceTokenId);
    }

    /**
     * Issue a new token for an application.
     *
     * @async
     * @param {Object} params - `{serviceClientId, expiresAt, createdByUserId}`.
     * @returns {Promise<Object>} The created token plus a one-time `rawToken` field.
     */
    async createToken(params) {
        logger.info('Controller: createToken', { serviceClientId: params.serviceClientId });
        return tokensService.createToken(params);
    }

    /**
     * Revoke a token.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier.
     * @returns {Promise<Object|null>} The updated token, or null when not found.
     */
    async revokeToken(serviceTokenId) {
        logger.info('Controller: revokeToken', serviceTokenId);
        return tokensService.revokeToken(serviceTokenId);
    }

    /**
     * Revoke a token and issue a brand-new one under the same application.
     *
     * @async
     * @param {number} serviceTokenId - Token identifier to regenerate.
     * @param {number} createdByUserId - Admin performing the regeneration.
     * @returns {Promise<Object|null>} The new token (with a one-time `rawToken`), or null when the original was not found.
     */
    async regenerateToken(serviceTokenId, createdByUserId) {
        logger.info('Controller: regenerateToken', serviceTokenId);
        return tokensService.regenerateToken(serviceTokenId, createdByUserId);
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
        logger.info('Controller: setTokenPermissions', serviceTokenId);
        return tokensService.setTokenPermissions(serviceTokenId, permissionKeys, grantedByUserId);
    }
}

module.exports = new TokensController();
