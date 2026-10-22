/**
 * Removes `dataset_build` jobs whose dataset no longer exists.
 *
 * **These are the residue of a decision that was reversed.** Deleting a dataset used to
 * leave its build job behind, on the reasoning that a job is the record that work
 * happened. Isaac objected twice -- once when the Datasets summary counted the leftovers,
 * and again when he deleted a dataset and met its build still listed on the Jobs screen:
 * *"this is weird because i already deleted this on the other page... but i deleted it, it
 * should be gone!"* `DELETE /dataset/:id` takes the job with the dataset now, and this
 * clears the ones already stranded so nobody has to undo that decision a row at a time.
 *
 * **It is a one-off, not a sweep.** Nothing creates orphans any more, so a clean run
 * means there is nothing to do rather than that the script failed. Run it after the
 * change lands; keep it for the next person who finds rows from before it.
 *
 * **A job that produced an artifact is left alone and named.** `artifacts.job_id` is
 * `RESTRICT`, and deleting evidence of a model's provenance to tidy a list is not a trade
 * this should make quietly.
 *
 *   node scripts/remove-orphaned-build-jobs.js            # dry run; writes nothing
 *   node scripts/remove-orphaned-build-jobs.js --apply
 *
 * Idempotent: a second run finds nothing. Run from the repository root, so `dotenv`
 * finds `.env` -- and set `DB_PORT` if the database you mean is not the one it names.
 *
 * @fileoverview Clears dataset_build jobs left behind by deleted datasets.
 * @module scripts/remove-orphaned-build-jobs
 */

'use strict';

const db = require('../model');
const buildRepository = require('../repository/dataset-build.repository');

/**
 * Every `dataset_build` job whose dataset is gone, with what hangs off it.
 *
 * @async
 * @returns {Promise<Object[]>} `{id, state, dataset_id, attempts, events, artifacts}`.
 */
async function orphans() {
    return db.sequelize.query(
        `SELECT j.id,
                j.state,
                (j.spec->>'dataset_id')::int AS dataset_id,
                (SELECT count(*)::int FROM gpu_job_attempts a WHERE a.job_id = j.id) AS attempts,
                (SELECT count(*)::int
                   FROM gpu_job_events e
                   JOIN gpu_job_attempts a2 ON a2.id = e.attempt_id
                  WHERE a2.job_id = j.id) AS events,
                (SELECT count(*)::int FROM artifacts f WHERE f.job_id = j.id) AS artifacts
           FROM gpu_jobs j
          WHERE j.kind = 'dataset_build'
            AND j.spec->>'dataset_id' ~ '^[0-9]+$'
            AND NOT EXISTS (
                SELECT 1 FROM datasets d WHERE d.id = (j.spec->>'dataset_id')::int
            )
          ORDER BY j.id`,
        { type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );
}

/**
 * Reports what it would remove, or removes it.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const found = await orphans();

    console.log(apply ? '== removing ==' : '== dry run; nothing will be written ==');

    if (!found.length) {
        console.log('No build job is pointing at a dataset that is gone.');

        return;
    }

    for (const job of found) {
        console.log(`  job ${String(job.id).padStart(6)}  ${job.state.padEnd(10)}`
            + `  dataset ${job.dataset_id} (gone)`
            + `  ${job.attempts} attempt(s), ${job.events} event(s)`
            + (job.artifacts ? `  -- holds ${job.artifacts} artifact(s), will be kept` : ''));
    }

    if (!apply) {
        console.log(`\n${found.length} to remove. Nothing written. Re-run with --apply.`);

        return;
    }

    /* Through the same function the delete route uses, rather than a second copy of the
       rules: the kind filter, the artifact refusal and the savepoint that makes a refusal
       survivable all live there. Per dataset, because that is the unit it takes. */
    const datasets = [...new Set(found.map((job) => job.dataset_id))];
    let removed = 0;
    const kept = [];

    for (const datasetId of datasets) {
        const result = await buildRepository.deleteBuildJobsFor(datasetId);

        removed += result.deleted.length;
        kept.push(...result.kept);
    }

    console.log(`\nremoved ${removed} job(s).`);

    if (kept.length) {
        console.log(`kept ${kept.length}: ${kept.join(', ')} -- each holds an artifact, `
            + 'which is a record of provenance and is not deleted to tidy a list.');
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exitCode = 1;
    });
