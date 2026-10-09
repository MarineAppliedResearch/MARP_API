/**
 * Generic JSON-API permission-guard middleware.
 *
 * Not specific to any one permission -- `requirePermission('admin')` is
 * just today's only caller. Any future named permission gates a route the
 * same way, with the same 401/403 contract. Not specific to a human
 * session either: it checks `req.principal`, populated by
 * `middleware/resolve-principal.middleware.js` from either a Passport
 * session or a valid `Authorization: Bearer` service token, already
 * carrying that principal's current permission list -- no separate
 * database check needed here.
 *
 * @fileoverview Generic permission-guard middleware for JSON API routes.
 * @author Isaac Travers
 * @module middleware/require-permission
 */

const { ApiError, ERROR_CODES } = require('./error-contract.middleware');

/**
 * Build Express middleware that requires the current request's principal
 * (session user or bearer-token service) to hold a specific permission.
 * Permissions are resolved fresh per request by `resolvePrincipal` (not
 * cached across requests), so a revoked permission or revoked token takes
 * effect immediately.
 *
 * @param {string} key - Permission key required to proceed (e.g. `'admin'`).
 * @returns {Function} Express middleware `(req, res, next)`.
 */
function requirePermission(key) {
    return function permissionGuard(req, res, next) {
        if (!req.principal) {
            return next(new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'Authentication is required.'));
        }

        if (!req.principal.permissions.includes(key)) {
            return next(new ApiError(403, ERROR_CODES.FORBIDDEN, `The "${key}" permission is required.`));
        }

        return next();
    };
}

module.exports = {
    requirePermission,
};
