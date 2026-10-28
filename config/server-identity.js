/**
 * Which code this process is actually running, and since when.
 *
 * **A server serves the code it was started with, not the code on your branch.** One here
 * ran five days behind its checkout for a day without anybody noticing, and the evidence
 * looked like a defect in the feature somebody had just written -- twice, the second time
 * against a process nineteen hours old. The checkout cannot answer the question, because
 * the checkout has moved on; only the process knows.
 *
 * **Read once, at load.** That is the whole point and not an optimisation: re-reading
 * `HEAD` later would report whatever the working tree has since become, which is exactly
 * the lie this exists to stop. These two values describe this process and never change
 * while it lives.
 *
 * **Null rather than a guess when git cannot answer.** A deployed copy with no `.git`, or
 * a machine with no `git` on PATH, has no commit to report -- and a fabricated or stale
 * one would be worse than the gap, because a screen would present it as a measurement.
 * The caller renders a null as *unknown*, never as a hash.
 *
 * **It says what HEAD was, not that the tree was clean.** Uncommitted edits are invisible
 * here, so a dirty checkout reports the commit it is standing on while running something
 * slightly different. That is still far more than nothing, which is what there was.
 *
 * @fileoverview The running server's boot time and commit.
 * @author Isaac Travers
 * @module config/server-identity
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/** When this process loaded. @constant {string} */
const STARTED_AT = new Date().toISOString();

/**
 * The commit this checkout was on when the process started.
 *
 * `execFileSync` rather than `exec`, so nothing reaches a shell; the repository root is
 * named explicitly, because a server started from elsewhere would otherwise ask git about
 * whatever directory it happened to be in.
 *
 * @returns {string|null} The full hash, or null when git cannot say.
 */
function readCommit() {
    try {
        const out = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            // stderr discarded: "not a git repository" is an answer, not a fault.
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
        }).trim();

        return out || null;
    } catch {
        return null;
    }
}

/** @constant {string|null} */
const COMMIT = readCommit();

/**
 * What this process is, for anything that serves it.
 *
 * A fresh object each call, so a caller cannot edit the record by editing what it got.
 *
 * @returns {{started_at: string, commit: string|null}} The identity.
 */
function serverIdentity() {
    return { started_at: STARTED_AT, commit: COMMIT };
}

module.exports = { serverIdentity, STARTED_AT, COMMIT };
