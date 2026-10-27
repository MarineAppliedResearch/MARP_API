/**
 * Draw the per-species bars beside the Class breakdown they were asked to look like.
 *
 * *"kind of like these bars... but they should have different shading"*, and then: *"if
 * the two do not read as the same family, it is not done."* That is a judgement nobody
 * can make from markup, and the API tier cannot help -- the browser pane has no session,
 * so every data route answers 401 and the panel never draws at all.
 *
 * So this boots the real screen in jsdom against AllTest1's real numbers, lifts the panel
 * it produced, and writes it into a page beside a Class breakdown built the way
 * `drawQueryComposition` builds one -- same stylesheet, same tokens, nothing reproduced
 * by hand except that one block of markup, which is marked where it is.
 *
 * **Not a test and not run by `npm test`.** It renders; it asserts nothing. The
 * assertions live in `tests/unit/species-split-bars.test.mjs`, which is the tier that can
 * see a width.
 *
 *   node tools/species-split-compare.mjs      # writes shots/species-split-compare.html
 *
 * @author Isaac Travers
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drawScreen, APP } from '../tests/unit/screen.mjs';

/** AllTest1's real composition, as `GET /dataset/387/composition` answers it. */
const SPLITS = [
    { split: 'test', observations: 96, images: 5546 },
    { split: 'train', observations: 392, images: 33417 },
    { split: 'validation', observations: 144, images: 11335 },
];

/** Its nine species, in the three splits, as the backfill recorded them. */
const SPECIES = [
    ['California sea cucumber', 775, [1566, 10157, 3297], [30, 92, 42]],
    ['Vermilion Rockfish', 331, [949, 6429, 1908], [18, 74, 24]],
    ['White-plumed anemone', 742, [912, 4224, 1783], [11, 48, 17]],
    ['Fish-eating anemone', 745, [811, 4385, 1605], [10, 46, 15]],
    ['Leather star', 739, [485, 3215, 964], [8, 39, 12]],
    ['Cookie star', 740, [348, 2303, 710], [7, 32, 10]],
    ['Red sea star', 741, [232, 1608, 461], [5, 25, 8]],
    ['UI Henricia', 743, [206, 1456, 416], [4, 23, 9]],
    ['Feather stars and sea lilies', 746, [99, 298, 191], [3, 13, 7]],
].flatMap(([comname, id, images, observations]) => ['test', 'train', 'validation']
    .map((split, i) => ({
        species_id: id,
        comname,
        split,
        images: images[i],
        observations: observations[i],
    })));

/**
 * A Class breakdown row, exactly as `drawQueryComposition` emits one.
 *
 * **The one piece of markup here that is reproduced rather than rendered**, because that
 * renderer lives inside the screen's own closure and the build flow has to be driven to
 * reach it. Four spans in a `.dist.pct`; if that ever stops matching `screens.js`, this
 * comparison is the thing that is wrong, not the panel.
 *
 * @param {string} label - The class.
 * @param {number} value - Its count.
 * @param {number} max - The largest count, which sets the scale.
 * @param {number} total - The headline count, which sets the share.
 * @returns {string}
 */
function classRow(label, value, max, total) {
    return `<span class="k">${label}</span>`
        + `<span class="b"><i style="width:${(value / max * 100).toFixed(1)}%"></i></span>`
        + `<span class="v">${value.toLocaleString('en-US')}</span>`
        + `<span class="p">${Math.round(value / total * 100)}%</span>`;
}

/**
 * Boot the Datasets screen, open the row, and hand back what it drew.
 *
 * @returns {Promise<string>} The composition panel's markup.
 */
async function drawn() {
    const screen = await drawScreen('datasets.html', {
        listDatasets: async () => [{
            id: 387,
            name: 'AllTest1',
            status: 'ready',
            source: 'ml-dashboard',
            archive_path: 'datasets/alltest1.tar',
            archive_sha256: 'c'.repeat(64),
            archive_bytes: 2_400_000_000,
            created_at: '2026-10-20T10:00:00.000Z',
            updated_at: '2026-10-22T10:00:00.000Z',
        }],
        listDatasetBuilds: async () => [],
        datasetComposition: async () => ({ splits: SPLITS, classes: [], speciesSplits: SPECIES }),
        datasetPreview: async () => ({ sha256: 'c'.repeat(64), total: 0, frames: [] }),
    });

    screen.document.querySelector('#saved-datasets tbody tr.runrow-head .exbtn').click();

    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    /* Scoped to the open row. The build flow's own breakdown earlier in the document
       carries the same attribute, so a document-wide query finds that one instead. */
    const panel = screen.document.querySelector('#saved-datasets [data-dataset-composition]');
    const html = panel ? panel.innerHTML : '<p>the panel did not draw</p>';

    screen.close();

    return html;
}

const counts = [['California sea cucumber', 164], ['Vermilion Rockfish', 121],
    ['White-plumed anemone', 76], ['Fish-eating anemone', 71], ['Leather star', 59],
    ['Other (4 classes)', 111]];
const total = counts.reduce((sum, [, n]) => sum + n, 0);
const max = Math.max(...counts.map(([, n]) => n));

const page = `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<title>Species split beside the class breakdown</title>
<link rel="stylesheet" href="../../../shared/assets/css/tokens.css">
<link rel="stylesheet" href="../screens.css">
<style>
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--text);
         font-family: var(--font, system-ui), sans-serif; }
  /* Stacked, not side by side. The detail panel is a half-width column on the real
     screen and the two have to be read at that width to be compared at all. */
  .side { display: grid; gap: 20px; max-width: 520px; }
  .side > section { padding: 14px; border: 1px solid var(--hairline);
                    border-radius: var(--r-sm); background: var(--card-flat); }
  h2 { margin: 0 0 12px; font-size: 12px; color: var(--faint); font-weight: 600;
       text-transform: uppercase; letter-spacing: .06em; }
</style></head>
<body><div class="side">
  <section>
    <h2>Build flow &mdash; Class breakdown</h2>
    <div class="field">
      <label>Class breakdown <span class="faint">(largest first)</span></label>
      <div class="dist pct">${counts.map(([l, n]) => classRow(l, n, max, total)).join('')}</div>
    </div>
  </section>
  <section>
    <h2>Datasets &mdash; composition and split</h2>
    ${await drawn()}
  </section>
</div></body></html>
`;

const out = join(APP, 'shots', 'species-split-compare.html');

writeFileSync(out, page, 'utf8');

// Fail loudly rather than writing a page with an empty right-hand column.
if (!readFileSync(out, 'utf8').includes('dist split')) {
    console.error('the species panel did not draw; the page would compare nothing');
    process.exitCode = 1;
} else {
    console.log(`wrote ${out}`);
}
