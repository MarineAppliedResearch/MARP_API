'use strict';

/**
 * How many images of each species went to each split.
 *
 * The Composition panel lists each species against train, validation and test, and Isaac
 * asked for a bar beside each one: *"each species should have an associated bar, who's
 * length is the number of images, and each bar should have 3 shades, one for the training
 * amount, one for the validation amount, and one for the test amount."*
 *
 * **Images, which `dataset_observations` cannot give.** That table is a row per
 * observation, so it counts observations; an observation is a span between keyframes and
 * becomes many frames. The breakdown shipped in observations because that was what was
 * available, and a bar whose length is observations sitting under a panel that counts
 * images would be two units in one picture -- worse than two units in one table, because
 * a reader compares lengths without reading headings.
 *
 * **These do not partition the dataset, and that is a property of the data rather than a
 * defect.** A frame holding two animals is written once and carries a label line for
 * each, so it counts toward both species. Summing this table across species therefore
 * exceeds `dataset_splits.images`, which is why that stays: *images in this split* and
 * *images of this species in this split* are two different facts and neither derives from
 * the other. Isaac met the same arithmetic early on, when a class breakdown totalled 129
 * per cent of its own query.
 *
 * **Recorded by the build rather than counted from the archive.** The runner knows the
 * split and the species of every frame at the moment it writes it -- the label lines it
 * is already writing carry the class index -- so this costs a counter. Reading it back out
 * of the tar would be exact too, and is what `scripts/backfill-split-species-images.js`
 * does for the datasets built before this existed, but doing it on every panel open is
 * the trade Isaac already rejected for the per-split counts.
 *
 * **`species_id` rather than the class index**, because a class index means nothing
 * without the vocabulary that gave it, and `dataset_classes` can be rewritten by a
 * rebuild. The species is the thing that is stable.
 *
 * @fileoverview Migration adding the dataset_split_species table.
 * @module migrations/a-species-knows-which-split-its-pictures-went-to
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.createTable('dataset_split_species', {
                dataset_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    primaryKey: true,
                    references: { model: 'datasets', key: 'id' },
                    /* With the dataset, like its membership, its vocabulary and its split
                       counts -- and `DELETE /dataset/:id` depends on every child going. */
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE',
                },
                split: {
                    type: Sequelize.STRING(32),
                    allowNull: false,
                    primaryKey: true,
                    comment: 'The split as dataset_observations.inclusion_type holds it -- '
                        + 'train, validation, eval or test. Not the archive directory: '
                        + 'validation and eval share eval/ on disk.',
                },
                species_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    primaryKey: true,
                    references: { model: 'species', key: 'id' },
                    /* No cascade: a species is catalogue data and is not deleted to tidy
                       a dataset. If one ever were, this row should fail loudly rather
                       than vanish and leave a bar shorter than the archive it describes. */
                    onDelete: 'RESTRICT',
                    onUpdate: 'CASCADE',
                },
                images: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    comment: 'Images in this split holding at least one box of this species. '
                        + 'A frame with two species counts for both, so these sum to more '
                        + 'than dataset_splits.images for the same split.',
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
            await queryInterface.dropTable('dataset_split_species', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
