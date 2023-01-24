module.exports = (sequelize, DataTypes, Model) => {

    class Users extends Model {}

    Users.init({
        // Model attributes are defined here

        user_id: {
          // The Observation id of this observation. This is meant to be the primary key..
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true
        },

        name: {
          // The Name of the Project the observation is associated with.
          type: DataTypes.STRING,
          allowNull: false,
          unique: true
        }
      }, {
        // Other model options go here
        sequelize, // We need to pass the connection instance
        modelName: 'users' // We need to choose the model name
      });
      
      return Users;
}