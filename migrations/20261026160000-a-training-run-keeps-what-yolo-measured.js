'use strict';

/**
 * What YOLO measured about a finished run: per-class quality, and the confusion matrix.
 *
 * `metrics_summary` and `metrics_curves` have existed since the legacy desktop script and
 * hold **zero rows**. Nothing in the GPU pipeline has ever written them. So the first
 * question was not "what tables" but "do these do it", and the answer is: the numbers
 * yes, the pictures no.
 *
 * **The numbers fit, because the catch is narrower than it looks.** `map50`, `map5095`
 * and the `box_*` names are detection's vocabulary, and classification and segmentation
 * are the next two tasks — but `precision`, `recall`, `f1_score` and `fitness` are
 * task-neutral and all three tasks report them. Only the two mAP columns are not. And
 * Ultralytics hands over its own discriminator: `(B)` for box, `(M)` for mask, the same
 * four metric names otherwise. **So a segmentation run needs no new metric columns at
 * all. It needs a second row.** Hence `metric_family` rather than a table per task.
 *
 * Rejected: a table per task (speculative, for tasks nobody has trained); a
 * metric-name/value row shape (survives anything, but discards columns that already
 * exist and are already right for the only task being trained, and turns every read
 * into a pivot).
 *
 * **The pictures do not fit, and that is structural rather than a preference.**
 * `metrics_summary` has eight `*_path` columns that look like an exact match for what
 * Ultralytics writes. They are not: it writes **three** `val_batch*_pred.jpg` files and
 * there is no column for any of them, and a closed set of eight columns can only drop a
 * plot type that arrives in a later version. The plots go to `artifacts`,
 * content-addressed, which is where the model weights already go and what that table's
 * own comment already claims. The eight columns are left where they are — empty,
 * unwritten, and commented as superseded. Dropping a published column on a scientific
 * record is the human's call, and they cost nothing where they sit.
 *
 * **Why the confusion matrix gets its own table.** It is an N-by-N measurement per run
 * per split, not a scalar per class, so a column on `metrics_summary` would be
 * meaningful on one row in N and null on the rest. Putting it in `details` would make a
 * documented structure undocumented. Serving the stored JSON artifact directly and
 * keeping no column was tempting at zero schema cost and rejected: it would make the
 * worker's wire format MARP's public contract, and nothing could be queried across runs.
 *
 * **It is stored in the trainer's own orientation, with that orientation named.**
 * Ultralytics' `metrics.py:400` is `self.matrix[p][t] += 1`, so its row is the
 * *predicted* class and its column the *true* one — the transpose of how a person reads
 * a confusion matrix. `db/final-metrics.js` transposes once on the way out. Rotating on
 * the way in would bake today's convention into the record, and every stored matrix
 * would become silently wrong the day a worker changed it.
 *
 * Additive and reversible throughout: two nullable columns and one new table.
 *
 * @fileoverview Migration adding final-metrics columns and the confusion matrix table.
 * @module migrations/a-training-run-keeps-what-yolo-measured
 */

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * The two columns `metrics_summary` gains.
 *
 * @constant
 * @type {Object<string, string>}
 */
