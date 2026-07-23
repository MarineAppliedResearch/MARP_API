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
