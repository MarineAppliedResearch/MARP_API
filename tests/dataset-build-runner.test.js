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
const buildRepository = require('../repository/dataset-build.repository');

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
 * How many frames the builder asks for in one ffmpeg pass.
 *
 * Taken from the module, which exports it. This read the constant out of the source text
 * for a day, because it was not exported and the batching build below has to be bigger
 * than it without being enormous — the alternative being a span chosen to beat whatever
 * the constant was that week, which is how it came to be 802 frames to beat 400.
 *
 * @returns {number} The batch size the builder is using.
 */
function passSize() {
    return buildService.FRAMES_PER_PASS;
}

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

    /** Every progress report this build made, so the sequence can be read back. */
    let progress;

    beforeAll(async () => {
        stagedBefore = new Set(fixture.stagingDirectories());
        stub = fixture.stubExtraction({ jellyfin, extraction });

        // Wrapped, not replaced: the rows are written for real and the calls recorded.
        progress = jest.spyOn(buildRepository, 'reportProgress');

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
        if (progress) progress.mockRestore();
        if (archive && fs.existsSync(archive.root)) fs.rmSync(archive.root, { recursive: true, force: true });
    });

    test('progress counts across videos rather than restarting at each one', async () => {
        const done = progress.mock.calls
            .map(([, report]) => report)
            /* `startsWith`, not equality: the phase carries which video and how far
               through the list -- "extracting 2/6 …163021_Fwd" -- because a build sits
               on one video for minutes and a bare "extracting" gave no way to tell
               working from wedged. */
            .filter((report) => String(report.phase || '').startsWith('extracting'))
            .map((report) => report.done);

        /* Three videos, and the count that is reported is the build's, not this video's.
           A report that restarted per video would send the number backwards twice here
           and finish at two rather than nine -- and on a real build it is a progress bar
           that jumps back to the start whenever a video ends. */
        expect(done.every((value, i) => i === 0 || value >= done[i - 1])).toBe(true);
        expect(done[0]).toBe(0);
        expect(done[done.length - 1]).toBe(9);
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

        /* **Two counts, in two columns.** Four observations expanded to nine frames.
           `num_samples` is the nine, which is what it has meant since before MARP built
           datasets -- `package-dataset.js` writes the image count, and that is why
           rockfish5 is known as 11,845 images. `num_observations` is the four, and is
           the new fact: nothing recorded it before #268 because `dataset_observations`
           was empty. See the tripwire below for why they are asserted apart. */
        expect(Number(dataset.num_samples)).toBe(9);
        expect(Number(dataset.num_observations)).toBe(4);
        expect(Number(dataset.num_classes)).toBe(3);
        expect(dataset.archive_sha256).toBe(built.archive.sha256);
        expect(dataset.archive_path).toBe(`datasets/${built.archive.sha256}.tar`);
        expect(Number(dataset.archive_bytes)).toBeGreaterThan(0);
    });

    test('observations and frames are two numbers, and neither stands in for the other', async () => {
        /* The tripwire. The two were briefly carried in one column, so a finished
           dataset read its frame count as its observation count -- 1,367 observations
           and no frames at all, both numbers wrong at once, and nothing noticed.

           The corpus is chosen so they cannot be confused: four observations, nine
           frames. A test built on a corpus where they happened to be equal would pass
           with them the wrong way round, which is the whole failure. */
        const [dataset] = await q('SELECT num_samples, num_observations FROM datasets WHERE id = :id', {
            id: built.datasetId,
        });

        const [members] = await q(
            'SELECT count(*)::int AS n FROM dataset_observations WHERE dataset_id = :id',
            { id: built.datasetId }
        );

        // They differ, so the assertions below can tell them apart at all.
        expect(members.n).not.toBe(built.images);

        // An observation is what a person selected; a frame is what it expanded to.
        expect(Number(dataset.num_observations)).toBe(members.n);
        expect(Number(dataset.num_samples)).toBe(built.images);
        expect(Number(dataset.num_samples)).toBeGreaterThan(Number(dataset.num_observations));
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
        const left = fixture.stagingDirectories().filter((name) => !stagedBefore.has(name));

        /* **This cannot tell whose staging directory it found**, and on 2026-10-21 it
           twice found somebody else's. `os.tmpdir()` is shared by every workspace on the
           machine and by whatever server a person is using, while a staging directory is
           named by `mkdtemp` and carries nothing that says which process owns it — so a
           build started elsewhere during this file looks exactly like a leak from this
           one. The check is kept because the thing it guards is real (a failed build
           leaving gigabytes behind), and the message says the other reading out loud so
           the next person does not spend an afternoon on it.

           The fix that would make it attributable is not in this file: staging under
           `%TEMP%/marp-builds/<pid>/` would let this ask about its own process, and would
           also stop a prefix sweep matching a live build. */
        /* Asserted as text rather than as an array, because jest's `expect` takes no
           message: this way the explanation travels in the diff, where somebody reading
           a red run will actually see it. */
        const found = left.length
            ? `${left.join(', ')} — appeared during this file and were not removed. This build `
              + 'removes its own staging in a `finally`, and %TEMP% is shared with every other '
              + 'workspace and server on this machine, so check whether another build was running '
              + 'before chasing a leak here.'
            : '';

        expect(found).toBe('');
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
           interpolated label is the same box -- and it is **the keyframe's own numbers**,
           because `keyframes.x, y` is the centre and YOLO wants the centre.

           These four read `0.500000 0.500000 0.500000 0.500000` until 2026-10-21, when
           the builder added half a width and half a height to a coordinate that was
           already the centre. Every label it had ever written was half a box right and
           down of the animal, and this test agreed with it. */
        for (const line of lines) {
            expect(line.split(' ').slice(1)).toEqual(['0.400000', '0.600000', '0.200000', '0.300000']);
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

        // SOI marker. ffmpeg writes the JPEG itself now; nothing re-encodes it.
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

        const [dataset] = await q(
            'SELECT status, num_samples, num_observations FROM datasets WHERE id = :id',
            { id: queued.dataset.id }
        );

        expect(dataset.status).toBe('ready');

        /* Five frames from two observations: the image count drops by the frame that
           could not be cut and the observation count does not, because both
           observations are still in the dataset. */
        expect(Number(dataset.num_samples)).toBe(5);
        expect(Number(dataset.num_observations)).toBe(2);

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

describe('a pass that falters is retried, not fatal (#268)', () => {

    /** This group's own stub, so the failure does not reach any other group. */
    let faltering;

    afterAll(() => {
        if (faltering) faltering.restore();
    });

    /**
     * **An eight-minute build should not die because one read faltered.**
     *
     * `CookieStarTest2` failed at 26,853 of 31,529 frames, on video 91 of 131, with the
     * filter thread returning -22 and then `Could not open encoder before EOF` -- no
     * frame ever reached the encoder. It was not the video: its pixel format matched the
     * ones that worked, its frames were inside its duration, and replaying its whole plan
     * afterwards produced every frame. It did not reproduce.
     *
     * **So this pins the behaviour rather than the trigger.** A test that claimed to
     * reproduce a fault nobody could provoke would be the worse artefact. What is asserted
     * is what the build does when a pass fails once: it tries again, and the dataset comes
     * out whole.
     */
    test('a pass that fails once still produces every frame', async () => {
        let failures = 0;

        faltering = fixture.stubExtraction({ jellyfin, extraction }, {
            /* The first pass of the run fails the way the real one did, and only once --
               a second attempt at the same frames succeeds, which is what was observed
               when the failing video was replayed. */
            onExtract: () => {
                if (failures === 0) {
                    failures += 1;

                    throw new Error('ffmpeg exited 4294967274: [enc:mjpeg] Could not open encoder before EOF');
                }
            },
        });

        const queued = await queueBuild({
            name: `Jest Build Faltering ${runId}`,
            filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] },
            splits: { train: 1 },
        });

        const result = await runBuild(queued.job.id);

        expect(failures).toBe(1);
        /* Not failed, and not short: the retry produced the frames the first attempt did
           not, so the build is indistinguishable from one that never faltered. */
        expect(result.reason).toBeUndefined();
        expect(result.images).toBe(6);

        const [dataset] = await q(
            'SELECT status, num_samples FROM datasets WHERE id = :id',
            { id: queued.dataset.id }
        );

        expect(dataset.status).toBe('ready');
        expect(Number(dataset.num_samples)).toBe(6);
    });

    /**
     * And when it is not transient, the build still fails -- but says which video, which
     * `ffmpeg exited 4294967274` did not. Working out that it was video 91 of 131 took a
     * query against the attempt's last reported phase.
     */
    test('a pass that keeps failing names the video it was cutting', async () => {
        if (faltering) faltering.restore();

        faltering = fixture.stubExtraction({ jellyfin, extraction }, {
            onExtract: () => {
                throw new Error('ffmpeg exited 4294967274: [enc:mjpeg] Could not open encoder before EOF');
            },
        });

        const queued = await queueBuild({
            name: `Jest Build Doomed ${runId}`,
            filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] },
            splits: { train: 1 },
        });

        const result = await runBuild(queued.job.id);

        expect(result.failed).toBe(true);
        expect(result.reason).toContain(path.parse(seeded.videos.one).name);
        expect(result.reason).toMatch(/frames \d+-\d+/);
        expect(result.reason).toMatch(/attempts/i);
    }, 60000);
});

