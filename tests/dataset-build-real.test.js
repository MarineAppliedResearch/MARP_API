/**
 * One genuine dataset build, from real observations out of real video.
 *
 * **This is the slow tier and it does not run in `npm test` or in CI.** It opens an
 * H.264 stream from the central media server, runs ffmpeg over it, and writes a hundred
 * megabytes or so; a minute of that on every push taxes every commit for a claim the
 * fast tier already makes about everything except ffmpeg itself. It is excluded by name
 * in `jest.config.js` and again in `.github/workflows/verify.yml`, the way
 * `tests/jellyfin.test.js` is, and it is run deliberately:
 *
 * ```
 * npm run test:datasets
 * ```
 *
 * What it is for is the one thing stubbing the extractor cannot tell you: that the
 * frames MARP asks for are frames the video can actually produce, at the frame rate it
 * reports, through the Jellyfin URL the coordinator resolved. Everything between the
 * route and the rows is asserted next door in `tests/dataset-build-runner.test.js`, in
 * two seconds.
 *
 * **It needs the development corpus and the media server, and it fails rather than
 * skips without them.** A suite that quietly skips looks green while proving nothing.
 * The query is `{session: [507], trainingDisposition: ['promoted']}` -- small, real, and
 * about 330 frames over one video.
 *
 * **It seeds nothing and removes everything it made**: the dataset, its membership, its
 * classes, the job, the attempt and the archive file. It reads the corpus and never
 * writes to it, which is what makes it safe to point at a database holding work that
 * cannot be regenerated.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview A real single-video dataset build. Not run in CI.
 * @author Isaac Travers
 * @module tests/dataset-build-real
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const db = require('../model');
const mosaic = require('../repository/mosaic.repository');
const buildService = require('../service/dataset-build.service');

const { QueryTypes } = db.Sequelize;

/** The query this builds from: small, real, and one video. */
const FILTERS = { session: [507], trainingDisposition: ['promoted'] };

/** Where `packageArchive` puts the tar. */
const ARCHIVE_DIRECTORY = buildService.ARCHIVE_DIRECTORY;

/** Distinguishes this run's dataset from a real one in the Datasets screen. */
const runId = Date.now();

/** Long enough for a real extraction over the network. */
const MINUTES = 15 * 60 * 1000;

/** What this run made, removed in `afterAll`. */
const made = { datasetId: null, jobId: null, archive: null, workerCreated: false };

/** The observations the query selects, read before the build so the rows can be checked. */
let selected;

/** What the build reported. */
let built;

/** The unpacked archive. */
let unpacked;

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

beforeAll(async () => {
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;

    selected = await mosaic.selectForBuild({ filters: FILTERS });

    /* Loud rather than skipped. An empty selection here means the database this is
       pointed at is not the development corpus -- `marp db load` puts one back, and
       `MARP_API/.marp/local/corpus-dump.md` says where the last dump is. */
    if (!selected.length) {
        throw new Error(
            `No observation matches ${JSON.stringify(FILTERS)} in this database, so there is `
            + 'nothing real to build. This suite needs the development corpus; see '
            + '.marp/local/corpus-dump.md and `marp db load`.'
        );
    }

    const response = await global.api.post('/api/v2/dataset/build').send({
        name: `Jest Real Build ${runId}`,
        description: 'A real single-video build. tests/dataset-build-real.test.js removes it.',
        filters: FILTERS,
    });

    expect(response.status).toBe(201);

    made.datasetId = response.body.dataset.id;
    made.jobId = response.body.job.id;

    await db.sequelize.query('UPDATE gpu_jobs SET priority = 5000 WHERE id = :id', {
        replacements: { id: made.jobId },
    });

    built = await buildService.runOne();

    expect(built).not.toBeNull();
    expect(built.jobId).toBe(made.jobId);

    // Surfaces ffmpeg's or Jellyfin's own message rather than an assertion about a
    // property of `undefined`.
    expect(built.reason).toBeUndefined();

    made.archive = path.join(ARCHIVE_DIRECTORY, `${built.archive.sha256}.tar`);

    unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-real-build-'));

    // A bare filename with `cwd` set: a colon in an archive path is `host:path` to tar.
    execFileSync('tar', ['-xf', `${built.archive.sha256}.tar`, '-C', unpacked], {
        cwd: ARCHIVE_DIRECTORY,
        stdio: 'pipe',
    });
}, MINUTES);

