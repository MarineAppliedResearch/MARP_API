/**
 * Registers one route twice: as it exists today, and as an authenticated V2 route.
 *
 * There are 108 unauthenticated V1 routes to move onto V2 (see #50), and writing
 * each definition out twice would double 3,000 lines of route code and guarantee
 * the two copies drift. So a route is declared once, with the permission it should
 * require, and this registers both:
 *
 *   GET /api/species/lists          unchanged, no gate
 *   GET /api/v2/species/lists       same handler, behind requirePermission(...)
 *
 * One handler, one OpenAPI description, one place to change behaviour. The V2
 * variant differs only in its path, its tag, an added permission note, and the
 * 401/403 responses.
 *
 * Declaring both is deliberate rather than a transition step nobody finished: V1
 * has consumers that cannot authenticate yet -- the annotation GUI, the dashboard
 * and entry frontends -- and production runs a codebase with none of the V2 auth
 * substrate at all. How and when V1 is retired is a decision on #50, not something
 * this helper should force.
 *
 * @fileoverview Registers a route under both the V1 and authenticated V2 prefixes.
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
 * Register a route as both an unauthenticated V1 route and an authenticated V2
 * route.
 *
 * @param {Object} app - Express application instance.
 * @param {Object} definition - Exactly what {@link registerOpenApiRoute} takes,
 * plus `permission`.
 * @param {string} definition.permission - Permission key the V2 route requires,
 * e.g. `species:read`.
 * @returns {void}
 * @throws {Error} If `permission` is missing. A route with no permission has no
 * business being registered by this helper -- register it directly and be explicit
 * about why it is ungated.
 */
function registerVersionedRoute(app, definition) {
    const { permission, ...routeDefinition } = definition;

    if (!permission) {
        throw new Error(
            `registerVersionedRoute requires a permission for ${routeDefinition.method} ${routeDefinition.path}. `
            + 'A deliberately ungated route should use registerOpenApiRoute directly.'
        );
    }

    // V1: exactly as it was. No gate, no change in behaviour, so an existing
    // consumer cannot be broken by this conversion.
    registerOpenApiRoute(app, routeDefinition);

    const v1Handlers = Array.isArray(routeDefinition.handler)
        ? routeDefinition.handler
        : [routeDefinition.handler];

    registerOpenApiRoute(app, {
        ...routeDefinition,
        path: toV2Path(routeDefinition.path),
        tags: toV2Tags(routeDefinition.tags),
        description: `${routeDefinition.description || ''} Requires the \`${permission}\` permission.`.trim(),

        responses: {
            ...routeDefinition.responses,
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
        },

        // The same handlers, behind the gate. Not a copy: the identical function
        // references, so the two versions cannot diverge in behaviour.
        handler: [requirePermission(permission), ...v1Handlers],
    });
}

module.exports = {
    registerVersionedRoute,
    toV2Path,
    toV2Tags,
};
