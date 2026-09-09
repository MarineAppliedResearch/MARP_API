/**
 * Finds the migration that currently defines "current", and reads its SQL.
 *
 * **Why this is found rather than named.** Until #111 there was exactly one
 * `-- rebuild:` block, in `20260909120200-create-observation-review-current.js`,
 * and both suites hard-coded that path. #111 supersedes that definition with a
 * second migration rather than editing an applied one, so the invariant is no
 * longer "the definition exists once" but **"exactly one definition is current,
 * and it is the newest"**. A hard-coded path would go on passing against the
 * superseded block, asserting the projection matches a rule nothing uses --
 * which is precisely the drift the projection-equals-derivation test exists to
 * catch. This is also the shape that survives the next redefinition.
 *
 * Migration filenames are timestamp-ordered, so newest is last by name.
 *
 * @fileoverview Locates and reads the current observation_review_current derivation.
 * @author Isaac Travers
 * @module tests/setup/current-derivation
 */

const fs = require('fs');
const path = require('path');

/** Where the migrations live. @type {string} */
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

/**
 * Pulls the `-- rebuild:` block out of a migration's text.
 *
 * Anchored to the start of a line, which is not fussiness: the migrations'
 * own documentation mentions both markers inline, and an unanchored pattern
 * matched that sentence instead of the SQL.
 *
 * @param {string} source - The migration file's text.
 * @returns {string} Everything between the markers, inclusive, or '' if absent.
 */
function extractRebuildBlock(source) {
    const match = source.match(/^-- rebuild:begin\r?\n[\s\S]*?^-- rebuild:end$/m);
    return match ? match[0] : '';
}

/**
 * Reads a file with line endings normalised to LF.
 *
 * **ECMAScript normalises CRLF to LF inside a template literal**, so a migration's
 * exported `CURRENT_DERIVATION_SQL` always holds LF however the file is stored --
 * while the same file read off disk holds whatever git checked out, which on
 * Windows with `core.autocrlf` is CRLF. Without this the two could never match.
 * That failed on `develop` the moment a merge caused a fresh checkout, having
 * passed on the branch it was written on, and it passes in CI regardless because
 * CI is Linux. A comparison of SQL should be about the SQL.
 *
 * @param {string} file - Absolute path.
 * @returns {string} The text, LF only.
 */
function readNormalised(file) {
    return fs.readFileSync(file, 'utf8').split('\r\n').join('\n');
}

/**
 * Every migration carrying a `-- rebuild:` block, oldest first.
 *
 * @returns {Array<string>} Absolute paths.
 */
function migrationsDefiningCurrent() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.js'))
        .sort()
        .map((name) => path.join(MIGRATIONS_DIR, name))
        .filter((file) => extractRebuildBlock(readNormalised(file)) !== '');
}

/** The migration whose definition is in force: the newest one. @type {string} */
const CURRENT_MIGRATION_PATH = migrationsDefiningCurrent().pop();

/** Its source, LF-normalised. @type {string} */
const currentMigrationSource = readNormalised(CURRENT_MIGRATION_PATH);

/** The `-- rebuild:` block as committed. @type {string} */
const currentDerivationBlock = extractRebuildBlock(currentMigrationSource);

/** The module itself, for `REBUILD_CURRENT_SQL` and `CURRENT_DERIVATION_SQL`. */
const currentMigration = require(CURRENT_MIGRATION_PATH);

module.exports = {
    CURRENT_MIGRATION_PATH,
    currentDerivationBlock,
    currentMigration,
    currentMigrationSource,
    extractRebuildBlock,
    migrationsDefiningCurrent,
    readNormalised,
};
