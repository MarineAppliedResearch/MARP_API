'use strict';

/**
 * Top-1 and top-5 accuracy, as columns rather than as jsonb.
 *
 * **A separate migration from `20261026160000`, deliberately.** That one has been applied
 * -- to a disposable workspace database, but applied -- and Sequelize records a migration
 * by name once it has run. Amending it would mean any database that already holds it
 * silently never receives these two columns, and the divergence would show up as a column
 * that exists on one machine and not another with nothing to explain it. A migration that
 * has run anywhere is immutable; this is the cheap half of that rule.
 *
 * **Columns rather than `details` jsonb, decided 2026-10-27.** The reasoning is about what
 * the dashboard is for: models are compared to decide which is good enough to put in front
 * of a reviewer, and a number that cannot be sorted on, filtered by, or charted across
 * runs is not available for comparison -- it is available for reading one run at a time.
 * For a classification model these two *are* the headline, the way mAP is for detection,
 * so they are not incidental and `details` would be the wrong home.
 *
 * **Double precision, not integer.** They are accuracies -- fractions in [0, 1], like
 * `metrics/accuracy_top1` -- not counts. `support` and `image_count` are the integers on
 * this table; these are not, and storing 0.873 in an integer column would round it to 1
 * and report a perfect classifier.
 *
 * **Null on every detection and segmentation row, and that is correct rather than
 * missing.** `metric_family` says which vocabulary a row is in, so a null here on a `box`
 * row means the measurement does not apply, exactly as a null `map50` does on a
 * `classify` row. Nothing is built that writes these yet: no classification model has been
 * trained, and the engine declares detection.
 *
 * @fileoverview Migration adding classification accuracy to metrics_summary.
 * @module migrations/a-classification-run-records-its-accuracy
 */

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Column to what it holds.
 *
 * @constant
 * @type {Object<string, string>}
 */
const COLUMNS = {
    accuracy_top1: 'Share of images whose single highest-scoring class was the correct '
        + 'one, as the trainer measured it. A fraction in [0, 1], not a count. Null on '
        + 'any row whose metric_family is not classify, where it does not apply rather '
        + 'than being missing.',
    accuracy_top5: 'Share of images whose correct class was among the five '
        + 'highest-scoring. Always at least accuracy_top1, and the gap between them is '
        + 'the useful part: a model that is nearly right about everything is a different '
        + 'thing from one that is confidently wrong.',
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'classification accuracy',
                tables: ['metrics_summary'],
                work: async () => {

            for (const [name, comment] of Object.entries(COLUMNS)) {
                await queryInterface.addColumn('metrics_summary', name, {
                    type: Sequelize.DOUBLE,
                    allowNull: true,
                    comment,
                }, { transaction });
            }
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
            for (const name of Object.keys(COLUMNS)) {
                await queryInterface.removeColumn('metrics_summary', name, { transaction });
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
