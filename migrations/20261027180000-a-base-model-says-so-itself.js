'use strict';

/**
 * A base model says so in a column, rather than being inferred from having no species.
 *
 * **Why a column and not an absence.** A pretrained classifier is a starting point, not a
 * MARP model: its thousand ImageNet classes are not in the species catalogue and it has
 * no species until training gives it some. The tempting shortcut is to treat "no
 * `model_species` rows" as the marker -- and that is wrong twice over. A *trained* model
 * whose species nobody seeded yet also has none, which is unhelpful rather than
 * dangerous; and the inference guard below has to refuse one case while letting the
 * other through. A fact this load-bearing is stated, not inferred.
 *
 * **The hole this closes, which is in code that is correct today.**
 * `checkSessionTypeAgainstModel` returns early when a model has no `model_species` rows,
 * deliberately: *"an unseeded model is unhelpful rather than wrong"*. That reasoning
 * holds for every model MARP has ever registered, because all 18 are trained detectors.
 * The moment species-less base models become a legitimate state, that early return
 * becomes the path by which a base model's ImageNet class names would reach the
 * observation ingest unchallenged. The column is what lets the guard tell the two apart.
 *
 * **Default false, so every existing row keeps meaning what it meant.** Nothing is
 * reclassified by this migration; the 18 registered detectors stay exactly as they are.
 *
 * @fileoverview Migration marking a model as a pretrained starting point.
 * @module migrations/a-base-model-says-so-itself
 */

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'base model flag',
                tables: ['ml_models'],
                work: async () => {

            await queryInterface.addColumn('ml_models', 'is_base', {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: 'True when this is a pretrained starting point for training rather '
                    + 'than a model MARP trained. A base model has no species -- its classes '
                    + 'are the upstream vocabulary, not MARP\'s -- so it must never be '
                    + 'selectable for inference, where its class names would be resolved '
                    + 'against the species catalogue and written into observations. Stated '
                    + 'rather than inferred from having no model_species rows, because a '
                    + 'trained model whose species nobody seeded yet also has none and is '
                    + 'merely unhelpful. False on every row that predates this column.',
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
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeColumn('ml_models', 'is_base', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
