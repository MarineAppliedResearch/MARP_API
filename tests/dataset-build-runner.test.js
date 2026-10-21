/**
 * Tests for what a finished dataset build actually produced.
 *
 * The planner is tested in milliseconds next door (`tests/dataset-build-plan.test.js`)
 * and this is the other half: the run that takes a claimed job, cuts the frames, writes
 * the labels, packages the tar and records the membership. **Only the two calls that
 * reach the media server are stubbed** -- `probeStream` and `extractFrames` -- so the
 * selection query, the split, the JPEG re-encode, `tar`, the SHA-256 and every row
 * written are the real ones. A real build opens an H.264 stream over the network and
 * takes minutes; `tests/dataset-build-real.test.js` is that build, and it is not run
 * here or in CI.
 *
 * **The archive is opened and read, not trusted.** Both real defects found in this code
 * so far were found by running it rather than by a test, and both were invisible from
 * the rows: `tar -cf C:\...` read as a remote host called `C`, and subsets sent to
 * Validation or Test being cut, recorded as members and then left out of the tar. A
 * dataset whose own archive does not hold the observations it claims is the exact
 * failure #268 exists to end, and the only tier that can see it is one that unpacks the
 * file.
 *
 * Everything is seeded by this file and removed again. See
 * `tests/fixtures/dataset-build-fixture.js` for the corpus's shape and why each row is
 * that shape.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Integration tests for the dataset build runner, extraction stubbed.
 * @author Isaac Travers
 * @module tests/dataset-build-runner
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const db = require('../model');
const jellyfin = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');
const buildService = require('../service/dataset-build.service');

const fixture = require('./fixtures/dataset-build-fixture');

const { QueryTypes } = db.Sequelize;

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Where `packageArchive` puts the tar, and where this suite reads it back from. */
const ARCHIVE_DIRECTORY = buildService.ARCHIVE_DIRECTORY;

/** The corpus, from the shared fixture. */
let seeded;

/** The stubbed extractor's handle for the suite's one build. */
let stub;

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
 * At the head because `runOne` takes *the* next queued build, and a stale one in a
 * development database would otherwise be the one this suite ran and asserted against.
 * The run checks it got its own job back regardless.
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

/**
 * Unpack an archive into a temporary directory and list what is in it.
 *
 * @param {string} sha256 - The archive, which is named for its own digest.
 * @returns {{root: string, entries: string[]}} Where it went, and every file in it.
 */
function unpack(sha256) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-build-unpack-'));

    /* A bare filename with `cwd` set, and `-C` for the full path. A colon in an archive
       path means `host:path` to GNU tar, which is how the first real build failed. */
    execFileSync('tar', ['-xf', `${sha256}.tar`, '-C', root], {
        cwd: ARCHIVE_DIRECTORY,
        stdio: 'pipe',
    });

    const entries = [];
    const walk = (directory, prefix) => {
        for (const name of fs.readdirSync(directory)) {
            const full = path.join(directory, name);

            if (fs.statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
            else entries.push(`${prefix}${name}`);
        }
    };

    walk(root, '');

    return { root, entries: entries.sort() };
}

beforeAll(async () => {
    /* Whether the API's own worker row already existed. `claimBuild` creates it on
       first use, and a row this run created has to go again or the corpus guard fails
       the file -- which against CI's empty database it always would. */
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;

    seeded = await fixture.seedCorpus(runId);
}, 60000);

