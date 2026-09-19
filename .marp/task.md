# 62 — The database owns observation ids

**Issue:** MarineAppliedResearch/MARP_API#62
**Branch:** `62-the-database-owns-observation-ids` off `develop`

## Requirements

- **R1** `observation_id` is assigned by its sequence, not by the application.
- **R2** The sequence is never behind the table, so anything inserting with the
  column default works.
- **R3** Two simultaneous creates get different ids.
- **R4** An `observation_id` supplied by a caller is ignored.
- **R5** `obsID` and `PobsID` keep being assigned by the application. They are
  per-session and per-project numbering, not primary keys.

## Open assumptions

- [x] **database/schema, blocking** — database or application ownership?
  *Answered by Isaac on 2026-09-19: the database owns it. The issue had already
  recommended this; it was recorded as "worth deciding" rather than decided.*
- [x] **destructive operations** — is `setval` safe on production? *It changes no
  row. The migration only ever moves the sequence forward (`GREATEST` of the table
  max and the current value), because a sequence legitimately runs ahead when an
  insert is rolled back, and winding it back would hand out a number a concurrent
  insert may already hold.*

## What was actually wrong

Not the model — it has carried `autoIncrement: true` all along, and the column has
always had `DEFAULT nextval(...)`. #62 says otherwise and is stale on that point.
The repository simply overrode both, every time.

## The measurement that made this urgent

    observations   max=18040    seq=7562    BEHIND by 10478
    keyframes      max=261266   seq=269150  ok

#62 recorded 3 behind. It is 10,478. Every insert relying on the default collided:
`npm run test:mosaic` failed **141 of 274**, and the dataset cascade suite failed
all 3, both inside helpers that insert with the column default.

## Not in scope

`obsID`/`PobsID` (R5). `VIDEO_PROCESSING_GUI#213`, which is where this was first
tripped over.
