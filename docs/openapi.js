/**
 * File: docs/openapi.js
 * Purpose: Build the OpenAPI specification from annotations in API source files.
 * Context: Used by the runtime Swagger endpoint and the CLI generation script.
 */

const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');
const { SchemaManager, OpenApiStrategy } = require('@techntools/sequelize-to-openapi');
const db = require('../model');
const { getRegisteredOpenApiRoutes } = require('./openapi-route-registry');


// PROJECT_ROOT anchors annotation paths to the repository instead of process.cwd().
const PROJECT_ROOT = path.resolve(__dirname, '..');


/**
 * Convert a filesystem path to forward slashes for glob compatibility.
 * Input: Absolute or relative filesystem path.
 * Output: Normalized path suitable for swagger-jsdoc glob matching.
 */
const normalizeGlobPath = (filePath) => {

    return filePath.replace(/\\/g, '/');
};

const schemaManager = new SchemaManager();
const openApiStrategy = new OpenApiStrategy();

/**
 * @techntools/sequelize-to-openapi requires model `jsonSchema.examples` to be
 * an array (it throws otherwise), then copies that array verbatim into the
 * OpenAPI `example` keyword, which is documented as a single scalar value.
 * Left alone, every generated property ends up as `example: [value]` instead
 * of `example: value`. This unwraps that mismatch after generation so the
 * spec's example values match what the API actually returns.
 */
function unwrapArrayExamples(schema) {
    for (const property of Object.values(schema.properties || {})) {
        if (Array.isArray(property.example)) {
            property.example = property.example[0];
        }
    }

    return schema;
}

/**
 * JSONB attributes map to a generic `anyOf: [object, array, boolean, ...]`
 * schema by default. A `jsonSchema.schema` override narrowing the type (e.g.
 * to a plain object) adds its own `type` key alongside that `anyOf` rather
 * than replacing it, leaving both present and redundant. This drops the
 * leftover `anyOf` whenever an explicit `type` narrowed it down.
 */
function dropRedundantAnyOf(schema) {
    for (const property of Object.values(schema.properties || {})) {
        if (property.type && property.anyOf) {
            delete property.anyOf;
        }
    }

    return schema;
}

/**
 * One entry per Sequelize model whose OpenAPI component schema is generated
 * from the model instead of hand-written. `propertyDescriptions` fills in
 * descriptions for properties `@techntools/sequelize-to-openapi` derives
 * itself (e.g. Sequelize's automatic `id`/`createdAt`/`updatedAt`), which
 * have no attribute definition on the model to attach `jsonSchema` to.
 *
 * @constant
 * @type {Array<Object>}
 */
const GENERATED_SCHEMAS = [
    {
        modelKey: 'tasks',
        schemaName: 'Task',
        description:
            'A discrete work item tracked in MARP, including descriptive text and audit fields showing who created and last updated it.',
        propertyDescriptions: {
            id: 'Primary database identifier for the task.',
            createdAt: 'Timestamp when the task record was created.',
            updatedAt: 'Timestamp when the task record was last updated.',
        },
    },
    {
        modelKey: 'metaInfo',
        schemaName: 'MetaInfo',
        description:
            'A small reference metadata record used for lightweight application-level values (for example labels or environment metadata) that do not belong to a larger domain table.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'keyframes',
        schemaName: 'Keyframe',
        description:
            'Frame-level annotation associated with a single observation. One observation can contain multiple tracked subsets (for example, two boxed organisms tracked in parallel) distinguished by the `subset` field.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'users',
        schemaName: 'User',
        description:
            'Individual identity record used to attribute sessions, observations, and related reporting outputs throughout MARP.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'projects',
        schemaName: 'Project',
        description:
            'Named organizational unit used to group sessions and observations for a survey effort, campaign, or reporting scope.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'sessions',
        schemaName: 'Session',
        description:
            'Dive or survey session grouping the observations recorded during a single dive/line, along with its owning project and user.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'species',
        schemaName: 'Species',
        description:
            'Taxonomic and GUI display entry used to classify observations, datasets, and ML model training labels throughout MARP.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'model_species',
        schemaName: 'ModelSpecies',
        description:
            'Join record linking an ML model to a species it was trained to detect or classify, including per-species dataset size, training weight, and evaluation metrics.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'datasets',
        schemaName: 'Dataset',
        description:
            'Curated collection of observations used for machine learning training, validation, or testing. Linked to individual observations through the dataset_observations join table.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'dataset_observations',
        schemaName: 'DatasetObservation',
        description:
            'Join record linking a dataset to one observation it includes, with metadata describing how and why that observation was selected for the dataset (train/val/test split, selection method, and sampling weight).',
        propertyDescriptions: {},
    },
    {
        modelKey: 'ml_models',
        schemaName: 'MlModel',
        description:
            'Metadata record for a distinct machine learning model identity used within MARP (e.g., "yolov8-marine-fish-2025"). Represents the conceptual model itself, not any individual training run; runs, metrics, and artifacts are linked through the training_runs table.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'training_runs',
        schemaName: 'TrainingRun',
        description:
            'A single training or retraining event of an ML model, linking the model, the dataset used, and the resulting epochs, metrics, and artifacts produced during that run.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'epochs',
        schemaName: 'Epoch',
        description:
            'Per-epoch performance and timing data captured during a single training run, including loss values and precision/recall/mAP metrics recorded at the end of that epoch.',
        propertyDescriptions: {},
    },
    {
        modelKey: 'observations',
        schemaName: 'Observation',
        description:
            'Biological or habitat observation recorded during a MARP session. The fields available in a response may depend on the query and any Sequelize associations included by that endpoint.',
        propertyDescriptions: {},
    },
];

function buildGeneratedComponentSchemas() {
    const schemas = {};

    for (const { modelKey, schemaName, description, propertyDescriptions } of GENERATED_SCHEMAS) {
        const model = db[modelKey];
        if (!model) {
            continue;
        }

        const schema = dropRedundantAnyOf(unwrapArrayExamples(schemaManager.generate(model, openApiStrategy)));
        schema.description = description;

        for (const [property, propertyDescription] of Object.entries(propertyDescriptions)) {
            if (schema.properties?.[property]) {
                schema.properties[property].description = propertyDescription;
            }
        }

        schemas[schemaName] = schema;
    }

    return schemas;
}

