/**
 * What the rail can filter on, declared once.
 *
 * Before this, adding a dimension meant editing seven files: `filters.js`, `data.js`
 * twice, `index.html`, `menus.js`, `chrome.js` and `mount.js`. That is a tax on every
 * future dimension and a trap for whoever forgets the seventh. `MODES` already proves
 * the alternative works for the status filters — adding one there is one entry and
 * nothing else — so this is that pattern, applied to the rest of the rail.
 *
 * **The test of this file is that adding a dimension is one entry here and nothing
 * else.** If it ever needs a second place, the refactor has failed and should be fixed
 * rather than worked around.
 *
 * No DOM, no network. This describes dimensions; it does not read or draw them.
 */

/**
 * How the values of a dimension are compared.
 *
 * - `set`     one of several chosen values, or unfiltered when none are chosen
 * - `range`   between two numbers, inclusive
 * - `window`  between two times of day, and it may wrap past midnight
 */
export const KIND = { SET: 'set', RANGE: 'range', WINDOW: 'window' };

/**
 * The rail, in the order it is drawn.
 *
 * The order is the whole of the arrangement. #77 grouped these under four headings --
 * *where it came from*, *what it is*, *when*, *who* -- and #81 dropped them: four headings
 * cost four rows of a rail that was already clipping its own status filters off the
 * bottom, and eight controls read fine as a list. `group` went with them rather than being
 * kept and ignored, because a field the declaration carries and nothing reads is a trap.
 *
 * `nestsUnder` is the chain that makes a narrower choice meaningful: a line number means
 * nothing without its dive, a dive nothing without its project, and a session nothing
 * outside the kind of session it was.
 *
 * `field` is the row property the fixture and the API both filter on, and `source` says
 * where that property comes from in the real schema. Most of them are a join rather than
 * a column on `observations` -- recorded here so Phase 4's query does not have to work it
 * out again, and so the one that is genuinely missing stays visible. See the schema audit
 * on #68.
 */
export const DIMENSIONS = [
  {
    key: 'project', field: 'project_name',
    source: 'projects.name via observations.project_id', kind: KIND.SET,
    label: 'project', all: 'All projects', one: (v) => v,
  },
  {
    key: 'dive', field: 'dive',
    source: 'sessions.dive via observations.session_id', kind: KIND.SET,
    nestsUnder: 'project', label: 'dive', all: 'All dives', one: (v) => `Dive ${v}`,
  },
  {
    key: 'line', field: 'line',
    source: 'sessions.line', kind: KIND.SET,
    nestsUnder: 'dive', label: 'line', all: 'All lines', one: (v) => `Line ${v}`,
  },
  {
    /* Above `session`, and `session` nests under it: the type is what narrows which
       sessions are worth offering, so asking for it second would be asking backwards. */
    key: 'sessionType', field: 'session_type',
    source: 'sessions.type -- aliased, because a bare `type` on an observation says type of what', kind: KIND.SET,
    label: 'session type', all: 'Any type', one: (v) => v,
  },
  {
    /* Filterable, and always was: the endpoint's filter is `o.session_id` as an `int[]`,
       and this already declared the right field. What it lacked was an option list, which
       is A6's facets and not a reason to withdraw the control — see A14. */
    key: 'session', field: 'session_id',
    source: 'observations.session_id', kind: KIND.SET,
    nestsUnder: 'sessionType', label: 'session', all: 'All sessions',
    one: (v) => `Session ${v}`, numeric: true,
  },

  {
    /**
     * The species filter is a **key**, not a name (F1, A10a).
     *
     * `field: 'comname'` was incompatibility 1 of #68: the endpoint filters on
     * `observations.species_id`, "and only species_id" — because it finds the *organism*,
     * where `comname` finds rows whose label text matches a name that may since have
     * moved. Lists were renamed and renumbered under records that were correct when they
     * were made, and a species correction deliberately never rewrites `comname`, so a
     * name filter and a key filter genuinely return different rows.
     *
     * `labelled` is the consequence, and it is why the rail carries `(key, label)` pairs:
     * `one(v)` would otherwise draw the key, so the species control would read "775".
     * The label comes from the server's facet list — see `optionLabel` below.
     */
    key: 'species', field: 'species_id',
    source: 'observations.species_id', kind: KIND.SET,
    label: 'species', all: 'All species', one: (v) => v, searchable: true,
    labelled: true, numeric: true,
  },
  {
    key: 'confidence', field: 'confidence',
    source: 'observations.confidence', kind: KIND.RANGE,
    label: 'confidence', bounds: [0, 1], step: 0.01,
    format: (v) => v.toFixed(2),
  },

  {
    /* Every observation has a time of day: `tc` carries one whether or not the session's
       clock was synced well enough to carry a date. This dimension therefore always
       works, which is why it is separate from `date` rather than one control. */
    key: 'timeOfDay', field: 'tc',
    source: 'observations.tc -- time of day, always present', kind: KIND.WINDOW,
    label: 'time of day', all: 'Any time',
  },
  {
    /**
     * A range over `tc` **as a point in time** (A17, answered by the human).
     *
     * *"If there is no date, it'll just default to the time. And if there is a date, then
     * the date will also work."* So the reviewer is asking about a moment, `tc` is the
     * moment MARP records, and the control answers with whatever `tc` can discriminate:
     * time of day today, and dates as well once #76 gives an observation a real one — with
     * no change to the control when that happens.
     *
     * **It does not wrap, and that is the whole difference from `timeOfDay`.** A time
     * *window* of 22:00 to 02:00 is one night; a *range* from later to earlier is empty.
     * The two are adjacent rather than duplicates, and they stop being adjacent at all the
     * moment `tc` carries a date.
     *
     * `clock: true` is what says the ends are times rather than numbers, so the rail draws
     * text inputs (a native `<input type="time">` renders from the browser locale and no
     * attribute overrides it — #81 B3) and `matchesDimension` compares clocks. It used to
     * be `<input type="date">` validated as `YYYY-MM-DD`, which is reading (i) and is the
     * one the human ruled out.
     *
     * `reportsExclusions` stays, and it finally has something to report: a row whose `tc`
     * carries no readable clock cannot answer, so it is excluded **and counted**. That
     * reporting is what #76 built so a date filter could never silently omit.
     */
    key: 'date', field: 'tc',
    source: 'observations.tc -- as a moment. Time of day today; dates when #76 lands', kind: KIND.RANGE,
    label: 'date', all: 'Any date', reportsExclusions: true, clock: true,
  },

  {
    /**
     * The model filter is a key too, and it **is** filterable (A14, corrected).
     *
     * The old note here — "NOTHING YET; ml_models exists, the link from an observation
     * does not" — was true when Phase 3 was written and is stale: the endpoint's filter is
     * `observations.ml_model_id` (`repository/mosaic.repository.js`, the `set('model', …)`
     * line), and the GPU pipeline populates the column. So this was never a dead control;
     * it had exactly the same defect as `species` — a name sent where the filter takes an
     * integer key — and it gets exactly the same fix.
     *
     * An earlier draft of Phase 8's spec claimed this and `session` had nothing behind
     * them and recommended withdrawing both. That was wrong, and it is recorded as wrong
     * in A14 rather than quietly amended.
     */
    key: 'model', field: 'ml_model_id',
    source: 'observations.ml_model_id', kind: KIND.SET,
    label: 'model', all: 'Any model', one: (v) => v,
    labelled: true, numeric: true,
  },
];

