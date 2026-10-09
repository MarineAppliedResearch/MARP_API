---
task: MarineAppliedResearch/MARP_API#142
repos: [marp-api]
status: design
needs: []
---

# A test never touches data it did not create

Design specification for **MARP_API#142**.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.**

## The requirement, in the human's words

> *"We need to make sure that none of our tests ever destructively hurt the data if I ever
> accidentally run the test on the production server. I wanna make sure that none of the
> data currently in the production server actually gets changed or mutated in any way…
> that means if the suite adds rows and needs to remove them afterwards, like, come on.
> Think."*

**This is a stronger and simpler rule than the one I first wrote**, and it replaces it. The
first draft asked whether to watch a net row count and whether leftover rows should merely
be *reported*. Both were wrong. The rule is:

> **A test may create rows and must remove them. It may never modify or delete a row it did
> not create.** After a suite runs, the database holds exactly what it held before.

That is the whole specification. It holds whatever the suite is pointed at — a scratch
database, the development corpus, or, by accident, production.

## What happened, which is only the symptom

`npm test` against the development corpus on 2026-09-11 passed — 44 suites, 612 tests, 0
failed — and left the database different:

```
observations               2094  ->  2093     one destroyed: 1233, CAMPA2026, Dive 28
observation_reviews         219  ->   427     208 left behind
observation_review_current  209  ->   359     150 left behind
```

The deletion is the alarming half. The 358 rows left behind are the same fault: a suite
that does not put the database back.

## What is already true, checked rather than assumed

- **A delete leaves no trace, deliberately.** `repository/mosaic-commit.repository.js`: *"no
  provenance row, nothing recording who or when"*. So there is no audit trail naming the
  caller, and that is correct for the feature.
- **Reading the tests does not find the culprit.** Every `DELETE FROM observations` in
  `tests/` is keyed on ids the suite created — `mosaic-commit` seeds with
  `addObservations(2)`; `gpu-observation-ingest:375` deletes by `gpu_job_id` but only for
  jobs it tracked. **The guard has to name the suite**, because inspection did not.
- **`setupFilesAfterEnv` runs once per test file** (`jest.config.js:75`), already carrying
  two setup files. That is where a per-suite check belongs, with no new machinery.
- **CI cannot see any of this.** CI builds an empty database, so there is nothing to borrow
  and nothing to lose. The guard is **inert in CI and meaningful only against real data**.
- **The development database is also called `mare_v1`**, the same name as production. The
  only thing distinguishing them is the host, which makes a misdirected `.env` genuinely
  dangerous rather than theoretically so.
- **The rule is already written down and was not enforced.** `CLAUDE.md`: *"A test must seed
  what it asserts."* Five tests were fixed for *reading* borrowed rows; this is one
  *writing* to them.

## Open assumptions

- [x] **A1 · architectural · blocking** — **How is "unchanged" detected?**
  A row count catches a deletion and a leftover insert. It does **not** catch a mutation —
  a test that flips `review_decision` on a real observation leaves every count identical.
  The requirement is that nothing is *changed*, so counting is not enough.
  Candidates: **(a)** per table, `count(*)` plus a digest over the rows —
  `md5(string_agg(...))` of each row's key columns, ordered — compared before and after;
  **(b)** counts plus `max(updated_at)`, cheaper and blind to a delete-and-reinsert;
  **(c)** counts only, accepting that mutations go unseen.
  **Recommendation: (a).** One digest per table catches all three failures at once — a
  deletion, a mutation, and a row added and not removed — because any of them changes the
  digest. It is one query per table and it makes the check exact rather than approximate.

- [x] **A2 · behavioural · blocking** — **Which tables, and what is legitimately exempt?**
  A blanket "nothing changes anywhere" will trip on bookkeeping that is not a defect:
  `service_tokens.last_used_at` and `service_clients.last_used_at` move merely because a
  test authenticated, and sequences advance whenever anything is inserted, by design.
  Candidates: **(a)** every table, with a named exemption list and a comment per entry;
  **(b)** only the tables holding survey data — observations, keyframes, thumbnails,
  sessions, projects, models, species, datasets and the review tables; **(c)** only what
  was lost this time.
  **Recommendation: (a).** An exemption you had to write down is a decision; a table you
  never watched is a blind spot, and the next loss will be in one of those. Sequences are
  not rows and are out of scope either way.

