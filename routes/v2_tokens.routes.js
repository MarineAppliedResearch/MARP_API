/**
 * V2 service-application (bearer token) routes, registered code-first
 * through the OpenAPI route registry.
 *
 * Covers both resources this admin feature manages together: applications
 * (`/api/v2/apps*`) and their bearer tokens (`/api/v2/tokens*`). The whole
 * domain is gated by the `admin` permission via `requirePermission('admin')`
 * -- satisfied by either an admin user session or a bearer token that has
 * itself been granted `admin` (see `middleware/resolve-principal.middleware.js`)
 * -- and every route documents that requirement explicitly in its OpenAPI
 * `description`.
 *
 * @fileoverview V2 service-application/token routes and OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/v2_tokens.routes
 */

const tokensController = require('../controller/v2_tokens.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { requirePermission } = require('../middleware/require-permission.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * OpenAPI tag label shared by all V2 service-application/token routes.
 *
 * @constant
 * @type {string}
 */
const TOKENS_TAG = 'V2 · Tokens';

/**
 * Note appended to every gated route's OpenAPI description, so the
 * required permission is visible in Swagger UI, not just in code.
 *
 * @constant
 * @type {string}
 */
const REQUIRES_ADMIN_NOTE = ' Requires the `admin` permission.';

/**
 * Every route in this file requires the `admin` permission, satisfied by
 * either an admin user session or an admin-permissioned bearer token.
 *
 * @constant
 * @type {Function}
 */
const requireAdmin = requirePermission('admin');

/**
 * Resolve the acting principal's `users.user_id` for audit columns, or
 * null when the caller is a service token (whose principal id is a
 * `service_clients.service_client_id`, not a `users.user_id`, and can't
 * satisfy that foreign key).
 *
 * @param {Object} req - Express request, with `req.principal` set by `resolvePrincipal`.
 * @returns {number|null} The acting user's id, or null.
 */
function actingUserId(req) {
    return req.principal.type === 'user' ? req.principal.id : null;
}

/**
 * Register all `/api/v2/apps/*` and `/api/v2/tokens/*` routes and their
 * OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerTokensRoutes(app) {
    // Register a new application.
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/apps',
        summary: 'Register an application',
        description: 'Registers a new application that can be issued bearer tokens.' + REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/ServiceClientCreateRequest' },
                },
            },
        },
        responses: {
            201: {
                description: 'Application registered successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceClient' },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            409: { $ref: '#/components/responses/ConflictError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const { name, description } = req.body || {};

                if (!name) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'name is required.');
                }

                const application = await tokensController.createApp({
                    name,
                    description,
                    createdByUserId: actingUserId(req),
                });

                res.status(201).json(application);
            }),
        ],
    });

    // List every application.
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/apps',
        summary: 'List applications',
        description: 'Returns every registered application, each with its token count.' + REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        responses: {
            200: {
                description: 'Applications returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/ServiceClient' } },
                    },
                },
            },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                res.json(await tokensController.getAllApps());
            }),
        ],
    });

    // Get one application.
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/apps/:id',
        summary: 'Get an application by id',
        description: 'Returns one registered application.' + REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        responses: {
            200: {
                description: 'Application returned successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceClient' },
                    },
                },
            },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const application = await tokensController.getAppById(req.params.id);

                if (!application) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Application ${req.params.id} was not found.`);
                }

                res.json(application);
            }),
        ],
    });

    // Update an application's editable fields.
    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/apps/:id',
        summary: 'Update an application',
        description: 'Updates an application\'s name, description, and/or status.' + REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/ServiceClientUpdateRequest' },
                },
            },
        },
        responses: {
            200: {
                description: 'Application updated successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceClient' },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            409: { $ref: '#/components/responses/ConflictError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const { name, description, status } = req.body || {};
                const application = await tokensController.updateApp(req.params.id, { name, description, status });

                if (!application) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Application ${req.params.id} was not found.`);
                }

                res.json(application);
            }),
        ],
    });

    // Permanently delete an application and every token under it.
    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/v2/apps/:id',
        summary: 'Delete an application',
        description:
            'Permanently deletes an application and every bearer token issued under it (cascading). Unlike a user soft-delete, this is a real, irreversible removal.' +
            REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        responses: {
            204: {
                description: 'Application deleted successfully.',
            },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const deleted = await tokensController.deleteApp(req.params.id);

                if (!deleted) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Application ${req.params.id} was not found.`);
                }

                res.status(204).send();
            }),
        ],
    });

    // Issue a new bearer token for an application. The only response that
    // ever contains the raw secret.
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/tokens',
        summary: 'Issue a bearer token',
        description:
            'Issues a new bearer token for an application. The raw token is returned exactly once, in this response -- it cannot be retrieved again afterward, only regenerated as a new token.' +
            REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/ServiceTokenCreateRequest' },
                },
            },
        },
        responses: {
            201: {
                description: 'Token issued successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceTokenIssued' },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const { serviceClientId, expiresAt } = req.body || {};

                if (!serviceClientId) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'serviceClientId is required.');
                }

                const application = await tokensController.getAppById(serviceClientId);

                if (!application) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Application ${serviceClientId} was not found.`);
                }

                const token = await tokensController.createToken({
                    serviceClientId,
                    expiresAt,
                    createdByUserId: actingUserId(req),
                });

                res.status(201).json(token);
            }),
        ],
    });

    // List every token across every application.
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/tokens',
        summary: 'List all tokens',
        description: 'Returns every issued token across every application (never the raw secret), with its owning application, status, and granted permissions.' + REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        responses: {
            200: {
                description: 'Tokens returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/ServiceToken' } },
                    },
                },
            },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                res.json(await tokensController.getAllTokens());
            }),
        ],
    });

    // Revoke a token. The row is kept (for history/audit) but rejected by
    // every future authentication attempt.
    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/v2/tokens/:id',
        summary: 'Revoke a token',
        description: 'Revokes a token immediately. The token record is kept for history, but is rejected by any future authentication attempt.' + REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        responses: {
            200: {
                description: 'Token revoked successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceToken' },
                    },
                },
            },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const token = await tokensController.revokeToken(req.params.id);

                if (!token) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Token ${req.params.id} was not found.`);
                }

                res.json(token);
            }),
        ],
    });

    // Regenerate a token: revoke the existing one and issue a brand-new
    // row under the same application, preserving an audit trail of
    // exactly which secret was live over which period.
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/tokens/:id/regenerate',
        summary: 'Regenerate a token',
        description:
            'Revokes the existing token and issues a brand-new one under the same application. The new raw token is returned exactly once, the same as when a token is first issued.' +
            REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        responses: {
            201: {
                description: 'Token regenerated successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceTokenIssued' },
                    },
                },
            },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const token = await tokensController.regenerateToken(req.params.id, actingUserId(req));

                if (!token) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Token ${req.params.id} was not found.`);
                }

                res.status(201).json(token);
            }),
        ],
    });

    // Replace a token's entire permission set.
    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/tokens/:id/permissions',
        summary: 'Set a token\'s permissions',
        description:
            'Replaces the token\'s entire permission set with exactly the given keys -- any currently-granted permission not in the list is revoked.' +
            REQUIRES_ADMIN_NOTE,
        tags: [TOKENS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/SetPermissionsRequest' },
                },
            },
        },
        responses: {
            200: {
                description: 'Permissions updated successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ServiceToken' },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            requireAdmin,
            asyncHandler(async (req, res) => {
                const { permissionKeys } = req.body || {};

                if (!Array.isArray(permissionKeys)) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'permissionKeys must be an array of permission keys.');
                }

                const existingToken = await tokensController.getTokenById(req.params.id);

                if (!existingToken) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Token ${req.params.id} was not found.`);
                }

                await tokensController.setTokenPermissions(req.params.id, permissionKeys, actingUserId(req));

                res.json(await tokensController.getTokenById(req.params.id));
            }),
        ],
    });
}

module.exports = registerTokensRoutes;
