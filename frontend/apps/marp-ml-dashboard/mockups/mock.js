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
  { id: 'jobs', label: 'Jobs', badge: 8, tone: 'attn',
    tip: 'The GPU queue: inference, tracking and training. Dataset builds live on Datasets' },
  { id: 'inference', label: 'Inference', badge: 4, tone: 'run',
    tip: 'Run a model over MARP data \u2014 4 running now' },
  { id: 'training', label: 'Training', badge: 2, tone: 'run',
    tip: 'Fine-tune a model on a saved dataset \u2014 2 running now' },
  { id: 'datasets', label: 'Datasets',
    tip: 'Build and save training sets from approved observations' },
  { id: 'models', label: 'Models',
    tip: 'The model registry, its versions and what each is preferred for' },
  { id: 'workers', label: 'Workers', tip: 'The GPU pool that runs the work' },
  { id: 'history', label: 'History', tip: 'Finished work, searchable' },
];

const IMG = '../../../shared/assets/images/';

function mountRail() {
  const rail = $('.rail');
  if (!rail) return;
  const here = document.body.dataset.screen;

  const links = NAV.map((n) => {
    const current = n.id === here ? ' aria-current="page"' : '';
    /* Two kinds of count, and they must not look alike: red is work that has
       gone wrong, cyan is work in progress. */
    const badge = n.badge
      ? '<span class="badge" data-tone="' + (n.tone || 'attn') + '">' + n.badge + '</span>'
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

/* The account menu wires itself: it is the shared component, and its opening, its
   dismissal and who it draws all live in `assets/js/account-menu.js` (#151). A second
   implementation here is exactly what that change removed. */

function wireDrawer() {
  const drawer = $('#drawer');
  const scrim = $('#scrim');
  if (!drawer || !scrim) return;
  const show = (on) => { drawer.hidden = !on; scrim.hidden = !on; };
  $$('.rowlink tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      /* A row action is not the row. Without this, cancelling a job also opened
         its detail behind the click. */
      if (e.target.closest('button, input, a, select')) return;
      show(true);
    });
  });
  const close = $('#drawerX');
  if (close) close.addEventListener('click', () => show(false));
  scrim.addEventListener('click', () => show(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
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
    /* Jobs, Workers and History sort their *data* and re-render, not their
       DOM. Sorting rows here would only ever reorder the page you can see,
       which is a different answer from the one the column promises once the
       list is paged -- and with both handlers bound the two sorts fought,
       leaving the arrow saying ascending over descending rows. That happened
       twice, which is why this is a list rather than three separate guards. */
    if (['jobs', 'workers', 'history'].includes(table.id)) return;

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
 * The Dashboard chart uses a deterministic moving fixture during design review.
 * Its input is two arrays of aggregate slot samples, which is deliberately the
 * same seam a later API stream can feed without changing the interaction.
 */
function wirePoolUtilization() {
  const root = $('[data-pool-history]');
  if (!root) return;

  const slotCapacity = 313;
  const queueScale = 24;
  const plots = {
    '24h': {
      labels: ['24h ago', '12h ago', 'Now'],
      computeUsed: [28, 30, 33, 36, 34, 39, 44, 42, 46, 51, 55, 52, 48, 45, 42, 44, 49, 54, 51, 47, 45, 43, 40, 40.6],
      vramUsed: [32, 34, 36, 39, 38, 43, 48, 47, 51, 56, 60, 58, 54, 51, 48, 49, 54, 59, 57, 53, 50, 48, 45, 45],
      training: [17, 18, 20, 22, 20, 24, 27, 25, 29, 33, 36, 34, 31, 29, 27, 28, 31, 35, 33, 30, 29, 28, 26, 26],
      queueTraining: [1, 1, 2, 2, 1, 3, 4, 3, 5, 6, 8, 7, 6, 5, 4, 4, 6, 8, 7, 5, 4, 3, 2, 2],
      queueInference: [3, 4, 4, 5, 4, 5, 6, 5, 7, 9, 11, 10, 9, 8, 7, 7, 8, 10, 9, 8, 7, 7, 6, 6]
    },
    '5h': {
      labels: ['5h ago', '2.5h ago', 'Now'],
      computeUsed: [31, 33, 32, 35, 37, 39, 38, 41, 44, 48, 50, 49, 46, 44, 42, 39, 38, 39, 42, 44, 43, 42, 40, 40.6],
      vramUsed: [35, 37, 36, 39, 41, 43, 42, 45, 48, 52, 55, 53, 51, 49, 47, 44, 43, 44, 47, 49, 48, 47, 45, 45],
      training: [19, 20, 19, 21, 23, 24, 23, 25, 27, 31, 33, 32, 30, 28, 27, 25, 24, 25, 27, 29, 28, 27, 26, 26],
      queueTraining: [1, 1, 1, 2, 2, 2, 2, 3, 4, 5, 6, 5, 4, 4, 3, 3, 2, 2, 3, 4, 3, 3, 2, 2],
      queueInference: [4, 4, 4, 5, 5, 6, 5, 6, 7, 9, 10, 9, 8, 8, 7, 7, 6, 6, 7, 8, 7, 7, 6, 6]
    },
    '1h': {
      labels: ['1h ago', '30m ago', 'Now'],
      computeUsed: [38, 39, 40, 42, 44, 45, 47, 46, 44, 43, 42, 41, 40, 38, 37, 38, 39, 41, 43, 44, 43, 42, 41, 40.6],
      vramUsed: [42, 43, 44, 46, 48, 49, 51, 50, 48, 47, 46, 45, 44, 42, 41, 42, 43, 45, 47, 48, 47, 46, 45, 45],
      training: [24, 25, 25, 27, 28, 29, 30, 29, 28, 27, 27, 26, 25, 24, 23, 24, 25, 26, 28, 29, 28, 27, 26, 26],
      queueTraining: [2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 2, 2, 3, 3, 3, 2, 2, 2],
      queueInference: [6, 6, 7, 7, 8, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 5, 6, 6, 7, 7, 7, 6, 6, 6]
    }
  };
  Object.values(plots).forEach((plot) => {
    plot.inference = plot.computeUsed.map((used, index) => used - plot.training[index]);
  });
  const buttons = $$('[data-pool-range]', root);
  const highlightButtons = $$('[data-pool-highlight]', root);
  const lines = Object.fromEntries($$('[data-pool-line]', root)
    .map((line) => [line.dataset.poolLine, line]));
  const trainingArea = $('[data-pool-area="training"]', root);
  const inferenceArea = $('[data-pool-area="inference"]', root);
  const chart = $('.pool-chart', root);
  const usedSummary = $('[data-pool-used-summary]');
  const usedSummaryPercent = $('[data-pool-used-summary-percent]');
  const available = $('[data-pool-available]');
  const availablePercent = $('[data-pool-available-percent]');
  let range = buttons.find((button) => button.classList.contains('on'))?.dataset.poolRange || '5h';
  let samples = Object.fromEntries(Object.entries(plots[range])
    .filter(([key]) => key !== 'labels').map(([key, values]) => [key, [...values]]));
  let tick = 0;

  const percentPoint = (value, index, count) => ({
    x: 44 + (700 * index / Math.max(1, count - 1)),
    y: 212 - (188 * value / 100)
  });
  const queuePoint = (value, index, count) => ({
    x: 44 + (700 * index / Math.max(1, count - 1)),
    y: 212 - (188 * value / queueScale)
  });
  const pathOf = (points) => points.map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const draw = () => {
    samples.computeAvailable = samples.computeUsed.map((value) => 100 - value);
    samples.vramAvailable = samples.vramUsed.map((value) => 100 - value);
    Object.entries(lines).forEach(([name, line]) => {
      const values = samples[name];
      const makePoint = name.startsWith('queue') ? queuePoint : percentPoint;
      line.setAttribute('d', pathOf(values.map((value, index) => makePoint(value, index, values.length))));
    });
    const totalPoints = samples.computeUsed.map((value, index) => percentPoint(value, index, samples.computeUsed.length));
    const inferencePoints = samples.inference.map((value, index) => percentPoint(value, index, samples.inference.length));
    const reversedInference = [...inferencePoints].reverse()
      .map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    inferenceArea.setAttribute('d', `${pathOf(inferencePoints)} L744,212 L44,212 Z`);
    trainingArea.setAttribute('d', `${pathOf(totalPoints)} ${reversedInference} Z`);
    const latest = Object.fromEntries(Object.entries(samples)
      .map(([name, values]) => [name, values[values.length - 1]]));
    latest.queueTotal = latest.queueTraining + latest.queueInference;
    const slotUse = Math.round(slotCapacity * latest.computeUsed / 100);
    usedSummary.textContent = String(slotUse);
    usedSummaryPercent.textContent = `${Math.round(latest.computeUsed)}%`;
    available.textContent = String(slotCapacity - slotUse);
    availablePercent.textContent = `${100 - Math.round(latest.computeUsed)}%`;
    $$('[data-current]', root).forEach((label) => {
      const value = latest[label.dataset.current];
      const suffix = {
        computeUsed: '% used', computeAvailable: '% free', vramUsed: '% used',
        vramAvailable: '% free', training: '%', inference: '%',
        queueTraining: '', queueInference: ''
      }[label.dataset.current];
      label.textContent = `${Math.round(value)}${suffix}`;
    });
    chart.setAttribute('aria-label', `GPU pool over the last ${range}: ${Math.round(latest.computeUsed)} percent compute and ${Math.round(latest.vramUsed)} percent VRAM utilized, ${latest.queueTotal} jobs queued; updating preview`);
  };
  const choose = (next) => {
    range = next;
    samples = Object.fromEntries(Object.entries(plots[range])
      .filter(([key]) => key !== 'labels').map(([key, values]) => [key, [...values]]));
    buttons.forEach((button) => {
      const on = button.dataset.poolRange === range;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const labels = plots[range].labels;
    $$('[data-pool-time]', root).forEach((label, index) => { label.textContent = labels[index]; });
    draw();
  };

  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.poolRange)));

  const highlight = (name) => {
    const active = chart.dataset.highlight === name ? '' : name;
    chart.dataset.highlight = active;
    chart.classList.toggle('is-highlighted', Boolean(active));
    $$('[data-pool-line], [data-pool-area]', chart).forEach((series) => {
      series.classList.toggle('highlighted', series.dataset.poolLine === active
        || series.dataset.poolArea === active);
    });
    highlightButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.poolHighlight === active));
    });
  };
  highlightButtons.forEach((button) => {
    button.addEventListener('click', () => highlight(button.dataset.poolHighlight));
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && chart.classList.contains('is-highlighted')) {
      const activeButton = highlightButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
      highlight('');
      activeButton?.focus();
    }
  });
  choose(range);

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const computeMovement = [.8, 1.2, .5, -.6, -1, .3, .9, -.4];
    const vramMovement = [.5, .8, .4, -.3, -.7, .2, .6, -.2];
    const queueMovement = [0, 1, 0, -1, 0, 1, -1, 0];
    window.setInterval(() => {
      const nextCompute = Math.max(0, Math.min(100, samples.computeUsed.at(-1) + computeMovement[tick % computeMovement.length]));
      const nextVram = Math.max(0, Math.min(100, samples.vramUsed.at(-1) + vramMovement[tick % vramMovement.length]));
      const nextTraining = Math.max(0, Math.min(nextCompute, samples.training.at(-1) + computeMovement[tick % computeMovement.length] * .65));
      const nextQueueTraining = Math.max(0, Math.min(queueScale, samples.queueTraining.at(-1) + queueMovement[tick % queueMovement.length]));
      const nextQueueInference = Math.max(0, Math.min(queueScale, samples.queueInference.at(-1) + queueMovement[(tick + 2) % queueMovement.length]));
      tick += 1;
      samples = {
        computeUsed: [...samples.computeUsed.slice(1), nextCompute],
        vramUsed: [...samples.vramUsed.slice(1), nextVram],
        training: [...samples.training.slice(1), nextTraining],
        inference: [...samples.inference.slice(1), nextCompute - nextTraining],
        queueTraining: [...samples.queueTraining.slice(1), nextQueueTraining],
        queueInference: [...samples.queueInference.slice(1), nextQueueInference]
      };
      draw();
    }, 2500);
  }
}

