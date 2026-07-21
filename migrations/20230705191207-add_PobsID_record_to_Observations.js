'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     // Use a transaction to make sure everything saves or everything reverts
     const transaction = await queryInterface.sequelize.transaction();

    try {
      // Add the PobsID column
      queryInterface.addColumn(
        'observations',
        'PobsID',
        {
          type: Sequelize.INTEGER,
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
      // 1. Remove column Capital from table metaInfo
      queryInterface.removeColumn('observations', 'PobsID');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
