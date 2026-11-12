/**
 * A habitat dataset build, end to end with the extractor stubbed (#287).
 *
 * Queued through the route and run by the real runner, as `dataset-build-runner.test.js`
 * does for species: only the calls that reach the media server are stubbed, and the
 * archive is unpacked and read, because what the trainer gets is the archive.
 *
 * The stub writes textured frames, since a flat one is a blank screen, and the End Line
 * card at 30 s, so the throwing out is the real check on a real picture.
 *
 * @fileoverview Integration test for runHabitatBuild.
 * @module tests/habitat-dataset-build
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');

const db = require('../model');
const jellyfin = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');
const buildService = require('../service/dataset-build.service');
const { formatTimeSpan, deriveTc } = require('../db/timecode');
const fixture = require('./fixtures/dataset-build-fixture');
const substrates = require('./fixtures/habitat-substrates');
const REJECT = require('../db/habitat-reject-screens.json');

const { QueryTypes } = db.Sequelize;
const q = (sql, replacements = {}) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });

const runId = Date.now();
const VIDEO = `jest-habitat-build-${runId}.mp4`;
const OTHER = `jest-habitat-build-other-${runId}.mp4`;
const seeded = { substrates: null, projectId: null, sessionId: null, reviewerId: null, ids: {} };
const made = { datasetId: null, jobId: null, archive: null, workerCreated: false };
let stub;
let built;
let root;

/** A habitat stretch in one file from 0, clock start and end in seconds. */
async function stretch(name, startS, endS, video) {
    const [row] = await q(
        `INSERT INTO observations (project_id, session_id, "obsID", species_id, comname, count,
                                   tc, etc, "actualPosition", "mediaPosition", video_source, "createdAt", "updatedAt")
         VALUES (:p, :s, :obs, :species, :name, 1, :tc, :etc, :at, :at, :video, now(), now())
         RETURNING observation_id`,
        {
            p: seeded.projectId, s: seeded.sessionId, obs: Object.keys(seeded.ids).length + 1, name,
            species: seeded.substrates.byName[name], video,
            tc: deriveTc(startS * 1000), etc: deriveTc(endS * 1000), at: formatTimeSpan(startS * 1000),
        }
    );
    return row.observation_id;
}

/** Promote a stretch for training, as the Mosaic's review does. */
async function promote(observationId) {
    const [review] = await q(
        `INSERT INTO observation_reviews (observation_id, purpose, decision, reviewer_id, observation_version,
                                          decided_at, created_at, updated_at)
         VALUES (:id, 'training', 'promoted', :reviewer, (SELECT version FROM observations WHERE observation_id = :id),
                 now(), now(), now())
         RETURNING review_id`,
        { id: observationId, reviewer: seeded.reviewerId }
    );
    await db.sequelize.query(
        `INSERT INTO observation_review_current (review_id, observation_id, purpose, decision, reason,
                                                 reviewer_id, decided_at, observation_version)
         SELECT review_id, observation_id, purpose, decision, reason, reviewer_id, decided_at, observation_version
           FROM observation_reviews WHERE review_id = :id`,
        { replacements: { id: review.review_id } }
    );
}

/** A 640 x 360 JPEG: textured seabed, or the End Line card enlarged. */
async function frameJpeg(kind) {
    if (kind === 'card') {
        return sharp(Buffer.from(REJECT.screens['end line card']), { raw: { width: 32, height: 18, channels: 1 } })
            .resize(640, 360, { kernel: 'nearest' }).jpeg().toBuffer();
    }
    let seed = 11;
    const noise = Buffer.from(Array.from({ length: 64 * 36 * 3 }, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return 40 + (seed % 150);
    }));
    return sharp(noise, { raw: { width: 64, height: 36, channels: 3 } }).resize(640, 360).jpeg().toBuffer();
}

beforeAll(async () => {
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");
    made.workerCreated = !worker;

    seeded.substrates = await substrates.ensureSubstrates();
    const [reviewer] = await q(
        `INSERT INTO users (name, username, status, "createdAt", "updatedAt")
         VALUES (:name, :name, 'active', now(), now()) RETURNING user_id`,
        { name: `jest-habitat-build-${runId}` }
    );
    seeded.reviewerId = reviewer.user_id;
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, now(), now()) RETURNING project_id',
        { name: `Jest Habitat Build ${runId}` }
    );
    seeded.projectId = project.project_id;
    const [session] = await q(
        `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:p, 'HD1', 'L1', :line, 'Habitat', now(), now()) RETURNING session_id`,
        { p: seeded.projectId, line: `LID-HB-${runId}` }
    );
    seeded.sessionId = session.session_id;

    /* Mud throughout, Boulder over part of it, both promoted; Rock later in another file,
       not promoted. Later: a stretch is on the session's clock, so one over the same
       moments in another file would be over these frames too. */
    seeded.ids.mud = await stretch('Mud', 0, 45, VIDEO);
    seeded.ids.boulder = await stretch('Boulder', 15, 35, VIDEO);
    seeded.ids.rock = await stretch('Rock', 100, 125, OTHER);
    await promote(seeded.ids.mud);
    await promote(seeded.ids.boulder);

    stub = fixture.stubExtraction({ jellyfin, extraction });
    const seabed = await frameJpeg('seabed');
    const card = await frameJpeg('card');
    extraction.extractFrames.mockImplementation(async (url, frames, fps, destination) => {
        stub.calls.extractions.push({ url, frames: [...frames], fps });
        frames.forEach((frame, i) => {
            const file = path.join(destination, `frame-${String(i + 1).padStart(4, '0')}.jpg`);
            fs.writeFileSync(file, Math.round((frame / fps) * 1000) === 30000 ? card : seabed);
        });
        return { files: [], ptsTimes: frames.map((f) => f / fps), seconds: 0.01 };
    });

    const response = await global.api.post('/api/v2/dataset/build')
        .send({ name: `Jest Habitat Build ${runId}`, task: 'habitat', filters: { session: [seeded.sessionId] } });
    expect(response.status).toBe(201);
    made.datasetId = response.body.dataset.id;
    made.jobId = response.body.job.id;
    await db.sequelize.query('UPDATE gpu_jobs SET priority = 5000 WHERE id = :id', { replacements: { id: made.jobId } });

    built = await buildService.runOne();
    expect(built.jobId).toBe(made.jobId);
    expect(built.reason).toBeUndefined();
    made.archive = path.join(buildService.ARCHIVE_DIRECTORY, `${built.archive.sha256}.tar`);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-habitat-unpack-'));
    execFileSync('tar', ['-xf', `${built.archive.sha256}.tar`, '-C', root], { cwd: buildService.ARCHIVE_DIRECTORY, stdio: 'pipe' });
}, 120000);

