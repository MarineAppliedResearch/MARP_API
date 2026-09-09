/**
 * The page commit: scientific review, training disposition, and delete.
 *
 * Phase 5 of #68, specified in `.marp/task.md`. The fixture implementation of the
 * same contract is `frontend/apps/marp-mosaic-review/src/data.js` `commitPage()`,
 * and this has to be substitutable for it.
 *
 * Raw SQL beside `mosaic.repository.js`, sharing its `MosaicRequestError` shape,
 * for the same reason (#105's R14): every statement here is set-based over a page
 * of up to 600 observations, and the conditions that decide an outcome are
 * `WHERE` clauses rather than exceptions.
 *
 * **A page commit is not one transaction, and it is not fifty either.** The
 * human settled that on 2026-09-09 and R7/R8 are the two halves:
 *
 * - **Ineligibility is not an error.** A vanished row, a stale version, a row
 *   another reviewer has claimed: each is an *outcome* for that observation and
 *   rolls nothing back. Forty-nine decisions land while one comes back
 *   `conflicted`, because losing forty-nine sound decisions to protect one is a
 *   bad trade -- and four of #68's five outcome values are unreachable under a
 *   whole-page rollback.
 * - **An unexpected failure is not per row.** A deadlock or a dying connection
 *   rolls the whole request back and is reported as a failed commit, because the
 *   client's rule is that a failed commit applied nothing and left the marks
 *   alone (`store.js:795`). A partial result is partial by outcome, never partial
 *   by accident.
 *
 * So one observation's writes are atomic together (R7) -- the log row and the
 * projection change -- because a log row with no projection row is the one
 * inconsistency `observation_review_current` cannot tolerate.
 *
 * **A decision that did not take effect is never logged** (D2). For the version
 * cause that is correctness, not taste: a version-conflicted commit can happen
 * with nobody having claimed the observation, so a log row would make that
 * reviewer the earliest claimant under the `-- rebuild:` derivation in
 * `migrations/20260909120200-create-observation-review-current.js`, and the next
 * rebuild would resurrect a decision the server refused. #103's
 * projection-equals-derivation test is what would find it, long afterwards.
 *
 * **Claim is decided against the log, not against the projection**, and that is
 * the one place this file goes further than the spec's sketch. The derivation
 * names the *earliest claiming reviewer* forever, so an observation its claimer
 * has withdrawn still belongs to them -- its projection row is absent, and a
 * second reviewer writing one would put the projection out of step with the
 * derivation. The `claimer` CTE below is that rule, restricted to the requested
 * ids, and it lives inside the write.
 *
 * **The observation rows are locked `FOR NO KEY UPDATE` before the claim is
 * read.** Without it two reviewers arriving together both pass the claim test on
 * their own snapshot, both append a log row, and only one projection write
 * applies -- leaving the loser logged, which is exactly what D2 forbids. The lock
 * is transaction-scoped and ordered by `observation_id` so two commits cannot
 * deadlock; it is not a reservation, and #68's *no locking or reserving records*
 * is about claims held across requests.
 *
 * Refs #106, MarineAppliedResearch/MARP_API#68, MarineAppliedResearch/MARP_API#103.
 *
 * @fileoverview The mosaic page-commit write path: review, training and delete.
 * @author Isaac Travers
 * @module repository/mosaic-commit
 */

const db = require('../model');
const { MAX_ROWS, MosaicRequestError } = require('./mosaic.repository');

const { QueryTypes } = db.Sequelize;

/**
 * A request the caller may not make: answered with `403`, not `400` or `500`.
 *
 * Separate from {@link MosaicRequestError} because the request is well formed and
 * the refusal is about who is asking, which is a different answer to the client.
 */
class MosaicCommitDeniedError extends Error {
    /**
     * @param {string} message - Why the caller may not do this.
     */
    constructor(message) {
        super(message);
        this.name = 'MosaicCommitDeniedError';
        this.status = 403;
    }
}