const SUMMARY_COLUMNS = {
    metric_family: 'Which vocabulary this row\'s numbers are in: box, mask or classify. '
        + 'Ultralytics suffixes its metrics (B) for box and (M) for mask and reports the '
        + 'same four names otherwise, so a segmentation run writes a box row and a mask '
        + 'row per class rather than needing new columns. Without this column a '
        + 'classification row with a null map50 is indistinguishable from a detection '
        + 'row that failed to measure one.',
    class_name: 'The class as the model named it. Null means this is the all-classes '
        + 'aggregate. Set with a null species_id means a class MARP could not resolve to '
        + 'a species, which is kept rather than dropped -- species_id alone could not '
        + 'tell those two apart, and the model is actively predicting that class.',
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'yolo training output',
                /* `training_runs` is the only pre-existing table the new one
                   references; `metrics_summary` is the one being altered. The foreign
                   keys in and out of both are discovered from the database. */
                tables: ['training_runs', 'metrics_summary'],
                work: async () => {

            for (const [name, comment] of Object.entries(SUMMARY_COLUMNS)) {
                await queryInterface.addColumn('metrics_summary', name, {
                    type: Sequelize.STRING,
                    allowNull: true,
                    comment,
                }, { transaction });
            }

            /* An index on the lookup every read does: one run's rows, in one family.
               `metrics_summary` is empty today and a training run produces a row per
               class, so this matters the first time somebody opens a 90-class run. */
            await queryInterface.addIndex('metrics_summary', {
                fields: ['training_run_id', 'metric_family'],
                name: 'metrics_summary_training_run_id_metric_family',
                transaction,
            });

            await queryInterface.createTable('training_run_confusion_matrices', {
                id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    primaryKey: true,
                    autoIncrement: true,
                    comment: 'Unique identifier for this stored confusion matrix.',
                },
                training_run_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'training_runs', key: 'id' },
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE',
                    comment: 'The run this matrix measures. Cascades, because a '
                        + 'matrix is not a fact about anything but its run.',
                },
                dataset_split: {
                    type: Sequelize.STRING,
                    allowNull: false,
                    comment: 'Which split was evaluated, as the worker stated it. '
                        + 'Never inferred: final_eval happening to use the '
                        + 'validation split is a fact about today\'s Ultralytics, '
                        + 'not something MARP may assert on its behalf.',
                },
                orientation: {
                    type: Sequelize.STRING,
                    allowNull: false,
                    comment: 'How the stored matrix is indexed, as the producer '
                        + 'named it. rows_predicted_cols_true is Ultralytics\' own '
                        + '(metrics.py:400, matrix[p][t] += 1) and is the transpose '
                        + 'of how a reader reads one. Stored rather than normalised '
                        + 'so that a producer changing convention says so, instead '
                        + 'of every earlier row quietly becoming wrong.',
                },
                class_names: {
                    type: Sequelize.JSONB,
                    allowNull: false,
                    comment: 'The class vocabulary in index order. A matrix without '
                        + 'it cannot be read at all -- a class index is meaningless '
                        + 'on its own, which is the same reason a dataset records '
                        + 'its class order.',
                },
                background_index: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    comment: 'Index of the background row and column, which is nc '
                        + 'for detect, segment and obb. Null for classify and '
                        + 'semantic, which have no background class. Kept rather '
                        + 'than trimmed: it holds the false negatives and false '
                        + 'positives, and the row sums mean nothing without it.',
                },
                matrix: {
                    type: Sequelize.JSONB,
                    allowNull: false,
                    comment: 'The counts, square, exactly as the trainer produced '
                        + 'them. Never derived: a matrix assembled from per-class '
                        + 'precision and recall is arithmetic dressed as a '
                        + 'measurement, and the off-diagonal -- the only part '
                        + 'anybody looks at -- is what a derivation cannot know.',
                },
                created_at: { type: Sequelize.DATE, allowNull: false },
                updated_at: { type: Sequelize.DATE, allowNull: false },
            }, { transaction });

            /* One matrix per run per split. A re-reported result for the same
               attempt must update rather than accumulate, the way the artifact
               hand-off is idempotent on its hash. */
            await queryInterface.addIndex('training_run_confusion_matrices', {
                fields: ['training_run_id', 'dataset_split'],
                name: 'training_run_confusion_matrices_run_split',
                unique: true,
                transaction,
            });
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.dropTable('training_run_confusion_matrices', { transaction });

            await queryInterface.removeIndex(
                'metrics_summary',
                'metrics_summary_training_run_id_metric_family',
                { transaction }
            );

            for (const name of Object.keys(SUMMARY_COLUMNS)) {
                await queryInterface.removeColumn('metrics_summary', name, { transaction });
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
