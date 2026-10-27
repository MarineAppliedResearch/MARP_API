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
}

module.exports = new InferenceOutcomeRepository();
module.exports.InferenceOutcomeRepository = InferenceOutcomeRepository;
