/**
 * What a training run reports when it finishes, read into the shapes MARP stores.
 *
 * **One copy, because two would drift.** The same reason `db/epoch-metrics.js` exists
 * for the per-epoch stream: the ingest reads a report as it arrives and anything that
 * later re-reads a stored one has to agree with it exactly. A mapping kept in two places
 * disagrees the first time a field is added, and the disagreement is silent.
 *
 * **This is the end of a run, not an epoch.** The per-epoch stream is scalars arriving
 * one event at a time while the run is going, and `epochs` is already fed from it. What
 * arrives here is a single self-describing JSON artifact published at `on_train_end`,
 * after the final validation: the class vocabulary once, the confusion matrix, and a
 * metrics block per family. It is deliberately not an event — a matrix is not a metric
 * scalar, and a hundred-class model would bloat the event stream for no gain.
 *
 * **There is no backfill and there never will be.** A job workspace is removed once MARP
 * has the result (#65), so a run directory does not survive its attempt. Anything not
 * published inside the attempt is gone permanently, and every training run completed
 * before this landed has none of it. Absence here is the normal case, not a fault.
 *
 * @fileoverview Reading a training run's end-of-run report.
 * @module db/final-metrics
 */

'use strict';

/**
 * The report version this module understands.
 *
 * A report declaring a higher one is read for what is recognised rather than refused:
 * a worker that has learned to send more must not break an older coordinator, and the
 * fields below are additive. A report declaring a *lower* one has never existed.
 *
 * @constant
 * @type {number}
 */
const FINAL_METRICS_SCHEMA = 1;

/**
 * The role a worker files the report under when it hands it over.
 *
 * The plots travel beside it under their own filename stems. **There is no allow-list of
 * stems and there must not be one** -- a plot type a later Ultralytics adds should arrive
 * and be served under its own name rather than be dropped for being unrecognised, which
 * is the one thing a closed set cannot do.
 *
 * @constant
 * @type {string}
 */
const FINAL_METRICS_ROLE = 'final_metrics';

/**
 * The role the per-threshold curves travel under.
 *
 * **A separate artifact from the report, on the worker's advice and for a good reason.**
 * The curves are `4 x classes x 1000` floats -- roughly 1 to 1.5 MB of JSON for twenty
 * species -- and a consumer that only wants the headline numbers should not have to
 * parse a megabyte in order to skip it.
 *
 * @constant
 * @type {string}
 */
const METRICS_CURVES_ROLE = 'metrics_curves';

/**
 * The three curves `metrics_curves` can hold, by the column each fills.
 *
 * **All three share one x axis**, the 1,000 confidence points Ultralytics evaluates at,
 * so one row holds a class's precision, recall and F1 at a single threshold rather than
 * three rows holding one each. That is a third of the rows for the same measurements.
 *
 * **Ultralytics' fourth curve is deliberately not stored.** Its PR curve is precision
 * interpolated onto a fixed *recall* grid, so its x axis is recall and not confidence --
 * and `metrics_curves.confidence_threshold` is NOT NULL and means confidence. Writing a
 * recall value into it would make every row of that table unreadable without knowing
 * which curve it came from, which is precisely the kind of column that means two things
 * this project keeps having to undo. Nothing is lost: precision and recall are stored at
 * each threshold, so a PR curve is drawn by plotting the two stored measurements against
 * each other, and the trainer's own rendering is kept as an image besides.
 *
 * @constant
 * @type {Object<string, string>}
 */
const CURVE_COLUMNS = { precision: 'precision', recall: 'recall', f1_score: 'f1' };

/**
 * How the trainer's own confusion matrix is indexed.
 *
 * Ultralytics' `metrics.py:400` is `self.matrix[p][t] += 1`, so its **row is the
 * predicted class and its column is the true one** -- the transpose of how a person
 * reads a confusion matrix, and of how MARP serves one. The value is carried in the
 * report rather than assumed, so a worker that ever changes it says so and nothing
 * already stored becomes a lie.
 *
 * @constant
 * @type {Object<string, string>}
 */
const ORIENTATIONS = {
    ROWS_PREDICTED: 'rows_predicted_cols_true',
    ROWS_TRUE: 'rows_true_cols_predicted',
};

