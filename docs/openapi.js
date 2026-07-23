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
                },
                {
                    name: 'Schema',
                    description:
                        'Database schema introspection endpoints for tables, views, columns, constraints, indexes, and relationships in the public schema.'
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
