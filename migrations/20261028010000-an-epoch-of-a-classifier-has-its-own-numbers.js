/**
 * An epoch of a classification run records what a classifier actually reports.
 *
 * **A classifier's loss is not a detector's `cls_loss`, and that is the whole reason for
 * new columns.** In a detector, `cls_loss` is one of three components of a composite
 * loss, alongside box and distribution-focal. A classifier has one loss, full stop.
 * Writing it into `cls_loss` would make that column mean a component on some rows and a
 * total on others, with nothing on the row to say which -- unreadable afterwards, and
 * exactly the kind of ambiguity this table has already been repaired for once.
 *
 * **The names come from a real run, not from a description.** A two-epoch classify run,
 * captured through the worker's own `_epoch_metrics`:
 *
 *     metrics/accuracy_top1   0.5
 *     metrics/accuracy_top5   1.0
 *     train/loss              0.61144
 *     val/loss                0.6933
 *
 * Ultralytics' own `results.csv` header from the same run agrees. That matters because
 * five of seven metric columns on this table were null on every row MARP held for months,
 * from a mapping that looked for `train/box_loss` where the worker sends `val/box_loss`
 * -- and the fixture agreed with the code rather than with the trainer, so nothing caught
 * it.
 *
 * **There is a correction inside that evidence worth keeping.** The first probe reported
 * that classification has no validation loss at all. It does. That probe ran a single
 * epoch and kept the last callback, and with `epochs=1` Ultralytics fires a second
 * callback after `final_eval()` revalidates the best weights -- which runs the validator
 * without a trainer, so there is no loss accumulator and `val/loss` is absent from that
 * call only. "Absent from the call I happened to keep" became "absent from
 * classification". A capture that keeps the wrong call produces a confident falsehood
 * with evidence attached, which is harder to doubt than a guess. The worker's epoch guard
 * drops that extra call, so it never reaches MARP.
 *
 * **Named by this table's existing convention: unprefixed is validation.** `box_loss` is
 * `val/box_loss` and `train_box_loss` is `train/box_loss`, so `loss` is `val/loss` and
 * `train_loss` is `train/loss`. A reader who knows one knows the other.
 *
 * **`loss` rather than `classify_loss`**, because the column records the single total
 * loss of a run that reports one, and a task name in the column would have to be joined
 * by another the next time a single-loss task appears. Null on a detection run, which
 * reports three components and no total -- and a total summed here would be arithmetic
 * dressed as a measurement.
 *
 * **The accuracies are named exactly as `metrics_summary` names them.** That table gained
 * `accuracy_top1` and `accuracy_top5` for the end-of-run figures; two names for one
 * quantity at two granularities is how a reader ends up believing they are two
 * quantities.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration adding the classification per-epoch columns to epochs.
 * @module migrations/an-epoch-of-a-classifier-has-its-own-numbers
 */

/** Column to the comment that says what it holds and what null means. */
const COLUMNS = {
    loss: 'Mean validation loss over this epoch, for a task that reports a single loss -- a classifier does. Null on a detection run, which reports box, classification and distribution-focal losses separately and no total. Deliberately not cls_loss: that is one component of a composite detection loss, and one column meaning a component on some rows and a total on others could not be read at all.',
    train_loss: 'Mean training loss over this epoch, against the validation loss in loss. The gap between the two is the overfitting signal.',
    accuracy_top1: 'Share of validation images whose top prediction was correct, at the end of this epoch. Named as metrics_summary names the end-of-run figure, because two names for one quantity at two granularities reads as two quantities.',
    accuracy_top5: 'Share of validation images whose correct class was among the top five predictions, at the end of this epoch. On a catalogue with few classes this saturates at 1.0 early and says little; it is kept because the trainer reports it and a run that stops reporting it should be visibly different from one measuring zero.',
};

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `ALTER TABLE epochs
                   ADD COLUMN IF NOT EXISTS loss            DOUBLE PRECISION,
                   ADD COLUMN IF NOT EXISTS train_loss      DOUBLE PRECISION,
                   ADD COLUMN IF NOT EXISTS accuracy_top1   DOUBLE PRECISION,
                   ADD COLUMN IF NOT EXISTS accuracy_top5   DOUBLE PRECISION`,
                { transaction }
            );

            /* **Double precision, not integer or numeric.** The accuracies are fractions
               -- 0.873 in an integer column reports a perfect classifier -- and the losses
               are the same floats the detector's columns already hold. */
            for (const [column, comment] of Object.entries(COLUMNS)) {
                await sequelize.query(
                    `COMMENT ON COLUMN epochs.${column} IS '${comment}'`,
                    { transaction }
                );
            }

            /* **Nothing is backfilled, and there is nothing to backfill.** No
               classification run has been trained, so every existing epoch row belongs to
               a detector and its four new columns are null because those quantities were
               never measured -- which is what null means here. */

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            const [rows] = await sequelize.query(
                `SELECT count(*)::int AS n FROM epochs
                  WHERE loss IS NOT NULL OR train_loss IS NOT NULL
                     OR accuracy_top1 IS NOT NULL OR accuracy_top5 IS NOT NULL`,
                { transaction }
            );

            /* Said rather than silently dropped: these are measurements, and the events
               they were read from are the only other copy. */
            console.log(
                `[classify-epochs] down: ${rows?.[0]?.n ?? 0} epoch row(s) hold classification `
                + 'measurements that this will discard; they remain in gpu_job_events.'
            );

            await sequelize.query(
                `ALTER TABLE epochs
                   DROP COLUMN IF EXISTS loss,
                   DROP COLUMN IF EXISTS train_loss,
                   DROP COLUMN IF EXISTS accuracy_top1,
                   DROP COLUMN IF EXISTS accuracy_top5`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
