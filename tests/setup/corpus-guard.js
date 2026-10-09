/**
 * The corpus guard: a test may create rows and must remove them, and it may
 * never modify or delete a row it did not create.
 *
 * Built for #142, where `npm test` reported 44 suites and 612 tests green and
 * left the development corpus one observation lighter and 358 review rows
 * heavier. A delete leaves no trace by design (see
 * `repository/mosaic-commit.repository.js`), so nothing in the database says
 * which suite did it -- the guard has to name the suite itself.
 *
 * How it detects a change: for every base table in `public`, one `count(*)`
 * and one digest -- `md5(string_agg(...))` over a per-row `md5(ROW(...)::text)`,
 * ordered, so it does not depend on the order rows come back in. Captured
 * before a test file's tests and captured again after. A count alone cannot
 * see a mutation: a test that flips `review_decision` on a real observation
 * leaves every count identical. The digest sees a deletion, a mutation and a
 * leftover insert with the same check, because any of them moves it.
 *
 * The watched set is every base table minus `EXEMPTIONS` below, which carries
 * a reason per entry. An exemption somebody had to write down is a decision; a
 * table nobody watched is a blind spot.
 *
 * Against an empty database every count is zero and every digest is equal, so
 * the guard is inert in CI -- green there for the right reason rather than by
 * accident.
 *
 * `tests/setup/corpus-guard-setup.js` takes the opening snapshot and
 * `tests/setup/corpus-guard-environment.js` makes the comparison; the split is
 * not decoration, and that first file says why.
 *
 * @fileoverview Fails any test file that leaves the database different.
 * @author Isaac Travers
 * @module tests/setup/corpus-guard
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../../model');

/**
 * Columns and tables that move for reasons that are not a defect.
 *
 * Each entry carries the reason it is here, because that is the difference
 * between a decision and a blind spot. `column: '*'` exempts a whole table.
 * Sequences are not rows and are out of scope -- they advance whenever
 * anything is inserted, by design.
 *
 * @constant
 * @type {Array<{table: string, column: string, reason: string}>}
 */
const EXEMPTIONS = [
    {
        table: 'service_tokens',
        column: 'last_used_at',
        reason: 'Bookkeeping. Moves because a test authenticated with the token, not because the'
            + ' row changed meaning.',
    },
    {
        table: 'service_clients',
        column: 'last_used_at',
        reason: 'Bookkeeping. Moves because a test authenticated as the client.',
    },
    {
        // #142 settled this as `users.last_used_at`; the column is actually
        // called `last_login_at`. Same reason, real name.
        table: 'users',
        column: 'last_login_at',
        reason: 'Bookkeeping. Moves because a test logged in as the user.',
    },
    {
        table: 'auth_sessions',
        column: '*',
        reason: "express-session's server-side store, written by connect-session-sequelize on"
            + ' every login and swept on its own expiration interval. Every suite logs in through'
            + ' tests/setup/authenticated-agent.js, so a row here records the login working'
            + ' rather than a test touching data. Not survey data, and nothing reads it after'
            + ' the run.',
    },
];

/**
 * Quotes an identifier for PostgreSQL, so a camelCase table such as
 * `metaInfos` is not folded to lower case.
 *
 * @param {string} name Identifier to quote.
 * @returns {string} The identifier, double-quoted and escaped.
 */
