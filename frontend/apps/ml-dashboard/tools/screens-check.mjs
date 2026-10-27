/**
 * Do the screens read from the layer, and do their controls query it?
 *
 * Covers #128's R1 (as rendered), R6 (the error state), R7 and R10.
 *
 * `markup-check` already proves no screen *states* a value. This proves the
 * other half: that something fills what was emptied. The two together are the
 * requirement -- a blank page passes one of them on its own.
 *
 *   node tools/screens-check.mjs
 *
 * @fileoverview R1, R6, R7, R10: the screens against their data layer.
 * @module tools/screens-check
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.SCREENS_PORT || 8141);
const BASE = `http://localhost:${PORT}/apps/ml-dashboard/`;

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
await new Promise((done) => setTimeout(done, 500));

const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });

/* ---------------------------------------------------- R10, before any browser */

/* Swapping the module for real `fetch` calls has to be a change in one file, so
   only that file may *reach for* a route.

   **Comments are stripped first, and that is not a loophole.** R10 is about
   where the code has its seam. A doc comment saying which route a function's
   data came from is the opposite of a problem -- it is how the next reader
   finds the seam -- and the first run of this check failed on eight of them.
   What would break R10 is a route in a string the code uses, and that is what
   survives the stripping.

   `jellyfin` is excepted: the image proxy is referenced by `src` on an `img`,
   which is not the data layer's business. */
const withoutComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

for (const file of ['screens.js', ...readdirSync(APP).filter((f) => f.endsWith('.html'))]) {
    const source = withoutComments(readFileSync(join(APP, file), 'utf8'));
    const routes = source.match(/\/api\/v2\/(?!jellyfin)[a-z_]+/g) || [];
    check(routes.length === 0,
        `R10: ${file} reaches for ${[...new Set(routes)].join(', ')}; only api.js may name a route`);
}

/* ------------------------------------------------------------------ R1 */

/** Every screen, and the table each one fills. */
const SCREENS = {
    dashboard: '#current-activity tbody tr',
    jobs: '#jobs tbody tr[data-job]',
    workers: '#workers tbody tr.runrow-head',
    history: '#history tbody tr[data-job]',
    models: '#models tbody tr.runrow-head',
    datasets: '#saved-datasets tbody tr.runrow-head',
    inference: '.inference-table tbody tr[data-job]',
    training: '.training-table tbody tr[data-job]',
};

