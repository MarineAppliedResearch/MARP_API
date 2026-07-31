/**
 * Session-guard middleware for protected static frontend apps.
 *
 * Unlike the JSON API (which rejects unauthenticated requests with a 401
 * envelope, see middleware/error-contract.middleware.js), a static app is
 * reached by a plain browser navigation, so an unauthenticated request is
 * redirected to the public entry page instead of returned as an error body.
 *
 * @fileoverview Session-guard middleware for protected static frontend apps.
 * @author Isaac Travers
 * @module middleware/require-authenticated-session
 */

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

module.exports = {
  requireAuthenticatedSession,
};
