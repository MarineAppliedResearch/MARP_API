/**
 * Central Sequelize model registry and shared database connection.
 *
 * Creates the shared Sequelize connection from environment-driven
 * configuration, dynamically discovers and loads every `*.model.js`
 * factory file in this directory, initializes each model against that
 * shared connection, and wires up model associations afterward so load
 * order does not matter.
 *
 * The resulting `db` object is the single registry imported throughout the
 * application as `require('../model')`. Repositories must use this same
 * shared connection rather than creating their own Sequelize instance, so
 * that connection pooling and query behavior stay consistent across the
 * app (see `validateSharedSequelizeConnection` in server.js, which checks
 * this at startup).
 *
 * @fileoverview Dynamic Sequelize model loader and shared database registry.
 * @author Isaac Travers
 * @module model/index
 */

'use strict';

/**
 * Node.js filesystem module used to discover model factory files in this
 * directory at startup.
 *
 * @constant
 * @type {Object}
 */
const fs = require('fs');

/**
 * Node.js path module used to build platform-independent file paths.
 *
 * @constant
 * @type {Object}
 */
const path = require('path');

/**
 * Sequelize library providing the connection class, data types, and query
 * operators used by every model in this registry.
 *
 * @constant
 * @type {Object}
 */
const Sequelize = require('sequelize');

const process = require('process');

/**
 * Base filename of this file, used to exclude it from the dynamic model
 * loader below so index.js does not attempt to require itself as a model.
 *
 * @constant
 * @type {string}
 */
const basename = path.basename(__filename);

/**
 * Active Node environment, used to select the matching connection
 * configuration block. Defaults to 'test' when NODE_ENV is not set.
 *
 * @constant
 * @type {string}
 */
const env = process.env.NODE_ENV || 'test';

/**
 * Connection configuration for the active environment, loaded from
 * config/config.js.
 *
 * @constant
 * @type {Object}
 */
const config = require(__dirname + '/../config/config.js')[env];

/**
 * Shared model registry populated by the dynamic loader below. Exposes
 * every initialized Sequelize model by name, plus the shared `sequelize`
 * connection and `Sequelize` library reference.
 *
 * @constant
 * @type {Object}
 */
const db = {};

/**
 * Shared Sequelize connection used by every model, repository, and
 * controller in the application.
 *
 * @type {Object}
 */
let sequelize;
if (config.use_env_variable) {
  // Some environments (e.g. hosted Postgres add-ons) supply the full
  // connection string through a single environment variable instead of
  // discrete host/user/password fields.
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

/**
 * Discover and initialize every model factory file in this directory.
 *
 * Scans this directory for files matching `*.model.js` (excluding this
 * file itself and any `.test.js` files), requires each one, calls it as a
 * Sequelize model factory with the shared connection, and registers the
 * resulting model on `db` under its Sequelize model name.
 *
 * A model file that fails to load or does not export a factory function is
 * logged and skipped rather than crashing startup, so a single broken
 * model definition does not take down the entire application.
 */
fs
  .readdirSync(__dirname)
  .filter(file => (
    file.indexOf('.') !== 0 &&
    file !== basename &&
    file.endsWith('.model.js') &&
    file.indexOf('.test.js') === -1
  ))
  .forEach(file => {
    // Only runtime model factory files should be loaded here.
    console.log('Loading model:', file);
    try {
      const modelFactory = require(path.join(__dirname, file));
      if (typeof modelFactory !== 'function') {
        console.error('Model did not export a function:', file);
        return;
      }
      const model = modelFactory(sequelize, Sequelize.DataTypes);
      db[model.name] = model;
      console.log('Loaded model:', model.name);
    } catch (err) {
      console.error('Failed loading model:', file);
      console.error(err);
    }
  });

/**
 * Wire up associations for every loaded model.
 *
 * Runs after all models have been loaded onto `db`, so each model's
 * `associate(models)` method can safely reference any other model in the
 * registry regardless of the order files were loaded in.
 */
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Expose the shared connection and Sequelize library alongside the models
// so repositories can run raw queries, transactions, and use Sequelize
// operators without a separate import.
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
