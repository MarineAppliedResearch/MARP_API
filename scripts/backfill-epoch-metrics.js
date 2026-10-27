/**
 * Fills in the epoch metrics the ingest dropped, from the events that still hold them.
 *
 * `epochs` has seven metric columns and until `db/epoch-metrics.js` existed the ingest
 * wrote two of them. `map50` and `map5095` were never mapped; the three losses were read
 * as `train/box_loss` and friends while the worker sends `val/`. So every epoch row MARP
 * has written carries a precision and a recall and five nulls.
 *
 * **Nothing was lost, which is the only reason this script can exist.** The ingest keeps
 * the whole metric payload as a `gpu_job_events` row -- *"everything else stays in the
 * event, which is the record that does not lose what it was not expecting"* -- so the
 * values are there to be read back. That comment was written about metrics nobody had
 * columns for, and it turned out to be insurance against this instead.
 *
 * **The same mapping the ingest uses**, imported rather than restated, so a metric added
 * to one is added to both.
 *
 * **It only fills nulls.** A column that already has a value was written by an ingest
 * that read the event correctly, and is at least as trustworthy as this re-reading. A
 * value that disagrees is reported and not written, because two sources disagreeing about
 * what an epoch measured is a thing to look at rather than to overwrite.
 *
 *   node scripts/backfill-epoch-metrics.js            # dry run; writes nothing
 *   node scripts/backfill-epoch-metrics.js --apply
 *   node scripts/backfill-epoch-metrics.js --apply --run 203
 *   node scripts/backfill-epoch-metrics.js --repair --run 204          # dry run
 *   node scripts/backfill-epoch-metrics.js --repair --apply --run 204
 *
 * **`--repair` is a second, narrower job: it rewrites rather than fills.** An API
 * process that had not been restarted since 21 October served the old mapping for five
 * days after it was corrected on disk, so job 21782 wrote ten rows carrying the
 * *training* loss in the *validation* columns. Those rows are not missing a value, they
 * hold the wrong one, and the fill path refuses them on purpose.
 *
 * **How it tells a mis-mapped row from a correct one, without being told which is
 * which.** A mis-mapped row holds exactly what the old mapping produced -- `box_loss`
 * equal to the event's `train/box_loss` -- while disagreeing with what the mapping
 * produces now. A row agreeing with the current mapping is left alone, and a row
 * matching neither is reported and never touched, because something happened to it that
 * this script does not model. Measured against 5432 before this was written: 10
 * mis-mapped, 3 correct, 0 ambiguous.
 *
 * Idempotent: a second run finds nothing null and does nothing. Run from the repository
 * root, so `dotenv` finds `.env`.
 *
 * @fileoverview Backfills epochs.map50, map5095 and the three losses from kept events.
 * @module scripts/backfill-epoch-metrics
 */

'use strict';

require('dotenv').config();

const db = require('../model');
const { EPOCH_METRIC_NAMES, epochMetrics } = require('../db/epoch-metrics');

/** The columns this fills. `precision` and `recall` were always written correctly. */
const RECOVERABLE = Object.keys(EPOCH_METRIC_NAMES);

/**
 * Every epoch row with a metric event behind it, oldest first.
 *
 * The join is run -> job -> attempt -> event, and the event is matched on `payload->>step`
 * because that is what the ingest reads the epoch number from. A row whose event has gone
 * -- cleared with the job, say -- simply does not appear, and is reported as unmatched by
 * the count at the end.
 *
 * @async
 * @param {?number} only - One training run, or null for all of them.
 * @returns {Promise<Object[]>} `{id, training_run_id, epoch_number, payload, ...columns}`.
 */
