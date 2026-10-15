'use strict';

/**
 * Gives a GPU job a name of its own and the instant it finished (#104, gaps 24 and 25).
 *
 * **The name.** `GpuJobSpec` carries `engine`, `model`, `video`, `session`, `range`,
 * `params` and `reduction`, and nothing names the job. Every title the ML Dashboard shows
 * is composed from `spec.video.source_name`, which is why they read "SALT 2025 D0895 L4"
 * rather than anything a person chose, and why a job cannot be found again by what it was
 * called. A column rather than a field inside `spec`, because the job list has to search it
 * and searching inside a JSON blob means a functional index or a sequential scan.
 *
 * Nullable on purpose. A job submitted without a name has no name, and MARP does not
 * compose one -- a fallback invented here would be indistinguishable from a name somebody
 * chose, and the screens already know what their own column is for.
 *
 * **The finish time.** `gpu_jobs` had no terminal timestamp at all: `created_at`,
 * `updated_at`, and `finished_at` on the *attempt*. So "completed today" could only be
 * asked as "touched today", which is a different question -- a heartbeat, a retry or a
 * priority write all move `updated_at` on a job that finished last week.
 *
 * Existing terminal rows are backfilled from their last attempt's `finished_at`, falling
 * back to `updated_at` where a job reached a terminal state without one -- a job cancelled
 * before it was ever leased has no attempt to ask. Non-terminal rows stay NULL, which is
 * what they mean.
 *
 * No `guardDataIntegrity` here: this adds columns and fills one in place. It deletes
 * nothing, re-inserts nothing, and touches no foreign key, so there is no count to compare
 * and nothing to orphan.
 *
 * @fileoverview Migration adding gpu_jobs.name and gpu_jobs.finished_at.
 * @author Isaac Travers
 * @module migrations/a-job-gets-a-name-and-a-finish-time
 */

/** The states a job does not come back from. Mirrors TERMINAL_JOB_STATES in config/gpu-orchestration.js. */
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'expired'];

/** @type {Object} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('gpu_jobs', 'name', {
                type: Sequelize.STRING(255),
                allowNull: true,
                comment: 'What a person called this job. NULL when the submitter gave none; MARP never composes one.',
            }, { transaction });

            await queryInterface.addColumn('gpu_jobs', 'finished_at', {
                type: Sequelize.DATE,
                allowNull: true,
                comment: 'When the job reached a terminal state. NULL while it is still queued or running.',
            }, { transaction });

            // The last attempt is the one that ended the job, so its finish is the
            // job's. `updated_at` is the fallback for a job that ended without ever
            // being leased -- cancelled out of the queue, or expired waiting.
            await queryInterface.sequelize.query(
                `UPDATE gpu_jobs j
                    SET finished_at = COALESCE(
                            (SELECT max(a.finished_at)
                               FROM gpu_job_attempts a
                              WHERE a.job_id = j.id),
                            j.updated_at)
                  WHERE j.state IN (:terminal)
                    AND j.finished_at IS NULL`,
                { replacements: { terminal: TERMINAL }, transaction }
            );

            // The list sorts and filters on both of these, and on nothing else that
            // was not already indexed.
            await queryInterface.addIndex('gpu_jobs', ['finished_at'], {
                name: 'gpu_jobs_finished_at_idx',
                transaction,
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
            await queryInterface.removeIndex('gpu_jobs', 'gpu_jobs_finished_at_idx', { transaction });
            await queryInterface.removeColumn('gpu_jobs', 'finished_at', { transaction });
            await queryInterface.removeColumn('gpu_jobs', 'name', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
