/**
 * Does the data layer answer the way the real routes do?
 *
 * Covers #128's R2 to R6. It asks the module directly rather than through a
 * screen, because the shape of an answer and the way a table draws it are two
 * different claims and a test that mixes them cannot say which one broke.
 *
 * Runs in a browser for one reason: `mockups/api.js` is a plain script that
 * reads `window` and `location` as it loads. Shimming those in node would be
 * testing a different module from the one the screens get.
 *
 *   node tools/data-layer-check.mjs
 *
 * @fileoverview R2-R6: the layer's shapes, determinism, scale, states and switch.
 * @module tools/data-layer-check
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.LAYER_PORT || 8137);
const BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/mockups/`;

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
await new Promise((done) => setTimeout(done, 500));

const problems = [];
/** @param {boolean} ok @param {string} what */
const check = (ok, what) => { if (!ok) problems.push(what); };

const browser = await chromium.launch();
const page = await browser.newPage();

/* ------------------------------------------------------------------ R2 */

await page.goto(`${BASE}jobs.html`, { waitUntil: 'load' });

const shapes = await page.evaluate(async () => {
    const api = window.MarpApi;
    const page1 = await api.listJobs({ limit: 10 });
    const page2 = await api.listJobs({ limit: 10, offset: 10 });
    const workers = await api.listWorkers();
    const submitted = await api.submitJob({ kind: 'inference' });
    const detail = await api.getJob(page1.jobs[0].id);

    return {
        jobsKeys: Object.keys(page1).sort(),
        jobsHonoursLimit: page1.jobs.length === 10,
        jobsHonoursOffset: page1.jobs[0].id !== page2.jobs[0].id,
        jobsTotalIsWhole: page1.total > page1.jobs.length,
        workersIsArray: Array.isArray(workers),
        workersUnpaged: workers.length > 100,
        submitStatus: submitted.status,
        detailKeys: Object.keys(detail).sort(),
        /* The attempt's own field names, so the route learning to carry
           progress renames nothing (gap 23). */
        progressFields: Object.keys(page1.jobs[0]).filter((k) => k.startsWith('progress_')).sort(),
    };
});

check(shapes.jobsKeys.join(',') === 'jobs,limit,offset,total',
    `R2: GET /gpu/jobs answers {${shapes.jobsKeys.join(', ')}}, expected {jobs, limit, offset, total}`);
check(shapes.jobsHonoursLimit, 'R2: GET /gpu/jobs ignored limit');
check(shapes.jobsHonoursOffset, 'R2: GET /gpu/jobs ignored offset — page 2 began with page 1\'s first job');
check(shapes.jobsTotalIsWhole, 'R2: total is not the whole matching set, only the page');
check(shapes.workersIsArray && shapes.workersUnpaged,
    'R2: GET /gpu/workers should be a bare, unpaged array of the whole pool (gap 12)');
check(shapes.submitStatus === 200, `R2: POST /gpu/jobs answered ${shapes.submitStatus}, and the real route answers 200`);
check(shapes.detailKeys.join(',') === 'artifacts,attempts,job',
    `R2: GET /gpu/jobs/:id answers {${shapes.detailKeys.join(', ')}}`);
check(shapes.progressFields.join(',') === 'progress_done,progress_elapsed_s,progress_phase,progress_total,progress_unit',
    `R2: a job carries ${shapes.progressFields.join(', ') || 'no progress fields'}, not the attempt's own names`);

/* ------------------------------------------------------------------ R3 */

/** One load's answers, serialised. @returns {Promise<string>} */
const fingerprint = async () => {
    await page.goto(`${BASE}jobs.html`, { waitUntil: 'load' });
    return page.evaluate(async () => {
        const api = window.MarpApi;
        const [jobs, workers, models, datasets] = await Promise.all([
            api.listJobs({ limit: 500 }), api.listWorkers(), api.listModels(), api.listDatasets(),
        ]);
        return JSON.stringify([jobs.jobs, workers, models, datasets]);
    });
};

const first = await fingerprint();
const second = await fingerprint();
check(first === second, 'R3: two loads produced different data; the corpus is not deterministic');
check(first.length > 100000, 'R3: the corpus serialised to almost nothing, so the comparison proves little');

/* ------------------------------------------------------------------ R4, R5 */

await page.goto(`${BASE}jobs.html`, { waitUntil: 'load' });

