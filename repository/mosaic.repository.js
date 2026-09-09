/**
 * The mosaic query: filtered, sorted, paged observations for the picture reviewer.
 *
 * This is Phase 4 of #68 and the endpoint `frontend/apps/marp-mosaic-review` is
 * already built against -- `src/data.js` `queryPages()` is the fixture
 * implementation of the same contract, and this has to be substitutable for it.
 * The request and response envelope are #99's; what this phase settled is in
 * `.marp/task.md`.
 *
 * **Raw SQL rather than the Sequelize query builder (R14).** A `hasMany` include
 * combined with `limit` makes Sequelize emit a subquery and duplicate parent rows,
 * which is why every joined query in `observation.repository.js` is unpaginated.
 *
 * Four properties are the whole reason for the shape, and each is a requirement:
 *
 * - **one pass for a discontiguous page set** (R3). The matching set is walked and
 *   numbered once; each requested page is a band over the numbering, so asking for
 *   pages 1, 47 and 9,780 costs what asking for page 1 costs;
 * - **flat in depth** (R4). Page 9,780 costs what page 1 costs, because the cost is
 *   proportional to the matching set rather than to the offset;
 * - **deterministic ordering** (R2). `observation_id` is appended as the final sort
 *   term, always, whatever the client sent. #68 makes page membership
 *   query-derived, so a comparator that can return zero for two different rows
 *   means page one holds different observations on each visit;
 * - **the count is an ordinary aggregate over the materialised CTE** (A1), never
 *   `count(*) OVER ()`. That window has an empty frame, so its `WindowAgg` cannot
 *   emit a row until it has read the last one: it buffers the entire matching set
 *   into a second tuplestore and spills. Measured at production cardinality:
 *   348 ms and 14,613 kB to disk, against 293 ms and no extra buffering for the
 *   identical number taken as an aggregate.
 *
 * `AS MATERIALIZED` is not decoration. `(SELECT count(*) FROM matched)` needs the
 * CTE to be a real tuplestore rather than inlined into the outer query, and that
 * is also what makes R3 and R4 true.
 *
 * Refs #105, MarineAppliedResearch/MARP_API#68, MarineAppliedResearch/MARP_API#99.
 *
 * @fileoverview The mosaic page-set and status-count queries.
 * @author Isaac Travers
 * @module repository/mosaic
 */

const db = require('../model');

/**
 * The cap on one page-set request: 12 pages or 600 rows, whichever binds first.
 *
 * A request over it is **rejected**, never truncated (R5). A scheduler that
 * quietly gets fewer pages than it asked for believes it holds a set it does not,
 * and the reviewer meets that as a spinner on a page the cache was supposed to
 * have. Mirrors `MAX_PAGES` / `MAX_ROWS` in the mosaic's `src/data.js`.
 *
 * @constant
 * @type {number}
 */
const MAX_PAGES = 12;

/** @constant @type {number} */
const MAX_ROWS = 600;

/**
 * A request this endpoint refuses: answered with `400`, not `500`.
 *
 * Validation sits beside the builder rather than in a service layer because the
 * builder is what defines what is valid -- the closed sort list, the closed status
 * vocabularies and the caps are all facts about the SQL it can emit.
 */
class MosaicRequestError extends Error {
    /**
     * @param {string} message - Why the request cannot be answered.
     */
    constructor(message) {
        super(message);
        this.name = 'MosaicRequestError';
        this.status = 400;
    }
}

/**
 * The two status dimensions, and the shape of their three-valued domains.
 *
 * **Undecided is the absence of a row** in `observation_review_current` (#103):
 * the projection's `CHECK` permits only `reviewed|flagged` for `scientific` and
 * `promoted|excluded` for `training`, and a withdrawal deletes the row. So each
 * dimension has three values, one of which is an absence, and that is what shapes
 * the predicate in {@link statusPredicate}.
 *
 * @constant
 * @type {Object}
 */
const STATUS_DIMENSIONS = {
    reviewStatus: { purpose: 'scientific', absent: 'unreviewed', decisions: ['reviewed', 'flagged'] },
    trainingDisposition: { purpose: 'training', absent: 'undecided', decisions: ['promoted', 'excluded'] },
};

