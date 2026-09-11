---
task: MarineAppliedResearch/MARP_API#142
repos: [marp-api]
status: design
needs: []
---

# The suite cannot quietly destroy the corpus

Design specification for **MARP_API#142**.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.**

## What happened

`npm test` was run against the development corpus on 2026-09-11 to verify #130 and #131.
**It passed — 44 suites, 612 tests, 0 failed — and it deleted a real observation.**

```
before   2094 observations
after    2093 observations
missing  observation 1233 · CAMPA2026 · Dive 28 · line 2003
```

Found by counting rows before and after and looking for a gap in the id range, not by
anything the suite reported. A second, non-destructive symptom of the same shape: the same
run took `observation_reviews` from 219 rows to 427 and `observation_review_current` from
209 to 359. Review decisions the suite made are now sitting in the corpus, and the mosaic
draws them as real.

## What is already true, checked rather than assumed

- **A delete leaves no trace, deliberately.** `repository/mosaic-commit.repository.js`:
  *"no provenance row, nothing recording who or when"*, cascading to `keyframes`,
  `dataset_observations`, `observation_reviews` and `observation_review_current`. So there
  is no audit trail to identify the caller, and this is correct behaviour for the feature.
- **Reading the tests does not find it.** Every `DELETE FROM observations` in `tests/` is
  keyed on ids the suite created — `tests/mosaic-commit.test.js` uses `addObservations(2)`
  and deletes by explicit id; `tests/gpu-observation-ingest.test.js:375` deletes by
  `gpu_job_id`, but only for jobs it tracked in `createdJobIds`. **The culprit is not
  obvious by inspection**, which is the strongest argument for a guard that names the suite
  rather than only the run.
- **`setupFilesAfterEnv` runs once per test file** (`jest.config.js:75`), already carrying
  `console-error-passthrough.js` and `authenticated-agent.js`. That is the hook a per-suite
  check fits into with no new machinery.
- **The suite runs `--runInBand`** against whatever `DB_*` points at. That is both how it is
  meant to work and why this is possible.
- **CI cannot see any of this.** CI builds an empty database from the baseline and the
  migrations, so there is nothing to borrow and nothing to lose. A guard added here is
  **inert in CI and meaningful only on a machine holding real data** — which is unusual
  enough to say out loud.
- **The rule this breaks is already written down.** `CLAUDE.md`: *"A test must seed what it
  asserts."* Five tests were fixed for *reading* borrowed rows. This is one *writing* to a
  borrowed row, destructively.
- **There is a dump from 08:20 that day** recording 2,094 observations, so observation 1233
  and its keyframes exist in a file. It exists by luck of timing: #125 landed hours earlier.

## Open assumptions

- [ ] **A1 · behavioural · blocking** — **What does the guard watch, and what counts as a
  loss?**
  Candidates: **(a)** `observations` alone — the thing that was lost, one number, nearly
  free; **(b)** a named set of *corpus tables* — `observations`, `keyframes`,
  `observation_thumbnails`, `sessions`, `projects`, `ml_models` — where a **net decrease**
  in any of them fails; **(c)** every table in the schema.
  **Recommendation: (b).** (a) would have caught this one and misses a suite that deletes
  keyframes, a session or the model — all of which are equally unrepeatable. (c) is noise:
  plenty of tables legitimately shrink when a suite cleans up after itself, and a guard
  that cries wolf gets disabled.
  **Note what (b) deliberately does not cover:** a test that deletes a real row *and* seeds
  one of its own leaves the count level. This is a net check, not an identity check. A6
  covers whether that matters.

- [ ] **A2 · architectural · blocking** — **Per suite, or per run?**
  Per run is one count before and one after — cheapest, and tells you the suite destroyed
  something without saying which file. Per suite uses `setupFilesAfterEnv` and **names the
  file**, at the cost of a `count(*)` per table per test file (44 files).
  **Recommendation: per suite.** The whole reason this issue is hard is that reading the
  tests did not identify the culprit. A guard that reproduces that ambiguity is worth much
  less. The cost is a handful of counting queries against indexed tables, in a suite that
  already takes 82 seconds.

