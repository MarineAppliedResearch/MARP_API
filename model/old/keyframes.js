const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('keyframes', {
    keyframe_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    // Foreign key to link the keyframe to an observation
    observation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'observations',
        key: 'observation_id'
      }
    },
    // Subset identifier to group keyframes by annotation within an observation
    subset: {
      type: DataTypes.STRING,
      allowNull: false
    },
    comname: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // Type of the keyframe (start, middle, end)
    type: {
      type: DataTypes.ENUM('start', 'middle', 'end'),
      allowNull: false
    },
    framenum: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    // X-coordinate of the annotation rectangle
    x: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    // Y-coordinate of the annotation rectangle
    y: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    // Height of the annotation rectangle
    height: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    // Width of the annotation rectangle
    width: {
      type: DataTypes.DOUBLE,
      allowNull: false
    }
    
  }, {
    sequelize,
    tableName: 'keyframes',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "keyframes_pkey",
        unique: true,
        fields: [
          { name: "keyframe_id" },
        ]
      },
    ]
  });
};