/**
 * The closed list of sortable fields, and the expression each sorts on.
 *
 * Matches `SORT_FIELDS` in the mosaic's `src/model/filters.js`. A field outside
 * this list is a rejected request rather than a silent fallback to the default:
 * the contract calls it a closed list, and a client that mistypes a field would
 * otherwise get a different question answered without being told.
 *
 * `keyframe_count` is the one that is not a column. Sorting by it is the case A2
 * exists to answer, and the human accepted its cost with open eyes -- so it moves
 * the keyframe aggregate inside the matching set, where it runs per matching row.
 * Every other sort leaves the aggregate in the outer query (R9).
 *
 * @constant
 * @type {Object}
 */
const SORT_FIELDS = {
    confidence: 'o.confidence',
    keyframe_count: 'kc.keyframe_count',
    updatedAt: 'o."updatedAt"',
    obsID: 'o."obsID"',
};

/** The sort applied when the request names none. `DEFAULT_SORT` in the client. */
const DEFAULT_SORT = [{ field: 'confidence', dir: 'asc' }];

/**
 * The row the tile renders, and nothing more (R13, A6).
 *
 * `processor_name` and `lineId` are deliberately absent: nothing draws either, and
 * `processor_name` is exactly the "who did how much work" the permission catalog
 * separates from `observations:read` -- carrying it would stop this being an
 * `observations:read` route (A7). `scientific_name` is out because whether the
 * mosaic shows scientific names is still open in #68, and adding a field later is
 * additive where removing one is not. `first_framenum` stays: it is free from the
 * same lateral that produces `keyframe_count`, and Phase 6 needs it to address a
 * thumbnail.
 *
 * The column list is written out rather than `o.*` so that a column added to
 * `observations` does not silently join the payload.
 *
 * @constant
 * @type {string}
 */
const ROW_COLUMNS = `
        o.observation_id,
        o."obsID",
        o.confidence,
        o.comname,
        o.tc,
        s.dive,
        s.line,
        s.type AS session_type,
        p.name AS project_name,
        rc.decision AS review_decision,
        rc.reason   AS flag_reason,
        rt.decision AS training_decision,
        rt.reason   AS exclusion_reason,
        k.keyframe_count,
        k.first_framenum`;

/**
 * Time of day, in `interval`, from the `tc` a row carries.
 *
 * Mirrors `timeOfDayMs` in the mosaic's `src/model/match.js` exactly, and for the
 * same reasons: the optional day group is **ignored**, because a dive crossing
 * midnight writes `1.00:15:33` and the day component says the dive rolled over
 * rather than which hour the observation happened in; a leading sign is ignored,
 * because a negative value formats with the sign in front of everything; and the
 * pattern is anchored, so a `tc` that carries a date rather than a bare clock
 * yields null and is excluded from a time window exactly as the fixture excludes
 * it.
 *
 * This extracts a clock and casts it. It does not reproduce the `TimeSpan`
 * arithmetic `db/timecode.js` owns -- no tick division, no millisecond
 * truncation -- because `tc` is written truncated at the second (`deriveTc`) and
 * a window is a comparison rather than a computation.
 *
 * @constant
 * @type {string}
 */
const TIME_OF_DAY = `substring(o.tc from '^-?(?:[0-9]+\\.)?([0-9]{1,2}:[0-9]{2}:[0-9]{2})')::interval`;

/**
 * Is a value narrowing anything?
 *
 * **An empty or absent value means not filtering** (R8), never the owning mode's
 * default. Both status dimensions are sent on every query (#89) and both may be
 * empty; reading an empty array as a default drops rows silently.
 *
 * @param {*} value - Whatever the request carried for one dimension.
 * @returns {boolean} True when the dimension narrows the result.
 */
function isActive(value) {
    if (Array.isArray(value)) {
        return value.length > 0;
    }

    return Boolean(value && (value.from != null || value.to != null));
}

/**
 * A multi-select value as a clean array, or null when it is not filtering.
 *
 * @param {*} value - The request's value for a set dimension.
 * @param {string} key - Dimension name, for the error message.
 * @returns {Array|null} The values, or null.
 * @throws {MosaicRequestError} If the value is neither an array nor absent.
 */
function setValue(value, key) {
    if (value == null) {
        return null;
    }

    if (!Array.isArray(value)) {
        throw new MosaicRequestError(`filters.${key} must be an array of values`);
    }

    return value.length ? value : null;
}

