const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Projects extends Model {}

  Projects.init(
    {
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),            // match DB exactly
        allowNull: false,
        unique: 'projects_name_key',            // use same constraint name
      },
    },
    {
      sequelize,
      modelName: 'projects',
      tableName: 'projects',                    // explicit table name
      schema: 'public',
      timestamps: true,                         // match old model
      indexes: [
        {
          name: 'projects_name_key',
          unique: true,
          fields: ['name'],
        },
        {
          name: 'projects_pkey',
          unique: true,
          fields: ['project_id'],
        },
      ],
    }
  );

  return Projects;
};