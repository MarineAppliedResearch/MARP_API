# Verification — endpoint and integration tests for the dataset build path

Issue: MarineAppliedResearch/MARP_API#268, planning item **1.1**
Branch: `claude/268-dataset-build-tests-8f6e1b`, cut from `104-dashboard-reads-marp`
Spec: `.marp/task-268-dataset-builds.md`

The build path works end to end and **nothing covered the route, the runner or the
repository**. The two real defects found so far were both found by running it by hand —
`tar -cf C:\…` read as a remote host called `C`, and subsets sent to Validation or Test
being cut, recorded as members and then left out of the archive. Both were invisible from
the rows, and both now have a tripwire.

## A third tier, for the migration

`migrations/20261021140000-an-r-in-the-note-meant-promoted.js` rewrites a decade of
approvals in the production database and had no automated test. It gets one, and it
**builds and drops its own database** — about five seconds, from the baseline and the
migrations, exactly as `marp db up` and CI do.

That is not caution, it is the only way the test can exist. `up()` promotes **every**
observation in the database whose note is the mark, and `down()` deletes **every** review
carrying the migration's reason. Pointed at a development corpus where the migration has
already run, `down()` would quietly withdraw the real migration's work; pointed at one
where it has not, `up()` would write hundreds of real decisions. **No amount of seeding
scopes that**, which is what makes this different from every other suite here.

`up` and `down` are called directly rather than driven through `sequelize-cli`: the CLI
would refuse to run it a second time, since the ledger already records it from the build —
and *running it twice* is one of the properties being asserted.
`tests/corpus-guard.test.js` is the precedent for the mechanics.

## The tiering, which is the decision that matters

A real build opens an H.264 stream from the central media server and runs ffmpeg over it
for minutes. That must never be what `npm test` or CI costs. So:

- **The fast tier stubs exactly two calls** — `thumbnail-extraction.service.probeStream`
  and `extractFrames` — with `jest.spyOn`, and leaves everything else real: the selection
  query, the planner, the JPEG re-encode through `sharp`, `tar`, the SHA-256, and every
  row written. The stub writes real 8×8 PNGs, so the re-encode is exercised rather than
  skipped. Three suites, 37 tests, **about 2 seconds each and 13 seconds inside
  `npm run test:ml`.**
- **The slow tier is one suite, one build, real video.** `tests/dataset-build-real.test.js`
  builds `{session: [507], trainingDisposition: ['promoted']}` — about 330 frames over one
  video, roughly a minute — and is excluded by name from `jest.config.js` (so `npm test`
  does not run it) and again on CI's command line (which replaces the config's list rather
  than adding to it). `npm run test:datasets` is how it is asked for.

