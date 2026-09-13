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
            // Phase 8 (#124): the facets route the rail's option lists come from,
            // and the row's reviewer ids. Same group as the query it rides beside --
            // both are the read path the mosaic client joins to.
            'mosaic-facets',
            // Phase 6 (#118). Here rather than in a group of their own: the
            // thumbnail is what a mosaic tile draws, and the row key, the
            // enqueue-on-page-fetch and the `no-imagery` skip are all changes to
            // the mosaic's own contract.
            'thumbnails',
            'thumbnail-geometry',
            // The stored filename is a content hash (#62). Here for the same
            // reason as the two above: the name is how a tile reaches the mosaic.
            'thumbnail-naming',
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
            // #125: what "the corpus" is, and the refusal that stands between a
            // mistyped load and a database with no backup. Here rather than in a
            // group of its own -- it is about the schema and about not losing
            // rows, which is what this group already owns.
            'corpus',
            // #132: where a database's thumbnails live. Beside `corpus` because
            // it is the other half of the same question -- the rows and the
            // files are one corpus, and this is what stops two databases in one
            // checkout sharing a directory and deleting each other's pictures.
            'thumbnail-storage',
            // The refusal that keeps the testing database's deliberately weak
            // isaac/isaac login off anything real. Beside the two above for the
            // same reason: it is about which database this is.
            'testing-database-admin',
            // The corpus guard (#142). Here because it is data integrity by
            // another route: it watches what a suite leaves behind rather than
            // what a migration does.
            'corpus-guard',
            // #152: the public entry pages, read off disk. Here rather than in
            // an entry group of its own -- one suite does not need a group, and
            // this is the same kind of check as `schema`: an invariant about
            // what the repository contains rather than about what it serves.
            'landing-copy',
            // #140: the two documentation surfaces and the forked jsdoc
            // template, read off disk. Same reasoning as `landing-copy` -- an
            // invariant about what the repository contains.
            'docs-branding',
            // #151: the legacy dashboard's shell -- its palette, its logo and the shared
            // account menu, read off disk. Here for the same reason as the two above, and
            // deliberately small: that application is being redesigned, so it has an
            // invariant rather than a tier of its own.
            'dashboard-shell',
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
