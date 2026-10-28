/**
 * Cancelling several jobs at once: a selection, or every piece of one run.
 *
 * Found by Isaac on 2026-10-28: he ticked a run's pieces on the Jobs tab, pressed
 * Cancel, and nothing happened. The button had no handler, and MARP had no way to
 * cancel more than one job per request -- so a run of 82 pieces, paged 18 to a
 * screen, could not be cancelled from the dashboard at all.
 *
 * Scoped to rows this file creates, so it runs in place against the test database.
 *
 * Refs MarineAppliedResearch/MARP_API#279.
 *
 * @fileoverview Tests for bulk and per-run job cancellation.
 * @author Isaac Travers
 * @module tests/gpu-job-cancel
 */

'use strict';

const { randomUUID } = require('crypto');

const db = require('../model');
const gpuRepository = require('../repository/gpu.repository');
const gpuService = require('../service/gpu.service');

/** Unique per run, so nothing here collides with another suite's rows. @type {number} */
const runId = Date.now();

/** Job ids created here, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/**
 * A minimal job in a given state. Nothing here leases it, so no engine or video is read.
 *
 * @param {string} state - Its state.
 * @param {string|null} batchId - The run it belongs to.
 * @returns {Object} A row for `createJobs`.
 */
function jobRow(state, batchId = null) {
    return {
        batch_id: batchId,
        name: `job-cancel-${runId}`,
        kind: 'inference',
        spec: {
            engine: 'test',
            model: { name: 'test' },
            video: { source_name: `job-cancel-${runId}` },
            range: { start_frame: 0, end_frame: 10 },
        },
        state,
        priority: 0,
        attempts_made: 0,
        max_attempts: 3,
        published_attempt_id: null,
        created_by: null,
        created_at: new Date(),
        updated_at: new Date(),
    };
}

/**
 * Creates jobs and remembers them for cleanup.
 *
 * @async
 * @param {Array<Object>} rows - From `jobRow`.
 * @returns {Promise<Array<Object>>} The jobs.
 */
async function make(rows) {
    const jobs = await gpuRepository.createJobs(rows);
    createdJobIds.push(...jobs.map((job) => job.id));
    return jobs;
}

/**
 * The current state of each job, by id.
 *
 * @async
 * @param {Array<number>} ids - The jobs.
 * @returns {Promise<Object>} `{id: state}`.
 */
async function statesOf(ids) {
    const [rows] = await db.sequelize.query('SELECT id, state FROM gpu_jobs WHERE id IN (:ids)', {
        replacements: { ids },
    });
    return Object.fromEntries(rows.map((row) => [Number(row.id), row.state]));
}

afterAll(async () => {
    if (createdJobIds.length) {
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: createdJobIds },
        });
    }

    /* Left open, as in gpu-finished-at: the corpus guard counts tables after the suite. */
});

describe('cancelling a selection (#279)', () => {
    test('cancels the live jobs and names the finished one it skipped', async () => {
        const [queued, done] = await make([jobRow('queued'), jobRow('succeeded')]);

        const answer = await gpuService.cancelJobs({ ids: [queued.id, done.id] });

        expect(answer).toEqual({ cancelled: 1, skipped: [{ id: done.id, reason: 'already succeeded' }] });
        expect(await statesOf([queued.id, done.id])).toEqual({ [queued.id]: 'cancelled', [done.id]: 'succeeded' });
    });

    test('a cancelled job records when it finished', async () => {
        const [job] = await make([jobRow('queued')]);

        await gpuService.cancelJobs({ ids: [job.id] });

        const [[row]] = await db.sequelize.query('SELECT finished_at FROM gpu_jobs WHERE id = :id', {
            replacements: { id: job.id },
        });
        expect(row.finished_at).not.toBeNull();
    });

    test('an id with no job is reported, not dropped', async () => {
        const [job] = await make([jobRow('queued')]);
        const missing = job.id + 1000000;

        const answer = await gpuService.cancelJobs({ ids: `${job.id},${missing}` });

        expect(answer).toEqual({ cancelled: 1, skipped: [{ id: missing, reason: 'no such job' }] });
    });

    test('an empty, malformed or oversized selection is refused', async () => {
        await expect(gpuService.cancelJobs({ ids: [] })).rejects.toMatchObject({ status: 400 });
        await expect(gpuService.cancelJobs({ ids: ['x'] })).rejects.toMatchObject({ status: 400 });
        const many = Array.from({ length: 201 }, (_, index) => index + 1);
        await expect(gpuService.cancelJobs({ ids: many })).rejects.toMatchObject({ status: 400 });
    });
});

describe('cancelling a whole run (#279)', () => {
    test('cancels every live piece of the run and nothing outside it', async () => {
        const run = randomUUID();
        const pieces = await make([jobRow('queued', run), jobRow('leased', run), jobRow('succeeded', run)]);
        const [outside] = await make([jobRow('queued', randomUUID())]);

        const answer = await gpuService.cancelJobs({ batch_id: run });

        expect(answer.cancelled).toBe(2);
        expect(answer.skipped).toEqual([{ id: pieces[2].id, reason: 'already succeeded' }]);
        expect(await statesOf([...pieces.map((job) => job.id), outside.id])).toEqual({
            [pieces[0].id]: 'cancelled',
            [pieces[1].id]: 'cancelled',
            [pieces[2].id]: 'succeeded',
            [outside.id]: 'queued',
        });
    });

    test('a run that is already finished cancels nothing', async () => {
        const run = randomUUID();
        await make([jobRow('cancelled', run)]);

        const answer = await gpuService.cancelJobs({ batch_id: run });

        expect(answer.cancelled).toBe(0);
    });

    test('both, neither, or a batch_id that is not a uuid is refused', async () => {
        await expect(gpuService.cancelJobs({})).rejects.toMatchObject({ status: 400 });
        await expect(gpuService.cancelJobs({ ids: [1], batch_id: randomUUID() })).rejects.toMatchObject({ status: 400 });
        await expect(gpuService.cancelJobs({ batch_id: 'run-1' })).rejects.toMatchObject({ status: 400 });
    });
});
