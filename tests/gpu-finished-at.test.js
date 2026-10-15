/**
 * `gpu_jobs.finished_at` is only worth having if it cannot be forgotten.
 *
 * The column exists so "what completed today" is a question the job list can
 * answer (#104, gap 24). `updated_at` could not answer it: a heartbeat, a retry
 * or a priority write all move `updated_at` on a job that finished last week.
 *
 * The risk is not that the current code is wrong -- it is that there are eight
 * statements in `gpu.repository.js` that move a job's state, and the ninth, a
 * year from now, will be written by somebody who has never heard of this column.
 * Nothing would break. The list would simply start under-reporting, silently,
 * for whichever transition was added.
 *
 * So the first test here reads the repository's own source. It is a lint rather
 * than a behaviour check, and that is the point: it fails on the statement that
 * forgot, naming it, rather than on some downstream count being mysteriously low.
 *
 * The second and third prove the two directions actually work, because a lint
 * that only checks a column is *mentioned* would pass on a statement that
 * mentioned it wrongly.
 *
 * @fileoverview Guards that a job's terminal timestamp cannot be left behind.
 * @author Isaac Travers
 * @module tests/gpu-finished-at
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');
const gpuRepository = require('../repository/gpu.repository');

/** Unique per run, so nothing here collides with another suite's rows. @type {number} */
const runId = Date.now();

/** Job ids created here, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/**
 * A minimal queued job. The spec only has to be shaped like one -- nothing in
 * this file leases it, so no engine or video is ever read.
 *
 * @returns {Object} A row for `createJobs`.
 */
function queuedJobRow() {
    return {
        batch_id: null,
        name: `finished-at-${runId}`,
        kind: 'inference',
        spec: {
            engine: 'test',
            model: { name: 'test' },
            video: { source_name: `finished-at-${runId}` },
            range: { start_frame: 0, end_frame: 10 },
        },
        state: 'queued',
        priority: 0,
        attempts_made: 0,
        max_attempts: 3,
        published_attempt_id: null,
        created_by: null,
        created_at: new Date(),
        updated_at: new Date(),
    };
}

afterAll(async () => {
    if (createdJobIds.length) {
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: createdJobIds },
        });
    }

    /* The connection is deliberately left open. `tests/setup/corpus-guard.js`
       counts the tables again after the suite finishes, and closing here takes
       the connection out from under it. */
});

describe('every statement that moves a job state also sets finished_at', () => {
    test('no UPDATE gpu_jobs sets state without touching finished_at', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'repository', 'gpu.repository.js'), 'utf8'
        );

        /* Each `UPDATE gpu_jobs ...` up to the WHERE that ends its SET list.
           Deliberately crude: it is looking for a statement that forgot, and a
           statement it cannot parse should be looked at by a person anyway. */
        const statements = source.match(/UPDATE gpu_jobs[\s\S]*?WHERE/g) || [];

        expect(statements.length).toBeGreaterThan(0);

        /* `FINISHED_AT_SQL` counts: it is the shared fragment, named for the
           column, that the statements taking a bound `:jobState` interpolate.
           Reading the source means seeing the variable rather than what it
           expands to. */
        const forgot = statements.filter(
            (statement) => /\bstate\s*=/.test(statement)
                && !/finished_at/.test(statement)
                && !/FINISHED_AT_SQL/.test(statement)
        );

        expect(forgot).toEqual([]);
    });
});

describe('finished_at follows the job into and out of a terminal state', () => {
    test('a queued job has no finish time', async () => {
        const [job] = await gpuRepository.createJobs([queuedJobRow()]);
        createdJobIds.push(job.id);

        expect(job.state).toBe('queued');
        expect(job.finished_at).toBeNull();
    });

    test('cancelling a job records when it finished', async () => {
        const [job] = await gpuRepository.createJobs([queuedJobRow()]);
        createdJobIds.push(job.id);

        const before = new Date();
        const { job: cancelled } = await gpuRepository.cancelJob(job.id);

        expect(cancelled.state).toBe('cancelled');
        expect(cancelled.finished_at).not.toBeNull();

        /* Within a second either side of the cancel. The point is that it is
           *this* moment rather than the row's creation or some earlier write. */
        const finished = new Date(cancelled.finished_at).getTime();
        expect(finished).toBeGreaterThanOrEqual(before.getTime() - 1000);
        expect(finished).toBeLessThanOrEqual(Date.now() + 1000);
    });

    test('a job put back in the queue stops claiming it finished', async () => {
        const [job] = await gpuRepository.createJobs([queuedJobRow()]);
        createdJobIds.push(job.id);

        await gpuRepository.cancelJob(job.id);

        /* Back to queued through the same statement a requeue uses -- the one
           bound to `:jobState` -- rather than by clearing the column directly,
           which would test the test. */
        await db.sequelize.query(
            `UPDATE gpu_jobs
                SET state = :jobState,
                    updated_at = NOW(),
                    finished_at = CASE WHEN :jobState IN ('succeeded', 'failed', 'cancelled', 'expired')
                                       THEN NOW() ELSE NULL END
              WHERE id = :jobId`,
            { replacements: { jobState: 'queued', jobId: job.id } }
        );

        const [[requeued]] = await db.sequelize.query(
            'SELECT state, finished_at FROM gpu_jobs WHERE id = :jobId',
            { replacements: { jobId: job.id } }
        );

        expect(requeued.state).toBe('queued');
        expect(requeued.finished_at).toBeNull();
    });
});