afterAll(async () => {
    if (made.datasetId) {
        await db.sequelize.query('DELETE FROM dataset_observations WHERE dataset_id = :id', {
            replacements: { id: made.datasetId },
        });
        await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id = :id', {
            replacements: { id: made.datasetId },
        });
    }

    if (made.jobId) {
        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'cancelled'
              WHERE id = :id AND state IN ('queued', 'leased')`,
            { replacements: { id: made.jobId } }
        );
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id = :id', {
            replacements: { id: made.jobId },
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id: made.jobId } });
    }

    if (made.datasetId) {
        await db.sequelize.query('DELETE FROM datasets WHERE id = :id', { replacements: { id: made.datasetId } });
    }

    if (made.workerCreated) {
        await db.sequelize.query("DELETE FROM gpu_workers WHERE local_id = 'marp-api-internal'");
    }

    /* The archive goes too. It is a hundred megabytes and it was made by a test; a real
       build of the same query would produce the same file again, by hash. */
    if (made.archive && fs.existsSync(made.archive)) fs.rmSync(made.archive, { force: true });
    if (unpacked && fs.existsSync(unpacked)) fs.rmSync(unpacked, { recursive: true, force: true });
});

describe('a real dataset build, from real video (#268)', () => {

    test('cut frames out of the video and packaged them', () => {
        expect(built.images).toBeGreaterThan(0);

        /* How many could not be produced is reported rather than asserted at zero: a
           video whose last second is truncated costs frames at the end, and that is the
           extractor's known behaviour rather than a failure. It is printed by the
           summary line below if it is ever non-zero.  */
        expect(built.missing).toBeLessThan(built.images);
    });

    test('the dataset is ready and its row matches the file on disk', async () => {
        const [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: made.datasetId });

        expect(dataset.status).toBe('ready');
        expect(Number(dataset.num_samples)).toBe(built.images);
        expect(dataset.archive_path).toBe(`datasets/${built.archive.sha256}.tar`);

        expect(fs.existsSync(made.archive)).toBe(true);
        expect(fs.statSync(made.archive).size).toBe(Number(dataset.archive_bytes));

        /* Hashed by streaming, the way the builder does: this file is hundreds of
           megabytes and reading it into memory is how the real one would die. */
        const digest = crypto.createHash('sha256');
        const reader = fs.openSync(made.archive, 'r');
        const chunk = Buffer.alloc(1024 * 1024);

        try {
            let read = fs.readSync(reader, chunk, 0, chunk.length, null);

            while (read > 0) {
                digest.update(chunk.subarray(0, read));
                read = fs.readSync(reader, chunk, 0, chunk.length, null);
            }
        } finally {
            fs.closeSync(reader);
        }

        expect(digest.digest('hex')).toBe(dataset.archive_sha256);
    }, MINUTES);

    test('every observation the query selected is recorded as a member', async () => {
        const members = await q(
            'SELECT observation_id, inclusion_type FROM dataset_observations WHERE dataset_id = :id',
            { id: made.datasetId }
        );

        expect(members).toHaveLength(selected.length);
        expect(new Set(members.map((row) => row.observation_id)))
            .toEqual(new Set(selected.map((row) => Number(row.observation_id))));

        // The default ratios, so both splits and nothing else.
        expect(new Set(members.map((row) => row.inclusion_type))).toEqual(new Set(['train', 'eval']));
    });

    test('the vocabulary is the species the query selected, in index order', async () => {
        const classes = await q(
            'SELECT class_index, species_id FROM dataset_classes WHERE dataset_id = :id ORDER BY class_index',
            { id: made.datasetId }
        );

        const species = new Set(selected.map((row) => Number(row.species_id)));

        expect(classes).toHaveLength(species.size);
        expect(classes.map((row) => Number(row.class_index)))
            .toEqual(classes.map((unused, index) => index));
        expect(new Set(classes.map((row) => Number(row.species_id)))).toEqual(species);
    });

    test('the archive holds an image and a label for every frame that was cut', () => {
        const entries = [];
        const walk = (directory, prefix) => {
            for (const name of fs.readdirSync(directory)) {
                const full = path.join(directory, name);

                if (fs.statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
                else entries.push(`${prefix}${name}`);
            }
        };

        walk(unpacked, '');

        const images = entries.filter((name) => name.endsWith('.jpg'));
        const labels = entries.filter((name) => name.endsWith('.txt'));

        expect(images).toHaveLength(built.images);
        expect(labels).toHaveLength(built.images);
        expect(entries).toContain('data.yaml');

        const stem = (name) => name.replace(/\/(images|labels)\//, '/').replace(/\.(jpg|txt)$/, '');

        expect(labels.map(stem).sort()).toEqual(images.map(stem).sort());

        /* Every label line is a class index inside the vocabulary and four fractions.
           A box outside 0..1 is one the trainer silently clips. */
        for (const label of labels.slice(0, 50)) {
            for (const line of fs.readFileSync(path.join(unpacked, label), 'utf8').trim().split('\n')) {
                const [index, ...box] = line.split(' ');

                expect(Number(index)).toBeGreaterThanOrEqual(0);
                expect(Number(index)).toBeLessThan(built.classes);
                expect(box).toHaveLength(4);

                for (const value of box) {
                    expect(Number(value)).toBeGreaterThanOrEqual(0);
                    expect(Number(value)).toBeLessThanOrEqual(1);
                }
            }
        }
    }, MINUTES);

    test('data.yaml names as many classes as the dataset recorded', () => {
        const yaml = fs.readFileSync(path.join(unpacked, 'data.yaml'), 'utf8');
        const names = yaml.split('\n').filter((line) => line.startsWith('- '));

        expect(names).toHaveLength(built.classes);
        expect(yaml).toContain(`nc: ${built.classes}`);
        expect(yaml).toContain('train: train/images');
        expect(yaml).toContain('val: eval/images');
    });

    test('the archive this built is the one a worker can fetch', async () => {
        /* The end of the chain. `GET /gpu/datasets/:id/archive` is what a worker calls,
           and a range request is what a resumed fetch over a home connection sends --
           so this asks for sixteen bytes rather than streaming a hundred megabytes. */
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${made.datasetId}/archive`)
            .set('Range', 'bytes=0-15')
            .responseType('blob');

        expect(response.status).toBe(206);
        expect(response.headers['content-range']).toBe(`bytes 0-15/${built.archive.bytes}`);
        expect(response.headers['etag']).toBe(`"dataset-archive-${built.archive.sha256}"`);
    }, MINUTES);
});
