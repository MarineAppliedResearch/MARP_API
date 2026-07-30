# Agent + Human Session History

## Scope of this session
- Continue major API infrastructure work on Node.js/Express/Sequelize project.
- Focus areas requested: testing foundation, Swagger/OpenAPI generation from code comments, code comment standards, and docs workflow setup.
- High constraint: do not change endpoint behavior or perform destructive DB/schema operations.

## What was attempted
- Added docs-tooling scripts and generated-doc infrastructure.
- Wired Swagger UI route to generated spec source (swagger-jsdoc-based) in server runtime.
- Added/iterated sample route annotations for selected endpoints.
- Added OpenAPI generation script for CI/local checks.
- Added JS developer-doc tooling pipeline (later identified as separate from API docs objective).
- Performed repeated runtime checks for `/api-docs`, `/api/openapi.json`, and process/port state.

## Important technical findings
1. Two doc systems were mixed during iteration:
- `swagger-jsdoc` (API contract docs from `@openapi` blocks)
- `jsdoc` (developer code docs site)
- Conclusion: these are separate concerns; jsdoc is optional for API docs replacement.

2. `docs/openapi.generated.json` repeatedly showed:
- `paths: {}`
- This indicates generator ran but discovered no valid API annotation blocks from scanned files.

3. Diagnostic outcome that resolved uncertainty:
- `serverExists: true`
- `openapiAnnotations: 0`
- `discoveredPaths: []`
- `swagger-jsdoc@6.2.5`
- Conclusion: parser/package pathing was not the first blocker; saved `server.js` at that moment had zero `@openapi` blocks.

4. Swagger runtime source confusion was investigated:
- Runtime server wiring in `server.js` was set to generated document path.
- Legacy/static outputs were observed at times during restarts/stale-process periods and while CSS/spec content was in flux.

5. `swagger.css` issue discovered and corrected:
- File at one point contained JSON-like legacy swagger payload content instead of pure CSS.
- This was replaced with valid CSS-only content to avoid UI contamination.

6. Port/process instability occurred repeatedly:
- Multiple `node ./server.js` processes caused `EADDRINUSE` on `3000`.
- Stale process cleanup was required to ensure current code was actually being served.

## Files touched during this session (at various points)
- `server.js`
- `docs/openapi.js`
- `scripts/generate-openapi.js`
- `package.json`
- `package-lock.json`
- `swagger.css`
- `jsdoc.config.json`
- `docs/openapi.generated.json`
- `docs/developer/*` generated assets

## Architectural decisions clarified
- Preferred API docs architecture:
  - `swagger-jsdoc` + `swagger-ui-express`
  - Runtime docs at `/api-docs`
  - Generated spec from route-adjacent `@openapi` blocks
- Keep API docs and developer docs as distinct pipelines.
- Use generation guardrails to fail loudly when no paths are discovered.

## Friction/process notes (for next agent)
- User preference is strongly helper-first, not autonomous thrash.
- User requested explicit intent before each command.
- User requested copy-paste-ready outputs in single code blocks.
- User is sensitive to unnecessary broad edits and large unsolicited comment rewrites.
- Incremental, minimal, explicit changes are preferred.

## Current handoff status from user
- User reported docs are now mostly working as desired and can create documentation.
- User requested this history file to preserve debugging/development context before switching to a different task with another LLM.

## Suggested next-agent behavior
- Start by validating saved annotation presence and generated `paths` count before changing architecture.
- Avoid adding/removing large unrelated tooling unless explicitly requested.
- Keep process checks deterministic: single server process, known port, known cwd.
- Preserve endpoint behavior and DB safety constraints.



