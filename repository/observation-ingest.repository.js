/**
 * Writing a GPU job's observations into the annotation record.
 *
 * One transaction per job, because half a run's observations is worse than none:
 * somebody would have to work out which tracks were missing before they could
 * ingest the rest, and a partial set silently understates what the model found.
 *
 * **Three things here are deliberate and each was a trap first.**
 *
 * 1. *The keys are assigned by hand, and the sequence is not used.*
 *    `observations.observation_id` has a sequence that has never been advanced by
 *    the annotation GUI's writes, so it sits far behind the table and `nextval`
 *    would collide immediately. `repository/observation.repository.js` assigns
 *    `max + 1`; so does this, because two conventions for one column is worse
 *    than one awkward convention. Tracked in #62.
 * 2. *An advisory lock covers the whole assignment.* `max + 1` computed by two
 *    transactions at once yields the same number twice, and two workers finishing
 *    within a second of each other is the normal case, not the unlucky one. The
 *    lock is transaction-scoped, so it is released by the commit or the rollback
 *    and cannot be leaked.
 * 3. *Rows are inserted with SQL rather than `db.observations.create`.* The model
 *    declares `observation_id` as a primary key that Sequelize believes is
 *    generated, so `create()` sends an explicit null for it and the insert fails.
 *
 * @fileoverview Persistence for observations produced by a GPU inference job.
 * @author Isaac Travers
 * @module repository/observation-ingest
 */

'use strict';

const { QueryTypes } = require('sequelize');

/**
 * Shared database registry containing the configured Sequelize connection,
 * initialized models, and model associations.
 *
 * @constant
 * @type {Object}
 */
const db = require('../model');

/**
 * Application logger used to record repository errors.
 *
 * @constant
 * @type {Object}
 */
const logger = require('../logger/api.logger');

/**
 * Key for the advisory lock that serialises observation-key assignment.
 *
 * An arbitrary constant, but a fixed one: every writer that assigns
 * `observation_id` as `max + 1` has to take the *same* lock or it does not
 * serialise anything.
 *
 * @constant
 * @type {number}
 */
const OBSERVATION_KEY_LOCK = 87301;

/**
 * The observation columns this module writes, in the order the insert sends
 * them. Named once so the statement and the value list cannot drift apart.
 *
 * @constant
 * @type {Array<string>}
 */
const OBSERVATION_COLUMNS = [
    'observation_id', 'obsID', 'PobsID', 'project_id', 'session_id', 'user_id',
    'tc', 'frame', 'taxserial', 'species_id', 'comname', 'count',
    'video_source', 'videoLocation', 'mediaPosition', 'actualPosition',
    'confidence', 'ml_model_id', 'gpu_job_id', 'gpu_attempt_id', 'jellyfin_item_id',
    'createdAt', 'updatedAt',
];


/**
 * Persistence for observations produced by a GPU inference job.
 *
 * @class ObservationIngestRepository
 */
class ObservationIngestRepository {

    db = {};

    constructor() {
        this.db = db;
    }

    /**
     * How many observations a job has already produced.
     *
     * This is the idempotency check. A replayed terminal report must not write a
     * second set of rows, and a job's own id is the only thing that distinguishes
     * its output from an identical re-run's -- which is a separate job and is
     * meant to produce a separate set.
     *
     * @async
     * @param {number} jobId - GPU job identifier.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<number>} Rows already written for this job.
     */
    async countObservationsForJob(jobId, transaction) {
        const [row] = await this.db.sequelize.query(
            'SELECT COUNT(*)::int AS n FROM observations WHERE gpu_job_id = :jobId',
            { replacements: { jobId }, type: QueryTypes.SELECT, transaction }
        );

        return row ? row.n : 0;
    }

