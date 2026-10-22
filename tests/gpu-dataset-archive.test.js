/**
 * Tests for serving a packaged dataset to a worker.
 *
 * This is the tier that can see it. The service decides where a file is and the route
 * decides what comes back over the wire, and almost everything worth getting wrong here is
 * in the second half: the status code for a range, the `Content-Range` arithmetic, whether
 * a conditional fetch is answered from cache. A unit test of the service would prove a path
 * exists and nothing about what a worker actually receives.
 *
 * The range cases matter more than they look. A packaged dataset is several gigabytes and
 * the machine fetching it is a volunteer's computer on a home connection, so a transfer
 * that cannot resume is a transfer that may never finish -- and an off-by-one in
 * `Content-Range` produces an archive that is subtly corrupt rather than one that visibly
 * fails.
 *
 * Everything here is seeded by the file and removed again: `tests/setup/corpus-guard.js`
 * fails the file otherwise, and a dataset row left behind would show up in the ML
 * Dashboard as a real dataset.
 *
 * @fileoverview Tests for GET /api/v2/gpu/datasets/:id/archive.
 * @author Isaac Travers
 * @module tests/gpu-dataset-archive
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');

/** Unique per run, so two runs cannot collide on a name or a file. */
const runId = Date.now();

/** Where the route resolves `archive_path` against. */
const ARCHIVE_DIRECTORY = path.join(__dirname, '..', 'storage', 'datasets');

/**
 * The archive's bytes.
 *
 * Deliberately short and recognisable: every assertion below is about which bytes came
 * back, and a slice of readable text says what went wrong where a buffer of noise does not.
 */
const BODY = Buffer.from('MARP-DATASET-ARCHIVE-TEST-BODY', 'utf8');

/** Lower-case hex sha256 of BODY, computed once at setup. */
let sha256;

/** The archive file this suite wrote, removed again afterwards. */
let archiveFile;

/** The dataset rows this suite created. */
let packagedId;
let unpackagedId;

/**
 * A dataset whose name is everything a filename cannot be.
 *
 * Quotes and a newline would break the header or inject another; the Windows-illegal
 * set would produce a file the browser cannot write; the trailing dot is refused by
 * Windows on its own. Dataset names are free text, so all of this is reachable by
 * typing it into the New dataset field.
 */
const AWKWARD_NAME = 'CAMPA "2024" / Rockfish: v1*?<>|\\\n  .';
let awkwardId;

