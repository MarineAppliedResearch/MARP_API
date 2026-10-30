---
task: MarineAppliedResearch/MARP_API#295
repos: [marp-api, marp-inference-worker]
status: design
needs: []
---

# The Training tab's per-batch charts draw the readings a run stored

Issue: MarineAppliedResearch/MARP_API#295
Branch: `295-live-loss-charts`
Related: #277 (its second half: readings from inside an epoch), #275 (ECharts)

## Goal

The *While it runs* charts (Box loss, Class loss, DFL loss, GPU memory) show the run's
readings, during the run and after it finishes. Today they are blank: job 21956 stored 100
loss readings over 102 epochs and not one is drawn.

## Requirements

- **R1 — A series is drawn from the samples that carry its key.** Phase markers and
  validation samples carry no loss, and they no longer split a loss series into lone points.
- **R2 — A lone reading is visible.** A series with one reading, or with readings far apart,
  draws each reading as a point, so a sparse run is never a blank chart.
- **R3 — Each attempt is still its own line**, as now: a retry restarts the step counter.
- **R4 — Readings from inside an epoch.** #295 depends on #277's second half: the worker
  stores only batch 0 of each epoch, so even drawn, a run of 637 batches an epoch is one
  point every 10 minutes. See A1.

## Open assumptions

- [x] **A1 · cross-repository · blocking** — answered 2026-10-30: yes, charts first, then the worker half in this task. — **Is the worker half (#277, readings inside an
  epoch) part of this task?** It means running `scripts/measure_epoch_split.py` on the GPU,
  fixing `on_batch_end` in marp-inference-worker, releasing and installing the worker, and
  checking a real run. #295's *done when* requires it. **Recommended: yes, but after the
  chart half**, which is a dashboard change that can be checked today on job 21956's
  stored readings.
- [x] **A2 · product/UI · non-blocking** — **GPU memory is drawn from training samples
  only**, as now. Validation samples also carry it, but the charts are per training batch.
- [x] **A3 · product/UI · non-blocking** — **Points shown when a line is sparse.** Each
  reading is drawn as a small point when an attempt has 200 readings or fewer. Above that,
  a line alone is readable.

## Plan

1. `stepCharts`: build each attempt's points from the training samples carrying the key;
   show symbols when sparse.
2. A unit test with job 21956's shape: losses at batch 0 only, between phase markers.
3. Check job 21956 on the Training tab in the browser.
4. Then the worker half, if A1 says so.

## Status

- **Gate:** implementing.