    /**
     * Find a session by dive, line and type within a project, or create one.
     *
     * Find-or-create rather than create, because a job is one piece of a video
     * and a dive-and-line will be submitted many times over. `lineId` is written
     * as `dive_line`, which is the shape every existing session uses.
     *
     * @async
     * @param {Object} params - Session identity.
     * @param {number} params.projectId - Project the session belongs to.
     * @param {string} params.dive - Dive name.
     * @param {string} params.line - Line name.
     * @param {string} params.type - Session type, e.g. `Invert`.
     * @param {number|null} params.userId - User to record as the session's owner.
     * @param {Object} [transaction] - Transaction to work inside.
     * @returns {Promise<{session: Object, created: boolean}>} The session row.
     */
    async findOrCreateSession({ projectId, dive, line, type, userId }, transaction) {
        const [existing] = await this.db.sequelize.query(
            `SELECT * FROM sessions
              WHERE project_id = :projectId AND dive = :dive AND line = :line AND type = :type
              ORDER BY session_id
              LIMIT 1`,
            {
                replacements: { projectId, dive, line, type },
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        if (existing) {
            return { session: existing, created: false };
        }

        const [rows] = await this.db.sequelize.query(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, :userId, :dive, :line, :lineId, :type, NOW(), NOW())
             RETURNING *`,
            {
                replacements: {
                    projectId,
                    userId,
                    dive,
                    line,
                    lineId: `${dive}_${line}`,
                    type,
                },
                transaction,
            }
        );

        return { session: rows[0], created: true };
    }

    /**
     * Fetch one session.
     *
     * @async
     * @param {number} sessionId - Session identifier.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<Object|null>} The session row, or null.
     */
    async getSession(sessionId, transaction) {
        const [row] = await this.db.sequelize.query(
            'SELECT * FROM sessions WHERE session_id = :sessionId',
            { replacements: { sessionId }, type: QueryTypes.SELECT, transaction }
        );

        return row || null;
    }

    /**
     * The species rows a model was trained with whose common name matches.
     *
     * `model_species` is a record of which species a model was trained with, not
     * a class-index translation table, and this reads it only in that sense: it
     * is the model's own trained-species list, which is what settles a common
     * name that more than one species row carries.
     *
     * @async
     * @param {number} mlModelId - Registered model identifier.
     * @param {string} comname - Common name as the worker reported it.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<Array<Object>>} Matching species rows.
     */
    async findTrainedSpeciesByName(mlModelId, comname, transaction) {
        return this.db.sequelize.query(
            `SELECT s.id, s.taxserial, s.comname, s.species_list, s.observation_type
               FROM model_species ms
               JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :mlModelId AND s.comname = :comname
              ORDER BY s.id`,
            {
                replacements: { mlModelId, comname },
                type: QueryTypes.SELECT,
                transaction,
            }
        );
    }

    /**
     * Every common name a model was trained with, for the worker to check
     * against the weights it actually loaded (#214).
     *
     * A job spec names a model and carries its sha256, and the worker verifies
     * that hash against the *file*. Nothing then checks that the file it loaded
     * is the model the job meant -- `species_names` comes from the loaded
     * weights and the window's footer comes from the spec, and the two are
     * never reconciled. A run using weights nobody asked for therefore produces
     * confident, plausible, wrong species and the only thing that catches it is
     * a person looking at a screen. That happened on 2026-09-18.
     *
     * These names are the same ones the ingest resolves detections against, so
     * a model whose loaded classes do not match this list could not have its
     * output ingested anyway -- the check just moves the discovery from after
     * the run to before it.
     *
     * @async
     * @param {number} mlModelId - Registered model identifier.
     * @returns {Promise<Array<string>>} Trained common names, sorted.
     * @throws {Error} Re-throws any database failure.
     */
    async trainedSpeciesNames(mlModelId) {
        const rows = await this.db.sequelize.query(
            `SELECT DISTINCT s.comname
               FROM model_species ms
               JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :mlModelId
                AND s.comname IS NOT NULL
              ORDER BY s.comname`,
            { replacements: { mlModelId }, type: QueryTypes.SELECT }
        );

        return rows.map((row) => row.comname);
    }

    /**
     * Every species row carrying a common name, whatever list it is on.
     *
     * The fallback for a model whose trained-species list does not name the
     * class. Still requires exactly one match: two rows means the name is
     * ambiguous and nothing here may choose between them.
     *
     * @async
     * @param {string} comname - Common name as the worker reported it.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<Array<Object>>} Matching species rows.
     */
    async findSpeciesByName(comname, transaction) {
        return this.db.sequelize.query(
            `SELECT id, taxserial, comname, species_list, observation_type
               FROM species
              WHERE comname = :comname
              ORDER BY id`,
            { replacements: { comname }, type: QueryTypes.SELECT, transaction }
        );
    }

    /**
     * The distinct species lists a model was trained against.
     *
     * What the session type is checked against: an inverts model writing into a
     * `Fish` session is wrong in a way no error would otherwise surface.
     *
     * @async
     * @param {number} mlModelId - Registered model identifier.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<Array<string>>} Species list names, ascending.
     */
    async listModelSpeciesLists(mlModelId, transaction) {
        const rows = await this.db.sequelize.query(
            `SELECT DISTINCT s.species_list
               FROM model_species ms
               JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :mlModelId AND s.species_list IS NOT NULL
              ORDER BY s.species_list`,
            { replacements: { mlModelId }, type: QueryTypes.SELECT, transaction }
        );

        return rows.map((row) => row.species_list);
    }

    /**
     * The species list of this exact name, if any species are on it.
     *
     * This is what lets a **new** model work without a deploy (#223). Seeding a
     * vocabulary is a script and takes effect at once; `db/species-lists.js` is
     * code and takes effect on the next restart. Between the two a job ran,
     * stored its artifact, reported `succeeded` and wrote nothing -- twice in one
     * day, on `MBARI_315k` and `MBARI_Megalodon`.
     *
     * So a session type that **is** the name of a list resolves to it. That is
     * already how most of the catalogue reads (`Fish` -> `Fish`,
     * `Habitat` -> `Habitat`), and it is a lookup rather than a guess: the list
     * has to exist, with species on it, or this returns null and the caller
     * refuses. The static map still answers first, which is what keeps
     * `Invert` -> `Inverts` and `MBARI_Benthic` -> `MBARI_Benthic_Supercategory`
     * meaning what they have always meant.
     *
     * @async
     * @param {string} name - A candidate `species.species_list` value.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<string|null>} The list name as stored, or null.
     */
    async speciesListNamed(name, transaction) {
        if (typeof name !== 'string' || name.trim() === '') {
            return null;
        }

        const [row] = await this.db.sequelize.query(
            `SELECT species_list
               FROM species
              WHERE species_list = :name
              LIMIT 1`,
            { replacements: { name: name.trim() }, type: QueryTypes.SELECT, transaction }
        );

        return row ? row.species_list : null;
    }

    /**
     * Fetch one registered model.
     *
     * @async
     * @param {number} mlModelId - Registered model identifier.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<Object|null>} The model row, or null.
     */
    async getModel(mlModelId, transaction) {
        const [row] = await this.db.sequelize.query(
            'SELECT * FROM ml_models WHERE id = :mlModelId',
            { replacements: { mlModelId }, type: QueryTypes.SELECT, transaction }
        );

        return row || null;
    }

    /**
     * Write a job's observations and their keyframes, all or nothing.
     *
     * Each entry in `observations` is a fully-resolved row: the caller has already
     * turned a class name into a species and a frame index into timecodes. This
     * method's only remaining decisions are the three key columns, which is why
     * it holds the advisory lock.
     *
     * **A thumbnail is enqueued for every keyframe this writes, and nothing here
     * does it** (#118's A3, reversed by the human 2026-09-10). `insertKeyframes`
     * below fires `keyframes_enqueue_thumbnail_trigger`, so the queue entry is
     * written inside this transaction and a rollback takes it too.
     *
     * **There is deliberately no call to the thumbnail repository here.** One was
     * written first and it was wrong: it covered this path and silently missed
     * every hand-annotated observation, which reaches the database through two
     * other repositories. The trigger moves whatever code path performs the write,
     * which is the same reason `observations.version` is a trigger.
     *
     * @async
     * @param {Object} params - What to write.
     * @param {number} params.jobId - GPU job the rows are attributed to.
     * @param {number} params.sessionId - Session the observations belong to.
     * @param {number|null} params.projectId - Project, from the session.
     * @param {string} params.sessionType - Session type, for the `PobsID` series.
     * @param {Array<Object>} params.observations - `{row, keyframes}` entries.
     * @returns {Promise<Object>} `{observations, keyframes, observation_ids}`.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async writeJobObservations({ jobId, sessionId, projectId, sessionType, observations, attemptId }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            // Serialise every writer that assigns observation_id as max + 1.
            // Transaction-scoped, so the commit below releases it.
            await this.db.sequelize.query(
                'SELECT pg_advisory_xact_lock(:key)',
                { replacements: { key: OBSERVATION_KEY_LOCK }, type: QueryTypes.SELECT, transaction }
            );

            // Taken again inside the lock, because the check the service made
            // before calling was outside it and two replays could both have
            // passed it.
            //
            // **Only when this is the job's one and only ingest.** A job that
            // an operator stopped and somebody else finished is ingested once
            // per attempt, and counting the job's observations would see the
            // first attempt's rows and refuse the second -- silently, reported
            // as `already_ingested`, which reads like success while the second
            // volunteer's work is dropped. The attempt's own `ingested_at` is
            // the guard in that case, claimed before this is called, and it
            // closes the same race this check exists for.
            if (attemptId === undefined || attemptId === null) {
                const already = await this.countObservationsForJob(jobId, transaction);

                if (already > 0) {
                    await transaction.commit();

                    return {
                        observations: 0,
                        keyframes: 0,
                        observation_ids: [],
                        already_ingested: already,
                    };
                }
            }

            const nextObservationId = await this.nextKey(
                'SELECT COALESCE(MAX(observation_id), 0)::int AS m FROM observations',
                {},
                transaction
            );

            const nextObsId = await this.nextKey(
                'SELECT COALESCE(MAX("obsID"), 0)::int AS m FROM observations WHERE session_id = :sessionId',
                { sessionId },
                transaction
            );

            // PobsID runs across every session in the project sharing this type,
            // which is what `observation.repository.js#getMaxPobsID` computes.
            const nextPobsId = await this.nextKey(
                `SELECT COALESCE(MAX(o."PobsID"), 0)::int AS m
                   FROM observations o
                   JOIN sessions s ON s.session_id = o.session_id
                  WHERE s.project_id = :projectId AND s.type = :sessionType`,
                { projectId, sessionType },
                transaction
            );

            const observationIds = [];
            let keyframesWritten = 0;

            for (let index = 0; index < observations.length; index += 1) {
                const { row, keyframes } = observations[index];
                const observationId = nextObservationId + index;

                await this.insertObservation({
                    ...row,
                    observation_id: observationId,
                    obsID: nextObsId + index,
                    PobsID: nextPobsId + index,
                    session_id: sessionId,
                    project_id: projectId,
                    gpu_job_id: jobId,
                    // The attempt whose settings produced this row (#232). Null
                    // on the path with no attempt, as it has no settings either.
                    gpu_attempt_id: attemptId ?? null,
                }, transaction);

                keyframesWritten += await this.insertKeyframes(observationId, keyframes, transaction);
                observationIds.push(observationId);
            }

            await transaction.commit();

            return {
                observations: observationIds.length,
                keyframes: keyframesWritten,
                observation_ids: observationIds,
                already_ingested: 0,
            };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Read a maximum and return the next value after it.
     *
     * @async
     * @param {string} sql - Query selecting a single `m` column.
     * @param {Object} replacements - Query replacements.
     * @param {Object} transaction - Transaction to read inside.
     * @returns {Promise<number>} The maximum plus one, or 1 when there is none.
     */
    async nextKey(sql, replacements, transaction) {
        const [row] = await this.db.sequelize.query(
            sql,
            { replacements, type: QueryTypes.SELECT, transaction }
        );

        return (row && row.m ? Number(row.m) : 0) + 1;
    }

    /**
     * Insert one observation row.
     *
     * Written as SQL because `db.observations.create` sends an explicit null for
     * `observation_id` and fails; see this module's header.
     *
     * @async
     * @param {Object} row - A value for every column in `OBSERVATION_COLUMNS`
     * except the two timestamps, which are set to now.
     * @param {Object} transaction - Transaction to write inside.
     * @returns {Promise<void>} Resolves once the row exists.
     */
    async insertObservation(row, transaction) {
        const columns = OBSERVATION_COLUMNS
            .filter((column) => column !== 'createdAt' && column !== 'updatedAt');

        const quoted = columns.map((column) => `"${column}"`).join(', ');
        const bound = columns.map((column) => `:${column}`).join(', ');

        const replacements = {};

        for (const column of columns) {
            replacements[column] = row[column] === undefined ? null : row[column];
        }

        await this.db.sequelize.query(
            `INSERT INTO observations (${quoted}, "createdAt", "updatedAt")
             VALUES (${bound}, NOW(), NOW())`,
            { replacements, transaction }
        );
    }

    /**
     * Insert one observation's keyframes.
     *
     * Geometry is passed through exactly as the worker sent it. A width over 1.0
     * is not clamped: it is what the reduction produced, and correcting it here
     * would replace a recorded value with a guess.
     *
     * @async
     * @param {number} observationId - Observation the keyframes belong to.
     * @param {Array<Object>} keyframes - `{subset, comname, type, framenum, x, y, width, height}`.
     * @param {Object} transaction - Transaction to write inside.
     * @returns {Promise<number>} How many rows were written.
     */
    async insertKeyframes(observationId, keyframes, transaction) {
        for (const keyframe of keyframes) {
            await this.db.sequelize.query(
                `INSERT INTO keyframes
                     (observation_id, subset, comname, type, framenum, x, y, width, height, confidence, "createdAt", "updatedAt")
                 VALUES
                     (:observationId, :subset, :comname, :type, :framenum, :x, :y, :width, :height, :confidence, NOW(), NOW())`,
                {
                    replacements: {
                        observationId,
                        subset: keyframe.subset,
                        comname: keyframe.comname,
                        type: keyframe.type,
                        framenum: keyframe.framenum,
                        x: keyframe.x,
                        y: keyframe.y,
                        width: keyframe.width,
                        height: keyframe.height,
                        confidence: keyframe.confidence === undefined ? null : keyframe.confidence,
                    },
                    transaction,
                }
            );
        }

        return keyframes.length;
    }
}

module.exports = new ObservationIngestRepository();
