/**
 * Project routes, registered code-first through the OpenAPI route registry.
 *
 * Projects group sessions and observations for a survey effort, campaign,
 * or reporting scope. This file covers all 8 project-related routes: 3
 * read variants (all, by user, by exact name), by-id read, create (full
 * record and name-only), update, and delete.
 *
 * @fileoverview Project resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/project.routes
 */

const projectController = require('../controller/project.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register every `/api/project(s)` route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerProjectRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/projects',
        summary: 'Fetch all projects',
        description: 'Returns every project record.',
        tags: ['V1 · Projects'],
        responses: {
            200: {
                description: 'Project list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await projectController.getProjects();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/projects/user/:userID',
        summary: 'Fetch projects belonging to a user',
        description: 'Returns every project that has at least one session belonging to the given user.',
        tags: ['V1 · Projects'],
        parameters: [
            {
                in: 'path',
                name: 'userID',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the user whose projects should be returned.',
            },
        ],
        responses: {
            200: {
                description: 'Matching project records returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await projectController.getProjectsByUserID(req.params.userID);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/project/getProjectByName/:projectName',
        summary: 'Fetch a project by name',
        description:
            'Returns the project record(s) matching an exact project name. CRITICAL: unlike other repository methods in this codebase, a database failure here resolves with the raw JavaScript Error object itself (not null, not an array, not an ErrorResponse-shaped body) — so a failure response will not match a typical error schema and callers should not rely on a consistent error shape from this endpoint.',
        tags: ['V1 · Projects'],
        parameters: [
            {
                in: 'path',
                name: 'projectName',
                required: true,
                schema: { type: 'string' },
                description: 'Exact project name to match.',
            },
        ],
        responses: {
            200: {
                description: 'Matching project record(s) as an array, or a raw Error object if the query failed (see description).',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            // See description above: repository/project.repository.js#getProjectByName
            // resolves the raw Error on failure rather than following the
            // codebase's usual [] / {} / rethrow conventions.
            const data = await projectController.getProjectByName(req.params.projectName);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/project/:id',
        summary: 'Fetch a project by id',
        description:
            "Returns a single project record by project_id, or null if not found. Database failures reject the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Projects'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'project_id of the project to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching project record.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/Project' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await projectController.getProjectById(req.params.id);

            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Project ${req.params.id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/project',
        summary: 'Create a new project',
        description: 'Creates a new project record.',
        tags: ['V1 · Projects'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/ProjectCreateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The created Project record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await projectController.createProject(req.body.project);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/project/createProjectByName/:projectName',
        summary: 'Create a new project by name only',
        description: 'Creates a new project record from a name alone, without a request body.',
        tags: ['V1 · Projects'],
        parameters: [
            {
                in: 'path',
                name: 'projectName',
                required: true,
                schema: { type: 'string' },
                description: 'Name for the new project.',
            },
        ],
        responses: {
            200: {
                description: 'The created Project record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await projectController.createProjectByName(req.params.projectName);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/project',
        summary: 'Update an existing project',
        description: 'Updates an existing project record by its project_id field.',
        tags: ['V1 · Projects'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/ProjectUpdateRequest' } },
            },
        },
        responses: {
            200: { description: 'The Sequelize update result.' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await projectController.updateProject(req.body.project);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/project/:id',
        summary: 'Delete a project',
        description: 'Deletes a project record by id.',
        tags: ['V1 · Projects'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the project to delete.',
            },
        ],
        responses: {
            200: { description: 'The number of rows destroyed, as returned by Sequelize.' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await projectController.deleteProject(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerProjectRoutes;
