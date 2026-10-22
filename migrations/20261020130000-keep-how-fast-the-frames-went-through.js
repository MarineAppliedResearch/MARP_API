'use strict';

/**
 * Keeps an attempt's progress over time, so throughput can be drawn (#104, gap 18).
 *
 * The Inference screen is specified to show **frames processed per minute** against **queued
 * frames**. MARP has always known both numbers *now* -- `gpu_job_attempts.progress_done` is
 * overwritten by every heartbeat -- and has never kept them, so a rate could not be worked
 * out. A rate needs two readings.
 *
 * **Its own table rather than a column on `gpu_worker_samples`, because the grain differs.**
 * That table is one row per machine per minute and holds what the card was doing; progress
 * belongs to an *attempt*, and a machine with four slots runs four at once. Folding them
 * together would have made a four-slot worker report one slot's progress and silently drop
 * the rest.
 *
 * One row per attempt per minute, upserted, for the same reason the telemetry is: a
 * heartbeat every ten seconds is six rows a minute per attempt, and a chart cannot draw more
 * than a pixel a minute anyway.
 *
 * **Throughput is a delta, and deltas need care.** An attempt that restarts reports progress
 * from zero again, so a reader takes positive differences only -- a negative one is a new
 * attempt at the same work, not frames un-processed. That belongs in the query rather than
 * here, but it is the reason this stores a cumulative count rather than a rate: a rate
 * computed at write time cannot be re-bucketed afterwards.
 *
 * @fileoverview Migration creating gpu_attempt_progress.
 * @author Isaac Travers
 * @module migrations/keep-how-fast-the-frames-went-through
 */

/** @type {Object} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.createTable('gpu_attempt_progress', {
                id: {
                    type: Sequelize.BIGINT,
                    allowNull: false,
                    autoIncrement: true,
                    primaryKey: true,
                    comment: 'Unique identifier for this reading.',
                },

                attempt_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'gpu_job_attempts', key: 'id' },
                    onDelete: 'CASCADE',
                    comment: 'The attempt this reading is of. Cascades: progress has no meaning without the attempt it measured, unlike a GPU reading, which is a fact about the machine.',
                },

                at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    comment: 'When the reading was taken, truncated to the minute.',
                },

                progress_done: {
                    type: Sequelize.BIGINT,
                    allowNull: true,
                    comment: 'Units completed so far, cumulative. A rate is the difference between two of these, so what is stored is the count.',
                },

                progress_total: {
                    type: Sequelize.BIGINT,
                    allowNull: true,
                    comment: 'How many units the attempt expects in all, so what is left can be counted without reading the job spec.',
                },

                progress_unit: {
                    type: Sequelize.STRING(32),
                    allowNull: true,
                    comment: 'What is being counted, as the worker named it. Usually frames.',
                },

                job_kind: {
                    type: Sequelize.STRING(16),
                    allowNull: true,
                    comment: 'The kind of job, so throughput can be read for inference separately from training.',
                },
            }, { transaction });

            await queryInterface.addIndex('gpu_attempt_progress', ['attempt_id', 'at'], {
                name: 'gpu_attempt_progress_attempt_minute_unique',
                unique: true,
                transaction,
            });

            await queryInterface.addIndex('gpu_attempt_progress', ['at'], {
                name: 'gpu_attempt_progress_at_idx',
                transaction,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        await queryInterface.dropTable('gpu_attempt_progress');
    },
};
