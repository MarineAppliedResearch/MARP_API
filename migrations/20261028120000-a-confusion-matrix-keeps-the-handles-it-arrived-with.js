'use strict';

/**
 * A confusion matrix keeps the labels it arrived with, beside the ones it is shown under.
 *
 * **A classification model's class names are dataset folder handles.** Ultralytics takes a
 * classify vocabulary from the subfolder names and keeps no other list, and MARP's folders
 * are handles like `145_blue-deacon-rockfish`, because `comname` is not a filesystem-safe
 * string -- 37 of 1,404 names contain a path separator. So run 209's matrix arrived
 * labelled `126_vermilion-rockfish … 26_kelp-greenling`, and for a classification run the
 * matrix is the *only* per-class output: the report carries one overall row and no
 * per-class metrics at all.
 *
 * `class_names` therefore becomes what the axis is shown under, and this column keeps what
 * the model actually said. The two are the same pair as an observation's `species_id` and
 * its `comname`: what it is, and what the model called it.
 *
 * **Nullable, and null is the normal case.** Every detection run already reports species
 * names, so handle and name are the same string and there is nothing to keep; a row
 * carrying handles is the exception and says so by having them. That also makes the
 * backfill reversible -- `scripts/backfill-confusion-matrix-labels.js` can put the
 * original labels back from here, which a destructive rewrite could not offer.
 *
 * Additive: one nullable column, dropped again by `down`.
 *
 * @fileoverview Migration keeping a confusion matrix's reported labels.
 * @module migrations/a-confusion-matrix-keeps-the-handles-it-arrived-with
 */

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'confusion matrix handles',
                tables: ['training_run_confusion_matrices'],
                work: async () => {
                    await queryInterface.addColumn('training_run_confusion_matrices', 'class_handles', {
                        type: Sequelize.JSONB,
                        allowNull: true,
                        comment: 'The axis labels exactly as the model reported them, kept only '
                            + 'when they differ from what the axis is shown under. A classify '
                            + 'model names its classes after the dataset folders it was trained '
                            + 'from -- 145_blue-deacon-rockfish -- which is the one route back to '
                            + 'that directory in the archive, and is what the .pt itself contains. '
                            + 'Null where the model already reported species names, which is every '
                            + 'detection run. Positional: same length and order as class_names, '
                            + 'because both index the matrix axes.',
                    }, { transaction });
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('training_run_confusion_matrices', 'class_handles');
    },
};