describe('a habitat dataset build (#287)', () => {
    // Inside the describe, so it runs before the shared setup's own cleanup.
    afterAll(async () => {
        if (stub) stub.restore();
        if (root) fs.rmSync(root, { recursive: true, force: true });
        if (made.archive && fs.existsSync(made.archive)) fs.rmSync(made.archive, { force: true });
        const ids = Object.values(seeded.ids);
        const byDataset = { replacements: { id: made.datasetId } };
        if (made.datasetId) {
            await db.sequelize.query('DELETE FROM dataset_observations WHERE dataset_id = :id', byDataset);
            await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id = :id', byDataset);
            await db.sequelize.query('DELETE FROM dataset_split_species WHERE dataset_id = :id', byDataset);
            await db.sequelize.query('DELETE FROM dataset_splits WHERE dataset_id = :id', byDataset);
        }
        if (made.jobId) {
            await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id = :id', { replacements: { id: made.jobId } });
            await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id: made.jobId } });
        }
        if (made.datasetId) await db.sequelize.query('DELETE FROM datasets WHERE id = :id', byDataset);
        if (made.workerCreated) await db.sequelize.query("DELETE FROM gpu_workers WHERE local_id = 'marp-api-internal'");
        if (ids.length) {
            await db.sequelize.query('DELETE FROM observation_review_current WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_reviews WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids } });
        }
        if (seeded.sessionId) await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', { replacements: { id: seeded.sessionId } });
        if (seeded.projectId) await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
        if (seeded.reviewerId) await db.sequelize.query('DELETE FROM users WHERE user_id = :id', { replacements: { id: seeded.reviewerId } });
        await substrates.removeSubstrates(seeded.substrates);
    });

    test('frames every 10 s from the promoted video only, cut in one pass', () => {
        expect(stub.calls.extractions.map((c) => c.url)).toEqual([`http://jest.invalid/stream/jest-item-${VIDEO}`]);
        expect(stub.calls.extractions[0].frames).toEqual([10, 20, 30, 40].map((s) => s * fixture.FPS));
    });

    test('the archive is what the habitat trainer reads, labelled by what is over each frame', () => {
        expect(JSON.parse(fs.readFileSync(path.join(root, 'classes.json'), 'utf8'))).toEqual(['Mud', 'Boulder']);
        const lines = fs.readFileSync(path.join(root, 'train', 'labels.csv'), 'utf8').trim().split('\n');
        const stem = (s) => `images/${seeded.sessionId}_${path.parse(VIDEO).name}_${String(s * fixture.FPS).padStart(8, '0')}.jpg`;
        expect(lines).toEqual(['image,Mud,Boulder', `${stem(10)},1,0`, `${stem(20)},1,1`, `${stem(40)},1,0`]);
        for (const line of lines.slice(1)) expect(fs.existsSync(path.join(root, 'train', line.split(',')[0]))).toBe(true);
    });

    test('the End Line card is thrown out and listed with its reason', () => {
        const report = JSON.parse(fs.readFileSync(path.join(root, 'habitat-report.json'), 'utf8'));
        expect(report.rejected).toEqual([{ session_id: seeded.sessionId, video: VIDEO, position_ms: 30000, reason: 'end line card' }]);
        expect(report.frames).toBe(3);
        expect(built.rejected).toBe(1);
    });

    test('the dataset is a habitat dataset of Habitat substrates, its stretches its members', async () => {
        const [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: made.datasetId });
        expect(dataset.status).toBe('ready');
        expect(dataset.task).toBe('habitat');
        expect(Number(dataset.num_samples)).toBe(3);
        expect(Number(dataset.num_classes)).toBe(2);

        const classes = await q('SELECT species_id, class_index FROM dataset_classes WHERE dataset_id = :id ORDER BY class_index', { id: made.datasetId });
        expect(classes.map((c) => Number(c.species_id))).toEqual([seeded.substrates.byName.Mud, seeded.substrates.byName.Boulder]);

        const members = await q('SELECT observation_id, inclusion_type FROM dataset_observations WHERE dataset_id = :id ORDER BY observation_id', { id: made.datasetId });
        expect(members).toEqual([
            { observation_id: seeded.ids.mud, inclusion_type: 'train' },
            { observation_id: seeded.ids.boulder, inclusion_type: 'train' },
        ]);
    });
});
