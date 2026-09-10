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
  { id: 'jobs', label: 'Jobs', badge: 7, tone: 'attn',
    tip: 'One queue for training and inference \u2014 7 need attention' },
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

/* What each scope actually covers. The consequence line and the range count are
   computed from this rather than typed, which is the only reason showing them
   is worth anything. */
const SCOPES = {
  project: { videos: 1842, frames: 43000000, what: 'every dive and line in CAMPA 2024' },
  dive: { videos: 31, frames: 742000, what: 'every line in CAMPA 2024 dive 0103' },
  line: { videos: 1, frames: 18300, what: 'CAMPA 2024 dive 0103 line L30' },
  custom: { videos: 3, frames: 55000, what: '3 chosen videos' },
};

const big = (n) => (n >= 1000000 ? '~' + Math.round(n / 1000000) + 'M'
  : n >= 100000 ? '~' + Math.round(n / 1000) + 'k'
    : n.toLocaleString('en-US'));

function wireInferenceForm() {
  const run = $('#runBtn');
  if (!run) return;

  const val = (id) => { const el = $('#' + id); return el ? el.value : ''; };
  const picked = (group) => {
    const b = $('[data-switch="' + group + '"] button.on');
    return b ? b.dataset.view : '';
  };

  /* The Advanced fold says what is inside it while it is shut. A fold that
     hides four settings and gives no hint of them is where a wrong threshold
     goes unnoticed. */
  const now = $('details.fold .now');
  const refreshNow = () => {
    if (!now) return;
    now.textContent = 'conf ' + val('conf') + ' · IoU ' + val('iou')
      + ' · ' + val('tracker') + ' · ' + val('chunk') + 'f ranges';
  };

  const sum = $('#scopeSum');
  const refreshSum = () => {
    if (!sum) return;
    const s = SCOPES[picked('scope')] || SCOPES.project;
    const chunk = Math.max(1, Number(val('chunk')) || 900);
    const ranges = Math.ceil(s.frames / chunk);
    $('.a', sum).textContent = 'Run inference on ' + s.what;
    const plural = (n, word) => n.toLocaleString('en-US') + ' ' + word + (n === 1 ? '' : 's');
    $('.b', sum).textContent = plural(s.videos, 'video') + ' · '
      + big(s.frames) + ' frames · ' + plural(ranges, 'range')
      + ' of ' + chunk + ' frames';
  };

  const cap = $('#cap');
  const capOn = $('#capOn');
  if (cap && capOn) {
    capOn.addEventListener('change', () => { cap.disabled = !capOn.checked; });
  }

  document.addEventListener('switched', () => { refreshSum(); });
  document.addEventListener('slid', () => { refreshNow(); });
  $$('#conf, #iou, #tracker, #chunk, #reduce, #imgsz, #maxdet').forEach((el) => {
    el.addEventListener('change', () => { refreshNow(); refreshSum(); });
  });

  /* The primary action reports the request it would send. A mockup whose main
     button does nothing teaches nothing; one that says "submitted" teaches
     something false. */
  run.addEventListener('click', () => {
    const scope = picked('scope');
    const s = SCOPES[scope] || SCOPES.project;
    const chunk = Math.max(1, Number(val('chunk')) || 900);
    const spec = {
      kind: 'inference',
      name: val('jobname') || null,
      scope: { type: scope, project: 'CAMPA 2024', videos: s.videos },
      model: { name: val('model'), version: val('version'), sha256: '9f2c41ab…' },
      spec: {
        engine: 'ultralytics',
        task: val('preset').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''),
        conf: Number(val('conf')),
        iou: Number(val('iou')),
        max_det: Number(val('maxdet')),
        imgsz: Number(val('imgsz')),
        tracker: val('tracker'),
        reduction: val('reduce'),
        range_frames: chunk,
      },
      output: {
        mode: picked('out') === 'csv' ? 'csv' : 'observations',
        confidence: true,
      },
      workers: {
        select: val('workers'),
        cap: capOn && capOn.checked ? Number(val('cap')) : null,
      },
      priority: 5,
    };
    $('#specText').textContent = JSON.stringify(spec, null, 2);
    $('#specOut').hidden = false;
    $('#specOut').scrollIntoView({ block: 'nearest' });
  });

  refreshNow();
  refreshSum();
}

