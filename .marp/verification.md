# Verification — MARP_API#232: an attempt records the settings it ran with

Two branches, verified together:

- `MARP_API` — `232-record-inference-settings`
- `marp-inference-worker` — `232-report-inference-settings`

Every result below was run on 2026-09-23 against the development database, with the API
moved to port 3001 so that no worker could reach it and write to the database mid-run.

## Results, by requirement

| Req | What proves it | Tier | Result |
|---|---|---|---|
| R1 | `gpu-attempt-settings` — every setting recorded; worker `test_every_setting_is_reported_under_its_catalogue_type` | API, unit | pass |
| R2 | `records a default as the value that was used`; worker `test_an_unset_imgsz_is_the_models_training_size_not_ultralytics_default`, `test_what_the_job_set_is_the_jobs_and_the_rest_is_default` | API, unit | pass |
| R3 | `records what the job asked for that the worker did not honour`; worker `test_keys_nothing_honours_are_reported_with_what_the_job_asked_for` | API, unit | pass |
| R4 | `still has its settings after it reports failure`; worker `test_a_fault_in_the_settings_report_does_not_fail_the_job` | API, unit | pass |
| R5 | `can be queried setting by setting, which is the point of the tables` | API | pass |
| R6 | `carries the attempt it came from, and so reaches that attempt's settings` | API | pass |
| R7 | `records nothing, and its other events are accepted as before`; worker `test_a_refused_settings_report_is_kept_as_a_warning_log_line` | API, wire | pass |

## What was run

**marp-api, `tests/gpu-attempt-settings.test.js`** — 16 passed, 0 failed, and
`corpus-guard` passed: the file left the database exactly as it found it.

**marp-inference-worker, full `pytest`** — 271 passed, 0 failed, 4 skipped. The skips are
platform branches and predate this change: two POSIX permission-bit tests, the non-Windows
credential store, and a symlink test that needs elevation. There is no test job in this
repository's CI, so this run is the evidence.

**Across the two repositories, once, not committed.** The worker's real code built the
event it would send — real `DEFAULT_CFG`, real `TrackerArgs`, a checkpoint `imgsz` of 1280,
the deep-sea regime from `object_tracking_live.py` and one misspelt key — and it was posted
through the real API. All 12 settings landed with the values and sources the worker
reported, and both ignored keys were recorded:

    agnostic_nms true/job   augment true/job   class_match_iou 0.4/engine
    confidence 0.001/job    half false/default imgsz 1280/job     iou 0.2/job
    match_thresh 0.8/job    max_det 300/default mot20 true/job
    track_buffer 300/job    track_thresh 0.01/job
    ignored: track_threshh '0.5', tracker 'null'

This is the tier the worker's own contract suite warns about: six divergences once passed
both repositories' tests and broke only when the halves ran together.

**The migrations, both ways.** Applied, undone, and applied again. `guardDataIntegrity`
reported no rows deleted, dereferenced or orphaned across 114,613 observations and 571,316
events. The undo removed the three tables and the column and put the event kinds back to
`metric, log, note`.

**A guard that can go red.** With the engine's `except` made to re-raise,
`test_a_fault_in_the_settings_report_does_not_fail_the_job` fails; restored, it passes.

## Not yet run, and why

**`npm run test:gpu`, the rest of the group.** Five suites refuse to run while the
database holds queued GPU jobs — `gpu-orchestration`, `gpu-lease-race`,
`gpu-video-resolution`, `gpu-playback-reporting`, `gpu-observation-ingest` — and there are
over a thousand. `gpu-observation-ingest` matters most here, because it exercises the
ingest path this change touches. Run after the queue is cleared.

## Not covered

- A real inference run on a GPU worker end to end. The wire-level and cross-repository
  checks cover the contract; the frame loop itself is unchanged.
- The testing database (`marp_test`) was not rebuilt. Nothing in the browser tier reads
  these tables.

## Found and left alone

- **`gpu-abandoned-poll` has no queued-jobs guard**, unlike the five suites above. Run
  against a non-empty queue it leased three real jobs and left four workers and three
  attempts behind. Cleaned up; the guard itself is not this task's.
- **Test debris from 2026-09-19**: workers `jest-ingest-worker-1789805535629` and
  `jest-ingest-worker-1789805601846`, and about fifty attempts on test jobs 6706–6745.
