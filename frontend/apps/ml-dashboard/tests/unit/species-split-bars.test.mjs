/**
 * Each species gets a bar, and its length is its image count.
 *
 * *"each species should have an associated bar, who's length is the number of images, and
 * each bar should have 3 shades, one for the training amount, one for the validation
 * amount, and one for the test amount."* The breakdown shipped as three columns of
 * numbers, which was the previous request answered and not this one.
 *
 * **This is the only tier that can see it.** The route carries the counts and the
 * repository test proves it does, but neither can say whether a width was computed, which
 * shade landed on which split, or whether the bar scaled to the wrong total -- and a
 * mis-scaled bar is the failure that still looks like a working panel. The doctrine in
 * `AGENTS.md` is that a defect is not fixed until a test at the tier that can observe it
 * is named, so the assertions here are about drawn widths rather than about the data that
 * produced them.
 *
 * **It also pins the unit.** The panel above these bars counts images; these counted
 * observations, and the two differ by about ninety to one, so a bar drawn in the wrong
 * one is a length a reader compares against a length that means something else. The unit
 * is asserted because nothing else can fail when it is wrong.
 *
 * The jsdom boot lives in `screen.mjs`, shared with the other screen tests.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A dataset row the table can draw, with the fields its renderer reads. */
const dataset = {
    id: 7,
    name: 'jest-bars',
    status: 'ready',
    source: 'ml-dashboard',
    archive_path: 'datasets/jest.tar',
    archive_sha256: 'b'.repeat(64),
    archive_bytes: 1024,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-22T10:00:00.000Z',
};

/**
 * One species' rows of a composition answer.
 *
 * @param {number} id - `species.id`.
 * @param {string} comname - Its name.
 * @param {Object} counts - Split to `[observations, images]`.
 * @returns {Object[]}
 */
function species(id, comname, counts) {
    return Object.entries(counts).map(([split, [observations, images]]) => ({
        species_id: id,
        comname,
        split,
        observations,
        images,
    }));
}

/**
 * Draw the Datasets screen, open its one row, and hand back the species panel.
 *
 * @param {Object[]} speciesSplits - The composition's per-species rows.
 * @param {Object} t - The test, for its `after` hook.
 * @returns {Promise<{screen: Object, panel: Object}>}
 */
async function openComposition(speciesSplits, t) {
    const screen = await drawScreen('datasets.html', {
        listDatasets: async () => [dataset],
        listDatasetBuilds: async () => [],
        datasetComposition: async () => ({
            splits: [
                { split: 'train', observations: 3, images: 300 },
                { split: 'validation', observations: 1, images: 100 },
                { split: 'test', observations: 1, images: 50 },
            ],
            classes: [],
            speciesSplits,
        }),
        datasetPreview: async () => ({ sha256: 'b'.repeat(64), total: 0, frames: [] }),
    });

    t.after(screen.close);

    /* The composition is fetched when the row is opened, not when the table is drawn, so
       the panel does not exist until something clicks. */
    const head = screen.document.querySelector('#saved-datasets tbody tr.runrow-head');

    assert.ok(head, 'the datasets table should have drawn a row to open');

    head.querySelector('.exbtn').click();

    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    const panel = screen.document.querySelector('.speciessplit');

    assert.ok(panel, 'opening a dataset row should draw the per-species panel');

    return { screen, panel };
}

/**
 * The panel's rows, as `.dist` lays them out.
 *
 * `.dist` is a grid of loose spans rather than nested rows -- label, bar, count, three
 * cells per species -- so a "row" has to be reassembled from them. Reading the three
 * together is what the assertions want, and doing it here keeps them about the drawing.
 *
 * @param {Object} panel - The `.speciessplit` element.
 * @returns {Array<{name: string, bar: Object, total: string}>} In drawn order.
 */
function rowsOf(panel) {
    const cells = [...panel.querySelectorAll('.dist > *')];
    const out = [];

    for (let i = 0; i < cells.length; i += 3) {
        out.push({ name: cells[i].textContent, bar: cells[i + 1], total: cells[i + 2].textContent });
    }

    return out;
}

/**
 * The widths one row's segments were drawn at, by shade.
 *
 * @param {Object} row - From {@link rowsOf}.
 * @returns {Object<string, number>} Class to percentage, rounded to a tenth.
 */
function widths(row) {
    return Object.fromEntries([...row.bar.querySelectorAll('i')].map((segment) => [
        segment.className,
        Math.round(parseFloat(segment.style.width) * 10) / 10,
    ]));
}

