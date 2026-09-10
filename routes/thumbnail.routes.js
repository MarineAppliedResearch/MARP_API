/**
 * The observation thumbnail routes: the bytes, the retry, and the control
 * surface.
 *
 * Phase 6 of #68. The extraction is `service/thumbnail-extraction.service.js` and
 * the record is `repository/observation-thumbnail.repository.js`; this file is
 * the HTTP surface and nothing else.
 *
 * **Every path is declared without the `/api/v2/` prefix** and registered through
 * `registerVersionedRoute`, which derives the V2 path and attaches
 * `requirePermission`. The helper **throws** when handed a path that already
 * starts `/api/v2/`, and mounting beside it to dodge that throw gets the URL and
 * silently loses the permission check -- which is the real risk rather than the
 * URL.
 *
 * **No new permission keys** (#68, Phase 2). The catalogue holds 27 and none of
 * them is about thumbnails:
 *
 * - serving the bytes is `observations:read`, plainly;
 * - **retrying is `observations:read` too** (A10, delegated by the human: *"just
 *   make the decision"*), bounded by the concurrency constant rather than by a
 *   permission. The counter-argument is recorded rather than dismissed: a script
 *   walking every page of a 440,000-row mosaic would enqueue the whole corpus,
 *   and the rate limit is what stops that hurting;
 * - **changing the run state is `admin`** (R26). The split is the point. A
 *   reviewer legitimately wants to know whether their pictures are coming, but
 *   pausing extraction affects everyone using the mosaic and throttles a shared
 *   media server, which is not a reviewer's decision.
 *
 * Refs #118.
 *
 * @fileoverview Thumbnail serving, retry and control routes, and their OpenAPI operations.
 * @author Isaac Travers
 * @module routes/thumbnail.routes
 */

const fs = require('fs');
const path = require('path');

const thumbnailRepository = require('../repository/observation-thumbnail.repository');
const extraction = require('../service/thumbnail-extraction.service');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerVersionedRoute } = require('./lib/register-versioned-route');
const { CONTROL_ACTIONS, STORAGE_DIR } = require('../config/thumbnails');

/** Tag these group under. `registerVersionedRoute` rewrites the V1 prefix. */
const TAG = 'V1 · Observation thumbnails';

/** Reading a thumbnail, and asking for one. */
const READ_PERMISSION = 'observations:read';

/** Changing whether extraction runs at all (R26). */
const ADMIN_PERMISSION = 'admin';

/** The cap on one retry request. A page is 45 tiles and the prefetcher holds
 * three pages, so this is generous without letting one call enqueue a corpus. */
const MAX_RETRY_IDS = 600;

/**
 * The `users.user_id` behind this request, or null.
 *
 * `req.principal.id` means a `users.user_id` for a session and a
 * `service_clients.service_client_id` for a bearer token, so the type has to be
 * checked before the id is stored as one.
 *
 * @param {Object} req - Express request.
 * @returns {number|null} The acting user id, or null for a non-user principal.
 */
function actingUserId(req) {
    return req.principal && req.principal.type === 'user' ? req.principal.id : null;
}

/**
 * The ETag for one thumbnail record.
 *
 * Built from `generation`, which every re-extraction bumps. The URL is stable per
 * observation, so **without the generation a replacement picture would sit
 * invisible behind a cached copy** -- which is exactly why this is not the
 * species pictures' `immutable` header. A stored species picture never changes
 * and a replacement is a new record with a new id; a thumbnail at a stable URL is
 * the opposite case, and copying `immutable` here would pin a stale picture in
 * every reviewer's browser for a year.
 *
 * @param {Object} row - The thumbnail record.
 * @returns {string} The ETag value, quoted.
 */
function etagFor(row) {
    return `"observation-thumbnail-${row.observation_id}-${row.generation}"`;
}

/**
 * The ids a retry request carries.
 *
 * @param {*} body - The request body.
 * @returns {Array<number>} De-duplicated observation ids, in request order.
 * @throws {ApiError} If the list is missing, empty, over the cap, or not integers.
 */
function readObservationIds(body) {
    const raw = body && body.observationIds;

    if (!Array.isArray(raw) || raw.length === 0) {
        throw new ApiError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            'observationIds must be a non-empty array of observation ids.'
        );
    }

    if (raw.length > MAX_RETRY_IDS) {
        throw new ApiError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            `${raw.length} observation ids sent; the cap is ${MAX_RETRY_IDS}.`
        );
    }

    const ids = [];

    for (const id of raw) {
        if (!Number.isInteger(id)) {
            throw new ApiError(
                400,
                ERROR_CODES.VALIDATION_ERROR,
                `observationIds entries must be integers, not ${JSON.stringify(id)}.`
            );
        }

        if (!ids.includes(id)) {
            ids.push(id);
        }
    }

    return ids;
}

/**
 * Register the thumbnail routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerThumbnailRoutes(app) {

    registerVersionedRoute(app, {
        method: 'get',
        permission: READ_PERMISSION,
        path: '/api/observations/thumbnails/status',
        summary: 'What the thumbnail extractor is doing',
        description:
            'Reports the persisted run state, the live loop state, how many streams are open against the configured limit, '
            + 'the queued/ready/failed/permanent counts and the last error. '
            + '**The run state and the loop state are different questions** and both are answered: whether somebody has paused '
            + 'extraction, and whether it is actually turning. A service reported as running with `extractorAvailable: false` is '
            + 'an API host with no ffmpeg, which is the condition this endpoint exists to make visible rather than leave as a '
            + 'surprise on the first thumbnail. Reading this is `observations:read`: a reviewer legitimately wants to know '
            + 'whether their pictures are coming.',
        tags: [TAG],
        responses: {
            200: {
                description: 'The extractor status.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ThumbnailExtractorStatus' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            res.json(await extraction.status());
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: ADMIN_PERMISSION,
        path: '/api/observations/thumbnails/control',
        summary: 'Pause, resume or stop thumbnail extraction',
        description:
            'Three distinct actions, and each says what happens to work already running. '
            + '**`pause`** stops *starting* new extractions and lets in-flight ones finish, because killing an ffmpeg mid-decode '
            + 'wastes the Jellyfin stream it already paid for. **`resume`** starts taking work again. **`stop`** is pause plus '
            + 'discarding the queue: the queued rows return to being simply absent, and since serving a mosaic page enqueues what '
            + 'it is missing, the next page view re-enqueues them -- so nothing is lost and no fourth state is needed. Rows that '
            + 'are already `ready` or `failed` are outcomes rather than queue and are untouched. '
            + 'The run state is **persisted**: a service paused because the media server was struggling must still be paused after '
            + 'an API restart, or the pause silently expires at the worst moment. '
            + '**`admin` rather than `observations:read`**: pausing extraction affects everyone using the mosaic and throttles a '
            + 'media server shared with people watching video, which is not a reviewer\'s decision.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['action'],
                        properties: {
                            action: { type: 'string', enum: CONTROL_ACTIONS, example: 'pause' },
                            note: { type: 'string', nullable: true, example: 'Jellyfin under load during the afternoon dive review', description: 'Why, in the operator\'s words. The only place the reason for a pause is recorded.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The action taken, how many queued rows it discarded, and the resulting status.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ThumbnailExtractorStatus' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const action = req.body && req.body.action;

            if (!CONTROL_ACTIONS.includes(action)) {
                throw new ApiError(
                    400,
                    ERROR_CODES.VALIDATION_ERROR,
                    `action must be one of ${CONTROL_ACTIONS.join(', ')}, not ${JSON.stringify(action)}.`
                );
            }

            const note = req.body && req.body.note != null ? String(req.body.note) : null;

            res.json(await extraction.control(action, actingUserId(req), note));
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: READ_PERMISSION,
        path: '/api/observations/thumbnails/retry',
        summary: 'Ask again for a page of thumbnails',
        description:
            'Takes **a page of observation ids in one request** and answers per observation, so a page-level retry is one round '
            + 'trip and two paints rather than one request per tile. '
            + 'Every entry is found by `observation_id`, never by position. '
            + 'It answers `queued` for work it accepted and **the status the observation now holds** for anything it refused -- '
            + 'never a terminal `ready` invented synchronously, which is only the fixture\'s shortcut. '
            + '**A permanent failure is refused rather than re-queued**: an observation with no keyframes, or whose video does not '
            + 'resolve, can never have a picture, and without that refusal this button becomes a way to hammer a shared media '
            + 'server. A row that is already `ready` is left alone, because a retry is a request for a picture and one exists.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['observationIds'],
                        properties: {
                            observationIds: {
                                type: 'array',
                                items: { type: 'integer' },
                                maxItems: MAX_RETRY_IDS,
                                example: [100123, 100456],
                                description: 'The observations to ask again for. De-duplicated server-side.',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'One entry per requested observation.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ThumbnailRetryResult' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const ids = readObservationIds(req.body);
            const rows = await thumbnailRepository.requeue(ids);
            const byId = new Map(rows.map((row) => [row.observation_id, row]));

            res.json({
                thumbnails: ids.map((id) => {
                    const row = byId.get(id);

                    // No row at all means no such observation: `requeue` inserts
                    // one for every id that exists. Reported rather than
                    // silently dropped, so the client's per-id lookup finds an
                    // answer for everything it asked about.
                    if (!row) {
                        return { observation_id: id, status: 'failed', permanent: true, reason: 'not-found' };
                    }

                    return {
                        observation_id: id,
                        status: row.status,
                        permanent: row.permanent,
                        reason: row.status === 'failed' ? row.last_error : null,
                    };
                }),
            });
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: READ_PERMISSION,
        path: '/api/observations/:observationId/thumbnail',
        summary: 'Fetch an observation thumbnail',
        description:
            'Serves the cropped picture for one observation: the frame at the moment the observation was recorded, cropped to the '
            + 'box the detector or the annotator drew, padded, squared and resized. '
            + 'The ETag carries a generation that every re-extraction bumps, and `Cache-Control` **revalidates rather than being '
            + '`immutable`**: the species picture routes may be immutable because a stored picture never changes and a replacement '
            + 'is a new record, but a thumbnail lives at a stable per-observation URL, so `immutable` would pin a stale picture in '
            + 'every reviewer\'s browser for a year. '
            + 'A recorded thumbnail whose file is missing answers **404 with an explanation** rather than a stack trace: `storage/` '
            + 'is restored separately from the database, and a thumbnail is re-derivable from the row, so this is a recoverable '
            + 'state rather than a lost one.',
        tags: [TAG],
        parameters: [
            {
                in: 'path',
                name: 'observationId',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the observation.',
            },
        ],
        responses: {
            200: {
                description: 'The thumbnail.',
                content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
            },
            304: { description: 'Not modified; the client\'s cached copy is current.' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const observationId = Number(req.params.observationId);

            if (!Number.isInteger(observationId)) {
                throw new ApiError(
                    400,
                    ERROR_CODES.VALIDATION_ERROR,
                    `observationId must be an integer, not ${JSON.stringify(req.params.observationId)}.`
                );
            }

            const row = await thumbnailRepository.findByObservationId(observationId);

            if (!row || row.status !== 'ready' || !row.filename) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    row
                        ? `Observation ${observationId} has no thumbnail yet; its extraction is ${row.status}.`
                        : `Observation ${observationId} has no thumbnail record. Nothing has asked for one.`
                );
            }

            const filePath = path.join(STORAGE_DIR, row.filename);

            // The row can outlive the file: storage is git-ignored and has no
            // seed to be re-imported from, so a redeployment starts with an
            // empty directory. Answering 404 with the reason is more useful than
            // a stack trace from sendFile, and the picture is re-extractable.
            if (!fs.existsSync(filePath)) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Observation ${observationId} has a thumbnail recorded but its file is missing from storage. `
                    + 'It can be re-extracted: the row carries the frame and the source dimensions it was made from.'
                );
            }

            const etag = etagFor(row);

            res.type(row.content_type || 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
            res.setHeader('ETag', etag);

            if (req.headers['if-none-match'] === etag) {
                res.status(304).end();

                return;
            }

            res.sendFile(filePath);
        }),
    });

}

module.exports = registerThumbnailRoutes;
