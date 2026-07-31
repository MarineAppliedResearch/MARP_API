/**
 * Generic JSON-API permission-guard middleware.
 *
 * Not specific to any one permission -- `requirePermission('admin')` is
 * just today's only caller. Any future named permission gates a route the
 * same way, with the same 401/403 contract.
 *
 * @fileoverview Generic permission-guard middleware for JSON API routes.
 * @author Isaac Travers
 * @module middleware/require-permission
 */

const usersRepository = require('../repository/v2_users.repository');
const { ApiError, ERROR_CODES } = require('./error-contract.middleware');

/**
 * Build Express middleware that requires the current session to hold a
 * specific permission. Checked fresh against the database on every
 * request (not cached on `req.user`/in the session), so a revoked
 * permission takes effect immediately, without waiting for re-login.
 *
 * @param {string} key - Permission key required to proceed (e.g. `'admin'`).
 * @returns {Function} Express middleware `(req, res, next)`.
 */
function requirePermission(key) {
    return async function permissionGuard(req, res, next) {
        try {
            if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
                throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'Authentication is required.');
            }

            const hasPermission = await usersRepository.userHasPermission(req.user.user_id, key);

            if (!hasPermission) {
                throw new ApiError(403, ERROR_CODES.FORBIDDEN, `The "${key}" permission is required.`);
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = {
    requirePermission,
};