afterAll(async () => {
    if (stub) stub.restore();

    for (const ids of [made.datasetIds]) {
        if (!ids.length) continue;

        await db.sequelize.query('DELETE FROM dataset_observations WHERE dataset_id IN (:ids)', {
            replacements: { ids },
        });
        await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id IN (:ids)', {
            replacements: { ids },
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

describe('a dataset build, end to end with the extractor stubbed (#268)', () => {

    /** What the one build produced, so every test below reads the same run. */
    let built;

    /** The unpacked archive. */
    let archive;

    /**
     * Staging directories that existed before this build ran.
     *
     * The temp directory is shared with everything else on the machine, including an
     * earlier build somebody interrupted, so the question has to be what *this* run
     * left rather than what is there.
     */
    let stagedBefore;

    beforeAll(async () => {
        stagedBefore = new Set(fixture.stagingDirectories());
        stub = fixture.stubExtraction({ jellyfin, extraction });

        /* Three subsets, one per split the screen offers. Deliberately *not* aligned
           with the connected group: `first` is claimed by the train subset and `second`
           -- which shares frames 101 and 102 with it -- is matched by the validation
           one, so the group rule has to pull the pair whole into train. A build that
           honoured the subsets naively would leak two frames into eval. */
        const queued = await queueBuild({
            name: `Jest Build Runner ${runId}`,
            subsets: [
                { split: 'train', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[0]] } },
                { split: 'validation', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] } },
                { split: 'test', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[2]] } },
            ],
        });

        built = await runBuild(queued.job.id);
        built.datasetId = queued.dataset.id;

        // Surfaces the reason rather than an assertion about a property of `undefined`.
        expect(built.reason).toBeUndefined();

        archive = unpack(built.archive.sha256);
    }, 120000);

    afterAll(() => {
        if (archive && fs.existsSync(archive.root)) fs.rmSync(archive.root, { recursive: true, force: true });
    });

    test('one ffmpeg pass per video and split, not one per observation', async () => {
        /* Four observations across three videos, and `first` and `second` are in the
           same video *and* the same split, so they are cut together. Opening the video
           is the expensive part; a pass per observation is hours where this is minutes. */
        expect(stub.calls.extractions).toHaveLength(3);

        const asked = stub.calls.extractions.map((call) => call.frames);

        expect(asked).toContainEqual([100, 101, 102, 103]);
        expect(asked).toContainEqual([200, 201, 202]);
        expect(asked).toContainEqual([300, 301]);
    });

    test('every frame of the span is cut, not just the keyframes', async () => {
        /* R5. A keyframe is a box at a frame number and the frames between two of them
           are interpolated and trained on, which is why `/mosaic/observations/frames`
           counts the span. The corpus draws two boxes per observation and nine frames
           come out. */
        expect(built.images).toBe(9);
        expect(built.missing).toBe(0);
    });

    test('the dataset is ready, and says what it is made of', async () => {
        const [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: built.datasetId });

        expect(dataset.status).toBe('ready');
        expect(Number(dataset.num_samples)).toBe(9);
        expect(Number(dataset.num_classes)).toBe(3);
        expect(dataset.archive_sha256).toBe(built.archive.sha256);
        expect(dataset.archive_path).toBe(`datasets/${built.archive.sha256}.tar`);
        expect(Number(dataset.archive_bytes)).toBeGreaterThan(0);
    });

    test('the archive is named for its own digest and is the size the row claims', async () => {
        const file = path.join(ARCHIVE_DIRECTORY, `${built.archive.sha256}.tar`);

        expect(fs.existsSync(file)).toBe(true);
        expect(fs.statSync(file).size).toBe(built.archive.bytes);

        const digest = require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

        expect(digest).toBe(built.archive.sha256);
    });

    test('no partial archive is left in the dataset directory', async () => {
        const partials = fs.readdirSync(ARCHIVE_DIRECTORY).filter((name) => name.startsWith('building-'));

        expect(partials).toEqual([]);
    });

    test('nothing this build staged is left in the temp directory', async () => {
        // Gigabytes of frames, removed in a `finally` whatever happened.
        expect(fixture.stagingDirectories().filter((name) => !stagedBefore.has(name))).toEqual([]);
    });

    test('the connected group stayed whole, in the split its earliest member claimed', async () => {
        const members = await q(
            `SELECT observation_id, inclusion_type, selection_method
               FROM dataset_observations
              WHERE dataset_id = :id
              ORDER BY observation_id`,
            { id: built.datasetId }
        );

        /* R7, and the reason the subsets above were chosen to cut across the group:
           `second` was matched by the validation subset and is in train, because it
           shares frames 101 and 102 with `first`. */
        const splitOf = Object.fromEntries(members.map((row) => [row.observation_id, row.inclusion_type]));

        expect(splitOf[seeded.first]).toBe('train');
        expect(splitOf[seeded.second]).toBe('train');
        expect(splitOf[seeded.third]).toBe('validation');
        expect(splitOf[seeded.fourth]).toBe('test');
    });

    test('membership is recorded for every observation that went in, and only those', async () => {
        const members = await q(
            'SELECT observation_id, selection_method FROM dataset_observations WHERE dataset_id = :id',
            { id: built.datasetId }
        );

        // R3. `dataset_observations` held 0 rows for 0 datasets before #268.
        expect(members).toHaveLength(4);
        expect(new Set(members.map((row) => row.observation_id)))
            .toEqual(new Set([seeded.first, seeded.second, seeded.third, seeded.fourth]));
        expect(new Set(members.map((row) => row.selection_method))).toEqual(new Set(['ml-dashboard query']));
    });

    test('the vocabulary is recorded in index order, by species id', async () => {
        const classes = await q(
            `SELECT c.class_index, c.species_id, s.comname
               FROM dataset_classes c
               JOIN species s ON s.id = c.species_id
              WHERE c.dataset_id = :id
              ORDER BY c.class_index`,
            { id: built.datasetId }
        );

        /* R4. The index is what every label file says and the id is what it means, so a
           rename changes the printed name and never the mapping. Ordered by common
           name, which is why the fixture's species are called A, B and C. */
        expect(classes.map((row) => Number(row.class_index))).toEqual([0, 1, 2]);
        expect(classes.map((row) => row.species_id)).toEqual(seeded.speciesIds);
        expect(classes.map((row) => row.comname))
            .toEqual([seeded.names.A, seeded.names.B, seeded.names.C]);
    });

    test('the archive holds all three splits, and the one sent to Test is in it', async () => {
        /* The defect this is a tripwire for: Validation and Test were cut, recorded as
           members and then left out of the tar, because packaging named a fixed pair of
           directories. The dataset claimed observations its own archive did not hold. */
        expect(archive.entries).toContain('data.yaml');

        const images = archive.entries.filter((name) => name.endsWith('.jpg'));
        const labels = archive.entries.filter((name) => name.endsWith('.txt'));

        expect(images).toHaveLength(9);
        expect(labels).toHaveLength(9);

        const inSplit = (prefix) => images.filter((name) => name.startsWith(prefix)).length;

        expect(inSplit('train/images/')).toBe(4);
        expect(inSplit('eval/images/')).toBe(3);
        expect(inSplit('test/images/')).toBe(2);
    });

    test('every image has the label file that belongs to it', async () => {
        const stems = (extension) => archive.entries
            .filter((name) => name.endsWith(extension))
            .map((name) => name.replace(/\/(images|labels)\//, '/').replace(extension, ''))
            .sort();

        expect(stems('.txt')).toEqual(stems('.jpg'));
    });

    test('a frame two observations share carries both of their boxes', async () => {
        /* The other side of the split rule. Frames 101 and 102 are in both `first` and
           `second`, so their label file has two lines -- one per class -- and writing a
           line per observation would have produced two images with one name. */
        const shared = path.join(
            archive.root, 'train', 'labels',
            `${path.parse(seeded.videos.one).name}_00000101.txt`
        );

        const lines = fs.readFileSync(shared, 'utf8').trim().split('\n');

        expect(lines).toHaveLength(2);
        expect(lines.map((line) => line.split(' ')[0]).sort()).toEqual(['0', '1']);

        /* The fixture's box does not move between its two keyframes, so every
           interpolated label is the same box: a centre of 0.5, half the frame wide. */
        for (const line of lines) {
            expect(line.split(' ').slice(1)).toEqual(['0.500000', '0.500000', '0.500000', '0.500000']);
        }
    });

    test('a frame only one observation covers carries one box, with that species\' index', async () => {
        const only = path.join(
            archive.root, 'train', 'labels',
            `${path.parse(seeded.videos.one).name}_00000100.txt`
        );

        const lines = fs.readFileSync(only, 'utf8').trim().split('\n');

        // Frame 100 is `first` alone, which is species A, which is class 0.
        expect(lines).toHaveLength(1);
        expect(lines[0].split(' ')[0]).toBe('0');
    });

    test('the frames are named for their video, so two videos cannot collide', async () => {
        const names = archive.entries.filter((name) => name.endsWith('.jpg')).map((name) => path.basename(name));

        expect(names.some((name) => name.startsWith(path.parse(seeded.videos.one).name))).toBe(true);
        expect(names.some((name) => name.startsWith(path.parse(seeded.videos.two).name))).toBe(true);
        expect(names.some((name) => name.startsWith(path.parse(seeded.videos.three).name))).toBe(true);
    });

    test('data.yaml names the classes in index order and points at all three splits', async () => {
        const yaml = fs.readFileSync(path.join(archive.root, 'data.yaml'), 'utf8');

        expect(yaml).toBe([
            'names:',
            `- ${seeded.names.A}`,
            `- ${seeded.names.B}`,
            `- ${seeded.names.C}`,
            'nc: 3',
            'train: train/images',
            'val: eval/images',
            'test: test/images',
            '',
        ].join('\n'));
    });

    test('the frames are JPEG, which is what every dataset MARP trains on', async () => {
        const image = archive.entries.find((name) => name.startsWith('train/images/'));
        const bytes = fs.readFileSync(path.join(archive.root, image));

        // SOI marker. The extractor writes PNG; a training frame is re-encoded.
        expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    });

    test('the job and its attempt both finished, with progress recorded in frames', async () => {
        const [job] = await q('SELECT state, finished_at, attempts_made FROM gpu_jobs WHERE id = :id', {
            id: made.jobIds[0],
        });

        expect(job.state).toBe('succeeded');
        expect(job.finished_at).not.toBeNull();
        expect(Number(job.attempts_made)).toBe(1);

        const [attempt] = await q(
            `SELECT state, progress_done, progress_total, progress_unit, progress_phase
               FROM gpu_job_attempts WHERE job_id = :id`,
            { id: made.jobIds[0] }
        );

        expect(attempt.state).toBe('succeeded');
        expect(attempt.progress_unit).toBe('frames');
        expect(attempt.progress_phase).toBe('packaging');
        expect(Number(attempt.progress_done)).toBe(9);
        expect(Number(attempt.progress_total)).toBe(9);
    });

    test('the attempt belongs to the API, which is the machine that did the work', async () => {
        const [attempt] = await q(
            `SELECT w.local_id, w.state
               FROM gpu_job_attempts a JOIN gpu_workers w ON w.id = a.worker_id
              WHERE a.job_id = :id`,
            { id: made.jobIds[0] }
        );

        /* Enrolled rather than making `worker_id` nullable on a table of tens of
           thousands of rows, and `paused` so the pool never hands it anything and the
           Workers screen does not show a machine nobody can fix. */
        expect(attempt.local_id).toBe('marp-api-internal');
        expect(attempt.state).toBe('paused');
    });
});