function mergeRegisteredRoutes(spec) {
    for (const { method, path: routePath, operation } of getRegisteredOpenApiRoutes()) {
        if (!spec.paths[routePath]) {
            spec.paths[routePath] = {};
        }

        spec.paths[routePath][method] = operation;
    }
}


/**
 * Build the OpenAPI document from in-code @openapi annotations.
 * Input: None.
 * Output: Generated OpenAPI specification object.
 * Throws: Annotation parsing errors when failOnErrors is enabled.
 */
const buildOpenApiSpec = () => {

    /**
     * Absolute source-file patterns scanned by `swagger-jsdoc`.
     *
     * Route annotations are read from the server, controller, service, and
     * repository layers. Reusable OpenAPI component schemas may also be defined
     * beside the model files they describe.
     *
     * Each path is normalized to forward slashes so the glob patterns behave
     * consistently across operating systems.
     *
     * @constant
     * @type {string[]}
     */
    const annotationFiles = [
        normalizeGlobPath(path.join(PROJECT_ROOT, 'app.js')),                    // Main Express routes and documentation endpoints.
        normalizeGlobPath(path.join(PROJECT_ROOT, 'controller', '**', '*.js')), // Controller-level OpenAPI annotations.
        normalizeGlobPath(path.join(PROJECT_ROOT, 'service', '**', '*.js')),    // Service-level OpenAPI annotations.
        normalizeGlobPath(path.join(PROJECT_ROOT, 'repository', '**', '*.js')), // Repository-related API documentation.
        normalizeGlobPath(path.join(PROJECT_ROOT, 'model', '**', '*.js')),      // Reusable component schemas defined beside models.
    ];
    

    const options = {
        failOnErrors: true,

        definition: {
            openapi: '3.0.3',

            info: {
                title: 'MARE API',
                version: '1.0.0',
                description: 'Generated OpenAPI specification for MARE API V1 routes.',
            },

            servers: [
                {
                    url: '/api',
                    description: 'Relative API base path',
                },
            ],

            tags: [
                {
                    name: 'Health',
                    description: 'Service status and diagnostics',
                },
                {
                    name: 'Tasks',
                    description: 'Task read operations',
                },
                {
                    name: 'Observations',
                    description:
                        'Access biological observation records and related data. These endpoints support observation retrieval, filtering, aggregation, review workflows, video-based queries, keyframe associations, and observation updates.'
                },
                {
                    name: 'Schema',
                    description:
                        'Database schema introspection endpoints for tables, views, columns, constraints, indexes, and relationships in the public schema.'
                },
                {
                    name: 'Jellyfin',
                    description:
                        'V2 endpoints proxying the Jellyfin media server: library/folder browsing, search-by-name, and playback resolution. Jellyfin itself is never exposed to API consumers -- MARP holds the Jellyfin credentials and session, and the stream endpoint returns a short-lived redirect rather than requiring callers to know Jellyfin exists.'
                }
            ],

            components: {
                schemas: {
                    ErrorDetail: {
                        type: 'object',
                        required: ['issue'],
                        properties: {
                            field: {
                                type: 'string',
                                nullable: true,
                                description: 'Optional field/key associated with this validation or domain issue.',
                            },
                            issue: {
                                type: 'string',
                                description: 'Human-readable description of the specific issue.',
                            },
                        },
                    },
                    ErrorObject: {
                        type: 'object',
                        required: ['code', 'message', 'status', 'requestId'],
                        properties: {
                            code: {
                                type: 'string',
                                description: 'Stable machine-readable error code (UPPER_SNAKE_CASE).',
                                example: 'RESOURCE_NOT_FOUND',
                            },
                            message: {
                                type: 'string',
                                description: 'Client-safe summary of the error.',
                                example: 'Requested session was not found.',
                            },
                            status: {
                                type: 'integer',
                                description: 'HTTP status code returned with this error.',
                                example: 404,
                            },
                            requestId: {
                                type: 'string',
                                description: 'Request correlation identifier for tracing and logs.',
                                example: 'req_mdxv3u_4f7k2q',
                            },
                            details: {
                                type: 'array',
                                nullable: true,
                                description: 'Optional structured issue list (commonly used for validation failures).',
                                items: {
                                    $ref: '#/components/schemas/ErrorDetail',
                                },
                            },
                        },
                    },
                    ErrorEnvelope: {
                        type: 'object',
                        required: ['error'],
                        properties: {
                            error: {
                                $ref: '#/components/schemas/ErrorObject',
                            },
                        },
                    },
                    ErrorResponse: {
                        allOf: [
                            { $ref: '#/components/schemas/ErrorEnvelope' },
                        ],
                        description: 'Backward-compatible alias for the standardized error envelope.',
                    },
                    TaskCreateRequest: {
                        type: 'object',
                        required: ['task'],
                        properties: {
                            task: {
                                type: 'object',
                                required: ['name', 'createdby'],
                                additionalProperties: true,
                                properties: {
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Review kelp transect annotations',
                                        description: 'Human-readable title of the task.',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'Validate species labels for line A before report export.',
                                        description: 'Optional freeform details describing scope or next actions.',
                                    },
                                    createdby: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'i.travers',
                                        description: 'Identifier or username of the person who created the task.',
                                    },
                                    updatedby: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'j.diver',
                                        description: 'Identifier or username of the person who last modified the task.',
                                    },
                                },
                            },
                        },
                    },
                    TaskUpdateRequest: {
                        type: 'object',
                        required: ['task'],
                        properties: {
                            task: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the task to update.',
                                    },
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Review kelp transect annotations',
                                        description: 'Human-readable title of the task.',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'Validate species labels for line A before report export.',
                                        description: 'Optional freeform details describing scope or next actions.',
                                    },
                                    createdby: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'i.travers',
                                        description: 'Identifier or username of the person who created the task.',
                                    },
                                    updatedby: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'j.diver',
                                        description: 'Identifier or username of the person who last modified the task.',
                                    },
                                },
                            },
                        },
                    },
                    UserCreateRequest: {
                        type: 'object',
                        required: ['user'],
                        properties: {
                            user: {
                                type: 'object',
                                required: ['name'],
                                additionalProperties: true,
                                properties: {
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Jane Diver',
                                        description: 'Unique display name used by API and reporting views.',
                                    },
                                },
                            },
                        },
                    },
                    UserUpdateRequest: {
                        type: 'object',
                        required: ['user'],
                        properties: {
                            user: {
                                type: 'object',
                                required: ['user_id'],
                                additionalProperties: true,
                                properties: {
                                    user_id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the user to update.',
                                    },
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Jane Diver',
                                        description: 'Unique display name used by API and reporting views.',
                                    },
                                },
                            },
                        },
                    },
                    ProjectCreateRequest: {
                        type: 'object',
                        required: ['project'],
                        properties: {
                            project: {
                                type: 'object',
                                required: ['name'],
                                additionalProperties: true,
                                properties: {
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Channel Islands 2024',
                                        description: 'Unique display name used across UI filters and API queries.',
                                    },
                                },
                            },
                        },
                    },
                    ProjectUpdateRequest: {
                        type: 'object',
                        required: ['project'],
                        properties: {
                            project: {
                                type: 'object',
                                required: ['project_id'],
                                additionalProperties: true,
                                properties: {
                                    project_id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the project to update.',
                                    },
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Channel Islands 2024',
                                        description: 'Unique display name used across UI filters and API queries.',
                                    },
                                },
                            },
                        },
                    },
                    SessionCreateRequest: {
                        type: 'object',
                        required: ['session'],
                        properties: {
                            session: {
                                type: 'object',
                                required: ['dive', 'line', 'lineId', 'type'],
                                additionalProperties: true,
                                properties: {
                                    project_id: {
                                        type: 'integer',
                                        nullable: true,
                                        example: 24,
                                        description: 'Identifier of the project this session was conducted under.',
                                    },
                                    user_id: {
                                        type: 'integer',
                                        nullable: true,
                                        example: 8,
                                        description: 'Identifier of the user who recorded or owns this session.',
                                    },
                                    dive: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Dive 12',
                                        description: 'Dive identifier or name associated with this session.',
                                    },
                                    line: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Line A',
                                        description: 'Transect line identifier associated with this session.',
                                    },
                                    lineId: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'L-2024-012A',
                                        description: 'Identifier of the specific survey line tied to this session.',
                                    },
                                    type: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'ROV',
                                        description: 'Type or category of this session (e.g., survey platform or method).',
                                    },
                                },
                            },
                        },
                    },
                    SpeciesCreateRequest: {
                        type: 'object',
                        required: ['species'],
                        properties: {
                            species: {
                                type: 'object',
                                required: ['taxserial'],
                                additionalProperties: true,
                                properties: {
                                    taxserial: {
                                        type: 'integer',
                                        example: 1054,
                                        description: 'Internal MARP taxonomy serial number used as a unique ID across systems.',
                                    },
                                    comname: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'Bat star',
                                        description: 'Common name used for this species.',
                                    },
                                },
                            },
                        },
                    },
                    SpeciesUpdateRequest: {
                        type: 'object',
                        required: ['species'],
                        properties: {
                            species: {
                                type: 'object',
                                additionalProperties: true,
                                properties: {
                                    taxserial: {
                                        type: 'integer',
                                        example: 1054,
                                        description: 'Internal MARP taxonomy serial number used as a unique ID across systems.',
                                    },
                                    comname: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'Bat star',
                                        description: 'Common name used for this species.',
                                    },
                                },
                            },
                        },
                    },
                    DatasetCreateRequest: {
                        type: 'object',
                        required: ['dataset'],
                        properties: {
                            dataset: {
                                type: 'object',
                                required: ['name'],
                                additionalProperties: true,
                                properties: {
                                    name: {
                                        type: 'string',
                                        example: 'Fish_2024_Training_Set_v1',
                                        description: 'Descriptive name of this dataset.',
                                    },
                                },
                            },
                        },
                    },
                    DatasetUpdateRequest: {
                        type: 'object',
                        required: ['dataset'],
                        properties: {
                            dataset: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the dataset to update.',
                                    },
                                    name: {
                                        type: 'string',
                                        example: 'Fish_2024_Training_Set_v1',
                                        description: 'Descriptive name of this dataset.',
                                    },
                                },
                            },
                        },
                    },
                    MlModelCreateRequest: {
                        type: 'object',
                        required: ['model'],
                        properties: {
                            model: {
                                type: 'object',
                                required: ['name', 'model_type'],
                                additionalProperties: true,
                                properties: {
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'yolov8-marine-fish-2025',
                                        description: 'Human-readable name of the model (e.g., "yolov8-marine-fish-2025").',
                                    },
                                    model_type: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'yolov8',
                                        description: 'Model architecture family (e.g., "yolov8", "resnet", "deepsort").',
                                    },
                                },
                            },
                        },
                    },
                    MlModelUpdateRequest: {
                        type: 'object',
                        required: ['model'],
                        properties: {
                            model: {
                                type: 'object',
                                additionalProperties: true,
                                properties: {
                                    storage_path: {
                                        type: 'string',
                                        example: '/models/yolov8-marine-fish-2025/',
                                        description: 'Filesystem or URI path to the stored model weights and artifacts.',
                                    },
                                    status: {
                                        type: 'string',
                                        enum: ['draft', 'training', 'trained', 'archived'],
                                        example: 'trained',
                                        description: 'Lifecycle state of the model ("draft", "training", "trained", or "archived").',
                                    },
                                },
                            },
                        },
                    },
                    TrainingRunCreateRequest: {
                        type: 'object',
                        required: ['training_run'],
                        properties: {
                            training_run: {
                                type: 'object',
                                required: ['model_id'],
                                additionalProperties: true,
                                properties: {
                                    model_id: {
                                        type: 'integer',
                                        example: 7,
                                        description: 'Foreign key referencing the parent ML model (ml_models.id).',
                                    },
                                    dataset_id: {
                                        type: 'integer',
                                        nullable: true,
                                        example: 3,
                                        description: 'Foreign key referencing the dataset used for training (datasets.id).',
                                    },
                                },
                            },
                        },
                    },
                    TrainingRunUpdateRequest: {
                        type: 'object',
                        required: ['training_run'],
                        properties: {
                            training_run: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the training run to update.',
                                    },
                                },
                            },
                        },
                    },
                    MetricsSummaryCreateRequest: {
                        type: 'object',
                        required: ['metrics_summary'],
                        properties: {
                            metrics_summary: {
                                type: 'object',
                                required: ['training_run_id', 'dataset_split'],
                                additionalProperties: true,
                                properties: {
                                    training_run_id: {
                                        type: 'integer',
                                        example: 12,
                                        description: 'Foreign key referencing the training run this metrics summary belongs to (training_runs.id).',
                                    },
                                    dataset_split: {
                                        type: 'string',
                                        enum: ['train', 'val', 'test'],
                                        description: 'Specifies which dataset split these metrics apply to - "train", "val", or "test".',
                                    },
                                },
                            },
                        },
                    },
                    MetricsSummaryUpdateRequest: {
                        type: 'object',
                        required: ['metrics_summary'],
                        properties: {
                            metrics_summary: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the metrics_summary to update.',
                                    },
                                },
                            },
                        },
                    },
                    MetricsCurveCreateRequest: {
                        type: 'object',
                        required: ['metrics_curve'],
                        properties: {
                            metrics_curve: {
                                type: 'object',
                                required: ['metrics_summary_id', 'confidence_threshold'],
                                additionalProperties: true,
                                properties: {
                                    metrics_summary_id: {
                                        type: 'integer',
                                        example: 501,
                                        description: 'Foreign key referencing the metrics summary record (metrics_summary.id) this curve point belongs to.',
                                    },
                                    confidence_threshold: {
                                        type: 'number',
                                        format: 'float',
                                        example: 0.25,
                                        description: 'Confidence threshold (between 0.0 and 1.0) at which these metrics were measured.',
                                    },
                                },
                            },
                        },
                    },
                    MetricsCurveUpdateRequest: {
                        type: 'object',
                        required: ['metrics_curve'],
                        properties: {
                            metrics_curve: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the metrics_curve to update.',
                                    },
                                },
                            },
                        },
                    },
                    EpochCreateRequest: {
                        type: 'object',
                        required: ['epoch'],
                        properties: {
                            epoch: {
                                type: 'object',
                                required: ['training_run_id', 'epoch_number'],
                                additionalProperties: true,
                                properties: {
                                    training_run_id: {
                                        type: 'integer',
                                        example: 12,
                                        description: 'Foreign key linking this epoch to its parent training run (training_runs.id).',
                                    },
                                    epoch_number: {
                                        type: 'integer',
                                        example: 3,
                                        description: 'The ordinal number of this epoch in the training sequence.',
                                    },
                                },
                            },
                        },
                    },
                    EpochUpdateRequest: {
                        type: 'object',
                        required: ['epoch'],
                        properties: {
                            epoch: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the epoch to update.',
                                    },
                                },
                            },
                        },
                    },
                    DatasetObservationCreateRequest: {
                        type: 'object',
                        required: ['dataset_observation'],
                        properties: {
                            dataset_observation: {
                                type: 'object',
                                required: ['dataset_id', 'observation_id'],
                                additionalProperties: true,
                                properties: {
                                    dataset_id: {
                                        type: 'integer',
                                        example: 3,
                                        description: 'Foreign key referencing the dataset that includes this observation (datasets.id).',
                                    },
                                    observation_id: {
                                        type: 'integer',
                                        example: 918,
                                        description: 'Foreign key referencing the observation included in this dataset (observations.observation_id).',
                                    },
                                },
                            },
                        },
                    },
                    DatasetObservationUpdateRequest: {
                        type: 'object',
                        required: ['dataset_observation'],
                        properties: {
                            dataset_observation: {
                                type: 'object',
                                required: ['id'],
                                additionalProperties: true,
                                properties: {
                                    id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the dataset_observation to update.',
                                    },
                                },
                            },
                        },
                    },
                    ObservationCreateRequest: {
                        type: 'object',
                        required: ['observation'],
                        properties: {
                            observation: {
                                type: 'object',
                                required: ['obsID'],
                                additionalProperties: true,
                                properties: {
                                    obsID: {
                                        type: 'integer',
                                        example: 42,
                                        description: 'Observation identifier used within the source workflow.',
                                    },
                                    comname: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'Bat star',
                                        description: 'Common name assigned to the observed taxon.',
                                    },
                                },
                            },
                        },
                    },
                    ObservationUpdateRequest: {
                        type: 'object',
                        required: ['observation'],
                        properties: {
                            observation: {
                                type: 'object',
                                required: ['observation_id'],
                                additionalProperties: true,
                                properties: {
                                    observation_id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the observation to update.',
                                    },
                                    comname: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'Bat star',
                                        description: 'Common name assigned to the observed taxon.',
                                    },
                                },
                            },
                        },
                    },
                    SessionUpdateRequest: {
                        type: 'object',
                        required: ['session'],
                        properties: {
                            session: {
                                type: 'object',
                                required: ['session_id'],
                                additionalProperties: true,
                                properties: {
                                    session_id: {
                                        type: 'integer',
                                        description: 'Primary database identifier for the session to update.',
                                    },
                                    project_id: {
                                        type: 'integer',
                                        nullable: true,
                                        example: 24,
                                        description: 'Identifier of the project this session was conducted under.',
                                    },
                                    user_id: {
                                        type: 'integer',
                                        nullable: true,
                                        example: 8,
                                        description: 'Identifier of the user who recorded or owns this session.',
                                    },
                                    dive: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Dive 12',
                                        description: 'Dive identifier or name associated with this session.',
                                    },
                                    line: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'Line A',
                                        description: 'Transect line identifier associated with this session.',
                                    },
                                    lineId: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'L-2024-012A',
                                        description: 'Identifier of the specific survey line tied to this session.',
                                    },
                                    type: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 255,
                                        example: 'ROV',
                                        description: 'Type or category of this session (e.g., survey platform or method).',
                                    },
                                },
                            },
                        },
                    },

                    // The three schemas below extend the generated `Observation` schema
                    // with association data (keyframes, session, datasets) that Sequelize
                    // attaches only when a query's `include` asks for it. They aren't
                    // derivable from the Observation model alone, so they're hand-written
                    // here rather than generated (see model/observation.model.js).
                    ObservationWithKeyframes: {
                        allOf: [
                            { $ref: '#/components/schemas/Observation' },
                            {
                                type: 'object',
                                description: 'Observation response containing associated keyframes.',
                                properties: {
                                    keyframes: {
                                        type: 'array',
                                        description: 'Keyframes associated with the observation.',
                                        items: { $ref: '#/components/schemas/Keyframe' },
                                    },
                                },
                            },
                        ],
                    },
                    ObservationWithSessionAndKeyframes: {
                        allOf: [
                            { $ref: '#/components/schemas/ObservationWithKeyframes' },
                            {
                                type: 'object',
                                description: 'Observation response containing both its owning session and associated keyframes.',
                                properties: {
                                    session: { $ref: '#/components/schemas/Session' },
                                },
                            },
                        ],
                    },
                    ObservationWithDatasets: {
                        allOf: [
                            { $ref: '#/components/schemas/Observation' },
                            {
                                type: 'object',
                                description: 'Observation response containing associated curated datasets.',
                                properties: {
                                    datasets: {
                                        type: 'array',
                                        description: 'Datasets that include this observation through the dataset_observations join table.',
                                        items: { $ref: '#/components/schemas/Dataset' },
                                    },
                                },
                            },
                        ],
                    },

                    // The schemas below document custom report/aggregate routes whose
                    // response shape does not match any single Sequelize model. Each
                    // was derived from real response samples captured against the dev
                    // database (see docs/openapi-response-schema-workflow.md and the
                    // samples under samples/openapi-response/) rather than guessed from
                    // the route name or query code alone.
                    VideoSummaryReport: {
                        type: 'array',
                        description:
                            'One aggregated row per distinct video_source/videoLocation combination within a project, produced by observationRepository.getVideoSummariesByProject and served by GET /getVideoSummaries/{project_id}.',
                        items: {
                            type: 'object',
                            required: [
                                'video_source',
                                'videoLocation',
                                'distinct_species_count',
                                'session_count',
                                'dive',
                                'line',
                                'session_type',
                            ],
                            properties: {
                                video_source: {
                                    type: 'string',
                                    nullable: true,
                                    example: '20251007_164658 Fwd.mp4',
                                    description: 'Video source shared by every observation in this group. Nullable because observations.video_source itself allows null.',
                                },
                                videoLocation: {
                                    type: 'string',
                                    nullable: true,
                                    example: 'E:\\Video\\Dive01\\FWD\\20251007_164658 Fwd.mp4',
                                    description: 'Video location shared by every observation in this group. Nullable because observations.videoLocation itself allows null.',
                                },
                                distinct_species_count: {
                                    type: 'string',
                                    example: '5',
                                    description:
                                        'Count of distinct non-null observation comname values in the group. Returned as a numeric string, not a number, because it is a raw Postgres COUNT(DISTINCT ...) aggregate served through Sequelize with raw:true.',
                                },
                                session_count: {
                                    type: 'string',
                                    example: '1',
                                    description:
                                        'Count of distinct sessions contributing observations to the group. Returned as a numeric string for the same raw-aggregate reason as distinct_species_count.',
                                },
                                dive: {
                                    type: 'string',
                                    example: '453',
                                    description:
                                        'Lowest sessions.dive value (database MIN, so string ordering rather than numeric) among the sessions joined into this group. The session join is required and sessions.dive is a required column, so this value is always present.',
                                },
                                line: {
                                    type: 'string',
                                    example: '3455',
                                    description:
                                        'Lowest sessions.line value, aggregated independently from dive. Always present for the same reasons as dive.',
                                },
                                session_type: {
                                    type: 'string',
                                    example: 'Fish',
                                    description:
                                        'Lowest sessions.type value (database MIN, string ordering). Always present for the same reasons as dive.',
                                },
                            },
                        },
                    },

                    DashboardUserDateEntry: {
                        type: 'object',
                        description:
                            'Per-day activity counts for one user, nested inside UserDashboardData. KNOWN LIMITATION: sessions and projects are always 0 in the current implementation -- observationRepository.getUserDashboardData only ever populates the observations count.',
                        required: ['sessions', 'observations', 'projects'],
                        properties: {
                            sessions: {
                                type: 'integer',
                                example: 0,
                                description: 'Always 0 in the current implementation; session counting was never wired up.',
                            },
                            observations: {
                                type: 'integer',
                                example: 26,
                                description: 'Number of observations the user created on this date, from a COUNT grouped by session.user_id and DATE(observations.createdAt).',
                            },
                            projects: {
                                type: 'integer',
                                example: 0,
                                description: 'Always 0 in the current implementation; project counting was never wired up.',
                            },
                        },
                    },

                    UserDashboardData: {
                        type: 'object',
                        description:
                            "Dashboard activity data keyed by user display name, then by ISO date (YYYY-MM-DD). Returned by GET /dashboardData. Both start and end query parameters are required for any rows to be returned -- omitting either produces {} because the underlying Sequelize Op.between filter cannot match against an undefined bound.",
                        additionalProperties: {
                            type: 'object',
                            description: "Map of ISO date (YYYY-MM-DD) to that date's activity entry for this user.",
                            additionalProperties: {
                                $ref: '#/components/schemas/DashboardUserDateEntry',
                            },
                        },
                        example: {
                            'Isaac Travers': {
                                '2026-07-01': { sessions: 0, observations: 26, projects: 0 },
                            },
                        },
                    },

                    ProjectTimeByDateAndUser: {
                        type: 'object',
                        description:
                            'Estimated recording minutes keyed by project name, then by ISO date (YYYY-MM-DD), then by user display name. Returned by GET /getProjectTimeByDateAndUser. Both start and end query parameters are required for any rows to be returned, for the same Op.between reason as UserDashboardData. KNOWN BUG: the last observation of every session/day contributes zero minutes to the total, so returned time is systematically undercounted.',
                        additionalProperties: {
                            type: 'object',
                            description: "Map of ISO date (YYYY-MM-DD) to that date's per-user minute totals.",
                            additionalProperties: {
                                type: 'object',
                                description: 'Map of user display name to estimated minutes recorded on this date for this project.',
                                additionalProperties: {
                                    type: 'number',
                                    example: 89.41666666666667,
                                },
                            },
                        },
                        example: {
                            'CAMPA-2025': {
                                '2026-07-01': { 'Camille Werner': 89.41666666666667 },
                            },
                        },
                    },

                    MetaInfoDbName: {
                        type: 'array',
                        description:
                            'Response shape for GET /metaInfo/dbName. Always a single-element array projecting only the name column -- never the full MetaInfo row. metaInfoRepository.getDBName returns [{name: "NO DB Name Found"}] when the metaInfo table has no rows, and an empty array only when the query itself throws.',
                        items: {
                            type: 'object',
                            required: ['name'],
                            properties: {
                                name: {
                                    type: 'string',
                                    nullable: true,
                                    example: 'Production',
                                    description: 'Value of the first metaInfo row\'s name column, or the literal "NO DB Name Found" placeholder when no row exists.',
                                },
                            },
                        },
                    },

                    SchemaColumn: {
                        type: 'object',
                        required: ['name', 'ordinalPosition', 'dataType', 'udtName', 'isNullable', 'isIdentity'],
                        properties: {
                            name: { type: 'string', example: 'project_id', description: 'Column name.' },
                            ordinalPosition: { type: 'integer', example: 1, description: '1-based column position in the table/view.' },
                            dataType: { type: 'string', example: 'integer', description: 'Generic SQL type reported by information_schema.' },
                            udtName: { type: 'string', example: 'int4', description: 'PostgreSQL underlying type name.' },
                            isNullable: { type: 'boolean', example: false, description: 'True when NULL values are allowed.' },
                            defaultValue: { type: 'string', nullable: true, example: "nextval('projects_project_id_seq'::regclass)", description: 'Raw default expression, if defined.' },
                            maxLength: { type: 'integer', nullable: true, example: 255, description: 'Character max length for character types.' },
                            numericPrecision: { type: 'integer', nullable: true, example: 32, description: 'Numeric precision, when applicable.' },
                            numericScale: { type: 'integer', nullable: true, example: 0, description: 'Numeric scale, when applicable.' },
                            datetimePrecision: { type: 'integer', nullable: true, example: 6, description: 'Datetime precision, when applicable.' },
                            isIdentity: { type: 'boolean', example: false, description: 'True when column is an identity column.' },
                            identityGeneration: { type: 'string', nullable: true, example: 'BY DEFAULT', description: 'Identity generation mode when isIdentity is true.' },
                            comment: { type: 'string', nullable: true, example: 'Primary key for projects table.', description: 'Column comment from PostgreSQL metadata, when set.' },
                        },
                    },

                    SchemaPrimaryKey: {
                        type: 'object',
                        required: ['name', 'columns'],
                        properties: {
                            name: { type: 'string', example: 'projects_pkey', description: 'Primary-key constraint name.' },
                            columns: { type: 'array', items: { type: 'string' }, example: ['project_id'], description: 'Ordered list of primary-key columns.' },
                        },
                    },

                    SchemaForeignKey: {
                        type: 'object',
                        required: ['name', 'columns', 'referencedSchema', 'referencedTable', 'referencedColumns', 'onUpdate', 'onDelete'],
                        properties: {
                            name: { type: 'string', example: 'sessions_project_id_fkey', description: 'Foreign-key constraint name.' },
                            columns: { type: 'array', items: { type: 'string' }, example: ['project_id'], description: 'Ordered source columns.' },
                            referencedSchema: { type: 'string', example: 'public', description: 'Referenced table schema.' },
                            referencedTable: { type: 'string', example: 'projects', description: 'Referenced table name.' },
                            referencedColumns: { type: 'array', items: { type: 'string' }, example: ['project_id'], description: 'Ordered referenced columns.' },
                            onUpdate: { type: 'string', example: 'NO ACTION', description: 'ON UPDATE action.' },
                            onDelete: { type: 'string', example: 'CASCADE', description: 'ON DELETE action.' },
                        },
                    },

                    SchemaUniqueConstraint: {
                        type: 'object',
                        required: ['name', 'columns'],
                        properties: {
                            name: { type: 'string', example: 'species_taxserial_key', description: 'Unique constraint name.' },
                            columns: { type: 'array', items: { type: 'string' }, example: ['taxserial'], description: 'Ordered constrained columns.' },
                        },
                    },

                    SchemaCheckConstraint: {
                        type: 'object',
                        required: ['name', 'expression'],
                        properties: {
                            name: { type: 'string', example: 'sessions_dive_check', description: 'Check constraint name.' },
                            expression: { type: 'string', example: 'CHECK ((dive > 0))', description: 'Rendered check expression from PostgreSQL.' },
                        },
                    },

                    SchemaIndex: {
                        type: 'object',
                        required: ['name', 'isUnique', 'isPrimary', 'definition'],
                        properties: {
                            name: { type: 'string', example: 'projects_pkey', description: 'Index name.' },
                            isUnique: { type: 'boolean', example: true, description: 'True when index enforces uniqueness.' },
                            isPrimary: { type: 'boolean', example: true, description: 'True when index backs a primary key.' },
                            definition: { type: 'string', example: 'CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (project_id)', description: 'Full index definition SQL.' },
                        },
                    },

                    SchemaTable: {
                        type: 'object',
                        required: ['schema', 'name', 'rowEstimate', 'columns', 'foreignKeys', 'uniqueConstraints', 'checkConstraints', 'indexes'],
                        properties: {
                            schema: { type: 'string', example: 'public', description: 'Table schema.' },
                            name: { type: 'string', example: 'projects', description: 'Table name.' },
                            rowEstimate: { type: 'integer', example: 2412, description: 'Approximate row count from PostgreSQL catalog statistics.' },
                            comment: { type: 'string', nullable: true, example: 'Stores project metadata.', description: 'Table comment from PostgreSQL metadata, when set.' },
                            columns: { type: 'array', items: { $ref: '#/components/schemas/SchemaColumn' }, description: 'All table columns in ordinal order.' },
                            primaryKey: { oneOf: [{ $ref: '#/components/schemas/SchemaPrimaryKey' }, { type: 'null' }], description: 'Primary key metadata, or null if no primary key exists.' },
                            foreignKeys: { type: 'array', items: { $ref: '#/components/schemas/SchemaForeignKey' }, description: 'Outgoing foreign-key constraints.' },
                            uniqueConstraints: { type: 'array', items: { $ref: '#/components/schemas/SchemaUniqueConstraint' }, description: 'Unique constraints defined on the table.' },
                            checkConstraints: { type: 'array', items: { $ref: '#/components/schemas/SchemaCheckConstraint' }, description: 'Check constraints defined on the table.' },
                            indexes: { type: 'array', items: { $ref: '#/components/schemas/SchemaIndex' }, description: 'All table indexes, including primary and non-unique indexes.' },
                        },
                    },

                    SchemaViewDependency: {
                        type: 'object',
                        required: ['schema', 'name', 'type'],
                        properties: {
                            schema: { type: 'string', example: 'public', description: 'Dependency object schema.' },
                            name: { type: 'string', example: 'observations', description: 'Dependency object name.' },
                            type: { type: 'string', example: 'TABLE', description: 'Dependency object type.' },
                        },
                    },

                    SchemaView: {
                        type: 'object',
                        required: ['schema', 'name', 'type', 'isUpdatable', 'definition', 'columns', 'dependencies'],
                        properties: {
                            schema: { type: 'string', example: 'public', description: 'View schema.' },
                            name: { type: 'string', example: 'observations_report', description: 'View name.' },
                            type: { type: 'string', example: 'VIEW', description: 'VIEW or MATERIALIZED_VIEW.' },
                            isUpdatable: { type: 'boolean', example: false, description: 'True when PostgreSQL marks the view as updatable.' },
                            definition: { type: 'string', example: ' SELECT observations.observation_id, observations.comname FROM observations;', description: 'SQL definition text for the view.' },
                            columns: { type: 'array', items: { $ref: '#/components/schemas/SchemaColumn' }, description: 'View columns in ordinal order.' },
                            dependencies: { type: 'array', items: { $ref: '#/components/schemas/SchemaViewDependency' }, description: 'Referenced public tables/views discovered from PostgreSQL dependency metadata.' },
                        },
                    },

                    SchemaRelationship: {
                        type: 'object',
                        required: ['name', 'source_schema', 'source_table', 'source_columns', 'target_schema', 'target_table', 'target_columns', 'on_update', 'on_delete'],
                        properties: {
                            name: { type: 'string', example: 'sessions_project_id_fkey', description: 'Foreign-key constraint name.' },
                            source_schema: { type: 'string', example: 'public', description: 'Source table schema.' },
                            source_table: { type: 'string', example: 'sessions', description: 'Source table name.' },
                            source_columns: { type: 'array', items: { type: 'string' }, example: ['project_id'], description: 'Ordered source columns participating in the relationship.' },
                            target_schema: { type: 'string', example: 'public', description: 'Referenced table schema.' },
                            target_table: { type: 'string', example: 'projects', description: 'Referenced table name.' },
                            target_columns: { type: 'array', items: { type: 'string' }, example: ['project_id'], description: 'Ordered referenced columns participating in the relationship.' },
                            on_update: { type: 'string', example: 'NO ACTION', description: 'ON UPDATE action.' },
                            on_delete: { type: 'string', example: 'CASCADE', description: 'ON DELETE action.' },
                        },
                    },
                    JellyfinItem: {
                        type: 'object',
                        description:
                            'A Jellyfin library, folder, or video item, normalized down to the fields MARP exposes. DRAFT schema: field examples are real (captured against the live Jellyfin dev server), but this has not yet gone through the full sample-capture-and-infer workflow (docs/openapi-response-schema-workflow.md) used for other custom-shape endpoints.',
                        properties: {
                            id: {
                                type: 'string',
                                example: '0da5ea1af7f4f116c19ebaa95ba82fc6',
                                description: 'Stable Jellyfin item identifier.',
                            },
                            name: {
                                type: 'string',
                                example: '20211112_170846_NOT_ACTUAL_LINE-_OUTREACH_CLIP',
                                description: 'Human-readable item name.',
                            },
                            path: {
                                type: 'string',
                                example: '/mnt/rov-video-new/CAMPA2021/Dive 165/20211112_170846_NOT_ACTUAL_LINE-_OUTREACH_CLIP.mp4',
                                description: 'Raw server-side filesystem path Jellyfin stores this item at. Exposed deliberately -- useful for confirming a /resolve fuzzy-match result or feeding tooling that needs the original file location -- at the cost of revealing Jellyfin server storage layout to API consumers.',
                            },
                            type: {
                                type: 'string',
                                example: 'Video',
                                description: 'Jellyfin item type, e.g. CollectionFolder (a top-level library), Folder, or Video.',
                            },
                            isFolder: {
                                type: 'boolean',
                                example: false,
                                description: 'Whether this item is a folder-like container browsable via GET /api/v2/jellyfin/items/{id}/children.',
                            },
                            mediaType: {
                                type: 'string',
                                example: 'Video',
                                description: 'Jellyfin media type classification (often "Unknown" for folders/libraries).',
                            },
                            runtimeTicks: {
                                type: 'integer',
                                nullable: true,
                                example: 795729999,
                                description: 'Runtime in Jellyfin ticks (100-nanosecond units). Null for folders and other non-playable items.',
                            },
                            childCount: {
                                type: 'integer',
                                nullable: true,
                                example: 9,
                                description: 'Number of child items. Present only on folder-like items; null for playable video items.',
                            },
                        },
                    },
                    JellyfinItemList: {
                        type: 'object',
                        description: 'A list of Jellyfin items returned by browsing, searching, or listing libraries.',
                        properties: {
                            items: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/JellyfinItem' },
                                description: 'Matching or child items, in the order Jellyfin returned them.',
                            },
                        },
                    },
                    JellyfinPlaybackOption: {
                        type: 'object',
                        description: 'One playback quality choice, derived from the item\'s actual source capabilities (bitrate/resolution) -- a transcode tier is only present if it is genuinely below source quality.',
                        properties: {
                            displayName: { type: 'string', example: '720p, 4 Mbps', description: 'Human-readable label for this option.' },
                            mode: { type: 'string', enum: ['Auto', 'Original', 'Transcode'], example: 'Transcode', description: 'Mode to pass to GET /items/{id}/stream to select this option.' },
                            maxStreamingBitrate: { type: 'integer', nullable: true, example: 4000000, description: 'Bitrate ceiling for this option, in bits/sec. Null for Auto/Original.' },
                            maxWidth: { type: 'integer', nullable: true, example: 1280, description: 'Width ceiling for this option. Null for Auto.' },
                            maxHeight: { type: 'integer', nullable: true, example: 720, description: 'Height ceiling for this option. Null for Auto.' },
                            isAuto: { type: 'boolean', example: false, description: 'True for the Auto placeholder option.' },
                            isOriginal: { type: 'boolean', example: false, description: 'True for the Original/Direct option.' },
                            requiresTranscoding: { type: 'boolean', example: true, description: 'True for a Transcode tier option.' },
                        },
                    },
                    JellyfinPlaybackOptionList: {
                        type: 'object',
                        description: 'The quality menu for one Jellyfin item.',
                        properties: {
                            options: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/JellyfinPlaybackOption' },
                                description: 'Available playback options, most capable first.',
                            },
                        },
                    },
                    JellyfinResolveResult: {
                        type: 'object',
                        description: 'Best Jellyfin item match found for a saved database video_source value, via multi-term search and filename/timestamp scoring.',
                        properties: {
                            item: { $ref: '#/components/schemas/JellyfinItem' },
                            score: { type: 'integer', example: 100, description: 'Match confidence, 0-100. Below the requested minScore is rejected with a 404 rather than returned here.' },
                            searchTerm: { type: 'string', example: '20211112_170846_NOT_ACTUAL_LINE-_OUTREACH_CLIP', description: 'The specific search-term variant that produced this match.' },
                        },
                    },
                    JellyfinPlaybackReportRequest: {
                        type: 'object',
                        description: 'Playback state relayed to Jellyfin\'s session-tracking endpoints. mediaSourceId/playSessionId should be carried forward from the earlier GET /items/{id}/stream or /items/{id}/playback-options response -- MARP does not store playback session state itself.',
                        properties: {
                            mediaSourceId: { type: 'string', nullable: true, example: '0da5ea1af7f4f116c19ebaa95ba82fc6', description: 'MediaSource id from the earlier stream/playback-options response.' },
                            playSessionId: { type: 'string', nullable: true, example: '08bf40f6fa5b474a9899e69983a07a84', description: 'PlaySessionId from the earlier stream/playback-options response.' },
                            positionTicks: { type: 'integer', example: 50000000, description: 'Current playback position, in Jellyfin ticks (100ns units).' },
                            isPaused: { type: 'boolean', example: false, description: 'Whether playback is currently paused. Ignored (always true) for the stopped report.' },
                            playMethod: { type: 'string', enum: ['DirectStream', 'Transcode'], example: 'Transcode', description: 'Which stream mode is active for this session.' },
                        },
                    },
                    JellyfinTrickplayInfo: {
                        type: 'object',
                        description: 'Parsed scrubbing-preview tile metadata for one item. Each tile image URL already embeds its own short-lived access token, the same signed-URL pattern used for stream/image URLs, and is directly fetchable by a caller.',
                        properties: {
                            thumbnailWidth: { type: 'integer', example: 320, description: 'Width of one thumbnail cell, in pixels.' },
                            thumbnailHeight: { type: 'integer', example: 180, description: 'Height of one thumbnail cell, in pixels.' },
                            columns: { type: 'integer', example: 10, description: 'Thumbnail columns per tile sheet image.' },
                            rows: { type: 'integer', example: 10, description: 'Thumbnail rows per tile sheet image.' },
                            thumbnailDurationSeconds: { type: 'number', example: 10, description: 'Seconds of video represented by each thumbnail cell.' },
                            tileImageUrls: {
                                type: 'array',
                                items: { type: 'string', format: 'uri' },
                                example: ['http://jellyfin.example/Videos/{id}/Trickplay/320/0.jpg?MediaSourceId={mediaSourceId}&ApiKey=EXAMPLE_TOKEN'],
                                description: 'Tile sheet image URLs, in order. Each sheet packs columns*rows thumbnails; mapping a scrub time to a specific tile/row/column is left to the caller, since it is pure arithmetic once this metadata is known.',
                            },
                        },
                    },
                },
                responses: {
                    BadRequestError: {
                        description: 'Request payload, query, or path parameters are invalid.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    UnauthorizedError: {
                        description: 'Authentication is required or failed.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    ForbiddenError: {
                        description: 'Authenticated caller does not have permission for this action.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    NotFoundError: {
                        description: 'Requested route or resource was not found.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    ConflictError: {
                        description: 'Operation conflicts with current resource state (for example unique-constraint violation).',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    UnprocessableEntityError: {
                        description: 'Request was syntactically valid but semantically invalid.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    InternalServerError: {
                        description: 'Unexpected server-side failure.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                    UpstreamError: {
                        description: 'A dependency this endpoint relies on (e.g. the Jellyfin media server) was unreachable or returned a failure.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                            },
                        },
                    },
                },
            },
        },

        apis: annotationFiles,
    };

    const spec = swaggerJSDoc(options);

    spec.components = spec.components || {};
    spec.components.schemas = {
        ...(spec.components.schemas || {}),
        ...buildGeneratedComponentSchemas(),
    };

    spec.paths = spec.paths || {};
    mergeRegisteredRoutes(spec);

    return spec;
};


module.exports = {
    buildOpenApiSpec,
};