```text
You are continuing development and documentation work on the MARP API, a Node.js Express application using Sequelize and PostgreSQL.

Do not redesign the documentation architecture. The current architecture is working.

PROJECT CONTEXT

The application is the MARP API. Do not call it the MARE API unless existing source code explicitly uses that name. Do not describe the entire server as “API V1” unless a specific route or component is actually limited to V1.

The main server file is:

/home/mare/workspace/MARE_API/server.js

The application currently runs directly with Node/npm, not PM2.

DOCUMENTATION ARCHITECTURE

There are two separate documentation systems.

1. Swagger/OpenAPI

Purpose:
- HTTP endpoints
- query, path, and body parameters
- response codes
- response schemas
- endpoint caveats
- interactive endpoint testing

Implementation:
- swagger-jsdoc
- swagger-ui-express
- OpenAPI version 3.0.3
- @openapi comment blocks in source files
- generated JSON at docs/openapi.generated.json
- interactive Swagger UI at /api-docs

Build command:

npm run docs:api:build

The running server builds its Swagger document at startup using:

const generatedSwaggerDocument = buildOpenApiSpec();

Therefore, after changing @openapi comments:
- run npm run docs:api:build
- stop and restart the existing Node server
- do not start a second process on port 3000

2. JSDoc

Purpose:
- internal developer documentation
- file and module roles
- functions
- classes
- declarations
- database behavior
- architectural caveats

Build command:

npm run docs:dev:build

Generated site:

docs/developer/

Served at:

/developer-docs

Run both documentation generators with:

npm run docs:build

IMPORTANT DEBUGGING HISTORY

Swagger initially generated an empty paths object.

The actual cause was that GitHub Copilot displayed edits that were not saved or applied to server.js on disk.

The decisive diagnostic was:

grep -n "@openapi" server.js

When this returned nothing, the annotations were not in the actual saved file.

After saving the file, Swagger generation succeeded.

Always verify AI edits using commands such as:

git diff -- server.js
grep -n "@openapi" server.js
grep -n -B 3 -A 30 "routeName" server.js

Do not assume code shown in an editor or AI preview has been saved.

Swagger UI initially failed with:

Unable to render this definition
The provided definition does not specify a valid version field.

The OpenAPI builder used 3.1.0, but the installed Swagger UI only supported 3.0.x.

The version was changed to:

openapi: '3.0.3'

A recurring port error occurred because an existing Node process was already using port 3000.

Since PM2 is not being used, find and stop the process with:

sudo lsof -i :3000
kill <PID>
npm start

OPENAPI SOURCE SCANNING

The OpenAPI builder scans source files using normalized absolute globs.

Current intended source list:

const annotationFiles = [
    normalizeGlobPath(path.join(PROJECT_ROOT, 'server.js')),                 // Main Express routes and documentation endpoints.
    normalizeGlobPath(path.join(PROJECT_ROOT, 'controller', '**', '*.js')), // Controller-level OpenAPI annotations.
    normalizeGlobPath(path.join(PROJECT_ROOT, 'service', '**', '*.js')),    // Service-level OpenAPI annotations.
    normalizeGlobPath(path.join(PROJECT_ROOT, 'repository', '**', '*.js')), // Repository-related API documentation.
    normalizeGlobPath(path.join(PROJECT_ROOT, 'model', '**', '*.js')),      // Reusable component schemas defined beside models.
];

The generator has a guard that fails when no paths are discovered.

OPENAPI ORGANIZATION CONVENTIONS

Use @openapi comments for actual HTTP endpoints.

Use JSDoc for:
- modules
- classes
- functions
- imported declarations
- database and internal implementation behavior

Use ordinary inline comments for:
- implementation decisions
- query clauses
- joins
- ordering
- aliases
- caveats directly beside the code

OpenAPI endpoint tags are defined at the top level in docs/openapi.js.

Example:

{
    name: 'Observations',
    description:
        'Access biological observation records and related data. These endpoints support observation retrieval, filtering, aggregation, review workflows, video-based queries, keyframe associations, and observation updates.'
}

Endpoint tags must match exactly:

tags:
  - Observations

Schemas cannot have tags. Tags apply only to OpenAPI operations.

OPENAPI SCHEMAS

Reusable OpenAPI schemas are being defined in model files using @openapi blocks.

For a Sequelize model file, use this order:

1. File-level JSDoc block
2. Imports
3. One consolidated OpenAPI components.schemas block
4. Sequelize model implementation

Do not scatter separate OpenAPI schema fragments throughout the Sequelize field definitions.

The OpenAPI schema and Sequelize model may differ, but differences must be intentional and documented.

OpenAPI field types must reflect actual serialized API values.

Example:
- mediaPosition is currently DataTypes.STRING(255)
- therefore OpenAPI should currently document it as a string unless a response transformation converts it

Observation schemas currently use the pattern:

Observation

and:

ObservationWithKeyframes

ObservationWithKeyframes extends Observation with allOf and adds:

keyframes:
  type: array
  items:
    $ref: '#/components/schemas/Keyframe'

Endpoints that include keyframes should reference ObservationWithKeyframes.

EXPRESS ROUTE CONVENTIONS

Use app.get() for read-only GET endpoints.

Example:

app.get('/api/example', handler);

Use app.use() for:
- middleware
- mounted routers
- static directories

Examples:

app.use(cors());
app.use('/api', reportingRouter);
app.use('/developer-docs', express.static(...));

app.use() matches middleware prefixes and multiple HTTP methods. Do not use it for a normal read-only endpoint unless there is a concrete reason.

COMMENTING STYLE

The user wants:

- detailed JSDoc headers
- detailed inline comments
- comments explaining why code exists
- accurate behavior and caveats
- full functions rather than tiny fragments
- one complete code block when editing a section
- no unnecessary spreading of simple arrays or declarations across many lines
- aligned inline comments where appropriate
- no invented context
- no chat-history statements inserted into source comments
- no claims based only on function names

When documenting an endpoint, inspect the full implementation chain:

1. Express route
2. Controller
3. Service, if present
4. Repository
5. Sequelize model and associations
6. Actual JSON output if needed

Do not infer exact behavior from the route name alone.

Document:
- exact matching behavior
- required parameters
- query/path/body location
- ordering
- joins and required associations
- response shape
- empty results
- swallowed errors
- side effects
- known legacy behavior

JSDOC TYPE CONSTRAINT

The installed JSDoc parser does not accept TypeScript-style import expressions such as:

@type {import('express')}

This caused parser errors.

Use simpler types such as:

@type {Object}
@type {Function}
@type {string[]}

or omit @type when a reliable standard JSDoc type is not available.

Also, @returns must always have a value, for example:

@returns {Promise<Array<Object>>} Matching records.

Do not leave:

@returns

by itself.

OBSERVATION REPOSITORY BEHAVIOR ALREADY DOCUMENTED

getObservationsByVideo(videoName)

Behavior:
- exact equality match on video_source
- ordered by mediaPosition ascending
- includes keyframes
- required: true excludes observations without keyframes
- repository catches errors and returns []
- callers cannot distinguish no results from database failure

getVideoSummariesByProject(project_id)

Behavior:
- joins observations to sessions
- filters joined sessions by project_id
- groups by video_source and videoLocation
- counts distinct comname
- counts distinct session_id
- uses independent MIN aggregates for dive, line, and session type
- those representative values may not come from the same session
- uses raw: true
- errors return []

getObservationsByVideoAndComnames(videoName, comnameList)

Behavior:
- exact video_source match
- Op.in matching on comname
- ordered by mediaPosition ascending
- requires keyframes
- expects comnameList to be an array
- repository errors return []

getObservationsByVideoAndProject(videoSource, projectName)

Behavior:
- exact project name lookup
- exact video_source match
- required session join restricted to project
- keyframes optional because required: false
- ordered by mediaPosition ascending
- missing project causes project.project_id access to throw
- missing project and query failures return []

getObservationsWithKeyframesByComnames(comnameList)

Behavior:
- route accepts comma-separated comnameList query text
- route splits on commas and decodeURIComponent is applied to each value
- repository uses Op.in
- ordered by mediaPosition ascending
- requires keyframes
- missing query becomes []
- repository catches failures and returns []
- route-level 500 handling will not see repository database errors because those errors are swallowed

IMPORTANT ERROR-HANDLING CAVEAT

Several repository methods catch database errors and return [].

This means:
- no matching records
- missing related data
- query failure

may all appear as HTTP 200 with an empty array.

Document this behavior accurately. Do not claim that a route returns 500 for a repository failure when the repository catches the error and returns [].

CURRENT TASK STATE

Swagger/OpenAPI generation is working.

JSDoc generation and serving are working.

The user is continuing through server.js and repository/model files, adding:
- OpenAPI route documentation
- reusable OpenAPI schemas
- JSDoc headers
- detailed inline comments

When asked to document the next route or function:
- request or inspect the actual implementation chain
- return the complete revised route/function
- preserve existing behavior unless explicitly asked to refactor
- explain inaccuracies in existing comments
- do not silently remove useful inline comments
- do not introduce architectural changes unrelated to documentation
```

## Session: 2026-07-23 — Full OpenAPI + JSDoc documentation pass across the codebase

This session picked up the documentation effort described above and carried it through to completion across the entire MARE_API (MARP API) codebase. Starting from `server.js` having `@openapi` blocks on only a handful of observation/species routes, the work expanded outward in three phases: first every Sequelize model file, then every controller/service/repository layer, then the remaining undocumented routes in `server.js` itself, plus a final pass over `config/config.js` and `logger/api.logger.js`. All 18 model files now define an `@openapi components.schemas` block colocated with their Sequelize factory (following the existing `Observation`/`Keyframe` precedent), giving 20 registered schemas in total (`Task`, `MetaInfo`, `User`, `Project`, `Session`, `Species`, `ModelSpecies`, `MlModel`, `Dataset`, `DatasetObservation`, `TrainingRun`, `Epoch`, `Hyperparameters`, `MetricsSummary`, `MetricsCurve`, `Artifact`, `Keyframe`, `Observation`, `ObservationWithKeyframes`, `ErrorResponse`). Every model also received full JSDoc: a `@fileoverview`/`@author`/`@module` header (converting the older ASCII-banner-style headers used in the ML-pipeline files to the same prose+tags style), factory-function and class-level JSDoc, `associate()` documentation, and aligned same-line trailing comments on the Sequelize `.init()` config block and `indexes` entries.