Stubbed with `jest.spyOn` rather than `jest.mock`, so the modules `app.js` loads are the
application's own; replacing the extraction service wholesale would change what every
route was built against for the sake of two functions.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 — a build is a job | `dataset-build-queue` · *answers with a dataset that is building and the job that will build it* | endpoint | The dataset and the `gpu_jobs` row exist together and the job's spec names the dataset. A dataset with no job says `building` for ever. |
| R1 | `dataset-build-queue` · *both rows are really in the database* | endpoint | The answer is not the only place the pairing exists. |
| R1 | `dataset-build-queue` · *the filters are carried into the spec*, *subsets are carried with the split each one asked for*, *an empty subsets array is not a subsets build*, *the image settings are carried* | endpoint | A build is a record of what was asked for, not a reference to a saved query that can be edited afterwards. |
| R1 | `dataset-build-queue` · *a missing name is a 400 and leaves nothing behind*, *a blank name is a 400 too*, *the name is trimmed* | endpoint | Validation happens before the row is created. |
| **R2 — the API runs it, not a worker** | `dataset-build-queue` · *a queued build is invisible to `POST /gpu/poll`, and an inference job behind it is not* | endpoint | The one rule keeping builds off the pool. The build is given the **highest priority in the queue** so it is one the poll genuinely reached, and an inference job behind it is the positive control. **Proved red by mutation** (below). |
| R3 — membership is recorded | `dataset-build-runner` · *membership is recorded for every observation that went in, and only those* | integration | `dataset_observations` has a row per observation, with `selection_method`. This table held 0 rows for 0 datasets before #268. |
| R4 — the vocabulary is recorded | `dataset-build-runner` · *the vocabulary is recorded in index order, by species id* | integration | `dataset_classes` carries index → `species_id`, ordered by common name, which is what makes a label file mean anything. |
| R5 — frames come from the video | `dataset-build-runner` · *every frame of the span is cut, not just the keyframes*, *one ffmpeg pass per video and split* | integration | Nine frames from four observations with two keyframes each, in three passes rather than four. |
| R5 | `dataset-build-runner` · *a frame two observations share carries both of their boxes*, *a frame only one observation covers carries one box* | integration | The label files are opened and read: two lines on a shared frame, with the interpolated box the fixture predicts. |
| R6 — the archive's shape | `dataset-build-runner` · *the archive holds all three splits*, *every image has the label file that belongs to it*, *data.yaml names the classes in index order*, *the frames are named for their video*, *the frames are JPEG* | integration | The tar is **unpacked and read**, which is the only tier that can see a dataset claiming observations its own archive does not hold. |
| R6 | `dataset-build-runner` · *the archive is named for its own digest and is the size the row claims* | integration | `archive_path`, `archive_sha256` and `archive_bytes` describe the file that is actually there. |
| R7 — no frame leaks across splits | `dataset-build-runner` · *the connected group stayed whole, in the split its earliest member claimed* | integration | The subsets are chosen to cut **across** a connected group: `first` is claimed by train and `second`, which shares frames 101–102 with it, is matched by validation. A naive build leaks two frames into eval. |
| **R8 — nothing half-served** | `dataset-build-lifecycle` · *a build that is cancelled stops between videos, returns the dataset to draft, and leaves nothing staged* | integration | Cancelled through the job's state in the database, which is where `isCancelled` looks. Asserts the second video was **never opened**, the dataset is `draft` with no `archive_*`, no membership, no staged frames, no new tar. |
| R8 | `dataset-build-lifecycle` · *a build that fails ends failed, with no archive columns set and no partial file behind* | integration | `failed`, `archive_*` null, no `building-*.tar`, nothing staged. It fails on the **second** video, so a video's frames and labels are already staged when it dies — a build that died before cutting anything leaves nothing behind whatever the cleanup does, and so cannot tell you the cleanup works. |
| R8 | `dataset-build-lifecycle` · *filters that match nothing fail the build* | integration | An empty dataset that is `ready` is worse than a failure. |
| R8 | `dataset-build-lifecycle` · *an image format nobody builds in fails before a single frame is cut* | integration | The **runner's own** guard, reached by writing the two rows the route would have written — because the route refuses this spec now, and that refusal is tested where it lives (`dataset-build-progress`, all three cases). Defence in depth is only in depth if the second line is tested too: a job queued by a seeder, a retry or a future caller still meets this one. |
| **R8 — cancelled mid-video** | `dataset-build-lifecycle` · *stops between passes rather than finishing the video first* | integration | One video of 802 frames, cancelled during the first pass: one pass runs, not three. Checked between videos, a single-video build has nothing left to check and would cut every frame and succeed — which is what this test does against the older builder, so it pins the change rather than describing it. |
| retry | `dataset-build-lifecycle` · *a second attempt replaces the first attempt's rows rather than doubling them* | integration | Four members and three classes before and after; two attempts recorded with epochs 1 and 2; the dataset names the **second** attempt's archive. |
| the extractor's own gaps | `dataset-build-runner` · *a frame the extractor could not produce costs that frame, not the build* | integration | A truncated video costs frames at the end; the dataset is still `ready`, and the gap in the archive is the frame that was lost rather than the one after it. |
| **observations ≠ frames** | `dataset-build-runner` · *observations and frames are two numbers, and neither stands in for the other* | integration | `num_samples` stays images, which is what it has meant since `package-dataset.js`, and `num_observations` is the new fact. The corpus is four observations and nine frames **on purpose**: a corpus where they happened to be equal would pass with them the wrong way round, which is how they came to be carried in one column. |
| the batched extraction | `dataset-build-runner` · *is cut in several passes rather than one enormous one*, *every frame is asked for exactly once, in order*, *every pass writes into its own directory*, *the archive holds every frame, once* | integration | An 802-frame video, which is more than one pass. `extractFrames` builds a `select` term per frame, so one pass over 8,408 frames made a ~340 KB command line and the build died with `spawn ENAMETOOLONG` after minutes of work — the bug that would have killed the 50,000-frame target. The batch size is **not** written into the test; the shape is read back from what the extractor was asked for. |
| progress | `dataset-build-runner` · *progress moves while the video is still being cut*, *progress counts across videos rather than restarting at each one* | integration | One long video reports strictly inside itself; three short ones report a count that never goes backwards and ends at nine. A per-video reset is a bar that jumps back to the start whenever a video ends. |
| **label geometry** | `dataset-build-runner` · *a frame two observations share carries both of their boxes*, *a box running off the edge is written as the part that is in the picture* | integration | `keyframes.x, y` is the **centre**, and the builder added half a width and half a height to it until 2026-10-21 — every label it had ever written was half a box right and down of the animal. Both tests assert the exact label text, which is what catches it; the fixture's box is interior and the edge one overruns the right edge, so the clipped values are asserted too. |
| label sanity | `dataset-build-runner` · *every coordinate in every label is inside the picture* | integration | Every coordinate in 0..1 and every class index inside the vocabulary, over a whole archive. **Read the note under *Proved red by mutation* before relying on this one**: clipping now makes the coordinate half of it true by construction. |
| the split dial | `dataset-build-queue` · *a subset carries shares as readily as a split* | endpoint | Whichever the person said is carried verbatim; the division is the runner's, because it needs the rows to divide. |
| the split dial | `dataset-build-runner` · *shares divide one query across the splits they name*, *a share of zero means that split gets none*, *an observation two subsets match still lands in exactly one split* | integration | Shares are divided **before** the subsets are reconciled, so a query matching everything cannot move what an earlier subset claimed — `first` stays in `test` and pulls `second` with it, because they share frames. Each build also asserts every observation appears exactly once: a divided subset putting one in two places would be invisible in the archive, where the second copy overwrites the first by name. |
| **the legacy `R` note** | `legacy-r-promotion` · 16 tests | migration, on its own database | See below. |
| everything, against real video | `dataset-build-real` | slow | That the frames MARP asks for are frames the video can produce, at the frame rate it reports, through the URL the coordinator resolved — ending in a range request to `GET /gpu/datasets/:id/archive`, which is what a worker calls. |

