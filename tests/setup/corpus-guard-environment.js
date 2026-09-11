/**
 * The test environment the corpus guard needs in order to have the last word.
 *
 * Jest's node environment, plus one thing: on jest-circus's `run_finish` event
 * -- dispatched after the file's tests *and* every `afterAll` in it, including
 * the suite's own cleanup -- it calls the closer that
 * `tests/setup/corpus-guard-setup.js` left on the sandbox global, and turns a
 * difference into a suite-level failure.
 *
 * A setup file cannot do this itself. Its hooks are registered before the test
 * file's own, `afterAll` runs in declaration order, so the guard would compare
 * before a well-behaved suite had cleaned up and fail it for rows it was about
 * to remove. `handleTestEvent` is the supported way to sit outside all of that.
 *
 * Pushing onto `state.unhandledErrors` is how a failure with no owning test
 * gets reported: jest-circus reads that array immediately after `run_finish`
 * and the suite is reported as having failed to run, carrying the guard's
 * message. `tests/reporters/summary-reporter.js` surfaces it.
 *
 * @fileoverview Node test environment that runs the corpus guard's comparison last.
 * @author Isaac Travers
 * @module tests/setup/corpus-guard-environment
 */

'use strict';

const { TestEnvironment: NodeEnvironment } = require('jest-environment-node');

/**
 * Node environment that compares the corpus guard's snapshots once everything
 * else in the test file has finished.
 *
 * @class CorpusGuardEnvironment
 * @augments NodeEnvironment
 */
class CorpusGuardEnvironment extends NodeEnvironment {
    /**
     * Handles jest-circus lifecycle events.
     *
     * @param {Object} event The circus event.
     * @param {Object} state The circus run state.
     * @returns {Promise<void>} Resolves when the event is handled.
     */
    async handleTestEvent(event, state) {
        if (event.name !== 'run_finish') {
            return;
        }

        const close = this.global.__corpusGuardClose;

        // Absent when the suite did not load the guard's setup file, which is
        // the case for any config that does not register it.
        if (typeof close !== 'function') {
            return;
        }

        try {
            await close();
        } catch (error) {
            state.unhandledErrors.push(error);
        }
    }
}

module.exports = CorpusGuardEnvironment;
