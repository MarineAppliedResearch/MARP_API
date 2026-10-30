/**
 * The shared chrome and the shared behaviour for every screen of the dashboard.
 *
 * **This file was called `mock.js` and nothing in it has been a mock for months.**
 * It draws the real application from the real API: `api.js` is the only seam, every
 * renderer here reads what MARP returned, and the polling is live. The name was left
 * over from the weeks in 2026 when these were hand-written screens with no backend, and
 * it kept inviting the obvious question from everyone who arrived at it -- Isaac's
 * included: *"who is writing mock.js, we aren't supposed to be mocking anything up?"*
 *
 * The icon sprite, the rail and the top bar's controls are built here rather
 * than copied into each screen's HTML. They were copied, and the point of
 * catching that early is that eight hand-written pages drift: a nav item gets
 * renamed on one screen, an icon is added on another, and the screens stop
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
 *     <script src="./screens.js"></script>
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
  /* **Not the cross.** `x` closes and cancels everywhere on these screens, and a
     permanent delete sharing that glyph is how somebody destroys a job meaning to
     dismiss a row. */
  trash: '<path d="M3.2 4.6h9.6"/><path d="M6.4 4.6V3.2a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.4"/><path d="M4.6 4.6l.5 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.5-8"/>',
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

  const set = (id, count, label) => {
    const badge = $('[data-nav-badge="' + id + '"]');

    if (!badge) return;

    badge.textContent = String(count);
    badge.hidden = !count;

    /* **What the number is, not just the number.** The Jobs badge is a count of failed
       jobs and read as a bare 1,189 with nothing saying so; Isaac asked what it meant
       twice, once when it said 8. The count was always right -- the silence was the
       defect. */
    if (label) badge.title = `${Number(count).toLocaleString()} ${label}`;
  };

  try {
    /* `limit: 1` because only the total is wanted and the rows are the expensive part;
       none of them is drawn here. */
    const [failed, inference, training] = await Promise.all([
      window.MarpApi.listJobs({ state: 'failed', limit: 1 }),
      window.MarpApi.listJobs({ state: 'leased', kind: 'inference', limit: 1 }),
      window.MarpApi.listJobs({ state: 'leased', kind: 'training', limit: 1 }),
    ]);

    set('jobs', failed.total || 0, 'failed jobs');
    set('inference', inference.total || 0, 'inference jobs running');
    set('training', training.total || 0, 'training jobs running');
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

/* **The top bar had a Project filter and it narrowed nothing.**
   It was six invented project names -- CAMPA 2024, GULF 2025, PACIFIC 2023 and three
   more -- written into the chrome when this was a mockup, on five screens, with no
   listener anywhere: choosing one changed no list. Filling it from
   `GET /api/v2/projects` made the names true and left the lie, because by this
   project's own rule a filter that narrows nothing is one.

   Removed rather than wired, as the smaller of the two. Wiring it is a real feature
   and a bigger one: jobs carry no project, only a session, so every list would have
   to narrow client-side through `SESSIONS`, on five screens, and Datasets and the
   Dashboard would each need their own rule. That is worth doing deliberately rather
   than as a side effect of making a mockup honest. */

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
  dashboard: { actions: ['inference', 'training'] },
  jobs: { actions: ['inference', 'training'] },
  inference: { actions: ['inference', 'training'] },
  training: { actions: ['inference', 'training'] },
  datasets: { actions: ['dataset'] },
  models: { wide: true, actions: ['register'], kebab: true,
    search: 'Search models by name, task, dataset or description\u2026' },
  workers: { wide: true, actions: ['tokens'], kebab: true,
    search: 'Search workers by name, GPU or job\u2026' },
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
    '<span class="search">' + ico('search', 'sm')
    + '<input class="inp" type="search" placeholder="'
    + (cfg.search || 'Search jobs, models, datasets\u2026') + '"'
    + ' aria-label="Search"></span>'
    /* **On every screen, because it is the same question on every screen.** Isaac asked
       for it on Models and it was absent everywhere; building it into the shared chrome
       is the difference between answering him once and answering him seven times. */
    + '<span class="fresh" data-freshness aria-live="polite" title="When MARP last answered"></span>'
    /* **Which code is answering, beside when it last answered.** Passive and quiet: it
       is not a control and nobody should have to look at it, but a server serves the
       code it was started with rather than the code on your branch, and one here ran
       five days behind its checkout for a day. The commit goes in the title, because
       the question people actually ask is "is this current", not "which hash". */
    + '<span class="fresh" data-server-started hidden></span>'
    + '<button class="btn icon" data-reload aria-label="Reload" title="Reload">' + ico('refresh') + '</button>'
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

  /* **One ladder across the dashboard**: 1h, 24h, 7d, 30d, 1y. Every chart takes a
     contiguous four of it, so the vocabulary is shared without every chart carrying every
     rung. Eight charts had four different vocabularies between them and no reason for any
     of it; `5h` was the only rung that was not a round unit and `90d` sat between 30d and
     1y on one chart alone, so both went.

     **This chart stops at 30 days because its data does.** `SAMPLE_RETENTION_DAYS` is 30
     and the pool read sweeps anything older, so a year here would be empty by
     construction -- which is the complaint this is answering, not a way to answer it. */
  const RANGES = {
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
    '7d': { hours: 168, bucket: 'hour', label: 'the last 7 days' },
    '30d': { hours: 720, bucket: 'day', label: 'the last 30 days' },
  };

  const buttons = $$('[data-pool-range]', root);
  const chart = $('.pool-chart', root);
  const plot = $('.pool-plot', root);

  const blank = () => { if (plot) plot.innerHTML = ''; };

  wireSeriesKeys(root, 'data-pool-highlight', plot);

  async function choose(next) {
    buttons.forEach((b) => {
      const on = b.dataset.poolRange === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const { hours, bucket, label } = RANGES[next] || RANGES['24h'];
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

      /* **A bucket nobody sampled is a gap.** These were mapped with `|| 0`, so an
         unsampled bucket drew 0% -- GPUs apparently idle across hours nobody measured. A
         queue is a count of rows, where none waiting is a real zero. */
      const at = points.map((p) => Date.parse(p.at));
      const reading = (key) => points.map((p) => (p[key] === null || p[key] === undefined ? null : Number(p[key])));
      const pair = (values) => values.map((value, index) => [at[index], value]);
      const samples = {
        queueInference: points.map((p) => queuedInference.get(String(p.at)) || 0),
        queueTraining: points.map((p) => queuedTraining.get(String(p.at)) || 0),
      };

      /* Utilization is a percentage; a queue is a count, on its own axis so a quiet queue
         does not flatten against a busy pool. */
      const series = [
        { id: 'inference', name: 'Inference', css: 'pool-area inference', kind: 'fill', unit: '%', data: pair(reading('avg_inference_utilization_percent')) },
        { id: 'training', name: 'Training', css: 'pool-area training', kind: 'fill', unit: '%', data: pair(reading('avg_training_utilization_percent')) },
        { id: 'computeUsed', name: 'Compute used', css: 'pool-line compute-used', unit: '%', data: pair(reading('avg_utilization_percent')) },
        { id: 'vramUsed', name: 'VRAM used', css: 'pool-line vram-used', unit: '%', data: pair(reading('avg_memory_percent_used')) },
        { id: 'queueTraining', name: 'Training queue', css: 'pool-line queue-training', axis: 1, data: pair(samples.queueTraining) },
        { id: 'queueInference', name: 'Inference queue', css: 'pool-line queue-inference', axis: 1, data: pair(samples.queueInference) },
      ];

      const last = points.at(-1);

      const said = `GPU pool over ${label}: `
        + `${Math.round(last.avg_utilization_percent || 0)} percent compute and `
        + `${Math.round(last.avg_memory_percent_used || 0)} percent VRAM across `
        + `${last.machines} reporting ${last.machines === 1 ? 'machine' : 'machines'}, `
        + `${samples.queueInference.at(-1)} inference and ${samples.queueTraining.at(-1)} training jobs queued`;

      if (chart) chart.setAttribute('aria-label', said);
      if (plot) {
        drawActivity(plot, activityOption({
          root, series, axes: [{ name: 'Pool capacity', max: 100, unit: '%' }, { name: 'Queued jobs', whole: true }],
        }), said, `pool-${next}`);
      }
    } catch (error) {
      blank();
      if (chart) chart.setAttribute('aria-label', `Could not load pool utilization (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.poolRange)));
  await choose('24h');
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
/**
 * A dive as a reader says it. Jellyfin names many of them "Dive 47" already, and every
 * scope on these screens put "Dive" in front, so they read "Dive Dive 47".
 *
 * @param {string|number} dive - `session.dive`, as recorded.
 * @returns {string}
 */
function diveText(dive) {
  const text = String(dive).trim();

  return /^dive(?![a-z])/i.test(text) ? text : `Dive ${text}`;
}

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
    ? `${diveText(session.dive)}${session.line ? ` &middot; Line ${session.line}` : ''}`
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

  /* **Absent on a running job, not disabled.** A leased job has a worker holding it,
     and deleting it cascades the attempt that worker is heartbeating against -- so the
     next heartbeat 404s and the machine is reporting into nothing. Cancel first, then
     delete; the row already carries Cancel while it is live. A greyed button with a
     tooltip was the other option and Isaac has rejected that shape three times: a
     control that cannot act should not be drawn.

     Queued is deletable. Nothing is running it, and removing it from the queue is a
     thing somebody legitimately wants rather than a cancellation. */
  const removable = job.state !== 'leased';
  const remove = removable
    ? `<button class="btn sm icon danger" type="button" data-delete-job="${job.id}"`
      + ` aria-label="Delete job ${job.id}" title="Delete this job and everything recorded against it">`
      + '<svg class="ico sm"><use href="#i-trash"/></svg></button>'
    : '';

  /* Cancel is wired by `wireJobsCancel`. The Open arrow that used to stand here on a
     finished job had nothing behind it; the row's own expander is how a job is opened. */
  const actions = (live
    ? `<button class="btn sm icon" type="button" data-cancel-job="${job.id}" aria-label="Cancel job ${job.id}"`
      + ' title="Cancel this job"><svg class="ico sm"><use href="#i-stop"/></svg></button>'
    : '')
    + remove;

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
    + ` data-batch="${job.batch_id || ''}"`
    + ` data-by="${job.created_by ?? ''}"`
    /* **Which dataset a build built.** The Jobs detail shows job-level facts and the
       Datasets screen shows dataset-level ones, which is right -- but nothing said the
       two were about the same thing, so the screens read as though they disagreed. The
       id travels on the row because the detail is built from the row rather than from
       the job object. */
    + ` data-dataset="${job.kind === 'dataset_build' && job.spec && job.spec.dataset_id != null ? job.spec.dataset_id : ''}">`
    + `<td class="chk"><input class="chkbox" type="checkbox" aria-label="Select job ${job.id}"></td>`
    + `<td class="jname" title="${escapeHtml(view.title)}"><span class="name"><svg class="ico ${view.kindIcon}"><use href="#i-${view.kindIcon}"/></svg><span class="t">${view.title}</span></span></td>`
    + `<td class="jtype"><span class="tag ${view.kindIcon}">${view.kindLabel}</span></td>`
    + `<td class="jscope"><span class="two"><span class="a">${scope}</span><span class="b">${frames}</span></span></td>`
    + `<td class="jmodel"><span class="two"><span class="a">${view.model}</span><span class="b">${view.reduction}</span></span></td>`
    + `<td class="jstatus" data-sort="${JOB_STATE_RANK[state]}"><span class="st" data-state="${state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="jprog" data-sort="${progress.sort}">${progress.html}</td>`
    + `<td class="jworker" data-sort="${job.worker_name || ''}">${workerCell(job)}</td>`
    + `<td class="jtime" data-sort="${job.created_at}"><span class="two"><span class="a">${hhmm}</span><span class="b">${date}</span></span></td>`
    /* **Submitted says when it arrived; this says whether anything has happened since.**
       The later of the job row's own timestamp and its latest heartbeat, because
       `gpu_jobs.updated_at` does not move while a job runs -- nothing on the heartbeat
       path writes the job row, so for job 21782 it sat at the instant of creation while
       the worker reported progress every sixty seconds. A column reading `updated_at`
       alone is faithfully showing a stale timestamp, which is worse than no column. */
    + `<td class="jseen" data-updated data-sort="${jobLastSeen(job) || job.created_at}">`
    + `${datasetStamp(jobLastSeen(job) || job.created_at)}</td>`
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

/* ------------------------------------------------------------------------------------
   One pager for every table.

   **Isaac: *"all of the tables should work and be paginated in the same way."*** Each
   table had grown its own copy -- Jobs at 18 rows, Training runs at 10, Models at 8,
   Workers at 5, Inference cut to 6 with no pager at all, so a run of 28 pieces pushed
   every finished job off the tab. They were the same footer five times over, drifting.
   This is the Jobs table's, now everyone's: what is shown out of how many, a window of
   page buttons, and Rows 18 / 25 / 50.
   ------------------------------------------------------------------------------------ */

/** The rows-per-page every table offers, the first being where each starts. */
const PAGE_SIZES = [18, 25, 50];

/** The Training screen's jobs table page. */
const trainingPage = { page: 1, perPage: PAGE_SIZES[0] };

/** The Dashboard's jobs table page. */
const dashboardPage = { page: 1, perPage: PAGE_SIZES[0] };

/** The saved datasets table's page. */
const datasetsPage = { page: 1, perPage: PAGE_SIZES[0] };

/**
 * The slice of `rows` a table's state says to show, with its page clamped to exist.
 *
 * @param {Array} rows - Every row the filters left, in order.
 * @param {{page: number, perPage: number}} state - The table's paging state.
 * @returns {{shown: Array, from: number, pages: number}}
 */
function pageOf(rows, state) {
  const pages = Math.max(1, Math.ceil(rows.length / state.perPage));
  state.page = Math.min(Math.max(1, state.page), pages);
  const from = (state.page - 1) * state.perPage;
  return { shown: rows.slice(from, from + state.perPage), from, pages };
}

/**
 * Draw a table's footer: *Showing a-b of N*, the page buttons, and Rows.
 *
 * **Drawn whole, every time, into the footer element**, so no table's markup has to
 * carry a pager that is a guess about its own length. The clicks are taken once per
 * footer by delegation and call whichever `redraw` the latest draw handed in.
 *
 * @param {Element} footer - The table's `.panel-ft`.
 * @param {{page: number, perPage: number}} state - The table's paging state; changed here.
 * @param {Object} what - `{total, from, count, pages, noun, plural, empty, redraw}`.
 * @returns {void}
 */
function drawPager(footer, state, what) {
  if (!footer) return;

  const { total, from, count, pages, noun, plural = `${noun}s`, empty, redraw } = what;
  const page = state.page;
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = [];

  for (let p = first; p <= Math.min(pages, first + 4); p += 1) {
    numbers.push(`<button type="button" data-page="${p}"${p === page ? ' aria-current="page"' : ''}>${p}</button>`);
  }

  const sizes = PAGE_SIZES.includes(state.perPage) ? PAGE_SIZES : [...PAGE_SIZES, state.perPage].sort((a, b) => a - b);

  footer.innerHTML = `<span>${count
    ? `Showing <b class="strong">${(from + 1).toLocaleString()}&ndash;${(from + count).toLocaleString()}</b> of ${total.toLocaleString()} ${total === 1 ? noun : plural}`
    : empty}</span>`
    + '<div class="pager">'
    + `<button type="button" aria-label="Previous page" data-page="${page - 1}"${page === 1 ? ' disabled' : ''}><svg class="ico sm"><use href="#i-left"/></svg></button>`
    + numbers.join('')
    + `<button type="button" aria-label="Next page" data-page="${page + 1}"${page >= pages ? ' disabled' : ''}><svg class="ico sm"><use href="#i-right"/></svg></button>`
    + '</div>'
    + '<span class="rpp">Rows <select class="sel" aria-label="Rows per page">'
    + sizes.map((size) => `<option${size === state.perPage ? ' selected' : ''}>${size}</option>`).join('')
    + '</select></span>';

  footer.pagerRedraw = redraw;
  footer.pagerState = state;

  if (!footer.dataset.pagerWired) {
    footer.dataset.pagerWired = 'true';
    footer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      footer.pagerState.page = Number(button.dataset.page);
      footer.pagerRedraw();
    });
    footer.addEventListener('change', (event) => {
      if (!event.target.matches('.rpp select')) return;
      footer.pagerState.perPage = Number(event.target.value) || PAGE_SIZES[0];
      footer.pagerState.page = 1;
      footer.pagerRedraw();
    });
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

  drawPager($('#jobs')?.closest('.panel')?.querySelector('.panel-ft'), jobsQuery, {
    total, from, count: shown, pages, noun: 'job', empty: 'No jobs match these filters', redraw: applyJobsQuery,
  });

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
  /* `live` is no column: running first, then queued, then the rest newest first (#285).
     Clicking a header replaces it with that column, as it always has. */
  sort: { key: 'live', dir: 'descending' },
  page: 1,
  perPage: PAGE_SIZES[0],
};

/** How each sortable column is ordered. Keyed by the header's class. */
const JOBS_SORT_KEYS = {
  hjob: (view) => view.title.toLowerCase(),
  htype: (view) => view.job.kind,
  hscope: (view) => `${view.session.dive || ''}${view.session.line || ''}`,
  hmodel: (view) => ((view.job.spec.model && view.job.spec.model.name) || '').toLowerCase(),
  hstatus: (view) => JOB_STATE_RANK[view.state],
  hprog: (view) => view.pct,
  /* **Worker was marked `sortable` in the markup and had no key here**, so the loop that
     wires the headers skipped it -- `if (!key) continue` -- and clicking it did nothing
     on desktop while the phone had no button for it at all. A header that says it sorts
     and does not is worse than one that never claimed to. Blank for a job never leased to
     a machine, which sorts those together rather than scattering them. */
  hworker: (view) => (view.job.worker_name || '').toLowerCase(),
  hupd: (view) => view.job.created_at,
};

/**
 * The column order the phone's sort strip uses.
 *
 * **Index for index with the table's headers**, which is why `hworker` goes before
 * `hupd` rather than on the end: the strip is the only sort control below 1050px and a
 * reader comparing it with the table above would otherwise find the two in different
 * orders. Appending it would have been a smaller diff and a worse answer.
 *
 * @type {string[]}
 */
const JOBS_SORT_COLUMNS = ['hjob', 'htype', 'hscope', 'hmodel', 'hstatus', 'hprog', 'hworker', 'hupd', 'hseen'];

/** The window the whole screen is drawn from, refetched only when the API query changes. */
let jobsWindow = null;

/* Every job the filters leave, in sort order -- more than the page shows. Export is
   about the window rather than whichever page somebody happens to be looking at. */
let jobsWindowViews = [];

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

  if (jobsQuery.sort.key === 'live') {
    /* **What is happening now, on page 1.** Newest first buried the four running pieces
       of an 82-piece run among hundreds of finished jobs (#285). Sorted over the whole
       window rather than the page, so it holds across pages -- which the Running and
       Queued cards, reordering only the rows on screen, cannot do. */
    const rank = (view) => ({ running: 0, queued: 1 }[view.state] ?? 2);
    views.sort((a, b) => rank(a) - rank(b)
      || Date.parse(b.job.created_at) - Date.parse(a.job.created_at)
      || b.job.id - a.job.id);
  } else {
    const key = JOBS_SORT_KEYS[jobsQuery.sort.key] || JOBS_SORT_KEYS.hupd;
    const sign = jobsQuery.sort.dir === 'ascending' ? 1 : -1;
    views.sort((a, b) => {
      const left = key(a);
      const right = key(b);
      if (left < right) return -1 * sign;
      if (left > right) return 1 * sign;
      return b.job.id - a.job.id;  /* the same id tie-breaker the route uses */
    });
  }

  jobsWindowViews = views;

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

/**
 * How a job's scope reads outside a table cell.
 *
 * `rowFor` builds the same thing as markup; this is the plain-text twin, kept beside the
 * columns that use it rather than factored out of a row that also draws a tag and a link.
 *
 * @param {Object} view - From `jobView`.
 * @returns {string}
 */
function jobScopeText(view) {
  const { session, spec } = view;

  if (session.dive) return `${diveText(session.dive)}${session.line ? ` · Line ${session.line}` : ''}`;
  return spec.session && spec.session.session_id !== undefined ? `Session ${spec.session.session_id}` : '';
}

/** The columns an exported queue carries, in the order the table draws them. */
const JOBS_CSV_COLUMNS = [
  ['Job id', (v) => v.job.id],
  ['Job', (v) => v.title],
  ['Type', (v) => v.kindLabel],
  ['Status', (v) => v.label],
  ['Scope', jobScopeText],
  ['Model', (v) => v.model],
  /* -1 is `jobView`'s "never measured", and a blank says that better than a number
     would -- writing 0 here would be a gap reading as a measurement. */
  ['Progress %', (v) => (v.pct < 0 ? '' : v.pct)],
  ['Created', (v) => v.job.created_at],
  ['Updated', (v) => v.job.updated_at],
  ['Worker', (v) => v.job.worker_name || ''],
];

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

/**
 * No run was recorded for this job, so there is nothing to say about one.
 *
 * **This used to say runs could not be listed, and it stopped being true twice.** #260
 * added the collection read and f951fdda added `GET /training_run/:id/epochs`, so the
 * page went on explaining why it could not do a thing it was doing. That is the same
 * defect as a *Design preview* marker on a live chart, and it was in twelve places.
 */
const NO_RUN_RECORDED = '<span class="dash" title="No training run was recorded for this job">&mdash;</span>';

/**
 * Answerable, but only by reading the run's epochs.
 *
 * Epochs are fetched per run when a row is opened rather than for every row on the page:
 * a screen of twenty would be twenty requests for curves nobody asked to see. So this is
 * a dash that points at where the number is, not one that says it does not exist.
 */
const IN_THE_EXPANSION = '<span class="dash" title="Computed from the run&apos;s epochs. Open the row to see it.">&mdash;</span>';

/**
 * The best validation mAP@50 a training job reached, for the table's own column.
 *
 * **Absent and null are different answers, and this is the fourth place today where
 * collapsing them would have been wrong.** `GET /gpu/jobs?kind=training` derives
 * `best_map50` over the run's epochs. The same endpoint unfiltered does not carry the
 * field at all, deliberately: the aggregate costs about 22ms a page, paid almost entirely
 * by the thousands of inference jobs that have no epochs and no such column. So there are
 * three states and only two of them are about this job:
 *
 * - **a number** — the best epoch of the run, not its last;
 * - **null** — this training job reached no epoch. That is an answer, and the dash is it;
 * - **absent** — this response was never asked for the field. Not a statement about the
 *   job, so the cell says what it said before the field existed rather than inventing
 *   *no mAP* — which is what an older API, or the unfiltered Jobs screen, would get.
 *
 * `job.best_map50 || dash` would collapse all three, and would read a genuine 0.000 —
 * a model that found nothing — as nothing recorded.
 *
 * @param {Object} job - The job as the list returned it.
 * @param {Object|null} run - Its training run, when one was recorded.
 * @returns {{html: string, sort: number}} The cell, and its sort key.
 */
function bestMap(job, run) {
  /* Unmeasured sorts below every real mAP, which cannot be negative. */
  const NOT_A_NUMBER = -1;

  if (!('best_map50' in job)) {
    return { html: run ? IN_THE_EXPANSION : NO_RUN_RECORDED, sort: NOT_A_NUMBER };
  }

  /* **A fourth state, and the only one that is about the task rather than the data.**
     `best_map50` is `max(map50)` over the run's epochs, and a classification run has no
     mAP at all -- so it comes back present and null, exactly like a detection run that
     reached no epoch. Without the task those two are indistinguishable, and this cell
     would tell a reader that a finished classifier "has reported no epoch yet", which is
     false and confidently so. Null means *not this task* here, and only the task says
     which null it is. */
  const task = trainingTaskOf(job);
  const headline = task ? TRAINING_TASKS[task].headline : null;

  if (headline && headline.from !== 'map50') {
    return {
      html: `<span class="dash" title="A ${TRAINING_TASKS[task].label.toLowerCase()} run has no mAP. `
        + `It reports ${escapeHtml(headline.label.toLowerCase())}, which is in the expansion.">&mdash;</span>`,
      sort: NOT_A_NUMBER,
    };
  }

  if (job.best_map50 === null || job.best_map50 === undefined) {
    return {
      html: run
        ? '<span class="dash" title="This run has reported no epoch yet, so there is no mAP to be best">&mdash;</span>'
        : NO_RUN_RECORDED,
      sort: NOT_A_NUMBER,
    };
  }

  const best = Number(job.best_map50);

  return {
    html: `<span title="The best epoch of this run, not its last">${best.toFixed(3)}</span>`,
    sort: best,
  };
}

/** The registry by id, so a row can read its base model's task. */
let trainingModelsById = new Map();

/** The latest view per training job id, so an open panel redraws from current data. */
let trainingViewsByJob = new Map();

/** What each training run was, by the job that produced it. Empty until the screen loads. */
let trainingRunsByJob = new Map();

/* The model each run produced, keyed by run id. `ml_models.training_run_id` is written at
   registration and is the only record of this: `training_runs.model_id` is the base the
   run started from, and reading that as the produced model is what made this column
   name every run after the checkpoint it fine-tuned from. */
let modelByTrainingRun = new Map();

/**
 * The model a run registered, as a link to it, or the dash saying none is recorded.
 *
 * @param {?Object} run - The run, when the job has one.
 * @returns {string} A table cell's contents.
 */
function producedModelCell(run) {
  const made = run && modelByTrainingRun.get(run.id);

  return made
    ? `<a href="./models.html?model=${encodeURIComponent(made.id)}" title="The model version this run registered">${escapeHtml(made.name)}</a>`
    : NO_REGISTERED_MODEL;
}

/** How often an open expansion re-reads a run that is still going. */
const TRAINING_EPOCH_POLL_MS = 5000;

/**
 * What a running run's step charts draw, and from which metric key.
 *
 * Isaac, on watching a run: *"i don't want it as a command line, i want everything that
 * would be showing in the command line to be graphed!"* So this is what the Ultralytics
 * console prints per batch, as charts: the running losses, the memory, the throughput and
 * the estimate.
 *
 * **Keyed on the metric name the worker sent, and a chart with no key in the samples is
 * not drawn.** `metrics` is deliberately free-form — a detector sends `train/box_loss`,
 * `train/cls_loss` and `train/dfl_loss`, a classifier sends one `train/loss` — so the
 * panel asks what arrived rather than deciding in advance. A classification run draws
 * three charts and a detection run five, from the same table, with nothing declaring
 * which task it is.
 *
 * **Two things are missing on purpose.** Instances per batch is unreachable from
 * Ultralytics' callback, and there is no callback at all while it caches images, so a
 * count of either would be invented. Both have been asked for three times and checked
 * twice; leaving a space for them would invite a fourth.
 */
const STEP_CHARTS = [
  { key: 'train/loss', title: 'Loss', unit: '', max: 'auto' },
  { key: 'train/box_loss', title: 'Box loss', unit: '', max: 'auto' },
  { key: 'train/cls_loss', title: 'Class loss', unit: '', max: 'auto' },
  { key: 'train/dfl_loss', title: 'DFL loss', unit: '', max: 'auto' },
  { key: 'gpu_memory_bytes', title: 'GPU memory', unit: ' GB', max: 'auto', scale: 1073741824 },
  { key: 'iterations_per_second', title: 'Throughput', unit: ' it/s', max: 'auto' },
  { key: 'epoch_eta_seconds', title: 'Epoch ETA', unit: ' s', max: 'auto' },
];

/** Readings per attempt at or below which each is drawn as a point as well as a line. */
const STEP_POINTS_SHOWN = 200;

/** Batch samples by run id, appended to rather than refetched. */
const trainingStepsByRun = new Map();

/**
 * Per-threshold curves by run id, once each.
 *
 * `/curves` is about a thousand points per class where `/metrics` is a handful of rows,
 * which is why the API serves it separately. Re-reading it on every five-second poll of
 * an open panel would be a megabyte a minute for numbers that cannot change: a run that
 * has finished evaluating does not evaluate again.
 */
const trainingCurvesByRun = new Map();

/**
 * How far above the settled losses the first epoch has to sit before it stops setting the
 * scale. Twice the highest value every later epoch reached.
 *
 * **Not a tuned number: it is the gap between a decay and a warm-up.** A loss that simply
 * starts high and falls -- which is every healthy curve -- has its first point within a
 * factor of two of what the rest of the run reaches, so nothing is clipped and the chart
 * is as it was. A first epoch several times above everything after it is the optimizer
 * before the model has learned anything, and it is not comparable to the run.
 */
const WARMUP_RATIO = 2;

/**
 * The ceiling for an auto-scaled chart, and which series it had to cut.
 *
 * **One warm-up point was setting the scale for sixty.** Run 205 recorded
 * `train_cls_loss` at 12.10 for epoch 1 and 0.65 for epoch 2; every other value in that
 * chart lives between 0.35 and 2.27. Scaled to 12.2, validation box loss travelled 3.4px
 * over ten epochs and DFL loss travelled 0.5px -- six flat lines and a spike, on the chart
 * whose whole purpose is the gap between each train/validation pair.
 *
 * **So the scale follows epoch 2 onward, and what that leaves out is said rather than
 * hidden.** The alternative was to clamp quietly, and a flat line that is
 * really a clamp cannot be told from a plateau -- which is a finding somebody would act
 * on. `clipped` is what the caller names in its note, above where the chart opens.
 *
 * @param {Object[]} drawn - `{key, label, values}` per series, values one per epoch.
 * @param {number} count - How many epochs there are.
 * @returns {{max: number, clipped: Object[]}} The ceiling, and the series above it at epoch 1.
 */
function autoCeiling(drawn, count) {
  const round = (value) => Math.max(1, Math.ceil(value * 10) / 10);
  const real = (list) => list.filter((value) => value !== null && value !== undefined);
  const everything = round(Math.max(...real(drawn.flatMap((one) => one.values)), 0));

  /* Two epochs cannot say which of them is the outlier, and dropping one of two leaves
     nothing to scale by. */
  if (count < 3) return { max: everything, clipped: [] };

  const settled = real(drawn.flatMap((one) => one.values.slice(1)));
  const firstMax = Math.max(...real(drawn.map((one) => one.values[0])), 0);
  const settledMax = Math.max(...settled, 0);

  if (!settled.length || !settledMax || firstMax <= settledMax * WARMUP_RATIO) {
    return { max: everything, clipped: [] };
  }

  const max = round(settledMax);

  return {
    max,
    clipped: drawn
      .filter((one) => one.values[0] !== null && one.values[0] !== undefined && one.values[0] > max)
      .map((one) => ({ key: one.key, label: one.label, value: one.values[0] })),
  };
}

/**
 * Read whatever batch samples are new for a run, and keep them.
 *
 * **Appended, never refetched.** `after_step` is the last step already held, applied per
 * attempt, so a poll asks for the handful of rows that arrived in the last few seconds
 * rather than the whole run every time. A run of four hundred batches would otherwise be
 * four hundred rows down the wire every five seconds for the whole of its life.
 *
 * **`strided` is handled by not meeting it.** A first read of a long run comes back
 * thinned, and after that every read is incremental, so the stride applies once and the
 * chart fills in from there. The newest sample is always included whatever the stride, so
 * the line never looks stalled when it is not.
 *
 * @param {number} runId - The run.
 * @returns {Promise<Object[]>} Every sample held, oldest first.
 */
async function readTrainingSteps(runId) {
  const held = trainingStepsByRun.get(runId) || [];
  /* The highest step seen, which is what `after_step` is measured against. A retry
     restarts at 1, so this is deliberately the maximum across attempts rather than per
     attempt: the endpoint applies it per attempt itself. */
  const after = held.reduce((top, one) => Math.max(top, Number(one.step) || 0), 0);

  let answer;

  try {
    answer = await window.MarpApi.trainingRunSamples(runId, after ? { after_step: after } : {});
  } catch {
    /* A failed read is a blip: the top bar says MARP is not answering, and what is
       already held stays on screen rather than the charts emptying. */
    return held;
  }

  const fresh = Array.isArray(answer.samples) ? answer.samples : [];

  if (!fresh.length) return held;

  const next = held.concat(fresh);

  trainingStepsByRun.set(runId, next);

  return next;
}

/**
 * The step charts for a run that is going, and the phase band under them.
 *
 * **Per batch, not per epoch.** The epoch charts above fill in once a minute or once an
 * hour; this is the view somebody watches, and it moves every few seconds. The x axis is
 * the step within the attempt rather than the clock, because `at` is the worker's own
 * clock and is good for ordering and duration and nothing else.
 *
 * **Grouped by attempt, because a retry restarts the step counter at 1.** Drawn as one
 * series, a second attempt walks backwards through the first and reads as the loss
 * collapsing. Each attempt gets its own line.
 *
 * @param {Object[]} samples - Every sample held for this run, oldest first.
 * @returns {string}
 */
function stepCharts(samples) {
  if (!samples.length) return '';

  const attempts = [...new Set(samples.map((one) => one.attempt_id))];
  const training = samples.filter((one) => one.phase === 'training_batch');
  const latest = samples[samples.length - 1];

  /* What this run actually reports. A chart nobody sent a key for is not drawn, which is
     how one panel serves detection and classification without being told which it is. */
  const present = STEP_CHARTS.filter((spec) => samples
    .some((one) => one.metrics && one.metrics[spec.key] !== undefined && one.metrics[spec.key] !== null));

  if (!present.length) return '';

  const theme = chartTheme();
  const digits = (spec) => (spec.scale ? 2 : 3);

  const cards = present.map((spec) => {
    /* One line per attempt, at the step it reported: a strided first read has uneven
       steps, and placing each point at its own step keeps the shape true.

       **Only the samples that carry this key** (#295). A phase marker has no loss, and
       read as a null it split the series into lone readings between gaps, which a line
       with no symbols draws as nothing: job 21956 stored 100 losses over 102 epochs and
       every chart was blank. */
    const lines = attempts.map((attemptId, index) => {
      const points = training
        .filter((one) => one.attempt_id === attemptId && one.metrics
          && one.metrics[spec.key] !== null && one.metrics[spec.key] !== undefined)
        .map((one) => [one.step, Number(one.metrics[spec.key]) / (spec.scale || 1)]);

      return { attemptId, points, index };
    });

    const every = lines.flatMap((line) => line.points.map((point) => point[1])).filter((value) => value !== null);

    if (!every.length) return '';

    const last = [...lines[lines.length - 1].points].reverse()
      .map((point) => point[1])
      .find((value) => value !== null && value !== undefined);

    const option = {
      grid: { left: 46, right: 18, top: attempts.length > 1 ? 40 : 30, bottom: 36 },
      legend: { ...theme.legend, show: attempts.length > 1 },
      xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', name: 'Step', nameLocation: 'middle', nameGap: 24, ...theme.axis },
      yAxis: { type: 'value', min: 0, ...theme.axis },
      tooltip: { ...theme.tooltip, valueFormatter: (value) => (value === null || value === undefined ? 'not reported' : `${Number(value).toFixed(digits(spec))}${spec.unit}`) },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
      /* **Each reading is a point while they are few**, so one reading, or one an epoch,
         is visible rather than a line too short to draw (#295). */
      series: lines.map((line) => {
        const { color } = chartKey(`class-${(line.index % 4) + 1}`);
        return {
          id: `attempt-${line.attemptId}`, name: attempts.length > 1 ? `Attempt ${line.index + 1}` : spec.title,
          type: 'line', data: line.points, connectNulls: false,
          showSymbol: line.points.length <= STEP_POINTS_SHOWN, symbol: 'circle', symbolSize: 4,
          lineStyle: { color, width: 1.6 }, itemStyle: { color },
        };
      }),
    };

    return '<article class="evaluation-card history-card">'
      + `<header><div><h5>${spec.title}</h5><p>Per batch`
      + `${last === undefined ? '' : ` &middot; now ${Number(last).toFixed(digits(spec))}${spec.unit}`}`
      + `${attempts.length > 1 ? ` &middot; ${attempts.length} attempts` : ''}</p></div></header>`
      + `${chartSlot(option, `${spec.title} per batch`, { key: `steps-${attempts.join('-')}-${spec.key}` })}</article>`;
  }).join('');

  /* **The phase as a band rather than a number**, because caching has no count: the
     trainer gives no callback while it reads images, so how far through it is cannot be
     known. What it is doing can. */
  const phase = latest.phase === 'validating_batch' ? 'Validating' : 'Training';
  const where = latest.epoch
    ? `epoch ${latest.epoch}${latest.batch ? `, batch ${latest.batch}${latest.batches_total ? ` of ${latest.batches_total}` : ''}` : ''}`
    : '';

  return '<div class="sect step-charts"><h3>While it runs'
    + `<span class="st" data-state="running"><span class="dot"></span>${phase}${where ? ` &middot; ${where}` : ''}</span></h3>`
    + `<div class="curve-grid">${cards}</div></div>`;
}

/* ------------------------------------------------------------------------------------
   Charts, drawn by Apache ECharts (docs/decisions/0001, #275).

   **A chart is a slot in the markup and an option held here.** Every screen builds its
   panels as HTML strings and inserts them later, so a chart cannot be drawn where the
   string is built -- there is no element yet. `chartSlot` returns the slot and keeps the
   option; one observer on the document draws any slot the moment it lands, wherever it
   was inserted from, and disposes the chart when its slot is taken away again.
   ------------------------------------------------------------------------------------ */

/** Options waiting for their slot to be inserted, by slot id. @type {Map<string, Object>} */
const CHART_OPTIONS = new Map();

let chartSeq = 0;

/**
 * Decode an HTML-escaped label, because ECharts writes text, not markup.
 *
 * @param {string} html - A label as the screens write it, `mAP@50&ndash;95`.
 * @returns {string}
 */
function chartText(html) {
  const holder = document.createElement('textarea');
  holder.innerHTML = String(html);
  return holder.value;
}

/**
 * A series' colour and dash, from the CSS key the hand-drawn charts used.
 *
 * **Read from the stylesheet rather than repeated here**, so `.box-loss` is cyan and dashed
 * in exactly one place and a legend swatch elsewhere cannot disagree with the line.
 *
 * @param {string} key - A series class such as `box-loss`.
 * @param {Element} [within] - The panel the key is scoped to, when it is.
 * @returns {{color: string, dash: number[]|null, fill: string|null}}
 */
function chartKey(key, within) {
  const probe = document.createElement('span');
  probe.className = key;
  probe.hidden = true;
  /* Inside the panel when given one: some keys are scoped to their panel, as
     `.training-health .queued` is, and a probe on the body would not match them. */
  (within || document.body).appendChild(probe);
  const style = getComputedStyle(probe);
  /* `--key` where the panel uses the shared vocabulary; the stroke or fill where it
     styled its paths directly, as the Dashboard's pool chart does. */
  const painted = (value) => (value && value !== 'none' ? value : '');
  const color = style.getPropertyValue('--key').trim() || painted(style.stroke) || painted(style.fill);
  let on = parseFloat(style.getPropertyValue('--dash-on'));
  let off = parseFloat(style.getPropertyValue('--dash-off'));
  if (!(on > 0) && style.strokeDasharray && style.strokeDasharray !== 'none') {
    [on, off] = style.strokeDasharray.split(/[ ,]+/).map(parseFloat);
  }
  const fill = style.getPropertyValue('--fill').trim() || painted(style.fill);
  probe.remove();
  /* A zero gap is a solid line, which is how a panel says "not dashed". */
  return { color: color || '#64f6f2', dash: on > 0 && off > 0 ? [on, off] : null, fill: fill || null };
}

/**
 * The MARP theme, as the pieces of an ECharts option.
 *
 * @returns {Object} `{text, axis, tooltip, legend, toolbox}`.
 */
function chartTheme() {
  const root = getComputedStyle(document.documentElement);
  const token = (name, fallback) => root.getPropertyValue(name).trim() || fallback;
  const text = token('--text', '#c7d4dd');
  const muted = token('--muted', '#8198a8');
  const line = token('--hairline', 'rgba(42, 214, 220, 0.11)');
  const font = token('--body-font', 'sans-serif');

  return {
    text: { color: text, fontFamily: font },
    axis: {
      axisLine: { lineStyle: { color: line } },
      axisTick: { lineStyle: { color: line } },
      axisLabel: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: line } },
      nameTextStyle: { color: muted, fontSize: 10 },
    },
    /* **On the page, not in the card.** The card clips what overflows it, so a tooltip
       drawn inside it was cut off at the chart's edge -- Isaac found it on the Loss chart.
       Attached to the body it floats over whatever is beside the chart. */
    tooltip: {
      trigger: 'axis',
      appendTo: 'body',
      backgroundColor: token('--navy-900', '#03101f'),
      borderColor: token('--border', 'rgba(42, 214, 220, 0.28)'),
      textStyle: { color: text, fontSize: 12 },
    },
    /* `right` leaves room for the toolbox, so a legend that wraps on a narrow card wraps
       before the zoom icons rather than under them. */
    legend: { top: 0, left: 0, right: 72, textStyle: { color: text, fontSize: 10 }, itemWidth: 18, itemHeight: 8, inactiveColor: muted },
    toolbox: {
      right: 0, top: 0, itemSize: 13, iconStyle: { borderColor: muted },
      feature: { dataZoom: { title: { zoom: 'Drag to zoom', back: 'Undo zoom' } }, restore: { title: 'Reset zoom' } },
    },
  };
}

/** Where somebody had zoomed each named chart, kept across a redraw. @type {Map<string, Object[]>} */
const CHART_ZOOM = new Map();

/**
 * A slot for a chart, to put into a panel's markup.
 *
 * **A name keeps the zoom.** A live run's panel is redrawn every few seconds, which
 * replaces its charts; a chart given a `key` that is stable across those redraws -- the
 * run and the series, say -- comes back at the zoom it was left at instead of resetting
 * under the person reading it.
 *
 * @param {Object} option - The ECharts option, without the theme.
 * @param {string} label - What the chart shows, for a screen reader.
 * @param {Object} [how] - `{key, height, bare}`. `key` is a name that stays the same across
 *   redraws of this chart; `height` is pixels, for a chart whose height follows its data;
 *   `bare` is for a chart going into a box that already has the frame and the label.
 * @returns {string} The slot's HTML.
 */
function chartSlot(option, label, how = {}) {
  const { key, height, bare } = how;
  chartSeq += 1;
  const id = `chart-${chartSeq}`;
  CHART_OPTIONS.set(id, option);
  return `<div class="${bare ? 'marp-chart bare' : 'result-chart marp-chart'}" data-chart="${id}"`
    + `${key ? ` data-chart-key="${escapeHtml(key)}"` : ''}${height ? ` style="height:${Math.round(height)}px"` : ''}`
    + `${bare ? '' : ` role="img" aria-label="${escapeHtml(label)}"`}></div>`;
}

/**
 * What a confusion-matrix cell says, in one of its two readings.
 *
 * A share of 100% over two instances and over two thousand look identical, which is why
 * both are offered: the share by default, the count one press away.
 *
 * @param {string} mode - `norm` or `count`.
 * @returns {Function} An ECharts label formatter.
 */
function matrixLabel(mode) {
  return mode === 'count'
    ? (item) => item.value[3].toLocaleString('en-US')
    : (item) => `${Math.round(item.value[2] * 100)}%`;
}

/**
 * Draw every chart slot under `root` that has not been drawn.
 *
 * **The slot keeps its option** after drawing (`el.marpOption`), which is what a test reads
 * to ask what a chart was given, alongside the SVG ECharts drew.
 *
 * @param {Element|Document} root - Where to look.
 * @returns {void}
 */
function mountCharts(root) {
  if (!window.echarts || !root.querySelectorAll) return;
  const slots = root.matches && root.matches('[data-chart]') ? [root] : [];
  slots.push(...root.querySelectorAll('[data-chart]'));

  for (const el of slots) {
    /* From the slot itself when it has been drawn before: a row the Jobs cards reorder is
       taken out and put back, which releases its chart and has to draw it again. */
    const option = el.marpOption || CHART_OPTIONS.get(el.dataset.chart);
    if (!option || el.marpChart) continue;
    CHART_OPTIONS.delete(el.dataset.chart);

    /* **A size even when the slot has none yet.** A chart in a collapsed row has no width
       until the row opens; drawn at a nominal size now, it is resized to the real one by
       the observer below the moment it has one. */
    const theme = chartTheme();
    const chart = window.echarts.init(el, null, {
      renderer: 'svg', width: el.clientWidth || 640, height: el.clientHeight || 220,
    });
    chart.setOption({ animation: false, textStyle: theme.text, tooltip: theme.tooltip, legend: theme.legend, toolbox: theme.toolbox, ...option });
    el.marpChart = chart;
    el.marpOption = option;

    const zoom = el.dataset.chartKey && CHART_ZOOM.get(el.dataset.chartKey);
    if (zoom) {
      zoom.forEach((one, index) => chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: index, start: one.start, end: one.end }));
    }

    if (window.ResizeObserver) {
      el.marpResize = new ResizeObserver(() => {
        if (el.clientWidth) chart.resize({ width: el.clientWidth, height: el.clientHeight || 220 });
      });
      el.marpResize.observe(el);
    }
  }
}

/**
 * Let go of the charts under a node that has left the page.
 *
 * @param {Node} node - What was removed.
 * @returns {void}
 */
function releaseCharts(node) {
  if (!node.querySelectorAll) return;
  const slots = node.matches && node.matches('[data-chart]') ? [node] : [];
  slots.push(...node.querySelectorAll('[data-chart]'));
  for (const el of slots) {
    if (el.marpResize) el.marpResize.disconnect();
    if (el.marpChart) {
      if (el.dataset.chartKey) {
        const zoom = (el.marpChart.getOption().dataZoom || []).map((one) => ({ start: one.start, end: one.end }));
        CHART_ZOOM.set(el.dataset.chartKey, zoom);
      }
      el.marpChart.dispose();
    }
    el.marpChart = null;
  }
}

/* One observer for the whole document: a slot is drawn when it arrives and released when
   it goes, whichever screen put it there. */
if (typeof MutationObserver !== 'undefined' && document.body) {
  new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach(releaseCharts);
      record.addedNodes.forEach(mountCharts);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/**
 * One chart of several series over the epochs.
 *
 * Drawn by ECharts through `chartSlot`, with each series' colour and dash taken from its
 * existing CSS key, so the vocabulary is the one the hand-drawn version used (#275).
 *
 * @param {Object} spec - `{title, note, max, top, mid, series}`.
 * @param {Object[]} epochs - The run's epochs, earliest first.
 * @returns {string} An `<article>`, or an empty state when nothing was measured.
 */
function epochChart(spec, epochs) {
  const drawn = spec.series
    .map(([key, label, column]) => {
      const values = epochs.map((epoch) => (epoch[column] === null || epoch[column] === undefined
        ? null : Number(epoch[column])));
      const measured = values.filter((v) => v !== null).length;

      return { key, label, column, values, measured };
    });

  /* A chart whose every series is empty is a frame around nothing. The panel says which
     columns are missing instead, because *that* is the useful fact while the worker is
     still being taught to report them. */
  if (!drawn.some((one) => one.measured)) {
    /* The note goes on the empty card too. It says what these series *are* -- validation
       rather than train, say -- and that is as worth knowing when the chart is waiting as
       when it is drawn. */
    return `<article class="evaluation-card history-card"><header><div><h5>${spec.title}</h5>`
      + `<p>Not reported for this run: ${drawn.map((one) => one.label.toLowerCase()).join(', ')}`
      + `${spec.note ? ` &middot; ${spec.note}` : ''}</p>`
      + '</div></header></article>';
  }

  /* **An axis that fits the data, where the data has no ceiling of its own.** A YOLO class
     loss routinely starts far above where it settles, and an axis scaled to that first
     epoch flattens every other line along the bottom. So the chart opens zoomed to where
     the run settled, and the first epoch is still there: the line leaves the top of the
     chart rather than being cut or pinned to it, and Reset zoom shows its full height.

     Quality keeps its fixed 1: precision, recall and mAP are 0 to 1 by definition, and a
     fixed axis is what lets two runs be compared by eye. */
  const ceiling = spec.max === 'auto'
    ? autoCeiling(drawn, epochs.length)
    : { max: spec.max, clipped: [] };

  const shown = drawn.filter((one) => one.measured);
  const missing = drawn.filter((one) => !one.measured);
  const first = epochs.length ? epochs[0].epoch_number : 0;
  const theme = chartTheme();

  const option = {
    grid: { left: 42, right: 18, top: 40, bottom: 36 },
    xAxis: {
      type: 'category', data: epochs.map((epoch) => epoch.epoch_number), boundaryGap: false,
      name: 'Epoch', nameLocation: 'middle', nameGap: 24, ...theme.axis,
    },
    yAxis: {
      type: 'value', min: 0, max: spec.max === 'auto' ? undefined : spec.max, ...theme.axis,
      /* Zoomed, the window's top is an arbitrary number that crowds the tick below it. */
      axisLabel: { ...theme.axis.axisLabel, showMaxLabel: !ceiling.clipped.length },
    },
    tooltip: { ...theme.tooltip, valueFormatter: (value) => (value === null || value === undefined ? 'not reported' : Number(value).toFixed(3)) },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      ...(ceiling.clipped.length
        ? [{ type: 'inside', yAxisIndex: 0, filterMode: 'none', startValue: 0, endValue: ceiling.max, zoomOnMouseWheel: false, moveOnMouseMove: false }]
        : []),
    ],
    /* A missing epoch stays null, so the line breaks there rather than dropping to zero. */
    series: shown.map((one) => {
      const { color, dash } = chartKey(one.key);
      return {
        id: one.key, name: chartText(one.label), type: 'line', data: one.values,
        connectNulls: false, symbolSize: 5, lineStyle: { color, width: 2, type: dash || 'solid' }, itemStyle: { color },
      };
    }),
  };

  /* The note carries the scale decision, because the zoom it opens at is a choice made
     here and a reader should know there is more above it. */
  const said = ceiling.clipped.map((one) => `${one.label.toLowerCase()} ${one.value.toFixed(2)}`).join(', ');
  const notes = [spec.note];
  if (said) {
    notes.push(`zoomed to epoch ${epochs[1] ? epochs[1].epoch_number : 2} onward, because epoch ${first} `
      + `starts above it (${escapeHtml(said)}); Reset zoom shows all of it`);
  }
  if (missing.length) notes.push(`not reported for this run: ${missing.map((one) => one.label.toLowerCase()).join(', ')}`);

  const label = said
    ? `${spec.title} by epoch, zoomed past epoch ${first}, which reached ${said}`
    : `${spec.title} by epoch`;

  return `<article class="evaluation-card history-card"><header><div><h5>${spec.title}</h5>`
    + `<p>${notes.filter(Boolean).join(' &middot; ')}</p></div></header>`
    + `${chartSlot(option, chartText(label), { key: epochs.length ? `epochs-${epochs[0].training_run_id}-${spec.title}` : '' })}</article>`;
}

/**
 * What a training job is training, and what that task's panel shows.
 *
 * **Keyed by task so a second one is a list of series rather than a component.** Every run
 * today is detection, which makes it tempting to hard-code box/class/DFL loss and mAP@50 --
 * and then classification arrives with top-1 and top-5 and no boxes, and segmentation with
 * mask metrics beside box metrics, and the panel has to be taken apart. Adding either is an
 * entry here.
 *
 * **Not built, and saying so rather than drawing nothing.** `classification` and
 * `segmentation` are named with no charts because nobody has described what their panels
 * show. A run of either renders the sections it shares and one sentence about the rest,
 * which is a gap a reader can see instead of a blank.
 *
 * @type {Object}
 */
const TRAINING_TASKS = {
  detection: {
    label: 'Detection',
    charts: [
      {
        /* **Both splits now, which is the question this chart is actually asked.** Until
           `ea964f18` the worker sent only `val/*` and this said so; the train trio exists
           beside it now, so the gap between the pairs -- the overfitting signal -- is
           readable here instead of being a thing the panel admitted it could not show. */
        title: 'Loss',
        note: 'Lower is better &middot; solid is train, dashed is validation &middot; the gap between a pair is the overfitting signal',
        max: 'auto',
        series: [
          ['box-loss-train', 'Box (train)', 'train_box_loss'],
          ['box-loss', 'Box (val)', 'box_loss'],
          ['cls-loss-train', 'Class (train)', 'train_cls_loss'],
          ['cls-loss', 'Class (val)', 'cls_loss'],
          ['dfl-loss-train', 'DFL (train)', 'train_dfl_loss'],
          ['dfl-loss', 'DFL (val)', 'dfl_loss'],
        ],
      },
      {
        title: 'Validation quality',
        note: 'Higher is better &middot; held-out split',
        max: 1,
        top: '1.0',
        mid: '.5',
        series: [['precision', 'Precision', 'precision'], ['recall', 'Recall', 'recall'], ['map', 'mAP@50', 'map50'], ['map95', 'mAP@50&ndash;95', 'map5095']],
      },
    ],
    sections: ['matrix', 'classes', 'curves', 'files'],
    headline: { label: 'Best mAP@50', from: 'map50', note: 'across reported epochs' },
  },
  classification: {
    label: 'Classification',
    charts: [],
    /* **Not "nobody has described it".** It is described, off a real two-epoch run the
       worker session captured, and it cannot be stored. Every per-epoch key a classify
       run produces is `train/loss`, `val/loss`, `metrics/accuracy_top1` and
       `metrics/accuracy_top5`, plus the three the worker adds for every task.

       **This said "no validation loss at all" for a few hours, and that was wrong.** The
       first probe ran one epoch and kept the last callback; at `epochs=1` the callback
       fires twice, and the second comes after `final_eval()`, which runs the validator
       without a trainer and so has no loss accumulator to report a validation loss
       against. Absent from the call that was kept became absent from the task. The extra
       call never reaches MARP -- the engine's epoch guard drops it rather than counting
       it as an epoch.

       Worth keeping because it is the lesson one level up from the one this file already
       carries: reading the literal keys off the trainer rather than off a description is
       necessary and **not sufficient**. A capture that keeps the wrong call produces a
       confident falsehood with evidence attached, which is harder to doubt than a guess.

       So: a loss **pair**, the same shape as detection with one pair instead of three,
       and the real train/validation gap to draw once there are columns. `epochs` has no
       accuracy columns, and `train/loss` is its own quantity -- not `cls_loss`, which is
       the classification *component* of a detector's loss and shares only a word. Both
       are schema questions, raised with the sessions that own them rather than guessed;
       a chart pointed at a column name invented here would look built and render
       nothing. */
    chartsWaiting: 'A classification run reports a training and a validation loss each '
      + 'epoch, with top-1 and top-5 accuracy. <code>epochs</code> has no accuracy columns, '
      + 'and none of its loss columns is the one a classifier reports &mdash; so none of it '
      + 'can be recorded yet. The final accuracy is below.',
    /* **No `classes` and no `curves`, rather than empty ones.** `ClassifyMetrics` has no
       per-class array and no thresholds at all, so a section saying "this run recorded
       none" would read as a run that failed to measure something instead of a task with
       no such measurement. A section that does not apply does not appear. */
    sections: ['matrix', 'files'],
    headline: { label: 'Top-1 accuracy', from: 'accuracy_top1', note: 'at the end of the run' },
  },
  segmentation: {
    label: 'Segmentation',
    charts: [],
    sections: ['matrix', 'classes', 'curves', 'files'],
    headline: { label: 'Best mAP@50', from: 'map50', note: 'across reported epochs' },
  },
};

/**
 * When a job last showed a sign of life.
 *
 * **`gpu_jobs.updated_at` is not it while a job runs.** For job 21782 it sat at the
 * instant the job was created while the worker heartbeated every sixty seconds and
 * progress advanced -- nothing on the heartbeat path touches the job row. So an Updated
 * column reading `updated_at` alone is faithfully showing a stale timestamp, which is
 * the opposite of the Datasets defect: there the value moved and the patch ignored it.
 *
 * **The fix is not to write `updated_at` on every heartbeat.** That is a write per
 * running job per minute, and `updated_at` moving is exactly what reshuffled rows in
 * heap order and closed expanded rows on Datasets. Taking the later of the two costs
 * nothing and reshuffles nothing.
 *
 * `last_heartbeat_at` is not in the job list payload yet -- `listJobs` joins the latest
 * attempt for its progress columns and does not select it. This reads it defensively so
 * the column is right the moment it is added, and unchanged until then.
 *
 * @param {Object} job - From `GET /gpu/jobs`.
 * @returns {string|null} An ISO instant, or null if the job carries neither.
 */
function jobLastSeen(job) {
  const candidates = [job.updated_at, job.last_heartbeat_at]
    .filter(Boolean)
    .map((iso) => [iso, Date.parse(iso)])
    .filter(([, ms]) => Number.isFinite(ms));

  if (!candidates.length) return null;

  return candidates.reduce((latest, one) => (one[1] > latest[1] ? one : latest))[0];
}

/**
 * Which task a training job is for.
 *
 * **From the base model, because the checkpoint decides the task.** A detection `.pt`
 * selected for a segmentation run trains a detector; the engine is never told which task
 * was asked for, which is why `trainingSubmission` refuses a mismatch rather than trusting
 * the form. So the model's own `model_type` is the answer, and it is read rather than
 * inferred from which metric columns happen to be null.
 *
 * **Not the Task column the Datasets screen lost.** That one was a dataset's task, a field
 * `Dataset` has never had -- Isaac: *"it'll never have a value"*. This is `ml_models.model_type`,
 * which exists, is required, and genuinely varies. Same word, different column.
 *
 * @param {Object} job - The training job.
 * @returns {string|null} A key into `TRAINING_TASKS`, or null when the model is unknown.
 */
function trainingTaskOf(job) {
  const id = job && job.spec && job.spec.model && job.spec.model.ml_model_id;
  const model = trainingModelsById.get(Number(id));
  const task = String((model && model.model_type) || '').trim().toLowerCase();

  return TRAINING_TASKS[task] ? task : null;
}

/**
 * A name with its id kept reachable.
 *
 * **Both, because both are used.** The row printed `Dataset 384` where the spec was
 * carrying `CookieStarTest` all along -- it reached past the name to the id. But the ids
 * are what Isaac works in and what gets quoted between sessions, so the name is the label
 * and the id is beside it, small, rather than one replacing the other.
 *
 * An older job whose spec has no name falls back to the id alone, which is honest; a blank
 * cell would not be.
 *
 * @param {string} noun - What the id names, for the fallback.
 * @param {Object} from - `spec.dataset` or `spec.model`.
 * @param {number|string} id - The id.
 * @param {string} [href] - Where the name should link, if anywhere.
 * @returns {string}
 */
function namedById(noun, from, id, href) {
  if (id === null || id === undefined || id === '') return NO_RUN_RECORDED;

  const name = from && typeof from.name === 'string' ? from.name.trim() : '';
  const small = `<span class="b mono" title="${noun} id">${id}</span>`;

  if (!name) {
    /* No name in the spec -- older jobs predate it being carried. The id alone says what
       it can, which is more than an empty cell. */
    return `<span class="two"><span class="a">${noun} ${id}</span></span>`;
  }

  const label = href
    ? `<a href="${href}" title="${escapeHtml(name)}">${escapeHtml(name)}</a>`
    : escapeHtml(name);

  return `<span class="two"><span class="a">${label}</span>${small}</span>`;
}

/**
 * Whether the run being drawn has finished. Set once per panel, read by the sections.
 *
 * A module-level flag rather than a parameter threaded through five renderers: they are
 * called in one place, one at a time, and the alternative was five signatures changed to
 * carry one boolean.
 */
let runHasFinished = false;

/**
 * A section of the run panel with nothing to draw.
 *
 * **Nothing, when the run has finished.** Each of these used to be a paragraph explaining
 * how the trainer and the worker work -- and on an older run, which will never have
 * artifacts, that was four paragraphs of mechanism stacked under each other saying only
 * that there was nothing to see. Isaac, reading it: *"that just seems to be a bunch of
 * messy filler for no reason"*. He is right: a section with no data on a finished run is
 * not news, and the honest rendering of nothing is nothing.
 *
 * **One short line while a run is still going**, because there the absence is temporary
 * and a reader is waiting for it. No mechanism, no internals, no naming of who publishes
 * what -- that belonged in the comments here all along, not on the screen.
 *
 * @param {string} title - What the section would show.
 * @returns {string} The card, or an empty string.
 */
function runSectionWaiting(title) {
  if (runHasFinished) return '';

  return `<article class="evaluation-card history-card"><header><div><h5>${title}</h5>`
    + '<p>Available when training finishes.</p></div></header></article>';
}

/**
 * The confusion matrix, drawn from numbers if MARP has them.
 *
 * **Numbers rather than the Ultralytics PNG, where there is a choice.** That render is a
 * white-background image: it would sit wrong on this page, could not be hovered for a
 * count, and could not be read at the size this panel gives it. A matrix MARP carries as
 * numbers is one this can make legible. The image is the fallback, not the target.
 *
 * @param {Object|null} matrix - `{labels, rows}` when MARP has one, else null.
 * @param {string|null} image - A URL to the rendered matrix, when that is all there is.
 * @returns {string}
 */
function confusionMatrix(matrix, image, raw = []) {
  /* One small link rather than two download tiles in the gallery. It sits here because
     this is where somebody doubting a number is looking when they want to check it
     against what the worker actually sent. */
  const source = raw.length
    ? `<p class="raw-metrics">${raw.map((file) => `<a href="${escapeHtml(file.url)}" download>`
      + `${file.name === 'metrics_curves' ? 'Raw curves' : 'Raw metrics'}</a>`).join('')}</p>`
    : '';

  if (matrix && Array.isArray(matrix.labels) && Array.isArray(matrix.rows)) {
    const total = (row) => row.reduce((sum, n) => sum + (Number(n) || 0), 0);

    /* **One fallback for both axes.** A label can come back null where the stored
       vocabulary was shorter than the matrix, and the rows named those `Class 3` while
       the columns left the header blank -- the same axis, labelled two ways, which reads
       as the column having no name rather than as MARP not knowing it. */
    const names = matrix.rows.map((_, index) => String(matrix.labels[index] ?? `Class ${index}`));

    /* Each cell as [predicted, true, share of its true class, count]. The share drives the
       colour in both readings, because a count's shade would follow class size instead of
       how often the model got that class right. */
    const cells = matrix.rows.flatMap((row, r) => {
      const sum = total(row);
      return row.map((value, c) => {
        const count = Number(value) || 0;
        return [c, r, sum ? count / sum : 0, count];
      });
    });

    const theme = chartTheme();
    const heat = chartKey('class-1').color;
    const option = {
      grid: { left: 96, right: 16, top: 12, bottom: 56 },
      /* **The axes are named in words on the chart, not only in the caption.** True and
         Predicted is the one thing a reader has to have right, and a confusion matrix
         read the wrong way round is completely plausible while asserting the reverse of
         what happened. The API transposes Ultralytics' own `matrix[predicted][true]` once
         on the way out so that rows are true here, and this says so where it is read. */
      xAxis: { type: 'category', data: names, name: 'Predicted class', nameLocation: 'middle', nameGap: 36, ...theme.axis, splitLine: { show: false } },
      yAxis: { type: 'category', data: names, inverse: true, name: 'True class', nameLocation: 'middle', nameGap: 82, ...theme.axis, splitLine: { show: false } },
      visualMap: { show: false, dimension: 2, min: 0, max: 1, inRange: { color: ['rgba(1, 6, 14, 0.5)', heat] } },
      legend: { show: false },
      toolbox: { ...theme.toolbox, show: names.length > 8 },
      tooltip: {
        ...theme.tooltip, trigger: 'item',
        formatter: (item) => `${escapeHtml(names[item.value[1]])} predicted as ${escapeHtml(names[item.value[0]])}: `
          + `${item.value[3].toLocaleString('en-US')} (${Math.round(item.value[2] * 100)}% of ${escapeHtml(names[item.value[1]])})`,
      },
      /* Zoom only where there are enough classes to need it. */
      dataZoom: names.length > 8 ? [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }] : [],
      series: [{
        id: 'matrix', type: 'heatmap', data: cells,
        label: { show: true, color: theme.text.color, fontSize: 10, fontWeight: 700, formatter: matrixLabel('norm') },
        itemStyle: { borderColor: 'rgba(1, 6, 14, 0.9)', borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: chartKey('curve-mean').color } },
      }],
    };

    const split = matrix.dataset_split ? ` &middot; ${escapeHtml(matrix.dataset_split)} split` : '';

    return '<article class="evaluation-card matrix-card" data-matrix><header><div><h5>Confusion matrix</h5>'
      /* **The note is here because the comparison is made here.** Run 207's matrix gives
         571 of 710 found, a recall of 0.804, where the per-class table beside it reports
         0.735 for the same class. Neither is wrong: the trainer builds its matrix at a
         fixed confidence and takes the table's recall at the confidence where mean F1
         peaks. A reader who checks one against the other finds a seven-point gap and
         reasonably concludes something is broken, which is the only reason this sentence
         is on a screen at all -- it is the per-class table's shared-threshold caveat,
         where the other half of the comparison is. */
      + `<p>Rows are the true class; columns are what the model predicted${split}`
      + ' &middot; counted at a fixed confidence, so recall here and in the table below differ</p></div>'
      + '<div class="seg matrix-modes" aria-label="Confusion matrix values">'
      + '<button type="button" class="on" data-matrix-mode="norm" aria-pressed="true" '
      + 'title="Each cell as a share of its true class">Normalised</button>'
      + '<button type="button" data-matrix-mode="count" aria-pressed="false" '
      + 'title="The instance counts the trainer recorded">Counts</button></div></header>'
      + chartSlot(option, `Confusion matrix over ${names.length} classes, rows true and columns predicted`,
        { height: Math.max(230, names.length * 40 + 80) })
      + `${source}</article>`;
  }

  if (image) {
    /* **Shown as what it is: a render, not a reading.** It cannot be hovered for a count
       and it carries its own white background, so it is labelled rather than dressed up
       as part of the page. */
    return '<article class="evaluation-card"><header><div><h5>Confusion matrix</h5>'
      + '<p>As the trainer rendered it &mdash; MARP does not carry the counts</p></div></header>'
      + `<div class="result-plot"><img src="${escapeHtml(image)}" alt="Confusion matrix rendered by the trainer" loading="lazy"></div>${source}</article>`;
  }

  return runSectionWaiting('Confusion matrix');
}

/**
 * Per-class quality, one table per metric family.
 *
 * **A family, not a split, is what makes a row unique.** A segmentation run reports `box`
 * and `mask` for the same class — the same four metric names twice — so a table keyed on
 * class alone would silently show one and drop the other, or interleave them. Grouping
 * here means segmentation arrives as a second table rather than a rewrite. Today every
 * row is `box`, so there is one table and no heading noise.
 *
 * **Three kinds of row, and they are not interchangeable:**
 *
 * - a class MARP resolved to a species: `species_id` and `class_name` both set;
 * - a class it could not resolve: `species_id` null, `class_name` set. Shown under the
 *   name the model used, because dropping it would hide a class the model is predicting;
 * - the all-classes aggregate: `class_name` null. Pulled out and shown apart, because
 *   listing it among the classes makes it look like one of them.
 *
 * @param {Object[]} classes - `metrics_summary` rows for this run, or empty.
 * @returns {string}
 */
function perClassTable(classes) {
  if (!classes.length) {
    /* **"Recorded none" rather than "not yet", because an empty answer is an answer.**
       The API session settled that a final-metrics report with no `metrics` block is
       empty-but-valid -- a run that scored nothing -- so for a finished run this section
       is not waiting for anything. Saying *they reach here when the worker publishes*
       about a settled result is the stale-text defect this screen keeps producing: true
       while a run is going, and a small lie the moment it has stopped. */
    return runSectionWaiting('Per-class quality');
  }

  const cell = (value) => (value === null || value === undefined
    ? '<span class="dash" title="Not reported">&mdash;</span>'
    : Number(value).toFixed(3));

  const count = (value) => (value === null || value === undefined
    ? '<span class="dash" title="The trainer reported no count. Not the same as counting none.">&mdash;</span>'
    : Number(value).toLocaleString('en-US'));

  /* **Support and images come before the scores, because they qualify them.** A precision
     of 1.000 over three instances and one over three thousand render identically without
     them, and on a survey whose point is the rare species that is the difference between
     a number somebody acts on and a number that misleads them. Reading left to right, the
     size of the sample arrives before the claim about it.

     `support` is labelled instances; `image_count` is how many frames held them. 142
     instances across 37 frames is a shoal, across 140 a scatter, and the scores cannot
     tell those apart. */
  const columns = [['Precision', 'precision'], ['Recall', 'recall'], ['F1', 'f1_score'],
    ['AP@50', 'map50'], ['AP@50&ndash;95', 'map5095']];
  const counts = [
    ['Support', 'support', 'Labelled instances of this class in the evaluated split'],
    ['Images', 'image_count', 'How many frames contained it'],
  ];

  /**
   * What a family is called where a reader sees it.
   *
   * **`seg`, not `mask`.** `SegmentMetrics.seg` is Ultralytics' own name for it; `(M)`
   * is only the suffix on the metric keys. An unlisted family falls through to its own
   * key below, so a wrong guess here would have shown up as a heading reading "seg"
   * rather than as a dropped table -- but it would have shown up on the first
   * segmentation run and nowhere before it.
   *
   * Classification is deliberately absent: it reports top-1 and top-5 and no per-class
   * array at all, so it never arrives as rows of this shape.
   */
  const FAMILY = { box: 'Box', seg: 'Segmentation' };

  const families = new Map();

  for (const row of classes) {
    const family = row.metric_family || 'box';

    if (!families.has(family)) families.set(family, []);
    families.get(family).push(row);
  }

  const tableFor = (family, rows) => {
    /* The aggregate is the row with no class name. It is a different quantity from the
       classes above it and reads as one of them if it is left in the list. */
    const overall = rows.find((row) => !row.class_name);
    /* **Worst AP first, which is the question this table is actually asked.** Nobody
       scans a species list alphabetically to find what the model is bad at, and the
       sorted bar is the form the field uses for exactly that. A class with no AP sorts
       last rather than first: not measured is not the same as measured badly, and
       putting it at the top would answer the question wrongly. */
    const score = (row) => (row.map50 === null || row.map50 === undefined
      ? Number.POSITIVE_INFINITY : Number(row.map50));
    const named = rows.filter((row) => row.class_name)
      .sort((a, b) => score(a) - score(b) || String(a.class_name).localeCompare(String(b.class_name)));

    const body = named.map((row) => {
      const label = escapeHtml(row.class_name);
      /* A class the model predicted and MARP could not place. Worth seeing, and worth
         marking: it means the species lookup found nothing, not that the class is odd. */
      const unresolved = row.species_id === null || row.species_id === undefined
        ? ' <span class="faint" title="MARP could not resolve this class to a species">unmatched</span>'
        : '';

      /* **Attribution, not a warning.** Flagging "low support" would need a cutoff, and
         any cutoff here would be mine rather than MARP's -- on a survey whose point is
         the rare species, an invented threshold is the kind of confident fiction this
         screen keeps having removed. So every score says what it rests on instead: a
         precision of 1.000 over 3 instances reads as exactly that when you ask it, and
         the reader draws their own line. */
      const over = row.support === null || row.support === undefined
        ? ''
        : ` title="over ${Number(row.support).toLocaleString('en-US')} labelled instance${Number(row.support) === 1 ? '' : 's'}"`;

      return `<tr><th scope="row">${label}${unresolved}</th>`
        + counts.map(([, key]) => `<td class="num">${count(row[key])}</td>`).join('')
        /* The AP@50 cell carries its own bar, so the column reads as a ranking at a
           glance rather than as five decimals to compare by eye. */
        + columns.map(([, key]) => (key === 'map50' && row[key] !== null && row[key] !== undefined
          ? `<td class="apcell"${over}><span class="apbar" style="--v:${Math.max(0, Math.min(1, Number(row[key]))).toFixed(3)}"></span>`
            + `<span class="apnum">${cell(row[key])}</span></td>`
          : `<td${over}>${cell(row[key])}</td>`)).join('') + '</tr>';
    }).join('');

    /* **"Classes seen", not "all classes".** The aggregate is a mean over the classes that
       actually appeared in validation, not over the vocabulary -- a species the run never
       saw is not a zero in it, it is absent from it. Labelling it "all" invites exactly
       the reading it cannot support, which is the VRAM problem again: the number is fine
       and the word was wrong. */
    const foot = overall
      ? `<tfoot><tr><th scope="row" title="Mean over the classes that appeared in validation, `
        + `not over the whole species vocabulary">Classes seen (${named.length})</th>`
        /* **Not a sum, and the two columns have different reasons for it** -- recorded
           together so neither gets "corrected" on the strength of the other, which is the
           same guard the API session put in the column comments.

           `image_count` is not summable at all: a frame holding three species is counted
           once for each, so a total counts that frame three times and answers no question
           anybody asked. `support` would be summable in principle, since instances really
           are disjoint -- but the trainer reports no whole-split count, so a figure
           computed here would be arithmetic of mine rather than a measurement. Same
           answer, different reasons, and the weaker one is not a licence for the other. */
        + counts.map(() => '<td class="num"><span class="dash" title="Reported per class only">&mdash;</span></td>').join('')
        + `${columns.map(([, key]) => `<td>${cell(overall[key])}</td>`).join('')}</tr></tfoot>`
      : '';

    const heading = families.size > 1
      ? `<h6>${FAMILY[family] || escapeHtml(family)}</h6>`
      : '';

    return `${heading}<div class="class-metrics-wrap"><table class="class-metrics"><thead><tr><th>Class</th>`
      + `${counts.map(([label, , said]) => `<th class="num" title="${said}">${label}</th>`).join('')}`
      + `${columns.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead>`
      + `<tbody>${body}</tbody>${foot}</table></div>`;
  };

  return '<article class="evaluation-card"><header><div><h5>Per-class quality</h5>'
    /* **The caveat goes where the comparison is made.** Every class here is scored at one
       shared confidence threshold, picked from the mean F1 across classes -- so a class
       whose own best threshold sits elsewhere is reported off its peak, and two classes
       read against each other are not each at their best. Buried in a tooltip this would
       be true and useless. */
    + `<p>${families.size > 1 ? 'One table per metric family. ' : ''}`
    + 'All classes are scored at one shared confidence threshold, chosen from the mean F1 '
    + '&mdash; so a class whose own best threshold is elsewhere reads below its peak.'
    + '</p></div></header>'
    + [...families].map(([family, rows]) => tableFor(family, rows)).join('')
    + '</article>';
}

/**
 * The plots the trainer draws for itself.
 *
 * **A gallery, captioned by what each one is rather than by its filename.** `PR_curve.png`
 * means nothing to a reader who has not run YOLO; "Precision against recall, per class"
 * does. The filenames are kept as the lookup key and never as the label.
 *
 * @param {Object[]} plots - `{name, url}` for each artifact the run produced.
 * @returns {string}
 */
/**
 * One curve chart: every class as a thin line, their mean as a thick one.
 *
 * **This is Ultralytics' own layout, deliberately.** Anybody who has trained a YOLO
 * model has read `PR_curve.png` a hundred times -- faint per-class lines with one bold
 * mean over them -- so the shape is borrowed and only the styling is MARP's. A cleverer
 * encoding would be a worse chart here, because recognising it at a glance is the whole
 * requirement.
 *
 * Both axes are 0 to 1 by definition, so the scale is fixed rather than fitted: two runs
 * can be compared by eye, which an axis that moved with the data would prevent.
 *
 * @param {Object} spec - `{title, note, x, y, xLabel, yLabel}`; `x` and `y` name arrays.
 * @param {Object[]} series - One entry per class, with parallel arrays.
 * @returns {string}
 */
function curveChart(spec, series) {
  /* **The mean across classes, which is the line a reader looks at first.** Index-wise
     rather than interpolated: the API refuses a family whose arrays disagree in length,
     so every class shares one x axis and the columns line up by construction. */
  const width = series.reduce((most, one) => Math.max(most, (one[spec.y] || []).length), 0);
  const finite = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const mean = [];

  for (let index = 0; index < width; index += 1) {
    const ys = series.map((one) => one[spec.y][index]).filter(finite).map(Number);
    const xs = series.map((one) => one[spec.x][index]).filter(finite).map(Number);

    mean.push(xs.length && ys.length
      ? [xs.reduce((sum, value) => sum + value, 0) / xs.length, ys.reduce((sum, value) => sum + value, 0) / ys.length]
      : [null, null]);
  }

  const pairs = (one) => (one[spec.x] || []).map((x, index) => {
    const y = one[spec.y][index];
    return finite(x) && finite(y) ? [Number(x), Number(y)] : [null, null];
  });

  const theme = chartTheme();
  const meanName = `Mean of ${series.length} class${series.length === 1 ? '' : 'es'}`;
  const tick = (value) => (value === null || value === undefined ? '—' : Number(value).toFixed(3));

  const option = {
    grid: { left: 42, right: 18, top: 40, bottom: 36 },
    /* Both axes are 0 to 1 by definition, so fixed: two runs compare by eye. */
    xAxis: { type: 'value', min: 0, max: 1, name: spec.xLabel, nameLocation: 'middle', nameGap: 24, ...theme.axis },
    yAxis: { type: 'value', min: 0, max: 1, name: spec.yLabel, ...theme.axis },
    /* By item rather than by axis: the x values differ slightly per class, so "every line
       at this x" is not a question these charts can answer. */
    tooltip: {
      ...theme.tooltip, trigger: 'item',
      formatter: (item) => `${escapeHtml(item.seriesName)}<br>${escapeHtml(spec.xLabel)} ${tick(item.value[0])} · ${escapeHtml(spec.yLabel)} ${tick(item.value[1])}`,
    },
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }, { type: 'inside', yAxisIndex: 0, filterMode: 'none' }],
    series: [
      ...series.map((one, index) => {
        const { color } = chartKey(`class-${(index % 4) + 1}`);
        return {
          id: `class-${index}`, name: chartText(one.class_name || `Class ${index}`), type: 'line',
          data: pairs(one), connectNulls: false, showSymbol: false,
          lineStyle: { color, width: 1.2, opacity: 0.42 }, itemStyle: { color }, emphasis: { lineStyle: { width: 2, opacity: 1 } },
        };
      }),
      {
        id: 'mean', name: meanName, type: 'line', data: mean, connectNulls: false, showSymbol: false, z: 3,
        lineStyle: { color: chartKey('curve-mean').color, width: 3.2 }, itemStyle: { color: chartKey('curve-mean').color },
      },
    ],
  };

  return '<article class="evaluation-card history-card curve-card">'
    + `<header><div><h5>${spec.title}</h5><p>${spec.note}</p></div></header>`
    /* No key under the chart: the legend names the classes and the mean, and the title
       says what is plotted against what. */
    + `${chartSlot(option, `${chartText(spec.title)} over ${series.length} classes`)}</article>`;
}

/**
 * The four threshold charts YOLO draws for every run, from numbers.
 *
 * **Read on asking, because this is the big one.** `/curves` is about a thousand points
 * per class where `/metrics` is a handful of rows; the API serves it separately for that
 * reason and a panel that pulled it on every expansion would be spending a megabyte on a
 * section most readers scroll past.
 *
 * @param {Object[]} curves - One entry per split, family and class.
 * @param {string} state - `read` once the request has been made, else `unread`.
 * @returns {string}
 */
function thresholdCurves(curves, state, published) {
  /* **An offer, not an explanation.** This card used to carry two paragraphs: what the
     four charts would show, and why they are fetched on asking. The first described
     something the reader can see the moment they press the button; the second is a fact
     about the API that only mattered to whoever wrote this. The button is the whole
     message. */
  if (state !== 'read') {
    /* **The offer is only made where there is something behind it.** Curves exist when
       the run published a `metrics_curves` artifact, and `/artifacts` has already been
       read -- so a finished run without one draws nothing at all rather than a button
       that fetches an empty answer. A run still going gets the short waiting line, since
       the curves are written at the end. */
    if (!runHasFinished) return runSectionWaiting('Threshold curves');
    if (!published) return '';

    return '<article class="evaluation-card history-card"><header><div><h5>Threshold curves</h5>'
      + '<p>Precision and recall against each other and against the threshold</p></div>'
      + '<button class="btn sm" type="button" data-read-curves>Show</button></header></article>';
  }

  /* One family and one split at a time. Today every run is detection on the validation
     split, so this picks the only one there is; a segmentation run will carry `box` and
     `seg` and the first is as good a default as any until somebody asks for a switch. */
  const named = curves.filter((one) => one.class_name);

  if (!named.length) {
    return runSectionWaiting('Threshold curves');
  }

  const family = named[0].metric_family;
  const split = named[0].dataset_split;
  const series = named.filter((one) => one.metric_family === family && one.dataset_split === split);

  const charts = [
    {
      title: 'Precision–recall',
      note: 'The curve mAP@50 is the area under &middot; higher and further right is better',
      x: 'recall', y: 'precision', xLabel: 'Recall', yLabel: 'Precision',
    },
    {
      title: 'F1 against confidence',
      note: 'Where the mean peaks is the confidence this model is best operated at',
      x: 'confidence', y: 'f1_score', xLabel: 'Confidence', yLabel: 'F1',
    },
    {
      title: 'Precision against confidence',
      note: 'Rises towards 1 as the threshold admits only what the model is sure of',
      x: 'confidence', y: 'precision', xLabel: 'Confidence', yLabel: 'Precision',
    },
    {
      title: 'Recall against confidence',
      note: 'Falls as the threshold rises &middot; the trade against precision above',
      x: 'confidence', y: 'recall', xLabel: 'Confidence', yLabel: 'Recall',
    },
  ];

  return `<div class="curve-grid" data-family="${escapeHtml(family)}" data-split="${escapeHtml(split)}">`
    + charts.map((spec) => curveChart(spec, series)).join('') + '</div>';
}

/**
 * The two artifacts MARP reads rather than shows.
 *
 * Their contents are already on screen as the matrix, the per-class table and the curves,
 * so a JSON download tile among the plot images is the same clutter as an explanatory
 * paragraph: it is there because it exists, not because anybody wants it. They are
 * reachable from one small link beside the matrix instead, which is enough for the one
 * person who ever wants them -- somebody checking a drawn number against what the trainer
 * actually sent.
 *
 * @type {string[]}
 */
const INGEST_ARTIFACTS = ['final_metrics', 'metrics_curves'];

function trainingPlots(plots) {
  /* What each of YOLO's own outputs is, in words. Anything not named here is still shown,
     under its own filename -- a plot nobody has described is better seen than hidden. */
  const SAID = {
    PR_curve: 'Precision against recall, per class',
    F1_curve: 'F1 against confidence threshold',
    P_curve: 'Precision against confidence threshold',
    R_curve: 'Recall against confidence threshold',
    labels: 'How many instances of each class the dataset held',
    labels_correlogram: 'Where boxes sit and how their sizes relate',
    results: 'Every metric the run recorded, as a spreadsheet',
    confusion_matrix: 'Confusion matrix, as the trainer rendered it',
    confusion_matrix_normalized: 'Confusion matrix, normalised by true class',
    /* **Already here, on every run that predates the artifact work.** `/artifacts` lists
       everything the attempt handed over, and the weights have always been handed over --
       runs 205 and 206 each return exactly one file and it is this. Found by asking the
       service rather than by waiting for the first run that uploads plots. */
    weights: 'The trained model itself',
  };

  if (!plots.length) {
    return runSectionWaiting('Training output');
  }

  /* **The stems MARP serves carry no extension and no reliable type**, so the two that
     are not pictures are named. Everything else in a run directory is. Run 207 arrived
     as twenty artifacts: sixteen images, this CSV, these weights, and the two the ingest
     reads, which never reach here. */
  const NOT_PICTURES = new Set(['weights', 'results']);

  const tiles = plots.map((plot) => {
    const stem = String(plot.name || '').replace(/\.[a-z]+$/i, '');
    /* **`Box`-prefixed for detection**, which is Ultralytics' own naming and not
       something anybody told us until the files arrived: `BoxPR_curve`, not `PR_curve`.
       Segmentation will bring `Mask` ones beside them, so the prefix is stripped for the
       lookup rather than four more entries being added above. */
    const curve = stem.replace(/^(Box|Mask|Seg)(?=[A-Z])/, '');
    const said = SAID[stem] || SAID[curve]
      || (/^val_batch\d+_pred$/.test(stem) ? 'Sample predictions on held-out images' : '')
      || (/^val_batch\d+_labels$/.test(stem) ? 'The labels those predictions were scored against' : '')
      || (/^train_batch\d+$/.test(stem) ? 'A batch as the model saw it, augmentations included' : '')
      || stem.replace(/[_-]+/g, ' ');

    /* **Not everything in this array is a picture, and the type often does not say.**
       Run 207's twenty artifacts are every one `application/octet-stream`, including a
       verified 3000x2250 PNG -- worker 0.1.8 declared nothing on upload. That is fixed
       for later runs and 21787 keeps its wrong types for ever, so a declared *specific*
       type wins and the generic one falls back on what the file is known to be. The
       broken-image fallback below catches anything this gets wrong. */
    const declared = String(plot.content_type || '');
    const vague = !declared || declared === 'application/octet-stream';
    const isImage = /^image\//.test(declared)
      || (vague && !NOT_PICTURES.has(stem)
        && !/\.(csv|txt|ya?ml|json|pt|pth|zip)$/i.test(plot.name || ''));

    if (!isImage) {
      const size = Number(plot.bytes) > 0 ? ` <span class="faint">${Math.round(Number(plot.bytes) / 1024)} KB</span>` : '';

      return `<figure class="result-plot is-file"><figcaption><a href="${escapeHtml(plot.url)}" download>`
        + `${escapeHtml(said)}</a>${size}<span class="b mono">${escapeHtml(plot.name)}</span></figcaption></figure>`;
    }

    /* `data-file` carries what the fallback needs, so a tile that turns out not to be an
       image can become the file form without the panel being redrawn. */
    return `<figure class="result-plot" data-file="${escapeHtml(plot.url)}" data-said="${escapeHtml(said)}" title="Open larger">`
      + `<img src="${escapeHtml(plot.url)}" alt="${escapeHtml(said)}" loading="lazy">`
      + `<figcaption>${escapeHtml(said)}</figcaption></figure>`;
  }).join('');

  return '<article class="evaluation-card"><header><div><h5>Training output</h5>'
    /* **Files, not plots.** `/artifacts` is an open set of everything the attempt handed
       over, and on every run that predates the plot work that is exactly one file: the
       weights. "1 plot the trainer produced" over a 50MB `.pt` is a small confident
       falsehood of the kind this panel keeps being corrected for. */
    + `<p>${plots.length} file${plots.length === 1 ? '' : 's'} this run produced</p></div></header>`
    + `<div class="plot-gallery">${tiles}</div></article>`;
}

/**
 * The run's pictures, one at a time and as large as the window allows.
 *
 * Isaac, on the gallery: *"i can't zoom in or see them bigger. maybe they should be
 * clickable and it should open a little scroll slide show so i can view them all?"* A
 * 220px tile of a 3000px plot is a thumbnail of something nobody can read.
 *
 * One overlay for the page, built on first use. Arrows and the keyboard step through
 * every picture in the gallery that was clicked; clicking the picture swaps between
 * fitting the window and its own pixels, which scroll -- that is the zoom.
 *
 * @param {Element[]} figures - The gallery's image tiles, in order.
 * @param {number} start - The one that was clicked.
 */
function openPlotViewer(figures, start) {
  let viewer = $('#plot-viewer');

  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'plot-viewer';
    viewer.className = 'plot-viewer';
    viewer.hidden = true;
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.innerHTML = '<div class="pv-bar"><span class="pv-said"></span><span class="pv-count faint"></span>'
      + '<a class="btn sm pv-open" target="_blank" rel="noopener" title="Open the full file in a new tab"><svg class="ico sm"><use href="#i-download"/></svg>Full size</a>'
      + '<button class="btn sm pv-close" type="button" aria-label="Close"><svg class="ico sm"><use href="#i-x"/></svg></button></div>'
      + '<button class="pv-step pv-prev" type="button" aria-label="Previous picture"><svg class="ico"><use href="#i-left"/></svg></button>'
      + '<div class="pv-stage"><img alt=""></div>'
      + '<button class="pv-step pv-next" type="button" aria-label="Next picture"><svg class="ico"><use href="#i-right"/></svg></button>';
    document.body.appendChild(viewer);

    const stage = $('.pv-stage', viewer);

    $('.pv-close', viewer).addEventListener('click', () => viewer.close());
    $('.pv-prev', viewer).addEventListener('click', () => viewer.step(-1));
    $('.pv-next', viewer).addEventListener('click', () => viewer.step(1));
    $('img', viewer).addEventListener('click', () => stage.classList.toggle('actual'));
    // The dark around the picture closes it; the picture itself is the zoom.
    stage.addEventListener('click', (event) => { if (event.target === stage) viewer.close(); });

    viewer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') viewer.close();
      else if (event.key === 'ArrowLeft') viewer.step(-1);
      else if (event.key === 'ArrowRight') viewer.step(1);
      else return;
      event.preventDefault();
    });

    viewer.show = (index) => {
      const count = viewer.figures.length;

      viewer.index = (index + count) % count;

      const figure = viewer.figures[viewer.index];
      const img = $('img', viewer);

      img.src = figure.dataset.file;
      img.alt = figure.dataset.said || '';
      $('.pv-said', viewer).textContent = figure.dataset.said || '';
      $('.pv-count', viewer).textContent = `${viewer.index + 1} of ${count}`;
      $('.pv-open', viewer).href = figure.dataset.file;
      stage.classList.remove('actual');
      stage.scrollTo?.(0, 0);
    };
    viewer.step = (by) => viewer.show(viewer.index + by);
    viewer.close = () => {
      viewer.hidden = true;
      document.body.classList.remove('viewing');
      if (viewer.opener) viewer.opener.focus?.();
    };
  }

  viewer.figures = figures;
  viewer.opener = document.activeElement;
  // One picture has nowhere to step to.
  $$('.pv-step', viewer).forEach((button) => { button.hidden = figures.length < 2; });
  viewer.show(start);
  viewer.hidden = false;
  document.body.classList.add('viewing');
  viewer.tabIndex = -1;
  viewer.focus();
}

/**
 * What a run looks like inside its row.
 *
 * @param {Object} run - The training run.
 * @param {Object[]} epochs - Its epochs, earliest first.
 * @returns {string} The run's part of the panel, without the wrapper.
 */
function trainingRunDetail(run, epochs, task, spec, evidence) {
  /* **Not `NOT_REPORTED`.** That one's tooltip is about worker telemetry, which is not
     what a null batch size on a training run means -- the run simply did not record one. */
  const NONE = '<span class="dash" title="Not recorded on this training run">&mdash;</span>';
  const metric = (label, value, note = '') =>
    `<div class="jobmetric"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;

  /* **The headline metric is the task's, not detection's.** A classification run has no
     mAP and reports top-1 instead, so this block named a quantity the run does not
     measure and would have shown a permanent dash under it. `from` says where it comes
     from as well as what it is called: `map50` is the best over the epochs as they
     arrive, top-1 is a single end-of-run figure on the aggregate row. */
  const plan = TRAINING_TASKS[task] || null;
  const headline = (plan && plan.headline) || TRAINING_TASKS.detection.headline;

  const best = headline.from === 'map50'
    ? epochs.reduce((top, epoch) => {
      const value = epoch.map50 === null || epoch.map50 === undefined ? null : Number(epoch.map50);

      return value !== null && (top === null || value > top) ? value : top;
    }, null)
    /* The aggregate row -- the one with no class name -- is where an end-of-run figure
       lives. Absent until the run has finished and published its metrics. */
    : (() => {
      const rows = (evidence && Array.isArray(evidence.metrics)) ? evidence.metrics : [];
      const overall = rows.find((row) => !row.class_name);
      const value = overall ? overall[headline.from] : null;

      return value === null || value === undefined ? null : Number(value);
    })();

  const done = epochs.length;
  const total = Number(run.total_epochs) || null;

  /* **Reported, not configured.** `total_epochs` is what the run was asked for and
     `epochs.length` is what has actually arrived, so a run in progress reads honestly as
     it fills. */
  const progress = total ? `${done} / ${total}` : String(done);

  /* **Epoch time, from the epochs themselves.** `duration_seconds` has been a column
     nothing wrote; worker 0.1.6 writes it. Averaged over the epochs that reported one and
     absent when none did, so it fills in as a run goes rather than appearing at the end.

     It is also a second opinion on the pace above it, measured a different way: the pace
     differences the attempt's progress samples, this reads what each epoch said it took.
     Two sources disagreeing is worth seeing, which is why both are shown rather than one
     derived from the other. */
  const timed = epochs
    .map((one) => Number(one.duration_seconds))
    .filter((value) => Number.isFinite(value) && value > 0);
  const meanEpoch = timed.length
    ? timed.reduce((sum, value) => sum + value, 0) / timed.length
    : null;

  const settings = [
    metric('Epochs reported', progress, total ? 'of the configured total' : 'no total recorded'),
    /* **Not `tookText`**, which rounds to whole minutes: a 40-second epoch would read
       "1m" and a 20-second one "0m". Isaac's last run finished in 27 seconds in total, so
       seconds are the ordinary case here rather than the edge. */
    metric('Epoch time', meanEpoch === null ? NONE : shortDuration(meanEpoch),
      meanEpoch === null ? 'not reported' : `mean of ${timed.length} reported`),
    metric(headline.label, best === null ? NONE : best.toFixed(3), headline.note),
    metric('Batch size', run.batch_size ?? NONE),
    metric('Learning rate', run.learning_rate ?? NONE),
    metric('Optimizer', run.optimizer || NONE),
    metric('Device', run.compute_device || NONE),
  ].join('');

  /* **The charts come from the task, not from this function.** Every run today is
     detection, which is exactly when hard-coding box/class/DFL and mAP@50 looks harmless.
     Classification reports top-1 and top-5 and no boxes; segmentation reports mask
     metrics beside box ones. `TRAINING_TASKS` is where a second task gets added, and
     adding it is a list of series rather than a rewrite of this.

     A task nobody has described yet says so, which is a gap a reader can see. */
  const charts = !plan || !plan.charts.length
    ? `<p class="hint">${plan
      ? (plan.chartsWaiting
        || `The charts a ${plan.label.toLowerCase()} run should show are not described yet.`)
      : 'This run&rsquo;s task is unknown, so there is no set of charts to draw for it.'}</p>`
    : (epochs.length
      ? plan.charts.map((chart) => epochChart(chart, epochs)).join('')
      : '<p class="hint">No epoch has been reported yet. This fills in as the run reports them.</p>');

  /* **No range control on these.** Their x-axis is the epoch number, not a clock, so
     "the last hour" names nothing -- a run is however many epochs long and all of them
     belong on the chart. The range controls stay on the charts that are over time. */
  /* **Everything below comes from the three end-of-run reads, not from the run row.**
     It used to read `run.confusion_matrix`, `run.class_metrics` and `run.plots`, which
     `GET /training_run/:id` has never carried and never will -- so all three sections
     drew their empty state for ever, over a gap that looked like missing data and was a
     missing request. `/metrics`, `/curves` and `/artifacts` are where they live. */
  const found = evidence || {};
  const everyFile = Array.isArray(found.files) ? found.files : [];
  /* The gallery shows what the trainer drew. The two MARP reads instead are reachable
     from the matrix card, where somebody checking a number would look for them. */
  const files = everyFile.filter((file) => !INGEST_ARTIFACTS.includes(file.name));
  const raw = everyFile.filter((file) => INGEST_ARTIFACTS.includes(file.name));
  /* The split a confusion matrix is for is its own; the first is the validation one in
     every run so far, and the card names whichever it drew rather than assuming. */
  const matrices = Array.isArray(found.matrices) ? found.matrices : [];
  const rendered = files.find((file) => /^confusion_matrix$/.test(file.name || ''));

  /* **Which sections exist is the task's to say, and this is the part that was a
     rewrite rather than a list.** These four were concatenated unconditionally, so a
     classification run drew "this run recorded no per-class precision, recall or AP" and
     a control offering to read threshold curves -- both reading as a run that failed to
     measure something, when `ClassifyMetrics` has no per-class array and no thresholds at
     all. A section that does not apply to the task does not appear.

     A task MARP does not recognise keeps all four: it is the only honest default, since
     nothing here knows what such a run does or does not report. */
  const drawn = {
    matrix: () => confusionMatrix(matrices[0] || null, rendered ? rendered.url : null, raw),
    classes: () => perClassTable(Array.isArray(found.metrics) ? found.metrics : []),
    curves: () => thresholdCurves(Array.isArray(found.curves) ? found.curves : [], found.curvesState,
      raw.some((file) => file.name === 'metrics_curves')),
    files: () => trainingPlots(files),
  };
  const wanted = (plan && plan.sections) || Object.keys(drawn);
  const evaluation = wanted.map((section) => (drawn[section] ? drawn[section]() : '')).join('');

  /* The inner content only; `trainingJobDetail` owns the wrapper, because it puts the
     live attempt block above this and the two have to sit in one panel. */
  /* The same names the row shows, for the same reason: the spec has been carrying them
     all along and this header was printing the ids beside them. */
  const named = (noun, from, id) => {
    const name = from && typeof from.name === 'string' ? from.name.trim() : '';

    return name ? `${escapeHtml(name)} (${noun.toLowerCase()} ${id})` : `${noun} ${id}`;
  };
  const about = [
    run.dataset_id ? named('Dataset', spec && spec.dataset, run.dataset_id) : 'No dataset recorded',
    run.model_id ? named('Model', spec && spec.model, run.model_id) : null,
    task ? TRAINING_TASKS[task].label : null,
  ].filter(Boolean).join(' &middot; ');

  /* **Above the epoch charts, because it is the part that moves.** A run somebody is
     watching reports a batch every few seconds and an epoch every few minutes; putting
     the slower thing first would mean scrolling past it to see anything happen. Empty for
     a finished run, whose batches are history its epoch charts already summarise. */
  const steps = stepCharts(Array.isArray(found.steps) ? found.steps : []);

  return `<div class="jobdetail-head"><div><b>Training run ${run.id}</b>`
    + `<span>${about}</span></div></div>`
    + `<div class="jobmetrics">${settings}</div>`
    + steps
    /* One heading over what the run concluded, matching *While it runs* above it, so the
       live charts and the epoch charts read as two things rather than one long column. */
    + ((charts || evaluation) ? '<div class="sect run-results"><h3>Results</h3>'
      + `<div class="training-history-grid">${charts}</div>`
      + `<div class="training-evaluation-grid">${evaluation}</div></div>` : '');
}

/**
 * A duration that is usually short, in words.
 *
 * `tookText` rounds to whole minutes, which is right for a job and wrong for an epoch:
 * it turns 40 seconds into "1m" and 20 into "0m". Below a minute and a half this counts
 * seconds; above it, it hands over to the one the rest of the screen uses.
 *
 * @param {number} seconds - How long.
 * @returns {string}
 */
function shortDuration(seconds) {
  return seconds < 90 ? `${Math.round(seconds)}s` : tookText(seconds * 1000);
}

/**
 * How fast a run is getting through its epochs, from its own progress samples.
 *
 * **Differenced over the whole window rather than the last pair.** Samples are about a
 * minute apart and an epoch can straddle several, so consecutive samples are often
 * identical -- a last-pair rate would read zero, then spike, then zero again. First to
 * last is the rate the run has actually held.
 *
 * **Two samples is the floor, and below it this says so.** A single sample has no
 * elapsed time to divide by, and a rate invented from one reading is the "~4h 10m" this
 * replaces: a number that looks measured and is not.
 *
 * @param {Object[]} pace - From `GET /training_run/:id/pace`, oldest first.
 * @returns {Object|null} `{perMinute, remainingMs, done, total}`, or null when unknowable.
 */
function trainingPace(pace) {
  if (!Array.isArray(pace) || pace.length < 2) return null;

  const first = pace[0];
  const last = pace[pace.length - 1];
  const minutes = (Date.parse(last.at) - Date.parse(first.at)) / 60000;
  const gained = Number(last.done) - Number(first.done);

  if (!(minutes > 0) || !(gained > 0)) return null;

  const perMinute = gained / minutes;
  const total = Number(last.total) || 0;
  const done = Number(last.done) || 0;
  const left = Math.max(0, total - done);

  return {
    perMinute,
    done,
    total,
    /* Only when there is a total to count down to. A run whose total is unknown has a
       rate and no end, and saying "0 left" would be a claim rather than a gap. */
    remainingMs: total > 0 ? (left / perMinute) * 60000 : null,
  };
}

/**
 * What a job's own attempt says it is doing, right now.
 *
 * **The live half, and it needs no training run.** `gpu_job_attempts` carries
 * `progress_done`, `progress_total`, `progress_unit` and `progress_phase`, and the job
 * list serves them — for 21779 that read `0 / 1 epochs, phase training` while it ran. A
 * run row and its epochs arrive later and sometimes never, so a panel that waited for one
 * showed nothing during the only period anybody is watching.
 *
 * @param {Object} job - From `GET /gpu/jobs`.
 * @param {string} state - The view's state word.
 * @returns {string} The progress block.
 */
function trainingAttemptProgress(job, state, pace) {
  const done = Number(job.progress_done);
  const total = Number(job.progress_total);
  const unit = job.progress_unit || 'epochs';
  const measured = Number.isFinite(done) && Number.isFinite(total) && total > 0;
  const pct = measured ? Math.round((done / total) * 100) : -1;

  const phase = (job.progress_phase || '').trim();
  /* Seconds matter here too: a run that finishes in 27 seconds spends its whole life
     reading "0m" under a minute-rounded formatter. */
  const elapsed = shortDuration(Math.max(0, Date.now() - Date.parse(job.created_at)) / 1000);

  const metric = (label, value, note = '') =>
    `<div class="jobmetric"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;

  if (state === 'queued') {
    return '<section class="jobstate" data-job-state="queued"><div class="jobstate-title"><div>'
      + '<h4>Waiting for a worker</h4><p>Nothing has leased this job yet, so it has reported nothing.</p>'
      + `</div></div><div class="jobmetrics">${metric('Waiting', elapsed, 'since it was queued')}`
      + `${metric('Epochs', measured ? `0 / ${total}` : '&mdash;', 'none started')}</div></section>`;
  }

  /* The bar is drawn only when the attempt gave numbers to draw it from. A bar at zero
     and a bar for "not reported" look identical, and one of them is a lie. */
  const bar = pct >= 0
    ? `<span class="bar wide"><i style="width:${pct}%"></i></span>`
    : '';

  return `<section class="jobstate" data-job-state="active"><div class="jobstate-title"><div>`
    + `<h4>${phase ? escapeHtml(phase.charAt(0).toUpperCase() + phase.slice(1)) : 'Training'}</h4>`
    + `<p>${measured ? `${done} of ${total} ${escapeHtml(unit)}` : 'The attempt has not reported progress yet'}</p>`
    + `</div>${bar}</div><div class="jobmetrics">`
    + metric('Epochs', measured ? `${done} / ${total}` : '&mdash;', measured ? escapeHtml(unit) : 'not reported')
    + metric('Elapsed', elapsed, 'since it was queued')
    + metric('Phase', phase ? escapeHtml(phase) : '&mdash;', phase ? 'as the worker reports it' : 'not reported')
    /* **Measured, or absent.** This is where the screen used to say "~4h 10m" from two
       literals in the markup, for a run that took 27 seconds. */
    + (pace
      ? metric('Pace', `${pace.perMinute.toFixed(pace.perMinute < 1 ? 2 : 1)} / min`, escapeHtml(unit))
        + metric('Remaining', pace.remainingMs === null ? '&mdash;' : `~${shortDuration(pace.remainingMs / 1000)}`,
          pace.remainingMs === null ? 'no total to count down to' : 'at the rate it has held')
      : metric('Pace', '&mdash;', 'not enough progress samples yet'))
    + '</div></section>';
}

/**
 * A training job inside its row: what it is doing now, and its run when it has one.
 *
 * @param {Object} view - The job view.
 * @param {Object|null} run - Its training run, when one has been recorded.
 * @param {Object[]} epochs - That run's epochs, or empty.
 * @param {Object[]} pace - Its progress samples, or empty.
 * @param {Object} [evidence] - `{metrics, matrices, curves, files}` from the three
 *   end-of-run reads. Empty when the run has not produced them.
 * @returns {string}
 */
function trainingJobDetail(view, run, epochs, pace, evidence) {
  const terminal = ['done', 'issues', 'failed', 'cancelled', 'expired'].includes(view.state);
  const live = terminal ? '' : trainingAttemptProgress(view.job, view.state, trainingPace(pace));

  /* Set before anything below draws: the sections read it to decide between a short
     waiting line and nothing at all. */
  runHasFinished = terminal;

  /* **Why it failed, said where somebody is looking.** A training job that failed showed
     no reason here at all -- job 21953, WpFeCec, failed three times over and the panel said
     only that no run had been recorded. The reason is on the attempts, so they are read
     when the panel opens and the last one's reason heads the section. */
  const ended = ['failed', 'expired'].includes(view.state)
    ? '<section class="jobstate" data-job-state="attention"><div class="jobstate-alert"><svg class="ico"><use href="#i-alert"/></svg>'
      + `<div><h4>${view.state === 'expired' ? 'Expired' : 'Failed'}</h4>`
      + '<p data-job-failure>The attempts below say how each try ended.</p></div></div></section>'
      + '<details class="diag" open><summary>Attempts<span class="later">Every try at this job, and why each ended</span></summary>'
      + `<div class="dbody"><div class="jobattempts" data-job-attempts="${view.job.id}"></div></div></details>`
    : '';

  if (!run) {
    /* **Expanding is not conditional on a run existing**, which is what broke watching:
       the gate used to be `data-run`, so the one job anybody wanted to watch -- the one
       still going -- had no expander at all. */
    return `<div class="rundetail jobdetail">${live}${ended}`
      + (ended ? '<p class="hint">It ended before training began, so no run was recorded.</p></div>'
        : '<p class="hint">No training run has been recorded for this job yet. Its epochs, losses '
          + 'and mAP appear here as soon as one is.</p></div>');
  }

  return `<div class="rundetail jobdetail">${live}${ended}`
    + `${trainingRunDetail(run, epochs, trainingTaskOf(view.job), view.job.spec, evidence)}</div>`;
}

/**
 * Expand a training job, and keep what is inside it current.
 *
 * **Every training job, not only one with a run.** The gate used to be `data-run`, so a
 * job that was queued or still leased had no expander — and that is the one somebody
 * watches. Isaac, on the run he had just started: *"it's not expandable, it should be
 * expandable, and updated every few seconds as we go through it"*.
 *
 * The detail is redrawn in place, never rebuilt around: the row and its detail element
 * stay, and only the contents of the cell change. That is the same rule the Datasets
 * table learned the hard way, where a redraw closed whatever somebody was reading.
 *
 * Epochs are asked for only when a run exists, and only while the row is open.
 *
 * @param {Element} head - The job row.
 * @param {Element} detail - Its detail row.
 * @returns {void}
 */
function wireTrainingJobDetail(head, detail) {
  const cell = $('td', detail);
  const jobId = Number(head.dataset.job);

  /* Exposed on the element the way `loadComposition` is on a dataset row, so the screen's
     poller can refresh an open panel without knowing anything about how it is built. */
  detail.redraw = async () => {
    if (head.getAttribute('aria-expanded') !== 'true') return;

    const view = trainingViewsByJob.get(jobId);

    if (!view) return;

    const run = trainingRunsByJob.get(jobId) || null;
    let epochs = [];
    let pace = [];
    let evidence = null;

    if (run) {
      try {
        /* **Settled, not awaited together.** The epochs are the charts and the pace is
           two figures beside them; a pace route that is slow or missing on an older MARP
           should cost those two figures, not the panel. */
        const [gotEpochs, gotPace, gotMetrics, gotFiles] = await Promise.allSettled([
          window.MarpApi.trainingRunEpochs(run.id),
          window.MarpApi.trainingRunPace(run.id),
          window.MarpApi.trainingRunMetrics(run.id),
          window.MarpApi.trainingRunArtifacts(run.id),
        ]);

        if (gotEpochs.status === 'rejected') throw gotEpochs.reason;

        epochs = gotEpochs.value;
        pace = gotPace.status === 'fulfilled' ? gotPace.value : [];

        /* **Settled, not awaited together, and the same rule the pace follows.** These
           three are what a finished run produced; a MARP that does not serve them yet,
           or a run that produced none, costs those sections and not the panel. A 404
           from an older API lands here as a rejection and reads as "nothing recorded",
           which is the honest rendering of both. */
        const measured = gotMetrics.status === 'fulfilled' ? gotMetrics.value : {};

        evidence = {
          metrics: Array.isArray(measured.metrics) ? measured.metrics : [],
          matrices: Array.isArray(measured.confusion_matrices) ? measured.confusion_matrices : [],
          files: gotFiles.status === 'fulfilled' ? gotFiles.value : [],
          curves: trainingCurvesByRun.get(run.id) || [],
          curvesState: trainingCurvesByRun.has(run.id) ? 'read' : 'unread',
          steps: await readTrainingSteps(run.id),
        };
      } catch (error) {
        cell.innerHTML = '<div class="rundetail jobdetail"><p class="hint">Could not read this '
          + `run's epochs (${error.status || 'no answer'}).</p></div>`;
        return;
      }
    }

    cell.innerHTML = trainingJobDetail(view, run, epochs, pace, evidence);
    if ($('[data-job-attempts]', cell)) fillJobAttempts(cell, jobId);

    /* **The curves are fetched on asking, once per run.** A thousand points per class is
       a megabyte a panel should not pull on every expansion, still less on every
       five-second poll of an open one -- so the card draws its own control, and what it
       reads is kept for as long as the page lives. The numbers cannot change: a run that
       has finished evaluating does not re-evaluate. */
    /* **Both readings of the same matrix, because they answer different questions.**
       The share says how a true class was split across predictions; the count says how
       much evidence that share rests on, and a convincing 100% over two instances is the
       thing a normalised matrix alone will not tell you. Both are already on the cell,
       so the swap is text rather than a redraw. */
    /* **The browser decides what a file really is, where the type did not say.** A tile
       drawn as an image whose bytes are not one leaves a broken icon with a caption
       under it -- so the figure becomes the download form instead. Captured rather than
       bubbled, because `error` on an element does not bubble. One listener for the
       panel; a tile that loads never reaches it. */
    /* A tile opens the viewer on the whole gallery. Delegated for the same reason the
       error listener is: the panel is redrawn under it on every poll. */
    cell.addEventListener('click', (event) => {
      const figure = event.target.closest && event.target.closest('.plot-gallery .result-plot[data-file]:not(.is-file)');

      if (!figure) return;

      const figures = $$('.result-plot[data-file]:not(.is-file)', figure.closest('.plot-gallery'));

      openPlotViewer(figures, figures.indexOf(figure));
    });

    cell.addEventListener('error', (event) => {
      const img = event.target;

      if (!img || img.tagName !== 'IMG') return;

      const figure = img.closest('.result-plot[data-file]');

      if (!figure) return;

      figure.classList.add('is-file');
      figure.innerHTML = `<figcaption><a href="${escapeHtml(figure.dataset.file)}" download>`
        + `${escapeHtml(figure.dataset.said || 'Download')}</a>`
        + '<span class="b mono">not an image</span></figcaption>';
    }, true);

    const modes = $$('[data-matrix-mode]', cell);

    modes.forEach((button) => button.addEventListener('click', () => {
      modes.forEach((other) => {
        const on = other === button;

        other.classList.toggle('on', on);
        other.setAttribute('aria-pressed', String(on));
      });

      const slot = $('[data-matrix] [data-chart]', cell);
      if (slot && slot.marpChart) {
        slot.marpChart.setOption({ series: [{ id: 'matrix', label: { formatter: matrixLabel(button.dataset.matrixMode) } }] });
      }
    }));

    const asking = $('[data-read-curves]', cell);

    if (asking && run) {
      asking.addEventListener('click', async () => {
        asking.disabled = true;
        asking.textContent = 'Reading…';

        try {
          trainingCurvesByRun.set(run.id, await window.MarpApi.trainingRunCurves(run.id));
        } catch (error) {
          trainingCurvesByRun.set(run.id, []);
          asking.textContent = `Could not read them (${error.status || 'no answer'})`;
          return;
        }

        detail.redraw();
      });
    }
  };

  /* **Watched rather than clicked.** The expander is one delegated listener on the
     document, so a click handler on the row runs while bubbling -- before that listener
     has flipped `aria-expanded`, which made an earlier version read the old value every
     time and never fetch. Watching the attribute is also what makes *Expand all* work. */
  new MutationObserver(() => { detail.redraw(); })
    .observe(head, { attributes: true, attributeFilter: ['aria-expanded'] });
}

/**
 * Write the cells that move, on the rows that are already there.
 *
 * **Every table of jobs, not only the training ones.** Jobs, Training and the Training
 * runs panel all draw `tr[data-job]` with the same cell classes, so one patcher serves
 * them: each cell it writes is guarded by being there, and a table without a Best mAP or
 * an Epochs column simply has nothing for those lines to find. A second patcher per
 * screen is how two tables start disagreeing about what a state looks like.
 *
 * **Patched, not redrawn.** Rebuilding the table every five seconds would close the row
 * being read, which is exactly the defect the Datasets table was fixed for; the same rule
 * applies here for the same reason, and the DOM tier pins both.
 *
 * A job that has finished is skipped: its cells are settled, and writing the last figures
 * it reached over them reads as a job still going.
 *
 * @param {Element} body - The table body.
 * @param {Map<number, Object>} views - The latest view per job id.
 * @returns {void}
 */
function patchJobRows(body, views) {
  for (const head of $$(':scope > tr[data-job]', body)) {
    const view = views.get(Number(head.dataset.job));

    if (!view) continue;

    /* **Patched before the terminal check, because it moves for its own reason.** On
       Datasets this cell sat frozen for as long as a build ran: the patch wrote frames
       and the pill and nothing else, and the column had only ever been refreshed by
       accident, when the whole table was still being thrown away every poll. A job's
       `updated_at` moves on every report, including the one that finishes it. */
    const seen = jobLastSeen(view.job);

    if (seen) {
      const updated = $('[data-updated]', head);

      if (updated && updated.dataset.sort !== String(seen)) {
        updated.innerHTML = datasetStamp(seen);
        /* The sort key too, or sorting by Updated orders the table by what the
           timestamps were when the page was drawn. */
        updated.dataset.sort = String(seen);
      }
    }

    const status = $('.jstatus', head);

    if (status && status.dataset.sort !== String(JOB_STATE_RANK[view.state])) {
      status.innerHTML = `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`;
      status.dataset.sort = String(JOB_STATE_RANK[view.state]);
    }

    /* **Before the terminal check, for the same reason Updated is.** Best mAP climbs as
       epochs land, and the poll that marks a job done is the one carrying its final
       value -- patching after the check would leave every finished run showing the
       second-to-last number it had. */
    const map = $('.jmap', head);
    const best = bestMap(view.job, trainingRunsByJob.get(view.job.id) || null);

    if (map && map.dataset.sort !== String(best.sort)) {
      map.innerHTML = best.html;
      map.dataset.sort = String(best.sort);
    }

    if (['done', 'issues', 'failed', 'cancelled', 'expired'].includes(view.state)) continue;

    /* Epochs, from the attempt rather than from a run: it is what moves while the job
       runs and it needs no `training_runs` row to exist.

       **Only when the attempt says the unit is epochs.** `progress_done` counts whatever
       the worker is counting, and a job reporting frames put `11131 / 45861` under a
       column headed Epochs -- a real number under the wrong label, which is worse than a
       dash because it looks like an answer. */
    const epochs = $('.jepochs', head);
    const done = Number(view.job.progress_done);
    const total = Number(view.job.progress_total);
    const counted = /epoch/i.test(view.job.progress_unit || '');

    if (epochs && counted && Number.isFinite(done) && Number.isFinite(total) && total > 0) {
      epochs.innerHTML = `${done} / ${total}`;
    }

    /* Only the Training runs table has this column, so this is a no-op on the recent
       table above -- one patch path for both, rather than a second one that would drift. */
    const prog = $('.jprog', head);

    if (prog) {
      const next = progressCell(view.job, view.state);

      if (prog.dataset.sort !== String(next.sort)) {
        prog.innerHTML = next.html;
        prog.dataset.sort = String(next.sort);
      }
    }

    const detail = head.nextElementSibling;

    if (detail && typeof detail.redraw === 'function') detail.redraw();
  }
}

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
  setCard(cards[2], done.length, [`${doneThisWeek} this week`, IN_THE_EXPANSION + ' versions']);
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
    if (n) n.innerHTML = IN_THE_EXPANSION;
    const sub = $('.stat-sub', cards[7]);
    if (sub) sub.innerHTML = '<span>open a run to see its best</span>';
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

  /* **Newest first, because the panel is called Recent.** It ranked by state instead --
     running, then issues, then failed, then everything that worked -- and then took three.
     With eight jobs and three failures that meant the three failures, every time: the
     table showed nothing but red while five jobs including the newest success sat
     underneath the cut. Isaac saw "Recent training jobs (8)" over three failed rows.

     Severity belongs in the cards above, which already count *Needs attention*. A list
     headed Recent that hides the most recent run is answering a question nobody asked. */
  const ordered = views
    .slice()
    .sort((a, b) => Date.parse(b.job.created_at) - Date.parse(a.job.created_at));

  /* **Every training job, a page at a time**, by the pager every table shares. It took
     the newest three, so a fourth run could only be reached through another screen --
     the same cut that hid every finished job on Inference behind a run in flight. */
  const { shown, from, pages } = pageOf(ordered, trainingPage);
  drawPager(table.closest('.panel')?.querySelector('.panel-ft'), trainingPage, {
    total: ordered.length, from, count: shown.length, pages, noun: 'training job', empty: 'No training jobs yet',
    redraw: () => renderTrainingRecent(views),
  });

  /* The heading counts every job; the footer says which of them are on this page. */
  const heading = $('.training-recent .panel-hd h2') || $$('.panel-hd h2').find((h) => /Recent training/.test(h.textContent));

  if (heading) heading.textContent = `Recent training jobs (${views.length.toLocaleString()})`;

  body.innerHTML = shown.map((view) => {
    const { job } = view;
    const started = new Date(job.created_at);
    const tookMs = Math.max(0, Date.parse(job.updated_at) - Date.parse(job.created_at));
    const terminal = ['done', 'issues', 'failed', 'cancelled', 'expired'].includes(view.state);

    /* The run this job produced, if it produced one. `training_runs.job_id` has existed
       since 20261020120000 and was missing from the model, so nothing could make this
       join until now. */
    const run = trainingRunsByJob.get(job.id) || null;

    /* **The names are in the spec and the row was reaching past them to the ids.**
       `spec.dataset` and `spec.model` each carry `{name, url, sha256}` beside the id, so
       "Dataset 384" was never the only thing available -- `CookieStarTest` was sitting in
       the same object. */
    const spec = job.spec || {};
    const datasetId = (spec.dataset && spec.dataset.dataset_id) ?? (run && run.dataset_id);
    const modelId = (spec.model && spec.model.ml_model_id) ?? (run && run.model_id);
    const task = trainingTaskOf(job);
    const lastSeen = jobLastSeen(job) || job.created_at;
    const map = bestMap(job, run);

    return `<tr data-job="${job.id}"${run ? ` data-run="${run.id}"` : ''}${task ? ` data-task="${task}"` : ''}>`
      /* **Every job, not only one with a run.** The expander used to be conditional on
         `run`, so a queued or leased job -- the only kind anybody watches -- had none. */
      + '<td class="ex"><button class="exbtn" type="button" aria-label="Show this job"><svg class="ico sm"><use href="#i-right"/></svg></button></td>'
        /* **Titled, because the column is 188px and these names are longer than that.**
         A generated training name runs to the forties and about thirty-two characters
         fit, so every one of them truncates -- including names a person typed.

         The time of day leads, which is deliberate and was measured: it is what tells
         three runs of one model over one dataset apart, and at the tail a long dataset
         name ate the budget and lost it. So what falls off now is the model name, which
         is the part least likely to differ between the runs somebody is comparing. The
         full string is one hover away regardless. */
    + `<td class="jname" title="${escapeHtml(view.title)}"><span class="name"><svg class="ico training"><use href="#i-training"/></svg><span class="t">${view.title}</span></span></td>`
      /* **What the model's task is**, from the base model rather than guessed from which
         metric columns are null. Once three kinds of run share this table, *Best mAP*
         means nothing for two of them and the row has to say which it is. */
      + `<td class="jtask" data-sort="${task || ''}">${task
        ? `<span class="tag">${TRAINING_TASKS[task].label}</span>`
        : '<span class="dash" title="The base model this job trains from is not in the registry">&mdash;</span>'}</td>`
      + `<td class="jdset">${namedById('Dataset', spec.dataset, datasetId,
        datasetId ? `./datasets.html?dataset=${encodeURIComponent(datasetId)}` : '')}</td>`
      /* **What it produces, which does not exist yet.** This cell means the model version
         the run registers, and a run that has not finished has not registered one. The
         base it trains *from* is a different fact and is in the expansion. */
      /* **It named the base model it trained FROM.** Both candidates are the starting
         checkpoint -- `spec.model.ml_model_id` is what `gpu.service.js` requires on
         submission, and `training_runs.model_id` is what that run is recorded against --
         so a finished run claimed to have produced the model it fine-tuned from, and the
         expansion named the same model again as the base. A run that trained from itself.
         Nothing records which model a run registered; until something does, this says so. */
      + `<td class="jmakes">${['done', 'issues'].includes(view.state)
        ? producedModelCell(run)
        : '<span class="dash" title="The version a run registers does not exist until it succeeds">&mdash;</span>'}</td>`
      + `<td class="jstatus" data-sort="${JOB_STATE_RANK[view.state]}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
      + `<td class="jepochs num">${run && run.total_epochs
        ? `<span title="Configured for this run. How many have been reported is in the expansion.">${run.total_epochs}</span>`
        : (run ? IN_THE_EXPANSION : NO_RUN_RECORDED)}</td>`
      + `<td class="jmap num" data-sort="${map.sort}">${map.html}</td>`
      + `<td class="jtime" data-sort="${job.created_at}"><span class="two"><span class="a">${started.toTimeString().slice(0, 5)}</span><span class="b">${started.toISOString().slice(0, 10)}</span></span></td>`
      + `<td class="jtook num" data-sort="${tookMs}">${terminal ? tookText(tookMs) : '<span class="dash">&mdash;</span>'}</td>`
      /* **The same cell the Datasets table has, with the same marker.** `data-updated` is
         what the patch path finds and what the DOM tier asserts against. */
      + `<td class="jtime" data-updated data-sort="${lastSeen}">${datasetStamp(lastSeen)}</td>`
      + '</tr>';
  }).join('');

  /* **Every view, not the three drawn here.** The Training runs panel below shows every
     run, and both tables' expansions are the same `wireTrainingJobDetail`, which looks a
     job up in this map -- so a run outside the recent three would have opened to nothing.
     It also fixes the watcher by the same stroke: it keeps polling while any training job
     is live, rather than only while one of the top three is. */
  trainingViewsByJob = new Map(views.map((view) => [view.job.id, view]));

  for (const head of $$(':scope > tr[data-job]', body)) {
    head.classList.add('runrow-head');
    head.setAttribute('aria-expanded', 'false');

    const detail = document.createElement('tr');

    detail.className = 'runrow-body';
    detail.hidden = true;
    detail.innerHTML = '<td colspan="11"><div class="rundetail jobdetail"><p class="hint">Reading this job&hellip;</p></div></td>';
    head.after(detail);

    wireTrainingJobDetail(head, detail);
  }

  /* The delegated expander listener keys off `table.expandable`, so the rows it has just
     been given are wired by the sweep every other table uses. */
  wireAccordions();
}

/**
 * Which task each base-model select is choosing a starting point for.
 *
 * **The checkpoint decides the task, and the engine never learns which task was asked
 * for.** A detection `.pt` selected for a segmentation run does not fail — it trains a
 * detector, while the screen says segmentation and the model that comes out is recorded
 * as whatever was requested. Of the three ways this could have gone that is the worst
 * one, because nothing downstream can tell the result from a correct run.
 *
 * Isaac asked the question directly: *"we don't want to transfer train different model
 * types from other models? like a segmentation model from a bounding box model?"* Cross-
 * task transfer is legitimate in principle — backbones do transfer — but the worker would
 * have to build the target task's architecture and load compatible weights into it
 * deliberately, which is work nobody has asked for. Until then these do not mix.
 *
 * @constant
 * @type {Object<string, string>}
 */
/** The registry and the catalogue the form is choosing from. Set when the choices fill. */
let trainingModels = [];
let trainingDatasets = [];

/** Who is signed in, once `GET /auth/me` has said. Null until it has, or if nobody is. */
let trainingWhoami = null;

/**
 * Which task's panel is on screen.
 *
 * @returns {string} `det`, `cls` or `seg`.
 */
function activeTrainingTask() {
  const shown = $$('[data-viewof="task"]').find((panel) => !panel.hidden);

  return (shown && shown.dataset.view) || 'det';
}

/**
 * Section 3, from what the form actually has selected.
 *
 * **Every value here was a literal, and all of them contradicted the selections above.**
 * With `base-det=91` and `dataset-det=388` chosen, it read *"Registers
 * MARP-Multiclass-Det-XL 1.0.3"*, base *1.0.2*, dataset *ALL_Projects_Inverts_v5*,
 * *12,846* observations and *itravers* — none of it true, and none of it moving when the
 * selections did.
 *
 * **The version is the one thing that stays unsaid.** `ml_models` has no version column:
 * what the Models screen calls *v2* is a position in a `parent_model_id` chain, derived
 * by walking it. And the submitted spec names no output model at all — it names the base
 * and the dataset — so the form has no say in what the result is called. Writing a "next
 * patch version" would be inventing a number MARP cannot produce, which is the rule that
 * took out the worker selector and the duration estimate. The *Version name* input went
 * with it: nothing read it, and its hint promised a next patch version that does not
 * exist.
 *
 * @returns {void}
 */
function renderTrainingResult() {
  const byId = new Map(trainingModels.map((model) => [model.id, model]));
  const datasets = new Map(trainingDatasets.map((set) => [set.id, set]));

  const produces = {
    det: 'box and class metrics',
    cls: 'top-1 and per-class metrics',
    seg: 'box and mask metrics',
  };
  const named = { det: 'detection', cls: 'classification', seg: 'segmentation' };

  for (const task of ['det', 'cls', 'seg']) {
    const into = $(`[data-fills="result-${task}"]`);

    if (!into) continue;

    const base = byId.get(Number($(`#base-${task}`)?.value));

    if (!base) {
      into.innerHTML = '<span class="a">No base model chosen</span>'
        + `<span class="b">Pick a ${named[task]} model to fine-tune from.</span>`;
      continue;
    }

    /* Generation, not a version: it is the depth of the `parent_model_id` chain, which is
       the only thing MARP can say about where a model sits in a line. */
    const generation = modelGeneration(base, byId);

    into.innerHTML = `<span class="a">Registers a new ${named[task]} model from ${escapeHtml(base.name)}</span>`
      + `<span class="b">Generation v${generation + 1}, with ${produces[task]}</span>`
      + '<span class="b">MARP records no version number &mdash; the result is its own registry '
      + 'entry, named by the run that produces it</span>'
      + '<span class="b"><b>Not marked preferred</b> &mdash; that stays a human decision</span>';
  }

  const task = activeTrainingTask();
  const base = byId.get(Number($(`#base-${task}`)?.value));
  const set = datasets.get(Number($(`#dataset-${task}`)?.value));
  const trace = $('[data-fills="trace"]');

  const UNKNOWN = '<span class="dash" title="Nothing selected yet">&mdash;</span>';

  if (trace) {
    const observations = set && set.num_observations != null
      ? `${Number(set.num_observations).toLocaleString('en-US')}, by membership`
      : '<span class="dash" title="This dataset records no observation count">&mdash;</span>';

    trace.innerHTML = `<dt>Base</dt><dd>${base ? `${escapeHtml(base.name)} <span class="faint">generation v${modelGeneration(base, byId)}</span>` : UNKNOWN}</dd>`
      + `<dt>Dataset</dt><dd>${set ? escapeHtml(set.name) : UNKNOWN}</dd>`
      + `<dt>Observations</dt><dd>${observations}</dd>`
      /* The signed-in user, not a literal. `created_by` on the job is filled by the API
         from the session, so this is a statement about who is about to press the button
         rather than a guess at who it will be recorded as. */
      + `<dt>Run by</dt><dd>${trainingWhoami
        ? escapeHtml(trainingWhoami.name || trainingWhoami.username || `User ${trainingWhoami.id}`)
        : '<span class="dash" title="Not signed in, or the session could not be read">&mdash;</span>'}</dd>`;
  }

  const quad = $('[data-fills="dataset-quad"]');

  if (quad) {
    const cells = $$('span', quad);
    /* **Two of the four are columns on a Dataset and two are not.** Videos and dives are
       properties of what went into a build, not of the dataset row, and nothing records
       them -- so they take the dash rather than a plausible number. */
    const NOT_RECORDED = '<span class="dash" title="Not recorded on a dataset">&mdash;</span>';
    const values = [
      set && set.num_observations != null ? Number(set.num_observations).toLocaleString('en-US') : NOT_RECORDED,
      set && set.num_classes != null ? String(set.num_classes) : NOT_RECORDED,
      NOT_RECORDED,
      NOT_RECORDED,
    ];

    cells.forEach((cell, index) => {
      const b = $('b', cell);

      if (b) b.innerHTML = values[index] ?? NOT_RECORDED;
    });
  }
}

/**
 * Keep section 3 following the form.
 *
 * @returns {void}
 */
function wireTrainingResult() {
  if (!$('[data-fills="trace"]')) return;

  for (const id of ['base-det', 'base-cls', 'base-seg', 'dataset-det', 'dataset-cls', 'dataset-seg']) {
    $(`#${id}`)?.addEventListener('change', renderTrainingResult);
  }

  /* The task switcher hides and shows the panels rather than announcing itself, so the
     visible one is watched instead -- the same reason the expander is watched. */
  const panel = $('[data-viewof="task"]')?.parentElement;

  if (panel) {
    new MutationObserver(renderTrainingResult)
      .observe(panel, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  }

  if (window.MarpAccountMenu && typeof window.MarpAccountMenu.whoami === 'function') {
    window.MarpAccountMenu.whoami().then((user) => {
      trainingWhoami = user;
      renderTrainingResult();
    }).catch(() => { /* Not signed in reads as the dash, which is true. */ });
  }
}

const BASE_MODEL_TASKS = {
  'base-det': 'detection',
  'base-cls': 'classification',
  'base-seg': 'segmentation',
};

/**
 * The models the base-model selects were last filled from, by id.
 *
 * Kept because a job spec needs more of a model than its option carries: the name, the
 * sha256 of its weights that the worker checks its download against, and the task it was
 * trained for. Reading those back out of the option would mean parsing the label this
 * screen composes, which is a display string and free to change — and which is exactly
 * how the previous version of this renderer worked, until the text it recognised was
 * stripped out from under it.
 *
 * @type {Map<number, Object>}
 */
const registeredModels = new Map();

/**
 * Whether a registered model was trained for the task a panel is setting up.
 *
 * **An exact match on `model_type`, with nothing mapped onto anything.** Two rows in
 * MARP carry `YOLOv8` here — an architecture in a task column, written by a test — and
 * reading those as detection to make the list longer would be inventing a fact about a
 * model in order to offer it as a starting point. They match no task and appear nowhere.
 *
 * @param {Object} model - A row from `GET /api/v2/ml_models`.
 * @param {string} task - One of {@link BASE_MODEL_TASKS}'s values.
 * @returns {boolean}
 */
function modelDoesTask(model, task) {
  return String(model && model.model_type || '').trim().toLowerCase() === task;
}

/**
 * Puts the real registry and the real datasets into the setup form.
 *
 * Every one of these selectors was written out by hand: base models that are not in
 * `ml_models`, datasets that are not in `dataset`. A run configured from them names
 * things MARP cannot resolve.
 *
 * @param {Object[]} models - From `GET /api/v2/ml_models`.
 * @param {Object[]} datasets - From `GET /api/v2/dataset`.
 * @returns {void}
 */
function fillTrainingChoices(models, datasets) {
  registeredModels.clear();

  for (const model of models || []) registeredModels.set(Number(model.id), model);

  /* **This used to find its targets by reading the fake data.** It decided a select was
     a base-model picker when its options matched `/^MARP-[\w-]+ — |upstream/` — that is,
     when they were the invented names the mockup shipped. It worked, and only while the
     fiction was there: stripping those options, to stop the screen stating models MARP
     does not have, turned this into a function that matched nothing and filled nothing.

     The markup now says which selects a renderer owns, with `data-fills`. A mark is a
     statement somebody can check; a pattern that recognises last year's placeholder text
     is a guess that happens to be right. */
  const put = (id, options, empty) => {
    const select = $(`[data-fills="${id}"]`);
    if (!select) return;

    select.innerHTML = (options.length ? options : [`<option value="">${empty}</option>`]).join('');
  };

  /* **Filtered by task, and the two columns still do not mean what this screen once
     assumed.** `status` is not filtered on: every real model says `active`, which is not
     one of the four values the generated contract declares, so a status filter hides all
     of them. `model_type` is filtered on, now that there is a reason stronger than
     tidiness — a model of the wrong task does not fail, it silently trains the wrong
     thing.

     Measured against MARP: fourteen rows say `detection` and two say `YOLOv8`. So
     Classification and Segmentation come back empty, and that is the honest answer rather
     than a fault — there are no such models registered. The empty option says which,
     because an unexplained empty select reads as a broken screen. */
  const forTask = (task) => models
    .filter((m) => modelDoesTask(m, task))
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`);

  for (const [id, task] of Object.entries(BASE_MODEL_TASKS)) {
    put(id, forTask(task), `No ${task} model is registered`);
  }

  /* **No upstream-checkpoint option.** There was one per task, carrying a sentence as its
     value where every other option carries a model id — so it would have reached a job
     spec as `ml_model_id: "YOLO detection — upstream checkpoint"`. Registering a stock
     YOLO checkpoint is a real question and a parked one; until it is answered, a control
     that cannot do anything is not drawn. `trainingSubmission` still refuses a selection
     with no numeric id, which is what keeps this class of thing impossible rather than
     merely absent. */

  /* **The same list in all three, because a dataset does not record a task.** The base
     pickers filter on `model_type`; `datasets` has no equivalent column -- which is why
     the Task column was taken off the Datasets screen, Isaac: *"it'll never have a
     value"*. So these three are independent controls over one catalogue rather than three
     filtered views, and a reader choosing wrongly is refused at submission by
     `modelDoesTask`, which is where that can actually be caught. */
  const datasetOptions = datasets.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`);
  for (const id of ['dataset-det', 'dataset-cls', 'dataset-seg']) {
    put(id, datasetOptions, 'No dataset saved in MARP');
  }

  trainingModels = models;
  trainingDatasets = datasets;
  renderTrainingResult();
}
/**
 * What the training engine accepts, and nothing else.
 *
 * **Taken from the worker's own allow-list** in
 * `src/marp_inference_worker/engines/training_engine.py`, which reports anything outside
 * it as *ignored* rather than dropping it silently. So a parameter added here that the
 * worker does not know does not fail -- it arrives, is listed as ignored, and a reader
 * concludes the setting did nothing. That is worse than a refusal, which is why this list
 * is written out rather than assembled from whatever fields happen to be on the page.
 *
 * **`det-box`, `det-cls` and `det-dfl` are deliberately absent.** The detection loss
 * weights are not in the allow-list yet; the worker is being widened to take them
 * separately. Sending them now would put three ignored parameters on every run.
 *
 * Each entry says which element holds the value and how to read it. `number` and `flag`
 * are the two kinds; `pick` is for the selects whose options are prose rather than
 * values, which is most of them on this screen.
 *
 * @constant
 * @type {Array<{key: string, id: string, as: string, pick: Function}>}
 */
const TRAINING_PARAMS = [
  // The two that always go, from the shared row under the task panels.
  { key: 'epochs', id: 'epochs', as: 'number' },
  /* "Auto — 60% GPU memory" is Ultralytics' `batch: -1`. Spelling it out rather than
     sending the words, which would reach the engine as an unparsable batch size. */
  { key: 'batch', id: 'batch', as: 'pick', pick: (text) => (/^auto/i.test(text) ? -1 : Number(text)) },

  // Detection's own two. The task panels for cls and seg are not wired yet.
  { key: 'imgsz', id: 'det-size', as: 'number' },
  { key: 'single_cls', id: 'det-single', as: 'pick', pick: (text) => /one class/i.test(text) },

  /* Optimisation and stopping. "Auto" means the engine chooses, and the way to say that
     is to send nothing -- a literal "Auto" would be an optimiser name it cannot resolve. */
  { key: 'optimizer', id: 'opt', as: 'pick', pick: (text) => (/^auto/i.test(text) ? undefined : text) },
  { key: 'lr0', id: 'lr', as: 'pick', pick: (text) => (/^auto/i.test(text) ? undefined : Number(text)) },
  { key: 'weight_decay', id: 'decay', as: 'number' },
  { key: 'warmup_epochs', id: 'warm', as: 'number' },
  { key: 'patience', id: 'patience', as: 'number' },
  { key: 'seed', id: 'seed', as: 'number' },

  // The Advanced fold. All blank by default, so none of them is sent unless asked for.
  { key: 'lrf', id: 'lrf', as: 'number' },
  { key: 'momentum', id: 'momentum', as: 'number' },
  { key: 'freeze', id: 'freeze', as: 'number' },
  { key: 'workers', id: 'workers', as: 'number' },
  { key: 'cos_lr', id: 'cos-lr', as: 'flag' },
  { key: 'rect', id: 'rect', as: 'flag' },
];

/**
 * Reads the training form into the `spec.params` the worker understands.
 *
 * **Blank sends nothing, and that is the difference between this and a form with
 * defaults.** The engine's own defaults live in its repository; restating them here would
 * put a number on the screen that nothing can keep true, and sending them would make
 * every run look like somebody chose them. An omitted key is the engine deciding.
 *
 * A field holding something that is not a number is omitted too, rather than sent as
 * `NaN` -- which serialises to `null` and reaches the engine as a parameter with no
 * value.
 *
 * @param {Document|Element} [root] - Where to read from; the document by default.
 * @returns {Object} The parameters, ready for `spec.params`.
 */
function trainingParams(root) {
  const where = root || document;
  const params = {};

  for (const field of TRAINING_PARAMS) {
    const element = where.querySelector(`#${field.id}`);

    if (!element) continue;

    if (field.as === 'flag') {
      /* Only when ticked. An unticked box is "did not ask for it", not "asked for it
         off" -- and the engine's default for both of these is off anyway. */
      if (element.checked) params[field.key] = true;

      continue;
    }

    const raw = field.as === 'pick'
      ? (element.options[element.selectedIndex] || {}).text
      : element.value;

    if (raw === undefined || raw === null || String(raw).trim() === '') continue;

    const value = field.pick ? field.pick(String(raw).trim()) : Number(raw);

    if (value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;

    params[field.key] = value;
  }

  return params;
}

/**
 * What one training submission needs, read off the form, or why it cannot be made.
 *
 * **A spec names a model by id AND by checksum.** `validateSubmittedModel` requires
 * `spec.model.sha256`, because the worker hashes what it fetched and refuses a mismatch —
 * that check is the only thing standing between a job and training on whatever file
 * happens to sit at a path. So a model MARP has recorded no checksum for cannot be
 * submitted, and saying so here beats a 400 from the API that reads as a bug in this
 * screen.
 *
 * **The dataset is named by id alone**, on purpose: `submitTrainingJob` composes the
 * locator and the hash from `datasets.archive_sha256` itself. The model half is composed
 * here because that column reached `ml_models` later. If the server ever composes both,
 * this sends the id alone too and nothing else changes.
 *
 * **The upstream-checkpoint option is refused by this rather than special-cased.** Its
 * value is a sentence where every other option carries a model id, so it fails the same
 * check an empty selection does. Registering a stock checkpoint is a separate question
 * and this screen must not imply it is settled.
 *
 * @param {Document|Element} [root] - Where to read from; the document by default.
 * @returns {{body: Object}|{refusal: string}} One or the other, never both.
 */
function trainingSubmission(root) {
  const where = root || document;
  const value = (id) => {
    const element = where.querySelector(`#${id}`);

    return element ? element.value : null;
  };

  const modelId = Number(value('base-det'));

  if (!Number.isInteger(modelId) || modelId <= 0) {
    return {
      refusal: 'Choose a base model that MARP has registered. The upstream checkpoint is '
        + 'not one: nothing has registered those weights, so no worker could be told which '
        + 'file to fetch.',
    };
  }

  const model = registeredModels.get(modelId);

  if (!model) {
    return { refusal: `Model ${modelId} is no longer in the registry. Reload the page.` };
  }

  /* **The filter is what a person sees; this is what makes it true.** A checkpoint
     decides the task by itself and the engine is never told which task was asked for, so
     a detection model selected for a segmentation run trains a detector and the result is
     recorded as a segmentation model. Refusing here means that cannot happen through a
     stale page, a restored form or anything else that gets a selection past the filter. */
  if (!modelDoesTask(model, BASE_MODEL_TASKS['base-det'])) {
    return {
      refusal: `${model.name} is ${model.model_type ? `a ${model.model_type}` : 'an untyped'} `
        + 'model, and this is a detection run. The checkpoint decides the task on its own, '
        + 'so training would succeed and produce the wrong kind of model.',
    };
  }

  if (!model.artifact_sha256) {
    /* Null means the checksum is not known, which is not the same as the model being
       unusable — its weights are simply not on the machine that would have hashed them.
       Naming the script is the difference between a dead end and a next step. */
    return {
      refusal: `${model.name} has no recorded checksum, so a worker would have nothing to `
        + 'verify its weights against. Run scripts/backfill-model-artifact-sha256.js where '
        + 'the model store lives.',
    };
  }

  const datasetId = Number(value('dataset-det'));

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return { refusal: 'Choose a saved dataset to train on.' };
  }

  const name = (value('trname') || '').trim();

  return {
    body: {
      kind: 'training',
      // Omitted rather than invented when blank: MARP composes no fallback name.
      ...(name ? { name } : {}),
      spec: {
        engine: 'marp_training',
        model: {
          ml_model_id: model.id,
          name: model.name,
          /* Coordinator-relative, exactly as the server composes the dataset one, so a
             worker resolves it against whichever MARP it is enrolled with. */
          url: `/api/v2/model/${model.id}/artifact`,
          sha256: String(model.artifact_sha256).toLowerCase(),
        },
        // The id alone; the server fills in the locator and the archive hash.
        dataset: { dataset_id: datasetId },
        params: trainingParams(where),
      },
    },
  };
}

/**
 * Queues the detection run the form describes.
 *
 * **Classification and segmentation are deliberately not wired.** Their panels have
 * fields and no submission; detection goes end to end first, on a real dataset, and the
 * other two follow once it has.
 *
 * The button is disabled while the request is in flight, because the one thing worse than
 * a run that does not start is three of them that do.
 *
 * @returns {void}
 */
function wireStartTraining() {
  const button = $('#trainBtn');
  const status = $('[data-fills="train-status"]');

  if (!button || !window.MarpApi) return;

  const say = (text, kind) => {
    if (!status) return;

    status.textContent = text;
    status.dataset.state = kind || '';
  };

  button.addEventListener('click', async () => {
    const asked = trainingSubmission();

    if (asked.refusal) {
      say(asked.refusal, 'warning');

      return;
    }

    button.disabled = true;
    say('Queueing…');

    try {
      const queued = await window.MarpApi.submitJob(asked.body);
      const job = (queued.jobs || [])[0];

      /* The id, because it is what every other screen keys on and what somebody types
         into the Jobs filter when they want to know what became of this. */
      say(job && job.id
        ? `Queued as job ${job.id}. It appears below, and on the Jobs screen.`
        : 'Queued.', 'ok');

      renderTrainingScreen();
    } catch (error) {
      /* The API's own message rather than a sentence of this screen's: it is the one that
         says which field was wrong, and replacing it with "Could not queue" is how a
         person ends up guessing. */
      say(`Could not queue it (${error.status || 'no answer'}). ${error.message || ''}`.trim(),
        'warning');
    } finally {
      button.disabled = false;
    }
  });
}

/**
 * Fills the Training screen from the data layer.
 *
 * @returns {Promise<void>}
 */
async function renderTrainingScreen() {
  if (document.body.dataset.screen !== 'training' || !window.MarpApi) return;

  try {
    const [jobs, models, datasets, runs] = await Promise.all([
      /* **Filtered to training, which the poll has always done and this had not.** Two
         things turned on it. `best_map50` is a lateral the API computes only for a list
         filtered to training -- 22ms a page otherwise, spent deriving it for thousands of
         inference jobs that have no epochs and no such column -- so an unfiltered request
         comes back with the field absent and every Best mAP cell took that branch. And
         `renderTraining` discards everything that is not training anyway, so this was
         fetching 500 rows to keep eight of them.

         Safe for the issues rollup, which is the one thing here that reads the other
         kinds: it groups by `batch_id`, and no training job in the corpus has one -- no
         batch spans two kinds at all. */
      loadSessions().then(() => window.MarpApi.listJobs({ limit: 500, kind: 'training' })),
      window.MarpApi.listModels(),
      window.MarpApi.listDatasets(),
      /* Settled rather than awaited with the rest: the runs decorate the table and a
         screen that drew nothing because one read was slow would be worse than one whose
         rows cannot be expanded. */
      window.MarpApi.listTrainingRuns().catch(() => []),
    ]);

    /* Newest first from the route, so the first run seen for a job is its latest. */
    trainingRunsByJob = new Map();
    modelByTrainingRun = new Map();

    for (const model of models) {
      if (model.training_run_id != null) modelByTrainingRun.set(model.training_run_id, model);
    }

    for (const run of runs) {
      if (run.job_id != null && !trainingRunsByJob.has(run.job_id)) trainingRunsByJob.set(run.job_id, run);
    }

    /* **Before `renderTraining`, because the rows read it.** The Task cell comes from the
       base model's `model_type`, and this used to be filled by `fillTrainingChoices`
       afterwards -- so every row was built against an empty map and drew a dash. */
    trainingModelsById = new Map(models.map((model) => [model.id, model]));

    renderTraining(jobs.jobs);
    fillTrainingChoices(models, datasets);
    /* After `renderTraining`, which is what fills `trainingViewsByJob`. */
    fillTrainingRuns(runs, trainingViewsByJob);
    watchTrainingJobs();
    wireTrainingResult();
  } catch (error) {
    const body = $('.training-table tbody');
    if (body) {
      body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="11">Could not load training jobs (${error.status || 'no answer'}).</td></tr>`;
    }
  }
}

/**
 * Keep the Training table current while anything is still going.
 *
 * **The dataset builder's cadence and the dataset builder's rule.** Isaac asked for this
 * screen to behave *"just like we do for the dataset builder"*, which means two things
 * and the second is the one that is easy to lose: every five seconds, and **patched** --
 * the rows are written into, never rebuilt around, because a rebuild closes the row
 * somebody is reading. That was a real defect on Datasets and it would be the same defect
 * here.
 *
 * Stops itself when nothing is queued or leased, so a screen of finished jobs makes no
 * requests at all. A newly queued job restarts it on the next render.
 *
 * @returns {void}
 */
let trainingWatch = null;

function watchTrainingJobs() {
  const body = $('.training-table tbody');

  if (!body || !window.MarpApi) return;

  const live = (view) => view.state === 'queued' || view.state === 'running' || view.state === 'leased';

  if (trainingWatch) { clearTimeout(trainingWatch); trainingWatch = null; }

  /* Nothing moving, nothing to ask about. */
  if (![...trainingViewsByJob.values()].some(live)) return;

  trainingWatch = setTimeout(async function again() {
    try {
      const [jobs, runs] = await Promise.all([
        window.MarpApi.listJobs({ limit: 500, kind: 'training' }),
        window.MarpApi.listTrainingRuns().catch(() => []),
      ]);

      /* A run can appear part-way through, which is the moment the panel stops saying
         there is none and starts drawing curves. */
      for (const run of runs) {
        if (run.job_id != null && !trainingRunsByJob.has(run.job_id)) trainingRunsByJob.set(run.job_id, run);
      }

      const issues = batchesWithIssues(jobs.jobs);
      const fresh = new Map(jobs.jobs.map((job) => [job.id, jobView(job, issues)]));

      /* Only rows that are on the page: paging and filtering are the table's business. */
      for (const [id, view] of fresh) {
        if (trainingViewsByJob.has(id)) trainingViewsByJob.set(id, view);
      }

      patchJobRows(body, trainingViewsByJob);

      /* The runs panel is the same rows seen a second way, so it is patched rather than
         redrawn for the same reason: a rebuild closes the expansion somebody is reading. */
      const runsBody = $('#runs tbody');

      if (runsBody) patchJobRows(runsBody, trainingViewsByJob);
    } catch {
      /* A poll that fails is a blip. The last good answer stays on screen, which is
         better than replacing a table somebody is reading with an error. */
    }

    trainingWatch = [...trainingViewsByJob.values()].some(live)
      ? setTimeout(again, TRAINING_EPOCH_POLL_MS)
      : null;
  }, TRAINING_EPOCH_POLL_MS);
}

/* ---------------------------------------------------- the Training runs panel */

/**
 * What the Training runs panel is showing.
 *
 * Client-side, because everything it filters over is already on the screen: the runs
 * came from `GET /training_run` and the jobs from the one `kind=training` read the
 * table above also uses. A server-side filter would be a second round trip for a list
 * of six.
 */
const runsQuery = { search: '', status: 'all', page: 1, perPage: PAGE_SIZES[0] };

/** Every run, newest first, as the panel sorts and filters it. */
let trainingRunRows = [];

/**
 * One run, reduced to what the panel shows, sorts and searches on.
 *
 * **Every column comes from data the screen already has.** This panel was a fixture --
 * an empty `<tbody>` under a footer hardcoded to *"Showing 1-6 of 28 runs"* and three
 * dead pager buttons -- and the reason given for it was that `/v2/training_run` had
 * only a `POST`. #260 added the collection read and the job list carries the rest, so
 * the only thing still missing was this function.
 *
 * **Epochs come from the attempt, not from `total_epochs`.** `progress_done` persists
 * after a job ends and equals the epoch rows exactly, including where a run was
 * stopped early -- run 203 is 8 of 10. `total_epochs` is what was *configured*, so a
 * finished run reading 10 of 10 from it would be a guess that happens to be right most
 * of the time and silently wrong on every cancellation.
 *
 * @param {Object} run - A `training_runs` row.
 * @param {Object|null} view - The job view for `run.job_id`, when the job is in the list.
 * @returns {Object} The row model.
 */
function trainingRunView(run, view) {
  const job = view ? view.job : null;
  const spec = (job && job.spec) || {};
  const started = Date.parse(run.start_time || (job && job.created_at) || '') || 0;

  /* The run's own clock where it has one. A cancelled run has a start and no end, so
     the job's wall clock stands in and the cell says which it is. */
  const ownMs = run.end_time && run.start_time
    ? Date.parse(run.end_time) - Date.parse(run.start_time)
    : null;
  const jobMs = job && job.updated_at && job.created_at
    ? Date.parse(job.updated_at) - Date.parse(job.created_at)
    : null;

  const counted = /epoch/i.test((job && job.progress_unit) || '');
  const done = counted ? Number(job.progress_done) : NaN;
  const total = counted ? Number(job.progress_total) : Number(run.total_epochs);

  return {
    run,
    view,
    job,
    spec,
    started,
    ownMs,
    jobMs,
    done: Number.isFinite(done) ? done : null,
    total: Number.isFinite(total) && total > 0 ? total : null,
    state: view ? view.state : 'queued',
    label: view ? view.label : 'No job',
    /* One lower-cased haystack per row, built once. The search box filters the model
       rather than the rendered cells, because a filter that reads the DOM can only
       filter the page it can see -- the same reason `jobView` exists. */
    find: [
      view && view.title,
      spec.dataset && spec.dataset.name,
      spec.model && spec.model.name,
      `run ${run.id}`,
      job && `job ${job.id}`,
      run.optimizer,
      run.compute_device,
    ].filter(Boolean).join(' ').toLowerCase(),
  };
}

/**
 * Draw the Training runs panel from the runs and jobs already loaded.
 *
 * @returns {void}
 */
function renderTrainingRuns() {
  const table = $('#runs');
  const body = table && $('tbody', table);

  if (!body) return;

  const panel = table.closest('.panel');
  const search = runsQuery.search.trim().toLowerCase();
  const matching = trainingRunRows.filter((row) => (runsQuery.status === 'all'
    || row.state === runsQuery.status)
    && (!search || row.find.includes(search)));

  const pages = Math.max(1, Math.ceil(matching.length / runsQuery.perPage));

  if (runsQuery.page > pages) runsQuery.page = pages;

  const from = (runsQuery.page - 1) * runsQuery.perPage;
  const shown = matching.slice(from, from + runsQuery.perPage);

  body.innerHTML = shown.length
    ? shown.map((row) => {
      const { run, job, spec } = row;
      const progress = job ? progressCell(job, row.state) : { html: NO_RUN_RECORDED, sort: -1 };
      const map = job ? bestMap(job, run) : { html: NO_RUN_RECORDED, sort: -1 };
      const took = row.ownMs !== null
        ? `<span title="From this run's own start and end times">${tookText(row.ownMs)}</span>`
        : (row.jobMs !== null
          ? `<span class="faint" title="This run recorded no end time, so this is its job's wall clock">${tookText(row.jobMs)}</span>`
          : '<span class="dash" title="Nothing recorded an end">&mdash;</span>');

      return `<tr data-job="${job ? job.id : ''}" data-run="${run.id}">`
        + '<td class="ex"><button class="exbtn" type="button" aria-label="Show this run"><svg class="ico sm"><use href="#i-right"/></svg></button></td>'
        + `<td class="jname" title="${escapeHtml(row.view ? row.view.title : `Run ${run.id}`)}">`
        + `<span class="name"><svg class="ico training"><use href="#i-training"/></svg>`
        + `<span class="t">${row.view ? row.view.title : `Run ${run.id}`}</span></span></td>`
        + `<td class="jdset">${namedById('Dataset', spec.dataset, run.dataset_id,
          run.dataset_id ? `./datasets.html?dataset=${encodeURIComponent(run.dataset_id)}` : '')}</td>`
        /* Same rule as the table above: a run registers a version only once it has
           succeeded, so an unfinished one has nothing to name here. */
        + `<td class="jmakes">${['done', 'issues'].includes(row.state)
          ? producedModelCell(run)
          : '<span class="dash" title="The version a run registers does not exist until it succeeds">&mdash;</span>'}</td>`
        + `<td class="jstatus" data-sort="${JOB_STATE_RANK[row.state]}">`
        + `<span class="st" data-state="${row.state}"><span class="dot"></span>${row.label}</span></td>`
        + `<td class="jprog" data-sort="${progress.sort}">${progress.html}</td>`
        + `<td class="jepochs num" data-sort="${row.done ?? -1}">${row.done === null
          ? '<span class="dash" title="This run&apos;s job did not report its progress in epochs">&mdash;</span>'
          : `<span title="${row.total ? `of ${row.total} configured` : 'configured epochs not recorded'}">${row.done}${row.total ? ` / ${row.total}` : ''}</span>`}</td>`
        + `<td class="jmap num" data-sort="${map.sort}">${map.html}</td>`
        + `<td class="jtime" data-sort="${row.started}">${row.started
          ? `<span class="two"><span class="a">${new Date(row.started).toTimeString().slice(0, 5)}</span>`
            + `<span class="b">${new Date(row.started).toISOString().slice(0, 10)}</span></span>`
          : '<span class="dash" title="This run recorded no start time">&mdash;</span>'}</td>`
        + `<td class="jtook num" data-sort="${row.ownMs ?? row.jobMs ?? -1}">${took}</td>`
        + '</tr>';
    }).join('')
    : '<tr class="tblmsg"><td class="empty" colspan="10">No training runs match these filters.</td></tr>';

  /* The same two rows per run the table above builds, so one expansion serves both:
     `wireTrainingJobDetail` reads `data-job` and knows nothing about which table it
     was called from. */
  for (const head of $$(':scope > tr[data-job]', body)) {
    head.classList.add('runrow-head');
    head.setAttribute('aria-expanded', 'false');

    const detail = document.createElement('tr');

    detail.className = 'runrow-body';
    detail.hidden = true;
    detail.innerHTML = '<td colspan="10"><div class="rundetail jobdetail"><p class="hint">Reading this run&hellip;</p></div></td>';
    head.after(detail);

    wireTrainingJobDetail(head, detail);
  }

  wireAccordions();
  renderTrainingRunsHeader(panel, matching.length, from, shown.length, pages);
}

/**
 * The run panel's count, its footer and its pager, from what was drawn.
 *
 * @param {Element} panel - The runs panel.
 * @param {number} total - Rows matching the filters.
 * @param {number} from - Index of the first row shown.
 * @param {number} shown - How many were drawn.
 * @param {number} pages - How many pages the filtered list has.
 * @returns {void}
 */
function renderTrainingRunsHeader(panel, total, from, shown, pages) {
  if (!panel) return;

  const count = $('.panel-hd .count', panel);

  if (count) count.textContent = `(${total.toLocaleString()})`;

  drawPager($('.panel-ft', panel), runsQuery, {
    total, from, count: shown, pages, noun: 'run', empty: 'No training runs match these filters', redraw: renderTrainingRuns,
  });
}

/**
 * Build the panel's row models and wire its controls. Called once per screen load.
 *
 * @param {Object[]} runs - Every `training_runs` row, newest first.
 * @param {Map<number, Object>} views - Job views by job id.
 * @returns {void}
 */
function fillTrainingRuns(runs, views) {
  trainingRunRows = runs
    .map((run) => trainingRunView(run, views.get(run.job_id) || null))
    .sort((a, b) => b.started - a.started || b.run.id - a.run.id);

  const table = $('#runs');
  const panel = table && table.closest('.panel');

  if (!panel) return;

  /* The options are declared in the markup and cover every state, the way the Jobs
     screen's do. Filling them from the states present would make the filter's own
     contents move with the data -- Running would be absent until something ran. */
  const select = $('.sel', panel);

  if (select && !select.dataset.wired) {
    select.dataset.wired = 'yes';
    select.addEventListener('change', () => {
      runsQuery.status = select.value;
      runsQuery.page = 1;
      renderTrainingRuns();
    });
  }

  const box = $('.search input', panel);

  if (box && !box.dataset.wired) {
    box.dataset.wired = 'yes';
    box.addEventListener('input', () => {
      runsQuery.search = box.value;
      runsQuery.page = 1;
      renderTrainingRuns();
    });
  }

  const expand = $('.panel-tools .btn', panel);

  if (expand && !expand.dataset.wired) {
    expand.dataset.wired = 'yes';
    /* Only the rows on this page, which is what is in the DOM -- "all" across a
       filtered list of hundreds would be a request per run for curves nobody asked
       for. */
    expand.addEventListener('click', () => {
      for (const head of $$('#runs tbody > tr.runrow-head')) {
        if (head.getAttribute('aria-expanded') !== 'true') $('.exbtn', head)?.click();
      }
    });
  }


  renderTrainingRuns();
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
          /* **The line and the frame range, which nothing else can supply.** The picker
             was rewritten to read the real Jellyfin library and these went with the old
             markup, while `choiceParts` kept reading selectors for them -- so every
             target it produced had no line, and a line is half of what places a session.
             The range went the same way, leaving no way to run part of a video at all.

             Blank frames mean the whole video, and MARP says what it worked that out to
             be rather than this screen guessing at a length it cannot know. */
          + '<div class="video-scope">'
          + '<label class="line-entry">Line<input class="inp" type="text" inputmode="numeric"'
          + ` aria-label="Line for ${escape(file.name)}" placeholder="e.g. 4"></label>`
          + '<label>From frame<input class="inp" type="number" min="0" step="1" data-start-frame'
          + ` aria-label="First frame of ${escape(file.name)}" placeholder="start"></label>`
          + '<label>To frame<input class="inp" type="number" min="1" step="1" data-end-frame'
          + ` aria-label="Last frame of ${escape(file.name)}" placeholder="whole video"></label>`
          + '</div>'
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
 * One list of what was found: a total, then each species with its count (#288).
 *
 * **Grouped by species, with the model's own words kept.** The route groups by species and
 * by the name the model reported, because a review correction changes the first and never
 * the second -- so one species can arrive as two rows. They are summed here into one line,
 * and where the model called it something else that is said beside it, because that
 * disagreement is the interesting part.
 *
 * **Zero is an answer.** A piece that ran every frame and found nothing says 0, which is
 * a different fact from a piece nobody has counted.
 *
 * @param {string} title - What this list covers.
 * @param {Object} outcome - From `jobObservations` or `batchObservations`.
 * @param {string} [note] - How far the work it counts has got.
 * @returns {string}
 */
function findingsSection(title, outcome, note = '') {
  const total = Number(outcome.observations) || 0;
  const groups = new Map();

  for (const row of outcome.species || []) {
    const key = row.species_id ?? `reported:${row.reported_name ?? ''}`;
    const group = groups.get(key) || {
      name: row.species_name || row.reported_name || 'Species not resolved', count: 0, reported: new Set(),
    };
    group.count += Number(row.observations) || 0;
    if (row.species_name && row.reported_name && row.reported_name !== row.species_name) group.reported.add(row.reported_name);
    groups.set(key, group);
  }

  const list = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const most = Math.max(1, ...list.map((group) => group.count));
  const rows = list.map((group) => `<li><b>${escapeHtml(group.name)}</b>`
    + `<span class="findbar"><i style="width:${Math.max(2, Math.round(group.count / most * 100))}%"></i></span>`
    + `<strong>${group.count.toLocaleString()}</strong>`
    + `${group.reported.size ? `<small>reported as ${[...group.reported].map(escapeHtml).join(', ')}</small>` : ''}</li>`).join('');

  return `<section class="findings"><h4>${title}</h4>`
    + `<p>${countOf(total, 'observation')}${note ? ` &middot; ${note}` : ''}</p>`
    + `${rows ? `<ol class="findlist">${rows}</ol>` : ''}</section>`;
}

/**
 * A time in a video, as the reviewer reads one: `1:05:03`, or `5:03` under an hour.
 *
 * @param {number|null} seconds - Seconds into the video.
 * @returns {string}
 */
function videoClock(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '?';
  const total = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Which video, which stretch of it, and where that sits in the whole (#288, with #293).
 *
 * **Isaac: *"I can't even tell what section of video is ran."*** The row said the dive and
 * the line; nothing said which video or which minutes of it. This names the video, says
 * the piece's range as time in that video, and draws the video as a strip with every
 * piece of the run on it in its state, this piece outlined, so a run reads as how much of
 * the video is done.
 *
 * @param {Object} timeline - From `jobTimeline` or `batchTimeline`.
 * @param {number} jobId - The piece this row is, to outline.
 * @returns {string}
 */
function videoWhereSection(timeline, jobId) {
  const { video, pieces } = timeline;
  const piece = pieces.find((one) => one.job_id === jobId) || pieces[0];
  const length = video.duration_s || Math.max(0, ...pieces.map((one) => one.end_s || 0));
  const at = (seconds) => (length ? Math.max(0, Math.min(100, (seconds / length) * 100)) : 0);
  const STATE = { succeeded: 'done', leased: 'running', queued: 'queued', failed: 'failed', cancelled: 'cancelled', expired: 'cancelled' };

  const strip = length
    ? pieces.map((one) => `<i class="${STATE[one.state] || 'queued'}${one.job_id === piece.job_id ? ' this' : ''}"`
      + ` style="left:${at(one.start_s || 0).toFixed(2)}%;width:${Math.max(0.4, at(one.end_s || 0) - at(one.start_s || 0)).toFixed(2)}%"`
      + ` title="${videoClock(one.start_s)}–${videoClock(one.end_s)} · ${escapeHtml(one.state)}"></i>`).join('')
    : '';

  const frames = piece.start_frame !== null && piece.end_frame !== null
    ? ` &middot; frames ${piece.start_frame.toLocaleString()}–${piece.end_frame.toLocaleString()}${video.fps ? ` at ${Number(video.fps.toFixed(3))} fps` : ''}`
    : '';

  return '<section class="video-where">'
    + `<h4>${escapeHtml(video.name || 'Video not named')}</h4>`
    + `<p>This piece: <b>${videoClock(piece.start_s)}–${videoClock(piece.end_s)}</b>${length ? ` of ${videoClock(length)}` : ''}${frames}</p>`
    + (strip ? `<div class="video-strip" role="img" aria-label="Where this piece and the rest of its run sit in the video">${strip}</div>`
      + `<div class="video-strip-axis"><span>0:00</span><span>${videoClock(length)}</span></div>` : '')
    + '</section>';
}

/**
 * Species over the video's time: a row per species, shaded by how many were seen when.
 *
 * **Normalised per species**, so a species seen four times shows where its four were
 * beside one seen four hundred; the hover gives the real count. A stretch with nothing
 * in it is drawn empty rather than left out, so a gap in the finds reads as a gap.
 *
 * @param {Object} timeline - From `jobTimeline` or `batchTimeline`.
 * @param {number} jobId - The piece this row is, marked on a run's chart.
 * @returns {string}
 */
function speciesOverTime(timeline, jobId) {
  const { species, bucket_s: bucket, span, pieces } = timeline;
  if (!species.length) return '';

  const shown = species.slice(0, 12);
  const buckets = shown[0].counts.length;
  const labels = Array.from({ length: buckets }, (_, index) => videoClock(span.from_s + index * bucket));
  const data = shown.flatMap((one, row) => {
    const most = Math.max(1, ...one.counts);
    return one.counts.map((count, column) => [column, row, count / most, count]);
  });

  const theme = chartTheme();
  const piece = pieces.find((one) => one.job_id === jobId);
  const mark = piece && pieces.length > 1 && piece.start_s !== null
    ? [[{ xAxis: Math.floor((piece.start_s - span.from_s) / bucket) }, { xAxis: Math.max(0, Math.ceil((piece.end_s - span.from_s) / bucket) - 1) }]]
    : [];

  const option = {
    /* Room above the rows for the zoom icons, which otherwise sit on the first species. */
    grid: { left: 130, right: 16, top: 30, bottom: 40 },
    legend: { show: false },
    xAxis: { type: 'category', data: labels, name: 'Time in the video', nameLocation: 'middle', nameGap: 26, ...theme.axis, splitLine: { show: false } },
    yAxis: { type: 'category', data: shown.map((one) => one.name), inverse: true, ...theme.axis, splitLine: { show: false } },
    visualMap: { show: false, dimension: 2, min: 0, max: 1, inRange: { color: ['rgba(1, 6, 14, 0.5)', chartKey('curve-mean').color] } },
    tooltip: {
      ...theme.tooltip, trigger: 'item',
      formatter: (item) => `${escapeHtml(shown[item.value[1]].name)}<br>${labels[item.value[0]]}–${videoClock(span.from_s + (item.value[0] + 1) * bucket)}: `
        + `<b>${item.value[3].toLocaleString()}</b>`,
    },
    dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
    series: [{
      id: 'density', type: 'heatmap', data,
      itemStyle: { borderColor: 'rgba(1, 6, 14, 0.9)', borderWidth: 1 },
      markArea: mark.length ? { silent: true, itemStyle: { color: 'transparent', borderColor: theme.text.color, borderWidth: 1 }, data: mark } : undefined,
    }],
  };

  const more = species.length > shown.length ? ` &middot; the ${shown.length} most common of ${species.length}` : '';

  return '<section class="findings species-time">'
    + `<h4>${pieces.length > 1 ? 'When in the video, across the run' : 'When in this piece'}</h4>`
    + `<p>Each row shaded against its own busiest ${videoClock(bucket)}${more}${mark.length ? ' &middot; this piece outlined' : ''}</p>`
    + chartSlot(option, `Species over time, ${bucket} seconds a column`, { height: Math.max(180, shown.length * 26 + 80) })
    + '</section>';
}

/** Whole runs' totals by `batch_id`, so a second open of the same run is not a second read. */
const inferenceRunOutcomes = new Map();

/**
 * Fill an open Inference row with what its piece found, and what its whole run found.
 *
 * **Read when the row is opened, and again on each poll while it stays open**: a running
 * piece and a running run keep finding things, and their counts are labelled *so far*
 * until every piece has finished, so a number that is still moving never reads as a total.
 *
 * @param {Element} place - The detail's `[data-inference-findings]` element.
 * @returns {Promise<void>}
 */
async function fillInferenceFindings(place) {
  if (!window.MarpApi) return;

  const jobId = Number(place.dataset.inferenceFindings);
  const batch = place.dataset.batch;
  const { state } = place.dataset;
  const finished = ['done', 'issues', 'failed', 'cancelled', 'expired'].includes(state);
  const sections = [];
  let session = null;

  if (state === 'queued') {
    sections.push('<section class="findings"><h4>This piece</h4><p>Not run yet, so nothing found yet.</p></section>');
  } else {
    try {
      const piece = finished && inferenceOutcomes.has(jobId)
        ? inferenceOutcomes.get(jobId)
        : await window.MarpApi.jobObservations(jobId);
      if (finished) inferenceOutcomes.set(jobId, piece);
      session = piece.session_id;
      sections.push(findingsSection('This piece', piece, finished ? '' : 'so far, while it runs'));
    } catch (error) {
      sections.push(`<section class="findings"><h4>This piece</h4><p class="faint">Could not read what it found (${error.status || 'no answer'}).</p></section>`);
    }
  }

  if (batch) {
    try {
      const run = inferenceRunOutcomes.get(batch) && inferenceRunOutcomes.get(batch).done
        ? inferenceRunOutcomes.get(batch).outcome
        : await window.MarpApi.batchObservations(batch);
      const states = run.states || {};
      const going = (states.queued || 0) + (states.leased || 0);
      const succeeded = states.succeeded || 0;
      inferenceRunOutcomes.set(batch, { outcome: run, done: going === 0 });
      session = run.session_id ?? session;
      /* What became of the pieces that did not finish, so "2 of 5" is not left to read as
         three still to come when they were cancelled. */
      const ended = [['failed', 'failed'], ['cancelled', 'cancelled'], ['expired', 'expired']]
        .filter(([key]) => states[key]).map(([key, word]) => `${states[key].toLocaleString()} ${word}`);
      sections.push(findingsSection(`The whole run &middot; ${countOf(run.pieces, 'piece')}`, run,
        [`${succeeded.toLocaleString()} of ${run.pieces.toLocaleString()} finished`, ...ended, ...(going ? ['so far'] : [])].join(', ')));
    } catch (error) {
      sections.push(`<section class="findings"><h4>The whole run</h4><p class="faint">Could not read what it found (${error.status || 'no answer'}).</p></section>`);
    }
  }

  /* **Which video, which stretch, and when things were found.** The run's timeline when
     this is one piece of a run, since it carries this piece as well; the piece's own
     otherwise. Read with the counts, each open, so a running run's strip keeps moving. */
  let where = '';
  let density = '';
  try {
    const time = batch ? await window.MarpApi.batchTimeline(batch) : await window.MarpApi.jobTimeline(jobId);
    where = videoWhereSection(time, jobId);
    density = speciesOverTime(time, jobId);
  } catch (error) {
    where = `<section class="video-where"><p class="faint">Could not read which video this ran on (${error.status || 'no answer'}).</p></section>`;
  }

  /* Into the mosaic, filtered to the run's session: a run makes its own session, so that
     is this run's observations and nothing else. Offered only when there is one. */
  place.innerHTML = `${where}<div class="findings-grid">${sections.join('')}</div>${density}`;
  const anything = $$('.findlist li', place).length > 0;
  if (session && anything) {
    place.insertAdjacentHTML('beforeend', `<p class="findings-go"><a class="btn sm" href="/apps/marp-mosaic-review/?session=${session}">`
      + 'Review these in the mosaic</a></p>');
  }
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
/** The Inference table's page, and every job it pages through. */
const inferenceList = { page: 1, perPage: PAGE_SIZES[0], views: [] };

function renderInferenceRecent(views = inferenceList.views) {
  const table = $('.inference-table');
  if (!table) return;

  inferenceList.views = views;

  const body = $('tbody', table);
  /* **In flight first, then newest.** Every failure used to outrank every success, so six
     September failures filled the table and the seven runs that succeeded today could
     not be reached from here at all. A failure keeps its place in *Needs attention*. */
  const live = (view) => (['running', 'queued'].includes(view.state) ? 0 : 1);
  const ordered = views
    .slice()
    .sort((a, b) => (live(a) - live(b))
      || (Date.parse(b.job.updated_at) - Date.parse(a.job.updated_at)));

  /* **Every inference job, a page at a time.** This was cut to six rows, so a run of 28
     pieces filled all six with work in flight and every finished job vanished from the
     tab -- Isaac: *"an inference job that's done is still an inference job"*. Paged rather
     than drawn whole because each finished row reads its own detection count, and five
     hundred rows would be five hundred reads. */
  const { shown, from, pages } = pageOf(ordered, inferenceList);
  drawPager(table.closest('.panel')?.querySelector('.panel-ft'), inferenceList, {
    total: ordered.length, from, count: shown.length, pages, noun: 'inference job', empty: 'No inference jobs yet',
    redraw: () => renderInferenceRecent(),
  });

  const heading = $('.inference-recent .panel-hd h2');
  if (heading) heading.textContent = `Recent inference jobs (${views.length.toLocaleString()})`;

  body.innerHTML = shown.map((view) => {
    const { job, session } = view;
    const started = new Date(job.created_at);
    const tookMs = Math.max(0, Date.parse(job.updated_at) - Date.parse(job.created_at));
    const terminal = ['done', 'issues', 'failed', 'cancelled', 'expired'].includes(view.state);

    /* **Expands onto what it found** (#288): the piece's species, and its whole run's when
       it is one piece of a split video. */
    return `<tr class="runrow-head" aria-expanded="false" data-job="${job.id}">`
      + `<td class="ex"><button class="exbtn" type="button" aria-label="Show what ${escapeHtml(view.title)} found"><svg class="ico sm"><use href="#i-right"/></svg></button></td>`
      + `<td class="jname"><span class="name"><svg class="ico inference"><use href="#i-inference"/></svg><span class="t">${view.title}</span></span></td>`
      + `<td class="jscope"><span class="two"><span class="a">${session.dive ? diveText(session.dive) : 'Dive ?'} &middot; Line ${session.line || '?'}</span><span class="b">${[session.type, job.spec && job.spec.range ? `frames ${Number(job.spec.range.start_frame).toLocaleString()}–${Number(job.spec.range.end_frame).toLocaleString()}` : ''].filter(Boolean).join(' &middot; ')}</span></span></td>`
      + `<td class="jmodel"><span class="two"><span class="a">${view.model}</span><span class="b">${view.reduction}</span></span></td>`
      + `<td class="jstatus" data-sort="${JOB_STATE_RANK[view.state]}">${statusWithProgress(view)}</td>`
      /* **A dash until asked, then whatever the answer is -- including zero.** Nothing
         rolls detections onto the job row itself, so this used to be a permanent dash
         (gap 11). `GET /gpu/jobs/:id/observations` answers it now, and is asked for the
         jobs on this page once they are finished; until that lands there is no
         measurement, and a 0 would claim one. */
      + '<td class="jdet">' + NOT_COUNTED + '</td>'
      + `<td class="jtime" data-sort="${job.created_at}"><span class="two"><span class="a">${started.toTimeString().slice(0, 5)}</span><span class="b">${started.toISOString().slice(0, 10)}</span></span></td>`
      + `<td class="jtook num" data-sort="${tookMs}">${terminal ? tookText(tookMs) : '<span class="dash">&mdash;</span>'}</td>`
      /* The Open arrow that stood here opened nothing; the row's expander does now. */
      + '<td class="jacts"></td>'
      + '</tr>'
      + `<tr class="runrow-body" hidden><td colspan="9"><div class="rundetail" data-inference-findings="${job.id}"`
      + ` data-batch="${job.batch_id || ''}" data-state="${view.state}"><p class="faint">Opening the row reads what it found.</p></div></td></tr>`;
  }).join('');

  /* However it is opened, the row's `hidden` is what changes, so that is what is watched. */
  $$('[data-inference-findings]', body).forEach((place) => {
    const detail = place.closest('tr.runrow-body');
    new MutationObserver(() => { if (!detail.hidden) fillInferenceFindings(place); })
      .observe(detail, { attributes: true, attributeFilter: ['hidden'] });
  });

  fillInferenceOutcomes(body, shown);
  watchInference();
}

/**
 * The status cell, carrying progress while a job is running.
 *
 * **`progressCell` rather than a second formatter**, because it already holds the one
 * decision that matters here: a job with no heartbeat yet has no measurement, and a 0%
 * bar would claim one.
 *
 * @param {Object} view - A job view.
 * @returns {string} The cell's inner HTML.
 */
function statusWithProgress(view) {
  const pill = `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`;

  if (view.state !== 'running') return pill;

  return pill + progressCell(view.job, view.state).html;
}

/** Jobs whose outcome has already been asked for, so a poll does not ask again. */
const inferenceOutcomes = new Map();

/**
 * Fill in what each finished run on the page produced.
 *
 * **Only the rows that are drawn, and only once each.** Six rows is six reads, which is
 * fine; the whole table would not be, and nothing rolls these counts onto the job list
 * for MARP to send in one answer.
 *
 * **Only finished jobs.** A running job's count is still moving, and a number that is
 * true for a moment reads as a total.
 *
 * @param {Element} body - The table body.
 * @param {Array<Object>} views - The views drawn into it.
 * @returns {Promise<void>}
 */
async function fillInferenceOutcomes(body, views) {
  if (!window.MarpApi || !window.MarpApi.jobObservations) return;

  const terminal = views.filter((view) => ['done', 'issues'].includes(view.state));

  await Promise.all(terminal.map(async (view) => {
    const id = view.job.id;

    if (!inferenceOutcomes.has(id)) {
      try {
        inferenceOutcomes.set(id, await window.MarpApi.jobObservations(id));
      } catch {
        /* Left unanswered rather than recorded as none: the dash stays, which says
           nobody knows, where a 0 would say the run found nothing. */
        return;
      }
    }

    paintOutcome(body, id, inferenceOutcomes.get(id));
  }));
}

/**
 * Write one run's outcome onto its row.
 *
 * @param {Element} body - The table body.
 * @param {number} jobId - The job.
 * @param {Object} outcome - What `jobObservations` answered.
 * @returns {void}
 */
function paintOutcome(body, jobId, outcome) {
  const row = $(`tr[data-job="${CSS.escape(String(jobId))}"]`, body);

  if (!row || !outcome) return;

  const cell = $('.jdet', row);

  if (cell) {
    const total = Number(outcome.observations) || 0;
    /* The species it found, on the cell's title rather than in it: the column is one
       number wide and the breakdown is what somebody asks for second. */
    const breakdown = (outcome.species || [])
      .map((row2) => `${row2.species_name || row2.reported_name || 'unresolved'}: ${row2.observations}`)
      .join(', ');

    cell.dataset.sort = String(total);
    cell.innerHTML = total === 0
      /* **Zero is an answer, and says so.** A run that completed every frame and detected
         nothing is not the same as a run nobody has asked about, and the dash beside it
         means the second. */
      ? '<span class="num" title="This run completed and detected nothing">0</span>'
      : `<span class="num"${breakdown ? ` title="${escapeHtml(breakdown)}"` : ''}>${total.toLocaleString()}</span>`;
  }

  /* **Into the mosaic, filtered to this run.** Exact because of the session rule: a run
     makes its own session, so `?session=N` is this run's observations and nothing else.
     Offered only when there is something to look at. */
  const acts = $('.jacts', row);

  if (acts && outcome.session_id && Number(outcome.observations) > 0 && !$('[data-mosaic]', acts)) {
    acts.insertAdjacentHTML('afterbegin',
      `<a class="btn sm" data-mosaic href="/apps/marp-mosaic-review/?session=${outcome.session_id}" `
      + `title="Review this run's observations in the mosaic">Review</a>`);
  }
}

/**
 * Write the cells that move, on the rows already drawn.
 *
 * **Patched, not redrawn**, for the reason `patchTrainingRows` is: rebuilding the table
 * under somebody reading it is the defect the Datasets table was fixed for.
 *
 * @param {Element} body - The table body.
 * @param {Map<number, Object>} views - The latest view per job id.
 * @returns {void}
 */
function patchInferenceRows(body, views) {
  for (const row of $$(':scope > tr[data-job]', body)) {
    const view = views.get(Number(row.dataset.job));

    if (!view) continue;

    const status = $('.jstatus', row);
    /* The progress bar moves while the state does not, so the state rank alone is the
       wrong thing to compare -- a running job would freeze at its first percentage. */
    const stamp = `${JOB_STATE_RANK[view.state]}:${view.job.progress_done}/${view.job.progress_total}`;

    if (status && status.dataset.stamp !== stamp) {
      status.innerHTML = statusWithProgress(view);
      status.dataset.sort = String(JOB_STATE_RANK[view.state]);
      status.dataset.stamp = stamp;
    }
  }
}

/** The inference table's poll, or null when nothing on it is moving. */
let inferenceWatch = null;

/**
 * Keep the table current while anything on it is still running.
 *
 * Stops when nothing is live, rather than polling an idle screen for ever.
 *
 * @returns {void}
 */
function watchInference() {
  if (inferenceWatch || !window.MarpApi) return;

  const body = $('.inference-table tbody');

  if (!body) return;

  inferenceWatch = setTimeout(async function again() {
    inferenceWatch = null;

    let live = false;

    try {
      const jobs = await window.MarpApi.listJobs({ limit: 500, kind: 'inference' });
      const issues = batchesWithIssues(jobs.jobs);
      const views = new Map(jobs.jobs.map((job) => [job.id, jobView(job, issues)]));

      patchInferenceRows(body, views);

      const drawn = $$(':scope > tr[data-job]', body)
        .map((row) => views.get(Number(row.dataset.job)))
        .filter(Boolean);

      /* A job that has just finished is the one whose count is now worth asking for. */
      await fillInferenceOutcomes(body, drawn);

      /* An open row keeps counting while its piece or its run is still going. */
      for (const place of $$('tr.runrow-body:not([hidden]) [data-inference-findings]', body)) {
        const view = views.get(Number(place.dataset.inferenceFindings));
        if (view) place.dataset.state = view.state;
        fillInferenceFindings(place);
      }

      live = drawn.some((view) => ['running', 'queued'].includes(view.state));
    } catch {
      /* A poll that fails is a blip; the last good answer stays on screen. Keep
         watching, because the thing that failed is the thing being watched. */
      live = true;
    }

    if (live) watchInference();
  }, TRAINING_EPOCH_POLL_MS);
}

/**
 * Nobody has asked yet. Distinct from zero of them.
 *
 * **This used to be permanent** -- gap 11 was that nothing counted observations back
 * onto a job, so the column could only ever draw a dash. `GET /gpu/jobs/:id/observations`
 * answers it, and the dash now means the narrower thing it says: the question has not
 * been put for this row yet, or it could not be answered. A finished run that detected
 * nothing draws 0, because that is a measurement somebody made.
 */
const NOT_COUNTED = '<span class="dash" title="Not counted yet for this row. A finished run that found nothing shows 0.">&mdash;</span>';

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

/**
 * The registry does not carry this, and nothing else does either.
 *
 * **Narrowed to what is still true.** It used to say the dataset link "cannot be listed"
 * and that nothing records metrics; #260 added the collection read for training runs, and
 * `metrics_summary` has recorded precision, recall, mAP and fitness all along. So the
 * dataset is drawn now and this covers the two that remain: scores nothing serves yet,
 * and cache placement nothing records at all. Isaac asked for both columns to stay --
 * *"later maybe we will keep those scores"* -- so they wait rather than disappear.
 */
/**
 * Something the registry has no way to know.
 *
 * **Half of what this used to say stopped being true.** It claimed that
 * `metrics_summary` records precision, recall and mAP *"but no route lists them by run"*
 * — and `GET /training_run/:id/metrics` has listed them by run since this morning. The
 * column that half was for is gone, so the sentence survived describing nothing.
 *
 * What is left is true and checked: a worker's capability payload carries its engines,
 * its reductions, its torch and CUDA versions and its hardware, and **nothing about which
 * model weights it has on disk**. So *Cached on workers* is a question no machine is
 * currently asked.
 */
const NOT_IN_REGISTRY = '<span class="dash" title="No worker reports which model weights it holds">&mdash;</span>';

/**
 * A model MARP has no training run for.
 *
 * **The same dash, and that is the requirement.** Some models predate the registry
 * keeping runs at all, and an honest "we have no run for this" has to look identical to
 * the columns beside it rather than becoming a third kind of empty -- a blank, a zero or
 * a "None" would all read as a different sort of fact. Only the tooltip differs, because
 * the reason differs and a reader who asks deserves the real one.
 */
const NO_REGISTERED_MODEL = '<span class="dash" title="MARP records no link from a run to the model it registered: training_runs.model_id and spec.model.ml_model_id are both the base model the run started FROM">&mdash;</span>';

let modelsTrainedOn = new Map();

const NO_TRAINING_RUN = '<span class="dash" title="MARP records no link from a model to the run that produced it: training_runs.model_id is the base model a run started FROM, not the model it produced">&mdash;</span>';

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
  page: 1, perPage: PAGE_SIZES[0],
};

/** How each sortable column orders. Keyed by the header's class. */
const MODELS_SORT_KEYS = {
  hname: (v) => v.model.name.toLowerCase(),
  htask: (v) => v.model.model_type,
  hver: (v) => v.version,
  hstatus: (v) => ['training', 'draft', 'trained', 'archived'].indexOf(v.model.status),
  hbase: (v) => (v.model.architecture_version || '').toLowerCase(),
  /* **No `hdset` key, deliberately.** The column has nothing to sort: every row is the
     same dash until MARP records which run produced a model. `Key metrics` and `Cached`
     were the other two keyless-but-sortable headers and they are gone -- Isaac asked to
     keep them once and to remove them now; the later call wins. */
  hupd: (v) => v.model.updated_at,
};

/** The registry, as fetched. */
let modelsRegistry = null;

/** What each model trained on, by model id. Empty until the registry has loaded. */

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
 * Which dataset each model actually learned from, by model id.
 *
 * **Through `ml_models.training_run_id`, which is the run that produced the model.** The
 * column this replaces walked `training_runs.model_id`, the base a run started FROM, so
 * it named a model after what some *other* run trained on -- rockfish5-2026-10-20 was
 * credited with CookieStarTest, which it never saw.
 *
 * A model with no recorded run, or a run with a null `dataset_id` -- one that trained on
 * something outside MARP -- both take the dash. They are different facts and read the
 * same in a single cell, so the tooltip carries the difference.
 *
 * @param {Object[]} models - The registry.
 * @param {Object[]} runs - From `GET /training_run`.
 * @param {Object[]} datasets - From `GET /dataset`, for the names.
 * @returns {Map<number, Object>} `{id, name}` per model id.
 */
function datasetByModel(models, runs, datasets) {
  const names = new Map(datasets.map((set) => [set.id, set.name]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const found = new Map();

  for (const model of models) {
    const run = model.training_run_id != null && runById.get(model.training_run_id);
    if (!run || run.dataset_id == null) continue;

    found.set(model.id, {
      id: run.dataset_id,
      /* A dataset the catalogue did not return -- deleted, or a read that failed -- is
         still a real link, so it is named by its id rather than dropped. */
      name: names.get(run.dataset_id) || `Dataset ${run.dataset_id}`,
    });
  }

  return found;
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

  const trainedOn = modelsTrainedOn.get(model.id) || null;

  return {
    model, state, label,
    version: modelGeneration(model, byId),
    trainedOn,
    /* Searchable by what it trained on, which is how somebody looks for "every model
       that saw the inverts dataset". */
    haystack: `${model.name} ${model.model_type} ${model.architecture_version || ''} ${model.status} ${trainedOn ? trainedOn.name : ''}`.toLowerCase(),
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
    /* **Empty, because the link does not exist rather than because it is missing.**
       This used to read `training_runs.model_id` as the model a run produced. It is the
       base model the run started FROM -- `gpu.service.js` says so where it refuses a
       submission without one -- so every row that showed a dataset was crediting a model
       with what some *other* run trained on. rockfish5-2026-10-20 was named against
       CookieStarTest on that basis, which it never saw. Nothing in `ml_models` or
       `training_runs` records which run produced which model; until something does, this
       column says so instead of guessing. */
    + `<td class="hdset">${view.trainedOn
      ? `<a href="./datasets.html?dataset=${encodeURIComponent(view.trainedOn.id)}" title="The dataset the run that produced this model learned from">${escapeHtml(view.trainedOn.name)}</a>`
      : NO_TRAINING_RUN}</td>`
    + `<td class="hupd">${sinceText(model.updated_at)}</td>`
    + '<td class="hacts"><button class="btn sm icon" aria-label="Open"><svg class="ico sm"><use href="#i-right"/></svg></button></td>'
    + '</tr>';

  /* **`hidden`, because nothing else hides it.** An expandable row is open or shut by
     the attribute alone -- there is no CSS rule holding `.runrow-body` closed -- so a
     detail row built as markup without it renders open. Both tables that build their
     detail as a string did, and both opened with every row expanded; the two that build
     it with `createElement` set `hidden = true` and were always right.

     It read worse than it sounds: `aria-expanded` on the head was `"false"` the whole
     time, so the row said shut while the panel was open, and the first click on any row
     set them to agree and changed nothing visible. */
  const body = '<tr class="runrow-body" hidden><td colspan="9"><div class="rundetail">'
    + `<div class="wdhead"><span class="name"><svg class="ico models"><use href="#i-models"/></svg><span class="t">${model.name}</span></span>`
    + `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`
    + `<span class="wid mono" title="Model id as the registry reports it">ml_${model.id}</span></div>`
    + '<div class="grid" data-cols="1">'
    + '<div class="sect"><h3>In the registry</h3><dl class="kv">'
    + `<dt>Task</dt><dd>${model.model_type}</dd>`
    + `<dt>Architecture</dt><dd>${model.architecture_version || NOT_REPORTED}</dd>`
    + `<dt>Generation</dt><dd>v${view.version}${parent ? ` &middot; from ${parent.name}` : ' &middot; root model'}</dd>`
    + `<dt>Weights</dt><dd class="mono">${model.storage_path || NOT_REPORTED}</dd>`
    + `<dt>Registered</dt><dd>${new Date(model.created_at).toISOString().slice(0, 10)}</dd>`
    + `<dt>Updated</dt><dd>${sinceText(model.updated_at)}</dd>`
    + '</dl></div>'
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

  drawPager($('#model-registry .panel-ft'), modelsQuery, {
    total, from, count: shown.length, pages, noun: 'model', empty: 'No models match these filters', redraw: applyModelsQuery,
  });

  for (const th of $$('#models thead th.sortable')) {
    const sortKey = [...th.classList].find((c) => MODELS_SORT_KEYS[c]);
    if (!sortKey) continue;
    if (sortKey === modelsQuery.sort.key) th.setAttribute('aria-sort', modelsQuery.sort.dir);
    else th.removeAttribute('aria-sort');
  }

  wireAccordions();
  openRequestedModel();
}

/* Once per load. The table is redrawn by every filter and sort, and reopening the
   asked-for row each time would fight whoever is using the screen. */
let openedRequestedModel = false;

/**
 * Expand the model a `?model=` link asked for.
 *
 * The Training screen's *Produces* column links here, the way a dataset build links to
 * `datasets.html?dataset=`. Without this the link lands on the registry and leaves the
 * reader to find the row, which for eight models is tolerable and for eighty is not.
 *
 * @returns {void}
 */
function openRequestedModel() {
  if (openedRequestedModel) return;

  const wanted = new URLSearchParams(window.location.search).get('model');
  if (!wanted) return;

  const head = $(`#models tbody tr[data-model="${CSS.escape(wanted)}"]`);
  if (!head) return;

  openedRequestedModel = true;
  $('.exbtn', head)?.click();
  requestAnimationFrame(() => head.scrollIntoView({ block: 'start' }));
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
    /* **Three reads, two of which may fail.** The registry is the screen; the runs and
       the dataset catalogue turn `ml_models.training_run_id` into a dataset name. A
       registry that drew nothing because the catalogue was slow would be worse than one
       with a dash in one column, so those two are settled rather than awaited. */
    const [registry, runs, datasets] = await Promise.all([
      window.MarpApi.listModels(),
      Promise.allSettled([window.MarpApi.listTrainingRuns(), window.MarpApi.listDatasets()]),
    ]).then(([models, [runResult, setResult]]) => [
      models,
      runResult.status === 'fulfilled' ? runResult.value : [],
      setResult.status === 'fulfilled' ? setResult.value : [],
    ]);

    modelsRegistry = registry;
    modelsTrainedOn = datasetByModel(registry, runs, datasets);
    fillModelsFilterOptions();
    applyModelsQuery();

    /* **The registry is nearly static, and the exception is the one worth watching.** A
       model being trained becomes a trained model while somebody has this open, and that
       row is the reason they have it open. So it watches while anything is `training`
       and stops otherwise, which on a settled registry means it never asks twice.

       `applyModelsQuery` redraws rather than patching, which is allowed here only because
       the thing it redraws is a table whose rows do not expand into anything a reader is
       part-way through -- and it is gated behind a status actually changing, so a quiet
       poll writes nothing at all. */
    const training = (list) => list.some((model) => model.status === 'training');

    if (training(registry)) {
      watchScreen({
        read: () => window.MarpApi.listModels(),
        live: training,
        patch: (next) => {
          const moved = next.some((model) => {
            const before = modelsRegistry.find((one) => one.id === model.id);

            return !before || before.status !== model.status;
          });

          if (!moved) return;

          modelsRegistry = next;
          applyModelsQuery();
        },
      });
    }
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
  /* It had options and no listener, so even enabled it would have done nothing. */
  selects.Dataset?.addEventListener('change', () => {
    modelsQuery.dataset = selects.Dataset.value.startsWith('All') ? '' : selects.Dataset.value;
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

}


/* ================================================ durations and CSV */

/* What survived History folding into Jobs: the two things other screens were already
   borrowing from it. `tookText` is read by the Jobs and Training tables, and the CSV
   writer is what Jobs exports through. */

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

/**
 * One CSV field, escaped the way RFC 4180 readers expect.
 *
 * Job names are typed by a person, so a comma in one is ordinary rather than exotic --
 * and an unquoted one splits a column in two in every spreadsheet that opens the file,
 * with nothing about it looking wrong.
 *
 * @param {*} value - Whatever the column produced.
 * @returns {string}
 */
function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Hand the browser a file without a route to download it from.
 *
 * @param {string} name - The filename offered.
 * @param {string} text - The file's contents.
 * @returns {void}
 */
function downloadText(name, text) {
  /* The BOM is what makes Excel read UTF-8 rather than the local code page, which is
     the difference between a species name and mojibake. */
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Write a screen's rows out as CSV.
 *
 * **The rows handed in, not the rows on screen.** Every table here pages, and an export
 * built from the table reads correctly until the window has a second page -- at which
 * point it is quietly wrong rather than visibly broken.
 *
 * @param {Array[]} columns - `[header, read]` pairs, in the order the table draws them.
 * @param {Object[]} views - The rows to write, already filtered and sorted.
 * @param {string} name - Names the file, so two exports do not collide.
 * @returns {void}
 */
function exportRows(columns, views, name) {
  if (!views.length) return;

  const lines = [columns.map(([header]) => csvField(header)).join(',')];
  for (const view of views) {
    lines.push(columns.map(([, read]) => csvField(read(view))).join(','));
  }

  const day = new Date().toISOString().slice(0, 10);
  downloadText(`marp-${name}-${day}.csv`, lines.join('\r\n'));
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
/** A job in one of these has ended; anything else is still in flight. */
const TERMINAL_STATES = ['succeeded', 'failed', 'cancelled', 'expired'];

/** How far back the outcomes panel reports, matching the window History opened on. */
const OUTCOME_WINDOW_DAYS = 30;

/**
 * How work ended, over the last thirty days.
 *
 * Moved here when History folded into Jobs: a queue screen answers *what is happening*,
 * and this answers *how it went*, which is what the Dashboard is for. It costs no second
 * request -- the Dashboard was already fetching the same jobs History did.
 *
 * **Anchored on the newest job, not on now.** A corpus that has been sitting for a month
 * would otherwise report an empty window and read as an idle pool.
 *
 * @param {Object[]} jobs - Every job the screen fetched.
 * @returns {void}
 */
function renderOutcomes(jobs) {
  const donut = $('.job-donut');
  const legend = $('.job-mix-key');
  if (!donut && !legend) return;

  const issueBatches = batchesWithIssues(jobs);
  const newest = jobs.reduce((max, j) => Math.max(max, Date.parse(j.created_at)), 0);
  const since = newest - OUTCOME_WINDOW_DAYS * 86400000;

  const views = jobs
    .filter((j) => TERMINAL_STATES.includes(j.state) && Date.parse(j.created_at) >= since)
    .map((job) => jobView(job, issueBatches));

  const done = views.filter((v) => v.state === 'done').length;
  const issues = views.filter((v) => v.state === 'issues').length;
  const bad = views.filter((v) => ['failed', 'cancelled', 'expired'].includes(v.state)).length;

  if (legend) {
    legend.innerHTML = [['done', done, 'Completed'], ['issues', issues, 'With issues'], ['failed', bad, 'Failed / cancelled']]
      .map(([cls, value, text]) => `<span class="${cls}"><i></i><b>${value}</b> ${text}</span>`)
      .join('');
  }

  const svg = $('svg', donut);
  if (svg) {
    /* `pathLength` is set to the total so each arc's dash array is a count rather than a
       length, which is why three arcs can be laid end to end without measuring anything. */
    const total = views.length || 1;
    const arcs = $$('.donut-part', svg);
    let offset = 0;
    arcs.forEach((arc, index) => {
      const value = [done, issues, bad][index] || 0;
      arc.setAttribute('pathLength', String(total));
      arc.setAttribute('stroke-dasharray', `${value} ${Math.max(0, total - value)}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      offset += value;
    });
  }

  const middle = $('.job-donut > span > b', donut.parentElement || document);
  if (middle) middle.textContent = String(views.length);

  /* **The renderer says which window, rather than the markup.** A screen that states a
     number no renderer owns is how a panel goes on claiming "the last 30 days" after the
     window changes -- which `markup-check` fails on, for exactly that reason. */
  const subtitle = $('[data-outcomes-window]');
  if (subtitle) {
    subtitle.textContent = `How work ended over the last ${OUTCOME_WINDOW_DAYS} days`;
  }
}

function renderDashboard(data) {
  const { jobs, workers, models, datasets } = data;

  renderOutcomes(jobs);

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

  const mix = [...running.slice(0, 2), ...attention.slice(0, 2), ...finished.slice(0, 1)];

  for (const pool of [attention.slice(2), running.slice(2), finished.slice(1)]) {
    for (const view of pool) {
      if (mix.length >= 5) break;
      mix.push(view);
    }
  }

  /* **The mix leads, and then every other job, newest first, paged like every table.**
     It stopped at the five, so anything past them could only be reached from Jobs. */
  const rest = newest(views.filter((view) => !mix.includes(view)));
  const { shown, from, pages } = pageOf([...mix, ...rest], dashboardPage);
  drawPager(table.closest('.panel')?.querySelector('.panel-ft'), dashboardPage, {
    total: views.length, from, count: shown.length, pages, noun: 'job', empty: 'No jobs yet',
    redraw: () => renderDashboardActivity(jobs),
  });

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

    /* **The one screen where redrawing is the honest patch.** Everything here is cards
       and charts -- there is no row to close and nothing expanded to lose -- so the
       rule's purpose is served by drawing it again. Four reads at the builder's cadence
       is more than the other screens make, so it stops as soon as nothing is moving,
       which on a quiet morning is immediately. */
    watchScreen({
      read: async () => {
        const [next, pool, registry, sets] = await Promise.all([
          window.MarpApi.listJobs({ limit: 500 }),
          window.MarpApi.listWorkers(),
          window.MarpApi.listModels(),
          window.MarpApi.listDatasets(),
        ]);

        return { jobs: next.jobs, workers: pool, models: registry, datasets: sets };
      },
      live: (data) => anyJobLive(data.jobs),
      patch: (data) => renderDashboard(data),
    });
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
/**
 * A cell this machine has not reported.
 *
 * **The tooltip used to say MARP records no live machine telemetry and that a worker
 * reports its capabilities at enrolment.** Both false: the worker sends GPU utilisation,
 * VRAM, temperature, power, CPU, system RAM and disk on every poll, and
 * `gpu_worker_samples` has stored the GPU half every minute since `d60fd0fe`. It is a
 * fact about *this machine* now, which is the only kind of absence worth drawing.
 */
const NOT_REPORTED = '<span class="dash" title="This machine has not reported it">&mdash;</span>';

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
  page: 1, perPage: PAGE_SIZES[0],
};

/**
 * When a machine was last heard from, by either of the two things that count.
 *
 * **Workers already had this column, under a better name**, so the every-screen rule
 * lands as a correction rather than a thirteenth header: *Last heard* is what Updated
 * means for a machine, and adding a second column beside it would have been the rule
 * being obeyed rather than understood.
 *
 * The correction is which timestamp it reads. `last_seen_at` is the worker's own
 * heartbeat; an attempt's `last_heartbeat_at` is the running job's, and it can be the
 * newer of the two. Taking the later means a machine that is mid-job never reads as
 * quieter than one that is idle.
 *
 * @param {Object} worker - A row from `GET /gpu/workers`.
 * @returns {?string} An ISO instant, or null if it has never been heard from.
 */
function workerLastSeen(worker) {
  const times = [worker.last_seen_at, ...(worker.attempts || []).map((one) => one.last_heartbeat_at)]
    .filter(Boolean)
    .map((at) => Date.parse(at))
    .filter((at) => Number.isFinite(at));

  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * Write what moves on a worker row, leaving the row itself alone.
 *
 * The two cells that change while somebody watches: the status pill, and how long since
 * the machine was last heard from. Everything else on the row -- its name, its GPU, its
 * version -- changes when a worker is reconfigured, which is not something that happens
 * under a reader's eyes, and redrawing it would close an expansion for nothing.
 *
 * @param {Object[]} pool - The workers, as `listWorkers` returned them.
 * @returns {void}
 */
function patchWorkerRows(pool) {
  const body = $('table#workers tbody');

  if (!body) return;

  const byId = new Map(pool.map((worker) => [String(worker.worker_id), worker]));

  for (const row of $$(':scope > tr[data-worker]', body)) {
    const worker = byId.get(row.dataset.worker);

    if (!worker) continue;

    const view = workerView(worker);
    const status = $('.jstatus', row);
    const rank = String(WORKERS_SORT_KEYS.wstate(view));

    if (status && status.dataset.sort !== rank) {
      status.innerHTML = `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`;
      status.dataset.sort = rank;
    }

    const heartbeat = $('.whb', row);
    const since = String(WORKERS_SORT_KEYS.whb(view));

    if (heartbeat && heartbeat.dataset.sort !== since) {
      heartbeat.textContent = sinceText(worker.last_seen_at);
      heartbeat.dataset.sort = since;
    }
  }
}

/** How each sortable column orders. Keyed by the header's class. */
const WORKERS_SORT_KEYS = {
  wname: (v) => v.worker.name.toLowerCase(),
  wstate: (v) => ['busy', 'idle', 'paused', 'offline'].indexOf(v.activity),
  wver: (v) => v.worker.worker_version || '',
  wgpu: (v) => v.gpu.toLowerCase(),
  wjobs: (v) => v.used / Math.max(1, v.worker.slot_count),
  whb: (v) => (workerLastSeen(v.worker) ? -Date.parse(workerLastSeen(v.worker)) : Infinity),
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
  const seconds = Math.max(0, Math.round((window.MarpApi.now() - Date.parse(iso)) / 1000));
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
/**
 * The system side of what a worker reports, from `capabilities.resources`.
 *
 * It sends `cpu`, `memory`, `disk`, `host`, `torch`, `nvidia`, `python`, `network` and
 * `job_pressure` on every poll. The screen said none of it was reported.
 *
 * Each of these returns a dash rather than inventing a zero: a machine that genuinely
 * sends no memory block has not told us it is using none.
 */
const resourceCpu = (caps) => {
  const cpu = (caps.resources || {}).cpu;

  if (!cpu || cpu.cpu_percent === null || cpu.cpu_percent === undefined) return NOT_REPORTED;

  const cores = cpu.physical_cpu_count
    ? ` of ${cpu.physical_cpu_count} cores` : '';

  return `${Math.round(cpu.cpu_percent)}%${cores}`;
};

const resourceMemory = (caps) => {
  const memory = (caps.resources || {}).memory;

  if (!memory || !memory.total_bytes) return NOT_REPORTED;

  return `${gb(memory.used_bytes)} of ${gb(memory.total_bytes)} GB`
    + `${memory.percent_used === undefined ? '' : ` &middot; ${Math.round(memory.percent_used)}%`}`;
};

const resourceDisk = (caps) => {
  const disk = (caps.resources || {}).disk;

  if (!disk || !disk.total_bytes) return NOT_REPORTED;

  return `${gb(disk.free_bytes)} GB free`
    + `${disk.percent_used === undefined ? '' : ` &middot; ${Math.round(disk.percent_used)}% used`}`;
};

/**
 * How old a GPU sample may be and still be called a reading.
 *
 * The sampler writes once a minute, so five intervals is generous for a machine that is
 * actually reporting and decisive for one that stopped days ago. The number matters less
 * than that there is one: without it, the newest row for a switched-off machine is shown
 * as its current state for ever.
 */
const SAMPLE_STALE_MS = 5 * 60 * 1000;

/** How long unheard before a machine is folded away rather than listed with the pool. */
const WORKER_GONE_MS = 2 * 24 * 60 * 60 * 1000;

/** Bytes as whole gigabytes, for a column 70px wide. */
const gb = (bytes) => (Number.isFinite(Number(bytes)) ? Math.round(Number(bytes) / 1073741824) : null);

/**
 * The cells that read a machine's live GPU reading.
 *
 * **These said "Not reported" under a note explaining that workers do not report them.**
 * They do, every minute, into `gpu_worker_samples` — utilisation, VRAM used and total,
 * temperature and power, all of it. The service only ever attached the reading to a
 * running *attempt*, so a machine that was plainly on and sampling showed nothing, and
 * the screen explained the absence rather than the absence being real.
 *
 * Each still says nothing when there is nothing: a worker with no sample yet has no
 * reading, and a dash is the honest cell. The difference is that it is now a fact about
 * that machine rather than a standing claim about MARP.
 */
/** A dash that says when the last reading was, rather than that there was never one. */
const staleCell = (view) => `<span class="dash" title="${escapeHtml(view.stale)}">&mdash;</span>`;

const gpuLoadCell = (view) => {
  if (view.stale) return staleCell(view);

  return view.load === null
    ? NOT_REPORTED
    : `<span class="prog" data-state="${view.state}" title="GPU utilisation, ${view.asOf}">`
      + `<span class="bar"><i style="width:${view.load}%"></i></span><span class="pct">${view.load}%</span></span>`;
};

const vramLoadCell = (view) => {
  if (view.stale) return staleCell(view);

  return view.vramUsed === null
    ? NOT_REPORTED
    : `<span class="two" title="VRAM in use, ${view.asOf}"><span class="a">${view.vramPct}%</span>`
      + `<span class="b">${gb(view.vramUsed)} of ${gb(view.vramTotal)} GB</span></span>`;
};

const thermalCell = (view) => {
  if (view.stale) return staleCell(view);

  return view.tempC === null && view.watts === null
    ? NOT_REPORTED
    : `<span class="two" title="As last sampled, ${view.asOf}">`
      + `<span class="a">${view.tempC === null ? '&mdash;' : `${view.tempC}&deg;C`}</span>`
      + `<span class="b">${view.watts === null ? '&mdash;' : `${Math.round(view.watts)} W`}</span></span>`;
};

function workerView(worker) {
  const caps = worker.capabilities || {};
  const [state, label] = WORKER_ACTIVITY[worker.activity] || WORKER_ACTIVITY.idle;

  /* **`cuda_devices`, not `gpu`.** The GPU name and its VRAM were read from `caps.gpu`
     and `caps.vram_mb`, keys no worker has ever sent -- not 0.1.1, not 0.1.9. So the
     column has been empty since it was written, and it looked like a worker problem.
     What arrives is `cuda_devices[]`, each with a `name` and `total_memory_bytes`. */
  const device = (caps.cuda_devices || [])[0] || null;
  const vramGb = device ? gb(device.total_memory_bytes) : null;

  /* **The machine's own latest sample, and only while it is still a reading.**
     `gpu_worker_samples` keeps every sample for ever, so the newest row for a machine
     that was switched off on Wednesday is Wednesday's. Isaac found ABYSS *offline, last
     heard 6d ago*, sitting next to **46°C and 123 W** -- presented as current, in the
     present tense, with no indication of its age. A six-day-old temperature shown as now
     is a confident wrong answer, which is worse than the dash that was there before I
     filled this in.

     A few sample intervals is the window: the sampler writes once a minute, so anything
     older than five has stopped being a reading and becomes a historical fact, which
     belongs in the chart below rather than in a column headed *GPU load*. */
  const sample = (worker.telemetry && (worker.telemetry.gpus || [])[0]) || null;
  const sampledAt = worker.telemetry ? Date.parse(worker.telemetry.as_of) : NaN;
  const fresh = Number.isFinite(sampledAt)
    && window.MarpApi.now() - sampledAt < SAMPLE_STALE_MS;
  /* **Two gates on purpose.** The cells below check `stale` and draw the dash that says
     when the last reading was; this one keeps the stale numbers out of the view model
     entirely, so the next thing to read `view.load` -- a chart, a card, a tooltip --
     cannot pick up a six-day-old value by accident. Only the first is observable today,
     so only the first is pinned; this one is the belt. */
  const reading = fresh ? sample : null;

  return {
    worker, caps, state, label,
    activity: worker.activity,
    /* **The model number is the part that tells two machines apart**, and it is the part
       a 10% column was cutting off: *"NVIDIA GeForce RTX 4…"*. Every card in this pool is
       an NVIDIA GeForce, so the two words that are the same on every row are what gets
       dropped, and the full string stays in the title. A card from another maker keeps
       its whole name, because only this prefix is stripped. */
    gpu: device ? device.name.replace(/^NVIDIA\s+GeForce\s+/i, '') : 'Not reported',
    gpuFull: device ? device.name : '',
    vram: vramGb ? `${vramGb} GB` : '',
    load: reading && reading.gpu_utilization_percent !== null
      ? Math.round(reading.gpu_utilization_percent) : null,
    vramUsed: reading ? reading.memory_used_bytes ?? null : null,
    vramTotal: reading ? reading.memory_total_bytes ?? null : null,
    vramPct: reading && reading.memory_percent_used !== null
      ? Math.round(reading.memory_percent_used) : null,
    tempC: reading ? reading.temperature_c ?? null : null,
    watts: reading ? reading.power_usage_watts ?? null : null,
    /* Said on every cell that shows a reading, because a number with no time on it is a
       claim about now that may be an hour old. */
    asOf: worker.telemetry ? sinceText(worker.telemetry.as_of) : 'not sampled',
    /* What the dash says instead, when the only reading is too old to be one. */
    stale: !fresh && sample
      ? `Last sampled ${sinceText(worker.telemetry.as_of)}, too old to show as current`
      : null,
    /* A machine nobody has heard from in days is folded away rather than filling the
       table above the ones that are working. */
    gone: (() => {
      const heard = Date.parse(workerLastSeen(worker) || '');

      return Number.isFinite(heard) ? window.MarpApi.now() - heard > WORKER_GONE_MS : true;
    })(),
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
/**
 * What one of a worker's slots is working on, linked to that job on the Jobs page.
 *
 * Isaac: *"the worker should also show exactly what job they are currently using, and
 * there should be a link through to that job"*. Drawn through the Jobs tab's own
 * `jobView`, `jobScopeText` and `jobDestination`, so a job reads the same here as there.
 *
 * @param {Object} attempt - One live attempt from `GET /gpu/workers`.
 * @returns {string} `<dt>`/`<dd>` pairs, or nothing when the pool sent no job.
 */
function workingOn(attempt) {
  const job = attempt.job;

  if (!job || job.job_id === undefined || job.job_id === null) return '';

  const view = jobView({
    id: job.job_id, kind: job.kind, state: job.state, name: job.name,
    spec: job.spec || {}, batch_id: job.batch_id, progress_done: null,
  }, new Set());
  const spec = view.spec;
  const href = jobDestination({ id: job.job_id, kind: job.kind, spec });
  const title = escapeHtml(view.title);
  const scope = [
    jobScopeText(view) || (spec.dataset && spec.dataset.name ? `Dataset ${spec.dataset.name}` : ''),
    spec.range ? `frames ${spec.range.start_frame.toLocaleString()}–${spec.range.end_frame.toLocaleString()}` : '',
    spec.model && spec.model.name ? spec.model.name : '',
  ].filter(Boolean).map(escapeHtml).join(' &middot; ');

  return `<dt>Job</dt><dd>${href ? `<a href="${href}">${title}</a>` : title} &middot; ${escapeHtml(view.kindLabel)}</dd>`
    + (scope ? `<dt>Working on</dt><dd>${scope}</dd>` : '');
}

/**
 * A worker's rows, or one row saying why it could not be drawn.
 *
 * **One machine must not cost the pool.** A single worker whose record the screen
 * misread used to throw out of the whole render, and the catch around it reported the
 * pool as unreachable -- which it was not; the answer had arrived (#282).
 *
 * @param {Object} view - From `workerView`.
 * @returns {string} Table rows.
 */
function workerRowsOrSay(view) {
  try {
    return workerRows(view);
  } catch (error) {
    return `<tr class="tblmsg" data-worker="${view.worker.worker_id}"><td class="error" colspan="11">`
      + `Could not draw ${escapeHtml(view.worker.name || 'this worker')}: ${escapeHtml(error.message || String(error))}</td></tr>`;
  }
}

function workerRows(view) {
  const { worker, caps } = view;
  const res = caps.resources || {};

  const head = `<tr class="runrow-head" data-worker="${worker.worker_id}" aria-expanded="false">`
    + `<td class="ex"><button class="exbtn" type="button" aria-label="Show ${worker.name} details"><svg class="ico sm"><use href="#i-right"/></svg></button></td>`
    + `<td class="jname"><span class="name"><svg class="ico"><use href="#i-workers"/></svg><span class="t">${worker.name}</span></span></td>`
    + `<td class="jstatus" data-sort="${WORKERS_SORT_KEYS.wstate(view)}"><span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span></td>`
    + `<td class="wver">${worker.worker_version || NOT_REPORTED}</td>`
    + `<td class="wgpu"${view.gpuFull ? ` title="${escapeHtml(view.gpuFull)}"` : ''}>`
    + `<span class="two"><span class="a">${view.gpu}</span><span class="b">${view.vram}</span></span></td>`
    + `<td class="wcpu" data-sort="${view.load ?? -1}">${gpuLoadCell(view)}</td>`
    + `<td class="wmem" data-sort="${view.vramUsed ?? -1}">${vramLoadCell(view)}</td>`
    + `<td class="wmodel">${thermalCell(view)}</td>`
    + `<td class="num" data-sort="${view.used}">${view.used} / ${worker.slot_count}</td>`
    + `<td class="wup">${NOT_REPORTED}</td>`
    + `<td class="whb" data-updated data-sort="${WORKERS_SORT_KEYS.whb(view)}">${sinceText(workerLastSeen(worker))}</td>`
    + '</tr>';

  /* **The shape `GET /gpu/workers` sends**: `progress: {done, total, unit, phase}`,
     `attempt_id` and `job: {job_id}`. This read `progress_done`, `id` and `job_id`, which
     a job row carries and a pool row never has -- and `undefined !== null` is true, so the
     first busy machine threw and the whole table read "Could not load the pool" (#282).
     Unseen for two weeks because the pool was idle whenever anyone looked. */
  const counted = (n) => (n !== null && n !== undefined && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : null);
  const progressOf = (one) => {
    const step = one.progress || {};

    return counted(step.done) !== null
      ? `${counted(step.done)}${counted(step.total) !== null ? ` / ${counted(step.total)}` : ''} ${escapeHtml(step.unit || '')}`
        + (step.phase ? ` &middot; ${escapeHtml(step.phase)}` : '')
      : 'No heartbeat yet';
  };

  /* **Every job the machine holds, not the first.** A four-slot worker runs four at
     once, and showing one of them made a busy machine look a quarter as busy. */
  const attempts = worker.attempts || [];
  const live = attempts.length
    ? `<div class="sect"><h3>${attempts.length === 1 ? 'Live attempt' : `Live attempts (${attempts.length})`}</h3>`
      + attempts.map((one) => '<dl class="kv">'
        + workingOn(one)
        + `<dt>Attempt</dt><dd>${one.attempt_id} &middot; job ${one.job ? one.job.job_id : NOT_REPORTED}</dd>`
        + `<dt>State</dt><dd>${escapeHtml(one.state)}</dd>`
        + `<dt>Progress</dt><dd>${progressOf(one)}</dd>`
        + `<dt>Slot</dt><dd>${one.slot_index} of ${worker.slot_count}</dd>`
        + `<dt>Heartbeat</dt><dd>${sinceText(one.last_heartbeat_at)}</dd>`
        + '</dl>').join('')
      + '</div>'
    : '<div class="sect"><h3>Live attempt</h3><p class="muted">No attempt on this machine right now.</p></div>';

  /* `hidden` for the same reason the registry's is: see `modelRows`. Isaac reported the
     models table; this one had it too, from the same line copied. */
  const body = '<tr class="runrow-body" hidden><td colspan="11"><div class="rundetail">'
    + `<div class="wdhead"><span class="name"><svg class="ico"><use href="#i-workers"/></svg><span class="t">${worker.name}</span></span>`
    + `<span class="st" data-state="${view.state}"><span class="dot"></span>${view.label}</span>`
    + `<span class="wid mono" title="Worker id as the pool reports it">wk_${worker.worker_id}</span>`
    + '<span class="wdacts"><button class="btn sm" title="Rename is the one worker mutation the API has"><svg class="ico sm"><use href="#i-pencil"/></svg>Rename</button></span></div>'
    + '<div class="grid" data-cols="2">'
    + '<div class="sect"><h3>Reported at enrolment</h3><dl class="kv">'
    /* Same mistake the row had: `caps.gpu`, `caps.driver` and `caps.cuda` are keys no
       worker sends, so this read "— / ? / ?" beside a row naming the card. */
    + `<dt>GPU</dt><dd>${view.gpuFull || NOT_REPORTED}</dd>`
    + `<dt>VRAM</dt><dd>${view.vram || NOT_REPORTED}</dd>`
    + `<dt>Driver / CUDA</dt><dd>${(res.nvidia && res.nvidia.driver_version) || NOT_REPORTED} / ${(res.torch && res.torch.cuda_version) || NOT_REPORTED}</dd>`
    + `<dt>Worker version</dt><dd>${worker.worker_version || NOT_REPORTED}</dd>`
    + `<dt>Slots</dt><dd>${view.used} of ${worker.slot_count} in use</dd>`
    + `<dt>Enrolled</dt><dd>${new Date(worker.enrolled_at).toISOString().slice(0, 10)}</dd>`
    + `<dt>Last heard</dt><dd>${sinceText(workerLastSeen(worker))}</dd>`
    /* **The paragraph that used to be here was wrong in every clause**, and it is the
       reason the columns stayed empty for weeks: it said live load, temperature, power,
       CPU, system RAM and disk are not reported and that a worker sends its capabilities
       once at enrolment. The worker sends all of it on every poll, and `gpu_worker_samples`
       has been storing the GPU half every minute since `d60fd0fe`. Isaac, finding it:
       *"this was all stuff we were supposed to implement, instead the former agent just
       didn't do it and put a note."*

       So the system reading goes here, from `capabilities.resources`, and the columns
       above carry the GPU one. Nothing explains an absence; where a machine really has
       not reported something, the cell is a dash. */
    + `<dt>CPU</dt><dd>${resourceCpu(caps)}</dd>`
    + `<dt>System RAM</dt><dd>${resourceMemory(caps)}</dd>`
    + `<dt>Disk</dt><dd>${resourceDisk(caps)}</dd>`
    + '</dl>'
    + '</div>'
    + live
    /* Filled when the row is opened rather than with the table: a series per machine for
       thirteen machines, most of which nobody expands, is a read for nothing. */
    + '</div><div class="worker-readings" data-worker-readings>'
    + '<p class="hint">Reading this machine…</p></div>'
    + '</div></td></tr>';

  return head + body;
}

/**
 * Fill a worker's expansion with its own charts, once it is opened.
 *
 * **Read on opening, not with the table.** A series per machine for a pool of thirteen,
 * most of which nobody expands, is a request for nothing — the same reason the training
 * curves are fetched when the row opens.
 *
 * **Kept per worker and per range**, so switching back to a window already read redraws
 * from what is in hand rather than asking again.
 *
 * @param {Element} head - The worker's head row.
 * @returns {void}
 */
function wireWorkerReadings(head) {
  const detail = head.nextElementSibling;
  const into = detail && $('[data-worker-readings]', detail);

  if (!into) return;

  const workerId = head.dataset.worker;
  const held = new Map();
  let range = '1h';

  const draw = async () => {
    if (head.getAttribute('aria-expanded') !== 'true') return;

    if (!held.has(range)) {
      const { hours } = WORKER_RANGES[range];
      const until = new Date();
      const since = new Date(until.getTime() - hours * 3600000);

      try {
        held.set(range, await window.MarpApi.workerSeries(workerId, {
          since: since.toISOString(),
          until: until.toISOString(),
        }));
      } catch (error) {
        into.innerHTML = `<p class="hint">Could not read this machine (${error.status || 'no answer'}).</p>`;
        return;
      }
    }

    into.innerHTML = workerCharts(held.get(range), range, workerId);

    for (const button of $$('[data-worker-range]', into)) {
      button.addEventListener('click', () => {
        range = button.dataset.workerRange;
        draw();
      });
    }
  };

  /* Watched rather than clicked, for the reason the training panel is: the expander is a
     delegated listener, so a click handler here would read `aria-expanded` before it had
     been flipped. */
  new MutationObserver(draw).observe(head, { attributes: true, attributeFilter: ['aria-expanded'] });
}

/** Narrows, sorts and pages the pool, then draws it. */
/**
 * What a machine's own charts show, and from which series.
 *
 * **Keyed like the training charts, for the same reason**: a reading that gets added
 * later is an entry here rather than a component. Each is drawn on its own axis because
 * they are different quantities — a percentage, a temperature and a wattage share no
 * scale, and putting them on one would make the temperature line look flat beside a
 * figure that reaches 320.
 */
const WORKER_CHARTS = [
  { key: 'gpu', title: 'GPU utilisation', unit: '%', max: 100 },
  { key: 'vram', title: 'VRAM in use', unit: '%', max: 100 },
  { key: 'cpu', title: 'CPU', unit: '%', max: 100 },
  { key: 'memory', title: 'System memory', unit: '%', max: 100 },
  { key: 'disk', title: 'Disk used', unit: '%', max: 100 },
  { key: 'temperature', title: 'Temperature', unit: '°C', max: 'auto' },
  { key: 'power', title: 'Power', unit: 'W', max: 'auto' },
];

/** The windows a worker's charts can be read over. An hour by default, as elsewhere. */
const WORKER_RANGES = {
  '1h': { hours: 1, label: 'the last hour' },
  '24h': { hours: 24, label: 'the last 24 hours' },
  '7d': { hours: 168, label: 'the last 7 days' },
  '30d': { hours: 720, label: 'the last 30 days' },
};

/**
 * One machine's readings, drawn.
 *
 * **A chart with nothing in it says so and is not drawn as a flat line at zero.** Most of
 * what is stored predates the worker sending CPU, memory and disk, so those three are
 * null for every older sample — and null here means *nobody measured*, which is the one
 * thing a line must never render as a floor.
 *
 * **A machine that was off is a gap, not a ramp.** On a time axis two readings either side
 * of an evening the worker was down would be joined by a straight line across it, which
 * reads as a measured slow climb. So a null goes in wherever readings are more than three
 * of their usual intervals apart.
 *
 * @param {Object} series - From `GET /gpu/workers/:id/series`.
 * @param {string} range - Which window is selected.
 * @param {string|number} workerId - The machine, so each chart keeps its own zoom.
 * @returns {string}
 */
function workerCharts(series, range, workerId) {
  const at = (series.at || []).map((value) => Date.parse(value));
  const spacing = at.slice(1).map((value, index) => value - at[index]).sort((a, b) => a - b);
  const usual = spacing.length ? spacing[Math.floor(spacing.length / 2)] : 0;
  const theme = chartTheme();
  const { color } = chartKey('result-line worker-series');
  const pointsOf = (values) => values.flatMap((value, index) => {
    const point = [at[index], value === null || value === undefined ? null : Number(value)];
    return index && usual && at[index] - at[index - 1] > 3 * usual ? [[at[index - 1] + usual, null], point] : [point];
  });
  const measured = (values) => values.some((value) => value !== null && value !== undefined);

  const cards = WORKER_CHARTS.map((spec) => {
    const values = series[spec.key] || [];

    if (!measured(values)) {
      /* Named rather than drawn empty: *this machine did not report it in this window* is
         a different fact from *it reported zero*, and the three system series will say
         this for every window that reaches back before the worker build that sends them. */
      return `<article class="evaluation-card history-card"><header><div><h5>${spec.title}</h5>`
        + `<p>Not reported in ${WORKER_RANGES[range].label}</p></div></header></article>`;
    }

    const last = [...values].reverse().find((value) => value !== null && value !== undefined);
    const option = {
      grid: { left: 44, right: 16, top: 30, bottom: 28 },
      legend: { show: false },
      xAxis: {
        type: 'time', ...theme.axis, splitLine: { show: false },
        axisLabel: { ...theme.axis.axisLabel, hideOverlap: true, formatter: { day: '{MM}-{dd}', hour: '{HH}:{mm}', minute: '{HH}:{mm}' } },
      },
      yAxis: { type: 'value', min: 0, max: spec.max === 'auto' ? undefined : spec.max, ...theme.axis, axisLabel: { ...theme.axis.axisLabel, formatter: `{value}${spec.unit}` } },
      tooltip: { ...theme.tooltip, valueFormatter: (value) => (value === null || value === undefined ? 'not reported' : `${Math.round(value)}${spec.unit}`) },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
      series: [{
        id: spec.key, name: spec.title, type: 'line', data: pointsOf(values), connectNulls: false, showSymbol: false,
        lineStyle: { color, width: 1.8 }, itemStyle: { color },
      }],
    };

    return '<article class="evaluation-card history-card">'
      + `<header><div><h5>${spec.title}</h5><p>${WORKER_RANGES[range].label}`
      + ` &middot; now ${Math.round(Number(last))}${spec.unit}</p></div></header>`
      + `${chartSlot(option, `${spec.title} over ${WORKER_RANGES[range].label}`, { key: `worker-${workerId}-${range}-${spec.key}` })}</article>`;
  }).join('');

  const buttons = Object.keys(WORKER_RANGES).map((key) => `<button type="button" class="${key === range ? 'on' : ''}"`
    + ` data-worker-range="${key}" aria-pressed="${key === range}">${key}</button>`).join('');

  return `<div class="sect worker-charts"><h3>Readings<span class="seg worker-ranges">${buttons}</span></h3>`
    + `<div class="curve-grid">${cards}</div></div>`;
}

/** Whether the long-gone machines are currently shown. Off until somebody asks. */
let workersFoldOpen = false;

/**
 * The control that says how many machines are folded away, and opens them.
 *
 * **The count is the point.** Hiding rows is only safe if the screen says it is hiding
 * them; a pool that quietly lists four of thirteen is how somebody concludes nine were
 * de-enrolled. It sits under the table rather than above it, because it is a footnote to
 * the pool rather than a filter on it.
 *
 * @param {number} count - How many rows are folded.
 * @returns {void}
 */
function renderWorkersFold(count) {
  const panel = $('#worker-pool');

  if (!panel) return;

  const wrap = $('.tblwrap', panel);
  let fold = $('[data-workers-fold]', panel);

  if (!count) {
    if (fold) fold.remove();
    return;
  }

  if (!fold) {
    fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'btn sm workers-fold';
    fold.setAttribute('data-workers-fold', '');
    fold.addEventListener('click', () => {
      workersFoldOpen = !workersFoldOpen;
      applyWorkersQuery();
    });
    wrap.after(fold);
  }

  fold.textContent = workersFoldOpen
    ? `Hide ${count} machine${count === 1 ? '' : 's'} not heard from in days`
    : `Show ${count} machine${count === 1 ? '' : 's'} not heard from in days`;
  fold.setAttribute('aria-expanded', String(workersFoldOpen));
  panel.dataset.foldOpen = workersFoldOpen ? 'yes' : 'no';
}

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

  /* **Machines nobody has heard from in days are folded away, not deleted.** The pool
     holds thirteen workers and two of them have ever been near this project; the rest
     are test enrolments and a laptop that was on once. Listing them with the ones doing
     work makes the table about history rather than about now -- Isaac: *"maybe it should
     be below the fold or not shown if it's not online, or hasn't been online in a day or
     two?"*

     Folded rather than filtered, and the count stays on the toggle, because a machine
     that silently vanished from a pool list is how somebody concludes it was
     de-enrolled. They are still searchable and still sortable: only the default view
     leaves them out. */
  const here = shown.filter((view) => !view.gone);
  const gone = shown.filter((view) => view.gone);

  body.innerHTML = here.length || gone.length
    ? here.map(workerRowsOrSay).join('') + (gone.length ? gone.map(workerRowsOrSay).join('') : '')
    : '<tr class="tblmsg"><td class="empty" colspan="11">No workers match these filters.</td></tr>';

  /* Marked after rendering rather than in the row builder: `workerRows` returns two rows
     per worker and the detail must fold with its head. */
  for (const view of gone) {
    const head = $(`tr[data-worker="${view.worker.worker_id}"]`, body);

    if (!head) continue;

    head.dataset.gone = 'yes';
    if (head.nextElementSibling) head.nextElementSibling.dataset.gone = 'yes';
  }

  for (const head of $$(':scope > tr[data-worker]', body)) wireWorkerReadings(head);

  renderWorkersFold(gone.length);

  const count = $('#worker-pool .panel-hd .count');
  if (count) count.textContent = `(${total.toLocaleString()})`;

  drawPager($('#worker-pool .panel-ft'), workersQuery, {
    total, from, count: shown.length, pages, noun: 'worker', empty: 'No workers match these filters', redraw: applyWorkersQuery,
  });

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
    ? Math.round((window.MarpApi.now() - oldestQueued) / 60000) : 0;

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

    /* **A pool screen that does not move is the one that misleads most**: a worker going
       offline looks exactly like a worker that was offline when the tab was opened. The
       status pill and the heartbeat are written into the rows that are there, so an
       expanded worker stays expanded.

       It keeps asking while any machine is reachable, rather than while any job is live:
       the thing being watched here is the pool itself, and a worker dropping out is
       precisely the event worth seeing. A pool that is entirely offline has nothing left
       to report and stops. */
    const reachable = (list) => list.some((one) => one.last_seen_at
      && Date.now() - Date.parse(one.last_seen_at) < 10 * 60 * 1000);

    if (reachable(pool)) {
      watchScreen({
        read: () => window.MarpApi.listWorkers(),
        live: reachable,
        patch: (next) => {
          workersPool = next;
          patchWorkerRows(next);
        },
      });
    }
  } catch (error) {
    /* `no answer` only when there was none: an error with no status is the screen's own,
       and saying the pool did not answer sent the search to the wrong place (#282). */
    body.innerHTML = `<tr class="tblmsg"><td class="error" colspan="11">Could not load the pool (${error.status || escapeHtml(error.message || 'no answer')}). `
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
      jobsQuery.windowDays = {
        'Last 24 hours': 1, 'Last 7 days': 7, 'Last 30 days': 30, 'Last 90 days': 90, 'This year': 365,
      }[windowSel.value] || 7;
      renarrow();
    });
  }

  /* **`?window=` arrives from other screens, so it is read once here rather than in the
     per-render wiring.** Inference, Training and Models each link to "recent work of this
     kind"; those links pointed at History until it folded into Jobs, and the window they
     asked for is the whole of what they meant. Set on the select too, so the control
     agrees with the table instead of reading 7 days over a 1-day list. */
  const askedWindow = { today: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days' }[
    new URLSearchParams(window.location.search).get('window')];
  if (askedWindow && windowSel) {
    windowSel.value = askedWindow;
    windowSel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const exportJobs = $('[data-jobs-export]', panel);
  if (exportJobs) {
    exportJobs.addEventListener('click', () => exportRows(JOBS_CSV_COLUMNS, jobsWindowViews, 'jobs'));
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

}

/* ====================================================== deleting jobs */

/**
 * What a delete just did, under the table.
 *
 * **A partial result is the normal result here**, so it needs somewhere to be said. A
 * selection of forty can come back as thirty-seven deleted and three held, each for its
 * own reason, and an alert saying "done" would be a lie about three of them.
 *
 * @param {string} text - What happened, already written.
 * @param {string} [tone] - `bad` for a refusal.
 * @returns {void}
 */
function sayJobsDelete(text, tone) {
  const said = $('#jobsDeleteSaid');
  if (!said) return;
  said.textContent = text;
  said.dataset.tone = tone || 'ok';
  said.hidden = !text;
}

/**
 * How many of whatever, written so it reads in a sentence.
 *
 * @param {number} count - The number.
 * @param {string} one - Singular noun.
 * @param {string} [many] - Plural, when it is not the singular plus s.
 * @returns {string}
 */
function countOf(count, one, many) {
  const n = Number(count) || 0;
  return `${n.toLocaleString()} ${n === 1 ? one : (many || `${one}s`)}`;
}

/**
 * Redraw after something was deleted.
 *
 * **The rail badge is recounted, not left.** It is a count of failed jobs, and deleting
 * failed jobs is the one act guaranteed to change it -- a badge still reading 1,189 over
 * an empty list is the screen contradicting itself.
 *
 * @returns {Promise<void>}
 */
async function afterJobsDelete() {
  await renderJobsTable();
  await fillRailBadges();
}

/**
 * What is true about a build's dataset, right now.
 *
 * Three answers, and they are three different facts, so none is guessed:
 *
 * - it is there, and deleting the job costs it the record of how it was made;
 * - it is gone already, and this job is the last trace of that build -- which makes the
 *   delete more obviously right rather than less, so saying so is not a warning;
 * - the question could not be answered, which is said plainly rather than resolved
 *   toward either of the other two.
 *
 * @param {string|number} id - The dataset the build names.
 * @returns {Promise<string>} One sentence for the confirmation.
 */
async function datasetClause(id) {
  try {
    await window.MarpApi.getDataset(id);
    return `Dataset ${id} is not deleted. It loses the record of the build that made it.`;
  } catch (error) {
    if (error.status === 404) {
      return `Dataset ${id} was deleted already, so this job is the last trace of that build.`;
    }

    return `Could not check whether dataset ${id} still exists (${error.status || 'no answer'}).`;
  }
}

/**
 * The delete controls: one row, a selection, or every failed job.
 *
 * **Three verbs, and the confirmation is different for each**, because what they destroy
 * is different. One job names that job. A selection names how many and that nothing in it
 * can be forced. Clearing a state asks the server what it is about to destroy and reads
 * the answer out -- the numbers measured while this was written (1,189 jobs, 3,570
 * attempts, 12,088 events) are the right shape for that sentence and the wrong thing to
 * write into one, because nothing on the page could tell when they stopped being true.
 *
 * **Observations are the thing worth stopping for.** `observations.gpu_job_id` is SET
 * NULL, so deleting a job that produced detections leaves them in place with nothing
 * recording where they came from. The route refuses with the count; this shows the count
 * and asks a second time. Only the single-job path can be confirmed that way -- a
 * selection has no second question, by design, so a job holding observations stays in it.
 *
 * @returns {void}
 */
/**
 * Cancel: one job from its row or its detail, a ticked selection, or a whole run.
 *
 * **All three were drawn and none did anything** until #279: Isaac ticked a run's pieces,
 * pressed Cancel and nothing happened. And a run is up to a hundred pieces paged eighteen
 * to a screen, so ticking cannot reach one anyway -- the run's own button sends its
 * `batch_id` and MARP finds the pieces, all of them, in one transaction.
 *
 * What came back is said in `#jobsDeleteSaid`, the screen's one place for "what the last
 * action did", and the table is redrawn so every row shows its new state.
 *
 * @returns {void}
 */
function wireJobsCancel() {
  const panel = $('table#jobs')?.closest('.panel');
  if (!panel || !window.MarpApi) return;

  /* "Skipped 12: 10 already succeeded, 2 already failed." Grouped by reason, because
     twelve ids tell nobody anything that the two reasons do not. */
  const said = (answer) => {
    const skipped = answer.skipped || [];
    const reasons = new Map();
    for (const entry of skipped) reasons.set(entry.reason, (reasons.get(entry.reason) || 0) + 1);
    const why = [...reasons].map(([reason, n]) => `${n} ${reason}`).join(', ');
    sayJobsDelete(`Cancelled ${countOf(answer.cancelled, 'job')}.${skipped.length ? ` Skipped ${skipped.length}: ${why}.` : ''}`,
      answer.cancelled ? 'ok' : 'bad');
  };

  const run = async (button, ask, body) => {
    /* eslint-disable-next-line no-alert -- the app has no dialog of its own, and stopping
       work somebody queued deserves a question. */
    if (!window.confirm(ask)) return;
    button.disabled = true;
    try {
      said(await window.MarpApi.cancelJobs(body));
      await afterJobsDelete();
    } catch (error) {
      sayJobsDelete(error.message || `Could not cancel (${error.status || 'no answer'}).`, 'bad');
    } finally {
      /* **Always, not only on failure.** A row's button is thrown away by the redraw,
         but the bulk bar's is not -- it stayed greyed after a successful cancel until
         the page was reloaded, which Isaac found on the second selection. */
      button.disabled = false;
    }
  };

  /* Delegated, for the reason `wireJobsDelete` gives: the rows are replaced on every
     filter, sort and page. */
  const body = $('table#jobs tbody', panel);
  if (body) {
    body.addEventListener('click', (event) => {
      const one = event.target.closest('[data-cancel-job]');
      const whole = event.target.closest('[data-cancel-run]');
      if (one) {
        const row = $(`tr[data-job="${CSS.escape(one.dataset.cancelJob)}"]`, body);
        const name = $('.jname .t', row)?.textContent.trim() || `Job ${one.dataset.cancelJob}`;
        run(one, `Cancel "${name}"?\n\nA machine running it stops at its next heartbeat. A cancelled job is not started again.`,
          { ids: [Number(one.dataset.cancelJob)] });
      } else if (whole) {
        run(whole, 'Cancel every piece of this run that is still queued or running?\n\n'
          + 'Pieces that have already finished keep their results. A cancelled piece is not started again.',
        { batch_id: whole.dataset.cancelRun });
      }
    });
  }

  const bulk = $('#bulkCancel', panel);
  if (bulk) {
    bulk.addEventListener('click', () => {
      const ids = $$('tbody .chkbox', panel)
        .filter((box) => box.checked)
        .map((box) => Number(box.closest('tr[data-job]')?.dataset.job))
        .filter(Boolean);
      if (!ids.length) return;
      run(bulk, `Cancel ${countOf(ids.length, 'job')}?\n\n`
        + 'Any that have already finished are skipped, and this will say how many. A cancelled job is not started again.',
      { ids });
    });
  }
}

function wireJobsDelete() {
  const panel = $('table#jobs')?.closest('.panel');
  if (!panel || !window.MarpApi) return;

  const body = $('table#jobs tbody', panel);

  /* Delegated: the rows are replaced on every filter, sort and page, so a listener
     bound to a button is a listener bound to something about to be thrown away. */
  if (body) {
    body.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-delete-job]');
      if (!button) return;

      const row = button.closest('tr[data-job]');
      const id = button.dataset.deleteJob;
      const attempts = Number(row?.dataset.attempts) || 0;
      const dataset = row?.dataset.dataset;
      const name = $('.jname .t', row)?.textContent.trim() || `Job ${id}`;

      /* Real, and from the row rather than invented: `attempts_made` travels on it
         already. The event log is named without a number because nothing serves one
         per job, and a plausible figure would be worse than an honest clause. */
      const goes = attempts
        ? `This removes ${countOf(attempts, 'attempt')} and the event log recorded against them.`
        : 'It was never attempted, so there is nothing recorded against it.';

      /* **Asked, not assumed.** A build keeps its dataset id in `spec` and nothing clears
         it when the dataset goes, so the id on this row is a claim about the past. Told
         that "dataset 385 is not deleted" about one he had deleted himself, Isaac's
         reaction was that the screen was wrong -- and it was. A confirmation promising to
         spare a row that is already gone is worse than one that says nothing, because it
         is the sentence somebody reads before agreeing.

         One request, on a destructive action, which is the right place to spend one. */
      const keeps = dataset ? `\n\n${await datasetClause(dataset)}` : '';

      /* eslint-disable-next-line no-alert -- the app has no dialog of its own, and a
         permanent delete with no confirmation at all is the worse answer. */
      if (!window.confirm(`Delete "${name}"?\n\n${goes} It cannot be undone.${keeps}`)) return;

      button.disabled = true;

      try {
        await window.MarpApi.deleteJob(id);
        sayJobsDelete(`Deleted job ${id}.`);
        await afterJobsDelete();
      } catch (error) {
        /* **The one case worth a second question.** The route answers 409 and puts the
           count in `details` as well as in its sentence, so this can ask about the
           provenance rather than repeat an API instruction at somebody. */
        const held = (error.details || [])[0];
        const orphaned = held && Number(held.observations);

        if (error.status === 409 && orphaned > 0) {
          /* eslint-disable-next-line no-alert -- as above. */
          const anyway = window.confirm(
            `Job ${id} produced ${countOf(orphaned, 'observation')}.\n\n`
            + 'Those detections stay in MARP and lose every record of what produced them: '
            + 'which model, which settings, which run. That cannot be undone and cannot be '
            + 'worked out again afterwards.\n\nDelete the job anyway?');

          if (!anyway) {
            button.disabled = false;
            sayJobsDelete(`Job ${id} was kept. ${countOf(orphaned, 'observation')} still point at it.`);
            return;
          }

          try {
            await window.MarpApi.deleteJob(id, true);
            sayJobsDelete(`Deleted job ${id}. ${countOf(orphaned, 'observation')} lost their provenance.`);
            await afterJobsDelete();
            return;
          } catch (second) {
            button.disabled = false;
            sayJobsDelete(second.message || `Could not delete job ${id}.`, 'bad');
            return;
          }
        }

        button.disabled = false;
        /* The server's own sentence: an artifact refusal names how many reference it,
           which is the useful half of why it will not go. */
        sayJobsDelete(error.message || `Could not delete job ${id} (${error.status || 'no answer'}).`, 'bad');
      }
    });
  }

  const bulkDelete = $('#bulkDelete', panel);

  if (bulkDelete) {
    bulkDelete.addEventListener('click', async () => {
      const ids = $$('tbody .chkbox', panel)
        .filter((box) => box.checked)
        .map((box) => box.closest('tr[data-job]')?.dataset.job)
        .filter(Boolean);

      if (!ids.length) return;

      /* eslint-disable-next-line no-alert -- as above. */
      if (!window.confirm(
        `Delete ${countOf(ids.length, 'job')}?\n\n`
        + 'Every attempt and every event recorded against them goes too. It cannot be undone.\n\n'
        + 'Anything that cannot safely go stays, and this will say which and why: a job an '
        + 'artifact references, and a job that produced observations. Those have to be '
        + 'deleted one at a time, where the count is shown first.')) return;

      bulkDelete.disabled = true;

      try {
        const answer = await window.MarpApi.deleteJobs(ids);
        const blocked = answer.blocked || [];

        /* **Each refusal with its own reason.** "37 of 40" tells somebody a number and
           leaves them to guess at three; the reasons are the answer they wanted. */
        sayJobsDelete(blocked.length
          ? `Deleted ${countOf(answer.deleted, 'job')}. `
            + `${blocked.length} stayed: `
            + blocked.map((entry) => `${entry.id} (${entry.reason})`).join(', ')
          : `Deleted ${countOf(answer.deleted, 'job')}.`, blocked.length ? 'bad' : 'ok');

        await afterJobsDelete();
      } catch (error) {
        sayJobsDelete(error.message || `Could not delete those jobs (${error.status || 'no answer'}).`, 'bad');
      } finally {
        bulkDelete.disabled = false;
      }
    });
  }

  const clearFailed = $('#clearFailed', panel);
  const stateSel = $$('#filters select', panel)[1];

  /* **Offered only when the list is the pile.** Narrowing to Failed is the gesture that
     means "this is what I am looking at"; a button that deletes every failed job sitting
     beside the filters the rest of the time is a button somebody eventually presses by
     accident. Absent rather than disabled, which is the same answer the row control
     gives on a running job. */
  const showClear = () => {
    if (clearFailed) clearFailed.hidden = !stateSel || stateSel.value !== 'Failed';
  };

  if (stateSel) stateSel.addEventListener('change', showClear);
  showClear();

  if (clearFailed) {
    clearFailed.addEventListener('click', async () => {
      clearFailed.disabled = true;

      try {
        /* **Counted by a GET, before anything is asked for.** Over exactly the rows the
           delete would take -- the same `NOT EXISTS` -- so the sentence and the act
           cannot disagree. It is a separate route rather than a flag on the delete
           because an unknown query parameter is ignored rather than refused: a `dryRun`
           an older MARP did not understand would have been the delete itself, and this
           would then have reported "nothing to delete" over a list it had just
           destroyed. A server without the route answers 404 and takes nothing. */
        const plan = await window.MarpApi.deletableJobs('failed');

        if (!plan.jobs) {
          sayJobsDelete(plan.blocked
            ? `Nothing to delete: all ${countOf(plan.blocked, 'failed job')} are referenced by artifacts.`
            : 'There are no failed jobs to delete.');
          return;
        }

        /* A failed dataset build is the record of a build somebody ran this morning, and
           it deserves a clause rather than being folded into a four-figure total. */
        const builds = plan.builds || [];
        const buildLine = builds.length
          ? `\n\n${builds.length} of them ${builds.length === 1 ? 'is a dataset build' : 'are dataset builds'}: `
            + builds.map((b) => `job ${b.id}${b.dataset_id ? ` to dataset ${b.dataset_id}` : ''}`).join(', ')
            + `. The dataset${builds.length === 1 ? '' : 's'} stay; only the build record goes.`
          : '';

        const blockedLine = plan.blocked
          ? `\n\n${countOf(plan.blocked, 'job')} will stay: an artifact references `
            + `${plan.blocked === 1 ? 'it' : 'them'}, and the artifacts are not touched.`
          : '';

        /* Provenance again, and at this scale it is the clause that should stop
           somebody rather than the four-figure job count. */
        const orphanLine = plan.observations
          ? `\n\n${countOf(plan.observations, 'observation')} will lose every record of what produced them.`
          : '';

        /* eslint-disable-next-line no-alert -- as above. */
        if (!window.confirm(
          `Delete ${countOf(plan.jobs, 'failed job')}?\n\nThis removes `
          + `${countOf(plan.attempts, 'attempt')} and ${countOf(plan.events, 'event')} recorded `
          + `against them. It cannot be undone.${orphanLine}${buildLine}${blockedLine}`)) return;

        const answer = await window.MarpApi.deleteJobsInState('failed');
        const blocked = answer.blocked || [];

        sayJobsDelete(blocked.length
          ? `Deleted ${countOf(answer.deleted, 'failed job')}. `
            + `${countOf(blocked.length, 'job')} stayed, held by artifacts: ${blocked.join(', ')}.`
          : `Deleted ${countOf(answer.deleted, 'failed job')}.`);

        await afterJobsDelete();
      } catch (error) {
        sayJobsDelete(error.message || `Could not delete the failed jobs (${error.status || 'no answer'}).`, 'bad');
      } finally {
        clearFailed.disabled = false;
        showClear();
      }
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

    /* **Jobs is the screen somebody leaves open while work runs**, and until now it was
       a snapshot of whenever the tab was opened. The rows are `tr[data-job]` with the
       same cell classes the Training tables use, so the patcher is the same one. */
    if (anyJobLive(jobsWindow.jobs)) {
      watchScreen({
        read: () => window.MarpApi.listJobs(ask),
        live: (window_) => anyJobLive(window_.jobs),
        patch: (window_) => {
          jobsWindow = window_;

          const issues = batchesWithIssues(window_.jobs);

          renderJobsSummary(window_.jobs);
          patchJobRows(body, new Map(window_.jobs.map((job) => [job.id, jobView(job, issues)])));
        },
      });
    }
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
/**
 * Fill an expanded job's attempts from `GET /gpu/jobs/:id`.
 *
 * **Fetched when the job is opened, not when the table is drawn.** A page is up to fifty
 * rows and nobody opens most of them, so asking for every job's attempts up front would
 * be fifty requests for one or two answers. Asked once per drawing of the row; a redraw
 * builds a new row and asks again, which is what keeps it current.
 *
 * Each attempt is one machine's go at the job, so this is where a failure's own reason
 * lives -- the last attempt's `failure_reason` is also lifted into the failed banner,
 * because that sentence is the thing somebody opened a failed job to read.
 *
 * @param {Element} detail - The expanded row.
 * @param {string} id - The job.
 * @returns {Promise<void>}
 */
async function fillJobAttempts(detail, id) {
  const place = $('[data-job-attempts]', detail);
  if (!place || !window.MarpApi) return;

  const at = (value) => {
    if (!value) return '<span class="faint">&mdash;</span>';
    /* Both halves in local time. The date was the UTC one beside a local clock, so an
       evening attempt read as tomorrow -- 23:01 on the 28th showed as the 29th. */
    const when = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${when.toTimeString().slice(0, 5)}`;
  };

  let attempts;
  try {
    ({ attempts = [] } = await window.MarpApi.getJob(id));
  } catch (error) {
    place.innerHTML = `<p class="faint">Could not load its attempts: ${escapeHtml(error.message || String(error.status || 'no answer'))}</p>`;
    return;
  }

  if (!attempts.length) {
    place.innerHTML = '<p class="faint">Never attempted.</p>';
    return;
  }

  const rows = attempts.map((one) => {
    const machine = (one.worker && one.worker.name) || (one.worker_id ? `Worker ${one.worker_id}` : '');
    const done = one.progress_total
      ? `${Number(one.progress_done || 0).toLocaleString()} / ${Number(one.progress_total).toLocaleString()} ${escapeHtml(one.progress_unit || '')}`
      : '<span class="faint">&mdash;</span>';
    return `<tr><td>${one.lease_epoch ?? ''}</td><td>${escapeHtml(machine)}</td><td>${escapeHtml(one.state || '')}</td>`
      + `<td>${done}</td><td>${escapeHtml(one.progress_phase || '')}</td><td>${at(one.leased_at)}</td>`
      + `<td>${at(one.finished_at)}</td><td>${one.failure_reason ? escapeHtml(one.failure_reason) : ''}</td></tr>`;
  }).join('');

  place.innerHTML = '<table class="tbl attempts-tbl"><thead><tr><th>Attempt</th><th>Machine</th><th>State</th>'
    + '<th>Progress</th><th>Phase</th><th>Leased</th><th>Ended</th><th>Why it ended</th></tr></thead>'
    + `<tbody>${rows}</tbody></table>`;

  const reason = [...attempts].reverse().find((one) => one.failure_reason)?.failure_reason;
  const banner = $('[data-job-failure]', detail);
  if (banner && reason) banner.textContent = reason;
}

function wireJobsOverview() {
  const table = $('table#jobs');
  if (!table) return;
  const body = $('tbody', table);
  const metric = (label, value, note = '') => `<div class="jobmetric"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
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
    const isDatasetBuild = type.toLowerCase() === 'dataset build';

    /* The dataset this build produced, as a link into the screen that owns it. The
       receiver on that side expands the row it lands on, so the reader arrives at the
       composition rather than at a table to search. No id, no link -- the same rule the
       Dashboard's rows follow. */
    const builtDataset = head.dataset.dataset;
    const datasetLink = isDatasetBuild && builtDataset
      ? `<p class="jobdetail-dataset">Built <a href="./datasets.html?dataset=${encodeURIComponent(builtDataset)}">dataset ${escapeHtml(builtDataset)}</a></p>`
      : '';

    /* **Duplicate with change, drawn only where there is somewhere to land.**
       It makes a new job from this one's spec by filling the build flow in and letting it
       be edited; nothing is created until Queue is pressed. That flow exists for a dataset
       build and for nothing else on this dashboard yet -- the Inference screen assembles a
       plan and prints it rather than submitting (`MarpApi.submitJob` has no callers), and
       `#trainBtn` has no handler at all. So an inference, tracking or training job has no
       form to arrive at, and a button that opened nothing would be the third dead control
       on this screen rather than the first working one.

       A link rather than a button because it navigates, and `?duplicate=1` is read on
       arrival. The filling itself is the Datasets screen's -- `datasetBuildSetup` and the
       `marp:duplicate-dataset-setup` event -- rather than a second implementation of
       "new build from an old spec", which is how two of them drift apart.

       It is a retry as well, which is why there is no Retry button beside it: a duplicate
       nobody edits is the same build run again, and reaching it this way never resets
       `attempts_made` or reopens a job the coordinator has closed. */
    const duplicate = isDatasetBuild && builtDataset
      ? `<a class="btn sm" href="./datasets.html?dataset=${encodeURIComponent(builtDataset)}&amp;duplicate=1"`
        + ' title="Fill the build flow with the queries this ran, to edit before queueing. Creates nothing.">'
        + '<svg class="ico"><use href="#i-copy"/></svg>Duplicate with changes</a>'
      : '';

    /* Nothing to offer is an absent strip, not an empty one. */
    const actions = (inner) => (inner ? `<div class="jobstate-actions">${inner}</div>` : '');

    /* **Only what MARP records about this job.** Every number this section used to
       draw -- a queue position worked out from the job id, "Waiting 8m 21s", "Priority
       5", "12 GB GPU", "RTX 4090", "mAP@50 0.742" -- was written into the template and
       shown on every job alike (#279). What is left comes off the row, and the attempts
       below are fetched from the job itself when it is opened. */
    const live = state === 'running' || state === 'queued';
    const batch = head.dataset.batch;
    const cancels = live
      ? `<button class="btn sm" type="button" data-cancel-job="${id}" title="Stop this job. A machine running it stops at its next heartbeat.">Cancel job</button>`
        + (batch ? `<button class="btn sm" type="button" data-cancel-run="${batch}" title="Cancel every piece of this run that is still queued or running">Cancel whole run</button>` : '')
      : '';
    const attemptText = maxAttempts ? `${attemptsMade} of ${maxAttempts}` : String(attemptsMade);
    const measured = Number.isFinite(progressValue) && progressValue >= 0;

    let operational;

    if (state === 'running') {
      operational = `<section class="jobstate" data-job-state="active"><div class="jobstate-title"><div><h4>Running</h4><p>On ${ranOn}</p></div>${measured ? `<span class="bar wide"><i style="width:${progressValue}%"></i></span>` : ''}</div><div class="jobmetrics">${metric('Progress', progress)}${metric('Attempt', attemptText)}</div>${actions(cancels)}</section>`;
    } else if (state === 'queued') {
      const note = attemptsMade ? `Back in the queue after ${countOf(attemptsMade, 'attempt')}.` : 'No machine has leased it yet.';
      operational = `<section class="jobstate" data-job-state="queued"><div class="jobstate-title"><div><h4>Waiting for a worker</h4><p>${note}</p></div></div><div class="jobmetrics">${metric('Priority', escapeHtml(priority))}${metric('Attempts', attemptText)}</div>${actions(cancels)}</section>`;
    } else if (state === 'failed') {
      operational = `<section class="jobstate" data-job-state="attention"><div class="jobstate-alert"><svg class="ico"><use href="#i-alert"/></svg><div><h4>Failed</h4><p data-job-failure>Why it ended is recorded on its last attempt, below.</p></div></div><div class="jobmetrics">${metric('Progress', progress)}${metric('Attempts', attemptText)}</div>${actions(duplicate)}</section>`;
    } else if (state === 'issues') {
      operational = `<section class="jobstate" data-job-state="attention"><div class="jobstate-alert"><svg class="ico"><use href="#i-alert"/></svg><div><h4>This piece finished; its run did not</h4><p>Another piece of the same run failed.</p></div></div><div class="jobmetrics">${metric('Progress', progress)}${metric('Attempts', attemptText)}</div></section>`;
    } else if (state === 'done') {
      operational = `<section class="jobstate" data-job-state="complete"><div class="jobstate-title"><div><h4>Finished</h4></div></div><div class="jobmetrics">${metric('Progress', progress)}${metric('Attempts', attemptText)}</div></section>`;
    } else {
      operational = `<section class="jobstate" data-job-state="cancelled"><div class="jobstate-title"><div><h4>${status}</h4></div></div><div class="jobmetrics">${metric('Stopped at', progress)}${metric('Attempts', attemptText)}</div>${actions(duplicate)}</section>`;
    }

    const expand = document.createElement('td');
    expand.className = 'ex';
    expand.innerHTML = `<button class="exbtn" type="button" aria-label="Expand ${name}"><svg class="ico sm"><use href="#i-right"/></svg></button>`;
    head.prepend(expand);

    const detail = document.createElement('tr');
    detail.className = 'runrow-body';
    detail.hidden = true;
    detail.innerHTML = `<td colspan="12"><div class="rundetail jobdetail">
      <div class="jobdetail-head"><div><b>${name}</b><span>Job ${id} · ${type}</span>${datasetLink}</div><span class="st" data-state="${state}"><span class="dot"></span>${status}</span></div>
      <div class="jobdetail-grid jobidentity">
        <dl class="kv"><dt>Job ID</dt><dd class="mono">${id}</dd><dt>Type</dt><dd>${type}</dd><dt>Scope</dt><dd>${scope}${scopeContext ? ` <span class="faint">· ${scopeContext}</span>` : ''}</dd><dt>${isDatasetBuild ? 'Build output' : 'Locked model'}</dt><dd>${model} <span class="faint">${modelVersion}</span><div class="locked">Immutable from submission</div></dd></dl>
        <dl class="kv"><dt>Submitted</dt><dd>${submitted}</dd><dt>Submitted by</dt><dd>${submittedBy}</dd><dt>Priority</dt><dd>${priority}</dd><dt>Attempt policy</dt><dd>Up to ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'}</dd></dl>
      </div>
      ${operational}
      <details class="diag"><summary>Diagnostics<span class="later">Every attempt, and why each ended</span></summary><div class="dbody">
        <dl class="kv"><dt>Attempt</dt><dd>${attemptsMade} of ${maxAttempts}</dd><dt>Ran on</dt><dd>${ranOn}</dd><dt>Machines tried</dt><dd>${machines}</dd><dt>Job ID</dt><dd class="mono">${id}</dd></dl>
        <div class="jobattempts" data-job-attempts="${id}"><p class="faint">Opening the job loads its attempts.</p></div>
      </div></details>
    </div></td>`;
    head.after(detail);

    /* However it was opened -- its own row, Expand all, or a `?job=` link -- the row's
       `hidden` is what changes, so that is what is watched. Once per drawing. */
    const watch = new MutationObserver(() => {
      if (detail.hidden) return;
      watch.disconnect();
      fillJobAttempts(detail, id);
    });
    watch.observe(detail, { attributes: true, attributeFilter: ['hidden'] });
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
  /* The shared ladder; see `wirePoolUtilization`. Shortest first, which four of the eight
     already did and the other four did not. */
  const RANGES = {
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
    '7d': { hours: 168, bucket: 'hour', label: 'the last 7 days' },
    '30d': { hours: 720, bucket: 'day', label: 'the last 30 days' },
  };

  const buttons = $$('[data-jobs-range]', root);
  const chart = $('.jobs-chart', root);
  const blank = () => { if (chart) chart.innerHTML = ''; };
  let range = '24h';

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
        blank();
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
        blank();
        if (chart) chart.setAttribute('aria-label', `No jobs submitted or finished in ${label}`);
        root.classList.add('is-quiet');
        return;
      }

      root.classList.remove('is-quiet');

      /* In whole jobs: a job and a half is not a count. */
      const at = points.map((p) => Date.parse(p.at));
      const pair = (values) => values.map((value, index) => [at[index], value]);

      if (chart) {
        drawActivity(chart, activityOption({
          root,
          axes: [{ whole: true }],
          series: [
            { id: 'started', name: 'Started', css: 'jobs-line started', data: pair(samples.started) },
            { id: 'completed', name: 'Completed', css: 'jobs-line completed', data: pair(samples.completed) },
            { id: 'queued', name: 'Queued', css: 'jobs-line queued', data: pair(samples.queued) },
          ],
        }), `Job activity over ${label}: `
          + `${samples.started.at(-1)} submitted, ${samples.completed.at(-1)} finished, `
          + `${samples.queued.at(-1)} waiting`, `jobs-activity-${range}`);
      }
    } catch (error) {
      blank();
      if (chart) chart.setAttribute('aria-label', `Could not load job activity (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.jobsRange)));
  choose(range);
}

/**
 * Draw one of the operational charts from a series.
 *
 * Inference, Models and Datasets share this: a left axis, sometimes a right one, a few
 * series keyed by name, and a run of current readings underneath. Only the data and the
 * labels differ, so it lives here once. ECharts draws it (#275), through `activityOption`.
 *
 * @param {Object} spec
 * @param {Element} spec.root - The panel.
 * @param {string} spec.prefix - The dataset prefix its markup uses: `inference`, `ops`.
 * @param {Object} spec.ranges - `{button: {since(), bucket, label}}`.
 * @param {string} spec.initial - Which range to open on.
 * @param {function(Object): Promise<Object>} spec.fetch - Given `{since, until, bucket}`, the answer.
 * @param {function(Object): Object} spec.read - Turns that answer into `{series, scales, current, quiet}`.
 * @param {Object} spec.looks - `{name: {css, kind}}`: each series' colour key and whether it
 *   is an `area` or a `line`. A series not named here is not drawn.
 * @param {string[]} [spec.onRight] - The series measured on the right-hand axis.
 * @returns {Promise<void>}
 */
async function drawSeriesChart({ root, prefix, ranges, initial, fetch: ask, read, looks, onRight = [] }) {
  if (!root) return;

  const camel = (name) => prefix + name[0].toUpperCase() + name.slice(1);
  const buttons = $$(`[data-${prefix}-range]`, root);
  const chart = $('.inference-chart, .ops-chart, .dataset-chart', root);

  /* The legend key's own words for a series, so a tooltip says what the key says. */
  const nameOf = (name) => $(`[data-${prefix}-highlight="${name}"]`, root)?.textContent.trim() || name;

  const blank = () => { if (chart) chart.innerHTML = ''; };

  wireSeriesKeys(root, `data-${prefix}-highlight`, chart);

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
      const { series, scales, current, quiet, points } = read(answer, { ...span, label: range.label });

      if (quiet) {
        blank();
        root.classList.add('is-quiet');
        if (chart) chart.setAttribute('aria-label', `${range.empty || 'Nothing recorded'} in ${range.label}`);
        return;
      }

      root.classList.remove('is-quiet');

      /* A series the data cannot fill is left undrawn rather than flattened to zero: an
         empty track says "not recorded", a line along the floor says "recorded, and none". */
      const at = points.map((p) => Date.parse(p.at));
      const drawn = Object.entries(series).filter(([name]) => looks[name]).map(([name, values]) => ({
        id: name, name: nameOf(name), css: looks[name].css, kind: looks[name].kind || 'line',
        axis: onRight.includes(name) ? 1 : 0, data: values.map((value, index) => [at[index], value]),
      }));
      const axes = [{ format: scales.formatLeft }];
      if (drawn.some((one) => one.axis === 1)) axes.push({ format: scales.formatRight, whole: true });

      if (chart) {
        drawActivity(chart, activityOption({ root, series: drawn, axes }),
          current.aria || chart.getAttribute('aria-label') || '', `${prefix}-${next}`);
      }

      /* **The unit travels with the figure.** A number beside a chart with a one-word
         label is the Jobs badge problem again -- `1,189` with nothing saying "failed".
         The window these are read over changes with the range buttons, so the words
         cannot live in the markup: `read` says what each figure is, and says it against
         the range it was actually computed for. */
      $$(`[data-${prefix}-unit]`, root).forEach((node) => {
        const said = (current.units || {})[node.dataset[camel('unit')]];

        if (said !== undefined) node.textContent = said;
      });

      $$(`[data-${prefix}-current]`, root).forEach((node) => {
        const value = current[node.dataset[camel('current')]];
        node.textContent = value === undefined ? '' : value;
        /* An empty value hides its node rather than leaving the label beside it
           stranded: "Clears in" with no duration reads as a rendering failure. */
        node.hidden = !node.textContent;
      });
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
  if (!root || !$('.inference-chart', root)) return;

  return drawSeriesChart({
    root,
    prefix: 'inference',
    looks: { throughput: { css: 'throughput', kind: 'area' }, backlog: { css: 'backlog' } },
    initial: '24h',
    ranges: {
      /* The shared ladder; see `wirePoolUtilization`. */
      '1h': { since: (u) => new Date(u - 3600e3), bucket: 'minute', label: 'the last hour', empty: 'No frames processed' },
      '24h': { since: (u) => new Date(u - 24 * 3600e3), bucket: 'hour', label: 'the last 24 hours', empty: 'No frames processed' },
      '7d': { since: (u) => new Date(u - 7 * 86400e3), bucket: 'hour', label: 'the last 7 days', empty: 'No frames processed' },
      '30d': { since: (u) => new Date(u - 30 * 86400e3), bucket: 'day', label: 'the last 30 days', empty: 'No frames processed' },
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
  if (!root || !$('.ops-chart', root)) return;

  return drawSeriesChart({
    root,
    prefix: 'ops',
    looks: { registered: { css: 'registered', kind: 'area' }, in_use: { css: 'preferred' }, coverage: { css: 'coverage' } },
    initial: '1y',
    ranges: {
      /* The shared ladder; see `wirePoolUtilization`. A model is registered rarely, so
         this one opens on the widest rung rather than the narrowest: a 24-hour default
         would be empty almost every day it was looked at. */
      '24h': { since: (u) => new Date(u - 24 * 3600e3), bucket: 'hour', label: 'the last 24 hours', empty: 'No models registered' },
      '7d': { since: (u) => new Date(u - 7 * 86400e3), bucket: 'day', label: 'the last 7 days', empty: 'No models registered' },
      '30d': { since: (u) => new Date(u - 30 * 86400e3), bucket: 'day', label: 'the last 30 days', empty: 'No models registered' },
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
/**
 * An activity chart's option: time along the bottom, one or two value axes.
 *
 * **One builder for every screen's activity panel**, because they are the same chart --
 * Training, Datasets, Inference, Models, Jobs and the Dashboard each plot a few series
 * from `/gpu/*\/series` over a chosen range -- and six hand-drawn copies of it is what
 * #275 was filed against.
 *
 * Each series names the CSS key its colour and dash already come from, read inside the
 * panel because those keys are scoped to it. A null reading stays null, so a line breaks
 * where nothing was recorded rather than dropping to zero.
 *
 * @param {Object} spec - `{root, axes, series}`. `axes` is `[{name, max, unit, whole, format,
 *   hidden}]` -- `hidden` for a scale a series needs and the chart has no room to label;
 *   each series is `{id, name, css, kind, axis, unit, format, data}`, `kind` being `line`, `area`,
 *   `fill` (an area with no line, shaded as the panel's CSS says) or `bar`, and `data`
 *   `[[ms, value], ...]`.
 * @returns {Object} The ECharts option.
 */
function activityOption({ root, axes, series }) {
  const theme = chartTheme();

  return {
    grid: { left: 50, right: axes.length > 1 ? 46 : 18, top: 30, bottom: 28 },
    legend: { show: false },
    /* Top centre: both top corners carry an axis title on these charts. */
    toolbox: { ...theme.toolbox, right: 'auto', left: 'center' },
    xAxis: {
      type: 'time', ...theme.axis, splitLine: { show: false },
      axisLabel: { ...theme.axis.axisLabel, hideOverlap: true, formatter: { day: '{MM}-{dd}', hour: '{HH}:{mm}', minute: '{HH}:{mm}' } },
    },
    yAxis: axes.map((axis, index) => ({
      type: 'value', name: axis.name, min: 0, max: axis.max, minInterval: axis.whole ? 1 : undefined, show: !axis.hidden,
      ...theme.axis, splitLine: index ? { show: false } : theme.axis.splitLine,
      axisLabel: { ...theme.axis.axisLabel, formatter: axis.format || (axis.unit ? `{value}${axis.unit}` : '{value}') },
    })),
    tooltip: { ...theme.tooltip },
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
    series: series.map((one) => {
      const { color, dash, fill } = chartKey(one.css, root);
      const shared = {
        id: one.id, name: one.name, yAxisIndex: one.axis || 0, data: one.data, itemStyle: { color },
        emphasis: { focus: 'series' }, blur: { lineStyle: { opacity: 0.12 }, itemStyle: { opacity: 0.12 }, areaStyle: { opacity: 0.03 } },
        tooltip: {
          valueFormatter: (value) => {
            if (value === null || value === undefined) return 'not recorded';
            if (one.format) return one.format(value);
            return `${Number.isInteger(value) ? value : Number(value).toFixed(1)}${one.unit || ''}`;
          },
        },
      };

      if (one.kind === 'bar') {
        return { ...shared, type: 'bar', barMaxWidth: 14, itemStyle: { color: fill || color, borderColor: color, borderWidth: 1 } };
      }

      /* `fill` is an area the panel shades itself, with its own transparency, and draws
         without an outline -- the pool chart's two utilisation bands. */
      if (one.kind === 'fill') {
        return { ...shared, type: 'line', showSymbol: false, connectNulls: false, lineStyle: { width: 0 }, areaStyle: { color: fill || color, opacity: 1 } };
      }

      return {
        ...shared, type: 'line', showSymbol: false, connectNulls: false,
        lineStyle: { color, width: 2.2, type: dash || 'solid' },
        areaStyle: one.kind === 'area' ? { color, opacity: 0.09 } : undefined,
      };
    }),
  };
}

/**
 * Draw an activity chart into its panel's chart box.
 *
 * @param {Element} box - The panel's chart box, which keeps its own frame and label.
 * @param {Object} option - From `activityOption`.
 * @param {string} label - What the chart shows, for a screen reader and for hover.
 * @param {string} key - Stable across redraws of the same range, so a zoom survives one.
 * @returns {void}
 */
function drawActivity(box, option, label, key) {
  box.innerHTML = chartSlot(option, label, { key, bare: true });
  box.setAttribute('aria-label', label);
  box.title = label;
}

/**
 * Light one series of a panel's chart and dim the rest, or restore them all.
 *
 * What the panels' key buttons did to the hand-drawn paths, done through ECharts so the
 * buttons keep working on the chart that replaced them.
 *
 * @param {Element} box - The chart box.
 * @param {string} id - The series to light; empty restores every series.
 * @returns {void}
 */
function highlightSeries(box, id) {
  const chart = box && $('[data-chart]', box)?.marpChart;
  if (!chart) return;
  chart.dispatchAction({ type: 'downplay' });
  if (id) chart.dispatchAction({ type: 'highlight', seriesId: id });
}

/**
 * Make a panel's key buttons light their series: press one to light it, again to restore.
 *
 * **These keys were drawn as buttons and wired to nothing** on the Inference, Models,
 * Datasets and Dashboard charts; only Training's did anything. One wiring for all of them.
 *
 * @param {Element} root - The panel.
 * @param {string} attr - The key buttons' attribute, such as `data-pool-highlight`.
 * @param {Element} box - The chart box.
 * @returns {void}
 */
function wireSeriesKeys(root, attr, box) {
  const keys = $$(`[${attr}]`, root);
  keys.forEach((button) => {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const id = button.getAttribute(attr);
      const on = button.getAttribute('aria-pressed') !== 'true';
      keys.forEach((other) => other.setAttribute('aria-pressed', String(on && other === button)));
      highlightSeries(box, on ? id : '');
    });
  });
}

function wireTrainingActivity() {
  const root = $('[data-training-activity]');
  if (!root) return;
  const buttons = $$('[data-training-range]', root);
  const chart = $('.training-chart', root);
  /* **Real, and the same two reads the Datasets activity chart makes.** This drew four
     hardcoded arrays per range -- the tiles above said 1 running, 0 queued, 2 completed
     while the footer said 2, 3 and 3, because the footer was a mockup. `GET
     /gpu/jobs/series` takes `kind`, which is validated against `JOB_KINDS` and includes
     `training`, so no route had to be added for this. */
  const RANGES = {
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
    '7d': { hours: 168, bucket: 'hour', label: 'the last 7 days' },
    '30d': { hours: 720, bucket: 'day', label: 'the last 30 days' },
  };

  let range = '1h';
  let samples = null;
  /**
   * A series the window recorded nothing for.
   *
   * **Not the same as a series of zeroes**, and the difference matters most for training
   * compute: `avg_training_utilization_percent` comes from `gpu_worker_samples`, which is
   * only written while a worker holds a lease and heartbeats. A flat 0% line would say the
   * GPUs were idle; nothing sampling says nobody looked.
   *
   * @param {Array<number|null>} values - The series.
   * @returns {boolean} True when not one point was measured.
   */
  const unmeasured = (values) => !values.some((value) => value !== null && value !== undefined);

  /* Blank reads as still loading. A dash reads as nothing recorded, which is what it is. */
  const NO_READING = '<span class="dash" title="Not recorded in this window">&mdash;</span>';
  const set = (name, text) => {
    const into = $(`[data-training-current="${name}"]`, root);

    if (into) into.innerHTML = text;
  };
  const clearReadouts = () => ['compute', 'running', 'queued', 'completed']
    .forEach((name) => set(name, NO_READING));

  const draw = () => {
    if (!samples) return;

    const { at, compute, running, queued, completed, label } = samples;
    const computeOff = unmeasured(compute);
    const pair = (values) => values.map((value, index) => [at[index], value]);

    /* The legend says which line is not there, rather than the chart implying a flat
       zero. Disabled, so it cannot be highlighted to reveal nothing. */
    const computeKey = $('[data-training-highlight="compute"]', root);

    if (computeKey) {
      computeKey.disabled = computeOff;
      computeKey.title = computeOff
        ? 'Not recorded in this window: a GPU reading is written only while a worker holds a lease and heartbeats'
        : 'Highlight only training GPU compute on this graph';
    }

    const totalCompleted = completed.reduce((sum, value) => sum + value, 0);

    set('compute', computeOff ? NO_READING : `${Math.round(compute.filter((v) => v != null).at(-1) ?? 0)}%`);
    set('running', String(running.at(-1) ?? 0));
    set('queued', String(queued.at(-1) ?? 0));
    set('completed', String(totalCompleted));

    const said = `All training activity over ${label}: `
      + `${computeOff ? 'no GPU reading recorded' : `${Math.round(compute.filter((v) => v != null).at(-1) ?? 0)}% of GPU compute used by training`}, `
      + `${running.at(-1) ?? 0} running, ${queued.at(-1) ?? 0} queued and ${totalCompleted} runs completed`;

    /* One scale for the three job counts so they can be read against each other, and a
       fixed 0-100 for the percentage, which is not a count. A compute reading nothing
       recorded stays a gap: it used to be drawn as 0%, which said the GPUs sat idle. */
    const series = [
      ...(computeOff ? [] : [{ id: 'compute', name: 'Training GPU compute', css: 'compute', kind: 'area', unit: '%', data: pair(compute) }]),
      { id: 'running', name: 'Running jobs', css: 'running', axis: 1, data: pair(running) },
      { id: 'queued', name: 'Queued jobs', css: 'queued', axis: 1, data: pair(queued) },
      { id: 'completed', name: 'Completed runs', css: 'completed', kind: 'bar', axis: 1, data: pair(completed) },
    ];

    drawActivity(chart, activityOption({
      root, series, axes: [{ name: 'GPU compute', max: 100, unit: '%' }, { name: 'Jobs', whole: true }],
    }), said, `training-activity-${range}`);
    highlightSeries(chart, root.dataset.highlight);
  };

  const choose = async (next) => {
    range = RANGES[next] ? next : '1h';

    const { hours, bucket, label } = RANGES[range];

    buttons.forEach((button) => {
      const on = button.dataset.trainingRange === range;

      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });

    const until = new Date();
    const since = new Date(until.getTime() - hours * 3600e3);
    const span = { since: since.toISOString(), until: until.toISOString(), bucket };

    try {
      const jobs = await window.MarpApi.jobSeries({ ...span, kind: 'training' });
      const points = jobs.points || [];

      if (!points.length) {
        root.classList.add('is-quiet');
        samples = null;
        clearReadouts();
        chart.setAttribute('aria-label', `No training activity in ${label}`);
        return;
      }

      root.classList.remove('is-quiet');

      /* **`succeeded`, not `finished`.** A training job that failed has finished, and
         counting it under a line labelled *completed runs* would say a model came out of
         it -- the same decision the Datasets chart makes for builds. */
      samples = {
        label,
        at: points.map((p) => Date.parse(p.at)),
        compute: points.map((p) => (p.avg_training_utilization_percent == null
          ? null : Number(p.avg_training_utilization_percent))),
        running: points.map((p) => Number(p.training_machines) || 0),
        queued: points.map((p) => Number(p.waiting) || 0),
        completed: points.map((p) => Number(p.succeeded) || 0),
      };

      draw();
    } catch (error) {
      root.classList.add('is-quiet');
      samples = null;
      clearReadouts();
      chart.setAttribute('aria-label', `Could not read training activity (${error.status || 'no answer'})`);
    }
  };

  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.trainingRange)));
  const highlightButtons = $$('[data-training-highlight]', root);
  const highlight = (name = '') => {
    const active = root.dataset.highlight === name ? '' : name;
    root.dataset.highlight = active;
    root.classList.toggle('is-highlighted', Boolean(active));
    highlightButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.trainingHighlight === active)));
    highlightSeries(chart, active);
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
  /* **The jitter is gone with the fixture.** A three-second timer nudged the last compute
     reading up and down so the chart looked alive. That was the mockup's liveliness and it
     would now be editing a real measurement -- which is worse than a still chart, because
     a number that moves reads as a number somebody is recording. The chart refreshes when
     a range is chosen; nothing invents motion between times. */
  choose(range);
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
  if (!root || !$('.dataset-chart', root)) return;

  return drawSeriesChart({
    root,
    prefix: 'dataset',
    looks: { rate: { css: 'throughput', kind: 'area' }, waiting: { css: 'backlog' }, finished: { css: 'done' } },
    /* Builds are counted in ones, frames in thousands: two axes, so neither flattens. */
    onRight: ['waiting', 'finished'],
    initial: '24h',
    ranges: {
      '24h': { since: (u) => new Date(u - 24 * 3600e3), bucket: 'hour', label: 'the last 24 hours', empty: 'No build activity' },
      '7d': { since: (u) => new Date(u - 7 * 24 * 3600e3), bucket: 'day', label: 'the last 7 days', empty: 'No build activity' },
      '30d': { since: (u) => new Date(u - 30 * 24 * 3600e3), bucket: 'day', label: 'the last 30 days', empty: 'No build activity' },
      '1y': { since: (u) => new Date(u - 365 * 24 * 3600e3), bucket: 'day', label: 'the last year', empty: 'No build activity' },
    },
    fetch: (span) => Promise.all([
      window.MarpApi.throughputSeries({ ...span, kind: 'dataset_build' }),
      window.MarpApi.jobSeries({ ...span, kind: 'dataset_build' }),
    ]).then(([rate, jobs]) => ({ rate, jobs })),
    read: ({ rate, jobs }, span) => {
      /* The bucket the route was asked for, so the figures can name their own window
         rather than implying they all share one. */
      const bucketWord = span.bucket === 'hour' ? 'hour' : 'day';

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
        /* **Each figure says what it counts and over what, and the fourth one is gone.**
           Isaac, on `14k frames - 2 waiting - 4 completed - 2 in flight`: *"which i'm not
           sure what is telling us."* He was right not to trust it.

           `2 in flight` was `waitingNow` a second time, under a word that means something
           else -- there was no leased build on his database at all, and "in flight" never
           read that. One number, twice, once wrongly labelled.

           The other three were bare figures over unstated windows that are not even the
           same window as each other: frames and waiting are the **last bucket**, an hour
           on the 24h view and a whole day on 7d and 30d, while completed is a **sum over
           the range**. Saying so is most of the fix. */
        current: {
          rate: compactCount(frames.at(-1)),
          waiting: String(waitingNow),
          finished: String(completed),
          units: {
            rate: `frames in the last ${bucketWord}`,
            waiting: waitingNow === 1 ? `build unfinished at the start of this ${bucketWord}` : `builds unfinished at the start of this ${bucketWord}`,
            finished: `completed in ${span.label}`,
          },
          aria: `Dataset build activity: ${compactCount(frames.at(-1))} frames extracted in the last ${bucketWord}, `
            + `${waitingNow} build${waitingNow === 1 ? '' : 's'} unfinished at the start of it, `
            + `${completed} completed in ${span.label}`,
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
 * The models inference may actually run, once.
 *
 * **Not the whole registry.** A pretrained base model is registered and the registry
 * screen should show it, but inference must never be handed one: its classes are the
 * upstream vocabulary rather than MARP species, so what it emits would be resolved
 * against the species catalogue and written into the record. Submission refuses one,
 * so this picker was offering a choice the API would reject -- found by driving the
 * tab rather than by reading it.
 *
 * @returns {Promise<Object[]>} Active, runnable models by name. Empty if MARP would not say.
 */
function loadRunnableModels() {
  if (!registryAsked) {
    registryAsked = (window.MarpApi?.listRunnableModels?.() || Promise.resolve([]))
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
    /* **Named for the keys the worker reads, and opened at the values it would use.**
       Every one of these was a name the worker does not honour, so a run reported
       them as ignored and used its own number instead. Detection confidence showed
       0.25 while an unset confidence runs at 0.15 -- the screen stating one
       measurement and the GPU applying another. `tracking_engine.py` is the source:
       `params.get("confidence", params.get("conf", 0.15))`, `_INFERENCE_OPTIONS` for
       the predict() settings, and ByteTrack's own four. */
    + '<label>Detection confidence<input class="inp" type="number" min="0" max="1" step="0.01" value="0.15" data-setting="confidence"></label>'
    + '<label>NMS IoU<input class="inp" type="number" min="0" max="1" step="0.01" value="0.45" data-setting="iou"></label>'
    + '<label>Track threshold<input class="inp" type="number" min="0" max="1" step="0.01" value="0.30" data-setting="track_thresh"></label>'
    + '<label>Match threshold<input class="inp" type="number" min="0" max="1" step="0.01" value="0.70" data-setting="match_thresh"></label>'
    + '<label>Track buffer (frames)<input class="inp" type="number" min="1" value="240" data-setting="track_buffer"></label>'
    /* **Minutes, not frames.** This was a frame count defaulting to 900 -- carried over
       from the mockup, never chosen -- which is thirty seconds of 30 fps video and cut
       three videos into 82 jobs. MARP converts at each video's own rate. */
    + '<label>Piece length (minutes)<input class="inp" type="number" min="0.5" step="0.5" value="5" data-setting="piece_minutes"></label>'
    + '<label class="check"><input type="checkbox" data-setting="mot20"><span>MOT20 mode</span></label>'
    /* Stated rather than chosen. `reduction/keyframes.py` registers exactly one --
       `("v3_dirpad", "1")` -- and the two options here were "Best frame of each
       track" and "Every detection", neither of which a worker could have run. */
    + '<label>Reduction<input class="inp" type="text" value="v3_dirpad v1" readonly disabled></label>'
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
  const models = await loadRunnableModels();

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
    note.textContent = `${chosen}${classes} · conf ${get('confidence') ?? ''}`;
  }

  /* The leading zero goes, because the fold's own line is tight and ".18" reads
     as a confidence to anybody who has used one. */
  const trim = (value) => String(value ?? '').replace(/^0(?=\.)/, '');

  if (now) now.textContent = `conf ${trim(get('confidence'))} · match ${trim(get('match_thresh'))} · buffer ${get('track_buffer') ?? ''}`;
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

/**
 * The engine a "Detection + ByteTrack" run is.
 *
 * **Read off the worker's own registry, not chosen.** `engines/engine_registry.py`
 * registers `mock`, `ultralytics`, `marp_tracking` and `marp_training`, and
 * `get_job_engine` refuses anything that is not a `BaseEngine` -- `UltralyticsEngine` is
 * `FrameInferenceCapable`, the single-frame engine behind the frame routes, so a video
 * job must be `marp_tracking`. There is no `marp_inference`, whatever MARP's older notes
 * say.
 *
 * @constant {string}
 */
const INFERENCE_ENGINE = 'marp_tracking';

/**
 * The keyframe rule applied to finished tracks.
 *
 * `reduction/keyframes.py` registers exactly one, keyed `("v3_dirpad", "1")`. The version
 * is sent as a string because that tuple key is a string; the worker stringifies anyway,
 * but relying on that is relying on a coincidence.
 *
 * @constant {{name: string, version: string}}
 */
const INFERENCE_REDUCTION = Object.freeze({ name: 'v3_dirpad', version: '1' });

/**
 * Say how a submission went, where somebody about to click again will see it.
 *
 * @param {string} text - What happened.
 * @param {string} [kind] - `ok` or `warning`, for the styling.
 * @returns {void}
 */
function sayRunStatus(text, kind) {
  const status = $('[data-fills="run-status"]');

  if (!status) return;

  status.textContent = text;
  status.dataset.state = kind || '';
}

/**
 * Fill every run group's MARP project picker.
 *
 * **MARP projects, not the Jellyfin folders above.** The video query panel browses
 * Jellyfin's own hierarchy, whose "project" is a directory name; a session belongs to a
 * row in `projects`, and the two are not the same thing. Submitting the Jellyfin name
 * would be submitting a string MARP cannot resolve.
 *
 * @async
 * @returns {Promise<void>}
 */
async function fillProjectPickers() {
  const pickers = $$('[data-marp-project]');

  if (!pickers.length || !window.MarpApi) return;

  const projects = await (window.MarpApi.listProjects
    ? window.MarpApi.listProjects().catch(() => [])
    : Promise.resolve([]));

  /* **Nothing selected to begin with.** A select takes its first option by default, so a
     picker that opened on a project nobody chose would file a dive's observations under
     whichever project sorted first -- silently, and in a record people query later. The
     empty option makes the refusal below fire instead. */
  const options = (projects || []).length
    ? '<option value="">Choose a project</option>' + projects.map((project) => {
      const id = project.project_id === undefined ? project.id : project.project_id;

      return '<option value="' + id + '">' + escapeHtml(project.name || ('Project ' + id)) + '</option>';
    }).join('')
    : '<option value="">No projects</option>';

  pickers.forEach((picker) => {
    /* Only an empty one, so refilling does not throw away a choice somebody made. */
    if (!picker.options.length) picker.innerHTML = options;
  });
}

/**
 * The settings a model config asks for, under the names the worker reads.
 *
 * **Only what was changed is sent.** The worker records each setting with a `source` of
 * `job` or `default`, so a value sent because it happened to be sitting in the box
 * reports as a choice somebody made. Confidence is the one that matters: the field opens
 * at the worker's own 0.15, and sending that back would claim a decision nobody took.
 *
 * @param {Element} config - The `[data-model-config]` element.
 * @returns {Object} `spec.params`, which may be empty.
 */
function inferenceParams(config) {
  const params = {};

  $$('[data-setting]', config).forEach((input) => {
    const key = input.dataset.setting;

    // Not a worker setting: it splits the submission into jobs, which is MARP's business.
    if (key === 'piece_minutes' || input.disabled) return;

    if (input.type === 'checkbox') {
      if (input.checked) params[key] = true;

      return;
    }

    const raw = String(input.value === undefined || input.value === null ? '' : input.value).trim();

    if (raw === '' || Number(raw) === Number(input.defaultValue)) return;

    params[key] = Number(raw);
  });

  return params;
}

/**
 * Every job the plan on screen describes, or why none of them can be submitted.
 *
 * One body per target per model configuration, which is what the plan's own arithmetic
 * already says: *N model runs across M selected video ranges*.
 *
 * **Refusals rather than a partial submission.** Each is something a person can act on,
 * and all of them are collected rather than the first -- a plan missing a line on four
 * cards should say so once, not four times over four clicks.
 *
 * @async
 * @returns {Promise<{bodies: Object[]}|{refusals: string[]}>}
 */
async function inferenceSubmissions() {
  const models = await loadRunnableModels();
  const bodies = [];
  const refusals = [];
  const name = ($('#jobname') ? $('#jobname').value : '').trim() || defaultJobName();

  $$('[data-run-group]').forEach((group, index) => {
    const where = 'Run group ' + (index + 1);
    const picker = $('[data-marp-project]', group);
    const projectId = Number(picker ? picker.value : NaN);
    const targets = $$('[data-target]', group);
    const configs = $$('[data-model-config]', group);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      refusals.push(where + ': choose the MARP project its observations belong to.');
    }

    if (!targets.length) refusals.push(where + ': add at least one video range.');
    if (!configs.length) refusals.push(where + ': add at least one model.');

    targets.forEach((target) => {
      const dive = (target.dataset.videoDive || '').trim();
      const line = (target.dataset.videoLine || '').trim();
      const named = $('b', target);
      const label = (named ? named.textContent.trim() : '') || target.dataset.videoId;

      /* Both identify the session and neither can be guessed. A line is typed onto the
         card and saved; a dive comes from the Jellyfin hierarchy. */
      if (!dive) refusals.push(where + ': ' + label + ' has no dive, so its session cannot be placed.');
      if (!line) refusals.push(where + ': ' + label + ' has no line. Type it into the Line box on its card.');

      configs.forEach((config) => {
        const pick = $('[data-model-pick]', config);
        const model = models.find((row) => row.id === Number(pick ? pick.value : NaN));

        if (!model) {
          refusals.push(where + ': choose a model.');

          return;
        }

        /* **The worker hashes what it fetched and refuses a mismatch**, and MARP refuses
           a spec without a hash. A model registered before `artifact_sha256` existed has
           none, and reaches the API as a 400 that reads like a defect in this screen. */
        if (!model.artifact_sha256) {
          refusals.push(where + ': ' + model.name + ' has no recorded checksum, so a worker would '
            + 'have nothing to verify its weights against. Run '
            + 'scripts/backfill-model-artifact-sha256.js where the model store lives.');

          return;
        }

        const piece = $('[data-setting="piece_minutes"]', config);
        const pieceMinutes = Number(piece ? piece.value : NaN);
        const params = inferenceParams(config);
        const body = {
          kind: 'inference',
          name,
          spec: {
            engine: INFERENCE_ENGINE,
            /* An item id, never a URL: MARP resolves it to something playable when the
               job is leased, and the Jellyfin item supplies `source_name`. */
            video: { jellyfin_item_id: target.dataset.videoId },
            model: {
              ml_model_id: model.id,
              name: model.name,
              // Coordinator-relative, so a worker resolves it against whichever MARP it
              // is enrolled with rather than a path on somebody's disk.
              url: '/api/v2/model/' + model.id + '/artifact',
              sha256: String(model.artifact_sha256).toLowerCase(),
            },
            reduction: Object.assign({}, INFERENCE_REDUCTION),
            /* **A session per run, under the dive**, and `type` left out so MARP derives
               it from the model's species list -- the screen has no business restating
               something the registry already knows. No `range`: MARP works the frame
               count out from the Jellyfin item and reports back what it decided, which
               beats this screen guessing at a video's length. */
            session: { project_id: projectId, dive, line, per_run: true },
          },
        };

        /* **Sent only when somebody scoped the run.** Left out, MARP derives the end
           from the Jellyfin item and reports back what it decided -- which is the one
           thing this screen could not work out for itself. A half-open range, so
           `to` is one past the last frame, exactly as the API documents it. */
        const from = (target.dataset.startFrame || '').trim();
        const to = (target.dataset.endFrame || '').trim();

        if (from !== '' || to !== '') {
          body.spec.range = {};

          if (from !== '') body.spec.range.start_frame = Number(from);
          if (to !== '') body.spec.range.end_frame = Number(to);
        }

        if (Number.isFinite(pieceMinutes) && pieceMinutes > 0) body.piece_seconds = pieceMinutes * 60;
        if (Object.keys(params).length) body.spec.params = params;

        bodies.push(body);
      });
    });
  });

  return refusals.length ? { refusals } : { bodies };
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
    /* Read as text and kept as text: an empty box is "not set", and `Number('')` is 0,
       which would silently submit frame 0 as a deliberate start. */
    const from = $('[data-start-frame]', choice)?.value.trim() || '';
    const to = $('[data-end-frame]', choice)?.value.trim() || '';

    return {
      id: choice.dataset.videoId,
      title,
      dive,
      line,
      from,
      to,
      range: from || to ? `Frames ${from || '0'}\u2013${to || 'end'}` : 'Entire video',
    };
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
    + safe(parts.id) + '" data-video-dive="' + safe(parts.dive || '')
    /* The line was in the card's prose and nowhere a submission could read it, so a
       plan that displayed "Line 4" submitted nothing of the sort. */
    + '" data-video-line="' + safe(parts.line || '')
    + '" data-start-frame="' + safe(parts.from || '')
    + '" data-end-frame="' + safe(parts.to || '') + '"><span class="mini-thumb' + (parts.line ? '' : ' pending') + '">'
    + (parts.line ? 'L' + safe(parts.line) : '—') + '</span><span><b class="mono">' + safe(parts.title)
    + '</b><small>' + (parts.dive ? safe(parts.dive) + ' · ' : '') + safe(parts.range)
    /* **The line is typed here too.** It used to be read only from the picker at the
       moment of Add, so a video added before its line was typed -- the natural order --
       sat at "Line not assigned" with nowhere to put one, and the only way out was to
       remove it and add it again. Isaac: *"it doesn't allow me to type a line number in
       for the individual video"*. */
    + '</small></span><label class="target-line">Line<input class="inp" type="text" inputmode="numeric"'
    + ' data-target-line value="' + safe(parts.line || '') + '" placeholder="e.g. 4"'
    + ' aria-label="Line for ' + safe(parts.title) + '"></label>'
    + '<button class="btn sm icon" type="button" data-remove-target aria-label="Remove '
    + safe(parts.title) + '">' + ico('x', 'sm') + '</button></article>';

  /* A card's line is what its submission carries, so the box writes straight onto the
     card's dataset and the badge follows it. */
  document.addEventListener('input', (event) => {
    if (!event.target.matches('[data-target-line]')) return;

    const target = event.target.closest('[data-target]');
    const line = event.target.value.trim();
    const badge = $('.mini-thumb', target);

    target.dataset.videoLine = line;
    if (badge) {
      badge.textContent = line ? 'L' + line : '—';
      badge.classList.toggle('pending', !line);
    }
  });

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

  run.addEventListener('click', async () => {
    const asked = await inferenceSubmissions();

    /* **Every refusal, in the status line.** They used to be readable in full only in a
       panel that printed the raw request -- which Isaac pointed out nobody should be
       shown -- while the status carried the first. */
    if (asked.refusals) {
      sayRunStatus(asked.refusals.join(' '), 'warning');
      return;
    }

    run.disabled = true;
    sayRunStatus(`Queueing ${asked.bodies.length} run${asked.bodies.length === 1 ? '' : 's'}…`);

    const queued = [];

    try {
      /* One at a time, deliberately. Each submission creates its own session, and a
         burst of parallel posts would interleave those writes for no gain -- there are
         a handful of runs here, not hundreds. */
      for (const body of asked.bodies) {
        const answer = await window.MarpApi.submitJob(body);

        queued.push(...(answer.jobs || []).map((job) => job.id));
      }

      sayRunStatus(`Queued ${queued.length} job${queued.length === 1 ? '' : 's'}: `
        + `${queued.join(', ')}. They appear below, and on the Jobs screen.`, 'ok');
      renderInferenceScreen();
    } catch (error) {
      /* MARP's own message, which names the field that was wrong. Replacing it with
         "Could not queue" is how somebody ends up guessing. Says what already went, so
         a failure halfway through a plan is not read as nothing having happened. */
      const sent = queued.length ? ` ${queued.length} already queued (${queued.join(', ')}).` : '';

      sayRunStatus(`Could not queue it (${error.status || 'no answer'}). ${error.message || ''}${sent}`.trim(),
        'warning');
    } finally {
      run.disabled = false;
    }
  });

  refreshSelected();
  refreshPlan();
  fillProjectPickers();

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
/**
 * A count this dataset does not have.
 *
 * **The tooltip used to name a gap, and the gap had closed.** It listed the columns
 * `datasets` carries and said *"and nothing else (gap 16)"* — but the table has had
 * `notes`, `archive_path`, `archive_sha256`, `archive_bytes`, `task` and `crop_source`
 * added since that sentence was written, and every figure this constant is actually used
 * for — `num_samples`, `num_observations`, `num_classes` — **is a column**. So it was
 * never saying what it appeared to say: the record carries these, this dataset has not
 * been given them.
 *
 * Which makes it a fact about one row rather than a standing claim about MARP, and that
 * is the whole of the difference Isaac has been pointing at all day.
 */
const NOT_IN_DATASET = '<span class="dash" title="Not recorded for this dataset">&mdash;</span>';

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
/**
 * A timestamp as this table draws one: time above, date below.
 *
 * Module-level because two paths write it now -- the draw, and the patch that keeps
 * the Updated cell moving while a build runs. It was a closure inside the draw, so the
 * patch would have needed a second copy, and a second copy of a format is a format
 * that drifts.
 *
 * @param {string} iso - An ISO timestamp.
 * @returns {string} The cell's inner HTML.
 */
function datasetStamp(iso) {
  const d = new Date(iso);

  return `<span class="two"><span class="a">${d.toTimeString().slice(0, 5)}</span><span class="b">${d.toISOString().slice(0, 10)}</span></span>`;
}

function fillSavedDatasets(body, datasets, builds) {
  const stamp = datasetStamp;

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
      /* Marked, because the patch path rewrites it on every poll while a build runs.
         `data-frames` beside it is marked for the same reason; picking it out as "the
         second .jtime" would be a rule about column order rather than about the cell. */
      + `<td class="jtime" data-updated data-sort="${set.updated_at}">${stamp(set.updated_at)}</td>`
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
/**
 * Readings of how far each build had got, so a rate can be worked out between them.
 *
 * Keyed by job id, holding `{done, at}` pairs taken when the count actually moved. A
 * build is not in here for long and there are never many at once, so this is bounded by
 * {@link RATE_WINDOW} per build rather than by any sweeping.
 */
const buildReadings = new Map();

/** How many readings a rate is averaged over. */
const RATE_WINDOW = 6;

/**
 * Frames per second, from how far the build has moved between reports.
 *
 * **Taken from the attempt row across polls, not from `gpu_attempt_progress`.** That
 * table is the series the chart is drawn from and it is sampled **once a minute** -- one
 * row per attempt per minute, upserted -- so a rate read from it can only change once a
 * minute, which is not a live rate on a screen that polls every second. The attempt row
 * carries `progress_done` and `last_heartbeat_at` and is rewritten on every report the
 * runner makes, which is once a pass: about twenty seconds at the speeds before the
 * extractor stopped re-encoding, and about two at the speeds after.
 *
 * **Recent, not since the start.** Averaging from the first reading hides exactly what he
 * asked to be able to see -- a stretch where the rate drops -- because by then the
 * average is dominated by everything before it. A short window moves when the build does.
 *
 * **Nothing until there are two readings**, which is a real state and lasts until the
 * runner reports twice. A rate of zero would be a measurement, and an infinity would be
 * arithmetic nobody asked for.
 *
 * **Only while frames are being cut.** `selecting` has no frames yet and `packaging` is
 * tar and SHA-256 over a finished tree -- the count does not move, so a rate that kept
 * being shown would fall toward zero and read as a build grinding to a halt when it is
 * doing the last thing it has to do.
 *
 * @param {Object} build - The in-flight build.
 * @returns {string} Frames per second to one decimal, or '' when there is no rate to give.
 */
function buildRate(build) {
  if (!build || build.state !== 'leased') return '';

  const phase = phaseOf(build).phase.toLowerCase();

  if (phase !== 'extracting') return '';

  const done = Number(build.progress_done);
  const at = Date.parse(build.last_heartbeat_at);

  if (!Number.isFinite(done) || !Number.isFinite(at)) return '';

  const key = build.job_id;
  const readings = buildReadings.get(key) || [];
  const last = readings[readings.length - 1];

  /* Only when the runner has actually reported again. Polling faster than it reports
     would otherwise stack identical readings and divide a real frame count by the
     seconds the browser spent asking, which is a rate of the polling rather than of
     the build. */
  if (!last || last.at !== at) {
    readings.push({ done, at });

    while (readings.length > RATE_WINDOW) readings.shift();

    buildReadings.set(key, readings);
  }

  if (readings.length < 2) return '';

  const first = readings[0];
  const latest = readings[readings.length - 1];
  const frames = latest.done - first.done;
  const seconds = (latest.at - first.at) / 1000;

  if (!(seconds > 0) || frames < 0) return '';

  const rate = frames / seconds;

  return rate >= 10 ? `${Math.round(rate)} f/s` : `${rate.toFixed(1)} f/s`;
}

function patchBuildRows(body, builds, byId) {
  for (const head of $$(':scope > tr[data-dataset-id]', body)) {
    const id = Number(head.dataset.datasetId);
    const set = (byId && byId.get(id)) || null;
    const build = builds.get(id);

    /* **The Updated cell, patched before the build check, because it moves for a
       reason that has nothing to do with this row having a build.** `datasets.updated_at`
       is touched on every progress report, and this column froze for as long as a
       build ran: it used to be refreshed by accident, because the whole table was
       being thrown away and redrawn twenty seconds at a time. Stopping that rebuild
       was right -- it is what stopped expanded rows closing -- and this is its cost,
       paid here rather than by going back. */
    if (set && set.updated_at) {
      const updated = $('[data-updated]', head);

      if (updated && updated.dataset.sort !== String(set.updated_at)) {
        updated.innerHTML = datasetStamp(set.updated_at);
        /* The sort key too, or sorting by Updated orders the table by what the
           timestamps were when the page was drawn. */
        updated.dataset.sort = String(set.updated_at);
      }
    }

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

    /* Asked once and used twice: `buildRate` records the reading it is given, so calling
       it a second time in the same poll would compare a reading with itself. */
    const rate = buildRate(build);
    const rateFact = $('[data-build-rate]', detail);

    if (rateFact) {
      rateFact.textContent = rate;

      const row = rateFact.closest('.jobmetric');

      if (row) row.hidden = !rate;
    }

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
 * How a build chose its frames, as the Build record says it (#296).
 *
 * Null is every frame of every track: a build from before #296, or one that asked.
 *
 * @param {?Object} sampling - `{frames_per_object, balance_classes, seed}` from the spec.
 * @returns {string} HTML.
 */
function samplingText(sampling) {
  if (!sampling || !sampling.frames_per_object) return 'Every frame of every track';

  return `${Number(sampling.frames_per_object).toLocaleString('en-US')} per object, spread across each track`
    + `${sampling.balance_classes ? ' &middot; classes balanced' : ''}`
    + ` &middot; seed <span class="mono">${escapeHtml(String(sampling.seed))}</span>`;
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
  /* **Hover text, not a paragraph.** *"i dont' know why we have this text"*, of the
     sentence that used to sit under this bar. What it says is worth keeping -- the
     percentages are of images, which is the quantity the builder balances on, and a
     reader checking them against the ratio they asked for needs that -- but it belongs on
     the bar rather than under it, which is the correction he already made once on this
     screen. */
  const why = byImages
    ? `Percentages are of images, which is what the builder balances the split on. ${escapeHtml(label)}`
    : `Percentages are of observations: the archive could not be counted, so these are not the ratio the build balanced on, which is images. ${escapeHtml(label)}`;

  return `<div class="splitbar" role="img" title="${why}" aria-label="${escapeHtml(label)}">${bands}</div>`
    + `<ul class="splitlegend">${legend}</ul>`;
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
    /* **The build job goes with the dataset now, so the confirmation says so.** It used
       to survive, and Isaac met one on the Jobs screen after deleting its dataset here:
       *"i already deleted this on the other page"*. Named only when the panel actually
       found one -- a legacy import has no build job at all, and a dialog that listed one
       anyway would be the same kind of untruth in reverse. */
    const job = detail.buildJobId
      ? ` Its build job (#${detail.buildJobId}), with that job's attempts and events, goes too.`
      : '';

    const what = holds.length
      ? `This removes ${holds.join(', ')}.${job}\n\nIt cannot be undone, and the archive is not kept anywhere else.`
      : 'This build recorded no images, no observations and no archive, so there is nothing'
        + ` to lose but the row itself.${job}`;

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

      /* Removing the rows is the instant feedback; this is what makes the numbers above
         them true again. The table owns its own counts and its own polling, so it is told
         rather than reached into -- the same seam a queued build uses. */
      document.dispatchEvent(new CustomEvent('marp:dataset-deleted', { detail: { id: set.id } }));
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Delete';

      /* The server's sentence, which is the whole point of it having written one. */
      if (said) said.textContent = error.message || `Could not delete it (${error.status || 'no answer'}).`;
    }
  });
}

/**
 * The builds waiting, in the order they will be taken, with a way to change it.
 *
 * **The order was real and invisible, which is why this exists before the buttons do.**
 * `claimBuild` has always selected `ORDER BY priority DESC, created_at ASC, id ASC`, so
 * the queue has always been a priority queue -- but nothing served the priority, and the
 * table sorts newest-first, which is the reverse of claim order within a priority. Move
 * buttons on that table would have reordered something nobody could see.
 *
 * **"Starts next" is a group, not a row.** Builds run `DATASET_BUILD_CONCURRENCY` at a
 * time, so the front of the queue begins together and there is no single next job. The
 * server says which ones would start now -- the ceiling less whatever is running -- and
 * they are marked as a set, because a numbered list alone would imply the first one goes
 * and the second waits.
 *
 * **Hidden below two.** With one build waiting there is no order to change, and a strip
 * of controls that cannot do anything is worse than no strip.
 *
 * @param {Object} answer - From `GET /dataset/build-queue`.
 * @returns {void}
 */
function drawBuildQueue(answer) {
  const strip = $('[data-build-queue]');

  if (!strip) return;

  const queue = (answer && answer.queue) || [];

  strip.hidden = queue.length < 2;

  if (strip.hidden) {
    strip.innerHTML = '';

    return;
  }

  const ceiling = Number(answer.concurrency) || 1;
  const running = Number(answer.running) || 0;
  const starting = queue.filter((row) => row.starts_next).length;

  /* Said in full rather than as a bare count, because "2 of 5" invites the reading that
     three are blocked rather than waiting their turn. */
  const lead = starting
    ? `${starting === 1 ? 'The first' : `The first ${starting}`} start${starting === 1 ? 's' : ''} next`
    : `All ${queue.length} are waiting for a slot`;

  const rows = queue.map((row, index) => {
    const name = escapeHtml(row.name || `Dataset ${row.dataset_id}`);

    return `<li${row.starts_next ? ' data-starting' : ''}>`
      + `<span class="qpos">${row.position}</span>`
      + `<span class="qname" title="Build job #${row.job_id}">${name}</span>`
      + (row.starts_next ? '<span class="qnext">starts next</span>' : '')
      + '<span class="qmove">'
      + `<button class="btn xs" type="button" data-move-build="${row.job_id}" data-direction="up"`
      + `${index === 0 ? ' disabled' : ''} aria-label="Move ${name} sooner" title="Move sooner">`
      + '<svg class="ico sm"><use href="#i-arrow"/></svg></button>'
      + `<button class="btn xs" type="button" data-move-build="${row.job_id}" data-direction="down"`
      + `${index === queue.length - 1 ? ' disabled' : ''} aria-label="Move ${name} later" title="Move later">`
      + '<svg class="ico sm"><use href="#i-down"/></svg></button>'
      + '</span></li>';
  }).join('');

  strip.innerHTML = `<div class="buildqueue-hd"><h3>${queue.length} builds waiting</h3>`
    + `<p>${lead}. ${ceiling} run at once${running ? `, ${running} running now` : ''}.</p></div>`
    + `<ol class="buildqueue-list">${rows}</ol>`;
}

/**
 * Asks for the queue and draws it.
 *
 * @returns {Promise<void>}
 */
async function refreshBuildQueue() {
  const strip = $('[data-build-queue]');

  if (!strip || !window.MarpApi) return;

  try {
    drawBuildQueue(await window.MarpApi.datasetBuildQueue());
  } catch (error) {
    /* A queue that could not be read is not a queue of nothing, so the strip is left
       as it was rather than being emptied into a claim that nothing is waiting. */
  }
}

/* **Five, because the Class breakdown folds at five.** This panel is that component
   now, and matching the screen somebody already reads matters more than the number. */
const SPECIES_SHOWN = 5;

/**
 * Where each species in the dataset being assembled is being sent, as a bar each.
 *
 * *"in this section we want the bars for every species, but we also want it shaded and
 * displayed like this: like we do in the build jobs and ready datasets."* So this is the
 * ready dataset's panel, built from what step 3 knows instead of from what a build wrote,
 * and sharing `.dist` and the three split tones so the two read as one design.
 *
 * **Every species, with no *Other* fold, and that is the deliberate difference from the
 * panel it copies.** A ready dataset is a record and a long tail can be folded away; step
 * 3 is a decision, and a hidden tail is hidden evidence about what is going in.
 *
 * **Observations, because images do not exist yet.** Nothing has been cut, so the only
 * exact quantity here is the observation count the facet returned. Images could be
 * estimated from the keyframe spans, and that estimate was rejected: it would be what the
 * build *intends* to cut rather than what it writes -- `cutVideo` reports frames it could
 * not produce -- and an estimate sitting beside a panel elsewhere that is exact is worse
 * than a smaller number that is true.
 *
 * **The split is what was asked for, not what will result, and the two differ for two
 * separate reasons.** A subset sent wholly to one split contributes all of its species
 * there, exactly. A subset divided by shares is spread here in those shares, but the
 * build runs `assignSplits`, which is *iterative stratification measured in frames* -- it
 * deliberately moves groups so a rare species is represented in every split, and one
 * observation spanning 400 frames outweighs one spanning two. So a divided subset's
 * per-species division is the algorithm's intent rather than its arithmetic.
 *
 * **One observation is one species here**, unlike the ready panel, where one image can
 * hold two animals and the species counts sum past the split totals. `observations`
 * carries a single `species_id`, so these sum to the headline count -- including its
 * double counting, because two subsets that match the same observation count it twice in
 * both and the build is what resolves that.
 *
 * @param {Element[]} rows - The subset `<li>` elements, carrying `data-species`,
 * `data-split` and optionally `data-shares`.
 * @returns {string} The `.dist` grid's inner HTML.
 */
function currentDatasetBars(rows) {
  const splits = ['train', 'validation', 'test'];
  const tone = { train: 'tr', validation: 'va', val: 'va', eval: 'va', test: 'te' };
  const by = new Map();

  for (const row of rows) {
    let species;

    try {
      species = JSON.parse(row.dataset.species || '[]');
    } catch (error) {
      continue;
    }

    /* Either a share map or a single split, which is exactly what the row carries and
       what the build obeys. A row with neither is not placed anywhere, and is counted
       into the total without a segment rather than being guessed at. */
    let shares = null;

    try {
      shares = row.dataset.shares ? JSON.parse(row.dataset.shares) : null;
    } catch (error) {
      shares = null;
    }

    const whole = shares ? null : (row.dataset.split || null);
    const sum = shares
      ? Object.values(shares).reduce((at, n) => at + (Number(n) || 0), 0)
      : 0;

    for (const [label, count] of species) {
      const name = label || 'Unnamed species';

      if (!by.has(name)) by.set(name, { name, total: 0, counts: {} });

      const entry = by.get(name);
      const n = Number(count) || 0;

      entry.total += n;

      if (shares && sum > 0) {
        /* Fractions kept here and rounded once, below, so the segments a reader compares
           are the real proportions rather than three numbers each rounded on its own. */
        for (const [split, share] of Object.entries(shares)) {
          entry.counts[split] = (entry.counts[split] || 0) + (n * (Number(share) || 0)) / sum;
        }
      } else if (whole) {
        entry.counts[whole] = (entry.counts[whole] || 0) + n;
      }
    }
  }

  const sorted = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  if (!sorted.length) return '<span class="nodata">Nothing has been added to this dataset yet.</span>';

  const widest = Math.max(...sorted.map((entry) => entry.total), 1);
  const count = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

  /**
   * Whole observations that still add up to the species total.
   *
   * A share of 70/20/10 over seven observations is 4.9/1.4/0.7, and rounding each on its
   * own gives 5/1/1 -- seven observations reported as seven, by luck. Largest remainder
   * makes that an arithmetic property rather than a coincidence, which matters because
   * the number beside the bar is the one a reader checks it against.
   *
   * @param {Object} entry - One species.
   * @returns {Object<string, number>} Whole counts per split.
   */
  const whole = (entry) => {
    const parts = splits
      .filter((split) => entry.counts[split])
      .map((split) => ({ split, exact: entry.counts[split] }));

    if (!parts.length) return {};

    const out = {};
    let placed = 0;

    for (const part of parts) {
      out[part.split] = Math.floor(part.exact);
      placed += out[part.split];
    }

    let left = Math.round(parts.reduce((at, part) => at + part.exact, 0)) - placed;

    for (const part of [...parts].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
      if (left <= 0) break;

      out[part.split] += 1;
      left -= 1;
    }

    return out;
  };

  return sorted.map((entry) => {
    const counts = whole(entry);
    /* Every split named, zeros included: a species landing only in train is what the
       stratification exists to prevent, and a segment that is not drawn says nothing on
       its own. */
    const said = splits.map((split) => `${split} ${count(counts[split])}`).join(', ');

    const segments = splits.map((split) => {
      const n = entry.counts[split] || 0;

      return n ? `<i class="${tone[split] || 'tr'}" style="width:${((n / widest) * 100).toFixed(1)}%"></i>` : '';
    }).join('');

    /* A subset with no split declared and no shares contributes to the total and to no
       segment, so the bar is shorter than the number beside it. Said rather than hidden. */
    const placed = splits.reduce((at, split) => at + (entry.counts[split] || 0), 0);
    const unplaced = Math.round(entry.total - placed);

    return `<span class="k" title="${escapeHtml(`${entry.name}: ${said}`
      + (unplaced > 0 ? `, ${unplaced} not yet assigned to a split` : ''))}">${escapeHtml(entry.name)}</span>`
      + `<span class="b">${segments}</span>`
      + `<span class="v">${count(entry.total)}</span>`;
  }).join('');
}

/**
 * Where each species went, split by split, as a bar each.
 *
 * *"kind of like these bars... but they should have different shading."* He was pointing
 * at the **Class breakdown** in the build flow, so this is that component --
 * `.dist`, largest first, folded into an *Other* row -- with the one difference he
 * asked for: the single blue-to-cyan fill becomes three segments, one per split. Reusing
 * it rather than building a second bar is the point; two bar components on one screen
 * drift the moment either is touched.
 *
 * **Images, the same unit as the bar above it.** This shipped in observations because
 * that was all that was recorded, and the two differ by about ninety to one -- 164
 * observations were 15,020 images. A length is compared without reading a heading, so two
 * units in one panel is worse as bars than it was as columns. The build now counts
 * species per frame as it writes each label file and
 * `scripts/backfill-split-species-images.js` reads them out of the archives for anything
 * built before it did; a dataset with neither falls back to observations, and the unit in
 * the heading changes with it.
 *
 * **Lengths are against the largest row, which is what `.dist` already does.** The point
 * of a row is the shape of its own split and how it compares with its neighbours'.
 * Scaling to the dataset's total would leave every bar but the commonest a sliver, with
 * the three shades too small to tell apart -- which is the one thing the bar is for.
 *
 * **No share column, unlike `.dist.pct` in the build flow, and that is deliberate.**
 * There the shares are of one total and add to a hundred. Here a frame holding a cucumber
 * and an anemone is one image belonging to both species, so shares would add past a
 * hundred -- the exact arithmetic `drawQueryComposition` treats as a defect and refuses
 * to draw, after one breakdown reached 129 per cent. The counts are exact; a percentage
 * would not be, so the panel shows the count and the heading explains the overlap.
 *
 * **A zero is drawn by its absence.** A species with nothing in test gets no test segment
 * and says so in its tooltip, which is what makes the gap visible rather than a hairline
 * that reads as a very small amount.
 *
 * @param {Object[]} rows - `{species_id, comname, split, observations, images}`.
 * @param {boolean} all - Show every species rather than the largest {@link SPECIES_SHOWN}.
 * @returns {string}
 */
function speciesSplitTable(rows, all) {
  if (!rows || !rows.length) return '';

  /* The split names `inclusion_type` holds. Deliberately not the archive's directories:
     `validation` and `eval` share `eval/` on disk, and a panel about membership should
     say what was asked for rather than where it landed. */
  const splits = ['train', 'validation', 'test'];

  /* `Number(null)` is 0, not NaN, so a bare `Number.isFinite` would read an unrecorded
     count as zero images -- a measurement, and the wrong one. Same guard as `splitBar`. */
  const known = (row) => row.images !== null && row.images !== undefined && Number.isFinite(Number(row.images));
  const byImages = rows.every(known);
  const unit = byImages ? 'images' : 'observations';
  const by = new Map();

  for (const row of rows) {
    const key = row.species_id ?? row.comname;

    if (!by.has(key)) {
      by.set(key, { name: row.comname || `Species ${row.species_id}`, total: 0, counts: {} });
    }

    const entry = by.get(key);
    const n = Number(byImages ? row.images : row.observations) || 0;

    entry.counts[row.split] = (entry.counts[row.split] || 0) + n;
    entry.total += n;
  }

  const sorted = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const shown = all ? sorted : sorted.slice(0, SPECIES_SHOWN);
  const rest = all ? [] : sorted.slice(SPECIES_SHOWN);

  /* One row standing for the rest, with its split counts summed -- not a count of species
     with the numbers thrown away, which would leave the panel unable to say where they
     went. Built before the scale is taken, so folding cannot make the longest bar vanish
     and silently rescale the rows that stayed. */
  const folded = rest.length
    ? [rest.reduce((sum, entry) => {
      for (const split of splits) sum.counts[split] = (sum.counts[split] || 0) + (entry.counts[split] || 0);
      sum.total += entry.total;

      return sum;
    }, { name: `Other (${rest.length} ${rest.length === 1 ? 'species' : 'species'})`, total: 0, counts: {} })]
    : [];

  const drawn = [...shown, ...folded];
  const widest = Math.max(...drawn.map((entry) => entry.total), 1);

  /* The class on each segment is what colours it, from the same three tokens the split
     bar above uses; an unexpected split name takes the neutral one rather than no class,
     which would be an invisible segment. */
  const tone = { train: 'tr', validation: 'va', val: 'va', eval: 'va', test: 'te' };
  const count = (n) => Number(n || 0).toLocaleString('en-US');

  /* Every split named on every row, zeros included. It is the only place a reader can see
     that a species has nothing in test, since a zero segment is not drawn. */
  const said = (entry) => splits.map((split) => `${split} ${count(entry.counts[split])}`).join(', ');

  const body = drawn.map((entry) => {
    const segments = splits.map((split) => {
      const n = Number(entry.counts[split]) || 0;

      return n ? `<i class="${tone[split] || 'tr'}" style="width:${((n / widest) * 100).toFixed(1)}%"></i>` : '';
    }).join('');

    return `<span class="k" title="${escapeHtml(`${entry.name}: ${said(entry)}`)}">${escapeHtml(entry.name)}</span>`
      + `<span class="b">${segments}</span>`
      + `<span class="v">${count(entry.total)}</span>`;
  }).join('');

  const toggle = (rest.length || all)
    ? `<button class="more" type="button" data-species-split-toggle aria-expanded="${all}"`
      + ` title="${all
        ? `Show the largest ${SPECIES_SHOWN} species instead of every one`
        : 'Show every species in the dataset instead of the largest few'}">`
      + `${all ? `Largest ${SPECIES_SHOWN}` : 'All species'} `
      + '<svg class="ico sm"><use href="#i-arrow"/></svg></button>'
    : '';

  /* **The explanations are hover text, not body text.** *"i dont' know why we have this
     text"* -- two paragraphs under the bars, which is the correction he had already made
     once on this screen, when the panel's other explanations became tooltips on the
     controls they described. The facts survive; the paragraphs do not. */
  const why = byImages
    ? 'Images in each split holding this species. A frame holding two species counts for '
      + 'both, so these add up to more than the splits above.'
    : 'Observations, not images: no archive could be counted for this dataset, so these '
      + 'are not the unit the splits above are in.';

  /* The toggle lives inside this element, because redrawing replaces the element whole
     -- a button outside it would keep saying "All" after everything was shown. */
  /* **No key of its own.** Drawn, it was the third legend on one panel for the same
     three colours: the split bar's own legend sits directly above it naming train,
     validation and test with these very swatches. The shades are already taught; each
     row's tooltip gives its three numbers. */
  return '<div class="speciessplit">'
    + `<h5>By species <span class="faint" title="${escapeHtml(why)}">(largest first, ${unit})</span>${toggle}</h5>`
    + `<div class="dist split">${body}</div>`
    + '</div>';
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

/**
 * Fill the build flow from the dataset named in `?dataset=`, when `?duplicate=1` asks.
 *
 * **Where Duplicate with change lands.** The Jobs screen cannot fill this form -- the form
 * is here -- so a failed build links across with the dataset it produced and this reads
 * the request on arrival. `openRequestedDataset` has already opened that row, which is
 * what a reader needs to see: the thing being copied, above the form it is copied into.
 *
 * **The same route and the same event the button beside it uses**, rather than a second
 * implementation of "new build from an old spec". The button is the gesture for somebody
 * already on this screen; this is the gesture for somebody arriving from a job. They have
 * to stay the same thing, so they share everything except how they were asked for.
 *
 * Creates nothing, which is the rule the whole feature turns on: the form is filled, the
 * ordinary Queue button is what starts a build, and a reader who changes their mind simply
 * leaves.
 *
 * 404 is the ordinary case for a legacy import and the route has written the sentence for
 * it, so it is shown rather than replaced with a guess.
 *
 * @returns {Promise<void>}
 */
async function fillFromRequestedBuild() {
  const query = new URLSearchParams(window.location.search);
  const wanted = query.get('dataset');

  if (!wanted || query.get('duplicate') !== '1') return;
  if (!$('#dsname') || !window.MarpApi) return;

  /* **Nothing is said on success, deliberately.** `applySetup` writes its own line when
     it has finished -- it names the build, says nothing was created, and adds what it
     could not restore, which this cannot know. A message here would be a worse one
     racing a better one: it only lost that race because `applySetup` is async, and a
     faster fill would have left the vaguer sentence on screen. */
  const say = (text, kind = '') => {
    const status = $('[data-query-add-status]');

    if (status) {
      status.textContent = text;
      status.dataset.kind = kind;
    }
  };

  try {
    const setup = await window.MarpApi.datasetBuildSetup(wanted);

    document.dispatchEvent(new CustomEvent('marp:duplicate-dataset-setup', { detail: setup }));
  } catch (error) {
    /* The one case the builder never hears about, because nothing reached it. */
    say(error.status === 404
      ? (error.message || `Dataset ${wanted} has no recorded queries to copy.`)
      : `Could not read that build's queries (${error.status || 'no answer'}).`, 'warning');
  }
}

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
          /* Built always and hidden until there is one, because the detail is drawn once
             and patched thereafter -- a row that had to be created later could not be. */
          fact('Rate', `<span data-build-rate>${buildRate(build)}</span>`, false, !buildRate(build)),
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

      /* **Duplicate is disabled until the queries are known to exist**, which is settled
         when the panel opens and asks. A dataset imported by the legacy packager has no
         recorded query at all, and a Duplicate that opened an empty build flow would look
         exactly like one that had worked. `compose` below enables it, and writes the
         reason onto it when it cannot.

         Use for training stays inert: it is blocked on the training section existing, and
         keeps the `later` chip this app uses for a control with nothing behind it.
         Duplicate has lost its chip because it is no longer later. */
      const remove = deleteButton(set);

      const readyActions = `<button class="btn sm" type="button" data-duplicate-setup="${set.id}" disabled title="Looking for the queries this was built from…"><svg class="ico"><use href="#i-copy"/></svg>Duplicate setup</button><button class="btn sm" type="button" disabled title="Not wired yet"><svg class="ico"><use href="#i-training"/></svg>Use for training <span class="chip">later</span></button>${download}${remove}`;
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
          const { splits, classes: vocabulary, speciesSplits } = await window.MarpApi.datasetComposition(set.id);
          const bar = splitBar(splits);
          const names = (vocabulary || [])
            .map((entry) => escapeHtml(entry.comname || `Species ${entry.species_id}`));

          named = new Map((vocabulary || [])
            .map((entry) => [entry.class_index, entry.comname || `Species ${entry.species_id}`]));

          /* Nothing recorded is a real answer and a common one: every dataset built
             before #268 wrote membership has neither, and saying so beats an empty bar. */
          /* The per-species breakdown replaces the bare list of names it used to print:
             the names are in the first column of it, with where each one went beside
             them, which is what the list was standing in for. */
          const table = speciesSplitTable(speciesSplits, false);

          into.innerHTML = (bar || names.length)
            ? bar + (table || (names.length
              ? `<p class="dataset-class-summary">${names.join(' &middot; ')}</p>`
              : ''))
            : '<span class="hint">No membership was recorded for this dataset.</span>';

          /* Redrawn in place rather than toggling a class, so the fold can sum the rest
             rather than hiding rows that are already on the page. */
          const toggle = $('[data-species-split-toggle]', into);

          if (toggle) {
            let all = false;

            into.addEventListener('click', (event) => {
              if (!event.target.closest('[data-species-split-toggle]')) return;

              all = !all;

              const fresh = speciesSplitTable(speciesSplits, all);
              const holder = $('.speciessplit', into);

              if (holder && fresh) holder.outerHTML = fresh;
            });
          }
        } catch (error) {
          into.innerHTML = `<span class="hint">Could not load its composition (${error.status || 'no answer'}).</span>`;
        }

        /* **Asked once, when the row is opened**, for the same reason the composition is:
           doing it for every row would be a request per row to draw one page. */
        const duplicate = $('[data-duplicate-setup]', detail);

        if (duplicate) {
          try {
            const setup = await window.MarpApi.datasetBuildSetup(set.id);

            /* **Kept for the delete confirmation, which must not claim a job that is not
               there.** This request has already happened for Duplicate setup, and its 404
               is the honest answer that a legacy import has no build job at all. */
            detail.buildJobId = setup.jobId;

            /* How its frames were chosen, which only the build's spec records (#296). */
            $('.kv', detail)?.insertAdjacentHTML('beforeend', recordRow('Frames', samplingText(setup.sampling)));

            duplicate.disabled = false;
            duplicate.title = `Fill the build flow with the ${setup.subsets.length === 1
              ? 'query' : `${setup.subsets.length} queries`} this was built from. Creates nothing.`;
            duplicate.addEventListener('click', () => {
              /* The builder owns the form; this says what is wanted and lets it do the
                 filling. Scrolled to, because the form is above the table and a page that
                 silently changed something off screen has not told anybody. */
              document.dispatchEvent(new CustomEvent('marp:duplicate-dataset-setup', { detail: setup }));
              $('#dsname')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
          } catch (error) {
            /* 404 is the ordinary case for a legacy import, and the sentence the route
               wrote is better than anything this could invent. */
            duplicate.title = error.status === 404
              ? (error.message || 'No recorded queries to copy.')
              : `Could not read its queries (${error.status || 'no answer'}).`;
          }
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
  const footer = $('#saved-datasets-panel .panel-ft');

  /* **Reads the rows out of the DOM every time, rather than closing over a list.** The
     table is rebuilt when a build starts or finishes, so a captured node list is stale
     from the first completion onwards -- it would go on filtering rows that are no
     longer on the page and ignoring the ones that are. */
  const filter = () => {
    const heads = $$(':scope > tr.runrow-head', body);
    const query = search.value.trim().toLowerCase();
    const wantedStatus = status.value;
    const matching = heads.filter((head) => (!query || head.dataset.search.includes(query))
      && (wantedStatus === 'all' || head.dataset.datasetStatus === wantedStatus));

    /* Paged like every other table, by hiding the rows off this page: the table is the
       whole list, drawn once, and a filter or a page only chooses which rows show. */
    const { shown, from, pages } = pageOf(matching, datasetsPage);
    const visible = new Set(shown);

    heads.forEach((head) => {
      const on = visible.has(head);
      head.hidden = !on;
      const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
        ? head.nextElementSibling : null;
      if (detail) detail.hidden = !on || head.getAttribute('aria-expanded') !== 'true';
    });
    /* `heads.length`, not 20. The total was written in when there were twenty
       rows in the markup; the saved datasets come from the API now and there
       are as many as MARP holds. */
    count.textContent = `(${matching.length} shown of ${heads.length})`;
    drawPager(footer, datasetsPage, {
      total: matching.length, from, count: shown.length, pages, noun: 'build or dataset', plural: 'builds and datasets',
      empty: 'No datasets match these filters', redraw: filter,
    });
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

      /* Not awaited with the other two: the queue strip is a detail above the table and
         the table should not wait on it, nor fail because of it. */
      refreshBuildQueue();
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
    /* **Sorted by id before being joined, because this is a set and was being compared as
       a sequence.** `GET /dataset` is `findAll()` with no ORDER BY, so rows arrive in
       PostgreSQL's physical order -- and an UPDATE writes a new tuple at the end of the
       heap. Since a build began touching `datasets.updated_at` on every progress report,
       the building dataset moved in that order every twenty seconds, this string differed
       from the last one for no real change, and the whole table was rebuilt. Every
       expanded row closed with it, which is what Isaac was looking at.

       The fix is that the comparison should not have been positional in the first place:
       what it is asking is *are these the same datasets in the same states*, and that is
       a question about a set. */
    const shape = [...datasets]
      .sort((a, b) => a.id - b.id)
      /* **Name and description are in here, and `updated_at` deliberately is not.**
         Everything a row draws is either in this string, so a change to it rebuilds
         the table, or patched in place by `patchBuildRows`. `updated_at` is the one
         that is patched, because it moves every twenty seconds and putting it here
         would rebuild the table on every poll -- which is the thing that was wrong.
         The two strings cannot change during a build, but nothing patches them, so
         without them here a rename would not reach the screen until a reload. */
      .map((set) => `${set.id}:${datasetScreenStatus(set, builds.get(set.id) || null)}:${set.num_samples ?? ''}:${set.num_observations ?? ''}:${set.num_classes ?? ''}:${set.name ?? ''}:${set.description ?? ''}`)
      .join('|');

    if (first || shape !== drawn) {
      /* **What the reader had open, so a redraw does not shut it.** The table is rebuilt
         when the set of datasets or their states genuinely change -- a build finishing is
         the obvious one, and it is exactly the moment somebody is watching that row. The
         markup is replaced, so `aria-expanded` and the detail element belonged to nodes
         that no longer exist and every open row closed.

         Keyed by dataset id rather than by position: a redraw is allowed to reorder, and
         restoring "the third row" would reopen whichever dataset had moved into third. */
      const wasOpen = new Set($$(':scope > tr[data-dataset-id][aria-expanded="true"]', body)
        .map((head) => head.dataset.datasetId));
      const wasScrolled = window.scrollY;

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

      /* **Reopened the way `openRequestedDataset` does it, not by clicking the expander.**
         A click toggles, so a row the deep link had already opened would be shut again by
         this. A dataset that has gone is simply not found and is not reopened. */
      for (const id of wasOpen) {
        const head = $(`:scope > tr[data-dataset-id="${CSS.escape(id)}"]`, body);

        if (!head) continue;

        const detail = head.nextElementSibling?.classList.contains('dataset-row-detail')
          ? head.nextElementSibling : null;

        head.setAttribute('aria-expanded', 'true');

        if (detail) {
          detail.hidden = false;
          /* The panel is new markup, so whatever it fetches on open has to be asked for
             again -- otherwise it reopens showing the empty state it was built with. */
          if (typeof detail.loadComposition === 'function') detail.loadComposition();
        }
      }

      /* Restored after the rows are back, or the page is shorter than it was and the
         browser clamps the scroll to the bottom of a half-built table. */
      if (wasOpen.size && window.scrollY !== wasScrolled) window.scrollTo({ top: wasScrolled });
      /* After the row is open, so a reader sees what is being copied above the form
         it is copied into. */
      fillFromRequestedBuild();
    } else {
      patchBuildRows(body, builds, new Map(datasets.map((set) => [set.id, set])));
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

  /* **A delete has to re-read, because the poller is not running.** It stops itself the
     moment nothing is building, which is right -- but it meant the summary cards kept the
     numbers from before the delete while the row vanished from under them. Isaac deleted a
     failed build and went on being told there were five datasets and two needing
     attention. A stale count after a destructive action reads as the delete having
     failed.

     `poll` rather than a bare redraw: it refreshes, and if a build happens to be in
     flight it also restarts the clock, which a one-shot refresh would leave stopped. */
  document.addEventListener('marp:dataset-deleted', () => {
    if (!timer) timer = setTimeout(poll, 0);
  });

  const queueStrip = $('[data-build-queue]');

  if (queueStrip) {
    queueStrip.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-move-build]');

      if (!button || button.disabled) return;

      /* Every button in the strip, because a second press would land on a row that has
         already moved and ask for something the reader did not mean. */
      const buttons = $$('[data-move-build]', queueStrip);

      buttons.forEach((one) => { one.disabled = true; });

      try {
        await window.MarpApi.moveQueuedBuild(button.dataset.moveBuild, button.dataset.direction);

        /* **Redrawn from a fresh read, not from the move's own answer.** The move
           returns the queue, but not the concurrency or how many are running, and which
           builds now start next depends on both -- so one authoritative request beats
           reassembling a half-shaped answer here. A failed move redraws nothing: the
           order did not change, and redrawing would suggest it had. */
        await refreshBuildQueue();
      } catch (error) {
        buttons.forEach((one) => { one.disabled = false; });
      }
    });
  }

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

  /* A new filter starts at its first page, as it does on every other table. */
  search.addEventListener('input', () => { datasetsPage.page = 1; filter(); });
  status.addEventListener('change', () => { datasetsPage.page = 1; filter(); });
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
  /* The ladder, in ladder order. `30d` had no entry at all and was on three charts. */
  '1h': 'Show this activity graph across the last hour',
  '24h': 'Show this activity graph across the last 24 hours',
  '7d': 'Show this activity graph across the last 7 days',
  '30d': 'Show this activity graph across the last 30 days',
  '1y': 'Show this activity graph across the last year',
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
  'Diagnostics': 'Every attempt at this job, and why each ended',
  'Open model': 'Open this model and version in the model registry',
  'Cancel': 'Stop this job and prevent it from taking more work',
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
  $$('.class-metrics tbody td:first-child, .balance-row > b').forEach((el) => {
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

    /* **Bars here, the Class breakdown in step 1.** They were one renderer and are
       now two, because what they answer diverged: step 1 is a facet of a query and
       folds its tail away, while this is the dataset being assembled and shows every
       species, segmented by the split each subset asked for. */
    const composition = $('[data-dataset-composition]');

    if (composition) composition.innerHTML = currentDatasetBars(rows);

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
    refreshEstimate();
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

  /** The added queries as the build takes them: each a filter and a split or shares. */
  const subsetsFromList = () => $$('li', list).map((row) => {
    const subset = { filters: JSON.parse(row.dataset.filters || '{}') };

    if (row.dataset.shares) subset.shares = JSON.parse(row.dataset.shares);
    else subset.split = row.dataset.split || 'train';

    return subset;
  });

  /* The seed a Duplicate carried in, so the copy picks the frames the original did. A
     new build has none and the API chooses one when it is queued. */
  let carriedSeed = null;

  /**
   * Frames per object, as the build takes it (#296). Null is every frame.
   *
   * @returns {?Object} `{frames_per_object, balance_classes, seed?}`.
   */
  const samplingSetting = () => {
    if ($('#dsevery')?.checked) return null;

    const n = Math.max(1, Math.round(Number($('#dsframes')?.value) || 10));
    const sampling = { frames_per_object: n, balance_classes: Boolean($('#dsbalance')?.checked) };

    if (carriedSeed !== null) sampling.seed = carriedSeed;

    return sampling;
  };

  /* Every frame leaves nothing to set and nothing to balance. */
  const syncSamplingControls = () => {
    const every = Boolean($('#dsevery')?.checked);
    const frames = $('#dsframes');
    const balance = $('#dsbalance');

    if (frames) frames.disabled = every;
    if (balance) balance.disabled = every;
  };

  let estimateTimer = null;
  let estimateAsked = 0;

  /**
   * How many images the build will cut, asked of the API after each change (#296).
   *
   * Debounced, and an answer to an earlier question is dropped, so a quick run of edits
   * shows the last one's estimate rather than whichever came back last.
   */
  const refreshEstimate = () => {
    const out = $('[data-build-estimate]');
    if (!out) return;

    clearTimeout(estimateTimer);

    if (!$$('li', list).length) {
      out.hidden = true;
      out.innerHTML = '';
      return;
    }

    estimateTimer = setTimeout(async () => {
      const asked = ++estimateAsked;
      const sampling = samplingSetting();

      out.hidden = false;
      out.textContent = 'Working out how many images the build will cut…';

      try {
        const answer = await window.MarpApi.estimateDatasetBuild({
          subsets: subsetsFromList(),
          splits: { train: 0.8, eval: 0.2 },
          sampling,
        });

        if (asked !== estimateAsked) return;

        const images = Number(answer.images || 0);
        const every = Number(answer.every_frame || 0);
        const fewer = sampling && images && every > images
          ? `, <b>${(every / images).toFixed(1)}&times;</b> fewer than every frame (${every.toLocaleString('en-US')})`
          : '';
        const perClass = (answer.per_class || [])
          .map((entry) => `${escapeHtml(entry.comname)} ${Number(entry.images).toLocaleString('en-US')}`)
          .join(' &middot; ');

        out.innerHTML = `The build will cut <b>${images.toLocaleString('en-US')}</b> images${fewer}.`
          + (perClass ? `<br>Images per class: ${perClass}` : '');
      } catch (error) {
        if (asked !== estimateAsked) return;
        out.textContent = `Could not work out the image count (${error.status || 'no answer'}). The build can still be queued.`;
      }
    }, 400);
  };

  for (const id of ['dsframes', 'dsevery', 'dsbalance']) {
    $('#' + id)?.addEventListener('change', () => {
      syncSamplingControls();
      refreshEstimate();
    });
  }

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
      const subsets = subsetsFromList();

      const queued = await window.MarpApi.queueDatasetBuild({
        name,
        description: $('#dsdesc')?.value.trim() || null,
        subsets,
        /* Sent as well as the per-subset splits, because a build with one subset and no
           split named still has to divide into something. */
        splits: { train: 0.8, eval: 0.2 },
        sampling: samplingSetting(),
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
  /**
   * Put a previous build's queries back into this form.
   *
   * *"Sets up a new dataset with the same queries as the old one, and just makes it so
   * the user can then queue it up, or make changes to the old query before queuing it."*
   *
   * **It drives the controls rather than reproducing what they do.** Each subset is
   * applied by setting the same inputs a person would set and then running the ordinary
   * add -- `runQuery` then `appendSubset` -- so the counts, the species breakdown and the
   * subset labels are produced the one way they are ever produced. Writing rows into the
   * list directly would have been shorter and would have been a second implementation of
   * the thing most likely to drift.
   *
   * **Nothing is created.** No dataset row, no draft, no job: this fills a form, and the
   * Queue button is still what starts a build. That was explicit in the request.
   *
   * @param {Object} setup - From `GET /dataset/:id/build-setup`.
   * @returns {Promise<void>}
   */
  const applySetup = async (setup) => {
    /* Replaced, not added to. Duplicating into a half-filled form would silently build a
       dataset that is neither the old one nor what the reader sees. */
    for (const row of $$('li', list)) row.remove();

    const named = $('#dsname');

    /* A new name, because the old one is taken and a build refusing on a unique name
       after all this would be a poor way to find that out. */
    if (named) named.value = `${setup.name} copy`;

    const described = $('#dsdesc');

    if (described) described.value = setup.description || '';

    /* The frames as the original chose them, seed and all, so changing only N is the one
       edit a rebuild at fewer frames needs. A build from before #296 took every frame. */
    const sampling = setup.sampling || null;
    const every = $('#dsevery');

    if (every) every.checked = !sampling;
    if (sampling && $('#dsframes')) $('#dsframes').value = String(sampling.frames_per_object);
    if ($('#dsbalance')) $('#dsbalance').checked = Boolean(sampling && sampling.balance_classes);
    carriedSeed = sampling && Number.isInteger(sampling.seed) ? sampling.seed : null;
    syncSamplingControls();

    /* A build that named filters without subsets is one subset going to train, which is
       what the builder would have done with it. */
    const subsets = setup.subsets && setup.subsets.length
      ? setup.subsets
      : [{ filters: setup.filters || {}, split: 'train' }];

    const missed = new Set();
    let added = 0;

    for (const subset of subsets) {
      applyFilters(subset.filters || {}, missed);
      applyDestination(subset);

      /* The same two calls the Add button makes, in the same order and for the same
         reason: a subset is never assembled from a count taken before the filters were
         last touched. */
      const result = await runQuery();

      if (result) {
        appendSubset(result);
        added += 1;
      }
    }

    const couldNot = missed.size
      ? ` ${[...missed].join(' and ')} could not be restored -- that option is no longer in the list, so this query is wider than the original.`
      : '';

    setStatus(added === subsets.length
      ? `Filled in from "${setup.name}" (build ${setup.jobId}). Nothing has been created -- change anything you like, then queue it.${couldNot}`
      : `Filled in ${added} of ${subsets.length} queries from "${setup.name}". The rest matched nothing or could not be run.${couldNot}`,
    added === subsets.length && !missed.size ? 'success' : 'warning');
  };

  /**
   * Sets the query controls from one subset's filters.
   *
   * The inverse of {@link mosaicFilters}, and deliberately next to it: the two have to
   * agree about which control carries which filter, and a mapping written anywhere else
   * would drift the first time a filter was added.
   *
   * **A value the control no longer offers is reported, not swallowed.** A project that
   * has been renamed, or a model retired from the picker, leaves the select on its first
   * option -- which is usually "Any", so the copied query silently widens. That is the
   * failure worth naming, because the count still looks like an answer.
   *
   * @param {Object} filters - A `MosaicQueryFilters` from a recorded build.
   * @param {Set<string>} missed - Collects the names of filters that would not take.
   * @returns {void}
   */
  const applyFilters = (filters, missed) => {
    const one = (id, value, label) => {
      const el = $('#' + id);

      if (!el) return;

      el.value = value === undefined || value === null ? '' : String(value);

      if (value !== undefined && value !== null && el.value !== String(value)) missed.add(label);
    };

    one('dsproj', filters.project && filters.project[0], 'the project');
    one('dsdive', filters.dive && filters.dive[0], 'the dive');
    one('dsline', filters.line && filters.line[0], 'the line');
    one('dsmodel', filters.model && filters.model[0], 'the model');

    const confidence = filters.confidence || {};

    if (confidence.from !== undefined) one('dsconf', confidence.from, 'the confidence floor');
    if (confidence.to !== undefined) one('dsconfmax', confidence.to, 'the confidence ceiling');

    /* **Species are ticked by id, which is also how the name gets on screen.** The menu
       is already built from the catalogue with a label per box, so restoring `[775]` is
       ticking that box and letting the existing label logic say what it is called -- no
       id-to-name lookup anywhere.

       No species filter means every box, because that is what "not narrowed" is in this
       form: `mosaicFilters` only sends a species list when it is a real narrowing. */
    const boxes = $$('[data-species-menu] input[data-species-id]');
    const wanted = new Set((filters.species || []).map(Number));

    if (wanted.size) {
      for (const id of wanted) {
        if (!boxes.some((box) => Number(box.dataset.speciesId) === id)) missed.add('a species');
      }
    }

    for (const box of boxes) {
      const on = wanted.size ? wanted.has(Number(box.dataset.speciesId)) : true;

      if (box.checked !== on) {
        box.checked = on;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  /**
   * Sets where a subset goes: divided across splits, or all to one.
   *
   * **Clicks the buttons rather than setting the variables they own.** `selectedSplit`
   * and the split mode are closure state with styling and labels hanging off them, and
   * assigning to them directly would leave the form showing one thing and meaning
   * another.
   *
   * @param {Object} subset - `{shares}` or `{split}`.
   * @returns {void}
   */
  const applyDestination = (subset) => {
    if (subset.shares && Object.keys(subset.shares).length) {
      $$('[data-split-mode]').find((b) => b.dataset.splitMode !== 'one')?.click();

      for (const name of ['train', 'validation', 'test']) {
        const field = $('#share' + name[0].toUpperCase() + name.slice(1));

        if (field) field.value = subset.shares[name] === undefined ? '' : String(subset.shares[name]);
      }

      return;
    }

    $('[data-split-mode="one"]')?.click();
    $(`[data-dataset-destination="${subset.split || 'train'}"]`)?.click();
  };

  /* The Datasets table is on this page but is not this closure, so it asks by event
     rather than reaching in -- the same seam `marp:dataset-build-queued` uses in the
     other direction. */
  document.addEventListener('marp:duplicate-dataset-setup', (event) => {
    applySetup(event.detail).catch((error) => {
      setStatus(`Could not fill in from that dataset (${error.message || 'no answer'}).`, 'warning');
    });
  });

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
     down in two places. A zero is refused: see `align-self: start` in screens.css, where a
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

  /* **One ladder across the dashboard**: 1h, 24h, 7d, 30d, 1y. Every chart takes a
     contiguous four of it, so the vocabulary is shared without every chart carrying every
     rung. Eight charts had four different vocabularies between them and no reason for any
     of it; `5h` was the only rung that was not a round unit and `90d` sat between 30d and
     1y on one chart alone, so both went.

     **This chart stops at 30 days because its data does.** `SAMPLE_RETENTION_DAYS` is 30
     and the pool read sweeps anything older, so a year here would be empty by
     construction -- which is the complaint this is answering, not a way to answer it. */
  const RANGES = {
    '1h': { hours: 1, bucket: 'minute', label: 'the last hour' },
    '24h': { hours: 24, bucket: 'hour', label: 'the last 24 hours' },
    '7d': { hours: 168, bucket: 'hour', label: 'the last 7 days' },
    '30d': { hours: 720, bucket: 'day', label: 'the last 30 days' },
  };

  const buttons = $$('[data-ops-range]', root);
  const chart = $('.ops-chart', root);
  const blank = () => { if (chart) chart.innerHTML = ''; };

  wireSeriesKeys(root, 'data-ops-highlight', chart);

  async function choose(next) {
    buttons.forEach((b) => {
      const on = b.dataset.opsRange === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const { hours, bucket, label } = RANGES[next] || RANGES['24h'];
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

      /* **A bucket nobody sampled is null, and null is not nought.** These three were
         mapped with `|| 0`, so an unsampled bucket drew 0% -- a reading saying the GPUs
         were idle, invented from the absence of a reading. It was masked while *nothing*
         had samples, because `anyReading` blanks the chart then; the day sampling covers
         part of a window, a real curve would fall to the floor across the gaps and climb
         back out. That looks like information, which is what makes it worse than an empty
         chart.

         `queued` keeps its `|| 0`: it is a reconstructed count of jobs waiting, where
         none waiting really is zero. */
      const percent = (value) => (value === null || value === undefined ? null : Number(value));
      const samples = {
        inference: points.map((p) => percent(p.avg_inference_utilization_percent)),
        training: points.map((p) => percent(p.avg_training_utilization_percent)),
        vram: points.map((p) => percent(p.avg_memory_percent_used)),
        queued: points.map((p) => queuedBy.get(String(p.at)) || 0),
      };

      const anyReading = points.some((p) => p.machines > 0);

      if (!points.length || !anyReading) {
        blank();
        if (chart) {
          chart.setAttribute('aria-label',
            /* **Not "a build".** A dataset build is run by the API and is not in
               `LEASABLE_JOB_KINDS`, so it is the one kind of work that can never produce a
               reading -- which is exactly the work Isaac was doing when he asked why this
               was empty. Saying "a build" here pointed at the wrong thing. */
            `No GPU readings in ${label}. A machine reports while it works, so this stays empty `
            + 'until a worker leases an inference, tracking, training or diagnostic job.');
        }
        root.classList.add('is-quiet');
        return;
      }

      root.classList.remove('is-quiet');

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

      /* Utilization and VRAM are percentages and share the left axis; the queue is a
         count and keeps the right one, in whole jobs. */
      const at = points.map((p) => Date.parse(p.at));
      const pair = (values) => values.map((value, index) => [at[index], value]);

      if (chart) {
        drawActivity(chart, activityOption({
          root,
          axes: [{ max: 100, unit: '%' }, { whole: true }],
          series: [
            { id: 'inference', name: 'Inference', css: 'inference', kind: 'area', unit: '%', data: pair(samples.inference) },
            { id: 'training', name: 'Training', css: 'training', unit: '%', data: pair(samples.training) },
            { id: 'vram', name: 'VRAM', css: 'vram', unit: '%', data: pair(samples.vram) },
            { id: 'queued', name: 'Queued', css: 'queued', axis: 1, data: pair(samples.queued) },
          ],
        }), `Pool capacity over ${label}: inference ${current.inference}, `
          + `training ${current.training}, VRAM ${current.vram}, ${current.queued} waiting`, `workers-pool-${next}`);
      }
    } catch (error) {
      blank();
      if (chart) chart.setAttribute('aria-label', `Could not load pool capacity (${error.status || 'no answer'})`);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.opsRange)));
  await choose('24h');
}

async function wireOperationalActivity() {
  const root = $('[data-ops-activity="outcomes"]');
  if (!root || !$('.ops-chart', root)) return;

  /* The shared ladder; see `wirePoolUtilization`. This table counts in days, so the
     24-hour rung is one day of hour buckets rather than a different shape. */
  const RANGES = {
    '24h': { days: 1, bucket: 'hour', label: '24 hours' },
    '7d': { days: 7, bucket: 'day', label: '7 days' },
    '30d': { days: 30, bucket: 'day', label: '30 days' },
    '1y': { days: 365, bucket: 'day', label: 'year' },
  };

  const buttons = $$('[data-ops-range]', root);
  const chart = $('.ops-chart', root);
  const blank = () => { if (chart) chart.innerHTML = ''; };

  wireSeriesKeys(root, 'data-ops-highlight', chart);

  const hours = (seconds) => {
    if (!seconds) return '0';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };

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
      /* **A bucket where nothing finished has no rate and no turnaround**, so both are
         gaps there: drawn as 0% and 0s they read as a spotless, instant afternoon. */
      const issues = points.map((p) => (p.finished ? Math.round(((p.finished - (p.succeeded || 0)) / p.finished) * 100) : null));
      const turnaround = points.map((p) => (p.finished && p.median_turnaround_s != null ? Number(p.median_turnaround_s) : null));

      const peak = Math.max(...completed, 0);

      if (!points.length || peak === 0) {
        blank();
        if (chart) chart.setAttribute('aria-label', `Nothing finished in the last ${label}`);
        root.classList.add('is-quiet');
        return;
      }

      root.classList.remove('is-quiet');

      const last = points.at(-1);
      const current = {
        completed: String(last.finished || 0),
        issues: `${last.finished ? Math.round(((last.finished - (last.succeeded || 0)) / last.finished) * 100) : 0}%`,
        turnaround: hours(last.median_turnaround_s),
      };

      $$('[data-ops-current]', root).forEach((node) => {
        if (current[node.dataset.opsCurrent] !== undefined) node.textContent = current[node.dataset.opsCurrent];
      });

      /* Three scales: jobs on the left, turnaround on the right, and the issue rate on a
         0-100 scale of its own that the chart has no room to label -- its readout and its
         tooltip carry the percent sign. */
      const at = points.map((p) => Date.parse(p.at));
      const pair = (values) => values.map((value, index) => [at[index], value]);

      if (chart) {
        drawActivity(chart, activityOption({
          root,
          axes: [{ whole: true }, { format: (v) => hours(Math.round(v)) }, { max: 100, hidden: true }],
          series: [
            { id: 'completed', name: 'Completed', css: 'completed', kind: 'area', data: pair(completed) },
            { id: 'issues', name: 'With issues', css: 'issues', axis: 2, unit: '%', data: pair(issues) },
            { id: 'turnaround', name: 'Median turnaround', css: 'turnaround', axis: 1, format: (v) => hours(Math.round(v)), data: pair(turnaround) },
          ],
        }), `Completion activity over ${label}: `
          + `${completed.at(-1)} finished in the last bucket, ${current.issues} with issues, `
          + `median turnaround ${current.turnaround}`, `outcomes-${next}`);
      }
    } catch (error) {
      blank();
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
/**
 * How long ago, in the fewest words that are still true.
 *
 * Seconds for the first minute because that is the window in which somebody is watching
 * something happen; after that nobody cares about the seconds and a number that changes
 * every second is noise.
 *
 * @param {number} ms - Milliseconds since the last answer.
 * @returns {string}
 */
function agoText(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;

  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * Paint the shared freshness label from the data layer's own record.
 *
 * **Four states, and the two that matter are the unhappy ones.** A number with no time on
 * it is a claim about now that may be an hour old, and the worst version of that is a
 * screen whose polling has stopped or whose API is not answering while the figures sit
 * there looking current. So a failure says so in place of the time rather than beside it.
 *
 * @returns {void}
 */
function paintFreshness() {
  const into = $('[data-freshness]');

  if (!into || !window.MarpApi) return;

  let state;

  /* **Guarded, because the chrome must not be what breaks a page.** This runs every
     second on every screen; a data layer that is older, stubbed, or simply does not
     answer this should cost the label and nothing else. */
  try {
    if (typeof window.MarpApi.freshness !== 'function') return;
    state = window.MarpApi.freshness();
  } catch {
    return;
  }

  /* **A thenable is not an answer.** A data layer that does not know this member may hand
     back a rejected promise rather than throwing, and an unhandled rejection from the
     chrome would fail whatever test happened to be running. Swallowed deliberately: there
     is nothing to report about a clock that is not there. */
  if (state && typeof state.then === 'function') {
    state.catch(() => {});
    return;
  }

  if (!state || typeof state !== 'object') return;

  const { at, failed, inFlight } = state;

  if (failed) {
    into.dataset.fresh = 'failed';
    into.textContent = failed.status === 0 ? 'not answering' : `error ${failed.status}`;
    into.title = failed.message || 'The last read failed';
    return;
  }

  if (at === null) {
    into.dataset.fresh = inFlight ? 'reading' : 'idle';
    into.textContent = inFlight ? 'reading…' : '';
    return;
  }

  into.dataset.fresh = inFlight ? 'reading' : 'ok';
  into.textContent = `updated ${agoText(Date.now() - at)}`;
  into.title = `MARP last answered at ${new Date(at).toTimeString().slice(0, 8)}`;
}

/**
 * Keep the label honest, and wire the Reload button that was drawn and inert.
 *
 * One second, because the label counts seconds for its first minute. It is a text write
 * against one element, not a render.
 *
 * @returns {void}
 */
/**
 * Say which code is answering, once.
 *
 * **Asked once and never again**, because the answer cannot change while the process
 * lives -- that is the whole point of MARP reading it at startup. Repainting it on a
 * timer would suggest otherwise.
 *
 * **Hidden until MARP says**, rather than showing "unknown" while the request is in
 * flight: an empty label is honest about a question not yet answered, where a filled one
 * would claim MARP had replied and not known.
 *
 * @async
 * @returns {Promise<void>}
 */
async function fillServerIdentity() {
  const into = $('[data-server-started]');

  if (!into || !window.MarpApi || typeof window.MarpApi.whoAmI !== 'function') return;

  let server;

  /* Guarded like the label beside it: the chrome must not be what breaks a page, and a
     signed-out visitor gets null here rather than an answer. */
  try {
    const me = await window.MarpApi.whoAmI();

    server = me && me.server;
  } catch {
    return;
  }

  if (!server || !server.started_at) return;

  const started = new Date(server.started_at);

  if (Number.isNaN(started.getTime())) return;

  /* **`agoText` within the day, a date beyond it.** The label shares its vocabulary with
     the freshness one beside it, so the two read as one thought -- but the case this
     exists for is a server days behind its checkout, and "127h ago" is arithmetic the
     reader has to do. A date is immediately obviously stale. */
  const age = Date.now() - started.getTime();

  into.textContent = `API started ${age < 86400000
    ? agoText(age)
    : started.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  /* Null rather than a guess is MARP's rule for the commit, so say so in those words
     instead of printing an empty parenthesis. */
  into.title = `This MARP process started ${started.toLocaleString()}, on commit `
    + `${server.commit || 'unknown -- git could not answer when it started'}`;
  into.hidden = false;
}

function wireFreshness() {
  if (!$('[data-freshness]')) return;

  fillServerIdentity();
  paintFreshness();

  const tick = setInterval(paintFreshness, 1000);

  /* **Stopped when the page goes**, which matters more than it looks: a timer with no
     end keeps a jsdom window alive, so the DOM tier hangs rather than failing -- and a
     suite that never finishes is harder to diagnose than one that goes red. */
  window.addEventListener('pagehide', () => clearInterval(tick));
  window.addEventListener('unload', () => clearInterval(tick));

  const reload = $('[data-reload]');

  /* The button has been in the chrome on every screen since the mockups and has never
     done anything. A full reload is the honest implementation: every screen reads on
     load, so this is exactly "read it all again" without each screen having to expose a
     refresh of its own. */
  if (reload) reload.addEventListener('click', () => location.reload());
}

/** The cadence every live screen keeps. The dataset builder's, which Isaac set. */
const SCREEN_POLL_MS = 5000;

/** Every live screen's tick, so the DOM tier can run one without waiting five seconds. */
const screenPolls = [];

/**
 * Run every pending screen poll once. For the DOM tier; the application never calls it.
 *
 * @returns {Promise<void>}
 */
async function pollScreenNow() {
  for (const tick of screenPolls) await tick();
}

/**
 * Keep a screen current without rebuilding it.
 *
 * **One of these rather than five.** Freshness, live updating and expandable rows were
 * each built a screen at a time as Isaac found them missing, so Datasets polled and
 * Models did not, and the only thing deciding which was where he had last looked. This is
 * the shared half: a screen says what it reads, what to write into the rows it already
 * has, and when there is nothing left worth watching.
 *
 * **Patched, never rebuilt.** A rebuild closes the row somebody is reading -- the defect
 * the Datasets table was fixed for -- so `patch` writes into cells and the table it was
 * given keeps its identity, its scroll and its open expansions.
 *
 * **It stops.** A screen of finished work makes no requests at all, which is what keeps
 * seven tabs open from being seven pollers.
 *
 * @param {Object} spec - `{read, patch, live}`.
 * @returns {void}
 */
function watchScreen({ read, patch, live }) {
  let timer = null;

  /* **A seam for the DOM tier, the way `detail.redraw` is one on a row.** A watcher
     schedules its first tick while the screen is still rendering, so a test has no moment
     in which to intercept the timer -- and waiting five real seconds per assertion would
     make the tier slow enough that nobody runs it. `pollScreenNow` runs what is pending,
     once, on demand. It is not used by the application. */
  screenPolls.push(() => again());

  const again = async () => {
    timer = null;

    let data;

    try {
      data = await read();
    } catch {
      /* A failed poll is not a reason to stop: the top bar already says MARP is not
         answering, and a screen that gave up would stay stale and silent after the
         connection came back. */
      timer = setTimeout(again, SCREEN_POLL_MS);
      return;
    }

    patch(data);

    if (live(data)) timer = setTimeout(again, SCREEN_POLL_MS);
  };

  timer = setTimeout(again, SCREEN_POLL_MS);

  /* A timer with no end keeps a jsdom window alive, so the DOM tier hangs rather than
     failing -- and a suite that never finishes is harder to diagnose than one that is
     red. The same reason the freshness ticker is stopped. */
  const stop = () => { if (timer) clearTimeout(timer); timer = null; };

  window.addEventListener('pagehide', stop);
  window.addEventListener('unload', stop);
}

/** The states worth watching: a screen holding any of these keeps asking. */
const LIVE_STATES = new Set(['queued', 'running', 'leased', 'cancelling']);

/**
 * Is anything here still moving?
 *
 * @param {Object[]} jobs - Raw job rows.
 * @returns {boolean}
 */
const anyJobLive = (jobs) => jobs.some((job) => LIVE_STATES.has(job.state));

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
boot('freshness', wireFreshness);
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
Promise.all([renderJobsTable(), renderWorkersTable(), renderDashboardScreen(), renderModelsScreen(), renderInferenceScreen(), renderTrainingScreen(), wireDatasetPage()]).then(() => {
  /* `applyJobsQuery` and `applyWorkersQuery` rewire the rows they draw; these
     are the ones that bind once, to controls that outlive every redraw. */
  wireJobsControls();
  wireJobsDelete();
  wireJobsCancel();
  wireWorkersControls();
  wireModelsControls();
  wireSorting();
  /* **Not `wireJobsOverview()`.** `applyJobsQuery` calls it on every render,
     including the first, so calling it here bound every result-graph legend a
     second time -- and a second listener undid what the first did, leaving a
     button that visibly worked and highlighted nothing. The row loop guards
     itself against a repeat; the graph bindings could not. */
  wireSelection();
  wireStartTraining();
  applyTips();
});
