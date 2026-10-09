/**
 * A thumbnail is named by its bytes, not by the observation it belongs to.
 *
 * The name used to be `${observation_id}.jpg`, and that is why two databases
 * cannot share a thumbnail directory: `observation_id` is assigned as
 * `max(observation_id) + 1` **per database** (#62), so independent databases hand
 * out overlapping ranges by construction and both own `582.jpg`.
 * `routes/thumbnail.routes.js` serves `path.join(STORAGE_DIR, row.filename)` after
 * checking only `fs.existsSync` -- it compares no `byte_size`, no `width` and no
 * `height` against the row -- so a collision is not a broken tile. It is a 200, a
 * plausible ETag, and a confident picture of the wrong animal.
 *
 * **Two tiers, and the first one cannot see the defect.** `thumbnailFilename` is
 * a pure function and a test of it stays green while the service ignores it
 * entirely, so the cases that matter go through `cropToTile` -- the function that
 * actually writes the file -- and assert the name it chose against a digest of the
 * bytes it wrote. That is the tier at which "named by the observation" is
 * observable.
 *
 * No database. `cropToTile` writes into `STORAGE_DIR`, which is read at module
 * load from `THUMBNAIL_STORAGE_DIR` (#132), so this suite points that at a
 * temporary directory of its own before requiring anything and removes it
 * afterwards. The development corpus is never touched.
 *
 * Refs #62.
 *
 * @fileoverview The stored thumbnail filename is a content hash.
 * @module tests/thumbnail-naming
 * @author Isaac Travers
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const {
    CONTENT_NAME_PATTERN,
    thumbnailFilename,
} = require('../db/thumbnail-filename');

const { planActions } = require('../scripts/rename-thumbnails-by-content');

/** A directory of this run's own, so nothing here can reach the real corpus. */
const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-thumb-naming-'));

/** A frame to crop. Made once; every case crops the same pixels from it. */
let framePath;

/** The service, required only after the storage directory is pointed somewhere safe. */
let cropToTile;

/** A box covering the middle of the frame, in the normalised centre-origin shape. */
const CENTRE_BOX = { x: 0.5, y: 0.5, width: 0.4, height: 0.4 };

/**
 * The digest of a file on disk, which is what the name is supposed to be.
 *
 * Computed from the bytes rather than taken from the function under test: a test
 * that names the file with the same call the code made would pass however wrong
 * that call is.
 *
 * @param {string} file - Path to read.
 * @returns {string} Lower-case hex sha256.
 */
