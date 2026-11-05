/**
 * A paused training job carries on from its checkpoint.
 *
 * #319. Pause now handed a training run back and the next attempt began at epoch 0,
 * throwing away every epoch done before the pause. A run handed back part way now
 * uploads its latest epoch as an artifact with role `resume`; the next lease names it in
 * `spec.resume`, and the worker fetches it from the job's checkpoint route.
 *
 * @fileoverview Resume checkpoint on the lease spec and the route that serves it.
 * @author Isaac Travers
 * @module tests/gpu-training-resume
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../model');
const gpuService = require('../service/gpu.service');
const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');

const runId = Date.now();
const made = { workerId: null, datasetId: null, jobId: null, files: [] };

const spec = () => ({
    engine: 'marp_training',
    model: { name: 'yolo11m.pt', sha256: 'b'.repeat(64) },
    dataset: { dataset_id: made.datasetId, url: `/api/v2/gpu/datasets/${made.datasetId}/archive`, sha256: 'c'.repeat(64) },
    params: { epochs: 3 },
});

/** A checkpoint in the artifact store, recorded against the job as role `resume`. */
async function recordCheckpoint(bytes) {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
    const file = path.join(ARTIFACT_DIRECTORY, sha256);
    fs.writeFileSync(file, bytes);
    made.files.push(file);

    await db.sequelize.query(
        `INSERT INTO artifacts (job_id, artifact_type, path, hash, metadata, created_at, updated_at)
         VALUES (:jobId, 'resume', :path, :sha256, '{}', now(), now())`,
        { replacements: { jobId: made.jobId, path: `gpu-artifacts/${sha256}`, sha256 }, logging: false }
    );
    return sha256;
}

