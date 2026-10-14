/**
 * Screenshots the static mockups in mockups/, at desktop and phone width.
 *
 *   node tools/mock-shots.mjs                 every screen, both widths
 *   node tools/mock-shots.mjs dashboard       one screen
 *   node tools/mock-shots.mjs dashboard phone
 *
 * Look-and-feel work is judged by looking, so this is the loop: change the
 * markup, take the shot, look at the shot. It fails on a console error and on
 * anything cut off at the right edge — both invisible in a picture.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.SHOT_PORT || 8129);
const BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/mockups/`;

/* The shell is a fixed-height grid whose content scrolls inside it, so
   `fullPage` sees exactly one screen and nothing below the fold. The phone
   shot therefore uses a tall viewport: same 390px width, so every width-based
   rule fires identically, but tall enough that the whole column is in the
   picture. `phone-fold` is the real 844px height, for judging what a person
   sees before scrolling. */
const VIEWS = {
  desktop: { width: 1672, height: 941 },
  /* The middle width, where the rail is a 56px strip. It has its own layout and
     its own logo, so it needs its own shot -- neither of the other two can see it. */
  tablet: { width: 1000, height: 1500 },
  phone: { width: 390, height: 1900 },
  'phone-fold': { width: 390, height: 844 },
};

const all = (await readdir(join(APP, 'mockups')))
  /* A leading underscore marks a template rather than a screen. One got shot as
     a page, placeholders and all, and reported four console errors. */
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .map((f) => f.replace(/\.html$/, ''));
const which = process.argv[2] && all.includes(process.argv[2]) ? [process.argv[2]] : all;
const views = process.argv[3] && VIEWS[process.argv[3]] ? [process.argv[3]] : Object.keys(VIEWS);

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 400));
await mkdir(join(APP, 'shots'), { recursive: true });

/**
 * Answer the account menu's session question, as nobody.
 *
 * This tier serves files and has no API, so the shared account component's probe of
 * `/api/v2/auth/me` 404s -- and a failed request is a console error, which these checks
 * fail on for good reasons that have nothing to do with this. Answering it with the
 * endpoint's own shape and no user gives exactly the state a signed-out visitor gets,
 * without loosening the rule that a console error is a failure.
 *
 * The 404 path itself is not skipped: `tools/account-check.mjs` lets it happen and asserts
 * the control says `Not signed in` rather than drawing somebody.
 *
 * @param {import('@playwright/test').Page} page the page to answer for.
 * @returns {Promise<void>}
 */
const answerAsNobody = (page) => page.route('**/api/v2/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ user: null })
}));
const browser = await chromium.launch();
const problems = [];