/**
 * What each route means, in one place.
 *
 * Three routes rather than one `mode` parameter (R1), because the permission
 * guard is per route and that is what keeps delete splittable later -- but what
 * the three *do* differs by these few values, so the write path is one.
 *
 * `accepts` is what an unmarked observation becomes and `marks` is what a marked
 * one becomes. Delete inverts that: it acts on the marked set and leaves the rest
 * untouched (`data.js:746`), which is why `accepts` is null there.
 *
 * `reasons` is the closed vocabulary, taken from the client's own
 * `src/model/modes.js` -- the only caller, so a value outside its list is a bug
 * rather than a data condition (R17). Every entry is well inside `varchar(64)`,
 * so the column's width cannot be reached through this route. Delete records no
 * reason at all, so its list is empty and any reason is refused.
 *
 * @constant
 * @type {Object}
 */
const MODES = {
    scientific: {
        purpose: 'scientific',
        accepts: 'reviewed',
        marks: 'flagged',
        withdrawable: true,
        reasons: ['Wrong species', 'False detection', 'Duplicate', 'Bounding box',
            'No imagery', 'Other / unsure'],
    },
    training: {
        purpose: 'training',
        accepts: 'promoted',
        marks: 'excluded',
        withdrawable: true,
        reasons: ['Bounding box too loose', 'Occluded', 'Too small', 'Ambiguous ID',
            'Other / unsure'],
    },
    delete: {
        purpose: null,
        accepts: null,
        marks: 'deleted',
        withdrawable: false,
        reasons: [],
    },
};

/** What the response says about itself (R6). A value, not a boolean, so a later
 * change is expressible without a rename. */
const ATOMICITY = 'per-observation';

/** Why a decision was refused. #68 names both causes and a reviewer needs to know
 * which happened (R4): the annotation moved, or somebody else got there first. */
const CONFLICT_VERSION = 'version';
const CONFLICT_CLAIMED = 'claimed';

/**
 * The only reason this phase emits `skipped` (R5).
 *
 * **Never for imagery.** The server makes no imagery judgement until Phase 6 --
 * there are no thumbnails and nothing on `observations` records a status -- so a
 * test asserting an imagery skip could not fail, and none is written.
 */
const SKIP_NOT_FOUND = 'not-found';

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
 * The page as the reviewer saw it: ids and the versions they were fetched with.
 *
 * **An absent version is a `400`, never an implicit overwrite** (D1). An optional
 * version is the worse failure -- a client that forgets one would get silent
 * last-write-wins on the annotation and nothing anywhere would say so.
 *
 * @param {*} observations - The request's `observations`.
 * @returns {Map<number, number>} observation_id to the version seen, in request order.
 * @throws {MosaicRequestError} If the page is malformed, empty, over the cap, or repeats an id.
 */
function readPage(observations) {
    if (!Array.isArray(observations) || observations.length === 0) {
        throw new MosaicRequestError('observations must be a non-empty array of {observation_id, version}');
    }

    if (observations.length > MAX_ROWS) {
        throw new MosaicRequestError(`${observations.length} observations sent; the cap is ${MAX_ROWS}`);
    }

    const page = new Map();

    for (const entry of observations) {
        if (!entry || typeof entry !== 'object') {
            throw new MosaicRequestError(`observations entries must be {observation_id, version}, not ${JSON.stringify(entry)}`);
        }

        const id = integer(entry.observation_id, 'observations[].observation_id');

        if (entry.version == null) {
            throw new MosaicRequestError(
                `observations[${id}] carries no version. The version the reviewer saw is required: `
                + 'without it a decision made against a changed observation cannot be detected.'
            );
        }

        if (page.has(id)) {
            throw new MosaicRequestError(`observation ${id} appears twice in observations`);
        }

        page.set(id, integer(entry.version, `observations[${id}].version`));
    }

    return page;
}

