/**
 * A worker's dataset cache: the floor it keeps, the size it is told, and clearing it.
 *
 * #320. A worker caches every training dataset it fetches -- 20 GB for the largest so far
 * -- and nothing ever removed one. Settled with Isaac on 2026-10-31: it evicts its least
 * recently used datasets to keep 50 GB of disk free, adjustable per worker from MARP, and
 * the cache can be cleared on request.
 *
 * @fileoverview Dataset cache floor, archive size on lease, clear request, pool report.
 * @author Isaac Travers
 * @module tests/gpu-dataset-cache
 */

'use strict';

const db = require('../model');
const gpuService = require('../service/gpu.service');

const runId = Date.now();
const made = { workerId: null, datasetId: null };

/** The default floor: 50 GB, decimal. */
const DEFAULT_FLOOR = 50 * 1000 ** 3;

/** A training spec naming this file's dataset, as a stored job holds it. */
const spec = () => ({
    engine: 'marp_training',
    model: { name: 'yolo11m.pt', sha256: 'b'.repeat(64) },
    dataset: { dataset_id: made.datasetId, url: `/api/v2/gpu/datasets/${made.datasetId}/archive`, sha256: 'c'.repeat(64) },
});

/** A cache report, shaped as the worker's dataset module writes it. */
const report = {
    bytes: 1939871777,
    partial_bytes: 0,
    entries: [{ sha256: 'd'.repeat(64), bytes: 1939871777, last_used_at: '2026-10-31T17:00:00+00:00', in_use: false }],
    disk: { total_bytes: 1999210803200, free_bytes: 107000000000 },
    keep_free_bytes: DEFAULT_FLOOR,
};

beforeAll(async () => {
    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-cache-local-${runId}`,
            name: `jest-cache-worker-${runId}`,
            slot_count: 1,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [], engines: ['marp_training'] },
        });
    made.workerId = enrolled.body.worker_id;

    const [dataset] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'test', 10, 2, 'test', 'ready', :path, :sha, 1963637760, now(), now())
         RETURNING id`,
        {
            replacements: { name: `jest-cache-dataset-${runId}`, path: `datasets/${'c'.repeat(64)}.tar`, sha: 'c'.repeat(64) },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    made.datasetId = dataset[0].id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
    if (made.workerId) {
        await drop('DELETE FROM gpu_worker_samples WHERE worker_id = :id', { id: made.workerId });
        await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
    }
    if (made.datasetId) await drop('DELETE FROM datasets WHERE id = :id', { id: made.datasetId });
});

describe('A leased training job tells the worker about room (#320)', () => {

    it('carries the archive size and the default floor', async () => {
        const leased = await gpuService.resolveSpecForLease(spec(), made.workerId);

        expect(leased.dataset.size_bytes).toBe(1963637760);
        expect(leased.dataset.keep_free_bytes).toBe(DEFAULT_FLOOR);
    });

    it('carries the floor set for this machine, and the default again once it is cleared', async () => {
        const set = await global.api
            .put(`/api/v2/gpu/workers/${made.workerId}/dataset-cache/floor`)
            .send({ keep_free_bytes: 10 * 1000 ** 3 });

        expect(set.status).toBe(200);
        expect(set.body).toEqual({ worker_id: made.workerId, keep_free_bytes: 10 * 1000 ** 3, is_default: false });
        expect((await gpuService.resolveSpecForLease(spec(), made.workerId)).dataset.keep_free_bytes).toBe(10 * 1000 ** 3);

        const reset = await global.api
            .put(`/api/v2/gpu/workers/${made.workerId}/dataset-cache/floor`)
            .send({ keep_free_bytes: null });

        expect(reset.body).toEqual({ worker_id: made.workerId, keep_free_bytes: DEFAULT_FLOOR, is_default: true });
        expect((await gpuService.resolveSpecForLease(spec(), made.workerId)).dataset.keep_free_bytes).toBe(DEFAULT_FLOOR);
    });

    it('refuses a floor that is not a whole number of bytes, and an unknown worker', async () => {
        const path = `/api/v2/gpu/workers/${made.workerId}/dataset-cache/floor`;

        expect((await global.api.put(path).send({ keep_free_bytes: -1 })).status).toBe(400);
        expect((await global.api.put(path).send({ keep_free_bytes: '50GB' })).status).toBe(400);
        expect((await global.api.put(path).send({})).status).toBe(400);
        expect((await global.api.put('/api/v2/gpu/workers/2147483000/dataset-cache/floor').send({ keep_free_bytes: 1 })).status).toBe(404);
    });
});

describe('Clearing a worker\'s dataset cache (#320)', () => {

    const poll = () => global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: made.workerId, wait_seconds: 0, free_slot_indexes: [], capabilities: { resources: {} } });

    it('is carried to the machine on its next poll, once', async () => {
        const asked = await global.api.post(`/api/v2/gpu/workers/${made.workerId}/dataset-cache/clear`);

        expect(asked.status).toBe(200);
        expect(asked.body.clear_dataset_cache_requested_at).toBeTruthy();

        const first = await poll();
        expect(first.headers['x-marp-worker-instructions']).toBe('clear-dataset-cache');

        const second = await poll();
        expect(second.headers['x-marp-worker-instructions']).toBeUndefined();
    });

    it('refuses an unknown worker', async () => {
        expect((await global.api.post('/api/v2/gpu/workers/2147483000/dataset-cache/clear')).status).toBe(404);
    });
});

describe('The pool view shows each worker\'s dataset cache (#320)', () => {

    it('carries what the machine last reported, and the floor it keeps', async () => {
        await global.api
            .post('/api/v2/gpu/poll')
            .send({
                worker_id: made.workerId,
                wait_seconds: 0,
                free_slot_indexes: [],
                capabilities: { resources: { cpu: { percent: 5 }, dataset_cache: report } },
            });

        const pool = await global.api.get('/api/v2/gpu/workers');
        const mine = (pool.body.workers || pool.body).find((worker) => worker.worker_id === made.workerId);

        expect(mine.dataset_cache).toEqual(report);
        expect(mine.dataset_keep_free_bytes).toBe(DEFAULT_FLOOR);
        expect(mine.dataset_keep_free_is_default).toBe(true);
    });
});
