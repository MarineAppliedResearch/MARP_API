/**
 * Makes a GPU worker's durable machine-generated id its identity, and its name
 * editable metadata.
 *
 * Today it is the other way round, and that was measured rather than inferred:
 * `gpu_workers.name` is `UNIQUE` and is the column re-enrolment keys on, while
 * the `local_id` a worker generates once and sends on every enrolment has no
 * column to be stored in at all. So renaming a machine would fork its pool row
 * the next time it enrolled -- a second row for one machine, with the first still
 * holding whatever lease it had. `MARP_API#104` says the opposite: a worker has a
 * persistent generated identity that survives restart, and its human-readable
 * name is editable metadata.
 *
 * `local_id` is therefore `NOT NULL UNIQUE` and `name` loses its uniqueness. Two
 * machines that happen to share a hostname get a row each, which is what the
 * name's uniqueness was standing in for, and an operator can rename either
 * without the machine's next enrolment undoing it.
 *
 * **Existing rows are backfilled with `legacy-worker-<id>`.** They predate durable
 * identity and there is nothing to recover: a name carries at most an eight
 * character slice of the id the worker chose, which no full value can be rebuilt
 * from. The backfill only has to be a value no real worker will ever send, so
 * that such a machine's next enrolment opens a fresh row rather than adopting one
 * whose history belongs to something else. `legacy-worker-<id>` is deterministic,
 * cannot collide with the uuid a worker generates, and says what it is when a
 * human reads the row.
 *
 * Kept a plain string rather than a `UUID` column: the id is opaque to the
 * coordinator, and typing it as a uuid would refuse a worker whose identity
 * happens not to be one while buying nothing.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#3.
 *
 * @fileoverview Migration adding gpu_workers.local_id and dropping the uniqueness of gpu_workers.name.
 * @author Isaac Travers
 * @module migrations/give-a-gpu-worker-a-durable-identity
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Name of the constraint Postgres created for `name UNIQUE`, from
 * `createTable`'s `unique: true`.
 *
 * @constant
 * @type {string}
 */
const NAME_UNIQUE_CONSTRAINT = 'gpu_workers_name_key';

/**
 * Name of the constraint carrying `local_id`'s uniqueness. Added explicitly
 * rather than through `addColumn`'s `unique`, so `down` has a name to drop.
 *
 * @constant
 * @type {string}
 */
const LOCAL_ID_UNIQUE_CONSTRAINT = 'gpu_workers_local_id_key';

