'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {

    // Create a transaction
    const transaction = await queryInterface.sequelize.transaction();

    try {

      // 1. Rename the column
      await queryInterface.renameColumn('observations', 'substrate_peddle', 'substrate_pebble');

      // 2. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down (queryInterface, Sequelize) {
    // Create a transaction
    const transaction = await queryInterface.sequelize.transaction();

    try {

      // 1. Rename the column
      await queryInterface.renameColumn('observations', 'substrate_pebble', 'substrate_peddle');

      // 2. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
