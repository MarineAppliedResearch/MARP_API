/**
 * Code-first Express route + OpenAPI operation registry.
 *
 * Lets a route module register a plain-object route definition once and
 * have it drive both real Express registration and the generated OpenAPI
 * document, instead of maintaining a handler and a separate `@openapi`
 * comment block in sync by hand. `docs/openapi.js` reads the accumulated
 * definitions back out via {@link getRegisteredOpenApiRoutes} and merges
 * them into `spec.paths` after `swagger-jsdoc` runs.
 *
 * @fileoverview Generic code-first route/OpenAPI registration helper.
 * @author Isaac Travers
 * @module docs/openapi-route-registry
 */

/**
 * Accumulated `{ method, path, operation }` entries, one per registered
 * route, in registration order. Read by {@link getRegisteredOpenApiRoutes}.
 *
 * @constant
 * @type {Array<Object>}
 */
const documentedRoutes = [];

/**
 * `"METHOD path"` keys already registered, used to reject duplicate
 * registrations of the same Express route.
 *
 * @constant
 * @type {Set<string>}
 */
const registeredRouteKeys = new Set();

/**
 * Convert an Express route path into its documented OpenAPI form.
 *
 * Strips a leading `/api` prefix (paths are documented without it,
 * matching the existing `@openapi` blocks elsewhere in the project) and
 * converts Express `:param` path segments to OpenAPI `{param}` syntax.
 *
 * @param {string} expressPath - Express-style route path, e.g. `/api/task/:id`.
 * @returns {string} OpenAPI-style path, e.g. `/task/{id}`.
 */
function normalizeOpenApiPath(expressPath) {
    return expressPath
        .replace(/^\/api(?=\/|$)/, '')
        .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Register an Express route and its OpenAPI operation from one definition.
 *
 * Wires `definition.handler` onto `app` for `definition.method`/`path`, then
 * records the remaining definition fields (summary, description, tags,
 * parameters, requestBody, responses, etc.) as the OpenAPI operation object
 * for that path, to be merged into the generated spec later.
 *
 * @param {Object} app - Express application instance to register the route on.
 * @param {Object} definition - Route + OpenAPI operation definition.
 * @param {string} definition.method - Documented HTTP method, e.g. `'get'`.
 * @param {string} [definition.expressMethod] - Actual Express method to
 *   register with, if it differs from `method` (e.g. a route mounted with
 *   `app.use()` so it responds to any HTTP verb, but is documented as `get`
 *   since that's its intended/only meaningful usage). Defaults to `method`.
 * @param {string} definition.path - Express route path, e.g. `/api/task/:id`.
 * @param {Function|Array<Function>} definition.handler - Express request
 *   handler, or an ordered array of middleware/handler functions (e.g.
 *   `[requirePermission('admin'), asyncHandler(realHandler)]`) -- the same
 *   chaining `app.get(path, mw1, mw2)` supports natively.
 * @returns {void}
 * @throws {Error} If method, path, or handler is missing/invalid, or if this
 *   method+path combination was already registered.
 */
function registerOpenApiRoute(app, definition) {
    const method = String(definition.method || '').toLowerCase();
    const expressMethod = String(definition.expressMethod || definition.method || '').toLowerCase();
    const routePath = definition.path;
    const handlerChain = Array.isArray(definition.handler) ? definition.handler : [definition.handler];

    if (!method) {
        throw new Error('registerOpenApiRoute requires a method.');
    }

    if (!routePath) {
        throw new Error('registerOpenApiRoute requires a path.');
    }

    if (handlerChain.length === 0 || handlerChain.some((fn) => typeof fn !== 'function')) {
        throw new Error('registerOpenApiRoute requires a handler function or a non-empty array of handler functions.');
    }

    const routeKey = `${method} ${routePath}`;

    if (registeredRouteKeys.has(routeKey)) {
        throw new Error(`Duplicate OpenAPI route registration: ${routeKey}`);
    }

    registeredRouteKeys.add(routeKey);

    app[expressMethod](routePath, ...handlerChain);

    const { handler: ignoredHandler, method: ignoredMethod, expressMethod: ignoredExpressMethod, path: ignoredPath, ...operation } = definition;

    documentedRoutes.push({
        method,
        path: normalizeOpenApiPath(routePath),
        operation,
    });
}

/**
 * Get every route registered so far via {@link registerOpenApiRoute}.
 *
 * Returns a shallow copy so callers (e.g. `docs/openapi.js` merging these
 * into the generated spec) cannot mutate the internal registry.
 *
 * @returns {Array<Object>} `{ method, path, operation }` entries in registration order.
 */
function getRegisteredOpenApiRoutes() {
    return documentedRoutes.slice();
}

module.exports = {
    getRegisteredOpenApiRoutes,
    normalizeOpenApiPath,
    registerOpenApiRoute,
};