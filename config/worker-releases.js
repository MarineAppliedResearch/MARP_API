/**
 * Where a worker release may be downloaded from, and where MARP keeps the ones it serves
 * itself (#253).
 *
 * A worker downloads whatever a release's `download_url` names and runs it, so the host is
 * the one part of the row that says *who published this*. The size and the SHA-256 are
 * checked before anything is staged, which is what stops a file being swapped underneath us
 * -- but both come from the same row as the URL, so integrity alone cannot answer "is this
 * ours". The allowlist answers that, and it is a **list of places we publish from** rather
 * than the single hardcoded host it used to be (Isaac, 2026-10-14: *"can't we just have them
 * download directly from us or github if we want?"*).
 *
 * **Prefixes, not hosts.** `https://github.com/` would accept any repository's assets;
 * matching the whole prefix keeps it to ours.
 *
 * **HTTPS unless an operator says otherwise.** A download over plain HTTP is still verified
 * by hash, so tampering is caught and the staged copy thrown away, but it is readable and
 * redirectable on the way. An `http://` source is therefore only ever allowed because
 * somebody put one in `WORKER_RELEASE_SOURCES` deliberately -- today that is how a
 * coordinator without a trusted certificate serves its own updates.
 *
 * @fileoverview Allowed sources for worker release archives, and where ours are kept.
 * @module config/worker-releases
 */

'use strict';

const path = require('path');

/** The GitHub releases of this project, which is where the rule started and still applies. */
const GITHUB_SOURCE = 'https://github.com/MarineAppliedResearch/marp-inference-worker/releases/download/';

/**
 * Where MARP serves its own release archives from, under `storage/`, which is git-ignored.
 * A release is a build artifact: nothing here is recoverable from the repository and a fresh
 * deployment starts empty, exactly as the thumbnail storage does.
 */
const DEFAULT_STORAGE_DIR = path.join('storage', 'worker-releases');

/** The path those files are served at, which is what `WORKER_RELEASE_SOURCES` names. */
const SERVE_PATH = '/worker-releases';

const STORAGE_DIR = path.resolve(
    path.join(__dirname, '..'),
    process.env.WORKER_RELEASE_STORAGE_DIR || DEFAULT_STORAGE_DIR
);

/**
 * The URL prefixes a release may be downloaded from.
 *
 * `WORKER_RELEASE_SOURCES` is a comma-separated list and **adds to** the GitHub one rather
 * than replacing it, so a deployment that configures its own server does not quietly stop
 * accepting the releases we publish. Unset, this is exactly the rule that was hardcoded.
 *
 * @constant
 * @type {Array<string>}
 */
const SOURCES = [
    GITHUB_SOURCE,
    ...String(process.env.WORKER_RELEASE_SOURCES || '')
        .split(',')
        .map((source) => source.trim())
        .filter(Boolean),
];

/**
 * Whether a download URL is one MARP will let a worker fetch from.
 *
 * @param {string} downloadUrl - The absolute URL from the release row.
 * @returns {boolean} True when it begins with an allowed prefix.
 */
function isAllowedSource(downloadUrl) {
    return SOURCES.some((source) => String(downloadUrl).startsWith(source));
}

/**
 * What to tell somebody whose URL was refused. It names the sources rather than saying
 * "not allowed", because the fix is to publish somewhere on this list or to add one.
 *
 * @returns {string}
 */
function sourceRefusal() {
    return 'download_url must begin with one of the release sources MARP publishes from: '
        + `${SOURCES.join(', ')}. Add another with WORKER_RELEASE_SOURCES.`;
}

module.exports = {
    GITHUB_SOURCE,
    SERVE_PATH,
    SOURCES,
    STORAGE_DIR,
    isAllowedSource,
    sourceRefusal,
};