/**
 * What MARP serves, whatever the trainer sent.
 *
 * @constant
 * @type {string}
 */
const SERVED_ORIENTATION = ORIENTATIONS.ROWS_TRUE;

/**
 * The metric families a row's numbers can be in.
 *
 * **`seg`, not `mask`.** The metric *key* suffix is `(M)`, which is where the obvious
 * guess comes from, but the library's own attribute is `SegmentMetrics.seg` and its
 * vocabulary is what a reader of either side will look for. Settled with the worker
 * session before anything was built, because a string the two halves disagree about is
 * the kind of mismatch that surfaces as a silent bug six weeks later.
 *
 * **`classify` does not fit the row shape below and nothing builds it yet.**
 * `ClassifyMetrics` has no `.box`, no per-class array, and no precision, recall or AP at
 * all -- its whole vocabulary is `metrics/accuracy_top1` and `metrics/accuracy_top5`. So
 * a classification run writes **one** aggregate row with the five metric columns null
 * and its top-1 and top-5 in `details`, plus its confusion matrix, which needs nothing
 * new (it is `nc x nc` with no background row). What must not happen is a nullable
 * detection row standing in for it: `metric_family` exists so a reader can tell that
 * those columns do not apply here, rather than reading a null mAP as a detection run
 * that failed to measure one.
 *
 * @constant
 * @type {Object<string, string>}
 */
const METRIC_FAMILIES = { BOX: 'box', SEG: 'seg', CLASSIFY: 'classify' };

/**
 * Whether a family is one MARP recognises.
 *
 * **Recognised, not permitted.** An unknown family is reported and stored, never
 * refused: Ultralytics has `pose` and `obb` beyond the three here, and an allow-list
 * would reject a whole run's metrics the first time somebody trained one -- the same
 * closed-set mistake as an allow-list of plot stems, which this work already rejected
 * once.
 *
 * What it buys is the opposite of refusal: a typo like `mask` for `seg` otherwise lands
 * silently and produces a table nobody is looking for, with no error to point at. Named
 * in the ingest's answer and in the log, it is visible the first time it happens while a
 * genuinely new family still arrives intact.
 *
 * @param {string} family - The family as reported.
 * @returns {boolean} True when MARP has seen this one before.
 */
function isKnownFamily(family) {
    return Object.values(METRIC_FAMILIES).includes(family);
}

/**
 * The per-class and overall metric fields, by the column that holds each.
 *
 * `precision`, `recall` and `f1_score` are shared by detection and segmentation, which
 * is why one table serves both and `metric_family` says which vocabulary a row is in
 * rather than the column names doing it.
 *
 * The per-class names differ from the overall ones because Ultralytics' own do: a class
 * has an AP, a run has a mAP, and flattening that distinction here would lose it.
 *
 * **There is no overall F1 and the column stays null.** `mean_results()` returns four
 * values -- `[mp, mr, map50, map]` -- and no F1 among them. The tempting fill is
 * `2*mp*mr/(mp+mr)`, and it is wrong: a mean of ratios is not the ratio of means, so
 * that is a third quantity Ultralytics never computes, sitting in a column whose other
 * rows hold a real measurement. Left null, which is the honest answer.
 *
 * **`fitness` is `map5095`, exactly, and the two columns will always agree.** The
 * weights are `[0.0, 0.0, 0.0, 1.0]` over `[P, R, mAP50, mAP50-95]` in 8.4.145, so
 * fitness is mAP50-95 and nothing else. Both are kept rather than one dropped, because
 * fitness is a different *concept* -- the number checkpoints are ranked by -- and those
 * weights are Ultralytics' to change; the day they do, a history with only one of them
 * could not be read. Anyone wondering why two columns never differ is answered here.
 *
 * @constant
 * @type {Object<string, string>}
 */
const OVERALL_FIELDS = {
    precision: 'precision',
    recall: 'recall',
    map50: 'map50',
    map5095: 'map5095',
    f1_score: 'f1',
    fitness: 'fitness',
    /* **Classification's headline, and the only task that reports them.** They are
       accuracies -- fractions in [0, 1] -- not counts, so they share nothing with
       `support` and `image_count` but the table. Null on every box and seg row, where
       they do not apply rather than being missing, which is what `metric_family` is for.
       Nothing emits them yet: no classification model has been trained. */
    accuracy_top1: 'accuracy_top1',
    accuracy_top5: 'accuracy_top5',
};

