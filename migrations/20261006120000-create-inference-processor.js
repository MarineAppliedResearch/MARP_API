/**
 * Creates the "MARP Inference" processor and gives it the sessions inference wrote.
 *
 * The annotation GUI reaches a session through its processor, so a session with
 * no processor can only be found through View -> By Dive. Every session inference
 * has written so far has none. See `db/inference-processor.js`.
 *
 * **Which sessions move.** Only machine-made ones: no processor, at least one
 * observation, and a model recorded on every observation. Keyed on
 * `observations.ml_model_id` rather than `gpu_job_id` -- the GPU seeder leaves
 * `gpu_job_id` null by design and that foreign key is `SET NULL`, while the model
 * that wrote an observation is a fact about the data that stays. A session with
 * one hand-entered observation is left alone, and so is an empty one: neither is
 * evidence of who made it.
 *
 * In production no observation records a model, so the backfill matches nothing
 * there and only the account is created.
 *
 * Creating the account uses WHERE NOT EXISTS, the same as the bootstrap admin, so
 * a database that already has a user of this name keeps it.
 *
 * @fileoverview Migration creating the inference processor account.
 * @author Isaac Travers
 * @module migrations/create-inference-processor
 */

'use strict';

const { QueryTypes } = require('sequelize');
const { guardDataIntegrity } = require('../db/data-integrity');
const { INFERENCE_PROCESSOR_NAME, inferenceProcessorId } = require('../db/inference-processor');

/** @type {Object} */
module.exports = {
    /**
     * Creates the account if it is missing, then gives it every machine-made
     * session that has no processor.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the account exists and the sessions are assigned.
     * @throws {Error} Re-throws after rolling back if any statement fails or the
     * integrity guard finds a row lost.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'inference processor',
                tables: ['users', 'sessions'],
                work: async () => {
                    // Only `name` is supplied: `username` is nullable, since this
                    // account never logs in, and `status` defaults to 'active'.
                    await sequelize.query(
                        `INSERT INTO users (name, "createdAt", "updatedAt")
                         SELECT :name, NOW(), NOW()
                         WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = :name)`,
                        { replacements: { name: INFERENCE_PROCESSOR_NAME }, transaction }
                    );

                    const userId = await inferenceProcessorId(sequelize, transaction);

                    // NOT EXISTS for the hand-entered row, EXISTS for "has any
                    // observation at all": an empty session says nothing about
                    // who made it.
                    const moved = await sequelize.query(
                        `UPDATE sessions s
                            SET user_id = :userId, "updatedAt" = NOW()
                          WHERE s.user_id IS NULL
                            AND EXISTS (SELECT 1 FROM observations o
                                         WHERE o.session_id = s.session_id)
                            AND NOT EXISTS (SELECT 1 FROM observations o
                                             WHERE o.session_id = s.session_id
                                               AND o.ml_model_id IS NULL)
                          RETURNING s.session_id`,
                        { replacements: { userId }, type: QueryTypes.SELECT, transaction }
                    );

                    console.log(
                        `[inference processor] "${INFERENCE_PROCESSOR_NAME}" is user ${userId}; `
                        + `${moved.length} session(s) assigned to it.`
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
     * Gives every session the account owns back to no processor, then removes
     * the account.
     *
     * Sessions inference created after `up` go back to no processor as well,
     * which is the state they would have had without this migration.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the account and its assignments are gone.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'inference processor (down)',
                tables: ['users', 'sessions'],
                mayShrink: ['users'],
                work: async () => {
                    const [row] = await sequelize.query(
                        'SELECT user_id FROM users WHERE name = :name',
                        { replacements: { name: INFERENCE_PROCESSOR_NAME }, type: QueryTypes.SELECT, transaction }
                    );
                    if (!row) return;

                    await sequelize.query(
                        'UPDATE sessions SET user_id = NULL, "updatedAt" = NOW() WHERE user_id = :userId',
                        { replacements: { userId: row.user_id }, transaction }
                    );
                    await sequelize.query(
                        'DELETE FROM users WHERE user_id = :userId',
                        { replacements: { userId: row.user_id }, transaction }
                    );
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
