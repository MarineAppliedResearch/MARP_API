/**
 * Step 3's species bars: every species, segmented by the split it was sent to.
 *
 * *"in this section we want the bars for every species, but we also want it shaded and
 * displayed like this: like we do in the build jobs and ready datasets."* So this is the
 * ready dataset's panel built from what step 3 knows, and the assertions are about the
 * three ways that differs from it.
 *
 * **Every species, no fold.** The ready panel folds its tail into *Other (N species)*
 * because a built dataset is a record. Step 3 is a decision, and a folded tail is hidden
 * evidence about what is going in — so the count of rows is asserted against the count of
 * species rather than against a page size.
 *
 * **The split is what was asked for.** A subset sent wholly to one split lands there
 * exactly; a subset divided by shares is spread by those shares. The build then runs
 * `assignSplits`, which is iterative stratification measured in frames, so a divided
 * subset's real per-species division is the algorithm's intent rather than this
 * arithmetic. That is a thing to label, not a thing to fix here.
 *
 * **The numbers beside the bar add up.** A 70/20/10 share over seven observations is
 * 4.9/1.4/0.7, and rounding each on its own reports seven as seven by luck. Largest
 * remainder makes it arithmetic, and the test uses counts that would expose the luck.
 *
 * The jsdom boot lives in `screen.mjs`, shared with the other screen tests.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/**
 * Draw the Datasets screen and hand back its window.
 *
 * @param {Object} t - The test, for its `after` hook.
 * @returns {Promise<Object>} From `drawScreen`.
 */
async function datasetsScreen(t) {
    const screen = await drawScreen('datasets.html', {
        listDatasets: async () => [],
        listDatasetBuilds: async () => [],
    });

    t.after(screen.close);

    return screen;
}

/**
 * One subset row, as `appendSubset` builds one.
 *
 * Built here rather than by driving the query form, because the form needs a live facet
 * answer and this is a test about the renderer that reads the rows. The attributes are
 * the ones `appendSubset` writes, which is the contract between the two.
 *
 * @param {Object} screen - From `datasetsScreen`.
 * @param {Object} spec - `{species, split, shares}`.
 * @returns {Object} The `<li>`.
 */
function subset(screen, { species, split, shares }) {
    const row = screen.document.createElement('li');

    row.dataset.species = JSON.stringify(species);
    row.dataset.unique = String(species.reduce((at, [, n]) => at + n, 0));

    if (shares) row.dataset.shares = JSON.stringify(shares);
    else row.dataset.split = split;

    return row;
}

/**
 * The rows the panel drew, reassembled from `.dist`'s loose cells.
 *
 * @param {Object} screen - From `datasetsScreen`.
 * @returns {Array<{name: string, total: string, widths: Object, title: string}>}
 */
function drawn(screen) {
    const cells = [...screen.document.querySelectorAll('[data-dataset-composition] > *')];
    const out = [];

    for (let i = 0; i < cells.length; i += 3) {
        out.push({
            name: cells[i].textContent,
            title: cells[i].title,
            widths: Object.fromEntries([...cells[i + 1].querySelectorAll('i')]
                .map((seg) => [seg.className, Math.round(parseFloat(seg.style.width) * 10) / 10])),
            total: cells[i + 2].textContent,
        });
    }

    return out;
}

/**
 * Put rows in the subset list and let the panel redraw.
 *
 * @param {Object} screen - From `datasetsScreen`.
 * @param {Object[]} rows - From `subset`.
 * @returns {Promise<void>}
 */
async function add(screen, rows) {
    const list = screen.document.querySelector('[data-subset-list]');

    assert.ok(list, 'the build flow should have a subset list to add to');

    for (const row of rows) list.append(row);

    /* **Redrawn by the gesture, not by calling the renderer.** `recalc` is private to
       `wireDatasetBuilder` and stays private; the list redraws when a subset is removed,
       so a disposable row is added and removed to reach it. Adding one the real way needs
       a live facet answer, which is a different test. */
    const disposable = screen.document.createElement('li');

    disposable.dataset.species = '[]';
    disposable.innerHTML = '<button data-remove-subset type=\"button\"></button>';
    list.append(disposable);
    disposable.querySelector('[data-remove-subset]').click();

    await new Promise((resolve) => setTimeout(resolve, 20));
}

test('every species gets a bar, with no Other fold', async (t) => {
    const screen = await datasetsScreen(t);

    /* Seven species, which is more than the five the Class breakdown folds at — so a
       panel that folded would draw six rows and the last would be an Other. */
    await add(screen, [subset(screen, {
        split: 'train',
        species: [
            ['California sea cucumber', 164], ['Vermilion Rockfish', 121],
            ['White-plumed anemone', 76], ['Fish-eating anemone', 71],
            ['Leather star', 59], ['Cookie star', 40], ['Red sea star', 22],
        ],
    })]);

    const rows = drawn(screen);

    assert.equal(rows.length, 7, 'every species, because a hidden tail here is hidden evidence');
    assert.deepEqual(rows.filter((row) => /^Other/.test(row.name)), [],
        'and no Other row, which is the deliberate difference from the ready panel');
    assert.equal(rows[0].name, 'California sea cucumber', 'largest first');
});

test('a subset sent to one split shades its species entirely that colour', async (t) => {
    const screen = await datasetsScreen(t);

    await add(screen, [
        subset(screen, { split: 'train', species: [['Cucumber', 100]] }),
        subset(screen, { split: 'test', species: [['Anemone', 50]] }),
    ]);

    const rows = drawn(screen);

    /* Exact, not projected: the subset declared a split and the build honours it. A
       species that exists only in a train subset having no validation segment is the
       thing this panel is for seeing. */
    assert.deepEqual(rows[0].widths, { tr: 100 }, 'all train, and measured against itself');
    assert.deepEqual(rows[1].widths, { te: 50 }, 'and the shorter species is half as long');
});

test('a divided subset is spread by its shares, and the numbers still add up', async (t) => {
    const screen = await datasetsScreen(t);

    /* Seven, so the shares land on 4.9 / 1.4 / 0.7 — three numbers that each round down
       and would report six observations for a species that has seven. */
    await add(screen, [subset(screen, {
        shares: { train: 70, validation: 20, test: 10 },
        species: [['Cucumber', 7]],
    })]);

    const [row] = drawn(screen);

    assert.equal(row.total, '7');
    assert.deepEqual(row.widths, { tr: 70, va: 20, te: 10 },
        'the segments are the shares, because that is what was asked for');

    const said = /train (\d+), validation (\d+), test (\d+)/.exec(row.title);

    assert.ok(said, `the tooltip should name all three splits, it said "${row.title}"`);
    assert.equal(Number(said[1]) + Number(said[2]) + Number(said[3]), 7,
        'largest remainder, so the three numbers sum to the one beside the bar');
});

test('a species in two subsets is one bar carrying both', async (t) => {
    const screen = await datasetsScreen(t);

    await add(screen, [
        subset(screen, { split: 'train', species: [['Cucumber', 80]] }),
        subset(screen, { split: 'validation', species: [['Cucumber', 20]] }),
    ]);

    const rows = drawn(screen);

    assert.equal(rows.length, 1, 'one species, one row, however many subsets it came from');
    assert.equal(rows[0].total, '100');
    assert.deepEqual(rows[0].widths, { tr: 80, va: 20 });
});