/**
 * A finite number from a range end, or null.
 *
 * @param {*} value - One end of a range.
 * @param {string} label - What to call it in an error.
 * @returns {number|null} The number, or null when the end is open.
 * @throws {MosaicRequestError} If the end is present and not a number.
 */
function rangeEnd(value, label) {
    if (value == null || value === '') {
        return null;
    }

    const n = Number(value);

    if (!Number.isFinite(n)) {
        throw new MosaicRequestError(`${label} must be a number`);
    }

    return n;
}

/**
 * `HH:MM[:SS]` normalised to a Postgres-castable clock, plus its seconds of day.
 *
 * Accepts what the rail's text fields produce -- `9:30` as well as `09:30` --
 * because the ends are typed rather than chosen from a native time input (#81 B3).
 *
 * @param {*} value - One end of a time window.
 * @param {string} label - What to call it in an error.
 * @returns {{text: string, seconds: number}|null} The clock, or null when open.
 * @throws {MosaicRequestError} If the end is present and is not a time of day.
 */
function clockEnd(value, label) {
    if (value == null || value === '') {
        return null;
    }

    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());

    if (!m) {
        throw new MosaicRequestError(`${label} must be a time of day as HH:MM`);
    }

    const [hh, mm, ss] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];

    if (hh > 23 || mm > 59 || ss > 59) {
        throw new MosaicRequestError(`${label} is not a time of day`);
    }

    return {
        text: `${String(hh).padStart(2, '0')}:${m[2]}:${String(ss).padStart(2, '0')}`,
        seconds: (hh * 3600) + (mm * 60) + ss,
    };
}

/**
 * Collects `$n` bind parameters in order, so a fragment never has to know its own
 * position in the statement.
 *
 * @returns {{add: Function, values: Array}} `add(value)` returns the placeholder.
 */
function binder() {
    const values = [];

    return {
        add(value) {
            values.push(value);
            return `$${values.length}`;
        },
        values,
    };
}

/**
 * The predicate for one status dimension (R6, R7).
 *
 * The domain has three values and one of them is the **absence** of a projection
 * row, so which join the selected set becomes depends on whether it includes that
 * absent value:
 *
 * - a set that **excludes** it is a **semi-join** -- `EXISTS (… decision = ANY(…))`;
 * - a set that **includes** it is an **anti-join over the complement** --
 *   `NOT EXISTS (… decision = ANY(the values not selected))`. The default question
 *   `['unreviewed','flagged']` is therefore `NOT EXISTS (… decision = 'reviewed')`;
 * - a set covering **every** value is no predicate at all, which is what Delete
 *   Mode's `trainingDisposition` default produces.
 *
 * **Never `coalesce(decision, 'unreviewed') IN (…)`.** That demotes the decision
 * test to a post-join filter and loses the index-only scan on
 * `observation_review_current_purpose_decision_idx`; both forms above keep it.
 * Confirmed from the plans -- see *Decisions* in `.marp/task.md`.
 *
 * @param {string} key - `reviewStatus` or `trainingDisposition`.
 * @param {Array<string>} selected - The statuses the reviewer has ticked.
 * @param {Object} bind - The {@link binder} collecting parameters.
 * @returns {string|null} SQL, or null when the dimension is not narrowing.
 * @throws {MosaicRequestError} If a value is outside the dimension's vocabulary.
 */
function statusPredicate(key, selected, bind) {
    const dimension = STATUS_DIMENSIONS[key];
    const domain = [dimension.absent, ...dimension.decisions];
    const wanted = [...new Set(selected)];

    for (const value of wanted) {
        if (!domain.includes(value)) {
            throw new MosaicRequestError(
                `filters.${key} does not take "${value}"; it takes ${domain.map((v) => `"${v}"`).join(', ')}`
            );
        }
    }

    // Every value selected is the same question as none selected.
    if (wanted.length === domain.length) {
        return null;
    }

    const purpose = bind.add(dimension.purpose);

    if (!wanted.includes(dimension.absent)) {
        const decisions = bind.add(wanted);

        return `EXISTS (SELECT 1 FROM observation_review_current rcf
                         WHERE rcf.observation_id = o.observation_id
                           AND rcf.purpose = ${purpose}
                           AND rcf.decision = ANY(${decisions}::varchar[]))`;
    }

    // The complement: everything the reviewer did not tick, which by construction
    // is all real decisions, so the anti-join never has to reason about absence.
    const complement = bind.add(dimension.decisions.filter((d) => !wanted.includes(d)));

    return `NOT EXISTS (SELECT 1 FROM observation_review_current rcf
                         WHERE rcf.observation_id = o.observation_id
                           AND rcf.purpose = ${purpose}
                           AND rcf.decision = ANY(${complement}::varchar[]))`;
}

