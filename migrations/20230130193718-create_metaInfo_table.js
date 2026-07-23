/**
 * Creates the `metaInfos` table used to store basic deployment/database
 * identification metadata (currently just a human-readable `name`, e.g.
 * "Development Database").
 *
 * The initial column set included a `Capital` column, which is removed by
 * the very next migration (`remove_Capital_tableFrom_metainfo`) — kept
 * here unmodified since altering historical migrations that have already
 * run against existing databases would desync `SequelizeMeta` from the
 * actual schema.
 *
 * @fileoverview Migration that creates the `metaInfos` table.
 * @author Isaac Travers
 * @module migrations/create-metaInfo-table
 */

'use strict';

/**
 * Table identifier used by both `up` and `down` below.
 *
 * @constant
 * @type {Object}
 */
let tableModel = { schema: 'public', tableName: 'metaInfos' };

module.exports = {
  /**
   * Applies this migration by creating the `metaInfos` table and its
   * indexes inside a single transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table and indexes have been created.
   * @throws {Error} Re-throws after rolling back if table or index creation fails.
   */
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Create table
      await queryInterface.createTable(tableModel, {
        id:             { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        createdAt:        { allowNull: false, type: Sequelize.DATE, defaultValue: new Date() },
        updatedAt:       { allowNull: false, type: Sequelize.DATE, defaultValue: new Date() },

        name:           { allowNull: false, type: Sequelize.STRING },
        Capital:        { allowNull: false, type: Sequelize.STRING },
      });

      // 2. Add indices
      await queryInterface.addIndex(tableModel, ['id'], { transaction });
      await queryInterface.addIndex(tableModel, ['name'], { transaction });

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this migration by dropping the `metaInfos` table.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   */
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable(tableModel);
  }

};
