/**
 * What a training run was doing between its epochs.
 *
 * **An epoch row every two or three minutes is not a live view.** A real epoch here runs
 * about 160 seconds, so until now a reader watching a training run learned something
 * roughly every 2.7 minutes, and the console the run is actually printing to updates
 * every batch. Isaac: *"i don't want it as a command line, i want everything that would
 * be showing in the command line to be graphed!"*
 *
 * So the worker reports a sample about every 2.5 seconds, and this is where they live.
 *
 * **Per attempt, not per run, because a sample can arrive before a run exists.** The
 * `training_runs` row is opened lazily by the first finished epoch, and batch samples
 * start before that -- the first one lands seconds into epoch 1. Keying these to the
 * attempt means nothing is dropped for being early, and it is also what makes a retry
 * legible: a second attempt restarts its step counter, and a reader joining through the
 * job sees two series with a seam rather than one series that jumps backwards.
 *
 * **The numbers are jsonb and the identity is columns, which is deliberate.** `step`,
 * `phase`, `epoch` and `batch` are what a query filters, orders and pages on, so they are
 * columns with an index. The measurements are not: a detector reports
 * `train/box_loss`, `train/cls_loss` and `train/dfl_loss` where a classifier reports one
 * `train/loss`, and a third task would bring a fourth vocabulary. Columns for those would
 * be a migration per task and a table mostly full of nulls that say "not this kind of
 * run" -- which is the absent-versus-null confusion this project keeps paying for, built
 * in on purpose. A chart reads the bag; nothing here needs to aggregate across it.
 *
 * **Two measurements that will never appear, recorded so nobody adds columns for them.**
 * Instances per batch is unreachable -- `trainer.batch` does not exist at the callback
 * and Ultralytics prints it from a local variable -- and image counts while caching have
 * no callback at all. Both have been asked for three times. A column for either would be
 * permanently null, which teaches a reader that the measurement failed rather than that
 * it was never available.
 *
 * **Retention: kept, and never pruned.** The shape of a run's batch losses is exactly
 * what somebody looks at afterwards, which is the whole reason for charting them, and a
 * series that vanishes when the run finishes could not answer "why did this one diverge".
 * The volume does not argue otherwise: one sample per 2.5 seconds over a 160-second epoch
 * is about 64 points, so a 100-epoch run is roughly 6,400 rows of a few hundred bytes --
 * a few megabytes for a run that cost hours of GPU time. They cascade with the attempt,
 * so deleting a job still takes them.
 *
 * **The bound is on the read, not on the write**, and `GET /training_run/:id/samples`
 * carries it: a wide range is strided down to a cap, and because the read is incremental
 * a polling client asks only for what is new and never meets the stride at all.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration creating training_batch_samples.
 * @module migrations/a-training-run-keeps-what-happened-between-epochs
 */

/** What `phase` may say. The vocabulary is `db/epoch-metrics.js`'s. */
const PHASES = ['training_batch', 'validating_batch'];

/**
 * Renders a list as a SQL `IN (...)` body. Every value here is a constant in this file.
 *
 * @param {Array<string>} values - Allowed values.
 * @returns {string} Quoted, comma-separated values.
 */
function inList(values) {
    return values.map((value) => `'${value}'`).join(', ');
}

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `CREATE TABLE IF NOT EXISTS training_batch_samples (
                    id              SERIAL PRIMARY KEY,
                    attempt_id      INTEGER NOT NULL
                                        REFERENCES gpu_job_attempts(id) ON DELETE CASCADE,
                    step            INTEGER NOT NULL,
                    phase           VARCHAR(24) NOT NULL
                                        CHECK (phase IN (${inList(PHASES)})),
                    epoch           INTEGER,
                    batch           INTEGER,
                    batches_total   INTEGER,
                    at              TIMESTAMPTZ,
                    metrics         JSONB NOT NULL,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`,
                { transaction }
            );

            /* **One row per attempt, step and phase.** The event stream already refuses a
               replayed batch by its seq, so this is not the primary guard -- it is the one
               that holds if a worker ever resends a sample under a new seq, which would
               otherwise double a point on the chart and look like a stall. */
            await sequelize.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS training_batch_samples_attempt_step_phase
                     ON training_batch_samples (attempt_id, step, phase)`,
                { transaction }
            );

            /* The incremental read's index: "this attempt, steps above N, in order". */
            await sequelize.query(
                `CREATE INDEX IF NOT EXISTS training_batch_samples_attempt_step
                     ON training_batch_samples (attempt_id, step)`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON TABLE training_batch_samples IS
                 'What a training attempt was doing between its epochs, sampled by the worker about every 2.5 seconds. Keyed to the attempt rather than the training run because samples begin before the run row is opened by its first finished epoch, and because a retry restarts the step counter and should read as a seam rather than a jump. Kept for the life of the attempt and never pruned: the shape of a run''s batch losses is what somebody looks at afterwards. The measurements are jsonb because they differ by task -- three losses for a detector, one for a classifier -- and columns for them would be a migration per task and a table of nulls meaning ''not this kind of run''.'`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN training_batch_samples.step IS
                 'The worker''s global batch counter, monotonic within an attempt. Not an epoch number: the per-epoch series in ''epochs'' uses the epoch for its step, and the two overlap numerically, which is why phase rather than step decides what a metric event is.'`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN training_batch_samples.at IS
                 'The worker''s own clock when it took the sample. Ordering and duration only -- valid within a run, never compared across machines.'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;

        /* The samples are the only record of what happened inside an epoch, and nothing
           else holds them -- the events they were read from are trimmed on their own
           schedule. Dropping the table loses them, which is what a down means here. */
        await sequelize.query('DROP TABLE IF EXISTS training_batch_samples');
    },
};