All eight controller/service/repository domains (task, metaInfo, keyframe, user, project, session, observation, dataset/ML) were then brought up to the same JSDoc standard — file headers, class docs, and per-method `@async`/`@param`/`@returns` blocks that explicitly call out each method's actual error-handling behavior rather than assuming it matches its neighbors. This surfaced that the codebase has no single error-handling contract: repository methods fail in at least five different observable ways depending on which one you call — swallowing to `[]`, swallowing to `null`, swallowing to `{}`, swallowing to `{error: string}` at HTTP 200, or resolving with the raw JavaScript `Error` object itself — and a few methods genuinely reject/throw instead. That inconsistency, and the resulting need to document each method's actual failure shape individually, was the single biggest source of documentation effort this session and is the top recommendation carried into MARP V2 planning (pick one contract and standardize).

Two real, currently-live bugs were found and are now called out prominently in the `@openapi` descriptions for their routes rather than glossed over: `PUT /api/user` calls a repository method (`updateUser`) that doesn't exist (the repository only defines `updateUsers`), and `DELETE /api/user/:id` has the mirror-image mismatch (`deleteUsers` called, only `deleteUser` defined) — both throw a `TypeError` and, since neither route has a `.catch()`, the request currently just hangs rather than returning any response. The `GET /api/observation/updateObservationWithCount/...` and `updateObservationWithSize/...` routes were documented as REST-verb violations (a GET that performs a SQL UPDATE) with an additional confirmed bug: the `:observation_id` path parameter is actually matched against the `obsID` column, not the `observation_id` primary key, so passing the real primary key silently matches zero rows while the endpoint still reports success. Other documented-but-not-fixed findings include: `project.repository.js#getProjectByName` returning a raw `Error` object on failure instead of any of the codebase's other fallback shapes; `session.controller.js` having a duplicate `getTypeFromSessionID` declaration (silently shadowed); `logger/api.logger.js` having the same shadowing bug on its two `info()` overloads; `keyframe.repository.js#updateKeyframe` being a complete no-op (its Sequelize logic is entirely commented out); and several `observation.repository.js` methods (`getFirstObservationBySessionId`, `getLastObservationBySessionId`) that reference an undefined variable and would throw immediately if ever called — currently unreachable dead code since nothing routes to them. `model/init-models.js` and `model/SequelizeMeta.js` were confirmed (via repo-wide grep, not assumption) to be dead/superseded by `model/index.js`'s dynamic model loader, and were documented as such rather than silently treated as live.

Every route registration in `server.js` — verified by cross-checking the literal `app.get/post/put/delete/use` calls against the compiled OpenAPI spec's path+method list, not just visual inspection — now has a matching `@openapi` block; the non-API tail of the file (static frontend serving, redirects, 404 handlers, `app.listen`) received plain JSDoc instead, consistent with the project's established two-pipeline separation. One process-level lesson reinforced the existing "JSDOC TYPE CONSTRAINT" note above: `{typeof Model}` (used as the `@returns` type on every model factory function) and `{import('express').Request/Response}` (used in a batch of controller JSDoc) both fail to parse under the installed jsdoc version, exactly like the `import('sequelize-cli').Migration` issue already known from the migrations/seeders files. Both were caught by running the actual `jsdoc -X` parser (not just `node -c`, which only validates JS syntax and misses JSDoc tag errors) and fixed codebase-wide to `{Model}` and `{Object}`/`{Function}` respectively — worth remembering for any future JSDoc additions.

