/**
 * Guards a data migration against losing or dereferencing rows.
 *
 * Written after the species list import, where the danger was concrete: 212,000
 * rows in `metrics_curves` point at `species.id`, and an import that had deleted
 * and re-inserted instead of updating in place would have orphaned all of them.
 * That was caught by checking afterwards, by hand, which only works if somebody
 * remembers to look.
 *
 * Wrap the body of a migration in {@link guardDataIntegrity} and it checks
 * itself: row counts before and after, how many foreign keys were actually
 * pointing at something, and whether anything ended up orphaned. Anything lost
 * throws, which rolls the migration back.
 *
 * The foreign keys are discovered from the database rather than listed by the
 * caller -- both the ones out of the named tables and the ones into them, since
 * a delete in one table is what orphans another. A caller cannot forget to
 * mention a relationship it does not know about.
 *
 * Deliberately outside `migrations/`, which the migrator globs for files to run.
 *
 * @fileoverview Before/after integrity checks for data migrations.
 * @author Isaac Travers
 * @module db/data-integrity
 */

'use strict';

/**
 * Find every foreign key into or out of the given tables.
 *
 * Both directions matter. Outbound catches this migration's own rows losing
 * their target; inbound catches this migration deleting a row that something
 * else depends on, which is the more expensive mistake.
 *
 * @async
 * @param {Object} sequelize - Sequelize instance.
 * @param {Array<string>} tables - Table names to examine.
 * @param {Object} [transaction] - Transaction to run inside.
 * @returns {Promise<Array<Object>>} `{ table, column, referencedTable, referencedColumn }`.
 */
async function discoverReferences(sequelize, tables, transaction) {
    const { QueryTypes } = sequelize.constructor;

    const rows = await sequelize.query(
        `SELECT child.relname       AS "table",
                child_col.attname  AS "column",
                parent.relname     AS "referencedTable",
                parent_col.attname AS "referencedColumn"
           FROM pg_constraint c
           JOIN pg_class child  ON child.oid  = c.conrelid
           JOIN pg_class parent ON parent.oid = c.confrelid
           JOIN unnest(c.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
           JOIN unnest(c.confkey) WITH ORDINALITY AS cfk(attnum, ord) ON cfk.ord = ck.ord
           JOIN pg_attribute child_col
                ON child_col.attrelid = c.conrelid AND child_col.attnum = ck.attnum
           JOIN pg_attribute parent_col
                ON parent_col.attrelid = c.confrelid AND parent_col.attnum = cfk.attnum
          WHERE c.contype = 'f'
            AND (child.relname IN (:tables) OR parent.relname IN (:tables))
          ORDER BY 1, 2`,
        { replacements: { tables }, type: QueryTypes.SELECT, transaction }
    );

    return rows;
}

/**
 * Count rows, live foreign keys and orphans for one moment in time.
 *
 * "Live" means the column is not null. A `SET NULL` cascade firing quietly is
 * exactly the kind of dereferencing that leaves row counts untouched and still
 * loses information, so it is counted separately from orphans.
 *
 * @async
 * @param {Object} sequelize - Sequelize instance.
 * @param {Array<string>} tables - Tables to count.
 * @param {Array<Object>} references - As returned by {@link discoverReferences}.
 * @param {Object} [transaction] - Transaction to run inside.
 * @returns {Promise<Object>} `{ rowCounts, liveReferences, orphans }`.
 */
async function captureSnapshot(sequelize, tables, references, transaction) {
    const { QueryTypes } = sequelize.constructor;

    /** @type {Object<string, number>} */
    const rowCounts = {};
    for (const table of tables) {
        const result = await sequelize.query(
            `SELECT COUNT(*)::int AS n FROM "${table}"`,
            { type: QueryTypes.SELECT, transaction }
        );
        rowCounts[table] = result[0].n;
    }

    /** @type {Object<string, number>} */
    const liveReferences = {};
    /** @type {Object<string, number>} */
    const orphans = {};

    for (const reference of references) {
        const key = `${reference.table}.${reference.column}`;

        const live = await sequelize.query(
            `SELECT COUNT(*)::int AS n FROM "${reference.table}" WHERE "${reference.column}" IS NOT NULL`,
            { type: QueryTypes.SELECT, transaction }
        );
        liveReferences[key] = live[0].n;

        const orphaned = await sequelize.query(
            `SELECT COUNT(*)::int AS n
               FROM "${reference.table}" child
              WHERE child."${reference.column}" IS NOT NULL
                AND NOT EXISTS (
                      SELECT 1 FROM "${reference.referencedTable}" parent
                       WHERE parent."${reference.referencedColumn}" = child."${reference.column}")`,
            { type: QueryTypes.SELECT, transaction }
        );
        orphans[key] = orphaned[0].n;
    }

    return { rowCounts, liveReferences, orphans };
}

