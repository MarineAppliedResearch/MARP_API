/**
 * Registers a route at its authenticated V2 path.
 *
 * A route is declared with the V1 path it has always had, plus the permission it
 * requires, and this registers it once -- at the V2 path, behind that permission.
 * The V1 path is not registered at all.
 *
 *   declared:   GET /api/species/lists    permission: 'species:read'
 *   registered: GET /api/v2/species/lists behind requirePermission('species:read')
 *
 * Keeping the declaration in V1 terms means the 140-odd route definitions did not
 * have to be rewritten, and a reader can still match a route to the handler and
 * documentation it always had.
 *
 * V1 is gone rather than deprecated. The dashboard and entry frontends already
 * call only V2, so the annotation GUI was the sole V1 consumer -- and it is being
 * rewritten as part of #50. Leaving both would have meant an unauthenticated way
 * in to every route, which is the thing this work exists to close.
 *
 * **The API and the GUI must therefore ship together.** A GUI still calling V1
 * stops working entirely against an API that has been promoted without it.
 *
 * @fileoverview Registers a route at its authenticated V2 path.
 * @author Isaac Travers
 * @module routes/lib/register-versioned-route
 */

const { requirePermission } = require('../../middleware/require-permission.middleware');
const { registerOpenApiRoute } = require('../../docs/openapi-route-registry');

/**
 * Turn a V1 path into its V2 equivalent.
 *
 * `/api/species/lists` becomes `/api/v2/species/lists`. Anything not starting
 * `/api/` is a mistake worth failing on rather than guessing at.
 *
 * @param {string} v1Path - The V1 route path.
 * @returns {string} The V2 route path.
 * @throws {Error} If the path is not under `/api/`.
 */
function toV2Path(v1Path) {
    if (!v1Path.startsWith('/api/')) {
        throw new Error(`Cannot derive a V2 path from "${v1Path}": expected it to start with /api/.`);
    }

    if (v1Path.startsWith('/api/v2/')) {
        throw new Error(`"${v1Path}" is already a V2 path; register it directly instead.`);
    }

    return v1Path.replace('/api/', '/api/v2/');
}

/**
 * Rewrite a `V1 · Thing` tag as `V2 · Thing`, so the two versions group separately
 * in the API documentation.
 *
 * @param {Array<string>} tags - The V1 tags.
 * @returns {Array<string>} Tags for the V2 operation.
 */
function toV2Tags(tags) {
    if (!Array.isArray(tags)) {
        return tags;
    }

    return tags.map((tag) => tag.replace(/^V1(\s|$)/, 'V2$1').replace(/^V1\s·/, 'V2 ·'));
}

/**
 * Register a route at its authenticated V2 path.
 *
 * @param {Object} app - Express application instance.
 * @param {Object} definition - Exactly what {@link registerOpenApiRoute} takes,
 * plus `permission`.
 * @param {string} definition.permission - Permission key the route requires,
 * e.g. `species:read`.
 * @param {string} [definition.v2Path] - Overrides the derived V2 path. Needed where
 * the obvious derivation collides with a V2 route that already exists: the legacy
 * name-only user routes cannot become `/api/v2/users`, because that is the admin
 * user-management API.
 * @returns {void}
 * @throws {Error} If `permission` is missing. A route with no permission has no
 * business being registered by this helper -- register it directly and be explicit
 * about why it is ungated.
 */
function registerVersionedRoute(app, definition) {
    const { permission, v2Path, ...routeDefinition } = definition;

    if (!permission) {
        throw new Error(
            `registerVersionedRoute requires a permission for ${routeDefinition.method} ${routeDefinition.path}. `
            + 'A deliberately ungated route should use registerOpenApiRoute directly.'
        );
    }

    const v1Handlers = Array.isArray(routeDefinition.handler)
        ? routeDefinition.handler
        : [routeDefinition.handler];

    registerOpenApiRoute(app, {
        ...routeDefinition,
        path: v2Path || toV2Path(routeDefinition.path),
        tags: toV2Tags(routeDefinition.tags),
        description: `${routeDefinition.description || ''} Requires the \`${permission}\` permission.`.trim(),

        responses: {
            ...routeDefinition.responses,
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
        },

        // The handlers as declared, behind the gate.
        handler: [requirePermission(permission), ...v1Handlers],
    });
}

module.exports = {
    registerVersionedRoute,
    toV2Path,
    toV2Tags,
};
