/**
 * Video clock routes: when a video's recording started, and setting it (#76).
 *
 * The clock belongs to the video file, not the session, so these name a video -- by the
 * file name observations record, or by its Jellyfin item -- rather than a session. Setting
 * it corrects every observation in that video; reading it also gives the start the file
 * name suggests, which is offered and never applied on its own.
 *
 * Refs MarineAppliedResearch/MARP_API#76.
 *
 * @fileoverview Video clock routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/video-clock.routes
 */

const videoClockService = require('../service/video-clock.service');
const { asyncHandler } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { requirePermission } = require('../middleware/require-permission.middleware');

/** Tag these operations group under in the API documentation. */
const TAG = 'V2 · Video clock';

/** A video's clock as both routes return it. */
const CLOCK_SCHEMA = {
    type: 'object',
    properties: {
        video_source: { type: 'string', example: '20210614_164041_Fwd.mp4', description: 'The file, as observations name it.' },
        recorded_start: { type: 'string', format: 'date-time', nullable: true, description: 'When the recording started, UTC. Null when no clock is set, in which case its observations\' times are positions in the video.' },
        start_source: { type: 'string', enum: ['file-name', 'entered', 'synced'], nullable: true, description: 'How the start was learned.' },
        start_set_by: { type: 'integer', nullable: true, description: 'Who set it.' },
        start_set_at: { type: 'string', format: 'date-time', nullable: true },
        suggested_start: { type: 'string', format: 'date-time', nullable: true, description: 'The start the file name states (`YYYYMMDD_HHMMSS`, taken as UTC), or null. A suggestion only.' },
    },
};

/** Name the video: in the query for a read, in the body for a write. */
const pickVideo = (from) => ({
    videoSource: from.video_source || from.videoSource,
    jellyfinItemId: from.jellyfin_item_id || from.jellyfinItemId,
});

/**
 * Registers the video clock routes.
 *
 * @param {Object} app - Express app.
 */
function registerVideoClockRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/videos/clock',
        summary: 'Read a video\'s clock, and the start its file name suggests',
        description: 'Name the video by `video_source` or `jellyfin_item_id`. Requires `observations:read`.',
        tags: [TAG],
        parameters: [
            { in: 'query', name: 'video_source', schema: { type: 'string' }, description: 'The file name, as observations record it.' },
            { in: 'query', name: 'jellyfin_item_id', schema: { type: 'string' }, description: 'Or the Jellyfin item.' },
        ],
        responses: {
            200: { description: 'The clock, set or not.', content: { 'application/json': { schema: CLOCK_SCHEMA } } },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
        },
        handler: [
            requirePermission('observations:read'),
            asyncHandler(async (req, res) => {
                const { videoSource } = await videoClockService.resolve(pickVideo(req.query || {}));
                res.json(await videoClockService.describe(videoSource));
            }),
        ],
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/videos/clock',
        summary: 'Set a video\'s clock, and time every observation in it',
        description:
            'Give the start directly, or a reading off the picture: `clock`, the date and time the burnt-in clock shows, with `at_media_position`, the position of that frame. Every observation in the video, in every session, gets `observed_at` = start + its position, and its clock time (`actualPosition`; `tc`, `frame` and `etc` where they still follow from it) moved to that moment. Positions in the video are never changed, and a value the derivation does not reproduce is left as found. Setting it again corrects it. Requires `observations:write`.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['source'],
                        properties: {
                            video_source: { type: 'string', example: '20210614_164041_Fwd.mp4' },
                            jellyfin_item_id: { type: 'string' },
                            start: { type: 'string', format: 'date-time', example: '2021-06-14T16:40:41Z', description: 'When the recording started, UTC.' },
                            clock: { type: 'string', format: 'date-time', example: '2021-06-14T16:45:39Z', description: 'Or: the date and time shown in a frame, UTC.' },
                            at_media_position: { type: 'string', example: '00:04:58.000', description: 'That frame\'s position in the video.' },
                            source: { type: 'string', enum: ['file-name', 'entered', 'synced'], description: 'file-name when the suggested start was accepted, entered when typed, synced when read off a frame.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Clock set and observations timed.',
                content: {
                    'application/json': {
                        schema: {
                            allOf: [CLOCK_SCHEMA, {
                                type: 'object',
                                properties: {
                                    observations: { type: 'integer', description: 'Observations timed by the clock.' },
                                    unreadable: { type: 'integer', description: 'Observations left alone because their recorded positions do not parse.' },
                                    tcLeftAlone: { type: 'integer', description: 'Of those timed, how many kept a `tc` something else wrote.' },
                                    frameLeftAlone: { type: 'integer', description: 'Of those timed, how many kept a `frame` something else wrote.' },
                                },
                            }],
                        },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
        },
        handler: [
            requirePermission('observations:write'),
            asyncHandler(async (req, res) => {
                const body = req.body || {};
                res.json(await videoClockService.setClock({
                    ...pickVideo(body),
                    start: body.start,
                    clock: body.clock,
                    atMediaPosition: body.at_media_position || body.atMediaPosition,
                    source: body.source,
                    userId: req.principal && req.principal.type === 'user' ? req.principal.id : null,
                }));
            }),
        ],
    });
}

module.exports = registerVideoClockRoutes;
