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
    /* **The three keys the worker names itself**, rather than passing Ultralytics
       names through: each is named for its column so the mapping is identity.
       `duration_seconds` has existed since the table did and nothing ever wrote it.

       The offsets are **elapsed seconds, not instants**, and that is a decision
       rather than a convenience: *"Treat start_time and end_time as ordering and
       duration only -- valid within a run, never compared across machines."* A
       volunteer box with a drifting clock cannot put a wrong wall-clock time into
       the record this way. `epochs.start_time` and `end_time` are timestamps and
       stay null, because an offset is not a time and the type would have let the
       lie through.

       **The origin is the start of training, so epoch 1 sits at roughly 0.000.**
       Ultralytics sets `train_time_start` after `_setup_train` has built the
       dataloaders, loaded the model and built the optimizer, so however long setup
       took is not inside these numbers -- it is the gap between the attempt's first
       event and the `on_train_start` settings report. Anyone reading a non-zero
       first offset as setup time will find 0.000 and think the worker is broken. */
    duration_seconds: 'duration_seconds',
    start_offset_s: 'start_offset_s',
    end_offset_s: 'end_offset_s',
};

/**
 * The offsets, which are one measurement in two columns.
 *
 * @constant
 * @type {string[]}
 */
const OFFSET_PAIR = ['start_offset_s', 'end_offset_s'];

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

    const read = Object.fromEntries(Object.entries(EPOCH_METRIC_NAMES).map(([column, name]) => {
        const raw = from[name];

        /* **`Number(null)` is 0, not NaN**, so a metric the worker sent as null would be
           recorded as a measurement of zero — on a loss curve that reads as a model
           collapsing, which is a lie about the training rather than a gap in it. Absent,
           null and empty are all "not measured" and are ruled out before the conversion. */
        if (raw === null || raw === undefined || raw === '') return [column, null];

        const value = Number(raw);

        return [column, Number.isFinite(value) ? value : null];
    }));

    /* **Half an interval is not a measurement.** The worker omits the two offsets
       together, so one arriving alone means something was lost on the way rather
       than that half of it was measured -- and a start with no end would be read as
       an epoch that never finished. Dropped as a pair rather than stored as one. */
    if (OFFSET_PAIR.some((column) => read[column] === null)) {
        for (const column of OFFSET_PAIR) read[column] = null;
    }

    return read;
}

module.exports = { EPOCH_METRIC_NAMES, epochMetrics };
