/**
 * Database schema introspection routes, registered code-first through the
 * OpenAPI route registry.
 *
 * All three routes are read-only and scoped to the `public` Postgres schema
 * only. They exist to power schema browsers, query builders, and
 * relationship explorers rather than any application resource.
 *
 * @fileoverview Schema introspection routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/schema.routes
 */

const schemaController = require('../controller/schema.controller');
const { asyncHandler } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register all three `/api/schema/*` routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerSchemaRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/schema/tables',
        summary: 'Retrieve public table metadata',
        description:
            'Returns one object per base table in the public schema, including table comments, row-estimate metadata, all columns with data types and defaults, primary keys, foreign keys, unique constraints, check constraints, and indexes. Intended for building schema browsers, table grids, query builders, and relationship explorers.',
        tags: ['V1 · Schema'],
        responses: {
            200: {
                description: 'Public table metadata returned successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/SchemaTable' },
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        // Row-estimate/column/constraint introspection lives entirely in
        // repository/schema.repository.js -- this route is pure delegation.
        handler: asyncHandler(async (req, res) => {
            const data = await schemaController.getPublicTables();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/schema/views',
        summary: 'Retrieve public view metadata',
        description:
            'Returns one object per public view (including materialized views), including SQL definition text, updatability flag, column metadata, and dependencies on other public tables/views. Intended for building view browsers and dependency visualizations.',
        tags: ['V1 · Schema'],
        responses: {
            200: {
                description: 'Public view metadata returned successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/SchemaView' },
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await schemaController.getPublicViews();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/schema/relationships',
        summary: 'Retrieve public foreign-key relationships',
        description:
            'Returns normalized foreign-key relationships between public-schema tables, including source/target columns and ON UPDATE / ON DELETE actions. Intended for relationship graphs and join-aware UI tooling.',
        tags: ['V1 · Schema'],
        responses: {
            200: {
                description: 'Public foreign-key relationships returned successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/SchemaRelationship' },
                        },
                    },
                },
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            // Relationship column values are normalized from Postgres array
            // text to real JS arrays in the repository layer -- see the
            // payload-shape fix noted in agents_history.md for this route.
            const data = await schemaController.getPublicRelationships();
            res.json(data);
        }),
    });
}

module.exports = registerSchemaRoutes;
