/**
 * The species correction: change what an observation is, and invalidate the
 * review decisions that were made about what it used to be.
 *
 * Phase 7 of #68, specified in `.marp/task.md`. The fixture implementation of
 * this contract is `frontend/apps/marp-mosaic-review/src/data.js` `setSpecies()`,
 * and this has to be substitutable for it.
 *
 * **A correction is a review decision** (#111 A1), settled by the human on
 * 2026-09-09. So it is a row in `observation_reviews` -- `purpose =
 * 'scientific'`, `decision = 'corrected'` -- rather than a separate audit table
 * beside it, and it takes part in whatever the derivation says "current" means.
 * Which, for a correction, is *nothing*: a correction is not an approval and
 * must never paint a tile as reviewed. The projection's `CHECK` enforces that
 * without having been changed at all, because it does not name the value.
 *
 * **`comname` is never rewritten, and neither is `taxserial`** (#111). `comname`
 * is the label the species list entry carried when the annotator pressed the
 * button, and roughly 50,000 observations already disagree with what their list
 * says today because lists were renamed and renumbered underneath records that
 * were correct when made. A correction changes `species_id` and nothing else,
 * which is what keeps the drift auditable. That is also why this does **not** go
 * through `updateObservation`, which propagates a submitted `comname` to every
 * keyframe (`observation.repository.js:690-712`).
 *
 * **It invalidates both purposes** (#111 A5), answered by the human on
 * 2026-09-09: *"yes if someone relabels something it needs to be reapproved."*
 * The scientific review and the training disposition both go, regardless of
 * whose they were, and the observation returns to undecided for anybody to
 * decide again. The reason worth keeping is scientific rather than procedural: a
 * promoted training sample carrying the wrong label teaches the model the wrong
 * thing, which is worse than not having the sample at all. Their log rows stay,
 * which is what "retaining that decision's audit history" means.
 *
 * **It is version-checked, and that is not the same question as who wins**
 * (#111 A3). Last-write-wins governs whose *decision* stands; it does not govern
 * whether a decision may be recorded against an observation that has changed
 * underneath it. A correction destroys other people's approvals, and doing that
 * from a stale view destroys approvals of a classification the corrector was
 * never looking at.
 *
 * Raw SQL beside `mosaic.repository.js` and `mosaic-commit.repository.js`,
 * sharing their `MosaicRequestError` shape.
 *
 * Refs #111, MarineAppliedResearch/MARP_API#68.
 *
 * @fileoverview The mosaic species-correction write path.
 * @author Isaac Travers
 * @module repository/mosaic-correction
 */

const db = require('../model');
const { MosaicRequestError } = require('./mosaic.repository');
const { deniedObservationIds, MosaicCommitDeniedError } = require('./mosaic-commit.repository');

const { QueryTypes } = db.Sequelize;

/**
 * Why a correction was refused, and every value the client can be told.
 *
 * **Reported as `{ok: false, error}` rather than thrown as a status** (R16),
 * because `store.js:597` branches on `res.ok` alone: a `400` surfaces there as a
 * transport failure in a path that has a perfectly good result to show. A7's
 * recommendation, followed.
 */
const REFUSED_NOT_FOUND = 'not-found';
const REFUSED_CONFLICTED = 'conflicted';
const REFUSED_UNCHANGED = 'unchanged';

/**
 * An integer, or a refusal saying which field was wrong.
 *
 * @param {*} value - Whatever the request carried.
 * @param {string} label - What to call it in the error.
 * @returns {number} The integer.
 * @throws {MosaicRequestError} If it is not an integer.
 */
function integer(value, label) {
    if (!Number.isInteger(value)) {
        throw new MosaicRequestError(`${label} must be an integer, not ${JSON.stringify(value)}`);
    }

    return value;
}

/**
 * Reads `{observation_id, version, species_id}` off the request.
 *
 * **An absent version is a `400`, never an implicit overwrite**, and the reason
 * is stronger here than on the commit routes: a correction removes review
 * decisions that belong to other people. Doing that from a page fetched before
 * somebody else corrected the species destroys approvals of a classification the
 * corrector never saw. Required, not optional -- an optional version is the
 * worse failure, because a client that forgets one gets silent destruction and
 * nothing anywhere says so.
 *
 * @param {Object} request - The request body.
 * @returns {{observationId: number, version: number, speciesId: number}} The correction asked for.
 * @throws {MosaicRequestError} If a field is missing or not an integer.
 */
function readCorrection(request) {
    if (!request || typeof request !== 'object') {
        throw new MosaicRequestError('a correction is {observation_id, version, species_id}');
    }

    const observationId = integer(request.observation_id, 'observation_id');

    if (request.version == null) {
        throw new MosaicRequestError(
            `observation ${observationId} carries no version. The version the reviewer saw is required: `
            + 'a correction invalidates other reviewers\' decisions, and one made against a changed '
            + 'observation would invalidate decisions about a classification the corrector never saw.'
        );
    }

    return {
        observationId,
        version: integer(request.version, 'version'),
        speciesId: integer(request.species_id, 'species_id'),
    };
}