- [ ] **A3 · behavioural · blocking** — **Does the guard fail the run, or report?**
  Failing turns a silent loss into a red suite. It also means the *first* discovery of a
  destructive test is a failing build on the machine that just lost data — the guard
  detects, it cannot undo.
  Candidates: fail the suite that lost rows; fail the whole run at the end; print loudly and
  exit 0.
  **Recommendation: fail the suite that lost rows**, and print what was lost and from which
  table. A test that destroys unrepeatable data is a failing test even when its assertions
  passed, and exiting 0 on a known loss is how this went unnoticed for a whole run.

- [ ] **A4 · architectural · blocking** — **Should the suite refuse to run against a
  database holding a corpus at all?**
  This is the only option that *prevents* rather than *detects*. It is also the most
  disruptive: running `npm test` against the development database is how everything in this
  project has been verified, including tonight's phase, and the corpus is what makes that
  verification meaningful.
  Candidates: **(a)** never refuse, only detect; **(b)** refuse unless an environment
  variable says the operator accepts it; **(c)** refuse always, and require the suite to be
  pointed at a database built for it — which #125's `marp db load` now makes possible.
  **Recommendation: (a) for this phase**, with (c) recorded as where this should end up
  once #132 has the browser tier on a loaded database too. Detection is a day's confidence;
  a separate test database is the real answer, and it should not be bolted on inside a
  bug-fix phase.

- [ ] **A5 · behavioural · blocking** — **What about rows the suite *adds* to the corpus?**
  The same run added 208 review rows and 150 projection rows that are still there. Nothing
  was lost, but the corpus's review counts are now partly synthetic, and the mosaic shows
  them as decisions somebody made.
  Candidates: fail on additions too; report additions without failing; ignore them.
  **Recommendation: report without failing.** Additions are recoverable and a test that
  writes a review is doing its job; a guard that fails on them would fail on almost every
  suite. But an unreported residue is how 208 rows accumulated without anybody noticing,
  so it should be visible at the end of a run.

- [ ] **A6 · destructive · blocking** — **Do we restore observation 1233?**
  It is in the 08:20 dump with its keyframes. Restoring one row out of a `pg_dump` means
  loading the dump into a second database and copying the row and its children across —
  perhaps twenty minutes, and it touches the corpus.
  Candidates: restore it; leave it and record that it was lost; leave it and write the
  restore path down for when it matters more.
  **Recommendation: leave it, and say so in the log.** One observation out of 2,093, whose
  absence changes no conclusion, against a careful write to the one database with no
  backup. **This is the human's call and it is not mine to make** — it is his scientific
  record, and "it is only one row" is exactly the reasoning that loses records.

## Requirements

- **R1** — A test suite that reduces the row count of a watched table fails, naming the
  table, the number lost, and the suite.
- **R2** — The watched set is named in one place, with a comment saying why each table is
  in it.
- **R3** — The guard costs no meaningful time: it is counting queries, and the suite's
  runtime is not materially changed.
- **R4** — The guard is inert against an empty database, so CI is unaffected and stays
  green for the right reason rather than by accident.
- **R5** — Rows *added* to the review tables are reported at the end of a run, per A5.
- **R6** — The guard itself has a test: a deliberately destructive fixture suite is caught.
  A guard nobody has watched fail is not a guard.
- **R7** — Nothing in this phase deletes, alters or restores corpus data, except whatever
  A6 settles.

## Out of scope

- Finding and fixing the specific destructive test. **The guard is what makes that findable**
  — the next full run will name it. Fixing it is the follow-up, and it may be one line.
- Pointing the suite at a database built from a dump (#132, #125).
- The review residue already in the corpus. Reporting it is R5; cleaning it is not this.
