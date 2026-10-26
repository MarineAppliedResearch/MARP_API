/**
 * The end-of-run report reader.
 *
 * **Where these fixtures come from, because it matters.** Two defects on this stream
 * were caused by a fixture agreeing with the code while both disagreed with the traffic,
 * so the provenance of every shape below is stated rather than assumed:
 *
 * - The **per-epoch event shape** in `the event stream as it really is` is copied from
 *   rows in the development database (`gpu_job_events`, job 21779), including the
 *   `child_kind` field that appears in no document anywhere. It is here as a tripwire:
 *   nothing in this module reads it, and if the ingest ever starts caring about the
 *   event shape, this is the real one.
 * - The **`final_metrics` report shape** is NOT from stored traffic, because no training
 *   run has ever produced one -- the feature does not exist on the worker yet. It is
 *   built from what the worker session read out of Ultralytics 8.4.145 itself:
 *   `metrics.py:400` being `self.matrix[p][t] += 1`, the background class sitting at
 *   index `nc`, and `ap_class_index` holding only classes that appeared in validation.
 *   **That is a contract, not an observation, and it is the weakest evidence in this
 *   file.** The first real run is what confirms it.
 *
 * @fileoverview Unit tests for db/final-metrics.
 */

'use strict';

const {
    METRIC_FAMILIES,
    ORIENTATIONS,
    SERVED_ORIENTATION,
    finalMetrics,
    confusionFromReport,
    confusionForReading,
    metricCurves,
} = require('../db/final-metrics');

/**
 * A metric event exactly as the development database holds one.
 *
 * Job 21779, the most recent succeeded training job. Note what is *not* here: no
 * `fitness`, no `duration_seconds`, no `train/*` loss. Those are the worker's unmerged
 * branch, so no stored event has ever contained them.
 */
const REAL_METRIC_EVENT = {
    step: 1,
    phase: 'training',
    metrics: {
        'val/box_loss': 0.75845,
        'val/cls_loss': 0.62161,
        'val/dfl_loss': 1.01172,
        'metrics/mAP50(B)': 0.82506,
        'metrics/recall(B)': 0.88513,
        'metrics/mAP50-95(B)': 0.65858,
        'metrics/precision(B)': 0.76877,
    },
    child_kind: 'metrics',
};

/**
 * A two-class detection report, which therefore has a 3x3 matrix.
 *
 * The numbers are deliberately asymmetric so a transpose cannot pass by accident: a
 * symmetric matrix makes the single most dangerous bug in this file invisible.
 */
function report(overrides = {}) {
    return {
        schema: 1,
        task: 'detect',
        split: 'val',
        classes: ['Lingcod', 'Rockfish'],
        confusion_matrix: {
            orientation: ORIENTATIONS.ROWS_PREDICTED,
            background_index: 2,
            matrix: [
                [10, 3, 5],
                [1, 20, 7],
                [2, 4, 0],
            ],
        },
        metrics: [{
            family: 'box',
            overall: {
                precision: 0.81, recall: 0.74, map50: 0.79,
                map5095: 0.52, f1: 0.77, fitness: 0.55,
            },
            per_class: [
                { class: 'Lingcod', precision: 0.9, recall: 0.8, f1: 0.85, ap50: 0.88, ap5095: 0.61 },
                { class: 'Rockfish', precision: 0.7, recall: 0.6, f1: 0.65, ap50: 0.68, ap5095: 0.41 },
            ],
        }],
        ...overrides,
    };
}

describe('the event stream as it really is', () => {
    it('carries child_kind, which no handoff note mentions', () => {
        // A tripwire, not an assertion about this module. If a future ingest reads the
        // event shape, this is the shape it will actually meet.
        expect(REAL_METRIC_EVENT.child_kind).toBe('metrics');
        expect(REAL_METRIC_EVENT.metrics.fitness).toBeUndefined();
        expect(REAL_METRIC_EVENT.metrics['train/box_loss']).toBeUndefined();
    });
});

