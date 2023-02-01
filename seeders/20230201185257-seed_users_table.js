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

      await queryInterface.bulkInsert('users', [
        {name: 'Isaac Travers', user_id: 0 ,createdAt:  creationTime, updatedAt:  creationTime },
        {name: 'Sam Parker', user_id: 1 , createdAt:  creationTime, updatedAt:  creationTime  },
        {name: 'Johnathan Centoni', user_id: 2, createdAt:  creationTime, updatedAt:  creationTime  }
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
      await queryInterface.bulkDelete('users', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
