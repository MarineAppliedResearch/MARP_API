'use strict';

/**
 * Hand `observations.observation_id` back to its own sequence (#62).
 *
 * The column has always carried `DEFAULT nextval('observations_observation_id_seq')`
 * and the model has always declared `autoIncrement`. Neither was ever reached,
 * because `repository/observation.repository.js` read `max(observation_id)` and
 * added one on every create. Two things followed:
 *
 * - **A race.** A read and a write with no lock between them, so two overlapping
 *   creates computed the same maximum and the second collided on the primary key.
 * - **A sequence that drifts for ever.** Never consulted, never advanced. Measured
 *   at **10,478 behind** the table on 2026-09-19, having been recorded as 3 behind
 *   when #62 was written.
 *
 * The drift is invisible while every insert goes through that one method, and fatal
 * to anything that does not -- a `Model.create()`, a bulk import, a restore. It was
 * failing 141 of 274 mosaic tests and every test in the dataset cascade suite, in
 * both cases inside a helper that inserted with the column default.
 *
 * **This migration is the half that cannot be done in code.** Stopping the
 * repository from assigning the id is useless on its own: the very next insert would
 * take `nextval`, get a value that already exists, and fail -- 10,478 times over
 * here, and by whatever production's own gap turns out to be, since production has
 * never advanced this sequence either.
 *
 * So the sequence is moved up to the table's maximum first. That changes no row, it
 * is safe to run twice, and it **never moves the sequence backwards** -- a sequence
 * legitimately runs ahead of the table when an insert is rolled back, and winding it
 * back would hand out a number a concurrent insert may already hold.
 *
 * `obsID` and `PobsID` are assigned in the same method and are deliberately left
 * alone: they are per-session and per-project numbering rather than primary keys,
 * and no sequence owns them.
 *
 * **There is no meaningful `down`.** The sequence position is not state anybody can
 * want restored -- putting it back where it was would only recreate the collisions.
 * The down is therefore a no-op that says so rather than a lie that looks reversible.
 *
 * @fileoverview Advances the observations sequence so the database can assign ids.
 * @author Isaac Travers
 * @module migrations/observations-sequence-owns-its-ids
 */

module.exports = {
    /**
     * Advance the sequence to the table's maximum.
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

        // An empty table has no maximum to set to, and setval(0) is rejected.
        // Nothing to do: a fresh database's sequence already starts at 1.
        if (Number(before.max_id) === 0) {
            console.log('[observations sequence] table is empty; the sequence is already correct');

            return;
        }

        // **Never backwards.** `GREATEST` because the sequence can legitimately be
        // ahead of the table -- a rolled-back insert or a failed create consumes a
        // value and does not return it -- and winding it back would hand out numbers
        // a concurrent insert may already have taken between the read and the write.
        // Only the gap in the other direction is the defect.
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
     * Deliberately nothing. See this file's header.
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
