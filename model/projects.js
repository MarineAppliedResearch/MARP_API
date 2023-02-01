const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('projects', {
    project_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: "projects_name_key"
    }
  }, {
    sequelize,
    tableName: 'projects',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "projects_name_key",
        unique: true,
        fields: [
          { name: "name" },
        ]
      },
      {
        name: "projects_pkey",
        unique: true,
        fields: [
          { name: "project_id" },
        ]
      },
    ]
  });
};
