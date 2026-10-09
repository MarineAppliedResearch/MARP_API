/** #137: completion is proved against committed API decisions, never the fixture. */
import { test, expect } from '@playwright/test';
import { commitOne } from './corpus.mjs';
import { facetsFor, pageOf, pageSizeOf, question, ready, expectRealBacking } from './support.mjs';
import { toQuery } from '../../src/model/query-url.js';
import { DEFAULT_SORT } from '../../src/model/filters.js';

const column = { scientific: 'review_decision', training: 'training_decision' };
const reasonColumn = { scientific: 'flag_reason', training: 'exclusion_reason' };
const accepted = { scientific: 'reviewed', training: 'promoted' };
const exception = { scientific: 'flagged', training: 'excluded' };

// A short final page proves partial completion while touching only a few real rows.
async function claimPage(request, pageSize, mode) {
  const unrestricted = {
    species: [],
    reviewStatus: ['unreviewed', 'flagged', 'reviewed'],
    trainingDisposition: ['undecided', 'promoted', 'excluded']
  };
  const { line } = await facetsFor(request, unrestricted);
  for (const candidate of line) {
    const inLine = await facetsFor(request, { ...unrestricted, line: [candidate.value] });
    for (const species of inLine.species || []) {
      const tail = species.count % pageSize;
      if (species.count <= pageSize || tail < 2 || tail > 8) continue;
      const filters = { ...unrestricted, species: [species.value], line: [candidate.value] };
      const last = Math.ceil(species.count / pageSize);
      const result = await pageOf(request, filters, { page: last, pageSize });
      if (result.rows.length !== tail || !result.rows.every((row) =>
        row.thumbnail_status === 'ready' &&
        [null, accepted[mode], exception[mode]].includes(row[column[mode]]))) continue;
      return { filters, last, rows: result.rows, pageSize };
    }
  }
  throw new Error('No ready final page of 2-8 observations with a preceding page; cannot prove #137.');
}

async function openClaim(page, mode, claim) {
  const search = toQuery({ mode, filters: question(claim.filters), sort: DEFAULT_SORT, page: 1 });
  await page.goto(`./${search}`);
  await expectRealBacking(page);
  await ready(page);
  expect(await pageSizeOf(page)).toBe(claim.pageSize);
  // Initial layout changes page size on phones; navigate only after it settles.
  await page.locator('#pageInput').fill(String(claim.last));
  await page.locator('#pageInput').press('Enter');
  await expect(page.locator('#pageInput')).toHaveValue(String(claim.last));
  await ready(page);
  const ids = await page.locator('.tile').evaluateAll((tiles) => tiles.map((tile) => Number(tile.dataset.id)));
  expect(ids).toEqual(claim.rows.map((row) => row.observation_id));
}

async function makeUndecided(request, mode, claim) {
  for (const row of claim.rows) {
    const result = await commitOne(request, mode, row, { withdraw: true });
    expect(result.conflicted).toEqual([]);
    expect(result.skipped).toEqual([]);
  }
}

async function restoreClaim(request, mode, claim) {
  const current = await pageOf(request, claim.filters, { page: claim.last, pageSize: claim.pageSize });
  for (const original of claim.rows) {
    const row = current.rows.find((r) => r.observation_id === original.observation_id);
    expect(row, 'the observation must still exist for restoration').toBeTruthy();
    const decision = original[column[mode]];
    await commitOne(request, mode, row, decision == null ? { withdraw: true } : {
      kind: decision === exception[mode] ? 'except' : 'accept',
      reason: original[reasonColumn[mode]]
    });
  }
  const restored = await pageOf(request, claim.filters, { page: claim.last, pageSize: claim.pageSize });
  expect(restored.rows.map((row) => [row.observation_id, row[column[mode]], row[reasonColumn[mode]]]))
    .toEqual(claim.rows.map((row) => [row.observation_id, row[column[mode]], row[reasonColumn[mode]]]));
}

async function mark(page, rows) {
  for (const row of rows) {
    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
    await tile.click();
    await expect(tile).toHaveClass(/marked/);
  }
}

async function save(page, selector = '#commitMarked') {
  const response = page.waitForResponse((res) => res.request().method() === 'POST' &&
    /\/mosaic\/observations\/(review|training)$/.test(new URL(res.url()).pathname));
  await page.locator(selector).click();
  const res = await response;
  expect(res.ok()).toBeTruthy();
  const report = await res.json();
  expect(report.conflicted).toEqual([]);
  expect(report.skipped).toEqual([]);
  await expect(page.locator(selector)).toContainText('Saved');
}

async function noPins(page) {
  expect(await page.evaluate(async () => {
    const { state } = await import('./src/store.js');
    return [state.pageMembers.size, state.pinnedRows.size];
  })).toEqual([0, 0]);
}

async function completedPager(page, claim) {
  await expect(page.locator('#pagesDone b').first()).toHaveText('1');
  await page.locator('[data-page="prev"]').click();
  await ready(page);
  const chip = page.locator(`[data-page="${claim.last}"]`);
  await expect(chip).toHaveClass(/done/);
  await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).color)).toMatch(/^rgb/);
  const doneColour = await chip.evaluate((el) => getComputedStyle(el).color);
  const plainColour = await page.locator('.pg.nav').first().evaluate((el) => getComputedStyle(el).color);
  expect(doneColour, 'completed page must have a visibly different colour').not.toBe(plainColour);
}

for (const viewport of ['desktop', 'phone']) {
  test.describe(`#137 ${viewport}`, () => {
    test.use(viewport === 'phone' ? {
      viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true
    } : { viewport: { width: 1600, height: 900 } });

    for (const mode of ['scientific', 'training']) {
      for (const batches of [1, 2]) {
        test(`${mode}: every tile committed in ${batches} batch(es) completes the pager`, async ({ page, request }) => {
          test.setTimeout(60000);
          await page.goto('./');
          await expectRealBacking(page);
          await ready(page);
          const claim = await claimPage(request, await pageSizeOf(page), mode);
          try {
            await makeUndecided(request, mode, claim);
            await openClaim(page, mode, claim);
            const half = Math.floor(claim.rows.length / 2);
            const groups = batches === 1 ? [claim.rows] : [claim.rows.slice(0, half), claim.rows.slice(half)];
            for (let i = 0; i < groups.length; i++) {
              await mark(page, groups[i]);
              await expect(page.locator('#pagesDone b').first()).toHaveText('0');
              await save(page);
              await expect(page.locator('#pagesDone b').first()).toHaveText(i === groups.length - 1 ? '1' : '0');
              await noPins(page);
              const recorded = await pageOf(request, claim.filters, { page: claim.last, pageSize: claim.pageSize });
              const committed = groups.slice(0, i + 1).flat().map((row) => row.observation_id);
              for (const row of recorded.rows) {
                expect(row[column[mode]]).toBe(committed.includes(row.observation_id) ? exception[mode] : null);
              }
            }
            await completedPager(page, claim);

            // A fresh sweep still completes a page, using the existing whole-page action.
            if (batches === 1) {
              await makeUndecided(request, mode, claim);
              await openClaim(page, mode, claim);
              await save(page, '#commit');
              await completedPager(page, claim);
            }
          } finally {
            await restoreClaim(request, mode, claim);
          }
        });
      }
    }
  });
}
