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
let workerAppBefore;

function workerPost(path) {
    return request(app).post(path).set('Authorization', `Bearer ${global.workerCredential}`);
}

beforeAll(async () => {
    const workerApp = await db.service_clients.findOne({
        where: { name: 'MARP Inference Workers' },
    });
    workerAppExisted = Boolean(workerApp);
    workerAppBefore = workerApp?.get({ plain: true });
});

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
    } else if (workerAppBefore) {
        await db.service_clients.update({
            description: workerAppBefore.description,
            status: workerAppBefore.status,
            created_by_user_id: workerAppBefore.created_by_user_id,
            last_used_at: workerAppBefore.last_used_at,
            updatedAt: workerAppBefore.updatedAt,
        }, {
            where: { service_client_id: workerAppBefore.service_client_id },
            silent: true,
        });
    }
    delete global.workerCredential;
});

describe('worker activation and operator-selected updates', () => {
    it('uses one revocable installer enrollment code for separate machines', async () => {
        const activation = await global.api
            .post('/api/v2/gpu/worker-activation-codes')
            .send({ label: `installer-${runId}`, ttl_minutes: 10, max_uses: 2 });
        expect(activation.status).toBe(201);

        const activatedWorkers = [];
        try {
            for (const suffix of ['a', 'b']) {
                const response = await request(app)
                    .post('/api/v2/gpu/workers/activate')
                    .send({
                        activation_code: activation.body.activation_code,
                        local_id: `installer-${runId}-${suffix}`,
                        name: `installer-worker-${runId}-${suffix}`,
                        platform: 'windows',
                        architecture: 'x86_64',
                        compute_runtime: 'cuda12.6',
                        worker_version: '0.1.0',
                    });
                expect(response.status).toBe(201);
                activatedWorkers.push(Number(response.body.worker_id));
            }

            const exhausted = await request(app)
                .post('/api/v2/gpu/workers/activate')
                .send({
                    activation_code: activation.body.activation_code,
                    local_id: `installer-${runId}-c`,
                    name: `installer-worker-${runId}-c`,
                    platform: 'windows',
                    architecture: 'x86_64',
                    compute_runtime: 'cuda12.6',
                });
            expect(exhausted.status).toBe(401);
        } finally {
            const workers = await db.gpu_workers.findAll({ where: { id: activatedWorkers } });
            const tokenIds = workers.map((worker) => worker.service_token_id).filter(Boolean);
            await db.gpu_workers.destroy({ where: { id: activatedWorkers } });
            if (tokenIds.length) {
                await db.service_token_permissions.destroy({ where: { service_token_id: tokenIds } });
                await db.service_tokens.destroy({ where: { service_token_id: tokenIds } });
            }
            await db.worker_activation_codes.destroy({ where: { id: activation.body.id } });
        }
    });

    it('accepts a release from a source MARP publishes from, and refuses anywhere else (#253)', async () => {
        const version = `253-${runId}`;
        const body = {
            version,
            platform: 'windows',
            architecture: 'x86_64',
            compute_runtime: 'cuda12.6',
            size_bytes: 1234,
            sha256: 'b'.repeat(64),
        };
        // Somewhere else entirely, and another repository's assets: a worker runs whatever this
        // names, so the host is what says the publisher is ours.
        for (const url of [
            'https://files.example.com/worker.zip',
            'https://github.com/someone-else/marp-inference-worker/releases/download/v1/worker.zip',
        ]) {
            const refused = await global.api.post('/api/v2/gpu/worker-releases').send({ ...body, download_url: url });
            expect(refused.status).toBe(400);
            expect(refused.body.error.message).toMatch(/release sources MARP publishes from/);
        }

        // The GitHub path it has always accepted still works, configuration or not.
        const accepted = await global.api.post('/api/v2/gpu/worker-releases').send({
            ...body,
            download_url: `https://github.com/MarineAppliedResearch/marp-inference-worker/releases/download/v${version}/worker.zip`,
        });
        expect(accepted.status).toBe(201);
        await db.worker_releases.destroy({ where: { id: accepted.body.id } });
    });
    it('a code with no use limit keeps working, and a machine can enrol again (#208, #217)', async () => {
        // The code the volunteer installer carries must not stop working at a number nobody is
        // watching: a build of the worker has to keep working (Isaac, 2026-10-14).
        const code = `jest-standing-${runId}`;
        const [row] = await db.sequelize.query(
            `INSERT INTO worker_activation_codes (code_prefix, code_hash, label, expires_at, max_uses, use_count, "createdAt", "updatedAt")
             VALUES ('jest', :hash, :label, NOW() + INTERVAL '1 day', NULL, 0, NOW(), NOW())
             RETURNING id`,
            {
                // Hashed the way the repository hashes it; only the hash is ever stored.
                replacements: { hash: require('crypto').createHash('sha256').update(code).digest('hex'), label: `standing-${runId}` },
                type: db.Sequelize.QueryTypes.SELECT,
            }
        );
        const machines = [];
        const issuedTokens = [];
        const enrol = (suffix) => request(app).post('/api/v2/gpu/workers/activate').send({
            activation_code: code,
            local_id: `standing-${runId}-${suffix}`,
            name: `standing-worker-${runId}-${suffix}`,
            platform: 'linux',
            architecture: 'x86_64',
            compute_runtime: 'cuda12.8',
        });
        try {
            // More machines than any cap this used to carry would be tested with; the point is
            // that nothing counts down to zero.
            for (const suffix of ['a', 'b', 'c']) {
                const response = await enrol(suffix);
                expect(response.status).toBe(201);
                machines.push(Number(response.body.worker_id));
            }

            // The same machine again: activation spends the code before the worker writes the
            // credential, so a failed write used to leave it enrolled, unable to authenticate,
            // and refused for ever. It is issued a fresh credential instead (#217).
            const first = await db.gpu_workers.findOne({ where: { local_id: `standing-${runId}-a` } });
            // Kept for the cleanup: re-enrolling leaves the old credential revoked but present,
            // and a test removes every row it created.
            issuedTokens.push(first.service_token_id);
            const again = await enrol('a');
            expect(again.status).toBe(201);
            expect(Number(again.body.worker_id)).toBe(machines[0]);

            const after = await db.gpu_workers.findOne({ where: { local_id: `standing-${runId}-a` } });
            expect(after.service_token_id).not.toBe(first.service_token_id);
            // And the credential it held before is dead, so one machine never has two.
            const old = await db.service_tokens.findOne({ where: { service_token_id: first.service_token_id } });
            expect(old.revoked_at).not.toBeNull();
        } finally {
            const workers = await db.gpu_workers.findAll({ where: { id: machines } });
            const tokenIds = [...new Set(workers.map((worker) => worker.service_token_id)
                .concat(issuedTokens).filter(Boolean))];
            await db.gpu_workers.destroy({ where: { id: machines } });
            if (tokenIds.length) {
                await db.service_token_permissions.destroy({ where: { service_token_id: tokenIds } });
                await db.service_tokens.destroy({ where: { service_token_id: tokenIds } });
            }
            await db.worker_activation_codes.destroy({ where: { id: row.id } });
        }
    });

    it('binds a revocable credential to one worker and keeps failed updates terminal', async () => {
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