for (const [screen, rowSelector] of Object.entries(SCREENS)) {
    await page.goto(`${BASE}${screen}.html`, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const filled = await page.evaluate((selector) => {
        const text = (list) => [...list].map((e) => e.textContent.trim());
        const nums = text(document.querySelectorAll('.stat-num'));
        const subs = text(document.querySelectorAll('.stat-sub'));
        const legend = document.querySelector('.job-mix-key');
        return {
            cards: nums.length,
            cardsFilled: nums.filter(Boolean).length,
            subs: subs.length,
            subsFilled: subs.filter(Boolean).length,
            legendPresent: Boolean(legend),
            legendFilled: Boolean(legend && legend.textContent.trim()),
            rows: document.querySelectorAll(selector).length,
        };
    }, rowSelector);

    check(filled.cards > 0 && filled.cardsFilled === filled.cards,
        `R1: ${screen} filled ${filled.cardsFilled} of ${filled.cards} headline numbers`);
    check(filled.subsFilled === filled.subs,
        `R1: ${screen} filled ${filled.subsFilled} of ${filled.subs} card breakdowns`);
    check(!filled.legendPresent || filled.legendFilled,
        `R1: ${screen} has a donut legend that nothing fills`);
    check(filled.rows > 0, `R1: ${screen} drew no rows into the table its layer fills`);
}

/* ------------------------------------------ expandable rows open collapsed */

/* An expandable table draws every row's detail row as well as its head, and the
   head says `aria-expanded="false"` from the moment it is written. Only the
   rendered page can tell whether the detail row obeyed it. `markup-check` reads
   the template and the template looks right; what was missing was `hidden` on
   the detail row itself, so every row stood open while its chevron and its aria
   state both said closed -- and the first click then appeared to do nothing,
   because it was the click that set `aria-expanded` to true on a row that was
   already open.

   Models and Workers build their detail rows from strings and both forgot it.
   Jobs and Datasets build theirs with `createElement` and set `hidden` there,
   which is why only these two screens were wrong. */
for (const [screen, table] of [['models', '#models'], ['workers', '#workers']]) {
    await page.goto(`${BASE}${screen}.html`, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const rows = await page.evaluate((id) => {
        const heads = [...document.querySelectorAll(`${id} tbody tr.runrow-head`)];
        const bodies = [...document.querySelectorAll(`${id} tbody tr.runrow-body`)];
        return {
            heads: heads.length,
            expanded: heads.filter((head) => head.getAttribute('aria-expanded') === 'true').length,
            bodies: bodies.length,
            showing: bodies.filter((body) => !body.hidden).length,
        };
    }, table);

    check(rows.bodies > 0 && rows.showing === 0,
        `${screen} opened with ${rows.showing} of ${rows.bodies} detail rows showing`);
    check(rows.expanded === 0,
        `${screen} opened with ${rows.expanded} of ${rows.heads} rows marked expanded`);
}

/* ------------------------------------------------------------------ R6 */

await page.goto(`${BASE}jobs.html?mock=fail:jobs`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const failed = await page.evaluate(() => ({
    message: document.querySelector('#jobs tbody .error')?.textContent.trim() || '',
    retry: Boolean(document.querySelector('#jobsRetry')),
    rows: document.querySelectorAll('#jobs tbody tr[data-job]').length,
}));
check(/could not load/i.test(failed.message), `R6: the failed Jobs table said "${failed.message}"`);
check(failed.retry, 'R6: the error state offers no way to try again');
check(failed.rows === 0, 'R6: the table drew rows as well as an error');

await page.goto(`${BASE}jobs.html`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const healthy = await page.evaluate(() => ({
    error: Boolean(document.querySelector('#jobs tbody .error')),
    rows: document.querySelectorAll('#jobs tbody tr[data-job]').length,
}));
check(!healthy.error && healthy.rows > 0, 'R6: the default path should draw rows and no error');

/* ------------------------------------------------------------------ R7 */

/* Each screen's filter, the sortable header to exercise, and the row selector. */
const SORTED = [
    { screen: 'jobs', rows: '#jobs tbody tr[data-job]', header: '#jobs thead th.hjob', cell: '.jname .t', pager: '.panel-ft .pager [data-jobs-page="2"]' },
    { screen: 'workers', rows: '#workers tbody tr.runrow-head', header: '#workers thead th.wname', cell: '.jname .t', pager: '#worker-pool .pager [data-workers-page="2"]' },
    { screen: 'history', rows: '#history tbody tr[data-job]', header: '#history thead th.hjob', cell: '.jname .t', pager: '#history-panel .pager [data-history-page="2"]' },
    { screen: 'models', rows: '#models tbody tr.runrow-head', header: '#models thead th.hname', cell: '.hname .t', pager: '#model-registry .pager [data-models-page="2"]' },
];

for (const { screen, rows, header, cell, pager } of SORTED) {
    await page.goto(`${BASE}${screen}.html`, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const read = () => page.evaluate(([r, c]) => [...document.querySelectorAll(r)]
        .map((row) => row.querySelector(c)?.textContent.trim() || ''), [rows, cell]);

    await page.click(header);
    await page.waitForTimeout(400);
    const ascending = await read();
    const sorted = ascending.every((v, i) => i === 0 || ascending[i - 1].toLowerCase() <= v.toLowerCase());
    check(sorted && ascending.length > 0, `R7: ${screen} did not sort ascending by its first column`);

    const aria = await page.getAttribute(header, 'aria-sort');
    check(aria === 'ascending', `R7: ${screen} drew aria-sort="${aria}" over ascending rows`);

    /* **The page boundary is the point.** Sorting only the visible page was the
       defect this found three times, and it looks identical to a correct sort
       until you turn the page. */
    const hasPager = await page.$(pager);
    if (hasPager) {
        await page.click(pager);
        await page.waitForTimeout(400);
        const next = await read();
        check(next.length > 0 && ascending[ascending.length - 1].toLowerCase() <= next[0].toLowerCase(),
            `R7: ${screen} page 2 begins at "${next[0]}", before page 1 ended at "${ascending[ascending.length - 1]}" — the sort covers only the page`);
    } else {
        problems.push(`R7: ${screen} has no second page to check the sort against`);
    }
}

/* A filter narrows the count rather than just hiding rows. */
await page.goto(`${BASE}jobs.html`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const narrowed = await page.evaluate(async () => {
    const showing = () => document.querySelector('.panel-ft > span')?.textContent.trim() || '';
    const before = showing();
    const status = [...document.querySelectorAll('#filters select')][1];
    status.value = 'Running';
    status.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 600));
    const states = [...document.querySelectorAll('#jobs tbody tr[data-job] td.jstatus .st')]
        .map((s) => s.dataset.state);
    return { before, after: showing(), allRunning: states.length > 0 && states.every((s) => s === 'running') };
});
check(narrowed.before !== narrowed.after, 'R7: filtering Jobs by Running did not change the count');
check(narrowed.allRunning, 'R7: filtering Jobs by Running left rows in other states');

await browser.close();
stop();

if (problems.length) {
    console.error('');
    for (const problem of problems) console.error('[x] ' + problem);
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} across the screens.`);
    process.exit(1);
}

console.log(`ok  ${Object.keys(SCREENS).length} screens fill themselves from the layer; `
    + 'sorting spans pages, filters narrow, and the error state is reachable');
