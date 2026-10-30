/**
 * A dataset build interrupted by an API restart carries on from where it got to.
 *
 * #292. Build 21924 (WP - FE - CUC) was killed by a routine restart at video 154 of 298.
 * It sat looking alive for up to an hour, because its lease ran an hour ahead; then it
 * started again from the first frame in a new temp directory, leaving 9.8 GB of cut
 * frames behind; and the restart cost it one of its three attempts.
 *
 * Here: a build stopped part-way by a shutdown is handed back without spending an
 * attempt, keeps its staging, and resumes by cutting only what it had not -- ending with
 * the same images and members as a build never interrupted. An abandoned build is
 * reclaimed on a lease of minutes, and gets its attempt back.
 *
 * Only the media server is stubbed, as in `dataset-build-runner`.
 *
 * @fileoverview Integration tests for resuming an interrupted dataset build.
 * @author Isaac Travers
 * @module tests/dataset-build-resume
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');
const jellyfin = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');
const buildService = require('../service/dataset-build.service');
const buildRepository = require('../repository/dataset-build.repository');

const fixture = require('./fixtures/dataset-build-fixture');

const { QueryTypes } = db.Sequelize;

const runId = Date.now();

let seeded;

const made = { datasetIds: [], jobIds: [], archives: [], workerCreated: false };

function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

async function queueBuild(name) {
    const response = await global.api.post('/api/v2/dataset/build').send({
        name: `${name} ${runId}`,
        filters: { session: [seeded.sessionId] },
        splits: { train: 1 },
    });

    expect(response.status).toBe(201);

    made.datasetIds.push(response.body.dataset.id);
    made.jobIds.push(response.body.job.id);

    await db.sequelize.query('UPDATE gpu_jobs SET priority = 5000 WHERE id = :id', {
        replacements: { id: response.body.job.id },
    });

    return response.body;
}

/** Every file in a directory tree, relative to it, sorted. */
function filesIn(root) {
    const found = [];
    const walk = (directory, prefix) => {
        for (const name of fs.readdirSync(directory)) {
            const full = path.join(directory, name);

            if (fs.statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
            else found.push(`${prefix}${name}`);
        }
    };

    if (fs.existsSync(root)) walk(root, '');

    return found.sort();
}

beforeAll(async () => {
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;
    seeded = await fixture.seedCorpus(runId);
}, 60000);

afterAll(async () => {
    buildService.setStopping(false);

    if (made.datasetIds.length) {
        for (const table of ['dataset_observations', 'dataset_classes', 'dataset_splits', 'dataset_split_species']) {
            await db.sequelize.query(`DELETE FROM ${table} WHERE dataset_id IN (:ids)`, { replacements: { ids: made.datasetIds } });
        }
    }

    if (made.jobIds.length) {
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', { replacements: { ids: made.jobIds } });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', { replacements: { ids: made.jobIds } });
        for (const id of made.jobIds) fs.rmSync(buildService.stagingFor(id), { recursive: true, force: true });
    }

    if (made.datasetIds.length) {
        await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', { replacements: { ids: made.datasetIds } });
    }

    if (made.workerCreated) {
        await db.sequelize.query("DELETE FROM gpu_workers WHERE local_id = 'marp-api-internal'");
    }

    for (const archive of made.archives) {
        if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
    }

    await fixture.removeCorpus(seeded);
});

describe('a build stopped part-way by a shutdown (#292)', () => {
    let reference;
    let stub;

    beforeAll(async () => {
        /* The same selection, never interrupted: what the resumed build must equal. */
        stub = fixture.stubExtraction({ jellyfin, extraction });

        const queued = await queueBuild('Jest Resume Reference');
        const result = await buildService.runOne();

        expect(result.jobId).toBe(queued.job.id);
        made.archives.push(path.join(buildService.ARCHIVE_DIRECTORY, `${result.archive.sha256}.tar`));

        const [dataset] = await q('SELECT num_samples, num_observations FROM datasets WHERE id = :id', { id: queued.dataset.id });

        reference = { images: Number(dataset.num_samples), observations: Number(dataset.num_observations), sha256: result.archive.sha256 };
        stub.restore();
    }, 120000);

    test('is handed back without spending an attempt, keeps its staging, and resumes where it stopped', async () => {
        /* Stop during the second video's pass, as a Ctrl+C would. */
        stub = fixture.stubExtraction({ jellyfin, extraction }, {
            onExtract: async (call) => { if (call === 2) buildService.setStopping(true); },
        });

        const queued = await queueBuild('Jest Resume Interrupted');
        const first = await buildService.runOne();

        expect(first).toMatchObject({ released: true, jobId: queued.job.id });

        const [job] = await q('SELECT state, attempts_made FROM gpu_jobs WHERE id = :id', { id: queued.job.id });

        expect(job).toEqual({ state: 'queued', attempts_made: 0 });

        const staged = filesIn(buildService.stagingFor(queued.job.id));

        expect(staged.length).toBeGreaterThan(0);

        const firstCalls = stub.calls.extractions.length;

        expect(firstCalls).toBe(2);

        /* The API is back. */
        buildService.setStopping(false);

        const second = await buildService.runOne();

        expect(second.jobId).toBe(queued.job.id);
        made.archives.push(path.join(buildService.ARCHIVE_DIRECTORY, `${second.archive.sha256}.tar`));

        /* Only the video it had not reached was cut again. */
        expect(stub.calls.extractions.length - firstCalls).toBe(1);

        const [dataset] = await q('SELECT status, num_samples, num_observations FROM datasets WHERE id = :id', { id: queued.dataset.id });

        expect(dataset.status).toBe('ready');
        expect({ images: Number(dataset.num_samples), observations: Number(dataset.num_observations) })
            .toEqual({ images: reference.images, observations: reference.observations });
        expect(second.archive.sha256).toBe(reference.sha256);

        /* Built, so its staging is gone. */
        expect(fs.existsSync(buildService.stagingFor(queued.job.id))).toBe(false);

        stub.restore();
    }, 120000);
});

describe('a build whose API died (#292)', () => {
    test('is reclaimed once its short lease lapses, and gets its attempt back', async () => {
        expect(buildRepository.BUILD_LEASE_SECONDS).toBeLessThanOrEqual(180);

        const queued = await queueBuild('Jest Resume Abandoned');
        const claimed = await buildRepository.claimBuild();

        expect(claimed.job.id).toBe(queued.job.id);

        const [lease] = await q(
            'SELECT EXTRACT(EPOCH FROM (lease_expires_at - NOW()))::int AS seconds FROM gpu_job_attempts WHERE id = :id',
            { id: claimed.attempt.id }
        );

        expect(lease.seconds).toBeLessThanOrEqual(buildRepository.BUILD_LEASE_SECONDS);

        /* The process dies: nothing renews the lease. */
        await db.sequelize.query("UPDATE gpu_job_attempts SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = :id",
            { replacements: { id: claimed.attempt.id } });

        await buildRepository.reclaimAbandonedBuilds();

        const [job] = await q('SELECT state, attempts_made FROM gpu_jobs WHERE id = :id', { id: queued.job.id });
        const [attempt] = await q('SELECT state FROM gpu_job_attempts WHERE id = :id', { id: claimed.attempt.id });

        expect(job).toEqual({ state: 'queued', attempts_made: 0 });
        expect(attempt.state).toBe('abandoned');

        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :id", { replacements: { id: queued.job.id } });
    });
});
