/**
 * The mosaic reviewer's three commit routes.
 *
 * Phase 5 of #68: the write path. The fixture implementation of this contract is
 * `frontend/apps/marp-mosaic-review/src/data.js` `commitPage()`. The write itself
 * is `repository/mosaic-commit.repository.js`; this file is the HTTP surface and
 * nothing else.
 *
 * **Three routes rather than one `mode` parameter** (R1). The permission guard is
 * per route, and that is what keeps the three operations splittable later: #68's
 * *Authorization* wants delete separable -- a per-project delete permission plus a
 * global one -- and when that lands it is one constant on one route rather than a
 * branch inside a shared handler.
 *
 * **All three take `observations:write`**, settled by the human on the grounds of
 * simplicity, and the consequence is recorded rather than implied: **anyone who
 * can correct a species can also permanently delete.** The catalog holds exactly
 * two observation keys and `observations:write` is described as *"Record, change
 * and delete observations"* -- so the key already claims delete; what it cannot do
 * is separate it. `user_permissions` carries no project column, so a per-project
 * grant is a migration rather than a key.
 *
 * **All three refuse a non-user principal with `403`, before any write** (D4).
 * This is a data-integrity matter rather than a permissions preference:
 * `observation_reviews.reviewer_id` is `NOT NULL` and references `users(user_id)`,
 * while a bearer principal's id is a `service_clients.service_client_id`. Both
 * sequences start at 1, so they collide -- and the failure is not an error but a
 * review silently attributed to an unrelated person in the scientific record.
 * `/delete` records no reviewer, so refusing it there is a deliberate choice
 * rather than a consequence of the foreign key, and it is the right one: the
 * `annotation-gui` token preset holds `observations:write`, so it would otherwise
 * authorize permanent bulk deletion of the scientific record unattended.
 *
 * The paths are declared as `/api/mosaic/...` because `registerVersionedRoute`
 * derives the V2 path and **throws** when handed one that already starts
 * `/api/v2/`. Registering beside the helper to dodge that throw would get the URL
 * and lose `requirePermission`, which is the real risk rather than the URL.
 * `/api/mosaic/observations/{review,training,delete}` follows the sibling query
 * routes (D5); #68's *Phase 5* section says `/api/v2/observations/review` and is
 * older, and needs the same correction its *Phase 4* section did.
 *
 * Refs #106.
 *
 * @fileoverview Mosaic page-commit routes, and their OpenAPI operations.
 * @author Isaac Travers
 * @module routes/mosaic-commit.routes
 */

const commitRepository = require('../repository/mosaic-commit.repository');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/** Tag these group under. `registerVersionedRoute` rewrites the V1 prefix. */
const TAG = 'V1 · Mosaic';

/**
 * The permission each route requires, named once per route so swapping one is a
 * one-line change (R9). No key is seeded, created or renamed.
 */
const REVIEW_PERMISSION = 'observations:write';
const TRAINING_PERMISSION = 'observations:write';
const DELETE_PERMISSION = 'observations:write';

/** Appended to each description, because the refusal is part of the contract. */
const USER_ONLY_NOTE =
    ' **A service token is refused with 403**: a review belongs to the person who made it, '
    + 'and a bearer principal\'s id is a service client rather than a user.';

/**
 * The acting `users.user_id`, or null when the caller is not a person.
 *
 * The same trap `routes/v2_tokens.routes.js` already carries a helper for:
 * `req.principal.id` means a `users.user_id` for a session and a
 * `service_clients.service_client_id` for a bearer token, and nothing in the type
 * of the value says which.
 *
 * @param {Object} req - Express request, with `req.principal` set by `resolvePrincipal`.
 * @returns {number|null} The acting user's id, or null.
 */
function reviewerId(req) {
    return req.principal && req.principal.type === 'user' ? req.principal.id : null;
}

/**
 * Turns a refused request into the status it is, and lets everything else through.
 *
 * A malformed page, a mark off the page, an unknown reason or an absent version is
 * the caller's question being unanswerable rather than the server failing. A
 * denial is about who is asking. Anything the repository did not raise
 * deliberately keeps its own status -- which is what makes an unexpected failure a
 * `500` and a failed commit, per R8.
 *
 * @param {Error} error - Whatever the repository threw.
 * @returns {Error} The error to throw on.
 */