test('a species bar is as long as its image count, against the commonest species', async (t) => {
    /* 400 images against 200: the second bar is half the first. Its observation counts
       are made to run the other way -- 2 against 20 -- so a bar drawn from the wrong
       column comes out inverted rather than merely wrong by a little. */
    const { panel } = await openComposition([
        ...species(1, 'Cucumber', { train: [2, 300], validation: [1, 60], test: [1, 40] }),
        ...species(2, 'Anemone', { train: [14, 150], validation: [4, 30], test: [2, 20] }),
    ], t);

    const rows = rowsOf(panel);

    assert.equal(rows.length, 2, 'one row per species');
    assert.equal(rows[0].name, 'Cucumber',
        'the commonest species sorts first, so the longest bar is the top one');

    const first = widths(rows[0]);
    const second = widths(rows[1]);

    /* The three segments of the widest species fill the track. Checked as a sum because
       the individual shares are what the next assertion is about. */
    assert.equal(Math.round(first.tr + first.va + first.te), 100,
        'the commonest species fills the track, which is what the others are measured against');

    /* 150/400, 30/400, 20/400. Scaled against the widest species rather than against
       either bar's own total -- that is the difference between a bar that says how much
       and a bar that only says in what proportions. */
    assert.deepEqual(second, { tr: 37.5, va: 7.5, te: 5 },
        'the second species is measured against the first, not against its own total');
});

test('each split gets its own shade, and a split with nothing gets none', async (t) => {
    /* A species entirely in train is the thing the stratification exists to prevent, and
       it is only visible if the missing shades are actually missing. */
    const { panel } = await openComposition([
        ...species(1, 'Cucumber', { train: [2, 100], validation: [1, 50], test: [1, 50] }),
        ...species(2, 'Rare star', { train: [1, 40] }),
    ], t);

    const rows = rowsOf(panel);

    assert.deepEqual(Object.keys(widths(rows[0])), ['tr', 'va', 'te'],
        'train, validation and test each get their own shade, in that order');
    assert.deepEqual(Object.keys(widths(rows[1])), ['tr'],
        'a species with nothing in validation or test is drawn with one shade, not three hairlines');

    /* The shades have to be the three the split bar above uses. They are the same class
       names on purpose, so one set of custom properties colours both; two colour schemes
       for train/validation/test in one panel would be its own defect. */
    const above = [...panel.parentElement.querySelectorAll('.splitbar i')].map((band) => band.className);

    assert.deepEqual(above, ['tr', 'va', 'te'],
        'the split bar above uses these same three classes, which is what keeps the shades identical');

    /* **It is the build flow's Class breakdown component, not a second one.** *"kind of
       like these bars"* -- reusing `.dist` is what makes the two read as one family, and
       a copy that drifted would look right on the day it was written. */
    assert.ok(panel.querySelector('.dist.split'),
        'the panel is drawn with .dist, the same component the Class breakdown uses');
});

test('the bars are drawn in images and the panel says so', async (t) => {
    const { panel } = await openComposition(
        species(1, 'Cucumber', { train: [2, 300], validation: [1, 60] }),
        t
    );

    assert.match(panel.querySelector('h5').textContent, /images/,
        'the heading names the unit, because the lengths are compared without reading it');
    assert.equal(rowsOf(panel)[0].total, '360',
        'the total beside the bar is images, matching the bar it sits next to');

    /* **The explanation is hover text, not a paragraph.** *"i dont' know why we have this
       text"* -- so the fact has to survive somewhere a reader can reach it, and a
       deleted paragraph and a tooltip look identical to every other check. */
    assert.match(panel.querySelector('h5 .faint').title, /counts for both/,
        'why these do not add up to the splits above hangs off the unit that states them');
    assert.equal(panel.querySelector('.hint'), null,
        'and it is no longer a paragraph under the bars');
});

test('falls back to observations, and says so, when no images were recorded', async (t) => {
    /* Every dataset built before the build counted species per frame is in this state.
       `Number(null)` is 0 rather than NaN, so an unguarded check would draw these as zero
       images -- a measurement, and the wrong one. */
    const { panel } = await openComposition([
        ...species(1, 'Cucumber', { train: [20, null], validation: [10, null] }),
        ...species(2, 'Anemone', { train: [10, null] }),
    ], t);

    const rows = rowsOf(panel);

    assert.match(panel.querySelector('h5').textContent, /observations/,
        'the heading changes with the unit rather than the bar quietly meaning something else');
    assert.match(panel.querySelector('h5 .faint').title, /no archive could be counted/,
        'and hovering the unit says why it changed, without a paragraph of apology');

    assert.deepEqual(widths(rows[1]), { tr: 33.3 },
        '10 observations against 30 is a third of the track');
});
