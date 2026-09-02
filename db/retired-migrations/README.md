# Retired migrations

These nine migrations are **not run any more**. They are kept for reference
only, and they are deliberately outside `migrations/` so that Sequelize cannot
find them.

Their work is already in `db/baseline/schema.sql`. That baseline is a
schema-only capture of the production database, which had exactly these nine
applied when it was taken — so restoring the baseline *is* running them, and
running them again would fail on the first table that already exists.

```text
20230130193608-create_schemas
20230130193718-create_metaInfo_table
20230201183600-remove_Capital_tableFrom_metainfo
20230705191207-add_PobsID_record_to_Observations
20231016171935-add_60SecondSubstrateData
20231019182032-rename_peddle_to_pebble
20241111192533-create-keyframes-table
20251020190232-create-ml-models-tables
20251020202725-add_confidence_to_observations_and_keyframes
```

## Why retire them rather than delete them

They are the only written record of how several tables reached their current
shape. `rename_peddle_to_pebble` explains a column name that otherwise looks
like a typo; `add_PobsID_record_to_Observations` explains a column whose
purpose is not obvious from the schema. Reading them is sometimes the fastest
way to understand why the database looks the way it does.

## Why moving them is safe

Databases that already exist — production, and any development server — have
these nine names recorded in their `SequelizeMeta` table, and those rows now
name files that are no longer on disk. Sequelize tolerates that: it reports
them as applied and looks only for files *not* in the ledger. Verified against
a real database carrying all 28 rows with only 19 files present — 28 reported
applied, nothing pending, no error.

So a fresh database and an existing one run the same command and reach the same
place:

```bash
npx sequelize-cli db:migrate
```

On a fresh database that applies all 19. On production it applies the 19 it has
not seen. Neither needs a special case.

## What this costs

`db:migrate:undo` can no longer walk back past the baseline. That is inherent
to having a baseline at all, not a consequence of where these files live.

## Do not add to this directory casually

A migration belongs here only once **every** database that matters already has
it applied and the baseline has been recaptured to include it. Retiring one
before then would leave a database unable to reach the current schema by any
route.
