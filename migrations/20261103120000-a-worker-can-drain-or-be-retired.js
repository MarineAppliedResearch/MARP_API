'use strict';

/**
 * A worker can be draining or retired.
 *
 * #319. The dashboard can now pause a machine now, drain it (finish the running job and
 * take no more), resume it, or retire it (take no work and leave the pool list, keeping
 * its history and token). `paused` existed; `draining` and `retired` are new, and the
 * state column is held to its vocabulary by a check constraint, which this widens.
 *
 * Adds two allowed values and changes no row. `down` narrows it again, and refuses while
 * a row holds a value it would no longer allow.
 *
 * @fileoverview Migration widening gpu_workers_state_check.
 * @module migrations/a-worker-can-drain-or-be-retired
 */

const BEFORE = ['online', 'offline', 'paused'];
const AFTER = ['online', 'offline', 'paused', 'draining', 'retired'];

const quoted = (values) => values.map((value) => `'${value}'`).join(', ');

/**
 * Replace the check constraint with one allowing `states`.
 *
 * @param {Object} queryInterface - Sequelize's.
 * @param {string[]} states - The allowed values.
 * @returns {Promise<void>}
 */
async function allow(queryInterface, states) {
    await queryInterface.sequelize.transaction(async (transaction) => {
        await queryInterface.sequelize.query(
            'ALTER TABLE gpu_workers DROP CONSTRAINT IF EXISTS gpu_workers_state_check', { transaction });
        await queryInterface.sequelize.query(
            `ALTER TABLE gpu_workers ADD CONSTRAINT gpu_workers_state_check CHECK (state IN (${quoted(states)}))`,
            { transaction });
    });
}

module.exports = {
    async up(queryInterface) {
        await allow(queryInterface, AFTER);
    },

    async down(queryInterface) {
        await allow(queryInterface, BEFORE);
    },
};
