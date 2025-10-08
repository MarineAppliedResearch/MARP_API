const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    const Keyframes = require('./keyframe.model'); // Import the Keyframes model

    class Observations extends Model {
      // Static method to define associations between models
      static associate(models) {
        // Associate Observations with Keyframes
        this.hasMany(models.keyframes, { foreignKey: 'observation_id', onDelete: 'CASCADE' });
      }
    }

    Observations.init({
        // Model attributes are defined here

        observation_id: {
          // The Observation id of this observation. This is meant to be the primary key..
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true
        },
      
        obsID: {
          // The Observation id of this observation. This is meant to be the primary key..
          type: DataTypes.INTEGER,
          allowNull: false
        },
        PobsID:{
          type: DataTypes.INTEGER,
          allowNull: true
        },
        project_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'projects',
            key: 'project_id'
          },
        },
        session_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'sessions',
            key: 'session_id'
          },
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'users',
            key: 'user_id'
          },
        },
        tc: {
          // The TimeCode the Observation was observed at.
          type: DataTypes.STRING(255)
          // allowNull defaults to true
        },

        frame: {
          // The Frame of The Observed Video when Observed.
          type: DataTypes.STRING(255)
          // allowNull defaults to true
        },

        taxserial: {
          // The Tax Serial of the Observed Species
            type: DataTypes.INTEGER
            // allowNull defaults to true
        },

        comname: {
          // The common name of the observed species.
            type: DataTypes.STRING(255)
        },

        count: {
          // The number of this species observed in this observeration.
            type: DataTypes.INTEGER
        },

        sex: {
          // The number of this species observed in this observeration.
            type: DataTypes.STRING(255)
        },

        coarsesize: {
          // The number of this species observed in this observeration.
            type: DataTypes.INTEGER
        },

        sizereview: {
          // The number of this species observed in this observeration.
            type: DataTypes.INTEGER
        },

        quadrant: {
          // The Quadrant of the screen this Observation was found at..
            type: DataTypes.INTEGER
        },

        etc: {
          // the ending time code of this observation, for a range.
            type: DataTypes.STRING(255)
        },

        taxReview: {
          // Does this observation need to be reviewed by another processor?.
            type: DataTypes.STRING(255)
        },

        note: {
          // Special Notes about this observation.
            type: DataTypes.STRING(255)
        },

        downcamera: {
          // Is this observation looking at a down camera?
            type: DataTypes.STRING(255)
        },

        timelog: {
          // A timestamp of the time when this observation was recorded.
            type: DataTypes.STRING(255)
        },

        video_source: {
          // The file location of the video this observation was made on..
            type: DataTypes.STRING(255)
        },

        videoLocation: {
          // An offset to equate the time of the video, with the actual world time of the observation.
            type: DataTypes.STRING(255)
        },

        mediaPosition: {
          // A timestamp of the position of the video where the observation was made.
            type: DataTypes.STRING(255)
        },

        actualPosition: {
          // A time stamp for the actual real world time this information was taken.
            type: DataTypes.STRING(255)
        },

        substrate_bedrock:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_megaclast:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_boulder:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_cobble:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_pebble:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_granule:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_sand:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_mud:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_coral_reef:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_coral_rubble:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_shell_hash:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_shell_rubble:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },

        substrate_algal:{
          type: DataTypes.BOOLEAN,
          defaultValue: false
        }
      }, {
        // Other model options go here
          sequelize,
          modelName: 'observations',
          tableName: 'observations',
          timestamps: true, // Enables createdAt and updatedAt fields
          schema: 'public',
          indexes: [
            {
              name: 'observations_pkey',
              unique: true,
              fields: ['observation_id']
            }
          ]
      });

      
      return Observations;
}