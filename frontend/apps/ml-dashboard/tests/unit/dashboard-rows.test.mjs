/**
 * The Dashboard's donuts share a row, and its graphs the next.
 *
 * #310. Isaac: the page read donut, graph, then donut and graph on one line, then the
 * list. Outcomes sat over Completion activity, and the GPU pool's utilization graph was
 * inside the pool panel beside its donut. The donuts are now one row and the graphs the
 * next, each graph in its own panel.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drawScreen, APP } from './screen.mjs';

test('donuts on the first row, graphs on the second, then the list', async (t) => {
  const screen = await drawScreen('dashboard.html', {
    listWorkers: async () => [],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    jobSeries: async () => ({ points: [] }),
    gpuSeries: async () => ({ points: [] }),
  });
  t.after(screen.close);

  const { document } = screen;
  const row = (name) => document.querySelector(`.panel-row[data-dashboard-row="${name}"]`);
  const children = (el) => [...el.children].filter((child) => child.classList.contains('panel'));

  const donuts = children(row('donuts'));
  const graphs = children(row('graphs'));

  assert.equal(donuts.length, 2);
  assert.ok(donuts[0].querySelector('.job-donut'), 'Outcomes, first');
  assert.equal(donuts[1].id, 'worker-pool', 'the pool donut beside it');
  assert.equal(donuts[1].querySelector('[data-pool-history]'), null, 'with its graph moved out');

  assert.equal(graphs.length, 2);
  assert.ok(graphs[0].matches('[data-ops-activity]'), 'Completion activity');
  assert.ok(graphs[1].querySelector('[data-pool-history]'), 'and the utilization graph beside it');

  const panels = [...document.querySelectorAll('.dashboard-panels > *')];
  assert.ok(panels.indexOf(row('donuts')) < panels.indexOf(row('graphs')));
  assert.ok(panels.indexOf(row('graphs')) < panels.indexOf(document.querySelector('#current-activity')), 'then the list');
});

test('a two-up row is a two-column grid, and one column on a narrow screen', () => {
  const css = readFileSync(join(APP, 'screens.css'), 'utf8');

  assert.match(css, /\.panel-row\[data-cols="2"\] \{\s*display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 1050px\) \{\s*\.panel-row\[data-cols="2"\] \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
