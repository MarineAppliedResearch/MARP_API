'use strict';

/**
 * Where an epoch sat in its run, as elapsed seconds rather than as instants.
 *
 * `epochs` has carried `start_time` and `end_time` since it existed and nothing has ever
 * written them. The obvious fix was to have the worker send two timestamps, and that is
 * deliberately not what happened.
 *
 * **Isaac's decision, in his words:** *"Treat start_time and end_time as ordering and
 * duration only — valid within a run, never compared across machines."* So the worker
 * emits `start_offset_s` and `end_offset_s`, elapsed seconds since training began, and a
 * volunteer box with a drifting clock cannot put a wrong wall-clock time into the record.
 *
 * **Which is why these are new columns rather than the existing two.** `start_time` and
 * `end_time` are `timestamp with time zone`; an elapsed-seconds offset is not a time, and
 * writing one into a timestamp column would be a lie the type system would have let
 * through. They stay null and keep meaning what their type says.
 *
 * **Three properties the worker guarantees, and the storage keeps:**
 *
 * - `end_offset_s - start_offset_s` equals `duration_seconds` exactly. It is the
 *   trainer's own arithmetic recovered, not recomputed here.
 * - Both are omitted together when there is no duration. Half an interval is not a
 *   measurement, and `db/epoch-metrics.js` drops a lone one rather than storing it.
 * - Both are omitted entirely when there is no origin.
 *
 * **An offset can be placed on a wall clock later, and that is a presentation decision
 * rather than a storage one.** MARP stores the *worker's* timestamp on attempt events,
 * and the `on_train_start` settings report fires within microseconds of the origin being
 * set — so an offset plus that event's `at` puts an epoch on the same timeline as every
 * other event for the attempt, with no absolute instant from the worker and no claim
 * about skew. Nothing here depends on that, and it holds only while the coordinator keeps
 * storing the child's timestamp rather than its own receipt time. If that changes, the
 * anchor breaks silently, which is why it is written down here rather than relied on.
 *
 * Additive and reversible: two nullable columns, dropped again by `down`.
 *
 * @fileoverview Migration adding the per-epoch offsets to epochs.
 * @module migrations/an-epoch-knows-where-it-sat-in-the-run
 */

/** Column to what it holds. */
const COLUMNS = {
    start_offset_s: 'Seconds from the start of training to the start of this epoch. '
        + 'Elapsed time, not an instant: valid for ordering and duration within one run, '
        + 'never comparable across machines. Null when the run reported no origin.',
    end_offset_s: 'Seconds from the start of training to the end of this epoch. '
        + 'end_offset_s minus start_offset_s is duration_seconds exactly, because it is '
        + "the trainer's own arithmetic rather than a figure recomputed here.",
};

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            for (const [name, comment] of Object.entries(COLUMNS)) {
                await queryInterface.addColumn('epochs', name, {
                    type: Sequelize.DOUBLE,
                    allowNull: true,
                    comment,
                }, { transaction });
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            for (const name of Object.keys(COLUMNS)) {
                await queryInterface.removeColumn('epochs', name, { transaction });
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
