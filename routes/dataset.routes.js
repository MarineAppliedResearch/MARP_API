/**
 * Machine-learning pipeline routes, registered code-first through the
 * OpenAPI route registry.
 *
 * Covers all 7 sub-resources backed by `controller/dataset.controller.js`:
 * ml_models, datasets, training_runs, metrics_summary, metrics_curves,
 * epochs, and dataset_observations. Kept in one file since they share a
 * single controller/service/repository boundary (the "MachineLearning"
 * domain).
 *
 * @fileoverview ML pipeline resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/dataset.routes
 */

const path = require('path');
const datasetController = require('../controller/dataset.controller');
const modelArtifactService = require('../service/model-artifact.service');
const datasetBuildRepository = require('../repository/dataset-build.repository');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/**
 * Register every ML-pipeline route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerDatasetRoutes(app) {
    // ---------------------------------------------------------------
    // ml_models
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/ml_models',
        summary: 'Fetch all ML models',
        description:
            "Returns every ML model record. A database failure rejects rather than resolving to an empty array; the route's .catch() handles this and responds with HTTP 500.",
        tags: ['V1 · MachineLearning'],
        responses: {
            200: {
                description: 'MlModel list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/MlModel' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getMl_models();
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/ml_models/:id/versions',
        summary: 'Fetch a model\'s version chain',
        description:
            'Returns every version in the chain the given model belongs to, oldest first. `ml_models` has no versions array -- a chain is `parent_model_id` and has to be walked -- and this walks up to the root and back down, so asking about any member returns the whole family. Its own route rather than part of the registry listing, so a caller that only wants the list does not pay for a self-join per row.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'Any model in the chain.' },
        ],
        responses: {
            200: {
                description: 'The version chain, oldest first.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/MlModel' } },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getModelVersions(req.params.id);

            // Empty means there is no such model, not a model with no versions:
            // a model is always in its own chain.
            if (!data.length) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `ML model ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'datasets:write',
        path: '/api/dataset/build',
        summary: 'Queue a dataset build from a mosaic query',
        description:
            'Builds a training dataset out of the observations MARP holds: selects them with the same filters the mosaic screens use, '
            + 'cuts the frames they point at from the video, writes YOLO labels, and packages one content-addressed archive that '
            + '`GET /gpu/datasets/:id/archive` can serve to a worker. **It also records what the dataset is made of** -- '
            + '`dataset_observations` and the ordered class vocabulary -- which nothing has ever written, so a dataset in MARP today '
            + 'says how many classes it has and cannot say which. '
            + '**Answers immediately with the dataset and the job**, because a real build cuts tens of thousands of frames and takes '
            + 'hours. Watch it on the job: it carries progress, it can be cancelled, and it appears on the Jobs screen like any other. '
            + 'The job is a `gpu_jobs` row of kind `dataset_build` that **the API runs rather than the pool** -- streaming the video to '
            + 'a worker so it can re-download it makes no sense, and workers deliberately have no video access. '
            + 'Observations with no keyframes or no species are left out: there is nothing to extract or no class to call it.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['name'],
                        properties: {
                            name: { type: 'string', example: 'CAMPA 2024 anemones v1' },
                            description: { type: 'string', nullable: true },
                            filters: { $ref: '#/components/schemas/MosaicQueryFilters' },
                            subsets: {
                                type: 'array',
                                description:
                                    'The builder is a union of queries, each sent to a split by the person assembling it. Sent in the '
                                    + 'order they were added, because that is what "first" means: an observation matched by two subsets '
                                    + 'belongs to the earlier one, and a connected frame group spanning two splits is pulled whole into '
                                    + 'the one its earliest member claimed. Use this **or** `filters`, not both.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        filters: { $ref: '#/components/schemas/MosaicQueryFilters' },
                                        split: { type: 'string', example: 'train' },
                                    },
                                },
                            },
                            image: {
                                type: 'object',
                                description:
                                    'How the frames are written. Defaults to JPEG at quality 95, which is what every dataset MARP '
                                    + 'has trained on and what the pretrained weights learned from -- and the source is H.264 video, '
                                    + 'which has already discarded more than JPEG does. Measured on the same 219 frames, PNG was 1,690 KB '
                                    + 'each against 246 KB at quality 90, which at 50,000 frames is about 85 GB against about 20 GB. '
                                    + '**Switchable because it is a judgement, not a law**: ask for `png` if lossless frames turn out to '
                                    + 'matter. PNG takes no quality and saying both is refused rather than ignored.',
                                properties: {
                                    format: { type: 'string', enum: ['jpeg', 'png'], example: 'jpeg' },
                                    quality: { type: 'integer', minimum: 1, maximum: 100, example: 95 },
                                },
                            },
                            splits: {
                                type: 'object',
                                description:
                                    'Shares, normalised here, keyed by split name. The archive carries `train` and `eval`, which is '
                                    + 'the shape the worker already trains on. Whole connected groups of observations are placed '
                                    + 'together, so a frame holding two animals cannot land in both.',
                                example: { train: 0.8, eval: 0.2 },
                                additionalProperties: { type: 'number' },
                            },
                        },
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'The dataset row, and the job that will build it.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                dataset: { $ref: '#/components/schemas/Dataset' },
                                job: { $ref: '#/components/schemas/GpuJob' },
                            },
                        },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const { name, description, filters, splits, subsets, image } = req.body || {};

            if (!name || !String(name).trim()) {
                throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A dataset name is required.');
            }

            /* A service client can queue a build; only a person is recorded as having
               asked for it, the same way every other `created_by` here works. */
            const createdBy = req.principal && req.principal.type === 'user' ? req.principal.id : null;

            const queued = await datasetBuildRepository.queueBuild({
                name: String(name).trim(),
                description: description ? String(description) : null,
                filters: filters || {},
                subsets: Array.isArray(subsets) && subsets.length ? subsets : null,
                image: image || null,
                splits,
                createdBy,
            });

            res.status(201).json(queued);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/ml_models/:id/species',
        summary: 'Fetch the species a model can detect',
        description:
            '`model_species` has mapped models to species since the schema was written and nothing served it, so a client choosing '
            + 'which classes to run had to be told the list rather than ask for it. Joined to `species` rather than returning the '
            + 'linkage rows, because a `species_id` is not something a person can pick from; `species_list` comes too, since a common '
            + 'name identifies an organism only within its list and a model spanning two can otherwise offer one label twice. '
            + 'The per-species training figures on the linkage ride along free from the same row, and they are what makes the list '
            + 'worth reading: a class the model recalls poorly is one somebody may want to leave out of a run. '
            + '**An empty array is a real answer** -- a registered model nothing has mapped yet -- and is not a 404.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'The model.' },
        ],
        responses: {
            200: {
                description: 'The species, by common name.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/ModelSpeciesClass' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            res.json(await datasetController.getModelSpecies(req.params.id));
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'jobs:execute',
        path: '/api/model/:id/artifact',
        summary: 'Download registered model weights',
        description: 'Streams the artifact registered for an ML model from API-owned local storage. The host filesystem path is never returned.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the registered ML model.' },
        ],
        responses: {
            200: {
                description: 'The registered model artifact.',
                content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const artifact = await modelArtifactService.resolveArtifact(req.params.id);
            if (!artifact) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Model artifact ${req.params.id} was not found.`);
            }

            res.type('application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${path.basename(artifact.path).replace(/"/g, '')}"`);
            await new Promise((resolve, reject) => {
                res.sendFile(artifact.path, (error) => error ? reject(error) : resolve());
            });
        }),
    });

    // ---------------------------------------------------------------
    // datasets
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset',
        summary: 'Fetch all datasets',
        description:
            'Returns every dataset record. Database errors are swallowed and resolve to an empty array, so an empty result doesn\'t distinguish "no datasets" from "query failed."',
        tags: ['V1 · MachineLearning'],
        responses: {
            200: {
                description: 'Dataset list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Dataset' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getDatasets();
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/:id',
        summary: 'Fetch a dataset by id',
        description:
            "Returns a single dataset record, or null if not found. Unlike getDatasets, a database error here does actually reject/throw, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching dataset record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Dataset' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getDatasetById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Dataset ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'datasets:write',
        path: '/api/dataset/:id',
        summary: 'Update an existing dataset',
        description:
            "Updates an existing dataset record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DatasetUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated dataset record, or null if no dataset matched the given ID.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Dataset' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.updateDataset(req.params.id, req.body.dataset);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'datasets:write',
        path: '/api/dataset/:id',
        summary: 'Delete a dataset',
        description:
            "Deletes a dataset record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteDataset(req.params.id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'datasets:write',
        path: '/api/dataset',
        summary: 'Create a new dataset',
        description:
            "Creates a new dataset record. CRITICAL: a database failure here resolves to null rather than rejecting, so the route's .catch() handler is effectively dead code — a failed insert currently still responds with HTTP 200 and a null body rather than an error status.",
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DatasetCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created dataset record, or null if the insert failed (see description; the failure still returns HTTP 200).',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Dataset' }, { type: 'null' }] },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await datasetController.createDataset(req.body.dataset);
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // ml_models write routes (model_id-keyed, distinct from GET /api/ml_models above)
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'models:write',
        path: '/api/model',
        summary: 'Create a new ML model',
        description: 'Creates a new ML model record. Has a real .catch() handler that responds with HTTP 500 on failure.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MlModelCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created MlModel record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MlModel' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            console.log('[API] POST /api/model', req.body);
            const data = await datasetController.createModel(req.body.model);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'models:write',
        path: '/api/model/:id',
        summary: 'Update an existing ML model',
        description:
            'Updates an existing ML model record by id. Returns the updated MlModel, or null if no row matched the given id (logged as a warning rather than an error in that case).',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the ML model to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MlModelUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated MlModel record, or null if no row matched.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/MlModel' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(`[API] PUT /api/model/${req.params.id}`, req.body);
            const data = await datasetController.updateModel(req.params.id, req.body.model);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/model/:id',
        summary: 'Fetch an ML model by id',
        description:
            "Returns a single ML model record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the ML model to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching MlModel record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MlModel' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getModelById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `MlModel ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'models:write',
        path: '/api/model/:id',
        summary: 'Delete an ML model',
        description:
            "Deletes an ML model record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case. Deleting a model cascades to delete its training_runs (see model/ml_models.model.js).",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the ML model to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteModel(req.params.id);
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // training_runs
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run',
        summary: 'Fetch training runs',
        description:
            'Returns training runs, newest first, optionally narrowed to one model. This collection read did not exist: a run could be created and fetched by id and never found, so no screen could show a training history at all.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'query', name: 'model_id', required: false, schema: { type: 'integer' }, description: 'Only runs that produced this model.' },
        ],
        responses: {
            200: {
                description: 'TrainingRun list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/TrainingRun' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getTrainingRuns({ modelId: req.query.model_id });
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'models:write',
        path: '/api/training_run',
        summary: 'Create a new training run',
        description: 'Creates a new training run record.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TrainingRunCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created TrainingRun record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TrainingRun' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await datasetController.createTrainingRun(req.body.training_run);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'models:write',
        path: '/api/training_run/:id',
        summary: 'Update an existing training run',
        description: 'Updates an existing training run record by id. Returns the updated TrainingRun, or null if no row matched.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the training run to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TrainingRunUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated TrainingRun record, or null if no row matched.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/TrainingRun' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const id = req.params.id;
            const data = await datasetController.updateTrainingRun(id, req.body.training_run);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run/:id',
        summary: 'Fetch a training run by id',
        description:
            "Returns a single training run record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the training run to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching TrainingRun record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TrainingRun' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getTrainingRunById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `TrainingRun ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'models:write',
        path: '/api/training_run/:id',
        summary: 'Delete a training run',
        description:
            "Deletes a training run record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case. Deleting a training run cascades to delete its epochs, metrics_summary, hyperparameters, and artifacts (see model/training_runs.model.js).",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the training run to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteTrainingRun(req.params.id);
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // metrics_summary
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'models:write',
        path: '/api/metrics_summary',
        summary: 'Create a new metrics summary',
        description: 'Creates a new metrics_summary record for a training run and dataset split.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsSummaryCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created MetricsSummary record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsSummary' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.createMetricsSummary(req.body.metrics_summary);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/metrics_summary/:id',
        summary: 'Fetch a metrics_summary by id',
        description:
            "Returns a single metrics_summary record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the metrics_summary to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching MetricsSummary record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsSummary' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getMetricsSummaryById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `MetricsSummary ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'models:write',
        path: '/api/metrics_summary/:id',
        summary: 'Update an existing metrics_summary',
        description:
            "Updates an existing metrics_summary record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the metrics_summary to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsSummaryUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated metrics_summary record, or null if no row matched the given ID.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/MetricsSummary' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.updateMetricsSummary(req.params.id, req.body.metrics_summary);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'models:write',
        path: '/api/metrics_summary/:id',
        summary: 'Delete a metrics_summary',
        description:
            "Deletes a metrics_summary record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case. Deleting a metrics_summary cascades to delete its metrics_curves (see model/metrics_summary.model.js).",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the metrics_summary to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteMetricsSummary(req.params.id);
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // metrics_curves
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'models:write',
        path: '/api/metrics_curve',
        summary: 'Create a single metrics curve point',
        description: 'Creates a single metrics_curve point tied to a metrics_summary record.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsCurveCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created MetricsCurve record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsCurve' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.createMetricsCurve(req.body.metrics_curve);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/metrics_curve/:id',
        summary: 'Fetch a metrics_curve by id',
        description:
            "Returns a single metrics_curve record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the metrics_curve to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching MetricsCurve record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsCurve' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getMetricsCurveById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `MetricsCurve ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'models:write',
        path: '/api/metrics_curve/:id',
        summary: 'Update an existing metrics_curve',
        description:
            "Updates an existing metrics_curve record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the metrics_curve to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsCurveUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated metrics_curve record, or null if no row matched the given ID.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/MetricsCurve' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.updateMetricsCurve(req.params.id, req.body.metrics_curve);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'models:write',
        path: '/api/metrics_curve/:id',
        summary: 'Delete a metrics_curve',
        description:
            "Deletes a metrics_curve record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the metrics_curve to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteMetricsCurve(req.params.id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'models:write',
        path: '/api/metrics_curves/bulk',
        summary: 'Bulk-create metrics curve records',
        description:
            "Bulk-inserts metrics_curve records. CRITICAL: unlike every sibling create/bulk route, this method takes the raw Express req/res directly rather than an already-extracted body field — the request body must be a raw JSON array of MetricsCurve fields (req.body itself is passed straight to Sequelize's bulkCreate). CRITICAL: on a database failure this resolves to { error: err.message } at HTTP 200 rather than rejecting or returning a non-200 status; the route has no .catch() at all.",
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/MetricsCurve' } },
                },
            },
        },
        responses: {
            200: {
                description: 'On success, an { inserted: number } summary object (not the created records).',
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: { inserted: { type: 'integer' } } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // Unlike every other domain's bulk/create route, this one passes
            // req/res straight into the controller rather than an extracted
            // body field -- see description above.
            const data = await datasetController.bulkCreateMetricsCurves(req, res);
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // epochs
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'models:write',
        path: '/api/epoch',
        summary: 'Create a new epoch record',
        description: 'Creates a new epoch record for a training run.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EpochCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created Epoch record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Epoch' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await datasetController.createEpoch(req.body.epoch);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'models:write',
        path: '/api/epoch/:id',
        summary: 'Update an existing epoch record',
        description: 'Updates an existing epoch record by id. Returns the updated Epoch, or null if no row matched.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the epoch to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EpochUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated Epoch record, or null if no row matched.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Epoch' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const id = req.params.id;
            const data = await datasetController.updateEpoch(id, req.body.epoch);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/epoch/:id',
        summary: 'Fetch an epoch by id',
        description:
            "Returns a single epoch record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the epoch to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching Epoch record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Epoch' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getEpochById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Epoch ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'models:write',
        path: '/api/epoch/:id',
        summary: 'Delete an epoch',
        description:
            "Deletes an epoch record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the epoch to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteEpoch(req.params.id);
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // dataset_observations
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'datasets:write',
        path: '/api/dataset_observation',
        summary: 'Create a new dataset-observation link',
        description: 'Creates a new dataset_observation join record linking a dataset to an observation.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DatasetObservationCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created DatasetObservation record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/DatasetObservation' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await datasetController.createDatasetObservation(req.body.dataset_observation);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset_observation/:id',
        summary: 'Fetch a dataset_observation by id',
        description:
            "Returns a single dataset_observation record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset_observation to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching DatasetObservation record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/DatasetObservation' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.getDatasetObservationById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `DatasetObservation ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'datasets:write',
        path: '/api/dataset_observation/:id',
        summary: 'Update an existing dataset_observation',
        description:
            "Updates an existing dataset_observation record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset_observation to update.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DatasetObservationUpdateRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated dataset_observation record, or null if no row matched the given ID.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/DatasetObservation' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.updateDatasetObservation(req.params.id, req.body.dataset_observation);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'datasets:write',
        path: '/api/dataset_observation/:id',
        summary: 'Delete a dataset_observation',
        description:
            "Deletes a dataset_observation record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset_observation to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await datasetController.deleteDatasetObservation(req.params.id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'datasets:write',
        path: '/api/dataset_observations/bulk',
        summary: 'Bulk-create dataset-observation links',
        description:
            'Bulk-inserts dataset_observation records. The response (per the route code) is { inserted: <count> }, NOT the created records. Uses ignoreDuplicates: true internally, which may not reliably suppress unique-constraint errors on Postgres depending on Sequelize version, so a 500 is still possible on duplicate observation_id values despite the flag.',
        tags: ['V1 · MachineLearning'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['dataset_observations'],
                        properties: {
                            dataset_observations: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/DatasetObservation' },
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'An { inserted: number } summary object rather than the created records.',
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: { inserted: { type: 'integer' } } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(`[INFO] Bulk insert ${req.body.dataset_observations?.length || 0} dataset_observations`);
            const data = await datasetController.bulkCreateDatasetObservations(req.body.dataset_observations);
            res.json({ inserted: data.length });
        }),
    });
}

module.exports = registerDatasetRoutes;