/**
 * The exception set: what the reviewer flagged, excluded or marked for deletion.
 *
 * A mark must name an observation on the page, because the page is what the
 * commit is about and a mark outside it is a client bug rather than a request to
 * reach further.
 *
 * @param {*} marks - The request's `marks`.
 * @param {Map<number, number>} page - The page, from {@link readPage}.
 * @param {Object} mode - The entry from {@link MODES}.
 * @returns {Map<number, string|null>} observation_id to its reason, or null.
 * @throws {MosaicRequestError} If a mark is malformed, off the page, repeated, or carries an unknown reason.
 */
function readMarks(marks, page, mode) {
    if (marks == null) {
        return new Map();
    }

    if (!Array.isArray(marks)) {
        throw new MosaicRequestError('marks must be an array of {observation_id, reason}');
    }

    const out = new Map();

    for (const entry of marks) {
        if (!entry || typeof entry !== 'object') {
            throw new MosaicRequestError(`marks entries must be {observation_id, reason}, not ${JSON.stringify(entry)}`);
        }

        const id = integer(entry.observation_id, 'marks[].observation_id');

        if (!page.has(id)) {
            throw new MosaicRequestError(`marks names observation ${id}, which is not on the page`);
        }

        if (out.has(id)) {
            throw new MosaicRequestError(`observation ${id} appears twice in marks`);
        }

        const reason = entry.reason == null || entry.reason === '' ? null : entry.reason;

        if (reason !== null && !mode.reasons.includes(reason)) {
            throw new MosaicRequestError(
                `${JSON.stringify(reason)} is not a reason this route records. `
                + (mode.reasons.length
                    ? `Expected one of: ${mode.reasons.join(', ')}.`
                    : 'This route records no reason -- a delete leaves no trace.')
            );
        }

        out.set(id, reason);
    }

    return out;
}

/**
 * The explicit take-backs (D3).
 *
 * No client gesture produces one yet -- the mosaic's take-back of a flag commits
 * as `reviewed` -- so this is the request shape that makes the settled schema
 * reachable: a withdrawal cannot be produced by accident from a page commit, and
 * it is the shape a later *clear my decision* gesture would send.
 *
 * Not accepted on delete, which records no decision to take back.
 *
 * @param {*} withdraw - The request's `withdraw`.
 * @param {Map<number, number>} page - The page, from {@link readPage}.
 * @param {Map<number, string|null>} marks - The marks, from {@link readMarks}.
 * @param {Object} mode - The entry from {@link MODES}.
 * @returns {Set<number>} The ids to withdraw.
 * @throws {MosaicRequestError} If the route takes none, or an id is off the page or also marked.
 */
function readWithdraw(withdraw, page, marks, mode) {
    if (withdraw == null) {
        return new Set();
    }

    if (!Array.isArray(withdraw)) {
        throw new MosaicRequestError('withdraw must be an array of observation ids');
    }

    if (withdraw.length && !mode.withdrawable) {
        throw new MosaicRequestError('withdraw is not accepted here: a delete records no decision to take back');
    }

    const out = new Set();

    for (const value of withdraw) {
        const id = integer(value, 'withdraw[]');

        if (!page.has(id)) {
            throw new MosaicRequestError(`withdraw names observation ${id}, which is not on the page`);
        }

        // Both would append two decisions for one observation in one commit, and
        // which of them was "current" would come down to a tie-break.
        if (marks.has(id)) {
            throw new MosaicRequestError(`observation ${id} is both marked and withdrawn in the same commit`);
        }

        out.add(id);
    }

    return out;
}

/**
 * Which of these observations this caller may not act on (R10).
 *
 * **A place rather than a formality.** Authorization is enforced per request and
 * per observation, per #68, even though in this phase every observation answers
 * the same way: all three routes take `observations:write`, which the route has
 * already required, and no scoped key exists. Adding one later changes what this
 * consults, not where the check lives -- and `user_permissions` has no project
 * column today, so a per-project grant is a migration rather than a key.
 *
 * @param {Object} principal - `req.principal`.
 * @param {Array<number>} observationIds - The page.
 * @returns {Array<number>} Ids the caller may not act on. Empty in this phase.
 */
function deniedObservationIds(principal, observationIds) {
    return [];
}

