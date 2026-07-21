var DataTypes = require("sequelize").DataTypes;
var _SequelizeMeta = require("./SequelizeMeta");
//var _observations = require("./observations");
//var _projects = require("./projects");
//var _sessions = require("./sessions");
//var _tasks = require("./tasks");
//var _users = require("./users");
//var _keyframes = require("./keyframes");

var _observations = require("./observation.model.js");
var _projects = require("./project.model.js");
var _sessions = require("./session.model.js");
var _tasks = require("./task.model.js");
var _users = require("./user.model.js");
var _keyframes = require("./keyframe.model.js");

// Machine Learning tables
var _ml_models = require("./ml_models.model");
var _species = require("./species.model");
var _model_species = require("./model_species.model");
var _datasets = require("./datasets.model");
var _dataset_observations = require("./dataset_observations.model");
var _training_runs = require("./training_runs.model");
var _epochs = require("./epochs.model");
var _hyperparameters = require("./hyperparameters.model");
var _metrics_summary = require("./metrics_summary.model");
var _metrics_curves = require("./metrics_curves.model");
var _artifacts = require("./artifacts.model");

function initModels(sequelize) {
  var SequelizeMeta = _SequelizeMeta(sequelize, DataTypes);
  var observations = _observations(sequelize, DataTypes);
  var projects = _projects(sequelize, DataTypes);
  var sessions = _sessions(sequelize, DataTypes);
  var tasks = _tasks(sequelize, DataTypes);
  var users = _users(sequelize, DataTypes);
  var keyframes = _keyframes(sequelize, DataTypes);

  //init ml tables:
  var ml_models = _ml_models(sequelize, DataTypes);
  var species = _species(sequelize, DataTypes);
  var model_species = _model_species(sequelize, DataTypes);
  var datasets = _datasets(sequelize, DataTypes);
  var dataset_observations = _dataset_observations(sequelize, DataTypes);
  var training_runs = _training_runs(sequelize, DataTypes);
  var epochs = _epochs(sequelize, DataTypes);
  var hyperparameters = _hyperparameters(sequelize, DataTypes);
  var metrics_summary = _metrics_summary(sequelize, DataTypes);
  var metrics_curves = _metrics_curves(sequelize, DataTypes);
  var artifacts = _artifacts(sequelize, DataTypes);


  // we shouldn't need to do this with new tables anymore
  observations.belongsTo(projects, { as: "project", foreignKey: "project_id"});
  projects.hasMany(observations, { as: "observations", foreignKey: "project_id"});
  sessions.belongsTo(projects, { as: "project", foreignKey: "project_id"});
  projects.hasMany(sessions, { as: "sessions", foreignKey: "project_id"});
  observations.belongsTo(sessions, { as: "session", foreignKey: "session_id"});
  sessions.hasMany(observations, { as: "observations", foreignKey: "session_id"});
  observations.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(observations, { as: "observations", foreignKey: "user_id"});
  sessions.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(sessions, { as: "sessions", foreignKey: "user_id"});

  // Associate observations to keyframes. an observation can have 0 to many keyframes, a keyframe must be associated with only one observation
  observations.hasMany(keyframes, { foreignKey: 'observation_id', as: 'keyframes' });
  keyframes.belongsTo(observations, { foreignKey: 'observation_id', as: 'observation' });



  return {
    SequelizeMeta,
    observations,
    projects,
    sessions,
    tasks,
    users,
    keyframes,
    // ML schema tables
    ml_models,
    species,
    model_species,
    datasets,
    dataset_observations,
    training_runs,
    epochs,
    hyperparameters,
    metrics_summary,
    metrics_curves,
    artifacts,
  };
}
module.exports = initModels;
module.exports.initModels = initModels;
module.exports.default = initModels;
