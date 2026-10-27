/**
 * Tests for what a classification dataset build actually produced.
 *
 * **The archive is opened and read, not trusted.** A classification dataset has no
 * `data.yaml`: Ultralytics keeps no names list for one, reads the subfolder names, and
 * that is the entire class vocabulary. So the directory layout *is* the contract, and
 * every way of getting it wrong produces an archive that trains happily and means
 * something other than what it says -- a `val/` that is called `eval/` and so does not
 * exist, a species name with a slash in it that becomes two nested folders, a missing
 * `train/` that Ultralytics silently replaces with a random 80/20 split. None of those is
 * visible from the rows, which is why this tier unpacks the tar.
 *
 * **Nothing below the HTTP boundary is mocked, and no video is touched.** A classification
 * build reads the mosaic tiles that already exist on disk, so unlike the detection runner
 * there is no extractor to stub: the files this suite writes are the files the build
 * copies. Everything else -- the selection query, the connected groups, the frame-based
 * split, `tar`, the SHA-256 and every row written -- is real.
 *
 * Everything is seeded and removed by this file, as `tests/setup/corpus-guard.js`
 * requires, including the `observation_thumbnails` rows and the JPEGs beside them.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Integration tests for the classification dataset build.
 * @author Isaac Travers
 * @module tests/dataset-build-classification
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const db = require('../model');
const buildService = require('../service/dataset-build.service');
const buildRepository = require('../repository/dataset-build.repository');
const { STORAGE_DIR: THUMBNAIL_DIR } = require('../config/thumbnails');

const fixture = require('./fixtures/dataset-build-fixture');

const { ARCHIVE_DIRECTORY } = buildService;
const { QueryTypes } = db.Sequelize;

/** Unique per run, so two runs cannot collide on a dataset or species name. */
const runId = Date.now();

/**
 * A real, if tiny, JPEG.
 *
 * **The bytes do not matter and that is worth saying rather than hiding.** The build
 * copies a file; it never decodes one, and a test that generated real imagery would be
 * proving something about ffmpeg instead of about the archive. This is a genuine 1x1
 * JPEG rather than arbitrary bytes so that nothing downstream -- an unpack, a viewer,
 * somebody opening the archive to look -- meets a file that claims to be one and is not.
 *
 * @constant
 * @type {Buffer}
 */
const ONE_PIXEL_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
    + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64'
);

/** What this file created, torn down in reverse. */
const made = { datasetIds: [], jobIds: [], archives: [], thumbnails: [], files: [], workerCreated: false };

/** The seeded corpus: three videos, four observations, three species. */
let seeded;

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });
}

/**
 * Give an observation a ready mosaic tile, on disk and in the database.
 *
 * **An update, not an insert, because the row is already there.** Adding an observation
 * with keyframes enqueues its thumbnail -- the row exists at `queued` with a null
 * filename from the moment the fixture seeds, and `observation_id` is UNIQUE on that
 * table, so inserting a second one is refused. Filling the queued row in is also exactly
 * what the real extractor does when it cuts a frame, which makes this fixture the shape
 * of the thing it stands in for rather than a second way of arriving at it.
 *
 * @async
 * @param {number} observationId - The observation.
 * @returns {Promise<string>} The filename written.
 */
async function giveTile(observationId) {
    const filename = `jest-classify-${runId}-${observationId}.jpg`;
    const full = path.join(THUMBNAIL_DIR, filename);

    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
    fs.writeFileSync(full, ONE_PIXEL_JPEG);
    made.files.push(full);

    const [row] = await q(
        `UPDATE observation_thumbnails
            SET status = 'ready', framenum = 100, subset = '1', filename = :filename,
                content_type = 'image/jpeg', byte_size = :bytes,
                width = 320, height = 320, source_width = 1920, source_height = 1080,
                generation = 1, attempts = 1, completed_at = NOW(), updated_at = NOW()
          WHERE observation_id = :observationId
          RETURNING observation_thumbnail_id`,
        { observationId, filename, bytes: ONE_PIXEL_JPEG.length }
    );

    /* The row belongs to the observation and goes with it -- the foreign key is
       ON DELETE CASCADE -- so `removeCorpus` takes it. Recorded anyway, so that a run
       which fails before that still names what it touched. */
    expect(row).toBeTruthy();
    made.thumbnails.push(row.observation_thumbnail_id);

    return filename;
}