/**
 * Every predicate the request asks for, as SQL fragments.
 *
 * @param {Object} filters - The request's `filters` object.
 * @param {Object} bind - The {@link binder} collecting parameters.
 * @param {Object} [options]
 * @param {boolean} [options.status=true] - Include the two status dimensions.
 * The counts query passes false: it applies the **non-status** filters only (R10),
 * deliberately, because `ui/chrome.js` reads `state.counts[value]` by value alone.
 * @returns {Array<string>} The `WHERE` terms, to be joined with `AND`.
 * @throws {MosaicRequestError} If a filter is unserviceable or malformed.
 */
function predicates(filters, bind, { status = true } = {}) {
    const where = [];
    const set = (key, expression, cast) => {
        const values = setValue(filters[key], key);

        if (!values) {
            return;
        }

        // An id dimension given names rather than ids is a rejected request, not
        // a database type error surfacing as a 500 -- and not a filter that
        // silently matches nothing either, which is the worse of the two.
        if (cast === 'int[]' && values.some((value) => !Number.isInteger(value))) {
            throw new MosaicRequestError(`filters.${key} takes integer ids, not ${JSON.stringify(values[0])}`);
        }

        where.push(`${expression} = ANY(${bind.add(values)}::${cast})`);
    };

    set('project', 'p.name', 'varchar[]');
    set('dive', 's.dive', 'varchar[]');
    set('line', 's.line', 'varchar[]');
    set('sessionType', 's.type', 'varchar[]');
    set('session', 'o.session_id', 'int[]');
    // A4: species_id and only species_id. It finds the organism, where `comname`
    // finds rows whose label text matches a name that may since have moved --
    // lists were renamed and renumbered under records that were correct when they
    // were made. The client still sends a name; that rename is Phase 8's.
    set('species', 'o.species_id', 'int[]');
    set('model', 'o.ml_model_id', 'int[]');

    if (isActive(filters.confidence)) {
        const from = rangeEnd(filters.confidence.from, 'filters.confidence.from');
        const to = rangeEnd(filters.confidence.to, 'filters.confidence.to');

        if (from != null) {
            where.push(`o.confidence >= ${bind.add(from)}`);
        }

        if (to != null) {
            where.push(`o.confidence <= ${bind.add(to)}`);
        }
    }

    // A3: `date` is not "limited pending #76", it is unanswerable. Nothing holds
    // the date an observation was made -- not `observations`, and not `sessions`,
    // whose timestamps are when the row was written rather than when the dive
    // happened. Rejecting is more honest than a control that excludes everything.
    if (isActive(filters.date)) {
        throw new MosaicRequestError(
            'filters.date cannot be served: no column holds the date an observation was made. See #76.'
        );
    }

    if (isActive(filters.timeOfDay)) {
        const from = clockEnd(filters.timeOfDay.from, 'filters.timeOfDay.from');
        const to = clockEnd(filters.timeOfDay.to, 'filters.timeOfDay.to');

        if (from && to) {
            const f = bind.add(from.text);
            const t = bind.add(to.text);

            // A window may wrap: 22:00 to 02:00 is one night, not two ranges, and
            // inside a wrapped window the test is "or" rather than "and". Writing
            // it as "and" is the single most common way this goes wrong, and it
            // then returns nothing at all.
            where.push(from.seconds <= to.seconds
                ? `(${TIME_OF_DAY} >= ${f}::interval AND ${TIME_OF_DAY} <= ${t}::interval)`
                : `(${TIME_OF_DAY} >= ${f}::interval OR ${TIME_OF_DAY} <= ${t}::interval)`);
        } else if (from) {
            where.push(`${TIME_OF_DAY} >= ${bind.add(from.text)}::interval`);
        } else if (to) {
            where.push(`${TIME_OF_DAY} <= ${bind.add(to.text)}::interval`);
        }
    }

    if (status) {
        for (const key of Object.keys(STATUS_DIMENSIONS)) {
            const values = setValue(filters[key], key);

            if (values) {
                const predicate = statusPredicate(key, values, bind);

                if (predicate) {
                    where.push(predicate);
                }
            }
        }
    }

    return where;
}

