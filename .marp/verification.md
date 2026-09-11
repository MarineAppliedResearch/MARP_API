# Verification — MarineAppliedResearch/MARP_API#142

A test never touches data it did not create. The plan below is for review **before** it is
accepted as this phase's evidence.

**What has already happened.** The guard was built and exercised against scratch databases,
and the full suite was run once against a throwaway copy of the corpus to see what it would
catch. Those results are quoted below as evidence for *why the plan is shaped this way*;
`## Results` stays empty until this plan is approved and run.

**Do not run `marp verify plan` against this file.** It drafts a plan from `task.md` and
overwrites what is here. It already destroyed one plan this way.

## The one thing that makes this phase different

**The subject under test is the thing that would destroy the evidence.** Verifying a guard
against corpus loss by running the suite against the corpus is how you lose a second
observation to learn about the first.

So every run in this plan happens against **`mare_guard_test`** — a local database restored
from the 08:20 dump with `pg_restore`, holding 2,094 observations, 29,693 keyframes and
observation 1233, which the corpus itself no longer has. R8 of the spec says nothing in
`mare_v1` changes, and the way to keep that promise is to never point at it.

That is also the shape the platform is moving to anyway: #125 built the dump and the load,
#132 wants the browser tier on a disposable database, and #144 wants walkthrough recordings
on one. This phase is the third consumer of one idea.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `tests/corpus-guard.test.js` drives four fixture suites as a child Jest run | API (jest-in-jest) | The rule holds in all three directions and does not misfire on the fourth. |
| R1, R2 | `deletes-a-row.fixture.js` | fixture | `1 row(s) deleted that the suite did not create (4 -> 3)` — **the case that lost observation 1233**. |
| R1, R2 | `mutates-a-row.fixture.js` | fixture | `row(s) modified, count unchanged at 3` — **the case a row count cannot see**, and the reason the check is a digest. |
| R1, R2 | `leaves-a-row.fixture.js` | fixture | `1 row(s) added and left behind (3 -> 4)` — the 358 review rows already in the corpus. |
| R1 | `tidies-up.fixture.js` | fixture | A suite that creates a row and removes it **passes**. A guard that fails everything is not a guard. |
| R2 | `tests/reporters/summary-reporter.js` gained `onTestResult` | reporter | Without it the run said `1 failed` and never said why — a suite-level failure printed no message at all. |
| R3 | `EXEMPTIONS` in `tests/setup/corpus-guard.js` | review | Every table is watched; each exemption carries its reason. |
| R4 | `tests/setup/local-database-guard.js` as Jest `globalSetup` | review + manual | The suite refuses a non-local `DB_HOST`. `MARP_TEST_ALLOW_REMOTE_DB` overrides. |
| R5 | the suite against an empty, CI-shaped database | API | 25 tests pass, guard silent. CI stays green for the right reason. |
| R6 | the four fixtures above | — | This requirement *is* the guard's own test. |
| R7 | measured overhead | API | 250 ms per test file against the full corpus; ~11 s across 44. |
| R8 | `observations` and `observation_reviews` on `mare_v1`, before and after | review | The corpus is untouched by this phase. |

## What the full-suite run already showed, and why it is in the plan

Run once against `mare_guard_test`, not the corpus:

```
Test Suites : 42 passed, 3 failed, 45 total
Tests       : 623 passed, 0 failed, 0 skipped, 623 total

tests/thumbnails.test.js          - thumbnail_extraction_state: row(s) modified, count unchanged at 1
tests/readonly-endpoints.test.js  - metaInfos: row(s) modified, count unchanged at 1
tests/sessions-by-project.test.js - users: 1 row(s) added and left behind (33 -> 34)
```

**623 tests passed and three suites changed the database.** That is the whole case for the
guard in one line, and it is why fixing those three is in this phase rather than after it:
a guard that leaves `npm test` permanently red would be switched off within a week.

`thumbnails.test.js` is the one worth naming. `thumbnail_extraction_state` is the
extraction worker's running/paused switch, held as a single row — so that suite could leave
the human's thumbnail extractor in a state he did not choose, and nothing reported it.

## What this does not prove, stated plainly

- **It did not find the suite that deleted observation 1233.** The deletion **did not
  reproduce** against the same data: the scratch copy still holds 2,094 observations and
  1233 is still there. So the culprit is non-deterministic — the shape that fits is a query
  that usually matches its own seeded row and occasionally matches a real one. Finding it is
  explicitly out of scope; **the guard is what makes the next occurrence name itself**
  instead of being discovered hours later by counting rows.
- **The guard detects; it does not prevent.** By the time it fires the rows are already
  gone. R4's refusal is the preventive half, and it only covers a non-local host.
- **It cannot see anything outside Jest.** A walkthrough recording writes real review
  decisions through Playwright — sixty of them reached the corpus on 2026-09-11 — and this
  guard is structurally blind to it. That is #144, and **pulling walkthroughs into the
  guarded path would be the wrong fix**: they are not tests.
- **`auth_sessions` is exempted as a whole table**, which by this spec's own argument is a
  blind spot. Every suite logs in and the session store writes asynchronously; the honest
  alternative is the login fixture deleting its own session row, which is racy. Traded
  deliberately, and recorded rather than hidden.
- **One decision in the spec named a column that does not exist.** `users.last_used_at` is
  really `last_login_at`. The implementation used the real name.

## Known gaps

- **CI cannot exercise any of this.** CI builds an empty database, so the guard is inert
  there and R5 is the only requirement CI can confirm. A green pipeline says nothing about
  R1.
- **The exemption list will grow, and each entry is a blind spot.** That is the accepted
  cost of watching every table rather than a hand-picked few; the mitigation is that an
  exemption has to be written down with a reason.
- **`marp harness check` reports `marp-api/AGENTS.md — drifted from the umbrella`**, as do
  all four component repositories. Pre-existing: the umbrella's shared-block changes are on
  its `develop` and have not been promoted to `master`, which is the documented state its
  own `AGENTS.md` describes.
- **`.nvmrc` pins Node 22 and this machine has only Node 24.** Everything ran on 24.

## Manual steps

1. **Point `DB_HOST` at something that is not local and run the suite.** *Expected:* it
   refuses before any test runs, naming the host and the override variable. This is the half
   that answers *"if I ever accidentally run the test on the production server"*, and it is
   worth seeing refuse once.

---

## Results

*Empty until the plan above is approved.*
