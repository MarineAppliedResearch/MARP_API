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

      await queryInterface.bulkInsert('observations', [
        {
          observation_id: 0, obsID: 0, session_id: 0, tc: "21:22:22", frame: "12", 
          taxserial: 9999996, comname: "YOY", count: 1, 
          video_source: "20211115_211947 Fwd.mp4", videoLocation: "C:\\Users\\eurek\\Desktop\\Workspace\\Misc\\Video\\Dive 169\\Forward\\20211115_211947 Fwd.mp4",
          mediaPosition: "00:02:34.7359957", actualPosition: "21:22:22.5179965", createdAt:  creationTime, updatedAt:  creationTime 
        },
        {
          observation_id: 1, obsID: 1, session_id: 0, tc: "21:22:27", frame: "17", 
          taxserial: 166767, comname: "Gopher Rockfish", count: 1, 
          video_source: "20211115_211947 Fwd.mp4", videoLocation: "C:\\Users\\eurek\\Desktop\\Workspace\\Misc\\Video\\Dive 169\\Forward\\20211115_211947 Fwd.mp4",
          mediaPosition: "00:02:39.9159968", actualPosition: "21:22:27.6979976", createdAt:  creationTime, updatedAt:  creationTime 
        },
        {
          observation_id: 2, obsID: 2, session_id: 0, tc: "21:22:32", frame: "2", 
          taxserial: 166767, comname: "Starry Rockfish", count: 1, 
          video_source: "20211115_211947 Fwd.mp4", videoLocation: "C:\\Users\\eurek\\Desktop\\Workspace\\Misc\\Video\\Dive 169\\Forward\\20211115_211947 Fwd.mp4",
          mediaPosition: "00:02:44.3159992", actualPosition: "21:22:32.0980000", createdAt:  creationTime, updatedAt:  creationTime 
        }, 
        {
          observation_id: 3, obsID: 3, session_id: 0, tc: "21:22:34", frame: "21", 
          taxserial: 166730, comname: "Blue/Deacon Rockfish", count: 1, 
          video_source: "20211115_211947 Fwd.mp4", videoLocation: "C:\\Users\\eurek\\Desktop\\Workspace\\Misc\\Video\\Dive 169\\Forward\\20211115_211947 Fwd.mp4",
          mediaPosition: "00:02:47.0959948", actualPosition: "21:22:34.8780008", createdAt:  creationTime, updatedAt:  creationTime 
        }
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
      await queryInterface.bulkDelete('observations', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
