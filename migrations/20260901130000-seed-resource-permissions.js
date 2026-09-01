/**
 * Seeds the permission vocabulary for survey data.
 *
 * Until now the catalog held exactly one key, `admin`, which is all-or-nothing:
 * reading a species list required the same permission as resetting somebody's
 * password. Every V1 route checked nothing at all, so the question never arose.
 *
 * The whole vocabulary is seeded here rather than one key per route family as
 * they are converted. Deciding the shape once is much cheaper than discovering
 * halfway through that `observations:write` should have been
 * `observations:create` and `observations:update` -- by which point tokens have
 * been issued against the wrong names.
 *
 * Shape: `<resource>:<action>`, with `read` and `write` per resource. Coarser than
 * per-route, finer than one key for everything. `write` covers create, update and
 * delete together: nothing in this API has a caller who may create but not
 * delete, and splitting for its own sake means three keys nobody distinguishes.
 *
 * `admin` is untouched and stays what it is -- the key for administering the API
 * itself, not for reading survey data.
 *
 * Refs #50.
 *
 * @fileoverview Migration seeding the per-resource permission vocabulary.
 * @author Isaac Travers
 * @module migrations/seed-resource-permissions
 */

'use strict';

/**
 * The vocabulary. One entry per permission, description written for whoever is
 * granting it rather than for whoever implemented it -- these appear in the
 * permission catalog that the V2 users API serves.
 *
 * @constant
 * @type {Array<{key: string, description: string}>}
 */
const PERMISSIONS = [
    {
        key: 'species:read',
        description: 'Read the annotation species lists and their pictures. Needed by anything that offers species for annotation.',
    },
    {
        key: 'species:write',
        description: 'Add, edit and retire species list entries, and upload or remove their pictures.',
    },
    {
        key: 'observations:read',
        description: 'Read recorded observations, including their keyframes.',
    },
    {
        key: 'observations:write',
        description: 'Record, change and delete observations. This is what an annotator needs.',
    },
    {
        key: 'keyframes:read',
        description: 'Read the frame-level annotation boxes belonging to observations.',
    },
    {
        key: 'keyframes:write',
        description: 'Draw, move and delete annotation boxes.',
    },
    {
        key: 'sessions:read',
        description: 'Read sessions, and browse them by project, dive or processor.',
    },
    {
        key: 'sessions:write',
        description: 'Create, change and delete sessions.',
    },
    {
        key: 'projects:read',
        description: 'Read projects and their dives.',
    },
    {
        key: 'projects:write',
        description: 'Create, change and delete projects.',
    },
    {
        key: 'datasets:read',
        description: 'Read curated machine-learning datasets and their contents.',
    },
    {
        key: 'datasets:write',
        description: 'Create and change datasets, and choose which observations they include.',
    },
    {
        key: 'models:read',
        description: 'Read machine-learning models, training runs, metrics and artifacts.',
    },
    {
        key: 'models:write',
        description: 'Register models and record training runs, metrics and artifacts.',
    },
    {
        key: 'reports:read',
        description: 'Read aggregate reporting: dashboards, video summaries and per-user time. Separate from observations:read because it exposes who did how much work.',
    },
    {
        key: 'users:read',
        description: 'Read the list of people, so a client can show who processed something. Does not include credentials or permissions, which are admin.',
    },
];

/** @type {Object} */
module.exports = {
    /**
     * Inserts every permission in {@link PERMISSIONS} that is not already there.
     *
     * Written to skip existing keys rather than fail on them, so it is safe to
     * re-run and so a database that already has one of these by hand is not a
     * blocker.
     *
     * Grants nothing. A permission that exists but is held by nobody denies
     * everything, which is the right default -- granting is a deliberate act
     * through the V2 users API.
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

            const skipped = PERMISSIONS.length - toInsert.length;

            console.log(
                `[permissions] ${toInsert.length} added, ${skipped} already present; `
                + `catalog now holds ${alreadyThere.size + toInsert.length} keys`
            );
            console.log('[permissions] nothing was granted -- grant through the V2 users API');

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the permissions this migration added.
     *
     * Deleting a permission cascades to its grants through the `user_permissions`
     * foreign key, so reversing this revokes access rather than orphaning it.
     * `admin` is never touched.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the permissions are gone.
     * @throws {Error} Re-throws after rolling back if the delete fails.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.bulkDelete(
                'permissions',
                { key: PERMISSIONS.map((permission) => permission.key) },
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
