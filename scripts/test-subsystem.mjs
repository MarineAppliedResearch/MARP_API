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
            'gpu-playback-reporting',
            'gpu-observation-ingest',
            // #232: the settings an attempt ran with, reported on the event stream.
            'gpu-attempt-settings',
            // #104: what the job list and the pool view can be asked, after the
            // dashboard's gaps 23 to 27 were closed.
            'gpu-finished-at',
            'gpu-job-list',
            'gpu-pool-telemetry',
            'gpu-telemetry-series',
            // #67: training as a job -- serving the dataset, and queueing a run
            // over it rather than over a span of a video.
            'gpu-dataset-archive',
            'gpu-training-submit',
            'gpu-training-run-record',
            // #104: what an inference job produced, which its state cannot say.
            'inference-job-outcome',
            // #104: the session a run creates for itself, and the type derived for it.
            'inference-run-session',
            /* #268: the name a training job gets when nobody typed one. */
            'gpu-training-job-name',
            'gpu-trained-model-registration',
            /* #268: what the training panel reads back -- the per-epoch metric names the
               ingest was getting wrong, and the pace series nothing served. */
            'training-run-pace',
            /* #268: bulk deletion of failed jobs. Builds and drops its own database,
               because the route deletes every failed job in whatever one it is pointed
               at -- no seeding scopes that. */
            'gpu-job-delete',
            'worker-provisioning',
            /* #268: the GPU reading a polling worker sends, which used to be dropped
               unless it was given work -- so the activity charts saw only leased minutes. */
            'gpu-idle-telemetry',
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
            // #104: the frame count the dataset builder sizes a training run against.
            // Here rather than with the dashboard's own suites, because it is the same
            // read path over the same filters as the query and the facets beside it.
            'mosaic-frames',
            // #181: the source-video inspector's read, which rides beside the query.
            'mosaic-video-context',
            'mosaic-video',
            'mosaic-video-edit',
            'mosaic-video-annotate',
            // #181: the Jellyfin proxy the video page plays through, and the one port
            // that answers HTTPS beside HTTP so that page can be secure.
            'jellyfin-proxy',
            'listen',
            // The player bundle the video page loads is in the checkout at all.
            'video-player-vendor',
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
        suites: [
            'observation-review-schema',
            'observation-review-current',
            'observation-version',
            /* #268: the migration carrying the legacy "R" note into the training
               dimension. Here rather than with the schema suites because what it is
               about is what a training decision means and who made it, which is this
               group's subject. It builds and drops its own database, so it is seconds
               rather than milliseconds -- see the file for why it cannot run against
               a shared one. */
            'legacy-r-promotion',
        ],
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
            // #268: reading YOLO's end-of-run report -- the per-class rows, and the
            // confusion matrix, which the trainer indexes as the transpose of how a
            // person reads one. Pure functions, so it costs a second.
            'final-metrics',
            // #268: the ingest and the three reads, end to end against a database.
            'training-run-yolo-output',
            'ml_models',
            // #268: a pretrained base model must never reach inference, where its
            // upstream class names would be resolved against the species catalogue.
            'base-model-guard',
            // #268: which models a picker may offer for inference.
            'ml-models-runnable',
            // #104: preferred models, version chains, dataset status and the
            // training-run listing the registry had no route for.
            'ml-registry',
            // #268: grouping, splitting and vocabulary for a dataset build. Pure
            // functions, so they cost a second and belong with the registry they feed.
            'dataset-build-plan',
            // #268: the rest of the build path -- the route, the claim rule, the
            // runner, and what a cancelled, retried or failed build left behind. The
            // extractor is stubbed in all three, so they are seconds rather than
            // minutes; the real build is `datasets` below.
            'dataset-build-queue',
            'dataset-build-runner',
            'dataset-build-lifecycle',
            /* #268: the classification archive -- class folders, no data.yaml, and the
               refusals that stop one being built that trains on a random split. Opens
               the tar, because the directory names are the whole contract. */
            'dataset-build-classification',
            /* #268 1.2: the build's progress as the Datasets screen reads it. Written
               on another branch, and registered from here deliberately -- this file has
               one writer, and two agents editing it from different assumptions is a
               conflict in the one place that says which suites exist. **The audit fails
               until that file lands**, naming it, which is the honest half of the
               trade: a suite that is expected and missing says so, where a suite nobody
               registered is one no fast loop would ever run. */
            'dataset-build-progress',
            /* #268: the builder and the thumbnail extractor must mean the same thing by
               `keyframes.x, y`, and did not for a day. Here rather than beside the
               thumbnail suites in `mosaic` because the drift was the builder's and the
               next one is likelier to be too -- the extractor's reading is older than
               this issue and was confirmed three times before it. */
            'keyframe-box-meaning',
            'model_species',
            'training_runs',
        ],
    },
    species: {
        describe: 'the species list and its pictures',
        suites: ['species', 'species-lists', 'species-pictures', 'v2_species', 'habitat-stop-pull-items'],
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
            // Which processor inference sessions belong to, and the models
            // the session lists name.
            'inference-processor',
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
    datasets: {
        describe: 'a real dataset build. Needs the corpus and the media server; CI excludes it',
        suites: ['dataset-build-real'],
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
