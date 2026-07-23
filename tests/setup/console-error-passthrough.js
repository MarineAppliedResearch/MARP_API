/**
 * Jest setup file that keeps console.error visible during test runs even
 * though jest.config.js sets `silent: true`.
 *
 * `silent: true` fully discards all console output (Jest replaces the
 * global console with a no-op NullConsole, which also empties
 * `testResult.console` — there's no built-in "capture but don't print"
 * middle ground). That's the right default for console.log/info (the
 * routine SQL-query/"Controller: X" noise), but it would also hide
 * console.error calls, which in this codebase only ever fire from a route's
 * `.catch()` block right before it responds with a 500 — exactly the
 * detail needed to trace a failing test back to its real root cause (a
 * generic `{error: "Failed to fetch task"}` response body doesn't say
 * *why* the query failed; the app's own console.error does).
 *
 * This file reassigns `console.error` to write straight to process.stderr,
 * bypassing Jest's console replacement entirely, so it still prints live
 * right at the point of failure. It intentionally does NOT touch
 * console.log/info/warn — those stay silenced.
 *
 * Registered via jest.config.js's `setupFilesAfterEnv`, so it runs once per
 * test file after the test framework (jest-circus) is installed.
 *
 * @fileoverview Keeps console.error visible under Jest's silent mode.
 * @author Isaac Travers
 * @module tests/setup/console-error-passthrough
 */

console.error = (...args) => {
    const line = args
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
    process.stderr.write(line + '\n');
};