/**
 * Locks the requested observation rows and reads what they currently are.
 *
 * Two jobs in one statement. It reports existence and the live version, which is
 * how a refusal is later attributed to `not-found` or to `version` rather than
 * guessed at -- and it **serializes claimants**, which the log-based claim test
 * needs to be true rather than merely current at snapshot time. Ordered by
 * `observation_id` so two commits over overlapping pages queue rather than
 * deadlock.
 *
 * `FOR NO KEY UPDATE` and not `FOR UPDATE`: this is the strength a foreign-key
 * reference takes anyway, it does not block readers, and nothing here changes the
 * observation's key.
 *
 * @async
 * @param {Array<number>} observationIds - The page.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Map<number, number>>} observation_id to its live version.
 */
async function lockObservations(observationIds, transaction) {
    const rows = await db.sequelize.query(
        `SELECT observation_id, version
           FROM observations
          WHERE observation_id = ANY($1::int[])
          ORDER BY observation_id
            FOR NO KEY UPDATE`,
        { bind: [observationIds], type: QueryTypes.SELECT, transaction }
    );

    return new Map(rows.map((row) => [row.observation_id, row.version]));
}

/**
 * The projection as it stands for these observations and this purpose.
 *
 * Read for two things only: whether a flag is taking back an acceptance, which is
 * what makes an entry `reverted` (`data.js:769`), and whether this reviewer has a
 * decision to withdraw. It is **not** how claim is decided -- see the file
 * comment.
 *
 * @async
 * @param {Array<number>} observationIds - The page.
 * @param {string} purpose - `scientific` or `training`.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Map<number, Object>>} observation_id to `{decision, reviewer_id}`.
 */
async function currentDecisions(observationIds, purpose, transaction) {
    const rows = await db.sequelize.query(
        `SELECT observation_id, decision, reviewer_id
           FROM observation_review_current
          WHERE purpose = $2
            AND observation_id = ANY($1::int[])`,
        { bind: [observationIds, purpose], type: QueryTypes.SELECT, transaction }
    );

    return new Map(rows.map((row) => [row.observation_id, row]));
}

/**
 * Appends the decisions that take effect, and only those.
 *
 * Three conditions, all in the write (R12):
 *
 * - the `JOIN` on `observations` drops an id that no longer exists, so a vanished
 *   row is `not-found` rather than a foreign-key error mid-page (R8);
 * - the `AND o.version = w.version` drops a stale decision, so nothing is logged
 *   for it -- which is what keeps the projection equal to its derivation across a
 *   rebuild (D2);
 * - the `NOT EXISTS` over `claimer` drops an observation somebody else claimed.
 *   `claimer` is the derivation's own rule: the reviewer with the earliest first
 *   decision, tied on the lower `review_id`. Read against the log rather than the
 *   projection, because a claimer who has withdrawn still owns the observation
 *   while its projection row is absent.
 *
 * The annotation fingerprint is computed here, server-side, at decision time
 * (R15): the client is not asked for it and could not be trusted with it.
 * `representative_keyframe_id` is written NULL (R16) -- neither side knows it
 * until Phase 6, and guessing would put a wrong image behind a decision.
 *
 * @async
 * @param {Array<Object>} decisions - `{observation_id, version, decision, reason}` each.
 * @param {string} purpose - `scientific` or `training`.
 * @param {number} reviewerId - The acting `users.user_id`.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Array<Object>>} `{review_id, observation_id, decision, decided_at}` for each row written.
 */
