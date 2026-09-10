/**
 * Builds the OpenAPI specification consumed by the runtime Swagger UI
 * endpoint and the `docs:api:build` CLI generation script.
 *
 * Combines three sources into one document: hand-written `@openapi`
 * comment-block annotations scanned from source files (via
 * `swagger-jsdoc`), component schemas generated directly from Sequelize
 * models (via `@techntools/sequelize-to-openapi`), and operations
 * registered by the code-first route registry
 * ({@link module:docs/openapi-route-registry}).
 *
 * @fileoverview OpenAPI specification builder.
 * @author Isaac Travers
 * @module docs/openapi
 */

const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');
const { SchemaManager, OpenApiStrategy } = require('@techntools/sequelize-to-openapi');
const db = require('../model');
const { getRegisteredOpenApiRoutes } = require('./openapi-route-registry');


/**
 * Absolute repository root, used to anchor annotation file globs instead of
 * `process.cwd()` so scanning behaves the same regardless of the directory
 * a script or the server happens to be run from.
 *
 * @constant
 * @type {string}
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');


/**
 * Convert a filesystem path to forward slashes for glob compatibility.
 *
 * `swagger-jsdoc`'s glob matching expects forward slashes; on Windows,
 * `path.join` produces backslashes, which would otherwise silently fail to
 * match any file.
 *
 * @param {string} filePath - Absolute or relative filesystem path.
 * @returns {string} Path with backslashes normalized to forward slashes.
 */
const normalizeGlobPath = (filePath) => {

    return filePath.replace(/\\/g, '/');
};

/**
 * Shared `@techntools/sequelize-to-openapi` schema manager instance used by
 * {@link buildGeneratedComponentSchemas} to derive component schemas from
 * Sequelize models.
 *
 * @constant
 * @type {SchemaManager}
 */
const schemaManager = new SchemaManager();

/**
 * OpenAPI generation strategy passed to `schemaManager.generate()`.
 *
 * @constant
 * @type {OpenApiStrategy}
 */
const openApiStrategy = new OpenApiStrategy();

/**
 * Unwrap array-wrapped `example` values left by `sequelize-to-openapi`.
 *
 * `@techntools/sequelize-to-openapi` requires model `jsonSchema.examples` to
 * be an array (it throws otherwise), then copies that array verbatim into
 * the OpenAPI `example` keyword, which is documented as a single scalar
 * value. Left alone, every generated property ends up as `example: [value]`
 * instead of `example: value`. This unwraps that mismatch after generation
 * so the spec's example values match what the API actually returns.
 *
 * @param {Object} schema - Generated OpenAPI schema object, mutated in place.
 * @returns {Object} The same schema object, returned for chaining.
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
 * Drop a redundant `anyOf` left over from narrowing a JSONB attribute's type.
 *
 * JSONB attributes map to a generic `anyOf: [object, array, boolean, ...]`
 * schema by default. A `jsonSchema.schema` override narrowing the type (e.g.
 * to a plain object) adds its own `type` key alongside that `anyOf` rather
 * than replacing it, leaving both present and redundant. This drops the
 * leftover `anyOf` whenever an explicit `type` narrowed it down.
 *
 * @param {Object} schema - Generated OpenAPI schema object, mutated in place.
 * @returns {Object} The same schema object, returned for chaining.
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
        modelKey: 'species_pictures',
        schemaName: 'SpeciesPicture',
        description:
            'One picture of one species. The bytes are on disk rather than in the database, so `filename` is a path relative to the picture storage directory; fetch the image itself from GET /api/species/pictures/{pictureId}.',
        propertyDescriptions: {
            created_at: 'Timestamp when the picture record was created.',
            updated_at: 'Timestamp when the picture record was last updated.',
        },
    },
    {
        modelKey: 'observations',
        schemaName: 'Observation',
        description:
            'Biological or habitat observation recorded during a MARP session. The fields available in a response may depend on the query and any Sequelize associations included by that endpoint.',
        propertyDescriptions: {},
    },
];

/**
 * Build OpenAPI component schemas for every entry in {@link GENERATED_SCHEMAS}.
 *
 * For each entry, generates a schema from the named Sequelize model (via
 * `schemaManager.generate()`), post-processes it with
 * {@link unwrapArrayExamples} and {@link dropRedundantAnyOf}, then applies
 * the entry's top-level `description` and any `propertyDescriptions` for
 * properties `sequelize-to-openapi` derives itself (e.g. `id`, `createdAt`)
 * that have no model attribute to attach `jsonSchema` to. Entries whose
 * `modelKey` is not present on `db` (a model not yet loaded) are skipped.
 *
 * @returns {Object<string, Object>} Map of schema name to generated OpenAPI schema.
 */
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

/**
 * Merge code-first route registry operations into a generated spec's paths.
 *
 * Reads every `{ method, path, operation }` entry accumulated by
 * {@link module:docs/openapi-route-registry.getRegisteredOpenApiRoutes} and
 * writes it onto `spec.paths[path][method]`, creating the path entry if it
 * does not already exist. Mutates `spec` in place; routes documented this
 * way never appear in `swagger-jsdoc`'s own annotation-scanned output, since
 * they have no `@openapi` comment block.
 *
 * @param {Object} spec - Generated OpenAPI specification object, mutated in place.
 * @returns {void}
 */
function mergeRegisteredRoutes(spec) {
    for (const { method, path: routePath, operation } of getRegisteredOpenApiRoutes()) {
        if (!spec.paths[routePath]) {
            spec.paths[routePath] = {};
        }

        spec.paths[routePath][method] = operation;
    }
}


