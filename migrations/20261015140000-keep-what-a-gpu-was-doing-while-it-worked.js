'use strict';

/**
 * Records what a machine's GPUs were doing *while they were working* (#104).
 *
 * MARP has had GPU telemetry all along and it has been useless for the one thing anybody
 * wants it for. A worker reports NVML on every `POST /gpu/poll`, and the coordinator stores
 * that reading against the attempt the poll opens -- which is the instant **before** the
 * machine starts. Measured over this database's own history: 6,789 attempts carry a real
 * reading spanning five weeks, and on the two days that ran two thousand jobs the average
 * GPU utilization in them is **0.5%**. A chart drawn from those numbers would show a farm
 * that is permanently idle, which is worse than no chart.
 *
 * So the reading has to come from the heartbeat, which is the only thing that happens while
 * work runs, and it needs somewhere to accumulate. That is this table.
 *
 * **One row per machine per minute, not per heartbeat.** A heartbeat goes every ten seconds,
 * so storing each one is six rows a minute per busy machine -- around 86,000 a day across a
 * modest pool, for a chart that cannot draw more than a pixel a minute anyway. `at` is
 * truncated to the minute and `(worker_id, at)` is unique, so the heartbeat upserts and the
 * rate limit is the schema's rather than a caller's to remember.
 *
 * **`devices` is the worker's own array**, stored as it arrives. The names are NVML's --
 * `gpu_utilization_percent`, `memory_used_bytes`, `temperature_c`, `power_usage_watts` --
 * and renaming them on the way in would make this the one place in MARP that calls them
 * something else, which `DESIGN.md` item 16 is entirely about.
 *
 * **`attempt_id` is nullable and `ON DELETE SET NULL`.** The reading is a fact about the
 * machine, not about the job: a sample should outlive the attempt that happened to be
 * running, and deleting an old job must not punch holes in the utilization history.
 *
 * No `guardDataIntegrity`: this creates a table and writes nothing to an existing one.
 *
 * @fileoverview Migration creating gpu_worker_samples.
 * @author Isaac Travers
 * @module migrations/keep-what-a-gpu-was-doing-while-it-worked
 */

/** @type {Object} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.createTable('gpu_worker_samples', {
                id: {
                    type: Sequelize.BIGINT,
                    allowNull: false,
                    autoIncrement: true,
                    primaryKey: true,
                    comment: 'Unique identifier for this sample.',
                },

                worker_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'gpu_workers', key: 'id' },
                    onDelete: 'CASCADE',
                    comment: 'The machine this reading came from.',
                },

                attempt_id: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    references: { model: 'gpu_job_attempts', key: 'id' },
                    onDelete: 'SET NULL',
                    comment: 'The attempt running when this was taken, where there was one. Nulled rather than cascaded: the reading is a fact about the machine and outlives the job.',
                },

                at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    comment: 'When the reading was taken, truncated to the minute. One row per machine per minute.',
                },

                devices: {
                    type: Sequelize.JSONB,
                    allowNull: false,
                    comment: 'The worker\'s own per-GPU array, field names included. NVML\'s names, not tidier ones.',
                },
            }, { transaction });

            // The rate limit, expressed as a constraint rather than as something a
            // caller has to remember: the heartbeat upserts onto this.
            await queryInterface.addIndex('gpu_worker_samples', ['worker_id', 'at'], {
                name: 'gpu_worker_samples_worker_minute_unique',
                unique: true,
                transaction,
            });

            // Every read of this table is "the pool, over a window", and the
            // retention sweep is a range delete on the same column.
            await queryInterface.addIndex('gpu_worker_samples', ['at'], {
                name: 'gpu_worker_samples_at_idx',
                transaction,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        await queryInterface.dropTable('gpu_worker_samples');
    },
};
