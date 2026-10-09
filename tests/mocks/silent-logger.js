/**
 * Test-only stand-in for logger/api.logger.js.
 *
 * The real logger is built on the `pine` library, which writes directly
 * to stdout in a way that bypasses Jest's console interception (unlike
 * plain `console.log`/`console.error` calls elsewhere in the app, which
 * Jest's `silent` config option already suppresses and still captures
 * into `testResult.console` for tests/reporters/summary-reporter.js to
 * surface on failure). Since this logger's calls are purely informational
 * ("Controller: createTask", etc.) and never the sole source of a
 * failure's root cause, this test-only substitute no-ops them entirely
 * rather than trying to route pine through Jest's console capture.
 *
 * Wired in via jest.config.js's moduleNameMapper, so no application file
 * needs to know it's running under test.
 *
 * @fileoverview No-op logger used in place of logger/api.logger.js during tests.
 * @author Isaac Travers
 * @module tests/mocks/silent-logger
 */

/**
 * No-op stand-in for the real APILogger instance.
 *
 * @constant
 * @type {Object}
 */
const silentLogger = {
    /**
     * No-op replacement for APILogger#info.
     *
     * @returns {void}
     */
    info() {},

    /**
     * No-op replacement for APILogger#error.
     *
     * @returns {void}
     */
    error() {},
};

module.exports = silentLogger;