/**
 * The pages a request is actually asking for: de-duplicated, ascending, capped.
 *
 * @param {*} pages - The request's `pages`.
 * @param {number} pageSize - Rows per page.
 * @returns {Array<number>} Page numbers, ascending.
 * @throws {MosaicRequestError} If a page is not a page number, or the cap is exceeded.
 */
function requestedPages(pages, pageSize) {
    if (!Array.isArray(pages)) {
        throw new MosaicRequestError('pages must be an array of page numbers');
    }

    const wanted = [...new Set(pages)].sort((a, b) => a - b);

    for (const page of wanted) {
        if (!Number.isInteger(page) || page < 1) {
            throw new MosaicRequestError(`${JSON.stringify(page)} is not a page number; pages are 1-based integers`);
        }
    }

    if (wanted.length > MAX_PAGES) {
        throw new MosaicRequestError(`${wanted.length} pages asked for; the cap is ${MAX_PAGES}`);
    }

    if (wanted.length * pageSize > MAX_ROWS) {
        throw new MosaicRequestError(`${wanted.length * pageSize} rows asked for; the cap is ${MAX_ROWS}`);
    }

    return wanted;
}

/**
 * The sort terms to apply, with `observation_id` appended.
 *
 * **Appended always, unconditionally, and regardless of what the client sent**
 * (R2). The client appends it too; both appending is correct and neither may stop.
 *
 * @param {*} sort - The request's `sort`: an array of `{ field, dir }`.
 * @returns {Array<Object>} Normalised terms, ending with `observation_id`.
 * @throws {MosaicRequestError} If a term names a field outside the closed list.
 */
function sortTerms(sort) {
    const given = (Array.isArray(sort) && sort.length) ? sort : DEFAULT_SORT;
    const terms = [];

    for (const term of given) {
        const field = term && term.field;

        if (!Object.prototype.hasOwnProperty.call(SORT_FIELDS, field)) {
            throw new MosaicRequestError(
                `sort field "${field}" is not one of ${Object.keys(SORT_FIELDS).join(', ')}`
            );
        }

        // A second term on the same field can never be reached, so it is not a term.
        if (!terms.some((t) => t.field === field)) {
            terms.push({ field, dir: (term && term.dir === 'desc') ? 'desc' : 'asc' });
        }
    }

    terms.push({ field: 'observation_id', dir: 'asc' });

    return terms;
}

/**
 * The `ORDER BY` list for a set of normalised sort terms.
 *
 * No explicit `NULLS` clause: Postgres sorts nulls last in `ASC`, which is what
 * puts the lowest-confidence *scored* rows on the first pages of the default
 * question and every unscored row on the last. That is the wanted behaviour and it
 * is invisible until somebody pages to the end, which is why it is written down.
 *
 * @param {Array<Object>} terms - From {@link sortTerms}.
 * @returns {string} The `ORDER BY` list, without the keyword.
 */
function orderBy(terms) {
    return terms
        .map((t) => `${t.field === 'observation_id' ? 'o.observation_id' : SORT_FIELDS[t.field]} ${t.dir === 'desc' ? 'DESC' : 'ASC'}`)
        .join(', ');
}

/**
 * Build the page-set statement and its bind parameters.
 *
 * Exported so a test can assert against the SQL itself. R9 -- that
 * `keyframe_count` is never computed over the whole matching set for a request
 * that does not sort by it -- is not observable from a row count on a database
 * holding one observation, so it is asserted here instead.
 *
 * @param {Object} request - The validated, normalised request.
 * @param {Object} request.filters - The ten rail dimensions plus the two status ones.
 * @param {Array<Object>} request.sort - `{ field, dir }` terms.
 * @param {number} request.pageSize - Rows per page.
 * @param {Array<number>} request.pages - Ascending, de-duplicated page numbers.
 * @param {Array<number>} [request.exclude] - Ids pinned to a committed page.
 * @param {boolean} [request.includeTotal] - Whether to count the matching set.
 * @returns {{sql: string, bind: Array}} The statement and its parameters.
 * @throws {MosaicRequestError} If any part of the request is unserviceable.
 */
