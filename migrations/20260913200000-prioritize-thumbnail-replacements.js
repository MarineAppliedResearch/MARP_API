/**
 * Gives reviewer-requested thumbnail replacements durable priority and a
 * restart-safe position in the finite frame-candidate sequence.
 *
 * Refs #134.
 */

'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.addColumn('observation_thumbnails', 'request_priority', {
                type: Sequelize.SMALLINT,
                allowNull: false,
                defaultValue: 0,
                comment: '0 for ordinary page/background work; 1 for a reviewer waiting on a replacement.',
            }, { transaction });
            await queryInterface.addColumn('observation_thumbnails', 'candidate_index', {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: 'Zero-based position in the deterministic thumbnail frame-candidate sequence.',
            }, { transaction });
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_priority_check
                   CHECK (request_priority IN (0, 1))`,
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_candidate_index_check
                   CHECK (candidate_index >= 0)`,
                { transaction }
            );
            await queryInterface.removeIndex(
                'observation_thumbnails', 'observation_thumbnails_queued_idx', { transaction }
            );
            await sequelize.query(
                `CREATE INDEX observation_thumbnails_queued_idx
                   ON observation_thumbnails
                      (request_priority DESC, requested_at, observation_id)
                   WHERE status = 'queued'`,
                { transaction }
            );
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.removeIndex(
                'observation_thumbnails', 'observation_thumbnails_queued_idx', { transaction }
            );
            await sequelize.query(
                'ALTER TABLE observation_thumbnails DROP CONSTRAINT observation_thumbnails_candidate_index_check',
                { transaction }
            );
            await sequelize.query(
                'ALTER TABLE observation_thumbnails DROP CONSTRAINT observation_thumbnails_priority_check',
                { transaction }
            );
            await queryInterface.removeColumn(
                'observation_thumbnails', 'candidate_index', { transaction }
            );
            await queryInterface.removeColumn(
                'observation_thumbnails', 'request_priority', { transaction }
            );
            await sequelize.query(
                `CREATE INDEX observation_thumbnails_queued_idx
                   ON observation_thumbnails (requested_at, observation_id)
                   WHERE status = 'queued'`,
                { transaction }
            );
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
