/**
 * Adds a nullable `confidence` column (0.0-1.0) to both `observations` and
 * `keyframes`, recording the model-reported confidence score for
 * ML-assisted annotations.
 *
 * @fileoverview Migration that adds `confidence` to `observations` and `keyframes`.
 * @author Isaac Travers
 * @module migrations/add-confidence-to-observations-and-keyframes
 */

'use strict';

module.exports = {
  /**
   * Applies this migration by adding `confidence` to `observations` and
   * `keyframes`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once both columns have been added.
   * @throws {Error} Re-throws after rolling back if either column add fails.
   */
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

  /**
   * Reverts this migration by dropping `confidence` from `keyframes` and
   * `observations`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once both columns have been dropped.
   * @throws {Error} Re-throws after rolling back if either column drop fails.
   */
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
