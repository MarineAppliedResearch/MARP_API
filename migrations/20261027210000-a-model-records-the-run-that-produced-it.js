'use strict';

/**
 * Records which training run produced a registered model (#268).
 *
 * **Three cells on two screens were confidently wrong because this link did not exist.**
 * The registry's *Training dataset* column and both *Produces* columns on Training read
 * `training_runs.model_id` as the model a run produced. It is the model a run started
 * *from* — `gpu.service.js` requires it on submission as the starting checkpoint, and the
 * run is recorded against it. So every finished run claimed to have produced
 * `rockfish5-2026-10-20`, the checkpoint all six fine-tuned from, while the models they
 * actually produced showed a dash. Those cells now say nothing; this is what lets them
 * say something true.
 *
 * **The link was already being recorded, as prose.** `registerTrainedModel` appends
 * ` Produced ml_models <id>.` to `training_runs.notes`, which is a fact no query can join
 * on and no screen can read. This moves it into a column and leaves the sentence alone:
 * it is the human-readable provenance, and the registration guard reads a sibling marker
 * in `ml_models.notes` to refuse registering one job twice.
 *
 * **Backfilled from that note, not from the artifact digest.** Both work today and both
 * agree on all six rows, but they are not equally sound. The digest route —
 * `artifacts.hash = ml_models.artifact_sha256`, then `training_runs.job_id =
 * artifacts.job_id` — is a derivation: `artifacts.hash` carries no uniqueness constraint,
 * and `recordJobArtifacts` writes a row per attempt, so a retry that reproduces identical
 * bytes will one day put two rows behind one hash and the join will quietly return two
 * runs. It is right today by accident, which is the same shape as the bug being fixed
 * here. The note is what the registration wrote when it knew the answer.
 *
 * The artifact join is used as the *check*: the migration refuses if the two disagree.
 *
 * **Nullable, and most rows stay null.** Models that predate the pipeline were registered
 * by hand or by the legacy desktop script and no run produced them. Null means "no
 * recorded run", which is a fact rather than a gap to be filled by guessing.
 *
 * `ON DELETE SET NULL`: a model outlives the run that made it. Deleting a run must not
 * cascade into the registry, and a model whose run has been cleared is still a model.
 *
 * @fileoverview Migration adding ml_models.training_run_id.
 * @author Isaac Travers
 * @module migrations/a-model-records-the-run-that-produced-it
 */

const { guardDataIntegrity } = require('../db/data-integrity');

/** The tables this migration can affect, watched for loss while it runs. */
const WATCHED = ['ml_models', 'training_runs'];

/** @type {Object} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: WATCHED,
                label: 'model-run-provenance',
                work: async () => {
                    await queryInterface.addColumn('ml_models', 'training_run_id', {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        references: { model: 'training_runs', key: 'id' },
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL',
                        comment: 'The training run that produced this model, when one did. '
                            + 'NULL for a model registered outside the pool, which is not an error. '
                            + 'Not to be confused with training_runs.model_id, which is the base '
                            + 'model a run started FROM.',
                    }, { transaction });

                    await queryInterface.addIndex('ml_models', ['training_run_id'], {
                        name: 'ml_models_training_run_id_idx',
                        transaction,
                    });

                    /* The note is written as ` Produced ml_models <id>.` by
                       `registerTrainedModel`. Anchored on the full sentence so a model id
                       that is a prefix of another cannot match the wrong row. */
                    const [, meta] = await sequelize.query(
                        `UPDATE ml_models m
                            SET training_run_id = r.id
                           FROM training_runs r
                          WHERE r.notes LIKE concat('%Produced ml_models ', m.id, '.%')
                            AND m.training_run_id IS NULL`,
                        { transaction }
                    );

                    const filled = meta && typeof meta.rowCount === 'number' ? meta.rowCount : 0;
                    console.log(`[model-run-provenance] linked ${filled} model(s) from the registration note`);

                    /* **The digest route as a check, never as the source.** If the two
                       disagree, one of them is wrong and this migration is not the place
                       to decide which. */
                    const [disagreements] = await sequelize.query(
                        `SELECT m.id AS model_id, m.training_run_id AS from_note, r.id AS from_artifact
                           FROM ml_models m
                           JOIN artifacts a
                             ON a.hash = m.artifact_sha256 AND a.artifact_type = 'weights'
                           JOIN training_runs r ON r.job_id = a.job_id
                          WHERE m.training_run_id IS NOT NULL
                            AND r.id <> m.training_run_id`,
                        { transaction, type: Sequelize.QueryTypes.SELECT }
                    );

                    if (disagreements && disagreements.length > 0) {
                        const detail = disagreements
                            .map((row) => `model ${row.model_id}: note says run ${row.from_note}, weights say ${row.from_artifact}`)
                            .join('; ');
                        throw new Error(`Registration notes and weight artifacts disagree: ${detail}`);
                    }

                    console.log('[model-run-provenance] the weights artifacts agree with every link written');
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the column.
     *
     * Nothing is restored because nothing was removed: the prose in `training_runs.notes`
     * that this was backfilled from is left untouched by `up`, so going down loses no
     * provenance that was not already duplicated there.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeIndex('ml_models', 'ml_models_training_run_id_idx', { transaction });
            await queryInterface.removeColumn('ml_models', 'training_run_id', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
