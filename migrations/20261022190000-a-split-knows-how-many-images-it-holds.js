'use strict';

/**
 * How many images each split of a dataset holds.
 *
 * The Composition panel shows three numbers per split -- percentage, observations,
 * images -- and the third had nowhere to come from. `dataset_observations` records which
 * split an observation went to and nothing about how many frames it became: one
 * observation is a span between keyframes, and 164 of them became 15,020 images in the
 * first large build.
 *
 * **Recorded rather than counted on read, which reverses how this first shipped.** It was
 * counted out of the archive by walking the tar's headers -- honest, because that is what
 * a training run actually reads, and it needed no migration. Isaac's objection settled it:
 * *"i'd rather not have to count the images in each archive everytime we have to load the
 * thing, it'd probably be better to record it in the database?"* The number cannot change
 * after a build -- the archive is immutable and addressed by its own hash -- so paying a
 * read for it every time the panel opens is paying repeatedly to re-derive a constant.
 *
 * **A table rather than columns on `datasets`.** The splits are not a fixed set:
 * `SPLIT_DIRECTORIES` sends `validation` and `eval` to one directory and `test` to
 * another, and a build names its own subsets. Three columns would write today's split
 * names into the schema and be wrong the first time somebody adds a fourth. `datasets` is
 * also part of the scientific record, so a new table is a far smaller thing to justify
 * than new columns on that one.
 *
 * **Images only; the observation count stays where it already is.** `dataset_observations`
 * is the record of membership and counting it is the truth about what is in a dataset
 * now. Storing a second copy here would make two numbers for one thing that can disagree
 * -- the cascade on `dataset_observations.observation_id` removes a membership row when an
 * observation is deleted -- and which of them the panel showed would decide which
 * question it was silently answering. The dataset-level `num_observations` already carries
 * the build-time figure for anybody who wants that one.
 *
 * **No backfill here.** A dataset built before this has no recorded count, and null means
 * *not known* rather than zero -- a distinction that matters, because zero images in a
 * split is a fact and a backfill writing zeroes would lie about `rockfish5`. The existing
 * datasets are filled in by `scripts/backfill-split-images.js`, which counts their
 * archives once and records nothing for an archive it cannot read.
 *
 * @fileoverview Migration adding the dataset_splits table.
 * @module migrations/a-split-knows-how-many-images-it-holds
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.createTable('dataset_splits', {
                dataset_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    primaryKey: true,
                    references: { model: 'datasets', key: 'id' },
                    /* The same rule `dataset_observations` and `dataset_classes` carry: a
                       split of a dataset has no meaning once the dataset is gone, and
                       `DELETE /dataset/:id` relies on the children going with it. */
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE',
                },
                split: {
                    type: Sequelize.STRING(32),
                    allowNull: false,
                    primaryKey: true,
                    comment: 'The split name as the build used it, which is what '
                        + 'dataset_observations.inclusion_type holds -- train, eval, validation '
                        + 'or test. Not the archive directory: validation and eval share one.',
                },
                images: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    comment: 'How many image files this split holds. Null means not known -- a '
                        + 'dataset built before this was recorded, or one whose archive could not '
                        + 'be read -- which is not the same as zero.',
                },
                created_at: { type: Sequelize.DATE, allowNull: false },
                updated_at: { type: Sequelize.DATE, allowNull: false },
            }, { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.dropTable('dataset_splits', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
