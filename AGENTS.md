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
- **"Seed it" means write a seeder, not type SQL.** Anything another machine or another
  person will need again goes in the repository as a migration or a checked-in script that
  can be run twice. Rows typed into a local database by hand exist on exactly one computer,
  are invisible to everybody else, and are gone the next time that database is rebuilt.

  This is written out because of what it cost. A model, a project, a session and seven
  species-mapping rows were inserted by hand here to get the first real inference job
  running. Nothing was committed. The row ids from that database — a model id, a session id
  — then went into instructions for a second machine, where they meant nothing, and an agent
  on that machine had to work out the seeding from scratch before it could run anything at
  all. The work was fine; it was unrepeatable, which made it worthless to anyone else.

  The same rule governs what you then write down: **never quote an id out of a hand-made
  local database as though it were a fact about MARP.** Name the seeder and say to use the
  ids it reports.

## Keep commit messages short

Subject under ~72 characters plus a few one-line bullets. Reference the issue with
`Refs #NN`. Cross-repository work references the other side in full:
`MarineAppliedResearch/MARP_API#68`.

**Never `Closes`, `Fixes` or `Resolves`, in a commit message or a pull request body.** An
issue is closed by a person who has decided it is done — after they have used the thing,
not when a merge succeeds. Closing it is a judgement, and it is theirs.

Those keywords happen not to fire here anyway: GitHub honours them only on merges to the
repository's *default* branch, which is `master`, while work merges to `develop`. Do not
rely on that. It is an accident of configuration, and the rule stands on its own.

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

**Assume you are not the only agent in this repository.** Several may be working at once,
in their own worktrees, on branches stacked on each other, while a human commits alongside
them. Everything in this section exists because that is now the normal case rather than the
exception.

### If you were spawned by another agent

You were given a task, not the whole picture. Before touching anything:

1. **Read this file, end to end, and the repository's own `AGENTS.md` section below it.**
   Not the parts that look relevant — all of it. It carries the gates, the testing
   doctrine, the permissions and the traps, and it is the only thing that makes two agents
   produce compatible work. If your instructions and this file disagree, say so rather than
   picking one.
2. **Read the issue you were given**, and the issues it references. The spawning agent
   summarised it; the issue is the source.
3. **`git fetch` before you branch, and branch from what you were told to branch from.**
   It is often *not* `develop` — stacked work is normal here, and starting from the wrong
   base produces a conflict that looks like a merge problem and is really a reading problem.
4. **Check what else is in flight**: `marp agent list` for workspaces, `git branch -r` and
   `gh pr list` for branches and open reviews.

### Staying out of each other's way

- **Your branch is yours; `develop` is nobody's.** Never commit to `develop` or `master`,
  and never merge another agent's branch into yours to "fix" a conflict unless you were
  asked to.
- **Never push and never open a pull request** unless the human explicitly said so. That is
  gate G5 and it does not delegate.
- **`develop` moves under you.** Another agent's work can merge while yours is running, so
  `git fetch` before you claim to be current, before you branch, and before you report that
  a suite is green — "green" against a stale base is not a fact about the repository.
- **Do not fix what another agent owns.** If you find a defect outside your task, *name it
  in your report* with what you saw and where. Do not fix it, and do not open an issue for
  it unless you were asked to — the human decides whether it is settled now or tracked.
- **Say what you touched.** Your report is the only record another agent has of why a file
  changed under them. List the files, and say plainly which of them were outside the
  obvious scope of your task and why.

### When you find you are colliding

Two agents in one repository collide over three things: the working tree, the ports, and a
shared file. `marp harness check` reports the mechanical ones — the same port is a failure,
an exclusive resource named twice in `needs:` is a failure, and two agents on one repository
is a note for a human to judge.

**A generated file is not a merge conflict, it is a regeneration.** `fixtures/*.json`,
`docs/openapi.generated.json` and anything else with a generator are resolved by running the
generator again, not by editing the diff. Say in your report which generated files you
touched so whoever merges knows to re-run rather than hand-resolve.

**If you are blocked by another agent's work in progress, stop and report it.** Waiting is
cheap; two agents editing the same file from different assumptions is not.

### Choosing a workspace

Most tasks do not need a separate workspace. **Branch in the checkout you already have**
— dependencies are installed, the database is up, and it costs nothing:

```bash
git checkout -b 72-unrendered-states origin/develop
```

`marp agent start` builds a whole isolated copy: its own clone, its own database on its
own port, its own API port, and a full `npm ci`. That is minutes of setup, and it buys
isolation. **Spend it only when isolation is what you need:**

