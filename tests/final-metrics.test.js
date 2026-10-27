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
 * **Job 21786, attempt 19223, the newest training event on 5432 (2026-10-27).** Re-read
 * from traffic rather than carried forward: an earlier version of this fixture came from
 * job 21779 and its comment said `fitness`, `duration_seconds` and the `train/*` losses
 * had never appeared in a stored event. That was true when written and is now false --
 * worker 0.1.6 landed and three of those are here. `fitness` still is not, in any event
 * MARP has ever stored.
 *
 * `start_offset_s` and `end_offset_s` arrived later still: jobs 21782 and 21785 carry the
 * training losses and duration without them, 21786 carries all five. That is a worker
 * version boundary rather than a gap, and `epochs` reflects it exactly -- run 205 has ten
 * rows with durations and no offsets, run 206 has one row with both.
 *
 * `child_kind` is in every one of them and in no document anywhere, which is why this is
 * copied rather than typed.
 */
const REAL_METRIC_EVENT = {
    step: 1,
    phase: 'training',
    metrics: {
        end_offset_s: 140.969,
        'val/box_loss': 1.6818,
        'val/cls_loss': 127.14748,
        'val/dfl_loss': 0.85276,
        start_offset_s: 0,
        'train/box_loss': 3.15601,
        'train/cls_loss': 26.33998,
        'train/dfl_loss': 1.41446,
        duration_seconds: 140.969,
        'metrics/mAP50(B)': 0.11645,
        'metrics/recall(B)': 0.40423,
        'metrics/mAP50-95(B)': 0.05488,
        'metrics/precision(B)': 0.1932,
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
        confusion_matrix: {
            orientation: ORIENTATIONS.ROWS_PREDICTED,
            classes: ['Lingcod', 'Rockfish'],
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
    });

    it('carries the training losses and duration, which it did not a day ago', () => {
        // This assertion was the exact opposite on 2026-10-26, and was correct then.
        // Worker 0.1.6 landed in between. Kept pointing at the live shape rather than
        // deleted, because a fixture agreeing with yesterday's traffic is the failure
        // this whole file exists to avoid.
        expect(REAL_METRIC_EVENT.metrics['train/box_loss']).toBeCloseTo(3.15601);
        expect(REAL_METRIC_EVENT.metrics.duration_seconds).toBeCloseTo(140.969);
        expect(REAL_METRIC_EVENT.metrics.start_offset_s).toBe(0);
    });

    it('still carries no fitness, in any event MARP has ever stored', () => {
        // Checked across every metric event on every training attempt on 5432, not just
        // this one. `OVERALL_FIELDS` maps `fitness` for the end-of-run report, which is
        // a different payload -- so this is a fact about the epoch stream, not a gap.
        expect(REAL_METRIC_EVENT.metrics.fitness).toBeUndefined();
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
            metrics: [{
                family: METRIC_FAMILIES.CLASSIFY,
                overall: { accuracy_top1: 0.873, accuracy_top5: 0.961 },
            }],
        });

        expect(classify.rows).toHaveLength(1);
        expect(classify.rows[0].class_name).toBeNull();
        expect(classify.rows[0].metric_family).toBe('classify');

        // Detection's columns are null, and `metric_family` is what says that means
        // "does not apply" rather than "was not measured".
        for (const column of ['precision', 'recall', 'map50', 'map5095', 'f1_score']) {
            expect(classify.rows[0][column]).toBeNull();
        }
    });

    it('takes a missing per_class as absence, on any family', () => {
        // The producer omits `per_class` rather than sending `[]`, because no rows means
        // nothing was scored per class. Classification never has one at all:
        // ClassifyMetrics has no per-class quantity of any kind, and its confusion
        // matrix is the only per-class thing it produces.
        const noPerClass = report();
        delete noPerClass.metrics[0].per_class;

        const parsed = finalMetrics(noPerClass);

        // The aggregate still lands; only the per-class rows are absent.
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].class_name).toBeNull();
        expect(parsed.rows[0].map50).toBe(0.79);
    });

    it('keeps a classification fitness, which is not a duplicate of anything', () => {
        // On a detection run `fitness` equals `map5095` under Ultralytics' [0,0,0,1]
        // weights. That identity is detection's alone -- classification has no mAP, so
        // its fitness is a measurement of its own and must not be read as a copy.
        const classify = finalMetrics({
            schema: 1,
            task: 'classify',
            split: 'val',
            metrics: [{
                family: METRIC_FAMILIES.CLASSIFY,
                overall: { accuracy_top1: 0.82, accuracy_top5: 0.97, fitness: 0.895 },
            }],
        });

        expect(classify.rows[0].fitness).toBeCloseTo(0.895);
        expect(classify.rows[0].map5095).toBeNull();
    });

    it('stores classification accuracy as the fraction it is', () => {
        // Accuracies, not counts. An integer column would round 0.873 to 1 and report
        // a perfect classifier, which is why these are double precision and `support`
        // and `image_count` beside them are not.
        const classify = finalMetrics({
            schema: 1,
            task: 'classify',
            split: 'val',
            metrics: [{
                family: METRIC_FAMILIES.CLASSIFY,
                overall: { accuracy_top1: 0.873, accuracy_top5: 0.961 },
            }],
        });

        expect(classify.rows[0].accuracy_top1).toBeCloseTo(0.873);
        expect(classify.rows[0].accuracy_top5).toBeCloseTo(0.961);
    });

    it('leaves the accuracies null on a detection run', () => {
        const box = finalMetrics(report()).rows.find((row) => row.class_name === null);

        expect(box.accuracy_top1).toBeNull();
        expect(box.accuracy_top5).toBeNull();
    });

    it('names the segmentation family seg, matching the library rather than the suffix', () => {
        // The metric-key suffix is (M); the attribute is SegmentMetrics.seg. Two halves
        // disagreeing on this string is a silent bug six weeks later, so it is pinned.
        expect(METRIC_FAMILIES.SEG).toBe('seg');
    });
});