/**
 * The per-class fields.
 *
 * **Every class is reported at one shared confidence threshold**, not at its own
 * optimum: Ultralytics picks the index that maximises the F1 curve *averaged across
 * classes* and slices every class's precision, recall and F1 at that same index. So a
 * class whose own best threshold sits elsewhere is reported off its peak, and comparing
 * two classes here compares them at one operating point rather than at their best. That
 * is a property of the measurement rather than of this storage, and it is the thing a
 * reader needs to know -- not, as first assumed here, any mismatch in how F1 is derived.
 * `f1` is exactly `2pr/(p+r)` of the same `p` and `r` in the row, because all three come
 * from that one index.
 *
 * @constant
 * @type {Object<string, string>}
 */
const PER_CLASS_FIELDS = {
    precision: 'precision',
    recall: 'recall',
    map50: 'ap50',
    map5095: 'ap5095',
    f1_score: 'f1',
};

/**
 * The two counts that say how much a per-class row's metrics rest on.
 *
 * A precision of 1.0 over three instances and over three thousand are not the same
 * claim. On a species list whose rare classes are the point, that is the difference
 * between a useful number and a misleading one.
 *
 * **They arrive already attached to their class, and must never be joined here.**
 * Ultralytics indexes `nt_per_class` by *class id* while the per-class metrics beside it
 * are indexed by *evaluated position* -- its own validator reads both in a single loop,
 * and they agree only while every class was evaluated. Zipping a raw array against the
 * metrics would silently misattribute one species' instance count to another exactly
 * when the evaluated set is smaller than the vocabulary, which is the rare-species case,
 * and it would not throw. Anyone tempted to "simplify" this into a top-level array
 * should read that sentence again.
 *
 * @constant
 * @type {Object<string, string>}
 */
const COUNT_FIELDS = { support: 'support', image_count: 'images' };

/**
 * A number the trainer measured, or null because it did not.
 *
 * **`Number(null)` is 0, not NaN**, which is the trap `db/epoch-metrics.js` had to learn
 * the same way: a metric sent as null and converted blind is recorded as a measurement
 * of zero, and a zero on a quality metric reads as a model that detects nothing. Absent,
 * null and empty are ruled out *before* the conversion, so they cannot be mistaken for
 * it. A genuine 0.0 is a measurement and survives.
 *
 * Anything non-finite becomes null rather than being stored: Ultralytics reports `nan`
 * for a class with no detections, which is not a measurement of zero, and `NaN` does not
 * survive the driver anyway.
 *
 * Duplicated from `epoch-metrics` rather than shared, deliberately: three lines, and
 * that module's version is bound to its own column map. A seam between them would be
 * larger than the thing it saves.
 *
 * @param {*} raw - The value as reported.
 * @returns {?number} The measurement, or null.
 */
function measured(raw) {
    if (raw === null || raw === undefined || raw === '') return null;

    const value = Number(raw);

    return Number.isFinite(value) ? value : null;
}

/**
 * Read one block of metrics -- overall or per class -- into columns.
 *
 * @param {Object} from - The reported object.
 * @param {Object<string, string>} fields - Column to reported-name map.
 * @returns {Object<string, ?number>} Keyed by column, every column present.
 */
function readFields(from, fields) {
    const source = from && typeof from === 'object' ? from : {};

    return Object.fromEntries(
        Object.entries(fields).map(([column, name]) => [column, measured(source[name])])
    );
}

/**
 * Whether a value is a non-empty string.
 *
 * @param {*} value - Candidate.
 * @returns {boolean} True when it is a usable name.
 */
function named(value) {
    return typeof value === 'string' && value.trim() !== '';
}