/** By key, for the many places that have one and want the rest. */
export const DIMENSION = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d]));

export const dimensionKeys = () => DIMENSIONS.map((d) => d.key);

/** Everything that nests under `key`, directly or through another dimension. */
export function dependentsOf(key) {
  const out = [];
  let frontier = [key];
  while (frontier.length) {
    const next = DIMENSIONS.filter((d) => frontier.includes(d.nestsUnder)).map((d) => d.key);
    out.push(...next);
    frontier = next;
  }
  return out;
}

/** The empty value for a dimension: no selection means it is not filtering. */
export function emptyValue(dimension) {
  if (dimension.kind === KIND.SET) return [];
  return null;                                   // a range or window is absent, not empty
}

/**
 * One value of a set dimension, in the type the wire takes.
 *
 * A `numeric` dimension filters on an integer key, and the endpoint **rejects** a
 * non-integer rather than matching nothing — `filters.species takes integer ids, not
 * "Bat Star"`. Values reach the client as strings from two places (an address, and a
 * menu's `data-v`), so there has to be one function that turns them back, and it returns
 * `null` for anything that is not a key rather than guessing.
 *
 * @param {Object} dimension - From `DIMENSIONS`.
 * @param {*} raw - A value read from an address, a menu, or a facet list.
 * @returns {number|string|null} The value to filter with, or null when it is not one.
 */
export function setValueOf(dimension, raw) {
  if (!dimension || !dimension.numeric) return raw;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/**
 * Which values each nesting dimension can still reach, from a facets answer.
 *
 * `applyDimension` asks "is this value still reachable" and wants plain values, where a
 * facet entry is `{ value, label, count, list }` — handing it the objects would make every
 * `Set.has` miss silently, and it would read as the nesting rule having stopped working
 * rather than as a shape mismatch.
 *
 * @param {Object} facets - `state.facets`, keyed by dimension.
 * @returns {Object} `{ [key]: values[] }`, for the dimensions the answer carried.
 */
export const reachableFrom = (facets = {}) => Object.fromEntries(
  Object.entries(facets || {}).map(([key, options]) =>
    [key, (options || []).map((o) => o.value)]));

/**
 * What the rail draws for one value of a set dimension.
 *
 * A `labelled` dimension filters on a key and shows a name, so the pair has to come from
 * somewhere: `facets` is the server's answer to "what is still reachable", and it carries
 * `{ value, label }` per option (A6, A10a). Without a label — a key chosen from an address
 * before the facets have arrived — the key itself is drawn, which is honest and briefly
 * ugly rather than blank.
 *
 * A10(c): a label is qualified with its list **only when the current question spans more
 * than one list**, because a common name identifies a species only within its list
 * (F15). One list is the common case and stays clean.
 *
 * @param {Object} dimension - From `DIMENSIONS`.
 * @param {*} value - One chosen value.
 * @param {Object} [facets] - `state.facets`, keyed by dimension.
 * @returns {string} What to draw.
 */
export function optionLabel(dimension, value, facets = {}) {
  const options = (facets && facets[dimension.key]) || [];
  const hit = options.find((o) => String(o.value) === String(value));
  if (!hit) return dimension.one(value);

  const spansLists = new Set(options.map((o) => o.list).filter(Boolean)).size > 1;
  const label = spansLists && hit.list ? `${hit.label} · ${hit.list}` : hit.label;
  return dimension.one(label);
}

/** Is this dimension narrowing anything? */
export function isActive(dimension, value) {
  /* `Array.isArray`, not a truthy length. A bare string has a length too, so a stray
     `state.filters.species = 'Bat Star'` used to read as active and then failed only
     wherever something tried to iterate it -- which was nowhere until the address needed
     writing, and then it threw inside a refresh. An invalid shape is inert now instead of
     half-applied. */
  if (dimension.kind === KIND.SET) return Array.isArray(value) && value.length > 0;
  return Boolean(value && (value.from != null || value.to != null));
}