function buildPageSetQuery({ filters = {}, sort, pageSize, pages, exclude, includeTotal = false }) {
    const bind = binder();
    const terms = sortTerms(sort);
    const where = predicates(filters, bind);

    // Read from either the contract's own field or `filters.excludeIds`, where the
    // client's `queryFilters` puts it, exactly as the fixture's `queryPages` does --
    // so the store can hand the same filters object to both and neither silently
    // stops excluding.
    const excluded = setValue(exclude != null ? exclude : filters.excludeIds, 'exclude');

    if (excluded) {
        if (excluded.some((id) => !Number.isInteger(id))) {
            throw new MosaicRequestError('exclude takes observation ids as integers');
        }

        // Suppression at serve time rather than in the cache key: the pinned set
        // grows on every commit, and in the key every commit would discard the
        // whole client cache (#99 A4).
        where.push(`o.observation_id <> ALL(${bind.add(excluded)}::int[])`);
    }

    // The keyframe aggregate belongs in the OUTER query, where it runs at most
    // once per returned row -- 600 index lookups under the cap, against an index
    // that already exists (R9). It moves inside the matching set only when the
    // sort names it, because `row_number()` cannot be assigned until the value
    // being sorted on exists. That is the 614 ms the human accepted for the
    // "Track length" sort, and it is one sort option of four.
    const sortsOnKeyframes = terms.some((t) => t.field === 'keyframe_count');

    const keyframeLateral = `LEFT JOIN LATERAL (
            SELECT count(*)::int AS keyframe_count, min(framenum) AS first_framenum
              FROM keyframes
             WHERE observation_id = o.observation_id) `;

    const bands = pages
        .map((page) => `m.rn BETWEEN ${bind.add(((page - 1) * pageSize) + 1)} AND ${bind.add(page * pageSize)}`)
        .join(' OR ');

    // `tally` is one row whatever the filters match, and the page rows hang off it
    // by `LEFT JOIN … ON true`. That is what makes `includeTotal` survive a page
    // set entirely past the end (R5): the scheduler asks for the tail before it
    // knows the count, and a bare projection would return no rows and so no total.
    const tally = includeTotal
        ? 'SELECT count(*)::int AS total FROM matched'
        : 'SELECT NULL::int AS total';

    const sql = `
WITH matched AS MATERIALIZED (
    SELECT o.observation_id,
           row_number() OVER (ORDER BY ${orderBy(terms)}) AS rn
      FROM observations o
      LEFT JOIN sessions s ON s.session_id = o.session_id
      LEFT JOIN projects p ON p.project_id = o.project_id${sortsOnKeyframes ? `\n      ${keyframeLateral}kc ON true` : ''}
     ${where.length ? `WHERE ${where.join('\n       AND ')}` : ''}
),
tally AS (${tally}),
banded AS (
    SELECT m.rn, m.observation_id
      FROM matched m
     WHERE ${bands || 'false'}
)
SELECT t.total,
       m.rn,${ROW_COLUMNS}
  FROM tally t
  LEFT JOIN banded m ON true
  LEFT JOIN observations o ON o.observation_id = m.observation_id
  LEFT JOIN sessions s ON s.session_id = o.session_id
  LEFT JOIN projects p ON p.project_id = o.project_id
  LEFT JOIN observation_review_current rc
         ON rc.observation_id = o.observation_id AND rc.purpose = 'scientific'
  LEFT JOIN observation_review_current rt
         ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
  ${keyframeLateral}k ON true
 ORDER BY m.rn`;

    return { sql, bind: bind.values };
}

/**
 * Build the status-counts statement and its bind parameters.
 *
 * **The non-status filters only** (R10), no sort and no `row_number`. That mirrors
 * `data.js` `counts()`, which is deliberately not conditioned on either status
 * dimension because the rail reads a count by value alone -- so a borrowed count
 * may exceed the result total, exactly as it already could in Delete Mode.
 *
 * `IS NULL` rather than a `coalesce` is the point: it is what the outer join
 * already knows.
 *
 * @param {Object} request
 * @param {Object} request.filters - The rail dimensions. Status ones are ignored.
 * @returns {{sql: string, bind: Array}} The statement and its parameters.
 * @throws {MosaicRequestError} If any filter is unserviceable.
 */
