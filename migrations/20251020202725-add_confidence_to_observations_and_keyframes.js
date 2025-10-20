'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Add confidence to observations
      await queryInterface.addColumn(
        'observations',
        'confidence',
        {
          type: Sequelize.DOUBLE,
          allowNull: true,
          comment: 'Confidence score (0.0–1.0) associated with this observation.',
        },
        { transaction }
      );

      // Add confidence to keyframes
      await queryInterface.addColumn(
        'keyframes',
        'confidence',
        {
          type: Sequelize.DOUBLE,
          allowNull: true,
          comment: 'Confidence score (0.0–1.0) for this annotation keyframe.',
        },
        { transaction }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Remove both columns on rollback
      await queryInterface.removeColumn('keyframes', 'confidence', { transaction });
      await queryInterface.removeColumn('observations', 'confidence', { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
