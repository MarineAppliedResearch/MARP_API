# 223 — A seeded species list must work without a deploy

**Issue:** MarineAppliedResearch/MARP_API#223
**Branch:** `223-seeded-species-list-needs-no-deploy` off `develop`

## The defect

Seeding a model's annotation vocabulary is a script and takes effect at once.
Deciding which list a session reads against was a frozen object literal in
`db/species-lists.js`, which takes effect on the next restart.

Between those two moments a job runs, uploads its artifact, reports `succeeded`
and writes nothing: `checkSessionTypeAgainstModel` calls `unreconcilable()`
because the session's type resolves to no list.

It happened twice on 2026-09-18 — `MBARI_315k` and `MBARI_Megalodon`. 133
observations were recovered by hand. Nothing warned; the sessions simply sat
empty while the jobs said they had succeeded.

## Requirements

- **R1** A session type that names a seeded species list resolves to it, with no
  code change and no restart.
- **R2** The static map still answers first, so every type whose list is called
  something else keeps its meaning — `Invert` → `Inverts`,
  `Substrate60Second` → `Substrate_60Seconds`,
  `MBARI_Benthic` → `MBARI_Benthic_Supercategory`.
- **R3** A type that names nothing still resolves to null, and the ingest still
  refuses. An observation is never attributed to a list nobody chose.
- **R4** A name that is not a list with species on it does not resolve. Naming an
  empty list would point the mosaic's correction picker at nothing.
- **R5** The mosaic's `species_list` column resolves the same way, or a new
  model's sessions are ingestible and un-reviewable.

## Open assumptions

- [x] **scientific / data-meaning, blocking** — is "the session type is the name
  of the list" a rule MARP is willing to adopt for new vocabularies? *Answered by
  the existing data: `Fish`, `Habitat`, `Inverts`, `GULF_Fish`, `GULF_Inverts`,
  `FathomNet_VME`, `FathomNet_Trash`, `MBARI_315k`, `MBARI_Megalodon` and
  `NOAA_Sea_Urchin` already read this way. Only `Invert`, `Substrate60Second`,
  `MarineDebris` and `MBARI_Benthic` differ, and all four are in the map.*
- [x] **architectural** — should the mapping become a table instead? *No. A table
  is a migration, a seeder and a second place to forget; the lookup answers the
  same question against rows that already have to exist for the model to run at
  all. Revisit if a list ever needs two session types.*

## Not in scope

The ingest still refuses a session it cannot resolve, and that stays. This makes
the resolution work without a deploy; it does not make an unresolvable session
succeed.
