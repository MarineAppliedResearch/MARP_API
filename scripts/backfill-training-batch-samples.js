/**
 * Re-project batch samples that the old unique key discarded.
 *
 * **The samples were never lost, only not stored.** `training_batch_samples` was unique on
 * `(attempt_id, step, phase)`, and the worker sends phase markers and the next epoch's
 * first batch at the same step -- so `ON CONFLICT DO NOTHING` kept one of each group and
 * dropped the rest. Job 21801 sent 14 events and MARP stored 4.
 *
 * Every one of them is still in `gpu_job_events`, which is why that table keeps whole
 * payloads rather than only what MARP knew how to read at the time. This walks those
 * events and writes the rows the ingest would write today.
 *
 * **Idempotent, because the table is now keyed by the event.** A sample already stored
 * has that event's seq and is left alone; running this twice changes nothing the second
 * time. Run it after `20261028050000-a-sample-is-identified-by-the-event-it-came-from`.
 *
 * ```bash
 * node scripts/backfill-training-batch-samples.js            # say what it would do
 * node scripts/backfill-training-batch-samples.js --apply    # do it
 * node scripts/backfill-training-batch-samples.js --attempt 19240 --apply
 * ```
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Recovers batch samples dropped by the superseded unique key.
 * @author Isaac Travers
 * @module scripts/backfill-training-batch-samples
 */

'use strict';

require('dotenv').config();

const db = require('../model');
const { readPhase } = require('../db/epoch-metrics');

const { QueryTypes } = db.Sequelize;

/**
 * Whole number, or null.
 *
 * Shared with the ingest's reading of the same fields, so a recovered row and a live one
 * are the same row.
 *
 * @param {*} value - Whatever the worker sent.
 * @returns {?number} The integer, or null.
 */
function whole(value) {
    return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
}

/**
 * Find and optionally write the samples that are missing.
 *
 * @async
 * @param {Object} options - What to do.
 * @param {boolean} options.apply - Write, rather than report.
 * @param {?number} options.attemptId - Only this attempt.
 * @returns {Promise<{missing: number, written: number}>} What was found and written.
 */
async function backfill({ apply, attemptId }) {
    /* **Left-joined against what is already stored**, so this reports only the gap. The
       events are the source and the samples are the projection; anything in the first
       with no row in the second is a sample that should exist. */
    const missing = await db.sequelize.query(
        `SELECT e.attempt_id, e.seq, e.at, e.payload
           FROM gpu_job_events e
           LEFT JOIN training_batch_samples s
                  ON s.attempt_id = e.attempt_id AND s.seq = e.seq
          WHERE e.kind = 'metric'
            AND s.id IS NULL
            AND (:attemptId::int IS NULL OR e.attempt_id = :attemptId)
          ORDER BY e.attempt_id, e.seq`,
        { replacements: { attemptId: attemptId ?? null }, type: QueryTypes.SELECT }
    );

    /* The phase decides what an event is, exactly as the ingest decides it -- an epoch
       belongs in `epochs` and is none of this script's business. */
    const samples = missing.filter((event) => {
        const payload = event.payload || {};
        const phase = readPhase(payload.phase);

        return !phase.epoch
            && phase.known
            && payload.metrics
            && typeof payload.metrics === 'object'
            && Number.isInteger(Number(payload.step));
    });

    const byAttempt = new Map();

    for (const sample of samples) {
        byAttempt.set(sample.attempt_id, (byAttempt.get(sample.attempt_id) || 0) + 1);
    }

    for (const [id, n] of [...byAttempt].sort((a, b) => a[0] - b[0])) {
        console.log(`  attempt ${id}: ${n} sample(s) missing`);
    }

    if (!apply) return { missing: samples.length, written: 0 };

    let written = 0;

    for (const event of samples) {
        const payload = event.payload;
        const metrics = payload.metrics;

        /* **`RETURNING`, and the returned rows are counted.** The driver's `rowCount` does
           not come back reliably through Sequelize for an `ON CONFLICT DO NOTHING`
           insert -- it reported zero writes for ten rows it had just written -- and a
           recovery script that cannot say how much it recovered is not much of one. */
        const [inserted] = await db.sequelize.query(
            `INSERT INTO training_batch_samples
                 (attempt_id, seq, step, phase, epoch, batch, batches_total, at, metrics, created_at)
             VALUES (:attemptId, :seq, :step, :phase, :epoch, :batch, :batchesTotal, :at, :metrics, NOW())
             ON CONFLICT (attempt_id, seq) DO NOTHING
             RETURNING id`,
            {
                replacements: {
                    attemptId: event.attempt_id,
                    seq: event.seq,
                    step: Math.trunc(Number(payload.step)),
                    phase: String(payload.phase),
                    epoch: whole(metrics.epoch),
                    batch: whole(metrics.batch),
                    batchesTotal: whole(metrics.batches_total),
                    /* The event's own `at`, which is the worker's clock -- the same value
                       the ingest stores, so a recovered row is indistinguishable from one
                       written at the time. */
                    at: event.at,
                    metrics: JSON.stringify(metrics),
                },
                logging: false,
            }
        );

        written += inserted.length;
    }

    return { missing: samples.length, written };
}

if (require.main === module) {
    const apply = process.argv.includes('--apply');
    const at = process.argv.indexOf('--attempt');
    const attemptId = at === -1 ? null : Number(process.argv[at + 1]);

    (async () => {
        console.log(apply ? 'Writing missing batch samples.' : 'Dry run; pass --apply to write.');

        const { missing, written } = await backfill({ apply, attemptId });

        console.log('');
        console.log(`  ${missing} sample(s) missing from training_batch_samples`);

        if (apply) console.log(`  ${written} written`);

        await db.sequelize.close();
    })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { backfill, whole };
