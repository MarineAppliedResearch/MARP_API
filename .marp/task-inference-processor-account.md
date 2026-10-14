---
task: (no issue yet — Isaac files one if wanted)
repos: [marp-api, VIDEO_PROCESSING_GUI]
status: implementing
needs: []
---

# Inference sessions belong to one processor, and the lists show the model

Written as `task-inference-processor-account.md` rather than `task.md` because `develop`
still carries the #181 spec there and the open video-review pull request rewrites it.
Replacing it here would conflict with that pull request.

## Goal

Sessions produced by GPU inference show up in the annotation GUI like any other session.
Today they have no processor, so the GUI's opening screen — processor, then project, then
session — can never reach them; only View → By Dive can. After this, every inference
session belongs to one processor account, **MARP Inference**, and both session lists show
which model produced a session's observations.

Goes out with the production upgrade: the release is re-pinned to include it.

## Requirements

- **R1** — An account named `MARP Inference` exists in every database, created by a
  migration. It has no password: it is a processor name, not a login.
- **R2** — The same migration gives that account every existing session that has no
  processor, has at least one observation, and has a model recorded (`ml_model_id`) on
  every one of its observations. No other session changes. Its `down` undoes exactly that.
- **R3** — Sessions created for inference from now on belong to the account: the GPU ingest,
  `scripts/process-dive.js`, `scripts/seed-inference-context.js`, and the GPU observations
  seeder.
- **R4** — `GET /api/v2/sessions/project/:projectID` and
  `GET /api/v2/sessions/user/:userID/project/:projectID` carry `models` on every session:
  the distinct names of the models that wrote observations in it, sorted, empty when none.
- **R5** — The GUI's opening-screen session list and the By Dive list each have a Model
  column showing those names, comma-separated, blank for human-only sessions.
- **R6** — In the GUI, choosing processor `MARP Inference` lists the projects and sessions
  the account owns, and a session launches from there.
- **R7** — Every observation identifies its video the same way, whoever wrote it: the
  video file's name on disk, extension included, in both `video_source` and
  `videoLocation`. The GPU ingest writes it into `videoLocation` instead of leaving it null.
- **R8** — A migration fills `videoLocation` from `video_source` on existing observations a
  model wrote that have none. Nothing else changes; production has no such rows.
- **R9** — The GUI, playing from Jellyfin, writes the file's name on disk into both columns,
  not Jellyfin's display name and not `jellyfin:item:<id>`.
- **R10** — Opening an inference session in the GUI loads its video, found in Jellyfin by
  filename.
- **R11** — Goto on an observation with no `videoLocation` uses its `video_source` instead
  of crashing the application.

## Open assumptions

- [x] **A1 · data-meaning · blocking** — One account for all inference, or one per model?
  Answered 2026-10-06: one account for all inference; the model is shown separately.
- [x] **A2 · database/schema · blocking** — Created by a migration or by the inference
  seeder? Answered 2026-10-06: a migration, so it exists in production before the worker
  goes live.
- [x] **A3 · data-meaning · blocking** — Which existing sessions move under it? Answered
  2026-10-06: only machine-made ones — no processor, and every observation written by a
  model. Keyed on `ml_model_id` rather than `gpu_job_id`: the GPU seeder leaves
  `gpu_job_id` null by design and that foreign key is `SET NULL`, while the model recorded
  on an observation is a fact about the data that stays. Matches nothing in production,
  where no observation records a model.
- [x] **A4 · product/UI · blocking** — Where is the model shown? Answered 2026-10-06: a
  column in both session lists.
- [x] **A5 · cross-repository · blocking** — In the production upgrade or after? Answered
  2026-10-06: in the upgrade.
- [x] **A6 · behavioural · blocking** — The GPU ingest records the job's submitter
  (`gpu_jobs.created_by`) as a new session's processor. Under A1 that becomes the
  inference account. Settled by A1's answer; each observation still records the submitter
  in `observations.user_id`, which this task does not touch.

- [x] **A7 · data-meaning · blocking** — Inference observations left `videoLocation` null
  and carried `jellyfin_item_id`; the GUI writes `jellyfin:item:<id>` into `videoLocation`.
  Which is right? Answered 2026-10-06: neither. Item ids are not stable — they change when
  items change on the Jellyfin server — and are to be retired. Video is looked up by
  filename. Both writers store the filename in `videoLocation`, and they must write the same.
- [x] **A8 · data-meaning · blocking** — "The filename" is the file's name on disk or
  Jellyfin's display Name? They differ: `20240730_171520_Fwd.mp4` against
  `20240730_171520_Fwd`, and `20200621_000532_Fwd.mp4.mp4` against
  `20200621_000532_Fwd.mp4`. Answered 2026-10-06: the name on disk, extension included.
  The doubled `.mp4.mp4` is the real name of eight CAMPA2020 files, not a data error.
- [x] **A9 · cross-repository · blocking** — In the upgrade? Answered 2026-10-06: yes, with
  the rest of this task. From upgrade night the processors' GUI writes the new form; their
  existing rows keep the item references they have, and goto already falls back to
  `video_source` when one no longer resolves (#186).
- [ ] **A10 · data-meaning · not blocking** — Should the ingest stop writing
  `jellyfin_item_id` now? This task leaves it writing it, since nothing relies on it after
  this and retiring the column is separate work. Not yet asked.

## Decisions

- **2026-10-06** — The account's name lives in `db/inference-processor.js`; the migration,
  the ingest, the script and both seeders take it from there and look the id up by name,
  because `users.name` is unique and ids differ between databases.
- **2026-10-06** — `models` is derived per request from `observations.ml_model_id`, the same
  way `observationCount` and `video_sources` already are. Nothing new is stored.

## Plan

1. `db/inference-processor.js` — the name, and an id lookup that fails loudly if the
   migration has not run.
2. The migration: create the account, backfill R2 inside `guardDataIntegrity`, and a `down`.
3. Point the four session creators at the account.
4. `models` on both session list endpoints; OpenAPI schemas; `npm run docs:build`.
5. GUI: Model column in both lists, through one helper shared with the Video column.
6. Tests, per `verification-inference-processor-account.md`.

## Acceptance criteria

- `npx sequelize-cli db:migrate` on the development database moves the inference sessions
  under MARP Inference and touches nothing else.
- In the GUI: processor `MARP Inference` → a CAMPA project → its sessions, each with the
  model's name in the Model column, and Launch opens one.
- By Dive shows the same sessions with processor `MARP Inference` and the model.

## Test plan

See `verification-inference-processor-account.md`.

## Status

- **Gate:** verifying
- **Notes:** Rehearsed 2026-10-06 on a copy of that day's production database
  (PostgreSQL 18 locally; production runs 14 -- not yet proven there). Two migrations
  in the release stopped on production data and were fixed alongside this task:
  `20260901120150-species-sequence-catches-up` (species sequence 478 against max id
  944) and `20260909120250-remove-orphaned-dataset-memberships` (24 memberships of
  observations deleted in 2025 and 2026; decided: remove). After that, 49 migrations
  in 20 s; observations, keyframes, sessions and projects identical before and after.
  Isaac used the GUI on the upgraded copy and it worked. Inference sessions are too
  large for the GUI to open (out of memory at ~15,000 observations) -- separate work.
  Found: 62 production observations hold a Jellyfin API key in `videoLocation`
  (written by `addCurrentTimeCodeToDB`, fixed here); the rows are not cleaned.
