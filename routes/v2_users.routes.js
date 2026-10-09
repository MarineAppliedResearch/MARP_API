/**
 * V2 user-management routes, registered code-first through the OpenAPI
 * route registry.
 *
 * The whole domain is gated by the `admin` permission via
 * `requirePermission('admin')` -- every route below documents that
 * requirement explicitly in its OpenAPI `description`. Distinct from the
 * legacy V1 `/api/user*` routes (display-name-only, no credentials, no
 * permission checks), which are untouched.
 *
 * @fileoverview V2 user-management routes and OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/v2_users.routes
 */

const usersController = require('../controller/v2_users.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { requirePermission } = require('../middleware/require-permission.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * OpenAPI tag label shared by all V2 user-management routes.
 *
 * @constant
 * @type {string}
 */
const USERS_TAG = 'V2 · Users';

/**
 * Note appended to every gated route's OpenAPI description, so the
 * required permission is visible in Swagger UI, not just in code.
 *
 * @constant
 * @type {string}
 */
const REQUIRES_ADMIN_NOTE = ' Requires the `admin` permission.';

/**
 * Every route in this file requires the `admin` permission.
 *
 * @constant
 * @type {Function}
 */
const requireAdmin = requirePermission('admin');

/**
 * Register all `/api/v2/users/*` routes and their OpenAPI operations on
 * `app`.
 *
 * Registration order matters: the literal `/permissions` path is
 * registered before `/:id`, otherwise Express would match
 * `GET /api/v2/users/permissions` against the `:id` route first (with
 * `id = 'permissions'`) instead of the catalog route below.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerUsersRoutes(app) {
    // Permission catalog -- every named permission that can be granted.
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/users/permissions',
        summary: 'List the permission catalog',
        description: 'Returns every named permission that can be granted to a user.' + REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        responses: {
            200: {
                description: 'Permission catalog returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Permission' } },
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
                const permissions = await usersController.getPermissionsCatalog();
                res.json(permissions);
            }),
        ],
    });

    // Create a new user with real local login credentials.
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/users',
        summary: 'Create a user',
        description: 'Creates a new user with a local username/password credential.' + REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/UserCreateRequestV2' },
                },
            },
        },
        responses: {
            201: {
                description: 'User created successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/UserWithPermissions' },
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
                const { name, username, password, status } = req.body || {};

                if (!name || !username || !password) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'name, username, and password are all required.');
                }

                const user = await usersController.createUser({ name, username, password, status });
                res.status(201).json(user);
            }),
        ],
    });

    // List every user with their granted permissions.
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/users',
        summary: 'List all users',
        description: 'Returns every user, each with their currently granted permission keys.' + REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        responses: {
            200: {
                description: 'Users returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/UserWithPermissions' } },
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
                const users = await usersController.getAllUsers();
                res.json(users);
            }),
        ],
    });

    // Get one user with their granted permissions.
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/users/:id',
        summary: 'Get a user by id',
        description: 'Returns one user, with their currently granted permission keys.' + REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        responses: {
            200: {
                description: 'User returned successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/UserWithPermissions' },
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
                const user = await usersController.getUserById(req.params.id);

                if (!user) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `User ${req.params.id} was not found.`);
                }

                res.json(user);
            }),
        ],
    });

    // Update a user's editable profile fields.
    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/users/:id',
        summary: 'Update a user',
        description: 'Updates a user\'s name, username, and/or status.' + REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/UserUpdateRequestV2' },
                },
            },
        },
        responses: {
            200: {
                description: 'User updated successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/UserWithPermissions' },
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
                const { name, username, status } = req.body || {};
                const user = await usersController.updateUser(req.params.id, { name, username, status });

                if (!user) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `User ${req.params.id} was not found.`);
                }

                res.json(user);
            }),
        ],
    });

    // Soft-delete a user -- sets status='deleted', never removes the row or
    // anything the user created.
    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/v2/users/:id',
        summary: 'Soft-delete a user',
        description:
            'Sets the user\'s status to "deleted". The row and every record the user created (sessions, observations, etc.) are preserved -- only login and session resumption are rejected, the same way "disabled" already works.' +
            REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        responses: {
            200: {
                description: 'User soft-deleted successfully.',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/UserWithPermissions' },
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
                const user = await usersController.softDeleteUser(req.params.id);

                if (!user) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `User ${req.params.id} was not found.`);
                }

                res.json(user);
            }),
        ],
    });

    // Replace a user's entire permission set.
    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/users/:id/permissions',
        summary: 'Set a user\'s permissions',
        description:
            'Replaces the user\'s entire permission set with exactly the given keys -- any currently-granted permission not in the list is revoked.' +
            REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
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
                        schema: { $ref: '#/components/schemas/UserWithPermissions' },
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

                const existingUser = await usersController.getUserById(req.params.id);

                if (!existingUser) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `User ${req.params.id} was not found.`);
                }

                // Audit column is a real FK to users.user_id -- a service
                // token's principal id isn't one, so only attribute the
                // grant when a human user session performed it.
                const grantedByUserId = req.principal.type === 'user' ? req.principal.id : null;

                await usersController.setUserPermissions(req.params.id, permissionKeys, grantedByUserId);

                res.json(await usersController.getUserById(req.params.id));
            }),
        ],
    });

    // Admin-initiated password change -- no old-password verification,
    // since the admin is acting on another user's account, not their own.
    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/users/:id/password',
        summary: 'Set a user\'s password',
        description: 'Sets a new local login password for the user directly, with no old-password check.' + REQUIRES_ADMIN_NOTE,
        tags: [USERS_TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/SetPasswordRequest' },
                },
            },
        },
        responses: {
            204: {
                description: 'Password updated successfully.',
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
                const { password } = req.body || {};

                if (!password) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'password is required.');
                }

                const existingUser = await usersController.getUserById(req.params.id);

                if (!existingUser) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `User ${req.params.id} was not found.`);
                }

                await usersController.setUserPassword(req.params.id, password);
                res.status(204).send();
            }),
        ],
    });
}

module.exports = registerUsersRoutes;
