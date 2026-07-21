'use strict';

// Define the table model we are making changes on.
let tableModel = { schema: 'public', tableName: 'metaInfos' };

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */

    // Use a transaction to make sure everything saves or everything reverts
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Remove column Capital from table metaInfo
      queryInterface.removeColumn('metaInfos', 'Capital');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */

    // Use a transaction to make sure everything saves or everything reverts
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Add column Capital from table metaInfo
      queryInterface.addColumn(
        'metaInfos',
        'Capital',
        {
          type: Sequelize.STRING
        }
      )

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }

  }
};
