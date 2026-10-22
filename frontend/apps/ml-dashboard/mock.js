/**
 * The shared chrome and the shared behaviour for every mockup screen.
 *
 * The icon sprite, the rail and the top bar's controls are built here rather
 * than copied into each screen's HTML. They were copied, and the point of
 * catching that early is that eight hand-written pages drift: a nav item gets
 * renamed on one screen, an icon is added on another, and the mockups stop
 * agreeing about what the application is. One definition cannot drift.
 *
 * A screen therefore declares only what it *is*:
 *
 *   <body data-screen="jobs">
 *     <div class="app">
 *       <aside class="rail"></aside>
 *       <div class="main">
 *         <header class="topbar"><h1>Jobs</h1></header>
 *         <main class="content"> ... the screen ... </main>
 *       </div>
 *     </div>
 *     <script src="./mock.js"></script>
 *
 * Behaviour is opt-in by markup: a screen with no drawer gets no drawer code,
 * a table with no sortable header is left alone.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Text from MARP reaches these screens as markup, so it is escaped on the way in.
   A species common name is typed by a person and an apostrophe is enough to break
   an attribute; `&` first, or the escaping undoes itself. */
const escapeHtml = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ================================================================== icons */

/* One 16x16 grid, stroked with currentColor so a class or a [data-state]
   colours them. No emoji anywhere in this design: emoji render differently on
   every platform and cannot take a state colour, which is the whole job of an
   icon here. */
const ICONS = {
  dashboard: '<rect x="2" y="2" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="1"/><rect x="2" y="8.5" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1"/>',
  jobs: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12M5.5 3v10"/>',
  inference: '<path d="M2 8h3M11 8h3"/><circle cx="8" cy="8" r="2.6"/><path d="M8 2v2.4M8 11.6V14"/>',
  training: '<path d="M2 12.5 5 8l2.5 2.5L11 4.5 14 9"/><path d="M2 14h12"/>',
  datasets: '<ellipse cx="8" cy="4" rx="5.5" ry="2"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4"/><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>',
  models: '<path d="M8 1.8 14 5v6L8 14.2 2 11V5z"/><path d="M2 5l6 3.2L14 5M8 8.2v6"/>',
  workers: '<circle cx="5.6" cy="5.6" r="2.2"/><circle cx="11.4" cy="10.4" r="2.2"/><path d="M2 13.4c0-1.7 1.6-2.6 3.6-2.6M14 4.4c-2 0-3.6.9-3.6 2.6"/>',
  history: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.6 1.6"/>',

  play: '<path d="M5 3.4 12.2 8 5 12.6z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.2"/>',
  queue: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7"/>',
  alert: '<path d="M8 2.2 14.4 13.2H1.6z"/><path d="M8 6.2v3.1M8 11.2h.01"/>',
  tick: '<path d="M3 8.4l3.2 3.2L13 4.6"/>',
  check: '<circle cx="8" cy="8" r="6"/><path d="M5.4 8.2l1.9 1.9 3.4-4"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.4v3.4M8 5.2h.01"/>',

  chip: '<rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2"/><path d="M6.4 1.6v2.6M9.6 1.6v2.6M6.4 11.8v2.6M9.6 11.8v2.6M1.6 6.4h2.6M1.6 9.6h2.6M11.8 6.4h2.6M11.8 9.6h2.6"/>',
  slots: '<rect x="1.6" y="4" width="12.8" height="7.4" rx="1.2"/><path d="M4.4 6.4h3.2v3h-3.2zM9.6 6.6h2.6M9.6 9h2.6M4 11.4v2M11 11.4v2"/>',
  search: '<circle cx="7" cy="7" r="4.4"/><path d="M10.3 10.3 14 14"/>',
  refresh: '<path d="M13.4 7a5.5 5.5 0 1 0-1.6 4.2"/><path d="M13.9 3.2v3.6h-3.6"/>',
  plus: '<path d="M8 3.4v9.2M3.4 8h9.2"/>',
  dots: '<circle cx="8" cy="3.4" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="8" cy="12.6" r="1.1"/>',
  copy: '<rect x="5.4" y="5.4" width="8" height="8" rx="1.2"/><path d="M10.6 5.4V3.8a1.2 1.2 0 0 0-1.2-1.2H3.8a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.6"/>',
  retry: '<path d="M2.6 8a5.4 5.4 0 1 1 1.6 3.8"/><path d="M2.1 12.2V8.6h3.6"/>',
  eye: '<path d="M1.4 8S4 3.6 8 3.6 14.6 8 14.6 8 12 12.4 8 12.4 1.4 8 1.4 8z"/><circle cx="8" cy="8" r="1.9"/>',
  download: '<path d="M8 2.6v7.6M4.8 7.4 8 10.6l3.2-3.2M2.6 13.4h10.8"/>',
  filter: '<path d="M2 4h12M4.4 8h7.2M6.6 12h2.8"/>',
  calendar: '<rect x="2.2" y="3.4" width="11.6" height="10.4" rx="1.2"/><path d="M2.2 6.6h11.6M5.4 1.8v2.6M10.6 1.8v2.6"/>',
  clock: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.4 1.4"/>',
  chart: '<path d="M2.4 13.6V9M6.4 13.6V3.4M10.4 13.6V6.6M14 13.6v-3"/>',
  arrow: '<path d="M3 8h9.4M9 4.6 12.4 8 9 11.4"/>',
  left: '<path d="M10 3.6 5.6 8 10 12.4"/>',
  right: '<path d="M6 3.6 10.4 8 6 12.4"/>',
  down: '<path d="M3.6 6 8 10.4 12.4 6"/>',
  menu: '<path d="M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h11.2"/>',
  video: '<rect x="1.6" y="4" width="9" height="8" rx="1.2"/><path d="M10.6 7.4 14.4 5.2v5.6l-3.8-2.2z"/>',
  pencil: '<path d="M11 2.6l2.4 2.4-8 8H3v-2.4z"/>',
  split: '<path d="M2.4 8h3.2M2.4 8V4.4h3.2M2.4 8v3.6h3.2M8.8 4.4h4.8M8.8 8h4.8M8.8 11.6h4.8"/>',
  star: '<path d="M8 2.2l1.8 3.7 4 .6-2.9 2.9.7 4.1L8 11.6l-3.6 1.9.7-4.1L2.2 6.5l4-.6z"/>',
};

/** `<svg class="ico"><use href="#i-play"/></svg>`, as markup. */
const ico = (name, cls) =>
  '<svg class="ico' + (cls ? ' ' + cls : '') + '"><use href="#i-' + name + '"/></svg>';

function mountSprite() {
  if ($('#mockSprite')) return;
  const symbols = Object.keys(ICONS)
    .map((k) => '<symbol id="i-' + k + '" viewBox="0 0 16 16">' + ICONS[k] + '</symbol>')
    .join('');
  const holder = document.createElement('div');
  holder.innerHTML = '<svg id="mockSprite" width="0" height="0" aria-hidden="true">'
    + '<defs>' + symbols + '</defs></svg>';
  /* Prepended, not appended: a `use` in the page resolves as soon as its target
     exists, and putting the sprite first keeps that order obvious. */
  document.body.insertBefore(holder.firstChild, document.body.firstChild);
}

/* ================================================================== the rail */

/* The destinations, in order, and the only place they are listed. `badge` is
   the one count an operator has to act on -- a number beside every entry is
   decoration. */
const NAV = [
  { id: 'dashboard', label: 'Dashboard',
    tip: 'What the GPU pool is running, queued and struggling with' },
  { id: 'jobs', label: 'Jobs', tone: 'attn',
    tip: 'The GPU queue: inference, tracking and training. Dataset builds live on Datasets' },
  { id: 'inference', label: 'Inference', tone: 'run',
    tip: 'Run a model over MARP data' },
  { id: 'training', label: 'Training', tone: 'run',
    tip: 'Fine-tune a model on a saved dataset' },
  { id: 'datasets', label: 'Datasets',
    tip: 'Build and save training sets from approved observations' },
  { id: 'models', label: 'Models',
    tip: 'The model registry, its versions and what each is preferred for' },
  { id: 'workers', label: 'Workers', tip: 'The GPU pool that runs the work' },
  { id: 'history', label: 'History', tip: 'Finished work, searchable' },
];

const IMG = '../../../shared/assets/images/';

/**
 * The counts beside the rail, from MARP.
 *
 * Two kinds, and they must not look alike: red is work that has gone wrong and needs
 * somebody, cyan is work running right now. A badge with nothing behind it is hidden
 * rather than drawn as a zero -- a zero is a number somebody reads and acts on, and
 * "nothing is wrong" is better said by the absence of a warning.
 *
 * **Dataset builds are deliberately not counted under Jobs.** They are `gpu_jobs` rows,
 * but the Jobs screen is the GPU queue and a build is not in it -- it has its own place
 * on Datasets, which is what that tooltip already says.
 *
 * Silent on failure: counts beside a label are not the labels.
 *
 * @returns {Promise<void>}
 */
async function fillRailBadges() {
  if (!window.MarpApi) return;

  const set = (id, count) => {
    const badge = $('[data-nav-badge="' + id + '"]');

    if (!badge) return;

    badge.textContent = String(count);
    badge.hidden = !count;
  };

  try {
    /* `limit: 1` because only the total is wanted and the rows are the expensive part;
       none of them is drawn here. */
    const [failed, inference, training] = await Promise.all([
      window.MarpApi.listJobs({ state: 'failed', limit: 1 }),
      window.MarpApi.listJobs({ state: 'leased', kind: 'inference', limit: 1 }),
      window.MarpApi.listJobs({ state: 'leased', kind: 'training', limit: 1 }),
    ]);

    set('jobs', failed.total || 0);
    set('inference', inference.total || 0);
    set('training', training.total || 0);
  } catch {
    /* Nothing: a rail that could not count is a rail without badges. */
  }
}

function mountRail() {
  const rail = $('.rail');
  if (!rail) return;
  const here = document.body.dataset.screen;

  const links = NAV.map((n) => {
    const current = n.id === here ? ' aria-current="page"' : '';
    /* Two kinds of count, and they must not look alike: red is work that has
       gone wrong, cyan is work in progress. */
    /* Empty, and filled by `fillRailBadges` from MARP. These read 8, 4 and 2 on every
       screen until 2026-10-21, because they were written into the mockup's nav and
       nothing ever replaced them -- Isaac, on a pool with nothing running: "i notice
       that jobs has a 8 next to the jobs tab, but there are 0 jobs running?". The
       markup check never saw them because they live in JavaScript, not markup. */
    const badge = n.tone
      ? '<span class="badge" data-tone="' + n.tone + '" data-nav-badge="' + n.id + '" hidden></span>'
      : '';
    return '<a href="./' + n.id + '.html"' + current + ' data-nav="' + n.id + '"'
      + ' title="' + (n.tip || n.label) + '">'
      + ico(n.id) + '<span>' + n.label + '</span>' + badge + '</a>';
  }).join('');

  rail.innerHTML =
    '<div class="rail-logo">'
    + '<img class="wordmark" src="' + IMG + 'marp-logo-compact.png" alt="MARP">'
    + '<img class="mark" src="' + IMG + 'marp-mark.png" alt="MARP">'
    + '</div>'
    + '<div class="rail-sec">Machine Learning</div>'
    + '<nav class="rail-nav" aria-label="Sections">' + links + '</nav>'
    + '<div class="rail-foot">'
    + '<span class="st" data-state="online"><span class="dot"></span><span>System online</span></span>'
    + '<div class="ver">MARP ML v0.1.0 &middot; mockup</div>'
    + '</div>';
}

/* ================================================================ the top bar */

const PROJECTS = ['All projects', 'CAMPA 2024', 'GULF 2025', 'PACIFIC 2023',
  'SALT 2024', 'VENTS 2025', 'ARCTIC 2024'];

/* The actions a top bar can offer, defined once so two screens cannot describe
   the same button two ways. */
const ACTIONS = {
  inference: { text: 'New Inference Job', ico: 'plus', cls: 'primary',
    tip: 'Run a registered model over MARP data' },
  training: { text: 'New Training Job', ico: 'plus', cls: 'accent',
    tip: 'Fine-tune a model on a saved dataset' },
  dataset: { text: 'New Dataset', ico: 'plus', cls: 'primary',
    tip: 'Build a dataset from promoted observations' },
  register: { text: 'Register Model', ico: 'plus', cls: 'primary',
    tip: 'Add model weights, metadata and provenance to the registry' },
  /* There is no add-a-worker action: a machine dials out and enrolls itself
     with a service token. Issuing that token is the thing a person does. */
  tokens: { text: 'Service Tokens', ico: 'chip', cls: 'primary',
    tip: 'Issue a token so a new machine can enroll itself' },
};

/* What each screen's top bar holds. `project` is shown only where narrowing by
   project means something. */
const TOPBAR = {
  dashboard: { project: true, actions: ['inference', 'training'] },
  jobs: { project: true, actions: ['inference', 'training'] },
  inference: { project: true, actions: ['inference', 'training'] },
  training: { project: true, actions: ['inference', 'training'] },
  datasets: { project: true, actions: ['dataset'] },
  models: { project: false, wide: true, actions: ['register'], kebab: true,
    search: 'Search models by name, task, dataset or description\u2026' },
  workers: { project: false, wide: true, actions: ['tokens'], kebab: true,
    search: 'Search workers by name, GPU or job\u2026' },
  history: { project: true, actions: [] },
};

function mountTopbar() {
  const bar = $('.topbar');
  if (!bar) return;
  const cfg = TOPBAR[document.body.dataset.screen] || TOPBAR.dashboard;

  const toggle = document.createElement('button');
  toggle.className = 'btn icon railtoggle';
  toggle.setAttribute('aria-label', 'Sections');
  toggle.innerHTML = ico('menu');
  bar.insertBefore(toggle, bar.firstChild);

  const btn = (key) => {
    const a = ACTIONS[key];
    return '<button class="btn ' + a.cls + '" data-top-action="' + key + '" title="' + a.tip + '">'
      + ico(a.ico) + a.text
      + '</button>';
  };

  const tools = document.createElement('div');
  tools.className = 'tools' + (cfg.wide ? ' wide' : '');
  tools.innerHTML =
    (cfg.project
      ? '<span class="lab">Project</span><select class="sel" aria-label="Project">'
        + PROJECTS.map((p) => '<option>' + p + '</option>').join('') + '</select>'
      : '')
    + '<span class="search">' + ico('search', 'sm')
    + '<input class="inp" type="search" placeholder="'
    + (cfg.search || 'Search jobs, models, datasets\u2026') + '"'
    + ' aria-label="Search"></span>'
    + '<button class="btn icon" aria-label="Reload" title="Reload">' + ico('refresh') + '</button>'
    + (cfg.actions || []).map(btn).join('')
    + (cfg.kebab
      ? '<button class="btn icon" aria-label="More" title="Export, columns and settings">'
        + ico('dots') + '</button>'
      : '')
    /* Account behavior and presentation are shared, while this application owns the rows
       inside its menu (#166). It used to be written here with identity literals --
       which is the bug the Mosaic Reviewer's notes record as having shipped once, telling
       everybody they were one developer. Nobody's name is typed into this application now.

       **This app asks for itself.** It is not session-gated, unlike the other two, so it
       genuinely does not know: signed in it shows you, and signed out it says so rather
       than drawing a plausible stranger. `DESIGN.md` calls this a mockup with real
       operation, and this is the real half. */
    + '<div class="account" data-account data-account-signed-out="show">'
    + '<button class="account__button" type="button" data-account-button'
    + ' data-account-nobody="yes" aria-haspopup="true" aria-expanded="false"'
    + ' aria-label="Not signed in">\u00b7</button>'
    + '<div class="account__menu" role="menu" data-account-menu hidden>'
    + '<p class="account__who" data-account-who>Not signed in</p>'
    + '<a class="account__item" role="menuitem" href="/apps/dashboard/index.html">Open the dashboard</a>'
    + '<hr class="account__rule">'
    + '<a class="account__item" role="menuitem" data-account-signin href="/?login=1">Sign in</a>'
    + '<button class="account__item" type="button" role="menuitem" data-account-signout hidden>Sign out</button>'
    + '</div></div>';
  bar.appendChild(tools);
}

/* =============================================================== behaviour */

function wireRailSheet() {
  const toggle = $('.railtoggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    document.body.dataset.rail = document.body.dataset.rail === 'open' ? 'closed' : 'open';
  });
}

function wireSelection() {
  const bulk = $('#bulk');
  if (!bulk) return;
  const boxes = $$('tbody .chkbox');
  const all = $('#all');
  const filters = $('#filters');
  const count = $('#bulkN');

  const sync = () => {
    const picked = boxes.filter((b) => b.checked);
    boxes.forEach((b) => b.closest('tr').classList.toggle('on', b.checked));
    if (count) count.textContent = String(picked.length);
    /* The filters are replaced rather than joined: a filter and a bulk action
       look alike and do opposite things, so both on screen at once is a way to
       cancel ten jobs while meaning to narrow a list. */
    bulk.hidden = picked.length === 0;
    if (filters) filters.hidden = picked.length !== 0;
    if (all) {
      all.checked = picked.length === boxes.length && boxes.length > 0;
      all.indeterminate = picked.length > 0 && picked.length < boxes.length;
    }
  };

  boxes.forEach((b) => b.addEventListener('change', sync));
  if (all) {
    all.addEventListener('change', (e) => {
      boxes.forEach((b) => { b.checked = e.target.checked; });
      sync();
    });
  }
  const clear = $('#bulkClear');
  if (clear) {
    clear.addEventListener('click', () => {
      boxes.forEach((b) => { b.checked = false; });
      sync();
    });
  }
  sync();
}

/**
 * Local sort, on the rows already on the page. Nothing is fetched — the whole
 * table is here, so sorting it is a client-side reorder.
 *
 * A cell's key comes from `data-sort` when it has one and from its text when it
 * does not, which matters for every column whose displayed value does not sort
 * the way it reads: a progress bar, a status word, a time without its date.
 * `aria-sort` on the header is the single source for the arrow, so the drawn
 * state and the announced state cannot disagree.
 */
function wireSorting() {
  $$('table.tbl').forEach((table) => {
    /* **A table that sorts its own data says so, and is left alone here.**
       Sorting rows in the DOM only ever reorders the page you can see, which
       is a different answer from the one the column promises once a list is
       paged -- and with both handlers bound the two sorts fight, leaving the
       arrow claiming ascending over descending rows.

       This was a list of table ids and it was forgotten three times, once per
       screen, each time producing the same silent wrong order. Now the screen
       that takes over sorting marks the table as it draws it, so forgetting is
       not possible: whoever owns the data owns the sort. */
    if (table.dataset.sortsItsOwnData === 'true') return;

    const heads = $$('th.sortable', table);
    const body = $('tbody', table);
    if (!heads.length || !body) return;
    const panel = table.closest('.panel') || document;
    const sortControls = $$('[data-sort-column]', panel);

    const keyOf = (row, i) => {
      const cell = row.children[i];
      if (!cell) return '';
      const raw = cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent.trim();
      const n = Number(raw);
      return raw !== '' && !Number.isNaN(n) ? n : raw.toLowerCase();
    };

    const sortBy = (th, dir) => {
      const i = Array.prototype.indexOf.call(th.parentElement.children, th);
      const sign = dir === 'ascending' ? 1 : -1;

      /* In an expandable table a row is really two rows -- the head and the
         detail under it -- so they are gathered into pairs and moved together.
         Sorting the `tr` list flat interleaved every run with someone else's
         charts. */
      const groups = [];
      $$('tr', body).forEach((tr) => {
        if (tr.classList.contains('runrow-body') && groups.length) {
          groups[groups.length - 1].push(tr);
        } else {
          groups.push([tr]);
        }
      });

      groups.sort((a, b) => {
        const x = keyOf(a[0], i);
        const y = keyOf(b[0], i);
        if (x === y) return 0;
        return (x > y ? 1 : -1) * sign;
      });
      groups.forEach((g) => g.forEach((tr) => body.appendChild(tr)));
      heads.forEach((h) => h.setAttribute('aria-sort', h === th ? dir : 'none'));
      sortControls.forEach((control) => {
        const active = heads[Number(control.dataset.sortColumn)] === th;
        control.dataset.direction = active ? dir : 'none';
        control.setAttribute('aria-pressed', String(active));
      });
    };

    const go = (th) => {
      /* A fresh column sorts ascending; the sorted one reverses. Always
         restarting ascending made reversing a two-click gesture for nothing. */
      const now = th.getAttribute('aria-sort');
      sortBy(th, now === 'ascending' ? 'descending' : 'ascending');
    };

    heads.forEach((th) => {
      if (!th.hasAttribute('aria-sort')) th.setAttribute('aria-sort', 'none');
      th.setAttribute('tabindex', '0');
      th.addEventListener('click', () => go(th));
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(th); }
      });
    });
    sortControls.forEach((control) => {
      control.setAttribute('aria-pressed', 'false');
      control.addEventListener('click', () => {
        const th = heads[Number(control.dataset.sortColumn)];
        if (th) go(th);
      });
    });

    /* Whatever the markup declared sorted is applied on load, so the arrow is
       never pointing at an order the rows are not actually in. */
    const initial = heads.find((h) => {
      const v = h.getAttribute('aria-sort');
      return v === 'ascending' || v === 'descending';
    });
    if (initial) sortBy(initial, initial.getAttribute('aria-sort'));
  });
}

/**
 * Any group of buttons that swaps a set of panels: the in-page tab strip, and
 * the segmented controls for scope and output mode. One implementation, because
 * three screens want the same gesture and three copies would behave three ways.
 *
 *   <nav class="seg" data-switch="scope"> <button data-view="dive"> ... </nav>
 *   <div data-viewof="scope" data-view="dive" hidden> ... </div>
 */
function wireSwitchers() {
  $$('[data-switch]').forEach((root) => {
    const group = root.dataset.switch;
    const btns = $$('button[data-view]', root);
    const panels = $$('[data-viewof="' + group + '"]');
    if (!btns.length) return;

    const show = (view) => {
      btns.forEach((b) => {
        const on = b.dataset.view === view;
        b.classList.toggle('on', on);
        b.setAttribute('aria-current', on ? 'true' : 'false');
      });
      panels.forEach((p) => { p.hidden = p.dataset.view !== view; });
      root.dispatchEvent(new CustomEvent('switched', { detail: view, bubbles: true }));
    };

    btns.forEach((b) => {
      b.addEventListener('click', () => { if (!b.disabled) show(b.dataset.view); });
    });
    const start = btns.find((b) => b.classList.contains('on')) || btns[0];
    show(start.dataset.view);
  });
}

/**
 * The Dashboard's GPU pool chart.
 *
 * **What this replaced.** Four arrays of invented percentages per range, a `slotCapacity` of
 * 313 and a `queueScale` of 24 — none of which came from MARP. The 313 was visible on screen
 * beside a pool that has a different number of slots.
 *
 * Its own renderer rather than the shared helper, because this panel is shaped differently
 * from the other three: two filled areas rather than one, and time labels addressed by name
 * (`start`, `middle`, `end`) instead of by position.
 *
 * Three fetches, because the chart asks three questions: what the cards were doing
 * (`/gpu/telemetry/series`), and what each queue looked like (`/gpu/jobs/series`, once per
 * kind). The queues come from the jobs rather than the telemetry on purpose — a queue is a
 * fact about work waiting, and a machine with nothing to do reports no reading at all.
 *
 * @returns {Promise<void>}
 */
async function wirePoolUtilization() {
  const root = $('[data-pool-history]');
  if (!root) return;

  const RANGES = {
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
    '5h': { hours: 5, bucket: 'minute', label: 'the last 5 hours' },
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
  };

  const lines = Object.fromEntries($$('[data-pool-line]', root).map((l) => [l.dataset.poolLine, l]));
  const areas = Object.fromEntries($$('[data-pool-area]', root).map((a) => [a.dataset.poolArea, a]));
  const buttons = $$('[data-pool-range]', root);
  const chart = $('.pool-chart', root);
  const times = Object.fromEntries($$('[data-pool-time]', root).map((t) => [t.dataset.poolTime, t]));

  const box = chart ? chart.querySelector('svg')?.getAttribute('viewBox')?.split(/\s+/) : null;
  const width = box ? Number(box[2]) : 760;
  const floor = 196;
  const top = 28;

  const x = (i, n) => 44 + (width - 70) * i / Math.max(1, n - 1);
  const y = (v, max) => floor - (floor - top) * (v / Math.max(1, max));
  const pathOf = (values, max) => values
    .map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length).toFixed(1)},${y(v, max).toFixed(1)}`).join(' ');
  const areaOf = (values, max) => `${pathOf(values, max)} L${x(values.length - 1, values.length).toFixed(1)},${floor} L44,${floor} Z`;

  const clock = (iso) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const blank = () => {
    [...Object.values(lines), ...Object.values(areas)].forEach((n) => n && n.removeAttribute('d'));
    Object.values(times).forEach((t) => { t.textContent = ''; });
  };

  async function choose(next) {
    buttons.forEach((b) => {
      const on = b.dataset.poolRange === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const { hours, bucket, label } = RANGES[next] || RANGES['5h'];
    const until = new Date();
    const span = {
      since: new Date(until.getTime() - hours * 3600e3).toISOString(),
      until: until.toISOString(),
      bucket,
    };

    try {
      const [gpu, inference, training] = await Promise.all([
        window.MarpApi.gpuSeries(span),
        window.MarpApi.jobSeries({ ...span, kind: 'inference' }),
        window.MarpApi.jobSeries({ ...span, kind: 'training' }),
      ]);

      const points = gpu.points || [];
      const waitingAt = (series) => new Map((series.points || []).map((p) => [String(p.at), p.waiting || 0]));
      const queuedInference = waitingAt(inference);
      const queuedTraining = waitingAt(training);

      if (!points.length || !points.some((p) => p.machines > 0)) {
        blank();
        root.classList.add('is-quiet');
        if (chart) {
          chart.setAttribute('aria-label', `No GPU readings in ${label}. A machine reports while it `
            + 'works, so an idle pool records nothing.');
        }
        return;
      }

      root.classList.remove('is-quiet');

      const samples = {
        computeUsed: points.map((p) => p.avg_utilization_percent || 0),
        vramUsed: points.map((p) => p.avg_memory_percent_used || 0),
        queueInference: points.map((p) => queuedInference.get(String(p.at)) || 0),
        queueTraining: points.map((p) => queuedTraining.get(String(p.at)) || 0),
      };

      const areaValues = {
        inference: points.map((p) => p.avg_inference_utilization_percent || 0),
        training: points.map((p) => p.avg_training_utilization_percent || 0),
      };

      /* Utilization is a percentage; a queue is a count, scaled to its own peak
         so a quiet queue does not flatten against a busy pool. */
      const maxQueue = Math.max(1, ...samples.queueInference, ...samples.queueTraining);

      if (lines.computeUsed) lines.computeUsed.setAttribute('d', pathOf(samples.computeUsed, 100));
      if (lines.vramUsed) lines.vramUsed.setAttribute('d', pathOf(samples.vramUsed, 100));
      if (lines.queueInference) lines.queueInference.setAttribute('d', pathOf(samples.queueInference, maxQueue));
      if (lines.queueTraining) lines.queueTraining.setAttribute('d', pathOf(samples.queueTraining, maxQueue));

      for (const [name, node] of Object.entries(areas)) {
        if (node && areaValues[name]) node.setAttribute('d', areaOf(areaValues[name], 100));
      }

      if (times.start) times.start.textContent = clock(points[0].at);
      if (times.middle) times.middle.textContent = clock(points[Math.floor(points.length / 2)].at);
      if (times.end) times.end.textContent = 'Now';

      const last = points.at(-1);

      if (chart) {
        chart.setAttribute('aria-label', `GPU pool over ${label}: `
          + `${Math.round(last.avg_utilization_percent || 0)} percent compute and `
          + `${Math.round(last.avg_memory_percent_used || 0)} percent VRAM across `
          + `${last.machines} reporting ${last.machines === 1 ? 'machine' : 'machines'}, `
          + `${samples.queueInference.at(-1)} inference and ${samples.queueTraining.at(-1)} training jobs queued`);
      }
    } catch (error) {
      blank();
      if (chart) chart.setAttribute('aria-label', `Could not load pool utilization (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.poolRange)));
  await choose('5h');
}

function batchesWithIssues(jobs) {
  const seen = new Map();

  for (const job of jobs) {
    if (!job.batch_id) continue;
    const found = seen.get(job.batch_id) || { ok: false, bad: false };
    if (job.state === 'succeeded') found.ok = true;
    if (job.state === 'failed' || job.state === 'expired') found.bad = true;
    seen.set(job.batch_id, found);
  }

  const issues = new Set();
  for (const [id, { ok, bad }] of seen) if (ok && bad) issues.add(id);
  return issues;
}

/**
 * The Progress cell.
 *
 * **Null is not zero.** A job with no heartbeat yet has no measurement, and a
 * 0% bar would claim one, so it draws a dash. Required by `DESIGN.md` since
 * #104 measured that progress is legitimately null before the first heartbeat.
 *
 * @param {Object} job - A job row.
 * @param {string} state - The design state, which colours the fill.
 * @returns {{html: string, sort: number}}
 */
function progressCell(job, state) {
  if (job.progress_done === null || !job.progress_total) {
    return { html: '<span class="dash">&mdash;</span>', sort: -1 };
  }

  const pct = Math.round((job.progress_done / job.progress_total) * 100);
  const counts = `${job.progress_done.toLocaleString()} of ${job.progress_total.toLocaleString()} ${job.progress_unit || ''}`.trim();

  return {
    sort: pct,
    html: `<span class="prog" data-state="${state}" title="${counts}">`
      + `<span class="bar" role="progressbar" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>`
      + `<span class="pct">${pct}%</span></span>`,
  };
}

/**
 * One job, reduced to what the table shows and sorts on.
 *
 * Separate from the rendering because sorting compares *values*: a sort that
 * reads rendered cells can only order the page it can see, and this screen
 * pages.
 *
 * @param {Object} job - A job from `GET /gpu/jobs`.
 * @param {Set<string>} issueBatches - Batches that finished with issues.
 * @returns {Object} The view model.
 */
/**
 * Sessions by id, so a job's `session_id` can become a dive and a line.
 *
 * Fetched once and kept, rather than per job: `GET /gpu/jobs` hands back fifty rows that
 * between them name a handful of sessions, and resolving each one separately would be the
 * same mistake the Progress column was built to avoid.
 *
 * @type {Map<number, Object>}
 */
const SESSIONS = new Map();

/**
 * People by id, so a job's `created_by` can become a name.
 *
 * Same reason as {@link SESSIONS}: the job carries an id and the name lives elsewhere. Null
 * is normal and means an application token submitted the job rather than a person, which is
 * most of them, so the screens say that rather than showing a blank.
 *
 * @type {Map<number, Object>}
 */
const USERS = new Map();

/** Kind to its icon and its label. @type {Object} */
/** `leased` is a lease; `running` is what an operator calls it. @type {Object} */
const JOB_STATE_LABEL = {
  queued: ['queued', 'Queued'],
  leased: ['running', 'Running'],
  succeeded: ['done', 'Done'],
  failed: ['failed', 'Failed'],
  cancelled: ['cancelled', 'Cancelled'],
  expired: ['expired', 'Expired'],
};

/** Sort rank for the Status column: what needs attention first. @type {Object} */
const JOB_STATE_RANK = { running: 0, queued: 1, issues: 2, failed: 3, expired: 4, cancelled: 5, done: 6 };

/** Kind to its icon and its label. @type {Object} */
const JOB_KIND_LABEL = {
  inference: ['inference', 'Inference'],
  training: ['training', 'Training'],
  tracking: ['inference', 'Tracking'],
  diagnostic: ['jobs', 'Diagnostic'],
  /* A dataset build is a `gpu_jobs` row that no GPU touches (#268). Absent from here it
     fell through to the fallback below and was drawn as *Inference* -- not "unknown",
     but a confident wrong answer, which is how Isaac found it: a build of his named
     test2 running on the Dashboard as an inference job. */
  dataset_build: ['datasets', 'Dataset build'],
};

/**
 * Fill {@link SESSIONS}. Safe to call on every screen; it asks once.
 *
 * A failure here is deliberately swallowed. Sessions are what turn an id into a name, and a
 * screen that refuses to draw its jobs because it could not pretty-print their scope has
 * made a bad trade.
 *
 * @returns {Promise<void>}
 */
let sessionsAsked = null;
function loadSessions() {
  if (!sessionsAsked) {
    const sessions = (window.MarpApi?.listSessions?.() || Promise.resolve([]))
      .then((rows) => {
        for (const row of rows || []) {
          const id = row.session_id ?? row.id;
          if (id !== undefined) SESSIONS.set(Number(id), row);
        }
      })
      .catch(() => { /* scope falls back to the id; the jobs still draw */ });

    const users = (window.MarpApi?.listUsers?.() || Promise.resolve([]))
      .then((rows) => {
        for (const row of rows || []) {
          const id = row.user_id ?? row.id;
          if (id !== undefined) USERS.set(Number(id), row);
        }
      })
      .catch(() => { /* a submitter falls back to the id */ });

    sessionsAsked = Promise.all([sessions, users]);
  }

  return sessionsAsked;
}

/**
 * The session a job spec refers to, as a row.
 *
 * `spec.session` takes two forms. A job submitted against an existing session
 * carries `{session_id}` alone -- the dive and line are columns on the session
 * row -- while one submitted for a session that does not exist yet carries
 * `{project_id, dive, line, type}` inline, because the ingest creates it
 * afterwards. The fixtures only ever produced the second, so the Scope column
 * worked against them and read "No session" for every real job in MARP.
 *
 * A training job has no session at all, so the empty object is a real answer
 * rather than a failure -- reading through it is what blanked the whole History
 * screen.
 *
 * SESSIONS is filled once per screen by `loadSessions`. A miss leaves the id
 * visible rather than blank: "Session 755" is a thing somebody can look up, and
 * "No session" was a lie about a job that has one.
 *
 * @param {Object} spec - A job's `spec`.
 * @returns {Object} The session row, the inline session, or `{}`.
 */
function sessionFor(spec) {
  const asked = (spec || {}).session;
  const named = asked && asked.session_id !== undefined
    ? SESSIONS.get(Number(asked.session_id))
    : null;
  return named || asked || {};
}

function jobView(job, issueBatches) {
  const spec = job.spec || {};
  const session = sessionFor(spec);
  /* **An unknown kind says so.** Falling back to Inference meant every kind added after
     this map was written was drawn as inference, confidently and wrongly, until somebody
     noticed. A kind nobody has given a label to is a gap in this file, and the screen
     naming it is how it gets found. */
  const [kindIcon, kindLabel] = JOB_KIND_LABEL[job.kind] || ['jobs', job.kind || 'Unknown'];

  let [state, label] = JOB_STATE_LABEL[job.state] || ['queued', job.state];

  /* A succeeded piece of a batch that did not all succeed is drawn as the
     batch's state, because the batch is the thing an operator acts on. */
  if (job.state === 'succeeded' && job.batch_id && issueBatches.has(job.batch_id)) {
    state = 'issues';
    label = 'Issues';
  }

  /* MARP has no name for a job: `GpuJobSpec` carries engine, model, video,
     session, range, params and reduction and nothing else. The title is
     composed from the video being processed, which is the one human-readable
     thing in there. */
  /* The name a person gave it wins. MARP composes no fallback -- a name it
     invented would be indistinguishable from a chosen one -- so composing one
     is this screen's job, and it has two more things to try.

     The extension strip only applies to a source name, and its `.` is escaped.
     It used to be `/.[a-z0-9]+$/`, which matches *any* character before the
     trailing run, so `Job 19343` lost ` 19343` and every unnamed job on the
     screen was titled "Job". Invisible against the fixtures, because every
     fixture job had a source name ending in `.mp4`. */
  const source = spec.video && spec.video.source_name;
  const title = job.name
    || (source ? source.replace(/\.[a-z0-9]+$/i, '') : `Job ${job.id}`);

  const measured = job.progress_done !== null && job.progress_total;

  return {
    job,
    spec,
    session,
    state,
    label,
    title,
    kindIcon,
    kindLabel,
    model: (spec.model && spec.model.name) || 'No model',
    reduction: spec.reduction ? `${spec.reduction.name} v${spec.reduction.version}` : '',
    /* -1 rather than 0 for "never measured", so an unstarted job sorts below a
       job genuinely sitting at zero instead of tying with it. */
    pct: measured ? Math.round((job.progress_done / job.progress_total) * 100) : -1,
  };
}

/**
 * A view model, as a table row.
 *
 * @param {Object} view - From `jobView`.
 * @returns {string} A `<tr>`.
 */
function rowFor(view) {
  const { job, spec, session, state } = view;

  const scope = session.dive
    ? `Dive ${session.dive}${session.line ? ` &middot; Line ${session.line}` : ''}`
    : (spec.session && spec.session.session_id !== undefined
      ? `Session ${spec.session.session_id}`
      : 'No session');
  const frames = spec.range
    ? `${session.type || 'Unassigned'} &middot; frames ${spec.range.start_frame.toLocaleString()}-${spec.range.end_frame.toLocaleString()}`
    : '';

  const progress = progressCell(job, state);
  const when = new Date(job.created_at);
  const hhmm = when.toTimeString().slice(0, 5);
  const date = when.toISOString().slice(0, 10);

  const live = job.state === 'queued' || job.state === 'leased';
  const actions = live
    ? '<button class="btn sm icon" aria-label="Cancel"><svg class="ico sm"><use href="#i-stop"/></svg></button>'
    : '<button class="btn sm icon" aria-label="Open"><svg class="ico sm"><use href="#i-right"/></svg></button>';

  /**
   * Which machine ran this job.
   *
   * **Past tense, and that is the whole point.** The mockup carried a present-tense
   * `workers.using`, which reads 0 the moment a job finishes -- so every completed row said
   * nothing had run it, and `DESIGN.md` gap 17 recorded that as "not recorded anywhere". It
   * always was: `gpu_job_attempts.worker_id` names the machine for every attempt, and the
   * job list carries it as of #104.
   *
   * A job tried on more than one machine says so, because that is the case worth seeing:
   * it usually means the first machine failed it.
   *
   * @param {Object} row - A job from the list.
   * @returns {string} The cell's contents.
   */
  function workerCell(row) {
    if (!row.worker_name && !row.worker_id) {
      // Never leased. Distinct from "ran and we lost the record".
      return '<span class="dash" title="Never leased to a machine">&mdash;</span>';
    }

    const name = row.worker_name || `Worker ${row.worker_id}`;
    const retried = Number(row.workers_used) > 1
      ? `<span class="b">${row.workers_used} machines</span>`
      : '';

    return `<span class="two"><span class="a">${name}</span>${retried}</span>`;
  }

  /* The expanded detail is built by a decorator that reads the row out of the
     DOM rather than holding the job, so anything it needs and cannot scrape from
     a visible cell travels here. It used to invent these -- "itravers", "5 ·
     normal", "Up to 3 attempts", "heartbeat 4s ago" -- on every job. */
  return `<tr data-job="${job.id}"`
    + ` data-worker="${job.worker_name || (job.worker_id ? `Worker ${job.worker_id}` : '')}"`
    + ` data-workers-used="${job.workers_used ?? 0}"`
    + ` data-attempts="${job.attempts_made ?? 0}"`
    + ` data-max-attempts="${job.max_attempts ?? 0}"`
    + ` data-priority="${job.priority ?? 0}"`
    + ` data-by="${job.created_by ?? ''}"`
    /* **Which dataset a build built.** The Jobs detail shows job-level facts and the
       Datasets screen shows dataset-level ones, which is right -- but nothing said the
       two were about the same thing, so the screens read as though they disagreed. The
       id travels on the row because the detail is built from the row rather than from
       the job object. */
    + ` data-dataset="${job.kind === 'dataset_build' && job.spec && job.spec.dataset_id != null ? job.spec.dataset_id : ''}">`
    + `<td class="chk"><input class="chkbox" type="checkbox" aria-label="Select job ${job.id}"></td>`
    + `<td class="jname"><span class="name"><svg class="ico ${view.kindIcon}"><use href="#i-${view.kindIcon}"/></svg><span class="t">${view.title}</span></span></td>`
    + `<td class="jtype"><span class="tag ${view.kindIcon}">${view.kindLabel}</span></td>`
    + `<td class="jscope"><span class="two"><span class="a">${scope}</span><span class="b">${frames}</span></span></td>`
    + `<td class="jmodel"><span class="two"><span class="a">${view.model}</span><span class="b">${view.reduction}</span></span></td>`
    + `<td class="jstatus" data-sort="${JOB_STATE_RANK[state]}"><span class="st" data-state="${state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="jprog" data-sort="${progress.sort}">${progress.html}</td>`
    + `<td class="jworker" data-sort="${job.worker_name || ''}">${workerCell(job)}</td>`
    + `<td class="jtime" data-sort="${job.created_at}"><span class="two"><span class="a">${hhmm}</span><span class="b">${date}</span></span></td>`
    + `<td class="jacts"><span>${actions}</span></td>`
    + '</tr>';
}

/**
 * The four headline cards, counted from the same data as the table.
 *
 * **Counted over a fetched window, because the route cannot be asked.**
 * `GET /gpu/jobs` filters on `state`, `kind` and `batch_id` and nothing else;
 * there is no date parameter, so *Completed today* cannot be a query and has to
 * be a count of rows pulled back and filtered here. Fine at 420 jobs, not fine
 * at the scale #104 assumes. Recorded as gap 24.
 *
 * Drawn from one fetch with the table, because cards disagreeing with the rows
 * beneath them is worse than either of them being wrong.
 *
 * @param {Object[]} jobs - The window of jobs to count over.
 */
function renderJobsSummary(jobs) {
  const issues = batchesWithIssues(jobs);

  const isIssue = (job) => job.state === 'succeeded' && job.batch_id && issues.has(job.batch_id);
  const running = jobs.filter((j) => j.state === 'leased');
  const queued = jobs.filter((j) => j.state === 'queued');

  /* "Today" is measured against the newest job in the corpus rather than the
     reader's clock: the data layer's present is fixed so that two people see
     the same screen, and a card reading the wall clock would undo that. */
  const newest = jobs.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  /* Local midnight, not a rolling day from the newest row. */
  const today = new Date().setHours(0, 0, 0, 0);
  const done = jobs.filter((j) => j.state === 'succeeded'
    && j.finished_at && Date.parse(j.finished_at) >= today);

  /* Scoped to the same day as Completed. Counting every failure in the window
     put 107 beside 22 completed, which compares a fortnight against a day. */
  const attention = jobs.filter((j) => (j.state === 'failed' || j.state === 'expired' || isIssue(j))
    && j.finished_at && Date.parse(j.finished_at) >= today);

  const byKind = (rows, kind) => rows.filter((j) => j.kind === kind).length;

  const cards = {
    running: [running.length, [[byKind(running, 'inference'), 'inference'], [byKind(running, 'training'), 'training']]],
    queued: [queued.length, [[byKind(queued, 'inference'), 'inference'], [byKind(queued, 'training'), 'training']]],
    done: [done.length, [[done.filter((j) => !isIssue(j)).length, 'clean'], [done.filter(isIssue).length, 'with issues']]],
    attention: [attention.length, [[attention.filter((j) => !isIssue(j)).length, 'failed or expired'], [attention.filter(isIssue).length, 'with issues']]],
  };

  for (const [priority, [total, parts]] of Object.entries(cards)) {
    const card = $(`.stat[data-job-priority="${priority}"]`);
    if (!card) continue;

    const num = $('.stat-num', card);
    if (num) num.textContent = String(total);

    /* The breakdown is rebuilt rather than patched. A card keeping a stale
       "3 builds" beside a fresh total would be the most believable kind of
       wrong -- and dataset builds are gap 19, not a MARP job kind at all, so
       that sub-count is gone rather than zero. */
    const sub = $('.stat-sub', card);
    if (sub) sub.innerHTML = parts.map(([n, label]) => `<span><b>${n}</b> ${label}</span>`).join('');
  }

  /* The Job status donut. Five arcs, not six: the sixth was *building datasets*
     and a dataset build is not a job (gap 19), so the arc is gone from the
     markup rather than drawn at zero, which would leave a segment that can
     never grow. */
  const donutParts = [
    ['inference', byKind(running, 'inference') + byKind(running, 'tracking'), 'Running inference'],
    ['training', byKind(running, 'training'), 'Running training'],
    ['queued', queued.length, 'Queued'],
    ['done', done.length, 'Completed today'],
    ['attention', attention.length, 'Need attention'],
  ];
  const donutTotal = donutParts.reduce((sum, [, value]) => sum + value, 0) || 1;

  const donut = $('.job-donut svg');
  if (donut) {
    let offset = 0;
    for (const [cls, value] of donutParts) {
      const arc = $(`.donut-part.${cls}`, donut);
      if (!arc) continue;
      arc.setAttribute('pathLength', String(donutTotal));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, donutTotal - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    }
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(donutTotal);
  }

  const legend = $('.job-mix-key');
  if (legend) {
    legend.innerHTML = donutParts
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }
}

/**
 * The count, the "showing" line, the pager and the sort arrows.
 *
 * Every number here was written into the markup — `(69)`, `1-18 of 69`, a fixed
 * run of five page buttons — and every one of them was wrong the moment the
 * table stopped being those twenty rows.
 *
 * @param {number} total - Matching jobs.
 * @param {number} from - Zero-based index of the first row shown.
 * @param {number} shown - How many rows are on this page.
 * @param {number} pages - How many pages there are.
 */
function renderJobsHeaderState(total, from, shown, pages) {
  const count = $('.panel-hd .count');
  if (count) count.textContent = `(${total.toLocaleString()})`;

  const showing = $('.panel-ft > span');
  if (showing) {
    showing.innerHTML = shown
      ? `Showing <b class="strong">${(from + 1).toLocaleString()}&ndash;${(from + shown).toLocaleString()}</b> of ${total.toLocaleString()} jobs`
      : 'No jobs match these filters';
  }

  const pager = $('.panel-ft .pager');
  if (pager) {
    /* Rebuilt rather than patched: the markup held a fixed run of five, which
       is a lie about any list that is not exactly five pages long. */
    const buttons = [`<button aria-label="Previous page" data-jobs-page="${jobsQuery.page - 1}"${jobsQuery.page === 1 ? ' disabled' : ''}><svg class="ico sm"><use href="#i-left"/></svg></button>`];

    /* A window around the current page, so a hundred pages do not become a
       hundred buttons. */
    const first = Math.max(1, Math.min(jobsQuery.page - 2, pages - 4));
    for (let p = first; p <= Math.min(pages, first + 4); p++) {
      buttons.push(`<button data-jobs-page="${p}"${p === jobsQuery.page ? ' aria-current="page"' : ''}>${p}</button>`);
    }

    buttons.push(`<button aria-label="Next page" data-jobs-page="${jobsQuery.page + 1}"${jobsQuery.page >= pages ? ' disabled' : ''}><svg class="ico sm"><use href="#i-right"/></svg></button>`);
    pager.innerHTML = buttons.join('');
  }

  /* The arrow is drawn from `aria-sort`, so the accessible state and the drawn
     state cannot disagree -- `DESIGN.md`, Tables. */
  for (const th of $$('#jobs thead th.sortable')) {
    const key = [...th.classList].find((c) => JOBS_SORT_KEYS[c]);
    if (!key) continue;
    if (key === jobsQuery.sort.key) th.setAttribute('aria-sort', jobsQuery.sort.dir);
    else th.setAttribute('aria-sort', 'none');
  }

  /* **The phone's sort strip carries the state too.** Below 1050px the headers
     are gone and this strip is the only sort control there is, so it has to say
     which column is sorted and which way -- `data-direction` and `aria-pressed`,
     the same pair the shared sorter uses. Taking sorting away from that sorter
     left these buttons working but silent, and a control that reorders the
     table while claiming nothing is worse than one that does not work. */
  for (const control of $$('.jobs-sort-mobile [data-sort-column]')) {
    const key = JOBS_SORT_COLUMNS[Number(control.dataset.sortColumn)];
    const active = key === jobsQuery.sort.key;
    control.dataset.direction = active ? jobsQuery.sort.dir : 'none';
    control.setAttribute('aria-pressed', String(active));
  }
}

/**
 * What the Jobs screen is currently asking for.
 *
 * **Two of these are real query parameters and four are not**, which is the
 * whole shape of this screen's relationship with the API. `kind` and `state`
 * are sent to `GET /gpu/jobs`. Search, the time window, the sort column and the
 * derived *Issues* filter have no parameter to be sent in -- the route takes
 * `state`, `kind`, `batch_id`, `limit` and `offset` and nothing else -- so they
 * are applied here, over a window the route *can* be asked for. Gap 26 records
 * what that costs.
 *
 * @type {Object}
 */
const jobsQuery = {
  kind: '',
  state: '',
  issuesOnly: false,
  search: '',
  windowDays: 7,
  sort: { key: 'created_at', dir: 'descending' },
  page: 1,
  perPage: 18,
};

/** How each sortable column is ordered. Keyed by the header's class. */
const JOBS_SORT_KEYS = {
  hjob: (view) => view.title.toLowerCase(),
  htype: (view) => view.job.kind,
  hscope: (view) => `${view.session.dive || ''}${view.session.line || ''}`,
  hmodel: (view) => ((view.job.spec.model && view.job.spec.model.name) || '').toLowerCase(),
  hstatus: (view) => JOB_STATE_RANK[view.state],
  hprog: (view) => view.pct,
  hupd: (view) => view.job.created_at,
};

/** The column order the phone's sort strip uses. @type {string[]} */
const JOBS_SORT_COLUMNS = ['hjob', 'htype', 'hscope', 'hmodel', 'hstatus', 'hprog', 'hupd'];

/** The window the whole screen is drawn from, refetched only when the API query changes. */
let jobsWindow = null;

/**
 * Narrows, sorts and pages what came back, then draws it.
 *
 * Everything here happens after the fetch on purpose: the parts the route
 * cannot express are done in one place, so it stays obvious which is which.
 */
function applyJobsQuery() {
  const table = $('table#jobs');
  if (table) table.dataset.sortsItsOwnData = 'true';
  if (!table || !jobsWindow) return;

  const body = $('tbody', table);
  const columns = $$('thead th', table).length;
  const issues = batchesWithIssues(jobsWindow.jobs);
  const newest = jobsWindow.jobs.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  const since = newest - jobsQuery.windowDays * 86400000;

  /* One view per job, so sorting compares values rather than rendered cells.
     A sort that reads the DOM can only ever order the page it can see. */
  let views = jobsWindow.jobs.map((job) => {
    const view = jobView(job, issues);
    view.haystack = `${view.title} ${view.model} ${view.job.kind} ${view.label} ${view.session.dive || ''} ${view.session.line || ''}`.toLowerCase();
    return view;
  });

  if (jobsQuery.issuesOnly) views = views.filter((v) => v.state === 'issues');
  if (jobsQuery.search) views = views.filter((v) => v.haystack.includes(jobsQuery.search));
  views = views.filter((v) => Date.parse(v.job.created_at) >= since);

  const key = JOBS_SORT_KEYS[jobsQuery.sort.key] || JOBS_SORT_KEYS.hupd;
  const sign = jobsQuery.sort.dir === 'ascending' ? 1 : -1;
  views.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;
    return b.job.id - a.job.id;  /* the same id tie-breaker the route uses */
  });

  const total = views.length;
  const pages = Math.max(1, Math.ceil(total / jobsQuery.perPage));
  if (jobsQuery.page > pages) jobsQuery.page = pages;
  const from = (jobsQuery.page - 1) * jobsQuery.perPage;
  const shown = views.slice(from, from + jobsQuery.perPage);

  body.innerHTML = shown.length
    ? shown.map(rowFor).join('')
    : `<tr class="tblmsg"><td class="empty" colspan="${columns}">No jobs match these filters.</td></tr>`;

  renderJobsHeaderState(total, from, shown.length, pages);
  wireJobsOverview();
  wireSelection();
  applyTips();
}

/* ========================================================== training */

/* Training is two different things on one page, and only one of them has an
   API behind it.

   A **training job** is a `gpu_jobs` row with `kind: 'training'`, and the job
   list returns it like any other. A **training run** is the record of what that
   job produced -- epochs, losses, mAP, the model it made -- and
   `/v2/training_run` has only a `POST`. A run can be created and never listed,
   so the Training runs table, every epoch count and every mAP on this screen
   has no route to come from. Gap 28.

   So the overview, the recent-jobs table and the setup form's choices are real;
   the runs table stays fixture and says so. */

/** Nothing lists these. Distinct from a run that has no epochs yet. */
const NOT_LISTABLE = '<span class="dash" title="Training runs cannot be listed: /v2/training_run has only a POST, so epochs, losses and mAP exist in MARP but no route returns them (gap 28)">&mdash;</span>';

/**
 * Draws the Training overview and its recent jobs.
 *
 * @param {Object[]} jobs - Every job in the window.
 */
function renderTraining(jobs) {
  const mine = jobs.filter((j) => j.kind === 'training');
  const issues = batchesWithIssues(jobs);
  const views = mine.map((job) => jobView(job, issues));

  const newest = mine.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  /* Local midnight, not a rolling day from the newest row. */
  const today = new Date().setHours(0, 0, 0, 0);

  const running = views.filter((v) => v.state === 'running');
  const queued = views.filter((v) => v.state === 'queued');
  const done = views.filter((v) => v.state === 'done');
  /* Scoped to the day, as on Inference and Jobs, so the four read as one
     moment rather than three spans and a fortnight. */
  const attention = views.filter((v) => ['failed', 'expired', 'issues'].includes(v.state)
    && v.job.finished_at && Date.parse(v.job.finished_at) >= today);

  const cards = $$('.stat');
  const setCard = (card, num, parts) => {
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.textContent = String(num);
    const sub = $('.stat-sub', card);
    if (sub) sub.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  };

  /* The labels repeat across the two panels on this screen, so the cards are
     taken in order rather than by name -- the first four are the overview. */
  const weekAgo = newest - 7 * 86400000;
  const doneThisWeek = done.filter((v) => Date.parse(v.job.created_at) >= weekAgo).length;

  setCard(cards[0], running.length, [`${running.length} on GPUs`, 'in flight']);
  setCard(cards[1], queued.length, ['waiting for a worker', `${queued.length} to start`]);
  setCard(cards[2], done.length, [`${doneThisWeek} this week`, NOT_LISTABLE + ' versions']);
  setCard(cards[3], attention.length, [
    `${attention.filter((v) => v.state === 'failed').length} failed`,
    `${attention.filter((v) => v.state === 'expired').length} expired`,
  ]);

  /* The second row of cards belongs to the runs panel. Three of them are the
     same job counts; the fourth is a best mAP, which nothing serves. */
  setCard(cards[4], running.length, ['workers busy']);
  setCard(cards[5], done.length, [`${doneThisWeek} this week`]);
  setCard(cards[6], views.filter((v) => v.state === 'failed').length, ['in the window']);
  if (cards[7]) {
    const n = $('.stat-num', cards[7]);
    if (n) n.innerHTML = NOT_LISTABLE;
    const sub = $('.stat-sub', cards[7]);
    if (sub) sub.innerHTML = '<span>no route returns run metrics</span>';
  }

  const parts = [
    ['running', running.length, 'Running'],
    ['queued', queued.length, 'Queued'],
    ['done', done.length, 'Completed'],
    ['failed', attention.length, 'Need attention'],
  ];
  /* Two numbers, because they are two different things. `total` is how many jobs
     there are -- zero is an answer, and the middle of the ring reading "1" while
     every segment read 0 was this exact conflation. `scale` is what the arcs
     divide, and it cannot be zero or every dash is NaN. */
  const total = parts.reduce((sum, [, value]) => sum + value, 0);
  const scale = total || 1;

  const donut = $('.job-donut svg');
  if (donut) {
    const arcs = $$('.donut-part', donut);
    let offset = 0;
    arcs.forEach((arc, index) => {
      const value = parts[index] ? parts[index][1] : 0;
      arc.setAttribute('pathLength', String(scale));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, scale - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    });
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(total);
  }

  const legend = $('.job-mix-key');
  if (legend) {
    legend.innerHTML = parts
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }

  renderTrainingRecent(views);
}

/**
 * The recent training jobs table.
 *
 * Four of its eight columns are run facts rather than job facts -- the dataset
 * it trained on, the model it produces, how many epochs it reached and its best
 * mAP -- and none of those can be fetched. They draw a dash with the reason.
 *
 * @param {Object[]} views - Training job views.
 */
function renderTrainingRecent(views) {
  const table = $('.training-table');
  if (!table) return;

  const body = $('tbody', table);
  const rank = { running: 0, issues: 1, failed: 2, expired: 3, queued: 4, cancelled: 5, done: 6 };
  const shown = views
    .slice()
    .sort((a, b) => (rank[a.state] - rank[b.state])
      || (Date.parse(b.job.updated_at) - Date.parse(a.job.updated_at)))
    .slice(0, 3);

  const heading = $('.training-recent .panel-hd h2') || $$('.panel-hd h2').find((h) => /Recent training/.test(h.textContent));
  if (heading) heading.textContent = `Recent training jobs (${views.length.toLocaleString()})`;

  body.innerHTML = shown.map((view) => {
    const { job } = view;
    const started = new Date(job.created_at);
    const tookMs = Math.max(0, Date.parse(job.updated_at) - Date.parse(job.created_at));
    const terminal = ['done', 'issues', 'failed', 'cancelled', 'expired'].includes(view.state);

    return `<tr data-job="${job.id}">`
      + `<td class="jname"><span class="name"><svg class="ico training"><use href="#i-training"/></svg><span class="t">${view.title}</span></span></td>`
      + `<td class="jdset">${NOT_LISTABLE}</td>`
      + `<td class="jmakes">${NOT_LISTABLE}</td>`
      + `<td class="jstatus" data-sort="${JOB_STATE_RANK[view.state]}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
      + `<td class="jepochs num">${NOT_LISTABLE}</td>`
      + `<td class="jmap num">${NOT_LISTABLE}</td>`
      + `<td class="jtime" data-sort="${job.created_at}"><span class="two"><span class="a">${started.toTimeString().slice(0, 5)}</span><span class="b">${started.toISOString().slice(0, 10)}</span></span></td>`
      + `<td class="jtook num" data-sort="${tookMs}">${terminal ? tookText(tookMs) : '<span class="dash">&mdash;</span>'}</td>`
      + '</tr>';
  }).join('');
}

/**
 * Puts the real registry and the real datasets into the setup form.
 *
 * Every one of these selectors was written out by hand: base models that are
 * not in `ml_models`, datasets that are not in `dataset`. A run configured from
 * them names things MARP cannot resolve.
 *
 * @param {Object[]} models - From `GET /api/v2/ml_models`.
 * @param {Object[]} datasets - From `GET /api/v2/dataset`.
 */
/**
 * The upstream checkpoints, by task.
 *
 * YOLO's own starting weights. They are not MARP models, are deliberately not in the
 * registry, and are owned here rather than left in the markup because the markup may state
 * no values -- and because losing them is exactly what happened when the options were
 * stripped out from under a renderer that read them back.
 *
 * @constant
 * @type {Object<string, string>}
 */
const UPSTREAM_CHECKPOINTS = {
  'base-det': 'YOLO detection — upstream checkpoint',
  'base-cls': 'YOLO classification — upstream checkpoint',
  'base-seg': 'YOLO segmentation — upstream checkpoint',
};

function fillTrainingChoices(models, datasets) {
  /* **Not filtered by status, and not filtered by task, because neither column
     means what this screen assumed.**

     Measured against MARP: thirteen models carry `model_type: "detection"` with
     `status: "active"`, and two carry `model_type: "YOLOv8"` with `status:
     "trained"`. So `model_type` holds a task on some rows and an architecture on
     others, and `status` holds `active`, which is not one of the four values the
     generated contract declares. Filtering on either one hid every model MARP
     has: the two trained ones are "YOLOv8" and matched no task, and the thirteen
     detection ones are "active" and matched no status.

     Every model is offered, with whatever `model_type` says beside it, until
     somebody settles what those two columns mean. Showing fifteen models and
     letting a person choose is honest; showing none because a filter the data
     does not support found nothing is not. */

  /* **This used to find its targets by reading the fake data.** It decided a
     select was a base-model picker when its options matched
     `/^MARP-[\w-]+ — |upstream/` -- that is, when they were the invented names
     the mockup shipped. It worked, and only while the fiction was there:
     stripping those options, to stop the screen stating models MARP does not
     have, turned this into a function that matched nothing and filled nothing.

     The markup now says which selects a renderer owns, with `data-fills`. A mark
     is a statement somebody can check; a pattern that recognises last year's
     placeholder text is a guess that happens to be right. */
  const put = (id, options, empty) => {
    const select = $(`[data-fills="${id}"]`);
    if (!select) return;

    const upstream = UPSTREAM_CHECKPOINTS[id]
      ? [`<option>${UPSTREAM_CHECKPOINTS[id]}</option>`] : [];

    select.innerHTML = (options.length ? options : [`<option value="">${empty}</option>`])
      .concat(upstream).join('');
  };

  /* The type is shown rather than filtered on, so a person can see that one
     model says "detection" and another says "YOLOv8" and judge for themselves. */
  const everyModel = models.map((m) => `<option value="${m.id}">${m.name}`
    + `${m.model_type ? ` — ${m.model_type}` : ''}</option>`);

  put('base-det', everyModel, 'No model in the registry');
  put('base-cls', everyModel, 'No model in the registry');
  put('base-seg', everyModel, 'No model in the registry');

  const datasetOptions = datasets.map((d) => `<option value="${d.id}">${d.name}</option>`);
  for (const id of ['dataset-det', 'dataset-cls', 'dataset-seg']) {
    put(id, datasetOptions, 'No dataset saved in MARP');
  }
}

/**
 * Fills the Training screen from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderTrainingScreen() {
  if (document.body.dataset.screen !== 'training' || !window.MarpApi) return;

  try {
    const [jobs, models, datasets] = await Promise.all([
      loadSessions().then(() => window.MarpApi.listJobs({ limit: 500 })),
      window.MarpApi.listModels(),
      window.MarpApi.listDatasets(),
    ]);

    renderTraining(jobs.jobs);
    fillTrainingChoices(models, datasets);
    markTrainingRunsUnbacked();
  } catch (error) {
    const body = $('.training-table tbody');
    if (body) {
      body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="8">Could not load training jobs (${error.status || 'no answer'}).</td></tr>`;
    }
  }
}

/**
 * Says, on the Training runs panel itself, that nothing serves it.
 *
 * The table is left as it is -- it is the designed contract for a run record,
 * and deleting it would lose that -- but a reader has to be able to tell it
 * apart from the tables above it, which are real.
 */
function markTrainingRunsUnbacked() {
  const heading = $$('.panel-hd h2').find((h) => /^Training runs/.test(h.textContent.trim()));
  const header = heading && heading.closest('.panel-hd');
  if (!header || $('.unbacked-note', header)) return;

  const note = document.createElement('p');
  note.className = 'unbacked-note muted';
  note.textContent = 'Design data. /v2/training_run has only a POST, so no route returns a run, '
    + 'its epochs or its metrics (gap 28).';
  header.appendChild(note);
}


/* ========================================================= inference */

/* Inference is the GPU job list seen through one kind. Its cards, its donut and
   its recent-jobs table are all `GET /gpu/jobs` narrowed to `inference` and
   `tracking` -- tracking belongs here because it is the same pipeline with the
   reduction left on, which is why the submission form offers one choice (R30).

   Two columns on this table have no source and already said so before anything
   was wired: **Detections** is gap 11 -- the ingest writes observations and
   nothing rolls the count back up to the job -- and the throughput graph is
   gap 18. */

/** The job kinds this screen is about. @type {string[]} */
const INFERENCE_KINDS = ['inference', 'tracking'];

/**
 * The Inference screen's video picker, against Jellyfin's own library.
 *
 * Three columns that were typed into the markup -- `CAMPA2024 · 20 dives`,
 * `20240727_141923_Fwd.mp4 · 00:00:55` and eight more like it. None of those filenames was
 * a real one, and the dive counts were invented, on a screen whose whole job is choosing
 * which real video to run against.
 *
 * It is a drill-down because Jellyfin is one: `/jellyfin/libraries` gives the project
 * folders, and `/jellyfin/items/:id/children` gives whatever is inside any of them. A
 * library's children are dives; a dive's children are videos. The same call does both.
 *
 * The thumbnails were already real — the markup pointed `<img>` at
 * `/jellyfin/items/:id/images/Primary` with a genuine item id — which is why they looked
 * right while every name beside them was fiction.
 *
 * @returns {Promise<void>}
 */
async function wireVideoPicker() {
  const projects = $('[data-fills="jf-projects"]');
  const dives = $('[data-fills="jf-dives"]');
  const videos = $('[data-fills="jf-videos"]');
  if (!projects || !dives || !videos) return;

  const projectsLabel = $('[data-fills="jf-projects-label"]');
  const divesLabel = $('[data-fills="jf-dives-label"]');
  const count = $('[data-fills="jf-count"]');

  /** Jellyfin counts in ten-millionths of a second. */
  const duration = (ticks) => {
    if (!ticks) return '';
    const total = Math.round(ticks / 10000000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const escape = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  /** Which boxes are ticked in a menu, as [{id, name}]. */
  const chosen = (menu) => [...menu.querySelectorAll('input:checked')]
    .map((box) => ({ id: box.dataset.id, name: box.dataset.name }));

  /** A menu of checkboxes. The first is ticked so the screen opens on something. */
  const menu = (items, extra) => items.map((item, index) =>
    `<label><input type="checkbox" data-id="${escape(item.id)}" data-name="${escape(item.name)}"`
    + `${index === 0 ? ' checked' : ''}>${escape(item.name)}`
    + `${extra(item) ? ` <small>${extra(item)}</small>` : ''}</label>`).join('');

  const say = (node, items) => {
    if (!node) return;
    node.textContent = items.length === 0 ? 'None'
      : (items.length === 1 ? items[0].name : `${items.length} selected`);
  };

  /** Render the videos of whatever dives are ticked. */
  async function showVideos() {
    const picked = chosen(dives);
    say(divesLabel, picked);

    if (!picked.length) {
      videos.innerHTML = '<p class="nodata">Choose a dive to see its videos.</p>';
      if (count) count.textContent = 'No dive selected';
      return;
    }

    videos.innerHTML = '<p class="nodata">Loading videos&hellip;</p>';

    try {
      const lists = await Promise.all(picked.map((d) => window.MarpApi.listVideoChildren(d.id)));
      /* Only playable items: a dive folder can hold stills and sidecars, and a
         picker that offers a .srt as something to run inference on is lying. */
      /* The dive each file came from, carried on the file. A video's own record
         does not name its dive -- the folder does -- and the run plan's target
         line needs it, so it is stamped here rather than parsed back out of the
         path later. */
      const files = lists.flatMap((list, index) => (list || [])
        .filter((item) => !item.isFolder)
        .map((item) => ({ ...item, dive: picked[index]?.name || '' })));

      if (count) {
        count.innerHTML = `<b>${files.length} video${files.length === 1 ? '' : 's'}</b>`
          + ` in ${picked.length} selected dive${picked.length === 1 ? '' : 's'}`;
      }

      videos.innerHTML = files.length ? files.map((file, index) => {
        const when = duration(file.runtimeTicks);
        return `<article class="video-choice${index === 0 ? ' is-selected' : ''}" data-video-choice`
          + ` data-video-id="${escape(file.id)}" data-video-dive="${escape(file.dive || '')}">`
          + `<label class="video-select"><input type="checkbox"${index === 0 ? ' checked' : ''} aria-label="Select ${escape(file.name)}"></label>`
          + `<div class="video-thumb"><img loading="lazy" src="/api/v2/jellyfin/items/${encodeURIComponent(file.id)}/images/Primary" alt="${escape(file.name)}"></div>`
          + `<div class="video-meta"><b>${escape(file.name)}</b>`
          + `<span class="faint">${escape(file.path || '')}${when ? ` &middot; ${when}` : ''}</span></div>`
          + '</article>';
      }).join('') : '<p class="nodata">That dive holds no video files.</p>';
    } catch (error) {
      videos.innerHTML = `<p class="nodata">Could not reach the video library (${error.status || 'no answer'}).</p>`;
      if (count) count.textContent = '';
    }
  }

  /** Render the dives of whatever projects are ticked, then their videos. */
  async function showDives() {
    const picked = chosen(projects);
    say(projectsLabel, picked);

    if (!picked.length) {
      dives.innerHTML = '';
      return showVideos();
    }

    try {
      const lists = await Promise.all(picked.map((p) => window.MarpApi.listVideoChildren(p.id)));
      const folders = lists.flat().filter((item) => item.isFolder);
      dives.innerHTML = menu(folders, (f) => f.childCount ? `${f.childCount} items` : '');
    } catch (error) {
      dives.innerHTML = `<label class="nodata">Could not load dives (${error.status || 'no answer'})</label>`;
    }

    return showVideos();
  }

  try {
    const libraries = await window.MarpApi.listVideoLibraries();
    projects.innerHTML = libraries.length
      ? menu(libraries, (l) => l.childCount ? `${l.childCount} dives` : '')
      : '<label class="nodata">The video library is empty</label>';
  } catch (error) {
    projects.innerHTML = `<label class="nodata">Could not reach the video library (${error.status || 'no answer'})</label>`;
    if (count) count.textContent = '';
    return;
  }

  /* Delegated for the same reason the expanders are: these menus are replaced
     whenever a level above them changes. */
  projects.addEventListener('change', showDives);
  dives.addEventListener('change', showVideos);

  await showDives();
}

/**
 * Draws the Inference overview and its recent jobs.
 *
 * @param {Object[]} jobs - Every job in the window.
 */
function renderInference(jobs) {
  const mine = jobs.filter((j) => INFERENCE_KINDS.includes(j.kind));
  const issues = batchesWithIssues(jobs);
  const views = mine.map((job) => jobView(job, issues));

  const running = views.filter((v) => v.state === 'running');
  const queued = views.filter((v) => v.state === 'queued');
  const newest = mine.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  /* Local midnight, not a rolling day from the newest row. */
  const today = new Date().setHours(0, 0, 0, 0);
  const done = views.filter((v) => v.state === 'done'
    && v.job.finished_at && Date.parse(v.job.finished_at) >= today);

  /* **Scoped to the same day as Completed.** Unscoped this counted every
     failure in the fortnight -- 85 against 13 completed -- and the donut below
     then composed four numbers measured over different spans, which makes a
     shape rather than a fact. A job that failed last week has not stopped
     needing attention; this card is about today, beside the other three. */
  const attention = views.filter((v) => ['failed', 'expired', 'issues'].includes(v.state)
    && v.job.finished_at && Date.parse(v.job.finished_at) >= today);

  const byLabel = {};
  for (const card of $$('.stat')) {
    const label = $('.stat-lab', card);
    if (label) byLabel[label.textContent.trim()] = card;
  }
  const set = (label, num, parts) => {
    const card = byLabel[label];
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.textContent = String(num);
    const sub = $('.stat-sub', card);
    if (sub) sub.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  };

  /* How many machines are carrying this work, counted from the jobs rather
     than guessed: a job in flight names the worker holding it only on its
     detail, but the pool view and the job list agree on how many are running. */
  const frames = (rows) => rows.reduce((sum, v) => sum + (v.job.spec.range ? v.job.spec.range.end_frame : 0), 0);
  const big = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M frames` : `${Math.round(n / 1000)}k frames`);

  set('Running inference', running.length, [big(frames(running)), 'in flight']);
  set('Queued inference', queued.length, [big(frames(queued)), 'waiting']);
  set('Completed today', done.length, [big(frames(done)), `${done.filter((v) => v.state === 'done').length} clean`]);
  set('Needs attention', attention.length, [
    `${attention.filter((v) => v.state === 'failed').length} failed`,
    `${attention.filter((v) => v.state === 'issues').length} with issues`,
  ]);

  const parts = [
    ['running', running.length, 'Running'],
    ['queued', queued.length, 'Queued'],
    ['done', done.length, 'Completed today'],
    ['failed', attention.length, 'Need attention'],
  ];
  /* Two numbers, because they are two different things. `total` is how many jobs
     there are -- zero is an answer, and the middle of the ring reading "1" while
     every segment read 0 was this exact conflation. `scale` is what the arcs
     divide, and it cannot be zero or every dash is NaN. */
  const total = parts.reduce((sum, [, value]) => sum + value, 0);
  const scale = total || 1;

  const donut = $('.job-donut svg');
  if (donut) {
    const arcs = $$('.donut-part', donut);
    let offset = 0;
    arcs.forEach((arc, index) => {
      const value = parts[index] ? parts[index][1] : 0;
      arc.setAttribute('pathLength', String(scale));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, scale - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    });
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(total);

    /* The ring is `aria-hidden`, so this label is the only thing a screen reader
       gets. It was markup reading "30 inference jobs ... 4 running", which stayed
       put while the ring beside it moved. */
    donut.closest('.job-donut')?.setAttribute('aria-label',
      `${total} inference ${total === 1 ? 'job' : 'jobs'} represented: `
      + parts.map(([, value, text]) => `${value} ${text.toLowerCase()}`).join(', '));
  }

  const legend = $('.job-mix-key');
  if (legend) {
    legend.innerHTML = parts
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }

  renderInferenceRecent(views);
}

/**
 * The recent inference jobs table.
 *
 * Running work first, then anything needing attention, then the most recently
 * finished -- the same ordering the Dashboard preview uses, for the same
 * reason: a short list is only useful if it leads with what is live.
 *
 * @param {Object[]} views - Inference job views.
 */
function renderInferenceRecent(views) {
  const table = $('.inference-table');
  if (!table) return;

  const body = $('tbody', table);
  const rank = { running: 0, issues: 1, failed: 2, expired: 3, queued: 4, cancelled: 5, done: 6 };
  const shown = views
    .slice()
    .sort((a, b) => (rank[a.state] - rank[b.state])
      || (Date.parse(b.job.updated_at) - Date.parse(a.job.updated_at)))
    .slice(0, 6);

  const heading = $('.inference-recent .panel-hd h2');
  if (heading) heading.textContent = `Recent inference jobs (${views.length.toLocaleString()})`;

  body.innerHTML = shown.map((view) => {
    const { job, session } = view;
    const started = new Date(job.created_at);
    const tookMs = Math.max(0, Date.parse(job.updated_at) - Date.parse(job.created_at));
    const terminal = ['done', 'issues', 'failed', 'cancelled', 'expired'].includes(view.state);

    return `<tr data-job="${job.id}">`
      + `<td class="jname"><span class="name"><svg class="ico inference"><use href="#i-inference"/></svg><span class="t">${view.title}</span></span></td>`
      + `<td class="jscope"><span class="two"><span class="a">Dive ${session.dive || '?'} &middot; Line ${session.line || '?'}</span><span class="b">${session.type || ''}</span></span></td>`
      + `<td class="jmodel"><span class="two"><span class="a">${view.model}</span><span class="b">${view.reduction}</span></span></td>`
      + `<td class="jstatus" data-sort="${JOB_STATE_RANK[view.state]}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
      /* Detections is gap 11: the ingest writes observations and nothing counts
         them back onto the job. A dash, not a zero. */
      + `<td class="jdet">${NOT_COUNTED}</td>`
      + `<td class="jtime" data-sort="${job.created_at}"><span class="two"><span class="a">${started.toTimeString().slice(0, 5)}</span><span class="b">${started.toISOString().slice(0, 10)}</span></span></td>`
      + `<td class="jtook num" data-sort="${tookMs}">${terminal ? tookText(tookMs) : '<span class="dash">&mdash;</span>'}</td>`
      + `<td class="jacts"><button class="btn sm icon" aria-label="Open"><svg class="ico sm"><use href="#i-right"/></svg></button></td>`
      + '</tr>';
  }).join('');
}

/** Nothing counts these. Distinct from zero of them. */
const NOT_COUNTED = '<span class="dash" title="Nothing rolls detections up to a job: the ingest writes observations and the count is not recorded anywhere (gap 11)">&mdash;</span>';

/**
 * Fills the Inference screen from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderInferenceScreen() {
  if (document.body.dataset.screen !== 'inference' || !window.MarpApi) return;

  try {
    const jobs = await loadSessions().then(() => window.MarpApi.listJobs({ limit: 500 }));

    renderInference(jobs.jobs);
    wireVideoPicker();
  } catch (error) {
    const table = $('.inference-table tbody');
    if (table) {
      table.innerHTML = `<tr class="tblmsg"><td class="error" colspan="8">Could not load inference jobs (${error.status || 'no answer'}).</td></tr>`;
    }
  }
}


/* ============================================================ models */

/* `GET /api/v2/ml_models` is the whole of what the registry knows: id, name,
   parent_model_id, model_type, architecture_version, storage_path, status,
   notes and the two timestamps. Three of the table's columns ask for more than
   that -- the training dataset, key metrics and how many workers hold a model
   -- and none of the three is anywhere in MARP. Gap 28. */

/** The registry does not carry this. Distinct from "not measured yet". */
const NOT_IN_REGISTRY = '<span class="dash" title="Not carried by ml_models: the dataset link lives on a training run, which cannot be listed, and nothing records metrics, cache placement or a preferred model (gap 28)">&mdash;</span>';

/** MARP's `ml_models.status`, in the design's own state words. @type {Object} */
const MODEL_STATE = {
  trained: ['done', 'Trained'],
  training: ['running', 'Training'],
  draft: ['queued', 'Draft'],
  archived: ['cancelled', 'Archived'],
};

/** What the Models screen is asking for. The route takes no parameters. */
const modelsQuery = {
  task: '', status: '', base: '', search: '',
  sort: { key: 'hupd', dir: 'descending' },
  page: 1, perPage: 8,
};

/** How each sortable column orders. Keyed by the header's class. */
const MODELS_SORT_KEYS = {
  hname: (v) => v.model.name.toLowerCase(),
  htask: (v) => v.model.model_type,
  hver: (v) => v.version,
  hstatus: (v) => ['training', 'draft', 'trained', 'archived'].indexOf(v.model.status),
  hbase: (v) => (v.model.architecture_version || '').toLowerCase(),
  hupd: (v) => v.model.updated_at,
};

/** The registry, as fetched. */
let modelsRegistry = null;

/**
 * Which generation a model is, by walking `parent_model_id`.
 *
 * **A version chain is a self-join** (gap 16): `ml_models` has no `versions`
 * array and no version number, so "v3" is a position in a chain rather than a
 * field. Walking it here is honest and cheap at registry size; it is also
 * exactly the work a route would do if one ever returned a chain.
 *
 * @param {Object} model - The model.
 * @param {Map<number,Object>} byId - Every model, by id.
 * @returns {number} 1 for a root model.
 */
function modelGeneration(model, byId) {
  let depth = 1;
  let current = model;
  const seen = new Set([model.id]);

  while (current.parent_model_id && byId.has(current.parent_model_id)) {
    /* A cycle would hang this. Self-joins are not guaranteed acyclic by
       anything in the schema, so the walk refuses to revisit. */
    if (seen.has(current.parent_model_id)) break;
    seen.add(current.parent_model_id);
    current = byId.get(current.parent_model_id);
    depth += 1;
  }
  return depth;
}

/**
 * One model, reduced to what the table shows and sorts on.
 *
 * @param {Object} model - From `GET /api/v2/ml_models`.
 * @param {Map<number,Object>} byId - Every model, by id.
 * @returns {Object}
 */
function modelView(model, byId) {
  const [state, label] = MODEL_STATE[model.status] || ['queued', model.status];
  return {
    model, state, label,
    version: modelGeneration(model, byId),
    haystack: `${model.name} ${model.model_type} ${model.architecture_version || ''} ${model.status}`.toLowerCase(),
  };
}

/**
 * A model, as its row and its expanded detail.
 *
 * @param {Object} view - From `modelView`.
 * @param {Map<number,Object>} byId - Every model, by id.
 * @returns {string} Two `<tr>`s.
 */
function modelRows(view, byId) {
  const { model } = view;
  const parent = model.parent_model_id && byId.get(model.parent_model_id);

  const head = `<tr class="runrow-head" data-model="${model.id}" aria-expanded="false">`
    + `<td class="ex"><button class="exbtn" type="button" aria-label="Show ${model.name} details"><svg class="ico sm"><use href="#i-right"/></svg></button></td>`
    + `<td class="hname"><span class="name"><svg class="ico models"><use href="#i-models"/></svg><span class="t">${model.name}</span></span></td>`
    + `<td class="htask"><span class="tag">${model.model_type}</span></td>`
    + `<td class="hver">v${view.version}</td>`
    + `<td class="hstatus" data-sort="${MODELS_SORT_KEYS.hstatus(view)}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="hbase">${model.architecture_version || NOT_REPORTED}</td>`
    + `<td class="hdset">${NOT_IN_REGISTRY}</td>`
    + `<td class="hmodel">${NOT_IN_REGISTRY}</td>`
    + `<td class="hcache num">${NOT_IN_REGISTRY}</td>`
    + `<td class="hupd">${sinceText(model.updated_at)}</td>`
    + '<td class="hacts"><button class="btn sm icon" aria-label="Open"><svg class="ico sm"><use href="#i-right"/></svg></button></td>'
    + '</tr>';

  const body = '<tr class="runrow-body"><td colspan="11"><div class="rundetail">'
    + `<div class="wdhead"><span class="name"><svg class="ico models"><use href="#i-models"/></svg><span class="t">${model.name}</span></span>`
    + `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`
    + `<span class="wid mono" title="Model id as the registry reports it">ml_${model.id}</span></div>`
    + '<div class="grid" data-cols="2">'
    + '<div class="sect"><h3>In the registry</h3><dl class="kv">'
    + `<dt>Task</dt><dd>${model.model_type}</dd>`
    + `<dt>Architecture</dt><dd>${model.architecture_version || NOT_REPORTED}</dd>`
    + `<dt>Generation</dt><dd>v${view.version}${parent ? ` &middot; from ${parent.name}` : ' &middot; root model'}</dd>`
    + `<dt>Weights</dt><dd class="mono">${model.storage_path || NOT_REPORTED}</dd>`
    + `<dt>Registered</dt><dd>${new Date(model.created_at).toISOString().slice(0, 10)}</dd>`
    + `<dt>Updated</dt><dd>${sinceText(model.updated_at)}</dd>`
    + '</dl></div>'
    + '<div class="sect"><h3>Not in the registry</h3>'
    + '<p class="muted">Which dataset trained this model, how it scored, and how many workers hold it '
    + 'are absent from <code>ml_models</code>. Its training runs can be listed now, and whether it is '
    + 'preferred for its task is recorded — both landed in #260, and this said otherwise for hours '
    + 'afterwards. What is left of gap 28 is the metrics and the cache count.</p></div>'
    + '</div></div></td></tr>';

  return head + body;
}

/** Narrows, sorts and pages the registry, then draws it. */
function applyModelsQuery() {
  const table = $('table#models');
  if (table) table.dataset.sortsItsOwnData = 'true';
  if (!table || !modelsRegistry) return;

  const body = $('tbody', table);
  const byId = new Map(modelsRegistry.map((m) => [m.id, m]));
  let views = modelsRegistry.map((m) => modelView(m, byId));

  renderModelsSummary(views);

  if (modelsQuery.task) views = views.filter((v) => v.model.model_type === modelsQuery.task);
  if (modelsQuery.status) views = views.filter((v) => v.model.status === modelsQuery.status);
  if (modelsQuery.base) views = views.filter((v) => v.model.architecture_version === modelsQuery.base);
  if (modelsQuery.search) views = views.filter((v) => v.haystack.includes(modelsQuery.search));

  const key = MODELS_SORT_KEYS[modelsQuery.sort.key] || MODELS_SORT_KEYS.hupd;
  const sign = modelsQuery.sort.dir === 'ascending' ? 1 : -1;
  views.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;
    return a.model.id - b.model.id;
  });

  const total = views.length;
  const pages = Math.max(1, Math.ceil(total / modelsQuery.perPage));
  if (modelsQuery.page > pages) modelsQuery.page = pages;
  const from = (modelsQuery.page - 1) * modelsQuery.perPage;
  const shown = views.slice(from, from + modelsQuery.perPage);

  const columns = $$('thead th', table).length;
  body.innerHTML = shown.length
    ? shown.map((view) => modelRows(view, byId)).join('')
    : `<tr class="tblmsg"><td class="empty" colspan="${columns}">No models match these filters.</td></tr>`;

  const heading = $('#model-registry .panel-hd h2');
  if (heading) heading.textContent = `Model registry (${total.toLocaleString()})`;

  const showing = $('#model-registry .panel-ft > span');
  if (showing) {
    showing.innerHTML = shown.length
      ? `Showing <b class="strong">${from + 1}&ndash;${from + shown.length}</b> of ${total.toLocaleString()} models`
      : 'No models match these filters';
  }

  const pager = $('#model-registry .panel-ft .pager');
  if (pager) {
    const buttons = [`<button aria-label="Previous page" data-models-page="${modelsQuery.page - 1}"${modelsQuery.page === 1 ? ' disabled' : ''}><svg class="ico sm"><use href="#i-left"/></svg></button>`];
    const first = Math.max(1, Math.min(modelsQuery.page - 2, pages - 4));
    for (let p = first; p <= Math.min(pages, first + 4); p++) {
      buttons.push(`<button data-models-page="${p}"${p === modelsQuery.page ? ' aria-current="page"' : ''}>${p}</button>`);
    }
    buttons.push(`<button aria-label="Next page" data-models-page="${modelsQuery.page + 1}"${modelsQuery.page >= pages ? ' disabled' : ''}><svg class="ico sm"><use href="#i-right"/></svg></button>`);
    pager.innerHTML = buttons.join('');
  }

  for (const th of $$('#models thead th.sortable')) {
    const sortKey = [...th.classList].find((c) => MODELS_SORT_KEYS[c]);
    if (!sortKey) continue;
    if (sortKey === modelsQuery.sort.key) th.setAttribute('aria-sort', modelsQuery.sort.dir);
    else th.removeAttribute('aria-sort');
  }

  wireAccordions();
}

/**
 * The four cards and the registry-status donut.
 *
 * Two of the four cards ask for things `ml_models` does not carry, and they say
 * so rather than showing a number nothing produced.
 *
 * @param {Object[]} views - Every model.
 */
function renderModelsSummary(views) {
  const count = (status) => views.filter((v) => v.model.status === status).length;
  const trained = count('trained');
  const training = count('training');
  const draft = count('draft');
  const archived = count('archived');
  const total = views.length || 1;

  const newest = views.reduce((max, v) => Math.max(max, Date.parse(v.model.updated_at)), 0);
  const recent = views.filter((v) => v.model.status === 'trained'
    && Date.parse(v.model.updated_at) >= newest - 7 * 86400000).length;

  const byLabel = {};
  for (const card of $$('.stat')) {
    const label = $('.stat-lab', card);
    if (label) byLabel[label.textContent.trim()] = card;
  }
  const set = (label, num, sub) => {
    const card = byLabel[label];
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.innerHTML = num;
    const s = $('.stat-sub', card);
    if (s) s.innerHTML = `<span>${sub}</span>`;
  };

  set('Registered models', String(views.length), `${trained} trained &middot; ${training} training`);
  /* Real since #260. One per `model_type`, enforced by a partial unique index,
     so this counts types that have chosen rather than models that are special. */
  const preferred = views.filter((v) => v.preferred).length;
  set('Preferred models', String(preferred), preferred === 1 ? 'one model type has chosen' : `${preferred} model types have chosen`);

  /* Still nothing. The worker keeps a real cache -- `models/cache/<id>_<sha>` --
     and simply never reports it, so closing this is a `marp-inference-worker`
     change and no migration. See DESIGN.md gap 28. */
  set('Cached on workers', NOT_IN_REGISTRY, 'no worker reports what it holds');
  set('Recently trained', String(recent), 'updated in the last 7 days');

  const parts = [['done', trained, 'Trained'], ['running', training, 'Training'], ['queued', draft, 'Draft'], ['cancelled', archived, 'Archived']];

  const donut = $('.job-donut svg');
  if (donut) {
    const arcs = $$('.donut-part', donut);
    let offset = 0;
    arcs.forEach((arc, index) => {
      const value = parts[index] ? parts[index][1] : 0;
      arc.setAttribute('pathLength', String(total));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, total - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    });
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(views.length);
  }

  const legend = $('.job-mix-key');
  if (legend) {
    legend.innerHTML = parts
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }
}

/**
 * Fills the Models screen from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderModelsScreen() {
  const table = $('table#models');
  if (!table || !window.MarpApi) return;

  const body = $('tbody', table);
  const columns = $$('thead th', table).length;
  body.innerHTML = `<tr class="tblmsg"><td class="loading" colspan="${columns}">Loading the registry&hellip;</td></tr>`;

  try {
    modelsRegistry = await window.MarpApi.listModels();
    fillModelsFilterOptions();
    applyModelsQuery();
  } catch (error) {
    body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="${columns}">Could not load the registry (${error.status || 'no answer'}). `
      + '<button class="btn sm" type="button" id="modelsRetry">Try again</button></td></tr>';
    $('#modelsRetry')?.addEventListener('click', renderModelsScreen);
  }
}

/**
 * Fills the Task and Base model selectors from what is there.
 *
 * The Dataset selector is left alone and disabled: `ml_models` has no dataset
 * link, so every choice it could offer would match nothing.
 */
function fillModelsFilterOptions() {
  const selects = {};
  for (const select of $$('select')) selects[select.getAttribute('aria-label')] = select;

  const tasks = [...new Set(modelsRegistry.map((m) => m.model_type))].sort();
  const bases = [...new Set(modelsRegistry.map((m) => m.architecture_version).filter(Boolean))].sort();

  if (selects.Task) {
    selects.Task.innerHTML = ['<option>All tasks</option>', ...tasks.map((t) => `<option>${t}</option>`)].join('');
  }
  if (selects['Base model']) {
    selects['Base model'].innerHTML = ['<option>All base models</option>', ...bases.map((b) => `<option>${b}</option>`)].join('');
  }
  if (selects.Dataset) {
    selects.Dataset.innerHTML = '<option>Not linked in the registry</option>';
    selects.Dataset.disabled = true;
    selects.Dataset.title = 'ml_models carries no dataset link; the connection lives on a training run, which cannot be listed (gap 28)';
  }
}

/** The Models filters, sort headers and pager. Bound once. */
function wireModelsControls() {
  const panel = $('#model-registry');
  if (!panel) return;

  const renarrow = () => { modelsQuery.page = 1; applyModelsQuery(); };
  const selects = {};
  for (const select of $$('select')) selects[select.getAttribute('aria-label')] = select;

  selects.Task?.addEventListener('change', () => {
    modelsQuery.task = selects.Task.value.startsWith('All') ? '' : selects.Task.value;
    renarrow();
  });
  selects.Status?.addEventListener('change', () => {
    modelsQuery.status = {
      Trained: 'trained', Training: 'training', Draft: 'draft', Archived: 'archived',
    }[selects.Status.value] || '';
    renarrow();
  });
  selects['Base model']?.addEventListener('change', () => {
    modelsQuery.base = selects['Base model'].value.startsWith('All') ? '' : selects['Base model'].value;
    renarrow();
  });

  const search = $('.search input', panel) || $('#filters input[type="search"]');
  if (search) {
    search.addEventListener('input', () => {
      modelsQuery.search = search.value.trim().toLowerCase();
      renarrow();
    });
  }

  for (const th of $$('#models thead th.sortable')) {
    const key = [...th.classList].find((c) => MODELS_SORT_KEYS[c]);
    if (!key) continue;
    th.addEventListener('click', () => {
      if (modelsQuery.sort.key === key) {
        modelsQuery.sort.dir = modelsQuery.sort.dir === 'ascending' ? 'descending' : 'ascending';
      } else {
        modelsQuery.sort = { key, dir: 'ascending' };
      }
      modelsQuery.page = 1;
      applyModelsQuery();
    });
  }

  const pager = $('.panel-ft .pager', panel);
  if (pager) {
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-models-page]');
      if (!button || button.disabled) return;
      modelsQuery.page = Number(button.dataset.modelsPage);
      applyModelsQuery();
    });
  }
}


/* =========================================================== history */

/* History is the terminal states over a window, which is the one question
   `GET /gpu/jobs` cannot be asked (gap 24): there is no date parameter, so the
   window is applied here over everything the route will hand back. It also
   resolves two ids the job carries bare -- `session.project_id` and
   `created_by` -- against `GET /api/v2/projects` and `GET /api/v2/users`. */

/** What the History screen is asking for. None of it is a query parameter. */
const historyQuery = {
  project: '', kind: '', state: '', model: '', windowDays: 30,
  sort: { key: 'hend', dir: 'descending' },
  page: 1, perPage: 10,
};

/** How each sortable column orders. Keyed by the header's class. */
const HISTORY_SORT_KEYS = {
  hjob: (v) => v.title.toLowerCase(),
  htype: (v) => v.job.kind,
  hstatus: (v) => JOB_STATE_RANK[v.state],
  hscope: (v) => v.projectName.toLowerCase(),
  hmodel: (v) => v.model.toLowerCase(),
  hdata: (v) => v.frames,
  hstart: (v) => v.job.created_at,
  hend: (v) => v.job.updated_at,
  hdur: (v) => v.tookMs,
  hwho: (v) => v.byName.toLowerCase(),
};

/** Everything History draws from, fetched once. */
let historyData = null;

/**
 * A finished job, reduced to what History shows.
 *
 * @param {Object} job - A terminal job.
 * @param {Set<string>} issues - Batches that finished with issues.
 * @param {Map<number,string>} projects - project_id to name.
 * @param {Map<number,string>} users - user_id to name.
 * @returns {Object}
 */
function historyView(job, issues, projects, users) {
  const view = jobView(job, issues);
  const session = view.session;
  const started = Date.parse(job.created_at);
  const completed = Date.parse(job.updated_at);

  view.projectName = projects.get(session.project_id) || 'Unknown project';
  view.byName = users.get(job.created_by) || 'Unattributed';
  view.frames = job.spec.range ? job.spec.range.end_frame - job.spec.range.start_frame : 0;
  /* `updated_at` is the closest thing the list route has to a finish time: the
     attempt's `finished_at` is real but only `GET /gpu/jobs/:id` returns it,
     and one detail call per row is what gap 23 already rejected. */
  view.tookMs = Math.max(0, completed - started);
  return view;
}

/**
 * How long something took, in the units an operator reads.
 *
 * @param {number} ms - Duration.
 * @returns {string}
 */
function tookText(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Narrows, sorts and pages the finished work, then draws it. */
function applyHistoryQuery() {
  const table = $('table#history');
  if (table) table.dataset.sortsItsOwnData = 'true';
  if (!table || !historyData) return;

  const body = $('tbody', table);
  const { jobs, projects, users } = historyData;

  const issues = batchesWithIssues(jobs);
  const newest = jobs.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  const since = newest - historyQuery.windowDays * 86400000;

  const terminal = ['succeeded', 'failed', 'cancelled', 'expired'];
  let views = jobs
    .filter((j) => terminal.includes(j.state) && Date.parse(j.created_at) >= since)
    .map((job) => historyView(job, issues, projects, users));

  /* The window drives the cards as well as the table, so they are counted
     before the other filters narrow anything. */
  renderHistoryOutcomes(views, jobs, since, newest);

  if (historyQuery.project) views = views.filter((v) => v.projectName === historyQuery.project);
  if (historyQuery.kind) views = views.filter((v) => v.job.kind === historyQuery.kind);
  if (historyQuery.model) views = views.filter((v) => v.model === historyQuery.model);
  if (historyQuery.state) {
    views = historyQuery.state === 'issues'
      ? views.filter((v) => v.state === 'issues')
      : views.filter((v) => v.state === historyQuery.state);
  }

  const key = HISTORY_SORT_KEYS[historyQuery.sort.key] || HISTORY_SORT_KEYS.hend;
  const sign = historyQuery.sort.dir === 'ascending' ? 1 : -1;
  views.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;
    return b.job.id - a.job.id;
  });

  const total = views.length;
  const pages = Math.max(1, Math.ceil(total / historyQuery.perPage));
  if (historyQuery.page > pages) historyQuery.page = pages;
  const from = (historyQuery.page - 1) * historyQuery.perPage;
  const shown = views.slice(from, from + historyQuery.perPage);

  const columns = $$('thead th', table).length;
  body.innerHTML = shown.length
    ? shown.map(historyRow).join('')
    : `<tr class="tblmsg"><td class="empty" colspan="${columns}">No finished work matches these filters.</td></tr>`;

  const heading = $('#history-panel .panel-hd h2');
  if (heading) heading.textContent = `Job history (${total.toLocaleString()})`;

  const showing = $('#history-panel .panel-ft > span');
  if (showing) {
    const windowText = historyQuery.windowDays === 365 ? 'this year' : `the last ${historyQuery.windowDays} days`;
    showing.innerHTML = shown.length
      ? `Showing <b class="strong">${from + 1}&ndash;${from + shown.length}</b> of ${total.toLocaleString()} jobs in ${windowText}`
      : `Nothing finished in ${windowText} matches these filters`;
  }

  const pager = $('#history-panel .panel-ft .pager');
  if (pager) {
    const buttons = [`<button aria-label="Previous page" data-history-page="${historyQuery.page - 1}"${historyQuery.page === 1 ? ' disabled' : ''}><svg class="ico sm"><use href="#i-left"/></svg></button>`];
    const first = Math.max(1, Math.min(historyQuery.page - 2, pages - 4));
    for (let p = first; p <= Math.min(pages, first + 4); p++) {
      buttons.push(`<button data-history-page="${p}"${p === historyQuery.page ? ' aria-current="page"' : ''}>${p}</button>`);
    }
    buttons.push(`<button aria-label="Next page" data-history-page="${historyQuery.page + 1}"${historyQuery.page >= pages ? ' disabled' : ''}><svg class="ico sm"><use href="#i-right"/></svg></button>`);
    pager.innerHTML = buttons.join('');
  }

  for (const th of $$('#history thead th.sortable')) {
    const sortKey = [...th.classList].find((c) => HISTORY_SORT_KEYS[c]);
    if (!sortKey) continue;
    if (sortKey === historyQuery.sort.key) th.setAttribute('aria-sort', historyQuery.sort.dir);
    else th.removeAttribute('aria-sort');
  }
}

/**
 * The four outcome cards and the outcomes donut.
 *
 * @param {Object[]} views - Finished work inside the window.
 * @param {Object[]} jobs - Every job, for the previous window's comparison.
 * @param {number} since - Start of the window.
 * @param {number} newest - The corpus's latest job.
 */
function renderHistoryOutcomes(views, jobs, since, newest) {
  const done = views.filter((v) => v.state === 'done').length;
  const issues = views.filter((v) => v.state === 'issues').length;
  const bad = views.filter((v) => ['failed', 'cancelled', 'expired'].includes(v.state)).length;
  const total = views.length || 1;

  /* The first card compares against the window before this one, which is a
     real question the data can answer -- it is only the *route* that cannot. */
  const span = newest - since;
  const previous = jobs.filter((j) => {
    const at = Date.parse(j.created_at);
    return at >= since - span && at < since
      && ['succeeded', 'failed', 'cancelled', 'expired'].includes(j.state);
  }).length;
  const change = previous ? Math.round(((views.length - previous) / previous) * 100) : 0;

  const byLabel = {};
  for (const card of $$('.stat')) {
    const label = $('.stat-lab', card);
    if (label) byLabel[label.textContent.trim()] = card;
  }
  const set = (label, num, sub) => {
    const card = byLabel[label];
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.textContent = String(num);
    const s = $('.stat-sub', card);
    if (s) s.innerHTML = `<span>${sub}</span>`;
  };
  const share = (n) => `${Math.round((n / total) * 100)}% of the window`;

  set('Jobs in this window', views.length, previous
    ? `${change >= 0 ? '+' : ''}${change}% against the window before`
    : 'no earlier window to compare');
  set('Completed', done, share(done));
  set('Completed with issues', issues, share(issues));
  set('Failed or cancelled', bad, share(bad));

  const legend = $('.job-mix-key');
  if (legend) {
    legend.innerHTML = [['done', done, 'Completed'], ['issues', issues, 'With issues'], ['failed', bad, 'Failed / cancelled']]
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }

  const donut = $('.job-donut svg');
  if (donut) {
    const arcs = $$('.donut-part', donut);
    const parts = [done, issues, bad];
    let offset = 0;
    arcs.forEach((arc, index) => {
      const value = parts[index] || 0;
      arc.setAttribute('pathLength', String(total));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, total - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    });
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(views.length);
  }
}

/**
 * One finished job, as a table row.
 *
 * @param {Object} view - From `historyView`.
 * @returns {string} A `<tr>`.
 */
function historyRow(view) {
  const { job } = view;
  const started = new Date(job.created_at);
  const completed = new Date(job.updated_at);
  const stamp = (d) => `<span class="two"><span class="a">${d.toTimeString().slice(0, 5)}</span><span class="b">${d.toISOString().slice(0, 10)}</span></span>`;

  return `<tr data-job="${job.id}">`
    + '<td class="chk"><input class="chkbox" type="checkbox" aria-label="Select ' + view.title + '"></td>'
    + `<td class="jname"><span class="name"><svg class="ico ${view.kindIcon}"><use href="#i-${view.kindIcon}"/></svg><span class="t">${view.title}</span></span></td>`
    + `<td class="jtype"><span class="tag ${view.kindIcon}">${view.kindLabel}</span></td>`
    + `<td class="jstatus" data-sort="${JOB_STATE_RANK[view.state]}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="hscope"><span class="two"><span class="a">${view.projectName}</span><span class="b">Dive ${view.session.dive || '?'} &middot; Line ${view.session.line || '?'}</span></span></td>`
    + `<td class="hmodel">${view.model}</td>`
    + `<td class="hdata num" data-sort="${view.frames}">${view.frames.toLocaleString()}</td>`
    + `<td class="hstart" data-sort="${job.created_at}">${stamp(started)}</td>`
    + `<td class="hend" data-sort="${job.updated_at}">${stamp(completed)}</td>`
    + `<td class="hdur num" data-sort="${view.tookMs}">${tookText(view.tookMs)}</td>`
    + `<td class="hworker" data-sort="${view.job.worker_name || ''}">${view.job.worker_name || (view.job.worker_id ? `Worker ${view.job.worker_id}` : '<span class="dash" title="Never leased to a machine">&mdash;</span>')}${Number(view.job.workers_used) > 1 ? ` <span class="faint">· ${view.job.workers_used} machines</span>` : ''}</td>`
    + `<td class="hwho">${view.byName}</td>`
    + '<td class="jacts"><button class="btn sm icon" aria-label="Open"><svg class="ico sm"><use href="#i-right"/></svg></button></td>'
    + '</tr>';
}

/**
 * Fills the History screen from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderHistoryScreen() {
  const table = $('table#history');
  if (!table || !window.MarpApi) return;

  const body = $('tbody', table);
  const columns = $$('thead th', table).length;
  body.innerHTML = `<tr class="tblmsg"><td class="loading" colspan="${columns}">Loading history&hellip;</td></tr>`;

  try {
    const [jobs, projects, users] = await Promise.all([
      loadSessions().then(() => window.MarpApi.listJobs({ limit: 500 })),
      window.MarpApi.listProjects(),
      window.MarpApi.listUsers(),
    ]);

    historyData = {
      jobs: jobs.jobs,
      projects: new Map(projects.map((p) => [p.project_id, p.name])),
      users: new Map(users.map((u) => [u.user_id, u.name])),
    };

    fillHistoryFilterOptions();
    applyHistoryQuery();
  } catch (error) {
    /* The banner can only report a status, and a rendering bug has none — so it
       reads "no answer" and sends whoever sees it to check the API. The detail
       goes to the console, where it names the actual line. */
    console.error('MarpDashboard: history failed to render —', error);

    body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="${columns}">Could not load history (${error.status || 'no answer'}). `
      + '<button class="btn sm" type="button" id="historyRetry">Try again</button></td></tr>';
    $('#historyRetry')?.addEventListener('click', renderHistoryScreen);
  }
}

/**
 * Fills the Project and Model selectors from what is actually there.
 *
 * They were written out by hand and listed six projects and two models, none of
 * which need match the data: a filter offering a choice that matches nothing is
 * worse than no filter.
 */
function fillHistoryFilterOptions() {
  const selects = $$('#history-panel select, .panel-tools select');
  const byLabel = {};
  for (const select of selects) byLabel[select.getAttribute('aria-label')] = select;

  const projects = [...new Set(historyData.jobs.map((j) => historyData.projects.get(sessionFor(j.spec).project_id)).filter(Boolean))].sort();
  const models = [...new Set(historyData.jobs.map((j) => j.spec.model && j.spec.model.name).filter(Boolean))].sort();

  if (byLabel.Project) {
    byLabel.Project.innerHTML = ['<option>All projects</option>', ...projects.map((p) => `<option>${p}</option>`)].join('');
  }
  if (byLabel.Model) {
    byLabel.Model.innerHTML = ['<option>All models</option>', ...models.map((m) => `<option>${m}</option>`)].join('');
  }
}

/** The History filters, sort headers and pager. Bound once. */
function wireHistoryControls() {
  const panel = $('#history-panel') || $('table#history')?.closest('.panel');
  if (!panel) return;

  const renarrow = () => { historyQuery.page = 1; applyHistoryQuery(); };
  const selects = {};
  for (const select of $$('select')) selects[select.getAttribute('aria-label')] = select;

  selects.Project?.addEventListener('change', () => {
    historyQuery.project = selects.Project.value.startsWith('All') ? '' : selects.Project.value;
    renarrow();
  });
  selects['Job type']?.addEventListener('change', () => {
    historyQuery.kind = { Inference: 'inference', Training: 'training' }[selects['Job type'].value] || '';
    renarrow();
  });
  selects.Status?.addEventListener('change', () => {
    historyQuery.state = {
      Completed: 'done', 'Completed with issues': 'issues', Failed: 'failed', Cancelled: 'cancelled',
    }[selects.Status.value] || '';
    renarrow();
  });
  selects.Window?.addEventListener('change', () => {
    historyQuery.windowDays = {
      'Last 7 days': 7, 'Last 30 days': 30, 'Last 90 days': 90, 'This year': 365,
    }[selects.Window.value] || 30;
    renarrow();
  });
  selects.Model?.addEventListener('change', () => {
    historyQuery.model = selects.Model.value.startsWith('All') ? '' : selects.Model.value;
    renarrow();
  });
  selects['Rows per page']?.addEventListener('change', () => {
    historyQuery.perPage = Number(selects['Rows per page'].value) || 10;
    renarrow();
  });

  for (const th of $$('#history thead th.sortable')) {
    const key = [...th.classList].find((c) => HISTORY_SORT_KEYS[c]);
    if (!key) continue;
    th.addEventListener('click', () => {
      if (historyQuery.sort.key === key) {
        historyQuery.sort.dir = historyQuery.sort.dir === 'ascending' ? 'descending' : 'ascending';
      } else {
        historyQuery.sort = { key, dir: 'ascending' };
      }
      historyQuery.page = 1;
      applyHistoryQuery();
    });
  }

  const pager = $('.panel-ft .pager', panel);
  if (pager) {
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-page]');
      if (!button || button.disabled) return;
      historyQuery.page = Number(button.dataset.historyPage);
      applyHistoryQuery();
    });
  }
}


/* ========================================================= dashboard */

/* The landing screen summarises every other one, so it reads four routes:
   jobs, workers, ml_models and dataset. Three of its six cards are counts the
   routes can give; the sub-lines underneath them are where this screen runs
   out of API, and each of those is a recorded gap rather than a number. */

/**
 * The Dashboard's six overview cards, the worker pool panel and the short
 * current-and-recent-jobs preview.
 *
 * @param {Object} data - `{ jobs, workers, models, datasets }`.
 */
function renderDashboard(data) {
  const { jobs, workers, models, datasets } = data;

  const running = jobs.filter((j) => j.state === 'leased');
  const queued = jobs.filter((j) => j.state === 'queued');
  const kindOf = (rows, kind) => rows.filter((j) => j.kind === kind).length;

  const byLabel = {};
  for (const card of $$('.stat')) {
    const label = $('.stat-lab', card);
    if (label) byLabel[label.textContent.trim()] = card;
  }

  const set = (label, num, parts) => {
    const card = byLabel[label];
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.textContent = String(num);
    const sub = $('.stat-sub', card);
    if (sub) sub.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  };

  set('Jobs', running.length + queued.length, [`${running.length} running`, `${queued.length} queued`]);

  set('Inference', kindOf(running, 'inference') + kindOf(running, 'tracking'), [
    'running now',
    `${kindOf(queued, 'inference') + kindOf(queued, 'tracking')} queued`,
  ]);

  set('Training', kindOf(running, 'training'), ['running now', `${kindOf(queued, 'training')} queued`]);

  /* `datasets.status` exists as of #260, so "building" is a count rather than
     an apology. What still has no API behind it is the *progress* of a build,
     which is gap 19 and belongs to whatever ends up doing the building. */
  const building = datasets.filter((d) => d.status === 'building').length;
  set('Datasets', datasets.length, ['saved', building ? `${building} building` : 'none building']);

  /* `ml_models.preferred` exists as of #260 -- one per model_type, held by a
     partial unique index. This said "no preferred flag in the API" for hours
     after the flag shipped, which is worse than saying nothing: a screen that
     reports a capability as missing is believed. */
  const preferred = models.filter((m) => m.preferred).length;
  set('Models', models.length, ['registered', `${preferred} preferred`]);

  /* History is the terminal states over the same window the screen is drawn
     for, which the route can answer only by being handed everything. Gap 24. */
  const newest = jobs.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  const finished = jobs.filter((j) => ['succeeded', 'failed', 'cancelled', 'expired'].includes(j.state)
    && Date.parse(j.created_at) >= newest - 7 * 86400000);
  set('History', finished.length, ['finished', 'last 7 days']);

  renderDashboardPool(workers);
  renderDashboardActivity(jobs);
}

/**
 * The Worker pool panel's figures.
 *
 * The utilization percentages it was drawn with are not available (gap 27), so
 * what is shown is what the pool really reports: machines, reachability and
 * slots in use against capacity.
 *
 * @param {Object[]} workers - The pool.
 */
function renderDashboardPool(workers) {
  const panel = $('#worker-pool');
  if (!panel) return;

  const total = workers.length || 1;
  const counts = ['busy', 'idle', 'paused', 'offline']
    .map((activity) => [activity, workers.filter((w) => w.activity === activity).length]);

  /* The donut's arcs are measured in circumference rather than `pathLength`
     here, so each share has to be converted. r=54. */
  const circumference = 2 * Math.PI * 54;
  const arcs = $$('.pool .donut circle', panel).slice(1);
  let offset = 0;
  counts.forEach(([, value], index) => {
    const arc = arcs[index];
    if (!arc) return;
    const length = (value / total) * circumference;
    arc.setAttribute('stroke-dasharray', `${length.toFixed(1)} ${(circumference - length).toFixed(1)}`);
    arc.setAttribute('stroke-dashoffset', `${(-offset).toFixed(1)}`);
    offset += length;
  });

  /* The count lives in `.mid > b`, beside its caption. Targeting `.n` here
     silently did nothing and still read 143, which was right by luck -- the
     kind of wiring that looks finished and is not. */
  const enrolled = $('.pool .donut .mid b', panel);
  if (enrolled) enrolled.textContent = String(workers.length);

  /* The legend is a flat run of dot/key/value/percent, four to a state. */
  const legend = $('.pool .legend', panel);
  if (legend) {
    legend.innerHTML = counts.map(([activity, value]) => {
      const label = activity[0].toUpperCase() + activity.slice(1);
      return `<span class="dot" data-state="${activity}"></span><span class="k">${label}</span>`
        + `<span class="v">${value}</span><span class="p">${Math.round((value / total) * 100)}%</span>`;
    }).join('');
  }

  const slots = workers.reduce((sum, w) => sum + w.slot_count, 0);
  const used = workers.reduce((sum, w) => sum + (w.attempts || []).length, 0);
  const pct = (n) => `${Math.round((n / Math.max(1, slots)) * 100)}%`;

  const capacity = $('.slots .big .n', panel);
  if (capacity) capacity.textContent = String(slots);

  const write = (selector, value) => {
    const node = $(selector, panel);
    if (node) node.textContent = value;
  };
  write('[data-pool-used-summary]', String(used));
  write('[data-pool-used-summary-percent]', pct(used));
  write('[data-pool-available]', String(slots - used));
  write('[data-pool-available-percent]', pct(slots - used));

  /* The history panel's caption said "313 total slots" in markup, which is the
     same number this already computes and was wrong the moment the pool
     changed. Said once, from the pool. */
  write('[data-pool-slots-total]', String(slots));
}

/**
 * Where a job on the Dashboard opens, so the row can be a link to it.
 *
 * **The addressing is the one `jobs.html` already reads**: `?job=<id>`, which it finds,
 * moves to the top, expands and scrolls to — the behaviour summary links from Inference
 * have used for a while. The Datasets screen lists datasets rather than jobs, so a build
 * addresses the thing that page holds, `?dataset=<id>`; it is the same rule, not a second
 * one, and it is what makes a link to a *finished* build work, since a build that
 * succeeded has left `GET /dataset/builds` and could not be resolved from a job id.
 *
 * **A kind with nowhere to land stays unlinked.** Training and Inference have screens but
 * neither lists jobs as rows that can be addressed, so a training job opens on Jobs — its
 * own page, with its own detail — rather than somewhere that would merely look right.
 *
 * @param {Object} job - The raw job.
 * @returns {?string} An address, or null when there is nothing to open.
 */
function jobDestination(job) {
  if (!job || job.id === undefined || job.id === null) return null;

  if (job.kind === 'dataset_build') {
    /* The build's own row is the dataset it is building. `spec.dataset_id` is written
       when the build is queued and never changes, so it addresses the row whether the
       build is still running or finished months ago. */
    const dataset = job.spec && job.spec.dataset_id;

    return dataset == null
      ? null
      : `./datasets.html?dataset=${encodeURIComponent(dataset)}`;
  }

  return `./jobs.html?job=${encodeURIComponent(job.id)}`;
}

/**
 * The short Current and recent jobs preview.
 *
 * Deliberately not the Jobs list: running work first, then anything needing
 * attention, then the most recently finished. Every column still sorts, and the
 * complete list, filters and paging stay on Jobs.
 *
 * @param {Object[]} jobs - The window of jobs.
 */
function renderDashboardActivity(jobs) {
  const table = $('#current-activity table') || $('#current-activity .tbl');
  if (!table) return;

  const body = $('tbody', table);
  if (!body) return;

  const issues = batchesWithIssues(jobs);
  const views = jobs.map((job) => jobView(job, issues));

  /* **Three groups, not one sorted list** (R3). Ranking by state and taking the
     top five filled the preview with running work and nothing else: eighteen
     jobs were running, so work needing attention and recently finished work
     never appeared, and a panel whose whole purpose is the mix showed a third
     of it. Each group is drawn from separately; leftovers top it back up. */
  const newest = (rows) => rows.sort((a, b) => Date.parse(b.job.updated_at) - Date.parse(a.job.updated_at));
  const running = newest(views.filter((v) => v.state === 'running'));
  const finished = newest(views.filter((v) => v.state === 'done'));

  /* **One per kind of trouble, not the two newest.** Taking the newest two
     filled both slots with `issues` and left a panel that never showed a
     failure -- two slots spent saying the same word. A preview this short is
     only useful if each row tells the reader something the others do not. */
  const attention = ['failed', 'issues', 'expired']
    .map((state) => newest(views.filter((v) => v.state === state))[0])
    .filter(Boolean);

  const shown = [...running.slice(0, 2), ...attention.slice(0, 2), ...finished.slice(0, 1)];

  for (const pool of [attention.slice(2), running.slice(2), finished.slice(1)]) {
    for (const view of pool) {
      if (shown.length >= 5) break;
      shown.push(view);
    }
  }

  body.innerHTML = shown.map((view) => {
    const progress = progressCell(view.job, view.state);
    const updated = new Date(view.job.updated_at);
    const opens = jobDestination(view.job);
    /* The name is the link, not the row: a row-wide handler would swallow a future
       control in another cell, and an `<a>` is what makes middle-click, copy-link and
       open-in-new-tab work without this screen implementing any of them. */
    const name = `<span class="name"><svg class="ico ${view.kindIcon}"><use href="#i-${view.kindIcon}"/></svg><span class="t">${view.title}</span></span>`;

    return `<tr data-job="${view.job.id}">`
      + `<td class="jname">${opens
        ? `<a class="jobopen" href="${opens}" title="Open this ${view.kindLabel.toLowerCase()} and expand it">${name}</a>`
        : name}</td>`
      + `<td class="jtype"><span class="tag ${view.kindIcon}">${view.kindLabel}</span></td>`
      + `<td class="jstatus" data-sort="${JOB_STATE_RANK[view.state]}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
      + `<td class="jprog" data-sort="${progress.sort}">${progress.html}</td>`
      + `<td class="jtime" data-sort="${view.job.updated_at}">${updated.toTimeString().slice(0, 5)}</td>`
      + '</tr>';
  }).join('');
}

/**
 * Fills the Dashboard from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderDashboardScreen() {
  if (document.body.dataset.screen !== 'dashboard' || !window.MarpApi) return;

  try {
    const [jobs, workers, models, datasets] = await Promise.all([
      loadSessions().then(() => window.MarpApi.listJobs({ limit: 500 })),
      window.MarpApi.listWorkers(),
      window.MarpApi.listModels(),
      window.MarpApi.listDatasets(),
    ]);

    renderDashboard({ jobs: jobs.jobs, workers, models, datasets });
  } catch (error) {
    /* **Say what actually went wrong, in the console.** This banner reports a
       status, and a rendering bug has no status -- so a `TypeError` thrown
       while drawing reads on screen as "could not be loaded (no answer)",
       which sends whoever sees it to look at the API. It cost a while today.
       The banner stays short; the detail goes where a developer will find it. */
    console.error('MarpDashboard: the dashboard failed to render —', error);

    /* One banner, not six broken cards. A landing screen that half-loaded is
       worse than one that says it could not. */
    const content = $('.content');
    if (!content) return;
    const warning = document.createElement('div');
    warning.className = 'tblmsg-banner';
    warning.innerHTML = `<p class="error">The dashboard could not be loaded (${error.status || 'no answer'}). `
      + '<button class="btn sm" type="button" id="dashRetry">Try again</button></p>';
    content.prepend(warning);
    $('#dashRetry')?.addEventListener('click', () => {
      warning.remove();
      renderDashboardScreen();
    });
  }
}


/* ============================================================ workers table */

/* `GET /gpu/workers` returns every machine, unpaged (gap 12). What it does
   *not* return is any live machine telemetry: `capabilities` is the static blob
   a worker sent at enrolment -- "GPUs and VRAM, driver, disk, engines" -- and a
   heartbeat carries the attempt's progress and nothing about the machine. So
   GPU load, VRAM load, temperature, power, clocks, CPU, system RAM, disk and
   process uptime have no source at all, and are drawn as not reported rather
   than invented. Gap 27. */

/** Not measured is not zero. One dash, one explanation, used everywhere. */
const NOT_REPORTED = '<span class="dash" title="MARP records no live machine telemetry: a worker reports its capabilities at enrolment and its attempt progress on heartbeat">&mdash;</span>';

/** Activity to the design's state word. The API derives `activity` already. */
const WORKER_ACTIVITY = {
  busy: ['busy', 'Busy'],
  idle: ['idle', 'Idle'],
  paused: ['paused', 'Paused'],
  offline: ['offline', 'Offline'],
};

/** What the Workers screen is asking for. The route takes no parameters at all. */
const workersQuery = {
  activity: '', gpu: '', search: '',
  sort: { key: 'whb', dir: 'ascending' },
  page: 1, perPage: 5,
};

/** How each sortable column orders. Keyed by the header's class. */
const WORKERS_SORT_KEYS = {
  wname: (v) => v.worker.name.toLowerCase(),
  wstate: (v) => ['busy', 'idle', 'paused', 'offline'].indexOf(v.activity),
  wver: (v) => v.worker.worker_version || '',
  wgpu: (v) => v.gpu.toLowerCase(),
  wjobs: (v) => v.used / Math.max(1, v.worker.slot_count),
  whb: (v) => (v.worker.last_seen_at ? -Date.parse(v.worker.last_seen_at) : Infinity),
};

/** The pool, as fetched. The route does not page, so this is all of it. */
let workersPool = null;

/**
 * How long ago, in the units an operator reads.
 *
 * Measured against the data layer's fixed present rather than the wall clock,
 * so the column says the same thing to two people looking at one screen.
 *
 * @param {?string} iso - An instant, or null.
 * @returns {string}
 */
function sinceText(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((window.MarpApi._meta.NOW - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * One worker, reduced to what the table shows and sorts on.
 *
 * @param {Object} worker - A worker from `GET /gpu/workers`.
 * @returns {Object}
 */
function workerView(worker) {
  const caps = worker.capabilities || {};
  const [state, label] = WORKER_ACTIVITY[worker.activity] || WORKER_ACTIVITY.idle;
  const vramGb = caps.vram_mb ? Math.round(caps.vram_mb / 1024) : null;

  return {
    worker, caps, state, label,
    activity: worker.activity,
    gpu: caps.gpu || 'Not reported',
    vram: vramGb ? `${vramGb} GB` : '',
    used: (worker.attempts || []).length,
    haystack: `${worker.name} ${worker.worker_id} ${caps.gpu || ''} ${worker.worker_version || ''}`.toLowerCase(),
  };
}

/**
 * A worker, as its row and its expanded detail.
 *
 * @param {Object} view - From `workerView`.
 * @returns {string} Two `<tr>`s, the head and its body.
 */
function workerRows(view) {
  const { worker, caps } = view;
  const attempt = (worker.attempts || [])[0] || null;

  const head = `<tr class="runrow-head" data-worker="${worker.worker_id}" aria-expanded="false">`
    + `<td class="ex"><button class="exbtn" type="button" aria-label="Show ${worker.name} details"><svg class="ico sm"><use href="#i-right"/></svg></button></td>`
    + `<td class="jname"><span class="name"><svg class="ico"><use href="#i-workers"/></svg><span class="t">${worker.name}</span></span></td>`
    + `<td class="jstatus" data-sort="${WORKERS_SORT_KEYS.wstate(view)}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="wver">${worker.worker_version || NOT_REPORTED}</td>`
    + `<td class="wgpu"><span class="two"><span class="a">${view.gpu}</span><span class="b">${view.vram}</span></span></td>`
    + `<td class="wcpu" data-sort="-1">${NOT_REPORTED}</td>`
    + `<td class="wmem" data-sort="-1">${NOT_REPORTED}</td>`
    + `<td class="wmodel">${NOT_REPORTED}</td>`
    + `<td class="num" data-sort="${view.used}">${view.used} / ${worker.slot_count}</td>`
    + `<td class="wup">${NOT_REPORTED}</td>`
    + `<td class="whb" data-sort="${WORKERS_SORT_KEYS.whb(view)}">${sinceText(worker.last_seen_at)}</td>`
    + '</tr>';

  const progress = attempt && attempt.progress_done !== null
    ? `${attempt.progress_done.toLocaleString()} / ${attempt.progress_total.toLocaleString()} ${attempt.progress_unit}`
    : 'No heartbeat yet';

  const live = attempt
    ? '<div class="sect"><h3>Live attempt</h3><dl class="kv">'
      + `<dt>Attempt</dt><dd>${attempt.id} &middot; job ${attempt.job_id}</dd>`
      + `<dt>State</dt><dd>${attempt.state}</dd>`
      + `<dt>Progress</dt><dd>${progress}</dd>`
      + `<dt>Slot</dt><dd>${attempt.slot_index} of ${worker.slot_count}</dd>`
      + `<dt>Heartbeat</dt><dd>${sinceText(attempt.last_heartbeat_at)}</dd>`
      + '</dl></div>'
    : '<div class="sect"><h3>Live attempt</h3><p class="muted">No attempt on this machine right now.</p></div>';

  const body = '<tr class="runrow-body"><td colspan="11"><div class="rundetail">'
    + `<div class="wdhead"><span class="name"><svg class="ico"><use href="#i-workers"/></svg><span class="t">${worker.name}</span></span>`
    + `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`
    + `<span class="wid mono" title="Worker id as the pool reports it">wk_${worker.worker_id}</span>`
    + '<span class="wdacts"><button class="btn sm" title="Rename is the one worker mutation the API has"><svg class="ico sm"><use href="#i-pencil"/></svg>Rename</button></span></div>'
    + '<div class="grid" data-cols="2">'
    + '<div class="sect"><h3>Reported at enrolment</h3><dl class="kv">'
    + `<dt>GPU</dt><dd>${caps.gpu || NOT_REPORTED}</dd>`
    + `<dt>VRAM</dt><dd>${view.vram || NOT_REPORTED}</dd>`
    + `<dt>Driver / CUDA</dt><dd>${caps.driver || '?'} / ${caps.cuda || '?'}</dd>`
    + `<dt>Worker version</dt><dd>${worker.worker_version || NOT_REPORTED}</dd>`
    + `<dt>Slots</dt><dd>${view.used} of ${worker.slot_count} in use</dd>`
    + `<dt>Enrolled</dt><dd>${new Date(worker.enrolled_at).toISOString().slice(0, 10)}</dd>`
    + `<dt>Last heard</dt><dd>${sinceText(worker.last_seen_at)}</dd>`
    + '</dl>'
    /* Said once, here, rather than left to be inferred from a column of dashes:
       this machine is not instrumented and MARP is not asking it to be. */
    + '<p class="muted">Live load, temperature, power, clocks, CPU, system RAM and disk are not reported. '
    + 'A worker sends its capabilities once at enrolment and its attempt progress on heartbeat (gap 27).</p>'
    + '</div>'
    + live
    + '</div></div></td></tr>';

  return head + body;
}

/** Narrows, sorts and pages the pool, then draws it. */
function applyWorkersQuery() {
  const table = $('table#workers');
  if (table) table.dataset.sortsItsOwnData = 'true';
  if (!table || !workersPool) return;

  const body = $('tbody', table);
  let views = workersPool.map(workerView);

  if (workersQuery.activity) views = views.filter((v) => v.activity === workersQuery.activity);
  if (workersQuery.gpu) views = views.filter((v) => v.gpu.toLowerCase().includes(workersQuery.gpu));
  if (workersQuery.search) views = views.filter((v) => v.haystack.includes(workersQuery.search));

  const key = WORKERS_SORT_KEYS[workersQuery.sort.key] || WORKERS_SORT_KEYS.whb;
  const sign = workersQuery.sort.dir === 'ascending' ? 1 : -1;
  views.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;
    return a.worker.worker_id - b.worker.worker_id;
  });

  const total = views.length;
  const pages = Math.max(1, Math.ceil(total / workersQuery.perPage));
  if (workersQuery.page > pages) workersQuery.page = pages;
  const from = (workersQuery.page - 1) * workersQuery.perPage;
  const shown = views.slice(from, from + workersQuery.perPage);

  body.innerHTML = shown.length
    ? shown.map(workerRows).join('')
    : '<tr class="tblmsg"><td class="empty" colspan="11">No workers match these filters.</td></tr>';

  const count = $('#worker-pool .panel-hd .count');
  if (count) count.textContent = `(${total.toLocaleString()})`;

  const showing = $('#worker-pool .panel-ft > span');
  if (showing) {
    showing.innerHTML = shown.length
      ? `Showing <b class="strong">${from + 1}&ndash;${from + shown.length}</b> of ${total.toLocaleString()} workers`
      : 'No workers match these filters';
  }

  const pager = $('#worker-pool .panel-ft .pager');
  if (pager) {
    const buttons = [`<button aria-label="Previous page" data-workers-page="${workersQuery.page - 1}"${workersQuery.page === 1 ? ' disabled' : ''}><svg class="ico sm"><use href="#i-left"/></svg></button>`];
    const first = Math.max(1, Math.min(workersQuery.page - 2, pages - 4));
    for (let p = first; p <= Math.min(pages, first + 4); p++) {
      buttons.push(`<button data-workers-page="${p}"${p === workersQuery.page ? ' aria-current="page"' : ''}>${p}</button>`);
    }
    buttons.push(`<button aria-label="Next page" data-workers-page="${workersQuery.page + 1}"${workersQuery.page >= pages ? ' disabled' : ''}><svg class="ico sm"><use href="#i-right"/></svg></button>`);
    pager.innerHTML = buttons.join('');
  }

  for (const th of $$('#workers thead th.sortable')) {
    const sortKey = [...th.classList].find((c) => WORKERS_SORT_KEYS[c]);
    if (!sortKey) continue;
    if (sortKey === workersQuery.sort.key) th.setAttribute('aria-sort', workersQuery.sort.dir);
    else th.removeAttribute('aria-sort');
  }

  wireAccordions();
}

/**
 * The four headline cards, the donut and its key.
 *
 * Drawn from the same fetch as the table, because a card reading 98 busy over a
 * table holding 22 is the failure this screen already had once.
 *
 * Two of the four are about *jobs* rather than machines, so this takes both.
 *
 * @param {Object[]} workers - The pool.
 * @param {Object[]} jobs - A window of jobs, for the two queue cards.
 */
function renderWorkersSummary(workers, jobs) {
  const by = (activity) => workers.filter((w) => w.activity === activity).length;
  const busy = by('busy');
  const idle = by('idle');
  const paused = by('paused');
  const offline = by('offline');
  const total = workers.length;

  /* Reachable is everything the scheduler could still talk to, which includes a
     paused machine: paused is a decision, offline is a silence. */
  const reachable = total - offline;
  const slots = workers.reduce((sum, w) => sum + w.slot_count, 0);
  const used = workers.reduce((sum, w) => sum + (w.attempts || []).length, 0);

  const running = jobs.filter((j) => j.state === 'leased');
  const queued = jobs.filter((j) => j.state === 'queued');
  const oldestQueued = queued.reduce((oldest, j) => Math.min(oldest, Date.parse(j.created_at)), Infinity);
  const waitingMinutes = Number.isFinite(oldestQueued)
    ? Math.round((window.MarpApi._meta.NOW - oldestQueued) / 60000) : 0;

  const cards = $$('.workers-stats .stat');
  const set = (card, num, parts) => {
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.innerHTML = num;
    const sub = $('.stat-sub', card);
    if (sub) sub.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  };

  set(cards[0], `${reachable}<small>/ ${total}</small>`, [`${busy} busy`, `${idle} idle`, `${paused} paused`]);
  set(cards[1], `${used}<small>/ ${slots}</small>`, [`${Math.round((used / Math.max(1, slots)) * 100)}% used`, `${slots - used} free`]);
  /* The breakdown has to add up to the number above it. MARP has four job
     kinds and this card named two, so a diagnostic run quietly went missing
     from a sum a reader can do in their head. */
  const inferenceish = running.filter((j) => j.kind === 'inference' || j.kind === 'tracking').length;
  const trainingish = running.filter((j) => j.kind === 'training').length;
  const others = running.length - inferenceish - trainingish;
  set(cards[2], String(running.length), [
    `${inferenceish} inference`,
    `${trainingish} training`,
    ...(others ? [`${others} diagnostic`] : []),
  ]);
  set(cards[3], String(queued.length), [queued.length ? `longest waiting ${waitingMinutes}m` : 'nothing waiting']);

  /* The donut's `pathLength` is the total, so each arc's dash is simply its own
     count and nothing has to be converted into a percentage first. */
  const donut = $('.job-donut svg');
  if (donut) {
    const parts = [['inference', busy], ['done', idle], ['queued', paused], ['attention', offline]];
    let offset = 0;
    for (const [cls, value] of parts) {
      const arc = $(`.donut-part.${cls}`, donut);
      if (!arc) continue;
      arc.setAttribute('pathLength', String(total));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, total - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    }
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(total);
    const label = $('.job-donut');
    if (label) label.setAttribute('aria-label', `${total} workers: ${busy} busy, ${idle} idle, ${paused} paused and ${offline} offline`);
  }

  const key = $('.job-mix-key');
  if (key) {
    key.innerHTML = [['inference', busy, 'Busy'], ['done', idle, 'Idle'], ['queued', paused, 'Paused'], ['attention', offline, 'Offline']]
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }
}

/**
 * Fills the Workers table from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderWorkersTable() {
  /* **`table#workers`, not `#workers`.** The Inference submission form has a
     `<select id="workers">` for choosing a machine, so the bare id matched a
     dropdown on a screen that has no pool at all, passed the guard, and threw
     on its missing tbody. Every renderer here names the element it expects. */
  const table = $('table#workers');
  if (!table || !window.MarpApi) return;

  const body = $('tbody', table);
  body.innerHTML = '<tr class="tblmsg"><td class="loading" colspan="11">Loading the pool&hellip;</td></tr>';

  try {
    /* Both routes, because two of the four headline cards are about the queue
       rather than the machines. One failure state covers them: a screen that
       half-loaded would be worse than one that says it could not. */
    const [pool, jobs] = await Promise.all([
      window.MarpApi.listWorkers(),
      loadSessions().then(() => window.MarpApi.listJobs({ limit: 500 })),
    ]);

    workersPool = pool;
    renderWorkersSummary(pool, jobs.jobs);
    applyWorkersQuery();
  } catch (error) {
    body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="11">Could not load the pool (${error.status || 'no answer'}). `
      + '<button class="btn sm" type="button" id="workersRetry">Try again</button></td></tr>';
    const retry = $('#workersRetry');
    if (retry) retry.addEventListener('click', renderWorkersTable);
  }
}

/**
 * The pool's filters, sort headers and pager. Bound once.
 *
 * Nothing here refetches: `GET /gpu/workers` takes no parameters at all, so
 * every control narrows what is already in hand.
 */
function wireWorkersControls() {
  const panel = $('#worker-pool');
  if (!panel) return;

  const renarrow = () => { workersQuery.page = 1; applyWorkersQuery(); };

  const search = $('.search input', panel);
  if (search) {
    search.addEventListener('input', () => {
      workersQuery.search = search.value.trim().toLowerCase();
      renarrow();
    });
  }

  const [activitySel, gpuSel] = $$('.panel-tools select', panel);
  if (activitySel) {
    activitySel.addEventListener('change', () => {
      workersQuery.activity = { Busy: 'busy', Idle: 'idle', Paused: 'paused', Offline: 'offline' }[activitySel.value] || '';
      renarrow();
    });
  }
  if (gpuSel) {
    gpuSel.addEventListener('change', () => {
      workersQuery.gpu = gpuSel.value.startsWith('All') ? '' : gpuSel.value.toLowerCase();
      renarrow();
    });
  }

  for (const th of $$('#workers thead th.sortable', panel)) {
    const key = [...th.classList].find((c) => WORKERS_SORT_KEYS[c]);
    if (!key) continue;
    th.addEventListener('click', () => {
      if (workersQuery.sort.key === key) {
        workersQuery.sort.dir = workersQuery.sort.dir === 'ascending' ? 'descending' : 'ascending';
      } else {
        workersQuery.sort = { key, dir: 'ascending' };
      }
      workersQuery.page = 1;
      applyWorkersQuery();
    });
  }

  const pager = $('.panel-ft .pager', panel);
  if (pager) {
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-workers-page]');
      if (!button || button.disabled) return;
      workersQuery.page = Number(button.dataset.workersPage);
      applyWorkersQuery();
    });
  }

  const perPage = $('.panel-ft .rpp select', panel);
  if (perPage) {
    perPage.addEventListener('change', () => {
      workersQuery.perPage = Number(perPage.value) || 5;
      renarrow();
    });
  }
}


/**
 * The filters, the sort headers and the pager.
 *
 * Bound once. A control that changes `kind` or `state` refetches, because those
 * are the two the route can answer; everything else only re-narrows what is
 * already in hand.
 */
function wireJobsControls() {
  const panel = $('table#jobs')?.closest('.panel');
  if (!panel) return;

  const refetch = () => { jobsQuery.page = 1; renderJobsTable(); };
  const renarrow = () => { jobsQuery.page = 1; applyJobsQuery(); };

  const search = $('#filters input[type="search"]', panel);
  if (search) {
    search.addEventListener('input', () => {
      jobsQuery.search = search.value.trim().toLowerCase();
      renarrow();
    });
  }

  const [kindSel, stateSel, windowSel] = $$('#filters select', panel);

  if (kindSel) {
    kindSel.addEventListener('change', () => {
      jobsQuery.kind = { Inference: 'inference', Tracking: 'tracking', Training: 'training', Diagnostic: 'diagnostic' }[kindSel.value] || '';
      refetch();
    });
  }

  if (stateSel) {
    stateSel.addEventListener('change', () => {
      /* *Issues* is the odd one: it is derived from a batch's pieces and is not
         a state the route knows, so it cannot be a `state=` and is narrowed
         here instead. */
      const choice = stateSel.value;
      jobsQuery.issuesOnly = choice === 'Issues';
      jobsQuery.state = jobsQuery.issuesOnly ? '' : ({
        Running: 'leased', Queued: 'queued', Done: 'succeeded',
        Failed: 'failed', Cancelled: 'cancelled', Expired: 'expired',
      }[choice] || '');
      refetch();
    });
  }

  if (windowSel) {
    windowSel.addEventListener('change', () => {
      jobsQuery.windowDays = { 'Last 24 hours': 1, 'Last 7 days': 7, 'Last 30 days': 30 }[windowSel.value] || 7;
      renarrow();
    });
  }

  /* Sorting: the header and the phone strip drive the same query. */
  const sortBy = (key) => {
    if (jobsQuery.sort.key === key) {
      jobsQuery.sort.dir = jobsQuery.sort.dir === 'ascending' ? 'descending' : 'ascending';
    } else {
      jobsQuery.sort = { key, dir: key === 'hupd' ? 'descending' : 'ascending' };
    }
    jobsQuery.page = 1;
    applyJobsQuery();
  };

  for (const th of $$('#jobs thead th.sortable', panel)) {
    const key = [...th.classList].find((c) => JOBS_SORT_KEYS[c]);
    if (key) th.addEventListener('click', () => sortBy(key));
  }

  for (const button of $$('[data-sort-column]', panel)) {
    const key = JOBS_SORT_COLUMNS[Number(button.dataset.sortColumn)];
    if (key) button.addEventListener('click', () => sortBy(key));
  }

  /* The pager is rebuilt on every draw, so its clicks are taken by delegation
     rather than bound to buttons that will not exist by the time they fire. */
  const pager = $('.panel-ft .pager', panel);
  if (pager) {
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-jobs-page]');
      if (!button || button.disabled) return;
      jobsQuery.page = Number(button.dataset.jobsPage);
      applyJobsQuery();
    });
  }

  const perPage = $('.panel-ft .rpp select', panel);
  if (perPage) {
    perPage.addEventListener('change', () => {
      jobsQuery.perPage = Number(perPage.value) || 18;
      renarrow();
    });
  }
}

/**
 * Fills the Jobs table from the data layer.
 *
 * Resolves immediately and does nothing anywhere but the Jobs screen, so the
 * boot sequence can wait on it unconditionally.
 *
 * @returns {Promise<void>}
 */
async function renderJobsTable() {
  const table = $('table#jobs');
  if (!table || !window.MarpApi) return;

  const body = $('tbody', table);
  const columns = $$('thead th', table).length;
  const fill = (cls, text) => `<tr class="tblmsg"><td class="${cls}" colspan="${columns}">${text}</td></tr>`;

  /* Drawn before the await, so a slow answer reads as loading rather than as an
     empty table somebody reloads. `?mock=slow` is how to see it. */
  body.innerHTML = fill('loading', 'Loading jobs&hellip;');

  try {
    /* The two things the route *can* be asked. Everything else the screen
       offers is narrowed after this, because there is no parameter for it. */
    const ask = { limit: 500 };
    if (jobsQuery.kind) ask.kind = jobsQuery.kind;
    if (jobsQuery.state) ask.state = jobsQuery.state;

    await loadSessions();
    jobsWindow = await window.MarpApi.listJobs(ask);

    /* The cards count the window, not the page: they are about the queue, not
       about what happens to be on screen. */
    renderJobsSummary(jobsWindow.jobs);
    applyJobsQuery();
  } catch (error) {
    /* A real state, and the reason the layer can be made to fail on purpose.
       `?mock=fail:jobs` is how to see it. */
    body.innerHTML = fill('error', `Could not load jobs (${error.status || 'no answer'}). `
      + '<button class="btn sm" type="button" id="jobsRetry">Try again</button>');
    const retry = $('#jobsRetry');
    if (retry) retry.addEventListener('click', renderJobsTable);
  }
}

/**
 * Jobs keeps its complete list visible while the headline cards prioritize one
 * state. The overview history is a deterministic moving seam for later API data.
 */
function wireJobsOverview() {
  const table = $('table#jobs');
  if (!table) return;
  const body = $('tbody', table);
  const metric = (label, value, note = '') => `<div class="jobmetric"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  const plotPath = (values, max) => values.map((value, index) => `${index ? 'L' : 'M'}${(46 + 654 * index / (values.length - 1)).toFixed(1)},${(174 - 150 * value / max).toFixed(1)}`).join(' ');
  const chartGrid = '<g class="result-grid"><line x1="46" y1="24" x2="700" y2="24"/><line x1="46" y1="99" x2="700" y2="99"/><line x1="46" y1="174" x2="700" y2="174"/></g>';
  const trainingHistory = (endEpoch) => {
    const loss = [
      ['box-loss', 'Box loss', [1.78,1.53,1.31,1.15,1.01,.89,.78,.68,.59,.52,.46,.42]],
      ['cls-loss', 'Class loss', [1.42,1.19,1.01,.86,.74,.63,.55,.48,.42,.37,.33,.29]],
      ['dfl-loss', 'DFL loss', [1.66,1.48,1.31,1.18,1.07,.96,.86,.77,.69,.62,.56,.51]]
    ];
    const quality = [
      ['precision', 'Precision', [.22,.31,.39,.46,.53,.59,.64,.68,.71,.74,.76,.78]],
      ['recall', 'Recall', [.18,.25,.34,.41,.47,.54,.59,.63,.67,.69,.72,.74]],
      ['map', 'mAP@50', [.12,.20,.29,.37,.45,.52,.58,.63,.68,.71,.74,.79]],
      ['map95', 'mAP@50–95', [.06,.11,.17,.23,.29,.34,.39,.43,.46,.49,.51,.52]]
    ];
    const graph = (title, note, series, max, top, mid, aria) => `<article class="evaluation-card history-card" data-result-graph><header><div><h5>${title}</h5><p>${note}</p></div><div class="result-legend">${series.map(([key, label]) => `<button type="button" class="${key}" data-result-highlight="${key}">${label}</button>`).join('')}</div></header><div class="result-chart" role="img" aria-label="${aria}"><svg viewBox="0 0 740 205" aria-hidden="true">${chartGrid}<g class="result-axis"><text x="38" y="28">${top}</text><text x="38" y="103">${mid}</text><text x="38" y="178">0</text><text x="46" y="196">Epoch 1</text><text x="700" y="196">Epoch ${endEpoch}</text></g>${series.map(([key,, values]) => `<path class="result-line ${key}" d="${plotPath(values, max)}"/>`).join('')}</svg></div></article>`;
    return `<section class="jobresults training-results"><header class="section-heading"><div><h4>Learning dynamics</h4><p>Optimization and validation quality are separated so unlike scales never imply a relationship.</p></div></header><div class="training-history-grid">${graph('Loss components', 'Lower is better · recorded each epoch', loss, 2, '2.0', '1.0', 'Box, classification and distribution focal loss by epoch')}${graph('Validation quality', 'Held-out validation split · higher is better', quality, 1, '1.0', '.5', 'Precision, recall, mAP at 50 IoU and mAP at 50 through 95 IoU by epoch')}</div></section>`;
  };
  const completedTrainingEvaluation = () => {
    const classes = [
      { name: 'Rockfish', support: 1860, p: .88, r: .84, f1: .86, ap50: .91, ap95: .63 },
      { name: 'Flatfish', support: 1420, p: .84, r: .81, f1: .82, ap50: .87, ap95: .58 },
      { name: 'Sculpin', support: 1120, p: .82, r: .77, f1: .79, ap50: .83, ap95: .54 },
      { name: 'Lingcod', support: 880, p: .79, r: .75, f1: .77, ap50: .81, ap95: .51 },
      { name: 'Pacific cod', support: 760, p: .78, r: .72, f1: .75, ap50: .79, ap95: .49 },
      { name: 'Skate', support: 640, p: .76, r: .69, f1: .72, ap50: .76, ap95: .45 },
      { name: 'Shark', support: 410, p: .73, r: .65, f1: .69, ap50: .72, ap95: .41 },
      { name: 'Other fish', support: 2050, p: .71, r: .62, f1: .66, ap50: .68, ap95: .35 }
    ];
    const colors = classes.map((_, index) => `eval-c${index + 1}`);
    const pr = classes.map((item, index) => {
      const start = .995 - index * .008;
      const values = [start,start-.01,start-.025,start-.045,start-.07,start-.10,start-.14,start-.19,start-.26,start-.35,start-.48,.08].map((value) => Math.max(.02, value - index * .017));
      return `<path class="result-line ${colors[index]}" d="${plotPath(values, 1)}"/>`;
    }).join('');
    const legends = classes.map((item, index) => `<button type="button" class="${colors[index]}" data-result-highlight="${colors[index]}">${item.name}</button>`).join('');
    const splitCell = (value, offset) => `<td data-test="${value.toFixed(2)}" data-val="${Math.min(.99, value + offset).toFixed(2)}" data-train="${Math.min(.99, value + offset * 2.2).toFixed(2)}">${value.toFixed(2)}</td>`;
    const classRows = classes.map((item) => `<tr><th scope="row">${item.name}</th><td>${item.support.toLocaleString('en-US')}</td>${splitCell(item.p,.02)}${splitCell(item.r,.025)}${splitCell(item.f1,.022)}${splitCell(item.ap50,.018)}${splitCell(item.ap95,.024)}</tr>`).join('');
    const matrix = classes.map((actual, row) => {
      const diagonal = [.89,.85,.82,.79,.77,.74,.70,.67][row];
      const rest = (1 - diagonal) / 7;
      return `<b>${actual.name}</b>${classes.map((_, col) => {
        const norm = col === row ? diagonal : rest * (1 + ((row + col) % 3 - 1) * .28);
        const count = Math.round(actual.support * norm);
        return `<i style="--heat:${Math.max(.04, norm).toFixed(2)}" data-norm="${Math.round(norm * 100)}%" data-count="${count.toLocaleString('en-US')}">${Math.round(norm * 100)}%</i>`;
      }).join('')}`;
    }).join('');
    const balance = classes.map((item, index) => {
      const max = 2050;
      return `<div class="balance-row"><b>${item.name}</b><span><i class="train" style="width:${Math.round(item.support / max * 100)}%"></i><i class="val" style="width:${Math.round(item.support * .22 / max * 100)}%"></i><i class="test" style="width:${Math.round(item.support * .16 / max * 100)}%"></i></span><strong>${item.support.toLocaleString('en-US')}</strong></div>`;
    }).join('');
    return `<section class="training-evaluation" data-training-evaluation><header><div><h4>Final evaluation</h4><p><span data-split-label>Test</span> split · best checkpoint at epoch 94</p></div><div class="seg eval-splits" aria-label="Evaluation split"><button type="button" data-eval-split="train">Train</button><button type="button" data-eval-split="val">Validation</button><button type="button" class="on" data-eval-split="test" aria-pressed="true">Test</button></div></header><div class="evaluation-metrics">${metric('Macro F1', '0.78', '8 classes')}${metric('Precision', '0.81')}${metric('Recall', '0.76')}${metric('mAP@50', '0.79')}${metric('mAP@50–95', '0.52')}${metric('Best checkpoint', 'Epoch 94', 'last: epoch 100')}</div><div class="eval-tabs" role="tablist" aria-label="Evaluation views"><button type="button" class="on" role="tab" data-eval-tab="classes" aria-selected="true">Per-class quality</button><button type="button" role="tab" data-eval-tab="thresholds" aria-selected="false">Thresholds</button><button type="button" role="tab" data-eval-tab="confusion" aria-selected="false">Confusion matrix</button><button type="button" role="tab" data-eval-tab="balance" aria-selected="false">Class balance</button></div><div class="eval-view" data-eval-view="classes"><div class="class-metrics-wrap"><table class="class-metrics"><thead><tr><th>Class</th><th>Support</th><th>Precision</th><th>Recall</th><th>F1</th><th>AP@50</th><th>AP@50–95</th></tr></thead><tbody>${classRows}</tbody></table></div><article class="evaluation-card" data-result-graph><header><div><h5>Per-class precision–recall</h5><p>Eight classes · legend labels isolate individual curves</p></div><div class="result-legend eight-class">${legends}</div></header><div class="result-chart" role="img" aria-label="Precision recall curves for eight fish classes on the test split"><svg viewBox="0 0 740 205" aria-hidden="true">${chartGrid}<g class="result-axis"><text x="38" y="28">1.0</text><text x="38" y="103">.5</text><text x="38" y="178">0</text><text x="46" y="196">Recall 0</text><text x="700" y="196">Recall 1</text></g>${pr}</svg></div></article></div><div class="eval-view" data-eval-view="thresholds" hidden><article class="evaluation-card" data-result-graph><header><div><h5>Operating threshold</h5><p>Best macro F1 is 0.78 at confidence 0.61</p></div><div class="result-legend"><button type="button" class="precision" data-result-highlight="precision">Precision</button><button type="button" class="recall" data-result-highlight="recall">Recall</button><button type="button" class="f1-score" data-result-highlight="f1-score">F1</button></div></header><div class="result-chart" role="img" aria-label="Precision, recall and F1 by confidence threshold"><svg viewBox="0 0 740 205" aria-hidden="true">${chartGrid}<g class="result-axis"><text x="38" y="28">1.0</text><text x="38" y="103">.5</text><text x="38" y="178">0</text><text x="46" y="196">Confidence 0</text><text x="700" y="196">Confidence 1</text></g><path class="result-line precision" d="${plotPath([.31,.39,.47,.55,.63,.71,.78,.84,.89,.93,.96,.99],1)}"/><path class="result-line recall" d="${plotPath([.98,.96,.93,.89,.85,.80,.74,.66,.56,.43,.27,.06],1)}"/><path class="result-line f1-score" d="${plotPath([.47,.55,.62,.68,.72,.76,.78,.77,.69,.59,.42,.11],1)}"/><line class="threshold-mark" x1="445" y1="24" x2="445" y2="174"/><text class="threshold-label" x="451" y="38">chosen .61</text></svg></div></article></div><div class="eval-view" data-eval-view="confusion" hidden><article class="evaluation-card matrix-card"><header><div><h5>Confusion matrix</h5><p>Rows are actual class; columns are predicted class</p></div><div class="seg matrix-modes" aria-label="Confusion matrix values"><button type="button" class="on" data-matrix-mode="norm" aria-pressed="true">Normalized</button><button type="button" data-matrix-mode="count">Counts</button></div></header><div class="matrix-scroll"><div class="confusion eight" role="img" aria-label="Eight-class confusion matrix"><span></span>${classes.map((item) => `<b>${item.name}</b>`).join('')}${matrix}</div></div></article></div><div class="eval-view" data-eval-view="balance" hidden><article class="evaluation-card balance-card"><header><div><h5>Class balance</h5><p>Samples by class and dataset split</p></div><div class="balance-key"><span class="train">Train</span><span class="val">Validation</span><span class="test">Test</span></div></header><div class="balance-chart">${balance}</div></article></div><footer class="evaluation-artifacts"><div><b>Selected model</b><span>best.pt · epoch 94 · fitness 0.736</span></div><div><b>Last checkpoint</b><span>last.pt · epoch 100 · mAP@50–95 0.50</span></div><button class="btn sm" type="button">Weights &amp; plots</button><button class="btn sm" type="button">Hyperparameters</button></footer></section>`;
  };

  /* **A dataset build is not a GPU job**, settled 2026-10-14 in #128. Six of
     them used to be prepended here, hand-written, because the design treated
     dataset construction as first-class work in *this* queue. The dashboard
     still builds datasets -- that work is real and the Datasets screen owns it
     -- but it is not a `gpu_jobs` row and the inference worker never leases
     one. MARP's job kinds are inference, tracking, training and diagnostic, so
     nothing could ever have filled these rows, and they made the headline cards
     disagree with the table beneath them: 18 running against 20. See gap 19. */

  /* The expanded row is the complete job view. Shared identity stays stable,
     while the operational facts change with type and state. */
  $$('tr[data-job]', body).forEach((head) => {
    /* **Decorate a row once.** `applyJobsQuery` calls this on every re-render
       and the boot calls it too, so eighteen jobs grew thirty-six detail rows
       -- two apiece, the second one unreachable behind the first. Guarding here
       rather than fixing the call order, because the next caller would make the
       same mistake and this is the place that can refuse. */
    if (head.classList.contains('runrow-head')) return;
    head.classList.add('runrow-head');
    head.setAttribute('aria-expanded', 'false');
    const id = head.dataset.job;
    const name = $('.jname .t', head)?.textContent.trim() || `Job ${id}`;
    const type = $('.jtype', head)?.textContent.trim() || 'Job';
    const scope = $('.jscope .a', head)?.textContent.trim() || '—';
    const scopeContext = $('.jscope .b', head)?.textContent.trim() || '';
    const model = $('.jmodel .a', head)?.textContent.trim() || '—';
    const modelVersion = $('.jmodel .b', head)?.textContent.trim() || '';
    const state = $('.jstatus [data-state]', head)?.dataset.state || 'queued';

    /* Real facts about this job, carried on the row by `rowFor`. Every one of
       these was previously a constant written into the detail template, so each
       expanded job claimed the same submitter, the same priority and the same
       attempt policy whatever it actually had. */
    const attemptsMade = Number(head.dataset.attempts) || 0;
    const maxAttempts = Number(head.dataset.maxAttempts) || 0;
    const priority = head.dataset.priority || '0';
    const machinesTried = Number(head.dataset.workersUsed) || 0;

    const ranOn = head.dataset.worker
      ? head.dataset.worker
      : '<span class="faint">Never leased</span>';

    const machines = machinesTried > 1
      ? `${machinesTried} <span class="faint">· retried elsewhere</span>`
      : (machinesTried === 1 ? '1' : '<span class="faint">None</span>');

    /* `created_by` is a user id, and null when an application token submitted
       the job -- which is most of them, because the worker pipeline does. */
    const submittedBy = head.dataset.by
      ? (USERS.get(Number(head.dataset.by))?.name
        || USERS.get(Number(head.dataset.by))?.username
        || `User ${head.dataset.by}`)
      : '<span class="faint">An application token</span>';
    const status = $('.jstatus', head)?.textContent.trim() || 'Queued';
    const progress = $('.jprog', head)?.textContent.trim() || 'Not started';
    const progressValue = Number($('.jprog', head)?.dataset.sort);
    const submitted = $('.jtime', head)?.textContent.trim().replace(/\s+/g, ' ') || '—';
    const isTraining = type.toLowerCase() === 'training';
    const isDatasetBuild = type.toLowerCase() === 'dataset build';

    /* The dataset this build produced, as a link into the screen that owns it. The
       receiver on that side expands the row it lands on, so the reader arrives at the
       composition rather than at a table to search. No id, no link -- the same rule the
       Dashboard's rows follow. */
    const builtDataset = head.dataset.dataset;
    const datasetLink = isDatasetBuild && builtDataset
      ? `<p class="jobdetail-dataset">Built <a href="./datasets.html?dataset=${encodeURIComponent(builtDataset)}">dataset ${escapeHtml(builtDataset)}</a></p>`
      : '';

    let operational;

    if (state === 'running' || state === 'paused' || state === 'cancelling') {
      const stateNote = state === 'paused' ? 'Paused by itravers · capacity retained'
        : state === 'cancelling' ? 'Finishing the current safe boundary'
          : 'Healthy · heartbeat 4 seconds ago';
      const measures = isDatasetBuild
        ? metric('Frames', `${Math.max(9408, Math.round((progressValue || 47) * 632))} materialized`, progress)
          + metric('Labels', `${Math.max(4100, Math.round((progressValue || 47) * 381))} written`)
          + metric('Thumbnails', `${Math.max(2800, Math.round((progressValue || 47) * 296))} cached`)
          + metric('Manifest', 'Pending', 'published only on success')
        : isTraining
        ? metric('Epoch', `${Math.max(1, Math.round((progressValue || 47) / 100 * 100))} / 100`, progress)
          + metric('mAP@50', '0.742', 'best 0.751') + metric('Validation loss', '0.318', 'falling')
          + metric('GPU', 'RTX 4090', '21.4 / 24 GB VRAM')
        : metric('Frames', `${Math.max(8604, Math.round((progressValue || 47) * 183))} / 18,300`, progress)
          + metric('Elapsed', '12m 04s') + metric('Remaining', '~13m') + metric('Throughput', '11.9 fps');
      operational = `<section class="jobstate" data-job-state="active"><div class="jobstate-title"><div><h4>${isDatasetBuild ? 'Dataset materialization' : isTraining ? 'Training progress' : 'Inference progress'}</h4><p>${stateNote}</p></div><span class="bar wide"><i style="width:${Number.isFinite(progressValue) && progressValue > 0 ? progressValue : 47}%"></i></span></div><div class="jobmetrics">${measures}</div><div class="jobworkers"><span>${isDatasetBuild ? 'Build worker' : 'Workers'}</span><b>${isDatasetBuild ? 'dataset-builder-02' : isTraining ? 'bergstrom-4090' : 'campa-lab-02 · campa-lab-04 · reef-node-11'}</b><small>${isDatasetBuild ? 'image, label, thumbnail and manifest pipeline' : isTraining ? '1 GPU · exclusive lease' : '3 active · 21 ranges total'}</small></div></section>`;
    } else if (state === 'queued') {
      const numericId = Number(String(id).replace(/\D/g, '')) || 1;
      operational = `<section class="jobstate" data-job-state="queued"><div class="jobstate-title"><div><h4>Waiting for ${isDatasetBuild ? 'a build worker' : 'compute'}</h4><p>Eligible workers are busy; this job remains ready to lease.</p></div></div><div class="jobmetrics">${metric('Queue position', `#${numericId % 4 + 1}`, 'of 8 queued')}${metric('Waiting', '8m 21s', 'submitted today')}${metric('Priority', '5', 'normal')}${metric('Requirement', isDatasetBuild ? 'Build worker' : isTraining ? '24 GB GPU' : '12 GB GPU', isDatasetBuild ? 'storage + media access' : isTraining ? 'exclusive' : 'shareable')}</div><div class="jobstate-actions"><button class="btn sm" type="button">Start when available</button><button class="btn sm" type="button">Change priority</button><button class="btn sm danger" type="button">Cancel</button></div></section>`;
    } else if (state === 'failed' || state === 'issues') {
      const issue = state === 'failed' ? (isDatasetBuild ? 'Thumbnail reads failed during materialization' : isTraining ? 'CUDA out of memory during validation' : 'Worker stopped responding') : '2 ranges exhausted their retry limit';
      const measures = isDatasetBuild
        ? metric('Materialized', '6,104 / 18,660 frames') + metric('Labels', '5,988 written')
          + metric('Partial output', 'Quarantined', 'not a usable dataset')
        : isTraining
        ? metric('Stopped', 'Epoch 37 / 100') + metric('Best mAP@50', '0.681') + metric('Checkpoint', 'Saved', 'last good epoch')
        : metric('Succeeded', '19 / 21 ranges') + metric('Affected', '2 ranges', '1,800 frames') + metric('Partial results', '386 obs', 'not yet ingested');
      operational = `<section class="jobstate" data-job-state="attention"><div class="jobstate-alert"><svg class="ico"><use href="#i-alert"/></svg><div><h4>${issue}</h4><p>${state === 'failed' ? 'The job stopped and needs an operator decision.' : 'Usable work is preserved; only failed work needs to run again.'}</p></div></div><div class="jobmetrics">${measures}${metric('Attempts', state === 'failed' ? '1 / 3' : '3 / 3')}</div><div class="jobstate-actions"><button class="btn sm" type="button">${state === 'issues' ? 'Retry failed work' : 'Retry job'}</button><button class="btn sm" type="button">Duplicate with changes</button></div></section>`;
    } else if (state === 'done') {
      const measures = isTraining
        ? metric('Registered', `${model} v1.0.3`) + metric('Best mAP@50', '0.781') + metric('Duration', '4h 18m') + metric('Checkpoint', '2.8 GB')
        : metric('Observations', '412', 'ready for review') + metric('Ranges', '21 / 21') + metric('Duration', '26m 11s') + metric('Throughput', '11.6 fps');
      operational = `<section class="jobstate" data-job-state="complete"><div class="jobstate-title"><div><h4>${isTraining ? 'Model version registered' : 'Results produced'}</h4><p>Completed cleanly; outputs are available to the rest of MARP.</p></div></div><div class="jobmetrics">${measures}</div><div class="jobstate-actions"><button class="btn sm" type="button">${isTraining ? 'Open model version' : 'Review observations'}</button><button class="btn sm" type="button">Run again</button></div></section>`;
    } else {
      operational = `<section class="jobstate" data-job-state="cancelled"><div class="jobstate-title"><div><h4>Job cancelled</h4><p>Cancelled by an operator; incomplete output was not published.</p></div></div><div class="jobmetrics">${metric('Stopped at', progress)}${metric('Cancelled by', 'itravers')}${metric('Reusable work', 'Preserved', 'completed ranges cached')}</div><div class="jobstate-actions"><button class="btn sm" type="button">Run again</button><button class="btn sm" type="button">Duplicate with changes</button></div></section>`;
    }

    let resultsPreview;
    if (state === 'queued') {
      resultsPreview = `<section class="jobresults empty"><div><h4>${isDatasetBuild ? 'Dataset output' : isTraining ? 'Training metrics' : 'Inference findings'}</h4><p>${isDatasetBuild ? 'No dataset artifacts exist until a build worker begins materialization.' : 'No result metrics exist until a worker begins this job.'}</p></div></section>`;
    } else if (isDatasetBuild) {
      resultsPreview = `<section class="jobresults dataset-build-results"><header class="section-heading"><div><h4>Dataset output so far</h4><p>Partial materialization is retained for retry but is not published as a ready dataset.</p></div></header><div class="jobmetrics">${metric('Membership', scopeContext || 'resolved')}${metric('Split', '70 / 20 / 10', 'overlap groups kept together')}${metric('Output', model, modelVersion)}${metric('Publication', state === 'failed' ? 'Blocked' : 'Pending', 'ready only after success')}</div></section>`;
    } else if (isTraining) {
      const endEpoch = state === 'done' ? 100 : Math.max(8, progressValue > 0 ? Math.round(progressValue) : 37);
      resultsPreview = trainingHistory(endEpoch);
      if (state === 'done') {
        resultsPreview += completedTrainingEvaluation();
      }
    } else {
      const family = /crab/i.test(name) ? ['Tanner crab', 'King crab', 'Hermit crab', 'Unknown crab']
        : /fish|rockfish/i.test(name) ? ['Rockfish', 'Flatfish', 'Sculpin', 'Other fish']
          : /sponge/i.test(name) ? ['Vase sponge', 'Boot sponge', 'Glass sponge', 'Other sponge']
            : ['Sea star', 'Crab', 'Anemone', 'Sponge'];
      const completeShare = state === 'done' || state === 'issues' ? 1 : Math.max(.16, progressValue > 0 ? progressValue / 100 : .37);
      const baseCounts = [146, 118, 79, 69];
      const counts = baseCounts.map((count) => Math.max(1, Math.round(count * completeShare)));
      const confidences = [91, 87, 83, 78];
      const ranges = ['84–97%', '79–94%', '72–91%', '66–88%'];
      const maxCount = Math.max(...counts);
      const classRows = family.map((label, index) => `<div class="finding-row"><b>${label}</b><span class="finding-count"><i style="width:${Math.round(counts[index] / maxCount * 100)}%"></i><strong>${counts[index]}</strong></span><span class="finding-confidence"><i style="width:${confidences[index]}%"></i><strong>${confidences[index]}%</strong><small>${ranges[index]}</small></span></div>`).join('');
      const progressSeries = [0,.06,.15,.23,.34,.46,.57,.68,.77,.86,.94,1];
      const series = baseCounts.map((count, classIndex) => progressSeries.map((share, index) => Math.round(count * completeShare * Math.max(0, share + Math.sin(index + classIndex) * .018))));
      const total = counts.reduce((sum, count) => sum + count, 0);
      resultsPreview = `<section class="jobresults inference-results"><header><div><h4>${state === 'done' ? 'Final findings' : 'Findings so far'}</h4><p>${total} detections · confidence shows median and 10–90% range</p></div><div class="result-legend classes">${family.map((label, index) => `<button type="button" class="class-${index + 1}" data-result-highlight="class-${index + 1}">${label}</button>`).join('')}</div></header><div class="inference-result-grid"><div class="finding-list"><div class="finding-head"><span>Class</span><span>Detections</span><span>Confidence</span></div>${classRows}</div><div class="result-chart" role="img" aria-label="Cumulative detections by processed range for ${family.join(', ')}"><svg viewBox="0 0 740 205" aria-hidden="true"><g class="result-grid"><line x1="46" y1="24" x2="700" y2="24"/><line x1="46" y1="99" x2="700" y2="99"/><line x1="46" y1="174" x2="700" y2="174"/></g><g class="result-axis"><text x="38" y="28">${maxCount}</text><text x="38" y="103">${Math.round(maxCount / 2)}</text><text x="38" y="178">0</text><text x="46" y="196">First range</text><text x="700" y="196">Latest range</text></g>${series.map((values, index) => `<path class="result-line class-${index + 1}" d="${plotPath(values, maxCount)}"/>`).join('')}</svg></div></div></section>`;
    }
    const expand = document.createElement('td');
    expand.className = 'ex';
    expand.innerHTML = `<button class="exbtn" type="button" aria-label="Expand ${name}"><svg class="ico sm"><use href="#i-right"/></svg></button>`;
    head.prepend(expand);

    const detail = document.createElement('tr');
    detail.className = 'runrow-body';
    detail.hidden = true;
    detail.innerHTML = `<td colspan="11"><div class="rundetail jobdetail">
      <div class="jobdetail-head"><div><b>${name}</b><span>Job ${id} · ${type}</span>${datasetLink}</div><span class="st" data-state="${state}"><span class="dot"></span>${status}</span></div>
      <div class="jobdetail-grid jobidentity">
        <dl class="kv"><dt>Job ID</dt><dd class="mono">${id}</dd><dt>Type</dt><dd>${type}</dd><dt>Scope</dt><dd>${scope}${scopeContext ? ` <span class="faint">· ${scopeContext}</span>` : ''}</dd><dt>${isDatasetBuild ? 'Build output' : 'Locked model'}</dt><dd>${model} <span class="faint">${modelVersion}</span><div class="locked">Immutable from submission</div></dd></dl>
        <dl class="kv"><dt>Submitted</dt><dd>${submitted}</dd><dt>Submitted by</dt><dd>${submittedBy}</dd><dt>Priority</dt><dd>${priority}</dd><dt>Attempt policy</dt><dd>Up to ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'}</dd></dl>
      </div>
      ${operational}
      ${resultsPreview}
      <details class="diag"><summary>Diagnostics<span class="later">Attempts, worker lease and event log</span></summary><div class="dbody">
        <dl class="kv"><dt>Attempt</dt><dd>${attemptsMade} of ${maxAttempts}</dd><dt>Ran on</dt><dd>${ranOn}</dd><dt>Machines tried</dt><dd>${machines}</dd><dt>Job ID</dt><dd class="mono">${id}</dd></dl>
        <div class="log"><div><span class="t">12:36:55</span><span class="l" data-lvl="info">info</span><span class="m">job ${id} status updated to ${status.toLowerCase()}</span></div><div><span class="t">12:36:54</span><span class="l" data-lvl="info">info</span><span class="m">worker checkpoint and lease state recorded</span></div></div>
      </div></details>
    </div></td>`;
    head.after(detail);
  });

  $$('.jobresults:not(.empty)', body).forEach((results) => {
    const topHeader = $(':scope > header', results);
    const topBody = results.classList.contains('inference-results')
      ? $(':scope > .inference-result-grid', results) : $(':scope > .result-chart', results);
    if (topHeader && topBody) {
      const group = document.createElement('div');
      group.className = 'result-group';
      group.dataset.resultGraph = '';
      results.insertBefore(group, topHeader);
      group.append(topHeader, topBody);
    }
  });

  $$('[data-result-graph]', body).forEach((results) => {
    const buttons = $$('[data-result-highlight]', results);
    const highlight = (name) => {
      const active = results.dataset.resultHighlight === name ? '' : name;
      results.dataset.resultHighlight = active;
      results.classList.toggle('is-highlighted', Boolean(active));
      $$('.result-line', results).forEach((line) => line.classList.toggle('highlighted', Boolean(active) && line.classList.contains(active)));
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.resultHighlight === active)));
    };
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', 'false');
      if (!button.title) button.title = `Highlight only ${button.textContent.trim()} on this graph; select it again or press Escape to restore every series`;
      button.addEventListener('click', () => highlight(button.dataset.resultHighlight));
    });
    results.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && results.classList.contains('is-highlighted')) {
        const selected = buttons.find((button) => button.getAttribute('aria-pressed') === 'true');
        highlight('');
        selected?.focus();
      }
    });
  });

  $$('[data-training-evaluation]', body).forEach((evaluation) => {
    const artifactItems = [
      ['Selected checkpoint', 'best.pt', '2.8 GB', 'Epoch 94 · fitness 0.736', 'Weights'],
      ['Last checkpoint', 'last.pt', '2.8 GB', 'Epoch 100 · mAP@50–95 0.50', 'Weights'],
      ['Epoch metrics', 'results.csv', '18 KB', '100 epochs · loss and validation metrics', 'Table'],
      ['Resolved arguments', 'args.yaml', '4 KB', 'Exact submitted and derived run settings', 'Config'],
      ['Evaluation plots', 'plots/', '11 files', 'PR, F1, P, R, confusion and label plots', 'Images']
    ].map(([kind, name, size, note, format], index) => `<details class="artifact-row"${index === 0 ? ' open' : ''}><summary title="${kind}: ${note}. Expand for its recorded path and availability."><span><small>${kind}</small><b>${name}</b></span><span class="artifact-format">${format}</span><strong>${size}</strong></summary><div class="artifact-detail"><p>${note}</p><dl><div><dt>Recorded path</dt><dd class="mono">runs/1739/${name}</dd></div><div><dt>Availability</dt><dd><span class="artifact-state">Recorded</span> Download route not implemented</dd></div></dl></div></details>`).join('');
    const configGroup = (title, items) => `<section class="config-group"><h6>${title}</h6><dl>${items.map(([label, value, note = '']) => `<div><dt>${label}</dt><dd>${value}${note ? `<small>${note}</small>` : ''}</dd></div>`).join('')}</dl></section>`;
    const configuration = [
      configGroup('Data', [['Dataset', 'GULF_2025_Fish_Train_v1'], ['Split', 'Train 70% · validation 20% · test 10%'], ['Training samples', '9,140'], ['Classes', '8'], ['Image policy', 'Letterbox · preserve aspect ratio']]),
      configGroup('Model & input', [['Base model', 'MARP-Fish-Det v1.1.3'], ['Architecture', 'YOLOv8l detector'], ['Input size', '1280 × 1280 px'], ['Pretrained', 'Yes · registered checkpoint'], ['Batch size', '16', 'automatic mixed precision']]),
      configGroup('Optimization', [['Epochs', '100'], ['Optimizer', 'AdamW'], ['Initial learning rate', '0.001'], ['Schedule', 'Cosine decay'], ['Weight decay', '0.0005'], ['Warm-up', '3 epochs'], ['Early stopping', '20 epochs patience']]),
      configGroup('Reproducibility & runtime', [['Seed', '42'], ['Deterministic mode', 'Enabled'], ['Worker', 'gpu-worker-03'], ['Accelerator', '2 × NVIDIA A100 80 GB'], ['Runtime', 'CUDA 12.4 · PyTorch 2.5'], ['Training package', 'Ultralytics 8.3.41']])
    ].join('');
    const footer = $('.evaluation-artifacts', evaluation);
    const drawerButtons = $$('button', footer);
    drawerButtons[0].textContent = 'Artifacts';
    drawerButtons[0].dataset.evaluationDrawerButton = 'artifacts';
    drawerButtons[1].textContent = 'Run configuration';
    drawerButtons[1].dataset.evaluationDrawerButton = 'configuration';
    drawerButtons.forEach((button) => button.setAttribute('aria-expanded', 'false'));
    footer.insertAdjacentHTML('afterend', `<div class="evaluation-drawers"><section class="evaluation-drawer" data-evaluation-drawer="artifacts" hidden><header><div><h5>Run artifacts</h5><p>Files recorded by this training run. Expand an item for provenance and availability.</p></div><button class="btn sm" type="button" data-close-evaluation-drawer aria-label="Close run artifacts">Close</button></header><div class="artifact-list">${artifactItems}</div></section><section class="evaluation-drawer" data-evaluation-drawer="configuration" hidden><header><div><h5>Resolved run configuration</h5><p>The settings the worker actually received, including derived defaults.</p></div><button class="btn sm" type="button" data-close-evaluation-drawer aria-label="Close run configuration">Close</button></header><div class="config-groups">${configuration}</div></section></div>`);
    const drawers = $$('[data-evaluation-drawer]', evaluation);
    const setDrawer = (name = '') => {
      drawers.forEach((drawer) => { drawer.hidden = drawer.dataset.evaluationDrawer !== name; });
      drawerButtons.forEach((button) => {
        const on = button.dataset.evaluationDrawerButton === name;
        button.classList.toggle('on', on);
        button.setAttribute('aria-expanded', String(on));
      });
    };
    drawerButtons.forEach((button) => button.addEventListener('click', () => {
      const name = button.dataset.evaluationDrawerButton;
      setDrawer(button.getAttribute('aria-expanded') === 'true' ? '' : name);
    }));
    $$('[data-close-evaluation-drawer]', evaluation).forEach((button) => button.addEventListener('click', () => {
      const active = drawerButtons.find((control) => control.getAttribute('aria-expanded') === 'true');
      setDrawer();
      active?.focus();
    }));
    evaluation.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawerButtons.some((button) => button.getAttribute('aria-expanded') === 'true')) {
        const active = drawerButtons.find((button) => button.getAttribute('aria-expanded') === 'true');
        setDrawer();
        active?.focus();
      }
    });

    const tabs = $$('[data-eval-tab]', evaluation);
    const views = $$('[data-eval-view]', evaluation);
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((other) => {
        const on = other === tab;
        other.classList.toggle('on', on);
        other.setAttribute('aria-selected', String(on));
      });
      views.forEach((view) => { view.hidden = view.dataset.evalView !== tab.dataset.evalTab; });
    }));

    const summaryValues = {
      test: ['0.78', '0.81', '0.76', '0.79', '0.52'],
      val: ['0.80', '0.83', '0.79', '0.81', '0.54'],
      train: ['0.85', '0.88', '0.83', '0.87', '0.61']
    };
    const splitButtons = $$('[data-eval-split]', evaluation);
    splitButtons.forEach((button) => button.addEventListener('click', () => {
      const split = button.dataset.evalSplit;
      splitButtons.forEach((other) => {
        const on = other === button;
        other.classList.toggle('on', on);
        other.setAttribute('aria-pressed', String(on));
      });
      $('[data-split-label]', evaluation).textContent = split === 'val' ? 'Validation' : split[0].toUpperCase() + split.slice(1);
      $$('.evaluation-metrics .jobmetric > b', evaluation).slice(0, 5)
        .forEach((value, index) => { value.textContent = summaryValues[split][index]; });
      $$('[data-test][data-val][data-train]', evaluation)
        .forEach((cell) => { cell.textContent = cell.dataset[split]; });
    }));

    const matrixButtons = $$('[data-matrix-mode]', evaluation);
    matrixButtons.forEach((button) => button.addEventListener('click', () => {
      const mode = button.dataset.matrixMode;
      matrixButtons.forEach((other) => {
        const on = other === button;
        other.classList.toggle('on', on);
        other.setAttribute('aria-pressed', String(on));
      });
      $$('.confusion i[data-norm]', evaluation).forEach((cell) => { cell.textContent = cell.dataset[mode]; });
    }));
  });

  const groups = () => $$('tr.runrow-head', body).map((head) => [head, head.nextElementSibling]);
  $$('[data-job-priority]').forEach((card) => {
    card.addEventListener('click', () => {
      const priority = card.dataset.jobPriority;
      const matches = (head) => {
        const state = $('.jstatus [data-state]', head)?.dataset.state;
        return priority === 'attention' ? state === 'failed' || state === 'issues' : state === priority;
      };
      const ordered = groups().map((group, index) => ({ group, index, rank: matches(group[0]) ? 0 : 1 }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index);
      ordered.forEach(({ group }) => group.forEach((row) => body.appendChild(row)));
      $$('th.sortable', table).forEach((head) => head.setAttribute('aria-sort', 'none'));
      $$('[data-sort-column]', table.closest('.panel')).forEach((control) => {
        control.setAttribute('aria-pressed', 'false');
        control.dataset.direction = 'none';
      });
      $$('[data-job-priority]').forEach((other) => other.setAttribute('aria-pressed', String(other === card)));
      card.scrollIntoView({ block: 'nearest' });
    });
  });

  /* Summary links from Inference arrive with a real destination rather than a
     decorative URL. Matching jobs move to the top but the complete queue stays
     visible, preserving the settled Jobs-page behavior. A direct job link also
     opens the same inline detail a person would reach from the row itself. */
  const requested = new URLSearchParams(window.location.search);
  const requestedJob = requested.get('job');
  const requestedType = requested.get('type');
  const requestedStatus = requested.get('status');
  if (requestedJob) {
    const head = $(`tr.runrow-head[data-job="${CSS.escape(requestedJob)}"]`, body);
    if (head?.nextElementSibling?.classList.contains('runrow-body')) {
      body.prepend(head.nextElementSibling);
      body.prepend(head);
      head.setAttribute('aria-expanded', 'true');
      head.nextElementSibling.hidden = false;
      requestAnimationFrame(() => head.scrollIntoView({ block: 'start' }));
    }
  } else if (requestedType || requestedStatus) {
    const matchesRequest = (head) => {
      const type = $('.jtype', head)?.textContent.trim().toLowerCase();
      const state = $('.jstatus [data-state]', head)?.dataset.state;
      const normalizeType = (value) => value.replaceAll('-', ' ').replace(/\s+/g, ' ').trim();
      const typeMatches = !requestedType || normalizeType(type) === normalizeType(requestedType.toLowerCase());
      const statusMatches = !requestedStatus || (requestedStatus === 'attention'
        ? state === 'failed' || state === 'issues'
        : state === requestedStatus);
      return typeMatches && statusMatches;
    };
    groups().map((group, index) => ({ group, index, rank: matchesRequest(group[0]) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .forEach(({ group }) => group.forEach((row) => body.appendChild(row)));
    const matchingCard = $(`[data-job-priority="${CSS.escape(requestedStatus || '')}"]`);
    matchingCard?.setAttribute('aria-pressed', 'true');
  }

  const root = $('[data-jobs-history]');
  if (!root) return;

  /* **This used to carry three arrays of invented numbers and animate them on a
     2.5-second timer**, which is what "updating preview" meant in the chart's
     own aria-label. It moved, so it looked alive; it was the same twenty-four
     values shuffling along.

     `GET /gpu/jobs/series` answers it properly now, out of `gpu_jobs` with
     nothing sampled: `created` is what went in, `finished` what came out, and
     `waiting` is reconstructed -- a job was waiting at an instant if it was
     created before it and had not finished by it. None of that was answerable
     until `finished_at` existed. */
  const RANGES = {
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
    '5h': { hours: 5, bucket: 'minute', label: 'the last 5 hours' },
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
  };

  const buttons = $$('[data-jobs-range]', root);
  const lines = Object.fromEntries($$('[data-jobs-line]', root).map((line) => [line.dataset.jobsLine, line]));
  const chart = $('.jobs-chart', root);
  const axis = $$('[data-jobs-axis]', root);
  let range = '5h';

  /** Fit a run of values into the chart's box. */
  const pathOf = (values, max) => values.map((value, index) =>
    `${index ? 'L' : 'M'}${(42 + 700 * index / Math.max(1, values.length - 1)).toFixed(1)},`
    + `${(198 - 174 * (value / Math.max(1, max))).toFixed(1)}`).join(' ');

  const clock = (iso) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  async function choose(next) {
    range = next;
    buttons.forEach((button) => {
      const on = button.dataset.jobsRange === range;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });

    const { hours, bucket, label } = RANGES[range];
    const until = new Date();
    const since = new Date(until.getTime() - hours * 3600 * 1000);

    try {
      const series = await window.MarpApi.jobSeries({
        since: since.toISOString(), until: until.toISOString(), bucket,
      });

      const points = series.points || [];

      if (!points.length) {
        Object.values(lines).forEach((line) => line.removeAttribute('d'));
        if (chart) chart.setAttribute('aria-label', `No job activity recorded in ${label}`);
        return;
      }

      const samples = {
        started: points.map((p) => p.created || 0),
        completed: points.map((p) => p.finished || 0),
        queued: points.map((p) => p.waiting || 0),
      };

      /* One scale for all three, so the lines can be compared by eye. */
      const peak = Math.max(...Object.values(samples).flat());

      /* **A flat line along zero is not a chart, it is a chart-shaped nothing.**
         Nothing ran in this window, and saying so is clearer than drawing three
         lines on the floor and leaving somebody to work out they are all zero. */
      if (peak === 0) {
        Object.values(lines).forEach((line) => line.removeAttribute('d'));
        axis.forEach((text) => { text.textContent = ''; });
        $$('[data-jobs-time]', root).forEach((label2) => { label2.textContent = ''; });
        if (chart) chart.setAttribute('aria-label', `No jobs submitted or finished in ${label}`);
        root.classList.add('is-quiet');
        return;
      }

      root.classList.remove('is-quiet');

      /* Round the top up to something the ticks can divide into thirds without
         repeating: a max of 1 produced an axis reading 1, 1, 0, 0. */
      const max = Math.max(3, Math.ceil(peak / 3) * 3);

      Object.entries(lines).forEach(([name, line]) => {
        if (samples[name]) line.setAttribute('d', pathOf(samples[name], max));
      });

      /* The axis is the data's range, not four numbers somebody picked. */
      axis.forEach((text, index) => {
        text.textContent = String(Math.round(max * (3 - index) / 3));
      });

      $$('[data-jobs-time]', root).forEach((label2, index) => {
        const at = [points[0], points[Math.floor(points.length / 2)], points.at(-1)][index];
        if (at) label2.textContent = index === 2 ? 'Now' : clock(at.at);
      });

      if (chart) {
        chart.setAttribute('aria-label', `Job activity over ${label}: `
          + `${samples.started.at(-1)} submitted, ${samples.completed.at(-1)} finished, `
          + `${samples.queued.at(-1)} waiting`);
      }
    } catch (error) {
      Object.values(lines).forEach((line) => line.removeAttribute('d'));
      if (chart) chart.setAttribute('aria-label', `Could not load job activity (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.jobsRange)));
  choose(range);
}

/**
 * Draw one of the operational charts from a series.
 *
 * The four charts on this app share an SVG: a left axis, a right axis, three time labels,
 * some `<path>`s keyed by name, and a run of current readings underneath. Only the data and
 * the labels differ, so the drawing lives here once rather than a fourth time.
 *
 * @param {Object} spec
 * @param {Element} spec.root - The panel.
 * @param {string} spec.prefix - The dataset prefix its markup uses: `inference`, `ops`.
 * @param {Object} spec.ranges - `{button: {since(), bucket, label}}`.
 * @param {string} spec.initial - Which range to open on.
 * @param {function(Object): Promise<Object>} spec.fetch - Given `{since, until, bucket}`, the answer.
 * @param {function(Object): Object} spec.read - Turns that answer into `{series, scales, current, quiet}`.
 * @returns {Promise<void>}
 */
async function drawSeriesChart({ root, prefix, ranges, initial, fetch: ask, read }) {
  if (!root) return;

  const camel = (name) => prefix + name[0].toUpperCase() + name.slice(1);
  const lines = Object.fromEntries($$(`[data-${prefix}-line]`, root)
    .map((l) => [l.dataset[camel('line')], l]));
  const area = $(`[data-${prefix}-area]`, root);
  const areaKey = area ? area.dataset[camel('area')] : null;
  const buttons = $$(`[data-${prefix}-range]`, root);
  const chart = $('.inference-chart, .ops-chart', root);
  const leftAxis = $$('.inference-axis.left text:not(.axis-title)', root)
    .filter((t) => !t.hasAttribute(`data-${prefix}-time`));
  const rightAxis = $$('.inference-axis.right text:not(.axis-title)', root);

  const x = (i, n) => 54 + 672 * i / Math.max(1, n - 1);
  const y = (v, max) => 196 - 168 * (v / Math.max(1, max));
  const pathOf = (values, max) => values
    .map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length).toFixed(1)},${y(v, max).toFixed(1)}`).join(' ');
  const areaOf = (values, max) => `${pathOf(values, max)} L${x(values.length - 1, values.length).toFixed(1)},196 L54,196 Z`;

  /** Ticks from however many the markup has, not from an assumed four. */
  const ticks = (nodes, top, format) => nodes.forEach((t, i) => {
    const steps = Math.max(1, nodes.length - 1);
    t.textContent = format(top * (steps - i) / steps);
  });

  const blank = () => {
    [...Object.values(lines), area].forEach((n) => n && n.removeAttribute('d'));
    leftAxis.concat(rightAxis).forEach((t) => { t.textContent = ''; });
    $$(`[data-${prefix}-time]`, root).forEach((t) => { t.textContent = ''; });
  };

  async function choose(next) {
    buttons.forEach((b) => {
      const on = b.dataset[camel('range')] === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const range = ranges[next] || ranges[initial];
    const until = new Date();
    const span = {
      since: range.since(until).toISOString(),
      until: until.toISOString(),
      bucket: range.bucket,
    };

    try {
      const answer = await ask(span);
      const { series, scales, current, quiet, points } = read(answer);

      if (quiet) {
        blank();
        root.classList.add('is-quiet');
        if (chart) chart.setAttribute('aria-label', `${range.empty || 'Nothing recorded'} in ${range.label}`);
        return;
      }

      root.classList.remove('is-quiet');

      for (const [name, values] of Object.entries(series)) {
        const max = scales[name] || 1;
        if (lines[name]) lines[name].setAttribute('d', pathOf(values, max));
        if (area && areaKey === name) area.setAttribute('d', areaOf(values, max));
      }

      /* A line the data cannot fill is left undrawn rather than flattened to
         zero: an empty track says "not recorded", a line along the floor says
         "recorded, and none". */
      for (const [name, line] of Object.entries(lines)) {
        if (!series[name]) line.removeAttribute('d');
      }

      ticks(leftAxis, scales.left ?? 1, scales.formatLeft || ((v) => String(Math.round(v))));
      ticks(rightAxis, scales.right ?? 1, scales.formatRight || ((v) => String(Math.round(v))));

      $$(`[data-${prefix}-time]`, root).forEach((t, i) => {
        const at = [points[0], points[Math.floor(points.length / 2)], points.at(-1)][i];
        if (!at) return;
        const d = new Date(at.at);
        t.textContent = i === 2 ? 'Now'
          : (range.bucket === 'day'
            ? d.toISOString().slice(5, 10)
            : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      });

      $$(`[data-${prefix}-current]`, root).forEach((node) => {
        const value = current[node.dataset[camel('current')]];
        node.textContent = value === undefined ? '' : value;
        /* An empty value hides its node rather than leaving the label beside it
           stranded: "Clears in" with no duration reads as a rendering failure. */
        node.hidden = !node.textContent;
      });

      if (chart && current.aria) chart.setAttribute('aria-label', current.aria);
    } catch (error) {
      blank();
      if (chart) chart.setAttribute('aria-label', `Could not load this chart (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset[camel('range')])));
  await choose(initial);
}

/** Thousands separated, and shortened once the numbers get long. */
function compactCount(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

/**
 * How long the queue takes to drain, at the rate it is currently going.
 *
 * Empty when it cannot be said: nothing queued is not "clears instantly", and nothing
 * being processed means the queue is not clearing at all. Both of those print nothing
 * rather than a figure, because a reader who sees a duration believes one.
 *
 * @param {number} rate - Units in the last bucket.
 * @param {number} queued - Units waiting.
 * @returns {string} A phrase, or '' when there is nothing honest to say.
 */
function clearingNote(rate, queued) {
  if (!queued) return '';
  if (!rate) return 'Not clearing';

  const minutes = Math.ceil(queued / rate);

  if (minutes < 60) return `Clears in ~${minutes} min`;

  const hours = minutes / 60;

  return hours < 48 ? `Clears in ~${Math.round(hours)} h` : `Clears in ~${Math.round(hours / 24)} days`;
}

/**
 * The Inference screen's throughput chart.
 *
 * Frames processed per minute against what is still queued. The rate is a difference
 * between kept readings of each attempt's progress -- see `GET /gpu/throughput/series`.
 *
 * **The backlog is drawn as a current figure, not a line**, and that is a decision rather
 * than an omission: MARP records what is queued now and has never recorded what was queued
 * then. Reconstructing it per bucket is possible now that progress is kept, and is worth
 * doing when somebody wants to watch a backlog grow rather than read its size.
 *
 * @returns {Promise<void>}
 */
function wireInferenceThroughput() {
  const root = $('[data-inference-activity]');
  if (!root || !$('.inference-chart svg', root)) return;

  return drawSeriesChart({
    root,
    prefix: 'inference',
    initial: '5h',
    ranges: {
      '1h': { since: (u) => new Date(u - 3600e3), bucket: 'minute', label: 'the last hour', empty: 'No frames processed' },
      '5h': { since: (u) => new Date(u - 5 * 3600e3), bucket: 'minute', label: 'the last 5 hours', empty: 'No frames processed' },
      '24h': { since: (u) => new Date(u - 24 * 3600e3), bucket: 'hour', label: 'the last 24 hours', empty: 'No frames processed' },
    },
    fetch: (span) => window.MarpApi.throughputSeries({ ...span, kind: 'inference' }),
    read: (answer) => {
      const points = answer.points || [];
      const done = points.map((p) => Number(p.units_done) || 0);
      const peak = Math.max(...done, 0);
      const unit = points.find((p) => p.unit)?.unit || 'units';
      const queued = answer.queued || { units: 0, jobs: 0 };

      return {
        points,
        quiet: !points.length || peak === 0,
        series: { throughput: done },
        scales: {
          throughput: Math.max(1, peak),
          left: Math.max(1, peak),
          right: Math.max(1, queued.units),
          formatLeft: compactCount,
          formatRight: compactCount,
        },
        current: {
          throughput: compactCount(done.at(-1)),
          backlog: compactCount(queued.units),
          aria: `Inference throughput: ${compactCount(done.at(-1))} ${unit} in the last bucket, `
            + `${compactCount(queued.units)} queued across ${queued.jobs} jobs`,
          /* How long the queue takes to drain at the rate it is going. This replaced
             "Clearing ~16k frames/min", which was a rate nothing measured -- and the
             question somebody actually has is when the backlog ends, not how fast it
             is nominally served. It assumes nothing more arrives, which the sentence
             it replaced assumed too and did not say. */
          clearing: clearingNote(done.at(-1), queued.units),
        },
      };
    },
  });
}

/**
 * The Models screen's registry chart.
 *
 * Versions registered over time, and how many of them anything actually ran.
 *
 * **`in_use` is here instead of the `preferred` line the mockup asked for.** A flag somebody
 * flips occasionally makes a poor chart; a registry filling with models nothing runs is
 * worth seeing. `DESIGN.md`, *Decisions*, 2026-10-20.
 *
 * **Cache coverage is left undrawn**, because nothing records which machine holds which
 * model. It stays on the design: it answers where a job can start without downloading
 * weights, which is a scheduling question.
 *
 * @returns {Promise<void>}
 */
function wireRegistryTrend() {
  const root = $('[data-ops-activity="models"]');
  if (!root || !$('.ops-chart svg', root)) return;

  return drawSeriesChart({
    root,
    prefix: 'ops',
    initial: '90d',
    ranges: {
      '30d': { since: (u) => new Date(u - 30 * 86400e3), bucket: 'day', label: 'the last 30 days', empty: 'No models registered' },
      '90d': { since: (u) => new Date(u - 90 * 86400e3), bucket: 'day', label: 'the last 90 days', empty: 'No models registered' },
      '1y': { since: (u) => new Date(u - 365 * 86400e3), bucket: 'day', label: 'the last year', empty: 'No models registered' },
    },
    fetch: (span) => window.MarpApi.registrySeries(span),
    read: (answer) => {
      const points = answer.points || [];
      const registered = points.map((p) => p.registered || 0);
      const inUse = points.map((p) => p.in_use || 0);
      const peak = Math.max(...registered, 0);

      return {
        points,
        quiet: !points.length || peak === 0,
        series: { registered, in_use: inUse },
        scales: {
          registered: Math.max(1, peak),
          in_use: Math.max(1, peak),
          left: Math.max(1, peak),
          right: 100,
          formatRight: () => '',
        },
        current: {
          registered: String(registered.at(-1) ?? 0),
          in_use: String(inUse.at(-1) ?? 0),
          coverage: '—',
          aria: `Model registry: ${registered.at(-1) ?? 0} versions registered, `
            + `${inUse.at(-1) ?? 0} of them run in the last bucket. Cache coverage is not recorded.`,
        },
      };
    },
  });
}

/* Training activity is operational rather than scientific: losses and mAP from
   unlike models cannot be aggregated meaningfully, while system load, running
   work, queue depth and completions can. These fixtures preserve the seam a
   later metrics endpoint or stream can feed. */
function wireTrainingActivity() {
  const root = $('[data-training-activity]');
  if (!root) return;
  const ranges = {
    '24h': {
      labels: ['24h ago', '12h ago', 'Now'],
      compute: [22, 21, 24, 28, 36, 44, 49, 53, 58, 62, 57, 51, 46, 43, 48, 55, 67, 72, 69, 64, 59, 57, 60, 61],
      running: [1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 3, 3, 2, 2, 2],
      queued: [0, 0, 1, 1, 1, 2, 2, 2, 3, 4, 4, 3, 3, 2, 2, 3, 4, 5, 5, 4, 4, 4, 3, 3],
      completed: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]
    },
    '7d': {
      labels: ['7d ago', '3.5d ago', 'Now'],
      compute: [38, 44, 51, 47, 34, 29, 42, 55, 61, 58, 43, 36, 49, 63, 69, 65, 51, 45, 57, 72, 76, 68, 54, 48, 59, 66, 63, 61],
      running: [2, 2, 3, 2, 1, 1, 2, 3, 3, 3, 2, 2, 2, 3, 4, 3, 2, 2, 3, 4, 4, 3, 3, 2, 3, 3, 2, 2],
      queued: [2, 3, 4, 3, 2, 1, 2, 3, 4, 4, 3, 2, 3, 4, 5, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 4, 3, 3],
      completed: [0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1]
    },
    '30d': {
      labels: ['30d ago', '15d ago', 'Now'],
      compute: [31, 42, 37, 48, 54, 46, 35, 29, 44, 58, 61, 53, 47, 38, 51, 64, 70, 62, 49, 41, 56, 68, 73, 66, 52, 45, 58, 67, 64, 61],
      running: [1, 2, 2, 2, 3, 2, 1, 1, 2, 3, 3, 2, 2, 2, 3, 3, 4, 3, 2, 2, 3, 4, 4, 3, 2, 2, 3, 3, 2, 2],
      queued: [1, 2, 2, 3, 4, 3, 2, 1, 2, 4, 4, 3, 3, 2, 3, 5, 5, 4, 3, 3, 4, 5, 6, 5, 4, 3, 4, 4, 3, 3],
      completed: [0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1]
    }
  };
  const buttons = $$('[data-training-range]', root);
  const lines = Object.fromEntries($$('[data-training-line]', root).map((line) => [line.dataset.trainingLine, line]));
  const area = $('[data-training-area="compute"]', root);
  const bars = $('[data-training-bars="completed"]', root);
  const chart = $('.training-chart', root);
  let range = '24h';
  let samples;
  let tick = 0;
  const coords = (values, scale) => values.map((value, index) => {
    const x = 54 + 672 * index / Math.max(1, values.length - 1);
    const y = scale === 'compute'
      ? 196 - 168 * Math.max(0, Math.min(100, value)) / 100
      : 196 - 168 * Math.max(0, Math.min(8, value)) / 8;
    return [x, y];
  });
  const pathOf = (values, scale) => coords(values, scale)
    .map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const barsOf = (values) => {
    const width = Math.min(14, 480 / values.length);
    return coords(values, 'jobs').map(([x, y], index) => values[index]
      ? `M${(x - width / 2).toFixed(1)},196 V${y.toFixed(1)} H${(x + width / 2).toFixed(1)} V196 Z`
      : '').join(' ');
  };
  const draw = () => {
    const computePath = pathOf(samples.compute, 'compute');
    lines.compute.setAttribute('d', computePath);
    lines.running.setAttribute('d', pathOf(samples.running, 'jobs'));
    lines.queued.setAttribute('d', pathOf(samples.queued, 'jobs'));
    area.setAttribute('d', `${computePath} L726,196 L54,196 Z`);
    bars.setAttribute('d', barsOf(samples.completed));
    const completed = samples.completed.reduce((sum, value) => sum + value, 0);
    $('[data-training-current="compute"]', root).textContent = `${Math.round(samples.compute.at(-1))}%`;
    $('[data-training-current="running"]', root).textContent = samples.running.at(-1);
    $('[data-training-current="queued"]', root).textContent = samples.queued.at(-1);
    $('[data-training-current="completed"]', root).textContent = completed;
    const label = `All training activity over ${range}: ${Math.round(samples.compute.at(-1))}% of GPU compute used by training, ${samples.running.at(-1)} running, ${samples.queued.at(-1)} queued and ${completed} runs completed`;
    chart.setAttribute('aria-label', label);
    chart.title = label;
  };
  const choose = (next) => {
    range = next;
    samples = Object.fromEntries(Object.entries(ranges[range])
      .filter(([name]) => name !== 'labels').map(([name, values]) => [name, [...values]]));
    buttons.forEach((button) => {
      const on = button.dataset.trainingRange === range;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    $$('[data-training-time]', root).forEach((label, index) => { label.textContent = ranges[range].labels[index]; });
    draw();
  };
  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.trainingRange)));
  const highlightButtons = $$('[data-training-highlight]', root);
  const highlight = (name = '') => {
    const active = root.dataset.highlight === name ? '' : name;
    root.dataset.highlight = active;
    root.classList.toggle('is-highlighted', Boolean(active));
    highlightButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.trainingHighlight === active)));
    $$('.training-line, .training-area, .training-bars', root).forEach((line) => line.classList.toggle('highlighted', Boolean(active) && line.classList.contains(active)));
  };
  highlightButtons.forEach((button) => {
    button.title = `Highlight only ${button.textContent.trim()} on this graph; select it again or press Escape to restore all series`;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => highlight(button.dataset.trainingHighlight));
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.classList.contains('is-highlighted')) {
      const selected = highlightButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
      highlight('');
      selected?.focus();
    }
  });
  choose(range);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const movement = [1, -2, 1, 0, 2, -1];
    window.setInterval(() => {
      samples.compute[samples.compute.length - 1] = Math.max(20, Math.min(90, samples.compute.at(-1) + movement[tick % movement.length]));
      tick += 1;
      draw();
    }, 3000);
  }
}

/**
 * The Datasets screen's Build activity chart.
 *
 * Frames extracted per bucket, against how many builds were waiting and how many finished.
 * **Two routes, because they measure two different things**, asked in parallel and drawn on
 * one pair of axes: the rate comes from `GET /gpu/throughput/series`, which differences the
 * per-minute readings in `gpu_attempt_progress`, and the counts come from
 * `GET /gpu/jobs/series`, which counts `gpu_jobs` rows and reconstructs what was waiting.
 * Both take `kind=dataset_build`, so neither sees the pool's own work.
 *
 * This panel used to say, on screen, that none of it was recorded -- true when a build was
 * not a job, and false since #268 made it one. What it drew behind that paragraph was worse:
 * an animated fixture of invented frame counts that only stayed hidden because the markup
 * had no SVG for it to find.
 *
 * **Concurrency is not drawn, and that is a decision rather than a gap.** The panel asked
 * for it, but `service/dataset-build.service.js` takes builds one at a time on purpose -- a
 * build is a second consumer of the media server the thumbnail extractor protects with a
 * concurrency ceiling -- so the number can only ever be 0 or 1 and a chart of it is a square
 * wave that tells a reader what the design already decided. The subtitle names the three
 * things this draws instead of promising a fourth. See `DESIGN.md`, *Decisions*.
 *
 * **Queue pressure is counted in builds, not in frames.** `GET /gpu/throughput/series` also
 * answers a backlog, but it measures it in units of work read out of `spec.range`, which is
 * an inference job's shape -- a build's spec carries filters, and how many frames it will
 * cut is not known until it has selected them. So that figure is always zero for a build,
 * and the honest backlog is how many builds have not finished.
 *
 * @returns {Promise<void>}
 */
function wireDatasetActivity() {
  const root = $('[data-dataset-activity]');
  /* **The guard is on the chart, not on the panel.** This threw on a missing SVG once and
     took the rest of the boot script with it, so the tables below never rendered and it
     looked like the API had failed. */
  if (!root || !$('.dataset-chart svg', root)) return;

  return drawSeriesChart({
    root,
    prefix: 'dataset',
    initial: '24h',
    ranges: {
      '24h': { since: (u) => new Date(u - 24 * 3600e3), bucket: 'hour', label: 'the last 24 hours', empty: 'No build activity' },
      '7d': { since: (u) => new Date(u - 7 * 24 * 3600e3), bucket: 'day', label: 'the last 7 days', empty: 'No build activity' },
      '30d': { since: (u) => new Date(u - 30 * 24 * 3600e3), bucket: 'day', label: 'the last 30 days', empty: 'No build activity' },
    },
    fetch: (span) => Promise.all([
      window.MarpApi.throughputSeries({ ...span, kind: 'dataset_build' }),
      window.MarpApi.jobSeries({ ...span, kind: 'dataset_build' }),
    ]).then(([rate, jobs]) => ({ rate, jobs })),
    read: ({ rate, jobs }) => {
      /* The two routes bucket the same window the same way, but only the jobs route
         generates a row per bucket -- the rate route groups what it found, so a bucket
         where nothing was extracted is simply absent. Keyed by instant and read back
         along the jobs series, so the two lines cannot slide against each other. */
      const extracted = new Map((rate.points || [])
        .map((p) => [new Date(p.at).getTime(), Number(p.units_done) || 0]));

      const points = jobs.points || [];
      const frames = points.map((p) => extracted.get(new Date(p.at).getTime()) || 0);
      const waiting = points.map((p) => Number(p.waiting) || 0);
      /* **`succeeded`, not `finished`.** A build that failed has finished, and counting it
         under a line labelled *completed* would say a dataset came out of it. The failures
         are not hidden -- *Needs attention* above counts them -- and the two numbers
         disagreeing is the point: seven builds ended here and five produced an archive. */
      const finished = points.map((p) => Number(p.succeeded) || 0);

      const peakFrames = Math.max(...frames, 0);
      const peakBuilds = Math.max(...waiting, ...finished, 0);

      /* Nothing extracted *and* nothing queued or finished. Either one alone is worth
         drawing: a build selecting its observations has cut no frames yet and is still
         activity, and a window of finished builds with no extraction in it is a window
         whose work happened earlier. */
      const quiet = !points.length || (peakFrames === 0 && peakBuilds === 0);

      /* `waiting` is reconstructed per bucket, so the current backlog is the last one
         rather than a sum -- adding them would count one waiting build once per hour it
         waited. `finished` is a count of events, so that one does sum. */
      const waitingNow = waiting.at(-1) || 0;
      const completed = finished.reduce((sum, n) => sum + n, 0);

      return {
        points,
        quiet,
        series: { rate: frames, waiting, finished },
        scales: {
          rate: Math.max(1, peakFrames),
          waiting: Math.max(1, peakBuilds),
          finished: Math.max(1, peakBuilds),
          left: Math.max(1, peakFrames),
          right: Math.max(1, peakBuilds),
          /* Rounded before formatting. The axis divides the peak into four, so a peak
             of 1,456 gives a tick of 970.666..., and `compactCount` formats a count
             rather than rounding one -- the axis read `970.667`. */
          formatLeft: (v) => compactCount(Math.round(v)),
          /* Builds are counted in ones and the axis has four ticks, so a thousands
             separator never fires and a fractional tick would be a build and a half. */
          formatRight: (v) => String(Math.round(v)),
        },
        current: {
          rate: compactCount(frames.at(-1)),
          waiting: String(waitingNow),
          finished: String(completed),
          aria: `Dataset build activity: ${compactCount(frames.at(-1))} frames extracted in the last bucket, `
            + `${waitingNow} build${waitingNow === 1 ? '' : 's'} waiting, ${completed} completed`,
          /* Said only while something is in flight, because "0 building" is what the
             cards above already say and a second copy of it is noise. */
          building: waitingNow ? `${waitingNow} in flight` : '',
        },
      };
    },
  });
}

/**
 * A range and its number box, bound both ways.
 *
 * Typing in the box has to move the handle, or the read-out is a label
 * pretending to be a control.
 */
function wireSliders() {
  $$('.slider').forEach((wrap) => {
    const range = $('input[type="range"]', wrap);
    const out = $('.slider-out', wrap);
    if (!range || !out) return;
    const push = (v) => {
      const n = Math.min(Number(range.max), Math.max(Number(range.min), Number(v) || 0));
      range.value = n;
      out.value = n;
      range.dispatchEvent(new CustomEvent('slid', { bubbles: true }));
    };
    range.addEventListener('input', () => push(range.value));
    out.addEventListener('change', () => push(out.value));
  });
}

/* ================================================= the inference form */

/**
 * The registry, fetched once per screen.
 *
 * Every model config on the page offers the same list, and a run plan can hold
 * several, so asking per config would ask the same question five times.
 */
let registryAsked = null;
const MODEL_SPECIES = new Map();

/**
 * MARP's models, once.
 *
 * @returns {Promise<Object[]>} Active models, by name. Empty if MARP would not say.
 */
function loadModels() {
  if (!registryAsked) {
    registryAsked = (window.MarpApi?.listModels?.() || Promise.resolve([]))
      /* **Active only.** `status` is what says a model is released to run; a draft
         has no weights worth sending and an archived one is retired. The thirteen
         real models here are active, and the two that are not are leftovers from a
         test run that did not clean up after itself. */
      .then((rows) => (rows || [])
        .filter((m) => m.name && m.id !== undefined && m.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name)))
      .catch(() => []);
  }

  return registryAsked;
}

/**
 * The classes one model can detect, once per model.
 *
 * @param {number} id - The model.
 * @returns {Promise<Object[]>} Its species, by common name.
 */
function loadModelSpecies(id) {
  if (!MODEL_SPECIES.has(id)) {
    MODEL_SPECIES.set(id, (window.MarpApi?.listModelSpecies?.(id) || Promise.resolve([]))
      .catch(() => []));
  }

  return MODEL_SPECIES.get(id);
}

/**
 * One empty model configuration.
 *
 * The selects open empty and are filled by {@link refreshModelConfig} once MARP has
 * answered, so a config appears the moment it is asked for rather than after a
 * round trip -- the same reason the tables draw a loading row.
 *
 * `Version` is present and disabled until there is a chain to choose from. Nothing in
 * MARP sets `parent_model_id` yet, so every chain is one long; the control says
 * "Not versioned" rather than offering a list of one, and starts working the day
 * training records a parent.
 *
 * @returns {string} The `<details>` element's markup.
 */
function modelConfigMarkup() {
  return '<details class="model-config" data-model-config>'
    + '<summary><span class="model-mark" data-model-mark></span>'
    + '<span><b data-model-name>Choose a model</b><small data-model-note></small></span>'
    + '<span class="config-state" data-config-state>Not configured</span></summary>'
    + '<div class="model-config-body">'
    + '<div class="model-fields">'
    + '<label>Model<select class="sel" data-model-pick></select></label>'
    + '<label>Version<select class="sel" data-model-version disabled></select></label>'
    + '<label>Species/classes<select class="sel" data-class-mode>'
    + '<option value="all">All species</option><option value="subset">Selected subset</option>'
    + '</select></label>'
    + '</div>'
    + '<div class="class-picker" data-class-picker hidden></div>'
    + '<details class="fold model-settings">'
    + '<summary>Inference &amp; ByteTrack settings <span class="now" data-settings-now></span></summary>'
    + '<div class="fbody settings-grid">'
    + '<label>Detection confidence<input class="inp" type="number" min="0" max="1" step="0.01" value="0.25" data-setting="conf"></label>'
    + '<label>NMS IoU<input class="inp" type="number" min="0" max="1" step="0.01" value="0.45" data-setting="iou"></label>'
    + '<label>Track threshold<input class="inp" type="number" min="0" max="1" step="0.01" value="0.30" data-setting="track"></label>'
    + '<label>Match threshold<input class="inp" type="number" min="0" max="1" step="0.01" value="0.70" data-setting="match"></label>'
    + '<label>Track buffer (frames)<input class="inp" type="number" min="1" value="240" data-setting="buffer"></label>'
    + '<label>Range size (frames)<input class="inp" type="number" min="1" value="900" data-setting="range"></label>'
    + '<label class="check"><input type="checkbox" data-setting="mot20"><span>MOT20 mode</span></label>'
    + '<label>Reduction<select class="sel" data-setting="reduction">'
    + '<option>Best frame of each track</option><option>Every detection</option></select></label>'
    + '</div></details>'
    + '<button class="text-action danger" type="button" data-remove-model>Remove model</button>'
    + '</div></details>';
}

/** The two-letter mark, from the model's own name rather than a fixed palette. */
const MODEL_MARK_TONES = ['gorg', 'star', ''];

/**
 * Fill one model configuration from MARP, and keep its summary honest.
 *
 * Called when a config is added, and again whenever its model changes -- the class
 * list and the version chain both belong to the chosen model, so neither can be
 * written once and left.
 *
 * @param {Element} config - The `[data-model-config]` element.
 * @returns {Promise<void>}
 */
async function refreshModelConfig(config) {
  const pick = $('[data-model-pick]', config);
  const models = await loadModels();

  if (!pick) return;

  if (!pick.options.length) {
    pick.innerHTML = models.length
      ? models.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')
      : '<option value="">No models registered</option>';
  }

  const id = Number(pick.value);
  const model = models.find((m) => m.id === id);
  const mark = $('[data-model-mark]', config);
  const name = $('[data-model-name]', config);
  const note = $('[data-model-note]', config);
  const state = $('[data-config-state]', config);

  if (!model) {
    if (name) name.textContent = 'No model';
    if (note) note.textContent = 'Nothing is registered to run';
    if (state) state.textContent = 'Not configured';
    return;
  }

  if (mark) {
    mark.textContent = model.name.slice(0, 1).toUpperCase();
    mark.className = `model-mark ${MODEL_MARK_TONES[model.id % MODEL_MARK_TONES.length]}`.trim();
  }

  if (name) name.textContent = model.name;

  const [versions, species] = await Promise.all([
    window.MarpApi.listModelVersions(model.id),
    loadModelSpecies(model.id),
  ]);

  const version = $('[data-model-version]', config);

  if (version) {
    /* A model is always in its own chain, so one entry means "not versioned"
       rather than "not found" -- and a picker offering a single choice is a
       control that looks broken. */
    const chain = (versions || []).filter((v) => v.id !== undefined);
    version.disabled = chain.length < 2;
    version.innerHTML = chain.length < 2
      ? '<option>Not versioned</option>'
      : chain.map((v) => `<option value="${v.id}"${v.id === model.id ? ' selected' : ''}>`
        + `${escapeHtml(v.architecture_version || v.name)}</option>`).join('');
  }

  const picker = $('[data-class-picker]', config);

  if (picker) {
    /* The list is qualified only when the model spans more than one species list,
       because a common name identifies an organism within its list and nowhere
       else -- and qualifying every row of a single-list model is just noise. */
    const lists = new Set(species.map((s) => s.species_list).filter(Boolean));
    const qualify = lists.size > 1;

    picker.innerHTML = species.length
      ? species.map((s) => `<label><input type="checkbox" checked data-species-id="${s.species_id}">`
        + `${escapeHtml(s.comname)}${qualify && s.species_list ? ` <small>${escapeHtml(s.species_list)}</small>` : ''}`
        + '</label>').join('')
      : '<span class="nodata">No classes are mapped to this model.</span>';
  }

  const mode = $('[data-class-mode]', config);
  const all = $('[data-class-mode] option[value="all"]', config);

  /* "All 1 species" is what counting without reading produces. */
  if (all) all.textContent = species.length > 1 ? `All ${species.length} species` : 'All species';

  refreshConfigSummary(config, { model, species });

  if (state) state.textContent = species.length ? 'Configured' : 'No classes';
  if (mode && !species.length) mode.value = 'all';
}

/**
 * The one-line summary under a config's name, and the settings fold's own.
 *
 * Both restate what is set below them, so both go stale the moment somebody changes
 * a number -- which is what they did: `conf .18 · match .70 · buffer 240` was markup
 * beside inputs the reader could edit.
 *
 * @param {Element} config - The `[data-model-config]` element.
 * @param {Object} [known] - `{model, species}` when the caller already has them.
 */
function refreshConfigSummary(config, known = {}) {
  const get = (setting) => $(`[data-setting="${setting}"]`, config)?.value;
  const checked = $$('[data-class-picker] input:checked', config).length;
  const total = $$('[data-class-picker] input', config).length;
  const subset = $('[data-class-mode]', config)?.value === 'subset';
  const note = $('[data-model-note]', config);
  const now = $('[data-settings-now]', config);

  if (note) {
    const version = $('[data-model-version]', config);
    const chosen = version && !version.disabled ? `${version.selectedOptions[0]?.textContent} · ` : '';
    const classes = total
      ? (subset
        ? `${checked} of ${total} ${total === 1 ? 'species' : 'species'}`
        : (total === 1 ? 'its one species' : `all ${total} species`))
      : 'no classes mapped';
    note.textContent = `${chosen}${classes} · conf ${get('conf') ?? ''}`;
  }

  /* The leading zero goes, because the fold's own line is tight and ".18" reads
     as a confidence to anybody who has used one. */
  const trim = (value) => String(value ?? '').replace(/^0(?=\.)/, '');

  if (now) now.textContent = `conf ${trim(get('conf'))} · match ${trim(get('match'))} · buffer ${get('buffer') ?? ''}`;
}

/**
 * A name for a plan nobody named, from what the plan actually is.
 *
 * The dives it covers and the date, which is what somebody looking at a job list a
 * week later wants to tell two runs apart by. Falls back to the date alone when the
 * targets carry no dive.
 *
 * @returns {string} A name made of letters, numbers, hyphen and underscore.
 */
function defaultJobName() {
  const dives = [...new Set($$('[data-target]')
    .map((t) => (t.dataset.videoDive || $('small', t)?.textContent.split(' · ')[0] || '').trim())
    .filter(Boolean))];

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const scope = dives.slice(0, 3).join('_').replace(/[^A-Za-z0-9_-]+/g, '-');

  return scope ? `${scope}_${day}` : `inference_${day}`;
}

function wireInferenceForm() {
  const run = $('#runBtn');
  if (!run) return;
  let activeGroup = $('[data-run-group]');

  /* `.video-meta`, not `.video-title`. The picker was rewritten to read the real
     Jellyfin library and these selectors were not, so every target it produced was
     titled "video" with an empty scope -- and the submitted plan said so too. */
  const choiceParts = (choice) => {
    const title = $('.video-meta b', choice)?.textContent.trim() || 'video';
    const dive = (choice.dataset.videoDive || '').trim();
    const line = $('.line-entry .inp', choice)?.value.trim();
    const mode = $('[data-video-range]', choice)?.value || 'all';
    const times = $$('.time-range .inp', choice).map((input) => input.value);
    return { id: choice.dataset.videoId, title, dive, line,
      range: mode === 'time' ? times.join('–') : 'Entire video' };
  };

  const refreshSelected = () => {
    const choices = $$('[data-video-choice]');
    choices.forEach((choice) => {
      choice.classList.toggle('is-selected', Boolean($('input[type="checkbox"]', choice)?.checked));
    });
    const count = choices.filter((choice) => $('input[type="checkbox"]', choice)?.checked).length;
    const out = $('[data-video-selected-count]');
    if (out) out.textContent = String(count);
  };

  const refreshPlan = () => {
    let totalTargets = 0;
    let totalModels = 0;
    let totalRuns = 0;
    $$('[data-run-group]').forEach((group, index) => {
      const targets = $$('[data-target]', group).length;
      const models = $$('[data-model-config]', group).length;
      totalTargets += targets;
      totalModels += models;
      totalRuns += targets * models;
      const set = (selector, value) => { const el = $(selector, group); if (el) el.textContent = String(value); };
      set('[data-target-count]', targets); set('[data-model-count]', models);
      set('[data-target-math]', targets); set('[data-model-math]', models); set('[data-run-math]', targets * models);
      const number = $('.group-number', group); if (number) number.textContent = String(index + 1);
    });
    const sub = $('#runbar .sub');
    if (sub) sub.textContent = totalRuns + ' model runs across ' + totalTargets
      + ' selected video ranges in ' + $$('[data-run-group]').length + ' run group'
      + ($$('[data-run-group]').length === 1 ? '' : 's');
    run.disabled = totalRuns === 0;
  };

  const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const targetMarkup = (parts) => '<article class="plan-target" data-target data-video-id="'
    + safe(parts.id) + '" data-video-dive="' + safe(parts.dive || '') + '"><span class="mini-thumb' + (parts.line ? '' : ' pending') + '">'
    + (parts.line ? 'L' + safe(parts.line) : '—') + '</span><span><b class="mono">' + safe(parts.title)
    + '</b><small>' + (parts.dive ? safe(parts.dive) + ' · ' : '')
    + (parts.line ? 'Line ' + safe(parts.line) : 'Line not assigned') + ' · ' + safe(parts.range)
    + '</small></span><button class="btn sm icon" type="button" data-remove-target aria-label="Remove '
    + safe(parts.title) + '">' + ico('x', 'sm') + '</button></article>';

  document.addEventListener('change', (event) => {
    const choice = event.target.closest('[data-video-choice]');
    if (choice && event.target.matches('input[type="checkbox"]')) refreshSelected();
    if (event.target.matches('[data-select-videos]')) {
      $$('[data-video-choice] > .video-select input').forEach((box) => { box.checked = event.target.checked; });
      refreshSelected();
    }
    if (event.target.matches('[data-video-range]')) {
      const range = $('[data-time-range]', event.target.closest('[data-video-choice]'));
      if (range) range.hidden = event.target.value !== 'time';
    }
    if (event.target.matches('[data-class-mode]')) {
      const config = event.target.closest('[data-model-config]');
      const picker = $('[data-class-picker]', config);
      if (picker) picker.hidden = event.target.value !== 'subset';
      refreshConfigSummary(config);
    }

    /* A model change replaces the class list and the version chain, because both
       belong to the model. Everything else only restates what is already there. */
    if (event.target.matches('[data-model-pick]')) {
      refreshModelConfig(event.target.closest('[data-model-config]'));
      return;
    }

    const config = event.target.closest('[data-model-config]');
    if (config && event.target.matches('[data-setting], [data-model-version], [data-class-picker] input')) {
      refreshConfigSummary(config);
    }
  });

  document.addEventListener('click', (event) => {
    const save = event.target.closest('[data-save-line]');
    if (save) {
      const choice = save.closest('[data-video-choice]');
      const input = $('.line-entry .inp', choice);
      if (input && input.value.trim()) {
        const state = $('.saved-line', choice); if (state) state.hidden = false;
        save.textContent = 'Saved';
      } else if (input) input.focus();
      return;
    }
    if (event.target.closest('[data-add-targets]')) {
      const list = $('[data-plan-targets]', activeGroup);
      if (!list) return;
      $$('[data-video-choice]').filter((choice) => $('input[type="checkbox"]', choice)?.checked)
        .forEach((choice) => {
          const parts = choiceParts(choice);
          if (!$('[data-target][data-video-id="' + parts.id + '"]', activeGroup)) {
            list.insertAdjacentHTML('beforeend', targetMarkup(parts));
          }
        });
      refreshPlan();
      activeGroup.scrollIntoView({ block: 'nearest' });
      return;
    }
    const removeTarget = event.target.closest('[data-remove-target]');
    if (removeTarget) { removeTarget.closest('[data-target]').remove(); refreshPlan(); return; }
    const editQuery = event.target.closest('[data-edit-query]');
    if (editQuery) { activeGroup = editQuery.closest('[data-run-group]'); $('.video-query-panel')?.scrollIntoView({ block: 'start' }); return; }
    const removeModel = event.target.closest('[data-remove-model]');
    if (removeModel) { removeModel.closest('[data-model-config]').remove(); refreshPlan(); return; }
    const addModel = event.target.closest('[data-add-model]');
    if (addModel) {
      const group = addModel.closest('[data-run-group]');
      const configs = $('[data-model-configs]', group);
      if (configs) {
        /* Built rather than cloned. It used to clone the first config and
           overwrite two strings with "MARP General Benthic v1.0.2 · all 24
           species", which is not a model MARP has ever held -- and once the
           seeded config went, there was nothing to clone at all. */
        configs.insertAdjacentHTML('beforeend', modelConfigMarkup());
        const added = configs.lastElementChild;
        added.open = true;
        refreshModelConfig(added);
      }
      refreshPlan(); return;
    }
    const removeGroup = event.target.closest('[data-remove-group]');
    if (removeGroup) {
      const group = removeGroup.closest('[data-run-group]');
      if ($$('[data-run-group]').length > 1) group.remove();
      refreshPlan(); return;
    }
    if (event.target.closest('[data-new-group]')) {
      const source = $('[data-run-group]');
      const clone = source.cloneNode(true);
      $$('[data-target], [data-model-config]', clone).forEach((el) => el.remove());
      const title = $('.run-group-head b', clone); if (title) title.textContent = 'New query group';
      const note = $('.run-group-head small', clone); if (note) note.textContent = 'Choose another project, dive, or model assignment';
      $('.run-groups').appendChild(clone); activeGroup = clone; refreshPlan();
      $('.video-query-panel')?.scrollIntoView({ block: 'start' }); return;
    }
  });

  run.addEventListener('click', () => {
    const groups = $$('[data-run-group]').map((group, index) => ({
      order: index + 1,
      targets: $$('[data-target]', group).map((target) => ({
        jellyfin_item_id: target.dataset.videoId,
        label: $('b', target)?.textContent.trim(),
        selection: $('small', target)?.textContent.trim(),
      })),
      models: $$('[data-model-config]', group).map((model) => ({
        model: $('summary b', model)?.textContent.trim(),
        summary: $('summary small', model)?.textContent.trim(),
      })),
    }));
    const spec = { kind: 'inference_plan', pipeline: 'detection_bytetrack',
      /* Blank means "name it after the plan", which is what the placeholder says.
         The box used to open pre-filled with `CAMPA_2024_Dives_0103_0125`, so every
         plan anybody submitted without noticing carried that name. */
      name: $('#jobname')?.value.trim() || defaultJobName(), groups,
      output: 'unreviewed_observations', worker_selection: $('table#workers')?.value };
    $('#specText').textContent = JSON.stringify(spec, null, 2);
    $('#specOut').hidden = false;
    $('#specOut').scrollIntoView({ block: 'nearest' });
  });

  refreshSelected();
  refreshPlan();

  /* One configuration to start with, so the panel shows the control rather than an
     empty box somebody has to guess at. The markup used to carry two, named after
     models MARP has never held. */
  const firstGroup = $('[data-run-group]');
  const configs = firstGroup && $('[data-model-configs]', firstGroup);

  if (configs && !configs.children.length) {
    configs.insertAdjacentHTML('beforeend', modelConfigMarkup());
    refreshModelConfig(configs.lastElementChild).then(refreshPlan);
  }
}

/**
 * A row that opens to its own detail. Used by Training's runs, where a person
 * wants one run's curves beside the row above rather than in a drawer that
 * hides the list.
 */
/** `Dataset` does not carry this. Distinct from "not measured yet". */
const NOT_IN_DATASET = '<span class="dash" title="Not carried by the dataset record: it has name, description, location, num_samples, num_observations, num_classes, source, status and timestamps, and nothing else (gap 16)">&mdash;</span>';

/**
 * Puts the saved datasets from `GET /api/v2/dataset` into the lifecycle table.
 *
 * The five that were written into the markup are replaced. The *builds* above
 * them are not: a build in flight has no API behind it at all (gap 19), so
 * those rows stay fixture and say so in their own detail.
 *
 * @param {Element} body - The table body.
 * @returns {Promise<void>}
 */
/**
 * Fill the dataset builder's pickers from MARP.
 *
 * Project, dive, line and model were four lists typed into the markup: `CAMPA 2024`,
 * `0123`, `L30`, `MARP-Det-v3 2.0.0`. They are not a design decision, they are data, and
 * they were wrong the moment somebody ran a survey the mockup had not heard of — a picker
 * that cannot offer the thing you want is worse than an empty one, because it looks like
 * the system does not have it.
 *
 * Dives and lines come from the sessions rather than from a route of their own: a session
 * *is* a dive and a line, and `GET /sessions` already carries both. Narrowing the dives to
 * the chosen project is deliberately not done here — that is a behaviour, and this is the
 * pass that stops the screen inventing values.
 *
 * @returns {Promise<void>}
 */
/**
 * How much promoted work there is to build from.
 *
 * The panel says promoted observations are the only eligible ones. Saying how many there
 * are turns that from a rule into a fact somebody can act on: 174 against 114,924 is the
 * difference between "query away" and "go and promote some first", and a reader who does
 * not know that spends their time narrowing filters that were never going to match.
 *
 * Silent on failure. It is context beside a rule, not the rule itself, and a sentence
 * that could not finish is better absent than carrying an error.
 *
 * @returns {Promise<void>}
 */
async function fillPromotedCount() {
  const node = $('[data-promoted-note]');

  if (!node || !window.MarpApi) return;

  try {
    const counts = await window.MarpApi.mosaicCounts({});
    const promoted = counts.promoted || 0;
    const total = counts.total || 0;

    /* Appended to the explanation rather than replacing it: the hover says what
       promotion is, and this says how much of it there is, which is the difference
       between "query away" and "go and promote some first". */
    node.title = `${node.title} ${promoted
      ? `MARP holds ${promoted.toLocaleString('en-US')} promoted of `
        + `${total.toLocaleString('en-US')} observations.`
      : 'Nothing is promoted yet, so no query here can match anything.'}`;
  } catch {
    /* Context, not the rule. */
  }
}

/**
 * The species picker: any combination, across every species list.
 *
 * It was a button that opened nothing. Isaac, trying to use it: *"i hit the species drop
 * down, and there is nothing there"*.
 *
 * **Grouped by species list, because a common name only identifies an organism within
 * one.** Two lists can both hold a "Sea star", and a picker that showed one row would be
 * asking somebody to choose between two things it had drawn identically. The facets route
 * carries `list` for exactly this reason.
 *
 * **It offers what is reachable, not the whole catalogue.** The list comes from
 * `/mosaic/observations/facets` under the filters already chosen, so every row has a count
 * and choosing any combination of them returns something. MARP holds hundreds of species
 * and 174 promoted observations; a picker listing all of them would be mostly rows that
 * match nothing, which is the failure the mosaic's own rail was designed to avoid.
 *
 * **Refilled when the other filters change**, so it never keeps offering a species that
 * the project or dive you just picked has ruled out.
 *
 * @param {Object} [filters] - The rest of the question, so the list stays reachable.
 * @returns {Promise<void>}
 */
async function fillSpeciesPicker(filters) {
  const menu = $('[data-species-menu]');
  const label = $('[data-species-label]');

  if (!menu || !window.MarpApi) return;

  /* What was already ticked, so refilling after another filter changed does not quietly
     discard a choice that is still available. */
  const held = new Set($$('input:checked', menu).map((box) => Number(box.dataset.speciesId)));

  menu.innerHTML = '<label class="nodata">Loading species…</label>';

  let species = [];

  try {
    const facets = await window.MarpApi.mosaicFacets(
      { ...(filters || {}), species: null, trainingDisposition: ['promoted'] },
      ['species']
    );

    species = facets.species || [];
  } catch (error) {
    menu.innerHTML = `<label class="nodata">Could not load species (${error.status || 'no answer'}).</label>`;
    return;
  }

  if (!species.length) {
    menu.innerHTML = '<label class="nodata">No promoted observations match the rest of this query, '
      + 'so there is no species to choose from.</label>';
    if (label) label.textContent = 'None available';
    return;
  }

  const byList = new Map();

  for (const entry of species) {
    const list = entry.list || 'Unlisted';

    if (!byList.has(list)) byList.set(list, []);

    byList.get(list).push(entry);
  }

  const lists = [...byList.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  menu.innerHTML = lists.map(([list, entries]) => {
    const rows = entries
      .sort((a, b) => String(a.label).localeCompare(String(b.label)))
      .map((entry) => {
        const on = held.size === 0 || held.has(Number(entry.value));

        return `<label><input type="checkbox" data-species-id="${entry.value}"${on ? ' checked' : ''}>`
          + `${escapeHtml(entry.label || `Species ${entry.value}`)}`
          + `<small>${Number(entry.count || 0).toLocaleString('en-US')}</small></label>`;
      }).join('');

    /* One heading per list with its own all/none, because picking "every invertebrate"
       is the move somebody actually makes and ticking nineteen boxes is not it. */
    return `<div class="species-list"><p class="species-list-head">${escapeHtml(list)}`
      + `<button type="button" class="text-action" data-species-all="${escapeHtml(list)}">all</button>`
      + `<button type="button" class="text-action" data-species-none="${escapeHtml(list)}">none</button>`
      + `</p>${rows}</div>`;
  }).join('');

  refreshSpeciesLabel();
}

/**
 * What the collapsed picker says it has chosen.
 *
 * "All species" when every box is ticked, because that is what no filter means and
 * saying "12 of 12" invites somebody to look for the twelve they are missing.
 */
function refreshSpeciesLabel() {
  const menu = $('[data-species-menu]');
  const label = $('[data-species-label]');

  if (!menu || !label) return;

  const boxes = $$('input[data-species-id]', menu);
  const picked = boxes.filter((box) => box.checked);

  if (!boxes.length) return;

  label.textContent = picked.length === boxes.length
    ? `All ${boxes.length} species`
    : (picked.length ? `${picked.length} of ${boxes.length} species` : 'No species chosen');
}

async function fillDatasetPickers() {
  const pickers = {
    dsproj: $('[data-fills="dsproj"]'),
    dsdive: $('[data-fills="dsdive"]'),
    dsline: $('[data-fills="dsline"]'),
    dsmodel: $('[data-fills="dsmodel"]'),
  };

  if (!pickers.dsproj && !pickers.dsmodel) return;

  /**
   * Append options, keeping whatever "all" choice the markup opens on.
   *
   * A plain string is its own value. `{value, label}` separates the two, which the
   * model picker needs: the mosaic filters take `ml_model_id` and only that, so a
   * picker offering names would send something the API rejects.
   */
  const add = (select, values) => {
    if (!select) return;
    const esc = (v) => String(v).replace(/"/g, '&quot;');
    select.insertAdjacentHTML('beforeend', values
      .map((v) => (typeof v === 'object'
        ? `<option value="${esc(v.value)}">${v.label}</option>`
        : `<option value="${esc(v)}">${v}</option>`)).join(''));
  };

  try {
    const [projects, models] = await Promise.all([
      window.MarpApi.listProjects(),
      window.MarpApi.listModels(),
    ]);

    await loadSessions();

    add(pickers.dsproj, projects.map((p) => p.name).filter(Boolean).sort());

    /* Distinct and sorted, because a session list repeats a dive once per line. */
    const dives = [...new Set([...SESSIONS.values()].map((s) => s.dive).filter(Boolean))].sort();
    const lines = [...new Set([...SESSIONS.values()].map((s) => s.line).filter(Boolean))].sort();

    add(pickers.dsdive, dives);
    add(pickers.dsline, lines);
    add(pickers.dsmodel, models
      .filter((m) => m.name && m.id !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ value: m.id, label: m.name })));
  } catch (error) {
    /* A picker that could not be filled says so, rather than silently offering
       only "All projects" and looking like MARP has nothing. */
    for (const select of Object.values(pickers)) {
      if (select) select.insertAdjacentHTML('beforeend', `<option disabled>Could not load (${error.status || 'no answer'})</option>`);
    }
  }
}

/* ---------------------------------------------------------------- builds */

/**
 * How long the Datasets screen waits between asking how a build is getting on.
 *
 * The runner reports once per video, and a video is minutes of extraction, so a faster
 * poll redraws a table that has not changed. Slower and the first report after
 * *selecting* -- the one that finally puts a total on screen -- arrives late enough to
 * look like nothing happened.
 */
const DATASET_POLL_MS = 5000;

/** What the runner's phases are called on screen. */
const BUILD_PHASES = { selecting: 'Selecting', extracting: 'Extracting', packaging: 'Packaging' };

/* How many frames a dataset's preview shows. Eight is two rows of four at the width the
   panel has, and enough to cover several videos once they are spread across the archive
   rather than taken from the front. */
const PREVIEW_FRAMES = 8;

/**
 * The phase, and whatever the runner said after it.
 *
 * `progress_phase` was a bare word and now carries what the build is working on --
 * `extracting 2/6 …0727_163021_Fwd`, which video of how many, trimmed from the left to
 * fit the column because the end of a Jellyfin name is the distinguishing part. Isaac
 * asked for it on 2026-10-21: he could not tell a build that was working from one that
 * was wedged.
 *
 * **Split rather than printed whole.** The pill on the table row has room for one word,
 * and a reader scanning the table wants the phase; the video belongs in the expanded
 * detail where there is a line for it. Reading the first word also means this keeps
 * working against a build that is still reporting the bare phase, which is what an API
 * that has not been restarted yet is doing.
 *
 * @param {?Object} build - The in-flight build.
 * @returns {{phase: string, detail: string}} The phase, titled, and the rest.
 */
function phaseOf(build) {
  const raw = (build && build.progress_phase) || '';
  const at = raw.indexOf(' ');
  const word = at === -1 ? raw : raw.slice(0, at);

  return {
    phase: BUILD_PHASES[word] || word,
    detail: at === -1 ? '' : raw.slice(at + 1).trim(),
  };
}

/**
 * How long since the build last said anything, which is what tells working from wedged.
 *
 * **Not how long since the screen last asked.** A poll that succeeds against a build
 * that has stopped reporting would still look alive, and the question is whether the
 * build is moving, not whether the browser is. Counted from `last_heartbeat_at`, which
 * the runner writes on every report.
 *
 * @param {?Object} build - The in-flight build.
 * @returns {string} A short phrase, or '' when nothing has reported yet.
 */
function buildReported(build) {
  if (!build || !build.last_heartbeat_at) return '';

  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(build.last_heartbeat_at)) / 1000));

  if (seconds < 90) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);

  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

/**
 * A `datasets.status` as this screen's own vocabulary, given the job building it.
 *
 * Two columns answer different halves of one question and neither answers it alone.
 * `datasets.status` is `building` from the instant a build is queued, so it cannot say
 * whether anything has started; the job's state can, and *Queued* rather than *0 frames*
 * is the difference between waiting and stuck.
 *
 * A dataset that says `building` with no job in flight keeps saying so rather than being
 * promoted to a failure. The job may have been cancelled, or finished without the row
 * catching up; either way this screen does not know which, and guessing *Needs attention*
 * would be a diagnosis it cannot make.
 *
 * @param {Object} set - The dataset row.
 * @param {?Object} build - Its in-flight build, from `GET /dataset/builds`.
 * @returns {string} One of `building`, `queued`, `attention`, `ready`, `draft`.
 */
function datasetScreenStatus(set, build) {
  /* **Only a build that is still going says what this row is.** The answer carries failed
     and cancelled builds too, for their reason -- and reading any build as *building* made
     a dead one draw a running row: an *Extracting* pill on a build that stopped an hour ago,
     with no alert under it, because the row never reached the failed branch at all. */
  if (build && build.state === 'queued') return 'queued';
  if (build && build.state === 'leased') return 'building';
  if (set.status === 'failed') return 'attention';
  if (set.status === 'building') return 'building';
  if (set.status === 'draft') return 'draft';
  return 'ready';
}

/**
 * What the FRAMES cell says, which is the whole point of #268's item 1.2.
 *
 * **A finished dataset says how many images it holds**, which is `num_samples` -- one per
 * extracted frame. That column used to be drawn under OBSERVATIONS, so a dataset built
 * from 5 observations into 333 images read as 333 observations and no frames at all,
 * exactly backwards. `num_observations` is the observation count now and this is the
 * images one.
 *
 * While a build runs, the same cell counts up instead. Three different kinds of nothing,
 * and collapsing them is what made this column useless:
 *
 * - **Queued.** Nothing has started, so there is nothing to count.
 * - **Selecting.** Running, and the total is not known yet: the runner has to resolve the
 *   observations and their videos before it can say how many frames it intends to cut,
 *   which on a large query is minutes. A reader seeing a dash here needs the phase beside
 *   it, or they conclude the build is stuck.
 * - **Never built.** A draft, or a dataset imported before MARP counted anything.
 *
 * @param {?Object} build - The in-flight build, or null.
 * @param {Object} [set] - The dataset, for the finished count.
 * @returns {{html: string, sort: number}} The cell's contents and its sort key.
 */
function buildFramesCell(build, set) {
  if (!build) {
    const images = set && set.num_samples;
    return images == null
      ? { html: NOT_IN_DATASET, sort: -1 }
      : { html: images.toLocaleString(), sort: images };
  }

  if (build.state === 'queued') {
    return { html: '<span class="dash" title="Waiting to start: no attempt has been opened">Not started</span>', sort: -1 };
  }

  const done = build.progress_done;
  const total = build.progress_total;

  if (done == null || total == null) {
    return {
      html: '<span class="dash" title="Running: the frame count is not known until selection finishes">Counting</span>',
      sort: 0,
    };
  }

  return {
    html: `${done.toLocaleString()} <span class="of">/</span> ${total.toLocaleString()}`,
    sort: done,
  };
}

/** How far along a build is, or -1 when nothing has measured anything. */
function buildPercent(build) {
  if (!build || build.state === 'queued') return -1;
  const { progress_done: done, progress_total: total } = build;
  if (done == null || !total) return -1;
  return Math.min(100, Math.round((done / total) * 100));
}

/** How long a build has been running, from the instant its attempt was opened. */
function buildElapsed(build) {
  if (!build || !build.started_at) return null;
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(build.started_at)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Put the saved datasets, and whatever is building, into the lifecycle table.
 *
 * **The six build rows that used to be prepended here were fixture.** They carried
 * invented names, invented frame counts and invented per-cent progress, and the summary
 * cards counted them -- so a screen with nothing building showed two builds in flight, and
 * a real build appeared underneath them indistinguishable from the inventions. #268 made a
 * build a `gpu_jobs` row with progress on its attempt, so there is a real answer now and
 * the fixtures are gone.
 *
 * @param {Element} body - The table body.
 * @param {Object[]} datasets - From `GET /api/v2/dataset`.
 * @param {Map<number, Object>} builds - In-flight builds by dataset id.
 * @returns {void}
 */
function fillSavedDatasets(body, datasets, builds) {
  const stamp = (iso) => {
    const d = new Date(iso);
    return `<span class="two"><span class="a">${d.toTimeString().slice(0, 5)}</span><span class="b">${d.toISOString().slice(0, 10)}</span></span>`;
  };

  /* **Newest first, which is what the column header has always claimed.** The CREATED
     header carries `aria-sort="descending"` and nothing sorted anything: the rows arrived
     in whatever order `GET /dataset` returned, which is Postgres's physical order and is
     not an order at all. A build queued a minute ago landed third. Sorted on a copy, so
     the caller's array is not reordered underneath it.

     `created_at` rather than `updated_at`: a build that reports progress touches
     `updated_at` every few seconds, so sorting on that would shuffle the table under
     somebody reading it. When it was queued is a fact that stays still. */
  const newestFirst = [...datasets].sort((a, b) => {
    const at = Date.parse(b.created_at) - Date.parse(a.created_at);

    /* Two datasets created in the same millisecond is a tie the id breaks, so the order
       is total and a re-render cannot reshuffle equal rows. */
    return at || (b.id - a.id);
  });

  body.innerHTML = newestFirst.map((set) => {
    const build = builds.get(set.id) || null;
    const frames = buildFramesCell(build, set);

    /* The real status travels on the row, so the decoration below reads what MARP says
       rather than defaulting every API row to `ready` -- which is what it did, so a
       dataset that was building drew a green *Ready* pill while it was being built. */
    return `<tr data-dataset-id="${set.id}" data-dataset-status="${datasetScreenStatus(set, build)}">`
      + `<td class="jname"><span class="name"><svg class="ico"><use href="#i-datasets"/></svg><span class="t">${set.name}</span></span></td>`
      + `<td class="jscope">${set.description || ''}</td>`
      /* **`num_observations`, not `num_samples`.** This column is headed OBSERVATIONS and
         used to be filled with the image count, which is a different and much larger
         quantity -- 5 observations became 333 images and the row said 333 observations.
         Null until a build finishes, and for every dataset built before MARP recorded
         membership at all. `toLocaleString()` on that null threw and took the whole table
         with it, which is how queueing a build from this screen first failed. */
      + `<td class="num" data-sort="${set.num_observations ?? -1}">`
      + `${set.num_observations == null ? NOT_IN_DATASET : set.num_observations.toLocaleString()}</td>`
      + `<td class="num" data-frames data-sort="${frames.sort}">${frames.html}</td>`
      + `<td class="num" data-sort="${set.num_classes ?? -1}">${set.num_classes ?? NOT_IN_DATASET}</td>`
      + `<td class="jtime" data-sort="${set.created_at}">${stamp(set.created_at)}</td>`
      + `<td class="jtime" data-sort="${set.updated_at}">${stamp(set.updated_at)}</td>`
      + '<td class="jacts"><span><button class="btn sm icon" aria-label="Open" title="Open this dataset"><svg class="ico sm"><use href="#i-eye"/></svg></button></span></td>'
      + '</tr>';
  }).join('');
}

/**
 * The four cards and the status donut.
 *
 * **All four are API facts now.** Building, queued and needing attention used to be
 * counted from the fixture rows above the table, because MARP recorded no build at all --
 * gap 19, and the cards said so. A build is a job with an attempt now, so *queued* and
 * *building* are its state and *needs attention* is `datasets.status = 'failed'`.
 *
 * @param {Object[]} datasets - From `GET /api/v2/dataset`.
 * @param {Map<number, Object>} builds - In-flight builds by dataset id.
 */
function renderDatasetsSummary(datasets, builds) {
  const states = datasets.map((set) => datasetScreenStatus(set, builds.get(set.id) || null));
  const count = (what) => states.filter((state) => state === what).length;
  const building = count('building');
  const queued = count('queued');
  const ready = count('ready');
  const attention = count('attention');
  const total = states.length;

  /* What the builds in flight are actually doing, so the card says more than a number.
     Counted rather than listed: three builds extracting is one phrase, three names is a
     card trying to be the table underneath it. */
  /* The phase alone. `progress_phase` carries which video after it, and a summary card
     is not where a Jellyfin filename goes -- it read "extracting 2/6 …0727_163021_fwd". */
  const phases = [...builds.values()]
    .filter((build) => build.state === 'leased' && build.progress_phase)
    .map((build) => phaseOf(build).phase);
  const phrase = phases.length
    ? [...new Set(phases)].map((p) => p.toLowerCase()).join(' · ')
    : 'nothing building';

  const byLabel = {};
  for (const card of $$('.stat')) {
    const label = $('.stat-lab', card);
    if (label) byLabel[label.textContent.trim()] = card;
  }
  const set = (label, num, sub) => {
    const card = byLabel[label];
    if (!card) return;
    const n = $('.stat-num', card);
    if (n) n.textContent = String(num);
    const s = $('.stat-sub', card);
    if (s) s.innerHTML = `<span>${sub}</span>`;
  };

  set('Building now', building, building ? phrase : 'nothing building');
  set('Queued builds', queued, queued ? 'waiting for the builder' : 'nothing waiting');
  set('Ready datasets', ready, 'saved in MARP');
  set('Needs attention', attention, attention ? 'builds that failed' : 'nothing failed');

  const parts = [['running', building, 'Building'], ['queued', queued, 'Queued'], ['done', ready, 'Ready'], ['failed', attention, 'Needs attention']];

  const donut = $('.job-donut svg');
  if (donut) {
    const arcs = $$('.donut-part', donut);
    let offset = 0;
    arcs.forEach((arc, index) => {
      const value = parts[index] ? parts[index][1] : 0;
      arc.setAttribute('pathLength', String(total || 1));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, (total || 1) - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    });
    const middle = $('.job-donut > span > b');
    if (middle) middle.textContent = String(total);
  }

  const legend = $('.job-mix-key');
  if (legend) {
    legend.innerHTML = parts
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }
}

/**
 * Move the numbers on the rows that are building, without rebuilding the table.
 *
 * **A full re-render every five seconds would close whatever the reader had open.** The
 * only things that move while a build runs are its frame count, its phase and how long it
 * has been going; the row set changes when a build starts or finishes, and *that* is what
 * earns a re-render. So this patches and the caller decides.
 *
 * @param {Element} body - The table body.
 * @param {Map<number, Object>} builds - In-flight builds by dataset id.
 * @returns {void}
 */
function patchBuildRows(body, builds) {
  for (const head of $$(':scope > tr[data-dataset-id]', body)) {
    const build = builds.get(Number(head.dataset.datasetId));
    /* A failed build is in this answer for its reason, which the detail drew once and
       which cannot change. Patching its row would overwrite the dashes it ends on with
       the last figures it reached, which reads as a build still going. */
    if (!build || (build.state !== 'queued' && build.state !== 'leased')) continue;

    const frames = buildFramesCell(build);
    const cell = $('[data-frames]', head);
    if (cell) {
      cell.innerHTML = frames.html;
      cell.dataset.sort = String(frames.sort);
    }

    /* The text node only. Writing `textContent` on the pill removed the dot with it, so
       the first poll after a row was drawn stopped it pulsing. */
    const pill = $('.jstatus .pill [data-pill-text]', head);
    if (pill) pill.textContent = datasetBuildLabel(head.dataset.datasetStatus, build);

    const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
      ? head.nextElementSibling : null;
    if (!detail) continue;

    const pct = buildPercent(build);
    const bar = $('.prog .bar i', detail);
    if (bar && pct >= 0) {
      bar.style.width = `${pct}%`;
      $('.prog .bar', detail)?.setAttribute('aria-valuenow', String(pct));
      const label = $('.prog .pct', detail);
      if (label) label.textContent = `${pct}%`;
    }
    const written = $('.build-frames', detail);
    if (written) written.innerHTML = `${frames.html} frames`;

    /* The same count the cell above shows, from the same answer, so the two cannot
       disagree -- which they did, because this one used to be written once. */
    const framesFact = $('[data-build-frames]', detail);
    if (framesFact) framesFact.innerHTML = frames.html;

    const phase = phaseOf(build);
    const phaseFact = $('[data-build-phase]', detail);
    if (phaseFact) phaseFact.textContent = phase.phase || NOT_STARTED_TEXT;

    /* The video row is created only when there was one to name, so a build that starts
       reporting it mid-way needs the row to arrive rather than be filled. A redraw is
       what brings it, and the phase changing is what triggers one. */
    const videoFact = $('[data-build-video]', detail);
    if (videoFact) {
      videoFact.textContent = phase.detail;
      videoFact.closest('.jobmetric').hidden = !phase.detail;
    }

    tickBuildClocks(detail, build);
  }
}

/**
 * The two figures that move on their own, between polls.
 *
 * **Both are read off instants the API already sent**, so this is a clock rather than an
 * animation: elapsed counts from the attempt's `leased_at` and *Reported* from its
 * `last_heartbeat_at`. Nothing here invents progress -- the frame count only ever moves
 * when a poll brings a new one -- but a reader watching a four-hour build needs something
 * that says the page is still alive, and *Reported* climbing past a minute is also how
 * they see that the build is not.
 *
 * @param {Element} detail - The expanded row.
 * @param {?Object} build - Its in-flight build.
 */
function tickBuildClocks(detail, build) {
  const elapsed = $('[data-build-elapsed]', detail);
  if (elapsed) elapsed.textContent = buildElapsed(build) || NOT_STARTED_TEXT;

  const reported = $('[data-build-reported]', detail);
  if (reported) reported.textContent = buildReported(build) || NOT_STARTED_TEXT;
}

/**
 * The pill for a build row: a pulsing dot while it is running, then the label.
 *
 * **The dot is the Jobs screen's, not a second one.** `.st[data-state="running"] .dot`
 * has pulsed there all along; this screen drew a bare pill, so a build that was extracting
 * looked exactly like one that had stopped. Reusing it means one answer to what *running*
 * looks like, and the reduced-motion guard comes with it.
 *
 * `leased`, not merely "has a build": a failed build keeps its last phase, and a pulsing
 * dot on it would say it is still going.
 *
 * @param {string} status - This screen's own status vocabulary.
 * @param {?Object} build - The build behind the row, if there is one.
 * @returns {string} The pill's inner HTML.
 */
/** Bytes as a person reads them. The archive is hundreds of megabytes to tens of GB. */
function archiveSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';

  const GB = 1024 ** 3;

  return n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / (1024 ** 2))} MB`;
}

/** How long a finished build took, from the two timestamps on its dataset row. */
function buildTook(set) {
  if (!set || !set.created_at || !set.updated_at) return '';

  const seconds = Math.round((Date.parse(set.updated_at) - Date.parse(set.created_at)) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 90) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);

  return minutes < 60
    ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * A row of the Build record list, or nothing at all.
 *
 * **Nothing rather than a dash with a sentence beside it.** The panel used to assert
 * "promoted observations only", "deduplicated" and "completed cleanly" next to em dashes
 * for values it did not have, about a dataset nobody had checked. A field MARP cannot
 * answer is now absent, which is the difference between not knowing and claiming.
 *
 * @param {string} label - The term.
 * @param {string} value - Already-escaped text, or '' to omit the row entirely.
 * @returns {string}
 */
function recordRow(label, value) {
  return value ? `<dt>${label}</dt><dd>${value}</dd>` : '';
}

/**
 * The split bar, drawn from what is actually in the dataset.
 *
 * It was three hardcoded widths -- 70%, 20%, 10% -- on every dataset regardless, which is
 * worse than no bar: it is a measurement nobody took, in the place a reader looks for one.
 * The real shares come from `GET /dataset/:id/composition`, which counts
 * `dataset_observations` by split.
 *
 * @param {Object[]} splits - `{split, observations}`, as the route returns them.
 * @returns {string} The bar, or '' when there is no membership recorded.
 */
function splitBar(splits) {
  const rows = (splits || []).filter((s) => Number(s.observations) > 0);
  if (!rows.length) return '';

  /* **The percentage is of images when the archive could be counted, and says so.**
     `assignSplits` balances the split on *frames* -- it measures each group as
     `last_framenum - first_framenum + 1` and fills each share by that -- so a requested
     70/20/10 is a ratio of images. This bar was drawn from observation counts, which is a
     different quantity: one observation is a span, and 164 of them became 15,020 images.
     A reader checking the bar against the ratio they asked for was comparing two
     different things with nothing saying so.

     When there is no archive to count, it falls back to observations and the label
     changes with it, rather than the same bar quietly meaning something else. */
  /* `Number(null)` is 0, not NaN, so a recorded-nothing split would have passed a bare
     `Number.isFinite` check and been drawn as zero per cent -- which is a measurement,
     and the wrong one. Null and undefined are both "not known" and are excluded first. */
  const known = (s) => s.images !== null && s.images !== undefined && Number.isFinite(Number(s.images));
  const byImages = rows.every(known);
  const unit = byImages ? 'images' : 'observations';
  const amount = (s) => Number(byImages ? s.images : s.observations);
  const total = rows.reduce((sum, s) => sum + amount(s), 0);

  if (!total) return '';
  /* The class on each band is what colours it; an unexpected split name gets the neutral
     one rather than no class at all, which would be an invisible band. */
  const tone = { train: 'tr', validation: 'va', val: 'va', eval: 'va', test: 'te' };

  const label = rows.map((s) => `${s.split} ${Math.round(amount(s) / total * 100)} per cent of ${unit}`).join(', ');
  const bands = rows.map((s) => {
    const share = Math.round(amount(s) / total * 100);

    return `<i class="${tone[s.split] || 'tr'}" style="width:${share}%"><span>${share}%</span></i>`;
  }).join('');

  /* **All three numbers per split, and the unit on every one of them.** Isaac asked for
     the percentage, the observations and the images together, and the reason they have to
     be labelled is that they disagree by two orders of magnitude -- 164 observations are
     15,020 images -- so a bare pair of numbers reads as a contradiction rather than as
     two units. The percentage carries its own unit in the caption below. */
  const legend = rows.map((s) => {
    const share = Math.round(amount(s) / total * 100);
    const images = known(s)
      ? `<b>${Number(s.images).toLocaleString()}</b> images`
      : '';

    return `<li><i class="${tone[s.split] || 'tr'}"></i><span class="splitname">${escapeHtml(s.split)}</span>`
      + `<span class="splitshare">${share}%</span>`
      + `<span class="splitof"><b>${Number(s.observations).toLocaleString()}</b> observations</span>`
      + (images ? `<span class="splitof">${images}</span>` : '')
      + '</li>';
  }).join('');

  /* `escapeHtml` on an attribute, which is the bug this had: `NOT_IN_DATASET` is markup,
     and interpolating it into `aria-label` closed the attribute early and spilled
     `train validation test split">` onto the screen as text. Nothing that reaches an
     attribute here is markup any more, and it is escaped as well. */
  return `<div class="splitbar" role="img" aria-label="${escapeHtml(label)}">${bands}</div>`
    + `<ul class="splitlegend">${legend}</ul>`
    + `<p class="hint">Percentages are of ${unit}${byImages
      ? ', which is what the builder balances the split on.'
      : " — the archive could not be counted, so these are not the ratio the build balanced on, which is images."}</p>`;
}

/**
 * The sample of frames a build cut, each with the box its label file records.
 *
 * **The box is the point, not decoration.** A frame on its own only says a picture was
 * taken out of the video; the frame with its box drawn says the label landed on the
 * animal, and the species beside it says it landed on the right one. Those are the two
 * ways a build goes quietly wrong, and neither is visible in any number on this screen.
 *
 * The boxes are YOLO: normalised to the image, with **x and y at the box centre**, which
 * is why each one is offset by half its own size here. Reading them as a top-left corner
 * draws every box down and to the right by half its width -- close enough to be believed,
 * which is what makes it worth a comment.
 *
 * @param {Object[]} frames - From `GET /dataset/:id/preview`.
 * @param {number} total - Every image in the archive, so the strip can say what it is a
 * sample of.
 * @param {number|string} datasetId - For the image URLs.
 * @param {number} limit - The sample size, which the frame positions are relative to.
 * @param {Map<number, string>} named - Class index to species name, from the composition.
 * @returns {string}
 */
function previewStrip(frames, total, datasetId, limit, named) {
  if (!frames || !frames.length) return '';

  const shots = frames.map((frame) => {
    const boxes = (frame.boxes || []).map((box) => {
      const style = `left:${((box.cx - box.w / 2) * 100).toFixed(3)}%;`
        + `top:${((box.cy - box.h / 2) * 100).toFixed(3)}%;`
        + `width:${(box.w * 100).toFixed(3)}%;height:${(box.h * 100).toFixed(3)}%`;

      return `<i class="pvbox" style="${style}"></i>`;
    }).join('');

    /* **The species goes in the caption, not on the box.** A chip drawn on the box is
       clipped by the frame's own edge for anything near it, and the real boxes here sit
       at cx 0.93 and cy 0.92 -- so the label would be missing on exactly the frames a
       reader most wants to check. Deduplicated, because a frame of nine urchins is one
       species said once. */
    const species = [...new Set((frame.boxes || [])
      .map((box) => named.get(box.class_index) || `class ${box.class_index}`))];

    /* The stem is `<video>_<frame>`, which is what identifies the picture: a reader who
       doubts a frame opens that video at that frame number and looks. */
    const where = escapeHtml(frame.stem).replace(/_(\d{8})$/, ' &middot; frame $1');

    /* Not `loading="lazy"`: these sit in a row that is collapsed until somebody opens it,
       and a lazy image revealed that way is never fetched -- the deferral never resolves,
       so the strip stays blank with nothing in the console. */
    return '<figure class="pvframe">'
      + `<span class="pvshot"><img src="/api/v2/dataset/${encodeURIComponent(datasetId)}/preview/${frame.index}?limit=${limit}"`
      + ` alt="Training frame ${escapeHtml(frame.stem)} with its label box drawn">${boxes}</span>`
      + `<figcaption><b>${escapeHtml(frame.split)}</b> ${where}`
      + (species.length ? `<em>${escapeHtml(species.join(', '))}</em>` : '<em class="none">no label</em>')
      + '</figcaption></figure>';
  }).join('');

  /* Says it is a sample, and of how many. A strip of eight pictures with no number beside
     it reads as the whole dataset, which is the mistake the old fixture strip invited. */
  const of = total > frames.length
    ? `<span class="hint">${frames.length} of ${total.toLocaleString()} images, spread across the archive.</span>`
    : `<span class="hint">All ${total.toLocaleString()} images in the archive.</span>`;

  return `<div class="pvstrip">${shots}</div>${of}`;
}

/**
 * The Cancel build button, where one was drawn.
 *
 * **Cancels the job, not the dataset.** `POST /gpu/jobs/:id/cancel` already does exactly
 * this and is kind-agnostic, so a dataset build needs no route of its own -- it writes
 * `cancelled` on the job and the runner, which polls that state once per pass, stops and
 * tidies its staging. A second route would have been a second way to say the same thing.
 *
 * **Confirmed first, because the work is the expensive part.** A build is hours of
 * extraction and the button sits beside a progress bar somebody is watching; a misclick
 * there costs the whole run. Cancelling is not destructive beyond that -- the dataset
 * returns to `draft` and can be built again -- so one confirmation is enough and nothing
 * is typed to prove intent.
 *
 * @param {Element} detail - The expanded build row.
 * @param {string} name - The dataset's name, for the confirmation.
 * @returns {void}
 */
function wireCancelBuild(detail, name) {
  const button = $('[data-cancel-build]', detail);

  if (!button) return;

  button.addEventListener('click', async () => {
    /* eslint-disable-next-line no-alert -- the app has no dialog of its own, and a
       destructive control with no confirmation at all is the worse answer. */
    if (!window.confirm(`Cancel the build of "${name}"? The frames cut so far are discarded and the dataset goes back to draft.`)) return;

    /* **Disabled and relabelled before the request, not after it.** The answer comes
       back in milliseconds but the build does not stop for another pass, so the thing
       that has to change immediately is the button -- otherwise the only feedback for
       twenty seconds is nothing happening. */
    button.disabled = true;
    button.textContent = 'Cancelling…';

    try {
      await window.MarpApi.cancelJob(button.dataset.cancelBuild);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Cancel build';

      const said = $('.hint', button.parentElement);

      if (said) said.textContent = `Could not cancel it (${error.status || 'no answer'}).`;
    }
  });
}

/**
 * The Delete control, wherever a dataset can be deleted from.
 *
 * **One definition, because it is drawn on two different panels.** A finished dataset
 * gets it in the footer beside Download; a build that failed or was cancelled gets it in
 * place of Cancel. It was written into the ready panel's footer alone to begin with,
 * which is how a failed build -- the case somebody most wants to clear -- ended up being
 * the one thing that could not be deleted.
 *
 * **Red, and last in its row**, so it is not the button a hand lands on next to Download.
 * What it takes with it is named in the confirmation rather than on the label: a button
 * cannot say "and 3.8 GB" without becoming a sentence.
 *
 * @param {Object} set - The dataset.
 * @returns {string}
 */
function deleteButton(set) {
  return `<button class="btn sm danger" type="button" data-delete-dataset="${set.id}">`
    + '<svg class="ico"><use href="#i-stop"/></svg>Delete</button>'
    + '<span class="hint" data-delete-said></span>';
}

/**
 * The Delete button on a built dataset.
 *
 * **What goes is said before it goes, with the size in it.** These archives are hundreds
 * of megabytes to several gigabytes and they are not recoverable -- there is no undo and
 * no second copy -- so the confirmation names the dataset, its contents and how much disk
 * it is about to free, rather than asking "are you sure?" about an unnamed thing.
 *
 * **A refusal is shown, not swallowed.** The route refuses a dataset a model was trained
 * from, and that refusal is the useful answer: it names the training run. The same for a
 * dataset still building, which asks for the build to be cancelled first. Both arrive as
 * 409 with the sentence already written, so this prints it rather than inventing its own.
 *
 * @param {Element} detail - The expanded row.
 * @param {Element} head - The row itself, removed with it.
 * @param {Object} set - The dataset.
 * @param {string} size - Its archive size, already formatted.
 * @returns {void}
 */
function wireDeleteDataset(detail, head, set) {
  const button = $('[data-delete-dataset]', detail);

  if (!button) return;

  button.addEventListener('click', async () => {
    /* **The size is worked out here, not passed in**, because this is called from two
       panels and only one of them had it in scope. A failed build has no archive and no
       counts at all, so every clause below can be absent at once. */
    const size = archiveSize(set && set.archive_bytes);
    const holds = [
      Number(set.num_observations) > 0 ? `${Number(set.num_observations).toLocaleString()} observations` : '',
      Number(set.num_samples) > 0 ? `${Number(set.num_samples).toLocaleString()} images` : '',
      size ? `a ${size} archive` : '',
    ].filter(Boolean);

    /* **Two different sentences, because they are two different acts.** Deleting a
       finished dataset destroys work; deleting a failed build tidies up. A confirmation
       that warned identically about both would be ignored on the one that matters -- and
       a confirmation that silently dropped its "this removes..." clause would make the
       dangerous case look like the harmless one. */
    const what = holds.length
      ? `This removes ${holds.join(', ')}.\n\nIt cannot be undone, and the archive is not kept anywhere else.`
      : 'This build recorded no images, no observations and no archive, so there is nothing'
        + ' to lose but the row itself.';

    /* eslint-disable-next-line no-alert -- the app has no dialog of its own, and a
       permanent delete with no confirmation at all is the worse answer. */
    if (!window.confirm(`Delete "${set.name}"?\n\n${what}`)) return;

    const said = $('[data-delete-said]', detail);

    button.disabled = true;
    button.textContent = 'Deleting…';

    try {
      await window.MarpApi.deleteDataset(set.id);

      /* Both rows: the dataset's own and the detail panel under it, which is a sibling
         `<tr>` rather than a child, so removing one would leave the other behind. */
      detail.remove();
      head.remove();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Delete';

      /* The server's sentence, which is the whole point of it having written one. */
      if (said) said.textContent = error.message || `Could not delete it (${error.status || 'no answer'}).`;
    }
  });
}

function datasetPillContents(status, build) {
  const dot = build && build.state === 'leased' ? '<span class="dot"></span>' : '';

  return `${dot}<span data-pill-text>${datasetBuildLabel(status, build)}</span>`;
}

/** What a build row's pill says: the phase while it runs, the state otherwise. */
function datasetBuildLabel(status, build) {
  /* `leased`, not "anything but queued". A failed build keeps the phase it died in, and
     a pill reading *Extracting* on it says it is still going. */
  if (build && build.state === 'leased' && build.progress_phase) {
    /* The phase alone. `progress_phase` carries the video after it now, and a pill in a
       table cell is not where a Jellyfin filename goes. */
    return phaseOf(build).phase;
  }
  return { building: 'Building', queued: 'Queued', attention: 'Needs attention', ready: 'Ready', draft: 'Draft' }[status] || 'Ready';
}

/** The dash a build that has not started draws, as plain text. */
const NOT_STARTED_TEXT = '—';

/**
 * Open the dataset a link asked for: `datasets.html?dataset=<id>`.
 *
 * The other half of the Dashboard's *Current and recent jobs* rows. `jobs.html` has read
 * `?job=` for a while and does exactly this — find the row, expand it, scroll to it — so
 * this is that behaviour for the screen that lists datasets rather than jobs.
 *
 * **Only once, and only if the row is there.** It runs after a full render, which also
 * happens when a build starts or finishes; re-expanding then would fight a reader who had
 * just closed the row. A dataset id that matches nothing is left alone rather than
 * reported: a link can outlive the dataset it names, and the table is still the right
 * answer to "where is it".
 *
 * @returns {void}
 */
let openedRequestedDataset = false;

function openRequestedDataset() {
  if (openedRequestedDataset) return;

  const wanted = new URLSearchParams(window.location.search).get('dataset');
  if (!wanted) return;

  const head = $(`#saved-datasets tbody tr[data-dataset-id="${CSS.escape(wanted)}"]`);
  if (!head) return;

  openedRequestedDataset = true;

  const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
    ? head.nextElementSibling : null;

  /* Expanded the way the expander does it, rather than by calling it: the row may be
     hidden by a filter the reader left set, and a click handler would toggle it shut
     if something else had already opened it. */
  head.setAttribute('aria-expanded', 'true');

  if (detail) {
    detail.hidden = false;
    /* A ready row fetches its splits and classes when it opens; this is the open. */
    if (typeof detail.loadComposition === 'function') detail.loadComposition();
  }

  /* **Scrolled twice, and the second one is the one that works.** Everything above this
     table — the pickers, the match counts, the sample thumbnails — fills in after the
     first paint and grows as it does, so a scroll on the next frame is computed against a
     layout that is about to move and leaves the page at the top. The second attempt is
     late enough to land and is skipped when the row is already in view, so a reader who
     scrolled away in the meantime is not yanked back. */
  const bring = () => head.scrollIntoView({ block: 'center' });
  const settled = () => {
    const box = head.getBoundingClientRect();
    const port = $('.content')?.clientHeight || window.innerHeight;

    if (box.top < 0 || box.bottom > port) bring();
  };

  requestAnimationFrame(bring);
  window.setTimeout(settled, 400);
}

async function wireDatasetPage() {
  const table = $('table#saved-datasets');
  if (!table) return;
  const body = $('tbody', table);

  /* The pickers do not block the table: a builder whose dropdowns are still
     filling is usable, and a saved-dataset list that waited for them would not be. */
  fillDatasetPickers();
  fillPromotedCount();
  fillSpeciesPicker();

  const samples = [
    ['/api/v2/jellyfin/items/9f66020c16c80d2800560a76d4417080/images/Primary', 'CAMPA2024 Dive 1 · 141923'],
    ['/api/v2/jellyfin/items/847c5f1034d01cf3a7aa2427fa7af4b4/images/Primary', 'CAMPA2024 Dive 1 · 154643'],
    ['/api/v2/jellyfin/items/f53860e0fbee24ceec374c12dd1f22a9/images/Primary', 'CAMPA2024 Dive 1 · 163021'],
    ['/api/v2/jellyfin/items/e8d220bb309bda85b77da70451cdb896/images/Primary', 'CAMPA2024 Dive 1 · 171404']
  ];
  const fixtures = {
    CAMPA_2024_Rockfish_v3: { task: 'Detection', format: 'YOLO bounding boxes', project: 'CAMPA 2024', queries: '3 saved query batches', groups: '1,204 overlap groups', split: '70 / 20 / 10', build: '2h 14m', size: '18.4 GB', fingerprint: 'ds-8f04c21a', classes: 'Rockfish 26% · Lingcod 21% · Canary rockfish 15%' },
    GULF_Invertebrates_v2: { task: 'Detection', format: 'YOLO bounding boxes', project: 'GULF 2025', queries: '2 saved query batches', groups: '684 overlap groups', split: '70 / 20 / 10', build: '1h 08m', size: '9.1 GB', fingerprint: 'ds-394a17ce', classes: 'Sea cucumber 31% · Red urchin 24% · Sea star 18%' },
    Baja_Seamount_Test: { task: 'Segmentation', format: 'YOLO instance polygons', project: 'GULF 2025', queries: '1 saved query batch', groups: '432 overlap groups', split: '70 / 20 / 10', build: '56m', size: '12.8 GB', fingerprint: 'ds-6bdc940f', classes: 'Sponge 29% · Coral 25% · Substrate 19%' },
    ALL_Projects_Inverts_v5: { task: 'Detection', format: 'YOLO bounding boxes', project: 'All projects', queries: '7 saved query batches', groups: '2,816 overlap groups', split: '70 / 20 / 10', build: '4h 37m', size: '26.7 GB', fingerprint: 'ds-7c15de90', classes: 'Sea cucumber 22% · Urchin 18% · Sea star 17%' },
    SALT_2024_Habitat_v2: { task: 'Classification', format: 'Class-labelled images', project: 'SALT 2024', queries: '4 saved query batches', groups: '592 source groups', split: '70 / 20 / 10', build: '1h 31m', size: '8.6 GB', fingerprint: 'ds-a8315f42', classes: 'Bedrock 28% · Mixed substrate 23% · Sand 19%' }
  };

  /**
   * Decorate the rows the API just produced: task, status, the expander and its detail.
   *
   * Run again after every re-render, because the rows are replaced rather than edited.
   *
   * @param {Map<number, Object>} builds - In-flight builds by dataset id.
   */
  const decorate = (builds, byId) => {
    for (const head of $$(':scope > tr[data-dataset-id]', body)) {
      const original = [...head.children];
      /* The dataset this row was drawn from. The detail panel reads real columns off it
         now -- the archive's hash and size, the source, the two timestamps -- and this
         loop walks DOM rows, so the row has to be able to find its own record. */
      const set = byId.get(Number(head.dataset.datasetId)) || { id: Number(head.dataset.datasetId) };
      const name = $('.jname .t', head)?.textContent.trim() || 'Saved dataset';
      const build = builds.get(Number(head.dataset.datasetId)) || null;
      const status = head.dataset.datasetStatus || 'ready';
      /* **A row from the API gets the API's own blanks, not another dataset's
         fixture.** This used to fall back to `CAMPA_2024_Rockfish_v3`, so any
         dataset the fixtures did not name borrowed that one's task, project,
         queries, overlap groups and split -- five invented facts per row, each
         of them plausible and none of them true. A `Dataset` carries `name`,
         `description`, `location`, `num_samples`, `num_classes`, `source` and
         the timestamps; everything else on this panel is gap 16. */
      const cfg = fixtures[name] || {
        /* **Not "Unassigned", which claimed somebody had failed to assign one.** The
           column means the training task -- detection, classification, segmentation --
           and `Dataset` has no column for it, so for every row that came from MARP it is
           simply not recorded. Isaac on seeing it: it makes no sense on a dataset build.
           It takes the same dash as every other field this screen cannot answer. */
        task: null,
        fromApi: true,
        format: NOT_IN_DATASET,
        project: NOT_IN_DATASET,
        queries: NOT_IN_DATASET,
        groups: NOT_IN_DATASET,
        split: NOT_IN_DATASET,
        build: NOT_IN_DATASET,
        size: NOT_IN_DATASET,
        fingerprint: NOT_IN_DATASET,
        classes: NOT_IN_DATASET,
      };
      const description = original[1]?.textContent.trim() || '';
      const observations = original[2]?.textContent.trim() || '';
      const frames = original[3]?.textContent.trim() || '';
      const classes = original[4]?.textContent.trim() || '';
      const isBuild = status === 'building' || status === 'queued' || status === 'attention';
      head.classList.add('runrow-head');
      head.dataset.search = `${name} ${description} ${cfg.project} ${status} ${build ? build.job_id : ''}`.toLowerCase();
      /* **No TASK column.** It meant the training task -- detection, classification,
         segmentation -- and `Dataset` records none, so it was a dash on every row that
         came from MARP. It said "Unassigned" before that, which claimed somebody had
         failed to assign one. Isaac, 2026-10-21: *"it'll never have a value"*, so the
         column is gone rather than better at being empty. The filter beside it went with
         it: without the cell there is no `data-dataset-task` to match, so the only thing
         it could still do is hide every row. */
      const state = document.createElement('td');
      state.className = 'jstatus';
      state.dataset.sort = status;
      const stateTone = { building: 'running', queued: 'queued', attention: 'failed', ready: 'done', draft: 'queued' }[status];
      /* **The pill says the phase while a build runs.** *Extracting* is what somebody
         watching a four-hour build wants from the one piece of prose on the row, and
         *Building* is what they already knew from opening the screen. The filter still
         keys on `data-dataset-status`, so filtering by Building is unchanged. */
      state.innerHTML = `<span class="pill" data-state="${stateTone}">${datasetPillContents(status, build)}</span>`;
      /* After the description, which is where the Task cell used to sit. */
      original[1].after(state);
      const expand = document.createElement('td');
      expand.className = 'ex';
      /* **A build expands here, on Datasets.** It used to carry a mark linking
         into Jobs, because a dataset build was drawn as a job in the GPU queue.
         It is not one -- settled 2026-10-14 in #128 -- so its progress, its
         worker and its diagnostics have to live where the build does, which is
         this row. The structure is deliberately the same as a Ready row's, a
         `runrow-head` with a `runrow-body` after it, so the existing expander
         wires it without knowing the difference. */
      if (isBuild) {
        head.classList.add('dataset-build-row');
        head.setAttribute('aria-expanded', 'false');
        expand.innerHTML = `<button class="exbtn" type="button" aria-label="Expand ${name}" title="Show build progress and phase"><svg class="ico sm"><use href="#i-right"/></svg></button>`;
        head.prepend(expand);

        const failed = status === 'attention';
        const pct = buildPercent(build);

        /* Queued work has not measured anything, and neither has a build still
           selecting -- so both draw a dash rather than a 0% bar, the same rule
           the Jobs table follows. */
        const bar = pct < 0
          ? `<span class="dash">${status === 'queued' ? 'Not started' : 'No count yet'}</span>`
          : `<span class="prog" data-state="${stateTone}"><span class="bar" role="progressbar" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span><span class="pct">${pct}%</span></span>`;

        const fact = (label, value, omit, hide) => (omit ? '' : `<div class="jobmetric"${hide ? ' hidden' : ''}><span>${label}</span><b>${value}</b></div>`);
        /* **Why it failed, from the attempt that failed.** This drew the dataset's own
           description under an alert icon and then claimed "Materialized frames are
           kept; only the unread remainder needs to run again" -- which says nothing
           about the failure and is not true: a failed build keeps nothing, its staging
           goes with it. Isaac, looking at one: "which isn't telling me ANYTHING about
           why it needs attention". */
        const reason = build && build.failure_reason
          ? escapeHtml(build.failure_reason)
          : 'No reason was recorded, which is itself worth reporting.';

        const note = failed
          ? '<div class="jobstate-alert"><svg class="ico"><use href="#i-alert"/></svg>'
            + `<div><h4>This build failed</h4><p>${reason}</p></div></div>`
          : '';
        const actions = failed
          ? '<button class="btn sm" type="button">Retry build</button><button class="btn sm ghost" type="button">Discard</button>'
          : status === 'queued'
            ? '<button class="btn sm" type="button">Start now</button><button class="btn sm ghost" type="button">Cancel build</button>'
            : '<button class="btn sm ghost" type="button">Cancel build</button>';

        /* **Five facts, not nine.** Worker, remaining time, materialized size and
           fingerprint were fixture: the API records none of them for a build in flight,
           and a dataset build has no worker to name because the API runs it rather than
           the pool. What an attempt does carry is the phase, the count, when it started
           and which try this is. */
        /* **Every fact that moves carries a hook, and that is the whole lesson here.**
           `Frames` was the FRAMES cell's text captured when the row was drawn and never
           touched again, so a row opened during *selecting* went on saying `0 / 10,361`
           while the cell four lines above it climbed -- two numbers for one thing, which
           Isaac read as neither being trustworthy. A fact that can change is patched. */
        const phase = phaseOf(build);
        const reported = buildReported(build);

        const metrics = [
          fact('Phase', `<span data-build-phase>${build ? (phase.phase || NOT_STARTED_TEXT) : NOT_STARTED_TEXT}</span>`),
          fact('Frames', `<span data-build-frames>${frames}</span>`),
          /* Where the build has got to in the list of videos. **Always built, hidden when
             there is nothing to name**, because the runner starts reporting it part-way
             through and a row that has to be created later cannot be: the detail is drawn
             once and patched thereafter. Hidden rather than dashed -- an empty *Video*
             reads as a video it could not name. */
          fact('Video', `<span data-build-video>${escapeHtml(phase.detail)}</span>`, false,
            !phase.detail),
          fact('Elapsed', `<span data-build-elapsed>${buildElapsed(build) || NOT_STARTED_TEXT}</span>`),
          fact('Reported', `<span data-build-reported>${reported || NOT_STARTED_TEXT}</span>`, !build),
          fact('Attempt', build ? `${build.attempts_made} of ${build.max_attempts}` : NOT_STARTED_TEXT),
          fact('Build job', build ? `#${build.job_id}` : NOT_IN_DATASET),
        ].join('');

        const detail = document.createElement('tr');
        detail.className = 'runrow-body dataset-row-detail';
        detail.hidden = true;
        /* **Only where cancelling can do anything.** `queued` and `leased` are the two
           states a build is still in; a failed or cancelled one has already stopped, and
           a succeeded one has an archive. A button that would answer `changed: false` is
           a button that lies about having done something. */
        const stoppable = build && (build.state === 'queued' || build.state === 'leased');

        /* **The delay is on screen, because it is long enough to look ignored.** A
           running build checks for cancellation once per pass of a hundred frames, which
           is about twenty seconds, and a control that appears to do nothing for twenty
           seconds gets pressed again. A queued build stops at once -- there is nothing
           cutting frames to interrupt. */
        /* **Delete belongs here more than it belongs on a finished dataset**, and it was
           missing: the button was built into `readyActions`, so it only ever appeared on
           a dataset that had built successfully. A failed build is the one somebody
           actually wants rid of -- it holds nothing, it clutters the list, and it may be
           sitting on a partial archive -- and it was the one case with no way to clear
           it. Isaac found it the hour after delete shipped.

           Not drawn while a build can still be cancelled: `queued` and `leased` both mean
           a runner has it or is about to, and the route refuses those anyway because the
           dataset row still says `building`. Cancel first, then delete, which is the
           order the refusal already asks for. */
        const stopActions = (stoppable || !build || build.state === 'failed' || build.state === 'cancelled')
          ? '<footer>'
            + (stoppable
              /* **The delay is on screen, because it is long enough to look ignored.** A
                 running build checks for cancellation once per pass of a hundred frames,
                 which is about twenty seconds, and a control that appears to do nothing
                 for that long gets pressed again. A queued build stops at once -- there
                 is nothing cutting frames to interrupt. */
              ? `<button class="btn sm danger" type="button" data-cancel-build="${build.job_id}">`
                + '<svg class="ico"><use href="#i-stop"/></svg>Cancel build</button>'
                + `<span class="hint">${build.state === 'leased'
                  ? 'Stops at the end of the pass it is cutting, usually within about 20 seconds.'
                  : 'Stops before it starts; nothing has been cut yet.'}</span>`
              : deleteButton(set))
            + '</footer>'
          : '';

        detail.innerHTML = `<td colspan="10"><div class="dataset-detail" data-status="${status}">`
          + `<header><div><h3>${name}</h3><p>${description}</p></div><span class="pill" data-state="${stateTone}">${datasetPillContents(status, build)}</span></header>`
          + `<div class="dataset-build-progress">${bar}<span class="build-frames">${frames} frames</span></div>`
          + note
          + `<div class="jobmetrics">${metrics}</div>`
          + stopActions
          + '</div></td>';
        head.after(detail);
        wireCancelBuild(detail, name);
        wireDeleteDataset(detail, head, set);
        continue;
      }
      head.setAttribute('aria-expanded', 'false');
      expand.innerHTML = `<button class="exbtn" type="button" aria-label="Expand ${name}" title="Show provenance, composition, split and sample images"><svg class="ico sm"><use href="#i-right"/></svg></button>`;
      head.prepend(expand);
      /* **Not `loading="lazy"`.** These sit inside a row that is collapsed until
         somebody opens it, and a lazy image revealed that way is never fetched:
         the load is deferred and the deferral never resolves, so the strip stays
         blank with no error anywhere -- the browser simply never asked. Twenty-six
         thumbnails on a page is a cost worth paying over a panel that silently
         shows nothing. */
      /* The four sample pictures that used to sit here were four hardcoded Jellyfin item
         ids -- the same four on every dataset. Removed rather than relabelled: the real
         frames are inside the archive and serving them is its own piece of work. */
      const detail = document.createElement('tr');
      detail.className = 'runrow-body dataset-row-detail';
      detail.hidden = true;
      /* **Download is a link, not a button.** The archive is hundreds of megabytes --
         541 MB for the first real one -- so the browser streams it to disk; pulling it
         through `fetch` into a blob would hold it all in memory first. Same-origin, so
         the session cookie goes with it the way every other request on this screen is
         authenticated; no token in a query string.

         **Drawn only when there is something to download.** `archive_path` is null until
         a build finishes, and a button that 404s is worse than one that is absent.

         The route is gated on `jobs:execute` rather than `datasets:read`, because
         fetching a dataset is part of running the job that names it -- so a reader who
         can see this screen may still be refused the file. That is the route's decision
         and not this screen's to work around. */
      /* Declared before the link below names it in its title, not with the rest of the
         Build record further down: a `const` read above its own declaration is a
         ReferenceError, and it took the whole detail row with it. */
      const size = archiveSize(set && set.archive_bytes);
      const downloadable = status === 'ready' && set && set.archive_path;
      const download = downloadable
        ? `<a class="btn sm" href="/api/v2/gpu/datasets/${encodeURIComponent(set.id)}/archive" download title="Download the built images, labels and manifest${size ? ` — ${size}` : ''}"><svg class="ico"><use href="#i-download"/></svg>Download archive</a>`
        : '';

      /* Duplicate setup and Use for training are still inert, and deliberately left so:
         wiring them has not been asked for, and two more half-working buttons is worse
         than two that are obviously not finished. They carry a `later` chip, which is
         what this app uses for a control with nothing behind it. */
      const remove = deleteButton(set);

      const readyActions = `<button class="btn sm" type="button" disabled title="Not wired yet"><svg class="ico"><use href="#i-copy"/></svg>Duplicate setup <span class="chip">later</span></button><button class="btn sm" type="button" disabled title="Not wired yet"><svg class="ico"><use href="#i-training"/></svg>Use for training <span class="chip">later</span></button>${download}${remove}`;
      /* **The Build record, from the dataset row rather than from its name.** This block
         was a lookup keyed on five invented dataset names — `CAMPA_2024_Rockfish_v3` and
         friends — so anything MARP actually built fell through to a wall of em dashes
         with confident sentences beside them: "promoted observations only",
         "deduplicated", "completed cleanly", about a dataset nobody had checked. Every
         line here is now either a column on `datasets` or absent.

         Task is gone for the same reason it left the table: a dataset records no training
         task and never will. */
      const took = buildTook(set);
      const fingerprint = set && set.archive_sha256
        ? `<span class="mono">${escapeHtml(String(set.archive_sha256).slice(0, 16))}</span>`
        : '';

      const record = [
        /* Only for a dataset this builder made. A legacy import's shape is whatever the
           desktop script produced, and `source` is what tells them apart. */
        recordRow('Format', set && set.source === 'ml-dashboard'
          ? 'YOLO bounding boxes &middot; one label file per image'
          : ''),
        recordRow('Source', set && set.source ? escapeHtml(set.source) : ''),
        recordRow('Built in', took),
        recordRow('Fingerprint', fingerprint),
        recordRow('Archive', size),
      ].join('');

      detail.innerHTML = `<td colspan="10"><div class="dataset-detail" data-status="${status}">`
        + `<header><div><h3>${name}</h3><p>${description}</p></div>`
        /* **Not "Ready · immutable" on everything that reaches this panel.** A cancelled
           build lands in `draft` and is drawn here, so the one piece of prose on the
           header was calling a dataset with no archive ready and promising it would never
           change. It is not ready, and the only thing immutable about it is that nothing
           was built. */
        + `<span class="pill" data-state="${stateTone}">${status === 'draft'
          ? 'Draft &middot; nothing built'
          : 'Ready &middot; immutable'}</span></header>`
        + '<div class="dataset-detail-grid">'
        + `<section><h4>Build record</h4><dl class="kv">${record}</dl></section>`
        + '<section><h4>Composition and split</h4>'
        + '<div class="dataset-facts">'
        + `<span><b>${observations}</b> observations</span>`
        + `<span><b>${frames}</b> images</span>`
        + `<span><b>${classes}</b> classes</span>`
        + (size ? `<span><b>${size}</b> archive</span>` : '')
        + '</div>'
        /* Filled when the row is opened, from `GET /dataset/:id/composition`. Asking for
           every row the table draws would be a request per row to draw one page. */
        + '<div data-dataset-composition></div>'
        + '</section></div>'
        /* Full width under the grid rather than a third column: a frame is only worth
           showing at a size somebody can see the box in, and three of those do not fit
           beside the build record. */
        + '<section class="dataset-sample"><h4>Frames it cut</h4><div data-dataset-preview></div></section>'
        + `<footer>${readyActions}</footer></div></td>`;

      /* **Asked on first open, once.** The splits and the vocabulary cannot change for a
         dataset that is built — the archive is addressed by its own hash — so one fetch
         per row for as long as the page is open is the whole of it. */
      let composed = false;
      const compose = async () => {
        if (composed) return;
        composed = true;

        const into = $('[data-dataset-composition]', detail);
        if (!into) return;

        /* The vocabulary is wanted twice -- once as the class breakdown, once to name the
           box on each sample frame -- so the preview waits on this rather than running
           beside it. A box labelled `class 2` is most of the way to useless. */
        let named = new Map();

        try {
          const { splits, classes: vocabulary } = await window.MarpApi.datasetComposition(set.id);
          const bar = splitBar(splits);
          const names = (vocabulary || [])
            .map((entry) => escapeHtml(entry.comname || `Species ${entry.species_id}`));

          named = new Map((vocabulary || [])
            .map((entry) => [entry.class_index, entry.comname || `Species ${entry.species_id}`]));

          /* Nothing recorded is a real answer and a common one: every dataset built
             before #268 wrote membership has neither, and saying so beats an empty bar. */
          into.innerHTML = (bar || names.length)
            ? bar + (names.length
              ? `<p class="dataset-class-summary">${names.join(' &middot; ')}</p>`
              : '')
            : '<span class="hint">No membership was recorded for this dataset.</span>';
        } catch (error) {
          into.innerHTML = `<span class="hint">Could not load its composition (${error.status || 'no answer'}).</span>`;
        }

        const sample = $('[data-dataset-preview]', detail);
        if (!sample) return;

        /* **The whole section goes when there is nothing to show**, rather than a heading
           over an explanation. A dataset with no archive on disk -- a build that failed at
           packaging, or an archive moved away from the rows that name it -- has no frames,
           and a reader does not need a paragraph about why. */
        const drop = (why) => {
          const section = sample.closest('.dataset-sample');

          if (section) section.innerHTML = why ? `<h4>Frames it cut</h4><span class="hint">${why}</span>` : '';
        };

        try {
          const { frames, total } = await window.MarpApi.datasetPreview(set.id, PREVIEW_FRAMES);
          const strip = previewStrip(frames, total, set.id, PREVIEW_FRAMES, named);

          if (strip) sample.innerHTML = strip;
          else drop('');
        } catch (error) {
          /* 404 is the ordinary case and not worth a complaint: the dataset has no
             archive to read. Anything else is the server failing and is said plainly. */
          drop(error.status === 404 ? '' : `Could not read its frames (${error.status || 'no answer'}).`);
        }
      };

      head.addEventListener('click', compose);

      /* **Also reachable without a click.** A row opened by `?dataset=` is expanded
         directly rather than by clicking it, so a composer hung only on the click
         listener never ran and the panel arrived with its split bar missing. Kept on the
         detail element so the closure stays with the row it belongs to. */
      detail.loadComposition = compose;
      head.after(detail);
      wireDeleteDataset(detail, head, set);
      const open = $('[aria-label="Open"]', head);
      if (open) {
        open.setAttribute('aria-label', `Show details for ${name}`);
        open.title = 'Show provenance, composition, split and sample images';
        open.addEventListener('click', () => $('.exbtn', head)?.click());
      }
    }
  };

  const search = $('[data-dataset-search]');
  const status = $('[data-dataset-status]');
  const count = $('[data-dataset-count]');
  const footer = $('#saved-datasets-panel .panel-ft > span');

  /* **Reads the rows out of the DOM every time, rather than closing over a list.** The
     table is rebuilt when a build starts or finishes, so a captured node list is stale
     from the first completion onwards -- it would go on filtering rows that are no
     longer on the page and ignoring the ones that are. */
  const filter = () => {
    const heads = $$(':scope > tr.runrow-head', body);
    const query = search.value.trim().toLowerCase();
    const wantedStatus = status.value;
    let shown = 0;
    heads.forEach((head) => {
      const match = (!query || head.dataset.search.includes(query))
        && (wantedStatus === 'all' || head.dataset.datasetStatus === wantedStatus);
      head.hidden = !match;
      const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
        ? head.nextElementSibling : null;
      if (detail) detail.hidden = !match || head.getAttribute('aria-expanded') !== 'true';
      if (match) shown += 1;
    });
    /* `heads.length`, not 20. The total was written in when there were twenty
       rows in the markup; the saved datasets come from the API now and there
       are as many as MARP holds. */
    count.textContent = `(${shown} shown of ${heads.length})`;
    if (footer) footer.innerHTML = `Showing <b class="strong">${shown}</b> of ${heads.length} builds and datasets`;
  };

  /** What the table was last drawn from, so a poll can tell a move from a change. */
  let drawn = '';

  /**
   * Ask MARP, and redraw only when the answer is a different table.
   *
   * @param {boolean} first - True for the initial draw, which always renders.
   * @returns {Promise<boolean>} Whether anything is still building.
   */
  const refresh = async (first) => {
    let datasets;
    let inFlight;

    try {
      [datasets, inFlight] = await Promise.all([
        window.MarpApi.listDatasets(),
        window.MarpApi.listDatasetBuilds(),
      ]);
    } catch (error) {
      /* Only on the first draw. A poll that fails is a blip, and replacing a table
         somebody is reading with an error because one request in a hundred timed out is
         worse than leaving the last good answer on screen until the next one lands. */
      if (first) {
        body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="10">Could not load datasets (${error.status || 'no answer'}).</td></tr>`;
      }
      return false;
    }

    const builds = new Map(inFlight.map((build) => [build.dataset_id, build]));

    /* The shape of the table: which datasets, in which state. The counts are
       deliberately left out -- they move constantly and moving them is what the patch
       below is for. */
    const shape = datasets.map((set) => `${set.id}:${datasetScreenStatus(set, builds.get(set.id) || null)}:${set.num_samples ?? ''}:${set.num_observations ?? ''}:${set.num_classes ?? ''}`).join('|');

    if (first || shape !== drawn) {
      drawn = shape;
      fillSavedDatasets(body, datasets, builds);
      decorate(builds, new Map(datasets.map((set) => [set.id, set])));
      /* **Bound here, not in the boot list.** `wireAccordions` runs before this
         function resolves -- these rows come from the API, so they did not exist
         when it swept the page -- and without this the expander on every dataset
         did nothing at all. */
      wireAccordions();
      filter();
      openRequestedDataset();
    } else {
      patchBuildRows(body, builds);
    }

    renderDatasetsSummary(datasets, builds);

    watching = builds;

    /* **In flight, not merely present.** The answer carries failed builds too now, so
       that the alert on a *Needs attention* row can say why -- and a failed build stays
       failed, so polling on `builds.size` would poll for ever. */
    const building = [...builds.values()]
      .some((build) => build.state === 'queued' || build.state === 'leased');

    if (building) startClock();

    return building;
  };

  let timer = null;

  /**
   * Keep asking while anything is building, and stop when nothing is.
   *
   * **The timer is not started on a screen with nothing in flight**, and it stops itself
   * the moment the last build leaves -- which is the whole of #268's *poll while anything
   * is building*. `setTimeout` rather than `setInterval` so a slow answer cannot stack a
   * queue of requests behind itself.
   */
  /** What the last poll said, so the clocks between polls have instants to count from. */
  let watching = new Map();

  /**
   * A second-by-second clock, running only while something is building.
   *
   * **It moves two figures and no others.** Elapsed and *Reported* are both durations
   * since an instant the API already sent, so counting them locally is reading a clock,
   * not guessing at progress: the frame count still moves only when a poll brings a new
   * one. Isaac asked for a screen that looks alive while a four-hour build runs, and the
   * honest version of that is a figure that is genuinely changing every second -- with the
   * side effect that a build which has stopped reporting shows it, because *Reported*
   * keeps climbing.
   */
  let clock = null;
  const stopClock = () => { if (clock) { clearInterval(clock); clock = null; } };
  const startClock = () => {
    if (clock) return;
    clock = setInterval(() => {
      for (const head of $$(':scope > tr[data-dataset-id]', body)) {
        const build = watching.get(Number(head.dataset.datasetId));
        const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
          ? head.nextElementSibling : null;
        /* Only what is on screen. A collapsed row's clocks are redrawn when it opens. */
        if (build && detail && !detail.hidden) tickBuildClocks(detail, build);
      }
    }, 1000);
  };

  const poll = async () => {
    timer = null;
    const busy = await refresh(false);
    if (busy) timer = setTimeout(poll, DATASET_POLL_MS);
    else stopClock();
  };

  if (await refresh(true)) {
    timer = setTimeout(poll, DATASET_POLL_MS);
    startClock();
  }

  /* A queued build is in flight from the instant the button answers, so the screen starts
     watching without waiting for the next whole poll interval. */
  document.addEventListener('marp:dataset-build-queued', () => {
    if (!timer) timer = setTimeout(poll, 0);
  });

  /* A row opened between polls gets its clocks filled straight away rather than waiting
     up to a second for the next tick -- an expander that shows a dash and then a figure
     looks like it failed and recovered. */
  body.addEventListener('click', (event) => {
    if (!event.target.closest('.exbtn')) return;
    window.setTimeout(() => {
      for (const head of $$(':scope > tr[data-dataset-id]', body)) {
        const build = watching.get(Number(head.dataset.datasetId));
        const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
          ? head.nextElementSibling : null;
        if (build && detail && !detail.hidden) tickBuildClocks(detail, build);
      }
    }, 0);
  });

  search.addEventListener('input', filter);
  status.addEventListener('change', filter);
}

function wireAccordions() {
  /* **Delegated, because the rows are not there yet.**
     This used to attach a listener per row, which worked for exactly as long as
     the rows were built synchronously from a fixture: `wireAccordions` ran at
     boot, found eighteen rows and wired them. The moment the data layer started
     asking MARP, the rows arrived after the fetch resolved — so this ran, found
     nothing, wired nothing, and every expander on every screen silently stopped
     working. No error, no empty table, just a button that does nothing, which is
     the hardest kind of broken to notice.

     One listener on the document survives that, and survives a re-render too:
     `applyJobsQuery` replaces the tbody on every filter change, which would have
     thrown away per-row listeners anyway. */
  if (!document.body.dataset.accordionsWired) {
    document.body.dataset.accordionsWired = 'true';

    document.addEventListener('click', (event) => {
      const head = event.target.closest('table.expandable tbody tr.runrow-head');
      if (!head) return;

      const body = head.nextElementSibling;
      if (!body || !body.classList.contains('runrow-body')) return;

      // Anything else interactive in the row keeps its own meaning.
      if (!event.target.closest('.exbtn') && event.target.closest('button, input, a, select')) return;

      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
  }

  const all = $$('.btn').find((b) => /^Expand all/.test(b.textContent.trim()));
  if (!all) return;
  all.addEventListener('click', () => {
    const heads = $$('tr.runrow-head').filter((head) => !head.hidden
      && head.nextElementSibling?.classList.contains('runrow-body'));
    const opening = heads.some((h) => h.getAttribute('aria-expanded') !== 'true');
    heads.forEach((h) => {
      h.setAttribute('aria-expanded', String(opening));
      if (h.nextElementSibling) h.nextElementSibling.hidden = !opening;
    });
    all.lastChild.textContent = opening ? 'Collapse all ready' : 'Expand all ready';
  });
}

/* ================================================================== tips */

/**
 * A short hover explanation on every control, keyed by the text already on
 * screen.
 *
 * Kept as a dictionary rather than a `title` on each element for the same
 * reason the rail is: eight hand-written screens would otherwise explain the
 * same control eight ways. Anything already carrying its own `title` is left
 * alone, so a screen can be more specific where it needs to be.
 */
const TIPS = {
  /* top bar */
  'Project': 'Narrow every list on this screen to one project',
  'Search jobs, models, datasets…': 'Search across jobs, models and datasets',
  'Search jobs…': 'Filter the visible queue by job name, model, dataset or status',
  'New Inference Job': 'Run a registered model over MARP data',
  'New Training Job': 'Fine-tune a model on a saved dataset',

  /* headline numbers */
  'Running jobs': 'Jobs a worker is executing right now',
  'Queued jobs': 'Submitted and waiting for a free GPU slot',
  'Needs attention': 'Failed, or finished with some pieces failed',
  'Completed today': 'Finished since midnight',
  'Workers reachable': 'Machines that answered recently, of every machine enrolled',
  'GPU slots in use': 'Concurrent jobs the pool is running, of its total capacity',
  'Training now': 'Training runs in progress',
  'Completed': 'Runs that finished and registered a version',
  'Failed': 'Runs that stopped without registering anything',
  'Best mAP@50': 'The best mean average precision any registered version reached',
  'Job status': 'How current and recently completed jobs are distributed by state and workload type',
  'Job activity': 'How many jobs started, completed or remained queued during the selected time window',
  'Running inference': 'Inference jobs actively processing MARP frames now',
  'Queued inference': 'Inference jobs submitted and waiting for eligible GPU capacity',
  'Running training': 'Training jobs actively updating model weights now',
  'Need attention': 'Jobs that failed or completed with some work unresolved',
  'Design preview': 'Illustrative changing data used to review this design before live metrics are connected',
  '24h': 'Show this activity graph across the last 24 hours',
  '5h': 'Show this activity graph across the last 5 hours',
  '1h': 'Show this activity graph across the last hour',
  'Inference status': 'How current and recently completed inference jobs are distributed by state',
  'Throughput & backlog': 'Compare the rate frames are being processed with the volume still waiting',
  'Processing throughput': 'Frames processed per minute across the inference worker pool',
  'Queued frames': 'Source frames waiting for an inference worker to process them',

  /* table headers */
  'Job': 'The job name',
  'Run': 'The training run name',
  'Type': 'Inference or training',
  'Scope': 'Which MARP data the job covers',
  'Dataset': 'The saved dataset this run trained on',
  'Model': 'The model and version the job is locked to',
  'Produces': 'The model version a successful run registers',
  'Status': 'Where the job has got to',
  'Progress': 'Frames or epochs finished',
  'Workers': 'Machines on this job now, of the slots it asked for',
  'Submitted': 'When the job was queued',
  'Updated': 'When anything about the job last changed',
  'Started': 'When work actually began',
  'Took': 'Wall-clock time from start to finish',
  'Epochs': 'Epochs finished, of the number requested',
  'mAP@50': 'Mean average precision at the lenient overlap threshold',
  'Detections': 'Model predictions retained after confidence and overlap filtering',
  'Frames': 'The half-open frame range, start included and end excluded',
  'Line': 'One transect line',
  'Worker': 'The machine holding this piece of work',
  'State': 'Where this piece has got to',
  'Done': 'How much of this range is finished',
  'Expand': 'Open or close the full details for this job',
  'Actions': 'Controls available for this job in its current state',
  'Job type': 'Show inference jobs, training jobs or both',
  'Window': 'Limit the list to jobs submitted during this period',

  /* expanded job and model evaluation */
  'Queue position': 'This job’s current place among work waiting for compute',
  'Waiting': 'How long the job has remained ready without a worker lease',
  'Priority': 'The scheduling weight used when eligible queued jobs compete for compute',
  'Requirement': 'The minimum GPU capacity and sharing mode this job needs',
  'Rate': 'The recent processing throughput for this job',
  'ETA': 'Estimated time until the current job finishes at its recent rate',
  'Elapsed': 'Wall-clock time since a worker began processing this job',
  'Remaining': 'Estimated time until completion at the recent processing rate',
  'Throughput': 'Frames processed per second at the job’s recent rate',
  'Epoch': 'One complete pass through the training dataset',
  'Validation loss': 'Error measured on held-out validation data; falling usually indicates improvement',
  'GPU memory': 'VRAM currently reserved by this training process',
  'GPU load': 'The share of available GPU compute being used now',
  'Stopped': 'The last epoch or frame range completed before work ended',
  'Error': 'The condition reported when the worker stopped this job',
  'Attempts': 'Attempts already used compared with the retry policy limit',
  'Registered': 'The immutable model version created after successful training',
  'Duration': 'Wall-clock time from the start of work until completion',
  'Checkpoint': 'Saved model weights that can resume training or run inference',
  'Stopped at': 'Progress preserved when this job was cancelled',
  'Cancelled by': 'The operator who requested cancellation',
  'Reusable work': 'Completed output retained so a later run need not repeat it',
  'Succeeded': 'Work ranges that completed successfully compared with all assigned ranges',
  'Affected': 'The amount of work impacted by this failure or incomplete result',
  'Partial results': 'Output produced before failure that has not yet been published',
  'Ranges': 'Independent frame intervals assigned to workers for this job',
  'Learning dynamics': 'How optimization losses and held-out validation quality changed across epochs',
  'Loss components': 'Box localization, class prediction and distribution focal loss; lower is better',
  'Validation quality': 'Precision, recall and average precision measured on held-out validation data',
  'Final evaluation': 'Metrics and diagnostic plots calculated from the selected finished checkpoint',
  'Macro F1': 'The unweighted mean of every class’s F1 score, so common classes do not dominate',
  'Precision': 'Of the detections the model made, the share that were correct',
  'Recall': 'Of the real targets present, the share the model detected',
  'mAP@50–95': 'Mean average precision averaged across IoU thresholds from 0.50 through 0.95',
  'Best checkpoint': 'The epoch selected by validation fitness rather than simply the final epoch',
  'Per-class quality': 'Compare support, precision, recall, F1 and average precision for each class',
  'Thresholds': 'See how confidence cutoff changes precision, recall and F1',
  'Confusion matrix': 'See which actual classes were predicted correctly or mistaken for another class',
  'Class balance': 'Compare how many examples each class contributes to train, validation and test data',
  'Support': 'The number of labeled test examples used to score this class',
  'Class': 'A detection category the model was trained and evaluated to recognize',
  'F1': 'The harmonic mean of precision and recall',
  'AP@50': 'Average precision when a prediction counts as matching at 0.50 intersection-over-union',
  'AP@50–95': 'Average precision averaged across stricter overlap thresholds from 0.50 through 0.95',
  'Per-class precision–recall': 'A separate precision–recall curve for each of the eight trained classes',
  'Operating threshold': 'How the chosen confidence cutoff trades recall for precision',
  'Normalized': 'Show each confusion-matrix row as proportions, making classes comparable despite different support',
  'Counts': 'Show the raw number of examples in each confusion-matrix cell',
  'Selected model': 'The best checkpoint chosen by validation fitness for registration and evaluation',
  'Last checkpoint': 'The weights saved at the final completed epoch, which may not be the best model',
  'Artifacts': 'Open the checkpoints, metrics, configuration and plots recorded by this run',
  'Run configuration': 'Open the exact submitted and derived settings received by the training worker',
  'Recorded path': 'Where the artifact is registered in the run output',
  'Availability': 'Whether MARP can currently retrieve this recorded artifact',
  'Data': 'The frozen dataset, split and sample policy used for this run',
  'Model & input': 'The starting weights, architecture and input batching used by the worker',
  'Optimization': 'The settings controlling how model weights changed during training',
  'Reproducibility & runtime': 'The seed, hardware and software needed to understand or reproduce this run',
  'Split': 'How examples were separated for learning, model selection and final scoring',
  'Training samples': 'The number of examples available to update model weights',
  'Image policy': 'How source frames were shaped for the model without distorting their aspect ratio',
  'Architecture': 'The neural-network family and size used by this model',
  'Input size': 'The pixel dimensions presented to the model',
  'Pretrained': 'Whether training began from existing learned weights instead of random initialization',
  'Initial learning rate': 'The optimizer step size at the beginning of training',
  'Schedule': 'How the learning rate changed as training progressed',
  'Weight decay': 'Regularization that discourages excessively large model weights',
  'Warm-up': 'Early epochs that gradually increase the learning rate for stability',
  'Optimizer': 'The algorithm used to update model weights from calculated gradients',
  'Early stopping': 'Stop training after validation quality fails to improve for this many epochs',
  'Seed': 'The random seed recorded so data ordering and initialization can be reproduced',
  'Deterministic mode': 'Use repeatable operations where the runtime supports them',
  'Accelerator': 'The GPUs assigned to this training run',
  'Runtime': 'The CUDA and machine-learning framework versions used by the worker',
  'Training package': 'The training library and version that executed this run',

  /* inference form */
  'Task preset': 'Fills the settings below with a sensible starting point',
  'Version': 'Which version of the model to run',
  'Engine': 'The inference runtime the worker will use',
  'Confidence threshold': 'Detections below this score are discarded',
  'IoU threshold (NMS)': 'How much two boxes may overlap before one is dropped',
  'Max detections per frame': 'A ceiling, so one busy frame cannot flood the results',
  'Image size': 'What each frame is resized to before the model sees it',
  'Tracker': 'How detections in consecutive frames are joined into one animal',
  'Reduction': 'Which frame of a track becomes the observation',
  'Frame range size': 'How much video one worker takes at a time',
  'Output mode': 'Whether results become observations or just a CSV',
  'Save results to': 'Where the observations are attached',
  'Output options': 'What else the job produces besides observations',
  'Worker selection': 'A preference for which machines take the work',
  'Worker limit': 'A ceiling on how many machines this job may occupy',
  'Job name': 'What this job is called in the queue and in history',
  'Columns': 'Which fields the exported CSV carries',

  /* training form */
  'Base model': 'The registered model or checkpoint being fine-tuned',
  'Task': 'What the model is being trained to do',
  'Batch size': 'Frames per optimiser step. Larger needs more VRAM',
  'Learning rate': 'How far each step moves the weights',
  'Optimiser': 'The algorithm that updates the weights',
  'Warm-up epochs': 'Epochs at a reduced learning rate before full speed',
  'Augmentation': 'Transformations applied to training frames to widen the data',
  'Saved dataset': 'The frozen set of approved observations to train on',
  'Saved split': 'The train, validation and test partition saved with the dataset',
  'Class distribution': 'How many observations each class contributes',
  'Version name': 'What the version this run registers will be called',
  'Traceability': 'What this run will be recorded as having come from',
  'Run name': 'What this run is called in the list',
  'Estimated': 'A guess from the dataset size and the base model',
  'On success': 'What exists afterwards if the run finishes',
  'What will actually run': 'The exact model, version and hash the job is locked to',
  'What that gives you': 'What the base model already knows',
  'What that contains': 'What the chosen scope covers',
  'What this will do': 'The work this submits, computed from the scope',

  /* buttons */
  'More filters': 'Filter by worker, model, submitter or date',
  'Expand all': "Open every run's curves at once",
  'Reprioritize': 'Move the selected jobs up or down the queue',
  'Retry failed': 'Re-run only the pieces that failed',
  'Clear selection': 'Deselect every row',
  'Run inference': 'Submit the job as configured',
  'Start training': 'Submit the run as configured',
  'Advanced settings': 'Tracker, thresholds and range size',
  'Pause after current range': 'Finish the range in flight, then stop taking work',
  'Pause now': 'Interrupt immediately. The range restarts when work resumes',
  'Cancel job': 'Stop the job and take it out of the queue',
  'Duplicate': 'Start a new job with this configuration',
  'Run again': 'Submit the same job again',
  'Retry': 'Re-run this job from the beginning',
  'Retry 2': 'Re-run only the two pieces that failed',
  'Stop': 'End this run now',
  'Diagnostics': 'Attempts, leases and the event log',
  'Open model version': 'Open the registered model version produced by this completed training job',
  'Open model': 'Open this model and version in the model registry',
  'Review observations': 'Open the observations produced by this inference job for review',
  'Start when available': 'Keep this job queued and begin automatically when eligible compute is free',
  'Change priority': 'Adjust where this queued job competes for eligible compute',
  'Cancel': 'Stop this job and prevent it from taking more work',
  'Retry failed work': 'Run only the ranges that did not complete successfully',
  'Retry job': 'Start this job again from its beginning',
  'Duplicate with changes': 'Create a new job prefilled from this one, then edit it before submitting',
  'Pause': 'Stop assigning new work while preserving completed progress',
  'Resume': 'Allow this paused job to begin taking work again',
  'Start now': 'Give this queued job immediate scheduling priority when eligible compute is available',
  'Close': 'Close this inline view and return focus to the control that opened it',
  'Inference progress': 'Current throughput, elapsed time and estimated completion for an active inference job',
  'Training progress': 'Current epoch, validation loss and GPU use for an active training job',
  'Waiting for compute': 'This job is ready but no eligible worker capacity is currently free',
  'Model version registered': 'Training completed and created an immutable version in the model registry',
  'Results produced': 'Inference completed and its output is available for review',
  'Job cancelled': 'An operator stopped this job before all work completed',

  /* scope and mode segments */
  'Dive': 'Every line in one dive',
  'Line': 'One transect line',
  'Custom': 'A hand-picked set of videos',
  'Write observations': "Detections become records in MARP's database",
  'CSV test & export': 'A downloadable file, leaving the database untouched',
  'Detection': 'Find and box animals',
  'Classification': 'Name what is already boxed',
  'Segmentation': 'Outline animals pixel by pixel',

  /* checkboxes */
  'Save detections to the database': 'Always on in this mode',
  'Include confidence scores': "Keep each detection's score on the observation",
  'Generate annotated video': 'A copy of the video with boxes drawn on it',
  'Save detection crops': 'A thumbnail cut from the frame for each detection',
  'Cap how many this job may use': 'Leave the rest of the pool free for other work',
  'Stop early when validation stalls': 'End the run when validation stops improving',

  /* datasets */
  'Classes': 'Which observation classes to include',
  'Generating model': 'Human annotation, or detections from a particular model',
  'Confidence': 'Only observations scored inside this range',
  'Recorded between': 'When the video was captured, not when it was annotated',
  'Train': 'The share the model learns from',
  'Validation': 'Held back to decide when to stop training',
  'Test': 'Held back entirely, for scoring a finished model',
  'Name': 'What this dataset is called when a run selects it',
  'Queries added': 'Each query contributes its matches; duplicates are dropped',
  'Composition': 'How many observations each class contributes',
  'Class breakdown': 'How many observations each class contributes',
  'Purpose': 'What this dataset is meant to be used for',
  'Frozen on save': 'Membership and split, fixed at this moment',
  'Sample images': 'Thumbnails of observations this query matched',
  'Species': 'Which species to include',
  'Confidence range': 'Only observations scored inside this range',
  'Date range': 'When the video was captured, not when it was annotated',
  'Review status': 'Only promoted observations are eligible',
  'Advanced filters': 'Annotator, box size and exclusions',
  'Dataset name': 'What this dataset is called when a run selects it',
  'Description': 'A note for whoever picks this dataset later',
  'Added subsets': 'Each query contributes its matches; duplicates are dropped',
  'Dataset composition': 'How many observations each class contributes',
  'Add all matching to dataset': 'Add every match; duplicates are ignored',
  'Reassign': 'Assign the groups again from a new seed',
  /* models */
  'Registered models': "Models in MARP's registry",
  'Preferred models': 'Versions somebody has marked preferred for a task',
  'Cached on workers': 'Copies held on workers, ready to run without a download',
  'Recently trained': 'Versions a training run registered in the last seven days',
  'Model name': 'The registered model',
  'Base model': 'What this version was fine-tuned from',
  'Key metrics': 'The headline score for its task',
  'Model details': 'Name, task, version and what it is preferred for',
  'Deployment & caching': 'Which workers already hold this model',
  'Training history': 'Every version of this model and what changed',
  'Preferred use': 'The task this version is preferred for',
  'Mark preferred': 'Choose the task it is preferred for, and say why',
  'View workers': 'Which workers hold a copy',
  'More filters': 'Filter by preference, size or who registered it',
  'Edit': 'Edit the name, description and preference',
  /* workers */
  'Reachable': 'Machines that answered recently, of every machine enrolled',
  'GPU slots in use': 'Concurrent jobs the pool is running, of its capacity',
  'Active jobs': 'Jobs a worker is executing right now',
  'Queued': 'Submitted and waiting for a free slot',
  'Worker': 'The machine, by its editable display name',
  'Role': 'What this machine is set up to do',
  'GPU': 'The card and how much memory it has',
  'CPU': 'Processor load',
  'Memory': 'System memory in use',
  'Cached model': 'The model this machine already holds',
  'Jobs': 'Ranges it is running now',
  'Uptime': 'How long it has been enrolled and up',
  'Last heard': 'A healthy idle machine can go most of a minute without speaking',
  'System': 'Host, driver and worker version',
  'Hardware': 'What the machine is doing with itself',
  'Utilization': 'GPU load over the last day',
  'Version': 'The worker build this machine is running',
  'Service Tokens': 'Issue a token so a new machine can enroll itself',
  'Rename': 'Change the display name; the durable id does not change',
  'Drain': 'Finish the work in flight, then stop taking more',
  'Retire': 'Take this machine out of the pool',
  'Activity': 'What the pool has been doing',
  'Job queue': 'Work waiting for a free slot',
  /* history */
  'Jobs in this window': 'Jobs that finished inside the chosen window',
  'Completed with issues': 'Finished, but some videos or ranges failed',
  'Failed or cancelled': 'Stopped without finishing, or cancelled by a person',
  'Input': 'The videos or dataset it read',
  'Took': 'Wall-clock time from start to finish',
  'By': 'Who submitted it. A service token records nobody',
  'Export': 'Download this window as CSV',
  'Run again': 'Start a new job with this configuration',
  'Review in Mosaic': 'Open these observations in the Picture Mosaic Reviewer',
  'Timeline': 'What happened to this job, and when',
  'Result': 'What the job produced',
  'Task': 'What the model does',
  'Base': 'What this version was fine-tuned from',
  'Training dataset': 'The saved dataset this version trained on',
  'Key metric': 'The headline score for its task',
  'Cached': 'How many workers hold a copy',
  'Register model': 'Add a model trained outside MARP',
  'Use for inference': 'Start an inference job with this version',
  'Train from this': 'Fine-tune a new version from this one',
  'Download weights': 'Download the weights file for this version',
  'Download': 'Download the images and labels as a YOLO archive',
  'Assign to workers': 'Cache it on chosen workers and prefer them for matching jobs',
  'Change preference': 'Choose the task it is preferred for, and say why',
  'Lineage': 'Every version this one descends from, oldest first',
  'Versions': 'Every version of this model, newest first',
  'Key metrics': 'Scored on the dataset held-out test split',
  'Caching': 'Which workers already hold this model',
  'Total (deduplicated)': 'The union of the subsets, each observation counted once',
  'Query promoted observations': 'Filters that find observations to add',
  /* Both of these were body text on the screen until somebody read the screen out
     loud: they explain a control rather than telling you anything you act on, which
     is what a tooltip is for. Keyed to the control each one describes. */
  'Add matching observations to': 'Observations whose frames overlap stay together, so a '
    + 'near-duplicate picture can never land in two splits. Shares are measured in frames, '
    + 'and each species is divided separately so a rare one reaches every split.',
  'Build jobs & ready datasets': 'Queued, running and failed builds appear here immediately '
    + 'and link to their full entry in Jobs. Successful builds become expandable datasets.',
  'Query results': 'What these filters match',
  'Current dataset': 'Name, composition and what went in',
  'Dataset': 'The saved dataset',
  'Observations': 'How many observations it holds',
  'Classes': 'How many distinct classes it covers',
  'Groups': 'Overlap groups the split was assigned to',
  'Split': 'Train, validation and test shares',
  'Created': 'When it was frozen',
  'Runs': 'Training runs that have used it',
  'Add all 12,486 to the dataset': 'Add every matching observation; duplicates are ignored',
  'Run query': 'Count what these filters match',
  'Reassign groups': 'Assign the groups again from a new seed',
  'Create dataset': 'Freeze this membership and split',
  'Train': 'Start a training run on this dataset',
};

/** The element's own words, ignoring chips and counts hung off it. */
function ownText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.later, .ro-tag, .count, .badge, .faint').forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

function applyTips() {
  /* `.k` is a plain row label -- `Total (deduplicated)`, `Duration`. It was missing
     here, so a tip written for one was never applied and the label looked like it had
     no explanation at all. Two labels across the thirteen screens were affected. */
  const sel = '.field > label, th, .stat-lab, .tabstrip button, .seg button, .k,'
    + ' .btn, .check span, .kv dt, .panel-hd h2, .exbtn, summary,'
    + ' .topbar .lab, .search input, .sel, .jobmetric > span, .eval-tabs button,'
    + ' .section-heading h4, .training-evaluation h4, .evaluation-card h5, .jobstate h4,'
    + ' .evaluation-artifacts b, .artifact-detail dt, .config-group h6, .config-group dt';
  $$(sel).forEach((el) => {
    if (el.getAttribute('title')) return;                 // the screen was specific
    const key = el.matches('select')
      ? el.getAttribute('aria-label')
      : ownText(el) || el.getAttribute('placeholder') || el.getAttribute('aria-label');
    const tip = TIPS[key];
    if (!tip) return;
    /* On a label, the tip belongs to the whole field -- hovering the control is
       the natural gesture, not hovering its caption. */
    const target = el.matches('.field > label, .jobmetric > span, .artifact-detail dt, .config-group dt, .evaluation-artifacts b')
      ? el.parentElement
      : el.matches('.stat-lab') ? el.closest('.stat') : el;
    if (!target.getAttribute('title')) target.setAttribute('title', tip);
  });
  $$('.job-mix-key > span, .jobs-chart-key > span').forEach((el) => {
    if (el.title) return;
    const key = ownText(el).replace(/^\d+\s*/, '');
    if (TIPS[key]) el.title = TIPS[key];
  });
  $$('[role="img"][aria-label]').forEach((el) => {
    if (!el.title) el.title = el.getAttribute('aria-label');
  });
  const findingTips = {
    Class: 'The detection category assigned by the model',
    Detections: 'How many detections of this class the job has produced so far',
    Confidence: 'The median model score and its 10th-to-90th percentile range'
  };
  $$('.finding-head span').forEach((el) => { el.title = findingTips[ownText(el)] || ''; });
  $$('.balance-key span').forEach((el) => {
    const splitTips = { Train: 'Examples used to update model weights', Validation: 'Held-out examples used to select the checkpoint', Test: 'Untouched examples used only for final evaluation' };
    el.title = splitTips[ownText(el)] || '';
  });
  const stateTips = {
    running: 'A worker is actively processing this job', queued: 'Ready and waiting for eligible compute',
    paused: 'Work is preserved but no new processing is starting', cancelling: 'Finishing a safe boundary before stopping',
    done: 'Finished successfully', issues: 'Finished with some ranges unresolved', failed: 'Stopped before completion',
    cancelled: 'Stopped by an operator before completion'
  };
  $$('.st[data-state], .pill[data-state]').forEach((el) => {
    if (!el.title && stateTips[el.dataset.state]) el.title = stateTips[el.dataset.state];
  });
  $$('.jobstate h4').forEach((el) => {
    if (!el.title && el.nextElementSibling?.textContent.trim()) el.title = el.nextElementSibling.textContent.trim();
  });
  $$('.class-metrics tbody td:first-child, .confusion > b, .balance-row > b').forEach((el) => {
    if (!el.title) el.title = `${el.textContent.trim()}: one of the eight classes scored in this training evaluation`;
  });
}

/* ============================================== the dataset split control */

/**
 * Dataset membership is assembled as a union of query snapshots. This is a
 * deterministic fixture, but the interaction is real: queries can be rerun,
 * added more than once when their filters differ, removed, and deduplicated.
 */
/**
 * Where the Mosaic Reviewer lives, and the question this screen is asking, as an address.
 *
 * **The reviewer keeps its question in the URL and nowhere else** -- decided 2026-09-06,
 * because two stores that can disagree about where a reviewer was is a bug waiting to be
 * written. That makes a link a first-class way in rather than a trick, which is why
 * *More samples* opens the reviewer on this query instead of this screen growing a second
 * sample viewer.
 *
 * The format is `marp-mosaic-review/src/model/query-url.js` and the keys are the same
 * vocabulary `mosaicFilters` already sends to `POST /mosaic/observations/*`, so the
 * translation is almost a copy. Three things about it are not obvious and each one would
 * land the reader on the wrong question:
 *
 * - **`trainingDisposition=promoted` has to be written.** Training mode opens at
 *   `undecided` -- `modes.js`, `defaultStatus` -- so a link that leaves it out lands on
 *   the observations nobody has judged yet, which is the opposite of what a dataset
 *   builder is looking at. `toQuery` writes a mode's own status dimension only when it
 *   differs from that default, and `promoted` does.
 * - **A set is comma-joined and percent-encoded per value**, so a species whose common
 *   name contains a comma still reads back as one value. `encodeURIComponent` escapes the
 *   colon as well, which the reviewer undoes because a time reads better as `22:00`; no
 *   value here carries one, and leaving it encoded would still parse.
 * - **A range is `from..to`**, and either end may be empty. A value outside a dimension's
 *   declared bounds makes the reviewer discard the whole range rather than clamp it, so
 *   confidence is written only as the two numbers the controls hold, which are 0 to 1.
 *
 * The parameter order follows `toQuery`'s own -- mode, then the declared dimensions, then
 * the status ones -- so an address built here is the same string the reviewer would write
 * for the same question, rather than a permutation of it that merely parses the same.
 *
 * @param {Object} filters - From `mosaicFilters()`.
 * @returns {string} An address, ready for `href`.
 */
function mosaicReviewUrl(filters) {
  /* The reviewer's own encoder: a colon is legal in a query value and reads better
     unescaped, and commas stay escaped so splitting a set on them is unambiguous. */
  const enc = (v) => encodeURIComponent(String(v)).replace(/%3A/g, ':');
  const parts = ['mode=training'];

  /* `query-url.js`'s declaration order, so the address matches what the reviewer writes.
     `sessionType`, `session`, `timeOfDay` and `date` are in that list and this screen has
     no control for them; they are named here so the next person adding one can see where
     it goes rather than appending it to the end. */
  const SETS = ['project', 'dive', 'line', 'sessionType', 'session', 'species', 'model'];
  const ORDER = ['project', 'dive', 'line', 'sessionType', 'session', 'species',
    'confidence', 'timeOfDay', 'date', 'model'];

  for (const key of ORDER) {
    const value = filters[key];
    if (value == null) continue;

    if (SETS.includes(key)) {
      if (!Array.isArray(value) || !value.length) continue;
      parts.push(`${key}=${value.map(enc).join(',')}`);
      continue;
    }

    /* A range. Both ends may be absent, and a range narrowing neither end is not a
       filter -- writing `..` would be read back as nothing anyway, so it is left out. */
    const from = value.from == null ? '' : enc(value.from);
    const to = value.to == null ? '' : enc(value.to);
    if (from === '' && to === '') continue;
    parts.push(`${key}=${from}..${to}`);
  }

  /* Last, the way `toQuery` writes the mode's status dimensions after the declared ones. */
  if (Array.isArray(filters.trainingDisposition) && filters.trainingDisposition.length) {
    parts.push(`trainingDisposition=${filters.trainingDisposition.map(enc).join(',')}`);
  }

  return `/apps/marp-mosaic-review/?${parts.join('&')}`;
}

function wireDatasetBuilder() {
  const list = $('[data-subset-list]');
  const totalEl = $('[data-dataset-total]');
  const status = $('[data-query-add-status]');
  if (!list || !totalEl) return;

  const resultFields = {
    observations: $('[data-result="observations"]'),
    frames: $('[data-result="frames"]'),
    videos: $('[data-result="videos"]'),
    species: $('[data-result="species"]')
  };
  const filterIds = ['dsproj', 'dsdive', 'dsline', 'dsspecies', 'dsmodel', 'dsconf',
    'dsconfmax', 'dsfrom', 'dsto', 'dsreview', 'dsann', 'dsminarea',
    'dsexcludeds', 'dsexcludecorrected'];
  const splitLabels = { train: 'Train', validation: 'Validation', test: 'Test' };
  let selectedSplit = 'train';
  let currentResult = null;

  /* The *label*, not the value. A snapshot names a subset on screen, and the values
     stopped being readable the moment the model picker started carrying ids. The
     filters sent to MARP are built separately, by `mosaicFilters`. */
  const valueOf = (el) => {
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'yes' : 'no';
    if (el.tagName === 'BUTTON') return el.textContent.trim();
    if (el.tagName === 'SELECT') return (el.selectedOptions[0]?.textContent || '').trim();
    if (el.tagName === 'DETAILS') return ($('[data-species-label]', el)?.textContent || '').trim();
    return (el.value ?? el.textContent).trim();
  };
  const snapshot = () => Object.fromEntries(filterIds.map((id) => [id, valueOf($('#' + id))]));
  const hashFor = (text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  /**
   * The form, as the filters the mosaic routes take.
   *
   * **`trainingDisposition` is always `promoted` and the form cannot say otherwise** --
   * step 1 is headed "Query promoted observations" and says so again in a locked note,
   * because promotion is what makes an observation eligible for training at all.
   *
   * The selects carry what the API takes rather than what the reader sees: a project is
   * filtered by name, a model by `ml_model_id`. That is why `fillDatasetPickers` puts
   * the model's id in the option value.
   *
   * @returns {Object} A `MosaicQueryFilters`.
   */
  const mosaicFilters = () => {
    const filters = { trainingDisposition: ['promoted'] };
    const one = (id, key) => {
      const value = $('#' + id)?.value;
      if (value) filters[key] = [value];
    };

    one('dsproj', 'project');
    one('dsdive', 'dive');
    one('dsline', 'line');

    /* "Human annotation only" is the absence of a model, and the filter takes ids --
       there is no id for "none". Left unsent rather than sent as something that would
       quietly match everything.

       The empty string is tested before the number: `Number('')` is 0, `Number.isInteger(0)`
       is true, and "Any model" therefore filtered on model id 0 and matched nothing at
       all -- a query that looks like an answer. */
    const model = ($('#dsmodel')?.value || '').trim();
    if (model && Number.isInteger(Number(model))) filters.model = [Number(model)];

    /* Only when it is a real narrowing. Every box ticked is the same question as no
       species filter at all, and sending all of them would turn "anything" into a list
       that silently excludes a species promoted a minute later. */
    const boxes = $$('[data-species-menu] input[data-species-id]');
    const picked = boxes.filter((box) => box.checked);

    if (picked.length && picked.length < boxes.length) {
        filters.species = picked.map((box) => Number(box.dataset.speciesId));
    }

    const from = Number($('#dsconf')?.value);
    const to = Number($('#dsconfmax')?.value);
    const confidence = {};
    if (Number.isFinite(from)) confidence.from = from;
    if (Number.isFinite(to)) confidence.to = to;
    if (Object.keys(confidence).length) filters.confidence = confidence;

    return filters;
  };
  /**
   * The class breakdown, from the species facet.
   *
   * Top five by count, then one "Other" row carrying the rest. The remainder is
   * computed against the **total** rather than against the facet's own sum, so an
   * observation with no species lands in Other instead of disappearing -- the two
   * numbers would otherwise disagree with the headline count sitting directly above
   * them, which is exactly the kind of thing a reader notices and nobody can explain.
   *
   * Rebuilt rather than filled in place: the markup carried six rows because the
   * fixture always had six classes, and a question matching two species should draw
   * two bars, not two bars and four leftovers.
   *
   * @param {Element} container - The `.dist` element.
   * @param {Object[]} species - The facet's entries, `{label, count}`.
   * @param {number} total - The headline match count.
   */
  /** Whether the step 2 breakdown is showing every class or the largest five. */
  let compositionExpanded = false;

  /**
   * Show or hide the *All classes* control, and say which way it is pointing.
   *
   * **Hidden when it would do nothing.** A question matching five classes or fewer has
   * nothing to expand, and a control that is always there and sometimes inert is how this
   * screen ended up with two dead buttons in the first place.
   *
   * @param {number} hidden - How many classes the breakdown is not showing.
   */
  const updateCompositionToggle = (hidden) => {
    const button = $('[data-composition-toggle]');
    if (!button) return;

    button.hidden = hidden <= 0 && !compositionExpanded;
    button.setAttribute('aria-expanded', String(compositionExpanded));
    button.firstChild.textContent = compositionExpanded ? 'Top five ' : 'All classes ';
    button.title = compositionExpanded
      ? 'Show the largest five classes instead of every one'
      : 'Show every class in the result instead of the largest five';
  };

  const drawQueryComposition = (container, species, total, expandable) => {
    if (!container) return;

    const sorted = [...species].sort((a, b) => b.count - a.count);
    /* Expanded means every class, with no Other row to fold the rest into. The remainder
       below is then whatever the facet does not account for at all -- an observation with
       no species -- which is a real row and not a fold. */
    const expanded = Boolean(expandable) && compositionExpanded;
    const top = expanded ? sorted : sorted.slice(0, 5);
    const rest = expanded ? [] : sorted.slice(5);
    const counted = top.reduce((sum, s) => sum + s.count, 0);
    const remainder = Math.max(0, total - counted);
    const rows = top.map((s) => ({ label: s.label || 'Unnamed species', count: s.count }));

    if (expandable) updateCompositionToggle(sorted.length - top.length);

    /* Only when there is something left over. "Other (0 classes)" is noise, and a
       question that matched nothing should draw an empty panel rather than one row
       claiming a hundred per cent of nothing. */
    if (remainder > 0) {
      const classes = rest.length;
      rows.push({
        label: classes ? `Other (${classes} ${classes === 1 ? 'class' : 'classes'})` : 'Other',
        count: remainder,
      });
    }

    if (!rows.length) {
      container.innerHTML = '<span class="nodata">Nothing matches these filters.</span>';
      return;
    }

    const max = Math.max(...rows.map((r) => r.count), 1);

    /* A share cannot exceed the whole. When one did -- "White-plumed anemone 53, 129%",
       an unfiltered count over a filtered total -- the panel drew it without complaint
       and the only reason anybody knew was that Isaac read it. A breakdown that does not
       add up is a breakdown of two different questions, so say so instead of drawing a
       number that cannot be true. */
    const drawn = rows.reduce((sum, r) => sum + r.count, 0);

    if (total && drawn > total) {
      console.error(`MarpDashboard: a class breakdown of ${drawn} over a total of ${total}`);
      container.innerHTML = '<span class="nodata">These counts do not add up, so the '
        + 'breakdown is not shown. Run the query again.</span>';

      return;
    }

    container.innerHTML = rows.map((r) => {
      const pct = total ? Math.round(r.count / total * 100) : 0;
      return `<span class="k">${escapeHtml(r.label)}</span>`
        + `<span class="b"><i style="width:${(r.count / max * 100).toFixed(1)}%"></i></span>`
        + `<span class="v">${r.count.toLocaleString('en-US')}</span>`
        + `<span class="p">${pct}%</span>`;
    }).join('');
  };

  /**
   * Six sample pictures from the matching observations.
   *
   * `thumbnail_status` decides whether a row can be drawn: `storage/` is restored
   * separately from the database, so a recorded thumbnail whose file is gone answers
   * 404, and six broken image icons look like a broken screen rather than a missing
   * file.
   *
   * @param {Object[]} rows - Rows from the page query.
   * @param {number} total - The headline match count.
   */
  const drawSamples = (rows, total) => {
    const note = $('[data-query-sample-note]');
    // Five elements on this page carry `.thumbs`; the one this renderer owns is the
    // one beside the note. Taking the first on the page filled a different panel.
    const thumbs = note?.parentElement?.querySelector('.thumbs');
    const usable = rows.filter((r) => r.thumbnail_status === 'ready');

    if (thumbs) {
      thumbs.innerHTML = usable.length
        ? usable.map((r) => {
          const scope = [r.dive && `Dive ${r.dive}`, r.line && `Line ${r.line}`].filter(Boolean).join(' · ');
          const name = r.species_comname || r.comname || 'Observation';
          return `<figure title="${escapeHtml(`${name}${scope ? ` — ${scope}` : ''}`)}">`
            + `<img src="/api/v2/observations/${encodeURIComponent(r.observation_id)}/thumbnail" `
            + `alt="${escapeHtml(`${name} observed on ${scope || 'an unrecorded dive'}`)}" loading="lazy">`
            + `<figcaption>${escapeHtml(name)}</figcaption></figure>`;
        }).join('')
        : '<span class="nodata">No pictures for these matches yet.</span>';
    }

    if (note) {
      note.textContent = usable.length
        ? `${usable.length} of ${total.toLocaleString('en-US')} matches. The build cuts the full frame behind each one. Duplicates are ignored when adding.`
        : 'Duplicates are ignored when adding.';
    }
  };
  const setStatus = (message, kind = '') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  };
  /**
   * Ask MARP what these filters match.
   *
   * Three questions in one pass, because they are three different routes answering
   * three different things:
   *
   * - **counts** for the headline. `promoted` rather than `total`: the counts route
   *   ignores the status dimensions by design and returns all six, so `total` here is
   *   every observation the non-status filters reach, promoted or not.
   * - **facets** for the breakdown and for how many videos and species are in reach.
   *   This one *does* apply the status filters, so its species counts are promoted
   *   work and its sum agrees with the headline.
   * - **pages** for six sample pictures.
   * - **frames** for how much video it covers. Its `frames` is the keyframes *plus*
   *   the frames interpolated between them, which is what a dataset built from this
   *   question would contain and therefore what a training run is sized against.
   *
   * @returns {Promise<Object|null>} The result, or null if MARP could not answer.
   */
  const runQuery = async () => {
    const filters = mosaicFilters();
    const query = snapshot();

    setStatus('Counting what these filters match…');

    try {
      const [counts, facets, pageSet, frames] = await Promise.all([
        window.MarpApi.mosaicCounts(filters),
        window.MarpApi.mosaicFacets(filters, ['species', 'session']),
        window.MarpApi.mosaicPages(filters, 6),
        window.MarpApi.mosaicFrames(filters),
      ]);

      /* **The facets route leaves a dimension out of its own predicate**, deliberately:
         a dive list narrowed by the dives already chosen would only ever offer what is
         already chosen. That is right for the picker and wrong here. This is a breakdown
         of what matched, so a query asking only for sea cucumbers must not report the
         anemones beside them -- which it did, with the anemone's unfiltered count over
         the filtered total, giving "53, 129%".

         Narrowed here rather than by asking the route differently, because each species'
         own count is already correct: the species filter cannot change how many of
         species X there are, only whether X is included. */
      const chosen = filters.species && filters.species.length ? new Set(filters.species) : null;
      const species = (facets.species || [])
        .filter((entry) => !chosen || chosen.has(Number(entry.value)));

      const sessions = facets.session || [];
      const observations = counts.promoted || 0;

      currentResult = {
        query,
        key: JSON.stringify(filters),
        hash: hashFor(JSON.stringify(filters)),
        observations,
        frames: frames.frames || 0,
        keyframes: frames.keyframes || 0,
        videos: sessions.length,
        species: species.length,
        // Kept so the dataset's own composition can be summed from its subsets
        // rather than asked for again once they are assembled.
        speciesCounts: species.map((s) => ({ label: s.label || 'Unnamed species', count: s.count })),
      };

      if (resultFields.observations) resultFields.observations.textContent = observations.toLocaleString('en-US');
      if (resultFields.videos) resultFields.videos.textContent = currentResult.videos.toLocaleString('en-US');
      if (resultFields.species) resultFields.species.textContent = currentResult.species.toLocaleString('en-US');

      if (resultFields.frames) {
        resultFields.frames.textContent = currentResult.frames.toLocaleString('en-US');
        /* The tooltip says where the number comes from, because the gap between it and
           the keyframe count is large and surprising -- a few hundred boxes become tens
           of thousands of frames, and that is the point rather than a mistake. */
        resultFields.frames.closest('span')?.setAttribute('title',
          `${currentResult.keyframes.toLocaleString('en-US')} key frames, plus the frames `
          + 'interpolated between them, which are trained on as well');
      }

      drawQueryComposition($('[data-query-composition]'), species, observations, true);
      drawSamples(pageSet.pages?.[0]?.rows || [], observations);

      setStatus(observations
        ? 'Query refreshed. Add these matches as a new subset, or change the filters and run another query.'
        : 'Nothing promoted matches these filters. Widen them, or promote more observations in the mosaic.',
        observations ? '' : 'warning');

      return currentResult;
    } catch (error) {
      currentResult = null;
      for (const el of Object.values(resultFields)) if (el) el.textContent = '—';
      const composition = $('[data-query-composition]');
      if (composition) composition.innerHTML = '';
      setStatus(`Could not count the matches (${error.status || 'no answer'}). The filters were not changed.`, 'warning');
      return null;
    }
  };
  const reindex = () => {
    $$('li', list).forEach((row, index) => {
      const label = $('.s1', row);
      if (label) {
        const badge = $('.subset-split', label);
        if (!row.dataset.subsetLabel) {
          const labelOnly = label.cloneNode(true);
          $('.subset-split', labelOnly)?.remove();
          row.dataset.subsetLabel = labelOnly.textContent.trim().replace(/^\d+\.\s*/, '');
        }
        label.textContent = `${index + 1}. ${row.dataset.subsetLabel} `;
        if (badge) label.append(badge);
      }
      row.className = `g${index % 6 + 1}`;
    });
  };
  const recalc = () => {
    const rows = $$('li', list);
    const total = rows.reduce((sum, row) => sum + Number(row.dataset.unique || 0), 0);
    totalEl.dataset.total = String(total);
    totalEl.textContent = total.toLocaleString('en-US');
    const count = $('[data-subset-count]');
    if (count) count.textContent = `(${rows.length})`;
    list.classList.toggle('is-scrollable', rows.length > 4);
    const scrollNote = $('[data-subset-scroll-note]');
    if (scrollNote) scrollNote.hidden = rows.length <= 4;
    /* Summed from what each subset actually matched, rather than from a fixed set of
       shares. Two subsets that overlap count the shared observations twice here, the
       same way the total above does -- the build is what resolves that, and saying so
       is better than a number that looks exact and is not. */
    const tally = new Map();
    for (const row of rows) {
      for (const [label, count] of JSON.parse(row.dataset.species || '[]')) {
        tally.set(label, (tally.get(label) || 0) + count);
      }
    }

    const classes = [...tally].map(([label, count]) => ({ label, count }));
    drawQueryComposition($('[data-dataset-composition]'), classes, total);

    const summary = $('[data-dataset-composition-summary]');
    if (summary) {
      const counts = classes.map((c) => c.count).sort((a, b) => b - a);
      const imbalance = counts.length > 1 && counts.at(-1) > 0
        ? ` \u00b7 imbalance ${(counts[0] / counts.at(-1)).toFixed(1)} : 1` : '';
      summary.textContent = total
        ? `\u00b7 ${counts.length} ${counts.length === 1 ? 'class' : 'classes'}${imbalance}`
        : '\u00b7 no observations added';
    }
    document.dispatchEvent(new CustomEvent('dataset-total-change', { detail: { total } }));
  };
  const appendSubset = (result) => {
    if ($$('[data-query-key]', list).some((row) => row.dataset.queryKey === result.key)) {
      setStatus('That exact query is already in this dataset. Change a filter to add another subset.', 'warning');
      return;
    }
    /* **No overlap is claimed.** This used to invent one -- six to fifteen per cent of
       the match, from a hash -- and report it as "5 duplicates were ignored", which is
       a number nobody can check and everybody would believe. Knowing the real overlap
       means comparing observation ids across subsets, and the page route caps at 600
       rows, so the honest answer is that duplicates are resolved when the build runs. */
    const row = document.createElement('li');
    row.dataset.queryKey = result.key;
    row.dataset.raw = String(result.observations);
    row.dataset.unique = String(result.observations);
    row.dataset.split = selectedSplit;
    row.dataset.species = JSON.stringify((result.speciesCounts || []).map((s) => [s.label, s.count]));
    /* The filters that produced it, so queueing a build sends what was asked for rather
       than the ids one browser happened to count. `key` is already that JSON. */
    row.dataset.filters = result.key;

    /* Either a share map or a single split. The build divides by the first and obeys
       the second, so the row carries whichever was asked for. */
    const shares = splitShares();

    if (shares) row.dataset.shares = JSON.stringify(shares);
    row.dataset.subsetLabel = `${result.query.dsproj} \u00b7 ${result.query.dsspecies}`;

    const title = document.createElement('span');
    title.className = 's1';
    title.textContent = `${result.query.dsproj} \u00b7 ${result.query.dsspecies} `;
    const splitBadge = document.createElement('i');
    splitBadge.className = `subset-split ${selectedSplit}`;
    /* The badge says what the subset actually does. A divided one labelled "Train" is
       the same lie the split panel was telling. */
    const badgeShares = splitShares();

    splitBadge.textContent = badgeShares
      ? Object.entries(badgeShares)
        .map(([name, value]) => `${name[0].toUpperCase()}${value}`).join(' / ')
      : splitLabels[selectedSplit];

    if (badgeShares) splitBadge.className = 'subset-split divided';
    title.append(splitBadge);
    const detail = document.createElement('span');
    detail.className = 's2';
    const scope = [result.query.dsdive, result.query.dsline].filter((v) => v && !v.startsWith('All '));
    detail.textContent = `${scope.length ? scope.join(' \u00b7 ') : 'All dives and lines'} | Confidence ${result.query.dsconf}\u2013${result.query.dsconfmax} | ${result.query.dsmodel}`;
    const amount = document.createElement('span');
    amount.className = 's3';
    amount.append(document.createTextNode(result.observations.toLocaleString('en-US')));
    const amountLabel = document.createElement('em');
    amountLabel.textContent = 'observations';
    amount.append(amountLabel);
    const remove = document.createElement('button');
    remove.className = 'btn sm icon';
    remove.type = 'button';
    remove.dataset.removeSubset = '';
    remove.title = 'Take this query out of the dataset';
    remove.setAttribute('aria-label', `Remove ${result.query.dsproj} query`);
    remove.innerHTML = '<svg class="ico sm"><use href="#i-x"/></svg>';
    row.append(title, detail, amount, remove);
    list.append(row);
    reindex();
    recalc();
    const where = badgeShares
      ? `divided across ${Object.keys(badgeShares).join(', ')}`
      : `to ${splitLabels[selectedSplit]}`;

    setStatus(`Added ${result.observations.toLocaleString('en-US')} matching observations `
      + `${where}. An observation matched by more than one subset is counted once, and `
      + 'keeps its first split, when the build runs.', 'success');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  /* Re-run before adding, so a subset is never assembled from a count taken before
     the filters were last touched. A failed count adds nothing. */
  const addCurrent = async () => {
    const result = await runQuery();
    if (result) appendSubset(result);
  };

  $('[data-run-dataset-query]')?.addEventListener('click', runQuery);
  /**
   * Queue a build of whatever is in the subset list.
   *
   * **The filters go, not the observation ids.** A build re-runs the query server-side,
   * so the dataset is a record of what was asked for rather than of what one browser
   * happened to count a minute earlier. It is also the only version that works: a list
   * of a hundred thousand ids is not a request body.
   *
   * Each subset carries its own filters and its own split, which is what makes the
   * three-step builder mean anything -- "these dives into train, those into eval" is a
   * sentence the API has to be told, not one it can infer from a merged filter.
   */
  /**
   * The shares this query is divided by, or null when it all goes to one split.
   *
   * Zero is a real answer and means that split gets none -- somebody building without a
   * test set says so by typing 0, and silently restoring it to 10 would build a dataset
   * they did not ask for. All three at zero is not a split at all, so it falls back to
   * sending everything to the chosen destination rather than producing nothing.
   *
   * @returns {?Object} Split name to share, or null for the single-destination mode.
   */
  const splitShares = () => {
    if ($('[data-split-mode="one"]')?.classList.contains('on')) return null;

    const shares = {};

    for (const name of ['train', 'validation', 'test']) {
      const value = Number($('#share' + name[0].toUpperCase() + name.slice(1))?.value);

      if (Number.isFinite(value) && value > 0) shares[name] = value;
    }

    return Object.keys(shares).length ? shares : null;
  };

  /**
   * What the shares add up to, said plainly.
   *
   * They are normalised rather than required to total 100 -- 2:1:1 is a perfectly clear
   * way to say it -- but somebody typing 70/20/20 usually meant 70/20/10, so the note
   * says what they will actually get rather than silently correcting or refusing.
   */
  const refreshShareNote = () => {
    const note = $('[data-share-note]');
    const shares = splitShares();

    if (!note) return;

    if (!shares) {
      note.textContent = '';
      return;
    }

    const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
    const parts = Object.entries(shares)
      .map(([name, value]) => `${name} ${Math.round(100 * value / total)}%`).join(' · ');

    note.textContent = total === 100
      ? `${parts}, measured in frames.`
      : `Adds up to ${total}, so it is read as ${parts}.`;
  };

  /** What the add button promises, which is whichever mode is on. */
  const refreshAddLabel = () => {
    const label = $('[data-add-query-label]');
    const shares = splitShares();

    if (!label) return;

    label.textContent = shares
      ? `Add all matching, divided across ${Object.keys(shares).length} splits`
      : `Add all matching to ${splitLabels[selectedSplit]}`;
  };

  const queueBuild = async () => {
    const rows = $$('li', list);

    if (!rows.length) {
      setStatus('Add at least one query before building. A dataset with no observations has nothing to train on.', 'warning');
      return;
    }

    const name = $('#dsname')?.value.trim();

    if (!name) {
      setStatus('Give the dataset a name first; it is how anybody finds it again.', 'warning');
      $('#dsname')?.focus();
      return;
    }

    const button = $('[data-queue-build]');

    if (button) button.disabled = true;

    setStatus('Queueing the build…');

    try {
      const subsets = rows.map((row) => {
        const subset = { filters: JSON.parse(row.dataset.filters || '{}') };

        if (row.dataset.shares) subset.shares = JSON.parse(row.dataset.shares);
        else subset.split = row.dataset.split || 'train';

        return subset;
      });

      const queued = await window.MarpApi.queueDatasetBuild({
        name,
        description: $('#dsdesc')?.value.trim() || null,
        subsets,
        /* Sent as well as the per-subset splits, because a build with one subset and no
           split named still has to divide into something. */
        splits: { train: 0.8, eval: 0.2 },
      });

      setStatus(`Build queued as job ${queued.job.id}. It cuts the frames, writes the labels and `
        + 'packages the archive; it appears in the table below with its frame count and phase, '
        + 'and can be cancelled from the Jobs screen.', 'success');

      /* The saved list is where a building dataset appears, so tell the table rather than
         leaving the reader to wonder whether anything happened. An event rather than a
         call, because the table owns its own polling now: it refreshes, notices the new
         build and starts watching, instead of this handler reaching inside it. */
      document.dispatchEvent(new CustomEvent('marp:dataset-build-queued'));
    } catch (error) {
      setStatus(`Could not queue the build (${error.status || 'no answer'}). Nothing was started.`, 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  };

  $('[data-queue-build]')?.addEventListener('click', queueBuild);

  /* Divide-across versus all-to-one. The shares and the destination buttons are the two
     halves of one question, so only the one being asked is on screen. */
  const modeButtons = $$('[data-split-mode]');

  modeButtons.forEach((button) => button.addEventListener('click', () => {
    modeButtons.forEach((other) => {
      const on = other === button;

      other.classList.toggle('on', on);
      other.setAttribute('aria-pressed', String(on));
    });

    const sharing = button.dataset.splitMode === 'share';
    const shares = $('[data-split-shares]');
    const one = $('[data-split-one]');

    if (shares) shares.hidden = !sharing;
    if (one) one.hidden = sharing;

    refreshShareNote();
    refreshAddLabel();
  }));

  for (const name of ['Train', 'Validation', 'Test']) {
    $('#share' + name)?.addEventListener('input', () => { refreshShareNote(); refreshAddLabel(); });
  }

  refreshShareNote();
  refreshAddLabel();

  /* The species menu is rebuilt whenever the question around it changes, so its rows
     are delegated rather than bound. */
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-species-menu] input[data-species-id]')) refreshSpeciesLabel();
  });

  document.addEventListener('click', (event) => {
    const all = event.target.closest('[data-species-all]');
    const none = event.target.closest('[data-species-none]');

    if (!all && !none) return;

    const group = (all || none).closest('.species-list');

    $$('input[data-species-id]', group).forEach((box) => { box.checked = Boolean(all); });
    refreshSpeciesLabel();
  });

  /**
   * Point *More samples* at the Mosaic Reviewer, on whatever the filters currently say.
   *
   * **Kept current as the controls move, not computed on click.** It is a real link, so a
   * reader may middle-click it, copy its address or open it in a new tab without ever
   * firing a click handler -- and all three have to arrive at the same question the panel
   * beside them is describing.
   */
  const refreshMosaicLink = () => {
    const link = $('[data-mosaic-link]');
    if (link) link.href = mosaicReviewUrl(mosaicFilters());
  };

  /* The reachable species depend on the rest of the question, so narrowing the project
     or the dive narrows what is on offer. Without this the picker keeps showing species
     that the dive you just chose has ruled out, and ticking one returns nothing. */
  for (const id of ['dsproj', 'dsdive', 'dsline', 'dsmodel']) {
    $('#' + id)?.addEventListener('change', () => {
      const { species, ...rest } = mosaicFilters();

      fillSpeciesPicker(rest);
    });
  }

  /* Every control that is part of the question. `filterIds` is the list the snapshot
     already keeps, so a filter added later is caught here by having been added there --
     one list rather than two that drift. The species menu is checkboxes rather than a
     field, so it is listened to where it lives. */
  for (const id of filterIds) {
    const el = $('#' + id);
    if (!el) continue;
    el.addEventListener('change', refreshMosaicLink);
    if (el.tagName === 'INPUT') el.addEventListener('input', refreshMosaicLink);
  }
  $('[data-species-menu]')?.addEventListener('change', refreshMosaicLink);
  refreshMosaicLink();

  /**
   * *All classes* expands the breakdown in place rather than opening anything.
   *
   * Isaac, 2026-10-21: *"I'm not sure all classes is even needed as a link."* It is not a
   * link -- there is nowhere for it to go that the panel underneath is not already
   * showing -- but the breakdown folds everything past the fifth class into one Other row,
   * and a reader deciding what a dataset is made of sometimes wants the tail. So it
   * expands, and it is hidden entirely when there is no tail to show.
   */
  $('[data-composition-toggle]')?.addEventListener('click', () => {
    compositionExpanded = !compositionExpanded;
    /* `speciesCounts`, not `species` -- the latter is how *many* species matched, and
       passing a number where the rows are expected drew an empty breakdown. */
    drawQueryComposition($('[data-query-composition]'), currentResult?.speciesCounts || [],
      currentResult?.observations || 0, true);
  });

  const destinationButtons = $$('[data-dataset-destination]');
  destinationButtons.forEach((button) => button.addEventListener('click', () => {
    selectedSplit = button.dataset.datasetDestination;
    destinationButtons.forEach((other) => {
      const on = other === button;
      other.classList.toggle('on', on);
      other.setAttribute('aria-pressed', String(on));
    });
    refreshAddLabel();
  }));
  $('#addQuery')?.addEventListener('click', addCurrent);
  $('[data-add-query]')?.addEventListener('click', addCurrent);
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-subset]');
    if (!button) return;
    const row = button.closest('li');
    const removed = $('.s1', row)?.textContent.replace(/^\d+\.\s*/, '') || 'subset';
    row.remove();
    reindex();
    recalc();
    setStatus(`Removed ${removed}. Totals, composition and split counts were recalculated.`, 'success');
  });
  recalc();
}

/**
 * Summarize the explicit split destinations chosen as each query was added.
 * Assignment happens at add time; this panel is deliberately read-only. A
 * duplicate observation or connected frame group retains its first assignment.
 */
function wireSplit() {
  const summary = $('[data-split-summary]');
  const list = $('[data-subset-list]');
  if (!summary || !list) return;

  const bars = [$('#barTr'), $('#barVa'), $('#barTe')];
  const pcs = [$('#pcTr'), $('#pcVa'), $('#pcTe')];
  const nums = [$('#trN'), $('#vaN'), $('#teN')];
  const note = $('#splitNote');
  const splitNames = ['train', 'validation', 'test'];

  const draw = () => {
    const rows = $$('li', list);

    /* A subset either names one split or carries shares to be divided by. This counted
       only the first, so a subset added as "divided across 3 splits" showed its whole
       count under Train -- which is what Isaac saw: 41 in train, 0 and 0 beside it.

       The division itself happens server-side at build time, over whole connected
       groups, so these are estimates: the real split moves a group at a time and cannot
       land on an exact percentage. Saying so is better than showing a number that will
       not be the one in the archive. */
    let estimated = false;

    const counts = splitNames.map((split) => rows.reduce((sum, row) => {
      const unique = Number(row.dataset.unique || 0);

      if (!row.dataset.shares) return sum + (row.dataset.split === split ? unique : 0);

      const shares = JSON.parse(row.dataset.shares);
      const whole = Object.values(shares).reduce((a, b) => a + b, 0) || 1;

      if (shares[split]) estimated = true;

      return sum + Math.round(unique * (shares[split] || 0) / whole);
    }, 0));

    const total = counts.reduce((sum, count) => sum + count, 0);
    counts.forEach((count, index) => {
      const pct = total ? count / total * 100 : 0;
      if (bars[index]) bars[index].style.width = pct.toFixed(2) + '%';
      if (pcs[index]) pcs[index].textContent = Math.round(pct) + '%';
      if (nums[index]) nums[index].textContent = count.toLocaleString('en-US');
      const split = splitNames[index];
      const subsetCount = rows.filter((row) => (row.dataset.shares
        ? Boolean(JSON.parse(row.dataset.shares)[split])
        : row.dataset.split === split)).length;
      const subsetLabel = $(`[data-split-subsets="${split}"]`);
      if (subsetLabel) subsetLabel.textContent = `${subsetCount} subset${subsetCount === 1 ? '' : 's'}`;
    });

    /* An estimate says nothing a reader can act on -- the numbers above already move
       when the shares do, and the caveat about whole groups is the split rule, which
       belongs on the control that applies it rather than under the figures.

       The other state is worth keeping, because it explains a number that will not add
       up otherwise: every subset went to one split, so these counts are exact, and a
       subset that contributed fewer than it matched did so because something it matched
       was already placed. Said in the words the screen uses elsewhere -- "first
       assignment wins" named the rule without saying what it does to you. */
    if (note) {
      note.textContent = estimated
        ? ''
        : 'An observation matched twice stays in the split that took it first, and overlapping frames go with it';
    }
  };

  document.addEventListener('dataset-total-change', draw);
  draw();
}

/**
 * A long lineage keeps its middle folded until asked. One line of behaviour,
 * because a chain of ten otherwise fills the column it lives in.
 */
function wireLineage() {
  $$('.lmorebtn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = b.closest('.lin');
      if (list) list.classList.add('open');
    });
  });
}

/**
 * A table whose selected row is described by a panel below it. One row at a
 * time, and clicking a row action is not clicking the row.
 */
function wireRowSelect() {
  $$('table.selectable tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a, select')) return;
      $$('table.selectable tbody tr.sel').forEach((o) => o.classList.remove('sel'));
      tr.classList.add('sel');
    });
  });
}

/**
 * The top bar gets out of the way of the reading (#151).
 *
 * Scroll down and it goes; start back up and it returns. There is deliberately **no
 * control** for it here, and that is the difference from the Picture Mosaic Reviewer,
 * which has a button: that app does not scroll, so hiding its chrome needs a gesture of
 * its own. This one scrolls, so the gesture is already in the reader's hand.
 *
 * `.content` is the scroller, not the window -- `.app` is a `100dvh` grid and the tab
 * content is the only thing in the app that scrolls, so a listener on `window` would
 * never hear anything.
 *
 * Three things here are not obvious, and each is a way this goes wrong:
 *
 * - **A threshold, and it does not reset the mark.** Under six pixels nothing happens, so
 *   trackpad noise and a momentum bounce cannot flap the bar. But the reference point is
 *   left where it was, so a slow deliberate drag accumulates and still decides -- resetting
 *   it per event is what makes a slow scroll unable to move the bar at all.
 * - **A settle window after each toggle.** Hiding the bar hands its height to the content,
 *   which *shrinks* the scroller's maximum scroll position -- so a reader already at the
 *   bottom is clamped upward by exactly that height, which reads as scrolling up and brings
 *   the bar straight back. The window is what stops the bottom of every long page flapping.
 * - **The floor.** At the top of the content, and whenever there is nothing to scroll, the
 *   bar is on screen -- no matter what happened on the way there. A bar that can be stuck
 *   hidden is a defect, and the content can stop being scrollable without anybody scrolling,
 *   which is why the observer below watches for the content changing under it.
 */
function wireTopbarAutohide() {
  const bar = $('.topbar');
  const content = $('.content');
  if (!bar || !content) return;

  /* Enough movement to be a decision rather than noise, and long enough for a layout
     change to stop arriving as a scroll. Both are in DESIGN.md's sense of a number that
     was chosen: see .marp/task.md for why these two. */
  const STEP = 6;
  const SETTLE = 180;

  /** Returns whether this actually changed anything, so only a real move starts the timer. */
  const set = (hidden) => {
    const next = hidden ? 'hidden' : 'shown';
    if (document.body.dataset.topbar === next) return false;
    document.body.dataset.topbar = next;
    return true;
  };

  /* The bar is offset by its own height, and only it knows what that is -- it follows its
     content, and it wraps differently at the narrow widths. Measured rather than written
     down in two places. A zero is refused: see `align-self: start` in mock.css, where a
     measurement of zero is the shape the flap takes. */
  const measure = () => {
    const h = bar.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--topbar-h', `${h}px`);
  };
  new ResizeObserver(measure).observe(bar);
  measure();

  let mark = content.scrollTop;
  let settled = 0;

  /** The two places the bar always belongs on screen. True when it took the decision. */
  const floor = () => {
    const room = content.scrollHeight - content.clientHeight;
    if (room <= STEP || content.scrollTop <= STEP) {
      set(false);
      mark = content.scrollTop;
      return true;
    }
    return false;
  };

  content.addEventListener('scroll', () => {
    if (floor()) return;
    const y = content.scrollTop;
    /* The menu belongs to the bar. Keep both on screen while somebody is using it. */
    if (!bar.querySelector('[data-account-menu]')?.hidden) {
      set(false);
      mark = y;
      return;
    }
    /* Inside the settle window the position is followed but not acted on -- the scroll
       that arrives here is the layout's, not the reader's. */
    if (Date.now() < settled) { mark = y; return; }
    const moved = y - mark;
    if (Math.abs(moved) < STEP) return;
    mark = y;
    if (set(moved > 0)) settled = Date.now() + SETTLE;
  }, { passive: true });

  /* A tab switch, a filter or a drawer can leave the content too short to scroll while the
     bar is hidden, and no scroll event ever comes to put it right. */
  new MutationObserver(floor).observe(content, { childList: true, subtree: true });
  window.addEventListener('resize', floor);
  floor();
}

/**
 * The operational charts, drawn from MARP rather than from arrays.
 *
 * **What this replaced.** Each panel carried a `configs` entry holding twenty-four
 * hand-written numbers per series per range -- `registered: [22,22,23,23,...]`,
 * `completed: [...]`, `turnaround: [...]` -- and drew them. Nothing about them came from
 * MARP, and because they were plausible they were read as evidence: `DESIGN.md` gap 22 was
 * written from them, saying the rollup "is not served as an operational series", which was a
 * statement about the mockup.
 *
 * **History is answerable with nothing sampled.** `GET /gpu/jobs/series` counts out of
 * `gpu_jobs`: `finished` per bucket, `succeeded` within it, and the median time from
 * submission to finish. The issue rate is the two counts against each other. None of it
 * existed before `finished_at` did.
 *
 * Panels whose series MARP does not hold are left alone -- their markup says so instead.
 *
 * @returns {Promise<void>}
 */
/**
 * The Workers screen's pool-capacity chart, split by what the compute was spent on.
 *
 * Four lines the design asks for: inference, training, VRAM pressure and queued work.
 *
 * **The split is real as of 2026-10-20.** It could not be drawn before, because a GPU
 * reading said how hard a card was working and not what it was working on. The sample now
 * records `job_kind` at heartbeat time, so `GET /gpu/telemetry/series` can report what the
 * machines running inference were doing separately from the ones training. Averaging them
 * together gave a number describing neither: a bucket with nine machines inferring at 90%
 * and one training at 98% reads 83% blended, which is true of nothing on the pool.
 *
 * Queued work comes from the job series rather than the telemetry one — it is a fact about
 * the queue, not about a card — so the two are fetched together.
 *
 * @returns {Promise<void>}
 */
async function wirePoolCapacity() {
  const root = $('[data-ops-activity="workers"]');
  if (!root || !$('.ops-chart', root)) return;

  const RANGES = {
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
    '5h': { hours: 5, bucket: 'minute', label: 'the last 5 hours' },
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
  };

  const lines = Object.fromEntries($$('[data-ops-line]', root).map((l) => [l.dataset.opsLine, l]));
  const area = $('[data-ops-area]', root);
  const buttons = $$('[data-ops-range]', root);
  const chart = $('.ops-chart', root);
  const leftAxis = $$('.inference-axis.left text:not(.axis-title):not([data-ops-time])', root);
  const rightAxis = $$('.inference-axis.right text:not(.axis-title)', root);

  const x = (i, n) => 54 + 672 * i / Math.max(1, n - 1);
  const y = (v, max) => 196 - 168 * (v / Math.max(1, max));
  const pathOf = (values, max) => values
    .map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length).toFixed(1)},${y(v, max).toFixed(1)}`).join(' ');
  const areaOf = (values, max) => `${pathOf(values, max)} L${x(values.length - 1, values.length).toFixed(1)},196 L54,196 Z`;

  const clock = (iso) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  async function choose(next) {
    buttons.forEach((b) => {
      const on = b.dataset.opsRange === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const { hours, bucket, label } = RANGES[next] || RANGES['5h'];
    const until = new Date();
    const since = new Date(until.getTime() - hours * 3600 * 1000);
    const span = { since: since.toISOString(), until: until.toISOString(), bucket };

    try {
      const [gpu, jobs] = await Promise.all([
        window.MarpApi.gpuSeries(span),
        window.MarpApi.jobSeries(span),
      ]);

      const points = gpu.points || [];
      const queuedBy = new Map((jobs.points || []).map((p) => [String(p.at), p.waiting || 0]));

      const samples = {
        inference: points.map((p) => p.avg_inference_utilization_percent || 0),
        training: points.map((p) => p.avg_training_utilization_percent || 0),
        vram: points.map((p) => p.avg_memory_percent_used || 0),
        queued: points.map((p) => queuedBy.get(String(p.at)) || 0),
      };

      const anyReading = points.some((p) => p.machines > 0);

      if (!points.length || !anyReading) {
        [...Object.values(lines), area].forEach((n) => n && n.removeAttribute('d'));
        leftAxis.concat(rightAxis).forEach((t) => { t.textContent = ''; });
        if (chart) {
          chart.setAttribute('aria-label',
            `No GPU readings in ${label}. A machine reports while it works, and a worker has to be `
            + 'running a build that sends telemetry on its heartbeat.');
        }
        root.classList.add('is-quiet');
        return;
      }

      root.classList.remove('is-quiet');

      /* Utilization and VRAM are percentages and share the left axis; the queue
         is a count and keeps the right one.

         Rounded up to a whole number of ticks, so a quiet queue does not produce
         an axis reading 1, 1, 1, 0, 0 -- a scale whose labels repeat says less
         than no scale at all. */
      const queueSteps = Math.max(1, rightAxis.length - 1);
      const queuePeak = Math.max(...samples.queued, 0);
      const maxQueued = Math.max(queueSteps, Math.ceil(queuePeak / queueSteps) * queueSteps);

      if (lines.inference) lines.inference.setAttribute('d', pathOf(samples.inference, 100));
      if (area) area.setAttribute('d', areaOf(samples.inference, 100));
      if (lines.training) lines.training.setAttribute('d', pathOf(samples.training, 100));
      if (lines.vram) lines.vram.setAttribute('d', pathOf(samples.vram, 100));
      if (lines.queued) lines.queued.setAttribute('d', pathOf(samples.queued, maxQueued));

      const ticks = (nodes, top, format) => nodes.forEach((t, i) => {
        const steps = Math.max(1, nodes.length - 1);
        t.textContent = format(top * (steps - i) / steps);
      });

      ticks(leftAxis, 100, (v) => `${Math.round(v)}%`);
      ticks(rightAxis, maxQueued, (v) => String(Math.round(v)));

      $$('[data-ops-time]', root).forEach((t, i) => {
        const at = [points[0], points[Math.floor(points.length / 2)], points.at(-1)][i];
        if (at) t.textContent = i === 2 ? 'Now' : clock(at.at);
      });

      const last = points.at(-1);
      const current = {
        inference: `${Math.round(last.avg_inference_utilization_percent || 0)}%`,
        training: `${Math.round(last.avg_training_utilization_percent || 0)}%`,
        vram: `${Math.round(last.avg_memory_percent_used || 0)}%`,
        queued: String(samples.queued.at(-1)),
      };

      $$('[data-ops-current]', root).forEach((node) => {
        if (current[node.dataset.opsCurrent] !== undefined) node.textContent = current[node.dataset.opsCurrent];
      });

      if (chart) {
        chart.setAttribute('aria-label', `Pool capacity over ${label}: inference ${current.inference}, `
          + `training ${current.training}, VRAM ${current.vram}, ${current.queued} waiting`);
      }
    } catch (error) {
      [...Object.values(lines), area].forEach((n) => n && n.removeAttribute('d'));
      if (chart) chart.setAttribute('aria-label', `Could not load pool capacity (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.opsRange)));
  await choose('5h');
}

async function wireOperationalActivity() {
  const root = $('[data-ops-activity="history"]');
  if (!root || !$('.ops-chart', root)) return;

  const RANGES = {
    '7d': { days: 7, bucket: 'day', label: '7 days' },
    '30d': { days: 30, bucket: 'day', label: '30 days' },
    '90d': { days: 90, bucket: 'day', label: '90 days' },
  };

  const lines = Object.fromEntries($$('[data-ops-line]', root).map((l) => [l.dataset.opsLine, l]));
  const area = $('[data-ops-area]', root);
  const buttons = $$('[data-ops-range]', root);
  const chart = $('.ops-chart', root);
  const leftAxis = $$('.inference-axis.left text:not(.axis-title):not([data-ops-time])', root);
  const rightAxis = $$('.inference-axis.right text:not(.axis-title)', root);

  const x = (i, n) => 54 + 672 * i / Math.max(1, n - 1);
  const y = (v, max) => 196 - 168 * (v / Math.max(1, max));

  const pathOf = (values, max) => values
    .map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length).toFixed(1)},${y(v, max).toFixed(1)}`).join(' ');

  /** The same line closed down to the baseline, for the filled area under it. */
  const areaOf = (values, max) => `${pathOf(values, max)} L${x(values.length - 1, values.length).toFixed(1)},196 L54,196 Z`;

  const hours = (seconds) => {
    if (!seconds) return '0';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };

  const day = (iso) => new Date(iso).toISOString().slice(5, 10);

  async function choose(next) {
    buttons.forEach((b) => {
      const on = b.dataset.opsRange === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const { days, bucket, label } = RANGES[next] || RANGES['30d'];
    const until = new Date();
    const since = new Date(until.getTime() - days * 86400000);

    try {
      const series = await window.MarpApi.jobSeries({
        since: since.toISOString(), until: until.toISOString(), bucket,
      });

      const points = series.points || [];
      const completed = points.map((p) => p.finished || 0);
      /* The share of finishing work that did not succeed. Expressed against the
         same bucket rather than against the whole window, so a bad afternoon
         shows as a spike instead of being averaged away. */
      const issues = points.map((p) => (p.finished ? Math.round(((p.finished - (p.succeeded || 0)) / p.finished) * 100) : 0));
      const turnaround = points.map((p) => p.median_turnaround_s || 0);

      const peak = Math.max(...completed, 0);

      if (!points.length || peak === 0) {
        [...Object.values(lines), area].forEach((n) => n && n.removeAttribute('d'));
        leftAxis.concat(rightAxis).forEach((t) => { t.textContent = ''; });
        if (chart) chart.setAttribute('aria-label', `Nothing finished in the last ${label}`);
        root.classList.add('is-quiet');
        return;
      }

      root.classList.remove('is-quiet');

      const maxJobs = Math.max(3, Math.ceil(peak / 3) * 3);
      const maxTurn = Math.max(1, ...turnaround);

      if (lines.completed) lines.completed.setAttribute('d', pathOf(completed, maxJobs));
      if (area) area.setAttribute('d', areaOf(completed, maxJobs));
      /* The issue rate is a percentage and the turnaround is seconds; each is
         scaled to its own axis, which is why the chart carries two. */
      if (lines.issues) lines.issues.setAttribute('d', pathOf(issues, 100));
      if (lines.turnaround) lines.turnaround.setAttribute('d', pathOf(turnaround, maxTurn));

      /* Steps from the tick count the markup actually has. Assuming four gave
         the Workers chart a fifth label reading -33%, which is a utilization
         nothing can have. */
      const ticks = (nodes, top, format) => nodes.forEach((t, i) => {
        const steps = Math.max(1, nodes.length - 1);
        t.textContent = format(top * (steps - i) / steps);
      });

      ticks(leftAxis, maxJobs, (v) => String(Math.round(v)));
      ticks(rightAxis, maxTurn, (v) => hours(Math.round(v)));

      $$('[data-ops-time]', root).forEach((t, i) => {
        const at = [points[0], points[Math.floor(points.length / 2)], points.at(-1)][i];
        if (at) t.textContent = i === 2 ? 'Now' : day(at.at);
      });

      const last = points.at(-1);
      const current = {
        completed: String(last.finished || 0),
        issues: `${last.finished ? Math.round(((last.finished - (last.succeeded || 0)) / last.finished) * 100) : 0}%`,
        turnaround: hours(last.median_turnaround_s),
      };

      $$('[data-ops-current]', root).forEach((node) => {
        if (current[node.dataset.opsCurrent] !== undefined) node.textContent = current[node.dataset.opsCurrent];
      });

      if (chart) {
        chart.setAttribute('aria-label', `Completion activity over ${label}: `
          + `${completed.at(-1)} finished in the last bucket, ${current.issues} with issues, `
          + `median turnaround ${current.turnaround}`);
      }
    } catch (error) {
      [...Object.values(lines), area].forEach((n) => n && n.removeAttribute('d'));
      if (chart) chart.setAttribute('aria-label', `Could not load completion activity (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.opsRange)));
  await choose('30d');
}

function wireModelRegistration() {
  const drawer = $('#modelRegisterDrawer');
  const scrim = $('#modelRegisterScrim');
  const form = $('#modelRegisterForm');
  if (!drawer || !scrim || !form) return;
  const opener = $('[data-top-action="register"]');
  const status = $('[data-model-register-status]', drawer);
  const source = $('[data-model-source]', drawer);
  const upload = $('[data-model-upload]', drawer);
  const uri = $('[data-model-uri]', drawer);
  const setOpen = (open) => {
    drawer.hidden = !open;
    scrim.hidden = !open;
    document.body.classList.toggle('has-drawer', open);
    if (open) {
      if (status) status.textContent = '';
      $('[name="name"]', form)?.focus();
    } else opener?.focus();
  };
  const setSource = () => {
    const isUpload = source?.value === 'upload';
    if (upload) upload.hidden = !isUpload;
    if (uri) uri.hidden = isUpload;
  };
  opener?.addEventListener('click', () => setOpen(true));
  $$('[data-model-register-close]', drawer).forEach((button) => button.addEventListener('click', () => setOpen(false)));
  scrim.addEventListener('click', () => setOpen(false));
  source?.addEventListener('change', setSource);
  drawer.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (status) status.textContent = `${data.get('name')} ${data.get('version')} is ready to register.`;
  });
  setSource();
}

/* ==================================================================== boot */

/**
 * Run one piece of wiring, and do not let it take the others with it.
 *
 * **Every screen is wired by one long run of calls in a single script.** A throw anywhere in
 * it stops the script, so everything after that line never runs -- and because the failure
 * is usually in a chart nobody is looking at, what a person sees is a *table* that never
 * filled. That reads as "the API is down", which is the wrong place to look.
 *
 * It happened three times on 2026-10-20 alone: a chart wiring that still expected an SVG
 * that had been replaced by an empty state; a function removed by an edit whose call was
 * left behind; and a helper renamed in one place. Each time the visible symptom was a blank
 * table on a page whose own data was fine.
 *
 * So each piece is isolated. A broken chart is a broken chart.
 *
 * @param {string} name - What is being wired, for the message.
 * @param {Function} wire - The wiring.
 * @returns {void}
 */
function boot(name, wire) {
  try {
    const result = wire();
    /* An async wiring rejects rather than throws, and would otherwise be an
       unhandled rejection nobody sees. */
    if (result && typeof result.catch === 'function') {
      result.catch((error) => console.error(`MarpDashboard: ${name} failed —`, error));
    }
  } catch (error) {
    console.error(`MarpDashboard: ${name} failed —`, error);
  }
}

document.body.dataset.rail = 'closed';
boot('sprite', mountSprite);
boot('rail', mountRail);
boot('rail-badges', fillRailBadges);
boot('topbar', mountTopbar);
boot('topbar autohide', wireTopbarAutohide);
boot('rail sheet', wireRailSheet);

boot('switchers', wireSwitchers);
boot('pool utilization', wirePoolUtilization);
boot('inference throughput', wireInferenceThroughput);
boot('registry trend', wireRegistryTrend);
boot('training activity', wireTrainingActivity);
boot('dataset activity', wireDatasetActivity);
boot('completion activity', wireOperationalActivity);
boot('pool capacity', wirePoolCapacity);
boot('model registration', wireModelRegistration);
boot('sliders', wireSliders);
boot('inference form', wireInferenceForm);
boot('accordions', wireAccordions);
boot('dataset builder', wireDatasetBuilder);
boot('split', wireSplit);
boot('lineage', wireLineage);
boot('row select', wireRowSelect);

/* **Rows first, then the wiring that needs rows.** The Jobs table is filled
   from the data layer, which is asynchronous because it has to be -- swapping
   it for real `fetch` calls is meant to be the whole of the wiring work, and a
   synchronous layer could not be swapped for one. So the four that bind to rows
   wait, and everything above, which does not care, has already run.

   Off those screens each render resolves without doing anything, so this costs
   one microtask and no special case. */
Promise.all([renderJobsTable(), renderWorkersTable(), renderDashboardScreen(), renderHistoryScreen(), renderModelsScreen(), renderInferenceScreen(), renderTrainingScreen(), wireDatasetPage()]).then(() => {
  /* `applyJobsQuery` and `applyWorkersQuery` rewire the rows they draw; these
     are the ones that bind once, to controls that outlive every redraw. */
  wireJobsControls();
  wireWorkersControls();
  wireHistoryControls();
  wireModelsControls();
  wireSorting();
  /* **Not `wireJobsOverview()`.** `applyJobsQuery` calls it on every render,
     including the first, so calling it here bound every result-graph legend a
     second time -- and a second listener undid what the first did, leaving a
     button that visibly worked and highlighted nothing. The row loop guards
     itself against a repeat; the graph bindings could not. */
  wireSelection();
  applyTips();
});