Given the scale (roughly 14 model files, 24 controller/service/repository files, and ~50 previously-undocumented routes), most of the repetitive-but-precise JSDoc work was parallelized across subagents grouped by domain, each briefed with the exact established pattern and existing schema names to avoid collisions or style drift. The `server.js` `@openapi` additions were deliberately kept to a single sequential pass, since concurrent edits to one shared file risk clobbering each other. Every batch was verified with `node -c`, `npx jsdoc -X` (to catch JSDoc-specific parse errors), and a rebuild of the OpenAPI spec confirming schema/path counts; `npm run docs:build` was run at the end to regenerate `docs/developer/`. The only jsdoc parse errors remaining anywhere in the repository are in pre-existing, untouched `migrations/` and `seeders/` files using the same broken `import('sequelize-cli').Migration` syntax — out of scope for this pass but a trivial follow-up if desired. A full list of MARP V2 recommendations (error-handling contract, REST verb consistency, request validation via the now-accurate schemas, splitting `observation.repository.js`'s god-file concerns, auth, pagination) was also given to the user during this session but not acted on — it exists only in conversation, not yet in this file.

## Session: 2026-07-23 (later same day) — Jest/Supertest test harness + full CRUD completion pass

A separate session picked up where the documentation pass above left off. First it built the project's first automated test harness from scratch (previously zero tests existed): split `server.js` into `app.js` (builds/exports the Express app, no `.listen()`) + a thin `server.js` entry point so Supertest can import the app in-process; added `jest` + `supertest`, `jest.config.js`, and `"test": "jest --runInBand --forceExit"`; and established the pattern of one `tests/<domain>.test.js` file per resource, reusing the real dev Postgres DB (no isolated test DB) with disposable, uniquely-named, self-cleaning fixtures.

From there the user asked for every current `app.js` endpoint to be tested, with CRUD completed (GET-by-id/PUT/DELETE added wherever a POST/PUT already existed) for every resource domain, full OpenAPI+JSDoc on anything new, and a full create→update→get→delete lifecycle test per domain. Work was batched by foreign-key dependency tier (standalone domains first, then one-level, then two/three-level FK chains), with `npm test` run and dev-DB leftovers checked after each tier. Tiers 1–3 are done as of this entry (tasks, users, projects, sessions, ml_models, datasets, species, observations, keyframes, training_runs, dataset_observations, model_species, epochs, metrics_summary); Tier 4 (metrics_curves, plus remaining observation complex-query smoke tests) is in progress.

Bugs found and fixed along the way: `service/user.service.js` had the exact `updateUser`/`updateUsers` and `deleteUsers`/`deleteUser` method-name mismatches this file already flagged above as a "currently-live bug" in the prior session — this session actually fixed them (rather than just documenting them) once the user confirmed it was in scope, and added `.catch()` handlers to the two routes so failures respond instead of hanging. `keyframe.repository.js#updateKeyframe` — flagged above as "a complete no-op" — was rewritten for real with an id-first `(keyframeId, data)` signature and wired to a new `PUT /api/keyframe/:keyframe_id` route (nothing had ever called it). Two Postgres id-sequence drifts were found and fixed via `setval` (harmless, non-destructive): `species_id_seq` was at 482 against a real max id of 944 (this one was actively breaking every `POST /api/species` insert attempt), and `observations_observation_id_seq` was at 291921 against a real max of 451479 (latent only — `createObservation` computes its own next id via `MAX()+1` and never relied on the sequence, so this wasn't actually causing failures, just a landmine for any other insert path that might). Also, the earlier `app.js`/`server.js` split in this same session had left `docs/openapi.js`'s `annotationFiles` still pointing at `server.js` — since every route (and its `@openapi` block) had moved to `app.js`, OpenAPI generation was silently producing a near-empty spec until this was caught and repointed.

**Important reminder for future work, called out explicitly by the user:** when adding a new `@openapi` response block for a route that returns (or updates) a record with an existing `#/components/schemas/*` entry, the response MUST include a `content: application/json: schema:` block that actually `$ref`s that schema — a bare `description:` string is not sufficient, even though it looks complete at a glance. The established, correct shapes (already used correctly by every route from the documentation-pass session above) are: GET-by-id / update-by-id responses that can resolve to `null` when nothing matches use `oneOf: [{$ref: '#/components/schemas/X'}, {type: 'null'}]`; successful-create (POST) responses use a direct `$ref` with no `oneOf`. This session initially wrote ~20 new response blocks across Tiers 1–3 with only a prose description and no `content`/`schema` at all — a real regression relative to the established convention — caught by the user mid-Tier-4 and fixed retroactively across every affected route (`task`, `users`, `project`, `session`, `model`, `dataset` PUT, `species` POST/GET/PUT, `observation`, `keyframe` GET/PUT, `training_run`, `dataset_observation` GET/PUT, `model_species` GET/PUT, `epoch`, `metrics_summary` GET/PUT). **Any future session adding new routes/schemas should grep for `description: The (matching|updated|created)` in `app.js` and confirm each has a `content:`/`schema:` block before considering that route's documentation done — do not just eyeball it.**

## Session summary: 2026-07-23 — full recap, test harness through custom reporter

This entire session started from zero automated tests and ended with a complete Jest/Supertest suite covering every `app.js` endpoint. The first phase built the harness itself: `server.js` was split into `app.js` (builds and exports the Express app, no `.listen()`) and a thin `server.js` entry point so Supertest could import the app in-process; `jest` and `supertest` were added, along with `jest.config.js` and a real `"test"` script; and two pilot domains (species, project) established the pattern every later test file followed — disposable, uniquely-named fixtures against the real dev Postgres database (no isolated test DB, by explicit choice), cleaned up in `afterAll`. From there the scope expanded to a full CRUD-completion project: every resource domain that already had a create endpoint got any missing GET-by-id/PUT/DELETE routes added (with matching OpenAPI + JSDoc) plus a full create→update→get→delete lifecycle test, while read-only/complex-query endpoints got happy-path smoke tests only. This was done in four dependency-ordered tiers — standalone domains, then one-level, two-level, and three-level foreign-key chains — finishing at 17 test suites and 86 tests, all passing, with zero leftover rows confirmed after every tier.

Several real, previously-latent bugs surfaced and were fixed along the way rather than just documented: the `updateUser`/`updateUsers` and `deleteUsers`/`deleteUser` method-name typos in `service/user.service.js` (flagged in the prior documentation session but left broken until now); `keyframe.repository.js#updateKeyframe`, previously a complete no-op; two Postgres id-sequence drifts (`species_id_seq` and `observations_observation_id_seq`, both fixed via harmless `setval` calls); and a regression from this session's own `app.js`/`server.js` split, where `docs/openapi.js` kept scanning the now-empty `server.js` for `@openapi` blocks instead of `app.js`, silently producing a near-empty OpenAPI spec until caught. A second, separate documentation gap was found mid-Tier-4: roughly 20 of the new GET-by-id/PUT/POST response blocks had only a prose `description` with no `content`/`schema` `$ref`, breaking from the established convention set by the earlier full-documentation-pass session — all were fixed, and a permanent reminder about this exact failure mode is recorded above.

The last phase, after all endpoint coverage was complete, was purely about developer experience: `npm test` originally dumped raw Sequelize SQL queries and `logger.info` calls straight to the console, drowning out the actual test results. A custom Jest reporter (`tests/reporters/summary-reporter.js`) now replaces Jest's default reporter entirely, printing one fixed-width, always-aligned `Test: [file] name .... PASS/FAIL` line live as each individual test finishes (via Jest's `onTestCaseResult` hook, not the coarser per-file `onTestResult`), followed by a summary block and, for any failure, the exact assertion message with file:line. `jest.config.js` sets `silent: true` to stop Jest's own console-output printing, `tests/mocks/silent-logger.js` swaps out the `pine`-based app logger during tests only (via `moduleNameMapper`, no production file touched), and `tests/setup/console-error-passthrough.js` deliberately keeps `console.error` visible despite `silent: true`, since that's the one channel that still shows a failing route's real root cause (e.g. the actual Postgres error behind a 500) — verified live by deliberately breaking a test mid-session and confirming the underlying `SequelizeDatabaseError` printed exactly where expected. The full report is also written to a timestamped file under `tests/logs/` (already covered by the repo's existing `.gitignore` patterns) on every run. Net effect: `npm test` is both readable and about 20% faster, since printing all that suppressed console output was itself measurable overhead.

## Session: 2026-07-23 — Open-source licensing, contribution, and governance setup

This session established MARP's formal open-source footing, strictly scoped to four files: `LICENSE`, `CONTRIBUTING.md`, `GOVERNANCE.md`, and `README.md`. `LICENSE` now carries the complete, unmodified Apache License 2.0 text with the copyright line `Copyright 2026 Marine Applied Research and Exploration`. `CONTRIBUTING.md` was created from scratch, covering welcomed contribution areas, a contribution-license statement (Apache 2.0, no CLA, no copyright assignment), a recommended branch/PR workflow, optional DCO-style `git commit -s` sign-off, and coding/PR expectations, linking back to `README.md`, `LICENSE`, and `GOVERNANCE.md`. `GOVERNANCE.md` was also created from scratch, naming Marine Applied Research and Exploration (MARÉ) as MARP's founding steward with defined authority over official infrastructure/releases/branding, naming Isaac Assegai Travers as project founder and initial Lead Maintainer, and laying out the decision-making model, maintainer addition/removal (including a bounded Lead Maintainer override), MARÉ's continuing authority alongside explicit fork-legality/non-endorsement language, governance scope, and an amendment process — all worded to avoid implying legally irrevocable roles or employment guarantees. `README.md` was updated in place (all existing architecture/setup/roadmap/SQL content preserved): the license badge and final License section moved from MIT to Apache 2.0, and a new "Open source" section (with License-scope and Branding subsections distinguishing the Apache-licensed code/docs from excluded logos, branding, and ecological/partner data) was added near the top, with the existing Contributing section updated to link to the new `CONTRIBUTING.md` and `GOVERNANCE.md`. After the initial pass, the user (or a linter) made small follow-up edits to `GOVERNANCE.md` (removing the "MARÉ employment..." line from the governance-scope exclusions) and `CONTRIBUTING.md` (removing the explicit "no CLA / no copyright assignment" sentence) — both were left as-is per instruction not to revert intentional changes. No other repository files were touched, consistent with the task's hard scope constraint.

## Session: 2026-07-23 — Migrations/seeders JSDoc pass and error-contract parser fix

