/**
 * Custom Jest reporter producing a compact, readable test run report.
 *
 * Replaces Jest's default reporter entirely (see jest.config.js), which
 * otherwise interleaves the application's own console output (Sequelize
 * SQL query logs, `logger.info('Controller: ...')` calls, etc.) with test
 * results. This reporter prints one padded `Test: [file] name ... STATUS`
 * line per test case as results come in, then a summary block, then — for
 * any failed test — the assertion failure and that test file's captured
 * console output together, so a failure can be traced back to the query/
 * error that caused it without digging through unrelated scrollback. The
 * same report text is written to a timestamped file under `tests/logs/`.
 *
 * Registered via jest.config.js's `reporters` array. Jest instantiates
 * reporters with `new Reporter(globalConfig, reporterOptions)` and calls
 * the lifecycle methods below as the run progresses; no base class is
 * required, only these method names.
 *
 * @fileoverview Custom Jest reporter for readable, traceable test output.
 * @author Isaac Travers
 * @module tests/reporters/summary-reporter
 */

const fs = require('fs');
const path = require('path');

/**
 * Column width that each `Test: [...] name` line is dot-padded to before
 * the status marker. Names longer than this are left as-is (never
 * truncated) with a minimum gap of dots before the status.
 *
 * @constant
 * @type {number}
 */
const LINE_WIDTH = 100;

/**
 * Directory (relative to this file) that timestamped report files are
 * written into.
 *
 * @constant
 * @type {string}
 */
const LOG_DIR = path.join(__dirname, '..', 'logs');

/**
 * Strip ANSI color escape codes from a string.
 *
 * Jest's `failureMessages` are pre-formatted with terminal color codes
 * (via chalk) for direct console display; those codes render as garbage
 * in a plain-text log file, so every string this reporter writes to
 * either destination is passed through this first.
 *
 * @param {string} text - Text that may contain ANSI escape sequences.
 * @returns {string} The same text with all ANSI escape sequences removed.
 */
function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Pad a test line with `.` characters up to `LINE_WIDTH`, leaving at
 * least three dots of separation before the status marker regardless of
 * how long the label is.
 *
 * @param {string} label - The `Test: [file] name` label to pad.
 * @returns {string} The label followed by a run of `.` characters.
 */
function padWithDots(label) {
    const minDots = 3;
    const targetLength = Math.max(LINE_WIDTH, label.length + minDots + 1);
    return label + '.'.repeat(targetLength - label.length);
}

/**
 * Custom Jest reporter that prints a padded pass/fail line per test case,
 * a summary block, and full traceability detail for any failures — to
 * both the console and a timestamped log file.
 *
 * @class SummaryReporter
 */
class SummaryReporter {

    /**
     * @param {Object} globalConfig - Jest's resolved global configuration. Unused directly but accepted per the reporter contract.
     * @param {Object} reporterOptions - Options passed via jest.config.js's reporters entry (none currently used).
     */
    constructor(globalConfig, reporterOptions) {
        this.globalConfig = globalConfig;
        this.reporterOptions = reporterOptions || {};

        /**
         * Every line printed this run, accumulated so the full report can
         * be written to the log file at the end exactly as it appeared on
         * the console.
         *
         * @type {string[]}
         */
        this.reportLines = [];

        /**
         * Failure detail collected per test file, keyed by the file's
         * relative path, so each failing file's console output is only
         * printed once even if multiple of its tests failed.
         *
         * @type {Map<string, {consoleOutput: string[], failures: Array<{fullName: string, messages: string[]}>}>}
         */
        this.failuresByFile = new Map();
    }

    /**
     * Write a line to both the accumulated report buffer and stdout.
     *
     * @param {string} [line] - Line to emit; omit for a blank line.
     * @returns {void}
     */
    print(line = '') {
        this.reportLines.push(line);
        process.stdout.write(line + '\n');
    }

    /**
     * Print the report header at the start of the run.
     *
     * @returns {void}
     */
    onRunStart() {
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
        this.print('='.repeat(LINE_WIDTH));
        this.print(`  MARP API Test Suite Report — ${timestamp}`);
        this.print('='.repeat(LINE_WIDTH));
        this.print();
    }