function digestOf(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

beforeAll(async () => {
    process.env.THUMBNAIL_STORAGE_DIR = storageDirectory;

    // Read at module load, so the cache has to be cleared or an earlier suite's
    // value stands. `tests/thumbnail-storage.test.js` is the precedent.
    jest.resetModules();
    ({ cropToTile } = require('../service/thumbnail-extraction.service'));

    framePath = path.join(storageDirectory, 'frame.png');

    // Noise rather than a flat colour: a solid image compresses to bytes that
    // barely differ, and a case here turns on two crops differing.
    const pixels = Buffer.alloc(320 * 240 * 3);
    for (let i = 0; i < pixels.length; i++) { pixels[i] = (i * 37) % 256; }

    await sharp(pixels, { raw: { width: 320, height: 240, channels: 3 } })
        .png()
        .toFile(framePath);
});

afterAll(() => {
    fs.rmSync(storageDirectory, { recursive: true, force: true });
    delete process.env.THUMBNAIL_STORAGE_DIR;
});

describe('a thumbnail is named by its bytes (#62)', () => {

    describe('the rule', () => {

        test('the name is the sha256 of the bytes, in hex, with .jpg', () => {
            const bytes = Buffer.from('not really a jpeg');
            const expected = crypto.createHash('sha256').update(bytes).digest('hex');

            expect(thumbnailFilename(bytes)).toBe(`${expected}.jpg`);
            expect(CONTENT_NAME_PATTERN.test(thumbnailFilename(bytes))).toBe(true);
        });

        test('identical bytes give an identical name, which is what makes a collision impossible', () => {
            const one = Buffer.from([1, 2, 3, 4]);
            const other = Buffer.from([1, 2, 3, 4]);

            expect(thumbnailFilename(one)).toBe(thumbnailFilename(other));
            expect(thumbnailFilename(one)).not.toBe(thumbnailFilename(Buffer.from([1, 2, 3, 5])));
        });

    });

    describe('what the extractor actually writes', () => {

        test('the filename it returns is the digest of the file it wrote', async () => {
            const result = await cropToTile(framePath, CENTRE_BOX, 582);
            const written = path.join(storageDirectory, result.filename);

            expect(fs.existsSync(written)).toBe(true);
            expect(result.filename).toBe(`${digestOf(written)}.jpg`);
        });

        test('the name does not carry the observation id', async () => {
            // The whole defect in one assertion: 582 in the name is what let two
            // databases, each with their own observation 582, own one file.
            const result = await cropToTile(framePath, CENTRE_BOX, 582);

            expect(result.filename).not.toBe('582.jpg');
            expect(result.filename).toMatch(CONTENT_NAME_PATTERN);
        });

        test('two observations cropping the same pixels get the same file', async () => {
            const first = await cropToTile(framePath, CENTRE_BOX, 582);
            const second = await cropToTile(framePath, CENTRE_BOX, 91411);

            expect(second.filename).toBe(first.filename);
            expect(second.byteSize).toBe(first.byteSize);
        });

        test('a different crop of the same frame gets a different file', async () => {
            const middle = await cropToTile(framePath, CENTRE_BOX, 582);
            const corner = await cropToTile(framePath, { x: 0.25, y: 0.25, width: 0.2, height: 0.2 }, 582);

            expect(corner.filename).not.toBe(middle.filename);
        });

    });

});

describe('renaming what is already on disk (#62)', () => {

    /**
     * A row, in the three columns the planner reads.
     *
     * @param {number} id - The observation.
     * @param {?string} filename - What the row names, or null.
     * @param {string} [status] - The extraction's state.
     * @returns {Object} A row.
     */
    function row(id, filename, status = 'ready') {
        return { observation_id: id, status, filename };
    }

    test('a file named by its observation is renamed to its digest', () => {
        const plan = planActions(
            [row(582, '582.jpg')],
            new Map([['582.jpg', 'a'.repeat(64)]]),
            ['582.jpg']
        );

        expect(plan.renames).toEqual([
            { observationId: 582, from: '582.jpg', to: `${'a'.repeat(64)}.jpg` },
        ]);
        expect(plan.orphans).toEqual([]);
    });

    test('a second run has nothing to do, which is what idempotent means here', () => {
        const named = `${'b'.repeat(64)}.jpg`;
        const plan = planActions(
            [row(582, named)],
            new Map([[named, 'b'.repeat(64)]]),
            [named]
        );

        expect(plan.renames).toEqual([]);
        expect(plan.alreadyNamed).toHaveLength(1);
    });

    test('a run half done is finished rather than restarted', () => {
        // The state an interrupted apply leaves: one row already moved, one not.
        const done = `${'c'.repeat(64)}.jpg`;
        const plan = planActions(
            [row(582, done), row(91411, '91411.jpg')],
            new Map([[done, 'c'.repeat(64)], ['91411.jpg', 'd'.repeat(64)]]),
            [done, '91411.jpg']
        );

        expect(plan.alreadyNamed.map((r) => r.observation_id)).toEqual([582]);
        expect(plan.renames.map((r) => r.observationId)).toEqual([91411]);
    });

    test('two rows holding identical bytes are pointed at one file', () => {
        const digest = 'e'.repeat(64);
        const plan = planActions(
            [row(582, '582.jpg'), row(91411, '91411.jpg')],
            new Map([['582.jpg', digest], ['91411.jpg', digest]]),
            ['582.jpg', '91411.jpg']
        );

        expect(plan.renames.map((r) => r.to)).toEqual([`${digest}.jpg`, `${digest}.jpg`]);
        expect(plan.orphans).toEqual([]);
    });

    test('a row whose file is missing is reported, never renamed', () => {
        const plan = planActions([row(582, '582.jpg')], new Map(), []);

        expect(plan.renames).toEqual([]);
        expect(plan.missingFiles.map((r) => r.observation_id)).toEqual([582]);
    });

    test('a row that never had a file is reported with its status', () => {
        // The fifteen on the development corpus: extractions that failed, so no
        // file was ever written. A rename has nothing to do with them.
        const plan = planActions([row(610, null, 'failed')], new Map(), []);

        expect(plan.noFilename.map((r) => r.status)).toEqual(['failed']);
        expect(plan.renames).toEqual([]);
        expect(plan.missingFiles).toEqual([]);
    });

    test('a file no row names is an orphan, and stays where it is', () => {
        const plan = planActions(
            [row(582, '582.jpg')],
            new Map([['582.jpg', 'f'.repeat(64)], ['1233.jpg', '0'.repeat(64)]]),
            ['582.jpg', '1233.jpg']
        );

        expect(plan.orphans).toEqual(['1233.jpg']);
        expect(plan.renames.map((r) => r.from)).toEqual(['582.jpg']);
    });

});
