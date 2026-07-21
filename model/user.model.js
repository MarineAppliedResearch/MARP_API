const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Users extends Model {
    static associate(models) {
      this.hasMany(models.sessions, {
        sourceKey: 'user_id',
        foreignKey: 'user_id',
        as: 'session',
      });

      this.hasMany(models.observations, {
        sourceKey: 'user_id',
        foreignKey: 'user_id',
        as: 'observation',
      });
    }
  }

  Users.init(
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),       // match existing column exactly
        allowNull: false,
        unique: 'users_name_key',          // keep same constraint name
      },
    },
    {
      sequelize,
      modelName: 'users',
      tableName: 'users',                  // explicit table name
      schema: 'public',
      timestamps: true,                    // match old model
      indexes: [
        {
          name: 'users_name_key',
          unique: true,
          fields: ['name'],
        },
        {
          name: 'users_pkey',
          unique: true,
          fields: ['user_id'],
        },
      ],
    }
  );

  return Users;
};