/** @type {Object} */
module.exports = {
    /**
     * Adds `local_id`, backfills it, makes it required and unique, and drops the
     * uniqueness of `name`.
     *
     * The column arrives nullable and is tightened afterwards rather than being
     * declared `NOT NULL` up front, because a `NOT NULL` column with no default
     * cannot be added to a table that already has rows.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once a worker's identity is its local_id.
     * @throws {Error} Re-throws after rolling back if anything fails, including
     * the integrity guard finding lost rows.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                // The attempts table is watched as well as the workers table:
                // every attempt points at a worker, and the whole point of this
                // migration is that a machine keeps one row rather than forking
                // into two. A worker row lost here would orphan its attempts.
                tables: ['gpu_workers', 'gpu_job_attempts'],
                label: 'gpu-worker-durable-id',
                work: async () => {
                    await queryInterface.addColumn(
                        'gpu_workers',
                        'local_id',
                        {
                            type: Sequelize.STRING(128),
                            allowNull: true,
                            comment: 'The durable id the machine generated for itself and sends on every enrolment. This, not the name, is the worker\'s identity: re-enrolment keys on it, so renaming a machine cannot fork its pool row.',
                        },
                        { transaction }
                    );

                    // Rows from before durable identity. Distinct per row and
                    // unmistakably not a real worker's id, which is all a backfill
                    // has to be -- such a machine's next enrolment supplies its own.
                    await sequelize.query(
                        `UPDATE "gpu_workers"
                            SET "local_id" = 'legacy-worker-' || "id"
                          WHERE "local_id" IS NULL`,
                        { transaction }
                    );

                    await sequelize.query(
                        'ALTER TABLE "gpu_workers" ALTER COLUMN "local_id" SET NOT NULL',
                        { transaction }
                    );

                    await sequelize.query(
                        `ALTER TABLE "gpu_workers"
                         ADD CONSTRAINT "${LOCAL_ID_UNIQUE_CONSTRAINT}" UNIQUE ("local_id")`,
                        { transaction }
                    );

                    // The reversal of the original design. Left non-unique rather
                    // than swapped for anything else: two machines called
                    // DESKTOP-1 are now two rows because their ids differ, and an
                    // operator renaming one to something clearer is not a
                    // collision waiting to happen.
                    await sequelize.query(
                        `ALTER TABLE "gpu_workers" DROP CONSTRAINT IF EXISTS "${NAME_UNIQUE_CONSTRAINT}"`,
                        { transaction }
                    );

                    // The pool view still sorts and searches by name, and it is no
                    // longer indexed now that the unique constraint is gone.
                    await queryInterface.addIndex('gpu_workers', ['name'], {
                        name: 'gpu_workers_name_idx',
                        transaction,
                    });

                    await sequelize.query(
                        `COMMENT ON COLUMN "gpu_workers"."name" IS
                         'What this machine is called, for people. Editable metadata rather than identity: not unique, and re-enrolment does not overwrite it.'`,
                        { transaction }
                    );
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Puts the uniqueness back on `name` and removes `local_id`.
     *
     * **Reversing this cannot keep two machines sharing a name**, because the
     * constraint being restored forbids it. Duplicates are suffixed with their
     * row id rather than deleted: a rename loses a label an operator chose, where
     * a delete would lose a machine's whole attempt history, and the column that
     * made the duplicate legitimate is going away in the same breath. Every rename
     * is printed, so a rollback says what it had to change.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the name is unique again.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['gpu_workers', 'gpu_job_attempts'],
                label: 'gpu-worker-durable-id-down',
                work: async () => {
                    // Oldest row of each name keeps it; the rest are suffixed.
                    // Done before the constraint goes back on, or adding it fails.
                    const [renamed] = await sequelize.query(
                        `UPDATE "gpu_workers" w
                            SET "name" = LEFT(w."name", 240) || '-' || w."id"
                          WHERE EXISTS (
                                SELECT 1 FROM "gpu_workers" other
                                 WHERE other."name" = w."name"
                                   AND other."id" < w."id")
                      RETURNING w."id", w."name"`,
                        { transaction }
                    );

                    for (const row of renamed) {
                        console.log(
                            `[gpu-worker-durable-id-down] worker ${row.id} renamed to "${row.name}" `
                            + 'so that gpu_workers.name can be unique again'
                        );
                    }

                    await sequelize.query(
                        `ALTER TABLE "gpu_workers"
                         ADD CONSTRAINT "${NAME_UNIQUE_CONSTRAINT}" UNIQUE ("name")`,
                        { transaction }
                    );

                    await sequelize.query(
                        `COMMENT ON COLUMN "gpu_workers"."name" IS
                         'What this machine calls itself. Unique, so a worker that restarts and enrols again is the same row rather than a second one.'`,
                        { transaction }
                    );
                },
            });

            // Outside the guard, though still inside this transaction. The guard
            // discovers the columns it watches up front and counts them again
            // afterwards, so dropping one mid-guard makes the second count fail on
            // a column that is no longer there. Dropping a column cannot lose a
            // row, which is what the guard exists to catch.
            await sequelize.query(
                `ALTER TABLE "gpu_workers" DROP CONSTRAINT IF EXISTS "${LOCAL_ID_UNIQUE_CONSTRAINT}"`,
                { transaction }
            );
            await queryInterface.removeIndex('gpu_workers', 'gpu_workers_name_idx', { transaction });
            await queryInterface.removeColumn('gpu_workers', 'local_id', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
