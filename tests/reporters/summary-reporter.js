/**
 * Custom Jest reporter producing a compact, readable, live-updating test
 * run report.
 *
 * Replaces Jest's default reporter entirely (see jest.config.js), which
 * otherwise interleaves the application's own console output (Sequelize
 * SQL query logs, `logger.info('Controller: ...')` calls, etc.) with test
 * results. This reporter prints one fixed-width `Test: [file] name ....
 * STATUS` line per test case the moment that individual test finishes
 * (via `onTestCaseResult`, not the coarser per-file `onTestResult`), so
 * lines appear live as the suite runs rather than all at once at the end.
 * Every label is padded — or truncated with an ellipsis, for the rare
 * outlier longer than COLUMN_WIDTH — to the exact same width, so the
 * status markers always line up in a single column regardless of how long
 * an individual test's name is.
 *
 * A summary block follows at the end, then — for any failed test — the
 * assertion failure with file:line, so a failure can be traced without
 * digging through scrollback. (The application's own `console.error`
 * calls, which capture the real root cause of a 500, still print live via
 * tests/setup/console-error-passthrough.js, right at the point of
 * failure — see that file's header for why this reporter doesn't also try
 * to re-surface them here.) The same report text is written to a
 * timestamped file under `tests/logs/`.
 *
 * Registered via jest.config.js's `reporters` array. Jest instantiates
 * reporters with `new Reporter(globalConfig, reporterOptions)` and calls
 * the lifecycle methods below as the run progresses; no base class is
 * required, only these method names.
 *
 * @fileoverview Custom Jest reporter for readable, live, traceable test output.
 * @author Isaac Travers
 * @module tests/reporters/summary-reporter
 */

const fs = require('fs');
const path = require('path');

/**
 * Fixed total width (in characters) of every `Test: [file] name` label,
 * before the trailing status marker. Chosen from the actual distribution
 * of test names in this suite (median ~80, 90th percentile ~140) so most
 * labels are padded with dots and only the rare long outlier is
 * truncated — never the other way around, which is what caused status
 * markers to land in different columns before this was fixed.
 *
 * @constant
 * @type {number}
 */
const COLUMN_WIDTH = 120;

/**
 * Minimum number of `.` characters always inserted between a label and
 * its status marker, even for a label truncated to exactly fit
 * COLUMN_WIDTH.
 *
 * @constant
 * @type {number}
 */
const MIN_DOTS = 3;

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
 * Fit a label to exactly `COLUMN_WIDTH - MIN_DOTS` characters (truncating
 * with an ellipsis if it's longer), then pad it with `.` characters up to
 * `COLUMN_WIDTH`. Every call returns a string of the exact same length,
 * which is what keeps the status column aligned across every test line
 * regardless of name length.
 *
 * @param {string} label - The `Test: [file] name` label to format.
 * @returns {string} A string exactly `COLUMN_WIDTH` characters long.
 */
function formatLabel(label) {
    const maxLabelWidth = COLUMN_WIDTH - MIN_DOTS;
    const fitted =
        label.length > maxLabelWidth
            ? label.slice(0, maxLabelWidth - 1) + '…'
            : label;
    return fitted + '.'.repeat(COLUMN_WIDTH - fitted.length);
}

/**
 * Custom Jest reporter that prints a fixed-width, aligned pass/fail line
 * per test case live as each one finishes, a summary block, and full
 * traceability detail for any failures — to both the console and a
 * timestamped log file.
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
         * relative path.
         *
         * @type {Map<string, Array<{fullName: string, messages: string[]}>>}
         */
        this.failuresByFile = new Map();
    }

    /**
     * Write a line to both the accumulated report buffer and stdout,
     * immediately (not buffered until the run ends), so lines appear live
     * as the suite runs.
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
        this.print('='.repeat(COLUMN_WIDTH));
        this.print(`  MARP API Test Suite Report — ${timestamp}`);
        this.print('='.repeat(COLUMN_WIDTH));
        this.print();
    }

    /**
     * Print one aligned pass/fail line the moment an individual test case
     * finishes, and record failure detail for the end-of-run failures
     * section. Called once per `it()` block, in real time, as opposed to
     * `onTestResult` which only fires once an entire test file completes.
     *
     * @param {Object} test - The test file this test case belongs to.
     * @param {Object} testCaseResult - Jest's result object for this single test case (title, ancestorTitles, status, failureMessages).
     * @returns {void}
     */
    onTestCaseResult(test, testCaseResult) {
        const relativeFile = path.relative(process.cwd(), test.path);
        const fileBase = path.basename(relativeFile);
        const fullName = [...testCaseResult.ancestorTitles, testCaseResult.title].join(' > ');
        const label = `Test: [${fileBase}] ${fullName} `;
        const status =
            testCaseResult.status === 'passed' ? 'PASS'
                : testCaseResult.status === 'pending' || testCaseResult.status === 'todo' ? 'SKIP'
                    : 'FAIL';

        this.print(formatLabel(label) + ' ' + status);

        if (status === 'FAIL') {
            if (!this.failuresByFile.has(relativeFile)) {
                this.failuresByFile.set(relativeFile, []);
            }
            this.failuresByFile.get(relativeFile).push({
                fullName,
                messages: (testCaseResult.failureMessages || []).map(stripAnsi),
            });
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
        this.print('-'.repeat(COLUMN_WIDTH));
        this.print('Tests Complete:');
        this.print('-'.repeat(COLUMN_WIDTH));
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
        this.print('='.repeat(COLUMN_WIDTH));

        if (this.failuresByFile.size > 0) {
            this.print();
            this.print('Failed Tests (traceback):');
            this.print('='.repeat(COLUMN_WIDTH));

            for (const [file, failures] of this.failuresByFile) {
                this.print();
                this.print(`File: ${file}`);
                for (const failure of failures) {
                    this.print(`  ✗ ${failure.fullName}`);
                    for (const message of failure.messages) {
                        for (const messageLine of message.split('\n')) {
                            this.print(`      ${messageLine}`);
                        }
                    }
                }
            }
            this.print('='.repeat(COLUMN_WIDTH));
        }

        fs.mkdirSync(LOG_DIR, { recursive: true });
        const logFileName = `test-run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
        fs.writeFileSync(path.join(LOG_DIR, logFileName), this.reportLines.join('\n') + '\n');
        process.stdout.write(`\nFull report written to tests/logs/${logFileName}\n`);
    }
}

module.exports = SummaryReporter;