describe('the confusion matrix, which is the thing most easily got backwards', () => {
    it('stores the trainer\'s array verbatim, unrotated', () => {
        const stored = confusionFromReport(report().confusion_matrix);

        expect(stored.orientation).toBe(ORIENTATIONS.ROWS_PREDICTED);
        expect(stored.matrix[0]).toEqual([10, 3, 5]);
        expect(stored.background_index).toBe(2);
    });

    it('transposes to rows-are-true when serving', () => {
        const stored = confusionFromReport(report().confusion_matrix);
        const served = confusionForReading(stored);

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
            classes: ['Lingcod', 'Rockfish'],
            background_index: 2,
            matrix: [[10, 3, 5], [1, 20, 7], [2, 4, 0]],
        });

        expect(confusionForReading(already).rows[0]).toEqual([10, 3, 5]);
    });

    it('labels the background row rather than trimming it', () => {
        const stored = confusionFromReport(report().confusion_matrix);

        expect(confusionForReading(stored).labels)
            .toEqual(['Lingcod', 'Rockfish', 'background']);
    });

    it('refuses a matrix that does not say which way round it is', () => {
        // Guessing produces a chart that looks plausible and asserts the opposite of
        // what happened. No matrix is better than a reversed one.
        expect(confusionFromReport({
            classes: ['Lingcod', 'Rockfish'],
            background_index: 2,
            matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 0]],
        })).toBeNull();
    });

    it('refuses a ragged matrix', () => {
        expect(confusionFromReport({
            orientation: ORIENTATIONS.ROWS_PREDICTED,
            classes: ['Lingcod', 'Rockfish'],
            background_index: 2,
            matrix: [[1, 0, 0], [0, 1], [0, 0, 0]],
        })).toBeNull();
    });

    it('refuses a matrix whose size does not match its own vocabulary', () => {
        // A label list that does not line up with the numbers is how a cell gets read
        // as the wrong class.
        const short = report().confusion_matrix;
        short.classes = ['Lingcod'];

        expect(confusionFromReport(short)).toBeNull();
    });

    it('refuses a background_index that is not one past the last class', () => {
        // Checkable rather than taken on trust: the background row is always at
        // `classes.length`. Anything else means the two halves of the report disagree
        // about what the axes are.
        const wrong = report().confusion_matrix;
        wrong.background_index = 1;

        expect(confusionFromReport(wrong)).toBeNull();
    });

    it('labels the axes with the FULL vocabulary, not the evaluated classes', () => {
        // **The bug this shape exists to prevent.** The matrix spans every class the
        // model knows; `per_class` covers only those the validator evaluated. They
        // differ exactly when a species had no validation instances -- the rare-species
        // case -- and labelling these axes with the evaluated list would shift every
        // label from that species onward and attribute confusions to the wrong animal.
        const sparse = report();
        sparse.confusion_matrix.classes = ['Lingcod', 'Rockfish', 'Cookie star'];
        sparse.confusion_matrix.background_index = 3;
        sparse.confusion_matrix.matrix = [
            [10, 3, 0, 5], [1, 20, 0, 7], [0, 0, 0, 0], [2, 4, 0, 0],
        ];
        // Only two classes were evaluated; Cookie star had nothing to score against.
        sparse.metrics[0].per_class = sparse.metrics[0].per_class.slice(0, 2);

        const parsed = finalMetrics(sparse);
        const served = confusionForReading(parsed.confusion);

        expect(served.labels).toEqual(['Lingcod', 'Rockfish', 'Cookie star', 'background']);

        // And the unevaluated species is in the matrix while having no metrics row --
        // a real fact, not an error and not a zero.
        expect(parsed.rows.some((row) => row.class_name === 'Cookie star')).toBe(false);
    });

    it('accepts a classification matrix, which has no background row', () => {
        const stored = confusionFromReport({
            orientation: ORIENTATIONS.ROWS_PREDICTED,
            classes: ['Lingcod', 'Rockfish'],
            matrix: [[7, 2], [1, 9]],
        });

        expect(stored.background_index).toBeNull();
        expect(confusionForReading(stored).labels)
            .toEqual(['Lingcod', 'Rockfish']);
    });

    it('yields nothing when the report carries no matrix', () => {
        // The panel's empty state is correct and a matrix is never derived from the
        // per-class numbers -- that would be arithmetic dressed as a measurement.
        expect(finalMetrics(report({ confusion_matrix: undefined })).confusion).toBeNull();
    });
});
