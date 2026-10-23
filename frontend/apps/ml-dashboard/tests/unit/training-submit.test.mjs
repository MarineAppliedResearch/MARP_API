/**
 * The detection form queues a real training job, or says why it cannot.
 *
 * **The refusals are most of what this is for.** A training spec has to carry
 * `spec.model.sha256`; the worker hashes what it fetched and refuses a mismatch, and
 * `validateSubmittedModel` refuses a spec without one. Two things on this screen can
 * produce a selection that has no checksum behind it — a model registered before
 * `ml_models.artifact_sha256` existed, and the *upstream checkpoint* option, whose value
 * is a sentence where every other option carries a model id. Both would reach the API as
 * a 400 that reads like a defect in this screen, so both are caught here and said
 * plainly.
 *
 * **`spec.dataset` is an id and `spec.model` is not, and that asymmetry is asserted.**
 * `submitTrainingJob` composes the dataset's locator and hash from `datasets` itself;
 * nothing composes the model's. Sending a dataset url from here would be this screen
 * naming a file path on the coordinator, which is the thing the locator rules exist to
 * prevent.
 *
 * The jsdom boot lives in `screen.mjs`, shared with the other screen tests.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A registered model, as `GET /api/v2/ml_models` returns one. */
const model = (id, name, sha) => ({
    id,
    name,
    model_type: 'detection',
    status: 'active',
    storage_path: `models/${name}/weights/${name}.pt`,
    artifact_sha256: sha,
});

/** Model 412, the one Isaac asked to test against — the output of the run that worked. */
const ROCKFISH5 = model(412, 'rockfish5-2026-10-20',
    '5e5aaa5a6ee6023734f154766b000c85805924178b865e3569d61592fcca0b89');

/**
 * Draw the Training screen, with the submissions it makes captured.
 *
 * @param {Object} t - The test, for its `after` hook.
 * @param {Object} [options] - `models` to offer, and `fail` to make the submit reject.
 * @returns {Promise<{screen: Object, sent: Object[]}>}
 */
async function trainingScreen(t, options = {}) {
    const sent = [];
    const screen = await drawScreen('training.html', {
        listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
        listModels: async () => options.models || [ROCKFISH5],
        listDatasets: async () => [{ id: 294, name: 'rockfish5', status: 'ready' }],
        listWorkers: async () => [],
        submitJob: async (body) => {
            sent.push(body);

            if (options.fail) throw Object.assign(new Error(options.fail.message), { status: options.fail.status });

            return { batch_id: null, jobs: [{ id: 21599, state: 'queued' }] };
        },
    });

    t.after(screen.close);

    return { screen, sent };
}

/**
 * Click Start training and let the handler settle.
 *
 * @param {Object} screen - From `trainingScreen`.
 * @returns {Promise<string>} What the status line says afterwards.
 */
async function start(screen) {
    screen.document.querySelector('#trainBtn').click();

    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    return screen.document.querySelector('[data-fills="train-status"]').textContent;
}

/**
 * Pick an option by its text.
 *
 * @param {Object} screen - From `trainingScreen`.
 * @param {string} id - The select's id.
 * @param {RegExp} matching - What its text should match.
 * @returns {void}
 */
function choose(screen, id, matching) {
    const select = screen.document.querySelector(`#${id}`);
    const at = [...select.options].findIndex((option) => matching.test(option.text));

    assert.ok(at >= 0, `#${id} should offer something matching ${matching}, it offers ${
        [...select.options].map((o) => o.text).join(' / ')}`);
    select.selectedIndex = at;
}

test('queues a detection job naming the model by id, name and checksum', async (t) => {
    const { screen, sent } = await trainingScreen(t);

    choose(screen, 'base-det', /rockfish5-2026-10-20/);
    choose(screen, 'dataset-det', /rockfish5/);

    const said = await start(screen);

    assert.equal(sent.length, 1, 'one click, one job');

    const body = sent[0];

    assert.equal(body.kind, 'training');
    assert.equal(body.spec.engine, 'marp_training');

    /* Spread into this realm first: the object was built inside jsdom, so its prototype
       is that window's Object and a strict deep-equal fails on identity alone. */
    assert.deepEqual({ ...body.spec.model }, {
        ml_model_id: 412,
        name: 'rockfish5-2026-10-20',
        url: '/api/v2/model/412/artifact',
        sha256: ROCKFISH5.artifact_sha256,
    }, 'the worker verifies its download against this sha256, so it has to be the real one');

    /* The id alone. `submitTrainingJob` composes the url and the archive hash from
       `datasets`, and a url sent from here would be this screen naming a path on the
       coordinator. */
    assert.deepEqual({ ...body.spec.dataset }, { dataset_id: 294 });

    assert.equal(body.spec.params.epochs, 100, 'the form parameters travel with it');
    assert.match(said, /21599/, 'the status names the job id, which is what the Jobs filter takes');
});

test('refuses a model with no recorded checksum, and says what to run', async (t) => {
    /* Every model registered before `ml_models.artifact_sha256` existed is in this state
       — fourteen of sixteen on Isaac's machine when the column landed. The API would
       answer 400 on `spec.model.sha256`, which reads as a bug in this screen. */
    const { screen, sent } = await trainingScreen(t, { models: [model(175, 'NOAA-Sea-Urchin-Detector', null)] });

    choose(screen, 'base-det', /NOAA-Sea-Urchin-Detector/);
    choose(screen, 'dataset-det', /rockfish5/);

    const said = await start(screen);

    assert.equal(sent.length, 0, 'nothing is submitted');
    assert.match(said, /no recorded checksum/);
    assert.match(said, /backfill-model-artifact-sha256/,
        'naming the script is the difference between a dead end and a next step');
});

test('refuses the upstream checkpoint, whose value is a sentence not an id', async (t) => {
    /* `fillTrainingChoices` appends this option to every base-model select. Registering a
       stock checkpoint is a separate, parked question; until it is answered this option
       must not look like it works. */
    const { screen, sent } = await trainingScreen(t);

    choose(screen, 'base-det', /upstream checkpoint/);
    choose(screen, 'dataset-det', /rockfish5/);

    const said = await start(screen);

    assert.equal(sent.length, 0, 'nothing is submitted');
    assert.match(said, /registered/,
        'it fails the same check an empty selection does, rather than being special-cased');
});

test('shows the API\'s own refusal rather than a sentence of its own', async (t) => {
    const { screen, sent } = await trainingScreen(t, {
        fail: { status: 400, message: 'Dataset 294 ("rockfish5") has not been packaged, so no worker can fetch it.' },
    });

    choose(screen, 'base-det', /rockfish5-2026-10-20/);
    choose(screen, 'dataset-det', /rockfish5/);

    const said = await start(screen);

    assert.equal(sent.length, 1, 'it did try');
    assert.match(said, /has not been packaged/,
        'the API message says which field was wrong; replacing it leaves a person guessing');

    // And the button comes back, because a refusal is something you fix and retry.
    assert.equal(screen.document.querySelector('#trainBtn').disabled, false);
});
