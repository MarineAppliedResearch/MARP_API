/**
 * Task CRUD routes, registered code-first through the OpenAPI route registry.
 *
 * Each route's Express handler and its documented OpenAPI operation
 * (summary, parameters, request/response schemas) are defined together in
 * one object and registered via `registerOpenApiRoute`, so the two cannot
 * drift out of sync the way separate `@openapi` comment blocks could.
 *
 * @fileoverview Task resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/task.routes
 */

const taskController = require('../controller/task.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register every `/api/task(s)` route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerTaskRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/tasks',
        summary: 'Fetch all tasks',
        description: 'Returns every task row currently available in storage.',
        tags: ['Tasks'],
        responses: {
            200: {
                description: 'Task list returned successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/Task',
                            },
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            // getTasks() swallows database errors to [] rather than
            // throwing, so an empty array here doesn't distinguish
            // "no tasks" from "query failed" -- see repository/task.repository.js.
            const data = await taskController.getTasks();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/task',
        summary: 'Create a new task',
        description: 'Creates a new task record and returns the inserted row.',
        tags: ['Tasks'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/TaskCreateRequest',
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The created Task record.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/Task',
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            // Insert failure is logged and swallowed to {} rather than
            // thrown, same swallow-to-fallback pattern as getTasks() above.
            const data = await taskController.createTask(req.body.task);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/task',
        summary: 'Update an existing task',
        description: 'Updates an existing task record by its id field.',
        tags: ['Tasks'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/TaskUpdateRequest',
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The Sequelize update result, or an empty object if the update failed.',
                content: {
                    'application/json': {
                        schema: {
                            oneOf: [
                                {
                                    type: 'array',
                                    items: {
                                        type: 'integer',
                                    },
                                },
                                {
                                    type: 'object',
                                    additionalProperties: true,
                                },
                            ],
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            // Success resolves to Sequelize's raw update result (an array
            // whose first element is the affected-row count); a failure is
            // logged and swallowed to {} rather than thrown -- hence the
            // oneOf(array, object) response schema above.
            const data = await taskController.updateTask(req.body.task);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/task/:id',
        summary: 'Fetch a task by id',
        description: 'Returns a single task record, or null if not found.',
        tags: ['Tasks'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: {
                    type: 'integer',
                },
                description: 'ID of the task to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching task record.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/Task',
                        },
                    },
                },
            },
            404: {
                $ref: '#/components/responses/NotFoundError',
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await taskController.getTaskById(req.params.id);

            // getTaskById resolves null for "no such task" -- only that
            // case becomes this explicit 404, not a repository failure
            // (which would reject and be caught by asyncHandler instead).
            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Task ${req.params.id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/task/:id',
        summary: 'Delete a task',
        description: 'Deletes a task record by id.',
        tags: ['Tasks'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: {
                    type: 'integer',
                },
                description: 'ID of the task to delete.',
            },
        ],
        responses: {
            200: {
                description: 'The number of rows destroyed (as returned by Sequelize).',
                content: {
                    'application/json': {
                        schema: {
                            type: 'integer',
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            // Delete failure is logged and swallowed to {} rather than
            // thrown -- see repository/task.repository.js#deleteTask (which
            // also has an unreachable dead-code line after its real return,
            // left as-is since it never executes).
            const data = await taskController.deleteTask(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerTaskRoutes;