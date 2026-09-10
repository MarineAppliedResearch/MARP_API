/**
 * The mosaic reviewer's two query routes.
 *
 * Phase 4 of #68: the endpoint `frontend/apps/marp-mosaic-review` is already built
 * against, whose fixture implementation is that app's `src/data.js` `queryPages()`
 * and `counts()`. The query itself is `repository/mosaic.repository.js`; this file
 * is the HTTP surface and nothing else.
 *
 * **Both routes are `POST`, and both are declared without the `/api/v2/` prefix.**
 *
 * `POST` rather than `GET` for two facts rather than a preference: the page-set
 * request carries an exclusion set that reaches thousands of observation ids after
 * a session of committing, which does not fit a URL under any common proxy limit;
 * and the scheduler's unit is a **discontiguous set of pages** in one call, so the
 * body carries a `pages` array. #68's *Phase 4* section says `GET` and is older;
 * the counts route follows the page route so that both take one request shape, one
 * serialiser and one validator.
 *
 * The paths are declared as `/api/mosaic/...` because `registerVersionedRoute`
 * derives the V2 path and **throws** when handed one that already starts
 * `/api/v2/`. Registering beside the helper to dodge that throw would get the URL
 * and lose `requirePermission`, which is the real risk rather than the URL.
 *
 * `observations:read` on both. Only `observations:read` and `observations:write`
 * exist for observations, Phase 2 settled that no new permission keys are seeded,
 * and the catalog's own note -- that `reports:read` is separate from
 * `observations:read` because it exposes who did how much work -- is satisfied
 * precisely because the row carries no `processor_name`. **The two are one
 * decision: if `processor_name` is ever put back into the row, this stops being an
 * `observations:read` route.**
 *
 * Refs #105.
 *
 * @fileoverview Mosaic page-set and status-count routes, and their OpenAPI operations.
 * @author Isaac Travers
 * @module routes/mosaic.routes
 */

const mosaicRepository = require('../repository/mosaic.repository');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/** Tag these group under. `registerVersionedRoute` rewrites the V1 prefix. */
const TAG = 'V1 · Mosaic';

/** The permission both routes require. See the file comment for why this one. */
const PERMISSION = 'observations:read';

/**
 * Turns a refused request into the `400` it is, and lets everything else through.
 *
 * A filter that cannot be served, a page number that is not one, or a request over
 * the cap is the caller's question being unanswerable rather than the server
 * failing. Anything the repository did not raise deliberately keeps its own status.
 *
 * @param {Error} error - Whatever the repository threw.
 * @returns {Error} The error to throw on.
 */
function asClientError(error) {
    if (error instanceof mosaicRepository.MosaicRequestError) {
        return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }

    return error;
}

