/**
 * Runs one subsystem's test suites, or audits that the subsystems still
 * account for every suite.
 *
 * `npm test` runs everything and is unchanged -- it is the slow tier, for the
 * end of a change set. This is the fast tier: run the subsystem you touched,
 * which is seconds rather than minutes, and keep the whole suite for the end.
 *
 * The group definitions live here and nowhere else. `npm run test:subsystems`
 * fails when a suite belongs to no group or to two, because a grouping nobody
 * checks is a grouping that silently stops covering the suite -- a new test
 * file would otherwise be in no group and no faster loop would ever run it.
 *
 * @fileoverview Subsystem test runner and grouping audit for the MARP API.
 * @author Isaac Travers
 * @module scripts/test-subsystem
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every subsystem, as a name and the suites it owns.
 *
 * Named by what the suites are about rather than by which files they touch,
 * so a reader can pick a group from a description of their change. Each entry
 * is matched against the test file's basename without `.test.js`.
 */
const SUBSYSTEMS = {
    gpu: {
        describe: 'distributed GPU compute: orchestration, leases, video resolution, ingest',
        suites: [
            'gpu-orchestration',
            'gpu-lease-race',
            'gpu-abandoned-poll',
            'gpu-video-resolution',
            'gpu-observation-ingest',
        ],
    },
    mosaic: {
        describe: 'the picture mosaic reviewer: query, commit, correction, thumbnails',
        suites: [
            'mosaic-query',
            'mosaic-commit',
            'mosaic-correction',
            // Phase 6 (#118). Here rather than in a group of their own: the
            // thumbnail is what a mosaic tile draws, and the row key, the
            // enqueue-on-page-fetch and the `no-imagery` skip are all changes to
            // the mosaic's own contract.
            'thumbnails',
            'thumbnail-geometry',
        ],
    },
    review: {
        describe: 'observation review and training state, and observation versioning',
        suites: ['observation-review-schema', 'observation-review-current', 'observation-version'],
    },
    observations: {
        describe: 'observations, keyframes, and the timecode columns',
        suites: ['observations', 'observations-readonly', 'keyframes', 'timecode', 'timecode-resync'],
    },
    ml: {
        describe: 'the ML domain: datasets, training runs, epochs, metrics, models',
        suites: [
            'datasets',
            'dataset_observations',
            'dataset-observations-cascade',
            'epochs',
            'metrics_curves',
            'metrics_summary',
            'ml_models',
            'model_species',
            'training_runs',
        ],
    },
    species: {
        describe: 'the species list and its pictures',
        suites: ['species', 'species-lists', 'species-pictures', 'v2_species'],
    },
    auth: {
        describe: 'authentication, users, and service tokens',
        suites: ['auth', 'users', 'v2_users', 'v2_tokens'],
    },
    core: {
        describe: 'projects, sessions, tasks, schema, and data integrity',
        suites: [
            'project',
            'sessions',
            'sessions-by-project',
            'tasks',
            'schema',
            'readonly-endpoints',
            'data-integrity',
        ],
    },
    media: {
        describe: 'Jellyfin. Needs the live media server, which is why CI excludes it',
        suites: ['jellyfin'],
    },
};

/**
 * Reads the suite basenames actually present under tests/.
 *
 * @returns {string[]} basenames without the `.test.js` suffix, sorted.
 */
function suitesOnDisk() {
    return readdirSync(join(ROOT, 'tests'))
        .filter((name) => name.endsWith('.test.js'))
        .map((name) => name.replace(/\.test\.js$/, ''))
        .sort();
}

/**
 * Checks that the groups above still account for every suite, exactly once.
 *
 * @returns {number} process exit code: 0 when the grouping is complete.
 */
function audit() {
    const onDisk = suitesOnDisk();
    const claimed = new Map();

    for (const [group, { suites }] of Object.entries(SUBSYSTEMS)) {
        for (const suite of suites) {
            if (claimed.has(suite)) {
                claimed.get(suite).push(group);
            } else {
                claimed.set(suite, [group]);
            }
        }
    }

    const ungrouped = onDisk.filter((suite) => !claimed.has(suite));
    const twice = [...claimed.entries()].filter(([, groups]) => groups.length > 1);
    const missing = [...claimed.keys()].filter((suite) => !onDisk.includes(suite));

    console.log(`==> Test subsystems (${onDisk.length} suites on disk)`);
    for (const [group, { suites, describe }] of Object.entries(SUBSYSTEMS)) {
        console.log(`    ${group.padEnd(13)} ${String(suites.length).padStart(2)}  ${describe}`);
    }
    console.log();

    let failed = false;

    if (ungrouped.length) {
        failed = true;
        console.log('    FAIL these suites belong to no subsystem, so no fast loop runs them:');
        for (const suite of ungrouped) console.log(`         ${suite}.test.js`);
        console.log('         add each to a group in scripts/test-subsystem.mjs');
    }
    if (twice.length) {
        failed = true;
        console.log('    FAIL these suites are claimed by more than one subsystem:');
        for (const [suite, groups] of twice) console.log(`         ${suite} -> ${groups.join(', ')}`);
    }
    if (missing.length) {
        failed = true;
        console.log('    FAIL these suites are grouped but do not exist:');
        for (const suite of missing) console.log(`         ${suite}.test.js`);
    }

    if (!failed) console.log('    ok   every suite belongs to exactly one subsystem');
    return failed ? 1 : 0;
}

const requested = process.argv[2];

if (!requested || requested === '--audit') {
    process.exit(audit());
}

const subsystem = SUBSYSTEMS[requested];

if (!subsystem) {
    console.error(`unknown subsystem '${requested}'. one of: ${Object.keys(SUBSYSTEMS).join(', ')}`);
    process.exit(2);
}

/* Anchored on the basename so `species` cannot also select `model_species`,
   and escaped so an underscore or hyphen in a name stays literal. */
const pattern = `tests/(${subsystem.suites
    .map((suite) => suite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\.test\\.js$`;

/* Jest is invoked through node rather than through a shell. The pattern
   contains `|`, and on Windows a shell reads that as a pipe -- which made the
   whole run silently execute nothing in about a second, looking fast rather
   than looking broken.

   --runInBand for the same reason `npm test` uses it: these suites share one
   real database and parallel workers race over it. */
const result = spawnSync(
    process.execPath,
    [
        join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js'),
        '--runInBand',
        '--forceExit',
        '--testPathPatterns',
        pattern,
        ...process.argv.slice(3),
    ],
    { cwd: ROOT, stdio: 'inherit' },
);

process.exit(result.status === null ? 1 : result.status);