- another agent is already working in that repository, and you would collide over the
  database, the ports, or the working tree;
- the task will disturb the database in a way you do not want in your own checkout —
  a migration, a destructive experiment, a schema rebuild;
- somebody wants to keep using the workspace normally while the work happens.

Otherwise a branch is the whole answer. On a second computer it is also the whole answer:
clone, check out the branch, and it is already isolated.

```bash
marp agent start marp-api 72-unrendered-states   # when you need the isolation
marp agent list                                  # what is set up, and on which ports
marp agent remove 72-unrendered-states           # keeps the branch
```

**Stop what you start.** A server outliving its work is not untidiness — one left running
in another checkout was adopted by a different workspace's browser tests, which then graded
that checkout's code for an hour without saying so.

`marp harness check` reports when two workspaces collide: the same port is a failure, an
exclusive resource named twice in `needs:` is a failure, and two agents on one repository
is a note for a human to judge.

**Parallelism belongs after the design is settled, never before.** Two agents each doing
their own investigation on overlapping surface is how two incompatible interpretations of
MARP get built. One agent settles the assumptions with the human; then the work fans out.

### If you are the one spawning an agent

- **Tell it to read this file first**, and give it the path to the repository it is working
  in. An agent that has not read the harness will guess at the gates, push when it should
  not, and verify at a tier that cannot see the thing it changed.
- **Name the branch to start from, explicitly**, and say why if it is not `develop`.
- **Give it the issue number, not a summary of the issue.** Summaries drift; issues do not.
- **Say which files are already being changed elsewhere**, and by whom, so it can keep its
  edits small there or come back to you.
- **Do not tell it to skip the gate.** Instructing an agent to pick a default for an
  ambiguous question instead of stopping converts a five-minute question into an hour of
  rework, and it has already happened here.
- **Scale the brief to the change.** A fifteen-line change does not need a research brief.
  Asking for a baseline established twice, a mutation per assertion, a real-hardware run and
  a deliberation on an edge case is right for a contract spanning two repositories and
  absurd for adding one field — it turns minutes of work into an hour, and the agent will do
  every part of it because you asked. Say which parts to skip. Keep the *rules* whatever the
  size: authorship, no push, no pull request, no issues.
- **Do not ask a question the spec already answers.** Before listing open questions for the
  human, check `.marp/task.md` and the issue comments for the ones already settled. Sending
  an agent to ask about a decision recorded an hour earlier wastes their time and teaches
  them the record is not trustworthy. Note that `marp spec retire` takes the spec off the
  integration branch once it merges, so the answers are reached with
  `git show <task-branch>:.marp/task.md` — give an agent that command rather than letting it
  conclude the decisions were never made.
- **Its report is the only thing anyone sees.** Ask for what it did per requirement, real
  test output including failures, the branch and its commits, every judgement call it made,
  and anything broken it found and left alone.

## Testing doctrine

Learned the expensive way, and it holds everywhere in this platform:

- **A defect is not fixed until it has a named test at a tier that can actually observe
  it.** Several defects here were reported twice because the first fix was verified at a
  tier that structurally could not see the bug. Store-level checks cannot see what was
  drawn; unit tests cannot see what a browser rendered.
- **A test that narrates a result without asserting it can lie.** This applies to
  walkthrough videos especially: a scene that says "the tile is now excluded" and only
  asserts that a panel opened will pass for weeks while excluding nothing.
- **Run the fast tiers after every change. Run the whole suite before calling anything
  done.** Parse and unit checks cost about a second and are the working loop. The slow
  tiers — browser, database, hardware — are not for routine feedback, but nothing is
  finished until they have passed. Run them as often as the work needs; never skip them
  to declare something working. `marp verify run` is that run.
- **CI runs the fast tiers only, deliberately.** A minute of browser tests on every push
  taxes every commit. That means **CI going green is not the same as the work being
  verified** — G4 is not satisfied by a green pipeline.
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

## The corpus, and how to copy it

The development database is not disposable. It holds observations and keyframes from GPU
inference runs over real Jellyfin video, the thumbnails extracted from that video, and real
review decisions that are the evidence behind recorded walkthroughs. That is GPU time plus
the Jellyfin extraction plus the reviewing, and it exists on one computer.

So there are two commands, and they are two halves of one thing:

```bash
marp db dump                                        # this machine's corpus, out
marp db load <dump> <thumbnails-dir> -Apply         # and back in
```

