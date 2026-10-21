/**
 * Tests for a dataset build that was cancelled, retried, or failed.
 *
 * R8: *a failed or cancelled build leaves nothing half-served*. By the time one stops it
 * may have written gigabytes, and the three things that can go wrong are all invisible
 * from the screen that queued it -- a dataset still saying `building`, a row naming an
 * archive that is not there, and a partial tar nobody removes. Cancel and retry were
 * both written and **neither had ever run** when these were written; this file is the
 * first thing that executes either.
 *
 * The extractor is stubbed, as in `tests/dataset-build-runner.test.js`, and everything
 * else is real -- including the `gpu_jobs` state machine the cancellation is read from,
 * which is the whole mechanism: `isCancelled` asks the database between videos, so a
 * test that mocked it would be asserting against its own stub.
 *
 * **Cancelling between videos is the behaviour, not a detail.** The thing being
 * interrupted is an ffmpeg pass; stopping mid-pass leaves a half-written frame to clean
 * up and saves seconds. So these assert that the second video was never opened, which is
 * the only way to tell a build that stopped from one that finished and threw the result
 * away.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Integration tests for cancel, retry and failure of a dataset build.
 * @author Isaac Travers
 * @module tests/dataset-build-lifecycle
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');
const jellyfin = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');
const buildService = require('../service/dataset-build.service');

const fixture = require('./fixtures/dataset-build-fixture');

const { QueryTypes } = db.Sequelize;

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Where `packageArchive` puts the tar. */
const ARCHIVE_DIRECTORY = buildService.ARCHIVE_DIRECTORY;

/** The corpus, from the shared fixture. */
let seeded;

/** Datasets, jobs and archive files created here, removed in `afterAll`. */
const made = { datasetIds: [], jobIds: [], archives: [], workerCreated: false };

/**
 * Runs one statement and returns its rows.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Named replacements.
 * @returns {Promise<Array<Object>>} The rows.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Queue a build through the route and put it at the head of the queue.
 *
 * @async
 * @param {Object} body - The request body.
 * @returns {Promise<Object>} `{dataset, job}`.
 */
async function queueBuild(body) {
    const response = await global.api.post('/api/v2/dataset/build').send(body);

    expect(response.status).toBe(201);

    made.datasetIds.push(response.body.dataset.id);
    made.jobIds.push(response.body.job.id);

    await db.sequelize.query('UPDATE gpu_jobs SET priority = 5000 WHERE id = :id', {
        replacements: { id: response.body.job.id },
    });

    return response.body;
}

/**
 * Run the one queued build, and insist it was this suite's.
 *
 * @async
 * @param {number} jobId - The job that must have been claimed.
 * @returns {Promise<Object>} What `runOne` reported.
 */
async function runBuild(jobId) {
    const result = await buildService.runOne();

    expect(result).not.toBeNull();
    expect(result.jobId).toBe(jobId);

    if (result.archive) made.archives.push(path.join(ARCHIVE_DIRECTORY, `${result.archive.sha256}.tar`));

    return result;
}

/** Every tar in the dataset directory right now. @returns {string[]} The filenames. */
const archivesOnDisk = () => fs.existsSync(ARCHIVE_DIRECTORY)
    ? fs.readdirSync(ARCHIVE_DIRECTORY).sort()
    : [];

/** A build over everything this suite seeded, in one split. */
const everything = () => ({ session: [seeded.sessionId] });

beforeAll(async () => {
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;

    seeded = await fixture.seedCorpus(runId);
}, 60000);

