/**
 * Adds thirteen nullable boolean substrate-composition columns to
 * `observations`, one per substrate category recorded during 60-second
 * substrate transects: `substrate_bedrock`, `substrate_megaclast`,
 * `substrate_boulder`, `substrate_cobble`, `substrate_peddle` (a typo kept
 * intentionally — later renamed to `substrate_pebble` by
 * `rename_peddle_to_pebble`), `substrate_granule`, `substrate_sand`,
 * `substrate_mud`, `substrate_coral_reef`, `substrate_coral_rubble`,
 * `substrate_shell_hash`, `substrate_shell_rubble`, and `substrate_algal`.
 *
 * These back the `Substrate60Second_report` view documented in the
 * project `README.md`.
 *
 * @fileoverview Migration that adds 60-second substrate columns to `observations`.
 * @author Isaac Travers
 * @module migrations/add-60-second-substrate-data
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this migration by adding all thirteen substrate columns to
   * `observations`.
   *
   * Note: none of the `queryInterface.addColumn` calls below are
   * `await`ed, so the transaction can commit before the column adds have
   * actually completed on the connection — a pre-existing bug carried
   * over unchanged rather than fixed as part of a documentation pass.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if any column add fails.
   */
  async up (queryInterface, Sequelize) {
     // Use a transaction to make sure everything saves or everything reverts
     const transaction = await queryInterface.sequelize.transaction();

    try {
      // Add the substrate_bedrock column
      queryInterface.addColumn(
        'observations',
        'substrate_bedrock',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_megaclast column
      queryInterface.addColumn(
        'observations',
        'substrate_megaclast',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_boulder column
      queryInterface.addColumn(
        'observations',
        'substrate_boulder',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_cobble column
      queryInterface.addColumn(
        'observations',
        'substrate_cobble',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_peddle column
      queryInterface.addColumn(
        'observations',
        'substrate_peddle',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_granule column
      queryInterface.addColumn(
        'observations',
        'substrate_granule',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_sand column
      queryInterface.addColumn(
        'observations',
        'substrate_sand',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_mud column
      queryInterface.addColumn(
        'observations',
        'substrate_mud',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_coral_reef column
      queryInterface.addColumn(
        'observations',
        'substrate_coral_reef',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_coral_rubble column
      queryInterface.addColumn(
        'observations',
        'substrate_coral_rubble',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_shell_hash column
      queryInterface.addColumn(
        'observations',
        'substrate_shell_hash',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_shell_rubble column
      queryInterface.addColumn(
        'observations',
        'substrate_shell_rubble',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )


      // Add the substrate_algal column
      queryInterface.addColumn(
        'observations',
        'substrate_algal',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this migration by dropping all thirteen substrate columns
   * from `observations`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if any column drop fails.
   */
  async down (queryInterface, Sequelize) {
     // Use a transaction to make sure everything saves or everything reverts
     const transaction = await queryInterface.sequelize.transaction();


    try {
      // 1. Remove column's from table observations
      queryInterface.removeColumn('observations', 'substrate_bedrock');
      queryInterface.removeColumn('observations', 'substrate_megaclast');
      queryInterface.removeColumn('observations', 'substrate_boulder');
      queryInterface.removeColumn('observations', 'substrate_cobble');
      queryInterface.removeColumn('observations', 'substrate_peddle');
      queryInterface.removeColumn('observations', 'substrate_granule');
      queryInterface.removeColumn('observations', 'substrate_sand');
      queryInterface.removeColumn('observations', 'substrate_mud');
      queryInterface.removeColumn('observations', 'substrate_coral_reef');
      queryInterface.removeColumn('observations', 'substrate_coral_rubble');
      queryInterface.removeColumn('observations', 'substrate_shell_hash');
      queryInterface.removeColumn('observations', 'substrate_shell_rubble');
      queryInterface.removeColumn('observations', 'substrate_algal');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