describe('reading a final report', () => {
    it('separates the all-classes row from the per-class rows', () => {
        const { rows } = finalMetrics(report());

        const aggregate = rows.filter((row) => row.class_name === null);
        const perClass = rows.filter((row) => row.class_name !== null);

        expect(aggregate).toHaveLength(1);
        expect(aggregate[0].map50).toBe(0.79);
        expect(aggregate[0].fitness).toBe(0.55);

        expect(perClass.map((row) => row.class_name)).toEqual(['Lingcod', 'Rockfish']);
    });

    it('maps a class AP into the mAP column it shares with the aggregate', () => {
        const { rows } = finalMetrics(report());
        const lingcod = rows.find((row) => row.class_name === 'Lingcod');

        // `ap50` per class and `map50` overall are one column; Ultralytics' own naming
        // distinguishes them and the column cannot.
        expect(lingcod.map50).toBe(0.88);
        expect(lingcod.map5095).toBe(0.61);
    });

    it('carries the two counts that say how much a class\'s metrics rest on', () => {
        const counted = report();
        counted.metrics[0].per_class[0] = {
            class: 'Lingcod', precision: 0.9, recall: 0.8, support: 142, images: 37,
        };

        const lingcod = finalMetrics(counted).rows.find((row) => row.class_name === 'Lingcod');

        expect(lingcod.support).toBe(142);
        expect(lingcod.image_count).toBe(37);

        // The aggregate has neither; the trainer reports them per class only.
        const aggregate = finalMetrics(counted).rows.find((row) => row.class_name === null);

        expect(aggregate.support).toBeUndefined();
    });

    it('nulls a count the trainer did not report, rather than calling it zero', () => {
        // Both are unset until a validation has populated them, and "no instances" and
        // "not counted" are different facts about a species.
        const lingcod = finalMetrics(report()).rows.find((row) => row.class_name === 'Lingcod');

        expect(lingcod.support).toBeNull();
        expect(lingcod.image_count).toBeNull();
    });

    it('writes no row at all for a class the validator never evaluated', () => {
        // `ap_class_index` holds only classes that appeared in the validation set, so an
        // absent class means NEVER EVALUATED, not scored zero. A row of zeros would be a
        // lie and a row of nulls would claim MARP looked.
        const sparse = report();
        sparse.metrics[0].per_class = [sparse.metrics[0].per_class[0]];

        const { rows } = finalMetrics(sparse);

        expect(rows.filter((row) => row.class_name !== null)).toHaveLength(1);
        expect(rows.some((row) => row.class_name === 'Rockfish')).toBe(false);
    });

    it('keeps a genuine zero and nulls an absent measurement', () => {
        const zeroed = report();
        zeroed.metrics[0].per_class[0] = { class: 'Lingcod', precision: 0, recall: null, f1: 'nan' };

        const lingcod = finalMetrics(zeroed).rows.find((row) => row.class_name === 'Lingcod');

        expect(lingcod.precision).toBe(0);       // measured as nothing
        expect(lingcod.recall).toBeNull();       // not measured
        expect(lingcod.f1_score).toBeNull();     // nan is not a measurement of zero
        expect(lingcod.map50).toBeNull();        // absent entirely
    });

    it('refuses a report that does not say which split it evaluated', () => {
        // `metrics_summary.dataset_split` is NOT NULL and defaulting it to `val` would
        // make a guess indistinguishable from something the worker said.
        expect(finalMetrics(report({ split: undefined })).split).toBeNull();
    });

    it('drops a metrics block that does not state its family', () => {
        const unlabelled = report();
        delete unlabelled.metrics[0].family;

        expect(finalMetrics(unlabelled).rows).toHaveLength(0);
    });

    it('keeps box and seg as separate rows for one class', () => {
        const segmentation = report({ task: 'segment' });
        segmentation.metrics.push({
            family: 'seg',
            overall: { precision: 0.6, recall: 0.5, map50: 0.55, map5095: 0.3, f1: 0.54 },
            per_class: [{ class: 'Lingcod', precision: 0.61, recall: 0.51, ap50: 0.56 }],
        });

        const lingcod = finalMetrics(segmentation).rows.filter((row) => row.class_name === 'Lingcod');

        expect(lingcod.map((row) => row.metric_family).sort()).toEqual(['box', 'seg']);
        // Keyed on class alone these would silently replace each other.
        expect(lingcod.find((row) => row.metric_family === 'seg').map50).toBe(0.56);
    });
});

