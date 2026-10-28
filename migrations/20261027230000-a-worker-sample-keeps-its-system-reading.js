'use strict';

/**
 * A per-minute worker sample keeps the machine's CPU, memory and disk, not only its GPUs.
 *
 * **Because there is nowhere else for them to live.** `gpu_workers.capabilities` holds a
 * system reading, but it is a snapshot overwritten on every poll — so a machine's CPU
 * right now is knowable and its CPU ten minutes ago is not, anywhere. Isaac asked for a
 * chart of memory, CPU and disk per worker; without this there is nothing to draw.
 *
 * **One `system` column rather than three, and not inside `devices`.** `devices` is an
 * array with one entry per GPU, and CPU, RAM and disk are facts about the machine rather
 * than about its first card — nesting them there would make a machine-level reading look
 * like a property of one device. A column per figure was the alternative and was
 * rejected: the worker owns the shape of its `resources` block, so every change it made
 * would become a migration here.
 *
 * **Nullable, and nothing is back-filled.** Every sample already stored was taken before
 * the worker sent these, and inventing a value for them would be worse than the gap. The
 * charts start empty and fill from the first sample after worker 0.1.10 and this land
 * together; a reader sees a gap, which is what actually happened.
 *
 * @fileoverview Migration adding `system` to `gpu_worker_samples`.
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable('gpu_worker_samples');

        if (table.system) return;

        await queryInterface.addColumn('gpu_worker_samples', 'system', {
            type: Sequelize.JSONB,
            allowNull: true,
            comment: 'The machine\'s own reading at this minute: cpu, memory and disk, as '
                + 'the worker sends them beside its GPU telemetry. Null for any sample '
                + 'taken before the worker reported them, and for a worker that does not.',
        });
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable('gpu_worker_samples');

        if (!table.system) return;

        await queryInterface.removeColumn('gpu_worker_samples', 'system');
    },
};
