/**
 * The training form reads out as the parameters the worker accepts.
 *
 * **The allow-list is the contract and it lives in another repository.**
 * `src/marp_inference_worker/engines/training_engine.py` accepts exactly seventeen names
 * and *reports anything else as ignored* rather than refusing it. That is the failure
 * this file exists to catch: a wrong key does not break anything, it arrives, is listed
 * as ignored, and the run proceeds with a setting the person thought they had changed.
 * Nothing else on either side can see that — the API takes `spec.params` as an opaque
 * object, so no server test can object to a key, and the worker's own report is read by
 * nobody until somebody wonders why the learning rate did nothing.
 *
 * So the first test is a spelling test against that list, written out here rather than
 * derived from the page, and the rest are about the three ways a value gets mangled on
 * the way out: a select whose options are prose, a blank that must stay absent, and
 * "Auto" meaning *do not send this*.
 *
 * The jsdom boot lives in `screen.mjs`, shared with the other screen tests.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/**
 * Every parameter `training_engine.py` accepts, as it spells them.
 *
 * Read off the engine on 2026-10-22. A name this screen sends that is not here is
 * ignored by the worker and silently does nothing.
 */
const ACCEPTED = new Set(['epochs', 'imgsz', 'batch', 'patience', 'workers', 'lr0', 'lrf',
    'momentum', 'weight_decay', 'warmup_epochs', 'optimizer', 'seed', 'cos_lr', 'dropout',
    'freeze', 'single_cls', 'rect']);

/**
 * Draw the Training screen and hand back its window.
 *
 * @param {Object} t - The test, for its `after` hook.
 * @returns {Promise<Object>} From `drawScreen`.
 */
async function trainingScreen(t) {
    const screen = await drawScreen('training.html', {
        listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
        listModels: async () => [{ id: 197, name: 'rockfish2', model_type: 'detection' }],
        listDatasets: async () => [{ id: 294, name: 'rockfish5', status: 'ready' }],
        listWorkers: async () => [],
    });

    t.after(screen.close);

    return screen;
}

/**
 * Set a field, by the kind of control it is.
 *
 * @param {Object} screen - From `trainingScreen`.
 * @param {string} id - The element's id.
 * @param {string|boolean} value - Text for a select, a value for an input, a tick for a box.
 * @returns {void}
 */
function set(screen, id, value) {
    const element = screen.document.querySelector(`#${id}`);

    assert.ok(element, `#${id} should exist on the training form`);

    if (element.type === 'checkbox') {
        element.checked = value;

        return;
    }

    if (element.tagName === 'SELECT') {
        const at = [...element.options].findIndex((option) => option.text === value);

        assert.ok(at >= 0, `#${id} should offer "${value}", it offers ${
            [...element.options].map((o) => o.text).join(' / ')}`);
        element.selectedIndex = at;

        return;
    }

    element.value = value;
}

test('every parameter the form sends is one the worker accepts', async (t) => {
    const screen = await trainingScreen(t);

    /* Fill everything, including the Advanced fold, so the spelling of every key this
       screen can produce is checked rather than only the ones that default to a value. */
    set(screen, 'lrf', '0.02');
    set(screen, 'momentum', '0.9');
    set(screen, 'freeze', '10');
    set(screen, 'workers', '4');
    set(screen, 'cos-lr', true);
    set(screen, 'rect', true);
    set(screen, 'opt', 'AdamW');
    set(screen, 'lr', '0.001');

    const params = screen.window.trainingParams();
    const wrong = Object.keys(params).filter((key) => !ACCEPTED.has(key));

    assert.deepEqual(wrong, [],
        'the worker reports an unknown parameter as ignored rather than refusing it, so a '
        + 'misspelled key here is a setting that silently does nothing');

    /* The loss weights are not in the allow-list yet. Sending them would put three
       ignored parameters on every detection run; the fields stay, unwired, until the
       worker is widened to take them. */
    for (const key of ['box', 'cls', 'dfl']) {
        assert.equal(params[key], undefined, `${key} is not in the worker's allow-list yet`);
    }
});

test('a blank field sends nothing rather than a default or a NaN', async (t) => {
    const screen = await trainingScreen(t);

    /* The Advanced fold ships blank. An engine default restated on this screen would be
       a number nothing can keep true, and `Number('')` is 0 -- a value somebody chose. */
    const params = screen.window.trainingParams();

    for (const key of ['lrf', 'momentum', 'freeze', 'workers']) {
        assert.ok(!(key in params), `${key} is blank, so it should be absent, not ${params[key]}`);
    }

    /* An unticked box is "did not ask", not "asked for it off". Both of these default
       off in the engine, so sending false would be noise that reads as a decision. */
    assert.ok(!('cos_lr' in params), 'an unticked box sends nothing');
    assert.ok(!('rect' in params), 'an unticked box sends nothing');

    // And a field holding something unreadable is omitted, not sent as null.
    set(screen, 'lrf', 'abc');
    assert.ok(!('lrf' in screen.window.trainingParams()),
        'NaN serialises to null and reaches the engine as a parameter with no value');
});

test('"Auto" means do not send it, not send the word', async (t) => {
    const screen = await trainingScreen(t);

    set(screen, 'opt', 'Auto');
    set(screen, 'lr', 'Auto for optimiser');

    const auto = screen.window.trainingParams();

    assert.ok(!('optimizer' in auto),
        'the engine chooses when the key is absent; "Auto" is not an optimiser it can resolve');
    assert.ok(!('lr0' in auto), 'and the same for the learning rate');

    set(screen, 'opt', 'AdamW');
    set(screen, 'lr', '0.001');

    const chosen = screen.window.trainingParams();

    /* These two are the ones that land in `training_runs.learning_rate` and
       `training_runs.optimizer` -- `recordTrainingEpoch` reads them off `spec.params` by
       these names when it opens the run. Columns that have been null forever. */
    assert.equal(chosen.optimizer, 'AdamW');
    assert.equal(chosen.lr0, 0.001);
});

test('the selects whose options are prose come out as values', async (t) => {
    const screen = await trainingScreen(t);

    /* "Auto — 60% GPU memory" is Ultralytics' batch: -1. Sent as its own text it reaches
       the engine as an unparsable batch size. */
    set(screen, 'batch', 'Auto — 60% GPU memory');
    assert.equal(screen.window.trainingParams().batch, -1);

    set(screen, 'batch', '8');
    assert.equal(screen.window.trainingParams().batch, 8);

    // `single_cls` is a boolean the page words as a choice between two phrasings.
    set(screen, 'det-single', 'Keep all classes');
    assert.equal(screen.window.trainingParams().single_cls, false);

    set(screen, 'det-single', 'Treat as one class');
    assert.equal(screen.window.trainingParams().single_cls, true);

    set(screen, 'det-size', '960');
    assert.equal(screen.window.trainingParams().imgsz, 960, 'image size is a number, not "960"');
});
