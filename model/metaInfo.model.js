const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {

    class MetaInfo extends Model {}

    MetaInfo.init({
        // Model attributes are defined here
        id: {
          // The Observation id of this observation. This is meant to be the primary key..
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true
        }, 
        name: {
          type: DataTypes.STRING
        }
      }, {
        // Other model options go here
        sequelize, // We need to pass the connection instance
        modelName: 'metaInfo' // We need to choose the model name
      });
      
      return MetaInfo;
}