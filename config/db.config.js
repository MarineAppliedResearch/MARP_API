const { Sequelize, Model, DataTypes } = require("sequelize");
const logger = require('../logger/api.logger');

const connect = () => {

    // PostgreSQL server hostname or IP address.
    const hostName = process.env.DB_HOST;

    // PostgreSQL role used by this API connection.
    const userName = process.env.DB_USER;

    // Password for the PostgreSQL role.
    const password = process.env.DB_PASSWORD;

    // PostgreSQL database used by the API.
    const database = process.env.DB_NAME;

    // PostgreSQL TCP port. PostgreSQL uses 5432 by default.
    const port = Number(process.env.DB_PORT || 5432);

    // Sequelize database dialect. MARP currently uses PostgreSQL.
    const dialect = process.env.DB_DIALECT || 'postgres';

    console.log("dialect: " + dialect);

    const sequelize = new Sequelize(database, userName, password, {
        host: hostName,
        port: port,
        dialect: dialect,
        operatorsAliases: false,
        logging: true,
        pool: {
            max: 10,
            min: 0,
            acquire: 20000,
            idle: 5000
        }
    });

    const db = {};
    db.Sequelize = Sequelize;
    db.sequelize = sequelize;
    db.tasks = require("../model/task.model")(sequelize, DataTypes, Model);
    db.observations = require("../model/observation.model")(sequelize, DataTypes, Model);
    db.users = require("../model/user.model")(sequelize, DataTypes, Model);
    db.projects = require("../model/project.model")(sequelize, DataTypes, Model);
    db.sessions = require("../model/session.model")(sequelize, DataTypes, Model);
    db.metaInfo =  require("../model/metaInfo.model")(sequelize, DataTypes, Model);
    
    db.species =  require("../model/species.model")(sequelize, DataTypes, Model);
    db.datasets =  require("../model/datasets.model")(sequelize, DataTypes, Model);
    db.dataset_observations =  require("../model/dataset_observations.model")(sequelize, DataTypes, Model);
    db.ml_models =  require("../model/ml_models.model")(sequelize, DataTypes, Model);
    db.training_runs =  require("../model/training_runs.model")(sequelize, DataTypes, Model);
    db.epochs =  require("../model/epochs.model")(sequelize, DataTypes, Model);
    db.metrics_summary =  require("../model/metrics_summary.model")(sequelize, DataTypes, Model);
    db.metrics_curves =  require("../model/metrics_curves.model")(sequelize, DataTypes, Model);
    db.model_species =  require("../model/model_species.model")(sequelize, DataTypes, Model);
    db.keyframes =  require("../model/keyframe.model")(sequelize, DataTypes, Model);


    // reset everything.
   // db.sequelize.sync({ force: true }).then(() => {
   //     console.log("Drop and re-sync db.");
   // });

    // Associate users and sessions. A user can have 0 to many sessions. A session can have 1 and only 1 user
    db.users.hasMany(db.sessions, {
        sourceKey: "user_id",
        foreignKey: "user_id",
        as: "session"
    });

    db.sessions.belongsTo(db.users, {
        sourceKey: "user_id",
        foreignKey: "user_id",
        as: "user"
    });

    // Now Associate project and sessions. A project can have 0 or many sessions, a session can have 1 only project
    db.projects.hasMany(db.sessions, {
        sourceKey: "project_id",
        foreignKey: "project_id",
        as: "session"
    });

    db.sessions.belongsTo(db.projects, {
        sourceKey: "project_id",
        foreignKey: "project_id",
        as: "project"
    });

    // Now Associate Project and observation
    // A project can have 0 or many observations, but an observation can have 1 and only 1 project
    db.projects.hasMany(db.observations, {
        sourceKey: "project_id",
        foreignKey: "project_id",
        as: "observation"
    });

    db.observations.belongsTo(db.projects, {
        sourceKey: "project_id",
        foreignKey: "project_id",
        as: "project"
    });

    // Now Associate User and Observation
    // A User can have 00 or many observations, an observation can have 1 and only 1 user
    db.users.hasMany(db.observations, {
        sourceKey: "user_id",
        foreignKey: "user_id",
        as: "observation"
    });

    db.observations.belongsTo(db.users, {
        sourceKey: "user_id",
        foreignKey: "user_id",
        as: "user"
    });

    // Now asscoaite SEssion and Observation, a session can have 0 or many obs, and obs 1 and 1 session
    db.sessions.hasMany(db.observations, {
        sourceKey: "session_id",
        foreignKey: "session_id",
        as: "observation"
    });

    db.observations.belongsTo(db.sessions, {
        sourceKey: "session_id",
        foreignKey: "session_id",
        as: "session"
    });

    // Define the association here
    db.keyframes.belongsTo(db.observations, { 
        sourceKey: "observation_id",
        foreignKey: "observation_id",
        as: "observation",
        onDelete: "CASCADE"
    });

    db.observations.hasMany(db.keyframes, { 
        sourceKey: "observation_id",
        foreignKey: "observation_id", 
        as: "keyframes",
        onDelete: "CASCADE"
    });

    db.keyframes.belongsTo(db.observations, { 
        sourceKey: "observation_id",
        foreignKey: "observation_id", 
        as: "parentObservation",
        onDelete: "CASCADE"
    });

    return db;

}

module.exports = {
    connect
}
