/**
 * A heartbeat counting past two billion is saved, and one MARP cannot save says so.
 *
 * Job 21953, *WpFeCec*, never trained. Its first attempt downloaded dataset 391 -- a
 * 20,126,426,112-byte archive -- and reported the download in bytes, and
 * `gpu_job_attempts.progress_total` was 32-bit. Every heartbeat after the first failed
 * with *integer out of range* and rolled back, the lease ran out, and the attempt was
 * recorded as having sent no heartbeat, which it had: one every five seconds. The next two
 * attempts landed on the same machine while the first download still held its file.
 *
 * Two things are pinned here: the counts fit now and come back as numbers, and a heartbeat
 * MARP fails to save leaves the reason the lease then expires under.
 *
 * @fileoverview Large attempt progress, and the reason a lease expires.
 * @author Isaac Travers
 * @module tests/gpu-heartbeat-large-progress
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const gpuRepository = require('../repository/gpu.repository');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { workerId: null, jobIds: [], attemptIds: [] };

/** The archive size that broke it. */
const ARCHIVE_BYTES = 20126426112;

function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * A training job leased to this file's worker, with a live attempt.
 *
 * @async
 * @param {string} expiresIn - SQL interval from now: positive for a live lease.
 * @returns {Promise<{jobId: number, attemptId: number}>}
 */
async function leasedAttempt(expiresIn) {
    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts, name)
         VALUES ('training', '{}', 'leased', 1, 3, :name) RETURNING id`,
        { name: `jest-large-progress-${runId}` }
    );
    made.jobIds.push(job.id);

    const [attempt] = await query(
        `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at)
         VALUES (:jobId, :workerId, 0, 1, 'running', NOW(), NOW() + (:expiresIn)::interval) RETURNING id`,
        { jobId: job.id, workerId: made.workerId, expiresIn }
    );
    made.attemptIds.push(attempt.id);

    return { jobId: job.id, attemptId: attempt.id };
}

beforeAll(async () => {
    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-large-progress-local-${runId}`,
            name: `jest-large-progress-${runId}`,
            slot_count: 1,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [], engines: ['marp_training'] },
        });

    made.workerId = enrolled.body.worker_id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.attemptIds.length) {
        await drop('DELETE FROM gpu_worker_samples WHERE worker_id = :id', { id: made.workerId });
        await drop('DELETE FROM gpu_attempt_progress WHERE attempt_id IN (:ids)', { ids: made.attemptIds });
        await drop('DELETE FROM gpu_job_events WHERE attempt_id IN (:ids)', { ids: made.attemptIds });
        await drop('DELETE FROM gpu_job_attempts WHERE id IN (:ids)', { ids: made.attemptIds });
    }
    if (made.jobIds.length) await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    if (made.workerId) await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
});

describe('a dataset download past 2 GB', () => {
    it('is a heartbeat MARP saves, and the lease moves on', async () => {
        const { attemptId } = await leasedAttempt('20 seconds');

        const res = await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/heartbeat`)
            .send({
                worker_id: made.workerId,
                lease_epoch: 1,
                state: 'running',
                progress: { done: 71303168, total: ARCHIVE_BYTES, unit: 'bytes', phase: 'fetching_dataset' },
            });

        expect(res.status).toBe(200);

        const [row] = await query(
            `SELECT progress_done, progress_total, lease_expires_at > NOW() + INTERVAL '30 seconds' AS extended
               FROM gpu_job_attempts WHERE id = :attemptId`,
            { attemptId }
        );

        expect(Number(row.progress_total)).toBe(ARCHIVE_BYTES);
        expect(row.extended).toBe(true);
    });

    it('comes back as a number, not the driver\'s string', async () => {
        const { jobId } = await leasedAttempt('1 minute');
        await query('UPDATE gpu_job_attempts SET progress_done = :done, progress_total = :total WHERE job_id = :jobId',
            { done: 3000000000, total: ARCHIVE_BYTES, jobId });

        const res = await global.api.get(`/api/v2/gpu/jobs/${jobId}`);

        expect(res.status).toBe(200);
        expect(res.body.attempts[0].progress_total).toBe(ARCHIVE_BYTES);
        expect(res.body.attempts[0].progress_done).toBe(3000000000);
    });
});

describe('a heartbeat MARP could not save', () => {
    it('is the reason the lease expires under, not "no heartbeat"', async () => {
        const { attemptId } = await leasedAttempt('-1 second');

        await gpuRepository.noteRefusedHeartbeat(attemptId, 'integer out of range');
        await gpuRepository.noteRefusedHeartbeat(attemptId, 'integer out of range');
        await gpuRepository.expireStaleLeases();

        const [row] = await query('SELECT state, failure_reason FROM gpu_job_attempts WHERE id = :attemptId', { attemptId });

        expect(row.state).toBe('abandoned');
        expect(row.failure_reason).toBe(
            'Lease expired: the worker kept sending heartbeats but MARP could not save them (integer out of range).'
        );

        const notes = await query(
            "SELECT count(*)::int AS n FROM gpu_job_events WHERE attempt_id = :attemptId AND payload->>'note' = 'heartbeat refused'",
            { attemptId }
        );

        expect(notes[0].n).toBe(1);
    });

    it('a lease that simply ran out still says so', async () => {
        const { attemptId } = await leasedAttempt('-1 second');

        await gpuRepository.expireStaleLeases();

        const [row] = await query('SELECT failure_reason FROM gpu_job_attempts WHERE id = :attemptId', { attemptId });

        expect(row.failure_reason).toBe('Lease expired: no heartbeat before lease_expires_at.');
    });
});
