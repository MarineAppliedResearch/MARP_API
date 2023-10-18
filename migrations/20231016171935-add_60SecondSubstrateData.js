/**
 * add_60SecondSubstrateData.js migration
 * This is a database migrations that adds new data columns to the observations model.
 * 
 * This will add the following substrate options,
 * substrate_bedrock, substrate_megaclast, substrate_boulder, substrate_cobble, substrate_peddle, substrate_granule,
 * substrate_sand, substrate_mud, substrate_coral_reef, substrate_coral_rubble, substrate_shell_hash, substrate_shell_rubble, substrate_algal
 */

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
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

      // Add the substrate_peddle column
      queryInterface.addColumn(
        'observations',
        'substrate_granule',
        {
          type: Sequelize.BOOLEAN,
          allowNull: true
        }
      )

      // Add the substrate_peddle column
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
