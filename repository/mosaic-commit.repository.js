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
 * **The last commit wins** (#111 A6). The human settled it on 2026-09-09:
 * *"obviously the last person to commit something wins, in our normal workflow
 * we are not expecting two people to query and review with the same filters, but
 * if they do, the last one to commit should win, and if they want to update they
 * can just refresh their page and requery."* That **overrules the
 * first-valid-review-wins this file was built for**, and most of the machinery
 * came back out: there is no claim, no claimer, no earliest reviewer, and no
 * observation anybody is locked out of. A reviewer who wants the current state
 * refreshes and requeries.
 *
 * **A decision that did not take effect is still never logged**, and the reason
 * narrowed rather than disappearing. It used to be that logging a loser would
 * make them the earliest claimant for ever; that reason is gone with the claim.
 * What survives is the version cause: a version-conflicted decision that were
 * logged would be the latest row for its observation and purpose, so the next
 * rebuild would resurrect a decision the server refused. #103's
 * projection-equals-derivation test is what would find it, long afterwards.
 *
 * **The observation rows are still locked `FOR NO KEY UPDATE`, for a narrower
 * reason.** Its old justification was the claim test and is gone. What is left is
 * that the version comparison producing `conflicted/version` is read before the
 * write and reported after it: without the lock two commits can interleave so
 * the *reported* reason is not the one that actually applied. The lock is
 * transaction-scoped and ordered by `observation_id` so two commits cannot
 * deadlock; it is not a reservation, and #68's *no locking or reserving records*
 * is about claims held across requests.
 *
 * Refs #106, #111, MarineAppliedResearch/MARP_API#68, MarineAppliedResearch/MARP_API#103.
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

/**
 * The two kinds a mark can carry (#126 A5).
 *
 * `except` is what a mark has always meant -- flag it, exclude it, destroy it.
 * `accept` is the new one, and it is what makes "approve just these, and say
 * nothing about the rest of the page" expressible: the client sends only the
 * marked observations as the page, and each mark says what it becomes.
 */
const MARK_EXCEPT = 'except';
const MARK_ACCEPT = 'accept';

/** What the response says about itself (R6). A value, not a boolean, so a later
 * change is expressible without a rename. */
const ATOMICITY = 'per-observation';

/** Why a decision was refused. Under last-write-wins there is exactly one cause
 * left -- the annotation moved underneath the reviewer. `claimed` went with the
 * claim rule (#111 R10); nothing can be refused for being second. */
const CONFLICT_VERSION = 'version';

/**
 * The observation is gone: it was deleted between the page being fetched and the
 * commit arriving (R5).
 *
 * **This was the only `skipped` reason until Phase 6.** The line that used to
 * stand here said *"never for imagery -- the server makes no imagery judgement
 * until Phase 6"*, and #118 is that phase.
 */
const SKIP_NOT_FOUND = 'not-found';

/**
 * The second reason, added by Phase 6 (#118 R12).
 *
 * Phase 6 gives the server a thumbnail state, so an imagery judgement is now one
 * it can make -- and a test asserting this skip can now fail, which is what makes
 * it worth writing.
 *
 * **An unmarked row whose thumbnail is not `ready` is skipped rather than
 * accepted**, because accepting it is a reviewer saying *"this is right"* about a
 * picture they were never shown. A **marked** row is committed whether or not it
 * has a picture: flagging a tile does not need imagery and never did, and Delete
 * is unaffected because it never touches an unmarked row.
 */
const SKIP_NO_IMAGERY = 'no-imagery';

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
 * What the reviewer marked, and which of the two things each mark means.
 *
 * A mark must name an observation on the page, because the page is what the
 * commit is about and a mark outside it is a client bug rather than a request to
 * reach further.
 *
 * **A mark carries a kind** (#126 A5). It used to be the exception set and
 * nothing else: marked meant flag it, exclude it or destroy it, and unmarked
 * meant accept it. The reviewer needs to be able to accept one tile without that
 * saying anything about the rest of the page, so `accept` joins `except` -- **in
 * this list, keyed by `observation_id`, rather than as a second list**, because
 * one list is what the client's own `applyCommit` folds by and two reintroduce
 * the question of what an id appearing in both means.
 *
 * An absent kind is `except`, which is what every mark meant before the field
 * existed, so an older client is read exactly as it always was.
 *
 * @param {*} marks - The request's `marks`.
 * @param {Map<number, number>} page - The page, from {@link readPage}.
 * @param {Object} mode - The entry from {@link MODES}.
 * @returns {Map<number, {kind: string, reason: string|null}>} observation_id to its mark.
 * @throws {MosaicRequestError} If a mark is malformed, off the page, repeated, or carries an unknown kind or reason.
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
        const kind = entry.kind == null ? MARK_EXCEPT : entry.kind;

        if (kind !== MARK_EXCEPT && kind !== MARK_ACCEPT) {
            throw new MosaicRequestError(
                `${JSON.stringify(kind)} is not a kind of mark. Expected ${MARK_EXCEPT} or ${MARK_ACCEPT}.`
            );
        }

        // Delete has no accepted state: the opposite of destroying an
        // observation is leaving it alone, which needs no record (#126 A2). So
        // an accept mark here has nothing to mean, and a request carrying one
        // has misunderstood the route rather than asked for something subtle.
        if (kind === MARK_ACCEPT && !mode.accepts) {
            throw new MosaicRequestError(
                `observation ${id} is marked ${MARK_ACCEPT}, and this route records no acceptance.`
            );
        }

        // The reason vocabularies are the flag and exclusion lists: they say
        // what is wrong with an observation. An acceptance has nothing to
        // explain, and storing one against `reviewed` would put "Wrong species"
        // on a record that says the species was right.
        if (kind === MARK_ACCEPT && reason !== null) {
            throw new MosaicRequestError(
                `observation ${id} is marked ${MARK_ACCEPT} and carries a reason. `
                + 'A reason says what is wrong with an observation, so only an exception takes one.'
            );
        }

        if (reason !== null && !mode.reasons.includes(reason)) {
            throw new MosaicRequestError(
                `${JSON.stringify(reason)} is not a reason this route records. `
                + (mode.reasons.length
                    ? `Expected one of: ${mode.reasons.join(', ')}.`
                    : 'This route records no reason -- a delete leaves no trace.')
            );
        }

        out.set(id, { kind, reason });
    }

    return out;
}

