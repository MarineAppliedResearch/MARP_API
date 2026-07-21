const db = require('../model');

/**
 * Compatibility wrapper for legacy repository code.
 *
 * Repositories currently call connect() and expect an object that contains
 * model handles plus sequelize/Sequelize references. Returning the shared
 * object from model/index.js ensures there is a single Sequelize instance
 * across the API while we migrate imports incrementally.
 */
const connect = () => db;

module.exports = {
  connect,
};