/**
 * Build the complete OpenAPI specification for the MARP API.
 *
 * Scans `@openapi` comment blocks from the files listed in
 * `annotationFiles` via `swagger-jsdoc`, then layers on top of that result:
 * component schemas generated from Sequelize models
 * ({@link buildGeneratedComponentSchemas}) and paths/operations registered
 * through the code-first route registry ({@link mergeRegisteredRoutes}).
 * Called by both the runtime Swagger UI endpoint and the `docs:api:build`
 * CLI script, so every consumer sees the same merged document.
 *
 * @returns {Object} Complete OpenAPI 3.0.3 specification object.
 * @throws {Error} When `swagger-jsdoc` fails to parse an `@openapi` comment
 * block in one of the scanned files (`failOnErrors: true` below).
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
                title: 'MARP API',
                version: '1.0.0',
                description: 'Generated OpenAPI specification for MARP API V1 routes.',
            },

            servers: [
                {
                    url: '/api',
                    description: 'Relative API base path',
                },
            ],

            /**
             * Tags are named "V1 · <Domain>"/"V2 · <Domain>" specifically so
             * Swagger UI's grouping (which follows this array's order)
             * visually clusters all V1 domains together, separate from all
             * V2 domains -- every V1 route file's tags: [...] literals were
             * updated to match. V1 · tags are inherently transitional: as a
             * domain is migrated to a V2 equivalent, its V1 · tag simply
             * stops being used rather than needing a cleanup pass here.
             */
            tags: [
                {
                    /**
                     * Deliberately not "V1 ·"/"V2 ·" prefixed: these routes
                     * (defined directly in app.js, not through the
                     * code-first registry) serve the API documentation
                     * itself, not a versioned resource domain -- they apply
                     * equally regardless of which API version is being read.
                     */
                    name: 'Documentation',
                    description: 'Retrieve the generated OpenAPI specification (as JSON) or open the internal developer (JSDoc) documentation site.',
                },
                {
                    name: 'V1 · Health',
                    description: 'Service status and diagnostics.',
                },
                {
                    name: 'V1 · Users',
                    description: 'Create, update, and look up user accounts by id or name.',
                },
                {
                    name: 'V1 · Projects',
                    description: 'Create, update, and look up MARP projects by id or name, including projects a given user belongs to.',
                },
                {
                    name: 'V1 · Sessions',
                    description: 'Create, update, and look up dive/survey sessions, including sessions scoped to a user within a project.',
                },
                {
                    name: 'V1 · Species',
                    description: 'Create, update, and look up species records and their model_species linkage records used for ML model training/evaluation.',
                },
                {
                    name: 'V1 · Tasks',
                    description: 'Create, update, look up, and delete tasks.',
                },
                {
                    name: 'V1 · Keyframes',
                    description: 'Bulk-create, look up, update, and delete keyframe records associated with observations.',
                },
                {
                    name: 'V1 · Observations',
                    description:
                        'Access biological observation records and related data. These endpoints support observation retrieval, filtering, aggregation, review workflows, video-based queries, keyframe associations, and observation updates.'
                },
                {
                    name: 'V1 · Videos',
                    description: 'Observation queries scoped to a specific video_source, including cross-project video summaries and per-video observation listings.',
                },
                {
                    name: 'V1 · MachineLearning',
                    description: 'ML pipeline resources: datasets, dataset-observation links, ML models, training runs, epochs, and metrics (summary and curve) records.',
                },
                {
                    name: 'V1 · Schema',
                    description:
                        'Database schema introspection endpoints for tables, views, columns, constraints, indexes, and relationships in the public schema.'
                },
                {
                    name: 'V2 · Jellyfin',
                    description:
                        'V2 endpoints proxying the Jellyfin media server: library/folder browsing, search-by-name, and playback resolution. Jellyfin itself is never exposed to API consumers -- MARP holds the Jellyfin credentials and session, and the stream endpoint returns a short-lived redirect rather than requiring callers to know Jellyfin exists.'
                },
                {
                    name: 'V2 · Auth',
                    description:
                        'V2 authentication endpoints for MARP-owned local sign-in, session lifecycle management, and authenticated-user session context.'
                },
                {
                    name: 'V2 · Users',
                    description:
                        'V2 user-management endpoints: create/update/soft-delete users, view the permission catalog, and grant/revoke or change a user\'s local password. Every endpoint requires the `admin` permission.'
                },
                {
                    name: 'V2 · Tokens',
                    description:
                        'V2 service-application endpoints: register applications, issue/revoke/regenerate their bearer tokens, and grant/revoke token permissions from the same catalog used for users. A bearer token satisfies the `admin` permission the same way an admin user session does. Every endpoint requires the `admin` permission.'
                },
                {
                    /**
                     * Declared as "V2 ·" rather than "V1 ·" because that is what
                     * the operations actually carry: the route file declares
                     * `V1 · GpuCompute` in V1 terms, the way every route through
                     * registerVersionedRoute does, and the helper rewrites it.
                     * This entry is the group those rewritten operations land in.
                     */
                    name: 'V2 · GpuCompute',
                    description:
                        'Distributed GPU compute: the pool of enrolled machines, the jobs queued on it, and the five outbound calls a worker makes. Every direction of travel is worker-to-MARP -- there is no route by which MARP contacts a worker, and no field anywhere that could hold a worker\'s address, so cancel and pause are delivered as an action in the heartbeat response. Claiming a job is part of the poll transaction, so two machines polling at the same instant cannot lease one job, and every state-changing call carries (attempt_id, worker_id, lease_epoch) so a worker whose job was reassigned is told to abandon it rather than allowed to corrupt it.'
                }
            ],

            // Every route requires a credential now (#50). Declared here so the
            // documentation says so, and so Swagger UI offers somewhere to put one.
            security: [
                { bearerAuth: [] },
                { sessionCookie: [] },
            ],

            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        description:
                            'An application token, as `Authorization: Bearer svc_...`. Issued by `POST /api/v2/tokens`, or from the command line with `node scripts/create-application-token.js`. This is how the annotation GUI and the inference worker authenticate.',
                    },
                    sessionCookie: {
                        type: 'apiKey',
                        in: 'cookie',
                        name: 'marp.sid',
                        description:
                            'The session cookie set by `POST /api/v2/auth/login`. This is how the browser applications authenticate; a browser sends it automatically.',
                    },
                },

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

                    /**
                     * Request body schema for local username/password login.
                     *
                     * Used by POST /api/v2/auth/login.
                     */
                    AuthLoginRequest: {
                        type: 'object',
                        required: ['username', 'password'],
                        properties: {
                            username: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 64,
                                example: 'jane.diver',
                                description: 'Local username used to sign in to MARP.',
                            },
                            password: {
                                type: 'string',
                                minLength: 1,
                                example: 'correct horse battery staple',
                                description: 'Plaintext password used for local authentication.',
                            },
                        },
                    },

                    /**
                     * Safe session-user projection returned by auth endpoints.
                     *
                     * Deliberately narrower than the full `User` schema --
                     * matches authService#toSafeUser() (service/auth.service.js)
                     * exactly, which is the only shape these endpoints ever
                     * actually return. Never includes password_hash or any
                     * other auth_identities credential field.
                     */
                    AuthUser: {
                        type: 'object',
                        required: ['user_id', 'name', 'username', 'status', 'permissions'],
                        properties: {
                            user_id: {
                                type: 'integer',
                                example: 42,
                                description: 'Primary database identifier for the user.',
                            },
                            name: {
                                type: 'string',
                                example: 'Jane Diver',
                                description: 'Display name used by API and reporting views.',
                            },
                            username: {
                                type: 'string',
                                nullable: true,
                                example: 'jane.diver',
                                description: 'Local sign-in username, or null if this user has no local username set.',
                            },
                            status: {
                                type: 'string',
                                nullable: true,
                                enum: ['active', 'disabled', 'pending', 'deleted'],
                                example: 'active',
                                description: 'Authentication status for this user account.',
                            },
                            permissions: {
                                type: 'array',
                                items: { type: 'string' },
                                example: ['admin'],
                                description: 'Permission keys currently granted to this user, e.g. for client-side admin-UI visibility checks.',
                            },
                        },
                    },

                    /**
                     * Shared authenticated-user response envelope.
                     *
                     * Used by POST /api/v2/auth/login and GET /api/v2/auth/me
                     * to return the current session user as a standardized
                     * contract reference.
                     */
                    AuthSessionUserResponse: {
                        type: 'object',
                        required: ['user'],
                        properties: {
                            user: {
                                $ref: '#/components/schemas/AuthUser',
                            },
                        },
                        description: 'Authenticated session response containing the current MARP user profile.',
                    },

                    /**
                     * V2 user-management schemas (routes/v2_users.routes.js).
                     * UserWithPermissions extends the generated `User` schema
                     * (see GENERATED_SCHEMAS) rather than duplicating its
                     * fields, the same allOf pattern already used for
                     * Observation's association-bearing variants.
                     */
                    Permission: {
                        type: 'object',
                        required: ['permission_id', 'key'],
                        properties: {
                            permission_id: {
                                type: 'integer',
                                example: 1,
                                description: 'Unique identifier for this permission definition.',
                            },
                            key: {
                                type: 'string',
                                example: 'admin',
                                description: 'Stable machine-readable permission identifier (e.g. "admin"), referenced by requirePermission() checks.',
                            },
                            description: {
                                type: 'string',
                                nullable: true,
                                example: 'Full administrative access: create, update, and soft-delete users; view and change user permissions; set user passwords.',
                                description: 'Human-readable explanation of what this permission grants, shown in admin UI.',
                            },
                        },
                    },
                    UserWithPermissions: {
                        allOf: [
                            { $ref: '#/components/schemas/User' },
                            {
                                type: 'object',
                                required: ['permissions'],
                                properties: {
                                    permissions: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['admin'],
                                        description: 'Permission keys currently granted to this user.',
                                    },
                                },
                            },
                        ],
                        description: 'A user record together with their currently granted permission keys.',
                    },
                    UserCreateRequestV2: {
                        type: 'object',
                        required: ['name', 'username', 'password'],
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1,
                                example: 'Jane Diver',
                                description: 'Display name used by API and reporting views.',
                            },
                            username: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 64,
                                example: 'jane.diver',
                                description: 'Local sign-in username.',
                            },
                            password: {
                                type: 'string',
                                minLength: 1,
                                example: 'correct horse battery staple',
                                description: 'Initial plaintext password. Hashed with Argon2 before storage -- never stored or logged in plaintext.',
                            },
                            status: {
                                type: 'string',
                                nullable: true,
                                enum: ['active', 'disabled', 'pending', 'deleted'],
                                example: 'active',
                                description: 'Initial account status; defaults to "active" when omitted.',
                            },
                        },
                    },
                    UserUpdateRequestV2: {
                        type: 'object',
                        description: 'All fields are optional; only the fields provided are updated.',
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1,
                                example: 'Jane Diver',
                                description: 'New display name.',
                            },
                            username: {
                                type: 'string',
                                nullable: true,
                                minLength: 1,
                                maxLength: 64,
                                example: 'jane.diver',
                                description: 'New local sign-in username.',
                            },
                            status: {
                                type: 'string',
                                enum: ['active', 'disabled', 'pending', 'deleted'],
                                example: 'active',
                                description: 'New account status.',
                            },
                        },
                    },
                    SetPermissionsRequest: {
                        type: 'object',
                        required: ['permissionKeys'],
                        properties: {
                            permissionKeys: {
                                type: 'array',
                                items: { type: 'string' },
                                example: ['admin'],
                                description: 'Full desired set of permission keys for this user. Any currently-granted permission not in this list is revoked.',
                            },
                        },
                    },
                    SetPasswordRequest: {
                        type: 'object',
                        required: ['password'],
                        properties: {
                            password: {
                                type: 'string',
                                minLength: 1,
                                example: 'correct horse battery staple',
                                description: 'New plaintext password. Hashed with Argon2 before storage, with no old-password check.',
                            },
                        },
                    },

                    /**
                     * V2 service-application/token schemas (routes/v2_tokens.routes.js).
                     * ServiceToken never includes the token secret or hash;
                     * ServiceTokenIssued is the one place the raw secret
                     * ever appears, at issue/regenerate time only.
                     */
                    ServiceClient: {
                        type: 'object',
                        required: ['service_client_id', 'name', 'status', 'tokenCount'],
                        properties: {
                            service_client_id: {
                                type: 'integer',
                                example: 1,
                                description: 'Unique identifier for this application.',
                            },
                            name: {
                                type: 'string',
                                example: 'Reporting Worker',
                                description: 'Human-readable name identifying this application.',
                            },
                            description: {
                                type: 'string',
                                nullable: true,
                                example: 'Nightly job that pulls dashboard metrics.',
                                description: 'Optional freeform notes about what this application does or who owns it.',
                            },
                            status: {
                                type: 'string',
                                enum: ['active', 'disabled'],
                                example: 'active',
                                description: 'Lifecycle state of this application. A disabled application\'s tokens are all rejected regardless of their own state.',
                            },
                            created_by_user_id: {
                                type: 'integer',
                                nullable: true,
                                example: 19,
                                description: 'Audit-only reference to the admin who registered this application.',
                            },
                            last_used_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                                example: '2026-07-31T12:34:56.000Z',
                                description: 'Timestamp of the most recent successful bearer-token authentication for any token under this application.',
                            },
                            tokenCount: {
                                type: 'integer',
                                example: 2,
                                description: 'Number of tokens (of any status) issued under this application.',
                            },
                        },
                    },
                    ServiceToken: {
                        type: 'object',
                        required: ['service_token_id', 'service_client_id', 'token_prefix', 'status', 'permissions'],
                        properties: {
                            service_token_id: {
                                type: 'integer',
                                example: 1,
                                description: 'Unique identifier for this token.',
                            },
                            service_client_id: {
                                type: 'integer',
                                example: 1,
                                description: 'Foreign key referencing the owning application (service_clients.service_client_id).',
                            },
                            appName: {
                                type: 'string',
                                nullable: true,
                                example: 'Reporting Worker',
                                description: 'Display name of the owning application.',
                            },
                            token_prefix: {
                                type: 'string',
                                example: 'svc_a1b2c3d4',
                                description: 'Non-secret leading slice of the raw token, for identification only. Never the full secret.',
                            },
                            status: {
                                type: 'string',
                                enum: ['active', 'revoked', 'expired'],
                                example: 'active',
                                description: 'Derived status: "revoked" if explicitly revoked, "expired" if past expires_at, otherwise "active".',
                            },
                            expires_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                                example: '2027-07-31T00:00:00.000Z',
                                description: 'Optional expiration timestamp; null means the token does not expire on its own.',
                            },
                            revoked_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                                example: null,
                                description: 'Timestamp this token was revoked, if it has been.',
                            },
                            last_used_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                                example: '2026-07-31T12:34:56.000Z',
                                description: 'Timestamp of the most recent successful authentication with this specific token.',
                            },
                            permissions: {
                                type: 'array',
                                items: { type: 'string' },
                                example: ['admin'],
                                description: 'Permission keys currently granted to this token.',
                            },
                        },
                    },
                    ServiceTokenIssued: {
                        allOf: [
                            { $ref: '#/components/schemas/ServiceToken' },
                            {
                                type: 'object',
                                required: ['rawToken'],
                                properties: {
                                    rawToken: {
                                        type: 'string',
                                        example: 'svc_5f0m2q8k3z1x7v9w4t6y8u2r0p1n3l5j7h9g',
                                        description: 'The raw bearer token. Shown exactly once, in this response only -- it cannot be retrieved again afterward, only regenerated as a new token.',
                                    },
                                },
                            },
                        ],
                        description: 'A token record together with its one-time raw secret, returned only by issue and regenerate.',
                    },
                    ServiceClientCreateRequest: {
                        type: 'object',
                        required: ['name'],
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 120,
                                example: 'Reporting Worker',
                                description: 'Human-readable name identifying this application.',
                            },
                            description: {
                                type: 'string',
                                nullable: true,
                                example: 'Nightly job that pulls dashboard metrics.',
                                description: 'Optional freeform notes about what this application does or who owns it.',
                            },
                        },
                    },
                    ServiceClientUpdateRequest: {
                        type: 'object',
                        description: 'All fields are optional; only the fields provided are updated.',
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 120,
                                example: 'Reporting Worker',
                                description: 'New application name.',
                            },
                            description: {
                                type: 'string',
                                nullable: true,
                                example: 'Nightly job that pulls dashboard metrics.',
                                description: 'New description.',
                            },
                            status: {
                                type: 'string',
                                enum: ['active', 'disabled'],
                                example: 'active',
                                description: 'New status.',
                            },
                        },
                    },
                    ServiceTokenCreateRequest: {
                        type: 'object',
                        required: ['serviceClientId'],
                        properties: {
                            serviceClientId: {
                                type: 'integer',
                                example: 1,
                                description: 'Application this token authenticates as (service_clients.service_client_id).',
                            },
                            expiresAt: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                                example: '2027-07-31T00:00:00.000Z',
                                description: 'Optional expiration timestamp; omit or null for a token that does not expire on its own.',
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

                    /**
                     * Extends the generated `Session` schema with the joined
                     * processor and the two derived counts the session browser
                     * lists. None of it is derivable from the sessions model
                     * alone -- `video_source` is a column on observations, not
                     * sessions -- so it is hand-written here rather than
                     * generated (see model/session.model.js).
                     */
                    SessionWithDetail: {
                        allOf: [
                            { $ref: '#/components/schemas/Session' },
                            {
                                type: 'object',
                                description:
                                    'Session response carrying the processor who ran it plus the observation count and video sources derived from its observations. Served by GET /api/sessions/project/{projectID}.',
                                properties: {
                                    user: {
                                        allOf: [{ $ref: '#/components/schemas/User' }],
                                        nullable: true,
                                        description:
                                            'The processor who ran this session. Null when the session has no user_id, since sessions.user_id is nullable and such a session still belongs in the list.',
                                    },
                                    observationCount: {
                                        type: 'integer',
                                        minimum: 0,
                                        example: 143,
                                        description: 'How many observations were recorded against this session. Zero for a session that was opened but never annotated.',
                                    },
                                    video_sources: {
                                        type: 'array',
                                        description:
                                            "Distinct, non-empty video_source values across this session's observations, sorted. Usually one entry; more than one means the session's observations name several videos. Empty when the session has no observations, or none of them recorded a video source.",
                                        items: {
                                            type: 'string',
                                            example: '20251007_164658 Fwd.mp4',
                                        },
                                    },
                                },
                            },
                        ],
                    },

                    /**
                     * Extends the generated `Species` schema with its pictures, which
                     * Sequelize attaches only when a query includes them. Served by the
                     * annotation-list endpoints, since a client listing species for
                     * annotation wants the picture alongside the name rather than a
                     * second request per row.
                     */
                    SpeciesWithPictures: {
                        allOf: [
                            { $ref: '#/components/schemas/Species' },
                            {
                                type: 'object',
                                description: 'Species response including the pictures recorded for it.',
                                properties: {
                                    pictures: {
                                        type: 'array',
                                        description:
                                            'Pictures recorded for this species. Usually one, occasionally two, and empty for an entry with none. Exactly one carries is_default = true where any exist.',
                                        items: { $ref: '#/components/schemas/SpeciesPicture' },
                                    },
                                },
                            },
                        ],
                    },

                    /**
                     * The three schemas below extend the generated `Observation` schema
                     * with association data (keyframes, session, datasets) that Sequelize
                     * attaches only when a query's `include` asks for it. They aren't
                     * derivable from the Observation model alone, so they're hand-written
                     * here rather than generated (see model/observation.model.js).
                     */
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

                    /**
                     * The schemas below document custom report/aggregate routes whose
                     * response shape does not match any single Sequelize model. Each
                     * was derived from real response samples captured against the dev
                     * database (see docs/openapi-response-schema-workflow.md and the
                     * samples under samples/openapi-response/) rather than guessed from
                     * the route name or query code alone.
                     */
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
                                '2026-07-01': { 'Processor One': 89.41666666666667 },
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
                            width: { type: 'integer', example: 320, description: 'Tile-sheet generation width actually used -- either the width requested, or the auto-selected largest available width when none was requested.' },
                            availableWidths: {
                                type: 'array',
                                items: { type: 'integer' },
                                example: [320],
                                description: 'Every tile-sheet width Jellyfin has actually generated for this item. Pass one of these as the width query parameter on a future request to pick a specific one deliberately.',
                            },
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
                    TimecodeResyncPreview: {
                        type: 'object',
                        description:
                            'What a burnt-in clock reading would do to a session. `mode` says which of two operations it means, decided from the data rather than chosen by the caller.',
                        properties: {
                            sessionId: { type: 'integer', example: 3686 },
                            mode: {
                                type: 'string',
                                enum: ['establish-sync', 'correct-pointer'],
                                example: 'correct-pointer',
                                description: '`establish-sync` when the session records no clock at all, in which case the recorded times move and the pointers do not. `correct-pointer` when it does, in which case mediaPosition and each keyframe framenum move and the times do not.',
                            },
                            videoSource: { type: 'string', nullable: true, example: null },
                            fromMediaPosition: { type: 'string', nullable: true, example: null },
                            reading: {
                                type: 'object',
                                description: 'The comparison the decision was made from.',
                                properties: {
                                    mediaPosition: { type: 'string', example: '00:02:24.7600000', description: 'The frame the reading was taken on.' },
                                    dataSays: { type: 'string', example: '15:20:21.6400000', description: 'What the session records as the time at that frame.' },
                                    pictureSays: { type: 'string', example: '15:20:21.5200000', description: 'What the clock burnt into it read.' },
                                    differenceMs: { type: 'integer', example: 120, description: 'Positive when the data thinks it is later than the picture does.' },
                                },
                            },
                            shiftMs: { type: 'integer', example: 120, description: 'What is added -- to mediaPosition in pointer mode, to actualPosition in establish mode.' },
                            frames: { type: 'number', example: 3, description: 'The same shift in frames. A whole number in pointer mode.' },
                            observationsInScope: { type: 'integer', example: 420 },
                            observationsToCorrect: { type: 'integer', example: 420 },
                            keyframesToCorrect: { type: 'integer', example: 2988, description: 'Zero in establish mode, since keyframes are not touched.' },
                            timesUnchanged: { type: 'boolean', example: true, description: 'True in pointer mode: tc, etc, actualPosition and frame are left exactly as recorded.' },
                            pointersUnchanged: { type: 'boolean', example: false, description: 'True in establish mode: mediaPosition and framenum are left exactly as recorded.' },
                            partial: { type: 'boolean', example: false, description: 'True when some observations cannot be read and would be left alone. Refused unless allowPartial is set.' },
                            counts: {
                                type: 'object',
                                description: 'Per-column tallies. Which keys appear depends on the mode.',
                                additionalProperties: { type: 'integer' },
                            },
                            undoWith: {
                                type: 'object',
                                description: 'How to reverse this. Nothing records that it happened, so it is worth keeping. `frames` in pointer mode, `shiftMs` in establish mode.',
                                additionalProperties: { type: 'integer' },
                            },
                            sample: {
                                type: 'array',
                                description: 'A few observations spread across the scope. Its shape depends on the mode.',
                                items: { type: 'object', additionalProperties: true },
                            },
                        },
                    },
                    TimecodeResyncResult: {
                        allOf: [
                            { $ref: '#/components/schemas/TimecodeResyncPreview' },
                            {
                                type: 'object',
                                properties: {
                                    applied: { type: 'boolean', example: true },
                                    observationsCorrected: { type: 'integer', example: 96 },
                                },
                            },
                        ],
                    },

                    /**
                     * GPU orchestration schemas (routes/gpu.routes.js).
                     *
                     * The worker-facing half of these is a contract with a
                     * program running on somebody else's machine, so the shapes
                     * are written out in full rather than left as free-form
                     * objects -- a worker cannot ask what MARP meant.
                     */
                    GpuJobSpec: {
                        type: 'object',
                        description:
                            'The whole of what a worker is being asked to do. `range` is always present, even for a whole video, so nothing has to special-case the undivided case. Additional properties are allowed: the engine-specific parts of a spec belong to the worker, and MARP validates only the parts it schedules on.',
                        required: ['engine', 'video', 'range'],
                        additionalProperties: true,
                        properties: {
                            engine: {
                                type: 'string',
                                example: 'ultralytics',
                                description: 'Which inference engine is to run this.',
                            },
                            model: {
                                type: 'object',
                                description: 'The weights to run. Named and hashed, so a result can be tied to exactly what produced it.',
                                additionalProperties: true,
                                properties: {
                                    name: { type: 'string', example: 'yolov8-marine-fish-2025' },
                                    sha256: { type: 'string', example: 'd5f2c1b0a9e8d7c6b5a4938271605f4e3d2c1b0a9e8d7c6b5a4938271605f4e3' },
                                    ml_model_id: {
                                        type: 'integer',
                                        example: 91,
                                        description: 'Which registered `ml_models` row this is. Required whenever `session` is given, because every ingested observation records the model that produced it and the model\'s trained-species list is what settles a common name that more than one species carries. `sha256` identifies the weights the worker verifies; it cannot identify a registry row, since `ml_models` holds no hash column.',
                                    },
                                },
                            },
                            video: {
                                type: 'object',
                                description:
                                    'What to process. **A worker is handed a source it can open and knows nothing about MARP or Jellyfin**, so a worker can process any reachable video and not only a Jellyfin item.\n\n'
                                    + '**On submission, exactly one of `jellyfin_item_id` or `url`.** Both together is refused rather than one silently winning. An item id is resolved to a playable URL when the job is leased -- not when it is queued, because a stream URL carries its own media credential and one minted at submission would rot in the queue -- and the stored spec keeps what was submitted rather than being rewritten. A bare `url` is handed over exactly as it was given.\n\n'
                                    + '**On a lease, `url` is always present.** That is the coordinator\'s guarantee to the worker. `jellyfin_item_id` travels through to the worker unchanged as opaque provenance for it to echo into its output; a worker never resolves one.',
                                additionalProperties: true,
                                properties: {
                                    url: {
                                        type: 'string',
                                        example: 'http://media.example.org/Videos/a1b2c3d4e5f60718293a4b5c6d7e8f90/stream?static=true',
                                        description: 'A source the worker can open. Required on submission when no `jellyfin_item_id` is given, and always present on a leased spec.',
                                    },
                                    jellyfin_item_id: {
                                        type: 'string',
                                        example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
                                        description: 'Which Jellyfin item this came from. Provenance only: MARP resolves it, the worker never does.',
                                    },
                                    source_name: {
                                        type: 'string',
                                        nullable: true,
                                        example: 'MARE_2024_Dive07_cam1.mp4',
                                        description: 'What appears as `video_source` on every observation the run produces. Required on submission with a bare `url`, since it cannot be guessed from one; optional with an item id, where the Jellyfin item supplies it.',
                                    },
                                },
                            },
                            session: {
                                type: 'object',
                                description:
                                    'Where this job\'s observations go. Optional -- a run whose only purpose is a raw detections artifact is legitimate -- but a job that gives it must also give `model.ml_model_id`, and a job without it produces no observations at all.\n\n'
                                    + '**Exactly one form.** `session_id` names a session that already exists; `project_id`, `dive`, `line` and `type` together carry enough for one to be found or created. Both together is refused rather than one silently winning.\n\n'
                                    + '**A session is a dive and a line, never a video.** `sessions` has no video column, so a session may span several videos and the video reference lives on the observation instead, as `video_source` and `jellyfin_item_id`. The submitter owns this: project, dive and line are human decisions and are not recoverable from a video and a frame range, so the coordinator does not invent scientific groupings.\n\n'
                                    + '`type` is checked against the model rather than trusted -- an inverts model\'s output belongs in an inverts session, and a mismatch is wrong in a way nothing downstream would complain about.',
                                additionalProperties: false,
                                properties: {
                                    session_id: { type: 'integer', example: 142, description: 'An existing session. Given on its own.' },
                                    project_id: { type: 'integer', example: 43, description: 'Project the session belongs to.' },
                                    dive: { type: 'string', example: 'Dive 8', description: 'Dive name.' },
                                    line: { type: 'string', example: '1000', description: 'Line name.' },
                                    type: { type: 'string', example: 'Invert', description: 'Session type: `Fish`, `Invert` or `GULF_Fish`. What the annotation GUI routes on.' },
                                },
                            },
                            range: {
                                type: 'object',
                                description: 'The frames to process. **Half-open: `start_frame` is included and `end_frame` is one past the last frame**, so the frames covered are `end_frame - start_frame` and consecutive pieces of a split video share a bound -- the `end_frame` of one piece is the `start_frame` of the next. Nothing is processed twice and nothing is missed. `end_frame` must be greater than `start_frame`; equal bounds are the empty range and are refused. A whole video is `[0, frame_count)`. This is the contract a worker is built against; a human-facing view may still read "frames 0-999", which is presentation rather than the contract.',
                                required: ['start_frame', 'end_frame'],
                                properties: {
                                    start_frame: { type: 'integer', minimum: 0, example: 0, description: 'First frame to process, included.' },
                                    end_frame: { type: 'integer', minimum: 1, example: 9000, description: 'One past the last frame to process, excluded. `[0, 9000)` is nine thousand frames.' },
                                },
                            },
                            params: {
                                type: 'object',
                                description: 'Engine parameters, passed through untouched -- with one exception, `data_type`, which the coordinator fills at lease time.',
                                additionalProperties: true,
                                properties: {
                                    conf: { type: 'number', example: 0.25 },
                                    iou: { type: 'number', example: 0.7 },
                                    imgsz: { type: 'integer', example: 1280 },
                                    tracker: { type: 'string', nullable: true, example: 'botsort.yaml' },
                                    data_type: {
                                        type: 'string',
                                        example: 'Invert',
                                        description: 'Which survey convention decides the frame a track is counted at: a fish when its centre crosses near the bottom of frame, an invertebrate when it enters the bottom-centre trapezoid. **This changes which frame becomes the observation, and therefore its timecode**, so it is not a tuning parameter.\n\n'
                                            + 'Left alone when submitted; otherwise **filled from `session.type` when the job is leased**, since the worker knows nothing about MARP and cannot know which discipline is being surveyed. A session type the engine has no rule for is refused rather than defaulted, because the engine falls back to the first frame of a track with no error.',
                                    },
                                },
                            },
                            reduction: {
                                type: 'object',
                                description: 'Which reduction the worker is to apply to its raw detections, named and versioned so two runs can be compared knowing whether they were reduced the same way.',
                                additionalProperties: true,
                                properties: {
                                    name: { type: 'string', example: 'v3_dirpad' },
                                    version: { type: 'integer', example: 1 },
                                },
                            },
                        },
                    },
                    GpuWorker: {
                        type: 'object',
                        description:
                            'One GPU machine enrolled in the compute pool. Deliberately carries no address of any kind: a worker dials out to MARP and MARP never dials a worker, so there is nowhere for a host, port or URL to be recorded. Nor does it carry the machine\'s durable id: that is its identity, it is kept internal, and `worker_id` is the stable handle to address a machine by.',
                        properties: {
                            worker_id: { type: 'integer', example: 3, description: 'Identifier the worker quotes on every later call, and the handle a rename addresses. Stable for the life of the machine\'s enrolment.' },
                            name: { type: 'string', example: 'office-3090', description: 'What the machine is called, for people. Editable metadata rather than identity: not unique, and a re-enrolment does not overwrite it.' },
                            state: {
                                type: 'string',
                                enum: ['online', 'offline', 'paused'],
                                example: 'online',
                                description: 'Lifecycle state. `paused` takes a machine out of rotation without un-enrolling it; its running attempt is told to pause at the next heartbeat.',
                            },
                            slot_count: { type: 'integer', example: 2, description: 'How many attempts this machine will run at once.' },
                            worker_version: { type: 'string', nullable: true, example: '0.4.1' },
                            capabilities: {
                                type: 'object',
                                nullable: true,
                                additionalProperties: true,
                                description: 'GPUs and VRAM, driver, disk, engines and ranges supported, as the worker reported them. Not verified by MARP.',
                                example: { gpus: [{ name: 'NVIDIA RTX 3090', vram_mb: 24576 }], driver: '560.94', engines: ['ultralytics'] },
                            },
                            enrolled_at: { type: 'string', format: 'date-time', description: 'When this machine was first seen.' },
                            last_seen_at: { type: 'string', format: 'date-time', nullable: true, description: 'Coordinator clock reading at the last poll or heartbeat.' },
                        },
                    },
                    GpuPoolAttempt: {
                        type: 'object',
                        description: 'What one machine is running right now, as the pool view reports it.',
                        properties: {
                            attempt_id: { type: 'integer', example: 118 },
                            state: {
                                type: 'string',
                                enum: ['assigned', 'preparing', 'running', 'uploading'],
                                example: 'running',
                                description: 'Only live states appear here; a finished attempt is no longer part of the pool view.',
                            },
                            slot_index: { type: 'integer', example: 0 },
                            lease_epoch: { type: 'integer', example: 1 },
                            lease_expires_at: { type: 'string', format: 'date-time' },
                            last_heartbeat_at: { type: 'string', format: 'date-time', nullable: true },
                            progress: {
                                type: 'object',
                                description: 'The latest heartbeat\'s progress, overwritten in place rather than accumulated.',
                                properties: {
                                    done: { type: 'integer', nullable: true, example: 4210 },
                                    total: { type: 'integer', nullable: true, example: 9000 },
                                    unit: { type: 'string', nullable: true, example: 'frames' },
                                },
                            },
                            job: {
                                type: 'object',
                                description: 'The job being attempted, in summary.',
                                properties: {
                                    job_id: { type: 'integer', example: 41 },
                                    kind: { type: 'string', example: 'inference' },
                                    state: { type: 'string', example: 'leased' },
                                    batch_id: { type: 'string', format: 'uuid', nullable: true },
                                },
                            },
                        },
                    },
                    GpuPoolWorker: {
                        allOf: [
                            { $ref: '#/components/schemas/GpuWorker' },
                            {
                                type: 'object',
                                properties: {
                                    activity: {
                                        type: 'string',
                                        enum: ['idle', 'busy', 'offline', 'paused'],
                                        example: 'busy',
                                        description: 'Derived rather than stored, so it cannot fall out of step with the attempts table. A machine is busy exactly while it holds a live attempt.',
                                    },
                                    attempts: {
                                        type: 'array',
                                        description: 'The live attempts this machine holds, one per busy slot. Empty for an idle machine.',
                                        items: { $ref: '#/components/schemas/GpuPoolAttempt' },
                                    },
                                },
                            },
                        ],
                    },
                    GpuJob: {
                        type: 'object',
                        description:
                            'One unit of GPU work. This row is the truth about the job; a worker\'s report about it is evidence. Nothing a worker sends sets `state` to `succeeded` directly -- the coordinator decides that when it accepts a terminal result, and `published_attempt_id` records which attempt it accepted.',
                        properties: {
                            id: { type: 'integer', example: 41 },
                            batch_id: {
                                type: 'string',
                                format: 'uuid',
                                nullable: true,
                                description: 'Groups the pieces of one split video. A split video is N jobs sharing this, not one job with children, so each piece leases, retries and fails independently.',
                            },
                            kind: { type: 'string', enum: ['inference', 'tracking', 'training', 'diagnostic'], example: 'inference' },
                            spec: { $ref: '#/components/schemas/GpuJobSpec' },
                            state: {
                                type: 'string',
                                enum: ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired'],
                                example: 'leased',
                                description: '`expired` is distinct from `failed`: nothing went wrong with the work, MARP simply stopped hearing from every machine that tried it.',
                            },
                            priority: { type: 'integer', example: 0, description: 'Higher is claimed first.' },
                            attempts_made: { type: 'integer', example: 1, description: 'How many times this job has been leased; also the current attempt\'s lease epoch.' },
                            max_attempts: { type: 'integer', example: 3 },
                            published_attempt_id: {
                                type: 'integer',
                                nullable: true,
                                example: null,
                                description: 'The attempt whose result was recorded. Set once and never overwritten, so a second attempt cannot replace the first one\'s artifacts.',
                            },
                            created_by: { type: 'integer', nullable: true, description: 'User who submitted it. Null when an application token did.' },
                            created_at: { type: 'string', format: 'date-time' },
                            updated_at: { type: 'string', format: 'date-time' },
                        },
                    },
                    GpuJobAttempt: {
                        type: 'object',
                        description:
                            'One machine\'s attempt at one job. A job may be attempted more than once; an attempt belongs to exactly one worker and carries the lease that makes its reports believable.',
                        properties: {
                            id: { type: 'integer', example: 118 },
                            job_id: { type: 'integer', example: 41 },
                            worker_id: { type: 'integer', example: 3 },
                            slot_index: { type: 'integer', example: 0 },
                            lease_epoch: {
                                type: 'integer',
                                example: 1,
                                description: 'The job\'s attempt ordinal when this lease was granted. Every state-changing call carries it, and a mismatch is answered `abandon`.',
                            },
                            state: {
                                type: 'string',
                                enum: ['assigned', 'preparing', 'running', 'uploading', 'succeeded', 'failed', 'cancelled', 'preempted', 'abandoned'],
                                example: 'running',
                                description: 'The first four are the worker\'s own report of where it is. The rest are terminal and only the coordinator writes them.',
                            },
                            leased_at: { type: 'string', format: 'date-time' },
                            lease_expires_at: { type: 'string', format: 'date-time', description: 'Compared against the coordinator\'s clock only. A worker\'s idea of the time never decides whether its lease is still good.' },
                            last_heartbeat_at: { type: 'string', format: 'date-time', nullable: true },
                            progress_done: { type: 'integer', nullable: true, example: 4210 },
                            progress_total: { type: 'integer', nullable: true, example: 9000 },
                            progress_unit: { type: 'string', nullable: true, example: 'frames' },
                            capabilities_snapshot: {
                                type: 'object',
                                nullable: true,
                                additionalProperties: true,
                                description: 'What the machine said it had when it took this lease, kept here because the worker row moves on and a result has to stay explainable.',
                            },
                            failure_reason: { type: 'string', nullable: true, example: 'CUDA out of memory at frame 5120.' },
                            finished_at: { type: 'string', format: 'date-time', nullable: true },
                            worker: {
                                type: 'object',
                                description: 'The machine that held it, in summary.',
                                properties: {
                                    id: { type: 'integer', example: 3 },
                                    name: { type: 'string', example: 'office-3090' },
                                    state: { type: 'string', example: 'online' },
                                },
                            },
                        },
                    },
                    GpuWorkerRenameRequest: {
                        type: 'object',
                        description: 'A new name for a machine. The name is metadata, so this is the whole request.',
                        required: ['name'],
                        properties: {
                            name: {
                                type: 'string',
                                maxLength: 255,
                                example: 'office-3090',
                                description: 'What to call the machine from now on. Need not be unique -- two machines are two rows because their durable ids differ, not because their names do -- and survives the machine\'s next enrolment.',
                            },
                        },
                    },
                    GpuWorkerEnrolRequest: {
                        type: 'object',
                        description: 'What a machine says about itself when joining the pool.',
                        required: ['local_id', 'name'],
                        properties: {
                            local_id: {
                                type: 'string',
                                maxLength: 128,
                                example: 'a0294ccd-9fca-462e-8ba3-b5a6f5b380e3',
                                description: 'The durable id this machine generated for itself once and keeps across restarts. **This is the identity enrolment keys on**: enrolling twice with one id updates that machine rather than adding a second, which is what lets the name be renamed freely. Opaque to MARP -- a uuid in practice, but nothing depends on that.',
                            },
                            name: { type: 'string', maxLength: 255, example: 'office-3090', description: 'What to call the machine. Used only when this id is new; a machine already enrolled keeps the name it currently has, so an operator\'s rename is not undone at the next restart.' },
                            capabilities: {
                                type: 'object',
                                additionalProperties: true,
                                description: 'GPUs and VRAM, driver, disk, engines, ranges supported.',
                                example: { gpus: [{ name: 'NVIDIA RTX 3090', vram_mb: 24576 }], driver: '560.94', engines: ['ultralytics'] },
                            },
                            slot_count: { type: 'integer', minimum: 1, example: 2, description: 'How many attempts it will run at once. Defaults to 1.' },
                            worker_version: { type: 'string', example: '0.4.1' },
                        },
                    },
                    GpuWorkerEnrolResponse: {
                        type: 'object',
                        description: 'The identity to quote on every later call, and the heartbeat interval MARP expects. The durable id is not echoed back: the worker already has it, and nothing else needs it.',
                        properties: {
                            worker_id: { type: 'integer', example: 3 },
                            name: { type: 'string', example: 'office-3090', description: 'What the machine is currently called, which for a machine that was renamed is not the name this enrolment sent.' },
                            state: { type: 'string', enum: ['online', 'offline', 'paused'], example: 'online' },
                            slot_count: { type: 'integer', example: 2 },
                            heartbeat_seconds: {
                                type: 'integer',
                                example: 10,
                                description: 'How often to heartbeat. Set by the coordinator so a fleet can be told to beat faster or slower without touching any machine.',
                            },
                            lease_seconds: { type: 'integer', example: 60, description: 'How long a lease survives without a heartbeat.' },
                        },
                    },
                    GpuPollRequest: {
                        type: 'object',
                        description: 'A worker asking for work. There is no separate claim call: claiming is part of this request\'s transaction.',
                        required: ['worker_id'],
                        properties: {
                            worker_id: { type: 'integer', example: 3 },
                            capabilities: {
                                type: 'object',
                                additionalProperties: true,
                                description: 'Current hardware, snapshotted onto whatever attempt this poll opens.',
                            },
                            slot_indexes: {
                                type: 'array',
                                items: { type: 'integer' },
                                example: [0, 1],
                                description: 'Slots the worker has free. The first is recorded on the attempt; which slot runs what is the worker\'s own bookkeeping.',
                            },
                            wait_seconds: {
                                type: 'integer',
                                minimum: 0,
                                example: 30,
                                description: 'How long to hold the request open waiting for work to appear. Capped by the coordinator. Zero answers immediately.',
                            },
                        },
                    },
                    GpuLease: {
                        type: 'object',
                        description: 'A job, and the lease on it. Returned by a poll that found work.',
                        properties: {
                            job_id: { type: 'integer', example: 41 },
                            attempt_id: { type: 'integer', example: 118, description: 'Quote this, with worker_id and lease_epoch, on every later call about this job.' },
                            lease_epoch: { type: 'integer', example: 1 },
                            lease_expires_at: { type: 'string', format: 'date-time' },
                            heartbeat_seconds: { type: 'integer', example: 10 },
                            slot_index: { type: 'integer', example: 0 },
                            kind: { type: 'string', enum: ['inference', 'tracking', 'training', 'diagnostic'], example: 'inference' },
                            batch_id: { type: 'string', format: 'uuid', nullable: true },
                            spec: { $ref: '#/components/schemas/GpuJobSpec' },
                        },
                    },
                    GpuHeartbeatRequest: {
                        type: 'object',
                        description: 'Progress in, control out. The state a worker may claim here is deliberately narrow.',
                        required: ['worker_id', 'lease_epoch'],
                        properties: {
                            worker_id: { type: 'integer', example: 3 },
                            lease_epoch: { type: 'integer', example: 1 },
                            state: {
                                type: 'string',
                                enum: ['preparing', 'running', 'uploading'],
                                example: 'running',
                                description: 'Where the worker says it is. A terminal state is not accepted here: a finished attempt is reported through the result route, which is what decides what it means.',
                            },
                            progress: {
                                type: 'object',
                                description: 'Small, and overwritten in place. Anything durable belongs in the events route instead.',
                                properties: {
                                    done: { type: 'integer', example: 4210 },
                                    total: { type: 'integer', example: 9000 },
                                    unit: { type: 'string', example: 'frames' },
                                },
                            },
                        },
                    },
                    GpuHeartbeatResponse: {
                        type: 'object',
                        description:
                            'The one channel by which MARP tells a worker to do anything. Cancel, pause and abandon are delivered only here, because there is no route from MARP to a worker.',
                        properties: {
                            action: {
                                type: 'string',
                                enum: ['continue', 'cancel', 'pause', 'abandon'],
                                example: 'continue',
                                description: '`cancel` when the job was cancelled, `pause` when the machine has been paused, `abandon` when this lease is no longer the live one -- stop and discard, the job belongs to somebody else now.',
                            },
                            reason: { type: 'string', nullable: true, example: 'lease epoch 1 is stale; this attempt is at epoch 2', description: 'Why, for anything but `continue`. Worth logging on the worker: it is the only explanation it will get.' },
                            lease_expires_at: { type: 'string', format: 'date-time', nullable: true, description: 'The extended lease. Null when the answer is `abandon`, because there is no longer a lease.' },
                            heartbeat_seconds: { type: 'integer', example: 10 },
                        },
                    },
                    GpuEventsRequest: {
                        type: 'object',
                        description:
                            'A batch of durable metrics and log lines. Keyed `(attempt_id, seq)`, so resending a batch whose answer was never seen inserts nothing the second time.',
                        required: ['worker_id', 'lease_epoch', 'events'],
                        properties: {
                            worker_id: { type: 'integer', example: 3 },
                            lease_epoch: { type: 'integer', example: 1 },
                            events: {
                                type: 'array',
                                minItems: 1,
                                description: 'The batch. Sequence numbers are the worker\'s own counter for this attempt, start at zero, and must not repeat within a batch.',
                                items: {
                                    type: 'object',
                                    required: ['seq', 'kind'],
                                    properties: {
                                        seq: { type: 'integer', minimum: 0, example: 17 },
                                        kind: {
                                            type: 'string',
                                            enum: ['metric', 'log'],
                                            example: 'metric',
                                            description: 'A worker sends metrics and log lines. `note` is the coordinator\'s own kind and is refused here, so the record of why a lease was taken away stays trustworthy.',
                                        },
                                        at: { type: 'string', format: 'date-time', description: 'When the worker says it happened. Evidence, not a clock anything is judged on.' },
                                        payload: { type: 'object', additionalProperties: true, example: { frames_per_second: 41.2 } },
                                    },
                                },
                            },
                        },
                    },
                    GpuEventsResponse: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['continue', 'abandon'], example: 'continue', description: '`abandon` when the lease quoted is not the live one, in which case nothing was written.' },
                            reason: { type: 'string', nullable: true },
                            accepted: { type: 'integer', example: 12, description: 'How many events were new.' },
                            duplicates: { type: 'integer', example: 0, description: 'How many were already held. A replay reports every event as a duplicate, which is the expected answer rather than an error.' },
                            next_seq: { type: 'integer', nullable: true, example: 18, description: 'The sequence number to use next. Null when the batch was refused.' },
                        },
                    },
                    GpuResultRequest: {
                        type: 'object',
                        description:
                            'An attempt\'s terminal report. Idempotent: sending it twice does not produce two results, and every artifact it names must already have been handed over.',
                        required: ['worker_id', 'lease_epoch', 'outcome'],
                        properties: {
                            worker_id: { type: 'integer', example: 3 },
                            lease_epoch: { type: 'integer', example: 1 },
                            outcome: {
                                type: 'string',
                                enum: ['succeeded', 'failed', 'cancelled'],
                                example: 'succeeded',
                                description: 'What the worker says happened. What it means for the job is the coordinator\'s decision: a failure with attempts left requeues the job rather than failing it.',
                            },
                            failure_reason: { type: 'string', example: 'CUDA out of memory at frame 5120.' },
                            artifacts: {
                                type: 'array',
                                description: 'What was produced, by hash. Each must already be staged through the check and upload routes, or the report is refused.',
                                items: {
                                    type: 'object',
                                    required: ['sha256'],
                                    properties: {
                                        sha256: { type: 'string', example: 'd5f2c1b0a9e8d7c6b5a4938271605f4e3d2c1b0a9e8d7c6b5a4938271605f4e3' },
                                        role: { type: 'string', example: 'detections', description: 'What this artifact is to the job. Recorded as the artifact type. Defaults to `result`.' },
                                    },
                                },
                            },
                        },
                    },
                    GpuResultResponse: {
                        type: 'object',
                        description: 'The ack. Safe to receive more than once, and says plainly whether this attempt is the one that published.',
                        properties: {
                            action: { type: 'string', enum: ['continue', 'abandon'], example: 'continue' },
                            accepted: { type: 'boolean', example: true },
                            idempotent: { type: 'boolean', example: false, description: 'True when this was a replay of a report already recorded, answered from the stored rows rather than reapplied.' },
                            outcome: { type: 'string', example: 'succeeded' },
                            job_id: { type: 'integer', example: 41 },
                            job_state: { type: 'string', example: 'succeeded' },
                            published: {
                                type: 'boolean',
                                example: true,
                                description: 'Whether this attempt\'s result became the job\'s result. False when another attempt had already published, in which case this attempt still records its own success and the job keeps the first result.',
                            },
                            published_attempt_id: { type: 'integer', nullable: true, example: 118 },
                            artifacts_recorded: { type: 'integer', example: 2 },
                            reason: { type: 'string', nullable: true },
                        },
                    },
                    GpuArtifactCheckRequest: {
                        type: 'object',
                        description: 'The first half of the hand-off: asking whether MARP already holds these bytes.',
                        required: ['sha256'],
                        properties: {
                            sha256: { type: 'string', example: 'd5f2c1b0a9e8d7c6b5a4938271605f4e3d2c1b0a9e8d7c6b5a4938271605f4e3', description: '64 lower-case hexadecimal characters. One spelling only, so two spellings of a hash cannot each get their own copy.' },
                            bytes: { type: 'integer', minimum: 0, example: 41205310, description: 'How large the file is, as the worker measures it.' },
                        },
                    },
                    GpuArtifactCheckResponse: {
                        type: 'object',
                        description: 'Either "already have it" or where to put it.',
                        properties: {
                            already_have: { type: 'boolean', example: false, description: 'True when MARP holds these bytes, in which case the upload can be skipped entirely.' },
                            sha256: { type: 'string' },
                            bytes: { type: 'integer', nullable: true },
                            upload_url: { type: 'string', nullable: true, example: '/api/v2/gpu/artifacts/upload/d5f2c1b0a9e8d7c6b5a4938271605f4e3d2c1b0a9e8d7c6b5a4938271605f4e3', description: 'Where to stream the bytes. Null when they are already held.' },
                            path: { type: 'string', nullable: true, example: 'gpu-artifacts/d5f2c1b0a9e8d7c6b5a4938271605f4e3d2c1b0a9e8d7c6b5a4938271605f4e3', description: 'Where MARP keeps them, relative to its storage directory. Present only when they are already held.' },
                        },
                    },
                    GpuArtifactUploadResponse: {
                        type: 'object',
                        description: 'The bytes arrived and their hash matched.',
                        properties: {
                            sha256: { type: 'string' },
                            bytes: { type: 'integer', example: 41205310, description: 'How many bytes were actually received and hashed.' },
                            content_type: { type: 'string', nullable: true, example: 'application/json' },
                            path: { type: 'string', example: 'gpu-artifacts/d5f2c1b0a9e8d7c6b5a4938271605f4e3d2c1b0a9e8d7c6b5a4938271605f4e3' },
                            already_have: { type: 'boolean', example: true },
                        },
                    },
                    GpuJobSubmitRequest: {
                        type: 'object',
                        description: 'Queue work. One job, or -- with `piece_frames` -- a batch covering a long video in pieces.',
                        required: ['kind', 'spec'],
                        properties: {
                            kind: { type: 'string', enum: ['inference', 'tracking', 'training', 'diagnostic'], example: 'inference' },
                            spec: { $ref: '#/components/schemas/GpuJobSpec' },
                            priority: { type: 'integer', example: 0, description: 'Higher is claimed first. Defaults to 0.' },
                            max_attempts: { type: 'integer', minimum: 1, example: 3, description: 'How many times a piece may be attempted before a failure or expiry is final. Defaults to 3.' },
                            piece_frames: {
                                type: 'integer',
                                minimum: 1,
                                example: 9000,
                                description: 'Split the spec\'s range into pieces of this many frames, each its own job, all sharing one batch_id. Omit for a single job. Piece k is `[start + k*piece_frames, start + (k+1)*piece_frames)`, clipped to the end of the range -- so the pieces tile the range exactly, consecutive pieces share a bound, and the last piece is short rather than over-long.',
                            },
                        },
                    },
                    GpuJobSubmitResponse: {
                        type: 'object',
                        properties: {
                            batch_id: { type: 'string', format: 'uuid', nullable: true, description: 'Null when the submission was a single job; set when it was split, and the way to find the pieces again.' },
                            jobs: { type: 'array', items: { $ref: '#/components/schemas/GpuJob' } },
                        },
                    },
                    GpuJobList: {
                        type: 'object',
                        properties: {
                            jobs: { type: 'array', items: { $ref: '#/components/schemas/GpuJob' } },
                            total: { type: 'integer', example: 128, description: 'How many jobs matched, not how many were returned.' },
                            limit: { type: 'integer', example: 50 },
                            offset: { type: 'integer', example: 0 },
                        },
                    },
                    GpuJobDetail: {
                        type: 'object',
                        description: 'One job, every attempt at it, and everything it produced.',
                        properties: {
                            job: { $ref: '#/components/schemas/GpuJob' },
                            attempts: { type: 'array', items: { $ref: '#/components/schemas/GpuJobAttempt' }, description: 'In lease-epoch order, so the history reads forwards.' },
                            artifacts: { type: 'array', items: { $ref: '#/components/schemas/Artifact' } },
                        },
                    },
                    GpuJobCancelResponse: {
                        type: 'object',
                        properties: {
                            job: { $ref: '#/components/schemas/GpuJob' },
                            changed: {
                                type: 'boolean',
                                example: true,
                                description: 'False for a job that had already finished, which is not an error -- cancelling something finished simply does nothing.',
                            },
                        },
                    },
                    GpuJobIngestResponse: {
                        type: 'object',
                        description:
                            'What one job\'s result became in the annotation record. `ingested` is false without being an error when the job\'s observations were already present -- `already_ingested` then says how many rows there are.',
                        properties: {
                            job_id: { type: 'integer', example: 1256 },
                            ingested: { type: 'boolean', example: true, description: 'Whether this call wrote anything.' },
                            already_ingested: { type: 'integer', example: 0, description: 'Observations this job had already produced. Non-zero means nothing was written this time.' },
                            session_id: { type: 'integer', example: 142, description: 'Session the observations were written into.' },
                            session_created: { type: 'boolean', example: false, description: 'Whether that session had to be created.' },
                            ml_model_id: { type: 'integer', example: 91, description: 'Model recorded on every row written.' },
                            observations: { type: 'integer', example: 6, description: 'Observation rows written. Zero is a valid outcome: the job detected nothing.' },
                            keyframes: { type: 'integer', example: 78, description: 'Keyframe rows written.' },
                            observation_ids: { type: 'array', items: { type: 'integer' }, example: [440103, 440104], description: 'The rows written, in file order.' },
                        },
                    },
                    MosaicQueryFilters: {
                        type: 'object',
                        description:
                            'The mosaic rail, as a query. **An absent or empty value means not filtering**, never "apply the reviewing mode\'s default" -- both status dimensions are sent on every query and both may be empty. `date` is rejected rather than served: no column holds the date an observation was made, and a filter that silently omits is worse than no filter. See #76.',
                        properties: {
                            project: { type: 'array', items: { type: 'string' }, example: ['Deep Reef Survey 2025'], description: 'projects.name, reached through observations.project_id.' },
                            dive: { type: 'array', items: { type: 'string' }, example: ['D04'], description: 'sessions.dive.' },
                            line: { type: 'array', items: { type: 'string' }, example: ['1'], description: 'sessions.line.' },
                            sessionType: { type: 'array', items: { type: 'string' }, example: ['Fish'], description: 'sessions.type. Aliased on the way out as session_type, because a bare `type` on an observation says type of what.' },
                            session: { type: 'array', items: { type: 'integer' }, example: [400], description: 'observations.session_id.' },
                            species: { type: 'array', items: { type: 'integer' }, example: [41], description: 'observations.species_id, and only species_id. It finds the organism; `comname` finds rows whose label text matches a name that may since have moved.' },
                            model: { type: 'array', items: { type: 'integer' }, example: [], description: 'observations.ml_model_id.' },
                            confidence: {
                                type: 'object',
                                nullable: true,
                                description: 'observations.confidence, inclusive at both ends. Either end may be null.',
                                properties: { from: { type: 'number', nullable: true, example: 0 }, to: { type: 'number', nullable: true, example: 0.8 } },
                            },
                            timeOfDay: {
                                type: 'object',
                                nullable: true,
                                description: 'Time of day from observations.tc, inclusive. **May wrap past midnight**: 22:00 to 02:00 is one night. A row whose tc carries no readable clock is excluded.',
                                properties: { from: { type: 'string', nullable: true, example: '22:00' }, to: { type: 'string', nullable: true, example: '02:00' } },
                            },
                            reviewStatus: {
                                type: 'array',
                                items: { type: 'string', enum: ['unreviewed', 'flagged', 'reviewed'] },
                                example: ['unreviewed', 'flagged'],
                                description: 'Current scientific review state. `unreviewed` is the absence of a review record, not a stored value.',
                            },
                            trainingDisposition: {
                                type: 'array',
                                items: { type: 'string', enum: ['undecided', 'promoted', 'excluded'] },
                                example: [],
                                description: 'Current training disposition. `undecided` is the absence of a review record, not a stored value.',
                            },
                        },
                    },
                    MosaicRow: {
                        type: 'object',
                        description:
                            'One mosaic tile: what the tile renders, plus the `version` the commit routes require back. `processor_name` and `lineId` are deliberately absent because nothing draws either, and who annotated something is what the permission catalog gates separately from observations:read. `first_framenum` is here because it is free from the same lateral as `keyframe_count` and addressing a thumbnail needs it.',
                        properties: {
                            observation_id: { type: 'integer', example: 100123 },
                            version: { type: 'integer', example: 3, description: 'The observation row version, maintained by a database trigger. **Send it back on a commit**: the three mosaic commit routes require the version the reviewer saw and refuse a request that omits one, so this is what makes a stale decision detectable rather than silently applied.' },
                            obsID: { type: 'integer', nullable: true, example: 4412, description: 'The annotator-facing observation number. A distinct column from observation_id.' },
                            confidence: { type: 'number', nullable: true, example: 0.42, description: 'Nullable. Nulls sort last ascending, so unscored rows land on the last pages of the default question.' },
                            comname: { type: 'string', nullable: true, example: 'Bat Star', description: 'What the species entry was called when the observation was recorded. Never dropped and never rewritten, including by a species correction: it is what makes the drift from species_id auditable.' },
                            species_comname: { type: 'string', nullable: true, example: 'Ochre Star', description: 'The **current** common name of the species the observation is now classified as, joined from species. Distinct from comname, which stays the annotator own choice: a species correction changes species_id and never the label the annotator saw, so without this field a corrected tile would render the old animal for ever while the species filter matched the new one. The pair is also what the "was Bat Star" indicator draws from. Null where the observation has no species -- about 4% of rows legitimately do not.' },
                            tc: { type: 'string', nullable: true, example: '21:57:22', description: 'Recorded clock time, as .NET TimeSpan text.' },
                            dive: { type: 'string', nullable: true, example: 'D04' },
                            line: { type: 'string', nullable: true, example: '1' },
                            session_type: { type: 'string', nullable: true, example: 'Fish' },
                            project_name: { type: 'string', nullable: true, example: 'Deep Reef Survey 2025', description: 'Null where the observation records no project. Both joins are outer, so a row is never silently dropped for want of one.' },
                            review_decision: { type: 'string', nullable: true, enum: ['reviewed', 'flagged', null], example: null, description: 'Current scientific decision, or null for unreviewed -- which is the absence of a record.' },
                            flag_reason: { type: 'string', nullable: true, example: null },
                            training_decision: { type: 'string', nullable: true, enum: ['promoted', 'excluded', null], example: null, description: 'Current training decision, or null for undecided.' },
                            exclusion_reason: { type: 'string', nullable: true, example: null },
                            keyframe_count: { type: 'integer', example: 8, description: 'How many keyframes the observation carries. Computed per returned row, not over the matching set, unless the sort names it.' },
                            first_framenum: { type: 'integer', nullable: true, example: 3457 },
                            thumbnail_status: { type: 'string', enum: ['queued', 'ready', 'failed'], example: 'ready', description: 'Whether the tile has a picture. **Never null**: an observation with no record at all reports `failed` rather than an absence the client has no rendering for. `failed` rather than `queued` because serving a page enqueues nothing -- a thumbnail is enqueued when the observation is created, so for a row that predates that nothing is coming and `queued` would be a promise the API does not keep. Ask for one with POST /api/v2/observations/thumbnails/retry. The picture itself is at /api/v2/observations/{observation_id}/thumbnail, which is derivable from a key this row already carries -- so no second field repeats a URL 45 times a page.' },
                        },
                    },
                    ThumbnailExtractorStatus: {
                        type: 'object',
                        description:
                            'What the thumbnail extractor is doing. The **persisted** run state and the **live** loop state are separate questions and both are answered: whether somebody has paused extraction, and whether it is actually turning on this host.',
                        properties: {
                            action: { type: 'string', enum: ['pause', 'resume', 'stop'], example: 'pause', description: 'Present only on a control response: the action just applied.' },
                            discarded: { type: 'integer', example: 0, description: 'Present only on a control response: how many queued rows `stop` discarded. Those observations become simply absent again, which reports `failed`, and the retry route is what re-enqueues them.' },
                            runState: { type: 'string', enum: ['running', 'paused'], example: 'running', description: 'Persisted, so a pause survives an API restart. There is no `stopped`: stop is pause plus discarding the queue.' },
                            runStateChangedAt: { type: 'string', format: 'date-time', nullable: true },
                            runStateChangedBy: { type: 'integer', nullable: true, description: 'users.user_id of whoever last changed it.' },
                            runStateNote: { type: 'string', nullable: true, example: 'Jellyfin under load', description: 'The only place the reason for a pause is recorded.' },
                            loopStarted: { type: 'boolean', example: true, description: 'Whether the drain loop is turning in this process. False in a process that imported the app without starting the server, which is how the test suite runs.' },
                            draining: { type: 'boolean', example: false },
                            inFlight: { type: 'integer', example: 1, description: 'Jellyfin streams open for extraction right now.' },
                            concurrencyLimit: { type: 'integer', example: 3, description: 'The configured bound. Deliberately below the media server ceiling, which is shared with people watching video.' },
                            extractorAvailable: { type: 'boolean', example: true, description: 'Whether ffmpeg and ffprobe answered. False means this API host has no decoder: extraction cannot run, and everything else still serves.' },
                            extractorUnavailableReason: { type: 'string', nullable: true },
                            counts: {
                                type: 'object',
                                properties: {
                                    queued: { type: 'integer', example: 45 },
                                    ready: { type: 'integer', example: 1203 },
                                    failed: { type: 'integer', example: 7 },
                                    permanent: { type: 'integer', example: 5, description: 'Failures retrying cannot help. Counted separately rather than as a fourth state.' },
                                    claimed: { type: 'integer', example: 3, description: 'Queued rows an extraction currently holds. A claim lapses after a timeout, so a process that died does not strand its tiles.' },
                                },
                            },
                            lastError: { type: 'string', nullable: true },
                            lastFailure: {
                                type: 'object',
                                nullable: true,
                                properties: {
                                    observation_id: { type: 'integer', example: 100123 },
                                    last_error: { type: 'string', example: 'The observation has no keyframes, so it has no bounding box and can never have a cropped picture.' },
                                    at: { type: 'string', format: 'date-time', nullable: true },
                                },
                            },
                        },
                    },
                    ThumbnailRetryResult: {
                        type: 'object',
                        description:
                            'One entry per requested observation, found by `observation_id` and never by position.',
                        properties: {
                            thumbnails: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        observation_id: { type: 'integer', example: 100123 },
                                        status: { type: 'string', enum: ['queued', 'ready', 'failed'], example: 'queued', description: '`queued` for work accepted. Never a terminal `ready` invented synchronously -- an accepted retry has not happened yet.' },
                                        permanent: { type: 'boolean', example: false, description: 'True where retrying cannot help, which is why the request was refused rather than queued.' },
                                        reason: { type: 'string', nullable: true, example: 'The observation has no keyframes, so it has no bounding box and can never have a cropped picture.' },
                                    },
                                },
                            },
                        },
                    },
                    MosaicPageSet: {
                        type: 'object',
                        description:
                            'A set of pages for one question, answered in one pass over the matching set. Carries an entry for **every** page asked for, in ascending page order, so the caller never has to work out which came back.',
                        properties: {
                            pageSize: { type: 'integer', example: 45 },
                            total: { type: 'integer', example: 2656, description: 'Rows matching the question. Present only when includeTotal was true.' },
                            pageCount: { type: 'integer', example: 60, description: 'Present only when includeTotal was true.' },
                            pages: {
                                type: 'array',
                                description: 'One entry per requested page, ascending. A page past the end is rows: [] with rowCount 0, not an error -- a prefetcher asks for the tail before it knows the count.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        page: { type: 'integer', example: 1 },
                                        rows: { type: 'array', items: { $ref: '#/components/schemas/MosaicRow' } },
                                        rowCount: { type: 'integer', example: 45 },
                                    },
                                },
                            },
                            excludedForNoDate: { type: 'integer', example: 0, description: 'How many observations a date filter could not answer for. Always 0 while the date dimension is rejected rather than served.' },
                            servedAt: { type: 'string', format: 'date-time', example: '2026-09-09T11:04:22.113Z', description: 'Diagnostic. Nothing depends on it.' },
                        },
                    },
                    MosaicCommitRequest: {
                        type: 'object',
                        required: ['observations'],
                        description:
                            'One shape for all three commit routes: the page as the reviewer saw it, and the marks. **`marks` is the exception set, not a selection** -- `review` flags them, `training` excludes them, and `delete` destroys them and touches nothing else. A row absent from the marks is accepted by review and training and **untouched** by delete.',
                        properties: {
                            observations: {
                                type: 'array',
                                description: 'The whole page, each with the `version` it was fetched with. **A missing version is a 400, never an implicit overwrite**: an optional version hides the failure mode where a client forgets one and gets silent last-write-wins on the annotation. Capped at 600, the same cap the page query takes.',
                                items: {
                                    type: 'object',
                                    required: ['observation_id', 'version'],
                                    properties: {
                                        observation_id: { type: 'integer', example: 100123 },
                                        version: { type: 'integer', example: 3, description: 'From the mosaic row. Trigger-maintained; never sent back changed.' },
                                    },
                                },
                            },
                            marks: {
                                type: 'array',
                                description: 'The exception set. Every id must be on the page. The reason is optional and comes from a closed vocabulary -- the reviewer-facing list for that mode -- so an unknown value is a 400 rather than a truncated or silently dropped reason. The delete route records no reason and refuses any.',
                                items: {
                                    type: 'object',
                                    required: ['observation_id'],
                                    properties: {
                                        observation_id: { type: 'integer', example: 100124 },
                                        reason: { type: 'string', nullable: true, example: 'Wrong species' },
                                    },
                                },
                            },
                            withdraw: {
                                type: 'array',
                                items: { type: 'integer' },
                                example: [100125],
                                description: 'Ids whose decision this reviewer is taking back. **Review and training only** -- a delete records no decision to take back. A withdrawal deletes the projection row and leaves every log row, because undecided is the absence of a row. An id that is also marked is a 400.',
                            },
                        },
                    },
                    MosaicCommitResult: {
                        type: 'object',
                        description:
                            'Per-observation outcomes. **The five arrays are not a partition**: `reverted` co-occurs with `flagged` for the same id when a flag takes back an acceptance, and a delete request\'s unmarked ids appear in none of them. Every entry is found by `observation_id`, never by position.',
                        properties: {
                            atomicity: {
                                type: 'string',
                                enum: ['per-observation'],
                                example: 'per-observation',
                                description: 'What the commit guaranteed. `per-observation` means an ineligible observation is an outcome rather than an error and rolls nothing back, while an unexpected failure rolls the whole request back so a failed commit applied nothing.',
                            },
                            reviewed: {
                                type: 'array',
                                description: 'What the commit accepted. `outcome` follows the route: `reviewed`, `promoted`, or `deleted`.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        observation_id: { type: 'integer', example: 100123 },
                                        outcome: { type: 'string', enum: ['reviewed', 'promoted', 'deleted'], example: 'reviewed' },
                                    },
                                },
                            },
                            flagged: {
                                type: 'array',
                                description: 'What the commit recorded as the exception. `flagged` on review, `excluded` on training. Empty on delete.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        observation_id: { type: 'integer', example: 100124 },
                                        outcome: { type: 'string', enum: ['flagged', 'excluded'], example: 'flagged' },
                                    },
                                },
                            },
                            reverted: {
                                type: 'array',
                                description: 'Acceptances taken back. Carries the same entry as `flagged` where a flag replaced an acceptance, and `withdrawn` for an explicit `withdraw`.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        observation_id: { type: 'integer', example: 100124 },
                                        outcome: { type: 'string', enum: ['flagged', 'excluded', 'withdrawn'], example: 'withdrawn' },
                                    },
                                },
                            },
                            skipped: {
                                type: 'array',
                                description: 'Left unwritten, for one of two reasons. **`not-found`**: an id that is no longer an observations row. **`no-imagery`**: an **unmarked** row whose thumbnail is not `ready`, because accepting it would be a reviewer saying "this is right" about a picture they were never shown. A **marked** row is committed whether or not it has a picture -- flagging needs no imagery -- and the delete route is unaffected because it never touches an unmarked row.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        observation_id: { type: 'integer', example: 100126 },
                                        reason: { type: 'string', enum: ['not-found', 'no-imagery'], example: 'not-found' },
                                    },
                                },
                            },
                            conflicted: {
                                type: 'array',
                                description: 'Refused, and **not recorded**. One cause: `version`, meaning the annotation changed since the page was fetched. There is no `claimed` -- the last commit wins, so nothing is ever refused for being second.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        observation_id: { type: 'integer', example: 100127 },
                                        reason: { type: 'string', enum: ['version'], example: 'version' },
                                    },
                                },
                            },
                            committedAt: { type: 'string', format: 'date-time', example: '2026-09-09T12:00:00.000Z', description: 'When the decisions were recorded, as the record holds it.' },
                        },
                    },
                    MosaicCorrectionRequest: {
                        type: 'object',
                        required: ['observation_id', 'version', 'species_id'],
                        description:
                            'One observation, one new species. Single rather than bulk because the client corrects one tile at a time; a bulk form would be additive later.',
                        properties: {
                            observation_id: { type: 'integer', example: 100123 },
                            version: { type: 'integer', example: 3, description: 'The version the reviewer saw, from the mosaic row. **Required.** A correction invalidates review decisions belonging to other people, so one made from a stale view would invalidate decisions about a classification the corrector never saw. An absent version is a 400, never an implicit overwrite.' },
                            species_id: { type: 'integer', example: 417, description: 'The species to correct to, as species.id -- **not** taxserial, and not the species_id the fixture keys its catalogue on.' },
                        },
                    },
                    MosaicCorrectionResult: {
                        type: 'object',
                        required: ['ok'],
                        description:
                            'Applied or refused, and **both are 200**: the client branches on `ok` alone, so a refusal that has a perfectly good result to show is not a transport failure. A malformed request is still a 400, and who may ask is still a 401 or 403.',
                        properties: {
                            ok: { type: 'boolean', example: true },
                            error: {
                                type: 'string',
                                enum: ['not-found', 'conflicted', 'unchanged'],
                                example: 'conflicted',
                                description: 'Present only when `ok` is false. `not-found`: no such observation, or no such species. `conflicted`: the version moved since the page was fetched, and nothing was written. `unchanged`: the observation already carries that species, so nothing was written -- doing it anyway would destroy live review decisions in exchange for no change.',
                            },
                            observation: {
                                type: 'object',
                                description: 'The observation as it now stands. Present only when `ok` is true.',
                                properties: {
                                    observation_id: { type: 'integer', example: 100123 },
                                    version: { type: 'integer', example: 4, description: 'Bumped by the trigger. Send this one back on the next write.' },
                                    species_id: { type: 'integer', nullable: true, example: 417 },
                                    species_comname: { type: 'string', nullable: true, example: 'Greenblotched Rockfish', description: 'The **current catalogue name** for the species the observation now is. A separate field from `comname` on purpose: without it a corrected tile would go on showing the old animal for ever, and reusing `comname` would let the catalogue label be mistaken for the frozen one the annotator chose. Taken from species.comname, not gui_display_name (an abbreviation) and not species (the scientific name).' },
                                    comname: { type: 'string', nullable: true, example: 'Blue/Deacon Rockfish', description: '**Unchanged by a correction, always.** What the species list entry was called when the annotator chose it. Roughly 50,000 observations already disagree with what their list says today, and keeping this frozen is what makes that drift auditable rather than silently rewritten.' },
                                    taxserial: { type: 'integer', nullable: true, example: 166730, description: 'Unchanged by a correction, for the same reason as comname. After an off-list correction this and species_id name different organisms -- deliberately, and auditably.' },
                                },
                            },
                            previous: {
                                type: 'object',
                                description: 'What the observation was before. Present only when `ok` is true.',
                                properties: {
                                    species_id: { type: 'integer', nullable: true, example: 233, description: 'Null where the observation had no species -- about 4% of rows legitimately do not.' },
                                    species_comname: { type: 'string', nullable: true, example: 'Blue Rockfish' },
                                },
                            },
                            review_id: { type: 'integer', example: 9912, description: 'The observation_reviews row this correction appended. It carries purpose "scientific", decision "corrected", and both species ids.' },
                            correctedAt: { type: 'string', format: 'date-time', example: '2026-09-09T12:00:00.000Z' },
                        },
                    },
                    MosaicStatusCounts: {
                        type: 'object',
                        description:
                            'How the non-status-filtered set divides across the two status dimensions. **`total` here is over a different and larger set than the page query\'s `total`** -- this one applies no status filter at all -- and the two are never substituted for one another.',
                        properties: {
                            total: { type: 'integer', example: 12480 },
                            unreviewed: { type: 'integer', example: 9800 },
                            reviewed: { type: 'integer', example: 2100 },
                            flagged: { type: 'integer', example: 580 },
                            undecided: { type: 'integer', example: 11900 },
                            promoted: { type: 'integer', example: 420 },
                            excluded: { type: 'integer', example: 160 },
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
                                example: {
                                    error: {
                                        code: 'VALIDATION_ERROR',
                                        message: 'Request body is required.',
                                        status: 400,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                        details: [
                                            { field: 'username', issue: 'Username is required.' },
                                        ],
                                    },
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
                                example: {
                                    error: {
                                        code: 'UNAUTHORIZED',
                                        message: 'Authentication is required.',
                                        status: 401,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
                                },
                            },
                        },
                    },
                    TooManyRequestsError: {
                        description: 'Too many requests from this client in the current rate-limit window.',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/ErrorEnvelope',
                                },
                                example: {
                                    error: {
                                        code: 'RATE_LIMITED',
                                        message: 'Too many login attempts. Please try again later.',
                                        status: 429,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
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
                                example: {
                                    error: {
                                        code: 'FORBIDDEN',
                                        message: 'You do not have permission to perform this action.',
                                        status: 403,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
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
                                example: {
                                    error: {
                                        code: 'RESOURCE_NOT_FOUND',
                                        message: 'Requested route or resource was not found.',
                                        status: 404,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
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
                                example: {
                                    error: {
                                        code: 'CONFLICT',
                                        message: 'A unique constraint was violated.',
                                        status: 409,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
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
                                example: {
                                    error: {
                                        code: 'VALIDATION_ERROR',
                                        message: 'Request validation failed.',
                                        status: 422,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                        details: [
                                            { field: 'password', issue: 'Password must be at least 8 characters.' },
                                        ],
                                    },
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
                                example: {
                                    error: {
                                        code: 'INTERNAL_ERROR',
                                        message: 'An unexpected server error occurred.',
                                        status: 500,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
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
                                example: {
                                    error: {
                                        code: 'UPSTREAM_ERROR',
                                        message: 'The upstream service was unavailable.',
                                        status: 502,
                                        requestId: 'req_mdxv3u_4f7k2q',
                                    },
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
