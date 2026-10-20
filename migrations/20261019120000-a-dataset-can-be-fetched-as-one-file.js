'use strict';

/**
 * Lets a dataset be fetched as one file, so a worker on another machine can train on it.
 *
 * `datasets` describes what is in a dataset -- `num_samples`, `num_classes`, `status` --
 * and `location` says where it is, but `location` holds whatever the legacy builder wrote,
 * which is an absolute path on the computer that built it:
 * `C:\\Users\\...\\datasets\\rockfish5`. That is not something a second machine can fetch,
 * and it is not something MARP can serve.
 *
 * So a packaged dataset gets three columns of its own rather than more meanings for
 * `location`. Overloading that column was the alternative and it is the worse one: existing
 * rows would keep holding build-machine folder paths while new ones held something servable,
 * and nothing in the column would say which kind a given row was.
 *
 * **Why the hash is a column and not derived from the path.** A worker verifies the archive
 * before unpacking it, so the hash is part of the job spec the coordinator builds. Parsing
 * it back out of a filename would make the filename load-bearing -- rename the file and the
 * verification silently changes meaning.
 *
 * All three are nullable, because a dataset that nobody has packaged has no archive. That
 * is the normal state for every row that exists today, and `archive_sha256 IS NULL` is the
 * honest way to ask whether a dataset can be trained on remotely.
 *
 * This is deliberately the small version. The general answer is the file server in
 * `MarineAppliedResearch/MARP_API#120`, which will own where bytes live and how they are
 * served for pictures, models and artifacts alike; these columns say what a dataset's
 * archive *is*, which that work needs either way.
 *
 * No `guardDataIntegrity`: this adds three nullable columns and backfills nothing. It
 * deletes no row, re-inserts no row and touches no foreign key, so there is no count to
 * compare and nothing to orphan.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#67, #120.
 *
 * @fileoverview Migration adding the archive columns to datasets.
 * @author Isaac Travers
 * @module migrations/a-dataset-can-be-fetched-as-one-file
 */

/** @type {Object} */
module.exports = {
    /**
     * Adds `archive_path`, `archive_sha256` and `archive_bytes` to `datasets`.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @param {Object} Sequelize - Sequelize data types.
     * @returns {Promise<void>} Resolves when the columns exist.
     */
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('datasets', 'archive_path', {
                type: Sequelize.STRING(512),
                allowNull: true,
                comment:
                    'Where the packaged archive sits, relative to the API storage root '
                    + '(for example "datasets/<sha256>.tar"). NULL when the dataset has '
                    + 'never been packaged. Deliberately relative: the storage root moves '
                    + 'when the file server takes over, and the rows must not.',
            }, { transaction });

            await queryInterface.addColumn('datasets', 'archive_sha256', {
                type: Sequelize.STRING(64),
                allowNull: true,
                comment:
                    'sha256 of the archive, lower-case hex. Travels in the job spec and is '
                    + 'what the worker verifies before unpacking, so a truncated download '
                    + 'cannot become a training run that learned from half a dataset.',
            }, { transaction });

            await queryInterface.addColumn('datasets', 'archive_bytes', {
                type: Sequelize.BIGINT,
                allowNull: true,
                comment:
                    'Size of the archive in bytes. Lets a worker report fetch progress and '
                    + 'refuse a dataset larger than its free disk before starting.',
            }, { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the three columns.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when they are gone.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeColumn('datasets', 'archive_bytes', { transaction });
            await queryInterface.removeColumn('datasets', 'archive_sha256', { transaction });
            await queryInterface.removeColumn('datasets', 'archive_path', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
