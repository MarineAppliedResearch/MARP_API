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
    key: 'session', field: 'session_id',
    source: 'observations.session_id', kind: KIND.SET,
    nestsUnder: 'sessionType', label: 'session', all: 'All sessions',
    one: (v) => `Session ${v}`,
  },

  {
    key: 'species', field: 'comname',
    source: 'observations.comname', kind: KIND.SET,
    label: 'species', all: 'All species', one: (v) => v, searchable: true,
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
    /* And this one does not always work. `tc` only carries a date where the clock was
       synced, so this dimension must report what it could not see -- see #76. */
    key: 'date', field: 'tc',
    source: 'observations.tc -- date, only where the clock was synced. #76', kind: KIND.RANGE,
    label: 'date', all: 'Any date', reportsExclusions: true,
  },

  {
    /* No column links an observation to the model that produced it in the real schema
       yet -- that is Phase 3 of #68 -- but the fixture simulates one, because simulating
       the schema the client is designed against is what the fixture is for. A control
       nobody can exercise is a control nobody can judge.

       #81 asked whether this stays, and left the question open rather than answering it;
       the Processor filter beside it was removed outright, because querying by who did
       the annotation does not match how the work is structured. */
    key: 'model', field: 'model_name',
    source: 'NOTHING YET. ml_models exists; the link from an observation does not. #68', kind: KIND.SET,
    label: 'model', all: 'Any model', one: (v) => v,
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
