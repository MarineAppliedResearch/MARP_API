'use strict';

/**
 * Move `observations_observation_id_seq` up to the table again (#62).
 *
 * `20260919090000-observations-sequence-owns-its-ids` did this once and moved
 * `observation.repository.js` onto the sequence. The GPU ingest was left assigning
 * `max(observation_id) + 1`, so every GPU run since grew the table without advancing
 * the sequence -- 96,670 behind on the development database on 2026-09-24 -- and every
 * create through the API or the GUI collided on the primary key.
 *
 * The ingest takes `nextval` now, so this is the last time the gap can open. The same
 * rules as the first time: no row changes, safe to run twice, **never backwards**, and
 * no meaningful `down`. That migration's header has the reasons.
 *
 * @fileoverview Advances the observations sequence past the GPU ingest's rows.
 * @author Isaac Travers
 * @module migrations/observations-sequence-catches-up-with-the-ingest
 */

module.exports = {
    /**
     * Advance the sequence to the table's maximum, if it is behind.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when the sequence is correct.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        const [[before]] = await sequelize.query(
            `SELECT (SELECT COALESCE(max(observation_id), 0) FROM observations) AS max_id,
                    (SELECT last_value FROM observations_observation_id_seq) AS seq`
        );

        // setval(0) is rejected, and an empty table's sequence is already right.
        if (Number(before.max_id) === 0) {
            console.log('[observations sequence] table is empty; the sequence is already correct');

            return;
        }

        await sequelize.query(
            `SELECT setval('observations_observation_id_seq',
                           GREATEST(
                               (SELECT max(observation_id) FROM observations),
                               (SELECT last_value FROM observations_observation_id_seq)
                           ),
                           true)`
        );

        const [[after]] = await sequelize.query(
            'SELECT last_value FROM observations_observation_id_seq'
        );

        console.log(
            `[observations sequence] max_id ${before.max_id}, sequence ${before.seq} -> `
            + `${after.last_value}. The next observation takes ${Number(after.last_value) + 1}.`
        );
    },

    /**
     * Deliberately nothing: moving the sequence back only recreates the collisions.
     *
     * @async
     * @returns {Promise<void>} Resolves immediately.
     */
    async down() {
        console.log(
            '[observations sequence] down is a no-op: moving the sequence backwards would '
            + 'only reintroduce the primary key collisions this fixed.'
        );
    },
};