describe('the per-threshold curves', () => {
    const curves = (overrides = {}) => ({
        schema: 1,
        split: 'val',
        family: 'box',
        classes: ['Lingcod', 'Rockfish'],
        confidence: [0.0, 0.5, 1.0],
        curves: {
            precision: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
            recall: [[0.9, 0.8, 0.7], [0.6, 0.5, 0.4]],
            f1: [[0.2, 0.3, 0.4], [0.5, 0.6, 0.7]],
        },
        ...overrides,
    });

    it('puts all three measurements for one threshold in one point', () => {
        // The three curves share one x axis, so a row holds precision, recall and F1 at
        // a single threshold rather than three rows holding one each.
        expect(metricCurves(curves()).byClass[1].points[1]).toEqual({
            confidence_threshold: 0.5, precision: 0.5, recall: 0.5, f1_score: 0.6,
        });
    });

    it('refuses the whole family when one curve is shorter than the axis', () => {
        // A curve one point short silently shifts every later reading onto the wrong
        // confidence -- a chart that is subtly wrong rather than visibly broken.
        const short = curves();
        short.curves.recall = [[0.9, 0.8], [0.6, 0.5]];

        expect(metricCurves(short)).toBeNull();
    });

    it('refuses a curve with the wrong number of classes', () => {
        const wrong = curves();
        wrong.curves.f1 = [[0.2, 0.3, 0.4]];

        expect(metricCurves(wrong)).toBeNull();
    });

    it('leaves an absent curve null without losing the ones that came', () => {
        const partial = curves();
        delete partial.curves.f1;

        const point = metricCurves(partial).byClass[0].points[0];

        expect(point.f1_score).toBeNull();
        expect(point.precision).toBe(0.1);
    });

    it('never invents support, which is not a per-threshold quantity', () => {
        expect('support' in metricCurves(curves()).byClass[0].points[0]).toBe(false);
    });

    it('refuses a threshold that is not a number', () => {
        // `confidence_threshold` is NOT NULL and a non-number cannot index anything.
        expect(metricCurves(curves({ confidence: [0, 'x', 1] }))).toBeNull();
    });

    it('refuses a curves artifact that does not say what it measured', () => {
        expect(metricCurves(curves({ family: undefined }))).toBeNull();
        expect(metricCurves(curves({ split: undefined }))).toBeNull();
    });

    it('keeps a flat row of zeros, which is a class the model missed entirely', () => {
        // A class with labels but no predictions leaves precision and recall at zero
        // across every threshold. That is correct -- nothing was predicted, so recall
        // really is zero everywhere -- and discarding it would throw away the record of
        // a class the model completely missed, which is one of the more important
        // things a reader can learn.
        const missed = curves();
        missed.curves.precision[1] = [0, 0, 0];
        missed.curves.recall[1] = [0, 0, 0];
        missed.curves.f1[1] = [0, 0, 0];

        const series = metricCurves(missed).byClass[1];

        expect(series.points).toHaveLength(3);
        expect(series.points[0].recall).toBe(0);
        expect(series.points[0].recall).not.toBeNull();
    });
});

describe('what the trainer does not report', () => {
    it('leaves the aggregate f1_score null rather than deriving one', () => {
        // `mean_results()` returns [mp, mr, map50, map] and no F1. The tempting fill is
        // 2*mp*mr/(mp+mr), which is a mean of ratios rather than a ratio of means -- a
        // third quantity the trainer never computes, in a column whose other rows hold
        // a real measurement.
        const noF1 = report();
        delete noF1.metrics[0].overall.f1;

        const aggregate = finalMetrics(noF1).rows.find((row) => row.class_name === null);

        expect(aggregate.f1_score).toBeNull();
        expect(aggregate.precision).toBe(0.81);
    });

    it('takes a classification run as one row with no per-class numbers', () => {
        // ClassifyMetrics has no .box, no per-class array, and no precision, recall or
        // AP -- only top-1 and top-5. A nullable detection row standing in for that
        // would be the "a gap reads as a measurement" failure in a new costume, so the
        // family is what tells a reader these columns do not apply.
        const classify = finalMetrics({
            schema: 1,
            task: 'classify',
            split: 'val',
            classes: ['Lingcod', 'Rockfish'],
            metrics: [{ family: METRIC_FAMILIES.CLASSIFY, overall: {} }],
        });

        expect(classify.rows).toHaveLength(1);
        expect(classify.rows[0].class_name).toBeNull();
        expect(classify.rows[0].metric_family).toBe('classify');

        for (const column of ['precision', 'recall', 'map50', 'map5095', 'f1_score']) {
            expect(classify.rows[column]).toBeUndefined();
            expect(classify.rows[0][column]).toBeNull();
        }
    });

    it('names the segmentation family seg, matching the library rather than the suffix', () => {
        // The metric-key suffix is (M); the attribute is SegmentMetrics.seg. Two halves
        // disagreeing on this string is a silent bug six weeks later, so it is pinned.
        expect(METRIC_FAMILIES.SEG).toBe('seg');
    });
});

