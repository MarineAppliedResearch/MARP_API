/**
 * What the pool view says about a machine's hardware (#104, gap 27).
 *
 * The telemetry was never missing -- the worker reads NVML on every poll and
 * MARP stores the reading on the attempt that poll opens. What was missing was
 * any way to reach it from `GET /gpu/workers`, which is the read the Workers
 * screen makes.
 *
 * Three cases, and the two negative ones matter as much as the first: a column
 * that shows a number for a busy machine and silently shows the *same* number
 * for an idle one would be worse than the dash it replaced.
 *
 * The snapshots here are real shapes, taken from what a worker actually stored:
 * `capabilities.resources.nvidia.devices[]`, each device carrying the worker's
 * own field names. They are not invented, and they are not renamed on the way
 * through -- see `DESIGN.md` item 16.
 *
 * @fileoverview Route tests for GPU telemetry on the pool view.
 * @author Isaac Travers
 * @module tests/gpu-pool-telemetry
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run. @type {string} */
const marker = `telemetry-${Date.now()}`;

/** Worker ids created here, removed in afterAll. @type {Array<number>} */
const createdWorkerIds = [];

/** Job ids created here, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/**
 * One device, shaped as `resource_monitor.py` reports it.
 *
 * @constant
 * @type {Object}
 */
const DEVICE = {
    device_index: 0,
    name: 'NVIDIA GeForce RTX 4080 SUPER',
    uuid: 'GPU-00000000-0000-0000-0000-000000000000',
    pci_bus_id: '00000000:01:00.0',
    temperature_c: 34,
    fan_speed_percent: 0,
    power_usage_watts: 7.68,
    power_limit_watts: 320,
    graphics_clock_mhz: 210,
    memory_clock_mhz: 405,
    gpu_utilization_percent: 22,
    memory_utilization_percent: 3,
    memory_total_bytes: 17171480576,
    memory_free_bytes: 16156016640,
    memory_used_bytes: 1015463936,
    memory_percent_used: 5.91,
};

/**
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * A worker that was heard from just now, so the stale sweep leaves it alone.
 *
 * These machines never poll, and work is only ever handed to a machine that
 * polls for it, so an online one with a free slot cannot be given somebody
 * else's job. `slot_count` is 1 rather than 0 because `gpu_workers_slot_count_check`
 * requires it -- a machine with no slots is not a machine.
 *
 * @param {string} suffix - Distinguishes it from this suite's other machines.
 * @returns {Promise<number>} Its id.
 */
async function enrol(suffix) {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, state, slot_count, enrolled_at, last_seen_at)
         VALUES (:localId, :name, 'online', 1, NOW(), NOW())
         RETURNING id`,
        { localId: `${marker}-${suffix}-local`, name: `${marker}-${suffix}` }
    );

    createdWorkerIds.push(worker.id);

    return worker.id;
}

/**
 * Give a worker a live attempt carrying the given snapshot.
 *
 * The lease is an hour out, so `expireStaleLeases` -- which every pool read runs
 * first -- does not take the attempt back before the assertion sees it.
 *
 * @param {number} workerId - The machine.
 * @param {?Object} snapshot - What to store as `capabilities_snapshot`.
 * @returns {Promise<void>}
 */
async function leaseTo(workerId, snapshot) {
    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, priority, attempts_made, max_attempts, created_at, updated_at)
         VALUES ('inference', :spec, 'leased', 0, 1, 3, NOW(), NOW())
         RETURNING id`,
        {
            spec: JSON.stringify({
                engine: 'ultralytics',
                video: { source_name: `${marker}-video` },
                range: { start_frame: 0, end_frame: 100 },
            }),
        }
    );

    createdJobIds.push(job.id);

    await query(
        `INSERT INTO gpu_job_attempts
                (job_id, worker_id, slot_index, lease_epoch, state, leased_at,
                 lease_expires_at, capabilities_snapshot)
         VALUES (:jobId, :workerId, 0, 1, 'running', NOW(),
                 NOW() + INTERVAL '1 hour', :snapshot)
         RETURNING id`,
        {
            jobId: job.id,
            workerId,
            snapshot: snapshot === null ? null : JSON.stringify(snapshot),
        }
    );
}

