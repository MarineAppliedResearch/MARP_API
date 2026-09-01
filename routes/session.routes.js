/**
 * Session routes, registered code-first through the OpenAPI route registry.
 *
 * Sessions are the parent record for observations: each session groups the
 * observations recorded during a single dive/line, along with its owning
 * project and user. This file covers all 7 session-related routes.
 *
 * @fileoverview Session resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/session.routes
 */

const sessionController = require('../controller/session.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register every `/api/session(s)` route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerSessionRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/sessions',
        summary: 'Fetch all sessions',
        description: 'Returns every session record, each including its associated user.',
        tags: ['V1 · Sessions'],
        responses: {
            200: {
                description: 'Session list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Session' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await sessionController.getSessions();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/session/:id',
        summary: 'Fetch a session by id',
        description:
            "Returns a single session record by session_id, or null if not found. Database failures reject the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Sessions'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'session_id of the session to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching session record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await sessionController.getSessionById(req.params.id);

            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Session ${req.params.id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/sessions/user/:userID/project/:projectID',
        summary: 'Fetch sessions for a user within a project',
        description: 'Returns sessions matching the given user and project, each including its associated user and project.',
        tags: ['V1 · Sessions'],
        parameters: [
            {
                in: 'path',
                name: 'userID',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the user whose sessions should be fetched.',
            },
            {
                in: 'path',
                name: 'projectID',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the project to scope the sessions to.',
            },
        ],
        responses: {
            200: {
                description: 'Matching session records returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Session' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await sessionController.getSessionsByUserIdAndProjectId(req.params.userID, req.params.projectID);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/sessions/project/:projectID',
        summary: 'Fetch every session in a project, with browser detail',
        description:
            'Returns every session in the project, ordered by dive, then line, then type, so a client can group them under their dive without sorting first. Each session carries its processor, how many observations were recorded against it, and the videos those observations name. Unlike GET /api/sessions/user/{userID}/project/{projectID} this does not require a processor to be chosen first, which is what lets a reviewer browse a dive whoever worked on it.',
        tags: ['V1 · Sessions'],
        parameters: [
            {
                in: 'path',
                name: 'projectID',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the project whose sessions should be listed.',
            },
        ],
        responses: {
            200: {
                description: 'Session records returned successfully. An empty array when the project has no sessions.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/SessionWithDetail' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await sessionController.getSessionsWithDetailByProjectID(req.params.projectID);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/session',
        summary: 'Create a new session',
        description: 'Creates a new session record.',
        tags: ['V1 · Sessions'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SessionCreateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The created Session record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await sessionController.createSession(req.body.session);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/session/createNewSession/:processorName/:projectName/:line/:dive/:lineID/:type',
        summary: 'Create a session, creating its project and processor user if needed',
        description:
            'Convenience endpoint that looks up or creates the named processor (user) and project, then creates a new session linking them with the given line, dive, and type. All identifying values are passed as path segments rather than a request body.',
        tags: ['V1 · Sessions'],
        parameters: [
            {
                in: 'path',
                name: 'processorName',
                required: true,
                schema: { type: 'string' },
                description: "Name of the user to look up or create as the session's processor.",
            },
            {
                in: 'path',
                name: 'projectName',
                required: true,
                schema: { type: 'string' },
                description: 'Name of the project to look up or create.',
            },
            {
                in: 'path',
                name: 'line',
                required: true,
                schema: { type: 'string' },
                description: 'Line value for the new session.',
            },
            {
                in: 'path',
                name: 'dive',
                required: true,
                schema: { type: 'string' },
                description: 'Dive value for the new session.',
            },
            {
                in: 'path',
                name: 'lineID',
                required: true,
                schema: { type: 'string' },
                description: 'Line identifier for the new session.',
            },
            {
                in: 'path',
                name: 'type',
                required: true,
                schema: { type: 'string' },
                description: 'Session type value.',
            },
        ],
        responses: {
            200: {
                description: 'The created Session record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            // Look-up-or-create for both the processor (user) and project
            // happens inside this one controller call before the session
            // itself is created -- see session.controller.js for the chain.
            const data = await sessionController.createSessionAndProjectandProcessor(
                req.params.processorName,
                req.params.projectName,
                req.params.line,
                req.params.dive,
                req.params.lineID,
                req.params.type
            );
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/session',
        summary: 'Update an existing session',
        description: 'Updates an existing session record by its session_id field.',
        tags: ['V1 · Sessions'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SessionUpdateRequest' } },
            },
        },
        responses: {
            200: { description: 'The Sequelize update result.' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await sessionController.updateSession(req.body.session);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/session/:id',
        summary: 'Delete a session',
        description: 'Deletes a session record by id.',
        tags: ['V1 · Sessions'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the session to delete.',
            },
        ],
        responses: {
            200: { description: 'The number of rows destroyed, as returned by Sequelize.' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await sessionController.deleteSession(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerSessionRoutes;
