var DataTypes = require("sequelize").DataTypes;
var _SequelizeMeta = require("./SequelizeMeta");
var _observations = require("./observations");
var _projects = require("./projects");
var _sessions = require("./sessions");
var _tasks = require("./tasks");
var _users = require("./users");
var _keyframes = require("./keyframes");

function initModels(sequelize) {
  var SequelizeMeta = _SequelizeMeta(sequelize, DataTypes);
  var observations = _observations(sequelize, DataTypes);
  var projects = _projects(sequelize, DataTypes);
  var sessions = _sessions(sequelize, DataTypes);
  var tasks = _tasks(sequelize, DataTypes);
  var users = _users(sequelize, DataTypes);
  var keyframes = _keyframes(sequelize, DataTypes);

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
    keyframes
  };
}
module.exports = initModels;
module.exports.initModels = initModels;
module.exports.default = initModels;
