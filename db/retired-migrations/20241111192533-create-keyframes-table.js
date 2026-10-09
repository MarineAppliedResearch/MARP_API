/**
 * Creates the `keyframes` table, which stores frame-accurate bounding-box
 * annotations (start/end markers with x/y/width/height) tied to a parent
 * `observations` row.
 *
 * See the `Keyframe` OpenAPI schema in `model/keyframe.model.js` for the
 * corresponding Sequelize model and API-facing field documentation.
 *
 * @fileoverview Migration that creates the `keyframes` table.
 * @author Isaac Travers
 * @module migrations/create-keyframes-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this migration by creating the `keyframes` table, including
   * its foreign key to `observations`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table has been created.
   * @throws {Error} Re-throws after rolling back if table creation fails.
   */
  async up (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable('keyframes', {
        keyframe_id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        observation_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: {
            model: 'observations',
            key: 'observation_id',
          },
          onDelete: 'CASCADE', // If an observation is deleted, delete related keyframes
        },
        subset: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        comname: {
          type: Sequelize.STRING,
          allowNull: false
        },
        type: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        framenum:{
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        x: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        y: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        width: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        height: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      });

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this migration by dropping the `keyframes` table.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('keyframes');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