/**
 * This suite's machines, out of the pool view.
 *
 * @returns {Promise<Array<Object>>} The workers whose name carries the marker.
 */
async function pool() {
    const response = await global.api.get('/api/v2/gpu/workers');

    expect(response.status).toBe(200);

    return response.body.filter((worker) => worker.name.startsWith(marker));
}

afterAll(async () => {
    if (createdJobIds.length) {
        await db.sequelize.query(
            `DELETE FROM gpu_job_events
              WHERE attempt_id IN (SELECT id FROM gpu_job_attempts WHERE job_id IN (:ids))`,
            { replacements: { ids: createdJobIds } }
        );

        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', {
            replacements: { ids: createdJobIds },
        });

        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: createdJobIds },
        });
    }

    if (createdWorkerIds.length) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id IN (:ids)', {
            replacements: { ids: createdWorkerIds },
        });
    }
});

describe('R5 — the pool view reaches the telemetry MARP already stores', () => {
    test('a busy machine carries its GPUs, in the worker\'s own field names', async () => {
        const workerId = await enrol('busy');
        await leaseTo(workerId, { resources: { nvidia: { nvml_available: true, devices: [DEVICE] } } });

        const [worker] = (await pool()).filter((entry) => entry.worker_id === workerId);

        expect(worker.activity).toBe('busy');
        expect(worker.attempts).toHaveLength(1);

        const { telemetry } = worker.attempts[0];

        expect(telemetry).not.toBeNull();
        expect(telemetry.gpus).toHaveLength(1);

        /* Named as the worker names them. A tidier `utilization` here would make
           this the one place in MARP that calls it that. */
        expect(telemetry.gpus[0]).toEqual({
            device_index: 0,
            name: 'NVIDIA GeForce RTX 4080 SUPER',
            gpu_utilization_percent: 22,
            memory_utilization_percent: 3,
            memory_used_bytes: 1015463936,
            memory_total_bytes: 17171480576,
            memory_percent_used: 5.91,
            temperature_c: 34,
            power_usage_watts: 7.68,
            power_limit_watts: 320,
        });
    });

    test('it is reduced to the GPUs, not the whole capabilities blob', async () => {
        const workerId = await enrol('reduced');
        await leaseTo(workerId, {
            slots: 4,
            engines: ['ultralytics'],
            resources: {
                cpu: { physical_cores: 16 },
                disk: { free_bytes: 1 },
                network: { sent_bytes: 1 },
                nvidia: { nvml_available: true, devices: [DEVICE] },
            },
        });

        const [worker] = (await pool()).filter((entry) => entry.worker_id === workerId);
        const { telemetry } = worker.attempts[0];

        /* Gap 12 already records this route as megabytes a refresh at scale. A
           second whole blob per live attempt makes the worse problem worse. */
        expect(Object.keys(telemetry).sort()).toEqual(['as_of', 'gpus']);
        expect(JSON.stringify(telemetry)).not.toMatch(/physical_cores|sent_bytes|ultralytics/);
    });

    test('the reading is stamped with when the lease opened, not with now', async () => {
        const [worker] = (await pool()).filter((entry) => entry.name.endsWith('-busy'));
        const { telemetry, attempt_id: attemptId } = worker.attempts[0];

        const [attempt] = await query(
            'SELECT leased_at FROM gpu_job_attempts WHERE id = :attemptId', { attemptId }
        );

        /* The heartbeat carries the attempt's progress and nothing about the
           hardware, so this number is as old as the lease. A screen that drew it
           as live would be overstating what is known. */
        expect(new Date(telemetry.as_of).getTime()).toBe(new Date(attempt.leased_at).getTime());
    });

    test('a machine that reported no GPU carries null, not an empty reading', async () => {
        const workerId = await enrol('nogpu');
        await leaseTo(workerId, { resources: { nvidia: { nvml_available: false, error: 'no driver' } } });

        const [worker] = (await pool()).filter((entry) => entry.worker_id === workerId);

        expect(worker.attempts[0].telemetry).toBeNull();
    });

    test('an idle machine has no attempt, so there is nothing to show', async () => {
        const workerId = await enrol('idle');

        const [worker] = (await pool()).filter((entry) => entry.worker_id === workerId);

        expect(worker.activity).toBe('idle');
        expect(worker.attempts).toEqual([]);
    });
});
