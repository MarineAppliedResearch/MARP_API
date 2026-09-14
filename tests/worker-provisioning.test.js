'use strict';

const request = require('supertest');

const app = require('../app');
const db = require('../model');

const runId = Date.now();
const localId = `worker-provisioning-${runId}`;
const otherLocalId = `worker-provisioning-other-${runId}`;
const releaseVersion = `0.1.${runId}`;
let workerId;
let otherWorkerId;
let tokenId;
let releaseId;
let activationId;
let jobId;
let attemptId;
let workerAppExisted = true;

function workerPost(path) {
    return request(app).post(path).set('Authorization', `Bearer ${global.workerCredential}`);
}

afterAll(async () => {
    if (attemptId) await db.gpu_job_attempts.destroy({ where: { id: attemptId } });
    if (jobId) await db.gpu_jobs.destroy({ where: { id: jobId } });
    if (workerId) await db.gpu_workers.update({ desired_release_id: null }, { where: { id: workerId } });
    if (activationId) await db.worker_activation_codes.destroy({ where: { id: activationId } });
    if (workerId || otherWorkerId) {
        await db.gpu_workers.destroy({ where: { id: [workerId, otherWorkerId].filter(Boolean) } });
    }
    if (tokenId) {
        await db.service_token_permissions.destroy({ where: { service_token_id: tokenId } });
        await db.service_tokens.destroy({ where: { service_token_id: tokenId } });
    }
    if (releaseId) await db.worker_releases.destroy({ where: { id: releaseId } });
    if (!workerAppExisted) {
        await db.service_clients.destroy({ where: { name: 'MARP Inference Workers' } });
    }
    delete global.workerCredential;
});

describe('worker activation and operator-selected updates', () => {
    it('binds a revocable credential to one worker and keeps failed updates terminal', async () => {
        workerAppExisted = Boolean(await db.service_clients.findOne({
            where: { name: 'MARP Inference Workers' },
        }));
        const code = await global.api
            .post('/api/v2/gpu/worker-activation-codes')
            .send({ label: `jest-${runId}`, ttl_minutes: 10 });
        expect(code.status).toBe(201);
        activationId = code.body.id;

        const activated = await request(app)
            .post('/api/v2/gpu/workers/activate')
            .send({
                activation_code: code.body.activation_code,
                local_id: localId,
                name: `worker-${runId}`,
                platform: 'windows',
                architecture: 'x86_64',
                compute_runtime: 'cuda12.6',
                worker_version: '0.1.0',
            });
        expect(activated.status).toBe(201);
        expect(activated.body.credential).toMatch(/^svc_/);
        workerId = Number(activated.body.worker_id);
        global.workerCredential = activated.body.credential;
        const worker = await db.gpu_workers.findByPk(workerId);
        tokenId = worker.service_token_id;

        const replay = await request(app)
            .post('/api/v2/gpu/workers/activate')
            .send({
                activation_code: code.body.activation_code,
                local_id: localId,
                name: `worker-${runId}`,
                platform: 'windows',
                architecture: 'x86_64',
                compute_runtime: 'cuda12.6',
            });
        expect(replay.status).toBe(401);

        const enrolled = await workerPost('/api/v2/gpu/workers/enrol').send({
            local_id: localId,
            name: `worker-${runId}`,
            slot_count: 1,
            capabilities: { gpus: [] },
        });
        expect(enrolled.status).toBe(200);
        expect(Number(enrolled.body.worker_id)).toBe(workerId);

        const other = await global.api.post('/api/v2/gpu/workers/enrol').send({
            local_id: otherLocalId,
            name: `other-worker-${runId}`,
            slot_count: 1,
        });
        expect(other.status).toBe(200);
        otherWorkerId = Number(other.body.worker_id);
        const impersonation = await workerPost('/api/v2/gpu/poll').send({
            worker_id: otherWorkerId,
            slot_indexes: [0],
            wait_seconds: 0,
        });
        expect(impersonation.status).toBe(403);

        const artifactCheck = await workerPost('/api/v2/gpu/artifacts/check').send({
            worker_id: otherWorkerId,
            sha256: 'b'.repeat(64),
            bytes: 4,
        });
        expect(artifactCheck.status).toBe(403);

        const job = await db.gpu_jobs.create({
            kind: 'diagnostic',
            spec: { engine: 'mock', range: { start_frame: 0, end_frame: 0 } },
            state: 'leased',
            attempts_made: 1,
        });
        jobId = job.id;
        const attempt = await db.gpu_job_attempts.create({
            job_id: job.id,
            worker_id: otherWorkerId,
            lease_epoch: 1,
            lease_expires_at: new Date(Date.now() + 60_000),
        });
        attemptId = attempt.id;
        const artifactUpload = await request(app)
            .post(`/api/v2/gpu/artifacts/upload/${'c'.repeat(64)}?attempt_id=${attemptId}`)
            .set('Authorization', `Bearer ${global.workerCredential}`)
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from('test'));
        expect(artifactUpload.status).toBe(403);

        const release = await global.api.post('/api/v2/gpu/worker-releases').send({
            version: releaseVersion,
            platform: 'windows',
            architecture: 'x86_64',
            compute_runtime: 'cuda12.6',
            download_url: `https://github.com/MarineAppliedResearch/marp-inference-worker/releases/download/v${releaseVersion}/worker.zip`,
            size_bytes: 1234,
            sha256: 'a'.repeat(64),
        });
        expect(release.status).toBe(201);
        releaseId = release.body.id;

        const requested = await global.api
            .put(`/api/v2/gpu/workers/${workerId}/desired-release`)
            .send({ release_id: releaseId });
        expect(requested.status).toBe(200);
        expect(requested.body.update_state).toBe('update_requested');

        const discovered = await workerPost(`/api/v2/gpu/workers/${workerId}/check-in`).send({
            installed_version: '0.1.0',
            platform: 'windows',
            architecture: 'x86_64',
            compute_runtime: 'cuda12.6',
        });
        expect(discovered.status).toBe(200);
        expect(discovered.body.desired_release.id).toBe(releaseId);

        const failed = await workerPost(`/api/v2/gpu/workers/${workerId}/check-in`).send({
            installed_version: '0.1.0',
            platform: 'windows',
            architecture: 'x86_64',
            compute_runtime: 'cuda12.6',
            update_state: 'failed',
            update_message: 'deliberate test failure',
        });
        expect(failed.body.update_state).toBe('failed');
        expect(failed.body.desired_release).toBeNull();

        const later = await workerPost(`/api/v2/gpu/workers/${workerId}/check-in`).send({
            installed_version: '0.1.0',
            platform: 'windows',
            architecture: 'x86_64',
            compute_runtime: 'cuda12.6',
        });
        expect(later.body.update_state).toBe('failed');
        expect(later.body.desired_release).toBeNull();

        const retried = await global.api
            .put(`/api/v2/gpu/workers/${workerId}/desired-release`)
            .send({ release_id: releaseId });
        expect(retried.body.update_state).toBe('update_requested');
        expect(retried.body.desiredRelease.id).toBe(releaseId);

        await db.service_tokens.update({ revoked_at: new Date() }, { where: { service_token_id: tokenId } });
        const revoked = await workerPost('/api/v2/gpu/poll').send({
            worker_id: workerId,
            slot_indexes: [0],
            wait_seconds: 0,
        });
        expect(revoked.status).toBe(401);
    });
});