describe('what a build does with what it could not cut (#268)', () => {

    /** This group's own stub, so the omission does not reach the group above. */
    let omitting;

    afterAll(() => {
        if (omitting) omitting.restore();
    });

    test('a frame the extractor could not produce costs that frame, not the build', async () => {
        omitting = fixture.stubExtraction({ jellyfin, extraction }, {
            // A video whose last second is truncated: frame 302 never arrives.
            omit: (frame) => frame === 202,
        });

        const queued = await queueBuild({
            name: `Jest Build Missing ${runId}`,
            filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] },
            splits: { train: 1 },
        });

        const result = await runBuild(queued.job.id);

        expect(result.reason).toBeUndefined();

        /* `second` spans 101–103 and `third` spans 200–202: six frames, one of which
           could not be produced. The dataset is five images and is still `ready` -- a
           video whose last second is truncated costs the frames at the end, not the
           dataset. */
        expect(result.images).toBe(5);
        expect(result.missing).toBe(1);

        const [dataset] = await q('SELECT status, num_samples FROM datasets WHERE id = :id', {
            id: queued.dataset.id,
        });

        expect(dataset.status).toBe('ready');
        expect(Number(dataset.num_samples)).toBe(5);

        const unpacked = unpack(result.archive.sha256);

        try {
            const images = unpacked.entries.filter((name) => name.endsWith('.jpg'));

            expect(images).toHaveLength(5);

            // And the gap is the frame that was lost, not the one after it.
            expect(images.some((name) => name.endsWith('_00000202.jpg'))).toBe(false);
            expect(images.some((name) => name.endsWith('_00000201.jpg'))).toBe(true);
        } finally {
            fs.rmSync(unpacked.root, { recursive: true, force: true });
        }
    }, 120000);
});
