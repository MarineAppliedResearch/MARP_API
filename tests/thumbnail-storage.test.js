/**
 * Where the thumbnails live, and who gets to decide (#132, R1 and R2).
 *
 * This was one hardcoded path, and it is the reason a testing database could not
 * exist: `observation_thumbnails` records a filename and the JPEG lives on disk,
 * so the rows and the files are one corpus -- and with one directory per
 * *checkout*, a development database and a testing database in the same checkout
 * were forced to share it. `scripts/load-corpus.js` replaces that directory
 * wholesale, so filling a testing database meant deleting the development
 * corpus's pictures.
 *
 * Three things are worth pinning here rather than discovering later, and all
 * three are the kind that fail silently:
 *
 * - **unset means what it always meant.** Every existing checkout, CI and
 *   production read this file with nothing set. A default that moved would move
 *   production's pictures, and nothing would say so -- the rows would still be
 *   there and every tile would 404.
 * - **relative resolves against the repository root.** `dotenv` resolves `.env`
 *   against the *working directory*, which has already cost time here: a script
 *   run from elsewhere connects to the defaults and fails as though the database
 *   were down. The same trap pointed at storage is worse, because a `cd` would
 *   silently aim the extractor at an empty directory and the corpus would look
 *   lost rather than merely unreachable.
 * - **`db/corpus.js` reads it from here rather than restating it.** Two copies of
 *   a path is two things to get wrong, and the one that would be wrong is the
 *   one the dump and the load use.
 *
 * The value is read at module load, the way `FFMPEG_PATH` beside it already is,
 * so each case has to clear the require cache and re-require. That is the whole
 * reason this suite exists as a file rather than three lines somewhere else.
 *
 * Refs #132.
 *
 * @fileoverview The thumbnail storage directory is per-database, not per-checkout.
 * @module tests/thumbnail-storage
 * @author Isaac Travers
 */

const path = require('path');

/** The repository root, as the module under test computes it. */
const ROOT = path.join(__dirname, '..');

/**
 * Load `config/thumbnails.js` afresh with `THUMBNAIL_STORAGE_DIR` set or unset.
 *
 * **`jest.resetModules()`, not `delete require.cache[...]`.** Jest gives each
 * test file its own module registry and `require.cache` is not it, so deleting
 * from `require.cache` succeeds, changes nothing, and every case reads the value
 * captured the first time -- which looks exactly like the environment variable
 * not being read at all. That is how this file failed the first time it ran.
 *
 * Both modules have to go, because `db/corpus.js` reads `config/thumbnails.js` at
 * *its* own module load and would otherwise hand back a path taken before the
 * environment was arranged.
 *
 * @param {?string} value - What to set, or null to leave it unset.
 * @returns {{config: Object, corpus: Object}} Freshly loaded modules.
 */
function loadWith(value) {
    const previous = process.env.THUMBNAIL_STORAGE_DIR;

    if (value === null) {
        delete process.env.THUMBNAIL_STORAGE_DIR;
    } else {
        process.env.THUMBNAIL_STORAGE_DIR = value;
    }

    jest.resetModules();

    try {
        return {
            config: require('../config/thumbnails'),
            corpus: require('../db/corpus'),
        };
    } finally {
        if (previous === undefined) {
            delete process.env.THUMBNAIL_STORAGE_DIR;
        } else {
            process.env.THUMBNAIL_STORAGE_DIR = previous;
        }
        // Leave the registry as the rest of this file expects to find it: the
        // next case resets it again anyway, and a module left loaded under a
        // directory that does not exist is a trap for anything added later.
        jest.resetModules();
    }
}