/**
 * Read a run's end-of-run report into the rows MARP stores.
 *
 * **Nothing is invented and nothing is padded.** A class the validator did not evaluate
 * is absent from the report -- `ap_class_index` holds only classes that appeared in the
 * validation set -- and it stays absent here. It does not become a row of zeros, which
 * would be a lie, and it does not become a row of nulls, which would claim MARP looked
 * and found nothing. On a species list where the rare classes are the whole point, that
 * distinction is the difference between a useful record and a misleading one.
 *
 * A report that carries no confusion matrix yields no confusion matrix. One is never
 * assembled from the per-class numbers: a matrix derived from precision and recall is
 * arithmetic dressed as a measurement, and the off-diagonal -- the only part anybody
 * looks at -- is exactly what a derivation cannot know.
 *
 * @param {Object} report - The parsed `final_metrics` artifact.
 * @returns {?Object} `{schema, task, split, rows, confusion}`, or null when the report
 *   carries nothing usable. The class lists live on `confusion` and on the curves
 *   artifact, each beside the numbers it indexes.
 */
function finalMetrics(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) return null;

    /* The split names a column that is NOT NULL, so a report that does not say which
       split it evaluated cannot be stored against one. Refused rather than defaulted to
       `val`: `final_eval` happening to use the validation split is a fact about today's
       Ultralytics, and writing it as though the worker had said it would make a guess
       indistinguishable from a report. */
    const split = named(report.split) ? report.split.trim() : null;

    /* **There is deliberately no top-level class list.** It was the thing that made two
       different lists look like one: the matrix's axes are the full vocabulary and
       `per_class` covers only what was evaluated. Each now carries the list it is
       indexed by, beside the numbers it labels. */
    /* **There is deliberately no top-level class list.** It was the thing that made two
       different lists look like one: the confusion matrix's axes are the model's full
       vocabulary while `per_class` covers only what the validator evaluated. Each now
       carries the list it is indexed by, beside the numbers it labels. */
    /* **A missing `metrics` block is empty-but-valid, not malformed.** The producer
       omits it only when nothing was scored -- a run whose validation set yielded no
       class it could measure -- and a confusion matrix can still be real beside it. So
       it yields no rows rather than refusing the file, and the caller reports the
       emptiness rather than this swallowing it. The worker separately found that its own
       broad `except` would have produced exactly this shape from a crash; that is fixed
       on its side, which is what makes an empty block trustworthy here. */
    const blocks = Array.isArray(report.metrics) ? report.metrics : [];

    const rows = [];

    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;

        /* Stated by the worker rather than inferred here from Ultralytics' `(B)`/`(M)`
           suffix. Without it a classification row with a null mAP is indistinguishable
           from a detection row that failed to measure one -- the same "a gap that reads
           as a measurement" failure this work has already fixed once, in a new place. */
        const family = named(block.family) ? block.family.trim() : null;

        if (!family) continue;

        /* The all-classes row. `class_name` null is what makes it tellable from a
           per-class row, because `species_id` null already means something else. */
        if (block.overall && typeof block.overall === 'object') {
            rows.push({
                metric_family: family,
                class_name: null,
                ...readFields(block.overall, OVERALL_FIELDS),
            });
        }

        const perClass = Array.isArray(block.per_class) ? block.per_class : [];

        for (const entry of perClass) {
            if (!entry || typeof entry !== 'object') continue;

            /* A per-class row without a class name cannot be told from the aggregate and
               cannot be resolved to a species. Dropped rather than stored anonymously. */
            if (!named(entry.class)) continue;

            rows.push({
                metric_family: family,
                class_name: entry.class.trim(),
                fitness: null,
                ...readFields(entry, PER_CLASS_FIELDS),
                /* Counts, not measurements: a fractional instance count is a transport
                   fault rather than a number to store, so they are rounded to integers
                   or dropped. Absent stays absent -- both are unset until a validation
                   has populated them. */
                ...Object.fromEntries(Object.entries(COUNT_FIELDS).map(([column, name]) => {
                    const value = measured(entry[name]);

                    return [column, value === null ? null : Math.round(value)];
                })),
            });
        }
    }

    return {
        schema: Number.isFinite(Number(report.schema)) ? Number(report.schema) : null,
        task: named(report.task) ? report.task.trim() : null,
        split,
        rows,
        confusion: confusionFromReport(report.confusion_matrix),
    };
}

