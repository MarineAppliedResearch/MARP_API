module.exports = (sequelize, DataTypes, Model) => {

    class Observations extends Model {}

    Observations.init({
        // Model attributes are defined here

        obsID: {
          // The Observation id of this observation. This is meant to be the primary key..
          type: DataTypes.STRING,
          allowNull: false
        },

        project_name: {
          // The Name of the Project the observation is associated with.
          type: DataTypes.STRING,
          allowNull: true
        },

        tc: {
          // The TimeCode the Observation was observed at.
          type: DataTypes.STRING
          // allowNull defaults to true
        },

        frame: {
          // The Frame of The Observed Video when Observed.
          type: DataTypes.STRING
          // allowNull defaults to true
        },

        taxserial: {
          // The Tax Serial of the Observed Species
            type: DataTypes.INTEGER
            // allowNull defaults to true
        },

        comname: {
          // The common name of the observed species.
            type: DataTypes.STRING
        },

        count: {
          // The number of this species observed in this observeration.
            type: DataTypes.INTEGER
        },

        quadrant: {
          // The Quadrant of the screen this Observation was found at..
            type: DataTypes.INTEGER
        },

        etc: {
          // the ending time code of this observation, for a range.
            type: DataTypes.STRING
        },

        taxReview: {
          // Does this observation need to be reviewed by another processor?.
            type: DataTypes.INTEGER
        },

        note: {
          // Special Notes about this observation.
            type: DataTypes.STRING
        },

        downcamera: {
          // Is this observation looking at a down camera?
            type: DataTypes.INTEGER
        },

        line: {
          // The Line Number, or Name of this observation.
            type: DataTypes.STRING
        },

        dive: {
          // The Dive Number, or Name of this observation.
            type: DataTypes.STRING
        },

        lineID: {
          // The The Line ID of this observation.
            type: DataTypes.STRING
        },

        processorName: {
          // The Name of the processor who made this observation.
            type: DataTypes.STRING
        },

        timelog: {
          // A timestamp of the time when this observation was recorded.
            type: DataTypes.STRING
        },

        video_source: {
          // The file location of the video this observation was made on..
            type: DataTypes.STRING
        },

        videoLocation: {
          // An offset to equate the time of the video, with the actual world time of the observation.
            type: DataTypes.STRING
        },

        mediaPosition: {
          // A timestamp of the position of the video where the observation was made.
            type: DataTypes.STRING
        },

        actualPosition: {
          // A time stamp for the actual real world time this information was taken.
            type: DataTypes.STRING
        },
      }, {
        // Other model options go here
        sequelize, // We need to pass the connection instance
        modelName: 'observations' // We need to choose the model name
      });
      
      return Observations;
}