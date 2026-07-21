const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Sessions extends Model {}

  Sessions.init(
    {
      session_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'projects',
          key: 'project_id',
        },
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'user_id',
        },
      },
      dive: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      line: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      lineId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'sessions',
      tableName: 'sessions',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          name: 'sessions_pkey',
          unique: true,
          fields: ['session_id'],
        },
      ],
    }
  );

  return Sessions;
};