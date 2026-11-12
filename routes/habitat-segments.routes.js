/**
 * The Mosaic's habitat segments route (#342, decided 2026-11-10).
 *
 * A habitat tile is a segment: a piece of a line's timeline with one combination of substrates.
 * This route answers which segments a question selects. Reviewing one goes through the Mosaic's
 * existing review routes, by its stretches -- every segment here carries them, each with the
 * version those routes require -- so a review stays per observation, as #287 settled.
 *
 * Refs MarineAppliedResearch/MARP_API#342, #287.
 *
 * @fileoverview Habitat segment route and its OpenAPI documentation.
 * @module routes/habitat-segments.routes
 */

const segmentsRepository = require('../repository/habitat-segments.repository');
const segmentPictures = require('../service/habitat-segment-picture.service');
const { MosaicRequestError } = require('../repository/mosaic.repository');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/** Tag these group under. `registerVersionedRoute` rewrites the V1 prefix. */
const TAG = 'V1 · Mosaic';

/** As the Mosaic's other read routes. */
const PERMISSION = 'observations:read';

/**
 * Registers the habitat segment route.
 *
 * @param {Object} app - Express app.
 */
function registerHabitatSegmentRoutes(app) {
    registerVersionedRoute(app, {
        method: 'post',
        permission: PERMISSION,
        path: '/api/mosaic/habitat/segments',
        summary: 'Fetch a page of habitat segments',
        description:
            'Cuts each selected Habitat session\'s stretches wherever any substrate starts or stops, so each segment has one combination '
            + 'of substrates, and returns the segments the question selects. Worked out when the query runs; segments under 2 s are left '
            + 'out. `filters` are the Mosaic\'s (project, dive, line, session, model, run); `substrates` with `mode` match a segment\'s '
            + 'combination: `all` (includes all of these), `exactly` (only these: "Mud alone" is exactly Mud) or `any`. `review` keeps '
            + 'segments in the given states, worked out from their stretches: `flagged` when any stretch is, `reviewed` when all are, '
            + 'otherwise `unreviewed`. Each segment carries its stretches with their `version`, so approving it is the review route '
            + 'called with every one of them, and flagging a substrate is that route called with that substrate\'s stretch.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            filters: { $ref: '#/components/schemas/MosaicQueryFilters' },
                            substrates: { type: 'array', items: { type: 'string' }, example: ['Mud', 'Boulder'] },
                            mode: { type: 'string', enum: ['all', 'exactly', 'any'], default: 'all' },
                            review: { type: 'array', items: { type: 'string', enum: ['unreviewed', 'flagged', 'reviewed'] }, example: ['unreviewed'] },
                            page: { type: 'integer', example: 1 },
                            pageSize: { type: 'integer', example: 60 },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'One page of segments, with the total the question selects.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                total: { type: 'integer' },
                                page: { type: 'integer' },
                                pageSize: { type: 'integer' },
                                segments: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            session_id: { type: 'integer' },
                                            project_name: { type: 'string', nullable: true },
                                            dive: { type: 'string', nullable: true },
                                            line: { type: 'string', nullable: true },
                                            substrates: { type: 'array', items: { type: 'string' } },
                                            label: { type: 'string', example: 'Mud + Boulder' },
                                            start_ms: { type: 'integer', description: 'On the session\'s clock.' },
                                            end_ms: { type: 'integer' },
                                            length_ms: { type: 'integer' },
                                            stretch_ids: { type: 'array', items: { type: 'integer' } },
                                            middle: {
                                                type: 'object',
                                                description: 'Where the segment\'s middle frame is: the picture is cut there, with the habitat crop.',
                                                properties: { video_source: { type: 'string', nullable: true }, media_ms: { type: 'integer' } },
                                            },
                                            review: { type: 'string', enum: ['unreviewed', 'flagged', 'reviewed'] },
                                            stretches: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        observation_id: { type: 'integer' },
                                                        substrate: { type: 'string' },
                                                        version: { type: 'integer' },
                                                        decision: { type: 'string', nullable: true },
                                                        training_decision: { type: 'string', nullable: true },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            try {
                res.json(await segmentsRepository.habitatSegments(req.body || {}));
            } catch (error) {
                if (error instanceof MosaicRequestError) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
                throw error;
            }
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: PERMISSION,
        path: '/api/mosaic/habitat/segment-picture',
        summary: 'Fetch a habitat segment\'s picture',
        description:
            'A segment\'s picture: the frame at its middle with the habitat crop (x 0.25-0.75, y 0.5-1.0 of the frame), squared and '
            + 'padded as observation thumbnails are (#287, A21). Asked for by the `middle` each segment carries. **Cut the first time '
            + 'it is asked for and kept**, so the first request waits for the media server and later ones do not; at most two are '
            + 'cut at once. A picture that could not be cut answers 404 with the reason, and is not tried again for ten minutes.',
        tags: [TAG],
        parameters: [
            { in: 'query', name: 'video_source', required: true, schema: { type: 'string' }, description: 'The segment\'s `middle.video_source`.' },
            { in: 'query', name: 'media_ms', required: true, schema: { type: 'integer' }, description: 'The segment\'s `middle.media_ms`.' },
        ],
        responses: {
            200: { description: 'The picture.', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } },
            304: { description: 'Not modified; the client\'s cached copy is current.' },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const videoSource = String(req.query.video_source || '').trim();
            const mediaMs = Number(req.query.media_ms);
            if (!videoSource || !Number.isFinite(mediaMs) || mediaMs < 0) {
                throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'video_source and a media_ms of 0 or more are required.');
            }

            const picture = await segmentPictures.segmentPicture(videoSource, mediaMs);
            if (!picture.path) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `No picture for that moment: ${picture.error}`);
            }

            // Named for its bytes, and a moment's picture is never recut once kept.
            const etag = `"${picture.filename}"`;
            res.type('image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=86400');
            res.setHeader('ETag', etag);
            if (req.headers['if-none-match'] === etag) {
                res.status(304).end();
                return;
            }
            res.sendFile(picture.path);
        }),
    });
}

module.exports = registerHabitatSegmentRoutes;