async function appendDecisions(decisions, purpose, reviewerId, transaction) {
    if (decisions.length === 0) {
        return [];
    }

    return db.sequelize.query(
        `WITH w AS (
             SELECT (r->>'observation_id')::int AS observation_id,
                    (r->>'version')::int        AS version,
                     r->>'decision'             AS decision,
                     r->>'reason'               AS reason
               FROM jsonb_array_elements($1::jsonb) AS r
         ),
         claim AS (
             SELECT observation_id,
                    reviewer_id,
                    MIN(decided_at) AS first_decided_at,
                    MIN(review_id)  AS first_review_id
               FROM observation_reviews
              WHERE purpose = $2
                AND observation_id IN (SELECT observation_id FROM w)
              GROUP BY observation_id, reviewer_id
         ),
         claimer AS (
             SELECT DISTINCT ON (observation_id) observation_id, reviewer_id
               FROM claim
              ORDER BY observation_id, first_decided_at, first_review_id
         )
         INSERT INTO observation_reviews (
                observation_id, purpose, decision, reason, reviewer_id,
                observation_version, reviewed_keyframe_count,
                reviewed_keyframe_max_updated_at, representative_keyframe_id,
                decided_at, created_at, updated_at)
         SELECT o.observation_id, $2, w.decision, w.reason, $3,
                o.version, k.keyframe_count,
                k.max_updated_at, NULL,
                NOW(), NOW(), NOW()
           FROM w
           JOIN observations o
             ON o.observation_id = w.observation_id
            AND o.version        = w.version
           LEFT JOIN LATERAL (
                SELECT count(*)::int      AS keyframe_count,
                       max("updatedAt")   AS max_updated_at
                  FROM keyframes
                 WHERE observation_id = o.observation_id) k ON true
          WHERE NOT EXISTS (
                SELECT 1
                  FROM claimer c
                 WHERE c.observation_id = w.observation_id
                   AND c.reviewer_id   <> $3)
         RETURNING review_id, observation_id, decision, decided_at`,
        {
            bind: [JSON.stringify(decisions), purpose, reviewerId],
            type: QueryTypes.SELECT,
            transaction,
        }
    );
}

/**
 * Projects the decisions just logged. First valid review wins (R11).
 *
 * The rule is the constraint plus the `WHERE` on `DO UPDATE`, written once here
 * and re-derived by no reader (#103's R6). `reviewer_id` and `first_decided_at`
 * are never updated: `first_decided_at` is the timestamp first-wins has to
 * preserve when the claiming reviewer revises.
 *
 * `first_decided_at` is taken as this reviewer's earliest decision on the
 * observation rather than as the row being written, so a reviewer who withdrew
 * and later decided again re-inserts with the timestamp the derivation computes
 * for them. Writing `NOW()` there would put the projection out of step with the
 * derivation the moment anyone re-decided after a withdrawal.
 *
 * @async
 * @param {Array<string|number>} reviewIds - The `review_id`s to project.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Array<Object>>} `{observation_id}` for each row the projection accepted.
 */
async function projectDecisions(reviewIds, transaction) {
    if (reviewIds.length === 0) {
        return [];
    }

    return db.sequelize.query(
        `INSERT INTO observation_review_current (
                observation_id, purpose, review_id, decision, reason, reviewer_id,
                first_decided_at, decided_at, observation_version)
         SELECT r.observation_id, r.purpose, r.review_id, r.decision, r.reason,
                r.reviewer_id, f.first_decided_at, r.decided_at, r.observation_version
           FROM observation_reviews r
           JOIN LATERAL (
                SELECT MIN(h.decided_at) AS first_decided_at
                  FROM observation_reviews h
                 WHERE h.observation_id = r.observation_id
                   AND h.purpose        = r.purpose
                   AND h.reviewer_id    = r.reviewer_id) f ON true
          WHERE r.review_id = ANY($1::bigint[])
         ON CONFLICT (observation_id, purpose) DO UPDATE
            SET review_id           = EXCLUDED.review_id,
                decision            = EXCLUDED.decision,
                reason              = EXCLUDED.reason,
                decided_at          = EXCLUDED.decided_at,
                observation_version = EXCLUDED.observation_version
          WHERE observation_review_current.reviewer_id = EXCLUDED.reviewer_id
         RETURNING observation_id`,
        { bind: [reviewIds], type: QueryTypes.SELECT, transaction }
    );
}

