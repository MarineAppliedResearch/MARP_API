/**
 * The session an inference run creates for itself.
 *
 * **One session per run, by Isaac's decision on 2026-10-27**, put to him with the cost
 * stated: a dive scanned in six submissions becomes six sessions on the annotation GUI's
 * opening screen. He chose it anyway, because who ran it differs between runs and a
 * session is how that is recorded.
 *
 * **This is a second mechanism beside the ingest's find-or-create, not a change to it.**
 * `spec.session` has always accepted `{project_id, dive, line, type}`, and
 * `observation-ingest.repository.js` resolves that by finding an existing session before
 * creating one -- deliberately, because *a job is one piece of a video and a dive-and-line
 * will be submitted many times over*. That reuse is still right for a spec written that
 * way, and two tests hold it in place. So the per-run form is opt-in under its own key and
 * nothing already submitting the descriptive form moves.
 *
 * A piece split is still one run: `piece_frames` turns one submission into several jobs
 * covering one video, and they share the session, because the person submitted one thing.
 *
 * @fileoverview Creating the session for one inference run.
 * @module service/inference-session
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const { inferenceProcessorId } = require('../db/inference-processor');
const { sessionTypeForSpeciesList } = require('../db/species-lists');

class InferenceSessionService {
    /**
     * @param {Object} [database] - Model registry; the shared one by default.
     */
    constructor(database = db) {
        this.db = database;
    }

    /**
     * The session type a model's observations belong in.
     *
     * **Derived rather than asked for.** A session's type chooses the species list its
     * observations are read against, and a model's species already say which list that
     * is -- so asking the submitter is asking them to restate something MARP knows, with
     * a wrong answer refused only later, at ingest, after the GPU has run.
     *
     * **Refused rather than guessed when a model spans two lists.** A model trained
     * across `Fish` and `Inverts` has no single session type, and picking either would
     * silently file half its output against a list that cannot name it.
     *
     * @async
     * @param {number} modelId - The registered model.
     * @param {Object} [transaction] - Transaction to read in.
     * @returns {Promise<{type: string}|{refusal: string}>} The type, or why there is none.
     */
    async sessionTypeForModel(modelId, transaction) {
        const rows = await this.db.sequelize.query(
            `SELECT DISTINCT s.species_list
               FROM model_species ms
               JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :modelId AND s.species_list IS NOT NULL
              ORDER BY s.species_list`,
            { replacements: { modelId }, type: QueryTypes.SELECT, transaction }
        );

        const lists = rows.map((row) => row.species_list);

        if (lists.length === 0) {
            return {
                refusal: `Model ${modelId} has no species mapped to it, so MARP cannot tell which `
                    + 'session type its observations belong in. Run scripts/seed-inference-context.js, '
                    + 'or name spec.session.type yourself.',
            };
        }

        if (lists.length > 1) {
            return {
                refusal: `Model ${modelId} was trained across more than one species list `
                    + `(${lists.join(', ')}), so it has no single session type. A session reads against `
                    + 'one list, so half this model’s output could not be named in whichever was '
                    + 'chosen. Name spec.session.type yourself to say which you mean.',
            };
        }

        return { type: sessionTypeForSpeciesList(lists[0]) };
    }

    /**
     * Create the session for one run.
     *
     * **`user_id` is the inference processor and `created_by` is the submitter**, because
     * they are two different facts and the column that already exists holds only the
     * first. Every automated session has the same producer; each has its own requester.
     * Pointing `user_id` at the person would destroy the only thing distinguishing machine
     * output from hand annotation across 76 existing sessions.
     *
     * `lineId` is `dive_line`, which is the shape every existing session uses and what
     * `findOrCreateSession` writes. Two mechanisms, one convention.
     *
     * @async
     * @param {Object} params - `{projectId, dive, line, type, createdBy}`.
     * @param {Object} [transaction] - Transaction to write in.
     * @returns {Promise<Object>} The session row.
     */
    async createForRun({ projectId, dive, line, type, createdBy = null }, transaction) {
        const userId = await inferenceProcessorId(this.db.sequelize, transaction);

        const [rows] = await this.db.sequelize.query(
            `INSERT INTO sessions (project_id, user_id, created_by, is_automated, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, :userId, :createdBy, true, :dive, :line, :lineId, :type, NOW(), NOW())
             RETURNING *`,
            {
                replacements: {
                    projectId,
                    userId,
                    createdBy,
                    dive,
                    line,
                    lineId: `${dive}_${line}`,
                    type,
                },
                transaction,
            }
        );

        return rows[0];
    }
}

module.exports = new InferenceSessionService();
module.exports.InferenceSessionService = InferenceSessionService;
