'use strict';

/**
 * A session records who asked for it, and whether a machine produced it.
 *
 * Isaac, on what an inference run should leave behind: *"one dive can have individual
 * sessions, so this would just be a session for that dive. and we'd record it was the
 * automated and who ran it."*
 *
 * **Two facts, and `user_id` can only hold one of them.** That column already means *who
 * produced these observations* -- for a human session the annotator, and for an
 * automated one a service user. `user_id = 4008` is a user literally named "MARP
 * Inference" and it owns 76 of the 136 sessions on the development corpus and 114,887
 * observations. So "automated" is already recorded, as a convention rather than a
 * column, and that convention is load-bearing: pointing new automated sessions at the
 * human who pressed the button would silently destroy the only way to tell machine
 * output from hand annotation. `user_id` therefore does not move.
 *
 * **`created_by` is the other fact**: who *asked for* the run, carried from
 * `gpu_jobs.created_by`. Different from who produced it, and not derivable from it --
 * every automated session has the same producer and a different requester.
 *
 * **`is_automated` is stated rather than inferred**, for the same reason `ml_models.
 * is_base` is. "A service user owns it" is undocumented, unenforced, invisible in the
 * schema, and requires knowing which user ids are service accounts -- three of them look
 * like service users by their names alone, which is exactly the inference the rules here
 * say not to make.
 *
 * **Nothing is backfilled, by Isaac's decision: "None, new runs only."** So a `false` on
 * an existing session does **not** mean a human made it. It means the session predates
 * this column and nobody recorded either way. The 76 sessions owned by "MARP Inference"
 * are automated and will read `false` for ever, and any query treating `is_automated =
 * false` as "human" will be wrong about all of them. Read it as *automated and recorded
 * as such*.
 *
 * Additive and reversible: two nullable-or-defaulted columns, dropped again by `down`.
 *
 * @fileoverview Migration recording a session's requester and whether it was automated.
 * @module migrations/a-session-says-who-ran-it-and-whether-it-was-automated
 */

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'session provenance',
                tables: ['sessions', 'users'],
                work: async () => {

            await queryInterface.addColumn('sessions', 'created_by', {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'user_id' },
                onDelete: 'SET NULL',
                onUpdate: 'CASCADE',
                comment: 'The person who asked for this session, as opposed to user_id '
                    + 'which is who produced its observations. For an automated run they '
                    + 'differ by design: the producer is the service user the pipeline '
                    + 'runs as, and this is whoever submitted the job, carried from '
                    + 'gpu_jobs.created_by. Null on a session nobody requested through a '
                    + 'job, which is every session predating this column.',
            }, { transaction });

            await queryInterface.addColumn('sessions', 'is_automated', {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: 'True when a machine produced this session rather than a person. '
                    + 'Stated rather than inferred from user_id pointing at a service '
                    + 'account, which is a convention nothing enforces and the schema '
                    + 'does not show. NOT BACKFILLED, by decision: false means "not '
                    + 'recorded as automated", NOT "made by a human". Every session '
                    + 'created before this column reads false, including the 76 owned by '
                    + 'the "MARP Inference" service user which carry 114,887 machine '
                    + 'observations between them. Any query reading false as human will '
                    + 'be wrong about all of those.',
            }, { transaction });
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            for (const name of ['is_automated', 'created_by']) {
                await queryInterface.removeColumn('sessions', name, { transaction });
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
