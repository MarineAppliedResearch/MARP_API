/**
 * A pretrained base model cannot be used for inference.
 *
 * **Why this needs a test rather than a comment.** A base model's classes are the
 * upstream vocabulary -- ImageNet's thousand labels for a classifier -- and the
 * observation ingest resolves whatever a run reports against `species.comname`. Run one
 * over video and whichever of those labels happens to collide with a species name is
 * written into `observations`, which puts invented records into a scientific record that
 * people outside this workspace query and report on.
 *
 * **The hole this closes was in code that was correct when it was written.**
 * `checkSessionTypeAgainstModel` returns early for a model with no `model_species` rows,
 * deliberately: *"an unseeded model is unhelpful rather than wrong"*. That held while
 * every registered model was a trained detector. Species-less base models make it the
 * path a base model would travel unchallenged, which is why `is_base` is a stated column
 * rather than an inference from an empty join table -- a trained model whose species
 * nobody seeded yet also has none, and that one must still go through.
 *
 * Two tiers, because they fail differently: submission refuses in one response before any
 * GPU time, and the ingest refuses a job that was queued before the gate existed.
 *
 * @fileoverview The guard keeping base models out of inference.
 * @author Isaac Travers
 * @module tests/base-model-guard
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const gpuService = require('../service/gpu.service');
const observationIngestService = require('../service/observation-ingest.service');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { baseModelId: null, trainedModelId: null };

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

beforeAll(async () => {
    const [base] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, is_base, created_at, updated_at)
         VALUES (:name, 'classification', 'active', false, true, NOW(), NOW())
         RETURNING id`,
        { name: `jest-base-${runId}` }
    );

    made.baseModelId = base.id;

    /* The control, and the reason `is_base` is a column: this one also has no species,
       and it must still be allowed through. */
    const [trained] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, is_base, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, false, NOW(), NOW())
         RETURNING id`,
        { name: `jest-unseeded-${runId}` }
    );

    made.trainedModelId = trained.id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    for (const id of [made.baseModelId, made.trainedModelId]) {
        if (id) await drop('DELETE FROM ml_models WHERE id = :id', { id });
    }
});

describe('Submitting a job that names a base model', () => {
    /**
     * `spec.model` as a submission carries one.
     *
     * @param {?number} mlModelId - The registered model, or null to omit it.
     * @returns {Object} The model block.
     */
    const modelSpec = (mlModelId) => ({
        name: 'whatever',
        sha256: 'a'.repeat(64),
        ...(mlModelId === null ? {} : { ml_model_id: mlModelId }),
    });

    it('refuses a base model, naming it and saying what to do instead', async () => {
        await expect(gpuService.refuseBaseModelForInference(modelSpec(made.baseModelId)))
            .rejects.toThrow(/pretrained base model/i);
    });

    it('refuses it through submitJobs, which is the tier that proves it is wired in', async () => {
        /* **The method behaving is not the same as the method being called.** An earlier
           version of this file asserted only the former, and removing the call site from
           `submitJobs` left it green -- the defect would have shipped with a passing
           test pointing at it. This drives the submission path far enough to reach the
           guard: the video and model blocks are valid, so the first thing that can
           refuse is the base model itself. */
        await expect(gpuService.submitJobs({
            kind: 'inference',
            engine: 'marp_inference',
            spec: {
                engine: 'marp_inference',
                video: { jellyfin_item_id: `jest-${runId}` },
                model: modelSpec(made.baseModelId),
                session: { session_id: 1 },
            },
        }, null)).rejects.toThrow(/pretrained base model/i);
    });

    it('lets a trained model through even when nobody has seeded its species', async () => {
        // The whole reason `is_base` is stated rather than inferred from an empty
        // `model_species`: this model has none either, and it is merely unhelpful.
        await expect(gpuService.refuseBaseModelForInference(modelSpec(made.trainedModelId)))
            .resolves.toBeUndefined();
    });

    it('says nothing about a spec that names no registered model', async () => {
        // `ml_model_id` is optional on an inference spec, and a spec that names no model
        // by id cannot be checked against the registry at all.
        await expect(gpuService.refuseBaseModelForInference(modelSpec(null)))
            .resolves.toBeUndefined();
    });
});

describe('Ingesting a result from a base model', () => {
    /** A session row shaped as the ingest reads one. */
    const session = { session_id: 1, type: 'Invert' };

    it('refuses before the no-species shortcut can let it through', async () => {
        // The backstop. A job queued before the submission gate existed reaches here
        // with its GPU time already spent, and this is the last place that can stop
        // ImageNet labels becoming observations.
        const [model] = await query('SELECT * FROM ml_models WHERE id = :id', { id: made.baseModelId });

        await expect(observationIngestService.checkSessionTypeAgainstModel(session, model))
            .rejects.toThrow(/pretrained base model/i);
    });

    it('still lets an unseeded trained model through', async () => {
        const [model] = await query('SELECT * FROM ml_models WHERE id = :id', { id: made.trainedModelId });

        await expect(observationIngestService.checkSessionTypeAgainstModel(session, model))
            .resolves.toBeUndefined();
    });
});