beforeAll(async () => {
    const enrolled = await global.api.post('/api/v2/gpu/workers/enrol').send({
        local_id: `jest-resume-local-${runId}`, name: `jest-resume-${runId}`, slot_count: 1,
        worker_version: '0.0.1-jest', capabilities: { gpus: [], engines: ['marp_training'] },
    });
    made.workerId = enrolled.body.worker_id;

    const [dataset] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'test', 10, 2, 'test', 'ready', :path, :sha, 1000, now(), now())
         RETURNING id`,
        { replacements: { name: `jest-resume-dataset-${runId}`, path: `datasets/${'c'.repeat(64)}.tar`, sha: 'c'.repeat(64) },
            type: db.Sequelize.QueryTypes.INSERT, logging: false }
    );
    made.datasetId = dataset[0].id;

    const [job] = await db.sequelize.query(
        `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, yields_made, max_attempts, created_at, updated_at)
         VALUES ('training', :name, :spec, 'cancelled', 0, 1, 1, 3, now(), now())
         RETURNING id`,
        { replacements: { name: `jest-resume-${runId}`, spec: JSON.stringify(spec()) },
            type: db.Sequelize.QueryTypes.INSERT, logging: false }
    );
    made.jobId = job[0].id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
    if (made.jobId) {
        await drop('DELETE FROM artifacts WHERE job_id = :id', { id: made.jobId });
        await drop('DELETE FROM gpu_jobs WHERE id = :id', { id: made.jobId });
    }
    if (made.workerId) {
        await drop('DELETE FROM gpu_worker_samples WHERE worker_id = :id', { id: made.workerId });
        await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
    }
    if (made.datasetId) await drop('DELETE FROM datasets WHERE id = :id', { id: made.datasetId });
    for (const file of made.files) fs.rmSync(file, { force: true });
});

describe('Training resumes from its checkpoint (#319)', () => {

    it('trains from the start when the job left no checkpoint', async () => {
        const leased = await gpuService.resolveSpecForLease(spec(), made.workerId, made.jobId);
        expect(leased.resume).toBeUndefined();

        const fetched = await global.api.get(`/api/v2/gpu/jobs/${made.jobId}/checkpoint`);
        expect(fetched.status).toBe(404);
    });

    it('names the newest checkpoint on the next lease, and serves its bytes', async () => {
        await recordCheckpoint(Buffer.from(`epoch-1-${runId}`));
        const newest = await recordCheckpoint(Buffer.from(`epoch-2-${runId}`));

        const leased = await gpuService.resolveSpecForLease(spec(), made.workerId, made.jobId);
        expect(leased.resume).toEqual({ url: `/api/v2/gpu/jobs/${made.jobId}/checkpoint`, sha256: newest });

        // The dataset, model and the rest of the spec are untouched.
        expect(leased.dataset.url).toBe(spec().dataset.url);

        const fetched = await global.api.get(leased.resume.url).buffer(true).parse((res, done) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
        });
        expect(fetched.status).toBe(200);
        expect(crypto.createHash('sha256').update(fetched.body).digest('hex')).toBe(newest);
    });

    it('does not name a checkpoint that is recorded but gone from the store', async () => {
        fs.rmSync(made.files[made.files.length - 1], { force: true });

        const leased = await gpuService.resolveSpecForLease(spec(), made.workerId, made.jobId);
        expect(leased.resume).toBeUndefined();
    });
});

describe('A failed training run resumes once from its checkpoint (#319)', () => {

    let jobId;
    let staged = null;
    const poll = () => global.api.post('/api/v2/gpu/poll')
        .send({ worker_id: made.workerId, slot_indexes: [0], wait_seconds: 0, capabilities: { gpus: [] } });
    const fail = (lease, artifacts = []) => global.api.post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
        .send({ worker_id: made.workerId, lease_epoch: lease.lease_epoch, outcome: 'failed',
            failure_reason: 'CUDA error: resource already mapped', artifacts });

    beforeAll(async () => {
        // A poll takes the head of the whole queue, so it must hold nothing but this job.
        const [queued] = await db.sequelize.query("SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = 'queued'",
            { type: db.Sequelize.QueryTypes.SELECT });
        if (queued.n > 0) throw new Error(`${queued.n} GPU job(s) are already queued here; this suite polls the queue.`);

        const [job] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, yields_made, max_attempts, created_at, updated_at)
             VALUES ('training', :name, :spec, 'queued', 9000, 0, 0, 3, now(), now())
             RETURNING id`,
            { replacements: { name: `jest-resume-failed-${runId}`, spec: JSON.stringify(spec()) },
                type: db.Sequelize.QueryTypes.INSERT, logging: false }
        );
        jobId = job[0].id;
    });

    afterAll(async () => {
        const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
        await drop('DELETE FROM artifacts WHERE job_id = :id', { id: jobId });
        await drop('DELETE FROM gpu_job_events WHERE attempt_id IN (SELECT id FROM gpu_job_attempts WHERE job_id = :id)', { id: jobId });
        await drop('DELETE FROM gpu_job_attempts WHERE job_id = :id', { id: jobId });
        await drop('DELETE FROM gpu_jobs WHERE id = :id', { id: jobId });
        if (staged) await drop('DELETE FROM gpu_artifacts_staging WHERE sha256 = :sha256', { sha256: staged });
    });

    it('keeps the checkpoint a failure uploads, hands it to the retry, and starts fresh when that fails too', async () => {
        const first = (await poll()).body;
        expect(first.job_id).toBe(jobId);
        expect(first.spec.resume).toBeUndefined();

        // The worker uploads last.pt before reporting the failure.
        const bytes = Buffer.from(`failed-at-epoch-1-${runId}`);
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        made.files.push(path.join(ARTIFACT_DIRECTORY, sha256));
        staged = sha256;
        await global.api.post(`/api/v2/gpu/artifacts/upload/${sha256}?attempt_id=${first.attempt_id}`)
            .set('Content-Type', 'application/octet-stream').send(bytes);

        const failed = await fail(first, [{ sha256, role: 'resume' }]);
        expect(failed.status).toBe(200);
        expect(failed.body.job_state).toBe('queued');

        // The retry carries on from it, and the attempt says so.
        const second = (await poll()).body;
        expect(second.spec.resume).toEqual({ url: `/api/v2/gpu/jobs/${jobId}/checkpoint`, sha256 });
        const [recorded] = await db.sequelize.query('SELECT resumed_from_sha256 FROM gpu_job_attempts WHERE id = :id',
            { replacements: { id: second.attempt_id }, type: db.Sequelize.QueryTypes.SELECT });
        expect(recorded.resumed_from_sha256).toBe(sha256);

        // The checkpoint may be what broke it: one failure from it, and the next starts over.
        await fail(second);
        const third = (await poll()).body;
        expect(third.job_id).toBe(jobId);
        expect(third.spec.resume).toBeUndefined();

        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :id", { replacements: { id: jobId } });
    });
});
