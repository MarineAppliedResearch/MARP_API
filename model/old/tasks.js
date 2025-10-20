const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('tasks', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    createdate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    updateddate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    createdby: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    updatedby: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'tasks',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "tasks_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