/**
 * Is this observation marked as the **exception**?
 *
 * The question every rule below used to ask as a bare `marks.has(id)`, and the
 * one line where #126 changes what a commit does: an accept mark is not an
 * exception, so it is accepted exactly as an unmarked row is. That is what keeps
 * the page sweep doing precisely what it did before any of this existed.
 *
 * @param {Map<number, Object>} marks - From {@link readMarks}.
 * @param {number} id - The observation.
 * @returns {boolean} True only for an exception mark.
 */
function excepted(marks, id) {
    return marks.has(id) && marks.get(id).kind === MARK_EXCEPT;
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
 * per observation, per #68, even though every observation answers the same way
 * today: all four routes take `observations:write`, which the route has already
 * required, and no scoped key exists. Adding one later changes what this
 * consults, not where the check lives -- and `user_permissions` has no project
 * column today, so a per-project grant is a migration rather than a key.
 *
 * **`operation` is why this signature changed** (#111 R15). One function is
 * shared by review, training, delete and correction, and #68's *Authorization*
 * expects deletion to want its own rule -- which cannot be written in here
 * without knowing that delete is the caller. The parameter is cheap now with
 * four call sites and expensive later with more. It is deliberately unused:
 * every operation answers the same way until a scoped key exists, and inventing
 * a rule before there is a key to express it would be the speculative half of
 * the work.
 *
 * @param {Object} principal - `req.principal`.
 * @param {Array<number>} observationIds - The page.
 * @param {string} operation - `review`, `training`, `delete` or `correct`.
 * @returns {Array<number>} Ids the caller may not act on. Empty for every operation today.
 */
// eslint-disable-next-line no-unused-vars
function deniedObservationIds(principal, observationIds, operation) {
    return [];
}

/**
 * Locks the requested observation rows and reads what they currently are.
 *
 * Two jobs in one statement. It reports existence and the live version, which is
 * how a refusal is later attributed to `not-found` or to `version` rather than
 * guessed at -- and it **serializes commits over the same observation**, which is
 * what keeps the reported refusal reason equal to the one that actually applied.
 * Ordered by `observation_id` so two commits over overlapping pages queue rather
 * than deadlock.
 *
 * **Kept deliberately under last-write-wins, on a narrower justification than it
 * had** (#111). It used to exist so that two reviewers arriving together could
 * not both pass the claim test; there is no claim now, and either outcome would
 * be legitimate. It stays because the version comparison is read before the write
 * and reported after it.
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
 * what makes an entry `reverted` (`data.js:769`), and whether there is a decision
 * to withdraw at all. It decides nothing about who may write.
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
 * Which of these observations have a picture a reviewer could have looked at
 * (#118 R12).
 *
 * `ready` and nothing else. `queued` means the picture has not arrived,
 * `failed` means it never will, and an observation with no row at all has never
 * had one asked for -- and none of the three is a tile somebody can accept on
 * sight.
 *
 * The file is deliberately **not** checked here. The thumbnail row is what the
 * mosaic query reads, per-tile `existsSync` inside a commit would be one stat
 * per row on a page of 600, and if storage ever moves behind a network it stops
 * being cheap at all. A row that says `ready` whose file has gone is a
 * recoverable state the serving route reports, not a reason to refuse a review.
 *
 * @async
 * @param {Array<number>} observationIds - The page's ids.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Set<number>>} The ids holding a ready thumbnail.
 */
async function readyThumbnails(observationIds, transaction) {
    const rows = await db.sequelize.query(
        `SELECT observation_id
           FROM observation_thumbnails
          WHERE status = 'ready'
            AND observation_id = ANY($1::int[])`,
        { bind: [observationIds], type: QueryTypes.SELECT, transaction }
    );

    return new Set(rows.map((row) => row.observation_id));
}

/**
 * Appends the decisions that take effect, and only those.
 *
 * Two conditions, both in the write (R12), where there were three before #111
 * removed the claim:
 *
 * - the `JOIN` on `observations` drops an id that no longer exists, so a vanished
 *   row is `not-found` rather than a foreign-key error mid-page (R8);
 * - the `AND o.version = w.version` drops a stale decision, so nothing is logged
 *   for it -- which is what keeps the projection equal to its derivation across a
 *   rebuild (D2).
 *
 * Nothing is dropped for belonging to somebody else. Under last-write-wins every
 * reviewer may decide every observation, every time.
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
         RETURNING review_id, observation_id, decision, decided_at`,
        {
            bind: [JSON.stringify(decisions), purpose, reviewerId],
            type: QueryTypes.SELECT,
            transaction,
        }
    );
}

/**
 * Projects the decisions just logged. The last commit wins (#111 R10).
 *
 * **The upsert is unconditional**, where it used to carry
 * `WHERE observation_review_current.reviewer_id = EXCLUDED.reviewer_id` to make
 * first-valid-wins a constraint rather than a convention. That guard is the rule
 * A6 overruled, and with it gone `reviewer_id` joins the `SET` list -- it is now
 * *who made the current decision* rather than who owns the record, so it has to
 * move when somebody else decides later. Leaving it out was the whole point
 * before and would be a silent bug now.
 *
 * `first_decided_at` is gone from the table entirely: it existed to be preserved
 * across a claiming reviewer's revision, and there is no claiming reviewer.
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
                decided_at, observation_version)
         SELECT r.observation_id, r.purpose, r.review_id, r.decision, r.reason,
                r.reviewer_id, r.decided_at, r.observation_version
           FROM observation_reviews r
          WHERE r.review_id = ANY($1::bigint[])
         ON CONFLICT (observation_id, purpose) DO UPDATE
            SET review_id           = EXCLUDED.review_id,
                decision            = EXCLUDED.decision,
                reason              = EXCLUDED.reason,
                reviewer_id         = EXCLUDED.reviewer_id,
                decided_at          = EXCLUDED.decided_at,
                observation_version = EXCLUDED.observation_version
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
 * **Not scoped to `reviewer_id`** (#111 R10). It used to delete only when the
 * withdrawing reviewer owned the row, which was the claim rule wearing a
 * different hat. Under last-write-wins a withdrawal is simply the latest
 * decision, so anybody's withdrawal clears the current one -- and the derivation
 * agrees, which is what the projection-equals-derivation test checks.
 *
 * @async
 * @param {Array<number>} observationIds - Ids withdrawn in this commit.
 * @param {string} purpose - `scientific` or `training`.
 * @param {Object} transaction - The commit's transaction.
 * @returns {Promise<Array<Object>>} `{observation_id}` for each row released.
 */
async function releaseWithdrawn(observationIds, purpose, transaction) {
    if (observationIds.length === 0) {
        return [];
    }

    return db.sequelize.query(
        `DELETE FROM observation_review_current
           WHERE purpose        = $2
             AND observation_id = ANY($1::int[])
         RETURNING observation_id`,
        { bind: [observationIds, purpose], type: QueryTypes.SELECT, transaction }
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

    throw new Error(
        `Mosaic commit aborted: observation ${id} was refused at version ${sent} with no cause. `
        + 'Nothing was applied.'
    );
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

    const denied = deniedObservationIds(principal, ids, mode.purpose === 'training' ? 'training' : 'review');

    if (denied.length) {
        throw new MosaicCommitDeniedError(`Not permitted to review observations: ${denied.join(', ')}.`);
    }

    return db.sequelize.transaction(async (transaction) => {
        const live = await lockObservations(ids, transaction);
        const current = await currentDecisions(ids, mode.purpose, transaction);
        const withImagery = await readyThumbnails(ids, transaction);
        const out = outcomes();

        // What will be attempted, and what is refused before any write. A
        // withdrawal with nothing to withdraw is a no-op rather than a log row:
        // the request's intent is already met, and an unprojectable log row
        // against an undecided observation says nothing true.
        const attempt = [];
        const noop = [];

        for (const [id, version] of page) {
            if (!live.has(id) || live.get(id) !== version) {
                reportRefusal(id, live, version, out);
                continue;
            }

            const held = current.get(id);

            if (withdraw.has(id)) {
                // Whose decision it is does not matter any more: the last
                // commit wins, and a withdrawal is a commit like any other.
                if (held) {
                    attempt.push({ observation_id: id, version, decision: 'withdrawn', reason: null });
                } else {
                    noop.push(id);
                }

                continue;
            }

            // R12. A row that is not the exception is an acceptance, and
            // accepting a tile with no picture is a reviewer saying "this is
            // right" about something they were never shown. An excepted row goes
            // through: flagging needs no imagery.
            //
            // #126 widens this by one word rather than changing it. An *accept*
            // mark is an acceptance too, so it is skipped here for the same
            // reason an untouched tile is. The client refuses that mark at click
            // time (A4); this is the same rule at the end that has to hold.
            if (!excepted(marks, id) && !withImagery.has(id)) {
                out.skip(id, SKIP_NO_IMAGERY);

                continue;
            }

            attempt.push({
                observation_id: id,
                version,
                decision: excepted(marks, id) ? mode.marks : mode.accepts,
                reason: excepted(marks, id) ? marks.get(id).reason : null,
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
            withdrawn.map((row) => row.observation_id), mode.purpose, transaction
        );

        // R7: the log row and the projection change are one unit. The upsert is
        // unconditional, so every logged decision must project; a shortfall here
        // is not an outcome but the invariant broken, and the only honest answer
        // is to roll the request back and report a failed commit.
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
    const denied = deniedObservationIds(principal, targets, 'delete');

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
    CONFLICT_VERSION,
    MODES,
    MosaicCommitDeniedError,
    MosaicRequestError,
    SKIP_NOT_FOUND,
    SKIP_NO_IMAGERY,
    commitPage,
    deniedObservationIds,
};
