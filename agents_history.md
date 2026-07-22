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