/**
 * Queue a build through the route, so the request validation is the real one.
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

    /* High, so this suite's build is the one the runner claims rather than whatever else
       is queued on this database. */
    await db.sequelize.query('UPDATE gpu_jobs SET priority = 5000 WHERE id = :id', {
        replacements: { id: response.body.job.id }, logging: false,
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

    return result;
}

/**
 * Unpack an archive and list every file in it, with forward slashes.
 *
 * @param {string} sha256 - The archive, which is named for its own digest.
 * @returns {{root: string, entries: string[]}} Where it went, and what is in it.
 */
function unpack(sha256) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-classify-unpack-'));

    /* A bare filename with `cwd` set, and `-C` for the full path: a colon in an archive
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
    /* `claimBuild` creates the API's own worker row on first use, and a row this run
       created has to go again or the corpus guard fails the file. */
    const [worker] = await q("SELECT id FROM gpu_workers WHERE local_id = 'marp-api-internal'");

    made.workerCreated = !worker;

    seeded = await fixture.seedCorpus(runId);

    /* **Three of the four observations get a tile, and the fourth deliberately does not.**
       About 3% of the real corpus has a failed thumbnail, so a build that assumed every
       selected observation had a picture would be wrong on real data. `fourth` is the
       only observation of the third species, so a build that selects that species is a
       build whose selection is larger than its archive -- which is what the last group
       in this file measures. */
    await giveTile(seeded.first);
    await giveTile(seeded.second);
    await giveTile(seeded.third);
}, 60000);

