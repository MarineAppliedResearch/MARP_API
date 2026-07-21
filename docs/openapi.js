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

    const annotationFiles = [
        normalizeGlobPath(path.join(PROJECT_ROOT, 'server.js')),
        normalizeGlobPath(path.join(PROJECT_ROOT, 'controller', '**', '*.js')),
        normalizeGlobPath(path.join(PROJECT_ROOT, 'service', '**', '*.js')),
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
                    description: 'Observation read and update operations',
                },
            ],

            components: {
                schemas: {
                    ErrorResponse: {
                        type: 'object',

                        properties: {
                            error: {
                                type: 'string',
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