- [x] **A3 · security/permissions · blocking** — **Should the suite refuse to run against
  production outright?**
  The guard above detects after the fact. On production, after the fact is too late — the
  rows are already gone and there is no dump.
  Candidates: **(a)** detection only; **(b)** refuse when the target is not local —
  anything but `127.0.0.1`/`localhost` — unless an explicit variable overrides;
  **(c)** refuse unless the database carries a marker row saying it is disposable.
  **Recommendation: (b), together with A1.** It is a few lines in the Jest global setup, it
  costs nothing on every machine that already runs the suite locally, and it turns *"if I
  ever accidentally point it at production"* from a catastrophe into an error message. (c)
  is stronger but every existing database would need marking, including this one.
  **Detection and refusal answer different halves and this phase should do both.**

- [x] **A4 · behavioural · non-blocking** — **What happens to a suite that fails the check?**
  Recommendation: the suite fails, naming the table, what changed, and the file — a test
  that leaves the database different is a failing test even when its assertions passed.
  Exiting 0 on a known change is exactly how 358 rows and one deletion went unnoticed for a
  whole run.

## Decisions

**A1-A4 settled by me on 2026-09-11, at the human's direction** — *"you wrote this issue and
I don't even know what you are talking about with these blockers, so decide and do it."*
That is a fair correction: these were questions about an implementation I had specified from
evidence I gathered myself, not questions about MARP. They are recorded so the reasoning
survives, not to claim anybody approved them.

- **A1 — a digest per table.** `count(*)` plus `md5(string_agg(...))` over each row's
  columns, ordered, captured before and compared after. Counting alone cannot see a
  mutation: a test that flips `review_decision` on a real observation leaves every count
  identical. One query per table catches a deletion, a mutation and a leftover insert with
  the same check, because any of them moves the digest.
- **A2 — every table, minus a written exemption list with a reason per entry.** An exemption
  somebody had to write down is a decision; a table nobody watched is a blind spot, and the
  next loss will be in one of those. Known exemptions to start from:
  `service_tokens.last_used_at`, `service_clients.last_used_at` and `users.last_used_at`
  move because a test authenticated, which is bookkeeping rather than a defect. Sequences
  are not rows and are out of scope.
- **A3 — refuse a database that is not local, and detect regardless.** The suite refuses
  when the host is anything but `127.0.0.1` or `localhost`, unless an explicit variable
  overrides it. Detection is too late on production — the rows are already gone and there is
  no dump. This matters more here than it would elsewhere: **the development database is
  also called `mare_v1`**, the same name as production, so only the host tells them apart
  and a misdirected `.env` is genuinely dangerous.
- **A4 — the suite that broke it fails**, naming the file, the table and what changed.

Settled by the human, 2026-09-11, and recorded here because they replaced questions I
should not have asked:

- **Rows the suite adds are removed by the suite.** Not reported, not tolerated. *"If the
  suite adds rows [it] needs to remove them afterwards."*
- **Observation 1233 is not restored.** *"Right now that's just in the testing data."* It is
  recorded as lost and the phase moves on.
- **The rule is about mutation, not only destruction.** Nothing already in the database
  changes in any way.

## Requirements

- **R1** — After any test file runs, every watched table holds exactly the rows it held
  before: none deleted, none modified, none added and left behind.
- **R2** — A suite that breaks R1 **fails**, naming the file, the table, and what changed.
- **R3** — The watched set is every table, minus a written exemption list with a reason per
  entry. Per A2.
- **R4** — The suite refuses to run against a database that is not local, unless explicitly
  overridden. Per A3.
- **R5** — The guard is inert against an empty database, so CI stays green for the right
  reason.
- **R6** — The guard has its own test: a deliberately destructive fixture suite is caught,
  and a deliberately mutating one is caught. A guard nobody has watched fail is not a guard.
- **R7** — The guard costs no meaningful time against the suite's current 82 seconds.
- **R8** — Nothing in this phase deletes, alters or restores corpus data.

## Out of scope

- **Finding and fixing the specific destructive test.** The guard makes it findable — the
  next full run names it. That is the follow-up, and it may be one line.
- Pointing the suite at a database built from a dump (#125, #132).
- The 358 review rows already left in the corpus. R1 stops the next ones; cleaning these is
  separate.
