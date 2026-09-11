/**
 * Jest configuration for the corpus guard's own fixture suites.
 *
 * Run only by `tests/corpus-guard.test.js`, as a child process pointed at a
 * scratch database. It collects `*.fixture.js` here -- a pattern the repository
 * config's default `testMatch` deliberately does not -- and arms the corpus
 * guard the same way `jest.config.js` does: the setup file first, and the
 * environment that gives its comparison the last word.
 *
 * No `globalSetup` and no authenticated agent: these fixtures talk to the
 * database directly and never build the Express app, so there is nothing to log
 * in to.
 *
 * @fileoverview Child Jest config for the corpus guard fixture suites.
 * @author Isaac Travers
 * @module tests/corpus-guard/jest.fixture.config
 */
module.exports = {
    rootDir: '../..',
    roots: ['<rootDir>/tests/corpus-guard'],
    testEnvironment: '<rootDir>/tests/setup/corpus-guard-environment.js',
    testMatch: ['**/*.fixture.js'],
    testTimeout: 30000,

    // Sequelize logs every statement through console.log; the parent test reads
    // this run's output and only the guard's own failures should be in it.
    silent: true,

    moduleNameMapper: {
        '.*/logger/api\\.logger$': '<rootDir>/tests/mocks/silent-logger.js',
    },

    setupFilesAfterEnv: ['<rootDir>/tests/setup/corpus-guard-setup.js'],
};
