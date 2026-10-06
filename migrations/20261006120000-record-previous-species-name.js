'use strict';

/**
 * Records the name a species correction replaced (#181, A16).
 *
 * A correction now renames an observation fully -- `species_id`, `comname`, `taxserial` and
 * every keyframe's `comname` (Isaac, 2026-10-06). On about 50,000 rows `comname` and
 * `taxserial` are the only record of the label the annotator pressed, because their species
 * lists were renamed and renumbered since; the review history kept only the previous
 * `species_id`. These two columns keep the replaced name with the correction that replaced it,
 * so the rename loses nothing.
 *
 * Existing rows acquire NULL: no correction before this one rewrote a name, so there was no
 * replaced name to record.
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.addColumn('observation_reviews', 'previous_comname', {
                type: Sequelize.STRING(255),
                allowNull: true,
                comment: 'The observation\'s comname before this correction renamed it. NULL on rows that are not renames.',
            }, { transaction });
            await queryInterface.addColumn('observation_reviews', 'previous_taxserial', {
                type: Sequelize.INTEGER,
                allowNull: true,
                comment: 'The observation\'s taxserial before this correction renamed it. NULL on rows that are not renames.',
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
            await queryInterface.removeColumn('observation_reviews', 'previous_taxserial', { transaction });
            await queryInterface.removeColumn('observation_reviews', 'previous_comname', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