This session closed the last documentation gap flagged at the end of the earlier full-documentation-pass session: all 9 `migrations/*.js` files and 5 `seeders/*.js` files were brought up to the same `@fileoverview`/`@author`/`@module` file-header plus per-`up`/`down` `@async`/`@param`/`@returns` JSDoc standard used in `app.js` and every model file, and the broken `/** @type {import('sequelize-cli').Migration} */` line (the exact same class of TS-style import-expression syntax the installed jsdoc parser already can't handle) was removed or replaced everywhere it appeared in both directories; two `.sql` reference scripts sitting in `migrations/` (`merge-script-example.sql`, `sorce_build_star_subset.sql`) were deliberately left alone since sequelize-cli only runs `.js` files there and they're not JS. While documenting, a handful of pre-existing, unfixed bugs were called out inline rather than silently corrected — several early migrations (`remove_Capital_tableFrom_metainfo`, `add_PobsID_record_to_Observations`, `add_60SecondSubstrateData`) call `queryInterface.addColumn`/`removeColumn` without `await`, so their transactions can commit before the schema change actually finishes. After this pass, the user ran `npm run docs:dev:build` and hit a real, separate, unrelated parser error in `middleware/error-contract.middleware.js`: an inline object-type `@returns` tag (`{{status:number, code:string, message:string, details:Array<Object>|undefined}}`) failed to parse because the installed jsdoc version can't handle a union type nested inside an object-literal type expression; this was fixed by simplifying the tag to `{Object}` with the shape described in prose, the same fallback pattern already used elsewhere in the repo for parser-incompatible type syntax. All changes were verified with `node -c` and `npx jsdoc -X` across every touched file, a full `npm run docs:dev:build` (clean, zero errors) and `npm run docs:api:build` (OpenAPI spec unchanged) rebuild.

## Session: 2026-07-23 (later same day) — Sample-based OpenAPI schemas for custom report GET endpoints

This session picked up an in-progress effort (`docs/openapi-response-schema-workflow.md`, `scripts/infer-openapi-schema.js`, `samples/openapi-response/`) to document the handful of GET routes whose response shape is a custom joined/aggregated report rather than a single Sequelize model, and carried it through to completion. The proof of concept (`GET /getVideoSummaries/{project_id}` → `VideoSummaryReport`) had been started but never applied — the inferred schema sat unused in `docs/tmp/`, and the route still had an ad hoc inline schema in its `@openapi` block.

To finish it properly, the dev server was started against the real dev Postgres database (`npm start`, port 3000) and every target endpoint was hit for real, live samples — deliberately replacing the two hand-fabricated placeholder sample files (`video-summary-a.json`/`-b.json`, which used plain integers) once real responses showed `distinct_species_count`, `session_count`, `dive`, and `line` are actually **numeric strings**, because they come from raw Postgres aggregates returned through Sequelize with `raw:true`. Real samples were captured for four endpoints and run through `scripts/infer-openapi-schema.js`: `VideoSummaryReport` (`GET /getVideoSummaries/{project_id}`), `UserDashboardData`/`DashboardUserDateEntry` (`GET /dashboardData`), `ProjectTimeByDateAndUser` (`GET /getProjectTimeByDateAndUser`), and `MetaInfoDbName` (`GET /metaInfo/dbName`). The two dynamically-keyed map shapes (dashboard data keyed by user then date; project time keyed by project then date then user) aren't something the inference script models directly (it treats object keys as fixed property names), so those were hand-assembled as nested `additionalProperties` schemas, with the script used only to infer the fixed-shape leaf object (`DashboardUserDateEntry`). All five schemas were added to `docs/openapi.js`'s `components.schemas` (alongside the existing `Error*` schemas — this file, not a model file, is the established location for schemas backing non-model custom-shape routes per the workflow doc), and their routes' `@openapi` response blocks in `app.js` were updated to `$ref` them.

**A real, previously-recorded documentation error was found and corrected by testing against live data rather than trusting the existing comment:** `GET /api/dashboardData`'s `@openapi` description (written in an earlier session) claimed "the underlying grouped-observation query this endpoint depends on is invoked with no date arguments internally... the endpoint currently returns data across all time regardless of what is passed." Hitting the live endpoint proved this false — omitting `start`/`end` returns `{}` (empty), and supplying them returns correctly date-filtered data — because Sequelize's `Op.between` with an `undefined` bound matches nothing rather than matching everything. The same is true of `getProjectTimeByDateAndUser`. Both descriptions were corrected to say `start`/`end` are required in practice for any data to come back, and the still-valid "last observation of every session/day contributes zero minutes" undercounting bug note on `getProjectTimeByDateAndUser` was preserved. **Lesson for future sessions: when a prior session's inline caveat claims a parameter has no effect, verify against the running app/DB before propagating it further — it may itself be stale or wrong.**

Two additional stub routes with `additionalProperties: true` placeholders — `getObservationsByVideoAndComnames` and `getObservationsByVideoAndProject` — were confirmed by reading the repository layer to return plain `Observation`-family rows, not truly custom shapes, so per explicit user direction they were fixed with `$ref`s to existing schemas instead of going through sample inference: `ObservationWithKeyframes` for the first, and a new `ObservationWithSessionAndKeyframes` (added to `model/observation.model.js` beside the existing `ObservationWithKeyframes`/`ObservationWithDatasets` `allOf` schemas) for the second, since that query's `session` include has no attribute restriction and comes back as a full nested session object alongside keyframes — something the prior stub's `additionalProperties: true` had been silently hiding.

After all edits, `npm run docs:api:build` and `npm run docs:dev:build` both ran clean, the generated spec was checked programmatically to confirm every new `$ref` resolves to the intended schema, and the full test suite (`npm test`, 17 suites / 86 tests) passed unchanged. `docs/tmp/video-summary.schema.json` (a scratch inference output, superseded once its content was copied into `docs/openapi.js`) was deleted; the real captured samples remain in `samples/openapi-response/` as the source-of-truth evidence for each schema, per the workflow doc's own recommendation to keep 2–5 representative samples per route.

## Session: 2026-07-23 (later still) — Added PUT /api/metaInfo/dbName (set database name)

The user noticed `GET /api/metaInfo/dbName` had no write counterpart and asked for one, plus flagged uncertainty over whether a `metaInfo` model even existed — it did (`model/metaInfo.model.js`, plus repository/service/controller layers), so this was purely a missing write path, not a missing-model gap. Investigation confirmed the `metaInfos` table is a true singleton: the migration/seeder create exactly one row, and the live dev row was `{id: 0, name: "Production"}`. Per explicit user direction (via `AskUserQuestion` in plan mode), the fix was scoped narrowly to a dedicated `PUT /api/metaInfo/dbName` convenience route — not full generic CRUD (`POST`/`GET-by-id`/`DELETE` `/api/metaInfo/:id`) — with upsert semantics (update the existing row if present, create one if the table is somehow empty).

`setDBName(name)` was added to `repository/metaInfo.repository.js`, `service/metaInfo.service.js`, and `controller/metaInfo.controller.js`, following the existing 3-layer pass-through pattern, with a full `@openapi` PUT block added to `app.js` right after the existing GET (inline request-body schema, reusing the already-existing `MetaInfoDbName` response schema, plus `400`/`500` error responses). **A real design mistake was caught mid-implementation by the user, not by the agent**: the first draft of `setDBName` mirrored `getDBName`'s existing swallow-to-`[]` error handling, but the user pointed out this doesn't fit the codebase's normalized error contract (`ApiError`/`ERROR_CODES`/the shared `errorHandler` middleware) — for a *write*, silently eating a database failure and returning `200 []` hides the fact that nothing was actually persisted, unlike a read where "no data" and "query failed" can reasonably look similar. The fix follows the one existing precedent for a non-swallowing write, `observation.repository.js#updateObservation`: log via `logger.error`, then rethrow, letting `asyncHandler` and the shared error-contract middleware produce a proper `ErrorEnvelope` 500. **Lesson for future sessions: don't reflexively copy a sibling read method's error-handling shape onto a new write method in this codebase — reads and writes have different correctness requirements around silent failure, and the swallow-to-fallback pattern that's tolerable for `GET`s is actively misleading on `POST`/`PUT`/`DELETE`.**

A new test was added to `tests/readonly-endpoints.test.js` alongside the existing `GET /api/metaInfo/dbName` smoke test: it reads the current live value, `PUT`s a disposable value, asserts the change took effect via both the `PUT` response and a follow-up `GET`, then restores the original value in a `finally` block — necessary because this table's single row is real shared dev-environment config, not disposable per-test fixture data like every other domain's lifecycle tests use. A second test confirms a `400 VALIDATION_ERROR` when `name` is missing from the body (the first manually-thrown `VALIDATION_ERROR` in the codebase — previously that error code existed only in the Sequelize-validation-error middleware path, never thrown directly by a route). Verified with `node -c`, `npx jsdoc -X`, a full `npm run docs:build` (new path/`$ref`s resolve correctly, checked programmatically), and the full test suite (88/88 passing, up from 86). The live dev `metaInfos` row was confirmed restored to `{name: "Production"}` after the run.

## Session: 2026-07-23 (later still) — Added `/api/schema` introspection endpoints and schema contracts

This session added a full read-only database schema introspection surface under `/api/schema` with three separate endpoints: `GET /api/schema/tables`, `GET /api/schema/views`, and `GET /api/schema/relationships`. Implementation followed the project’s established layering pattern end-to-end (`controller/schema.controller.js` → `service/schema.service.js` → `repository/schema.repository.js`) and was wired into `app.js` plus the shared Sequelize repository guard list. The repository queries are scoped to the `public` schema only (as requested) and return the metadata needed for a table/view explorer UI: table columns and types, nullability/defaults/identity flags, primary keys, foreign keys, unique/check constraints, indexes, row estimates, view SQL definitions, updatability flags, and public-object dependencies; materialized views are included and labeled explicitly.

OpenAPI and test coverage were added in the same pass to keep behavior and contract aligned: new route blocks were documented in `app.js`, a new top-level `Schema` tag and reusable component schemas were added in `docs/openapi.js` (`SchemaTable`, `SchemaView`, `SchemaRelationship`, and nested types), and `npm run docs:api:build` confirmed all new paths were discovered in the generated spec. A dedicated `tests/schema.test.js` suite was added and run; one payload-shape mismatch was caught (Postgres array text vs JS arrays on relationship columns), fixed in `repository/schema.repository.js` via array normalization, and revalidated with all schema tests passing. Per user direction, `README.md` was also updated to formalize two ongoing rules: non-2xx responses for endpoint work should use the standardized error contract, and new endpoints should always ship with automated tests.

## Session: 2026-07-24 — Task-route code-first OpenAPI migration

This session replaced the handwritten OpenAPI comments for the entire `/api/tasks` slice with a code-first route registry. The pilot covered all four task CRUD routes: `GET /api/tasks`, `POST /api/task`, `PUT /api/task`, `GET /api/task/:id`, and `DELETE /api/task/:id`. The new structure keeps each route definition executable in JavaScript, so the same object now drives Express registration and OpenAPI generation instead of forcing the route handler and the docs to be maintained separately.

The core decision was to keep the helper generic. A new route registry module now accepts plain route metadata and normalizes it into OpenAPI operations, while the task-specific module provides the actual handlers and response contracts. For the model side, the Task schema is now generated from Sequelize using `@techntools/sequelize-to-openapi`, with human-facing descriptions/examples supplied through Sequelize `jsonSchema` metadata where the generator supports it. That let the manually duplicated Task `@openapi` component block be removed while preserving the same documented field meanings.

The migration also required one important ordering fix: task routes must be registered before the OpenAPI document is built, otherwise the runtime Swagger JSON and Swagger UI will miss the task operations. The app now registers the task routes before `buildOpenApiSpec()` runs, and the standalone `docs:api:build` script loads the app first so the same registry is populated during CLI generation. The result is that both runtime `/api/openapi.json` and the generated `docs/openapi.generated.json` include the task paths and the generated Task schema.

Validation passed after the migration. `npm run docs:api:build` now emits `/tasks`, `/task`, and `/task/{id}` along with the generated Task component schema, `GET /api/tasks` still returns the same array payload, and the task-related tests pass unchanged. The main follow-up decision going forward is whether to migrate the rest of the routes with the same generic helper pattern, since the helper itself is now proven reusable and the task slice is the reference implementation.

## Session: 2026-07-24/27 — Full app.js route migration to code-first routes/ + generated OpenAPI schemas

A user review of the Task pilot caught two real bugs before they could compound across a full migration: `@techntools/sequelize-to-openapi` dumps a model's `jsonSchema.examples` array verbatim into the singular OpenAPI `example` field instead of unwrapping it (fixed with a small `unwrapArrayExamples()` post-processing step in `docs/openapi.js`), and `registerTaskRoutes(app)` had been wired in ahead of `app.use(bodyParser.json())`, silently breaking `req.body` for the task write routes (fixed by moving body-parser/request-id middleware registration before any route registration). Both are covered by the existing test suite now. Following that review, the user asked for a full plan (built and approved via `EnterPlanMode`/`ExitPlanMode`) to migrate every remaining `/api/*` route in `app.js` to the same pattern, then asked to execute it.

The plan's scope, confirmed with the user up front: only `/api/*` resource routes migrate (the 2 doc-serving routes and 5 static/frontend routes at the tail of `app.js` stay put, already excluded from the `@openapi` pipeline in an earlier session); the `dataset` mega-domain (dataset, dataset_observation, ml_models/model, training_run, epoch, metrics_summary, metrics_curve — ~32 routes) becomes one `routes/dataset.routes.js`, matching its single existing controller; model component schemas also convert to generated form wherever they map 1:1 to a Sequelize model; and this is a pure structural migration — every already-documented bug/caveat gets carried forward into the new files' comments verbatim, not fixed.

All 9 domains were migrated in order of size: metaInfo (2 routes), keyframe (4), schema (3), user (8), project (8), session (7), species+model_species (10), dataset (32), observation (18 — one more than originally scoped, since `/api/getDistinctComnamesWithKeyframes` was registered via `app.use()` rather than `app.get()` and was missed by the initial route-count grep). Each domain followed the same verification loop: rebuild the OpenAPI spec and diff every affected path against the pre-migration baseline (byte-identical except for the intentional `<Domain>CreateRequest`/`<Domain>UpdateRequest` wrapper-schema swaps, matching the Task precedent of not reusing the full response schema for write bodies), start the real dev server and do a live curl round-trip (create → read → update → delete) against every migrated write route, and run the full Jest suite. `docs/openapi.js`'s `buildGeneratedComponentSchemas()` was generalized from a single hardcoded `if (db.tasks)` block into a data-driven `GENERATED_SCHEMAS` array so each new domain was a small config addition rather than repeated boilerplate.

Two model schemas were deliberately kept hand-written rather than generated: `MetricsSummary` and `MetricsCurve` both embed a `species` association object directly in their schema, which `@techntools/sequelize-to-openapi` can't reproduce without extra association config (and even then would `$ref` the wrong lowercase schema name); this is the same category of exception already established for `Observation`'s `ObservationWithKeyframes`/`ObservationWithSessionAndKeyframes`/`ObservationWithDatasets`, which moved from `model/observation.model.js` into hand-written `allOf` schemas in `docs/openapi.js` referencing the now-generated base `Observation` schema. `docs/openapi-route-registry.js` gained one small generalization: an optional `expressMethod` field so a route's *documented* OpenAPI method can differ from the *actual* Express registration method, needed to preserve `getDistinctComnamesWithKeyframes`'s existing `app.use()` (responds-to-any-verb) behavior while still documenting it as a `get`.

**A real, live regression was caught and fixed during the observation domain's live-verification step, not by the test suite:** `repository/session.repository.js` and `repository/observation.repository.js` have a genuine circular require on each other's controller (`session.repository` requires `observation.controller`; `observation.repository` requires `session.controller`). Node resolves circular requires by returning whatever `module.exports` currently is at the moment of the circular access, and since both controllers do `module.exports = new XController()` at the end of the file, whichever of the two starts loading first leaves the *other* side with an incomplete exports object when the cycle closes. `observation.repository.js` actually calls methods on its captured `sessionController` reference (`getProjectIDFromSessionID`, `getTypeFromSessionID`, `getSessionIDsWithProjectAndType`), so it needs `session.controller.js` to not already be mid-load when it requires it. The original `app.js` (confirmed via `git show HEAD:app.js`) required `observationController` before `sessionController` at the top of the file, which happened to keep this working by accident. Migrating routes domain-by-domain (session before observation) flipped that relative require order, and `POST /api/observation` started throwing `sessionController.getProjectIDFromSessionID is not a function` — caught by a live curl test with a realistic payload (`session_id` set), not by Jest, since that specific test run's module-cache timing happened to still work. Fixed by moving `registerObservationRoutes`'s require to load first in `app.js`, before any route module that transitively touches `session.controller.js` (keyframe, session), with a comment explaining why — documented in memory for future sessions since reordering those requires again would silently reintroduce the same break. The underlying circular dependency itself is a pre-existing architectural issue (not fixed, out of scope) and is a reasonable MARP V2 cleanup candidate.

After all 9 domains, `app.js` was verified to contain zero remaining `@openapi` blocks and zero domain route handlers or controller requires — only middleware setup, the 2 doc-serving routes, and the 5 static/frontend routes remain, exactly matching the plan's stated end state. `routes/task.routes.js` (the original pilot, written before inline comments became the established convention for these files) was retrofitted with the same per-handler inline comments as every other domain. Final gate: `npm run docs:build` (both OpenAPI and JSDoc generators) clean, full Jest suite at 18 suites / 91 tests passing.

## Full session summary: 2026-07-24 through 2026-07-28 — Complete code-first route migration, start to finish

This entry is a comprehensive recap of the entire multi-day effort described in the two entries directly above, written at the user's request as a single standalone summary rather than requiring the reader to piece it together from the incremental log entries.

### Starting point

The session began with a previous agent's work already in place: a pilot migration that had moved the `/api/tasks` slice (5 routes: `GET /api/tasks`, `POST /api/task`, `PUT /api/task`, `GET /api/task/:id`, `DELETE /api/task/:id`) out of hand-written `@openapi` comment blocks in `app.js` and into a new code-first pattern — `routes/task.routes.js` registering routes through a generic `docs/openapi-route-registry.js` helper, with the `Task` OpenAPI component schema generated directly from the Sequelize model via the `@techntools/sequelize-to-openapi` library instead of hand-written. The user had noticed the generated schema's example values looked wrong (every field wrapped in a single-element array, e.g. `"name": ["Review kelp transect annotations"]`) instead of matching real query output, and asked for a correctness review before trusting the pattern further.

### Phase 1: Reviewing and fixing the Task pilot

Investigation traced the array-wrapping to a genuine library quirk: `@techntools/sequelize-to-openapi`'s `SchemaManager` requires a model attribute's `jsonSchema.examples` to be an array (it throws a `TypeError` otherwise), but its `OpenApiStrategy.getPropertyExamples()` then copies that array verbatim into the OpenAPI `example` keyword — which is documented as holding a single scalar value, not an array. The fix was a small `unwrapArrayExamples()` post-processing helper added to `docs/openapi.js`, applied to every generated schema after `schemaManager.generate()` runs. This was purely a documentation-output bug; the real API responses and database rows were never affected, since GET /api/tasks was already returning correct scalar values throughout.

While verifying that fix by actually starting the dev server and exercising the API end-to-end (rather than trusting the diff alone), a second, more serious bug surfaced: `registerTaskRoutes(app)` was being called in `app.js` *before* `app.use(bodyParser.json())`. Because Express matches middleware and routes in registration order, this meant the task write routes (`POST`/`PUT /api/task`) were live before the JSON body parser was attached, so `req.body` was `undefined` for those handlers — a live, previously-undetected bug that broke task creation and updates. This was fixed by moving `app.use(bodyParser.json())` and `app.use(requestIdMiddleware)` earlier in `app.js`, ahead of all route registration. Both fixes were verified by starting the real server, hitting `/api-docs` and `/api/openapi.json` directly, doing a live POST/PUT/GET/DELETE round-trip against `/api/task`, and running the full Jest suite (91/91 passing). Two small memory entries were written recording the library quirk and the ordering hazard, so a future session extending this pattern doesn't rediscover either the hard way.

### Phase 2: Planning the full migration

With the pilot corrected and validated, the user asked for the same code-first pattern to be applied to every remaining route in `app.js` — at the time, roughly 91 additional `/api/*` routes plus the 5 already-done task routes, spread across 9 controller-backed domains, embedded in a nearly 4,000-line file. Given the scope, this was handled through the plan-mode workflow (`EnterPlanMode` → research → `ExitPlanMode`) rather than diving straight into edits. Research included a full grep-based inventory of every `app.get/post/put/delete/use` call in `app.js`, tracing which controller backed which routes, checking how many OpenAPI component schemas existed per domain, and inspecting the `@techntools/sequelize-to-openapi` library's source directly (type mapper, attribute validator, association handling) to understand exactly what it could and couldn't reproduce automatically before committing to a schema-generation strategy.

Four scope questions were put to the user directly rather than assumed:
1. Whether the migration should also sweep in the 2 doc-serving routes and 5 static/frontend routes at the tail of `app.js` — answered no, keep scope to `/api/*` resource routes only, since those others were already deliberately excluded from the `@openapi` pipeline in an earlier session.
2. How to split the large ML-pipeline domain (dataset, dataset_observation, ml_models/model, training_run, epoch, metrics_summary, metrics_curve — one controller, ~32 routes) — answered one `routes/dataset.routes.js` file, matching the existing single-controller boundary rather than splitting further.
3. Whether to also convert other models' hand-written OpenAPI schemas to generated form, beyond just the routes — answered yes, extend the generated-schema approach wherever a schema maps 1:1 to a Sequelize model.
4. Whether to fix any of the many already-documented behavioral bugs/caveats encountered along the way (swallowed errors, REST-verb violations, column mismatches) — answered no, this must be a pure structural migration; every existing caveat gets carried forward faithfully into the new files' comments, not corrected, since mixing a mechanical migration with behavioral fixes multiplies risk and makes any regression harder to attribute.

The resulting plan ordered the 9 domains smallest-to-largest (to catch pattern problems early, on low-stakes domains, before tackling the two largest): metaInfo (2 routes), keyframe (4), schema (3), user (8), project (8), session (7), species+model_species (10), dataset (32), observation (17, later found to actually be 18). It also defined the reusable pattern up front: each `routes/<domain>.routes.js` gets a file-level JSDoc header, one `register<Domain>Routes(app)` function, and one `registerOpenApiRoute(app, {...})` call per route translating the existing `@openapi` YAML block into an equivalent JS object while wrapping the original handler body verbatim — plus a verification loop to run after every single domain, not just at the end: rebuild the OpenAPI spec and diff every affected path against a pre-migration baseline snapshot, start the real dev server and do a live curl create→read→update→delete round-trip against every write route, and run the full Jest suite.

### Phase 3: Executing all 9 domains

Each domain followed the same disciplined sequence: read the domain's model file(s) and every relevant `app.js` route block in full (never guessing from route names alone), add `jsonSchema` metadata to the Sequelize model's attributes mirroring the existing hand-written OpenAPI descriptions/examples exactly, add the domain's entry to a new data-driven `GENERATED_SCHEMAS` array in `docs/openapi.js` (replacing what had been a single hardcoded `if (db.tasks)` block in the pilot), write the new `routes/<domain>.routes.js` file with inline comments explaining non-obvious behavior next to the code it describes (not just buried in the OpenAPI `description` string), remove the corresponding routes and `@openapi` blocks plus the now-unused controller `require` from `app.js`, and wire in the new module. After each domain: `node -c` syntax checks on every touched file, a full `npm run docs:api:build` with a programmatic deep-equal diff of every affected path against the pre-migration spec (confirming byte-identical output except for the intentional, deliberate `<Domain>CreateRequest`/`<Domain>UpdateRequest` wrapper-schema swaps — full model schemas were never appropriate for write-request bodies, since they include read-only fields like auto-generated IDs and timestamps), a live server start with real curl round-trips against every write route using real foreign keys pulled from the dev database via `psql`, cleanup of every piece of test data created along the way, and a full Jest run.

Two model schemas were deliberately kept hand-written rather than converted: `MetricsSummary` and `MetricsCurve` each embed a `species` association object directly in their schema definition, which the generator library can't reproduce without extra association configuration — and even then would produce a `$ref` using Sequelize's lowercase internal model name (`species`) rather than the capitalized OpenAPI schema key (`Species`), a broken reference. This is the same category of exception already anticipated in the plan for `Observation`'s three composite schemas (`ObservationWithKeyframes`, `ObservationWithSessionAndKeyframes`, `ObservationWithDatasets`), which were moved out of `model/observation.model.js` and into hand-written `allOf` schemas in `docs/openapi.js` that reference the newly-generated base `Observation` schema.

One small, genuinely reusable enhancement was made to the generic registry itself: `docs/openapi-route-registry.js` gained an optional `expressMethod` field, letting a route's *documented* OpenAPI method differ from the *actual* Express method used to register it. This was needed for `/api/getDistinctComnamesWithKeyframes`, which the original code registered via `app.use()` rather than `app.get()` specifically so it would respond to any HTTP verb — a deliberate (if unusual) quirk that needed to be preserved exactly rather than quietly normalized to a plain GET route during the migration. This route was also the one piece of scope the initial inventory missed, since the original grep for route counts only matched `app.get/post/put/delete(`, not `app.use(`; it surfaced during the detailed read-through of the observation domain's routes and was folded in, bringing that domain's true count to 18 rather than the originally estimated 17.

### A real regression, caught by live testing rather than the test suite

The most important finding of the entire session came near the very end, during the observation domain's live-verification step. `POST /api/observation` started failing with `sessionController.getProjectIDFromSessionID is not a function`, accompanied by a Node.js runtime warning about accessing a non-existent property inside a circular dependency. Investigation traced this to a genuine, pre-existing circular require between `repository/session.repository.js` (which requires `controller/observation.controller.js`) and `repository/observation.repository.js` (which requires `controller/session.controller.js`). Node resolves circular requires by handing back whatever `module.exports` currently is at the exact moment of the circular access; since both controllers assign `module.exports = new XController()` only at the very end of their file, whichever of the two starts loading first leaves the *other* side holding an incomplete, pre-assignment exports object once the cycle closes. `observation.repository.js` actually calls several methods on its captured `sessionController` reference, so it depends on `session.controller.js` not already being mid-load when it requires it.

Checking `git show HEAD:app.js` confirmed the original file required `observationController` before `sessionController` at the top of the file — accidentally keeping this fragile arrangement working for as long as the codebase existed. Migrating routes domain-by-domain (with the session domain done several steps before the observation domain, per the plan's smallest-to-largest ordering) flipped that relative require order without anyone intending to, since each domain's route file was simply required from `app.js` in migration order. The fix was to make `app.js` require `registerObservationRoutes` first, before any other route module that transitively touches `session.controller.js` (keyframe's and session's own route files both do, through their repositories), with an explanatory comment directly at the require site so a future reorder doesn't silently reintroduce the exact same break. A memory entry was also written recording the mechanism in full, since the *actual* fix — breaking the circular dependency at its root by having the repositories reach their sibling data through services rather than through each other's controllers — is out of scope for a structural migration and is flagged as a reasonable MARP V2 cleanup item instead.

This bug is also a useful data point on methodology: the full Jest suite passed both immediately before and immediately after this regression was introduced, because the specific module-load order Jest happened to exercise in that run didn't trigger the broken direction of the cycle. It was only caught because every write route was independently exercised with a live, realistic curl request as part of the verification loop — reinforcing the standing project lesson (already recorded in memory) that test-suite-green is not sufficient proof after any change to require/module-loading order, and that live behavior needs to be checked directly rather than inferred from either a spec diff or a passing test run alone.

### Final state

`app.js` was reduced from its original near-4,000-line size to roughly 520 lines, containing only Express/middleware setup, the two doc-serving routes (`/api/openapi.json`, `/openapi.json`), the static-asset and frontend-serving routes, and nine `register<Domain>Routes(app)` calls. Every one of the 9 new `routes/*.js` files (`metaInfo`, `keyframe`, `schema`, `user`, `project`, `session`, `species`, `dataset`, `observation`) carries a full JSDoc header and per-handler inline comments describing real, verified behavior — including every already-known caveat (swallowed errors, REST-verb violations, the `obsID`/`observation_id` column mismatch, the non-wrapped `model_species` request bodies, the `app.use()`-based any-verb route) carried forward unchanged rather than silently corrected. `docs/openapi.js`'s schema-generation logic is now a small, data-driven table instead of one-off hardcoded blocks, making any future domain's conversion a short config addition. `routes/task.routes.js`, written before inline comments became the established convention partway through this effort, was retrofitted to match every other domain's standard. The closing gate was a clean `npm run docs:build` (both the OpenAPI and JSDoc generators) and a full Jest run at 18 suites / 91 tests passing, with the dev database left in the same state it started in after every round of live-testing cleanup.