    /**
     * Print one padded pass/fail line per test case in a completed test
     * file, and record failure detail (including that file's captured
     * console output) for the end-of-run failures section.
     *
     * @param {Object} test - The test file that just finished.
     * @param {Object} testResult - Jest's result object for that file, including per-test-case results and captured console output.
     * @returns {void}
     */
    onTestResult(test, testResult) {
        const relativeFile = path.relative(process.cwd(), testResult.testFilePath);
        const fileBase = path.basename(relativeFile);

        for (const caseResult of testResult.testResults) {
            const fullName = [...caseResult.ancestorTitles, caseResult.title].join(' > ');
            const label = `Test: [${fileBase}] ${fullName} `;
            const status =
                caseResult.status === 'passed' ? 'PASS'
                    : caseResult.status === 'pending' || caseResult.status === 'todo' ? 'SKIP'
                        : 'FAIL';

            this.print(padWithDots(label) + ' ' + status);

            if (status === 'FAIL') {
                if (!this.failuresByFile.has(relativeFile)) {
                    this.failuresByFile.set(relativeFile, {
                        consoleOutput: (testResult.console || []).map(
                            (entry) => `    [${entry.type}] ${stripAnsi(entry.message)}`
                        ),
                        failures: [],
                    });
                }
                this.failuresByFile.get(relativeFile).failures.push({
                    fullName,
                    messages: caseResult.failureMessages.map(stripAnsi),
                });
            }
        }
    }

    /**
     * Print the summary stats block, the full failure-traceability
     * section (if any), and write the accumulated report to a timestamped
     * file under tests/logs/.
     *
     * @param {Object} contexts - Unused; accepted per the reporter contract.
     * @param {Object} results - Jest's aggregated results for the whole run (counts, timing, overall success).
     * @returns {void}
     */
    onRunComplete(contexts, results) {
        const durationSeconds = ((Date.now() - results.startTime) / 1000).toFixed(1);

        this.print();
        this.print('-'.repeat(LINE_WIDTH));
        this.print('Tests Complete:');
        this.print('-'.repeat(LINE_WIDTH));
        this.print(
            `  Test Suites : ${results.numPassedTestSuites} passed, ${results.numFailedTestSuites} failed, ${results.numTotalTestSuites} total`
        );
        this.print(
            `  Tests       : ${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numPendingTests} skipped, ${results.numTotalTests} total`
        );
        this.print(`  Duration    : ${durationSeconds}s`);
        this.print();

        const allTestsPassed = results.numFailedTests === 0 && results.numFailedTestSuites === 0;
        this.print(allTestsPassed ? '  Result: ALL TESTS PASSED' : '  Result: FAILURES DETECTED — see below');
        this.print('='.repeat(LINE_WIDTH));

        if (this.failuresByFile.size > 0) {
            this.print();
            this.print('Failed Tests (traceback):');
            this.print('='.repeat(LINE_WIDTH));

            for (const [file, detail] of this.failuresByFile) {
                this.print();
                this.print(`File: ${file}`);
                for (const failure of detail.failures) {
                    this.print(`  ✗ ${failure.fullName}`);
                    for (const message of failure.messages) {
                        for (const messageLine of message.split('\n')) {
                            this.print(`      ${messageLine}`);
                        }
                    }
                }
                if (detail.consoleOutput.length > 0) {
                    this.print('  --- console output during this test file ---');
                    for (const line of detail.consoleOutput) {
                        this.print(line);
                    }
                }
            }
            this.print('='.repeat(LINE_WIDTH));
        }

        fs.mkdirSync(LOG_DIR, { recursive: true });
        const logFileName = `test-run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
        fs.writeFileSync(path.join(LOG_DIR, logFileName), this.reportLines.join('\n') + '\n');
        process.stdout.write(`\nFull report written to tests/logs/${logFileName}\n`);
    }
}

module.exports = SummaryReporter;
