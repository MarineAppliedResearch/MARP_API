const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {

    class Sessions extends Model {}

    Sessions.init({
        // Model attributes are defined here

        session_id: {
          // The id of this session
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true
        },
        
        project_id: {
          // The Dive this session is associated with
          type: DataTypes.INTEGER
        },
        user_id: {
          // The Dive this session is associated with
          type: DataTypes.INTEGER
        },
        dive: {
          // The Dive this session is associated with
          type: DataTypes.STRING,
          allowNull: false
        },
        line: {
          // The Line this session is associated with
          type: DataTypes.STRING,
          allowNull: false
        },
        lineId: {
          // The Line this session is associated with
          type: DataTypes.STRING,
          allowNull: false
        },
        type: {
          // The Type of this session
          type: DataTypes.STRING,
          allowNull: false
        }
      }, {
        // Other model options go here
        sequelize, // We need to pass the connection instance
        modelName: 'sessions' // We need to choose the model name
      });
      
      return Sessions;
}