/**
 * Releases the projection rows this reviewer has withdrawn (R14).
 *
 * A withdrawal **deletes**: `observation_review_current_purpose_decision_check`
 * permits only `reviewed|flagged` and `promoted|excluded`, so `withdrawn` is
 * legal in the log and illegal here, and a delete is the only legal expression of
 * it. Undecided is the absence of a row, which is what makes the mosaic's default
 * filter a primary-key anti-join.
 *
 * Scoped to `reviewer_id`, so it deletes only when the withdrawing reviewer owns
 * the row.
 *
 * @async
 * @param {Array<number>} observationIds - Ids withdrawn in this commit.
 * @param {string} purpose - `scientific` or `training`.
 * @param {number} reviewerId - The acting `users.user_id`.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Array<Object>>} `{observation_id}` for each row released.
 */
async function releaseWithdrawn(observationIds, purpose, reviewerId, transaction) {
    if (observationIds.length === 0) {
        return [];
    }

    return db.sequelize.query(
        `DELETE FROM observation_review_current
           WHERE purpose        = $2
             AND reviewer_id    = $3
             AND observation_id = ANY($1::int[])
         RETURNING observation_id`,
        { bind: [observationIds, purpose, reviewerId], type: QueryTypes.SELECT, transaction }
    );
}

/**
 * Collects the five outcome arrays, which are **not a partition** (R5).
 *
 * `reverted` co-occurs with `flagged` for the same id, and a delete request's
 * unmarked ids appear in no array at all. Both are the fixture's existing
 * behaviour and both are easy to assume away, so the response documents it.
 *
 * Every entry is found by `observation_id`, never by position (R3).
 *
 * @returns {Object} The collector, with `add*` methods and a `body`.
 */
function outcomes() {
    const reviewed = [];
    const flagged = [];
    const reverted = [];
    const skipped = [];
    const conflicted = [];

    return {
        accept: (id, outcome) => reviewed.push({ observation_id: id, outcome }),
        mark: (id, outcome) => flagged.push({ observation_id: id, outcome }),
        revert: (id, outcome) => reverted.push({ observation_id: id, outcome }),
        skip: (id, reason) => skipped.push({ observation_id: id, reason }),
        conflict: (id, reason) => conflicted.push({ observation_id: id, reason }),
        body: (committedAt) => ({
            atomicity: ATOMICITY,
            reviewed,
            flagged,
            reverted,
            skipped,
            conflicted,
            committedAt,
        }),
    };
}

/**
 * Classifies an id the write refused, from what the locked read saw.
 *
 * The conditional writes stay the authority on what was written; this only
 * attributes a refusal to the cause a reviewer needs to be told about (R4).
 *
 * @param {number} id - The observation.
 * @param {Map<number, number>} live - observation_id to live version, from the locked read.
 * @param {number} sent - The version the reviewer sent.
 * @param {Object} out - The collector from {@link outcomes}.
 * @returns {void}
 */
function reportRefusal(id, live, sent, out) {
    if (!live.has(id)) {
        out.skip(id, SKIP_NOT_FOUND);
        return;
    }

    if (live.get(id) !== sent) {
        out.conflict(id, CONFLICT_VERSION);
        return;
    }

    // It exists, at the version the reviewer saw, and the write still declined
    // it: somebody else claimed it. Reported, not recorded -- #68's second
    // reviewer "is reported as already completed".
    out.conflict(id, CONFLICT_CLAIMED);
}

/**
 * Commits a page of scientific-review or training decisions.
 *
 * @async
 * @param {Object} mode - The entry from {@link MODES}.
 * @param {Object} request - `{observations, marks, withdraw}`.
 * @param {Object} principal - `req.principal`, already checked to be a user.
 * @param {number} reviewerId - The acting `users.user_id`.
 * @returns {Promise<Object>} The response body.
 * @throws {MosaicRequestError} If the request cannot be served.
 * @throws {MosaicCommitDeniedError} If the caller may not act on an observation.
 */