/**
 * Register the two mosaic routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerMosaicRoutes(app) {

    registerVersionedRoute(app, {
        method: 'post',
        permission: PERMISSION,
        path: '/api/mosaic/observations/pages',
        summary: 'Fetch a set of mosaic pages for one question',
        description:
            'Answers a filtered, sorted, paged question about observations in **one pass** over the matching set. '
            + 'A discontiguous page set -- the head, the tail and the neighbourhood of the current page -- costs what one page costs, '
            + 'and page 9,780 costs what page 1 costs, because the cost is proportional to the matching set rather than to the offset. '
            + '**The ordering always ends with `observation_id`, appended by the server whatever the client sent**: page membership is '
            + 'query-derived, so a comparator that can return zero for two different rows would put different observations on page one '
            + 'each visit. A page past the end is `rows: []` rather than an error. Over 12 pages or 600 rows is rejected with 400, never '
            + 'truncated -- a caller that quietly gets fewer pages than it asked for believes it holds a set it does not.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['pages'],
                        properties: {
                            filters: { $ref: '#/components/schemas/MosaicQueryFilters' },
                            sort: {
                                type: 'array',
                                description: 'One or two terms, each naming a field from the closed list. A field outside it is rejected rather than quietly replaced by the default. `observation_id` is not a term here -- the server appends it, always.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        field: { type: 'string', enum: ['confidence', 'keyframe_count', 'updatedAt', 'obsID'], example: 'confidence' },
                                        dir: { type: 'string', enum: ['asc', 'desc'], example: 'asc' },
                                    },
                                },
                            },
                            pageSize: { type: 'integer', example: 45, description: 'Rows per page. Follows the reviewer\'s viewport, so it is not a constant.' },
                            pages: {
                                type: 'array',
                                items: { type: 'integer' },
                                example: [1, 2, 3, 47, 48, 9779],
                                description: '1-based page numbers. **May be discontiguous.** De-duplicated and sorted server-side.',
                            },
                            exclude: {
                                type: 'array',
                                items: { type: 'integer' },
                                example: [100123, 100456],
                                description: 'Observation ids the caller already holds pinned to a committed page. Optional.',
                            },
                            includeTotal: { type: 'boolean', default: false, description: 'When true the response carries total and pageCount. Ask once per question, never on a prefetch.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Every page asked for, in ascending page order.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicPageSet' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            try {
                res.json(await mosaicRepository.queryPages(req.body || {}));
            } catch (error) {
                throw asClientError(error);
            }
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: PERMISSION,
        path: '/api/mosaic/observations/counts',
        summary: 'Count how a mosaic question divides across the review states',
        description:
            'Applies the **non-status** filters only and returns all six status counts plus a total, in one pass, with no sort and no row numbering. '
            + 'Deliberately not conditioned on either status dimension, because the rail shows a count beside every status box whether or not that '
            + 'status is currently selected -- so a count here may exceed the number of rows the page query returns. '
            + '**Its `total` is a different number over a different set from the page query\'s `total`** and the two must never be substituted for one another.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            filters: { $ref: '#/components/schemas/MosaicQueryFilters' },
                        },
                        description: 'The same filters object the page query takes. `reviewStatus` and `trainingDisposition` are ignored here rather than rejected, so one serialiser can feed both routes.',
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'The six status counts and the total they divide.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicStatusCounts' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            try {
                res.json(await mosaicRepository.counts(req.body || {}));
            } catch (error) {
                throw asClientError(error);
            }
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: PERMISSION,
        path: '/api/mosaic/observations/facets',
        summary: 'Which values each rail dimension can still offer for one question',
        description:
            'Answers, per set dimension, the values that are **still reachable under the filters already chosen** -- because offering a '
            + 'dive that returns nothing is worse than not offering it. **The dimension being enumerated is excluded from its own '
            + 'predicate**: a dive list narrowed by the dives already selected would only ever offer what is already selected. Every '
            + 'other filter applies, the two status dimensions included, so the rail never offers a combination that returns nothing. '
            + '`value` is what the filter takes and `label` is what a reviewer reads, and for species, model and session those are '
            + 'different columns -- a species name lives on `species`, a model name on `ml_models`, and a session has no name, so its id '
            + 'is the honest label. `count` rides along free from the aggregate that groups the values, and the client needs it to pick a '
            + 'default species. `list` is populated for species only: a common name identifies a species only within its list, so a '
            + 'question spanning two lists can offer two organisms under one label and the client has to be able to say which. '
            + '**A route of its own rather than a flag on the page response** -- that response carries an exact-key tripwire over its row '
            + 'shape, and one contract answering two shapes is what disables a tripwire; and the page-set request is issued up to three '
            + 'times per navigation by the prefetcher, where this is asked once per question, exactly as the counts route beside it is.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            filters: { $ref: '#/components/schemas/MosaicQueryFilters' },
                            dimensions: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                    enum: Object.keys(mosaicRepository.FACET_DIMENSIONS),
                                },
                                example: ['dive', 'line', 'species'],
                                description:
                                    'Which dimensions to answer for. Absent means all of them. A name outside the list is a 400 rather '
                                    + 'than a silently missing key, because a client that mistypes one would otherwise render an empty '
                                    + 'control and read it as "nothing is reachable".',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'One entry per requested dimension.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicFacets' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            try {
                res.json(await mosaicRepository.facets(req.body || {}));
            } catch (error) {
                throw asClientError(error);
            }
        }),
    });

}

module.exports = registerMosaicRoutes;