const corpus = await page.evaluate(async () => {
    const api = window.MarpApi;
    const workers = await api.listWorkers();
    const all = await api.listJobs({ limit: 500 });

    const states = {};
    for (const job of all.jobs) states[job.state] = (states[job.state] || 0) + 1;

    /* `cancelling` is derived, not stored: a cancelled job still holding a live
       attempt. Only the detail route returns attempts, so this asks it. */
    let cancellingReachable = 0;
    for (const job of all.jobs.filter((j) => j.state === 'cancelled').slice(0, 40)) {
        const detail = await api.getJob(job.id);
        if (detail.attempts.some((a) => ['assigned', 'preparing', 'running', 'uploading'].includes(a.state))) {
            cancellingReachable += 1;
        }
    }

    /* `issues` is derived too: a batch holding both a success and a failure. */
    const byBatch = {};
    for (const job of all.jobs) {
        if (!job.batch_id) continue;
        (byBatch[job.batch_id] ||= []).push(job.state);
    }
    const mixedBatches = Object.values(byBatch)
        .filter((s) => s.includes('succeeded') && (s.includes('failed') || s.includes('expired'))).length;

    /* A state reachable only deep in the list is invisible on the screen
       somebody opens, so the first page is checked separately. */
    const firstPage = await api.listJobs({ limit: 50 });
    const firstPageBatches = {};
    for (const job of firstPage.jobs) {
        if (!job.batch_id) continue;
        (firstPageBatches[job.batch_id] ||= []).push(job.state);
    }
    const mixedOnFirstPage = Object.values(firstPageBatches)
        .filter((s) => s.includes('succeeded') && (s.includes('failed') || s.includes('expired'))).length;

    const slots = workers.reduce((sum, w) => sum + w.slot_count, 0);
    const held = workers.reduce((sum, w) => sum + w.attempts.length, 0);
    const leased = all.jobs.filter((j) => j.state === 'leased').length;

    return {
        workers: workers.length,
        jobs: all.total,
        states,
        cancellingReachable,
        mixedBatches,
        mixedOnFirstPage,
        slots,
        held,
        leased,
        noHeartbeat: all.jobs.filter((j) => j.state === 'leased' && j.progress_done === null).length,
        neverHeard: workers.filter((w) => w.last_seen_at === null).length,
        busyAgrees: workers.filter((w) => w.activity === 'busy').length === workers.filter((w) => w.attempts.length > 0).length,
    };
});

check(corpus.workers === 143, `R4: the pool is ${corpus.workers} machines, and the requirement is 143`);
check(corpus.jobs >= 200, `R4: ${corpus.jobs} jobs is not the "bounded window over hundreds" R4 asks for`);
check(corpus.held <= corpus.slots, `R4: ${corpus.held} attempts are held across ${corpus.slots} slots, which is more work than capacity`);
check(corpus.busyAgrees, 'R4: a machine is busy exactly while it holds a live attempt, and the two disagree');

for (const state of ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired']) {
    check((corpus.states[state] || 0) > 0, `R5: no job is in state "${state}", so the screen cannot draw it`);
}
check(corpus.cancellingReachable > 0, 'R5: no cancelled job holds a live attempt, so `cancelling` cannot be derived at all');
check(corpus.mixedBatches > 0, 'R5: no batch finished with some pieces failed, so `issues` cannot be derived at all');
check(corpus.mixedOnFirstPage > 0, 'R5: a batch with issues exists but none is on the first page, so nobody sees the state');
check(corpus.noHeartbeat > 0, 'R5: no running job is waiting on its first heartbeat, so the dash-not-zero case is untested');

/* ------------------------------------------------------------------ R6 */

await page.goto(`${BASE}jobs.html?mock=slow`, { waitUntil: 'load' });
const slow = await page.evaluate(async () => {
    const started = performance.now();
    await window.MarpApi.listJobs({ limit: 5 });
    return Math.round(performance.now() - started);
});
check(slow > 1800, `R6: ?mock=slow took ${slow}ms, which is not a slow answer`);

await page.goto(`${BASE}jobs.html?mock=fail:jobs`, { waitUntil: 'load' });
const failure = await page.evaluate(async () => {
    const api = window.MarpApi;
    let jobs = null;
    try { await api.listJobs({}); } catch (error) { jobs = { name: error.name, status: error.status }; }
    let workers = null;
    try { workers = (await api.listWorkers()).length; } catch (error) { workers = `threw ${error.message}`; }
    return { jobs, workers };
});
check(failure.jobs && failure.jobs.status === 500,
    `R6: ?mock=fail:jobs gave ${JSON.stringify(failure.jobs)}, expected a 500`);
check(typeof failure.workers === 'number',
    'R6: ?mock=fail:jobs took the worker routes down with it; the switch names one route');

await page.goto(`${BASE}jobs.html`, { waitUntil: 'load' });
const clean = await page.evaluate(async () => {
    const started = performance.now();
    try {
        await window.MarpApi.listJobs({});
        return { threw: false, ms: Math.round(performance.now() - started) };
    } catch { return { threw: true }; }
});
check(!clean.threw && clean.ms < 500, 'R6: the default path should be instant and successful');

await browser.close();
stop();

if (problems.length) {
    console.error('');
    for (const problem of problems) console.error('[x] ' + problem);
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} in the data layer.`);
    process.exit(1);
}

console.log(`ok  the layer answers like the routes: ${corpus.workers} machines unpaged, `
    + `${corpus.jobs} jobs paged, all six states reachable, deterministic, and failable on demand`);
