/**
 * Controller layer for authentication routes.
 *
 * Handles request-level authentication delegation to the auth service.
 *
 * @fileoverview Authentication request delegation.
 * @author Isaac Travers
 * @module controller/auth
 */

const authService = require('../service/auth.service');
const logger = require('../logger/api.logger');

/**
 * Controller for auth route operations.
 *
 * @class AuthController
 */
class AuthController {
  /**
   * Authenticate local credentials.
   *
   * @async
   * @param {string} username - Username from request body.
   * @param {string} password - Password from request body.
   * @returns {Promise<Object|null>} Safe authenticated user payload, or null.
   */
  async authenticateLocal(username, password) {
    // Log auth attempts at controller boundary for request tracing.
    logger.info('Controller: authenticateLocal', username);

    // Delegate credential logic to service layer.
    return await authService.authenticateLocalUser(username, password);
  }

  /**
   * Resolve an authenticated session user.
   *
   * @async
   * @param {number} userId - Session user identifier.
   * @returns {Promise<Object|null>} Safe session user payload, or null.
   */
  async getSessionUserById(userId) {
    // Log session-principal lookups used by Passport deserialize.
    logger.info('Controller: getSessionUserById', userId);

    // Delegate identity resolution to service layer.
    return await authService.getSessionUserById(userId);
  }
}

module.exports = new AuthController();
