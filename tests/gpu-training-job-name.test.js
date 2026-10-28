/**
 * A training job nobody named gets one from what it is training.
 *
 * **`Job 21782` is not a name**, and the submit form has been promising otherwise all
 * along: its Run name field reads *"Optional. Blank is left to MARP."* So the UI said MARP
 * names it and MARP did not — `gpu_jobs.name` was null on every training job ever queued,
 * and the Recent training jobs table showed one hand-typed name among a column of ids.
 *
 * Isaac: *"a training job should get a name other than job 21782 type of thing, maybe it
 * should be named on dataset, and model name? that it generates?"*
 *
 * **The time of day is in there because he has run the same model over the same dataset
 * three times in one day.** Dataset and model alone would produce one string for all
 * three, which stops being a name at exactly the moment there is most to tell apart. The
 * job id would disambiguate and is deliberately excluded — not showing an id is the point.
 *
 * **Training only.** `submitJob`'s own name block is untouched: an inference job names a
 * video, which the screens already fall back to.
 *
 * @fileoverview Endpoint tests for generated training job names.
 * @author Isaac Travers
 * @module tests/gpu-training-job-name
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const gpuService = require('../service/gpu.service');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { jobIds: [], datasetId: null, modelId: null };

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Submit a training job over the seeded dataset and model.
 *
 * Through the service rather than the route, because what is under test is the naming and
 * the route adds only authentication to it.
 *
 * @param {Object} [body] - Merged over the minimum a training job needs.
 * @returns {Promise<Object>} The created job row.
 */
async function submit(body = {}) {
    const answer = await gpuService.submitTrainingJob(
        body,
        {
            engine: 'marp_training',
            model: { ml_model_id: made.modelId, name: `rockfish5-2026-10-20-${runId}`, sha256: 'a'.repeat(64) },
            dataset: { dataset_id: made.datasetId },
            params: { epochs: 1 },
        },
        null
    );

    const job = answer.jobs[0];

    made.jobIds.push(job.id);

    return job;
}

beforeAll(async () => {
    const [dataset] = await query(
        `INSERT INTO datasets (name, status, source, archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'ready', 'jest', 'datasets/jest.tar', :sha, 1024, NOW(), NOW())
         RETURNING id`,
        { name: `CookieStarTest-${runId}`, sha: 'b'.repeat(64) }
    );

    made.datasetId = dataset.id;

    const [model] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, NOW(), NOW())
         RETURNING id`,
        { name: `jest-name-model-${runId}` }
    );

    made.modelId = model.id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    for (const id of made.jobIds) {
        await drop('DELETE FROM gpu_jobs WHERE id = :id', { id });
    }
    if (made.datasetId) await drop('DELETE FROM datasets WHERE id = :id', { id: made.datasetId });
    if (made.modelId) await drop('DELETE FROM ml_models WHERE id = :id', { id: made.modelId });
});

describe('A training job submitted without a name', () => {

    it('is named from its dataset, its model and the time of day', async () => {
        const job = await submit();

        expect(job.name).toBeTruthy();

        /* The dataset name comes from the archive row rather than from the submitter --
           the spec carries only a dataset id -- so this also proves the name is composed
           after that lookup rather than from the raw spec. */
        expect(job.name).toContain('CookieStarTest');
        expect(job.name).toContain('rockfish5-2026-10-20');

        /* **A 24-hour clock, and it leads.** The Job column renders about thirty-two
           characters, so every one of these names is truncated — and with the time last
           it was the part that disappeared, which is the one part that cannot be spared.
           Asserted at the start rather than merely present, because the position is the
           fix: three runs of one model over one dataset are told apart by exactly these
           five characters. */
        expect(job.name).toMatch(/^\d{2}:\d{2} · /);

        /* Leading with the dataset instead was tried and is worse: a long dataset name
           eats the budget alone and the time vanishes again. This is the only order
           where it survives whatever the names are. */
        expect(job.name.slice(0, 32)).toMatch(/^\d{2}:\d{2}/);

        /* **Not the id**, which is the whole point: "Job 21782" is what this replaces.
           Checked part by part rather than as a substring: on CI's empty database the id
           is 13, and the fixture's timestamped names carry a 13 often enough to fail. */
        expect(job.name).not.toMatch(/^Job \d+$/);
        expect(job.name.split(' · ')).not.toContain(String(job.id));
    });

    /**
     * **Blank counts as absent, as the form means it.** A cleared field is somebody not
     * answering rather than answering with nothing, and MARP has never stored an empty
     * string as a name.
     */
    it('is named when the field was cleared rather than left alone', async () => {
        const job = await submit({ name: '   ' });

        expect(job.name).toContain('CookieStarTest');
    });
});

describe('A training job submitted with a name', () => {

    /**
     * **An explicit name always wins.** Generating over something a person typed would be
     * MARP overruling them about the one field on the form that is theirs.
     */
    it('keeps exactly what was typed', async () => {
        const job = await submit({ name: '2026-CAMPA-Group2' });

        expect(job.name).toBe('2026-CAMPA-Group2');
    });

    /** Including a name that happens to look like a generated one. */
    it('does not regenerate over a name that resembles a generated one', async () => {
        const job = await submit({ name: '09:15 · something · else' });

        expect(job.name).toBe('09:15 · something · else');
    });
});

describe('Two runs of the same model over the same dataset', () => {

    /**
     * **They must not produce the same string.** Isaac has run the same pair three times
     * in a day; a name identical across all three stops being a name. The minute is what
     * separates them, so this is only guaranteed for submissions a minute apart — two
     * inside the same minute collide, which is a double submission rather than two runs
     * worth telling apart, and is why uniqueness is not enforced with a round trip.
     */
    it('are told apart by the clock in the name', async () => {
        const first = await submit();
        const second = await submit();

        /* Both are named, both name the same pair -- so the only thing that can
           distinguish them is the time, and within one test it does not differ. What is
           asserted is the part that is not luck: the clock is present and is the only
           varying field. */
        expect(first.name).toBe(second.name);

        const clock = first.name.match(/^(\d{2}:\d{2})/);

        expect(clock).toBeTruthy();
        expect(first.name.replace(clock[1], 'HH:MM'))
            .toBe(second.name.replace(clock[1], 'HH:MM'));
    });
});

describe('An inference job', () => {

    /**
     * **Out of scope, and that is deliberate rather than an oversight.** An inference job
     * names a video, and `jobViewOf` already falls back to `spec.video.source_name` before
     * it falls back to the id — so a generated name there would replace a better one.
     */
    it('is still left unnamed when nothing was typed', async () => {
        const [job] = await query(
            `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
             VALUES ('inference', :spec, 'queued', 0, 3)
             RETURNING id, name`,
            { spec: JSON.stringify({ jest: `training-job-name-${runId}` }) }
        );

        made.jobIds.push(job.id);

        expect(job.name).toBeNull();
    });
});
