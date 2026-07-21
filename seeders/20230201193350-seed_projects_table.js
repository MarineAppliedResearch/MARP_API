'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add seed commands here.
     *
     * Example:
     * await queryInterface.bulkInsert('People', [{
     *   name: 'John Doe',
     *   isBetaMember: false
     * }], {});
    */
    const transaction = await queryInterface.sequelize.transaction();

    try {
      var creationTime =   new Date() 

      await queryInterface.bulkInsert('projects', [
        {project_id: 0, name: "Development Testing", createdAt:  creationTime, updatedAt:  creationTime }
      ], {});
        
      

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add commands to revert seed here.
     *
     * Example:
     * await queryInterface.bulkDelete('People', null, {});
     */
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Remove all people in the users
      await queryInterface.bulkDelete('projects', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