/* ============================================================== jobs table */

/* The Jobs table is drawn from the data layer and no longer from its markup.
   What follows turns one `GET /gpu/jobs` row into one table row, so it is also
   the seam where the API's vocabulary stops and the design's begins. */

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
};

/**
 * Which batches finished with some of their pieces failed.
 *
 * This is where `issues` comes from, and it is the only place it can: a single
 * job is never succeeded-with-problems, because #225 settled that a job whose
 * results did not reach the database is *failed*. A batch -- one video cut into
 * frame ranges -- routinely finishes with some ranges failed, and that is what
 * the design has always meant by the word.
 *
 * **Scoped to the page, which is a real limit and not a shortcut.** A batch has
 * no row of its own to fetch (gap 1), so this sees only the pieces in this
 * response; a batch straddling a page boundary looks clean on one of them. The
 * fix is a batch object, not a larger page.
 *
 * @param {Object[]} jobs - The page of jobs.
 * @returns {Set<string>} Batch ids holding both a success and a failure.
 */
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
function jobView(job, issueBatches) {
  const spec = job.spec || {};
  const session = spec.session || {};
  const [kindIcon, kindLabel] = JOB_KIND_LABEL[job.kind] || JOB_KIND_LABEL.inference;

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
  const title = ((spec.video && spec.video.source_name) || `Job ${job.id}`).replace(/.[a-z0-9]+$/i, '');

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

  const scope = session.dive ? `Dive ${session.dive} &middot; Line ${session.line}` : 'No session';
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

  return `<tr data-job="${job.id}">`
    + `<td class="chk"><input class="chkbox" type="checkbox" aria-label="Select job ${job.id}"></td>`
    + `<td class="jname"><span class="name"><svg class="ico ${view.kindIcon}"><use href="#i-${view.kindIcon}"/></svg><span class="t">${view.title}</span></span></td>`
    + `<td class="jtype"><span class="tag ${view.kindIcon}">${view.kindLabel}</span></td>`
    + `<td class="jscope"><span class="two"><span class="a">${scope}</span><span class="b">${frames}</span></span></td>`
    + `<td class="jmodel"><span class="two"><span class="a">${view.model}</span><span class="b">${view.reduction}</span></span></td>`
    + `<td class="jstatus" data-sort="${JOB_STATE_RANK[state]}"><span class="st" data-state="${state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="jprog" data-sort="${progress.sort}">${progress.html}</td>`
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
  const done = jobs.filter((j) => j.state === 'succeeded' && Date.parse(j.created_at) >= newest - 86400000);
  const attention = jobs.filter((j) => j.state === 'failed' || j.state === 'expired' || isIssue(j));

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
    else th.removeAttribute('aria-sort');
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
  const table = $('#jobs');
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
  const table = $('#history');
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
  const table = $('#history');
  if (!table || !window.MarpApi) return;

  const body = $('tbody', table);
  const columns = $$('thead th', table).length;
  body.innerHTML = `<tr class="tblmsg"><td class="loading" colspan="${columns}">Loading history&hellip;</td></tr>`;

  try {
    const [jobs, projects, users] = await Promise.all([
      window.MarpApi.listJobs({ limit: 500 }),
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

  const projects = [...new Set(historyData.jobs.map((j) => historyData.projects.get(j.spec.session.project_id)).filter(Boolean))].sort();
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
  const panel = $('#history-panel') || $('#history')?.closest('.panel');
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

  /* A `Dataset` has no status column, so "building" cannot be counted -- the
     builds the Datasets screen shows are its own, not the API's. Gap 19. */
  set('Datasets', datasets.length, ['saved', 'builds not tracked by the API']);

  /* Nothing on an `MlModel` marks one preferred, and nothing counts how many
     workers hold it. Gap 28. */
  set('Models', models.length, ['registered', 'no preferred flag in the API']);

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
  const attention = newest(views.filter((v) => ['issues', 'failed', 'expired'].includes(v.state)));
  const finished = newest(views.filter((v) => v.state === 'done'));

  const shown = [...running.slice(0, 2), ...attention.slice(0, 2), ...finished.slice(0, 1)];

  for (const pool of [running.slice(2), attention.slice(2), finished.slice(1)]) {
    for (const view of pool) {
      if (shown.length >= 5) break;
      shown.push(view);
    }
  }

  body.innerHTML = shown.map((view) => {
    const progress = progressCell(view.job, view.state);
    const updated = new Date(view.job.updated_at);
    return `<tr data-job="${view.job.id}">`
      + `<td class="jname"><span class="name"><svg class="ico ${view.kindIcon}"><use href="#i-${view.kindIcon}"/></svg><span class="t">${view.title}</span></span></td>`
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
      window.MarpApi.listJobs({ limit: 500 }),
      window.MarpApi.listWorkers(),
      window.MarpApi.listModels(),
      window.MarpApi.listDatasets(),
    ]);

    renderDashboard({ jobs: jobs.jobs, workers, models, datasets });
  } catch (error) {
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
  const table = $('#workers');
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
  const table = $('#workers');
  if (!table || !window.MarpApi) return;

  const body = $('tbody', table);
  body.innerHTML = '<tr class="tblmsg"><td class="loading" colspan="11">Loading the pool&hellip;</td></tr>';

  try {
    /* Both routes, because two of the four headline cards are about the queue
       rather than the machines. One failure state covers them: a screen that
       half-loaded would be worse than one that says it could not. */
    const [pool, jobs] = await Promise.all([
      window.MarpApi.listWorkers(),
      window.MarpApi.listJobs({ limit: 500 }),
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
  const panel = $('#jobs')?.closest('.panel');
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
  const table = $('#jobs');
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
  const table = $('#jobs');
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
    const status = $('.jstatus', head)?.textContent.trim() || 'Queued';
    const progress = $('.jprog', head)?.textContent.trim() || 'Not started';
    const progressValue = Number($('.jprog', head)?.dataset.sort);
    const submitted = $('.jtime', head)?.textContent.trim().replace(/\s+/g, ' ') || '—';
    const isTraining = type.toLowerCase() === 'training';
    const isDatasetBuild = type.toLowerCase() === 'dataset build';
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
    detail.innerHTML = `<td colspan="10"><div class="rundetail jobdetail">
      <div class="jobdetail-head"><div><b>${name}</b><span>Job ${id} · ${type}</span></div><span class="st" data-state="${state}"><span class="dot"></span>${status}</span></div>
      <div class="jobdetail-grid jobidentity">
        <dl class="kv"><dt>Job ID</dt><dd class="mono">${id}</dd><dt>Type</dt><dd>${type}</dd><dt>Scope</dt><dd>${scope}${scopeContext ? ` <span class="faint">· ${scopeContext}</span>` : ''}</dd><dt>${isDatasetBuild ? 'Build output' : 'Locked model'}</dt><dd>${model} <span class="faint">${modelVersion}</span><div class="locked">Immutable from submission</div></dd></dl>
        <dl class="kv"><dt>Submitted</dt><dd>${submitted}</dd><dt>Submitted by</dt><dd>itravers</dd><dt>Priority</dt><dd>5 · normal</dd><dt>Attempt policy</dt><dd>Up to 3 attempts</dd></dl>
      </div>
      ${operational}
      ${resultsPreview}
      <details class="diag"><summary>Diagnostics<span class="later">Attempts, worker lease and event log</span></summary><div class="dbody">
        <dl class="kv"><dt>Attempt</dt><dd>${state === 'issues' ? '3 of 3' : '1 of 3'}</dd><dt>Worker lease</dt><dd>${state === 'running' ? 'Healthy · heartbeat 4s ago' : 'No active lease'}</dd><dt>Last event</dt><dd>${status} · review fixture</dd><dt>Request ID</dt><dd class="mono">job-${id}-attempt-1</dd></dl>
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
  const ranges = {
    '24h': { labels: ['24h ago', '12h ago', 'Now'], started: [2,3,3,4,5,4,6,7,5,6,8,7,6,5,7,8,6,7,9,8,7,6,5,6], completed: [1,2,2,3,3,4,4,5,4,5,6,7,7,6,6,7,8,8,7,9,8,7,7,8], queued: [5,6,5,7,8,7,9,10,8,9,11,10,9,8,9,10,8,9,10,9,8,8,7,8] },
    '5h': { labels: ['5h ago', '2.5h ago', 'Now'], started: [3,4,3,5,4,6,5,7,8,7,6,5,6,7,6,8,7,6,5,6,7,6,5,6], completed: [2,2,3,3,4,4,5,5,6,6,7,7,6,6,7,7,8,8,7,7,8,8,7,8], queued: [6,6,7,8,8,9,9,10,11,10,10,9,9,8,8,9,9,8,8,9,9,8,8,8] },
    '1h': { labels: ['1h ago', '30m ago', 'Now'], started: [4,4,5,5,6,6,7,6,5,5,6,7,7,6,6,5,5,6,7,7,6,6,5,6], completed: [5,5,5,6,6,6,7,7,7,7,8,8,8,8,7,7,7,8,8,8,8,8,8,8], queued: [8,8,9,9,10,10,10,9,9,8,8,9,9,8,8,7,7,8,8,9,9,8,8,8] }
  };
  const buttons = $$('[data-jobs-range]', root);
  const lines = Object.fromEntries($$('[data-jobs-line]', root).map((line) => [line.dataset.jobsLine, line]));
  let range = '5h';
  let samples;
  let tick = 0;
  const pathOf = (values) => values.map((value, index) => `${index ? 'L' : 'M'}${(42 + 700 * index / (values.length - 1)).toFixed(1)},${(198 - 174 * value / 12).toFixed(1)}`).join(' ');
  const draw = () => {
    Object.entries(lines).forEach(([name, line]) => line.setAttribute('d', pathOf(samples[name])));
    $('.jobs-chart', root).setAttribute('aria-label', `Job activity over the last ${range}; ${samples.started.at(-1)} started, ${samples.completed.at(-1)} completed and ${samples.queued.at(-1)} queued; updating preview`);
  };
  const choose = (next) => {
    range = next;
    samples = Object.fromEntries(Object.entries(ranges[range]).filter(([key]) => key !== 'labels').map(([key, values]) => [key, [...values]]));
    buttons.forEach((button) => { const on = button.dataset.jobsRange === range; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    $$('[data-jobs-time]', root).forEach((label, index) => { label.textContent = ranges[range].labels[index]; });
    draw();
  };
  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.jobsRange)));
  choose(range);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const movement = [1, 0, -1, 1, -1, 0];
    window.setInterval(() => {
      samples = Object.fromEntries(Object.entries(samples).map(([name, values], index) => [name, [...values.slice(1), Math.max(0, Math.min(12, values.at(-1) + movement[(tick + index) % movement.length]))]]));
      tick += 1;
      draw();
    }, 2500);
  }
}

/* Inference needs an operational graph, not another count of jobs. Throughput
   and backlog share time but not units, so each keeps an explicit axis. Their
   relationship answers the useful question: is processing catching up? */
function wireInferenceActivity() {
  const root = $('[data-inference-activity]');
  if (!root) return;
  const ranges = {
    '24h': { labels: ['24h ago', '12h ago', 'Now'], throughput: [48,52,55,51,58,62,59,65,69,63,67,72,70,74,76,73,79,82,77,81,84,80,76,78], backlog: [7.6,7.7,7.5,7.4,7.3,7.2,7.1,7.2,7.0,6.9,6.8,6.7,6.8,6.6,6.5,6.4,6.2,6.3,6.1,6.0,5.9,5.8,5.9,5.8] },
    '5h': { labels: ['5h ago', '2.5h ago', 'Now'], throughput: [61,64,67,65,69,72,70,74,76,73,77,80,78,82,85,81,79,83,86,82,80,79,77,78], backlog: [6.9,6.8,6.8,6.7,6.6,6.6,6.5,6.4,6.3,6.3,6.2,6.1,6.1,6.0,5.9,5.9,5.8,5.8,5.7,5.7,5.8,5.7,5.8,5.8] },
    '1h': { labels: ['1h ago', '30m ago', 'Now'], throughput: [72,74,73,76,79,77,80,82,81,84,83,81,79,82,85,84,82,80,79,81,80,79,77,78], backlog: [6.0,6.0,5.9,5.9,5.8,5.8,5.8,5.7,5.7,5.7,5.6,5.6,5.6,5.7,5.7,5.7,5.8,5.8,5.8,5.7,5.7,5.8,5.8,5.8] }
  };
  const buttons = $$('[data-inference-range]', root);
  const lines = Object.fromEntries($$('[data-inference-line]', root).map((line) => [line.dataset.inferenceLine, line]));
  const area = $('[data-inference-area="throughput"]', root);
  const chart = $('.inference-chart', root);
  let range = '5h';
  let samples;
  let tick = 0;
  const coords = (values, scale) => values.map((value, index) => {
    const x = 54 + 672 * index / (values.length - 1);
    const y = scale === 'throughput'
      ? 196 - 168 * Math.max(0, Math.min(120, value)) / 120
      : 196 - 168 * Math.max(0, Math.min(6, value - 2)) / 6;
    return [x, y];
  });
  const pathOf = (values, scale) => coords(values, scale)
    .map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const draw = () => {
    const throughputPath = pathOf(samples.throughput, 'throughput');
    lines.throughput.setAttribute('d', throughputPath);
    lines.backlog.setAttribute('d', pathOf(samples.backlog, 'backlog'));
    area.setAttribute('d', `${throughputPath} L726,196 L54,196 Z`);
    $('[data-inference-current="throughput"]', root).textContent = `${Math.round(samples.throughput.at(-1))}k`;
    $('[data-inference-current="backlog"]', root).textContent = `${samples.backlog.at(-1).toFixed(1)}M`;
    const label = `Inference activity over the last ${range}: ${Math.round(samples.throughput.at(-1))} thousand frames processed per minute and ${samples.backlog.at(-1).toFixed(1)} million frames queued`;
    chart.setAttribute('aria-label', label);
    chart.title = label;
  };
  const choose = (next) => {
    range = next;
    samples = { throughput: [...ranges[range].throughput], backlog: [...ranges[range].backlog] };
    buttons.forEach((button) => {
      const on = button.dataset.inferenceRange === range;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    $$('[data-inference-time]', root).forEach((label, index) => { label.textContent = ranges[range].labels[index]; });
    draw();
  };
  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.inferenceRange)));
  const highlightButtons = $$('[data-inference-highlight]', root);
  const highlight = (name = '') => {
    const active = root.dataset.highlight === name ? '' : name;
    root.dataset.highlight = active;
    root.classList.toggle('is-highlighted', Boolean(active));
    highlightButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.inferenceHighlight === active)));
    $$('.inference-line, .inference-area', root).forEach((line) => line.classList.toggle('highlighted', Boolean(active) && line.classList.contains(active)));
  };
  highlightButtons.forEach((button) => {
    button.title = `Highlight only ${button.textContent.trim()} on this graph; select it again or press Escape to restore both series`;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => highlight(button.dataset.inferenceHighlight));
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
    const throughputMovement = [1, -1, 2, -2, 1, 0];
    const backlogMovement = [-.1, 0, -.1, .1, 0, 0];
    window.setInterval(() => {
      samples.throughput = [...samples.throughput.slice(1), Math.max(38, Math.min(105, samples.throughput.at(-1) + throughputMovement[tick % throughputMovement.length]))];
      samples.backlog = [...samples.backlog.slice(1), Math.max(2.2, Math.min(7.8, samples.backlog.at(-1) + backlogMovement[tick % backlogMovement.length]))];
      tick += 1;
      draw();
    }, 2500);
  }
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

/* Dataset creation is long-running system work. The aggregate chart uses a
   throughput scale for materialized frames and a job-count scale for running,
   queued and completed build jobs. */
function wireDatasetActivity() {
  const root = $('[data-dataset-activity]');
  if (!root) return;
  const ranges = {
    '24h': { labels: ['24h ago', '12h ago', 'Now'],
      throughput: [0,0,180,260,420,610,720,840,910,760,620,500,390,460,580,740,920,1040,980,850,690,720,760,780],
      running: [0,0,1,1,1,2,2,2,3,3,2,2,1,1,2,2,3,3,3,2,2,2,2,2],
      queued: [1,1,1,2,2,3,3,4,4,4,3,3,2,2,3,4,5,5,4,4,4,3,3,3],
      completed: [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0] },
    '7d': { labels: ['7d ago', '3.5d ago', 'Now'],
      throughput: [310,460,620,540,180,0,240,590,810,760,390,120,360,680,940,870,510,280,440,790,1020,900,560,330,520,840,730,780],
      running: [1,2,2,2,1,0,1,2,3,3,1,1,1,2,3,3,2,1,2,3,4,3,2,1,2,3,2,2],
      queued: [2,2,3,3,2,1,1,3,4,4,3,2,2,4,5,5,4,3,3,5,6,5,4,3,3,4,3,3],
      completed: [0,1,0,1,0,0,1,0,1,0,1,0,0,1,1,0,1,0,1,0,1,1,0,1,0,1,0,1] },
    '30d': { labels: ['30d ago', '15d ago', 'Now'],
      throughput: [220,510,430,680,790,540,210,0,390,720,860,610,330,170,460,780,990,820,490,260,570,910,1080,870,520,300,620,900,740,780],
      running: [1,2,2,3,3,2,1,0,1,3,3,2,1,1,2,3,4,3,2,1,2,3,4,3,2,1,2,3,2,2],
      queued: [1,2,3,4,4,3,2,1,2,3,5,4,3,2,3,4,5,5,3,2,4,5,6,5,4,3,4,5,4,3],
      completed: [0,1,0,1,1,0,1,0,0,1,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,1,0,1] }
  };
  const buttons = $$('[data-dataset-range]', root);
  const lines = Object.fromEntries($$('[data-dataset-line]', root).map((line) => [line.dataset.datasetLine, line]));
  const area = $('[data-dataset-area="throughput"]', root);
  const bars = $('[data-dataset-bars="completed"]', root);
  const chart = $('.dataset-chart', root);
  let range = '24h';
  let samples;
  let tick = 0;
  const coords = (values, scale) => values.map((value, index) => {
    const x = 54 + 672 * index / Math.max(1, values.length - 1);
    const max = scale === 'throughput' ? 1200 : 8;
    return [x, 196 - 168 * Math.max(0, Math.min(max, value)) / max];
  });
  const pathOf = (values, scale) => coords(values, scale)
    .map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const barsOf = (values) => {
    const width = Math.min(14, 480 / values.length);
    return coords(values, 'jobs').map(([x, y], index) => values[index]
      ? `M${(x - width / 2).toFixed(1)},196 V${y.toFixed(1)} H${(x + width / 2).toFixed(1)} V196 Z` : '').join(' ');
  };
  const draw = () => {
    const throughputPath = pathOf(samples.throughput, 'throughput');
    lines.throughput.setAttribute('d', throughputPath);
    lines.running.setAttribute('d', pathOf(samples.running, 'jobs'));
    lines.queued.setAttribute('d', pathOf(samples.queued, 'jobs'));
    area.setAttribute('d', `${throughputPath} L726,196 L54,196 Z`);
    bars.setAttribute('d', barsOf(samples.completed));
    const completed = samples.completed.reduce((sum, value) => sum + value, 0);
    $('[data-dataset-current="throughput"]', root).textContent = Math.round(samples.throughput.at(-1));
    $('[data-dataset-current="running"]', root).textContent = samples.running.at(-1);
    $('[data-dataset-current="queued"]', root).textContent = samples.queued.at(-1);
    $('[data-dataset-current="completed"]', root).textContent = completed;
    const label = `All dataset build activity over ${range}: ${Math.round(samples.throughput.at(-1))} frames materialized per minute, ${samples.running.at(-1)} building, ${samples.queued.at(-1)} queued and ${completed} builds completed`;
    chart.setAttribute('aria-label', label);
    chart.title = label;
  };
  const choose = (next) => {
    range = next;
    samples = Object.fromEntries(Object.entries(ranges[range]).filter(([name]) => name !== 'labels')
      .map(([name, values]) => [name, [...values]]));
    buttons.forEach((button) => { const on = button.dataset.datasetRange === range; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    $$('[data-dataset-time]', root).forEach((label, index) => { label.textContent = ranges[range].labels[index]; });
    draw();
  };
  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.datasetRange)));
  const highlightButtons = $$('[data-dataset-highlight]', root);
  const highlight = (name = '') => {
    const active = root.dataset.highlight === name ? '' : name;
    root.dataset.highlight = active;
    root.classList.toggle('is-highlighted', Boolean(active));
    highlightButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.datasetHighlight === active)));
    $$('.dataset-line, .dataset-area, .dataset-bars', root).forEach((mark) => mark.classList.toggle('highlighted', Boolean(active) && mark.classList.contains(active)));
  };
  highlightButtons.forEach((button) => {
    button.title = `Highlight only ${button.textContent.trim()} on this graph; select it again or press Escape to restore all series`;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => highlight(button.dataset.datasetHighlight));
  });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && root.classList.contains('is-highlighted')) highlight(''); });
  choose(range);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const movement = [18, -12, 8, -6, 12, -8];
    window.setInterval(() => {
      samples.throughput[samples.throughput.length - 1] = Math.max(0, Math.min(1200, samples.throughput.at(-1) + movement[tick % movement.length]));
      tick += 1;
      draw();
    }, 3000);
  }
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

function wireInferenceForm() {
  const run = $('#runBtn');
  if (!run) return;
  let activeGroup = $('[data-run-group]');

  const choiceParts = (choice) => {
    const title = $('.video-title b', choice)?.textContent.trim() || 'video';
    const meta = $('.video-title > span', choice)?.textContent.trim() || '';
    const line = $('.line-entry .inp', choice)?.value.trim();
    const mode = $('[data-video-range]', choice)?.value || 'all';
    const times = $$('.time-range .inp', choice).map((input) => input.value);
    return { id: choice.dataset.videoId, title, meta, line,
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
    + safe(parts.id) + '"><span class="mini-thumb' + (parts.line ? '' : ' pending') + '">'
    + (parts.line ? 'L' + safe(parts.line) : '—') + '</span><span><b class="mono">' + safe(parts.title)
    + '</b><small>' + safe(parts.meta.split(' · ').slice(0, 2).join(' · ')) + ' · '
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
      const picker = $('[data-class-picker]', event.target.closest('[data-model-config]'));
      if (picker) picker.hidden = event.target.value !== 'subset';
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
      const models = $('[data-model-configs]', group);
      const source = $('[data-model-config]', group);
      if (models && source) {
        const clone = source.cloneNode(true);
        const name = $('summary b', clone); if (name) name.textContent = 'MARP General Benthic';
        const note = $('summary small', clone); if (note) note.textContent = 'v1.0.2 · all 24 species · conf 0.20';
        clone.open = true; models.appendChild(clone);
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
      name: $('#jobname')?.value || null, groups,
      output: 'unreviewed_observations', worker_selection: $('#workers')?.value };
    $('#specText').textContent = JSON.stringify(spec, null, 2);
    $('#specOut').hidden = false;
    $('#specOut').scrollIntoView({ block: 'nearest' });
  });

  refreshSelected();
  refreshPlan();
}

/**
 * A row that opens to its own detail. Used by Training's runs, where a person
 * wants one run's curves beside the row above rather than in a drawer that
 * hides the list.
 */
function wireDatasetPage() {
  const table = $('#saved-datasets');
  if (!table) return;
  const body = $('tbody', table);
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
  const buildJobs = [
    { name: 'CAMPA_2024_Rockfish_v4', description: 'Expanded rockfish set with 2026 review promotions', task: 'Detection', status: 'building', observations: '31,640', frames: '42,816 / 63,200', frameSort: 42816, classes: '12', classSummary: 'Rockfish 28% · Lingcod 19% · Canary rockfish 14%', created: '2026-09-14 07:42', updated: '18 sec ago', project: 'CAMPA 2024', queries: '4 saved query batches', groups: '2,031 overlap groups', split: '70 / 20 / 10', build: '2h 18m elapsed', size: '12.6 GB so far', fingerprint: 'pending', format: 'YOLO bounding boxes', job: 'DS-2048', progress: 68, eta: '~1h 05m', worker: 'gpu-build-02' },
    { name: 'GULF_Invertebrates_v3', description: 'New Gulf survey invertebrate training corpus', task: 'Detection', status: 'building', observations: '18,920', frames: '9,408 / 45,120', frameSort: 9408, classes: '8', created: '2026-09-14 09:26', updated: '31 sec ago', project: 'GULF 2025', queries: '3 saved query batches', groups: '1,126 overlap groups', split: '70 / 20 / 10', build: '34m elapsed', size: '2.9 GB so far', fingerprint: 'pending', format: 'YOLO bounding boxes', job: 'DS-2049', progress: 21, eta: '~2h 09m', worker: 'gpu-build-04' },
    { name: 'PACIFIC_2023_RareFish_v1', description: 'Rare-fish validation set across reviewed dives', task: 'Detection', status: 'queued', observations: '8,412', frames: '0 / 17,960', frameSort: 0, classes: '6', created: '2026-09-14 10:02', updated: '10:02 today', project: 'PACIFIC 2023', queries: '5 saved query batches', groups: '614 overlap groups', split: '70 / 20 / 10', build: 'Waiting for worker', size: 'Not materialized', fingerprint: 'pending', format: 'YOLO bounding boxes', job: 'DS-2050', progress: 0, eta: '~52m after start', worker: 'Unassigned' },
    { name: 'CAMPA_2025_Habitat_v1', description: 'Habitat classification frames from promoted observations', task: 'Classification', status: 'queued', observations: '12,104', frames: '0 / 24,208', frameSort: 0, classes: '7', created: '2026-09-14 10:08', updated: '10:08 today', project: 'CAMPA 2025', queries: '2 saved query batches', groups: '806 source groups', split: '70 / 20 / 10', build: 'Waiting for worker', size: 'Not materialized', fingerprint: 'pending', format: 'Class-labelled images', job: 'DS-2051', progress: 0, eta: '~1h 14m after start', worker: 'Unassigned' },
    { name: 'GULF_2024_CoralMasks_v2', description: 'Instance masks for coral and sponge classes', task: 'Segmentation', status: 'queued', observations: '6,780', frames: '0 / 13,560', frameSort: 0, classes: '9', created: '2026-09-14 10:11', updated: '10:11 today', project: 'GULF 2024', queries: '2 saved query batches', groups: '488 overlap groups', split: '70 / 20 / 10', build: 'Waiting for worker', size: 'Not materialized', fingerprint: 'pending', format: 'YOLO instance polygons', job: 'DS-2052', progress: 0, eta: '~46m after start', worker: 'Unassigned' },
    { name: 'SALT_2025_Substrate_v1', description: 'Substrate classification build stopped during thumbnail reads', task: 'Classification', status: 'attention', observations: '9,330', frames: '6,104 / 18,660', frameSort: 6104, classes: '7', created: '2026-09-13 16:44', updated: '2026-09-13 17:19', project: 'SALT 2025', queries: '3 saved query batches', groups: '622 source groups', split: '70 / 20 / 10', build: '35m before failure', size: '1.8 GB partial', fingerprint: 'pending', format: 'Class-labelled images', job: 'DS-2042', progress: 33, eta: 'Retry available', worker: 'gpu-build-01' }
  ];
  buildJobs.slice().reverse().forEach((item) => {
    fixtures[item.name] = item;
    const row = document.createElement('tr');
    /* No link into Jobs: a dataset build is not in that queue, and its detail
       is this row's own expansion. The icon is the Datasets one for the same
       reason -- the jobs icon claimed a home it does not have. */
    row.innerHTML = '<td class="jname"><span class="name dataset-build-name"><svg class="ico datasets"><use href="#i-datasets"/></svg><span class="t">' + item.name + '</span></span></td>'
      + '<td class="jscope">' + item.description + '</td>'
      + '<td class="num" data-sort="' + item.observations.replaceAll(',', '') + '">' + item.observations + '</td>'
      + '<td class="num" data-sort="' + item.frameSort + '">' + item.frames + '</td>'
      + '<td class="num" data-sort="' + item.classes + '">' + item.classes + '</td>'
      + '<td class="jtime" data-sort="' + item.created + '"><span class="two"><span class="a">' + item.created.slice(11) + '</span><span class="b">' + item.created.slice(0, 10) + '</span></span></td>'
      + '<td class="jtime" data-sort="' + item.updated + '"><span class="two"><span class="a">' + item.updated + '</span></span></td>'
      + '<td class="jacts"><button class="btn sm dataset-build-open" type="button" aria-label="Show build detail for ' + item.name + '" title="Show build progress, worker and diagnostics"><svg class="ico sm"><use href="#i-right"/></svg>Build detail</button></td>';
    body.prepend(row);
  });
  const heads = $$(':scope > tr', body);
  heads.forEach((head) => {
    const original = [...head.children];
    const name = $('.jname .t', head)?.textContent.trim() || 'Saved dataset';
    const cfg = fixtures[name] || fixtures.CAMPA_2024_Rockfish_v3;
    const description = original[1]?.textContent.trim() || '';
    const observations = original[2]?.textContent.trim() || '';
    const frames = original[3]?.textContent.trim() || '';
    const classes = original[4]?.textContent.trim() || '';
    const status = cfg.status || 'ready';
    const isBuild = status !== 'ready';
    head.classList.add('runrow-head');
    head.dataset.datasetTask = cfg.task.toLowerCase();
    head.dataset.datasetStatus = status;
    head.dataset.search = `${name} ${description} ${cfg.task} ${cfg.project} ${status} ${cfg.job || ''}`.toLowerCase();
    const task = document.createElement('td');
    task.className = 'jtype';
    task.dataset.sort = cfg.task;
    task.innerHTML = `<span class="task-pill" data-task="${cfg.task.toLowerCase()}">${cfg.task}</span>`;
    original[1].after(task);
    const state = document.createElement('td');
    state.className = 'jstatus';
    state.dataset.sort = status;
    const stateLabel = { building: 'Building', queued: 'Queued', attention: 'Needs attention', ready: 'Ready' }[status];
    const stateTone = { building: 'running', queued: 'queued', attention: 'failed', ready: 'done' }[status];
    state.innerHTML = `<span class="pill" data-state="${stateTone}">${stateLabel}</span>`;
    task.after(state);
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
      expand.innerHTML = `<button class="exbtn" type="button" aria-label="Expand ${name}" title="Show build progress, worker and diagnostics"><svg class="ico sm"><use href="#i-right"/></svg></button>`;
      head.prepend(expand);

      const failed = status === 'attention';
      const pct = Math.max(0, cfg.progress || 0);
      const tone = { building: 'running', queued: 'queued', attention: 'failed' }[status];

      /* Queued work has not measured anything, so it draws a dash rather than
         a 0% bar -- the same rule the Jobs table follows. */
      const bar = status === 'queued'
        ? '<span class="dash">Not started</span>'
        : `<span class="prog" data-state="${tone}"><span class="bar" role="progressbar" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span><span class="pct">${pct}%</span></span>`;

      const fact = (label, value) => `<div class="jobmetric"><span>${label}</span><b>${value}</b></div>`;
      const note = failed
        ? `<div class="jobstate-alert"><svg class="ico"><use href="#i-alert"/></svg><div><h4>${cfg.description}</h4><p>Materialized frames are kept; only the unread remainder needs to run again.</p></div></div>`
        : '';
      const actions = failed
        ? '<button class="btn sm" type="button">Retry build</button><button class="btn sm ghost" type="button">Discard</button>'
        : status === 'queued'
          ? '<button class="btn sm" type="button">Start now</button><button class="btn sm ghost" type="button">Cancel build</button>'
          : '<button class="btn sm ghost" type="button">Cancel build</button>';

      const detail = document.createElement('tr');
      detail.className = 'runrow-body dataset-row-detail';
      detail.hidden = true;
      detail.innerHTML = `<td colspan="11"><div class="dataset-detail" data-status="${status}">`
        + `<header><div><h3>${name}</h3><p>${description}</p></div><span class="pill" data-state="${tone}">${stateLabel}</span></header>`
        + `<div class="dataset-build-progress">${bar}<span class="build-frames">${frames} frames</span></div>`
        + note
        + `<div class="jobmetrics">${fact('Worker', cfg.worker)}${fact('Elapsed', cfg.build)}${fact('Remaining', cfg.eta)}${fact('Materialized', cfg.size)}${fact('Split', cfg.split)}${fact('Fingerprint', cfg.fingerprint)}</div>`
        + `<dl class="kv"><dt>Project</dt><dd>${cfg.project}</dd><dt>Queries</dt><dd>${cfg.queries}</dd><dt>Overlap groups</dt><dd>${cfg.groups}</dd><dt>Output format</dt><dd>${cfg.format}</dd></dl>`
        + `<div class="jobstate-actions">${actions}</div>`
        + '</div></td>';
      head.after(detail);

      /* The row's own click handler ignores buttons, so the action has to ask
         the expander itself -- the same arrangement a Ready row uses. */
      const open = $('.dataset-build-open', head);
      if (open) {
        open.addEventListener('click', (event) => {
          event.stopPropagation();
          $('.exbtn', head)?.click();
        });
      }
      return;
    }
    head.setAttribute('aria-expanded', 'false');
    expand.innerHTML = `<button class="exbtn" type="button" aria-label="Expand ${name}" title="Show provenance, composition, split and sample images"><svg class="ico sm"><use href="#i-right"/></svg></button>`;
    head.prepend(expand);
    const thumbs = samples.map(([src, alt]) => `<figure><img src="${src}" alt="Opening source frame from ${alt}" loading="lazy"><figcaption>${alt}</figcaption></figure>`).join('');
    const detail = document.createElement('tr');
    detail.className = 'runrow-body dataset-row-detail';
    detail.hidden = true;
    const readyActions = `<button class="btn sm" type="button" title="Use these immutable queries and split as a new starting point"><svg class="ico"><use href="#i-copy"/></svg>Duplicate setup</button><button class="btn sm" type="button" title="Open Training with this dataset selected"><svg class="ico"><use href="#i-training"/></svg>Use for training</button><button class="btn sm" type="button" title="Download the built images, labels and manifest"><svg class="ico"><use href="#i-download"/></svg>Download archive</button>`;
    detail.innerHTML = `<td colspan="11"><div class="dataset-detail" data-status="${status}"><header><div><h3>${name}</h3><p>${description}</p></div><span class="pill" data-state="${stateTone}">Ready &middot; immutable</span></header><div class="dataset-detail-grid"><section><h4>Build record</h4><dl class="kv"><dt>Task / format</dt><dd>${cfg.task} &middot; ${cfg.format}</dd><dt>Source</dt><dd>${cfg.project} &middot; promoted observations only</dd><dt>Membership</dt><dd>${cfg.queries} &middot; deduplicated</dd><dt>Build result</dt><dd>${cfg.build} &middot; completed cleanly</dd><dt>Fingerprint</dt><dd class="mono">${cfg.fingerprint}</dd></dl></section><section><h4>Composition and split</h4><div class="dataset-facts"><span><b>${observations}</b> observations</span><span><b>${frames}</b> frames</span><span><b>${classes}</b> classes</span><span><b>${cfg.size}</b> archive</span></div><div class="splitbar" role="img" aria-label="${cfg.split} train validation test split"><i class="tr" style="width:70%"><span>70%</span></i><i class="va" style="width:20%"><span>20%</span></i><i class="te" style="width:10%"><span>10%</span></i></div><p class="dataset-class-summary">${cfg.classes}</p><span class="hint">${cfg.groups}; connected frames stay in one split.</span></section><section class="dataset-samples"><h4>Sample images <span>design preview</span></h4><div class="thumbs">${thumbs}</div></section></div><footer>${readyActions}</footer></div></td>`;
    head.after(detail);
    const open = $('[aria-label="Open"]', head);
    if (open) {
      open.setAttribute('aria-label', `Show details for ${name}`);
      open.title = 'Show provenance, composition, split and sample images';
      open.addEventListener('click', () => $('.exbtn', head)?.click());
    }
  });

  const search = $('[data-dataset-search]');
  const task = $('[data-dataset-task]');
  const status = $('[data-dataset-status]');
  const count = $('[data-dataset-count]');
  const footer = $('#saved-datasets-panel .panel-ft > span');
  const filter = () => {
    const query = search.value.trim().toLowerCase();
    const wanted = task.value;
    const wantedStatus = status.value;
    let shown = 0;
    heads.forEach((head) => {
      const match = (!query || head.dataset.search.includes(query))
        && (wanted === 'all' || head.dataset.datasetTask === wanted)
        && (wantedStatus === 'all' || head.dataset.datasetStatus === wantedStatus);
      head.hidden = !match;
      const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
        ? head.nextElementSibling : null;
      if (detail) detail.hidden = !match || head.getAttribute('aria-expanded') !== 'true';
      if (match) shown += 1;
    });
    count.textContent = `(${shown} shown of 20)`;
    if (footer) footer.innerHTML = `Showing <b class="strong">${shown}</b> of 20 builds and datasets`;
  };
  search.addEventListener('input', filter);
  task.addEventListener('change', filter);
  status.addEventListener('change', filter);
  filter();
}

function wireAccordions() {
  $$('table.expandable tbody tr.runrow-head').forEach((head) => {
    const body = head.nextElementSibling;
    if (!body || !body.classList.contains('runrow-body')) return;
    const set = (on) => {
      head.setAttribute('aria-expanded', String(on));
      body.hidden = !on;
    };
    const toggle = () => set(head.getAttribute('aria-expanded') !== 'true');
    const btn = $('.exbtn', head);
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    head.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a, select')) return;
      toggle();
    });
  });

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
  'Save query': 'Keep these filters for next time',
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
  'Load query': 'Reuse a saved set of filters',
  'Reassign groups': 'Assign the groups again from a new seed',
  'Save draft': 'Keep the filters and membership without freezing a split',
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
  const sel = '.field > label, th, .stat-lab, .tabstrip button, .seg button,'
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
  const classNames = ['Rockfish', 'Lingcod', 'Canary rockfish', 'Kelp greenling',
    'Invertebrate', 'Other (7 classes)'];
  const datasetShares = [26, 21, 15, 11, 9, 18];
  const splitLabels = { train: 'Train', validation: 'Validation', test: 'Test' };
  let selectedSplit = 'train';
  let currentResult = null;

  const valueOf = (el) => {
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'yes' : 'no';
    if (el.tagName === 'BUTTON') return el.textContent.trim();
    return (el.value ?? el.textContent).trim();
  };
  const snapshot = () => Object.fromEntries(filterIds.map((id) => [id, valueOf($('#' + id))]));
  const keyFor = (query) => JSON.stringify(query);
  const hashFor = (text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  const makeResult = (query) => {
    const hash = hashFor(keyFor(query));
    let observations = 6200 + hash % 9200;
    if (query.dsproj === 'All projects') observations += 7400;
    if (query.dsdive !== 'All dives') observations = Math.round(observations * .46);
    if (query.dsline !== 'All lines') observations = Math.round(observations * .58);
    if (query.dsmodel === 'Human annotation only') observations = Math.round(observations * .71);
    const minConfidence = Math.max(0, Math.min(1, Number(query.dsconf) || 0));
    observations = Math.max(240, Math.round(observations * (1.18 - minConfidence * .36)));
    return {
      query,
      key: keyFor(query),
      observations,
      frames: Math.round(observations * (1.72 + (hash % 37) / 100)),
      videos: Math.max(4, Math.round(observations / (155 + hash % 70))),
      species: query.dsspecies === 'All species' ? 8 + hash % 5 : 1,
      hash
    };
  };
  const distribute = (total, shares) => {
    let used = 0;
    return shares.map((share, index) => {
      const count = index === shares.length - 1 ? total - used : Math.round(total * share / 100);
      used += count;
      return count;
    });
  };
  const drawDistribution = (container, total, shares) => {
    if (!container) return;
    const counts = distribute(total, shares);
    const max = Math.max(...counts, 1);
    const keys = $$('.k', container);
    const bars = $$('.b i', container);
    const values = $$('.v', container);
    const pcts = $$('.p', container);
    counts.forEach((count, index) => {
      if (keys[index]) keys[index].textContent = classNames[index];
      if (bars[index]) bars[index].style.width = (count / max * 100).toFixed(1) + '%';
      if (values[index]) values[index].textContent = count.toLocaleString('en-US');
      if (pcts[index]) pcts[index].textContent = shares[index] + '%';
    });
  };
  const queryShares = (hash) => {
    const first = 22 + hash % 10;
    const second = 18 + (hash >>> 3) % 8;
    const third = 13 + (hash >>> 6) % 6;
    const fourth = 9 + (hash >>> 9) % 5;
    const fifth = 7 + (hash >>> 12) % 5;
    return [first, second, third, fourth, fifth, 100 - first - second - third - fourth - fifth];
  };
  const setStatus = (message, kind = '') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  };
  const runQuery = () => {
    currentResult = makeResult(snapshot());
    Object.entries(resultFields).forEach(([name, el]) => {
      if (el) el.textContent = currentResult[name].toLocaleString('en-US');
    });
    drawDistribution($('[data-query-composition]'), currentResult.observations,
      queryShares(currentResult.hash));
    const sampleNote = $('[data-query-sample-note]');
    if (sampleNote) sampleNote.textContent = `Six of ${currentResult.observations.toLocaleString('en-US')} matches. Duplicates are ignored when adding.`;
    setStatus('Query refreshed. Add these matches as a new subset, or change the filters and run another query.');
    return currentResult;
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
    drawDistribution($('[data-dataset-composition]'), total, datasetShares);
    const summary = $('[data-dataset-composition-summary]');
    if (summary) summary.textContent = total ? '\u00b7 12 classes \u00b7 imbalance 4.2 : 1' : '\u00b7 no observations added';
    document.dispatchEvent(new CustomEvent('dataset-total-change', { detail: { total } }));
  };
  const appendSubset = (result) => {
    if ($$('[data-query-key]', list).some((row) => row.dataset.queryKey === result.key)) {
      setStatus('That exact query is already in this dataset. Change a filter to add another subset.', 'warning');
      return;
    }
    const overlapRate = 6 + result.hash % 9;
    const overlap = Math.round(result.observations * overlapRate / 100);
    const existingRows = $$('li', list);
    const existingTotal = existingRows.reduce((sum, item) => sum + Number(item.dataset.unique || 0), 0);
    const otherSplitTotal = existingRows
      .filter((item) => item.dataset.split !== selectedSplit)
      .reduce((sum, item) => sum + Number(item.dataset.unique || 0), 0);
    const crossSplitOverlap = existingTotal
      ? Math.min(overlap, Math.round(overlap * otherSplitTotal / existingTotal)) : 0;
    const unique = Math.max(0, result.observations - overlap);
    const row = document.createElement('li');
    row.dataset.queryKey = result.key;
    row.dataset.raw = String(result.observations);
    row.dataset.unique = String(unique);
    row.dataset.split = selectedSplit;
    row.dataset.subsetLabel = `${result.query.dsproj} \u00b7 ${result.query.dsspecies}`;

    const title = document.createElement('span');
    title.className = 's1';
    title.textContent = `${result.query.dsproj} \u00b7 ${result.query.dsspecies} `;
    const splitBadge = document.createElement('i');
    splitBadge.className = `subset-split ${selectedSplit}`;
    splitBadge.textContent = splitLabels[selectedSplit];
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
    const held = crossSplitOverlap
      ? ` ${crossSplitOverlap.toLocaleString('en-US')} overlapping matches kept their earlier split assignment.` : '';
    setStatus(`Added ${unique.toLocaleString('en-US')} new observations to ${splitLabels[selectedSplit]}; ${overlap.toLocaleString('en-US')} duplicates were ignored.${held}`, 'success');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const addCurrent = () => appendSubset(runQuery());

  $('[data-run-dataset-query]')?.addEventListener('click', runQuery);
  const destinationButtons = $$('[data-dataset-destination]');
  destinationButtons.forEach((button) => button.addEventListener('click', () => {
    selectedSplit = button.dataset.datasetDestination;
    destinationButtons.forEach((other) => {
      const on = other === button;
      other.classList.toggle('on', on);
      other.setAttribute('aria-pressed', String(on));
    });
    const label = $('[data-add-query-label]');
    if (label) label.textContent = `Add all matching to ${splitLabels[selectedSplit]}`;
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
    const counts = splitNames.map((split) => rows
      .filter((row) => row.dataset.split === split)
      .reduce((sum, row) => sum + Number(row.dataset.unique || 0), 0));
    const total = counts.reduce((sum, count) => sum + count, 0);
    counts.forEach((count, index) => {
      const pct = total ? count / total * 100 : 0;
      if (bars[index]) bars[index].style.width = pct.toFixed(2) + '%';
      if (pcs[index]) pcs[index].textContent = Math.round(pct) + '%';
      if (nums[index]) nums[index].textContent = count.toLocaleString('en-US');
      const subsetCount = rows.filter((row) => row.dataset.split === splitNames[index]).length;
      const subsetLabel = $(`[data-split-subsets="${splitNames[index]}"]`);
      if (subsetLabel) subsetLabel.textContent = `${subsetCount} subset${subsetCount === 1 ? '' : 's'}`;
    });
    if (note) note.textContent = 'First assignment wins; later overlaps never cross splits';
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

/* The last three review pages use one chart mechanism with different questions.
   The fixtures are deterministic seams for future telemetry; each legend item
   isolates its own series exactly like the reviewed job and training graphs. */
function wireOperationalActivity() {
  const configs = {
    models: {
      initial: '90d', leftMax: 30, rightMax: 100,
      ranges: {
        '30d': { labels: ['30d ago', '15d ago', 'Now'], registered: [22,22,23,23,23,24,24,24,24,25,25,25,25,25,25,26,26,26,26,27,27,27,27,28], preferred: [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6], coverage: [31,32,32,34,35,35,36,36,38,37,38,39,40,40,39,41,41,42,42,41,42,43,43,43] },
        '90d': { labels: ['90d ago', '45d ago', 'Now'], registered: [16,16,17,17,18,18,18,19,19,20,20,21,21,21,22,22,23,23,24,24,25,26,27,28], preferred: [3,3,3,3,3,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,6,6,6], coverage: [18,20,21,22,24,23,25,27,28,29,30,32,31,33,34,35,36,37,38,39,40,41,42,43] },
        '1y': { labels: ['1y ago', '6mo ago', 'Now'], registered: [6,7,7,8,9,10,11,12,13,14,15,16,16,17,18,19,20,21,22,23,24,25,27,28], preferred: [1,1,1,2,2,2,2,2,3,3,3,3,3,3,4,4,4,4,5,5,5,5,6,6], coverage: [4,5,7,8,10,12,13,15,17,19,21,23,25,27,28,30,32,34,35,37,39,40,42,43] }
      },
      scales: { registered: 'left', preferred: 'left', coverage: 'right' },
      formats: { registered: (v) => Math.round(v), preferred: (v) => Math.round(v), coverage: (v) => `${Math.round(v)}%` }
    },
    workers: {
      initial: '5h', leftMax: 100, rightMax: 16,
      ranges: {
        '24h': { labels: ['24h ago', '12h ago', 'Now'], inference: [18,21,24,29,34,31,36,39,42,38,35,32,28,30,34,37,41,44,40,36,34,32,30,31], training: [8,8,9,10,11,12,14,15,14,13,12,11,10,10,11,12,13,12,11,10,10,9,10,10], vram: [36,38,41,44,48,49,52,56,58,55,51,48,46,47,50,54,58,61,59,57,55,54,53,54], queued: [3,3,4,5,6,6,7,8,9,8,7,6,5,5,6,7,9,10,10,9,9,8,8,8] },
        '5h': { labels: ['5h ago', '2.5h ago', 'Now'], inference: [26,28,30,29,32,35,34,37,39,36,34,32,30,33,36,38,35,33,31,30,32,33,30,31], training: [9,9,10,11,11,12,13,13,12,12,11,10,10,11,11,12,12,11,11,10,10,10,10,10], vram: [47,49,51,50,53,56,58,59,57,55,54,52,51,53,56,58,57,55,54,53,55,56,54,54], queued: [6,6,7,7,8,9,9,10,10,9,9,8,8,9,9,10,9,9,8,8,9,9,8,8] },
        '1h': { labels: ['1h ago', '30m ago', 'Now'], inference: [30,31,33,32,34,36,35,37,38,36,35,34,33,35,36,35,34,33,32,31,32,31,30,31], training: [10,10,10,11,11,11,12,12,11,11,10,10,10,10,11,11,10,10,10,10,10,10,10,10], vram: [52,53,54,53,55,57,56,58,59,57,56,55,54,55,57,56,55,54,53,54,55,54,54,54], queued: [8,8,9,9,9,10,10,10,9,9,8,8,8,9,9,9,8,8,8,8,8,8,8,8] }
      },
      scales: { inference: 'left', training: 'left', vram: 'left', queued: 'right' },
      formats: { inference: (v) => `${Math.round(v)}%`, training: (v) => `${Math.round(v)}%`, vram: (v) => `${Math.round(v)}%`, queued: (v) => Math.round(v) }
    },
    history: {
      initial: '30d', leftMax: 16, rightMax: 4,
      ranges: {
        '7d': { labels: ['7d ago', '3.5d ago', 'Now'], completed: [7,8,9,8,10,11,10,12,11,9,8,10,12,13,11,10,9,8,10,11,10,9,8,9], issues: [1,1,2,1,1,2,1,2,2,1,1,1,2,2,1,1,2,1,1,2,1,1,1,1], turnaround: [1.6,1.5,1.4,1.5,1.3,1.2,1.3,1.1,1.2,1.4,1.5,1.3,1.1,1.0,1.2,1.3,1.4,1.5,1.3,1.2,1.3,1.4,1.3,1.3] },
        '30d': { labels: ['30d ago', '15d ago', 'Now'], completed: [5,7,6,8,9,7,6,5,8,10,11,9,8,7,9,12,13,11,9,8,10,12,11,9], issues: [1,1,1,2,1,1,2,1,1,2,2,1,1,2,1,2,2,1,2,1,1,2,1,1], turnaround: [2.4,2.2,2.3,2.0,1.9,2.1,2.3,2.4,2.0,1.8,1.7,1.9,2.0,2.2,1.9,1.6,1.5,1.7,1.9,2.0,1.7,1.5,1.4,1.3] },
        '90d': { labels: ['90d ago', '45d ago', 'Now'], completed: [4,5,6,5,7,6,8,7,9,8,10,9,8,10,11,10,12,11,10,12,11,10,9,9], issues: [1,1,1,1,2,1,1,2,1,2,1,1,2,1,2,1,2,1,2,1,1,2,1,1], turnaround: [3.0,2.9,2.8,2.9,2.7,2.6,2.5,2.6,2.4,2.3,2.2,2.3,2.1,2.0,1.9,2.0,1.8,1.7,1.6,1.7,1.5,1.4,1.4,1.3] }
      },
      scales: { completed: 'left', issues: 'left', turnaround: 'right' },
      formats: { completed: (v) => Math.round(v), issues: (_v, samples) => `${Math.round(samples.issues.at(-1) / Math.max(1, samples.completed.at(-1) + samples.issues.at(-1)) * 100)}%`, turnaround: (v) => `${Math.floor(v)}h ${Math.round((v % 1) * 60)}m` }
    }
  };

  $$('[data-ops-activity]').forEach((root) => {
    const config = configs[root.dataset.opsActivity];
    if (!config) return;
    const lines = Object.fromEntries($$('[data-ops-line]', root).map((line) => [line.dataset.opsLine, line]));
    const area = $('[data-ops-area]', root);
    const chart = $('.ops-chart', root);
    const rangeButtons = $$('[data-ops-range]', root);
    const highlightButtons = $$('[data-ops-highlight]', root);
    let range = config.initial;
    let samples;
    let tick = 0;
    const pathOf = (values, scale) => values.map((value, index) => {
      const x = 54 + 672 * index / Math.max(1, values.length - 1);
      const max = scale === 'right' ? config.rightMax : config.leftMax;
      const y = 196 - 168 * Math.max(0, Math.min(max, value)) / max;
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const draw = () => {
      Object.entries(lines).forEach(([name, line]) => line.setAttribute('d', pathOf(samples[name], config.scales[name])));
      const areaName = area?.dataset.opsArea;
      if (area && areaName) area.setAttribute('d', `${pathOf(samples[areaName], config.scales[areaName])} L726,196 L54,196 Z`);
      Object.entries(config.formats).forEach(([name, format]) => {
        const current = $(`[data-ops-current="${name}"]`, root);
        if (current) current.textContent = format(samples[name].at(-1), samples);
      });
      const values = Object.keys(lines).map((name) => `${name} ${config.formats[name](samples[name].at(-1), samples)}`).join(', ');
      const label = `${root.dataset.opsActivity} activity over ${range}: ${values}`;
      chart.setAttribute('aria-label', label);
      chart.title = label;
    };
    const choose = (next) => {
      range = next;
      samples = Object.fromEntries(Object.entries(config.ranges[range]).filter(([name]) => name !== 'labels').map(([name, values]) => [name, [...values]]));
      rangeButtons.forEach((button) => { const on = button.dataset.opsRange === range; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
      $$('[data-ops-time]', root).forEach((label, index) => { label.textContent = config.ranges[range].labels[index]; });
      draw();
    };
    const highlight = (name = '') => {
      const active = root.dataset.highlight === name ? '' : name;
      root.dataset.highlight = active;
      root.classList.toggle('is-highlighted', Boolean(active));
      highlightButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.opsHighlight === active)));
      $$('.ops-line, .ops-area', root).forEach((mark) => mark.classList.toggle('highlighted', Boolean(active) && mark.classList.contains(active)));
    };
    rangeButtons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.opsRange)));
    highlightButtons.forEach((button) => {
      button.title = `Highlight only ${button.textContent.trim()} on this graph; select it again or press Escape to restore all series`;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => highlight(button.dataset.opsHighlight));
    });
    root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && root.classList.contains('is-highlighted')) highlight(''); });
    choose(range);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const movement = [1, 0, -1, 1, -1, 0];
      window.setInterval(() => {
        const first = Object.keys(lines)[0];
        const max = config.scales[first] === 'right' ? config.rightMax : config.leftMax;
        samples[first][samples[first].length - 1] = Math.max(0, Math.min(max, samples[first].at(-1) + movement[tick % movement.length]));
        tick += 1;
        draw();
      }, 3000);
    }
  });
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

document.body.dataset.rail = 'closed';
mountSprite();
mountRail();
mountTopbar();
wireTopbarAutohide();
wireRailSheet();
wireDrawer();
wireSwitchers();
wirePoolUtilization();
wireInferenceActivity();
wireTrainingActivity();
wireDatasetActivity();
wireOperationalActivity();
wireModelRegistration();
wireSliders();
wireInferenceForm();
wireDatasetPage();
wireAccordions();
wireDatasetBuilder();
wireSplit();
wireLineage();
wireRowSelect();

/* **Rows first, then the wiring that needs rows.** The Jobs table is filled
   from the data layer, which is asynchronous because it has to be -- swapping
   it for real `fetch` calls is meant to be the whole of the wiring work, and a
   synchronous layer could not be swapped for one. So the four that bind to rows
   wait, and everything above, which does not care, has already run.

   Off those screens each render resolves without doing anything, so this costs
   one microtask and no special case. */
Promise.all([renderJobsTable(), renderWorkersTable(), renderDashboardScreen(), renderHistoryScreen()]).then(() => {
  /* `applyJobsQuery` and `applyWorkersQuery` rewire the rows they draw; these
     are the ones that bind once, to controls that outlive every redraw. */
  wireJobsControls();
  wireWorkersControls();
  wireHistoryControls();
  wireSorting();
  wireJobsOverview();
  wireSelection();
  applyTips();
});