describe('opening a video survives a timeout (#268)', () => {

    /** This group's own stub. */
    let opening;

    afterAll(() => {
        if (opening) opening.restore();
    });

    /**
     * **The second failure, in the gap the first fix did not cover.** `CookieStarTest2`
     * failed again at `ffprobe exited 1: Connection to tcp://... failed: Error number
     * -138` -- a connection timeout, from `probeStream`, which runs *before* the
     * extraction loop that the pass retry protects. The media server is across the
     * internet rather than on this machine, so a timeout is routine, and a build that now
     * pulls six to nine times harder meets them far more often.
     */
    test('a probe that times out once does not lose the build', async () => {
        let failures = 0;

        opening = fixture.stubExtraction({ jellyfin, extraction }, {
            onProbe: () => {
                if (failures === 0) {
                    failures += 1;

                    throw new Error('ffprobe exited 1: Connection to tcp://jest.invalid:8096 failed: Error number -138');
                }
            },
        });

        const queued = await queueBuild({
            name: `Jest Build Probe Timeout ${runId}`,
            filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] },
            splits: { train: 1 },
        });

        const result = await runBuild(queued.job.id);

        expect(failures).toBe(1);
        expect(result.reason).toBeUndefined();
        expect(result.images).toBe(6);
    }, 60000);

    /**
     * And when the server really is unreachable, the build fails saying which video it
     * could not open -- not `ffprobe exited 1` and a URL with the API key elided.
     */
    test('a video that never opens fails the build, naming it', async () => {
        if (opening) opening.restore();

        opening = fixture.stubExtraction({ jellyfin, extraction }, {
            onProbe: () => {
                throw new Error('ffprobe exited 1: Connection to tcp://jest.invalid:8096 failed: Error number -138');
            },
        });

        const queued = await queueBuild({
            name: `Jest Build Probe Dead ${runId}`,
            filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] },
            splits: { train: 1 },
        });

        const result = await runBuild(queued.job.id);

        expect(result.failed).toBe(true);
        expect(result.reason).toContain(path.parse(seeded.videos.one).name);
        expect(result.reason).toMatch(/attempts/i);
    }, 60000);

    /**
     * **A video with no frame rate is not retried.** That is a permanent property of the
     * file, not a network blip: five attempts would spend fifteen seconds to produce a
     * message about attempts when the answer was the same the first time. It fails at
     * once, and says what is actually wrong.
     */
    test('a video reporting no frame rate fails at once rather than being retried', async () => {
        if (opening) opening.restore();

        let probes = 0;

        opening = fixture.stubExtraction({ jellyfin, extraction }, {
            onProbe: () => {
                probes += 1;

                return { width: 8, height: 8, codec: 'h264', fps: null, duration: 60 };
            },
        });

        const queued = await queueBuild({
            name: `Jest Build No Rate ${runId}`,
            filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] },
            splits: { train: 1 },
        });

        const result = await runBuild(queued.job.id);

        expect(result.failed).toBe(true);
        expect(result.reason).toMatch(/frame rate/i);
        expect(result.reason).not.toMatch(/attempts/i);
        /* Once, not five times. */
        expect(probes).toBe(1);
    }, 60000);
});