`scripts/dump-corpus.js` and `scripts/load-corpus.js` do the work; `marp db dump` and
`marp db load` are the umbrella's wrappers, and they exist to supply the two things this
repository deliberately does not know -- where PostgreSQL's own tools are, and which
database is running. Same boundary `marp db up` keeps by calling `scripts/init-database.js`
rather than holding a second copy of the schema. `db/corpus.js` is what the two scripts
share: the table list, the manifest shape, and the decision a refusal turns on.

**Four things about them that are not obvious, and each is deliberate:**

- **A dump is two things.** `observation_thumbnails` records a filename and the JPEG lives
  under `storage/`, which is git-ignored. A dump of the rows alone restores a corpus whose
  every tile is a broken pointer -- it looks restored and is not. So `load` takes two
  inputs and refuses with one.
- **A load is a dry run until `-Apply`,** and a load into a database that already holds a
  corpus is refused even with `-Apply` until `-Force`. The two flags answer different
  questions: `-Apply` is *write at all*, `-Force` is *yes, destroy what is in there*. From
  `marp.sh` they are `--apply` and `--force`.
- **The dump carries credential material** -- users, `auth_identities` and `service_tokens`
  -- because without them a loaded database cannot be logged into and *load and go* becomes
  *load and then redo the setup*. Settled in #125. It follows that a dump is a credential
  file: it stays on the machine that made it, and is never committed or attached to an
  issue. `marp db dump` defaults it into `.marp/local/`, which is git-ignored, and records
  where it put it in `.marp/local/corpus-dump.md` -- which is how an agent told "load the
  corpus" finds it.
- **The load checks its own work.** It compares the counts it produced against the manifest
  written when the dump was taken and fails on a mismatch, because a dump that cannot be
  loaded is not a backup.

**A dump older than the schema is loaded and then migrated.** It carries `SequelizeMeta`,
so `npx sequelize-cli db:migrate` afterwards applies only what has landed since; the load
says so when the dump is behind. That is the supported path -- a year-old dump is
known-stale and usable rather than a surprise.

**Stop the API before loading.** The restore drops every table, and an open connection
holding a lock on one of them is what turns a load into a hang.

**None of this reaches CI**, and it must not start to. CI builds an empty database and a
dump on one person's machine is invisible to it, so the rule that a test seeds what it
asserts does not relax because a dump exists.

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
the migrations — the same sequence `marp db up` uses. Everything runs there except
`tests/jellyfin.test.js`, excluded by name because it drives the central media server,
which a runner cannot reach — that is the `media` subsystem, and `npm run test:media` is
how you run it. **Run it locally before merging anything that touches Jellyfin**, because
CI cannot tell you it broke. CI builds its database from the baseline and the migrations
and puts no data in it, which is what makes that job meaningful. If you add a test that depends on
rows the development server happens to hold, seed them in the suite; see
`tests/species-lists.test.js`, where a block used to fail in one place and pass vacuously
in three.

## A test may create rows and must remove them

It may never modify or delete a row it did not create. After a test file runs, the database
holds exactly what it held before — whatever it is pointed at.

This is enforced rather than requested. `tests/setup/corpus-guard.js` takes a count and a
digest of every table before a file's tests and again after everything in it has finished,
and **fails that file**, naming the table and whether rows were deleted, modified, or added
and left behind. `tests/setup/local-database-guard.js` refuses to run the suite at all
against a database that is not local, because the development database carries the same name
as production and only the host tells them apart.

Exemptions are a written list with a reason each, at the top of `corpus-guard.js`. Add to it
only for something that moves because a test authenticated, or the equivalent; a table nobody
watches is where the next loss happens. `tests/corpus-guard.test.js` proves the guard catches
all three failures, against a scratch database it builds and drops.

It exists because a run that reported every suite and every test green destroyed a real
observation and left hundreds of review rows behind in the corpus. See #142.

**There is a fast tier and a slow tier. Use the fast one between changes.**
`npm test` is the whole suite -- minutes, not seconds -- and it is for the end of a change
set, not the working loop. The suites are grouped into subsystems, and running the one you
touched is tens of seconds. `npm run test:subsystems` lists them and says which suites
each one owns:

```bash
npm run test:gpu           # orchestration, leases, video resolution, ingest
npm run test:mosaic        # the picture mosaic reviewer
npm run test:review        # review and training state, observation versioning
npm run test:observations  # observations, keyframes, the timecode columns
npm run test:ml            # datasets, training runs, epochs, metrics, models
npm run test:species
npm run test:auth
npm run test:core          # projects, sessions, tasks, schema, data integrity
npm run test:media         # Jellyfin. Needs the live media server; CI excludes it
npm run test:subsystems    # the audit: does every suite belong to exactly one group
```