/**
 * Compare two snapshots and describe what was lost.
 *
 * Inserting is never a problem, so only shrinkage is reported. Orphans that
 * already existed before are reported as pre-existing rather than blamed on the
 * migration -- otherwise a database with old inconsistencies could never be
 * migrated again.
 *
 * @param {Object} before - Snapshot from before the work.
 * @param {Object} after - Snapshot from after the work.
 * @param {Array<string>} [mayShrink] - Tables allowed to lose rows.
 * @returns {{problems: Array<string>, notes: Array<string>}} `problems` should
 * abort the migration; `notes` are worth printing but not failing over.
 */
function compareSnapshots(before, after, mayShrink = []) {
    /** @type {Array<string>} */
    const problems = [];
    /** @type {Array<string>} */
    const notes = [];

    for (const [table, count] of Object.entries(before.rowCounts)) {
        const now = after.rowCounts[table];
        if (now < count && !mayShrink.includes(table)) {
            problems.push(`${table}: ${count - now} row(s) deleted (${count} -> ${now})`);
        } else if (now < count) {
            notes.push(`${table}: ${count - now} row(s) deleted, which this migration declared it may do`);
        } else if (now > count) {
            notes.push(`${table}: ${now - count} row(s) added (${count} -> ${now})`);
        }
    }

    for (const [key, count] of Object.entries(before.liveReferences)) {
        const now = after.liveReferences[key];
        if (now < count) {
            problems.push(
                `${key}: ${count - now} reference(s) became null (${count} -> ${now}). `
                + 'Something dereferenced rows without deleting them, most likely an ON DELETE SET NULL.'
            );
        }
    }

    for (const [key, count] of Object.entries(after.orphans)) {
        const was = before.orphans[key] || 0;
        if (count > was) {
            problems.push(`${key}: ${count - was} row(s) now point at a parent that does not exist`);
        } else if (count > 0) {
            notes.push(`${key}: ${count} orphaned row(s), already there before this migration`);
        }
    }

    return { problems, notes };
}

/**
 * Run a migration's work between two integrity snapshots, and throw if anything
 * was lost.
 *
 * Throwing is the point: a migration wrapped in this either leaves the data
 * intact or does not apply at all, provided the caller runs it inside the same
 * transaction as its work.
 *
 * @async
 * @param {Object} options
 * @param {Object} options.sequelize - Sequelize instance.
 * @param {Object} options.transaction - Transaction the work runs in, so a failure rolls back.
 * @param {Array<string>} options.tables - Tables this migration touches, plus any it could affect indirectly.
 * @param {Array<string>} [options.mayShrink] - Tables this migration is allowed to delete from.
 * @param {string} [options.label] - Prefix for the log lines. Defaults to 'integrity'.
 * @param {Function} options.work - Async function performing the migration.
 * @returns {Promise<*>} Whatever `work` resolved to.
 * @throws {Error} If rows were deleted, dereferenced, or orphaned.
 */
async function guardDataIntegrity(options) {
    const {
        sequelize, transaction, tables, mayShrink = [], label = 'integrity', work,
    } = options;

    const references = await discoverReferences(sequelize, tables, transaction);
    const before = await captureSnapshot(sequelize, tables, references, transaction);

    console.log(
        `[${label}] before: `
        + Object.entries(before.rowCounts).map(([t, n]) => `${t}=${n}`).join(' ')
        + ` | ${references.length} foreign key(s) watched`
    );

    const result = await work();

    const after = await captureSnapshot(sequelize, tables, references, transaction);
    const { problems, notes } = compareSnapshots(before, after, mayShrink);

    for (const note of notes) {
        console.log(`[${label}] ${note}`);
    }

    if (problems.length > 0) {
        throw new Error(
            `Data integrity check failed, rolling back:\n  - ${problems.join('\n  - ')}`
        );
    }

    console.log(`[${label}] after: no rows deleted, dereferenced or orphaned`);

    return result;
}

module.exports = {
    discoverReferences,
    captureSnapshot,
    compareSnapshots,
    guardDataIntegrity,
};