## Proved red by mutation

`LEASABLE_JOB_KINDS` gained `'dataset_build'` — the one-word edit the R2 tripwire exists
to catch — and the suite went red:

```
✗ a dataset build is never handed to a worker (#268 R2) > a queued build is invisible to
  POST /gpu/poll, and an inference job behind it is not
    Expected: 200
    Received: 204
```

It failed at the **positive control** rather than at the first assertion, which says
something worth keeping: with `dataset_build` leasable, the claim picks the build (it is
first in line), cannot turn it into a lease, and answers "no work" — so the inference job
behind it is never offered either. The mutation does not merely hand a build to a worker;
it **wedges the queue behind it**. `config/gpu-orchestration.js` was restored and
`git status` confirmed clean.

The other two tripwires — the fixed split list in `packageArchive`, and `isCancelled` —
live in `service/dataset-build.service.js`, which this branch was told not to touch, so
they are **not** proved by mutation. Both read real artefacts (an unpacked tar, the job's
own state) rather than a stub's return value.

**The batching tests were proved red three ways**, in a throwaway worktree carrying the
batched builder, so nobody's working copy was touched:

| Mutation | What failed |
| --- | --- |
| every pass writes into one directory (`batchDir = cut`) | *every pass writes into its own directory* — **and nothing else**. The archive still held 802 images: with batches sharing a directory, pass two's `frame-0001.png` overwrites pass one's, so the images come out right in number and wrong in content. Only this test can see it. |
| an overlapping batch boundary (`at += FRAMES_PER_PASS - 1`) | five tests, including *every frame is asked for exactly once, in order* |
| the per-pass progress callback disabled | *progress moves while the video is still being cut* — and nothing else |