/**
 * Corrects one observation's species, in one transaction.
 *
 * The order inside is load-bearing:
 *
 * 1. **Lock the observation** `FOR NO KEY UPDATE` and read its live version and
 *    species. Same strength and reason as the commit path: nothing here changes
 *    the row's key, it does not block readers, and it keeps the version that is
 *    compared equal to the version that is written against.
 * 2. **Refuse a stale version** before anything is written.
 * 3. **Refuse a no-op** -- a correction naming the species already recorded
 *    writes nothing (R4). It would otherwise destroy live review decisions in
 *    exchange for changing nothing at all.
 * 4. **Look up the species** before the write, the way the fixture does, "so a
 *    correction that cannot be made writes nothing".
 * 5. **Update `species_id`, and only `species_id`.**
 * 6. **Append the log row**, with the fingerprint computed server-side.
 * 7. **Remove both projection rows**, regardless of whose they are.
 *
 * Steps 5 to 7 are one unit. A `species_id` that moved without the decisions
 * being invalidated is the inconsistency this endpoint exists to prevent.
 *
 * @async
 * @param {Object} request - `{observation_id, version, species_id}`.
 * @param {Object} principal - `req.principal`, already checked to be a user.
 * @param {number} reviewerId - The acting `users.user_id`.
 * @returns {Promise<Object>} `{ok: true, observation, previous}` or `{ok: false, error}`.
 * @throws {MosaicRequestError} If the request cannot be served.
 * @throws {MosaicCommitDeniedError} If the caller may not act on this observation.
 */
async function correctSpecies(request = {}, principal = {}, reviewerId = null) {
    const { observationId, version, speciesId } = readCorrection(request);

    const denied = deniedObservationIds(principal, [observationId], 'correct');

    if (denied.length) {
        throw new MosaicCommitDeniedError(`Not permitted to correct observations: ${denied.join(', ')}.`);
    }

    return db.sequelize.transaction(async (transaction) => {
        const [live] = await db.sequelize.query(
            `SELECT observation_id, version, species_id, comname
               FROM observations
              WHERE observation_id = $1
                FOR NO KEY UPDATE`,
            { bind: [observationId], type: QueryTypes.SELECT, transaction }
        );

        if (!live) {
            return { ok: false, error: REFUSED_NOT_FOUND };
        }

        if (live.version !== version) {
            return { ok: false, error: REFUSED_CONFLICTED };
        }

        // Nothing to do, and doing it anyway would invalidate live decisions in
        // exchange for no change. Under the version-boundary design this
        // replaced, a no-op was a correctness landmine as well: the version
        // trigger fires only WHEN (old.* IS DISTINCT FROM new.*), so a boundary
        // at an unmoved version would have made the observation permanently
        // unreviewable. The boundary is review_id-keyed, so that trap is gone
        // and this is a behavioural rule -- kept because the trap will look
        // attractive again to anyone who reaches for a version boundary.
        if (live.species_id === speciesId) {
            return { ok: false, error: REFUSED_UNCHANGED };
        }

        // The catalogue's own label for both species, read before the write so a
        // correction naming a species that does not exist writes nothing.
        const catalogue = await db.sequelize.query(
            'SELECT id, comname FROM species WHERE id = ANY($1::int[])',
            {
                bind: [[speciesId, live.species_id].filter((id) => id != null)],
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        const byId = new Map(catalogue.map((row) => [row.id, row.comname]));

        if (!byId.has(speciesId)) {
            return { ok: false, error: REFUSED_NOT_FOUND };
        }

        // `species_id` and nothing else. The trigger bumps `version` from OLD,
        // so the row comes back at the version the client should send next.
        const [updated] = await db.sequelize.query(
            `UPDATE observations
                SET species_id = $2, "updatedAt" = NOW()
              WHERE observation_id = $1
          RETURNING observation_id, version, species_id, comname, taxserial`,
            { bind: [observationId, speciesId], type: QueryTypes.SELECT, transaction }
        );

        // The fingerprint is computed here, server-side, exactly as the commit
        // path computes it: the client is not asked for it and could not be
        // trusted with it. `observation_version` is the version the correction
        // *applied to*, not the one the trigger just produced.
        const [logged] = await db.sequelize.query(
            `INSERT INTO observation_reviews (
                    observation_id, purpose, decision, reason, reviewer_id,
                    observation_version, previous_species_id, corrected_species_id,
                    reviewed_keyframe_count, reviewed_keyframe_max_updated_at,
                    representative_keyframe_id, decided_at, created_at, updated_at)
             SELECT $1, 'scientific', 'corrected', NULL, $2,
                    $3, $4, $5,
                    k.keyframe_count, k.max_updated_at,
                    NULL, NOW(), NOW(), NOW()
               FROM (SELECT count(*)::int    AS keyframe_count,
                            max("updatedAt") AS max_updated_at
                       FROM keyframes
                      WHERE observation_id = $1) k
          RETURNING review_id, decided_at`,
            {
                bind: [observationId, reviewerId, version, live.species_id, speciesId],
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        // **Both purposes, regardless of reviewer_id.** Unlike the commit path's
        // `releaseWithdrawn` this is not scoped to a purpose either: removing
        // other people's projection rows is what invalidation *is*. Their
        // decisions stay in the log.
        await db.sequelize.query(
            'DELETE FROM observation_review_current WHERE observation_id = $1',
            { bind: [observationId], type: QueryTypes.SELECT, transaction }
        );

        return {
            ok: true,
            observation: {
                observation_id: updated.observation_id,
                version: updated.version,
                species_id: updated.species_id,
                // The catalogue's current name for the species the observation
                // now *is*. A separate field from `comname` on purpose (A4):
                // `comname` is the annotator's frozen label and is returned
                // unchanged beside it, so nothing can mistake one for the other.
                species_comname: byId.get(speciesId),
                comname: updated.comname,
                taxserial: updated.taxserial,
            },
            previous: {
                species_id: live.species_id,
                species_comname: live.species_id == null ? null : byId.get(live.species_id) || null,
            },
            review_id: logged.review_id,
            correctedAt: new Date(logged.decided_at).toISOString(),
        };
    });
}

module.exports = {
    MosaicCommitDeniedError,
    MosaicRequestError,
    REFUSED_CONFLICTED,
    REFUSED_NOT_FOUND,
    REFUSED_UNCHANGED,
    correctSpecies,
};
