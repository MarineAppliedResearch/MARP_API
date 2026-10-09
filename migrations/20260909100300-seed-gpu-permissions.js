/**
 * Seeds the four permissions the GPU orchestration routes are gated on.
 *
 * Same shape and the same policy as
 * `20260901130000-seed-resource-permissions.js`: the vocabulary is decided once,
 * seeded whole, and granted to nobody. A permission that exists but is held by
 * nobody denies everything, which is the right default -- granting is a
 * deliberate act through the V2 users or tokens API.
 *
 * **Why a worker does not get `models:write`.** The existing `models:*` and
 * `datasets:*` keys are for humans curating the model registry. A worker holding
 * `models:write` could rewrite that registry, which is a much larger power than
 * "run the job I was given and report back". So a worker's token holds
 * `jobs:execute` and `jobs:write` and nothing else, and enrolment is separated
 * again into `workers:enrol` so a one-time bootstrap credential does not also
 * carry the right to execute work.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#3.
 *
 * @fileoverview Migration seeding the GPU orchestration permission keys.
 * @author Isaac Travers
 * @module migrations/seed-gpu-permissions
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * The four keys, with descriptions written for whoever is granting them --
 * these appear in the permission catalog the V2 users API serves.
 *
 * @constant
 * @type {Array<{key: string, description: string}>}
 */
const PERMISSIONS = [
    {
        key: 'workers:enrol',
        description: 'Enrol a GPU machine into the compute pool and report its hardware. Held by a worker\'s bootstrap credential. Deliberately separate from jobs:execute, so a credential that can join the pool cannot also take work.',
    },
    {
        key: 'jobs:execute',
        description: 'Poll for GPU work, take a lease on a job, and heartbeat while running it. This is what a GPU worker needs. It carries no power over the model registry or the survey data.',
    },
    {
        key: 'jobs:read',
        description: 'Read the GPU compute pool and the jobs queued, running and finished on it, including each attempt\'s progress. What the dashboard needs.',
    },
    {
        key: 'jobs:write',
        description: 'Submit and cancel GPU jobs, and report an attempt\'s events, results and artifacts. Held both by a person queueing work and by a worker reporting back on it.',
    },
];

/** @type {Object} */
module.exports = {
    /**
     * Inserts every key that is not already there.
     *
     * Written to skip existing keys rather than fail on them, so it is safe to
     * re-run.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once every permission exists.
     * @throws {Error} Re-throws after rolling back if any insert fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                // The catalog, plus both tables that grant from it -- a grant
                // disappearing would be the expensive mistake here.
                tables: ['permissions', 'user_permissions', 'service_token_permissions'],
                label: 'gpu-permissions',
                work: async () => {
                    const existing = await sequelize.query(
                        'SELECT key FROM permissions',
                        { type: QueryTypes.SELECT, transaction }
                    );
                    const alreadyThere = new Set(existing.map((row) => row.key));

                    const toInsert = PERMISSIONS.filter((permission) => !alreadyThere.has(permission.key));

                    if (toInsert.length > 0) {
                        await queryInterface.bulkInsert(
                            'permissions',
                            toInsert.map((permission) => ({
                                key: permission.key,
                                description: permission.description,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            })),
                            { transaction }
                        );
                    }

                    console.log(
                        `[gpu-permissions] ${toInsert.length} added, `
                        + `${PERMISSIONS.length - toInsert.length} already present`
                    );
                    console.log('[gpu-permissions] nothing was granted -- grant through the V2 users or tokens API');
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the four permissions.
     *
     * Deleting a permission cascades to its grants, so reversing this revokes
     * access rather than orphaning it -- which is why the grant tables are
     * declared as tables that may shrink.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the permissions are gone.
     * @throws {Error} Re-throws after rolling back if the delete fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['permissions', 'user_permissions', 'service_token_permissions'],
                mayShrink: ['permissions', 'user_permissions', 'service_token_permissions'],
                label: 'gpu-permissions-down',
                work: async () => {
                    await queryInterface.bulkDelete(
                        'permissions',
                        { key: PERMISSIONS.map((permission) => permission.key) },
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
};
