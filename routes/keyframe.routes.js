/**
 * Keyframe routes, registered code-first through the OpenAPI route registry.
 *
 * Keyframes are frame-level bounding-box annotations belonging to an
 * observation (see `model/keyframe.model.js`). All four CRUD routes for
 * this resource are registered here.
 *
 * @fileoverview Keyframe resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/keyframe.routes
 */

const keyframeController = require('../controller/keyframe.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register every `/api/keyframe(s)` route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerKeyframeRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/keyframe',
        summary: 'Bulk-create keyframe records',
        description:
            'Creates one or more keyframe records in a single transaction. CRITICAL: unlike most other POST routes, the request body itself must be a JSON array of keyframe objects (not wrapped in a named field) — only the observation_id, x, y, width, height, subset, type, comname, and framenum fields are copied from each input object; any others are ignored. If the bulk insert fails, the transaction is rolled back and the failure is only logged, so the response resolves to an empty array `[]` rather than an error — callers cannot distinguish "nothing to insert" from "insert failed."',
        tags: ['Keyframes'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'array',
                        items: {
                            $ref: '#/components/schemas/Keyframe',
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The created Keyframe records, or an empty array if the bulk insert failed (see description).',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/Keyframe',
                            },
                        },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            // req.body IS the array of keyframes -- not wrapped in { keyframes: [...] }
            // like the other domains' write bodies.
            const data = await keyframeController.createKeyframes(req.body);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/keyframe/:keyframe_id',
        summary: 'Fetch a keyframe by id',
        description:
            "Returns a single keyframe record by keyframe_id, or null if not found. Database failures reject the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Keyframes'],
        parameters: [
            {
                in: 'path',
                name: 'keyframe_id',
                required: true,
                schema: { type: 'integer' },
                description: 'keyframe_id of the keyframe to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching keyframe record.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/Keyframe',
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
            const data = await keyframeController.getKeyframeById(req.params.keyframe_id);

            // Unlike getDBName-style reads, a missing keyframe here is a real
            // 404 rather than a swallowed-to-[] result -- the repository
            // resolves null and this route turns that into ApiError.
            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Keyframe ${req.params.keyframe_id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/keyframe/:keyframe_id',
        summary: 'Update an existing keyframe',
        description:
            "Updates an existing keyframe record by keyframe_id. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Keyframes'],
        parameters: [
            {
                in: 'path',
                name: 'keyframe_id',
                required: true,
                schema: { type: 'integer' },
                description: 'keyframe_id of the keyframe to update.',
            },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['keyframe'],
                        properties: {
                            keyframe: {
                                $ref: '#/components/schemas/Keyframe',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The updated keyframe record, or null if no keyframe matched the given id.',
                content: {
                    'application/json': {
                        schema: {
                            oneOf: [
                                { $ref: '#/components/schemas/Keyframe' },
                                { type: 'null' },
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
            const data = await keyframeController.updateKeyframe(req.params.keyframe_id, req.body.keyframe);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/keyframe/:keyframe_id',
        summary: 'Delete a keyframe',
        description:
            'Deletes a keyframe record by id. Database failures are logged and swallowed, resolving to an empty object `{}` rather than throwing.',
        tags: ['Keyframes'],
        parameters: [
            {
                in: 'path',
                name: 'keyframe_id',
                required: true,
                schema: { type: 'integer' },
                description: 'keyframe_id of the keyframe to delete.',
            },
        ],
        responses: {
            200: {
                description: 'The number of rows destroyed (as returned by Sequelize), or an empty object `{}` if the delete failed.',
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            // Unlike the GET above, a failure here is swallowed to {} rather
            // than thrown -- see repository/keyframe.repository.js#deleteKeyframe.
            const data = await keyframeController.deleteKeyframe(req.params.keyframe_id);
            res.json(data);
        }),
    });
}

module.exports = registerKeyframeRoutes;