describe('labels at the edge of the frame (#268)', () => {

    /**
     * A box whose right half is outside the picture.
     *
     * Centre 0.95 with a width of 0.2 reaches 1.05, and boxes really do run off the
     * edge -- measured over 78 real keyframes they span [-0.0105, 1.0275] horizontally
     * (`service/thumbnail-geometry.js`, F3). The label carries the part that is in the
     * picture, re-centred on it: 0.85 to 1.0, so a centre of 0.925 and a width of 0.15.
     */
    const EDGE_BOX = { x: 0.95, y: 0.5, width: 0.2, height: 0.2 };

    /** This group's stub, build and unpacked archive. */
    let stub;
    let built;
    let archive;
    let edgeObservation;

    beforeAll(async () => {
        const sessionId = await fixture.addSession(seeded, 'E');

        edgeObservation = await fixture.addObservation(seeded, {
            obsID: 7,
            speciesId: seeded.speciesIds[0],
            video: seeded.videos.edge,
            sessionId,
        });

        await fixture.addKeyframes(seeded, edgeObservation, [500, 502], EDGE_BOX);

        /* An ordinary box in the same build, so the archive holds both shapes and the
           invariant below is not asserted over edge cases alone. */
        const interior = await fixture.addObservation(seeded, {
            obsID: 8,
            speciesId: seeded.speciesIds[1],
            video: seeded.videos.edge,
            sessionId,
        });

        await fixture.addKeyframes(seeded, interior, [600, 601]);

        stub = fixture.stubExtraction({ jellyfin, extraction });

        const queued = await queueBuild({
            name: `Jest Build Edge ${runId}`,
            filters: { session: [sessionId] },
            splits: { train: 1 },
        });

        built = await runBuild(queued.job.id);

        expect(built.reason).toBeUndefined();

        archive = unpack(built.archive.sha256);
    }, 120000);

    afterAll(() => {
        if (stub) stub.restore();
        if (archive && fs.existsSync(archive.root)) fs.rmSync(archive.root, { recursive: true, force: true });
    });

    test('a box running off the edge is written as the part that is in the picture', () => {
        const label = path.join(
            archive.root, 'train', 'labels',
            `${path.parse(seeded.videos.edge).name}_00000500.txt`
        );

        const [line] = fs.readFileSync(label, 'utf8').trim().split('\n');

        // Clipped to 0.85..1.0 and re-centred on it, rather than clamped: clamping the
        // centre keeps a width that reaches outside and describes a bigger animal.
        expect(line.split(' ').slice(1)).toEqual(['0.925000', '0.500000', '0.150000', '0.200000']);
    });

    test('every coordinate in every label is inside the picture', () => {
        /* **This is the assertion that caught the centre-origin defect**, and it caught
           it in the real-video suite -- which asserts the same thing -- on its first run
           anywhere, reading 1.012 at a right edge. It is here now because it did not
           need a real video: it needed a box near an edge, and this fixture has one.
           A class index outside the vocabulary is checked beside it, since a label is
           two claims and only one of them is a coordinate. */
        const labels = archive.entries.filter((name) => name.endsWith('.txt'));

        expect(labels.length).toBeGreaterThan(0);

        for (const name of labels) {
            const text = fs.readFileSync(path.join(archive.root, name), 'utf8').trim();

            for (const line of text.split('\n')) {
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
    });
});

describe('a subset that is divided rather than sent to one split (#268)', () => {

    /** This group's stub, restored so the batching group gets a clean one. */
    let stub;

    beforeAll(() => {
        stub = fixture.stubExtraction({ jellyfin, extraction });
    });

    afterAll(() => {
        if (stub) stub.restore();
    });

    /**
     * Build one dataset and read back which split each observation landed in.
     *
     * @async
     * @param {string} label - Distinguishes this build's dataset.
     * @param {Array<Object>} subsets - The subsets to build from.
     * @returns {Promise<Map<number, string>>} Observation id to split.
     */
    async function splitsOf(label, subsets) {
        const queued = await queueBuild({ name: `Jest Build ${label} ${runId}`, subsets });
        const result = await runBuild(queued.job.id);

        expect(result.reason).toBeUndefined();

        const members = await q(
            'SELECT observation_id, inclusion_type FROM dataset_observations WHERE dataset_id = :id',
            { id: queued.dataset.id }
        );

        /* Exactly once each, which is the invariant underneath every split question: a
           divided subset must not put an observation in two places, and the archive
           would not show it -- the second copy overwrites the first by name. */
        expect(new Set(members.map((row) => row.observation_id)).size).toBe(members.length);

        return new Map(members.map((row) => [row.observation_id, row.inclusion_type]));
    }

    test('shares divide one query across the splits they name', async () => {
        /* "Divide this query 70/20/10" is a sentence somebody says, and a builder that
           only understood "these dives into train" made them run the same query three
           times to say it. */
        const placed = await splitsOf('Shares', [
            { filters: { session: [seeded.sessionId] }, shares: { train: 0.5, test: 0.5 } },
        ]);

        expect(placed.size).toBe(4);

        const used = new Set(placed.values());

        /* Both of the splits it named, and only those. If this ever fails with one
           split, the division put everything in one place -- which for a 50/50 of four
           observations in three groups is a bug in the division, not a close call. */
        expect(used).toEqual(new Set(['train', 'test']));
    }, 120000);

    test('a share of zero means that split gets none', async () => {
        const placed = await splitsOf('Zero Share', [
            { filters: { session: [seeded.sessionId] }, shares: { train: 1, eval: 0 } },
        ]);

        // Asked for none, given none -- rather than a rounding error's worth.
        expect(new Set(placed.values())).toEqual(new Set(['train']));
        expect(placed.size).toBe(4);
    }, 120000);

    test('an observation two subsets match still lands in exactly one split', async () => {
        /* The first-assignment rule has to survive a divided subset: shares are divided
           before the subsets are reconciled, so a query that matches everything cannot
           move what an earlier subset already claimed. */
        const placed = await splitsOf('Shares Overlap', [
            { split: 'test', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[0]] } },
            { filters: { session: [seeded.sessionId] }, shares: { train: 0.5, eval: 0.5 } },
        ]);

        expect(placed.size).toBe(4);

        /* `first` was claimed by the earlier subset, and `second` shares frames with it,
           so the group goes whole to where its earliest member went -- even though the
           divided subset matched both of them too. */
        expect(placed.get(seeded.first)).toBe('test');
        expect(placed.get(seeded.second)).toBe('test');

        // And the two the divided subset was left to place are in the splits it named.
        expect(['train', 'eval']).toContain(placed.get(seeded.third));
        expect(['train', 'eval']).toContain(placed.get(seeded.fourth));
    }, 120000);
});

