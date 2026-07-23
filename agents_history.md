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
