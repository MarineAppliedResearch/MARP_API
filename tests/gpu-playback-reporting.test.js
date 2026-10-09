/**
 * HTTP/database tests for GPU-attempt playback reporting.
 *
 * PostgreSQL is real and disposable. Jellyfin is replaced only at its
 * repository boundary so these tests observe the worker HTTP contract and the
 * coordinator rows together without writing playback into a live account.
 *
 * @fileoverview GPU attempt lifecycle reporting to Jellyfin.
 * @author Isaac Travers
 * @module tests/gpu-playback-reporting
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');

const runId = Date.now();
const ITEM_ID = `jest-playback-item-${runId}`;
const RESOLVED_URL = `http://jellyfin.invalid/Videos/${ITEM_ID}/stream?api_key=test`;
const createdJobIds = [];
let workerId;

function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

async function submit(video = { jellyfin_item_id: ITEM_ID }, overrides = {}) {
    const response = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'inference',
            priority: 2000 + createdJobIds.length,
            max_attempts: 1,
            spec: {
                engine: 'ultralytics',
                model: { name: `jest-playback-model-${runId}`, sha256: '9'.repeat(64) },
                video,
                range: { start_frame: 100, end_frame: 200 },
                reduction: { name: 'v3_dirpad', version: 1 },
            },
            ...overrides,
        });

    expect(response.status).toBe(200);
    createdJobIds.push(...response.body.jobs.map((job) => job.id));
    return response.body.jobs[0];
}

async function lease(video, slotIndex = 2, overrides = {}) {
    const job = await submit(video, overrides);
    const response = await global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [slotIndex], wait_seconds: 0 });

    expect(response.status).toBe(200);
    expect(response.body.job_id).toBe(job.id);
    return { job, lease: response.body };
}

function activeSession(positionTicks = 44_000_000) {
    return {
        itemId: ITEM_ID,
        positionTicks,
        mediaSourceId: ITEM_ID,
        playSessionId: '',
    };
}

beforeAll(async () => {
    const [foreign] = await query('SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = \'queued\'');

    if (foreign.n > 0) {
        throw new Error(`${foreign.n} queued GPU job(s) would make this suite lease the wrong work.`);
    }

    const response = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-playback-local-${runId}`,
            name: `jest playback worker ${runId}`,
            slot_count: 16,
            worker_version: '0.0.1-jest',
        });

    expect(response.status).toBe(200);
    workerId = response.body.worker_id;
});

beforeEach(() => {
    jest.spyOn(jellyfinRepository, 'buildDirectStreamUrl').mockResolvedValue(RESOLVED_URL);
    jest.spyOn(jellyfinRepository, 'getItem').mockResolvedValue({
        id: ITEM_ID,
        name: 'playback test',
        path: 'C:/media/playback-test.mp4',
    });
    jest.spyOn(jellyfinRepository, 'reportPlaybackStarted').mockResolvedValue();
    jest.spyOn(jellyfinRepository, 'reportPlaybackProgress').mockResolvedValue();
    jest.spyOn(jellyfinRepository, 'reportPlaybackStopped').mockResolvedValue();
    jest.spyOn(jellyfinRepository, 'getPlaybackSession').mockResolvedValue(null);
});

afterEach(async () => {
    jest.restoreAllMocks();
    if (workerId) {
        await db.sequelize.query('UPDATE gpu_workers SET state = \'online\' WHERE id = :workerId', {
            replacements: { workerId },
        });
    }
});

afterAll(async () => {
    if (createdJobIds.length > 0) {
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
    }

    if (workerId) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :workerId', {
            replacements: { workerId },
        });
    }
});

describe('GPU Jellyfin playback lifecycle', () => {
    it('starts one session identified by the enrolled worker and leased slot', async () => {
        await lease({ jellyfin_item_id: ITEM_ID }, 7);

        expect(jellyfinRepository.reportPlaybackStarted).toHaveBeenCalledWith(
            ITEM_ID,
            { positionTicks: 40_000_000, playMethod: 'DirectStream' },
            {
                key: `gpu-worker-${workerId}-slot-7`,
                name: 'MARP GPU worker',
                deviceName: `jest playback worker ${runId} - slot 7`,
                version: '0.0.1-jest',
            }
        );
    });

    it('reports accepted frame progress as an absolute bounded media position', async () => {
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        const belowRange = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({
                worker_id: workerId,
                lease_epoch: leased.lease_epoch,
                state: 'running',
                progress: { done: -50, total: 100, unit: 'frames' },
            });
        const beyondRange = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({
                worker_id: workerId,
                lease_epoch: leased.lease_epoch,
                state: 'running',
                progress: { done: 150, total: 100, unit: 'frames' },
            });

        expect(belowRange.status).toBe(200);
        expect(beyondRange.status).toBe(200);
        expect(beyondRange.body.action).toBe('continue');
        expect(jellyfinRepository.reportPlaybackProgress.mock.calls).toEqual([
            [
                ITEM_ID,
                { positionTicks: 40_000_000, playMethod: 'DirectStream' },
                expect.objectContaining({ key: `gpu-worker-${workerId}-slot-2` }),
            ],
            [
                ITEM_ID,
                { positionTicks: 80_000_000, playMethod: 'DirectStream' },
                expect.objectContaining({ key: `gpu-worker-${workerId}-slot-2` }),
            ],
        ]);
    });

    it('stops a terminal attempt once and makes a result retry a no-op', async () => {
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.getPlaybackSession
            .mockResolvedValueOnce(activeSession())
            .mockResolvedValue(null);

        const body = {
            worker_id: workerId,
            lease_epoch: leased.lease_epoch,
            outcome: 'failed',
            failure_reason: 'intentional test failure',
            artifacts: [],
        };
        const first = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/result`)
            .send(body);
        const retry = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/result`)
            .send(body);

        expect(first.status).toBe(200);
        expect(retry.status).toBe(200);
        expect(retry.body.idempotent).toBe(true);
        expect(jellyfinRepository.reportPlaybackStopped).toHaveBeenCalledTimes(1);
        expect(jellyfinRepository.reportPlaybackStopped).toHaveBeenCalledWith(
            ITEM_ID,
            expect.objectContaining({ positionTicks: 44_000_000 }),
            expect.objectContaining({ key: `gpu-worker-${workerId}-slot-2` })
        );
    });

    it('stops playback when a valid heartbeat returns cancel', async () => {
        const { job, lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.getPlaybackSession.mockResolvedValue(activeSession());
        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: leased.lease_epoch, state: 'running' });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe('cancel');
        expect(jellyfinRepository.reportPlaybackStopped).toHaveBeenCalledTimes(1);
    });

    it('stops playback when a valid heartbeat returns pause', async () => {
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.getPlaybackSession.mockResolvedValue(activeSession());
        await db.sequelize.query('UPDATE gpu_workers SET state = \'paused\' WHERE id = :workerId', {
            replacements: { workerId },
        });

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: leased.lease_epoch, state: 'running' });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe('pause');
        expect(jellyfinRepository.reportPlaybackStopped).toHaveBeenCalledTimes(1);
    });

    it('stops playback when a valid heartbeat abandons work the job moved past', async () => {
        const { job, lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.getPlaybackSession.mockResolvedValue(activeSession());
        await db.sequelize.query('UPDATE gpu_jobs SET state = \'failed\' WHERE id = :jobId', {
            replacements: { jobId: job.id },
        });

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: leased.lease_epoch, state: 'running' });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe('abandon');
        expect(jellyfinRepository.reportPlaybackStopped).toHaveBeenCalledTimes(1);
    });

    it('does not let a refused heartbeat stop another worker slot session', async () => {
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.getPlaybackSession.mockResolvedValue(activeSession());

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: leased.lease_epoch + 1, state: 'running' });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe('abandon');
        expect(jellyfinRepository.getPlaybackSession).not.toHaveBeenCalled();
        expect(jellyfinRepository.reportPlaybackStopped).not.toHaveBeenCalled();
    });

    it('reconstructs an expired attempt identity from PostgreSQL and stops its live session', async () => {
        const { job, lease: leased } = await lease({ jellyfin_item_id: ITEM_ID }, 5);
        jellyfinRepository.getPlaybackSession.mockResolvedValue(activeSession(55_000_000));
        await db.sequelize.query(
            'UPDATE gpu_job_attempts SET lease_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = :attemptId',
            { replacements: { attemptId: leased.attempt_id } }
        );

        const response = await global.api.get(`/api/v2/gpu/jobs/${job.id}`);

        expect(response.status).toBe(200);
        expect(response.body.attempts[0].state).toBe('abandoned');
        expect(jellyfinRepository.getPlaybackSession).toHaveBeenCalledWith(
            expect.objectContaining({ key: `gpu-worker-${workerId}-slot-5` })
        );
        expect(jellyfinRepository.reportPlaybackStopped).toHaveBeenCalledTimes(1);
    });

    it('keeps leasing when Jellyfin start reporting fails and records the failure', async () => {
        jellyfinRepository.reportPlaybackStarted.mockRejectedValue(new Error('test Jellyfin outage'));
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        const notes = await query(
            `SELECT payload FROM gpu_job_events
              WHERE attempt_id = :attemptId AND kind = 'note'
              ORDER BY seq`,
            { attemptId: leased.attempt_id }
        );

        expect(leased.attempt_id).toEqual(expect.any(Number));
        expect(notes.map((row) => row.payload)).toContainEqual(expect.objectContaining({
            note: 'Jellyfin GPU playback reporting failed',
            operation: 'started',
            reason: 'test Jellyfin outage',
        }));
    });

    it('keeps heartbeating when Jellyfin progress reporting fails', async () => {
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.reportPlaybackProgress.mockRejectedValue(new Error('test progress outage'));

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/heartbeat`)
            .send({
                worker_id: workerId,
                lease_epoch: leased.lease_epoch,
                state: 'running',
                progress: { done: 10, total: 100, unit: 'frames' },
            });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe('continue');
        const [note] = await query(
            `SELECT payload FROM gpu_job_events
              WHERE attempt_id = :attemptId AND kind = 'note' AND payload->>'operation' = 'progress'`,
            { attemptId: leased.attempt_id }
        );
        expect(note.payload.reason).toBe('test progress outage');
    });

    it('keeps a terminal result accepted when Jellyfin stop reporting fails', async () => {
        const { lease: leased } = await lease({ jellyfin_item_id: ITEM_ID });
        jellyfinRepository.getPlaybackSession.mockResolvedValue(activeSession());
        jellyfinRepository.reportPlaybackStopped.mockRejectedValue(new Error('test stop outage'));

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${leased.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: leased.lease_epoch,
                outcome: 'failed',
                failure_reason: 'intentional test failure',
                artifacts: [],
            });

        expect(response.status).toBe(200);
        expect(response.body.accepted).toBe(true);
        const [note] = await query(
            `SELECT payload FROM gpu_job_events
              WHERE attempt_id = :attemptId AND kind = 'note' AND payload->>'operation' = 'stopped'`,
            { attemptId: leased.attempt_id }
        );
        expect(note.payload.reason).toBe('test stop outage');
    });

    it('does not report playback for a bare URL job', async () => {
        await lease({
            url: `http://jest.invalid/video-${runId}.mp4`,
            source_name: `video-${runId}.mp4`,
        });

        expect(jellyfinRepository.reportPlaybackStarted).not.toHaveBeenCalled();
        expect(jellyfinRepository.getPlaybackSession).not.toHaveBeenCalled();
    });
});