function buildCountsQuery({ filters = {} }) {
    const bind = binder();
    const where = predicates(filters, bind, { status: false });

    const sql = `
SELECT count(*)::int                                          AS total,
       count(*) FILTER (WHERE rc.decision IS NULL)::int       AS unreviewed,
       count(*) FILTER (WHERE rc.decision = 'reviewed')::int  AS reviewed,
       count(*) FILTER (WHERE rc.decision = 'flagged')::int   AS flagged,
       count(*) FILTER (WHERE rt.decision IS NULL)::int       AS undecided,
       count(*) FILTER (WHERE rt.decision = 'promoted')::int  AS promoted,
       count(*) FILTER (WHERE rt.decision = 'excluded')::int  AS excluded
  FROM observations o
  LEFT JOIN sessions s ON s.session_id = o.session_id
  LEFT JOIN projects p ON p.project_id = o.project_id
  LEFT JOIN observation_review_current rc
         ON rc.observation_id = o.observation_id AND rc.purpose = 'scientific'
  LEFT JOIN observation_review_current rt
         ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
 ${where.length ? `WHERE ${where.join('\n   AND ')}` : ''}`;

    return { sql, bind: bind.values };
}

/**
 * A `pageSize` that can be served.
 *
 * @param {*} value - The request's `pageSize`.
 * @returns {number} The page size.
 * @throws {MosaicRequestError} If it is not a positive integer.
 */
function readPageSize(value) {
    const pageSize = value == null ? 45 : Number(value);

    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new MosaicRequestError('pageSize must be a positive integer');
    }

    return pageSize;
}

/**
 * A set of pages, in one request, for one question.
 *
 * `POST /api/v2/mosaic/observations/pages`. Every page asked for comes back, in
 * ascending page order, so the caller never has to work out which arrived; a page
 * past the end is `rows: []` rather than an error, because the scheduler asks for
 * the tail speculatively before it knows the count.
 *
 * @async
 * @param {Object} request - #99's request body.
 * @returns {Promise<Object>} #99's response envelope.
 * @throws {MosaicRequestError} If the request cannot be served.
 */
async function queryPages(request = {}) {
    const pageSize = readPageSize(request.pageSize);
    const pages = requestedPages(request.pages, pageSize);
    const includeTotal = Boolean(request.includeTotal);

    const { sql, bind } = buildPageSetQuery({ ...request, pageSize, pages, includeTotal });

    const result = await db.sequelize.query(sql, {
        bind,
        type: db.Sequelize.QueryTypes.SELECT,
    });

    // `tally` guarantees at least one row. A row with no `rn` is that anchor and
    // carries the total only -- it is not an observation.
    const total = result.length ? result[0].total : 0;
    const byPage = new Map(pages.map((page) => [page, []]));

    for (const row of result) {
        if (row.rn == null) {
            continue;
        }

        const { total: ignoredTotal, rn, ...served } = row;

        byPage.get(Math.ceil(Number(rn) / pageSize)).push(served);
    }

    return {
        pageSize,
        ...(includeTotal
            ? { total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
            : {}),
        pages: pages.map((page) => ({ page, rows: byPage.get(page), rowCount: byPage.get(page).length })),
        // A3: always 0 in this phase. The date dimension is rejected rather than
        // served, so nothing is silently omitted for want of a date.
        excludedForNoDate: 0,
        // Diagnostic. Nothing depends on it.
        servedAt: new Date().toISOString(),
    };
}

/**
 * Status counts for the current non-status filters.
 *
 * `POST /api/v2/mosaic/observations/counts`. Its `total` is over a **different and
 * larger set** than the page query's (R11) -- the page query's is status-filtered
 * and this is not -- and the two are never substituted for one another.
 *
 * @async
 * @param {Object} request - `{ filters }`.
 * @returns {Promise<Object>} The six status counts and a total.
 * @throws {MosaicRequestError} If a filter cannot be served.
 */
async function counts(request = {}) {
    const { sql, bind } = buildCountsQuery(request);

    const [row] = await db.sequelize.query(sql, {
        bind,
        type: db.Sequelize.QueryTypes.SELECT,
    });

    return row;
}

module.exports = {
    MAX_PAGES,
    MAX_ROWS,
    MosaicRequestError,
    SORT_FIELDS,
    STATUS_DIMENSIONS,
    buildCountsQuery,
    buildPageSetQuery,
    counts,
    queryPages,
};