async function candidates(only) {
    return db.sequelize.query(
        `SELECT e.id, e.training_run_id, e.epoch_number,
                e.precision, e.recall, e.map50, e.map5095,
                e.box_loss, e.cls_loss, e.dfl_loss,
                e.train_box_loss, e.train_cls_loss, e.train_dfl_loss,
                e.duration_seconds, e.start_offset_s, e.end_offset_s,
                v.payload
           FROM epochs e
           JOIN training_runs r ON r.id = e.training_run_id
           JOIN gpu_job_attempts a ON a.job_id = r.job_id
           JOIN gpu_job_events v ON v.attempt_id = a.id
                                AND v.kind = 'metric'
                                AND (v.payload->>'step')::int = e.epoch_number
          WHERE (:only::int IS NULL OR e.training_run_id = :only)
          ORDER BY e.training_run_id, e.epoch_number`,
        { replacements: { only }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );
}

/**
 * Whether a stored value is the old mapping's output rather than the current one.
 *
 * **Sharper than "the train columns are empty".** Empty says a row is incomplete; this
 * says *how* it went wrong -- the column holds precisely what the previous mapping would
 * have put there. A row that is merely missing values is the fill path's business, and a
 * row holding something matching neither mapping is nobody's business without a person
 * looking at it.
 *
 * @param {?number} stored - What is in the column.
 * @param {?number} current - What the mapping produces today.
 * @param {number} previous - What the old mapping would have produced.
 * @returns {boolean} True only when the row provably came from the old mapping.
 */
function wasMisMapped(stored, current, previous) {
    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;

    if (stored === null || stored === undefined) return false;

    return !near(Number(stored), Number(current)) && near(Number(stored), Number(previous));
}

/**
 * Works out what one epoch row is missing, and fills it.
 *
 * @async
 * @param {Object} row - From {@link candidates}.
 * @param {boolean} apply - Whether to write.
 * @returns {Promise<{outcome: string, disagreed: boolean}>} For the report.
 */
async function backfill(row, apply, repair) {
    const read = epochMetrics(row.payload && row.payload.metrics);
    const filling = {};
    const disagreements = [];

    for (const column of RECOVERABLE) {
        const have = row[column];
        const found = read[column];

        if (found === null) continue;

        if (have === null || have === undefined) {
            filling[column] = found;

            continue;
        }

        /* Both sides have a number. They should be the same number, and if they are not
           then one of the two readings is of something else. Reported, never written. */
        if (Math.abs(Number(have) - found) > 1e-9) {
            disagreements.push(`${column} recorded ${have}, event says ${found}`);
        }
    }

    /* **Repair rewrites exactly the columns that provably came from the old mapping.**
       The three validation losses are the only ones it could have got wrong -- it read
       `train/` where the worker sends both -- so the rule is applied per column, and a
       column disagreeing for any other reason still falls through to the report below
       rather than being overwritten on the strength of a guess. */
    if (repair) {
        const metrics = (row.payload && row.payload.metrics) || {};
        const previously = {
            box_loss: metrics['train/box_loss'],
            cls_loss: metrics['train/cls_loss'],
            dfl_loss: metrics['train/dfl_loss'],
        };

        for (const [column, before] of Object.entries(previously)) {
            if (!wasMisMapped(row[column], read[column], before)) continue;

            filling[column] = read[column];

            /* No longer a disagreement once it is explained: the row held the old
               mapping's value and is being moved to the current one. */
            const at = disagreements.findIndex((text) => text.startsWith(`${column} `));

            if (at !== -1) disagreements.splice(at, 1);
        }
    }

    if (disagreements.length) {
        return { outcome: `DISAGREES: ${disagreements.join('; ')} -- not written`, disagreed: true };
    }

    const names = Object.keys(filling);

    if (!names.length) return { outcome: 'nothing missing', disagreed: false };

    if (apply) {
        await db.sequelize.query(
            `UPDATE epochs
                SET ${names.map((column) => `${column} = :${column}`).join(', ')},
                    updated_at = NOW()
              WHERE id = :id`,
            { replacements: { id: row.id, ...filling }, logging: false }
        );
    }

    return { outcome: names.map((column) => `${column}=${filling[column]}`).join(', '), disagreed: false };
}

/**
 * Reports what it would do, or does it.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const repair = process.argv.includes('--repair');
    const at = process.argv.indexOf('--run');
    const only = at === -1 ? null : Number(process.argv[at + 1]);

    if (at !== -1 && !Number.isInteger(only)) {
        throw new Error('--run takes a training run id.');
    }

    console.log(apply ? '== recording ==' : '== dry run; nothing will be written ==');

    if (repair) {
        console.log("== repair: rewriting columns that hold the old mapping's value ==");
    }

    const rows = await candidates(only);

    if (!rows.length) {
        console.log('No epoch row has a metric event behind it, so there is nothing to recover.');

        return;
    }

    let disagreed = 0;

    for (const row of rows) {
        const { outcome, disagreed: bad } = await backfill(row, apply, repair);

        if (bad) disagreed += 1;

        console.log(`  run ${String(row.training_run_id).padStart(4)} epoch ${String(row.epoch_number).padStart(3)}: ${outcome}`);
    }

    /* How many epoch rows have no event to read. Counted rather than left implicit,
       because a run whose events were cleared cannot be recovered and somebody should
       know that rather than wonder why its chart is short. */
    const [{ unmatched }] = await db.sequelize.query(
        `SELECT count(*)::int AS unmatched
           FROM epochs e
          WHERE (:only::int IS NULL OR e.training_run_id = :only)
            AND e.id NOT IN (${rows.map((row) => row.id).join(',') || '0'})`,
        { replacements: { only }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );

    if (unmatched) {
        console.log(`\n${unmatched} epoch row(s) have no metric event left to read, so they stay as they are.`);
    }

    if (!apply) console.log('\nnothing written. Re-run with --apply.');

    if (disagreed) {
        console.error(`\n${disagreed} epoch row(s) disagree with their event.`);
        process.exitCode = 1;
    }
}

/* **Run when invoked, importable when not.** `wasMisMapped` decides whether a row in
   a scientific record gets overwritten, which is worth a test of its own -- and a test
   cannot require this file while requiring it opens a database and starts work. */
if (require.main === module) {
    main()
        .then(() => db.sequelize.close())
        .catch(async (error) => {
            console.error(error.message);
            await db.sequelize.close();
            process.exitCode = 1;
        });
}

module.exports = { wasMisMapped };
