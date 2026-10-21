'use strict';

/**
 * A dataset records how many observations it was built from, beside how many images.
 *
 * **Two different quantities, and `num_samples` is already one of them.** A dataset built
 * from 115 observations holds 13,380 images, because a keyframe is a box at a frame number
 * and the frames between two keyframes are interpolated and trained on as well. The
 * Datasets screen wants both: observations is how much *review* went into it, images is
 * how big a training run it is.
 *
 * `num_samples` has meant images since before MARP built datasets at all --
 * `scripts/package-dataset.js` prints `images: N` and writes that figure, which is how
 * `rockfish5` is known to be 11,845 images. Putting the observation count there instead
 * would leave one column meaning images on every legacy row and observations on every
 * dashboard-built one, with nothing to tell them apart. That is the ambiguity
 * `AGENTS.md` counts as loss of a scientific record, so the new fact gets the new column.
 *
 * **Nullable, with no backfill.** Nothing recorded this before #268 -- `dataset_observations`
 * held zero rows for zero datasets -- so null means "not known for this dataset" rather than
 * zero, and no existing row can be given a true value. A dataset imported by the legacy
 * packager has no membership to count and never will.
 *
 * **Not derived at read time**, which was the alternative and is the trap:
 *
 * - `count(*) FROM dataset_observations` would *shrink*. `20260909120300` puts a foreign
 *   key on `dataset_observations.observation_id` and deleting an observation takes its
 *   membership row with it, while the archive still holds that observation's frames. A
 *   dataset's composition is what it was built from; a live count would quietly disagree
 *   with the archive it describes.
 * - The keyframe spans of its observations are what the build *intended* to cut, not what
 *   it got -- `cutVideo` reports frames it could not read -- so that number can claim
 *   images the archive does not contain.
 *
 * @fileoverview Migration adding datasets.num_observations.
 * @module migrations/a-dataset-counts-its-observations
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('datasets', 'num_observations', {
                type: Sequelize.INTEGER,
                allowNull: true,
                comment: 'How many observations went into this dataset, as recorded when it was '
                    + 'built. Null for a dataset built before MARP recorded membership, which is '
                    + 'not the same as zero. num_samples is the image count, which is larger: the '
                    + 'frames between two keyframes are interpolated and trained on as well.',
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
            await queryInterface.removeColumn('datasets', 'num_observations', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