describe('where one ffmpeg pass ends (#268)', () => {

    /* The batching rule on its own, in milliseconds and without a database. The pass
       boundary has now caused two separate failures of a real build -- `ENAMETOOLONG`
       from too many frames in one command, and the extractor's 120-second timeout from
       too much video in one pass -- and both were found by running a build rather than
       by a test. This is the tier that can see the rule itself. */

    const { passes, FRAMES_PER_PASS, SEEK_RATHER_THAN_DECODE } = buildService;

    /** Every frame, once, in order: the invariant no boundary rule may break. */
    function asked(wanted) {
        return passes(wanted).flat();
    }

    test('keeps a run of frames together up to the count', () => {
        const wanted = Array.from({ length: FRAMES_PER_PASS }, (unused, at) => 1000 + at);

        expect(passes(wanted)).toHaveLength(1);
    });

    test('breaks on the count', () => {
        const wanted = Array.from({ length: FRAMES_PER_PASS + 1 }, (unused, at) => 1000 + at);
        const split = passes(wanted);

        expect(split).toHaveLength(2);
        expect(split[0]).toHaveLength(FRAMES_PER_PASS);
        expect(split[1]).toEqual([1000 + FRAMES_PER_PASS]);
    });

    /**
     * **The gap rule caps each step; it does not cap the total.** A pass breaks on a gap
     * wider than 250, so its span can be `(frames - 1) x 250` and grows with the count --
     * 24,750 frames at the old 100, and 99,750 had 400 been raised without this. A pass
     * covering four and a half minutes of video is what the 120-second timeout killed
     * once already, and 99,750 frames is sixty-six minutes.
     *
     * This is the rule that makes the larger count safe, so it is the one that would let
     * that defect back if it went quietly.
     */
    test('breaks on how far a pass reaches, which the gap rule does not bound', () => {
        const { MAX_PASS_SPAN } = buildService;
        const step = SEEK_RATHER_THAN_DECODE;

        /* Gaps of exactly 250 -- every one allowed by the gap rule, and few enough to be
           well under the count, so only the span rule can split these. */
        const wanted = Array.from({ length: 40 }, (unused, at) => 1000 + at * step);

        expect(wanted.length).toBeLessThan(FRAMES_PER_PASS);

        const split = passes(wanted);

        expect(split.length).toBeGreaterThan(1);

        for (const pass of split) {
            expect(pass[pass.length - 1] - pass[0]).toBeLessThanOrEqual(MAX_PASS_SPAN);
        }

        // And nothing was lost to the splitting.
        expect(asked(wanted)).toEqual(wanted);
    });

    /** A dense run is untouched by the span rule: 400 contiguous frames span 400. */
    test('does not split a dense run that is nowhere near the span', () => {
        const wanted = Array.from({ length: FRAMES_PER_PASS }, (unused, at) => 1000 + at);

        expect(passes(wanted)).toHaveLength(1);
    });

    test('breaks on a gap, well short of the count', () => {
        /* The defect. Two frames an hour apart were one pass, so ffmpeg decoded the
           hour to produce two pictures and was killed at 120 seconds -- having already
           written both. Seeking past the gap costs one seek. */
        const wanted = [1000, 1001, 1002, 1002 + SEEK_RATHER_THAN_DECODE + 1];
        const split = passes(wanted);

        expect(split).toHaveLength(2);
        expect(split[0]).toEqual([1000, 1001, 1002]);
    });

    test('decodes through a gap it is cheaper to decode than to seek', () => {
        const wanted = [1000, 1000 + SEEK_RATHER_THAN_DECODE];

        expect(passes(wanted)).toHaveLength(1);
    });

    test('bounds what any one pass makes ffmpeg read', () => {
        /* What the timeout actually cares about: not how many frames a pass keeps, but
           how much video it has to read to reach the last one. */
        const wanted = [];
        for (let group = 0; group < 40; group += 1) {
            const start = group * 5000;                     // Far apart, like real observations.
            for (let at = 0; at < 30; at += 1) wanted.push(start + at);
        }

        for (const pass of passes(wanted)) {
            expect(pass[pass.length - 1] - pass[0]).toBeLessThanOrEqual(
                (FRAMES_PER_PASS - 1) * SEEK_RATHER_THAN_DECODE,
            );
        }

        expect(asked(wanted)).toEqual(wanted);
    });

    test('asks for every frame exactly once however it breaks', () => {
        const wanted = [1, 2, 3, 900, 901, 1500, 1501, 1502, 9000];

        expect(asked(wanted)).toEqual(wanted);
        expect(passes([])).toEqual([]);
    });
});

