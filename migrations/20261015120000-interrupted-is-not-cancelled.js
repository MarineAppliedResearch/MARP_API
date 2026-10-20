'use strict';

/**
 * `interrupted` as a job state, distinct from `cancelled` (#257).
 *
 * `cancelled` meant two things: a human changing their mind, and a job that
 * stopped part-way leaving frames nobody did. Nothing could act on it, because
 * requeueing the first kind redoes work nobody wanted and not requeueing the
 * second leaves a hole in the record that no query could find.
 *
 * Job 14372 is the worked example: twelve thousand frames processed, the rest
 * never done, recorded as though nobody had wanted them.
 *
 * **Existing rows are left alone.** Every `cancelled` job stays `cancelled`.
 * The two meanings cannot be told apart in the old rows -- that is the whole
 * problem -- so guessing would invent a record rather than recover one. The
 * distinction starts here, which is sound because this is development data and
 * production has not used GPU orchestration.
 */
const CONSTRAINT = 'gpu_jobs_state_check';

const WITH_INTERRUPTED = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'interrupted', 'expired'];
const WITHOUT = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired'];

/**
 * Rewrite the state check to the given set of states.
 *
 * @param {Object} queryInterface - Sequelize query interface.
 * @param {Array<string>} states - The states to allow.
 * @returns {Promise<void>} Resolves once rewritten.
 */
async function setStates(queryInterface, states) {
    const list = states.map((state) => `'${state}'`).join(', ');

    await queryInterface.sequelize.query(
        `ALTER TABLE gpu_jobs DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`
    );
    await queryInterface.sequelize.query(
        `ALTER TABLE gpu_jobs ADD CONSTRAINT ${CONSTRAINT} CHECK (state::text = ANY (ARRAY[${list}]::text[]))`
    );
}

module.exports = {
    async up(queryInterface) {
        await setStates(queryInterface, WITH_INTERRUPTED);
    },

    /**
     * Put the old check back.
     *
     * Any job left `interrupted` becomes `cancelled`, because that is where it
     * would have been without this migration and the constraint cannot be
     * narrowed while a row violates it. The frames stay owed; the record simply
     * stops being able to say so, which is the state this migration fixes.
     */
    async down(queryInterface) {
        await queryInterface.sequelize.query(
            "UPDATE gpu_jobs SET state = 'cancelled' WHERE state = 'interrupted'"
        );
        await setStates(queryInterface, WITHOUT);
    },
};