async function commitReview(mode, request, principal, reviewerId) {
    const page = readPage(request.observations);
    const marks = readMarks(request.marks, page, mode);
    const withdraw = readWithdraw(request.withdraw, page, marks, mode);
    const ids = [...page.keys()];

    const denied = deniedObservationIds(principal, ids);

    if (denied.length) {
        throw new MosaicCommitDeniedError(`Not permitted to review observations: ${denied.join(', ')}.`);
    }

    return db.sequelize.transaction(async (transaction) => {
        const live = await lockObservations(ids, transaction);
        const current = await currentDecisions(ids, mode.purpose, transaction);
        const out = outcomes();

        // What will be attempted, and what is refused before any write. A
        // withdrawal this reviewer has nothing to withdraw is a no-op rather than
        // a log row: logging it would make them the claimer of an observation
        // nobody has decided, and lock everyone else out of it.
        const attempt = [];
        const noop = [];

        for (const [id, version] of page) {
            if (!live.has(id) || live.get(id) !== version) {
                reportRefusal(id, live, version, out);
                continue;
            }

            const held = current.get(id);

            if (withdraw.has(id)) {
                if (held && held.reviewer_id !== reviewerId) {
                    out.conflict(id, CONFLICT_CLAIMED);
                } else if (held) {
                    attempt.push({ observation_id: id, version, decision: 'withdrawn', reason: null });
                } else {
                    noop.push(id);
                }

                continue;
            }

            attempt.push({
                observation_id: id,
                version,
                decision: marks.has(id) ? mode.marks : mode.accepts,
                reason: marks.has(id) ? marks.get(id) : null,
            });
        }

        const written = await appendDecisions(attempt, mode.purpose, reviewerId, transaction);
        const writtenIds = new Set(written.map((row) => row.observation_id));

        // Refused by the write itself: a claim this reviewer does not hold.
        for (const entry of attempt) {
            if (!writtenIds.has(entry.observation_id)) {
                reportRefusal(entry.observation_id, live, entry.version, out);
            }
        }

        const decided = written.filter((row) => row.decision !== 'withdrawn');
        const withdrawn = written.filter((row) => row.decision === 'withdrawn');

        const projected = await projectDecisions(decided.map((row) => row.review_id), transaction);
        const released = await releaseWithdrawn(
            withdrawn.map((row) => row.observation_id), mode.purpose, reviewerId, transaction
        );

        // R7: the log row and the projection change are one unit. Under the row
        // lock every logged decision is one this reviewer owns, so a shortfall
        // here is not an outcome -- it is the invariant broken, and the only
        // honest answer is to roll the request back and report a failed commit.
        if (projected.length !== decided.length || released.length !== withdrawn.length) {
            throw new Error(
                'Mosaic commit aborted: the projection did not accept every logged decision '
                + `(${projected.length}/${decided.length} projected, ${released.length}/${withdrawn.length} released). `
                + 'Nothing was applied.'
            );
        }

        for (const row of written) {
            const held = current.get(row.observation_id);

            if (row.decision === 'withdrawn') {
                out.revert(row.observation_id, 'withdrawn');
            } else if (row.decision === mode.marks) {
                out.mark(row.observation_id, mode.marks);

                // An acceptance taken back. The fixture pushes the same entry
                // into both arrays (`data.js:769`), which is why the arrays are
                // documented as not being a partition.
                if (held && held.decision === mode.accepts) {
                    out.revert(row.observation_id, mode.marks);
                }
            } else {
                out.accept(row.observation_id, mode.accepts);
            }
        }

        // Already undecided for this reviewer, so the request's intent is met and
        // nothing was written. Reported as the take-back it asked for.
        for (const id of noop) {
            out.revert(id, 'withdrawn');
        }

        const committedAt = written.length
            ? new Date(written[0].decided_at).toISOString()
            : new Date().toISOString();

        return out.body(committedAt);
    });
}

