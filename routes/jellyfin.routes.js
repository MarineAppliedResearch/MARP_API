/**
 * Jellyfin routes, registered code-first through the OpenAPI route registry.
 *
 * These are MARP's first V2 routes: everything built from here forward uses
 * the literal path prefix /api/v2/..., while every existing V1 route stays
 * exactly where it is. Jellyfin itself has no Sequelize model backing it --
 * it is an external media server MARP proxies -- so there is no
 * routes/jellyfin.model.js; the OpenAPI schemas these routes reference
 * (JellyfinItem, JellyfinItemList, JellyfinPlaybackOption(List),
 * JellyfinResolveResult, JellyfinPlaybackReportRequest, JellyfinTrickplayInfo)
 * are hand-written in docs/openapi.js instead of generated, following the
 * same precedent already established for other no-model custom-shape
 * endpoints (see docs/openapi-response-schema-workflow.md).
 *
 * Playback endpoints (stream, playback-options, images) deliberately return
 * an HTTP redirect rather than proxying bytes: MARP resolves playback
 * server-side (so Jellyfin's existence, host, and credentials never reach
 * the caller) and hands back Jellyfin's own URL as a Location header for
 * the caller's HTTP client to follow directly. The one exception is
 * trickplay, which returns many tile URLs as JSON data rather than a single
 * redirect, since a redirect can only point at one location.
 *
 * MARP holds no server-side playback session state: the playback/started,
 * /progress, and /stopped relay endpoints require the caller to carry
 * mediaSourceId/playSessionId forward from the earlier stream/
 * playback-options response into each report -- a shared backend serving
 * concurrent callers cannot safely assume one global "current" session the
 * way jellyfin_client.cs's single-user desktop client does.
 *
 * Every route also reads an optional X-Client-Name/X-Client-Version pair
 * from the real downstream client and forwards it as `clientIdentity` down
 * through controller -> service -> repository, so Jellyfin's own
 * session/dashboard view can attribute each session to the actual caller
 * instead of a single undifferentiated "MARP API" device -- confirmed
 * necessary against the live server (see repository/jellyfin.repository.js's
 * file-level doc comment). Callers that omit these headers fall back to one
 * shared "unknown" Jellyfin session, matching the original single-session
 * behavior.
 *
 * @fileoverview Jellyfin (V2) routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/jellyfin.routes
 */

const jellyfinController = require('../controller/jellyfin.controller');
const { asyncHandler } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Shared OpenAPI parameter documentation for the optional client-identity
 * headers every Jellyfin route reads. Spread into each route's `parameters`
 * array rather than declared once, since the OpenAPI route registry has no
 * shared-parameters concept of its own.
 *
 * @constant
 * @type {Array<Object>}
 */
const CLIENT_IDENTITY_PARAMETERS = [
    { in: 'header', name: 'X-Client-Name', required: false, schema: { type: 'string' }, description: 'Name of the real downstream client (e.g. a web frontend or mobile app), folded into the Jellyfin device identity MARP authenticates with so Jellyfin can distinguish real callers. Omitting this falls back to one shared "unknown" Jellyfin session.' },
    { in: 'header', name: 'X-Client-Version', required: false, schema: { type: 'string' }, description: 'Version of the real downstream client, paired with X-Client-Name.' },
];

/**
 * Extracts the downstream client identity from request headers.
 *
 * @param {Object} req - Express request.
 * @returns {Object} `{ name, version }`, either or both possibly undefined.
 */
