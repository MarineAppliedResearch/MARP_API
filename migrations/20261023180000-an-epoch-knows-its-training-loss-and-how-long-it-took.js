'use strict';

/**
 * The training losses and the epoch's duration, which had nowhere to land.
 *
 * `epochs` has held one set of loss columns — `box_loss`, `cls_loss`, `dfl_loss` — and
 * they carry the **validation** losses, because `val/*` is what the worker has been
 * sending. Ultralytics reports training losses as a separate series, and the worker build
 * on `268-training-params-and-provenance` now sends those too, from `trainer.tloss`.
 *
 * **The gap between the two is the overfitting signal**, and it is the first thing an ML
 * reader looks for. Until now MARP could answer half of it: the dashboard's loss chart is
 * labelled *Validation loss* with a note saying the training split is not recorded,
 * because that was true.
 *
 * **Separate columns rather than overloading the existing three.** One column meaning
 * training loss on some rows and validation loss on others cannot be read at all — a
 * reader comparing two runs would be comparing two different quantities with no way to
 * tell. So `box_loss` keeps its meaning and `train_box_loss` is a new fact.
 *
 * **`duration_seconds` is not added; it has existed all along and nothing wrote it.** The
 * worker names the key `duration_seconds` deliberately so the mapping is identity. Same
 * for `start_time` and `end_time`, which stay null: the worker sends a duration, not two
 * instants, and deriving them from when MARP received the report would be inventing
 * precision that the arrival time does not have.
 *
 * **Three columns, and segmentation will need a fourth.** Ultralytics names its losses off
 * the criterion, so a segmentation run reports `train/seg_loss` as well — the worker's
 * contract says to match on the `train/` prefix rather than on a list of three. A `jsonb`
 * holding every loss by its reported name would survive that without a migration, and it
 * is deliberately not what this does: detection is the only task being trained, the
 * existing validation losses are flat columns, and a shape chosen now for a task nobody
 * has started would be guessing at both. The decision belongs with whoever builds
 * segmentation, with the data in front of them.
 *
 * Additive and reversible: three nullable columns, dropped again by `down`.
 *
 * @fileoverview Migration adding the per-epoch training losses to epochs.
 * @module migrations/an-epoch-knows-its-training-loss-and-how-long-it-took
 */

/** Column to what it holds, for the comments and for `down`. */
const COLUMNS = {
    train_box_loss: 'Mean training box loss over the epoch, from Ultralytics\' trainer.tloss. '
        + 'The box_loss column beside this one is the validation loss; the two are different '
        + 'quantities and the gap between them is the overfitting signal.',
    train_cls_loss: 'Mean training classification loss over the epoch. Null means the number '
        + 'did not exist -- tloss is None through a NaN-recovery epoch -- never zero.',
    train_dfl_loss: 'Mean training distribution-focal loss over the epoch. Null means not '
        + 'reported; a genuine 0.0 is stored as 0.0.',
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
