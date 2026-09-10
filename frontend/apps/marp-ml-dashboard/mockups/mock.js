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
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'jobs', label: 'Jobs', badge: 7 },
  { id: 'inference', label: 'Inference' },
  { id: 'training', label: 'Training' },
  { id: 'datasets', label: 'Datasets' },
  { id: 'models', label: 'Models' },
  { id: 'workers', label: 'Workers' },
  { id: 'history', label: 'History' },
];

const IMG = '../../../shared/assets/images/';

function mountRail() {
  const rail = $('.rail');
  if (!rail) return;
  const here = document.body.dataset.screen;

  const links = NAV.map((n) => {
    const current = n.id === here ? ' aria-current="page"' : '';
    const badge = n.badge
      ? '<span class="badge" title="' + n.badge + ' need attention">' + n.badge + '</span>'
      : '';
    return '<a href="./' + n.id + '.html"' + current + ' data-nav="' + n.id + '">'
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

function mountTopbar() {
  const bar = $('.topbar');
  if (!bar) return;

  /* The rail toggle and the tools bracket whatever heading the screen wrote. */
  const toggle = document.createElement('button');
  toggle.className = 'btn icon railtoggle';
  toggle.setAttribute('aria-label', 'Sections');
  toggle.innerHTML = ico('menu');
  bar.insertBefore(toggle, bar.firstChild);

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.innerHTML =
    '<span class="lab">Project</span>'
    + '<select class="sel" aria-label="Project">'
    + PROJECTS.map((p) => '<option>' + p + '</option>').join('')
    + '</select>'
    + '<span class="search">' + ico('search', 'sm')
    + '<input class="inp" type="search" placeholder="Search jobs, models, datasets…"'
    + ' aria-label="Search"></span>'
    + '<button class="btn icon" aria-label="Reload">' + ico('refresh') + '</button>'
    + '<button class="btn primary">' + ico('plus') + 'New Inference Job</button>'
    + '<button class="btn accent">' + ico('plus') + 'New Training Job</button>'
    + '<div class="menuwrap">'
    + '<button class="who" id="userBtn" title="Account and preferences"'
    + ' aria-haspopup="true" aria-expanded="false">IT</button>'
    + '<div class="menu" id="userMenu" role="menu" hidden>'
    + '<div class="mhead">Signed in as Isaac Travers</div>'
    + '<button role="menuitem">Preferences</button>'
    + '<button role="menuitem">Keyboard shortcuts</button>'
    + '<button role="menuitem">Worker service tokens</button>'
    + '<hr>'
    + '<button role="menuitem">Sign out</button>'
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

function wireMenu() {
  const btn = $('#userBtn');
  const menu = $('#userMenu');
  if (!btn || !menu) return;
  const show = (on) => {
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); show(menu.hidden); });
  document.addEventListener('click', () => show(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
}

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
    const heads = $$('th.sortable', table);
    const body = $('tbody', table);
    if (!heads.length || !body) return;

    const keyOf = (row, i) => {
      const cell = row.children[i];
      if (!cell) return '';
      const raw = cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent.trim();
      const n = Number(raw);
      return raw !== '' && !Number.isNaN(n) ? n : raw.toLowerCase();
    };

    const sortBy = (th, dir) => {
      const i = Array.prototype.indexOf.call(th.parentElement.children, th);
      const rows = $$('tr', body);
      const sign = dir === 'ascending' ? 1 : -1;
      rows.sort((a, b) => {
        const x = keyOf(a, i);
        const y = keyOf(b, i);
        if (x === y) return 0;
        return (x > y ? 1 : -1) * sign;
      });
      rows.forEach((r) => body.appendChild(r));
      heads.forEach((h) => h.setAttribute('aria-sort', h === th ? dir : 'none'));
    };

    heads.forEach((th) => {
      if (!th.hasAttribute('aria-sort')) th.setAttribute('aria-sort', 'none');
      th.setAttribute('tabindex', '0');
      const go = () => {
        /* A fresh column sorts ascending; the sorted one reverses. Always
           restarting ascending made reversing a two-click gesture for nothing. */
        const now = th.getAttribute('aria-sort');
        sortBy(th, now === 'ascending' ? 'descending' : 'ascending');
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
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

/* ==================================================================== boot */

document.body.dataset.rail = 'closed';
mountSprite();
mountRail();
mountTopbar();
wireRailSheet();
wireMenu();
wireDrawer();
wireSelection();
wireSorting();
