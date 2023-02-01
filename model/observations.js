const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('observations', {
    observation_id: {
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
    session_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sessions',
        key: 'session_id'
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
    tc: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    frame: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    taxserial: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    comname: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    count: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    quadrant: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    etc: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    timelog: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    video_source: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    videoLocation: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    mediaPosition: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    actualPosition: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    sex: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    coarsesize: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    taxReview: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    downcamera: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    sizereview: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    obsID: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'observations',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "observations_pkey",
        unique: true,
        fields: [
          { name: "observation_id" },
        ]
      },
    ]
  });
};
