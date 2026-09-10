/**
 * The shell and the router.
 *
 * Owns the rail, the top bar and the content slot, and nothing else. A tab
 * renders into the content slot and never reaches out of it -- that rule is
 * what lets eight tabs be drawn by different people and still be one
 * application. See DESIGN.md, "Module contract".
 */
import { h, fill, $ } from './lib/dom.js';
import icon from './lib/icons.js';
import { fmt } from './lib/fmt.js';
import { btn, iconBtn, search, select, st } from './lib/parts.js';
import { load } from './data.js';

/** The rail, in order. `mod` is loaded lazily the first time a tab is opened. */
const TABS = [
  { id: 'dashboard', text: 'Dashboard', ico: 'dashboard', mod: () => import('./tabs/dashboard.js') },
  { id: 'jobs', text: 'Jobs', ico: 'jobs', mod: () => import('./tabs/jobs.js') },
  { id: 'inference', text: 'Inference', ico: 'inference', mod: () => import('./tabs/inference.js') },
  { id: 'training', text: 'Training', ico: 'training', mod: () => import('./tabs/training.js') },
  { id: 'datasets', text: 'Datasets', ico: 'datasets', mod: () => import('./tabs/datasets.js') },
  { id: 'models', text: 'Models', ico: 'models', mod: () => import('./tabs/models.js') },
  { id: 'workers', text: 'Workers', ico: 'workers', mod: () => import('./tabs/workers.js') },
  { id: 'history', text: 'History', ico: 'history', mod: () => import('./tabs/history.js') },
];

const state = {
  tab: 'dashboard',
  params: {},
  project: 'all',
  query: '',
  data: null,
};

/* ------------------------------------------------------------------ routing */

/** `#/jobs?state=failed` -> { id: 'jobs', params: { state: 'failed' } } */
function readHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, qs] = raw.split('?');
  const found = TABS.find((t) => t.id === id);
  return { id: found ? found.id : 'dashboard', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

/**
 * The only way a tab reaches another tab. Goes through the hash so the back
 * button works and a screen can be linked to -- which is also what makes the
 * walkthrough recordings able to start anywhere.
 */
function nav(id, params) {
  const qs = new URLSearchParams(params || {}).toString();
  location.hash = '#/' + id + (qs ? '?' + qs : '');
  document.body.dataset.rail = 'closed';
}

/* -------------------------------------------------------------------- shell */

function railEl() {
  const nums = state.data ? state.data.counts : {};
  return h('aside', { class: 'rail' },
    h('div', { class: 'rail-logo' },
      h('img', { src: '../../shared/assets/images/marp-logo-compact.png', alt: 'MARP' })),
    h('div', { class: 'rail-sec' }, 'Machine Learning'),
    h('nav', { class: 'rail-nav', ariaLabel: 'Sections' },
      TABS.map((t) => h('a', {
        href: '#/' + t.id,
        ariaCurrent: t.id === state.tab ? 'page' : null,
        dataNav: t.id,
      }, icon(t.ico), h('span', {}, t.text),
        // Only one badge in the rail, and it is the one an operator has to act
        // on. A count beside every destination is decoration.
        t.id === 'jobs' && nums.attention
          ? h('span', { class: 'badge', title: `${nums.attention} need attention` }, nums.attention)
          : null))),
    h('div', { class: 'rail-foot' },
      st('online'),
      h('div', { class: 'ver' }, 'MARP ML v0.1.0 · mockup')));
}

function topbarEl(meta) {
  const projects = state.data ? state.data.projects : [];
  return h('header', { class: 'topbar' },
    // Only drawn on the phone layout, where the rail has left the grid.
    h('button', {
      class: 'btn icon railtoggle', type: 'button', ariaLabel: 'Sections',
      onclick: () => {
        document.body.dataset.rail = document.body.dataset.rail === 'open' ? 'closed' : 'open';
        render();
      },
    }, icon('menu')),
    h('div', { class: 'heading' },
      h('h1', {}, meta.title),
      meta.subtitle && h('div', { class: 'sub' }, meta.subtitle)),
    h('div', { class: 'tools' },
      h('span', { class: 'lab' }, 'Project'),
      select([['all', 'All projects'], ...projects.map((p) => [p.code, p.name])], {
        value: state.project, label: 'Project',
        onchange: (e) => { state.project = e.target.value; render(); },
      }),
      search('Search jobs, models, datasets...', (e) => {
        state.query = e.target.value;
        // The query is shell state so it survives a tab change; each tab reads
        // it out of ctx and decides what it means there.
        clearTimeout(topbarEl._t);
        topbarEl._t = setTimeout(render, 160);
      }),
      iconBtn('refresh', 'Reload', () => render()),
      btn('New Inference Job', { primary: true, ico: 'plus', onclick: () => nav('inference') }),
      btn('New Training Job', { accent: true, ico: 'plus', onclick: () => nav('training') })));
}

/* ------------------------------------------------------------------- render */

// The topbar's search input is recreated on every render, so its value and the
// caret have to be put back or typing loses a character on every keystroke.
function keepSearch(fn) {
  const before = $('.topbar .search input');
  const val = before ? before.value : state.query;
  const pos = before ? before.selectionStart : null;
  const had = before === document.activeElement;
  fn();
  const after = $('.topbar .search input');
  if (after) {
    after.value = val;
    if (had) { after.focus(); if (pos !== null) after.setSelectionRange(pos, pos); }
  }
}

let rendering = false;

async function render() {
  if (rendering) return;
  rendering = true;
  try {
    const route = readHash();
    state.tab = route.id;
    state.params = route.params;

    const tab = TABS.find((t) => t.id === state.tab);
    const mod = await tab.mod();
    const meta = mod.meta || { title: tab.text };

    document.title = `${meta.title} · MARP Machine Learning`;

    const ctx = {
      data: state.data,
      nav,
      fmt,
      project: state.project,
      query: state.query.trim(),
      params: state.params,
    };

    const content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
    keepSearch(() => {
      fill($('#app'),
        railEl(),
        h('div', { class: 'main' }, topbarEl(meta), content),
        document.body.dataset.rail === 'open'
          ? h('div', { class: 'rail-scrim', onclick: () => { document.body.dataset.rail = 'closed'; render(); } })
          : null);
    });

    content.appendChild(mod.render(ctx));
    if (mod.mount) mod.mount(content, ctx);
  } catch (err) {
    fill($('#app'), h('div', { style: 'padding:24px;max-width:620px' },
      h('h1', { style: 'font-size:16px;color:var(--red-400);margin-bottom:8px' }, 'Could not start'),
      h('p', { class: 'mono' }, String(err && err.message || err)),
      h('p', { class: 'muted' },
        'This app uses ES modules and fetch, so it has to be served over HTTP ',
        'rather than opened from the filesystem. Run npm run serve.')));
    throw err;
  } finally {
    rendering = false;
  }
}

/* --------------------------------------------------------------------- boot */

export async function start() {
  document.body.dataset.rail = 'closed';
  state.data = await load();
  /* The rail's destinations are plain <a href="#/id">, so they change the hash
     without going through nav() -- which meant the phone sheet stayed open over
     the page you had just navigated to. Closing here covers every route change
     whatever caused it. */
  addEventListener('hashchange', () => {
    document.body.dataset.rail = 'closed';
    render();
  });
  await render();
  // Reachable from the console, the way the mosaic reviewer's is, so a state
  // the fixture is too healthy to produce can still be got at by hand.
  window.MARP_ML = { state, nav, render, TABS };
}
