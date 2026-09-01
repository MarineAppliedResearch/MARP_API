# marp-api — working notes

The MARP API and application backend. One component of the [MARP
platform](https://github.com/MarineAppliedResearch/MARP); shared conventions live in
the umbrella repository's `CLAUDE.md` when this repo is opened inside that workspace,
and `agents.md` here holds general coding guidance. This file holds what is specific
to working in this repository — mostly things that cost real time to find out.

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

## Tests

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

## Known gaps

- Four moderate dependency advisories on `develop`, all in the sequelize chain, where
  npm's suggested fix is a downgrade to sequelize 3. Left deliberately; see #58.
- `master` is far behind `develop` and architecturally older. The plan is to promote
  `develop` wholesale rather than backport.
