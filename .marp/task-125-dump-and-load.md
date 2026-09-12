---
task: MarineAppliedResearch/MARP_API#125
repos: [marp-api, marp]
status: implementing
needs: []
---

# Dump and load the development corpus

Design specification for MARP_API#125. Cross-repository: the verbs are wired in the
umbrella (`MarineAppliedResearch/MARP`), the work is in this repository.

## Goal

A person with a development database holding real work can take a copy of it and put that
copy back, or into a second database, and get a system that can be logged into and reviewed
in without any further setup. Today they cannot: the corpus exists on exactly one computer,
there is no backup, and the umbrella's `CLAUDE.md` therefore forbids `marp db destroy`
outright.

## Requirements

- **R1** — `marp db dump` writes a loadable copy of the whole database, every table, to a
  destination on this machine.
- **R2** — The dump also carries the extracted thumbnail files, because a dump of the rows
  alone restores a corpus whose every tile is a broken pointer — which looks restored and
  is not.
- **R3** — `marp db load <dump> <thumbnails-dir>` puts both halves into the database that is
  already running. It does not stand up a second cluster and does not touch `.postgres/`.
- **R4** — A load into a database that already holds a corpus **refuses**, and the refusal is
  the default. Nothing is destroyed to find out.
- **R5** — A load is a dry run unless `--apply` is passed, and prints what it would destroy
  before it is asked to destroy it.
- **R6** — After a load, the tool itself compares the row counts it produced against the
  counts recorded when the dump was taken, and fails on a mismatch. A dump that cannot be
  loaded is not a backup, so the round trip is checked by the tool rather than by hand.
- **R7** — The dump carries users, `auth_identities`, permissions and `service_tokens`, so a
  loaded database can be logged into and the worker and operator tokens authenticate.
  Settled by the human: *"I want a database that I could just load and start testing on right
  away without doing any setup on."*
- **R8** — No host, port or password is written into any tracked file, or into the dump's own
  manifest. The connection comes from the `DB_*` environment the rest of this repository
  reads, and documentation points at `marp db status` rather than restating a value.
- **R9** — Where a dump is on a given machine is recorded in `.marp/local/`, which is
  git-ignored, so an agent told "load the corpus" can find it without being handed the path.

## Open assumptions

- [x] **A1 · security/permissions · blocking** — answered in #125 by the human: the dump
  carries credential material (users, `auth_identities`, `service_tokens`) because removing
  it turns *load and go* back into *load and then redo the setup*. Handling note, not a
  requirement: the file stays on the machine that made it and is never committed, attached to
  an issue, or passed around.
- [x] **A2 · destructive · blocking** — answered here: a load refuses rather than replaces.
  #125 says only *"loading replaces whatever is there, so it should say so plainly before it
  does it"*; that is not enough for a corpus with no backup, so this specification is
  stricter than the issue. Two guards, guarding different things: `--apply` means *write at
  all*, `--force` means *yes, destroy the corpus that is in there*. A bare
  `marp db load <dump> <dir>` changes nothing, ever.
- [x] **A3 · architectural** — answered here: `pg_dump -Fc` custom format, restored with
  `pg_restore`. One file, compressed, and `pg_restore -l` can list it without loading it.
  Plain SQL was the alternative and was rejected: a data dump is `COPY ... FROM stdin`, which
  the `pg` driver cannot execute, so it would need `psql` anyway and would be 19 MB
  uncompressed.
- [x] **A4 · environment** — answered here: this repository is not told where `.postgres/` is.
  It finds `pg_dump`/`pg_restore` through `PG_BIN` (or `PG_DUMP`/`PG_RESTORE`), defaulting to
  `PATH` — the same shape as `FFMPEG_PATH` in `config/thumbnails.js`. The umbrella sets
  `PG_BIN` when it calls in, exactly as it already sets `DB_*`.
- [x] **A5 · behavioural** — answered here, and #125 asked for it to be stated:
  **restore-then-migrate** is the supported path for a dump older than the schema. A full
  dump carries `SequelizeMeta`, so `npx sequelize-cli db:migrate` after a load applies only
  what has landed since. A dump is therefore known-stale-but-usable rather than a surprise.
- [ ] **A6 · data-meaning · non-blocking** — `observation_thumbnails` is not the only table
  whose rows point at files under `storage/`. `species_pictures` (646 rows, 49 MB) and
  `artifacts` / `gpu_artifacts_staging` (25 rows each, 3.6 MB) have the same shape, and a
  load restores those rows without their files. The settled interface in #125 is two inputs —
  a dump and a thumbnails directory — so that is what is built, and this is named rather than
  guessed at. `species_pictures` is a pre-existing gap: the baseline already restores those
  rows on any fresh `marp db up` without the images.

## Decisions

- **2026-09-11** — The umbrella wires the verb; this repository does the work. Same boundary
  `marp db up` already keeps by calling `scripts/init-database.js` rather than holding a
  second copy of the schema. `db.ps1` and `db.sh` gain `dump` and `load`; the dumping and
  loading live in `scripts/dump-corpus.js` and `scripts/load-corpus.js` here.
- **2026-09-11** — The emptiness test looks at the tables a corpus is made of, not at the
  whole database. `species` (854) and `permissions` (27) come from the baseline and `users`
  gains the bootstrap administrator, so "any row anywhere" would refuse every fresh
  `marp db up` and teach people to pass `--force` by reflex.
- **2026-09-11** — Restore is `--clean --if-exists --no-owner --no-privileges`. `--clean`
  because the usual target is a database `marp db up` has already given a schema to, where a
  plain restore fails on every `CREATE TABLE`; `--no-owner --no-privileges` because the role
  name on the machine doing the loading is not the dump's business.

## Plan

1. `scripts/dump-corpus.js` — count, `pg_dump -Fc`, copy the thumbnails, write a manifest,
   record the path in `.marp/local/`.
2. `scripts/load-corpus.js` — inspect, refuse, dry run, restore, copy thumbnails back, then
   re-count and compare against the manifest.
3. Umbrella: `dump` and `load` in `scripts/db.ps1` and `scripts/db.sh`, passing `DB_*` and
   `PG_BIN` in exactly as `up` already passes `DB_*`.
4. Round trip proven into a **second** database on its own port. Never into the corpus.

## Acceptance criteria

- `marp db dump` produces a directory holding a dump file, the thumbnails, and a manifest.
- `marp db load` into that second database reproduces the counts the manifest recorded.
- `marp db load` into a database that holds a corpus refuses, and has changed nothing.
- No tracked file names a host, a port or a password.

## Test plan

Unit tier for the parts that can be seen without a database — the corpus-table list, the
manifest round trip, the refusal decision. The refusal and the count comparison are the two
things that matter and both are observable there.

The round trip itself is the database tier and is run by hand into a second database
(`marp db up --port` with its own `-DataDirName`), because it is the only tier that can see
whether a dump is loadable at all.

## Status

- **Gate:** verifying. `.marp/verification.md` carries the plan and the real results.
- **Notes:** A GPU inference run was writing to the corpus while this was built, so the
  dump taken to prove the tooling is a snapshot of a moving target. That is fine for testing
  the tool and is **not the real dump** — the real one is the human's to take when the run
  finishes.

  Two things left for the human rather than decided here. The umbrella's `CLAUDE.md`
  warning that #125 asks to edit down is **not on `origin/develop`** — it sits on an
  unpushed local commit on the umbrella's `develop`, so this branch cannot see it and
  editing it from here would conflict. And A6 above names three other tables whose rows
  point at files under `storage/` that a load does not carry.