/**
 * Read the confusion matrix out of a report, verbatim and in the trainer's orientation.
 *
 * **Stored as sent, not rotated on the way in.** The orientation travels with it, so a
 * worker that ever changes orientation says so and everything already stored stays
 * interpretable. Rotating here would bake today's convention into the record and make
 * every stored matrix silently wrong the day it changed.
 *
 * **The matrix carries its own class list, and that is load-bearing rather than
 * convenience.** Its axes are the model's FULL vocabulary, while `per_class` and the
 * curves cover only the classes the validator actually evaluated -- `ConfusionMatrix.names`
 * against `ap_class_index`. Those two lists differ exactly when a species had no
 * validation instances, which is the rare-species case this work exists to serve. A
 * single shared list would have labelled these axes with the evaluated one, shifting
 * every label from the missing species onward and attributing confusions to the wrong
 * animals -- no exception, no null, just wrong. So the labels live here, beside the
 * numbers they label.
 *
 * @param {*} raw - `report.confusion_matrix`.
 * @returns {?Object} `{orientation, classes, background_index, matrix}`, or null.
 */
function confusionFromReport(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const matrix = Array.isArray(raw.matrix) ? raw.matrix : null;

    if (!matrix || matrix.length === 0) return null;

    const orientation = named(raw.orientation) ? raw.orientation.trim() : null;

    /* An unlabelled matrix is refused rather than assumed into one orientation. Guessing
       produces a chart that looks entirely plausible and asserts the opposite of what
       happened, which is worse than no chart -- and the panel's empty state is already
       correct for having none. */
    if (!Object.values(ORIENTATIONS).includes(orientation)) return null;

    const classes = Array.isArray(raw.classes) ? raw.classes.filter(named) : [];

    if (classes.length === 0) return null;

    /* Square, and every row the same length. A ragged matrix is a transport fault, and
       serving it would misalign every label after the short row. */
    const size = matrix.length;

    for (const row of matrix) {
        if (!Array.isArray(row) || row.length !== size) return null;
    }

    const hasBackground = raw.background_index !== undefined && raw.background_index !== null;

    /* **`background_index` is checkable rather than taken on trust**: the background row
       is always the one past the last real class, so it is exactly `classes.length`.
       Anything else means the two halves of the report disagree about what the axes are,
       and a label list that does not line up with the numbers is how a cell gets read as
       the wrong species. Absent for classify and semantic, which have no background
       class -- absent, not null, the same absence rule as everywhere else. */
    if (hasBackground) {
        if (!Number.isInteger(raw.background_index)) return null;
        if (raw.background_index !== classes.length) return null;
        if (size !== classes.length + 1) return null;
    } else if (size !== classes.length) {
        return null;
    }

    return {
        orientation,
        classes,
        background_index: hasBackground ? raw.background_index : null,
        matrix: matrix.map((row) => row.map((cell) => measured(cell))),
    };
}

/**
 * Turn a stored confusion matrix into the one MARP serves.
 *
 * **Rows are true classes and columns are predicted ones**, which is how a person reads
 * a confusion matrix and the opposite of how Ultralytics indexes one. The transpose
 * happens here, once, at the serving boundary and nowhere else -- a second copy of it
 * somewhere would eventually disagree, and a transposed confusion matrix is the kind of
 * wrong that looks completely plausible while asserting the reverse of what happened.
 *
 * The background row is kept and labelled rather than trimmed: from the model's point of
 * view it is a real outcome, the row sums do not mean anything without it, and
 * `matrix[nc][nc]` being permanently zero is a true zero rather than a gap.
 *
 * @param {?Object} stored - `{orientation, classes, background_index, matrix}` as stored.
 *   The labels come from the row itself, never from a list passed in beside it: the
 *   axes are the full vocabulary and anything else shifts them.
 * @returns {?Object} `{labels, rows, orientation, background_index}`, or null.
 */
function confusionForReading(stored) {
    const classes = stored && Array.isArray(stored.classes) ? stored.classes : [];

    if (!stored || !Array.isArray(stored.matrix) || stored.matrix.length === 0) return null;

    const { matrix } = stored;
    const size = matrix.length;

    const rows = stored.orientation === SERVED_ORIENTATION
        ? matrix.map((row) => row.slice())
        : matrix[0].map((_, trueIndex) => matrix.map((row) => row[trueIndex]));

    const labels = Array.from({ length: size }, (_, index) => {
        if (index === stored.background_index) return 'background';

        return classes[index] === undefined ? null : classes[index];
    });

    return {
        labels,
        rows,
        orientation: SERVED_ORIENTATION,
        background_index: stored.background_index === undefined ? null : stored.background_index,
    };
}