function quote(name) {
    return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Builds a sub-select alias that is a legal bare identifier, since a table
 * name may hold characters an unquoted alias cannot.
 *
 * @param {string} table Table name.
 * @returns {string} The alias.
 */
function alias(table) {
    return `snapshot_${table.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/**
 * Reads every watched table and the columns of it that are compared.
 *
 * Views are excluded: they hold no rows of their own, so a change visible in
 * one is already reported against the table underneath it.
 *
 * @param {Object} sequelize Shared Sequelize connection.
 * @returns {Promise<Array<{table: string, columns: string[]}>>} Watched tables.
 */
async function watchedTables(sequelize) {
    const rows = await sequelize.query(
        `SELECT c.table_name AS table_name, c.column_name AS column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema
            AND t.table_name = c.table_name
          WHERE c.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
          ORDER BY c.table_name, c.ordinal_position`,
        { type: QueryTypes.SELECT }
    );

    const exemptTables = new Set(
        EXEMPTIONS.filter((entry) => entry.column === '*').map((entry) => entry.table)
    );
    const exemptColumns = new Set(
        EXEMPTIONS
            .filter((entry) => entry.column !== '*')
            .map((entry) => `${entry.table}.${entry.column}`)
    );

    const byTable = new Map();

    for (const row of rows) {
        if (exemptTables.has(row.table_name)) {
            continue;
        }

        if (!byTable.has(row.table_name)) {
            byTable.set(row.table_name, []);
        }

        if (!exemptColumns.has(`${row.table_name}.${row.column_name}`)) {
            byTable.get(row.table_name).push(row.column_name);
        }
    }

    return [...byTable.entries()].map(([table, columns]) => ({ table, columns }));
}

/**
 * Captures one count and one digest per watched table, in a single query.
 *
 * One round trip rather than one per table: a suite already pays about eight
 * seconds for Jest's startup and its database connection, and the guard must
 * not add to that noticeably (R7).
 *
 * @param {Object} sequelize Shared Sequelize connection.
 * @param {Array<{table: string, columns: string[]}>} tables Watched tables.
 * @returns {Promise<Map<string, {count: string, digest: string}>>} The snapshot.
 */
async function capture(sequelize, tables) {
    if (tables.length === 0) {
        return new Map();
    }

    const parts = tables.map(({ table, columns }) => {
        // Every compared column of the row hashed as one value. A table whose
        // every column is exempt still has its row count compared.
        const rowDigest = columns.length
            ? `md5(ROW(${columns.map(quote).join(', ')})::text)`
            : "md5('')";

        // A sum over the first 64 bits of each row's md5, rather than an
        // ordered string_agg of the whole hashes. Summing is order-independent
        // without a sort, and measured on the 29,682-row keyframes table it is
        // 86 ms against 151 ms. sum(bigint) returns numeric, so it cannot
        // overflow. Two row sets summing alike is a 1-in-2^64 accident.
        return `SELECT ${sequelize.escape(table)} AS table_name,
                       count(*)::text AS row_count,
                       coalesce(
                         sum(('x' || substr(d, 1, 16))::bit(64)::bigint), 0
                       )::text AS digest
                  FROM (SELECT ${rowDigest} AS d FROM ${quote(table)}) ${alias(table)}`;
    });

    const rows = await sequelize.query(parts.join('\nUNION ALL\n'), { type: QueryTypes.SELECT });

    return new Map(
        rows.map((row) => [row.table_name, { count: row.row_count, digest: row.digest }])
    );
}

/**
 * Describes, in words, how two snapshots differ.
 *
 * The counts separate the three failures the digest collapses together: fewer
 * rows is a deletion, more rows is something created and not removed, and the
 * same count with a moved digest is a mutation.
 *
 * @param {Map<string, {count: string, digest: string}>} before Snapshot taken first.
 * @param {Map<string, {count: string, digest: string}>} after Snapshot taken last.
 * @returns {string[]} One line per table that changed; empty when nothing did.
 */
function differences(before, after) {
    const lines = [];

    for (const [table, was] of before) {
        const now = after.get(table);

        if (!now) {
            lines.push(`${table}: the table itself is gone`);
            continue;
        }

        if (was.count === now.count && was.digest === now.digest) {
            continue;
        }

        const wasCount = Number(was.count);
        const nowCount = Number(now.count);

        if (nowCount < wasCount) {
            lines.push(
                `${table}: ${wasCount - nowCount} row(s) deleted that the suite did not create`
                + ` (${wasCount} -> ${nowCount})`
            );
        } else if (nowCount > wasCount) {
            lines.push(
                `${table}: ${nowCount - wasCount} row(s) added and left behind`
                + ` (${wasCount} -> ${nowCount})`
            );
        } else {
            lines.push(`${table}: row(s) modified, count unchanged at ${nowCount}`);
        }
    }

    for (const table of after.keys()) {
        if (!before.has(table)) {
            lines.push(`${table}: a table that did not exist before the suite ran`);
        }
    }

    return lines;
}

/** The snapshot taken before a test file's tests. @type {Map|null} */
let opening = null;

/** The watched tables, resolved once per test file. @type {Array|null} */
let tables = null;

/**
 * Captures the opening snapshot. Called from `corpus-guard-open.js`.
 *
 * @returns {Promise<void>} Resolves once the snapshot is held.
 */
async function open() {
    tables = await watchedTables(db.sequelize);
    opening = await capture(db.sequelize, tables);
}

/**
 * Captures the closing snapshot and throws when it differs.
 *
 * Throwing from `afterAll` fails the test file, which is the point: a test that
 * leaves the database different is a failing test even when its assertions
 * passed. Exiting 0 on a known change is exactly how one deleted observation
 * and 358 leftover review rows went unnoticed for a whole run.
 *
 * @param {string} testPath Path of the test file, named in the failure.
 * @returns {Promise<void>} Resolves when nothing changed.
 * @throws {Error} When any watched table differs.
 */
async function close(testPath) {
    if (!opening) {
        return;
    }

    const closing = await capture(db.sequelize, tables);
    const changed = differences(opening, closing);

    // Cleared either way, so a second call cannot report the same drift twice.
    opening = null;

    if (changed.length === 0) {
        return;
    }

    throw new Error(
        `${testPath} changed the database.\n`
        + 'A test may create rows and must remove them, and may never modify or delete a row\n'
        + 'it did not create (#142). What changed:\n\n'
        + changed.map((line) => `  - ${line}`).join('\n')
        + '\n'
    );
}

module.exports = { open, close, differences, EXEMPTIONS };
