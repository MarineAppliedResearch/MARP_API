/**
 * User routes, registered code-first through the OpenAPI route registry.
 *
 * Users are the individuals who own sessions and observations throughout
 * MARP. This file covers all 8 user-related routes: 3 read variants
 * (all, by id, by exact name), a name-only lookup, create (full record and
 * name-only), update, and delete.
 *
 * @fileoverview User resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/user.routes
 */

const userController = require('../controller/user.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register every `/api/user(s)` route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerUserRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/users',
        summary: 'Fetch all users',
        description: 'Returns every user record.',
        tags: ['V1 · Users'],
        responses: {
            200: {
                description: 'User list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await userController.getUsers();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/users/:id',
        summary: 'Fetch a user by id',
        description:
            "Returns a single user record by user_id, or null if not found. Database failures reject the returned promise, so the route's .catch() responds with HTTP 500 in that case. Registered under the plural /users path (rather than /user/:id) to avoid colliding with the existing name-based lookup at /user/{name}.",
        tags: ['V1 · Users'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'user_id of the user to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching user record.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/User' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await userController.getUserById(req.params.id);

            // getUserById rethrows on a real DB failure (rejects the promise,
            // caught by asyncHandler) but resolves null for "no such user" --
            // only the null case becomes this explicit 404.
            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `User ${req.params.id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/user/:name',
        summary: 'Fetch a user by name',
        description:
            'Returns the user record(s) matching an exact display name. Resolves to an empty array both when no user has that name and when the underlying database query fails.',
        tags: ['V1 · Users'],
        parameters: [
            {
                in: 'path',
                name: 'name',
                required: true,
                schema: { type: 'string' },
                description: 'Exact display name to match.',
            },
        ],
        responses: {
            200: {
                description: 'Matching user record(s) returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await userController.getUserByName(req.params.name);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/user/getUserNameByID/:userID',
        summary: "Fetch a user's display name by id",
        description:
            "Returns the display name of the user matching the given id. CRITICAL: if no user matches the given ID, this can throw / return an unhandled error (HTTP 500 via the framework's default error handling, or an unhandled rejection since the route has no .catch()), because the repository accesses a property on the query result without checking whether it's null first.",
        tags: ['V1 · Users'],
        parameters: [
            {
                in: 'path',
                name: 'userID',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the user whose name should be returned.',
            },
        ],
        responses: {
            200: {
                description: 'User name returned successfully.',
                content: { 'application/json': { schema: { type: 'string' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            // See description above: repository/user.repository.js#getUserNameByID
            // accesses `.dataValues.name` on a possibly-null query result with
            // no null check, so a bad userID throws instead of 404ing cleanly.
            const data = await userController.getUserNameByID(req.params.userID);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/user',
        summary: 'Create a new user',
        description: 'Creates a new user record.',
        tags: ['V1 · Users'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/UserCreateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The created User record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await userController.createUser(req.body.user);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/user/createUserByName/:userName',
        summary: 'Create a new user by name only',
        description: 'Creates a new user record from a name alone, without a request body.',
        tags: ['V1 · Users'],
        parameters: [
            {
                in: 'path',
                name: 'userName',
                required: true,
                schema: { type: 'string' },
                description: 'Display name for the new user.',
            },
        ],
        responses: {
            200: {
                description: 'The created User record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            // Insert failure (e.g. the users.name unique constraint) is
            // logged and swallowed to {} rather than thrown -- see
            // repository/user.repository.js#createUserByName.
            const data = await userController.createUserByName(req.params.userName);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/user',
        summary: 'Update an existing user',
        description: 'Updates an existing user record by its user_id field.',
        tags: ['V1 · Users'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/UserUpdateRequest' } },
            },
        },
        responses: {
            200: {
                description: "Sequelize's update result (typically `[affectedCount]`), or `{}` if the update failed.",
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await userController.updateUser(req.body.user);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/user/:id',
        summary: 'Delete a user',
        description:
            'Deletes a user record by user_id. Database failures are logged and swallowed, resolving to an empty object `{}` rather than throwing.',
        tags: ['V1 · Users'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the user to delete.',
            },
        ],
        responses: {
            200: {
                description: 'The number of rows destroyed (as returned by Sequelize), or an empty object `{}` if the delete failed.',
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await userController.deleteUser(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerUserRoutes;
