/**
 * Timecode resync routes: correcting a session's sync after the fact.
 *
 * These are V2-native rather than declared in V1 terms, because there was never a
 * V1 equivalent -- until now there was no way to correct a session at all.
 *
 * The shape follows how an operator actually establishes sync in the annotation
 * GUI: pause on a frame, read the clock burnt into the picture, type it. So a
 * correction is expressed as "at this media position the true time is this", and the
 * shift is derived from what the session currently holds there. A shift in
 * milliseconds or frames is accepted too, for the case where it has already been
 * measured at several positions.
 *
 * Preview first, then apply. The preview writes nothing and reports exactly what
 * would change and what would be left as recorded, so a client can show it before
 * anyone confirms -- correcting a session rewrites part of a scientific record.
 *
 * Refs MarineAppliedResearch/VIDEO_PROCESSING_GUI#213.
 *
 * @fileoverview Timecode resync routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/timecode_sync.routes
 */

const timecodeSyncRepository = require('../repository/timecode_sync.repository');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { requirePermission } = require('../middleware/require-permission.middleware');

/** Tag these operations group under in the API documentation. */
const TAG = 'V2 · Timecode';

/**
 * Pulls the correction request out of a request body, so the preview and apply
 * routes cannot drift in what they accept.
 *
 * @param {Object} req - Express request.
 * @returns {Object} The request shape the repository takes.
 */
function readCorrection(req) {
    const body = req.body || {};

    return {
        sessionId: Number(req.params.sessionID),
        videoSource: body.videoSource || null,
        fromMediaPosition: body.fromMediaPosition || null,
        atMediaPosition: body.atMediaPosition || null,
        pictureClockTime: body.pictureClockTime || null,
        // A frame count given directly is the other way in: a pointer shift measured
        // by looking at where the boxes sit, which is the only evidence available once
        // a session has a sync.
        frames: body.frames === undefined || body.frames === null
            ? undefined
            : Number(body.frames),
        allowPartial: Boolean(body.allowPartial),
        note: body.note || null,
    };
}

/**
 * The request body both correction routes accept, as an OpenAPI schema.
 *
 * @constant
 * @type {Object}
 */
const CORRECTION_BODY = {
    required: true,
    content: {
        'application/json': {
            schema: {
                type: 'object',
                description:
                    'Two ways in. Either a reading -- `atMediaPosition` with `pictureClockTime` -- in which case what it means is decided from the session’s own data, see `mode` in the response. Or `frames` on its own, which is always a pointer shift: once a session has a sync its clocks agree at every frame whether or not those frames are the right ones, so the only evidence left is where the annotation boxes sit, and that is something a person reads off the screen.',
                properties: {
                    frames: {
                        type: 'integer',
                        example: 3,
                        description: 'Whole frames to move every observation and keyframe by. Positive is later in the video. Always a pointer shift; the recorded times are never touched.',
                    },
                    atMediaPosition: {
                        type: 'string',
                        example: '00:02:24.7600000',
                        description: 'Media position of the frame the reading was taken on.',
                    },
                    pictureClockTime: {
                        type: 'string',
                        example: '15:20:21.5200000',
                        description: 'What the clock burnt into that frame read.',
                    },
                    videoSource: {
                        type: 'string',
                        nullable: true,
                        example: null,
                        description: 'Restrict to one clip. Omit for every clip in the session.',
                    },
                    fromMediaPosition: {
                        type: 'string',
                        nullable: true,
                        example: null,
                        description: 'Act from this media position onward, for a clip that changes part way through.',
                    },
                    allowPartial: {
                        type: 'boolean',
                        default: false,
                        description: 'Proceed even when some observations cannot be read and must be left alone.',
                    },
                    note: {
                        type: 'string',
                        nullable: true,
                        example: 'Read off the burnt-in clock at 00:02:24.76.',
                        description: 'Why. Written to the API log, since nothing else records it.',
                    },
                },
            },
        },
    },
};

/**
 * Register the timecode resync routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerTimecodeSyncRoutes(app) {

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/sessions/:sessionID/resync/preview',
        summary: 'Preview what a burnt-in clock reading would do to a session',
        description:
            'Reports what a reading would change, without writing anything. `mode` says which of two things it means, decided from the data: `establish-sync` when the session records no clock at all (every observation has the same media position and real-world time), in which case the recorded times move and the pointers do not; or `correct-pointer` when it does, in which case `mediaPosition` and each keyframe `framenum` move by a whole number of frames and the times do not. A reading that fits neither -- a synced session more than a second from the picture -- is refused rather than guessed at. Requires the `observations:write` permission, since it is the preview of a write.',
        tags: [TAG],
        parameters: [
            { in: 'path', name: 'sessionID', required: true, schema: { type: 'integer' }, description: 'Session to preview a correction for.' },
        ],
        requestBody: CORRECTION_BODY,
        responses: {
            200: {
                description: 'Preview produced. Nothing was written.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TimecodeResyncPreview' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
        },
        handler: [
            requirePermission('observations:write'),
            asyncHandler(async (req, res) => {
                try {
                    const preview = await timecodeSyncRepository.preview(readCorrection(req));
                    res.json(preview);
                } catch (error) {
                    // Everything the repository throws here is the caller's request
                    // being unusable, not the server failing.
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
                }
            }),
        ],
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/sessions/:sessionID/resync',
        summary: 'Apply a burnt-in clock reading to a session',
        description:
            'Applies what the preview described. In `correct-pointer` mode this shifts `mediaPosition` and every keyframe `framenum` by a whole number of frames, so a bounding box lands on the frame it was drawn on, and the recorded times are untouched. In `establish-sync` mode it shifts the recorded times so the session has a real-world clock for the first time, and the pointers are untouched. Nothing records that it happened, so keep the returned `undoWith`. Requires the `observations:write` permission.',
        tags: [TAG],
        parameters: [
            { in: 'path', name: 'sessionID', required: true, schema: { type: 'integer' }, description: 'Session to correct.' },
        ],
        requestBody: CORRECTION_BODY,
        responses: {
            200: {
                description: 'Correction applied and recorded.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TimecodeResyncResult' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
        },
        handler: [
            requirePermission('observations:write'),
            asyncHandler(async (req, res) => {
                try {
                    const result = await timecodeSyncRepository.apply(readCorrection(req));
                    res.json(result);
                } catch (error) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
                }
            }),
        ],
    });

}

module.exports = registerTimecodeSyncRoutes;