/**
 * Permanently deletes the marked observations, conditional on their version.
 *
 * One statement (R19): a row whose version moved comes back `conflicted` rather
 * than being destroyed. **A delete leaves no trace** (R20) -- no provenance row,
 * nothing recording who or when -- and it cascades to exactly `keyframes`,
 * `dataset_observations`, `observation_reviews` and `observation_review_current`.
 * It never removes a `dataset`, a `session`, a `project` or a source video.
 *
 * Unmarked ids are untouched and appear in no outcome array (R5, `data.js:746`).
 * The confirmation is the client's (`store.js:759`); this does not second-guess
 * it and takes no confirm token (R18).
 *
 * No row lock is taken: the `DELETE` is itself the conditional write, and the
 * existence check that follows only attributes a refusal.
 *
 * @async
 * @param {Object} mode - The `delete` entry from {@link MODES}.
 * @param {Object} request - `{observations, marks}`.
 * @param {Object} principal - `req.principal`, already checked to be a user.
 * @returns {Promise<Object>} The response body.
 * @throws {MosaicRequestError} If the request cannot be served.
 * @throws {MosaicCommitDeniedError} If the caller may not act on an observation.
 */
async function commitDelete(mode, request, principal) {
    const page = readPage(request.observations);
    const marks = readMarks(request.marks, page, mode);

    readWithdraw(request.withdraw, page, marks, mode);

    const targets = [...marks.keys()];
    const denied = deniedObservationIds(principal, targets);

    if (denied.length) {
        throw new MosaicCommitDeniedError(`Not permitted to delete observations: ${denied.join(', ')}.`);
    }

    return db.sequelize.transaction(async (transaction) => {
        const out = outcomes();

        if (targets.length === 0) {
            return out.body(new Date().toISOString());
        }

        const removed = await db.sequelize.query(
            `DELETE FROM observations o
               USING (SELECT (r->>'observation_id')::int AS observation_id,
                             (r->>'version')::int        AS version
                        FROM jsonb_array_elements($1::jsonb) AS r) w
               WHERE o.observation_id = w.observation_id
                 AND o.version        = w.version
             RETURNING o.observation_id`,
            {
                bind: [JSON.stringify(targets.map((id) => ({ observation_id: id, version: page.get(id) })))],
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        const removedIds = new Set(removed.map((row) => row.observation_id));

        for (const id of removedIds) {
            out.accept(id, mode.marks);
        }

        // Whatever survived: told apart by one existence query over the
        // remainder, because the trigger does not fire on a delete and the
        // version there is a plain comparison.
        const survivors = targets.filter((id) => !removedIds.has(id));

        if (survivors.length) {
            const present = await db.sequelize.query(
                'SELECT observation_id FROM observations WHERE observation_id = ANY($1::int[])',
                { bind: [survivors], type: QueryTypes.SELECT, transaction }
            );

            const live = new Set(present.map((row) => row.observation_id));

            for (const id of survivors) {
                if (live.has(id)) {
                    out.conflict(id, CONFLICT_VERSION);
                } else {
                    out.skip(id, SKIP_NOT_FOUND);
                }
            }
        }

        return out.body(new Date().toISOString());
    });
}

/**
 * Commits one page, in one of the three modes.
 *
 * @async
 * @param {string} modeKey - `scientific`, `training` or `delete`.
 * @param {Object} request - The request body.
 * @param {Object} principal - `req.principal`.
 * @param {number} reviewerId - The acting `users.user_id`.
 * @returns {Promise<Object>} The response body.
 * @throws {MosaicRequestError} If the request cannot be served.
 * @throws {MosaicCommitDeniedError} If the caller may not act on an observation.
 */
async function commitPage(modeKey, request = {}, principal = {}, reviewerId = null) {
    const mode = MODES[modeKey];

    if (!mode) {
        throw new Error(`Unknown mosaic commit mode "${modeKey}".`);
    }

    if (modeKey === 'delete') {
        return commitDelete(mode, request, principal);
    }

    return commitReview(mode, request, principal, reviewerId);
}

module.exports = {
    ATOMICITY,
    CONFLICT_CLAIMED,
    CONFLICT_VERSION,
    MODES,
    MosaicCommitDeniedError,
    MosaicRequestError,
    SKIP_NOT_FOUND,
    commitPage,
    deniedObservationIds,
};
