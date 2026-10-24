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
 * **The two sets of losses are two facts, in two sets of columns.** Ultralytics reports
 * `train/box_loss` and `val/box_loss` as separate series: the first is the mean loss
 * over the epoch's batches, the second is the validator's. The gap between them is the
 * overfitting signal and the first thing an ML reader looks for, so neither is allowed
 * to stand in for the other -- a column meaning training loss on some rows and
 * validation loss on others could not be read at all.
 *
 * The unprefixed columns hold the validation losses, which is what they have always
 * held; `train_*` is the new fact rather than a rename, because the dashboard is
 * drawing the old ones.
 *
 * **Segmentation will add a fourth loss and this will need a decision.** Ultralytics
 * names its losses off the criterion, so a segmentation run also reports
 * `train/seg_loss` — the worker's contract says to match on the `train/` prefix rather
 * than on a list of three. A map keyed by reported name would survive that without a
 * migration; three columns will not. Detection is the only task being trained, so that
 * decision is left to whoever builds segmentation rather than guessed at now.
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
    train_box_loss: 'train/box_loss',
    train_cls_loss: 'train/cls_loss',
    train_dfl_loss: 'train/dfl_loss',
    /* **The one key the worker names itself**, rather than passing an Ultralytics
       name through: it is named for this column so the mapping is identity. It has
       existed since the table did and nothing has ever written it. */
    duration_seconds: 'duration_seconds',
};

/**
 * Read a metric payload into the columns `epochs` holds.
 *
 * **A genuine 0.0 is a measurement and is stored.** `tloss` is None through a
 * NaN-recovery epoch and `epoch_time` is unset before the first epoch finishes, so an
 * absent key means the number did not exist — but a loss that really was zero is sent
 * as zero and has to survive. Absence and zero are told apart before the conversion,
 * which is the only place they look alike.
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
