/**
 * A sampled dataset build cuts what its estimate said, and records how it sampled.
 *
 * Dataset 391 cut every frame of every track -- 155,258 images of 1,683 animals -- and an
 * epoch on it took 1 h 40 min. #296 takes N frames per object instead, spread across the
 * track and seeded. The planner's rules are tested in milliseconds in
 * `tests/dataset-build-plan.test.js`; this is the route, the runner and the estimate
 * together, with only the two media-server calls stubbed, so the number shown on the
 * build flow is checked against the frames the build actually asked the extractor for.
 *
 * Refs MarineAppliedResearch/MARP_API#296.
 *
 * @fileoverview Integration tests for frames per object and the build estimate.
 * @author Isaac Travers
 * @module tests/dataset-build-sampling
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

/** The corpus, from the shared fixture, plus this file's own session. */
let seeded;

/** This file's session: two overlapping long tracks in one video, one in another. */
let sessionId;

/** Datasets, jobs and archives created here, removed in `afterAll`. */
const made = { datasetIds: [], jobIds: [], archives: [], workerCreated: false };

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

beforeAll(async () => {
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;

    seeded = await fixture.seedCorpus(runId);
    sessionId = await fixture.addSession(seeded, 'S');

    const [speciesA, speciesB] = seeded.speciesIds;
    const video = `jest-sampling-${runId}.mp4`;
    const other = `jest-sampling-other-${runId}.mp4`;

    /* 300 frames and 300 frames, overlapping by 200, so each one's picks land inside the
       other's track and those frames must carry both boxes. */
    const a = await fixture.addObservation(seeded, { obsID: 11, speciesId: speciesA, video, sessionId });
    await fixture.addKeyframes(seeded, a, [100, 399]);

    const b = await fixture.addObservation(seeded, { obsID: 12, speciesId: speciesB, video, sessionId });
    await fixture.addKeyframes(seeded, b, [200, 499]);

    const c = await fixture.addObservation(seeded, { obsID: 13, speciesId: speciesA, video: other, sessionId });
    await fixture.addKeyframes(seeded, c, [100, 399]);
}, 60000);

afterAll(async () => {
    if (made.datasetIds.length) {
        for (const table of ['dataset_observations', 'dataset_classes', 'dataset_splits', 'dataset_split_species']) {
            await db.sequelize.query(`DELETE FROM ${table} WHERE dataset_id IN (:ids)`, {
                replacements: { ids: made.datasetIds },
            });
        }
    }

    if (made.jobIds.length) {
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', { replacements: { ids: made.jobIds } });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', { replacements: { ids: made.jobIds } });
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

describe('a build at N frames per object (#296)', () => {

    const body = () => ({
        name: `Jest Sampling ${runId}`,
        filters: { session: [sessionId] },
        splits: { train: 1 },
        sampling: { frames_per_object: 5, balance_classes: false, seed: 11 },
    });

    let estimate;
    let built;
    let stub;

    beforeAll(async () => {
        const answer = await global.api.post('/api/v2/dataset/build/estimate').send(body());

        expect(answer.status).toBe(200);
        estimate = answer.body;

        stub = fixture.stubExtraction({ jellyfin, extraction });

        const queued = await queueBuild(body());

        built = await buildService.runOne();
        built.datasetId = queued.dataset.id;

        expect(built.reason).toBeUndefined();
        expect(built.jobId).toBe(queued.job.id);

        made.archives.push(path.join(buildService.ARCHIVE_DIRECTORY, `${built.archive.sha256}.tar`));
    }, 120000);

    afterAll(() => {
        if (stub) stub.restore();
    });

    test('the estimate is what the build cut', async () => {
        const asked = stub.calls.extractions.reduce((sum, call) => sum + call.frames.length, 0);

        expect(estimate.observations).toBe(3);
        expect(estimate.images).toBe(asked);
        expect(built.images).toBe(estimate.images);

        const [dataset] = await q('SELECT num_samples FROM datasets WHERE id = :id', { id: built.datasetId });

        // R7: the dataset counts what was cut, not the 900 frames available.
        expect(Number(dataset.num_samples)).toBe(estimate.images);
    });

    test('at most five frames per object, far fewer than every frame', () => {
        // Five each, and the two that share a video share none of their picks by design,
        // so at most fifteen.
        expect(estimate.images).toBeLessThanOrEqual(15);
        expect(estimate.images).toBeGreaterThanOrEqual(5);
        expect(estimate.every_frame).toBe(400 + 300);
    });

    test('a frame picked for one object carries the box of the other one in it', () => {
        // Frames 200..399 hold both tracks. Each class's images count every frame it is in.
        const both = estimate.per_class.reduce((sum, entry) => sum + entry.images, 0) - estimate.images;
        const shared = stub.calls.extractions.flatMap((call) => call.frames).filter((frame) => frame >= 200 && frame <= 399);

        expect(both).toBeGreaterThan(0);
        expect(both).toBeLessThanOrEqual(shared.length);
    });

    test('the spec records the sampling, and Duplicate setup carries it', async () => {
        const setup = await global.api.get(`/api/v2/dataset/${built.datasetId}/build-setup`);

        expect(setup.status).toBe(200);
        expect(setup.body.sampling).toEqual({ frames_per_object: 5, balance_classes: false, seed: 11 });
    });
});

describe('the build route and the sampling it is given (#296)', () => {

    test('a seed is chosen and recorded when none is given', async () => {
        const queued = await queueBuild({
            name: `Jest Sampling Seed ${runId}`,
            filters: { session: [sessionId] },
            sampling: { frames_per_object: 10 },
        });

        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :id", { replacements: { id: queued.job.id } });

        const [job] = await q('SELECT spec FROM gpu_jobs WHERE id = :id', { id: queued.job.id });

        expect(job.spec.sampling.frames_per_object).toBe(10);
        expect(Number.isInteger(job.spec.sampling.seed)).toBe(true);
    });

    test('no sampling is every frame, as every build before it', async () => {
        const queued = await queueBuild({ name: `Jest Sampling Every ${runId}`, filters: { session: [sessionId] } });

        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :id", { replacements: { id: queued.job.id } });

        const [job] = await q('SELECT spec FROM gpu_jobs WHERE id = :id', { id: queued.job.id });

        expect(job.spec.sampling).toBeNull();
    });

    test('a bad setting is a 400 on the request, not a failed build later', async () => {
        const response = await global.api.post('/api/v2/dataset/build').send({
            name: `Jest Sampling Bad ${runId}`,
            filters: { session: [sessionId] },
            sampling: { frames_per_object: 0 },
        });

        expect(response.status).toBe(400);
        expect(response.body.message || JSON.stringify(response.body)).toMatch(/1 or more/);

        const estimate = await global.api.post('/api/v2/dataset/build/estimate').send({
            filters: { session: [sessionId] },
            sampling: { frames_per_object: 2.5 },
        });

        expect(estimate.status).toBe(400);
    });

    test('balancing evens the classes out in the estimate', async () => {
        // Two A tracks against one B track: B takes ten frames from its one track to match.
        const answer = await global.api.post('/api/v2/dataset/build/estimate').send({
            filters: { session: [sessionId] },
            splits: { train: 1 },
            sampling: { frames_per_object: 5, balance_classes: true, seed: 3 },
        });

        expect(answer.status).toBe(200);

        expect(answer.body.per_class).toHaveLength(2);
        // Every class reaches at least the largest class's own picks (2 objects x 5).
        for (const entry of answer.body.per_class) expect(entry.images).toBeGreaterThanOrEqual(10);
    });
});