function extractClientIdentity(req) {
    return {
        name: req.get('X-Client-Name') || undefined,
        version: req.get('X-Client-Version') || undefined,
    };
}

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
        parameters: [...CLIENT_IDENTITY_PARAMETERS],
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
            const items = await jellyfinController.getLibraries(extractClientIdentity(req));
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
            ...CLIENT_IDENTITY_PARAMETERS,
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
            const items = await jellyfinController.getChildItems(req.params.id, extractClientIdentity(req));
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
            ...CLIENT_IDENTITY_PARAMETERS,
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
            const items = await jellyfinController.searchItems(req.query.q, limit, extractClientIdentity(req));
            res.json({ items });
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/:id/playback-options',
        summary: 'Get the playback quality menu for a Jellyfin item',
        description:
            'Capability-probes the item via PlaybackInfo and derives a quality menu (Auto, Original/Direct, and transcode tiers) from its actual source bitrate/resolution -- a tier only appears if it is genuinely below source quality. Pass a returned option\'s mode (and maxBitrate/maxWidth/maxHeight for a Transcode tier) to GET /items/{id}/stream to play it.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the video item.' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        responses: {
            200: {
                description: 'Playback options returned successfully.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/JellyfinPlaybackOptionList' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const options = await jellyfinController.getPlaybackOptions(req.params.id, extractClientIdentity(req));
            res.json({ options });
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/:id/stream',
        summary: 'Resolve and redirect to a playable Jellyfin stream URL',
        description:
            'Negotiates playback for the given item via Jellyfin\'s PlaybackInfo endpoint (which also confirms the item exists and is playable) and responds with an HTTP redirect straight to Jellyfin\'s stream URL. MARP never proxies the video bytes itself -- the caller\'s HTTP client follows the redirect and connects to Jellyfin directly. mode=Original (default) and mode=Auto redirect to Jellyfin\'s direct-stream URL (Auto currently behaves identically to Original -- there is no adaptive-quality decision procedure yet). mode=Transcode negotiates a real constrained transcode via a DeviceProfile and redirects to Jellyfin\'s own negotiated transcodingUrl (an HLS master.m3u8, not the static direct-stream URL) -- use maxBitrate/maxWidth/maxHeight from a playback-options Transcode tier to pick a specific quality. The response also carries the negotiated mediaSourceId/playSessionId/playMethod as headers -- confirmed against Jellyfin\'s own live session state that reporting playback/progress or playback/stopped with anything other than the exact playSessionId this call issued is silently ignored (Jellyfin never updates its PlayState), so a caller MUST capture these headers to use those endpoints correctly.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the video item to stream.' },
            { in: 'query', name: 'mode', required: false, schema: { type: 'string', enum: ['Original', 'Auto', 'Transcode'], default: 'Original' }, description: 'Playback mode.' },
            { in: 'query', name: 'maxBitrate', required: false, schema: { type: 'integer' }, description: 'Bitrate ceiling for mode=Transcode.' },
            { in: 'query', name: 'maxWidth', required: false, schema: { type: 'integer' }, description: 'Width ceiling for mode=Transcode.' },
            { in: 'query', name: 'maxHeight', required: false, schema: { type: 'integer' }, description: 'Height ceiling for mode=Transcode.' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        responses: {
            302: {
                description: 'Redirect to a Jellyfin stream URL for this item -- a direct-stream URL for Original/Auto, or a negotiated transcodingUrl for Transcode.',
                headers: {
                    Location: {
                        schema: { type: 'string', format: 'uri' },
                        description: 'Absolute Jellyfin stream URL, including a short-lived access token.',
                    },
                    'X-Jellyfin-Media-Source-Id': {
                        schema: { type: 'string' },
                        description: 'MediaSource id negotiated for this stream -- pass through to the playback/started, /progress, and /stopped endpoints.',
                    },
                    'X-Jellyfin-Play-Session-Id': {
                        schema: { type: 'string' },
                        description: 'PlaySessionId Jellyfin issued for this negotiation -- required by the playback report endpoints; reporting with any other value is silently ignored by Jellyfin.',
                    },
                    'X-Jellyfin-Play-Method': {
                        schema: { type: 'string', enum: ['DirectStream', 'Transcode'] },
                        description: 'Which playback method this negotiation used -- pass through as playMethod on playback reports.',
                    },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const clientIdentity = extractClientIdentity(req);
            const result = await jellyfinController.getStreamRedirectUrl(
                req.params.id,
                {
                    mode: req.query.mode,
                    maxBitrate: req.query.maxBitrate !== undefined ? Number(req.query.maxBitrate) : undefined,
                    maxWidth: req.query.maxWidth !== undefined ? Number(req.query.maxWidth) : undefined,
                    maxHeight: req.query.maxHeight !== undefined ? Number(req.query.maxHeight) : undefined,
                },
                clientIdentity
            );
            res.set('X-Jellyfin-Media-Source-Id', result.mediaSourceId || '');
            res.set('X-Jellyfin-Play-Session-Id', result.playSessionId || '');
            res.set('X-Jellyfin-Play-Method', result.playMethod || '');
            res.redirect(302, result.url);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/resolve',
        summary: 'Resolve a saved video_source value to a Jellyfin item',
        description:
            'Runs the fuzzy resolver: builds several search-term variants from the given value (raw, filename, filename stem, underscore/space variants, an extracted MARE timestamp), searches Jellyfin with each, and scores every candidate by how closely its Jellyfin name or server-side path filename matches. Returns the single best match, or 404 if the best score is below minScore -- this rejects a weak match rather than silently resolving to the wrong video.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'query', name: 'videoSource', required: true, schema: { type: 'string' }, description: 'Saved filename, path, or other free-text video reference to resolve.' },
            { in: 'query', name: 'minScore', required: false, schema: { type: 'integer', default: 60 }, description: 'Minimum acceptable match score (0-100).' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        responses: {
            200: {
                description: 'A sufficiently confident match was found.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/JellyfinResolveResult' } },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const minScore = req.query.minScore !== undefined ? Number(req.query.minScore) : undefined;
            const result = await jellyfinController.resolveVideoSource(req.query.videoSource, minScore, extractClientIdentity(req));
            res.json(result);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/jellyfin/items/:id/playback/started',
        summary: 'Report that playback has started or resumed',
        description:
            'Relays a playback-started report to Jellyfin so its session/transcode lifecycle and "Now Playing" state stay accurate. MARP stores no playback session state itself -- carry mediaSourceId/playSessionId forward from the earlier stream/playback-options response.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the item being played.' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        requestBody: {
            required: false,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JellyfinPlaybackReportRequest' } } },
        },
        responses: {
            204: { description: 'Report relayed successfully.' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            await jellyfinController.reportPlaybackStarted(req.params.id, req.body, extractClientIdentity(req));
            res.status(204).send();
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/jellyfin/items/:id/playback/progress',
        summary: 'Report current playback position/pause state',
        description:
            'Relays a playback-progress report to Jellyfin. Should be called periodically during playback so Jellyfin\'s transcode-session lifecycle and resume position stay accurate. MARP stores no playback session state itself.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the item being played.' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        requestBody: {
            required: false,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JellyfinPlaybackReportRequest' } } },
        },
        responses: {
            204: { description: 'Report relayed successfully.' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            await jellyfinController.reportPlaybackProgress(req.params.id, req.body, extractClientIdentity(req));
            res.status(204).send();
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/jellyfin/items/:id/playback/stopped',
        summary: 'Report that playback has stopped',
        description:
            'Relays a playback-stopped report to Jellyfin so it can clean up any active transcode session. MARP stores no playback session state itself -- carry mediaSourceId/playSessionId forward from the earlier stream/playback-options response.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin id of the item that was being played.' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        requestBody: {
            required: false,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JellyfinPlaybackReportRequest' } } },
        },
        responses: {
            204: { description: 'Report relayed successfully.' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            await jellyfinController.reportPlaybackStopped(req.params.id, req.body, extractClientIdentity(req));
            res.status(204).send();
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/:id/images/:imageType',
        summary: 'Resolve and redirect to a Jellyfin item image',
        description:
            'Builds a Jellyfin image URL (e.g. Primary poster, Thumb) for the item and responds with an HTTP redirect to it, following the same signed-redirect pattern as /stream -- MARP never proxies the image bytes itself.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin item id.' },
            { in: 'path', name: 'imageType', required: true, schema: { type: 'string' }, description: 'Jellyfin image type, e.g. Primary, Thumb, Backdrop.' },
            { in: 'query', name: 'maxWidth', required: false, schema: { type: 'integer', default: 320 }, description: 'Maximum image width Jellyfin should return.' },
            { in: 'query', name: 'quality', required: false, schema: { type: 'integer', default: 85 }, description: 'JPEG quality (1-100).' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        responses: {
            302: {
                description: 'Redirect to a direct Jellyfin image URL.',
                headers: {
                    Location: {
                        schema: { type: 'string', format: 'uri' },
                        description: 'Absolute Jellyfin image URL, including a short-lived access token.',
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const imageUrl = await jellyfinController.getImageRedirectUrl(
                req.params.id,
                req.params.imageType,
                {
                    maxWidth: req.query.maxWidth !== undefined ? Number(req.query.maxWidth) : undefined,
                    quality: req.query.quality !== undefined ? Number(req.query.quality) : undefined,
                },
                extractClientIdentity(req)
            );
            res.redirect(302, imageUrl);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/jellyfin/items/:id/trickplay',
        summary: 'Get scrubbing-preview tile metadata for a Jellyfin item',
        description:
            'Fetches and parses Jellyfin\'s trickplay tile playlist for the item and returns structured metadata plus tile image URLs, so callers can build a scrubbing preview without knowing Jellyfin\'s playlist format. Each tile URL already embeds its own access token and is directly fetchable. Supplying runTimeTicks lets MARP probe for additional tile sheets some Jellyfin servers omit from the playlist itself.',
        tags: ['Jellyfin'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Jellyfin item id.' },
            { in: 'query', name: 'width', required: true, schema: { type: 'integer' }, description: 'Requested tile-sheet width -- must match a width Jellyfin actually generated trickplay data for.' },
            { in: 'query', name: 'mediaSourceId', required: false, schema: { type: 'string' }, description: 'Specific media source, if the item has more than one.' },
            { in: 'query', name: 'runTimeTicks', required: false, schema: { type: 'integer' }, description: 'Item runtime in Jellyfin ticks, to probe for additional tile sheets.' },
            ...CLIENT_IDENTITY_PARAMETERS,
        ],
        responses: {
            200: {
                description: 'Trickplay metadata returned successfully.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/JellyfinTrickplayInfo' } },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            502: { $ref: '#/components/responses/UpstreamError' },
        },
        handler: asyncHandler(async (req, res) => {
            const trickplay = await jellyfinController.getTrickplayInfo(
                req.params.id,
                Number(req.query.width),
                {
                    mediaSourceId: req.query.mediaSourceId,
                    runTimeTicks: req.query.runTimeTicks !== undefined ? Number(req.query.runTimeTicks) : undefined,
                },
                extractClientIdentity(req)
            );
            res.json(trickplay);
        }),
    });
}

module.exports = registerJellyfinRoutes;
