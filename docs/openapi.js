/**
 * File: docs/openapi.js
 * Purpose: Build the OpenAPI specification from annotations in API source files.
 * Context: Used by the runtime Swagger endpoint and the CLI generation script.
 */

const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');


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
                },
            },
        },

        apis: annotationFiles,
    };

    return swaggerJSDoc(options);
};


module.exports = {
    buildOpenApiSpec,
};