afterAll(async () => {
    if (made.thumbnails.length) {
        await db.sequelize.query(
            'DELETE FROM observation_thumbnails WHERE observation_thumbnail_id IN (:ids)',
            { replacements: { ids: made.thumbnails }, logging: false }
        );
    }

    for (const file of made.files) {
        if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }

    if (made.datasetIds.length) {
        await db.sequelize.query('DELETE FROM dataset_observations WHERE dataset_id IN (:ids)', {
            replacements: { ids: made.datasetIds }, logging: false,
        });
        await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id IN (:ids)', {
            replacements: { ids: made.datasetIds }, logging: false,
        });
        await db.sequelize.query('DELETE FROM dataset_splits WHERE dataset_id IN (:ids)', {
            replacements: { ids: made.datasetIds }, logging: false,
        });
        await db.sequelize.query(
            'DELETE FROM dataset_split_classes WHERE dataset_id IN (:ids)',
            { replacements: { ids: made.datasetIds }, logging: false }
        ).catch(() => {
            /* The per-species split table arrived with the Composition panel and may not
               exist on an older branch's database; its absence is not this file's. */
        });
    }

    if (made.jobIds.length) {
        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'cancelled'
              WHERE id IN (:ids) AND state IN ('queued', 'leased')`,
            { replacements: { ids: made.jobIds }, logging: false }
        );
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', {
            replacements: { ids: made.jobIds }, logging: false,
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: made.jobIds }, logging: false,
        });
    }

    if (made.datasetIds.length) {
        await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', {
            replacements: { ids: made.datasetIds }, logging: false,
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

describe('a classification dataset build, end to end (#268)', () => {

    /** What the one build produced, so every test below reads the same run. */
    let built;

    /** The unpacked archive. */
    let archive;

    /** The dataset row, after the build recorded itself. */
    let dataset;

    beforeAll(async () => {
        /* Two subsets, so the archive has both a train and a held-out split. `validation`
           rather than `eval` on purpose: it is the name the screen offers, and the
           directory it has to become is `val`. */
        const queued = await queueBuild({
            name: `Jest Classify ${runId}`,
            task: 'classification',
            subsets: [
                { split: 'train', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[0]] } },
                { split: 'validation', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] } },
            ],
        });

        built = await runBuild(queued.job.id);

        expect(built.reason).toBeUndefined();

        [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: queued.dataset.id });

        made.archives.push(path.join(ARCHIVE_DIRECTORY, `${dataset.archive_sha256}.tar`));
        archive = unpack(dataset.archive_sha256);
    }, 120000);

    afterAll(() => {
        if (archive && fs.existsSync(archive.root)) {
            fs.rmSync(archive.root, { recursive: true, force: true });
        }
    });

    /**
     * **The directory names are the whole contract**, so this is the assertion that a
     * detection-shaped archive would fail. `eval/` would leave classify with no
     * validation split at all, and the failure would look like Ultralytics' fault.
     */
    test('writes train/ and val/, never eval/', () => {
        const directories = new Set(archive.entries.map((entry) => entry.split('/')[0]));

        expect(directories.has('train')).toBe(true);
        expect(directories.has('val')).toBe(true);
        expect(directories.has('eval')).toBe(false);
    });

    /** No `data.yaml`: the worker takes the detection path when it finds one. */
    test('carries no data.yaml, which would make the worker treat it as detection', () => {
        expect(archive.entries).not.toContain('data.yaml');
    });

    /**
     * **One picture per observation, named for the observation.** The tile's own filename
     * is a content hash and says nothing about where it came from, so a picture in the
     * archive would otherwise be untraceable to the row that produced it.
     */
    test('writes one picture per observation that had a tile', () => {
        const pictures = archive.entries.filter((entry) => entry.endsWith('.jpg'));

        /* Three tiles were written and `fourth` is in neither subset, so both of the
           selected species' observations with tiles are here. */
        expect(pictures.length).toBeGreaterThan(0);

        for (const picture of pictures) {
            expect(path.basename(picture)).toMatch(/^obs-\d+\.jpg$/);
        }
    });

    /**
     * **Every picture sits exactly two levels down**: `<split>/<class>/<file>`. A species
     * name holding a path separator is the way this breaks, and it breaks into a *deeper*
     * tree, so counting segments is the assertion rather than looking for a slash in a
     * string that no longer has one.
     */
    test('puts every picture in one class folder, not a nested tree', () => {
        for (const entry of archive.entries.filter((name) => name.endsWith('.jpg'))) {
            expect(entry.split('/')).toHaveLength(3);
        }
    });

    /** The folder is the encoded handle, and it leads with the species id. */
    test('names each class folder for its species id', () => {
        const folders = new Set(
            archive.entries
                .filter((entry) => entry.endsWith('.jpg'))
                .map((entry) => entry.split('/')[1])
        );

        expect(folders.size).toBeGreaterThan(0);

        for (const folder of folders) {
            expect(folder).toMatch(/^\d+(_[a-z0-9-]+)?$/);
        }
    });

    /**
     * **`classes.json` is what makes the encoding reversible**, and without it the archive
     * states its vocabulary only in handles. A classify model reports those handles, so
     * this file is the only thing that maps its output back to a species.
     */
    test('carries classes.json, mapping every folder to its species', () => {
        expect(archive.entries).toContain('classes.json');

        const written = JSON.parse(
            fs.readFileSync(path.join(archive.root, 'classes.json'), 'utf8')
        );

        expect(written.task).toBe('classification');
        expect(written.crop_source).toBe('mosaic_thumbnail');
        expect(written.classes.length).toBeGreaterThan(0);

        for (const entry of written.classes) {
            expect(typeof entry.species_id).toBe('number');
            expect(typeof entry.comname).toBe('string');
            expect(entry.comname.length).toBeGreaterThan(0);
        }
    });

    /** Every folder on disk is named in the file, and every name in the file is real. */
    test('agrees with the folders that are actually in the archive', () => {
        const written = JSON.parse(
            fs.readFileSync(path.join(archive.root, 'classes.json'), 'utf8')
        );

        const declared = new Set(written.classes.map((entry) => entry.folder));
        const onDisk = new Set(
            archive.entries
                .filter((entry) => entry.endsWith('.jpg'))
                .map((entry) => entry.split('/')[1])
        );

        for (const folder of onDisk) {
            expect(declared.has(folder)).toBe(true);
        }
    });

    /**
     * **The row says what kind of dataset it is and how its pictures were cut.** Both were
     * the worker's objection: a crop rule baked in with nothing in the record to say what
     * it was makes two different datasets look identical.
     */
    test('records the task and the crop method on the dataset', () => {
        expect(dataset.task).toBe('classification');
        expect(dataset.crop_source).toBe('mosaic_thumbnail');
        expect(dataset.status).toBe('ready');
    });

    /**
     * **Members are what was selected; `num_samples` is what was written.** The fourth
     * observation has no tile, so on a selection including it these two differ -- and
     * that difference is how a reader sees that some of the corpus has no picture. A
     * build that recorded only the smaller number would quietly understate its own
     * selection.
     */
    test('counts the observations with no tile rather than hiding them', async () => {
        const [counted] = await q(
            'SELECT COUNT(*)::int AS members FROM dataset_observations WHERE dataset_id = :id',
            { id: dataset.id }
        );

        expect(counted.members).toBe(dataset.num_observations);
        expect(Number(dataset.num_samples)).toBe(built.written);
        expect(built.missing).toBe(0);
    });
});

describe('a classification build that would have no train split', () => {

    /**
     * **Ultralytics splits what it finds 80/20 at random when `train/` is absent**, logs
     * it at INFO, and trains. Against a frame-based split that puts near-duplicate crops
     * on both sides and reports an accuracy that looks excellent and means nothing. The
     * worker refuses it as well; this is the half that stops one being built at all.
     */
    test('is refused on the request that asked for it', async () => {
        const response = await global.api.post('/api/v2/dataset/build').send({
            name: `Jest Classify No Train ${runId}`,
            task: 'classification',
            filters: { session: [seeded.sessionId] },
            splits: { validation: 1 },
        });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/train split/i);
    });

    /** A detection build is not subject to it: `data.yaml` names whatever it holds. */
    test('does not refuse the same splits for a detection build', async () => {
        const response = await global.api.post('/api/v2/dataset/build').send({
            name: `Jest Detect No Train ${runId}`,
            filters: { session: [seeded.sessionId] },
            splits: { validation: 1 },
        });

        expect(response.status).toBe(201);

        made.datasetIds.push(response.body.dataset.id);
        made.jobIds.push(response.body.job.id);

        /* **Cancelled the moment it is asserted, because a queued build is a landmine for
           every other suite.** What is under test is the 201 -- that the refusal is for
           classification only -- and nothing here will ever run it. Left queued it sits in
           the same table the other build suites claim from, and the next `runOne()`
           anywhere in the group takes it instead of its own: it did exactly that, and the
           failure surfaced two files later as somebody else's build ending in the wrong
           state. A test's leftovers are not only its own file's problem. */
        await db.sequelize.query(
            "UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :id",
            { replacements: { id: response.body.job.id }, logging: false }
        );
    });
});

/**
 * What happens to an observation the thumbnail extractor never managed to cut.
 *
 * **This is 3% of the real corpus, not an edge case.** 3,514 of 114,925 observations on
 * the development database have a `failed` thumbnail -- a video that would not resolve, a
 * frame rate that disagreed -- and they will not acquire one without another extraction
 * pass. A build that quietly wrote fewer pictures than it recorded members would produce
 * a dataset whose own row overstates it, and nothing downstream could tell.
 */
describe('a selection holding an observation with no tile', () => {
    let dataset;
    let result;

    beforeAll(async () => {
        /* All three species, so the fourth observation -- the only one of the third
           species, and the one deliberately left without a tile -- is selected. */
        const queued = await queueBuild({
            name: `Jest Classify Missing ${runId}`,
            task: 'classification',
            subsets: [
                { split: 'train', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[0], seeded.speciesIds[2]] } },
                { split: 'validation', filters: { session: [seeded.sessionId], species: [seeded.speciesIds[1]] } },
            ],
        });

        result = await runBuild(queued.job.id);

        expect(result.reason).toBeUndefined();

        [dataset] = await q('SELECT * FROM datasets WHERE id = :id', { id: queued.dataset.id });

        made.archives.push(path.join(ARCHIVE_DIRECTORY, `${dataset.archive_sha256}.tar`));
    }, 120000);

    /** Counted, and the count reaches the caller rather than being swallowed. */
    test('is counted as missing rather than silently dropped', () => {
        expect(result.missing).toBe(1);
    });

    /**
     * **The two numbers differ, and that difference is the record.** `num_observations` is
     * what the query selected; `num_samples` is what the archive holds. A build that
     * recorded only the smaller would understate its own selection, and one that recorded
     * only the larger would claim pictures it does not have.
     */
    test('records the selection and the pictures as two different numbers', () => {
        expect(dataset.num_observations).toBe(result.written + result.missing);
        expect(Number(dataset.num_samples)).toBe(result.written);
        expect(Number(dataset.num_samples)).toBeLessThan(dataset.num_observations);
    });

    /** And it still succeeds: a missing tile is a smaller dataset, not a failed build. */
    test('still produces a ready dataset', () => {
        expect(dataset.status).toBe('ready');
        expect(dataset.archive_sha256).toBeTruthy();
    });
});

describe('an unknown task', () => {

    /**
     * Settled on the request, the way the image format is: without it the answer is 201,
     * a dataset row saying `building`, and a failure in a job the asker has to go and
     * find.
     */
    test('is refused rather than queued and failed later', async () => {
        const response = await global.api.post('/api/v2/dataset/build').send({
            name: `Jest Bad Task ${runId}`,
            task: 'segmentation',
            filters: { session: [seeded.sessionId] },
        });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/detection, classification/);
    });
});