function asClientError(error) {
    if (error instanceof commitRepository.MosaicRequestError) {
        return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }

    if (error instanceof commitRepository.MosaicCommitDeniedError) {
        return new ApiError(403, ERROR_CODES.FORBIDDEN, error.message);
    }

    return error;
}

/**
 * One handler shape for all three routes: refuse a non-user principal, then
 * commit.
 *
 * The principal check is here rather than in the repository because it is about
 * the request rather than about the write, and it must happen **before any
 * write** -- which is only guaranteed by it being the first thing the handler
 * does.
 *
 * @param {string} mode - `scientific`, `training` or `delete`.
 * @returns {Function} The Express handler.
 */
function commitHandler(mode) {
    return asyncHandler(async (req, res) => {
        const me = reviewerId(req);

        if (me === null) {
            throw new ApiError(
                403,
                ERROR_CODES.FORBIDDEN,
                'This route is for a signed-in reviewer. A service token cannot review, promote or delete '
                + 'observations: a review belongs to the person who made it, and a bearer principal is not a user.'
            );
        }

        try {
            res.json(await commitRepository.commitPage(mode, req.body || {}, req.principal, me));
        } catch (error) {
            throw asClientError(error);
        }
    });
}

/**
 * Register the three mosaic commit routes and their OpenAPI operations on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerMosaicCommitRoutes(app) {

    registerVersionedRoute(app, {
        method: 'post',
        permission: REVIEW_PERMISSION,
        path: '/api/mosaic/observations/review',
        summary: 'Commit a page of scientific review decisions',
        description:
            'Accepts every observation on the page that is not marked, and records every marked one as **flagged** with its reason -- '
            + 'the marks are the page\'s exception set, not a selection. **This is not one transaction**: outcomes are per observation, '
            + 'so forty-nine decisions land while one comes back `conflicted`, and `atomicity` in the response says so. '
            + '**First valid review wins**: a second reviewer is reported as `conflicted` with reason `claimed` and does not overwrite '
            + 'the original reviewer or timestamp, while the claiming reviewer may revise their own decision. An observation whose '
            + '`version` has moved since the page was fetched comes back `conflicted` with reason `version` and **its decision is not '
            + 'recorded at all**. An unexpected failure rolls the whole request back, so a failed commit applied nothing.'
            + USER_ONLY_NOTE,
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/MosaicCommitRequest' },
                },
            },
        },
        responses: {
            200: {
                description: 'Per-observation outcomes. The five arrays are not a partition.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicCommitResult' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: commitHandler('scientific'),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: TRAINING_PERMISSION,
        path: '/api/mosaic/observations/training',
        summary: 'Commit a page of training dispositions',
        description:
            'Promotes every observation on the page that is not marked, and records every marked one as **excluded** with its reason. '
            + 'The scientific and training decisions are independent: this changes nothing about scientific review status. '
            + 'Everything the review route says about per-observation outcomes, first-wins and version conflicts holds identically here.'
            + USER_ONLY_NOTE,
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/MosaicCommitRequest' },
                },
            },
        },
        responses: {
            200: {
                description: 'Per-observation outcomes, with `promoted` and `excluded` as the outcome values.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicCommitResult' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: commitHandler('training'),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: DELETE_PERMISSION,
        path: '/api/mosaic/observations/delete',
        summary: 'Permanently delete the marked observations',
        description:
            '**Irreversible, and it leaves no trace.** Destroys only the observations named in `marks` -- unmarked ids on the page are '
            + 'untouched and appear in no outcome array -- conditional on the `version` each was fetched with, so a row that moved comes '
            + 'back `conflicted` rather than being destroyed. There is no deletion provenance record: nothing stores that an observation '
            + 'existed, who removed it, or when. The delete cascades to `keyframes`, `dataset_observations`, `observation_reviews` and '
            + '`observation_review_current`, **removing a training-set membership row and never its dataset**; it never removes a session, '
            + 'a project or a source video. `withdraw` is not accepted here. The confirmation dialog is the client\'s and no confirm token '
            + 'is required.'
            + USER_ONLY_NOTE,
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/MosaicCommitRequest' },
                },
            },
        },
        responses: {
            200: {
                description: 'Per-observation outcomes. Deleted ids arrive in `reviewed` with outcome `deleted`.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicCommitResult' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: commitHandler('delete'),
    });

}

module.exports = registerMosaicCommitRoutes;