And the whole set is pinned to the change itself: against the branch **without** the
batched, observation-counting builder, six tests fail — among them a single 802-frame
observation reporting **802** where the observation count belongs, which is the defect in
one number.

**The `R` migration's case rule was proved red by the defect it was written against.**
`LEGACY_MARK` was changed to `upper(btrim(o.note)) = 'R'` — the first draft — and two
tests failed, naming the pre-checks it promoted:

```
✗ a lowercase r is not an approval and is left undecided
    Received: {"decision": "promoted", "reason": "Legacy note \"R\" meant approved for training", ...}
✗ promotes exactly the two it should, and says so
    Expected: 2   Received: 4
```

The migration file was restored and `git status` confirmed clean.

**The centre-origin reading was proved red by the defect it replaced**, and the result
says something about tiering that is worth more than the proof. `boxAt` was changed back
to adding half a width and half a height, and **two** tests failed — both of them
exact-value assertions:

```
✗ a frame two observations share carries both of their boxes
    - "0.400000"  + "0.500000"
✗ a box running off the edge is written as the part that is in the picture
    - "0.925000"  + "0.975000"
```

*every coordinate in every label is inside the picture* **did not fail**, and cannot: the
old reading puts the centre at 1.05, clipping trims the box to 0.95–1.0 and re-centres it
at 0.975, and 0.975 is in range. That assertion caught the defect in the real-video suite
precisely because it ran **before** clipping existed. Now that clipping is there, the
invariant is true by construction for coordinates, and only the exact-value assertions can
see a geometry error. It is kept because it still watches the class index and would catch
a clipping regression, and it is written down here because a reader would otherwise assume
it guards what it used to guard.

The same holds for the mid-video cancellation: against the builder that checked between
videos, *stops between passes rather than finishing the video first* fails, because a
single-video build has nothing left to check and runs to a successful finish. Each of
these tests was watched failing on the code before the change and passing on the code
after it, rather than only passing.

## Requirements with no test

None of R1–R8 is untested. `repository/dataset-build.repository.js` is covered through
the runner rather than directly: every function it exports is on the path these suites
drive, and a unit test of `recordBuild` would assert the same rows one layer lower.

## Known gaps

- **The slow suite has never been run against real data.** `marp agent adopt` provisioned
  this workspace's database but its corpus restore failed, so the database is empty. The
  suite was run and fails at its precondition with the message it was written to give; the
  real build it describes is unexercised.
- **A rebuild is not the same file.** `packageArchive` says content addressing means
  "building the same dataset twice is the same file"; a tar records each entry's
  modification time and the frames are rewritten on every attempt, so the digest moves.
  The retry test records this instead of asserting it.
- **The route's own refusal of a bad image format is not tested here**, deliberately: it
  lives in `tests/dataset-build-progress.test.js`, which covers all three cases and that
  nothing is queued. This file tests the runner's guard behind it.
- **Permissions are not tested here.** Every suite runs as the fixture user, which holds
  every permission; the refusals are the auth suites' subject.
- **Nothing covers two builds at once**, because the poller is one at a time by
  construction and no test starts a second process.

## Manual steps

Run the real build where the corpus and the media server are reachable:

```
npm run test:datasets
```

It removes the dataset, the job, the attempt, the membership and the archive it made.
