/**
 * A build saves its pictures for review, and leaves out a picture a reviewer flagged (#271).
 *
 * The same stubbed-extractor build as `tests/dataset-build-runner.test.js`: only the two
 * calls that reach the media server are stubbed, so the selection, the plan, the cutting,
 * the small copies and every row are real. Everything is seeded here and removed again.
 *
 * Refs MarineAppliedResearch/MARP_API#271.
 *
 * @fileoverview Integration tests for dataset pictures and flagged pictures in a build.
 * @module tests/dataset-review-build
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');
const jellyfin = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');
const buildService = require('../service/dataset-build.service');
const pictureRepository = require('../repository/dataset-picture.repository');

const fixture = require('./fixtures/dataset-build-fixture');

const { QueryTypes } = db.Sequelize;
const runId = Date.now();
const ARCHIVE_DIRECTORY = buildService.ARCHIVE_DIRECTORY;

let seeded;
let stub;
let reviewerId;
const made = { datasetIds: [], jobIds: [], archives: [], workerCreated: false };

const q = (sql, replacements = {}) => db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });

/** Queue a build of the fixture's first video and run it, insisting it was this suite's. */
async function build(name) {
    const response = await global.api.post('/api/v2/dataset/build').send({
        name: `${name} ${runId}`,
        subsets: [{ split: 'train', filters: { session: [seeded.sessionId], species: seeded.speciesIds.slice(0, 2) } }],
    });

    expect(response.status).toBe(201);
    made.datasetIds.push(response.body.dataset.id);
    made.jobIds.push(response.body.job.id);
    await db.sequelize.query('UPDATE gpu_jobs SET priority = 5000 WHERE id = :id', {
        replacements: { id: response.body.job.id },
    });

    const result = await buildService.runOne();

    expect(result.jobId).toBe(response.body.job.id);
    if (result.archive) made.archives.push(path.join(ARCHIVE_DIRECTORY, `${result.archive.sha256}.tar`));

    return response.body.dataset.id;
}

/* Video one's two animals; species B's other observation, in video two, is in the build
   too and is not what these tests are about. */
const picturesOf = (datasetId) => q(
    `SELECT observation_id, framenum, split, drawn, picture FROM dataset_pictures
      WHERE dataset_id = :datasetId AND observation_id IN (:ids) ORDER BY observation_id, framenum`,
    { datasetId, ids: [seeded.first, seeded.second] }
);

beforeAll(async () => {
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;
    seeded = await fixture.seedCorpus(runId);
    stub = fixture.stubExtraction({ jellyfin, extraction });
    [{ user_id: reviewerId }] = await q('SELECT user_id FROM users ORDER BY user_id LIMIT 1');
}, 60000);