describe('a video with more frames than one ffmpeg pass can ask for (#268)', () => {

    /**
     * The frames this video wants: **two full passes and a short third**, whatever the
     * builder's batch size happens to be.
     *
     * It used to be a flat 802 frames, chosen to beat a batch size of 400. That made it
     * the most expensive test in the group for no added confidence, and it would have
     * quietly stopped testing anything the day somebody raised the batch size past it.
     * Three passes is the smallest number that distinguishes a dropped middle batch from
     * a dropped last one, so the video is sized to produce exactly three.
     */
    const SPAN = { first: 1000, last: 1000 + (2 * passSize()) + 1 };

    /** How many frames that is. */
    const WANTED = SPAN.last - SPAN.first + 1;

    /** This group's own stub and its own session, invisible to the builds above. */
    let stub;
    let progress;
    let built;
    let archive;

    beforeAll(async () => {
        const sessionId = await fixture.addSession(seeded, 'L');
        const observationId = await fixture.addObservation(seeded, {
            obsID: 5,
            speciesId: seeded.speciesIds[0],
            video: seeded.videos.long,
            sessionId,
        });

        await fixture.addKeyframes(seeded, observationId, [SPAN.first, SPAN.last]);

        stub = fixture.stubExtraction({ jellyfin, extraction });

        /* Wrapped rather than replaced -- `jest.spyOn` calls through -- so the rows are
           written for real and the calls are recorded. Progress is the only way to see
           that a long video reports while it is still being cut. */
        progress = jest.spyOn(buildRepository, 'reportProgress');

        const queued = await queueBuild({
            name: `Jest Build Batched ${runId}`,
            filters: { session: [sessionId] },
            splits: { train: 1 },
        });

        built = await runBuild(queued.job.id);
        built.datasetId = queued.dataset.id;

        expect(built.reason).toBeUndefined();

        archive = unpack(built.archive.sha256);
    }, 300000);

    afterAll(() => {
        if (progress) progress.mockRestore();
        if (stub) stub.restore();
        if (archive && fs.existsSync(archive.root)) fs.rmSync(archive.root, { recursive: true, force: true });
    });

    test('is cut in several passes rather than one enormous one', () => {
        /* The bug this is for: `extractFrames` builds a `select` expression with a term
           per frame, so a video wanting 8,408 frames produced a command line of roughly
           340 KB against an operating-system limit near 32 KB, and the build died with
           `spawn ENAMETOOLONG` **after minutes of extraction**. Every build run by hand
           before that was a few hundred frames, which is why it had never shown -- and
           it is the 50,000-frame datasets this is all for that would have hit it. */
        expect(stub.calls.extractions.length).toBeGreaterThan(1);

        const sizes = stub.calls.extractions.map((call) => call.frames.length);

        /* Three, by construction: the video is two full passes and a short third, so a
           dropped middle batch is distinguishable from a dropped last one. */
        expect(sizes).toHaveLength(3);

        // Full batches, then a last one that is whatever is left.
        expect(Math.max(...sizes)).toBeLessThan(WANTED);
        expect(sizes.slice(0, -1).every((size) => size === sizes[0])).toBe(true);
        expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(sizes[0]);
        expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(WANTED);
    });

    test('every frame is asked for exactly once, in order, across the passes', () => {
        const asked = stub.calls.extractions.flatMap((call) => call.frames);

        /* Disjoint and contiguous. A batch boundary is where an off-by-one costs a
           frame or asks for one twice, and either is invisible in the archive's size
           alone -- a duplicate overwrites and the count still looks right. */
        expect(asked).toHaveLength(WANTED);
        expect(new Set(asked).size).toBe(WANTED);
        expect(asked[0]).toBe(SPAN.first);
        expect(asked[asked.length - 1]).toBe(SPAN.last);
        expect(asked.every((frame, i) => i === 0 || frame === asked[i - 1] + 1)).toBe(true);
    });

    test('the build asks the extractor for its final format, not for PNG', () => {
        /* **The whole of the speed change, stated as a requirement.** ffmpeg writing JPEG
           costs 416 ms per hundred frames; writing PNG and re-encoding with sharp cost
           19,394 ms for the same hundred, which was 96% of a build. If this regresses to
           PNG the archive still comes out correct and a 50,000-frame build takes two and
           a half hours longer, which no other assertion here would notice. */
        for (const call of stub.calls.extractions) {
            expect(call.output).toMatchObject({ format: 'jpeg' });
        }
    });

    test('every pass writes into its own directory, so position stays the addressing', () => {
        const directories = stub.calls.extractions.map((call) => call.destination);

        /* The extractor names its output `frame-%04d.png` by position in the list it was
           given. Two passes writing into one directory would have the second pass
           overwrite the first's frames 1..n, and the images would be right in number and
           wrong in content -- which nothing downstream could tell. */
        expect(new Set(directories).size).toBe(directories.length);
    });

    test('the archive holds every frame, once', () => {
        const images = archive.entries.filter((name) => name.endsWith('.jpg'));
        const labels = archive.entries.filter((name) => name.endsWith('.txt'));

        expect(built.images).toBe(WANTED);
        expect(images).toHaveLength(WANTED);
        expect(labels).toHaveLength(WANTED);

        // The first and last frames of the span, named for the video they came from.
        const stem = path.parse(seeded.videos.long).name;

        expect(images).toContain(`train/images/${stem}_${String(SPAN.first).padStart(8, '0')}.jpg`);
        expect(images).toContain(`train/images/${stem}_${String(SPAN.last).padStart(8, '0')}.jpg`);
    });

    test('and the dataset counts it as one observation', async () => {
        /* The other side of the tripwire above, at the scale that makes the distinction
           obvious: eight hundred frames, one observation. Carried in one column, this
           dataset claimed 802 observations. */
        const [dataset] = await q('SELECT num_samples, num_observations FROM datasets WHERE id = :id', {
            id: built.datasetId,
        });

        expect(Number(dataset.num_samples)).toBe(WANTED);
        expect(Number(dataset.num_observations)).toBe(1);
    });

    test('progress moves while the video is still being cut, not only when it is done', async () => {
        const extracting = progress.mock.calls
            .map(([, report]) => report)
            .filter((report) => String(report.phase || '').startsWith('extracting') && report.total === WANTED);

        /* A four-hour build over a handful of long videos reported nothing between
           videos, so the number sat still for an hour at a time. Reported per pass, it
           climbs. The assertion is that at least one report landed *strictly* inside the
           video -- more than nothing done, less than all of it. */
        const midway = extracting.filter((report) => report.done > 0 && report.done < WANTED);

        expect(midway.length).toBeGreaterThan(0);

        // And it never goes backwards, which is what a per-video reset would look like.
        const done = extracting.map((report) => report.done);

        expect(done.every((value, i) => i === 0 || value >= done[i - 1])).toBe(true);

        // Ending at the whole video, so the bar reaches the end.
        expect(done[done.length - 1]).toBe(WANTED);
    });
});
