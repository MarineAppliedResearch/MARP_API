# 223 — verification

## What was run

`npx jest tests/species-lists.test.js` — **32 passed, 0 failed.**

Four of those are new and each names a requirement:

| Test | Proves |
| --- | --- |
| resolves a session type that names a list the static map has never heard of | R1 |
| lets the static map answer first | R2 |
| still resolves nothing for a type that names nothing | R3 |
| does not resolve a list with no species on it | R4 |

The R1 test asserts `speciesListForSessionType(LIST)` is **null** before asserting
the service resolves it, so it cannot pass by the map having been edited — which
is the exact failure mode being removed.

`npm run test:species` — **58 tests passed, 0 failed.**

## What was NOT proven, and why

`npm run test:gpu` and `npm run test:mosaic` cannot currently be trusted on this
machine, and **not because of this change.** Three inference workers are online
and writing to the same database the suite runs against:

- `test:gpu` fails 4–5 of 148, **a different set each run** — lease and long-poll
  tests whose queued jobs are leased by a real worker mid-test.
- `test:mosaic` fails 141 of 274, in `addObservations`, a test helper. The
  `observations` sequence drifts behind the table because the repository assigns
  `max(observation_id) + 1` (#62), so a helper relying on the column default
  collides with rows live ingest is inserting at the same moment.

Both were run on unmodified `develop` by stashing, and produce the same result:
`test:mosaic` is **133 passed / 141 failed on develop and on this branch**, the
same tests. `test:gpu` on develop failed 4, this branch 5, with a different set
each time.

So the evidence says this change adds no failure. It does not say those two
groups are green, and they are not — that is an environment defect worth its own
issue, and it is named here rather than left to be rediscovered.

R5 (the mosaic SQL) is therefore covered by review and by the query parsing, not
by a passing mosaic suite.

## End-to-end

Pending, and it is the real proof: seed a vocabulary whose session type has never
been named in code, queue a job against it, and confirm the observations land
with no restart between the seeding and the ingest.
