const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    const Observations = require('./observation.model'); // Import the Observations model

    class Keyframes extends Model {}
  
    Keyframes.init({
      // Unique identifier for each keyframe
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
        //type: DataTypes.ENUM('start', 'middle', 'end'),
        type: DataTypes.STRING,
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
      },
      confidence: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        comment: 'Confidence score (0.0–1.0)',
      }
    }, {
      sequelize,
      modelName: 'keyframes' // Define the model name
    });

    
  
    return Keyframes;
  };
  