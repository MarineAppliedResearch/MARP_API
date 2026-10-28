/**
 * A batch sample is keyed by the event it was projected from, not by its contents.
 *
 * **The key I shipped threw most of the series away.** `training_batch_samples` was unique
 * on `(attempt_id, step, phase)`, which assumed a step carries one sample per phase. It
 * does not. Job 21801 sent 14 `training_batch` metric events and MARP stored **4**.
 *
 * The worker reports phase markers -- `validating`, `validated`, `saving` -- through the
 * same phase as the batch samples, carrying no `batch`, at the same step as the *next*
 * epoch's batch-0 sample. So one step holds four or five distinct events:
 *
 *     seq  61  step 144  validating   epoch 1
 *     seq  63  step 144  validated    epoch 1
 *     seq  64  step 144  saving       epoch 1
 *     seq  69  step 144  batch 0      epoch 2
 *
 * `ON CONFLICT DO NOTHING` kept the first and discarded the rest -- so the row stored at
 * step 144 is the *validating marker*, and the measurement that followed it, the first
 * batch of epoch 2, was dropped. Every epoch after the first lost its opening sample and
 * kept a marker in its place.
 *
 * **Keyed on `seq`, and the obvious alternative was checked rather than assumed.** Adding
 * `phase_entered` to the key is the natural first thought and it does not work: on this
 * same job, step 432 carries two `validating` markers and two `validated` markers, one
 * pair for epoch 3 and one for epoch 4. `(attempt_id, step, phase, phase_entered)` still
 * collides twice. Adding `epoch` as well would fix that particular shape and nothing
 * about the next one.
 *
 * `seq` is right for a reason other than that it happens to work. **A sample is a
 * projection of exactly one event**, and `gpu_job_events` is already unique on
 * `(attempt_id, seq)` -- so keying the projection by its source means the two tables
 * cannot disagree about what a duplicate is. A genuine resend carries the same seq and
 * still dedupes, which is what the key was for.
 *
 * **Existing rows are backfilled from the events they came from.** The stored row at a
 * colliding step is the first the batch accepted, which is the lowest seq of that group,
 * so the match is exact rather than a guess. A row that cannot be traced to an event
 * fails this migration inside its transaction: a sample whose source cannot be identified
 * is a sample that cannot be keyed, and inventing a seq for it would make the index lie.
 *
 * **The samples already dropped are not recovered here.** They are still in
 * `gpu_job_events`, which is the point of keeping the events, and
 * `scripts/backfill-training-batch-samples.js` re-projects them. That is a separate,
 * re-runnable step rather than a migration, for the same reason the epoch-metric
 * recovery was.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration re-keying training_batch_samples on the source event's seq.
 * @module migrations/a-sample-is-identified-by-the-event-it-came-from
 */

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                'ALTER TABLE training_batch_samples ADD COLUMN IF NOT EXISTS seq INTEGER',
                { transaction }
            );

            /* **Matched to the event it was projected from.** The lowest seq of the
               colliding group is the row that survived `DO NOTHING`, because an event
               batch is posted and accepted in seq order -- so this identifies the stored
               row rather than picking one of its siblings. */
            const [, filled] = await sequelize.query(
                `UPDATE training_batch_samples s
                    SET seq = (
                        SELECT min(e.seq) FROM gpu_job_events e
                         WHERE e.attempt_id = s.attempt_id
                           AND e.kind = 'metric'
                           AND e.payload->>'step' = s.step::text
                           AND e.payload->>'phase' = s.phase
                    )
                  WHERE s.seq IS NULL`,
                { transaction }
            );

            console.log(`[sample-seq] backfilled ${filled?.rowCount ?? 0} sample(s) from their events`);

            const [orphans] = await sequelize.query(
                'SELECT count(*)::int AS n FROM training_batch_samples WHERE seq IS NULL',
                { transaction }
            );

            if (orphans[0].n) {
                throw new Error(
                    `[sample-seq] ${orphans[0].n} sample(s) cannot be traced to an event, so they `
                    + 'cannot be keyed by one. Rolled back rather than inventing a seq.'
                );
            }

            await sequelize.query(
                'ALTER TABLE training_batch_samples ALTER COLUMN seq SET NOT NULL',
                { transaction }
            );

            await sequelize.query(
                'DROP INDEX IF EXISTS training_batch_samples_attempt_step_phase',
                { transaction }
            );

            await sequelize.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS training_batch_samples_attempt_seq
                     ON training_batch_samples (attempt_id, seq)`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN training_batch_samples.seq IS
                 'The sequence number of the gpu_job_events row this sample was projected from, unique within an attempt. It is the identity of the sample, because a sample is exactly one event read into columns -- so a resend of that event dedupes and two different events at one step both survive. The previous key, (attempt_id, step, phase), assumed one sample per step per phase and discarded the rest: the worker sends phase markers and the next epoch''s first batch at the same step.'`,
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
        const transaction = await sequelize.transaction();

        try {
            /* **The old key cannot be restored while the rows that broke it are present.**
               Re-creating a unique index on (attempt_id, step, phase) would fail against
               any attempt whose samples this fix allowed through -- which is the defect,
               reinstated. So `down` drops the seq key and leaves a plain index: the column
               goes, the rows stay, and nothing is deleted to make an index fit. */
            const [rows] = await sequelize.query(
                `SELECT count(*)::int AS n FROM (
                     SELECT attempt_id, step, phase FROM training_batch_samples
                      GROUP BY 1,2,3 HAVING count(*) > 1
                 ) colliding`,
                { transaction }
            );

            console.log(
                `[sample-seq] down: dropping the seq key. ${rows[0].n} (attempt, step, phase) `
                + 'group(s) now hold more than one sample, so the old unique key is NOT '
                + 'recreated -- it would either fail or require deleting measurements.'
            );

            await sequelize.query(
                'DROP INDEX IF EXISTS training_batch_samples_attempt_seq',
                { transaction }
            );

            await sequelize.query(
                `CREATE INDEX IF NOT EXISTS training_batch_samples_attempt_step_phase_idx
                     ON training_batch_samples (attempt_id, step, phase)`,
                { transaction }
            );

            await sequelize.query(
                'ALTER TABLE training_batch_samples DROP COLUMN IF EXISTS seq',
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
