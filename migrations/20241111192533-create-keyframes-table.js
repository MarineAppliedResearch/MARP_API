'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable('keyframes', {
        keyframe_id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        observation_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: {
            model: 'observations',
            key: 'observation_id',
          },
          onDelete: 'CASCADE', // If an observation is deleted, delete related keyframes
        },
        subset: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        type: {
          type: Sequelize.ENUM('start', 'middle', 'end'),
          allowNull: false,
        },
        framenum:{
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        x: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        y: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        width: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        height: {
          type: Sequelize.DOUBLE,
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      });

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('keyframes');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
