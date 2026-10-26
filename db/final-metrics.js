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
 * The per-class and overall metric fields, by the column that holds each.
 *
 * `precision`, `recall`, `f1_score` and `fitness` are **task-neutral** -- detection,
 * segmentation and classification all report them -- which is why one table serves all
 * three and `metric_family` says which vocabulary a row is in rather than the column
 * names doing it. Only `map50` and `map5095` are detection's and segmentation's alone.
 *
 * The per-class names differ from the overall ones because Ultralytics' own do: a class
 * has an AP, a run has a mAP, and flattening that distinction here would lose it.
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
};

/**
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
 * @returns {?Object} `{schema, task, split, classes, rows, confusion}`, or null when the
 *   report carries nothing usable.
 */
function finalMetrics(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) return null;

    /* The split names a column that is NOT NULL, so a report that does not say which
       split it evaluated cannot be stored against one. Refused rather than defaulted to
       `val`: `final_eval` happening to use the validation split is a fact about today's
       Ultralytics, and writing it as though the worker had said it would make a guess
       indistinguishable from a report. */
    const split = named(report.split) ? report.split.trim() : null;

    const classes = Array.isArray(report.classes) ? report.classes.filter(named) : [];

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
            });
        }
    }

    return {
        schema: Number.isFinite(Number(report.schema)) ? Number(report.schema) : null,
        task: named(report.task) ? report.task.trim() : null,
        split,
        classes,
        rows,
        confusion: confusionFromReport(report.confusion_matrix, classes),
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
 * @param {*} raw - `report.confusion_matrix`.
 * @param {string[]} classes - The run's class vocabulary.
 * @returns {?Object} `{orientation, background_index, matrix}`, or null.
 */
function confusionFromReport(raw, classes) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const matrix = Array.isArray(raw.matrix) ? raw.matrix : null;

    if (!matrix || matrix.length === 0) return null;

    const orientation = named(raw.orientation) ? raw.orientation.trim() : null;

    /* An unlabelled matrix is refused rather than assumed into one orientation. Guessing
       produces a chart that looks entirely plausible and asserts the opposite of what
       happened, which is worse than no chart -- and the panel's empty state is already
       correct for having none. */
    if (!Object.values(ORIENTATIONS).includes(orientation)) return null;

    /* Square, and every row the same length. A ragged matrix is a transport fault, and
       serving it would misalign every label after the short row. */
    const size = matrix.length;

    for (const row of matrix) {
        if (!Array.isArray(row) || row.length !== size) return null;
    }

    const background = Number(raw.background_index);

    /* Background is index `nc` on both axes for detect, segment and obb, and absent for
       classify and semantic, which have no background class at all. Accepted only where
       it is the last index, which is the only place Ultralytics puts it. */
    const backgroundIndex = Number.isInteger(background) && background === size - 1
        ? background
        : null;

    /* The vocabulary has to account for every index. With a background row the matrix is
       one wider than the class list; without one they match. Anything else means the two
       halves of the report disagree, and a label list that does not line up with the
       numbers is how a cell gets read as the wrong class. */
    const expected = backgroundIndex === null ? size : size - 1;

    if (classes.length !== expected) return null;

    return {
        orientation,
        background_index: backgroundIndex,
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
 * @param {?Object} stored - `{orientation, background_index, matrix}` as stored.
 * @param {string[]} classes - The run's class vocabulary, in index order.
 * @returns {?Object} `{labels, rows, orientation, background_index}`, or null.
 */
function confusionForReading(stored, classes) {
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

module.exports = {
    FINAL_METRICS_SCHEMA,
    FINAL_METRICS_ROLE,
    ORIENTATIONS,
    SERVED_ORIENTATION,
    OVERALL_FIELDS,
    PER_CLASS_FIELDS,
    finalMetrics,
    confusionFromReport,
    confusionForReading,
};
