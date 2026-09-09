/**
 * The mosaic reviewer's species-correction route.
 *
 * Phase 7 of #68. The fixture implementation of this contract is
 * `frontend/apps/marp-mosaic-review/src/data.js` `setSpecies()`; the write itself
 * is `repository/mosaic-correction.repository.js`, and this file is the HTTP
 * surface and nothing else.
 *
 * **A fourth route beside Phase 5's three, with its own permission constant**
 * (R12). It holds the same value they do, and that is the point: #68's
 * *Authorization* asks that review, training, deletion and correction not be
 * coupled in a way that prevents finer permissions later, and four constants on
 * four routes means splitting one is one line rather than a branch inside a
 * shared handler. No new key is seeded -- Phase 2 settled the existing model.
 *
 * **Single observation rather than bulk** (R1), because the client's seam is
 * `setSpecies(observationId, speciesId)` (`data.js:790`) called one tile at a
 * time (`store.js:596`). A bulk form is additive later and nothing asks for one.
 *
 * **A non-user principal is refused `403` before any write** (R13), for the same
 * data-integrity reason as Phase 5's three: `observation_reviews.reviewer_id` is
 * `NOT NULL` and references `users(user_id)`, while a bearer principal's id is a
 * `service_clients.service_client_id`. Both sequences start at 1, so they
 * collide -- and the failure is not an error but a correction silently
 * attributed to an unrelated person in the scientific record. The
 * `annotation-gui` token preset holds `observations:write`, so without this a
 * token could relabel the record unattended.
 *
 * **The consequence this route adds, recorded rather than implied:** anyone
 * holding `observations:write` can now destroy any reviewer's approval, on any
 * observation, in any project, by correcting a species. That is what
 * invalidation *is* and the log keeps the history -- but it is a new power on an
 * old key, and it is why R13 matters here even more than it did there.
 *
 * The path is declared as `/api/mosaic/...` because `registerVersionedRoute`
 * derives the V2 path and **throws** when handed one that already starts
 * `/api/v2/`. Registering beside the helper to dodge that throw would get the
 * URL and lose `requirePermission`, which is the real risk rather than the URL.
 *
 * Refs #111.
 *
 * @fileoverview The mosaic species-correction route, and its OpenAPI operation.
 * @author Isaac Travers
 * @module routes/mosaic-correction.routes
 */

const correctionRepository = require('../repository/mosaic-correction.repository');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/** Tag this under the same group as the other mosaic routes. */
const TAG = 'V1 · Mosaic';

/**
 * The permission this route requires, named here rather than imported from the
 * commit routes (R12). Swapping it is a one-line change that moves nothing else.
 */
const CORRECTION_PERMISSION = 'observations:write';

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
 * A malformed body or an absent version is the caller's question being
 * unanswerable rather than the server failing. A denial is about who is asking.
 * Anything the repository did not raise deliberately keeps its own status.
 *
 * @param {Error} error - Whatever the repository threw.
 * @returns {Error} The error to throw on.
 */
function asClientError(error) {
    if (error instanceof correctionRepository.MosaicRequestError) {
        return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }

    if (error instanceof correctionRepository.MosaicCommitDeniedError) {
        return new ApiError(403, ERROR_CODES.FORBIDDEN, error.message);
    }

    return error;
}

/**
 * Register the mosaic correction route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerMosaicCorrectionRoutes(app) {

    registerVersionedRoute(app, {
        method: 'post',
        permission: CORRECTION_PERMISSION,
        path: '/api/mosaic/observations/species',
        summary: "Correct one observation's species",
        description:
            'Changes `species_id` and **nothing else**. `comname` and `taxserial` are never rewritten: they are what the species list '
            + 'entry was called when the annotator chose it, and roughly 50,000 observations already disagree with what their list says '
            + 'today because lists were renamed underneath records that were correct when made -- which is exactly what makes the drift '
            + 'auditable. The response carries `species_comname`, the catalogue\'s current name for the corrected species, as a **separate '
            + 'field** so it cannot be mistaken for the annotator\'s frozen label.\n\n'
            + '**A correction invalidates every review decision on the observation, for both purposes.** The scientific review and the '
            + 'training disposition are removed regardless of who made them, and the observation returns to unreviewed and undecided for '
            + 'anyone to decide again -- a promoted training sample carrying the wrong label teaches the model the wrong thing. Their '
            + 'decisions stay in `observation_reviews`: the audit history is retained, only its currency is not.\n\n'
            + '**`version` is required.** A correction destroys other people\'s approvals, so one made from a stale view would destroy '
            + 'approvals of a classification the corrector never saw. A stale version comes back `{ok: false, error: "conflicted"}` and '
            + 'writes nothing; an absent one is a `400`. A correction naming the species already recorded writes nothing and comes back '
            + '`{ok: false, error: "unchanged"}`, because it would otherwise destroy live decisions in exchange for no change.\n\n'
            + '**A service token is refused with 403**: a correction belongs to the person who made it, and a bearer principal\'s id is a '
            + 'service client rather than a user.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/MosaicCorrectionRequest' },
                },
            },
        },
        responses: {
            200: {
                description:
                    'The correction, applied or refused. Both are `200`: the client branches on `ok`, and a refusal with a perfectly '
                    + 'good result to show is not a transport failure.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MosaicCorrectionResult' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const me = reviewerId(req);

            // First, and before any write: the principal check is about the
            // request rather than about the write, and "before any write" is
            // only guaranteed by it being the first thing the handler does.
            if (me === null) {
                throw new ApiError(
                    403,
                    ERROR_CODES.FORBIDDEN,
                    'This route is for a signed-in reviewer. A service token cannot correct an observation\'s species: '
                    + 'a correction belongs to the person who made it, it invalidates other reviewers\' decisions, and a '
                    + 'bearer principal is not a user.'
                );
            }

            try {
                res.json(await correctionRepository.correctSpecies(req.body || {}, req.principal, me));
            } catch (error) {
                throw asClientError(error);
            }
        }),
    });

}

module.exports = registerMosaicCorrectionRoutes;