The groups are defined once, in `scripts/test-subsystem.mjs`. **Add a new test file to a
group when you write it** -- `test:subsystems` runs in CI and fails when a suite belongs to
no group or to two, because a suite in no group is a suite no fast loop ever runs.

Two things that make this less useful than the numbers suggest, and are worth knowing
rather than rediscovering. Most of a subsystem's time is Jest starting up and each suite
opening its own database connection, not the assertions -- so a *single file* is about 8 s
and five files is 46 s rather than 5x8. And the runner invokes Jest through `node` rather
than a shell on purpose: the path pattern contains `|`, which a Windows shell reads as a
pipe, and that made the whole run execute nothing in about a second -- looking fast rather
than looking broken.

**`npm test`, not `npx jest`.** The suite runs against the real development
PostgreSQL, and `package.json` passes `--runInBand` for that reason. Running Jest
directly lets workers race each other over one database and produces a wave of
failures that look like real breakage — most of the suite failing on a green codebase, in
one case.

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

## Running the inference pipeline needs context the baseline does not carry

The baseline builds the schema and the species catalogue. It does **not** build a
project, a session, or a registered model — those are survey data, and a `marp db destroy`
takes them. A GPU job spec names a session and an `ml_models` row *by id*, so a rebuilt
database rejects the same job spec that worked yesterday, and the error arrives from the
ingest rather than from the thing that is actually missing.

**Run `node scripts/seed-inference-context.js` after any rebuild.** Dry run by default;
`--apply` writes. It is idempotent, it pins the ids the job specs use, and it advances the
sequences past them. Do not seed these rows by hand — that is how they were lost.

Two things it encodes that are not obvious from the schema:

- **`species` identifies a species; `model_species` only records what a model was trained
  with.** The join table is not a lookup and not a class-index table — it has no class
  column, and the class names come from the model's own `mixed-classnames.yaml`. It matters
  to a run for a narrower reason: the ingest is handed a class *name* rather than a key, and
  `service/observation-ingest.service.js` resolves that name against `species.comname`
  requiring exactly one match. Common names are not unique across the catalogue —
  `Red sea urchin` is on both `Inverts` (769) and `GULF_Inverts` (544) — so the lookup
  narrows to the model's trained species before falling back to the whole catalogue, and an
  unseeded model leaves it with two matches and no grounds to choose. Seed the rows and the
  run proceeds; the disambiguation is the code's lookup order, not a property of the table.
- **The session's `type` chooses the species list.** `db/species-lists.js` maps `Invert` to
  `Inverts`. An inverts model writing into a `Fish` session is refused by
  `checkSessionTypeAgainstModel`, which is the check working.

The worker's side of this — which interpreter, which weights, which Jellyfin — is
machine-specific and lives in `.marp/local/`, not here. **The worker is given no Jellyfin
credentials**; the coordinator resolves the video and the job spec carries a playable URL.

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
phased plan for the schema and endpoints it will need. **It talks to this API now**:
`src/api/` is the seam and `src/data.js` survives as a test fixture, with
`src/backend.js` deciding which is in force. The application never chooses the fixture —
that app's `CLAUDE.md` has the reasoning, under *The two backings*, and it is worth reading
before pointing any tier at either one.

**#68 is a record of thinking, not a specification, and a line in it is not automatically a
decision somebody made deliberately.** It has been written and rewritten over months, it
contradicts itself in places, and it is long enough that nobody reads all of it at once. So
**a requirement taken from #68 is checked with the human, not inherited** — cite it, quote
it, and ask.

This is not a style preference; it has cost real work three times:

- A phase built a **deletion provenance table** from one line saying MARP *"retains a
  lightweight deletion provenance event"*. The answer was that it was never planned — a row
  per deleted observation would outgrow the data, since the models under test produce
  hundreds of millions of erroneous detections. The table was removed and #68 corrected in
  four places.
- A phase built **first-valid-review-wins** — a row lock, a claimer derivation, a
  conditional upsert, a rule that refused decisions are never logged, and a concurrency test
  — from one line in *Concurrent review*. The answer was that the **last commit wins**, and
  most of that machinery came straight back out.
- A phase specified `GET /api/v2/observations/mosaic` from *Phase 4*, which a later and more
  specific issue (#99) had already settled as a `POST`.

Where #68 and a later, more specific issue disagree, **the later decision wins and #68 gets
the edit** rather than being left to contradict itself.

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
