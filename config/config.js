/**
 * Sequelize database configuration builder.
 *
 * Builds the Sequelize connection configuration used both by the running
 * API (via model/index.js) and by Sequelize CLI commands such as
 * migrations and seeders. Database credentials and environment-specific
 * values are loaded from the local `.env` file so secrets are not stored
 * in source control.
 *
 * @fileoverview Sequelize database configuration for all runtime environments.
 * @author Isaac Travers
 * @module config/config
 */

/**
 * Loads environment variables from the repository's local `.env` file into
 * `process.env`.
 *
 * @constant
 * @type {Object}
 */
const dotenv = require('dotenv');

// Load variables from the repository's local .env file into process.env.
dotenv.config();


/**
 * Shared Sequelize configuration.
 *
 * Development, test, and production currently use the same environment-based
 * configuration structure. Individual environments can be separated later
 * without changing the code that initializes Sequelize.
 *
 * @constant
 * @type {Object}
 */
const sharedConfig = {
  // PostgreSQL role used by Sequelize when opening database connections.
  username: process.env.DB_USER,

  // Password for the PostgreSQL role defined by DB_USER.
  password: process.env.DB_PASSWORD,

  // Name of the PostgreSQL database the API will connect to.
  database: process.env.DB_NAME,

  // Hostname or IP address of the PostgreSQL server.
  host: process.env.DB_HOST,

  // TCP port used by PostgreSQL. PostgreSQL defaults to port 5432.
  port: Number(process.env.DB_PORT || 5432),

  // Sequelize database dialect. MARP currently uses PostgreSQL.
  dialect: process.env.DB_DIALECT || 'postgres',
};


/**
 * Sequelize configuration keyed by runtime environment.
 *
 * model/index.js selects one of these configurations using NODE_ENV.
 * Sequelize CLI also uses these names when running migrations and seeders.
 * All three environments currently share the same underlying config object.
 *
 * @constant
 * @type {Object}
 * @property {Object} development - Configuration used when NODE_ENV is unset or 'development'.
 * @property {Object} test - Configuration used when NODE_ENV is 'test'.
 * @property {Object} production - Configuration used when NODE_ENV is 'production'.
 */
module.exports = {
  development: sharedConfig,
  test: sharedConfig,
  production: sharedConfig,
};