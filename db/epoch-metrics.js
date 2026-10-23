/**
 * Which metric a worker reports goes in which column of `epochs`.
 *
 * **One copy, because two would drift.** The ingest writes these as an epoch arrives and
 * `scripts/backfill-epoch-metrics.js` writes them from events that arrived before the
 * ingest knew about them; a mapping that lived in both places would disagree the first
 * time a metric was added. Same reason `db/corpus.js` exists for the dump and the load.
 *
 * **Five of these seven columns were empty on every row MARP had ever written.** `map50`
 * and `map5095` were never mapped at all, and the three losses were looked up as
 * `train/box_loss` and friends while the worker sends `val/`. The values were in the
 * events the whole time, which is what makes the backfill possible.
 *
 * **The losses are validation losses, and the columns mean that.** Ultralytics reports
 * `train/box_loss` and `val/box_loss` as separate series. The worker sends the validation
 * set, so that is what these hold. `train/` is deliberately not accepted as an
 * alternative: a column that means training loss on some rows and validation loss on
 * others cannot be read at all, and the gap between the two -- which is the first thing
 * an ML reader looks for -- needs its own columns rather than a shared one.
 *
 * **`(B)` is Ultralytics' box-task suffix.** A segmentation run also reports `(M)` for
 * mask metrics, which nothing here is trained for yet; those stay in the event until
 * there are columns asking for them.
 *
 * @fileoverview The metric-name to column mapping for the epochs table.
 * @module db/epoch-metrics
 */

'use strict';

/**
 * Column on `epochs` to the metric name the worker reports it as.
 *
 * @constant
 * @type {Object<string, string>}
 */
const EPOCH_METRIC_NAMES = {
    precision: 'metrics/precision(B)',
    recall: 'metrics/recall(B)',
    map50: 'metrics/mAP50(B)',
    map5095: 'metrics/mAP50-95(B)',
    box_loss: 'val/box_loss',
    cls_loss: 'val/cls_loss',
    dfl_loss: 'val/dfl_loss',
};

/**
 * Read a metric payload into the columns `epochs` holds.
 *
 * Anything that is not a finite number becomes null rather than being stored: a metric
 * Ultralytics reports as `nan` on an epoch with no detections is not a measurement of
 * zero, and `NaN` does not survive the driver anyway.
 *
 * @param {Object} metrics - The event payload's `metrics` object.
 * @returns {Object<string, ?number>} Keyed by column name, every column present.
 */
function epochMetrics(metrics) {
    const from = metrics && typeof metrics === 'object' ? metrics : {};

    return Object.fromEntries(Object.entries(EPOCH_METRIC_NAMES).map(([column, name]) => {
        const raw = from[name];

        /* **`Number(null)` is 0, not NaN**, so a metric the worker sent as null would be
           recorded as a measurement of zero — on a loss curve that reads as a model
           collapsing, which is a lie about the training rather than a gap in it. Absent,
           null and empty are all "not measured" and are ruled out before the conversion. */
        if (raw === null || raw === undefined || raw === '') return [column, null];

        const value = Number(raw);

        return [column, Number.isFinite(value) ? value : null];
    }));
}

module.exports = { EPOCH_METRIC_NAMES, epochMetrics };