/**
 * Read a curves artifact into per-class, per-threshold points.
 *
 * **Every array is checked against the shared x axis before anything is stored.** A
 * curve one point shorter than the confidence axis would silently shift every reading
 * after the gap, which on a threshold curve means a precision attributed to the wrong
 * confidence -- a chart that is subtly and confidently wrong rather than visibly broken.
 * A mismatch refuses the whole family rather than storing part of it.
 *
 * `metrics_curves.support` is left null throughout. It is a per-class count, not a
 * per-threshold one, so repeating it a thousand times down that column would state a
 * per-threshold fact nobody measured. It lives on the class's `metrics_summary` row.
 *
 * **The `classes` here are the evaluated classes, not the vocabulary**, and that is the
 * producer's indexing rather than a convention imposed here: the three curves are filled
 * in `unique_classes` order, the same order as the per-class metrics. Everything below
 * matches by name anyway, so the two cannot drift apart silently.
 *
 * **A flat row of zeros is a measurement and is stored.** A class with labels but no
 * predictions leaves its precision and recall at zero across every threshold, which is
 * correct -- nothing was predicted, so recall really is zero everywhere. The array is
 * full length, so it does not trip the length check below, and it must not: refusing it
 * would discard the record of a class the model completely missed, which is one of the
 * more important things a reader can learn.
 *
 * @param {Object} report - The parsed `metrics_curves` artifact.
 * @returns {?Object} `{schema, split, family, classes, confidence, byClass}` where
 *   `byClass` is one entry per class, each with its points in axis order. Null when the
 *   artifact carries nothing usable.
 */
function metricCurves(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) return null;

    const split = named(report.split) ? report.split.trim() : null;
    const family = named(report.family) ? report.family.trim() : null;

    if (!split || !family) return null;

    const confidence = Array.isArray(report.confidence) ? report.confidence.map(measured) : [];

    /* **This artifact's own list, and it is the EVALUATED classes.** Not the vocabulary:
       the curve arrays are filled in `unique_classes` order, the same order as the
       per-class metrics, so a species with nothing in the validation split is absent
       here and present on the confusion matrix's axes. Each list lives beside the
       numbers it indexes, which is the whole reason there is no shared one. */
    const classes = Array.isArray(report.classes) ? report.classes.filter(named) : [];

    if (confidence.length === 0 || classes.length === 0) return null;

    /* A threshold that is not a number cannot index anything, and the column is NOT
       NULL. Refused as a set rather than skipped point by point, because dropping one
       point silently renumbers nothing but quietly changes the curve's shape. */
    if (confidence.some((point) => point === null)) return null;

    const curves = report.curves && typeof report.curves === 'object' ? report.curves : {};

    const series = {};

    for (const [column, name] of Object.entries(CURVE_COLUMNS)) {
        const rows = Array.isArray(curves[name]) ? curves[name] : null;

        // A curve may be absent entirely; that is a gap, and the column stays null.
        if (rows === null) continue;

        if (rows.length !== classes.length) return null;

        for (const row of rows) {
            if (!Array.isArray(row) || row.length !== confidence.length) return null;
        }

        series[column] = rows;
    }

    if (Object.keys(series).length === 0) return null;

    const byClass = classes.map((className, classIndex) => ({
        class_name: className,
        points: confidence.map((threshold, pointIndex) => ({
            confidence_threshold: threshold,
            ...Object.fromEntries(Object.keys(CURVE_COLUMNS).map((column) => [
                column,
                series[column] ? measured(series[column][classIndex][pointIndex]) : null,
            ])),
        })),
    }));

    return {
        schema: Number.isFinite(Number(report.schema)) ? Number(report.schema) : null,
        split,
        family,
        classes,
        confidence,
        byClass,
    };
}

module.exports = {
    FINAL_METRICS_SCHEMA,
    METRICS_CURVES_ROLE,
    CURVE_COLUMNS,
    metricCurves,
    FINAL_METRICS_ROLE,
    METRIC_FAMILIES,
    isKnownFamily,
    ORIENTATIONS,
    SERVED_ORIENTATION,
    OVERALL_FIELDS,
    PER_CLASS_FIELDS,
    finalMetrics,
    confusionFromReport,
    confusionForReading,
};