afterAll(async () => {
    if (made.datasetIds.length) {
        await db.sequelize.query('DELETE FROM dataset_observations WHERE dataset_id IN (:ids)', {
            replacements: { ids: made.datasetIds },
        });
        await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id IN (:ids)', {
            replacements: { ids: made.datasetIds },
        });
    }

    if (made.jobIds.length) {
        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'cancelled'
              WHERE id IN (:ids) AND state IN ('queued', 'leased')`,
            { replacements: { ids: made.jobIds } }
        );
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', {
            replacements: { ids: made.jobIds },
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: made.jobIds },
        });
    }

    if (made.datasetIds.length) {
        await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', {
            replacements: { ids: made.datasetIds },
        });
    }

    if (made.workerCreated) {
        await db.sequelize.query("DELETE FROM gpu_workers WHERE local_id = 'marp-api-internal'");
    }

    for (const archive of made.archives) {
        if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
    }

    await fixture.removeCorpus(seeded);
});

describe('a build that is cancelled while it runs (#268 R8)', () => {

    /** This group's stub, restored afterwards so the next group gets a clean one. */
    let stub;

    afterAll(() => {
        if (stub) stub.restore();
    });

    test('stops between videos, returns the dataset to draft, and leaves nothing staged', async () => {
        const queued = await queueBuild({ name: `Jest Build Cancelled ${runId}`, filters: everything() });

        const stagedBefore = new Set(fixture.stagingDirectories());
        const archivesBefore = archivesOnDisk();

        /* Cancelled the way a person cancels it: the job's state in the database, which
           is where `isCancelled` looks. Done from inside the first extraction so the
           cancellation genuinely arrives mid-build rather than before it started. */
        stub = fixture.stubExtraction({ jellyfin, extraction }, {
            onExtract: async (nth) => {
                if (nth !== 1) return;

                await db.sequelize.query(
                    "UPDATE gpu_jobs SET state = 'cancelled', updated_at = NOW() WHERE id = :id",
                    { replacements: { id: queued.job.id } }
                );
            },
        });

        const result = await runBuild(queued.job.id);

        expect(result.cancelled).toBe(true);

        /* Three videos were planned and one was cut. A build that checked only at the
           end would have opened all three, which on a real corpus is the difference
           between stopping now and stopping in an hour. */
        expect(stub.calls.extractions).toHaveLength(1);

        const [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: queued.dataset.id });

        /* `draft`, not `failed`: nothing went wrong, somebody changed their mind, and
           the row is one they can queue again. */
        expect(dataset.status).toBe('draft');
        expect(dataset.archive_path).toBeNull();
        expect(dataset.archive_sha256).toBeNull();
        expect(dataset.archive_bytes).toBeNull();

        const [attempt] = await q(
            'SELECT state, failure_reason, finished_at FROM gpu_job_attempts WHERE job_id = :id',
            { id: queued.job.id }
        );

        expect(attempt.state).toBe('cancelled');
        expect(attempt.failure_reason).toBe('Cancelled while extracting.');
        expect(attempt.finished_at).not.toBeNull();

        const [job] = await q('SELECT state FROM gpu_jobs WHERE id = :id', { id: queued.job.id });

        // The job was already cancelled -- that is how the run found out -- and a
        // failure must not overwrite it with `failed`.
        expect(job.state).toBe('cancelled');

        // Nothing recorded, because nothing was built.
        const [members] = await q(
            'SELECT count(*)::int AS n FROM dataset_observations WHERE dataset_id = :id',
            { id: queued.dataset.id }
        );

        expect(members.n).toBe(0);

        // And the frames it had already cut are gone, along with any partial archive.
        expect(fixture.stagingDirectories().filter((name) => !stagedBefore.has(name))).toEqual([]);
        expect(archivesOnDisk()).toEqual(archivesBefore);
    }, 120000);
});

describe('a build that fails (#268 R8)', () => {

    /** This group's stub. */
    let stub;

    afterAll(() => {
        if (stub) stub.restore();
    });

    test('ends failed, with no archive columns set and no partial file behind', async () => {
        const queued = await queueBuild({ name: `Jest Build Failed ${runId}`, filters: everything() });

        const stagedBefore = new Set(fixture.stagingDirectories());
        const archivesBefore = archivesOnDisk();

        stub = fixture.stubExtraction({ jellyfin, extraction }, {
            onExtract: async () => {
                throw new Error('ffmpeg exited 1: jest made it so');
            },
        });

        const result = await runBuild(queued.job.id);

        expect(result.failed).toBe(true);
        expect(result.reason).toContain('jest made it so');

        const [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: queued.dataset.id });

        expect(dataset.status).toBe('failed');
        expect(dataset.archive_path).toBeNull();
        expect(dataset.archive_sha256).toBeNull();
        expect(dataset.archive_bytes).toBeNull();

        const [job] = await q('SELECT state, finished_at FROM gpu_jobs WHERE id = :id', { id: queued.job.id });

        expect(job.state).toBe('failed');
        expect(job.finished_at).not.toBeNull();

        const [attempt] = await q(
            'SELECT state, failure_reason FROM gpu_job_attempts WHERE job_id = :id',
            { id: queued.job.id }
        );

        expect(attempt.state).toBe('failed');
        expect(attempt.failure_reason).toContain('jest made it so');

        /* The two that would be invisible from the screen: a `building-*.tar` nobody
           removes, and gigabytes of frames staged in the temp directory. */
        expect(archivesOnDisk()).toEqual(archivesBefore);
        expect(fixture.stagingDirectories().filter((name) => !stagedBefore.has(name))).toEqual([]);
    }, 120000);

    test('filters that match nothing fail the build rather than producing an empty dataset', async () => {
        /* A session nobody has. An empty archive would be worse than a failure: it
           packages, it is `ready`, and the first thing to notice is a training run that
           learns nothing. */
        const queued = await queueBuild({
            name: `Jest Build Nothing ${runId}`,
            filters: { session: [987654321] },
        });

        const result = await runBuild(queued.job.id);

        expect(result.failed).toBe(true);
        expect(result.reason).toContain('match no promoted observation');

        const [dataset] = await q('SELECT status FROM datasets WHERE id = :id', { id: queued.dataset.id });

        expect(dataset.status).toBe('failed');
    }, 60000);

    test('an image format nobody builds in fails before a single frame is cut', async () => {
        const queued = await queueBuild({
            name: `Jest Build Webp ${runId}`,
            filters: everything(),
            image: { format: 'webp' },
        });

        const counting = fixture.stubExtraction({ jellyfin, extraction });

        try {
            const result = await runBuild(queued.job.id);

            expect(result.failed).toBe(true);
            expect(result.reason).toContain('webp');

            /* The point of settling the format before anything is cut: a bad format
               costs a second rather than an hour of extraction. */
            expect(counting.calls.extractions).toHaveLength(0);

            const [dataset] = await q('SELECT status FROM datasets WHERE id = :id', { id: queued.dataset.id });

            expect(dataset.status).toBe('failed');
        } finally {
            counting.restore();
        }
    }, 60000);
});

describe('a build that is retried (#268)', () => {

    /** This group's stub. */
    let stub;

    afterAll(() => {
        if (stub) stub.restore();
    });

    test('a second attempt replaces the first attempt\'s rows rather than doubling them', async () => {
        stub = fixture.stubExtraction({ jellyfin, extraction });

        const queued = await queueBuild({
            name: `Jest Build Retried ${runId}`,
            filters: everything(),
            splits: { train: 1 },
        });

        const first = await runBuild(queued.job.id);

        expect(first.reason).toBeUndefined();

        const counted = async () => {
            const [members] = await q(
                'SELECT count(*)::int AS n FROM dataset_observations WHERE dataset_id = :id',
                { id: queued.dataset.id }
            );
            const [classes] = await q(
                'SELECT count(*)::int AS n FROM dataset_classes WHERE dataset_id = :id',
                { id: queued.dataset.id }
            );

            return { members: members.n, classes: classes.n };
        };

        expect(await counted()).toEqual({ members: 4, classes: 3 });

        /* Requeued the way a retry requeues it: the job goes back to `queued` with its
           attempt already spent. `max_attempts` is 3, so a second claim is allowed. */
        await db.sequelize.query(
            "UPDATE gpu_jobs SET state = 'queued', finished_at = NULL, updated_at = NOW() WHERE id = :id",
            { replacements: { id: queued.job.id } }
        );

        const second = await runBuild(queued.job.id);

        expect(second.reason).toBeUndefined();

        // The whole claim: replaced, not doubled. Eight members here would mean every
        // observation counted twice in a dataset that says it has four.
        expect(await counted()).toEqual({ members: 4, classes: 3 });

        const [job] = await q('SELECT state, attempts_made FROM gpu_jobs WHERE id = :id', { id: queued.job.id });

        expect(job.state).toBe('succeeded');
        expect(Number(job.attempts_made)).toBe(2);

        const attempts = await q(
            'SELECT state, lease_epoch FROM gpu_job_attempts WHERE job_id = :id ORDER BY lease_epoch',
            { id: queued.job.id }
        );

        // Two attempts, both recorded. A retry that reused the first attempt would lose
        // the history the Jobs screen draws.
        expect(attempts.map((row) => Number(row.lease_epoch))).toEqual([1, 2]);
        expect(attempts.map((row) => row.state)).toEqual(['succeeded', 'succeeded']);

        /* **The dataset names the archive the second attempt produced**, which is the
           part that has to be true: a row pointing at the first attempt's file after a
           retry is a dataset served from a build nobody can account for.

           What it does *not* assert is that the two attempts produced the same file.
           `packageArchive` says content addressing means "building the same dataset
           twice is the same file and a rebuild is not a way to accumulate copies", and
           that is **not what happens**: a tar records each entry's modification time,
           the frames are written afresh on every attempt, and the digest moves with
           them. Written this way the two builds land in the same second about half the
           time, so asserting equality is a coin toss -- it failed on the second run of
           this suite with two different hashes, which is how it was noticed. Recorded
           rather than asserted either way, because making a build reproducible is a
           change to the builder and not to this test. */
        const [dataset] = await q('SELECT status, archive_sha256 FROM datasets WHERE id = :id', {
            id: queued.dataset.id,
        });

        expect(dataset.status).toBe('ready');
        expect(dataset.archive_sha256).toBe(second.archive.sha256);

        // Whichever it was, every file either attempt produced is on disk and servable.
        for (const sha of new Set([first.archive.sha256, second.archive.sha256])) {
            expect(fs.existsSync(path.join(ARCHIVE_DIRECTORY, `${sha}.tar`))).toBe(true);
        }
    }, 180000);
});
