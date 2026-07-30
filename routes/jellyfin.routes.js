/**
 * Jellyfin routes, registered code-first through the OpenAPI route registry.
 *
 * These are MARP's first V2 routes: everything built from here forward uses
 * the literal path prefix /api/v2/..., while every existing V1 route stays
 * exactly where it is. Jellyfin itself has no Sequelize model backing it --
 * it is an external media server MARP proxies -- so there is no
 * routes/jellyfin.model.js; the OpenAPI schemas these routes reference
 * (JellyfinItem, JellyfinItemList) are hand-written in docs/openapi.js
 * instead of generated, following the same precedent already established
 * for other no-model custom-shape endpoints (see
 * docs/openapi-response-schema-workflow.md).
 *
 * The stream endpoint deliberately returns an HTTP redirect rather than
 * proxying video bytes: MARP resolves playback server-side (so Jellyfin's
 * existence, host, and credentials never reach the caller) and hands back
 * Jellyfin's own direct-stream URL as a Location header for the caller's
 * HTTP client to follow directly.
 *
 * @fileoverview Jellyfin (V2) routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/jellyfin.routes
 */

const jellyfinController = require('../controller/jellyfin.controller');
const { asyncHandler } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Register all Jellyfin (V2) routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerJellyfinRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/libraries',
        summary: 'List top-level Jellyfin libraries',
        description:
            'Returns the top-level library/folder roots visible to MARP\'s shared Jellyfin service account. This is the entry point for browsing -- pass any returned item\'s id to GET /api/v2/jellyfin/items/{id}/children to go one level deeper.',
        tags: ['Jellyfin'],
        responses: {
            200: {
                description: 'Libraries returned successfully.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/JellyfinItemList' } },
                },
            },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const items = await jellyfinController.getLibraries();
            res.json({ items });
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/:id/children',
        summary: 'List child items under a Jellyfin folder/library',
        description:
            'Returns one folder level of children under the given Jellyfin item id -- not recursive. Both libraries (from GET /api/v2/jellyfin/libraries) and folders returned here can be passed back in as the parent id to browse further.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the parent folder or library.' },
        ],
        responses: {
            200: {
                description: 'Child items returned successfully.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/JellyfinItemList' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const items = await jellyfinController.getChildItems(req.params.id);
            res.json({ items });
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/search',
        summary: 'Search Jellyfin video items by name',
        description:
            'Searches recursively across the whole Jellyfin library for video items matching the given text -- this is the resolve-by-name path for turning a database video_source value (or any free-text title/filename fragment) into a playable Jellyfin item.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'query', name: 'q', required: true, schema: { type: 'string' }, description: 'Filename or title search term.' },
            { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 20 }, description: 'Maximum number of matches to return.' },
        ],
        responses: {
            200: {
                description: 'Matching items returned successfully.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/JellyfinItemList' } },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
            const items = await jellyfinController.searchItems(req.query.q, limit);
            res.json({ items });
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/:id/stream',
        summary: 'Resolve and redirect to a playable Jellyfin stream URL',
        description:
            'Negotiates playback for the given item via Jellyfin\'s PlaybackInfo endpoint (which also confirms the item exists and is playable) and responds with an HTTP redirect straight to Jellyfin\'s direct-stream URL. MARP never proxies the video bytes itself -- the caller\'s HTTP client follows the redirect and connects to Jellyfin directly for the actual stream.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the video item to stream.' },
        ],
        responses: {
            302: {
                description: 'Redirect to a direct Jellyfin stream URL for this item.',
                headers: {
                    Location: {
                        schema: { type: 'string', format: 'uri' },
                        description: 'Absolute Jellyfin stream URL, including a short-lived access token as the api_key query parameter.',
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const streamUrl = await jellyfinController.getStreamRedirectUrl(req.params.id);
            res.redirect(302, streamUrl);
        }),
    });
}

module.exports = registerJellyfinRoutes;
