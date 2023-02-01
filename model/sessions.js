const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('sessions', {
    session_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    project_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'projects',
        key: 'project_id'
      }
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    dive: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    line: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    lineId: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    type: {
      type: DataTypes.STRING(255),
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'sessions',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "sessions_pkey",
        unique: true,
        fields: [
          { name: "session_id" },
        ]
      },
    ]
  });
};
