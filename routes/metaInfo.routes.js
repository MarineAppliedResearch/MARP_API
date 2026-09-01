/**
 * MetaInfo routes, registered code-first through the OpenAPI route registry.
 *
 * The `metaInfo` table is a true singleton: exactly one row is created by
 * the migration/seeder, and these two routes are the only read/write
 * surface for its `name` column (the configured database display name).
 * See `repository/metaInfo.repository.js` for the upsert/read behavior
 * these handlers delegate to.
 *
 * @fileoverview MetaInfo (database name) routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/metaInfo.routes
 */

const metaInfoController = require('../controller/metaInfo.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/**
 * Register both `/api/metaInfo/dbName` routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerMetaInfoRoutes(app) {
    registerVersionedRoute(app, {
        method: 'get',
        permission: 'metaInfo:read',
        path: '/api/metaInfo/dbName',
        summary: 'Retrieve active database name',
        description:
            'Returns metadata identifying the current configured database as a single-element array containing only a name field (never the full metaInfo row).',
        tags: ['V1 · Health'],
        responses: {
            200: {
                description: 'Database name returned successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/MetaInfoDbName',
                        },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            // getDBName() never rejects: a query failure resolves to [] rather
            // than throwing, so there is no try/catch needed here.
            const data = await metaInfoController.getDBName();
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'metaInfo:write',
        path: '/api/metaInfo/dbName',
        summary: 'Set the active database name',
        description:
            'Sets the configured database name on the singleton metaInfo row. Upserts: if the metaInfo table already has a row, its name column is updated in place; if the table is empty, a new row is created. This affects the single shared configuration record also read by GET /metaInfo/dbName. Unlike the GET, a database failure here is not swallowed to an empty/placeholder result -- it responds with a standard 500 error envelope so callers can tell the write did not happen.',
        tags: ['V1 · Health'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['name'],
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1,
                                example: 'Production',
                                description: 'New value to store as the database name.',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Database name set successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/MetaInfoDbName',
                        },
                    },
                },
            },
            400: {
                $ref: '#/components/responses/BadRequestError',
            },
            500: {
                $ref: '#/components/responses/InternalServerError',
            },
        },
        handler: asyncHandler(async (req, res) => {
            // Body is flat ({ name }), not wrapped like every other domain's
            // { <domain>: {...} } convention -- this route has no request
            // schema entity, just a single scalar to store.
            if (typeof req.body.name !== 'string' || req.body.name.trim().length === 0) {
                throw new ApiError(
                    400,
                    ERROR_CODES.VALIDATION_ERROR,
                    'name is required and must be a non-empty string.'
                );
            }

            // setDBName() rethrows on failure (see repository) so asyncHandler
            // and the shared error-contract middleware turn it into a 500
            // instead of silently reporting success on a failed write.
            const data = await metaInfoController.setDBName(req.body.name);
            res.json(data);
        }),
    });
}

module.exports = registerMetaInfoRoutes;