afterAll(async () => {
    if (stub) stub.restore();

    await db.sequelize.query('DELETE FROM picture_reviews WHERE observation_id IN (:ids)', {
        replacements: { ids: seeded.observationIds },
    });

    for (const id of made.datasetIds) {
        fs.rmSync(path.join(ARCHIVE_DIRECTORY, 'pictures', String(id)), { recursive: true, force: true });
    }

    if (made.datasetIds.length) {
        for (const table of ['dataset_pictures', 'dataset_observations', 'dataset_classes']) {
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

describe('reviewing a dataset\'s pictures (#271)', () => {

    let first;

    beforeAll(async () => {
        first = await build('Jest Review Build');
    }, 120000);

    test('R8: every picture is recorded per observation, with a small copy on disk', async () => {
        const rows = await picturesOf(first);

        // `first` is frames 100-102 and `second` 101-103, both in video one: frames 101 and
        // 102 are one picture each, holding both animals, so two rows each.
        expect(rows.map((r) => [r.observation_id, r.framenum])).toEqual([
            [seeded.first, 100], [seeded.first, 101], [seeded.first, 102],
            [seeded.second, 101], [seeded.second, 102], [seeded.second, 103],
        ]);

        for (const row of rows) {
            expect(row.split).toBe('train');
            expect(row.drawn.box).toEqual(expect.objectContaining({ cx: expect.any(Number), w: expect.any(Number) }));
            expect(row.picture).toBeTruthy();
            expect(fs.existsSync(path.join(ARCHIVE_DIRECTORY, row.picture))).toBe(true);
        }
    });

    test('R4/R5: a flagged picture is left out of the next build, and the rest of its track is in it', async () => {
        await pictureRepository.recordDecisions([
            { observation_id: seeded.first, framenum: 101, decision: 'flagged', reason: 'Bounding box too loose' },
        ], reviewerId, first);

        const second = await build('Jest Review Rebuild');
        const frames = (await picturesOf(second)).map((r) => [r.observation_id, r.framenum]);

        // Frame 101 is one picture holding both animals, so it goes for both.
        expect(frames).toEqual([
            [seeded.first, 100], [seeded.first, 102],
            [seeded.second, 102], [seeded.second, 103],
        ]);
    }, 120000);

    test('R6: promoting it again puts it back', async () => {
        await pictureRepository.recordDecisions([
            { observation_id: seeded.first, framenum: 101, decision: 'promoted' },
        ], reviewerId, first);

        const third = await build('Jest Review Promoted');
        const frames = (await picturesOf(third)).map((r) => r.framenum);

        expect(frames).toContain(101);
    }, 120000);

    test('the pictures and their decisions read back together', async () => {
        const rows = await pictureRepository.picturesOf(first, [seeded.first]);

        expect(rows.map((r) => [r.framenum, r.decision])).toEqual([[100, null], [101, 'promoted'], [102, null]]);
    });
});

describe('the API a dataset is reviewed through (#271)', () => {

    let datasetId;
    const page = (filters) => global.api.post('/api/v2/mosaic/observations/pages')
        .send({ filters, pages: [1], pageSize: 45, includeTotal: true });

    beforeAll(async () => {
        datasetId = await build('Jest Review API');
    }, 120000);

    /* Here rather than at the end of the file: these decisions are the signed-in fixture
       user's, and that user is removed before the file's own cleanup runs. */
    afterAll(async () => {
        await db.sequelize.query('DELETE FROM picture_reviews WHERE observation_id IN (:ids)', {
            replacements: { ids: seeded.observationIds },
        });
    });

    test('R1/R2: pointed at a dataset, the Mosaic gives its tracks, each with its pictures', async () => {
        const response = await page({ dataset: [datasetId], session: [seeded.sessionId] });

        expect(response.status).toBe(200);

        const rows = response.body.pages[0].rows;
        const first = rows.find((r) => r.observation_id === seeded.first);

        expect(rows.every((r) => r.dataset_id === datasetId)).toBe(true);
        expect(first.pictures.map((p) => p.framenum)).toEqual([100, 101, 102]);
        expect(first.pictures[0]).toEqual(expect.objectContaining({
            split: 'train', has_picture: true, drawn: expect.objectContaining({ box: expect.any(Object) }),
        }));
        // Only the dataset's tracks: the fourth observation, species C, is not in it.
        expect(rows.map((r) => r.observation_id)).not.toContain(seeded.fourth);
    });

    test('R2: a picture is served small, by observation and frame', async () => {
        const response = await global.api.get(`/api/v2/dataset/${datasetId}/pictures/${seeded.first}/100`);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/jpeg/);

        const missing = await global.api.get(`/api/v2/dataset/${datasetId}/pictures/${seeded.first}/999`);

        expect(missing.status).toBe(404);
    });

    test('R3/R4: a flag needs a reason from the list, and is recorded on the observation', async () => {
        const refused = await global.api.post(`/api/v2/dataset/${datasetId}/pictures/review`)
            .send({ decisions: [{ observation_id: seeded.second, framenum: 103, decision: 'flagged', reason: 'needs fixing' }] });

        expect(refused.status).toBe(400);

        const recorded = await global.api.post(`/api/v2/dataset/${datasetId}/pictures/review`).send({
            decisions: [
                { observation_id: seeded.second, framenum: 103, decision: 'flagged', reason: 'Bounding box too loose' },
                { observation_id: seeded.second, framenum: 101, decision: 'promoted' },
            ],
        });

        expect(recorded.status).toBe(200);
        expect(recorded.body.recorded).toBe(2);

        const rows = (await page({ dataset: [datasetId], session: [seeded.sessionId] })).body.pages[0].rows;
        const second = rows.find((r) => r.observation_id === seeded.second);

        expect(second.pictures.map((p) => [p.framenum, p.decision, p.reason])).toEqual([
            [101, 'promoted', null], [102, null, null], [103, 'flagged', 'Bounding box too loose'],
        ]);
    });

    test('R6: flagged pictures are found again, and a track with none is not', async () => {
        const rows = (await page({ dataset: [datasetId], session: [seeded.sessionId], pictureReview: ['picture-flagged'] })).body.pages[0].rows;

        expect(rows.map((r) => r.observation_id)).toEqual([seeded.second]);
    });

    test('R6: a take-back returns a picture to undecided', async () => {
        await global.api.post(`/api/v2/dataset/${datasetId}/pictures/review`)
            .send({ decisions: [{ observation_id: seeded.second, framenum: 103, decision: 'withdrawn' }] });

        const rows = (await page({ dataset: [datasetId], session: [seeded.sessionId], pictureReview: ['picture-flagged'] })).body.pages[0].rows;

        expect(rows).toEqual([]);
    });
});
