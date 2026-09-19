# 62 — verification

## What was run

`npm run test:observations` — **60 passed, 0 failed, 5 suites, no suite-level failures.**
`npm run test:mosaic` — **274 passed, 0 failed, 7 suites, no suite-level failures.**

Four tests are new, in `tests/observations.test.js`, at the HTTP tier because that
is the path the annotation GUI takes and the defect was in what the repository sent
rather than in what the model declared:

| Test | Proves |
| --- | --- |
| takes the id from the sequence, so the two stay together | R1 |
| leaves the sequence at or ahead of the table maximum | R2 |
| gives two simultaneous creates different ids | R3 |
| ignores an observation_id the caller supplies | R4 |

## Proven red before green

The repository was reverted to `develop`'s version, the new block run, and the
tripwire failed:

    Tests: 3 passed, 1 failed, 6 skipped, 10 total
    ✗ Who assigns an observation id (#62) > takes the id from the sequence, so the two stay together

Then restored. **Only one of the four goes red**, and that is worth saying rather
than implying all four are tripwires: R4's test passes under the old code too,
because `max(observation_id) + 1` also overwrote a caller's id; it is a guard
against a future regression rather than a demonstration of this one. R2 and R3 need
a run with real concurrency and a drifted sequence to fail, which is the state this
migration removes.

## The mosaic suite is the real evidence

Before, on `develop`, with the sequence 10,478 behind:

    npm run test:mosaic        133 passed, 141 failed

After:

    npm run test:mosaic        274 passed, 0 failed

Every one of the 141 failed inside `addObservations`, a helper that inserts with the
column default. `tests/dataset-observations-cascade.test.js` went 0/3 to 3/3 the
same way.

## The migration

Run against development:

    [observations sequence] max_id 18040, sequence 18040 -> 18040.
    The next observation takes 18041.

Run twice (undo, then up again) to confirm it is idempotent, and it reports the
no-op `down` honestly rather than pretending to reverse.

**Not verified against production**, and it cannot be from here. Production has
never advanced this sequence either, so the migration's `up` is what stops the first
insert after deploy from colliding — that is the half of this change that cannot be
done in code, and it should be watched on the release.

## Note on the corpus guard

Both groups ran clean, including the guard — the first fully clean run of the night.
Earlier runs reported `gpu_workers` and `service_tokens` modified by the live pool;
that traffic happened to be quiet here. The environmental noise is unchanged, not
fixed.