beforeAll(async () => {
    sha256 = require('crypto').createHash('sha256').update(BODY).digest('hex');

    fs.mkdirSync(ARCHIVE_DIRECTORY, { recursive: true });
    archiveFile = path.join(ARCHIVE_DIRECTORY, `test-${runId}-${sha256}.tar`);
    fs.writeFileSync(archiveFile, BODY);

    const [packaged] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'test', 1, 1, 'test', 'ready', :archivePath, :sha, :bytes, now(), now())
         RETURNING id`,
        {
            replacements: {
                name: `jest-dataset-packaged-${runId}`,
                archivePath: `datasets/${path.basename(archiveFile)}`,
                sha: sha256,
                bytes: BODY.length,
            },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    packagedId = packaged[0].id;

    const [unpackaged] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status, created_at, updated_at)
         VALUES (:name, 'test', 1, 1, 'test', 'ready', now(), now())
         RETURNING id`,
        { replacements: { name: `jest-dataset-unpackaged-${runId}` }, type: db.Sequelize.QueryTypes.INSERT, logging: false }
    );
    unpackagedId = unpackaged[0].id;

    /* Points at the same archive file: what is being tested is the name on the way out,
       not the bytes, and one file serves both. */
    const [awkward] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'test', 1, 1, 'test', 'ready', :archivePath, :sha, :bytes, now(), now())
         RETURNING id`,
        {
            replacements: {
                name: `${AWKWARD_NAME} ${runId}`,
                archivePath: `datasets/${path.basename(archiveFile)}`,
                sha: sha256,
                bytes: BODY.length,
            },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    awkwardId = awkward[0].id;
});

afterAll(async () => {
    await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', {
        replacements: { ids: [packagedId, unpackagedId, awkwardId].filter(Boolean) },
        logging: false,
    });
    if (archiveFile && fs.existsSync(archiveFile)) fs.rmSync(archiveFile);
});

describe('GET /api/v2/gpu/datasets/:id/archive', () => {

    test('serves the whole archive, with the headers a resumable fetch needs', async () => {
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('application/x-tar');
        expect(response.headers['accept-ranges']).toBe('bytes');
        expect(response.headers['etag']).toBe(`"dataset-archive-${sha256}"`);
        expect(response.headers['content-length']).toBe(String(BODY.length));
        expect(Buffer.from(response.body).equals(BODY)).toBe(true);
    });

    test('answers a byte range with 206 and exactly those bytes', async () => {
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .set('Range', 'bytes=5-9')
            .responseType('blob');

        expect(response.status).toBe(206);
        expect(response.headers['content-range']).toBe(`bytes 5-9/${BODY.length}`);
        expect(response.headers['content-length']).toBe('5');
        expect(Buffer.from(response.body).toString('utf8')).toBe(BODY.subarray(5, 10).toString('utf8'));
    });

    test('answers an open-ended range, which is what a resume actually sends', async () => {
        const first = 10;
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .set('Range', `bytes=${first}-`)
            .responseType('blob');

        expect(response.status).toBe(206);
        expect(response.headers['content-range']).toBe(`bytes ${first}-${BODY.length - 1}/${BODY.length}`);
        expect(Buffer.from(response.body).equals(BODY.subarray(first))).toBe(true);
    });

    test('refuses a range past the end rather than returning short', async () => {
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .set('Range', `bytes=0-${BODY.length + 50}`);

        expect(response.status).toBe(416);
        expect(response.headers['content-range']).toBe(`bytes */${BODY.length}`);
    });

    test('answers a conditional fetch from cache', async () => {
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .set('If-None-Match', `"dataset-archive-${sha256}"`);

        expect(response.status).toBe(304);
    });

    test('says a dataset nobody packaged has no archive, rather than 500', async () => {
        const response = await global.api.get(`/api/v2/gpu/datasets/${unpackagedId}/archive`);

        expect(response.status).toBe(404);
        expect(JSON.stringify(response.body)).toMatch(/packaged/i);
    });

    test('is 404 for a dataset that does not exist', async () => {
        const response = await global.api.get('/api/v2/gpu/datasets/99999999/archive');

        expect(response.status).toBe(404);
    });
});

describe('what a person gets when they click Download (#268)', () => {

    /* The archive is stored under its own SHA-256, which is the right name in storage
       and useless in a downloads folder. Until this header existed the only client was
       a worker, which does not care; a person does. */

    test('the archive arrives named for the dataset, as a tar', async () => {
        const response = await global.api.get(`/api/v2/gpu/datasets/${packagedId}/archive`).responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-disposition'])
            .toBe(`attachment; filename="jest-dataset-packaged-${runId}.tar"`);
    });

    test('a name full of things a filename cannot contain is made safe', async () => {
        const response = await global.api.get(`/api/v2/gpu/datasets/${awkwardId}/archive`).responseType('blob');
        const disposition = response.headers['content-disposition'];

        expect(response.status).toBe(200);

        /* The header must survive being a header: a newline would end it and start
           another, which is how a dataset name becomes header injection. */
        expect(disposition).not.toMatch(/[\r\n]/);

        /* And must survive being a Windows filename. The interior dot stays — a dot is
           only a problem at the end of a name, and this is what the person typed. */
        expect(disposition).toBe(`attachment; filename="CAMPA 2024 Rockfish v1 . ${runId}.tar"`);
        expect(disposition).not.toMatch(/[\\/:*?<>|]/);
    });

    test('a range request carries it too, so a resumed download keeps the name', async () => {
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .set('Range', 'bytes=0-4')
            .responseType('blob');

        expect(response.status).toBe(206);
        expect(response.headers['content-disposition'])
            .toBe(`attachment; filename="jest-dataset-packaged-${runId}.tar"`);
    });

    test('the worker path is untouched: bytes, length and validator are what they were', async () => {
        /* The trade this change must not make. A worker asks for bytes and checks them
           against the digest; an extra header is nothing to it, and this says so rather
           than assuming it. */
        const response = await global.api
            .get(`/api/v2/gpu/datasets/${packagedId}/archive`)
            .set('Range', 'bytes=5-9')
            .responseType('blob');

        expect(response.status).toBe(206);
        expect(response.headers['content-range']).toBe(`bytes 5-9/${BODY.length}`);
        expect(response.headers['content-length']).toBe('5');
        expect(response.headers['etag']).toBe(`"dataset-archive-${sha256}"`);
        expect(Buffer.from(response.body).toString('utf8')).toBe(BODY.subarray(5, 10).toString('utf8'));
    });
});
