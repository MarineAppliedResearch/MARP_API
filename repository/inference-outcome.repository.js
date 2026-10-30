/**
 * What an inference job actually produced.
 *
 * **A separate file from `gpu.repository.js` on purpose.** That file is the busiest in
 * the repository and several agents work here at once; everything below is additive and
 * reads tables nothing else here writes, so keeping it apart means this cannot conflict
 * with somebody else's work in a file neither of us owns.
 *
 * The count already existed in one place -- inside `jobDeletionImpact`, to warn somebody
 * what a delete would take with it. That is the same number, asked for the opposite
 * reason, and it is not served anywhere a screen can reach.
 *
 * @fileoverview Reading an inference job's observations.
 * @module repository/inference-outcome.repository
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

class InferenceOutcomeRepository {
    /**
     * @param {Object} [database] - Model registry; the shared one by default.
     */
    constructor(database = db) {
        this.db = database;
    }

    /**
     * What one job wrote, and which species it wrote.
     *
     * **Grouped by `species_id`, not by the observation's own `comname`.** The two are
     * different facts and they drift apart the moment anybody reviews the output: a
     * species correction changes `species_id` and deliberately never rewrites `comname`,
     * which stays the label the model produced. So `comname` answers *what the model
     * said* and `species_id` answers *what it is*, and a screen asking "which species did
     * this job find" wants the second -- otherwise a corrected observation keeps being
     * counted under the name somebody already rejected.
     *
     * The model's own label is returned beside it, because where the two disagree that
     * disagreement is the interesting part rather than noise.
     *
     * **Null `species_id` is kept rather than dropped.** An observation whose species was
     * never resolved is still something the job produced, and a count that silently
     * omitted it would not add up to the total beside it.
     *
     * @async
     * @param {number} jobId - The GPU job.
     * @returns {Promise<Object|null>} `{job_id, state, session_id, ml_model_id,
     *   observations, species}` or null when there is no such job.
     */
    async findJobOutcome(jobId) {
        const [job] = await this.db.sequelize.query(
            `SELECT j.id AS job_id, j.kind, j.state,
                    (j.spec->'session'->>'session_id')::int AS session_id,
                    (j.spec->'model'->>'ml_model_id')::int AS ml_model_id,
                    (SELECT COUNT(*)::int FROM observations o WHERE o.gpu_job_id = j.id) AS observations
               FROM gpu_jobs j WHERE j.id = :jobId`,
            { replacements: { jobId }, type: QueryTypes.SELECT }
        );

        if (!job) return null;

        const species = await this.db.sequelize.query(
            `SELECT o.species_id,
                    s.comname AS species_name,
                    o.comname AS reported_name,
                    COUNT(*)::int AS observations
               FROM observations o
               LEFT JOIN species s ON s.id = o.species_id
              WHERE o.gpu_job_id = :jobId
              GROUP BY o.species_id, s.comname, o.comname
              ORDER BY COUNT(*) DESC, s.comname, o.comname`,
            { replacements: { jobId }, type: QueryTypes.SELECT }
        );

        return { ...job, species };
    }

    /**
     * What every piece of one run wrote together, and which species.
     *
     * **One query for the run, not one per piece.** A long video is split into pieces that
     * share a `batch_id` -- 82 of them for one CAMPA dive -- and reading each piece's
     * outcome to add them up on the page was 82 requests for one number (#288).
     *
     * Grouped exactly as `findJobOutcome` groups one job, so a run's breakdown and its
     * pieces' breakdowns add up to the same thing.
     *
     * **How far the run has got travels with the count**, by state, because a total from
     * a run still going is a total *so far* and a screen has to be able to say so.
     *
     * @async
     * @param {string} batchId - The run's `batch_id`.
     * @returns {Promise<Object|null>} `{batch_id, pieces, states, session_ids, session_id,
     *   observations, species}`, or null when no job carries that `batch_id`.
     */
    async findBatchOutcome(batchId) {
        const pieces = await this.db.sequelize.query(
            `SELECT j.state, COUNT(*)::int AS pieces,
                    array_agg(DISTINCT (j.spec->'session'->>'session_id')::int)
                        FILTER (WHERE j.spec->'session'->>'session_id' IS NOT NULL) AS session_ids
               FROM gpu_jobs j
              WHERE j.batch_id = :batchId
              GROUP BY j.state`,
            { replacements: { batchId }, type: QueryTypes.SELECT }
        );

        if (!pieces.length) return null;

        const states = Object.fromEntries(pieces.map((row) => [row.state, row.pieces]));
        const sessionIds = [...new Set(pieces.flatMap((row) => row.session_ids || []))].sort((a, b) => a - b);

        const species = await this.db.sequelize.query(
            `SELECT o.species_id,
                    s.comname AS species_name,
                    o.comname AS reported_name,
                    COUNT(*)::int AS observations
               FROM observations o
               JOIN gpu_jobs j ON j.id = o.gpu_job_id
               LEFT JOIN species s ON s.id = o.species_id
              WHERE j.batch_id = :batchId
              GROUP BY o.species_id, s.comname, o.comname
              ORDER BY COUNT(*) DESC, s.comname, o.comname`,
            { replacements: { batchId }, type: QueryTypes.SELECT }
        );

        return {
            batch_id: batchId,
            pieces: pieces.reduce((sum, row) => sum + row.pieces, 0),
            states,
            session_ids: sessionIds,
            /* The one session when there is one, which is the usual case: a run is one
               video, and a run makes its own session. */
            session_id: sessionIds.length === 1 ? sessionIds[0] : null,
            observations: species.reduce((sum, row) => sum + row.observations, 0),
            species,
        };
    }
    /**
     * The pieces a timeline covers: one job, or every job of one run, in frame order.
     *
     * @async
     * @param {Object} which - `{jobId}` or `{batchId}`.
     * @returns {Promise<Object[]>} `{job_id, state, start_frame, end_frame, jellyfin_item_id}`.
     */
    async findTimelinePieces({ jobId = null, batchId = null }) {
        return this.db.sequelize.query(
            `SELECT j.id AS job_id, j.state,
                    (j.spec->'range'->>'start_frame')::int AS start_frame,
                    (j.spec->'range'->>'end_frame')::int AS end_frame,
                    j.spec->'video'->>'jellyfin_item_id' AS jellyfin_item_id
               FROM gpu_jobs j
              WHERE j.kind = 'inference'
                AND ${jobId !== null ? 'j.id = :jobId' : 'j.batch_id = :batchId'}
              ORDER BY (j.spec->'range'->>'start_frame')::int NULLS LAST, j.id`,
            { replacements: { jobId, batchId }, type: QueryTypes.SELECT }
        );
    }

    /**
     * Observations per species per stretch of video time, counted here rather than sent.
     *
     * `mediaPosition` is the time in the video an observation was seen, as
     * `HH:MM:SS.fffffff`. A row whose position is missing or not in that shape is left
     * out rather than guessed at; every observation the GPU pipeline writes has one.
     *
     * @async
     * @param {Object} params - `{jobIds, bucketSeconds, fromSeconds}`.
     * @returns {Promise<Object[]>} `{species_id, species_name, reported_name, bucket, n}`.
     */
    async countByTime({ jobIds, bucketSeconds, fromSeconds }) {
        if (!jobIds.length) return [];

        return this.db.sequelize.query(
            `SELECT o.species_id,
                    s.comname AS species_name,
                    o.comname AS reported_name,
                    FLOOR((EXTRACT(EPOCH FROM o."mediaPosition"::interval) - :fromSeconds) / :bucketSeconds)::int AS bucket,
                    COUNT(*)::int AS n
               FROM observations o
               LEFT JOIN species s ON s.id = o.species_id
              WHERE o.gpu_job_id IN (:jobIds)
                AND o."mediaPosition" ~ '^[0-9]+:[0-9]{2}:[0-9]{2}([.][0-9]+)?$'
              GROUP BY 1, 2, 3, 4`,
            { replacements: { jobIds, bucketSeconds, fromSeconds }, type: QueryTypes.SELECT }
        );
    }

    /**
     * The video file name the observations of these jobs recorded, for when Jellyfin is not answering.
     *
     * @async
     * @param {number[]} jobIds - The jobs.
     * @returns {Promise<string|null>} The most common `video_source`, or null when none was recorded.
     */
    async observedVideoName(jobIds) {
        if (!jobIds.length) return null;

        const [row] = await this.db.sequelize.query(
            `SELECT video_source FROM observations
              WHERE gpu_job_id IN (:jobIds) AND video_source IS NOT NULL
              GROUP BY video_source ORDER BY COUNT(*) DESC LIMIT 1`,
            { replacements: { jobIds }, type: QueryTypes.SELECT }
        );

        return row ? row.video_source : null;
    }
}


module.exports = new InferenceOutcomeRepository();
module.exports.InferenceOutcomeRepository = InferenceOutcomeRepository;