/**
 * A row that opens to its own detail. Used by Training's runs, where a person
 * wants one run's curves beside the row above rather than in a drawer that
 * hides the list.
 */
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

  const all = $$('.btn').find((b) => b.textContent.trim() === 'Expand all');
  if (!all) return;
  all.addEventListener('click', () => {
    const heads = $$('tr.runrow-head');
    const opening = heads.some((h) => h.getAttribute('aria-expanded') !== 'true');
    heads.forEach((h) => {
      h.setAttribute('aria-expanded', String(opening));
      if (h.nextElementSibling) h.nextElementSibling.hidden = !opening;
    });
    all.lastChild.textContent = opening ? 'Collapse all' : 'Expand all';
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
  'Frames': 'The half-open frame range, start included and end excluded',
  'Line': 'One transect line',
  'Worker': 'The machine holding this piece of work',
  'State': 'Where this piece has got to',
  'Done': 'How much of this range is finished',

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
  'Reprioritise': 'Move the selected jobs up or down the queue',
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
    + ' .topbar .lab, .search input, .sel';
  $$(sel).forEach((el) => {
    if (el.getAttribute('title')) return;                 // the screen was specific
    const key = ownText(el) || el.getAttribute('placeholder') || el.getAttribute('aria-label');
    const tip = TIPS[key];
    if (!tip) return;
    /* On a label, the tip belongs to the whole field -- hovering the control is
       the natural gesture, not hovering its caption. */
    const target = el.matches('.field > label') ? el.parentElement : el;
    if (!target.getAttribute('title')) target.setAttribute('title', tip);
  });
}

/* ============================================== the dataset split control */

/**
 * The train / validation / test split.
 *
 * The numbers are what an operator sets. The arithmetic behind them is not:
 * MARP_API#104 requires the partition be assigned to whole groups of
 * observations whose key frames share screen time, so the shares land near the
 * request rather than exactly on it. That is computed here for real, and the
 * panel says where it landed.
 *
 * An earlier version drew all 1,204 groups as a barcode, with a timeline
 * explaining why a group cannot be separated. Both were teaching diagrams for
 * whoever implements this rather than controls for whoever uses it, and they
 * went the same way as the explanatory paragraphs did. The rule is in DESIGN.md.
 */
function wireSplit() {
  const inputs = [$('#pTrain'), $('#pVal'), $('#pTest')];
  if (inputs.some((el) => !el)) return;

  /* Group sizes, so the assignment is a real one rather than a percentage of a
     total. Mostly small -- a lone animal or a pair -- with occasional dense
     patches of seabed. */
  const sizes = [];
  let gen = 4711;
  for (let i = 0; i < 1204; i++) {
    gen = (gen * 1103515 + 12345) % 2147483647;
    const r = gen / 2147483647;
    sizes.push(r < 0.55 ? 1 + Math.floor(r * 4)
      : r < 0.9 ? 4 + Math.floor(r * 14)
        : 18 + Math.floor(r * 30));
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  let seed = 1;

  const bars = [$('#barTr'), $('#barVa'), $('#barTe')];
  const pcs = [$('#pcTr'), $('#pcVa'), $('#pcTe')];
  const nums = [$('#trN'), $('#vaN'), $('#teN')];
  const note = $('#splitNote');

  const draw = () => {
    let want = inputs.map((el) => Math.max(0, Number(el.value) || 0));
    const sum = want.reduce((a, b) => a + b, 0) || 1;
    want = want.map((w) => w * 100 / sum);

    /* Largest group first, into whichever partition is furthest from its
       target: one dense aggregation must not overshoot a small partition and
       leave it unfillable. */
    const targets = want.map((w) => total * w / 100);
    const got = [0, 0, 0];
    const order = sizes.map((v, i) => i)
      .sort((a, b) => sizes[b] - sizes[a] || ((a * seed) % 7) - ((b * seed) % 7));
    for (const i of order) {
      let k = 0;
      let worst = -Infinity;
      for (let c = 0; c < 3; c++) {
        const room = targets[c] - got[c];
        if (room > worst) { worst = room; k = c; }
      }
      got[k] += sizes[i];
    }

    let drift = 0;
    for (let k = 0; k < 3; k++) {
      const pct = got[k] / total * 100;
      drift = Math.max(drift, Math.abs(pct - want[k]));
      if (bars[k]) bars[k].style.width = pct.toFixed(2) + '%';
      if (pcs[k]) pcs[k].textContent = Math.round(pct) + '%';
      if (nums[k]) nums[k].textContent = got[k].toLocaleString('en-US');
    }
    if (note) {
      note.textContent = drift < 0.05
        ? 'Whole groups only, and these shares land on the request'
        : 'Whole groups only \u2014 within ' + drift.toFixed(1) + ' points of the request';
    }
  };

  inputs.forEach((el) => el.addEventListener('input', draw));
  const again = $('#reshuffle');
  if (again) again.addEventListener('click', () => { seed = (seed * 7 + 3) % 101 || 1; draw(); });
  draw();
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
wireSwitchers();
wireSliders();
wireInferenceForm();
wireSorting();
wireAccordions();
wireSplit();
applyTips();
