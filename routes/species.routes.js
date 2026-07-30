/**
 * Species and model_species routes, registered code-first through the
 * OpenAPI route registry.
 *
 * Both resources share `controller/species.controller.js`: species is the
 * taxonomy/GUI-display catalog, and model_species is the join table linking
 * ML models to the species they were trained on. Kept in one file since
 * they share a controller/service/repository boundary.
 *
 * @fileoverview Species and model_species resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/species.routes
 */

const speciesController = require('../controller/species.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register every `/api/species` and `/api/model_species` route and its
 * OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerSpeciesRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species',
        summary: 'Fetch all species',
        description:
            'Returns every species record used for taxonomy, GUI display configuration, and ML model training labels. An empty array may indicate either that no records exist or that the database query failed.',
        tags: ['Species'],
        responses: {
            200: {
                description: 'Species list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Species' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpecies();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/by-comname/:comname',
        summary: 'Fetch a species by common name',
        description:
            'Returns the species record whose comname matches the supplied value, case-insensitively. Returns null both when no species matches and when the database query fails.',
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'comname',
                required: true,
                schema: { type: 'string' },
                description: 'Common name to match, case-insensitively.',
            },
        ],
        responses: {
            200: {
                description: 'Matching species returned, or null if not found.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Species' }, { type: 'null' }] },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesByComname(req, res);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/:id',
        summary: 'Fetch a species by id',
        description:
            "Returns a single species record by id, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'id of the species record to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching species record, or null if not found.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Species' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesById(req.params.id);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/species',
        summary: 'Create a new species record',
        description:
            "Creates a new species record. The caller must supply a unique taxserial (see the species_taxserial_idx unique index in model/species.model.js). A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SpeciesCreateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The created species record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Species' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // Insert failure (e.g. the species_taxserial_idx unique
            // constraint) rejects rather than swallowing to a fallback.
            const data = await speciesController.createSpecies(req.body.species);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/species/:id',
        summary: 'Update an existing species record',
        description:
            "Updates an existing species record by id. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'id of the species record to update.',
            },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SpeciesUpdateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The updated species record, or null if no species matched the given id.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Species' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.updateSpecies(req.params.id, req.body.species);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/species/:id',
        summary: 'Delete a species record',
        description:
            "Deletes a species record by id. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'id of the species record to delete.',
            },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.deleteSpecies(req.params.id);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/model_species',
        summary: 'Create a model-species linkage record',
        description:
            'Creates a model_species join record linking an ML model to a species, using the request body directly as the record to insert. Note that when the insert fails the response body is an ErrorResponse-shaped object, but the endpoint currently still responds with HTTP 200 rather than an error status.',
        tags: ['Species'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['model_id', 'species_id'],
                        properties: {
                            model_id: { type: 'integer', example: 7 },
                            species_id: { type: 'integer', example: 42 },
                            dataset_size: { type: 'integer', nullable: true },
                            balance_weight: { type: 'number', format: 'float', nullable: true },
                            precision_mean: { type: 'number', format: 'float', nullable: true },
                            recall_mean: { type: 'number', format: 'float', nullable: true },
                            f1_mean: { type: 'number', format: 'float', nullable: true },
                            notes: { type: 'string', nullable: true },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Model-species record created successfully.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelSpecies' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // Unlike every wrapped-body domain ({ species: {...} }, etc.),
            // this route's body IS the model_species record directly.
            const data = await speciesController.createModelSpecies(req, res);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/model_species/:id',
        summary: 'Fetch a model_species record by id',
        description:
            "Returns a single model_species join record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the model_species record to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching model_species record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelSpecies' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getModelSpeciesById(req.params.id);

            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `ModelSpecies ${req.params.id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/model_species/:id',
        summary: 'Update an existing model_species record',
        description:
            "Updates an existing model_species join record by ID. The request body fields are used directly (unwrapped), matching the POST /model_species convention. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the model_species record to update.',
            },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelSpecies' } } },
        },
        responses: {
            200: {
                description: 'The updated model_species record, or null if no row matched the given ID.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/ModelSpecies' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.updateModelSpecies(req.params.id, req.body);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/model_species/:id',
        summary: 'Delete a model_species record',
        description:
            "Deletes a model_species join record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the model_species record to delete.',
            },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.deleteModelSpecies(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerSpeciesRoutes;