describe('THUMBNAIL_STORAGE_DIR', () => {

    it('is storage/observation-thumbnails when nothing is set', () => {
        // The case that must never move. Production and CI both read this file
        // with nothing set, and a changed default is a corpus that is still on
        // disk and no longer served.
        const { config } = loadWith(null);
        expect(config.STORAGE_DIR).toBe(path.join(ROOT, 'storage', 'observation-thumbnails'));
    });

    it('resolves a relative value against the repository root, not the cwd', () => {
        // Not `path.resolve(value)`, which would be the working directory. A
        // script run from `scripts/` would then write into `scripts/storage/`.
        const { config } = loadWith(path.join('storage', 'testing', 'observation-thumbnails'));
        expect(config.STORAGE_DIR)
            .toBe(path.join(ROOT, 'storage', 'testing', 'observation-thumbnails'));
    });

    it('uses an absolute value exactly as given', () => {
        const absolute = path.resolve(path.join(ROOT, '..', 'somewhere-else', 'thumbs'));
        const { config } = loadWith(absolute);
        expect(config.STORAGE_DIR).toBe(absolute);
    });

    it('is what the dump and the load will use, because corpus.js reads it', () => {
        // The coupling that matters: `scripts/dump-corpus.js` copies out of this
        // and `scripts/load-corpus.js` replaces the contents of it. A second copy
        // of the path here would be the one that is wrong.
        const value = path.join('storage', 'testing', 'observation-thumbnails');
        const { config, corpus } = loadWith(value);
        expect(corpus.THUMBNAIL_STORAGE_DIR).toBe(config.STORAGE_DIR);
    });

    it('does not leak between loads', () => {
        // Belt and braces on the helper above: a case that sets the variable and
        // fails to put it back would make every later suite in this process read
        // a directory that does not exist, and the failures would arrive
        // somewhere else entirely.
        //
        // Compared against what was there before rather than against undefined,
        // because a checkout serving two databases may legitimately set this in
        // its own `.env` and the suite must not assert that nobody has.
        const before = process.env.THUMBNAIL_STORAGE_DIR;
        loadWith(path.join('storage', 'testing', 'observation-thumbnails'));
        expect(process.env.THUMBNAIL_STORAGE_DIR).toBe(before);
    });
});

describe('the shared review-imagery eviction policy (#176)', () => {
    const candidates = [
        { kind: 'thumbnail', observation_id: 1, byte_size: 10, accessed_at: new Date('2026-01-01') },
        { kind: 'full_frame', observation_id: 2, byte_size: 20, accessed_at: new Date('2026-03-01') },
        { kind: 'full_frame', observation_id: 3, byte_size: 30, accessed_at: new Date('2026-02-01') },
    ];

    it('R16: evicts least-recent full frames before thumbnails by default', () => {
        const { orderEvictionCandidates } = require('../service/review-imagery-policy');
        expect(orderEvictionCandidates(candidates, 'full_frames_first')
            .map((item) => [item.kind, item.observation_id]))
            .toEqual([['full_frame', 3], ['full_frame', 2], ['thumbnail', 1]]);
    });

    it('R18: supports both administrator-selectable alternative orders', () => {
        const { orderEvictionCandidates } = require('../service/review-imagery-policy');
        expect(orderEvictionCandidates(candidates, 'oldest_first').map((item) => item.observation_id))
            .toEqual([1, 3, 2]);
        expect(orderEvictionCandidates(candidates, 'thumbnails_first').map((item) => item.observation_id))
            .toEqual([1, 3, 2]);
    });

    it('R16: computes the low-watermark byte target without rounding above it', () => {
        const { lowWatermarkBytes } = require('../service/review-imagery-policy');
        expect(lowWatermarkBytes(101, 90)).toBe(90);
    });

    it('R18: rejects settings that cannot safely govern storage', () => {
        const { validateSettings } = require('../service/review-imagery-policy');
        expect(() => validateSettings({ maxBytes: 0, lowWatermarkPercent: 90,
            evictionOrder: 'full_frames_first' })).toThrow(/maxBytes/);
        expect(() => validateSettings({ maxBytes: 100, lowWatermarkPercent: 100,
            evictionOrder: 'full_frames_first' })).toThrow(/lowWatermarkPercent/);
        expect(() => validateSettings({ maxBytes: 100, lowWatermarkPercent: 90,
            evictionOrder: 'unknown' })).toThrow(/evictionOrder/);
    });
});
