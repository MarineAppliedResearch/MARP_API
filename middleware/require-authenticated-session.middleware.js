/**
 * Session-guard middleware for protected static frontend apps.
 *
 * Unlike the JSON API (which rejects unauthenticated requests with a 401
 * envelope, see middleware/error-contract.middleware.js), a static app is
 * reached by a plain browser navigation, so an unauthenticated request is
 * redirected to the public entry page instead of returned as an error body.
 * Same reasoning applies to a missing permission, not just a missing
 * session -- see {@link requirePermissionSession}.
 *
 * @fileoverview Session-guard middleware for protected static frontend apps.
 * @author Isaac Travers
 * @module middleware/require-authenticated-session
 */

const usersRepository = require('../repository/v2_users.repository');

/**
 * Requires an authenticated Passport session, redirecting to the entry page
 * otherwise. Written generically (not specific to any one app) so any
 * future protected static app can be gated the same way.
 *
 * @param {Object} req - Express request; expects `req.isAuthenticated`/`req.user` from Passport session middleware.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next callback.
 * @returns {void}
 */
function requireAuthenticatedSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }

  return res.redirect('/');
}

/**
 * Build static-page middleware that requires the current session to hold a
 * specific permission, redirecting to the entry page otherwise (covers both
 * "not logged in" and "logged in but missing the permission" the same way,
 * since neither case should see the protected page). The JSON-API
 * equivalent is `requirePermission` in
 * `middleware/require-permission.middleware.js`; this is its
 * redirect-instead-of-403 counterpart for static apps.
 *
 * @param {string} key - Permission key required to view the page (e.g. `'admin'`).
 * @returns {Function} Express middleware `(req, res, next)`.
 */
function requirePermissionSession(key) {
  return async function permissionSessionGuard(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
      return res.redirect('/');
    }

    const hasPermission = await usersRepository.userHasPermission(req.user.user_id, key);

    if (!hasPermission) {
      return res.redirect('/');
    }

    return next();
  };
}

module.exports = {
  requireAuthenticatedSession,
  requirePermissionSession,
};
