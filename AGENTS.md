# marp-api — agent instructions

The MARP API and application backend. One component of the [MARP
platform](https://github.com/MarineAppliedResearch/MARP).

**This file is the source.** `CLAUDE.md` and `.github/copilot-instructions.md` point here;
they hold only what is specific to one tool. The shared block below is synced from the
umbrella — edit `MARP/AGENTS.md` and run `marp harness sync`, never this copy.

<!-- marp:shared start -->
<!-- Canonical source: MARP/AGENTS.md. Do not edit this block in a component repository;
     edit it here and run `marp harness sync`. -->

## The platform

MARP is a polyrepo. `services/repos.yml` in the umbrella repository is the registry of
what MARP consists of, and it is authoritative — including for which branch to work on.

**Start from `repos.yml`'s `default_branch`, not from GitHub's default branch.** They
differ deliberately. `master` in this platform means *what is in production*, and
production is promoted by hand, so `master` can be far behind and that is not decay. Work
happens on `develop` where a repository has one.

Branch model is Gitflow: `master` is production, `develop` is integration, and every task
gets its own branch off `develop` named for its issue (`68-mosaic-review-prototype`).
Never commit directly to `master` or `develop`.

## Rules that are not negotiable

- **Commit authorship is the human developer only.** Never add an AI assistant as author
  or co-author, never add a `Co-Authored-By` trailer, and never mention an assistant or
  vendor in a commit message, PR title, or PR body. This applies to merge and squash
  commits too.
- **Never commit `.env` files, credentials, tokens, keys, or host passwords.** Each
  repository has a `.env.example` documenting variable *names*. Operational detail for a
  specific machine goes in `.marp/local/`, which is git-ignored.
- **The production database is a scientific record.** `mare_v1` holds years of annotation
  that is queried and reported on by people and tools outside this workspace. Any
  transformation of existing data must either preserve everything currently possible or
  lose nothing — a column that stops being populated, a value that becomes ambiguous, or a
  format an existing query no longer parses all count as loss, even when the application
  still works. Derived columns are part of the contract.
- **Ask about meaning rather than inferring it from the data.** How a field is meant to
  work, what an empty value means, whether two similar rows are one thing or two — these
  are answerable by the person who recorded them and not reliably by inspection.

## Keep commit messages short

Subject under ~72 characters plus a few one-line bullets. Reference the issue with
`Refs #NN` or `Closes #NN`. Cross-repository work references the other side in full:
`MarineAppliedResearch/MARP_API#68`.

## The workflow, and where it stops for a human

```
G0  Intake      read the task, this file, and the repository's decision records
G1  Design      investigate -> write .marp/task.md -> surface assumptions
    GATE          the human answers. Nothing is implemented while a `blocking`
                  assumption is open. This is enforced, not requested.
G2  Implement   implement the settled spec. Fast, autonomous, no questions --
                  unless a NEW material assumption appears, which returns to G1.
G3  Test plan   write .marp/verification.md: what will be tested, which
    GATE          requirement each test proves, and what is NOT covered.
                  The human reviews the PLAN before anything is run.
G4  Verify      run the approved verification, record real results including
    GATE          failures, verbatim. The human reviews the evidence.
G5  PR          opened only when the human says so. Never automatically.
G6  Merge       CI green plus human approval.
```

`.marp/task.md` is the task specification and it lives on the task's own branch, so it
travels with the code and appears in the pull request. `.marp/task.template.md` is the
skeleton. Durable decisions are promoted out of it into decision records
(`docs/decisions/` for one repository, the umbrella's `architecture/decisions/` for
anything spanning two).

## Surfacing assumptions is the point

Agents make plausible but incorrect assumptions, and a material assumption must never
silently become an implementation decision. During G1, write down anything of these kinds
that the task does not settle:

behavioural · product/UI · scientific or data-meaning · database/schema · API contract ·
architectural · performance/concurrency · security/permissions · destructive operations ·
cross-repository integration · environment

Each goes in `## Open assumptions` in `.marp/task.md` as a checklist item tagged with its
category and whether it is `blocking`. `marp spec check` fails while a blocking assumption
is unticked, which is what actually stops G2 from starting.

Trivial local choices that follow an established pattern in the repository are not
assumptions. If you are unsure whether something is material, the test is: *would a
different reasonable answer change the behaviour, the schema, the interface, or the
data?* If yes, it is material.

Discovering a new material assumption during G2 is normal and is not a failure. Append it,
say so, and stop — do not guess to preserve momentum.

## Working in parallel

Several agents can work at once, and the model is the ordinary one: **each works on its own
branch, in its own copy of the repository, and pushes that branch when the work is done.**
Branches are merged the usual way. The only extra requirement is that two agents must not
collide over the things a running MARP needs.

```bash
marp agent start marp-api 71-thumbnail-lifecycle
```

That gives the branch its own copy, its own database on its own port, its own API port, a
written `.env`, and its dependencies installed — so it can run and test without touching
anybody else's. `marp agent list` shows what is set up and where; `marp agent env <branch>`
prints the settings again; `marp agent remove <branch>` throws the copy away and **keeps
the branch**, because tidying up and discarding work should never be the same command.

On a second machine there is nothing to set up: clone the repository, check out the branch,
and it is already isolated. The command exists for putting several on one machine.

Two things are deliberately shared:

- **Jellyfin.** Every agent talks to the central MARP media server. It holds the real
  library, and the tests that touch it read far more than they write. A task that genuinely
  needs its own instance says so; nothing else should.
- **The PostgreSQL binaries**, downloaded once. Only the data directory is per-agent.

**Parallelism comes after the design is settled, never before.** Two agents each doing
their own investigation on overlapping surface is how two incompatible interpretations of
MARP get built. One agent settles the assumptions with the human; then the work fans out.

## Testing doctrine

Learned the expensive way, and it holds everywhere in this platform:

- **A defect is not fixed until it has a named test at a tier that can actually observe
  it.** Several defects here were reported twice because the first fix was verified at a
  tier that structurally could not see the bug. Store-level checks cannot see what was
  drawn; unit tests cannot see what a browser rendered.
- **A test that narrates a result without asserting it can lie.** This applies to
  walkthrough videos especially: a scene that says "the tile is now excluded" and only
  asserts that a panel opened will pass for weeks while excluding nothing.
- **Run the fast tiers after every change.** Parse and unit checks cost about a second.
  Do not run slow browser, database or hardware suites for routine feedback; they belong
  to the person working, and to G4.
- **A skipped suite looks green.** Prerequisites missing should fail, not skip.

## Documentation that states an environment fact

**Point at the command; do not restate the value.** A host, a port, a path or a version
written into prose goes stale silently and an agent cannot tell. Write *"run `marp db
status` to see yours"* rather than naming a host and port.

This is not a style preference. The umbrella's own `CLAUDE.md` once described the database
in two contradictory ways sixty lines apart, and an agent resolved the contradiction toward
the stale half and built a plan on it. `marp harness check` now greps tracked instruction
files for environment literals and retired markers.

The same rule retires any document that promises to stay in sync with code it cannot
observe. Do not write a `## Current API` section by hand; point at the generated contract.

## How corrections become durable

When a human corrects an agent, the correction should make the same mistake less likely
next time. Route it by this ranking:

> **A correction becomes a check if it possibly can, a test if it cannot be a check, and a
> sentence only if it can be neither.**

| The correction is about | Where it goes |
| --- | --- |
| what the system should do | `.marp/task.md` requirements, plus a test naming that requirement |
| a decision that constrains future work | a decision record |
| how agents should work, everywhere | this shared block |
| a rule for one area of one tree | `.github/instructions/*.instructions.md` |
| a defect | a named test at the tier that can see it |
| a mechanically checkable invariant | `marp doctor` or `marp harness check` or CI |
| something an agent should not do | a hook or a permission rule |

## Permissions

**Free:** read anything, search, run parse/unit/contract tiers, write to a task branch,
write `.marp/*`, commit locally, query a local disposable database, read the GitHub API.

**Ask first:** `git push` · opening a pull request (this is gate G5) · migrations against
anything but a local disposable database · any write to a shared database · adding a
dependency · editing generated output by hand · changing a published contract surface.

**Never without the human present:** anything against production `mare_v1` · the live
Jellyfin service and its configuration · force push · branch deletion · rewriting
published history · restoring anything from a `retired-migrations` directory · rotating
credentials.

## Working style

The human is the programmer; the agent is the assistant.

- Do not race ahead, and do not design large systems without checking direction.
- Work one milestone at a time. If asked for a test, give exactly that test and wait for
  the result before moving on.
- If a failure is reported, focus on that failure. Do not pile on unrelated improvements.
- **Report a failure the moment you see it.** Do not silently run diagnostics while
  somebody waits, and never present a partial result as a finished one.
- State assumptions explicitly. If several interpretations exist, present them rather than
  picking silently. If a simpler approach exists, say so.
- Minimum code that solves the problem. No speculative features, no abstractions for
  single-use code, no configurability that was not asked for.
- Touch only what the task requires. Do not reformat, refactor or "improve" adjacent code.
  Match the existing style even where you would do it differently. Remove only the imports
  and variables your own change orphaned.
- Comments: many short ones rather than a few long ones, about two lines on average, and
  they explain *why* far more than *what*.

<!-- marp:shared end -->


## This repository

## Running anything

**Run node from the repository root.** `dotenv` resolves `.env` against the working
directory, so a script run from elsewhere connects to whatever the defaults are and
fails with `ECONNREFUSED`. That looks exactly like the database being down, and it is
not.

```bash
cd MARP_API
npm run dev                      # nodemon, or F5 in VS Code
npm test
npx sequelize-cli db:migrate:status
```

Node is pinned in `.nvmrc` and installed via nvm-windows. A shell started before nvm
was installed needs `C:/nvm4w/nodejs` prepended to `PATH`.

## The development database

**Run `marp db up` from the umbrella workspace.** It produces a self-contained PostgreSQL
for development — no installer, no administrator rights, no VM, no container — and finishes
by having this repository load its own schema into it.

```bash
marp db up                # scripts/marp.ps1 db up   /   sh scripts/marp.sh db up
marp db status            # where yours is listening, and what is in it
marp db env               # the DB_* lines to paste into .env
marp db up --port 5440    # a second database, for a second worktree
```

**Do not write a host or a port into documentation here.** `db env` prints the current
values and `db status` reports them. A host or port written into prose goes stale silently
and an agent cannot tell it has — several files in this repository were wrong about the
database for months for exactly that reason, and `marp harness check` now fails on it.

marp-api never learns where its database came from. It reads five `DB_*` variables and has
no idea what is serving them, so pointing it at any other PostgreSQL is exactly as
supported as it ever was; `db up` is one way to satisfy them and need never be run.

The development VM that used to serve this role is being retired. Anything that still
describes it is history, not instructions.

## The migrations cannot build a database

`observations`, `projects`, `sessions` and `metaInfos` have no `createTable`
migration anywhere. They predate the migration history and every migration that
touches them assumes they exist, so `db:migrate` against an empty database fails
immediately.

`db/baseline/schema.sql` is the starting point they assume -- a schema-only
capture of production, no observation data. Against an empty database:

```bash
node scripts/init-database.js     # baseline: 23 tables, 4 views
npx sequelize-cli db:migrate      # 19 migrations
```

Verified: this produces a schema identical to the development server's -- 35
tables and views, 447 columns, 77 indexes, 204 constraints, 4 view definitions.

Three things follow that are easy to get wrong:

- **`migrations/` holds 19 files, not 28.** The nine already in the baseline are
  retired to `db/retired-migrations/`, where Sequelize cannot see them. Moving
  one back would break every fresh database.
- **Existing databases keep 28 ledger rows, nine naming files that are gone.**
  Sequelize tolerates that -- reports them applied, and looks only for files not
  in the ledger. So production and a fresh database run the same `db:migrate`
  with no special case.
- **The baseline is not a migration, deliberately.** A migration numbered before
  the others would be run against production and recorded in its ledger for no
  benefit -- production already has this schema. Keeping it a script means the
  migration history means one thing only: the upgrade path.

Recapturing the baseline and retiring a migration are one operation: the
baseline must contain a migration's work before that migration moves. Strip
pg_dump's `\restrict` / `\unrestrict` lines on recapture so the file stays
executable by the `pg` driver without psql.

## Tests

**The suite runs in CI**, against a PostgreSQL built from `db/baseline/schema.sql` plus
the migrations — the same sequence `marp db up` uses. 210 of 227 run there; the 17 in
`tests/jellyfin.test.js` are excluded by name because they drive the central media server,
which a runner cannot reach. **Run those locally before merging anything that touches
Jellyfin** — CI cannot tell you they broke. It is 227 for 227 on a database with
no data in it, which is what makes that job meaningful. If you add a test that depends on
rows the development server happens to hold, seed them in the suite; see
`tests/species-lists.test.js`, where a block used to fail in one place and pass vacuously
in three.

**`npm test`, not `npx jest`.** The suite runs against the real development
PostgreSQL, and `package.json` passes `--runInBand` for that reason. Running Jest
directly lets workers race each other over one database and produces a wave of
failures that look like real breakage — 27 suites failing on a green codebase, in one
case.

Every route requires a permission (see below), so an anonymous request gets 401 and
nothing else. `tests/setup/authenticated-agent.js` builds a per-file fixture user
holding every permission and leaves it on `global.api`; use that rather than
`request(app)`. The exceptions are suites that deliberately test the refusals —
`auth`, `v2_users`, `v2_tokens`, `v2_species` — which build their own narrow users.

**The custom reporter swallows `console.log`.** Debugging a test by printing does not
work; assert the value instead, or run the code outside Jest.

## Every route is authenticated

There are no V1 routes. `routes/lib/register-versioned-route.js` takes a route
declared with its old V1 path plus the permission it needs and registers it once, at
`/api/v2/...`, behind `requirePermission`. Permission keys are seeded by
`migrations/20260901130000-seed-resource-permissions.js` and granted to nobody by
default.

An application that is not a browser needs a token:

```bash
node scripts/create-application-token.js --preset annotation-gui \
  --app "MARE Video Processing GUI"
```

It prints the token once. `--presets` lists the recorded permission sets.

## The timecode columns

`mediaPosition`, `actualPosition`, `tc`, `etc` and `frame` on `observations` are all
`varchar(255)` holding .NET `TimeSpan` text, written by the annotation GUI.
**Use `db/timecode.js`. Never re-implement the arithmetic.** Two subtleties, both
found by accident rather than by reading:

- Ticks truncate to whole milliseconds, because `TimeSpan.Milliseconds` does.
  Rounding instead moves 7,501 frame indices by one and carries `.9995` into the next
  whole second.
- A negative value formats as `-17:36:09.0800000`, with the sign in front of
  everything. A parser that only accepts it in front of a day component cannot read
  back what this module writes.

`observations.frame` is a sub-second index, 0..24. `keyframes.framenum` is an
absolute frame number from media time. Two different quantities sharing a name;
conflating them nearly rewrote the wrong column. Frame rate is assumed to be 25
throughout — see `VIDEO_PROCESSING_GUI#221`.

## Data migrations

The production database is a scientific record; the umbrella `CLAUDE.md` says what
that means. Every data migration wraps its work in `db/data-integrity.js`, which
counts rows and foreign-key references before and after and refuses to commit if
anything was lost, and carries a `down` that restores what it changed.

## Primary keys are assigned inconsistently

`repository/observation.repository.js` sets `observation_id` itself as
`max(observation_id) + 1`; keyframes let the column default assign. So
`db.observations.create({...})` fails — the model declares the key without
`autoIncrement`, so Sequelize sends an explicit null — and the `observations`
sequence sits unused and drifts behind the table. Insert with SQL if you need to
create one outside the repository. Tracked in #62.

## Documentation is generated and tracked

`docs/openapi.generated.json` and `docs/developer/` are committed, so a route change
needs them rebuilt or the diff is a lie:

```bash
npm run docs:build
```

Served at `/api-docs` and `/developer-docs`. Route documentation is code-first
through `docs/openapi-route-registry.js`; shared schemas, security schemes and error
responses live in `docs/openapi.js`.

## The frontend applications

`app.js` serves any folder under `frontend/apps/` by name, with shared assets under
`frontend/shared/`. Adding an app is a folder, not a route. Gating one behind a session
is a `requirePermissionSession` line registered *before* the static mount, the way
`/apps/dashboard` already is.

Each application owns its own test suite so it can be extracted into its own repository
later without untangling anything. `npm run test:apps` from here runs them all.

**`frontend/apps/marp-mosaic-review/CLAUDE.md` holds that app's architecture notes** —
the layering rule, the one-way data flow, and the invariants that will bite (the grid's
layout feedback loop, request sequencing, why a committed page keeps its membership,
why a mark is not a decision). Read it before changing anything structural there. Its
`README.md` covers running it and recording walkthrough videos.

That app is the MARP Picture Mosaic Reviewer, designed in #68, which also carries the
phased plan for the schema and endpoints it will need. None of that schema exists yet:
the app runs entirely against a fixture, and its `src/data.js` is the seam where the
API will arrive.

**The schema decisions are settled** — see *The schema decisions* in #68, answered
2026-09-05. The ones that change what gets built: a review belongs to the reviewer, so
`observations` gains a review *table* rather than a `review_status` column; a species
correction edits the observation; Delete is a real permanent delete with no soft-delete
marker; page membership is query-derived, which makes deterministic ordering with an
`observation_id` tie-breaker a hard requirement on every query; and the existing
permission model is used initially, so no new permission keys are seeded.

Server-side pagination and adjacent-page prefetching are part of that design, not a
later optimisation: the mosaic runs over hundreds of thousands of rows and must never
fetch the whole matching set to page through it.

## Known gaps

- Four moderate dependency advisories on `develop`, all in the sequelize chain, where
  npm's suggested fix is a downgrade to sequelize 3. Left deliberately; see #58.
- `master` is far behind `develop` and architecturally older. The plan is to promote
  `develop` wholesale rather than backport.
