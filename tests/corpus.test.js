/**
 * Tests for `db/corpus.js`, the definition the dump and load scripts share.
 *
 * The two decisions worth testing are both in here rather than in the scripts,
 * which is why they are testable at all:
 *
 * - **the refusal** (R4). `holdsCorpus` is what stands between a mistyped path
 *   and three GPU runs with no backup. It has to say yes to a corpus and no to a
 *   database `marp db up` has just built -- and the second half is the one that
 *   would break silently, because a freshly built database is not empty:
 *   `species` carries 854 baseline rows and the bootstrap migration puts an
 *   administrator in `users`. A refusal that fires on every fresh database
 *   teaches people to pass `--force` by reflex, which is exactly the habit the
 *   tool exists to prevent.
 * - **the round-trip check** (R6). `compareCounts` is what makes a load report a
 *   failure rather than a success it cannot substantiate.
 *
 * The last test is at the database tier on purpose: a table name misspelled in
 * `CORPUS_TABLES` is invisible to every pure test here -- `countCorpus` would
 * report it as absent and `holdsCorpus` would read absent as empty, so the
 * refusal would quietly stop protecting that table. Only the schema can see it.
 *
 * Refs #125.
 *
 * @fileoverview Unit tests for the corpus definition, plus one schema check.
 * @module tests/corpus
 * @author Isaac Travers
 */

const path = require('path');

const db = require('../model');

const {
    CORPUS_TABLES,
    locateTool,
    holdsCorpus,
    compareCounts,
    countThumbnailFiles,
} = require('../db/corpus');

/**
 * Counts as a freshly built database reports them: every corpus table empty.
 *
 * @returns {Object<string, number>} Zero for every corpus table.
 */
function freshDatabase() {
    return Object.fromEntries(CORPUS_TABLES.map((table) => [table, 0]));
}

describe('holdsCorpus', () => {

    it('says no to a database marp db up has just built', () => {
        // The case that matters. A fresh database is not an empty database --
        // the baseline and the migrations put rows in species, permissions and
        // users -- so a refusal keyed on "any row anywhere" would fire here.
        expect(holdsCorpus(freshDatabase())).toBe(false);
    });

    it('says no when a corpus table is missing entirely', () => {
        // Before the baseline is loaded there are no tables at all, which
        // countCorpus reports as null. Nothing to lose.
        const noSchema = Object.fromEntries(CORPUS_TABLES.map((table) => [table, null]));
        expect(holdsCorpus(noSchema)).toBe(false);
    });

    it('says yes to a single row in any one corpus table', () => {
        for (const table of CORPUS_TABLES) {
            const counts = { ...freshDatabase(), [table]: 1 };
            expect(holdsCorpus(counts)).toBe(true);
        }
    });

    it('asks the database, and ignores anything it is handed about files', () => {
        // The reversal (#132, R3). This used to assert the opposite -- that
        // thumbnail files with no rows behind them made a database occupied --
        // and that short circuit is what made a second database impossible to
        // fill: a provably empty one was refused, and the refusal advised
        // standing up the second database the caller was already standing up.
        //
        // It was a guard in front of the missing per-database storage rather
        // than a bug on its own, and THUMBNAIL_STORAGE_DIR is what it guarded.
        // The second argument is gone; passing one anyway must not resurrect
        // the old answer, which is what this actually pins.
        expect(holdsCorpus(freshDatabase(), 2079)).toBe(false);
        expect(holdsCorpus({ ...freshDatabase(), observations: 1 }, 0)).toBe(true);
    });
});

describe('compareCounts', () => {

    it('reports nothing when the load reproduced the dump', () => {
        const dumped = { observations: 1108, keyframes: 15741 };
        expect(compareCounts(dumped, { observations: 1108, keyframes: 15741 })).toEqual([]);
    });

    it('names the table, the expectation and what arrived', () => {
        const dumped = { observations: 1108, keyframes: 15741 };
        const loaded = { observations: 1108, keyframes: 15740 };

        expect(compareCounts(dumped, loaded)).toEqual([
            { table: 'keyframes', expected: 15741, actual: 15740 },
        ]);
    });

    it('treats a table the load did not report at all as a difference', () => {
        // A restore that skipped a table is the failure this check exists for,
        // and it arrives as a missing key rather than as a zero.
        expect(compareCounts({ keyframes: 9656 }, {})).toEqual([
            { table: 'keyframes', expected: 9656, actual: null },
        ]);
    });

    it('says nothing about a table the manifest never knew', () => {
        // An older dump has a shorter table list. Reporting its silence as a
        // mismatch would make every old dump look unloadable.
        expect(compareCounts({}, { observations: 1108 })).toEqual([]);
    });
});

describe('locateTool', () => {

    const saved = { PG_BIN: process.env.PG_BIN, PG_DUMP: process.env.PG_DUMP };

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
        }
    });

    it('falls back to the bare name so PATH decides', () => {
        delete process.env.PG_BIN;
        delete process.env.PG_DUMP;
        expect(locateTool('pg_dump')).toBe('pg_dump');
    });

    it('prefers an explicit override over everything', () => {
        process.env.PG_DUMP = path.join('somewhere', 'pg_dump');
        process.env.PG_BIN = path.join('elsewhere', 'bin');
        expect(locateTool('pg_dump')).toBe(path.join('somewhere', 'pg_dump'));
    });

    it('ignores a PG_BIN that does not hold the tool', () => {
        // Falling through to PATH rather than returning a path that does not
        // exist: the error then comes from the shell looking, which says
        // something, instead of from spawn on a made-up absolute path.
        delete process.env.PG_DUMP;
        process.env.PG_BIN = path.join(__dirname, 'no-such-bin');
        expect(locateTool('pg_dump')).toBe('pg_dump');
    });
});

describe('countThumbnailFiles', () => {

    it('reports zero for a directory that is not there', () => {
        // The state of a fresh checkout: storage/ is git-ignored, so the
        // directory genuinely does not exist yet and that is not an error.
        expect(countThumbnailFiles(path.join(__dirname, 'no-such-directory'))).toBe(0);
    });

    it('counts the files in a directory that is', () => {
        // tests/setup holds three files and no subdirectories.
        expect(countThumbnailFiles(path.join(__dirname, 'setup'))).toBeGreaterThan(0);
    });
});

describe('CORPUS_TABLES against the schema', () => {

    it('names only tables that exist', async () => {
        const [rows] = await db.sequelize.query(
            `select table_name from information_schema.tables
              where table_schema = 'public' and table_name = any(array[:tables])`,
            { replacements: { tables: CORPUS_TABLES } }
        );

        const found = rows.map((row) => row.table_name).sort();
        expect(found).toEqual([...CORPUS_TABLES].sort());
    });

    // No afterAll closing the connection. tests/setup/authenticated-agent.js has
    // an afterAll of its own that deletes its fixture user, and it runs after
    // this file's -- so closing sequelize here made a suite of fourteen passing
    // tests report "failed to run", with the real error thirty lines down in the
    // setup file. `npm test` passes --forceExit for exactly this.
});
