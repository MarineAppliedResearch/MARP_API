/**
 * Application-wide logging wrapper used by controllers, services, and
 * repositories to record informational and error messages.
 *
 * @fileoverview Thin wrapper around the pine logger used throughout the API.
 * @author Isaac Travers
 * @module logger/api.logger
 */

/**
 * Pine logging library used to write formatted log output.
 *
 * @constant
 * @type {Function}
 */
const pine = require('pine');

/**
 * Shared pine logger instance used by every method on APILogger.
 *
 * @constant
 * @type {Object}
 */
const logger = pine();


/**
 * Application-wide logger used across controllers, services, and
 * repositories.
 *
 * @class APILogger
 */
class APILogger {

    /**
     * Log an informational message.
     *
     * CAUTION: this single-argument overload is dead code — the two-argument
     * `info(message, data)` defined immediately below it has the same name,
     * so it silently overwrites this one on the class prototype. Calling
     * `logger.info(message)` with one argument still works (`data` is
     * simply `undefined` in the surviving method), but this method body is
     * never actually reached.
     *
     * @param {string} message - Message to log.
     * @returns {void}
     */
    info(message) {
        logger.info(message);
    }

    /**
     * Log an informational message, optionally with structured data.
     *
     * This is the method that actually runs for every `logger.info(...)`
     * call in the codebase (see caution on the overload above). When
     * `data` is provided, it is JSON-stringified and appended to the
     * message.
     *
     * @param {string} message - Message to log.
     * @param {*} [data] - Optional additional data to log alongside the message, JSON-stringified if present.
     * @returns {void}
     */
    info(message, data) {
        logger.info(`${message}   ${undefined != data ? JSON.stringify(data) : ''}`);
    }

    /**
     * Log an error message.
     *
     * @param {string} message - Message to log.
     * @returns {void}
     */
    error(message) {
        logger.error(message);
    }
}

module.exports = new APILogger();