'use strict';

let tableModel = { schema: 'public', tableName: 'metaInfos' };

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Create table
      await queryInterface.createTable(tableModel, {
        id:             { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        createdAt:        { allowNull: false, type: Sequelize.DATE, defaultValue: new Date() },
        updatedAt:       { allowNull: false, type: Sequelize.DATE, defaultValue: new Date() },
        
        name:           { allowNull: false, type: Sequelize.STRING },
        Capital:        { allowNull: false, type: Sequelize.STRING },      
      });

      // 2. Add indices
      await queryInterface.addIndex(tableModel, ['id'], { transaction });
      await queryInterface.addIndex(tableModel, ['name'], { transaction });

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable(tableModel);
  }

};