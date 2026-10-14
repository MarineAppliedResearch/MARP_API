/**
 * Compares every table of two databases: row count, and a fingerprint of the
 * columns the first database has.
 *
 * Written for the production upgrade, where `before` is a copy of production as it
 * stood and `after` the same copy migrated. Fingerprinting only the columns `before`
 * has means a column a migration added does not count as a change, so a table whose
 * existing data is untouched reads `same` even though it gained columns.
 *
 * Usage, from the repository root (it reads the connection from `.env`, as the API does):
 *   node scripts/compare-databases.js mare_v1 mare_v1_next
 *
 * Read-only on both databases. Exits 0 whatever it finds: deciding whether a
 * difference is expected is the reader's job, and the upgrade runbook lists the
 * expected ones.
 *
 * @fileoverview Table-by-table comparison of two databases.
 * @author Isaac Travers
 * @module scripts/compare-databases
 */

'use strict';

require('dotenv').config();

const { Client } = require('pg');

/**
 * Connection settings for one database, from the same `DB_*` variables the API reads.
 *
 * @param {string} database - Database name.
 * @returns {Object} pg client configuration.
 */
function connectionFor(database) {
    return {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database,
    };
}

/**
 * Row count and fingerprint of one table, over the given columns.
 *
 * Each row is hashed and the hashes sorted before they are combined, so row order
 * on disk does not matter.
 *
 * @async
 * @param {Object} client - Connected pg client.
 * @param {string} table - Table name.
 * @param {string} columns - Comma-separated, already-quoted column list.
 * @returns {Promise<{n: string, fingerprint: string}>}
 */
async function fingerprint(client, table, columns) {
    const { rows } = await client.query(
        `SELECT count(*)::bigint AS n,
                md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS fingerprint
           FROM (SELECT md5(row(${columns})::text) AS h FROM public.${JSON.stringify(table)}) x`
    );

    return rows[0];
}

/**
 * Compares the two databases named on the command line and prints one line per table.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const [beforeName, afterName] = process.argv.slice(2);

    if (!beforeName || !afterName) {
        console.error('Usage: node scripts/compare-databases.js <before database> <after database>');
        process.exit(2);
    }

    const before = new Client(connectionFor(beforeName));
    const after = new Client(connectionFor(afterName));
    await before.connect();
    await after.connect();

    try {
        const tables = (await before.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`
        )).rows.map((row) => row.table_name);

        const lines = [];

        for (const table of tables) {
            // quote_ident, so mixed-case columns such as "createdAt" survive.
            const { rows } = await before.query(
                `SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) AS columns
                   FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = $1`,
                [table]
            );

            const a = await fingerprint(before, table, rows[0].columns);
            let b;
            try {
                b = await fingerprint(after, table, rows[0].columns);
            } catch (error) {
                lines.push(`MISSING          ${table.padEnd(30)} ${error.message}`);
                continue;
            }

            const verdict = a.n === b.n && a.fingerprint === b.fingerprint ? 'same'
                : a.n === b.n ? 'CONTENT CHANGED' : 'COUNT CHANGED';

            lines.push(`${verdict.padEnd(16)} ${table.padEnd(30)} ${String(a.n).padStart(9)} -> ${b.n}`);
        }

        console.log(`Comparing ${beforeName} (before) with ${afterName} (after) on ${process.env.DB_HOST}\n`);
        console.log(lines.sort().join('\n'));
    } finally {
        await before.end();
        await after.end();
    }
}

main().catch((error) => {
    console.error(`compare-databases failed: ${error.message}`);
    process.exit(1);
});
