/**
 * Dual-mode auth principal resolution.
 *
 * Runs globally, once per request, right after Passport's session
 * middleware. Normalizes whichever credential the request actually
 * presented -- a browser session or an `Authorization: Bearer` token --
 * into one shape, `req.principal = {type, id, permissions}`, so
 * `middleware/require-permission.middleware.js` (and anything else that
 * cares "is this caller allowed to do X") never needs to know which kind
 * of caller it is.
 *
 * @fileoverview Resolves the current request's auth principal from either a session or a bearer token.
 * @author Isaac Travers
 * @module middleware/resolve-principal
 */

const tokensRepository = require('../repository/v2_tokens.repository');

/**
 * Extract the raw token from a `Authorization: Bearer <token>` header.
 *
 * @param {Object} req - Express request.
 * @returns {string|null} The raw token, or null if the header is missing/malformed.
 */
function extractBearerToken(req) {
    const header = req.get('authorization');

    if (!header || !header.startsWith('Bearer ')) {
        return null;
    }

    const token = header.slice('Bearer '.length).trim();

    return token || null;
}

/**
 * Resolve `req.principal` for the current request.
 *
 * Session identity takes priority (a browser that is both logged in and
 * somehow sending a bearer token should be treated as its logged-in user,
 * not a service). Leaves `req.principal` undefined when neither credential
 * resolves to anything, same as today's unauthenticated case -- downstream
 * checks (`requirePermission`) already handle that.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next callback.
 * @returns {void}
 */
function resolvePrincipal(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        req.principal = {
            type: 'user',
            id: req.user.user_id,
            permissions: req.user.permissions,
        };

        return next();
    }

    const rawToken = extractBearerToken(req);

    if (!rawToken) {
        return next();
    }

    tokensRepository
        .resolveToken(rawToken)
        .then((principal) => {
            if (principal) {
                req.principal = principal;
                // Fire-and-forget: never let a usage-timestamp write delay the request.
                tokensRepository.touchTokenUsage(principal.tokenId, principal.id);
            }

            return next();
        })
        .catch(next);
}

module.exports = {
    resolvePrincipal,
};
