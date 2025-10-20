const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const Keyframes = require('./keyframe.model');

  class Observations extends Model {
    static associate(models) {
      this.hasMany(models.keyframes, {
        foreignKey: 'observation_id',
        onDelete: 'CASCADE',
      });
    }
  }

  Observations.init(
    {
      observation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },

      obsID: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      PobsID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },

      project_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'projects',
          key: 'project_id',
        },
      },

      session_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'sessions',
          key: 'session_id',
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

      tc: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },


      frame: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      taxserial: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      comname: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      sex: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      coarsesize: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      sizereview: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      quadrant: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      etc: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      taxReview: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      note: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      downcamera: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      timelog: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      video_source: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      videoLocation: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      mediaPosition: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      actualPosition: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },

      substrate_bedrock: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_megaclast: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_boulder: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_cobble: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_pebble: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_granule: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_sand: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_mud: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_coral_reef: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_coral_rubble: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_shell_hash: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_shell_rubble: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      substrate_algal: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'observations',
      tableName: 'observations',
      schema: 'public',
      timestamps: true,
      freezeTableName: true,
      underscored: false,
      sync: { alter: false },  // <— prevents any future alters
      indexes: [
        {
          name: 'observations_pkey',
          unique: true,
          fields: ['observation_id'],
        },
      ],
    }
  );

  return Observations;
};