for (const view of views) {
  const page = await browser.newPage({ viewport: VIEWS[view], deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await answerAsNobody(page);

  for (const name of which) {
    errors.length = 0;
    await page.goto(BASE + name + '.html', { waitUntil: 'load' });
    await page.waitForTimeout(160);

    if (name === 'dashboard') {
      const overview = await page.evaluate(() => {
        const summaries = [...document.querySelectorAll('.dashboard-overview a')];
        const worker = document.querySelector('#worker-pool')?.getBoundingClientRect();
        const workerSummary = document.querySelector('#worker-pool .pool')?.getBoundingClientRect();
        const workerSlots = document.querySelector('#worker-pool .slots')?.getBoundingClientRect();
        const poolHistory = document.querySelector('#worker-pool .pool-history')?.getBoundingClientRect();
        const activityElement = document.querySelector('#current-activity');
        const activity = activityElement?.getBoundingClientRect();
        const content = document.querySelector('.content')?.getBoundingClientRect();
        return {
          destinations: summaries.map((link) => link.getAttribute('href')),
          hasDuplicateJobList: document.body.textContent.includes('Active and recent jobs'),
          summaryBottom: Math.max(...summaries.map((link) => link.getBoundingClientRect().bottom)),
          worker: worker && { top: worker.top, width: worker.width },
          workerSummary: workerSummary && { top: workerSummary.top, right: workerSummary.right },
          workerSlots: workerSlots && { bottom: workerSlots.bottom },
          poolHistory: poolHistory && { top: poolHistory.top, left: poolHistory.left },
          activity: activity && { top: activity.top, width: activity.width },
          activityStates: [...(activityElement?.querySelectorAll('[data-state]') || [])]
            .map((element) => element.dataset.state),
          sortableHeaders: activityElement?.querySelectorAll('th.sortable').length || 0,
          poolRanges: [...document.querySelectorAll('[data-pool-range]')]
            .map((button) => button.dataset.poolRange),
          defaultPoolRange: document.querySelector('[data-pool-range][aria-pressed="true"]')
            ?.dataset.poolRange,
          poolLine: document.querySelector('[data-pool-line]')?.getAttribute('d'),
          poolSeries: document.querySelectorAll('[data-pool-line]').length,
          poolHighlightLabels: document.querySelectorAll('[data-pool-highlight]').length,
          contentWidth: content?.width
        };
      });
      const expected = ['./jobs.html', './inference.html', './training.html', './datasets.html',
        './models.html', './history.html'];
      if (overview.destinations.join('|') !== expected.join('|')) {
        problems.push(`dashboard/${view}: overview destinations are ${overview.destinations.join(', ')}`);
      }
      if (overview.hasDuplicateJobList) {
        problems.push(`dashboard/${view}: the duplicate Active and recent jobs list is still present`);
      }
      if (!overview.worker || !overview.activity || overview.worker.top <= overview.summaryBottom
          || overview.activity.top <= overview.worker.top) {
        problems.push(`dashboard/${view}: overview, Worker pool and current activity are out of order`);
      }
      if (!overview.activityStates.includes('running') || !overview.activityStates.includes('issues')
          || !overview.activityStates.includes('failed')
          || !overview.activityStates.includes('done')) {
        problems.push(`dashboard/${view}: current activity does not cover running, attention and done`);
      }
      if (overview.sortableHeaders !== 5) {
        problems.push(`dashboard/${view}: expected five sortable activity headers, found ${overview.sortableHeaders}`);
      }
      if (overview.poolRanges.join('|') !== '24h|5h|1h' || overview.defaultPoolRange !== '5h'
          || !overview.poolLine || overview.poolSeries !== 4 || overview.poolHighlightLabels !== 6) {
        problems.push(`dashboard/${view}: GPU ranges or cohesive resource-and-queue history is missing`);
      } else {
        const before = overview.poolLine;
        await page.locator('[data-pool-range="1h"]').click();
        const switched = await page.locator('[data-pool-range="1h"]').getAttribute('aria-pressed');
        const after = await page.locator('[data-pool-line]').getAttribute('d');
        if (switched !== 'true' || before === after) {
          problems.push(`dashboard/${view}: GPU history does not switch from 5h to 1h`);
        }
        const computeLabel = page.locator('[data-pool-highlight="computeUsed"]');
        await computeLabel.click();
        const highlighted = await page.locator('.pool-chart').evaluate((chart) => ({
          active: chart.classList.contains('is-highlighted'),
          selected: chart.querySelectorAll('.highlighted').length,
          faded: [...chart.querySelectorAll('[data-pool-line], [data-pool-area]')]
            .filter((series) => !series.classList.contains('highlighted')).length
        }));
        if (await computeLabel.getAttribute('aria-pressed') !== 'true'
            || !highlighted.active || highlighted.selected !== 1 || highlighted.faded < 1) {
          problems.push(`dashboard/${view}: selecting the Compute label does not isolate its series`);
        }
        await computeLabel.click();
        if (await computeLabel.getAttribute('aria-pressed') !== 'false') {
          problems.push(`dashboard/${view}: selecting a highlighted graph label again does not restore all series`);
        }
      }
      const phoneView = view.startsWith('phone');
      const narrowPool = VIEWS[view].width <= 1050;
      if (!overview.workerSummary || !overview.workerSlots || !overview.poolHistory
          || (narrowPool && overview.poolHistory.top < overview.workerSlots.bottom)
          || (!narrowPool && overview.poolHistory.left < overview.workerSummary.right)) {
        problems.push(`dashboard/${view}: GPU history is not right on wide screens or below on narrow screens`);
      }
      const activitySorters = page.locator(phoneView
        ? '#current-activity [data-sort-column]'
        : '#current-activity th.sortable');
      const directionAttribute = phoneView ? 'data-direction' : 'aria-sort';
      for (let column = 0; column < await activitySorters.count(); column += 1) {
        const sorter = activitySorters.nth(column);
        await sorter.click();
        const firstDirection = await sorter.getAttribute(directionAttribute);
        const firstOrder = await page.locator('#current-activity tbody tr').evaluateAll((rows, index) =>
          rows.map((row) => row.children[index]?.dataset.sort || row.children[index]?.textContent.trim()), column);
        await sorter.click();
        const secondDirection = await sorter.getAttribute(directionAttribute);
        const secondOrder = await page.locator('#current-activity tbody tr').evaluateAll((rows, index) =>
          rows.map((row) => row.children[index]?.dataset.sort || row.children[index]?.textContent.trim()), column);
        if (firstDirection === secondDirection || firstOrder.join('|') === secondOrder.join('|')) {
          problems.push(`dashboard/${view}: activity header ${column + 1} does not reverse its sort`);
        }
      }
      if (view.startsWith('phone')) {
        const tolerance = 2;
        if (Math.abs(overview.worker.width - overview.contentWidth) > tolerance
            || Math.abs(overview.activity.width - overview.contentWidth) > tolerance) {
          problems.push(`dashboard/${view}: Worker pool and current activity are not full width`);
        }
      }
    }

    if (name === 'jobs') {
      const jobs = await page.evaluate(() => ({
        moreFilters: document.body.textContent.includes('More filters'),
        filters: [...document.querySelectorAll('#filters input, #filters select')]
          .map((control) => control.getAttribute('aria-label')),
        rows: document.querySelectorAll('#jobs tr.runrow-head').length,
        details: document.querySelectorAll('#jobs tr.runrow-body').length,
        diagnostics: document.querySelectorAll('#jobs tr.runrow-body details.diag').length,
        stateDetails: document.querySelectorAll('#jobs tr.runrow-body [data-job-state]').length,
        stateKinds: [...document.querySelectorAll('#jobs tr.runrow-body [data-job-state]')]
          .map((detail) => detail.dataset.jobState),
        trainingResults: document.querySelectorAll('#jobs .training-results').length,
        inferenceResults: document.querySelectorAll('#jobs .inference-results').length,
        emptyResults: document.querySelectorAll('#jobs .jobresults.empty').length,
        completedTraining: document.querySelectorAll('#jobs .training-evaluation').length,
        confusionMatrices: document.querySelectorAll('#jobs .confusion').length,
        evaluationGraphs: document.querySelectorAll('#jobs .training-evaluation [data-result-graph]').length,
        trainingHistoryGraphs: document.querySelectorAll('#jobs .training-results [data-result-graph]').length,
        classMetricRows: document.querySelectorAll('#jobs .class-metrics tbody tr').length,
        matrixCells: document.querySelectorAll('#jobs .confusion.eight i').length,
        evaluationTabs: document.querySelectorAll('#jobs [data-eval-tab]').length,
        sortableHeaders: document.querySelectorAll('#jobs th.sortable').length,
        mobileSorts: document.querySelectorAll('.jobs-sort-mobile [data-sort-column]').length,
        ranges: [...document.querySelectorAll('[data-jobs-range]')].map((button) => button.dataset.jobsRange),
        defaultRange: document.querySelector('[data-jobs-range][aria-pressed="true"]')?.dataset.jobsRange,
        chartLines: document.querySelectorAll('[data-jobs-line]').length,
        donutParts: document.querySelectorAll('.donut-part').length
      }));
      if (jobs.moreFilters || jobs.filters.join('|') !== 'Search jobs|Job type|Status|Window') {
        problems.push(`jobs/${view}: visible search and selectors are not the complete filter set`);
      }
      if (jobs.rows !== 12 || jobs.details !== jobs.rows || jobs.diagnostics !== jobs.rows
          || jobs.stateDetails !== jobs.rows || !['active', 'queued', 'attention', 'complete', 'cancelled']
            .every((kind) => jobs.stateKinds.includes(kind))) {
        problems.push(`jobs/${view}: each displayed job does not own a state-specific detail and diagnostics fold`);
      }
      if (!jobs.trainingResults || !jobs.inferenceResults || jobs.emptyResults !== 2) {
        problems.push(`jobs/${view}: expanded training curves, inference findings, or queued empty states are missing`);
      }
      if (!jobs.completedTraining || jobs.confusionMatrices !== 1 || jobs.evaluationGraphs !== 2
          || jobs.trainingHistoryGraphs < 2 || jobs.classMetricRows !== 8
          || jobs.matrixCells !== 64 || jobs.evaluationTabs !== 4) {
        problems.push(`jobs/${view}: the eight-class completed-training review hierarchy is incomplete`);
      }
      if (jobs.sortableHeaders !== 7 || jobs.mobileSorts !== 7) {
        problems.push(`jobs/${view}: expected seven desktop and compact sort controls`);
      }
      if (jobs.ranges.join('|') !== '24h|5h|1h' || jobs.defaultRange !== '5h'
          || jobs.chartLines !== 3 || jobs.donutParts !== 5) {
        problems.push(`jobs/${view}: status composition or 24h/5h/1h activity history is incomplete`);
      }

      const beforeCount = await page.locator('#jobs tr.runrow-head').count();
      await page.locator('[data-job-priority="queued"]').click();
      const afterCount = await page.locator('#jobs tr.runrow-head').count();
      const firstState = await page.locator('#jobs tr.runrow-head .jstatus [data-state]').first().getAttribute('data-state');
      if (beforeCount !== afterCount || firstState !== 'queued') {
        problems.push(`jobs/${view}: summary prioritizing filtered rows or did not move queued jobs first`);
      }

      const compact = VIEWS[view].width <= 1050;
      const sorters = page.locator(compact ? '.jobs-sort-mobile [data-sort-column]' : '#jobs th.sortable');
      const directionAttribute = compact ? 'data-direction' : 'aria-sort';
      for (let column = 0; column < await sorters.count(); column += 1) {
        const sorter = sorters.nth(column);
        await sorter.click();
        const firstDirection = await sorter.getAttribute(directionAttribute);
        await sorter.click();
        const secondDirection = await sorter.getAttribute(directionAttribute);
        if (firstDirection === secondDirection) {
          problems.push(`jobs/${view}: sort ${column + 1} did not reverse`);
        }
      }

      await page.locator('#expandAll').click();
      const opened = await page.locator('#jobs tr.runrow-body:not([hidden])').count();
      const resultLabel = page.locator('#jobs .inference-results [data-result-highlight]').first();
      await resultLabel.click();
      const resultHighlight = await page.locator('#jobs .inference-results [data-result-graph]').first().evaluate((results) => ({
        active: results.classList.contains('is-highlighted'),
        selected: results.querySelectorAll('.result-line.highlighted').length
      }));
      await resultLabel.click();
      const resultRestored = await resultLabel.getAttribute('aria-pressed');
      const evaluation = page.locator('#jobs [data-training-evaluation]');
      await evaluation.locator('[data-eval-split="val"]').click();
      const splitLabel = await evaluation.locator('[data-split-label]').textContent();
      await evaluation.locator('[data-eval-tab="confusion"]').click();
      const confusionVisible = await evaluation.locator('[data-eval-view="confusion"]').isVisible();
      await evaluation.locator('[data-matrix-mode="count"]').click();
      const matrixCount = await evaluation.locator('.confusion i').first().textContent();
      await page.locator('#jobs tr.runrow-body details.diag summary').first().click();
      const diagOpen = await page.locator('#jobs tr.runrow-body details.diag').first().getAttribute('open');
      await page.locator('#expandAll').click();
      const closed = await page.locator('#jobs tr.runrow-body:not([hidden])').count();
      if (opened !== jobs.rows || diagOpen === null || closed !== 0) {
        problems.push(`jobs/${view}: Expand all, Diagnostics, or Collapse all did not work`);
      }
      if (!resultHighlight.active || resultHighlight.selected !== 1 || resultRestored !== 'false') {
        problems.push(`jobs/${view}: a result legend label does not isolate and restore its graph series`);
      }
      if (splitLabel !== 'Validation' || !confusionVisible || matrixCount.includes('%')) {
        problems.push(`jobs/${view}: evaluation split, view tabs, or confusion-matrix mode does not update`);
      }
    }

    const file = join(APP, 'shots', `mock-${name}-${view}.png`);
    /* fullPage, because the part below the fold is exactly the part that has
       not been looked at yet. */
    await page.screenshot({ path: file, fullPage: true });
    console.log(`mock-${name}-${view}.png`);

    /* Anything wider than the box that holds it. The right-edge check above
       only sees content leaving the *viewport*; a child overflowing its own
       grid column lands on top of the column beside it and stays inside the
       page, which is how two headings ended up printed over each other. */
    const spill = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.panel *, .rundetail *')) {
        const par = el.parentElement;
        if (!par) continue;
        const cs = getComputedStyle(par);
        if (cs.overflowX !== 'visible' || cs.display === 'inline') continue;
        if (getComputedStyle(el).position === 'absolute') continue;
        const a = el.getBoundingClientRect();
        const b = par.getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        if (a.width - b.width > 2) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`
            + ` ${Math.round(a.width)}px inside ${Math.round(b.width)}px`
            + ` ${par.tagName.toLowerCase()}.${String(par.className).split(' ')[0]}`);
        }
      }
      return [...new Set(out)].slice(0, 5);
    });
    for (const o of spill) problems.push(`${name}/${view}: wider than its container: ${o}`);

    /* Two controls side by side in a `.fieldrow` must sit on the same line. They
       did not: a grid item stretches to its row, and a stretched `.field` puts
       the slack into its own label row, dropping the second control 7px. Easy
       to miss by eye on one screen, and it was wrong on two. */
    const rows = await page.evaluate(() => {
      const out = [];
      for (const row of document.querySelectorAll('.fieldrow')) {
        const ctrls = [...row.querySelectorAll(
          ':scope > .field > select, :scope > .field > input, :scope > .field > button')];
        if (ctrls.length < 2) continue;
        /* Only controls that are genuinely side by side. On a phone the row
           collapses to one column and the fields are *meant* to stack, so
           comparing every pair reported the layout working as a fault. */
        for (let i = 1; i < ctrls.length; i++) {
          const a = ctrls[i - 1].getBoundingClientRect();
          const b = ctrls[i].getBoundingClientRect();
          const sideBySide = Math.abs(a.left - b.left) > 2;
          if (sideBySide && Math.abs(a.top - b.top) > 1) {
            out.push((row.querySelector('label') || {}).textContent
              + ' -> ' + Math.round(a.top) + ' / ' + Math.round(b.top));
          }
        }
      }
      return out.slice(0, 4);
    });
    for (const r of rows) problems.push(`${name}/${view}: field pair off the same line: ${r}`);

    /* A tab icon that points at nothing fails silently -- the tab just shows the
       browser's default and nobody notices for months. So it is asserted. */
    const fav = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="icon"]');
      if (!link) return { missing: true };
      const res = await fetch(link.href, { method: 'GET' });
      return { href: link.getAttribute('href'), status: res.status };
    });
    if (fav.missing) problems.push(`${name}/${view}: no <link rel="icon"> -- the tab has no icon`);
    else if (fav.status !== 200) problems.push(`${name}/${view}: tab icon ${fav.href} answered ${fav.status}`);

    /* A dropdown that is only ever drawn shut cannot be judged, so a screen with
       an account button gets one extra shot with it open. */
    if (view === 'desktop' && await page.locator('[data-account-button]').count()) {
      await page.locator('[data-account-button]').click();
      await page.waitForTimeout(120);
      const f = join(APP, 'shots', `mock-${name}-menu.png`);
      await page.screenshot({ path: f, fullPage: false });
      console.log(`mock-${name}-menu.png`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }

    /* A drawer is the point of the screen it lives on, so it gets a shot of its
       own rather than only ever being photographed shut. */
    if (view === 'desktop' && await page.locator('#drawer').count()
        && await page.locator('.rowlink').count()) {
      await page.locator('table tbody tr').nth(2).click();
      await page.waitForTimeout(140);
      /* Opened folded, then opened again with the diagnostics expanded -- the
         folded state is the normal view and the open one is what it hides. */
      const d = join(APP, 'shots', `mock-${name}-drawer.png`);
      await page.screenshot({ path: d, fullPage: false });
      console.log(`mock-${name}-drawer.png`);
      if (await page.locator('details.diag').count()) {
        await page.locator('details.diag summary').click();
        await page.waitForTimeout(140);
        /* The drawer body is its own scroller, so opening the fold is not enough
           -- what it revealed is below the fold until this scrolls to it. */
        await page.locator('.drawer-bd').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(120);
        const d2 = join(APP, 'shots', `mock-${name}-drawer-diag.png`);
        await page.screenshot({ path: d2, fullPage: false });
        console.log(`mock-${name}-drawer-diag.png`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    const over = await page.evaluate(() => {
      const w = window.innerWidth;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        let fixed = false;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
        }
        if (fixed) continue;
        /* A wide table scrolling inside its own overflow-x wrapper is the
           documented answer, not a defect -- so only content that escapes every
           scroller counts. */
        let scrolls = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') { scrolls = true; break; }
        }
        if (scrolls) continue;
        if (r.right > w + 1) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`
            + ` right=${Math.round(r.right)}`);
        }
      }
      return { over: out.slice(0, 5), w,
        scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    if (over.scrolls) problems.push(`${name}/${view}: the page scrolls sideways`);
    for (const o of over.over) problems.push(`${name}/${view}: past the ${over.w}px edge: ${o}`);
    for (const e of errors) problems.push(`${name}/${view}: console error: ${e}`);
  }
  await page.close();
}

await browser.close();
stop();

if (problems.length) {
  console.error('');
  for (const p of problems) console.error('[x] ' + p);
  process.exit(1);
}
console.log(`ok  ${which.length * views.length} shots, nothing clipped, no console errors`);