describe('the confusion matrix, which is the thing most easily got backwards', () => {
    it('stores the trainer\'s array verbatim, unrotated', () => {
        const stored = confusionFromReport(report().confusion_matrix, ['Lingcod', 'Rockfish']);

        expect(stored.orientation).toBe(ORIENTATIONS.ROWS_PREDICTED);
        expect(stored.matrix[0]).toEqual([10, 3, 5]);
        expect(stored.background_index).toBe(2);
    });

    it('transposes to rows-are-true when serving', () => {
        const stored = confusionFromReport(report().confusion_matrix, ['Lingcod', 'Rockfish']);
        const served = confusionForReading(stored, ['Lingcod', 'Rockfish']);

        expect(served.orientation).toBe(SERVED_ORIENTATION);

        // Trainer's matrix[p][t]: predicted Lingcod / true Rockfish is matrix[0][1] = 3.
        // Served rows[true][predicted]: true Rockfish / predicted Lingcod is rows[1][0].
        expect(served.rows[1][0]).toBe(3);
        expect(served.rows[0][1]).toBe(1);

        // The whole first served row is the trainer's first column.
        expect(served.rows[0]).toEqual([10, 1, 2]);
    });

    it('does not transpose a matrix already sent rows-are-true', () => {
        const already = confusionFromReport({
            orientation: ORIENTATIONS.ROWS_TRUE,
            background_index: 2,
            matrix: [[10, 3, 5], [1, 20, 7], [2, 4, 0]],
        }, ['Lingcod', 'Rockfish']);

        expect(confusionForReading(already, ['Lingcod', 'Rockfish']).rows[0]).toEqual([10, 3, 5]);
    });

    it('labels the background row rather than trimming it', () => {
        const stored = confusionFromReport(report().confusion_matrix, ['Lingcod', 'Rockfish']);

        expect(confusionForReading(stored, ['Lingcod', 'Rockfish']).labels)
            .toEqual(['Lingcod', 'Rockfish', 'background']);
    });

    it('refuses a matrix that does not say which way round it is', () => {
        // Guessing produces a chart that looks plausible and asserts the opposite of
        // what happened. No matrix is better than a reversed one.
        expect(confusionFromReport({
            background_index: 2,
            matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 0]],
        }, ['Lingcod', 'Rockfish'])).toBeNull();
    });

    it('refuses a ragged matrix', () => {
        expect(confusionFromReport({
            orientation: ORIENTATIONS.ROWS_PREDICTED,
            background_index: 2,
            matrix: [[1, 0, 0], [0, 1], [0, 0, 0]],
        }, ['Lingcod', 'Rockfish'])).toBeNull();
    });

    it('refuses a matrix whose size does not match the vocabulary', () => {
        // A label list that does not line up with the numbers is how a cell gets read
        // as the wrong class.
        expect(confusionFromReport(report().confusion_matrix, ['Lingcod'])).toBeNull();
    });

    it('accepts a classification matrix, which has no background row', () => {
        const stored = confusionFromReport({
            orientation: ORIENTATIONS.ROWS_PREDICTED,
            matrix: [[7, 2], [1, 9]],
        }, ['Lingcod', 'Rockfish']);

        expect(stored.background_index).toBeNull();
        expect(confusionForReading(stored, ['Lingcod', 'Rockfish']).labels)
            .toEqual(['Lingcod', 'Rockfish']);
    });

    it('yields nothing when the report carries no matrix', () => {
        // The panel's empty state is correct and a matrix is never derived from the
        // per-class numbers -- that would be arithmetic dressed as a measurement.
        expect(finalMetrics(report({ confusion_matrix: undefined })).confusion).toBeNull();
    });
});
