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
const fs = require('fs');

const { DATASET_DIRECTORY } = require('../config/gpu-orchestration');
const datasetController = require('../controller/dataset.controller');
const trainingMetricsController = require('../controller/training-metrics.controller');
const modelArtifactService = require('../service/model-artifact.service');
const datasetBuildRepository = require('../repository/dataset-build.repository');
const { imageSettings, concurrency } = require('../service/dataset-build.service');
const datasetRepository = require('../repository/dataset.repository');
const datasetPreviewService = require('../service/dataset-preview.service');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/** A blank line between paragraphs of a route description. */
const BREAK = '\n\n';

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
                                        split: {
                                            type: 'string',
                                            example: 'train',
                                            description: 'Send the whole subset to one split. Use this **or** `shares`.',
                                        },
                                        shares: {
                                            type: 'object',
                                            description:
                                                'Divide this subset across splits in these proportions, normalised, rather than '
                                                + 'sending it to one. Measured in frames, and each species is divided separately so '
                                                + 'a rare one reaches every split. Whole connected groups move together, so a '
                                                + 'near-duplicate picture cannot land in two.',
                                            example: { train: 70, validation: 20, test: 10 },
                                            additionalProperties: { type: 'number' },
                                        },
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

            /* **Settled here, not minutes later in the runner.** `imageSettings` is what
               the build calls before it cuts anything, and it throws the useful message
               for an unknown format, a quality out of range, and png asked for with a
               quality. Calling it at the route turns all three into a 400 on the request
               that made the mistake -- without it, `{"format":"webp"}` answered 201, left
               a dataset row saying `building`, and then failed in a job the asker had to
               go and find. The thrown text is the message, because it already names the
               mistake and what is allowed.

               Only the format is settled here. Everything else the spec carries is about
               which observations to select, and that is a question the build has to run
               to answer. */
            if (image !== undefined && image !== null) {
                try {
                    imageSettings(image);
                } catch (error) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
                }
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

    /*
     * **Registered before `/api/dataset/:id`, and that is load-bearing.** Express matches
     * in registration order, so after it this path is a dataset whose id is the word
     * "builds" -- which reaches `findByPk('builds')` and comes back a 500 about an integer.
     */
    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/builds',
        summary: 'Fetch the dataset builds that are still running',
        description:
            'How far every dataset build in flight has got: frames done against total, and which phase it is in. '
            + '**A route of its own rather than a field on `GET /api/dataset`**, for three reasons. The progress is not a property '
            + 'of a dataset -- it belongs to the latest attempt of the `dataset_build` job building it, and what the dataset itself '
            + 'records is `status`, plus `num_samples` once the build finishes. the `Dataset` schema is generated from the Sequelize '
            + 'model, so a `build` object on the row could not be described without a hand-maintained parallel schema. And this is '
            + 'the route a screen polls: `GET /api/dataset` is unpaged and grows without bound, while this answers only about work '
            + 'in flight rather than every dataset. '
            + '**A build that failed is carried too, with its `failure_reason`**, because the Datasets screen draws one as '
            + '*Needs attention* and could otherwise only say that something had gone wrong. A screen therefore watches for '
            + 'a row whose state is `queued` or `leased` rather than for a non-empty answer: a failed build stays failed. '
            + '**`queued` is returned as well as `leased`**, without an attempt and so without progress: `datasets.status` is '
            + '`building` from the instant a build is queued, so the dataset alone cannot distinguish waiting from started. '
            + 'At most one row per dataset, newest job first.',
        tags: ['V1 · MachineLearning'],
        responses: {
            200: {
                description: 'Every build that is queued or running, at most one per dataset.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    dataset_id: { type: 'integer', description: 'The dataset being built.' },
                                    job_id: { type: 'integer', description: 'The `dataset_build` job, on the Jobs screen like any other.' },
                                    state: {
                                        type: 'string',
                                        enum: ['queued', 'leased', 'failed', 'cancelled'],
                                        description: '`queued` is waiting to start and has no attempt; `leased` is running; '
                                            + '`failed` and `cancelled` are over, and are here for their reason.',
                                    },
                                    attempts_made: { type: 'integer' },
                                    max_attempts: { type: 'integer' },
                                    queued_at: { type: 'string', format: 'date-time' },
                                    attempt_id: { type: 'integer', nullable: true, description: 'Null while the build is still queued.' },
                                    progress_done: {
                                        type: 'integer',
                                        nullable: true,
                                        description: 'Frames written so far. Null until the extracting phase begins, which is not the same as zero.',
                                    },
                                    progress_total: {
                                        type: 'integer',
                                        nullable: true,
                                        description: 'Frames the build intends to cut. Not known until selection finishes, which on a large query is minutes.',
                                    },
                                    progress_unit: { type: 'string', nullable: true, example: 'frames' },
                                    progress_phase: {
                                        type: 'string',
                                        nullable: true,
                                        enum: ['selecting', 'extracting', 'packaging'],
                                        description: 'What it is doing. A build sits in `selecting` with no counts at all, so a reader seeing no number needs this to tell waiting from stuck.',
                                    },
                                    started_at: { type: 'string', format: 'date-time', nullable: true },
                                    last_heartbeat_at: { type: 'string', format: 'date-time', nullable: true },
                                    failure_reason: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'Why the build stopped, as the runner recorded it. Null while it is still going.',
                                        example: 'train/images/20240727_163021_Fwd_00029982.jpg: unable to open for write',
                                    },
                                },
                            },
                        },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            res.json(await datasetRepository.getBuildsInFlight());
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/:id/composition',
        summary: 'What a dataset is made of: its splits and its classes',
        description:
            'Counts of included observations per split, and the ordered class vocabulary. Both have been recorded since '
            + '#268 -- `dataset_observations` holds a row per included observation and `dataset_classes` the vocabulary a '
            + 'label index refers to -- and neither was served, so the Datasets screen drew a split bar hardcoded to '
            + '70/20/10 and a class breakdown keyed on five invented dataset names. '
            + '**The split is `inclusion_type`.** That column predates the build path and its name is about why an '
            + 'observation is in a dataset; the builder writes the split name into it, which is the name `data.yaml` uses. '
            + 'Counted now rather than taken from `num_observations`, which is what was recorded at build time: membership '
            + 'can lose rows to the observation cascade, and the two disagreeing is a fact worth being able to see.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'The dataset.' },
        ],
        responses: {
            200: {
                description: 'Its splits and its classes. Both arrays are empty for a dataset built before membership was recorded.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                splits: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            split: { type: 'string', example: 'train' },
                                            observations: { type: 'integer', example: 49 },
                                        },
                                    },
                                },
                                classes: {
                                    type: 'array',
                                    description: 'In class-index order, which is the order a YOLO label file indexes.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            class_index: { type: 'integer', example: 0 },
                                            species_id: { type: 'integer', nullable: true },
                                            comname: { type: 'string', nullable: true, example: 'California sea cucumber' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            /* The dataset has to exist: empty arrays for a real dataset mean "built before
               membership was recorded", and the same answer for a dataset that is not
               there would make a typo look like an old build. */
            const dataset = await datasetController.getDatasetById(req.params.id);

            if (!dataset) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Dataset ${req.params.id} was not found.`);
            }

            /* Images per split come off `dataset_splits`, which the build writes.
               They were counted out of the archive here until Isaac pointed out the
               obvious: the archive is immutable, so the count cannot change after the
               build, and walking a 2.4 GB tar on every panel open is paying repeatedly to
               re-derive a constant. Null for a dataset built before that was recorded,
               which the screen says rather than showing a zero. */
            const composition = await datasetRepository.getDatasetComposition(req.params.id);

            res.json(composition);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/build-queue',
        summary: 'The builds waiting, in the order they will run',
        description:
            'The builds waiting to be taken, in the order they will be taken, and how many of them start together.'
            + '\n\n'
            + '**The order was already real and was nowhere on screen.** `claimBuild` selects '
            + 'ORDER BY priority DESC, created_at ASC, id ASC, so the queue has always been a priority queue -- '
            + 'but nothing served the priority and the Datasets table sorts newest-first, which is the reverse of '
            + 'claim order within a priority. Reorder buttons without this would have moved something invisible.'
            + '\n\n'
            + '**`starts_next` is a set, not a single row.** Builds run `DATASET_BUILD_CONCURRENCY` at a time, so '
            + 'the first few in the queue all begin on the next tick and there is no one next job. This marks '
            + 'exactly those that would start now -- the ceiling less whatever is already running -- so the screen '
            + 'can say so rather than implying a single front of the queue.'
            + '\n\n'
            + '**Only `dataset_build`.** `priority` is a `gpu_jobs` column and the worker pool orders its own '
            + 'queue by it, but `LEASABLE_JOB_KINDS` excludes dataset builds, so the two queues are disjoint and '
            + 'nothing here can reorder inference work.',
        tags: ['V1 \u00b7 MachineLearning'],
        responses: {
            200: {
                description: 'The queue, first to run first.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                concurrency: { type: 'integer', description: 'How many builds run at once.' },
                                running: { type: 'integer', description: 'How many are running right now.' },
                                queue: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            job_id: { type: 'integer' },
                                            dataset_id: { type: 'integer' },
                                            name: { type: 'string', nullable: true },
                                            priority: { type: 'integer' },
                                            position: { type: 'integer', description: '1 is next.' },
                                            starts_next: {
                                                type: 'boolean',
                                                description: 'It would begin on the next tick, as a free slot allows.',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const [queue, inFlight] = await Promise.all([
                datasetBuildRepository.getQueuedBuilds(),
                datasetBuildRepository.countRunningBuilds(),
            ]);

            const ceiling = concurrency();
            /* Slots a build could start into right now. When builds are already running
               the front of the queue is shorter than the ceiling, and saying otherwise
               would promise several starts that cannot happen yet. */
            const free = Math.max(0, ceiling - inFlight);

            res.json({
                concurrency: ceiling,
                running: inFlight,
                queue: queue.map((row, index) => ({
                    ...row,
                    position: index + 1,
                    starts_next: index < free,
                })),
            });
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/dataset/build-queue/:jobId/move',
        summary: 'Move a queued build sooner or later',
        description:
            'Moves one queued build one place sooner or later.'
            + '\n\n'
            + '**The whole queue is renumbered, which is what keeps the numbers sane.** Swapping priorities with a '
            + 'neighbour does nothing: every build is priority 0 until something changes it, so the swap is 0 for 0 '
            + 'and `created_at` still decides. Giving the moved job max + 1 works once and then climbs for ever. '
            + 'Writing positions N..1 across the queued set on each move leaves no ties, bounds the largest value '
            + 'by the length of the queue, and needs no compaction later.'
            + '\n\n'
            + '**Moving past either end is not an error.** Pressing up on the first row is a reasonable thing to '
            + 'do; the answer is `moved: false` and the queue unchanged.'
            + '\n\n'
            + '**Only a queued build can move**, because a leased one is already running and reordering it means '
            + 'nothing. Gated on `jobs:write`, the human job-management permission that `POST /gpu/jobs/:id/cancel` '
            + 'uses, rather than the `jobs:execute` a worker holds.',
        tags: ['V1 \u00b7 MachineLearning'],
        parameters: [
            { in: 'path', name: 'jobId', required: true, schema: { type: 'integer' }, description: 'The queued build.' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['direction'],
                        properties: { direction: { type: 'string', enum: ['up', 'down'] } },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The queue after the move.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                moved: { type: 'boolean', description: 'False when it was already at that end.' },
                                queue: { type: 'array', items: { type: 'object' } },
                            },
                        },
                    },
                },
            },
            400: { $ref: '#/components/responses/ValidationError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            res.json(await datasetBuildRepository.moveQueuedBuild(
                req.params.jobId,
                req.body && req.body.direction
            ));
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/:id/build-setup',
        summary: 'The queries a dataset was built from, for setting up another like it',
        description:
            'What *Duplicate setup* needs: the subsets, filters and split shares a dataset was built from, so the '
            + 'build flow can be filled in with them and edited before anything is queued.\n\n'
            + '**It creates nothing.** No dataset, no draft, no job -- this reads, the screen fills its form, and '
            + 'the ordinary Queue button is what starts a build.\n\n'
            + '**The spec lives on the job, not the dataset**, which is why this route exists at all. `queueBuild` '
            + 'writes the filters into `gpu_jobs.spec` on purpose: a saved query can be edited afterwards and a '
            + "build has to stay a record of what it actually ran. The job is found by `spec->>'dataset_id'`.\n\n"
            + '**The succeeded job wins when a dataset has several**, which is normal -- a retry opens a second, and '
            + 'a cancelled attempt followed by a successful one leaves two. The succeeded one is the only spec known '
            + 'to have produced this dataset. Failing that, the newest, so a dataset still building can be copied.\n\n'
            + '**404 when there is nothing worth copying.** A dataset imported by the legacy packager has no job at '
            + 'all, and a dashboard build can carry `filters: {}` with everything in `subsets`. A Duplicate that '
            + 'opened an empty build flow would look like it had worked, so the screen is told there is nothing and '
            + 'leaves the control disabled with the reason on it.',
        tags: ['V1 \u00b7 MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'The dataset to copy.' },
        ],
        responses: {
            200: {
                description: 'Its setup.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                jobId: { type: 'integer', description: 'Which build this came from.' },
                                name: { type: 'string' },
                                description: { type: 'string', nullable: true },
                                subsets: {
                                    type: 'array',
                                    description: 'Each a query and where it goes: `filters` plus either `shares` or `split`.',
                                    items: { type: 'object' },
                                },
                                filters: {
                                    type: 'object',
                                    nullable: true,
                                    description: 'A build that named filters without subsets. Null when it used subsets.',
                                },
                                splits: { type: 'object', nullable: true },
                                image: { type: 'object', nullable: true },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const setup = await datasetBuildRepository.getBuildSetup(req.params.id);

            if (!setup) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Dataset ${req.params.id} has no recorded queries to copy. It was imported rather than built here, `
                    + 'or its build predates the queries being kept.');
            }

            res.json(setup);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/:id/preview',
        summary: 'A sample of the frames a build cut, with their label boxes',
        description:
            'A handful of the actual training images in a dataset, read straight out of the archive the build '
            + 'wrote. The Datasets screen showed four sample pictures per dataset and they were four hardcoded '
            + 'Jellyfin item ids -- the same four on every row, of video unrelated to the dataset under them.\n\n'
            + '**The boxes come back with the frames**, as the YOLO label file records them: `class_index` into '
            + "the vocabulary `GET /dataset/:id/composition` returns, and `cx`/`cy`/`w`/`h` normalised to the "
            + 'image with **x and y at the box centre**. Drawing them is the point -- a frame on its own says a '
            + 'picture was cut, and a frame with its box says the label landed on the animal.\n\n'
            + '**Read rather than stored.** The archive is an uncompressed tar, so a sample costs a walk of its '
            + 'headers -- one 512-byte read per member, about 140 ms over a 2.4 GB archive -- plus one read per '
            + 'frame shown. Nothing is written at build time to make this work, so it answers for datasets that '
            + 'were built before it existed.\n\n'
            + '**The frames are spread across the archive, not taken from the front.** A build interpolates '
            + 'between keyframes, so the first dozen images are one animal a fortieth of a second apart; an even '
            + 'stride covers the videos and splits the build actually touched, for the same walk.\n\n'
            + 'Gated on `datasets:read` rather than the `jobs:execute` that guards the whole archive: this is '
            + 'somebody browsing the catalogue, which is the case that permission exists for, and it serves a '
            + 'sample rather than the dataset.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'The dataset.' },
            {
                in: 'query',
                name: 'limit',
                required: false,
                schema: { type: 'integer', default: datasetPreviewService.DEFAULT_LIMIT, maximum: datasetPreviewService.MAX_LIMIT },
                description: 'How many frames to sample. Clamped, because each one is served at full size.',
            },
        ],
        responses: {
            200: {
                description: 'The sample.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                sha256: { type: 'string', description: "The archive's hash, which is also its address." },
                                total: {
                                    type: 'integer',
                                    example: 10361,
                                    description: 'Every image in the archive, not how many are shown, so a reader knows what the sample is a sample of.',
                                },
                                frames: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            index: { type: 'integer', description: 'Its address for `GET /dataset/:id/preview/:index`.' },
                                            split: { type: 'string', example: 'train' },
                                            stem: {
                                                type: 'string',
                                                example: '20240727_163021_Fwd_00029982',
                                                description: 'The video it came from and the absolute frame number in it.',
                                            },
                                            bytes: { type: 'integer' },
                                            boxes: {
                                                type: 'array',
                                                description: 'Empty when the archive carries no label beside the frame, which is a fact about the build rather than an error.',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        class_index: { type: 'integer', example: 2 },
                                                        cx: { type: 'number', example: 0.234120 },
                                                        cy: { type: 'number', example: 0.095045 },
                                                        w: { type: 'number', example: 0.052060 },
                                                        h: { type: 'number', example: 0.094724 },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            res.json(await datasetPreviewService.preview(req.params.id, req.query.limit));
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'datasets:read',
        path: '/api/dataset/:id/preview/:index',
        summary: 'One frame of a dataset preview',
        description:
            'The image bytes for one entry of `GET /dataset/:id/preview`, cut out of the archive at the offset '
            + 'its tar header records.\n\n'
            + '**Addressed by position in the sample, not by filename.** The archive is named for its own hash '
            + 'and never changes, so a walk of it returns the same order every time and a position is a stable '
            + 'address. A filename from the caller would be a caller-supplied path reaching a file read, which '
            + 'is a shape worth not having.\n\n'
            + '`limit` must match the one the sample was taken with, because it is what the positions are '
            + 'relative to.\n\n'
            + '**Cached hard and deliberately.** The response carries a strong ETag of the archive hash and the '
            + "position, and `immutable`, because those bytes cannot change: a re-packaged dataset is a "
            + 'different hash. A reader fetches each preview frame once.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'The dataset.' },
            { in: 'path', name: 'index', required: true, schema: { type: 'integer' }, description: 'Which frame of the sample.' },
            {
                in: 'query',
                name: 'limit',
                required: false,
                schema: { type: 'integer', default: datasetPreviewService.DEFAULT_LIMIT },
                description: 'The sample size the index was taken against.',
            },
        ],
        responses: {
            200: {
                description: 'The frame.',
                content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const frame = await datasetPreviewService.frame(req.params.id, req.params.index, req.query.limit);
            const etag = `"dataset-preview-${frame.sha256}-${req.params.index}"`;

            if (req.headers['if-none-match'] === etag) {
                res.status(304).end();

                return;
            }

            res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
            res.setHeader('Content-Type', frame.contentType);
            res.setHeader('Content-Length', frame.buffer.length);
            res.send(frame.buffer);
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
        summary: 'Delete a dataset, its membership and its archive',
        description:
            'Deletes everything the dataset is -- the row, its membership and its class vocabulary -- and removes '
            + 'the archive from storage.\n\n'
            + "**It refuses if a model was trained from it.** That is the schema's own rule rather than one added "
            + 'here: `dataset_observations` and `dataset_classes` are `ON DELETE CASCADE`, while '
            + '`training_runs.dataset_id` is `NO ACTION` and PostgreSQL blocks the delete while a run points at the '
            + 'row. A dataset is the answer to *what was this model trained on*, so that is the guard working. The '
            + 'runs are looked up first so the refusal is a 409 naming the model that was trained, rather than a '
            + 'foreign-key violation arriving as a 500 -- which is what this route did until #268.\n\n'
            + '**A dataset that is still building is refused too**, and asks for the build to be cancelled first. '
            + 'There is a runner holding a staging directory and about to write that row; deleting underneath it '
            + 'turns its own completion into the error. Cancelling is one press and takes effect within a pass.\n\n'
            + '**The row goes first and the file only once that succeeded.** A refused delete must leave the archive '
            + 'where it was, and a dataset whose archive is gone but whose row survives is worse than either '
            + 'outcome. Removing the file was not done at all before, so a deleted dataset left gigabytes behind. A '
            + 'file that is already missing is not an error -- the row is what is being deleted.\n\n'
            + '**The build job goes too, with its attempts, their events and their progress samples.** It used to '
            + 'survive, as the record that the work happened, and Isaac objected twice: a build job for a dataset '
            + 'nobody can see is not a record anyone can use, and he met it again on the Jobs screen after deleting '
            + 'the dataset here. There is no foreign key -- the job names its dataset in its spec -- so '
            + 'this is a deliberate lookup. The attempts cascade from the job and the events and progress samples '
            + 'cascade from the attempt.' + BREAK
            + '**A job holding an artifact refuses, and the dataset still goes.** `artifacts.job_id` is `RESTRICT`. '
            + 'Failing the whole delete over a job row the caller cannot see would be the same complaint again, so '
            + 'the refusal is reported in `jobs_kept` instead.' + BREAK
            + 'Older text, kept because the reasoning is still worth reading: a job is the record that work happened -- its attempt, its '
            + 'failure reason, its timings, and the spec that is the only record of what was asked for -- and '
            + 'nothing references the dataset by a foreign key, so nothing cascades. **They are excluded from '
            + '`GET /dataset/builds` by a join rather than by hope:** this description previously claimed they '
            + '"simply stop appearing", and they did not. Three such rows were being served on the development '
            + 'database, '
            + 'and a build row for a dataset nobody can open, expand or delete is a row for nothing. They remain '
            + 'visible on the Jobs screen, which is where a record of work belongs.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the dataset to delete.' },
        ],
        responses: {
            200: {
                description: 'It is gone.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                deleted: { type: 'boolean' },
                                archive_removed: {
                                    type: 'boolean',
                                    description: 'False when the row named no archive, or the file was already absent.',
                                },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            409: {
                description: 'A model was trained from it, or it is still building. The message says which.',
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const { deleted, archivePath, jobsDeleted, jobsKept } = await datasetBuildRepository.deleteDataset(req.params.id);

            /* **Only now.** Everything that could refuse has refused and the row is gone,
               so removing the file can no longer orphan a dataset that still exists. */
            let archiveRemoved = false;

            if (deleted && archivePath) {
                const storageRoot = path.resolve(DATASET_DIRECTORY, '..');
                const absolute = path.resolve(storageRoot, archivePath);

                /* `archive_path` is our own value, but it is a database value becoming a
                   filesystem path, which is the shape of a traversal bug -- and this one
                   unlinks rather than reads. Checked the way the archive route checks it. */
                if (absolute.startsWith(storageRoot + path.sep) && fs.existsSync(absolute)) {
                    /* **The row is already gone, so this must not throw.** An archive
                       held open -- by a worker still streaming it, or by anything else on
                       Windows -- would otherwise answer 500 for a delete that had
                       succeeded, and the caller would retry and get a 404. The file
                       staying behind is reported rather than hidden: `archive_removed`
                       false means there is something left on disk, which is a different
                       outcome from the row having named no archive at all. */
                    try {
                        fs.rmSync(absolute, { force: true });
                        archiveRemoved = true;
                    } catch (error) {
                        archiveRemoved = false;
                    }
                }
            }

            res.json({
                deleted,
                archive_removed: archiveRemoved,
                /* Which build jobs went with it, and which would not. A job holding an
                   artifact refuses, and the dataset still goes -- the caller asked to
                   remove a dataset, and failing that over a job row they cannot see is
                   the complaint this change exists to answer, in a new form. */
                jobs_deleted: jobsDeleted,
                jobs_kept: jobsKept,
            });
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
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run/:id/pace',
        summary: 'How fast one training run has been getting through its epochs',
        description:
            'The heartbeat\'s record of how many epochs were done, sampled once a minute for as '
            + 'long as the run\'s attempt held its lease.'
            + BREAK
            + '**This is the clock; `/training_run/:id/epochs` is the science.** An epoch row is '
            + 'written when the worker reports its metrics, so that array has one entry per '
            + 'finished epoch and nothing at all before the first one lands. These samples start '
            + 'when the attempt is leased, which covers the stretch where the dataset is being '
            + 'fetched and nothing has trained yet -- exactly when a reader most wants to see '
            + 'that the run is alive. Neither answers for the other, so they are two reads.'
            + BREAK
            + '**Every attempt of the job, each sample saying which.** A run that was retried has '
            + 'a second attempt counting from zero again, and dropping it would leave a step down '
            + 'in the series that nothing explains.'
            + BREAK
            + '**Nothing is derived.** Epochs per minute and a remaining estimate both come out of '
            + 'these samples; computing them here would mean choosing a window and a rounding on '
            + 'the reader\'s behalf.'
            + BREAK
            + '**An empty array is the honest answer** for a run whose attempt has not reported a '
            + 'heartbeat yet. A run that does not exist is a 404, because a mistyped id and a run '
            + 'that has reported nothing are different answers and a chart cannot tell them apart.'
            + BREAK
            + 'Requires the `models:read` permission.',
        tags: ['V2 · MachineLearning'],
        parameters: [
            {
                in: 'path', name: 'id', required: true, schema: { type: 'integer' },
                description: 'The training run whose pace to read.',
            },
        ],
        responses: {
            200: {
                description: 'Its progress samples, oldest first.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    at: { type: 'string', format: 'date-time', description: 'When the sample was taken.' },
                                    done: { type: 'integer', description: 'Epochs finished at that moment.' },
                                    total: { type: 'integer', description: 'Epochs the run is doing in all.' },
                                    unit: { type: 'string', description: 'What is being counted; `epochs` for a training job.' },
                                    attempt_id: { type: 'integer', description: 'Which attempt reported it.' },
                                },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const pace = await datasetRepository.getTrainingRunPace(req.params.id);

            if (!pace) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Training run ${req.params.id} was not found.`);
            }

            res.json(pace);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run/:id/epochs',
        summary: 'Every epoch of one training run',
        description:
            'The per-epoch record a training run leaves behind: losses, precision, recall and mAP, in the order they happened. **This is the read that did not exist.** `/v2/epoch` had a POST and a GET by id, so an epoch could be written and fetched only by somebody who already knew its id -- the curves were in the database and no screen could draw them. A sub-resource on the run rather than a filter on a collection, the same shape `GET /dataset/:id/composition` uses.\n\n'
            + 'Ordered by `epoch_number`, which is what an x-axis of a training curve actually is. Insert order would put a kink in the line the first time a worker reported an epoch late.\n\n'
            + '**Nulls are returned as nulls.** Most of these columns are nullable, most are null today because the worker does not yet report them all, and a run with no validation split will never have them. Coalescing to zero would turn "not measured" into "measured as nothing" -- on a loss curve that reads as a model collapsing, which is a lie about the training rather than a gap in it. A reader draws a gap.\n\n'
            + 'An empty array is the honest answer for a run that has not reported an epoch yet, and for one that never will. It is not a 404: the run exists either way, and a screen watching a run in progress would otherwise have to treat "nothing yet" as an error.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            {
                in: 'path', name: 'id', required: true, schema: { type: 'integer' },
                description: 'The training run whose epochs to read.',
            },
        ],
        responses: {
            200: {
                description: 'Its epochs, earliest first.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Epoch' } },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            /* The run is checked rather than assumed, so a mistyped id is a 404 and not an
               empty chart that looks like a run which reported nothing. */
            const run = await datasetController.getTrainingRunById(req.params.id);

            if (!run) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Training run ${req.params.id} was not found.`);
            }

            res.json(await datasetController.getEpochsForRun(req.params.id));
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run/:id/metrics',
        summary: 'What one training run measured when it finished',
        description:
            'The end-of-run record: per-class precision, recall, F1 and AP, the all-classes aggregate, and the confusion matrix as numbers. All of it is carried from the trainer -- **MARP computes none of it**, and an endpoint with nothing to serve serves nothing.\n\n'
            + '**The confusion matrix is served rows-as-TRUE, columns-as-PREDICTED**, which is how a person reads one. Note that this is the transpose of how Ultralytics indexes it internally (`matrix[predicted][true]`); the stored row keeps the producer\'s own orientation and names it, and the rotation happens once, here, on the way out. A matrix is never derived from the per-class numbers -- one assembled from precision and recall is arithmetic dressed as a measurement, and the off-diagonal, which is the only part anybody looks at, is exactly what a derivation cannot know.\n\n'
            + '**The background row is kept and labelled rather than trimmed.** It holds the misses and the false positives, and the row sums do not mean anything without it. It is absent for classification, which has no background class.\n\n'
            + '**Three kinds of metrics row, and they are different quantities.** `class_name` null is the all-classes aggregate. `class_name` set with `species_id` null is a class MARP could not resolve to a species -- kept, because the model is actively predicting it and dropping it would hide it. Everything else is a resolved class. `metric_family` says which vocabulary the numbers are in, so a segmentation run\'s box and mask rows for one class do not silently replace each other and a classification row\'s null mAP is not read as a detection row that failed to measure one.\n\n'
            + '**A class the validator never evaluated has no row at all.** The trainer reports only classes that appeared in the validation set, so absence means *never evaluated* rather than *scored zero* -- and on a species list where the rare classes are the point, those are not the same fact. Nulls are returned as nulls for the same reason; a reader draws a dash.\n\n'
            + 'Empty is the honest answer for a run still training, for a run that was stopped before its final validation, and for every run that finished before this was recorded. It is not a 404: the run exists either way.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the training run.' },
        ],
        responses: {
            200: {
                description: 'What the run measured. Empty arrays when it measured nothing.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                metrics: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/MetricsSummary' },
                                },
                                confusion_matrices: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/TrainingRunConfusionMatrix' },
                                },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            /* The run is checked rather than assumed, so a mistyped id is a 404 and not
               an empty panel that looks like a run which measured nothing. */
            const run = await datasetController.getTrainingRunById(req.params.id);

            if (!run) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Training run ${req.params.id} was not found.`);
            }

            res.json(await trainingMetricsController.getMetricsForRun(req.params.id));
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run/:id/artifacts',
        summary: 'Every file one training run produced',
        description:
            'The run directory\'s output: the confusion matrix images, the PR, F1, P and R curves, the label distribution and correlogram, the validation prediction samples, `results.csv`, and the weights. Each entry carries the URL that serves its bytes.\n\n'
            + '**An open set, deliberately.** `name` is the real filename stem the worker filed the artifact under and there is no allow-list of recognised ones, so a plot type a later trainer version adds appears here under its own name rather than being dropped for being unfamiliar. A reader should caption what it recognises and show anything else under a tidied version of its own name.\n\n'
            + '**`content_type` matters and is not decoration.** A run directory holds a CSV among the images, so a gallery that assumes every entry is an image draws a broken icon for it.\n\n'
            + '**There is no backfill and there never will be.** A job workspace is removed once MARP holds the result, so anything a run did not publish during its attempt is gone permanently -- every training run that finished before this existed has no plots, and a run that was stopped produced none, because the trainer unwinds out of its loop before the final evaluation and the end-of-run callback. Empty is the honest answer in all three cases.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the training run.' },
        ],
        responses: {
            200: {
                description: 'The files, or an empty array when the run produced none.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string', example: 'confusion_matrix_normalized' },
                                    url: { type: 'string', example: '/api/v2/training_run/202/artifacts/3464930b…' },
                                    sha256: { type: 'string' },
                                    bytes: { type: 'integer', nullable: true },
                                    content_type: { type: 'string', nullable: true, example: 'image/png' },
                                },
                            },
                        },
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const run = await datasetController.getTrainingRunById(req.params.id);

            if (!run) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Training run ${req.params.id} was not found.`);
            }

            res.json(await trainingMetricsController.getArtifactsForRun(req.params.id));
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'models:read',
        path: '/api/training_run/:id/artifacts/:hash',
        summary: 'The bytes of one of a training run\'s files',
        description:
            'Serves one file a training run produced, addressed by the sha256 that identifies it. The same content-addressing the model weights use, so the bytes served are provably the bytes the trainer wrote.\n\n'
            + '**Scoped to the run rather than looked up by hash alone.** A digest copied from an unrelated record cannot be used to read an artifact through this route, which is why the run id is in the path and not merely decorative.',
        tags: ['V1 · MachineLearning'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the training run.' },
            { in: 'path', name: 'hash', required: true, schema: { type: 'string' }, description: 'The sha256 addressing the file.' },
        ],
        responses: {
            200: {
                description: 'The file.',
                content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const located = await trainingMetricsController.locateArtifact(
                req.params.id, req.params.hash
            );

            /* One 404 for "no such run", "no such artifact" and "recorded but its bytes
               are not on disk". They are the same answer to a reader -- the file is not
               here -- and distinguishing them would tell a caller which hashes exist. */
            if (!located) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Training run ${req.params.id} has no artifact ${req.params.hash}.`);
            }

            if (located.content_type) {
                res.type(located.content_type);
            }

            res.sendFile(located.file);
        }),
    });

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
