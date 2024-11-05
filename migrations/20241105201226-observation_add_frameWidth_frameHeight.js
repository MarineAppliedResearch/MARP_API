'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     // Use a transaction to make sure everything saves or everything reverts
     const transaction = await queryInterface.sequelize.transaction();

    try {
      queryInterface.addColumn(
        'observations',
        'frameWidth',
        {
          type: Sequelize.INTEGER,
          allowNull: true
        }
      )

      queryInterface.addColumn(
        'observations',
        'frameHeight',
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
      queryInterface.removeColumn('observations', 'frameHeight');
      queryInterface.removeColumn('observations', 'frameWidth');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
