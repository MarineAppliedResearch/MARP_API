/**
 * Express application definition for the MARP API.
 *
 * This module initializes the Express application, loads environment
 * configuration, registers shared middleware, connects API routes to their
 * controllers, generates the OpenAPI specification, and serves API and
 * internal developer documentation.
 *
 * The app provides the HTTP interface used by MARP applications,
 * processing workers, reporting tools, and other authorized clients.
 *
 * Route handlers defined in this file should delegate application behavior to
 * controllers rather than implementing database access or business logic
 * directly.
 *
 * This module does not call app.listen() — see server.js for the HTTP entry
 * point. Exporting the app on its own lets it be imported directly by tests
 * (e.g. Supertest) without starting a real server.
 *
 * @fileoverview Express application initialization, middleware configuration,
 * API route registration, and documentation setup for the MARP API.
 * @author Isaac Travers
 * @module app
 */


/**
 * Express framework used to create the HTTP server, register middleware,
 * and define API routes.
 *
 * @constant
 */
const express = require('express');


/**
 * Middleware package used to parse incoming JSON request bodies.
 *
 * @constant
 */
const bodyParser = require('body-parser');


/**
 * Node.js filesystem module used to read local files required by the server.
 *
 * @constant
 */
const fs = require('fs');


/**
 * Node.js path module used to construct platform-independent filesystem paths.
 *
 * @constant
 */
const path = require('path');


/**
 * Express middleware used to enable cross-origin requests.
 *
 * @constant
 */
const cors = require('cors');


/**
 * Loads environment variables from the local `.env` file into `process.env`.
 */
require('dotenv').config();


/**
 * Controller responsible for task-related API operations.
 *
 * @constant
 * @type {Object}
 */
const taskController = require('./controller/task.controller');


/**
 * Controller responsible for observation queries, updates, dashboard data,
 * and observation-related operations.
 *
 * @constant
 * @type {Object}
 */
const observationController = require('./controller/observation.controller');


/**
 * Controller responsible for observation keyframes and frame-related data.
 *
 * @constant
 * @type {Object}
 */
const keyframeController = require('./controller/keyframe.controller');


/**
 * Controller responsible for user-related API operations.
 *
 * @constant
 * @type {Object}
 */
const userController = require('./controller/user.controller');


/**
 * Controller responsible for project metadata and project-level operations.
 *
 * @constant
 * @type {Object}
 */
const projectController = require('./controller/project.controller');


/**
 * Controller responsible for session, dive, transect, and related operations.
 *
 * @constant
 * @type {Object}
 */
const sessionController = require('./controller/session.controller');


/**
 * Controller responsible for API, application, and database metadata.
 *
 * @constant
 * @type {Object}
 */
const metaInfoController = require('./controller/metaInfo.controller');


/**
 * Controller responsible for species and taxonomic data operations.
 *
 * @constant
 * @type {Object}
 */
const speciesController = require('./controller/species.controller');


/**
 * Controller responsible for machine-learning dataset operations.
 *
 * @constant
 * @type {Object}
 */
const datasetController = require('./controller/dataset.controller');


/**
 * Builds the OpenAPI specification from annotations in the API source files.
 *
 * @constant
 * @type {Function}
 */
const { buildOpenApiSpec } = require('./docs/openapi');
const {
    ApiError,
    ERROR_CODES,
    asyncHandler,
    apiNotFoundHandler,
    errorHandler,
    requestIdMiddleware,
} = require('./middleware/error-contract.middleware');


//---------------------------------------------------------
// Database initialization and connection validation
//---------------------------------------------------------

/**
 * Shared database object initialized by the model registry.
 *
 * The model registry creates the Sequelize connection, loads the database
 * models, and exposes them through one shared object. Repositories must use
 * this same Sequelize instance so all database operations share the same
 * connection and model registry.
 *
 * @constant
 * @type {Object}
 */
const db = require('./model');


/**
 * Repository modules that are expected to use the shared Sequelize instance.
 *
 * This list is checked during server initialization to detect repositories
 * that created or imported a different database connection.
 *
 * @constant
 * @type {string[]}
 */
const repositoryPaths = [
    './repository/metaInfo.repository',
    './repository/task.repository',
    './repository/user.repository',
    './repository/species.repository',
    './repository/project.repository',
    './repository/session.repository',
    './repository/observation.repository',
    './repository/keyframe.repository',
    './repository/dataset.repository',
];


/**
 * Verify that every repository uses the application's shared Sequelize
 * connection.
 *
 * Each repository is loaded and its exported `db.sequelize` reference is
 * compared by identity with the Sequelize instance provided by the model
 * registry. A mismatch indicates that a repository is using a separate
 * database object or connection.
 *
 * @param {Object} sharedDb - Shared database object exported by the model registry.
 * @param {Object} sharedDb.sequelize - Sequelize instance all repositories must use.
 * @returns {void}
 * @throws {Error} If one or more repositories use a different Sequelize instance.
 */
function validateSharedSequelizeConnection(sharedDb) {
    // Collect every repository that does not reference the shared connection.
    const mismatchedRepositories = [];

    for (const repositoryPath of repositoryPaths) {
        // Load the repository so its exported database reference can be checked.
        const repository = require(repositoryPath);

        // Read the Sequelize instance exposed through the repository's db object.
        const repositorySequelize = repository?.db?.sequelize;

        if (repositorySequelize !== sharedDb.sequelize) {
            mismatchedRepositories.push(repositoryPath);
        }
    }

    if (mismatchedRepositories.length > 0) {
        throw new Error(
            'Repository Sequelize mismatch detected for: ' +
            mismatchedRepositories.join(', ')
        );
    }

    console.log(
        `[DB Guard] Shared Sequelize validated across ${repositoryPaths.length} repositories.`
    );
}


/**
 * Initialize and validate the database when the server starts.
 *
 * The initialization sequence authenticates the shared Sequelize connection,
 * verifies that all repositories use that connection, and optionally performs
 * explicitly enabled model synchronization during development.
 *
 * Core production tables are intentionally not synchronized automatically.
 * Individual development model sync calls must be enabled manually.
 *
 * Database initialization errors are logged so the cause of a startup failure
 * is visible in the server output.
 *
 * @async
 * @returns {Promise<void>}
 */
(async () => {
    try {
        // Confirm that Sequelize can connect to the configured PostgreSQL database.
        await db.sequelize.authenticate();
        console.log('Connected to PostgreSQL.');

        // Ensure all repositories use the same Sequelize connection.
        validateSharedSequelizeConnection(db);

        if (process.env.NODE_ENV === 'development') {
            // Enable individual model sync calls only while actively developing
            // the corresponding schema. These remain disabled by default to
            // prevent unintended database changes.

            // await db.metrics_summary.sync({ alter: true });
            // await db.metrics_curves.sync({ alter: true });
            // await db.training_runs.sync({ alter: true });
            // await db.epochs.sync({ alter: true });
            // await db.ml_models.sync({ alter: true });
            // await db.species.sync({ alter: true });
            // await db.model_species.sync({ alter: true });

            // Existing core tables are managed separately and are not
            // automatically synchronized during application startup.
            console.log(
                'Skipping sync for existing core tables (observations, sessions, etc.)'
            );
            console.log(
                'Development schema synced safely (non-destructive).'
            );
        }

        console.log('Models initialized successfully.');
    } catch (err) {
        console.error('Database initialization failed:', err);
    }
})();


/**
 * Express application instance used to register middleware, routes,
 * documentation endpoints, and static resources.
 *
 * @constant
 * @type {Object}
 */
const app = express();


// Allow browser applications from other origins to access the API.
app.use(cors());


/**
 * Swagger UI middleware used to render the generated OpenAPI specification.
 *
 * @constant
 * @type {Object}
 */
const swaggerUi = require('swagger-ui-express');


/**
 * Generated OpenAPI document built from source-code `@openapi` annotations.
 *
 * The document is used by Swagger UI and exposed directly as JSON for
 * development tools, validation, and external API clients.
 *
 * @constant
 * @type {Object}
 */
const generatedSwaggerDocument = buildOpenApiSpec();


/**
 * Custom CSS applied to the Swagger UI documentation site.
 *
 * @constant
 * @type {string}
 */
const customCss = fs.readFileSync(
    path.join(__dirname, 'swagger.css'),
    'utf8'
);


// Parse incoming JSON request bodies.
app.use(bodyParser.json());

// Attach or generate an API request correlation id.
app.use(requestIdMiddleware);


// Serve the interactive Swagger UI documentation site.
app.use(
    '/api-docs',
    swaggerUi.serveFiles(generatedSwaggerDocument),
    swaggerUi.setup(generatedSwaggerDocument, { customCss })
);


/**
 * @openapi
 * /openapi.json:
 *   get:
 *     summary: Retrieve the OpenAPI specification
 *     description: Returns the generated OpenAPI document used by the API documentation and development tools.
 *     tags:
 *       - Documentation
 *     responses:
 *       200:
 *         description: OpenAPI specification returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/api/openapi.json', (req, res) => {
    res.json(generatedSwaggerDocument);
});


/**
 * @openapi
 * /../openapi.json:
 *   get:
 *     summary: Retrieve the OpenAPI specification from the root alias
 *     description: Returns the generated OpenAPI document from the root-level compatibility endpoint.
 *     tags:
 *       - Documentation
 *     responses:
 *       200:
 *         description: OpenAPI specification returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/openapi.json', (req, res) => {
    res.json(generatedSwaggerDocument);
});


/**
 * @openapi
 * /../developer-docs:
 *   get:
 *     summary: Open internal developer documentation
 *     description: >
 *       Serves the generated JSDoc website containing internal source-code and
 *       module documentation. This endpoint returns HTML and related static
 *       assets rather than a JSON API response.
 *     tags:
 *       - Documentation
 *     responses:
 *       200:
 *         description: Developer documentation page returned successfully.
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
app.use(
    '/developer-docs',
    express.static(path.join(__dirname, 'docs', 'developer'))
);


// Mount reporting endpoints under the shared /api base path.
// Individual reporting routes must define their own @openapi blocks in
// ./reporting/routes or the route modules imported from that directory.
app.use('/api', require('./reporting/routes'));


/**
 * @openapi
 * /getObservationsByVideo:
 *   get:
 *     summary: Retrieve observations for a video
 *     description: >
 *       Returns observations whose video_source exactly matches the supplied
 *       videoName. Results are ordered by mediaPosition in ascending order and
 *       include associated keyframes. Observations without keyframes are
 *       excluded. An empty array may indicate either that no records matched
 *       or that the database query failed.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: query
 *         name: videoName
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact video_source value to match.
 *     responses:
 *       200:
 *         description: Matching observations returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Observation'
 */
app.get('/api/getObservationsByVideo', asyncHandler(async (req, res) => {
    const data = await observationController.getObservationsByVideo(req.query.videoName);
    res.json(data);
}));


/**
 * @openapi
 * /getVideoSummaries/{project_id}:
 *   get:
 *     summary: Retrieve video summaries for a project
 *     description: >
 *       Returns one summary row for each distinct combination of video_source
 *       and videoLocation associated with sessions in the specified project.
 *       Each row includes the number of distinct observation common names, the
 *       number of distinct sessions, and representative dive, line, and session
 *       type values selected using MIN aggregation. Results are ordered by the
 *       representative dive and line in ascending order. Videos without a
 *       matching session in the project are excluded. An empty array may mean
 *       that no matching observations were found or that the database query
 *       failed.
 *     tags:
 *       - Observations
 *       - Videos
 *     parameters:
 *       - in: path
 *         name: project_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Database identifier of the project whose videos should be summarized.
 *     responses:
 *       200:
 *         description: >
 *           Video summaries returned successfully. distinct_species_count,
 *           session_count, dive, and line are numeric strings rather than
 *           numbers because they come back from raw Postgres aggregates
 *           (Sequelize raw:true); see VideoSummaryReport for the verified
 *           field-by-field shape, captured from real response samples.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VideoSummaryReport'
 */
app.get('/api/getVideoSummaries/:project_id', asyncHandler(async (req, res) => {
    const data = await observationController.getVideoSummariesByProject(req.params.project_id);
    res.json(data);
}));



/**
 * @openapi
 * /getObservationsByVideoAndComnames:
 *   get:
 *     summary: Retrieve video observations filtered by common name
 *     description: >
 *       Returns observations whose video_source exactly matches videoName and
 *       whose comname is included in comnameList. Results are ordered by
 *       mediaPosition in ascending order and include associated keyframes.
 *       Observations without at least one keyframe are excluded. The current
 *       repository returns an empty array both when no observations match and
 *       when the database query fails.
 *     tags:
 *       - Observations
 *       - Videos
 *     parameters:
 *       - in: query
 *         name: videoName
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact value to match against the observation video_source field.
 *       - in: query
 *         name: comnameList
 *         required: true
 *         style: form
 *         explode: true
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: >
 *           Common names used to filter observations. Supply the parameter
 *           repeatedly, such as comnameList=Bat%20star&comnameList=Leather%20star.
 *     responses:
 *       200:
 *         description: Matching observations returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ObservationWithKeyframes'
 */
app.get('/api/getObservationsByVideoAndComnames', asyncHandler(async (req, res) => {
    const data = await observationController.getObservationsByVideoAndComnames(
        req.query.videoName,
        req.query.comnameList
    );
    res.json(data);
}));


/**
 * @openapi
 * /getObservationsByVideoAndProject/{videoName}/{projectName}:
 *   get:
 *     summary: Retrieve observations for a video within a project
 *     description: >
 *       Returns observations whose video_source exactly matches videoName and
 *       whose associated session belongs to the project identified by
 *       projectName. Results are ordered by mediaPosition in ascending order.
 *       Each observation includes its full associated session object (the
 *       session join has no attribute restriction) in addition to keyframes.
 *       Associated keyframes are included when available, but observations
 *       without keyframes are also returned. An empty array may indicate that
 *       no observations matched, the project was not found, or the database
 *       query failed.
 *     tags:
 *       - Observations
 *       - Projects
 *       - Videos
 *     parameters:
 *       - in: path
 *         name: videoName
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact value to match against the observation video_source field.
 *       - in: path
 *         name: projectName
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact project name used to locate the associated project record.
 *     responses:
 *       200:
 *         description: Matching observations returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ObservationWithSessionAndKeyframes'
 */
app.get(
    '/api/getObservationsByVideoAndProject/:videoName/:projectName',
    asyncHandler(async (req, res) => {
        const data = await observationController.getObservationsByVideoAndProject(
            req.params.videoName,
            req.params.projectName
        );
        res.json(data);
    })
);


/**
 * @openapi
 * /getObservationsWithKeyframesByComnames:
 *   get:
 *     summary: Retrieve observations with keyframes by common name
 *     description: >
 *       Returns observations whose comname matches one of the supplied common
 *       names. The comnameList query parameter must contain a comma-separated
 *       list of URL-encoded common names. Results are ordered by mediaPosition
 *       in ascending order and include associated keyframes. Observations
 *       without at least one keyframe are excluded. An empty array may indicate
 *       that no observations matched or that the repository query failed.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: query
 *         name: comnameList
 *         required: true
 *         schema:
 *           type: string
 *         example: Bat%20star,Leather%20star
 *         description: >
 *           Comma-separated list of common names. Each value is decoded after
 *           the string is split on commas.
 *     responses:
 *       200:
 *         description: Matching observations with keyframes returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ObservationWithKeyframes'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/getObservationsWithKeyframesByComnames', asyncHandler(async (req, res) => {
    // Convert the comma-separated query value into an array of decoded
    // common-name strings. A missing parameter produces an empty array.
    const comnameList = req.query.comnameList
        ? req.query.comnameList.split(',').map(decodeURIComponent)
        : [];

    // Delegate the filtered observation query to the observation controller.
    const data = await observationController.getObservationsWithKeyframesByComnames(comnameList);
    res.json(data);
}));


/**
 * @openapi
 * /getDistinctComnamesWithKeyframes:
 *   get:
 *     summary: Fetch distinct common names that have keyframes
 *     description: >
 *       Returns every distinct comname value found on observations that have
 *       at least one associated keyframe. This route is registered with
 *       `app.use` rather than `app.get`, so it technically responds to any
 *       HTTP method, not just GET.
 *     tags:
 *       - Observations
 *     responses:
 *       200:
 *         description: Distinct common names returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 */
app.use('/api/getDistinctComnamesWithKeyframes', asyncHandler(async (req, res) => {
    const data = await observationController.getDistinctComnamesWithKeyframes();
    res.json(data);
}));


/**
 * @openapi
 * /dashboardData:
 *   get:
 *     summary: Fetch per-user dashboard activity data
 *     description: >
 *       Returns per-user, per-date observation activity counts for a
 *       dashboard view. Both start and end are required for any data to come
 *       back: the underlying query filters observations.createdAt with a
 *       Sequelize Op.between, and an undefined bound matches nothing, so
 *       omitting either parameter returns {} rather than unfiltered data.
 *       sessions and projects are always 0 in the current implementation;
 *       only the observations count is actually populated.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: query
 *         name: start
 *         required: false
 *         schema:
 *           type: string
 *         description: Start of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.
 *       - in: query
 *         name: end
 *         required: false
 *         schema:
 *           type: string
 *         description: End of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.
 *     responses:
 *       200:
 *         description: Dashboard data returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserDashboardData'
 */
app.get('/api/dashboardData', asyncHandler(async (req, res) => {
    const data = await observationController.getUserDashboardData(req.query.start, req.query.end);
    res.json(data);
}));

/**
 * @openapi
 * /getProjectTimeByDateAndUser:
 *   get:
 *     summary: Fetch estimated recording time by project, date, and user
 *     description: >
 *       Returns an object keyed by project name, then by date, then by user
 *       name, containing the estimated minutes recorded within the given
 *       date range. Both start and end are required for any data to come
 *       back: the underlying query filters observations.createdAt with a
 *       Sequelize Op.between, and an undefined bound matches nothing, so
 *       omitting either parameter returns {} rather than unfiltered data.
 *       KNOWN BUG: the last observation of every session/day contributes
 *       zero minutes to the total, so returned time is systematically
 *       undercounted.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: query
 *         name: start
 *         required: false
 *         schema:
 *           type: string
 *         description: Start of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.
 *       - in: query
 *         name: end
 *         required: false
 *         schema:
 *           type: string
 *         description: End of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.
 *     responses:
 *       200:
 *         description: Grouped time data returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProjectTimeByDateAndUser'
 */
app.get('/api/getProjectTimeByDateAndUser', asyncHandler(async (req, res) => {
    const data = await observationController.getProjectTimeByDateAndUser(req.query.start, req.query.end);
    res.json(data);
}));

/**
 * @openapi
 * /tasks:
 *   get:
 *     summary: Fetch all tasks
 *     description: Returns every task row currently available in storage.
 *     tags: [Tasks]
 *     responses:
 *       200:
 *         description: Task list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Task'
 */
app.get('/api/tasks', asyncHandler(async (req, res) => {
    const data = await taskController.getTasks();
    res.json(data);
}));

/**
 * @openapi
 * /observations:
 *   get:
 *     summary: Fetch all observations
 *     description: Returns all observation records available through the V1 API.
 *     tags: [Observations]
 *     responses:
 *       200:
 *         description: Observation list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Observation'
 */
app.get('/api/observations', asyncHandler(async (req, res) => {
    const data = await observationController.getObservations();
    res.json(data);
}));

/**
 * @openapi
 * /observation/getLastVideoInfo/{session_id}:
 *   get:
 *     summary: Fetch latest video info for a session
 *     description: Returns the most recent video metadata associated with a session.
 *     tags: [Observations]
 *     parameters:
 *       - in: path
 *         name: session_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Session identifier.
 *     responses:
 *       200:
 *         description: Last video information returned successfully.
 */
app.get('/api/observation/getLastVideoInfo/:session_id', asyncHandler(async (req, res) => {
    const data = await observationController.getLastVideoInfo(req.params.session_id);
    res.json(data);
}));


/**
 * @openapi
 * /observation/getMaxObservationFromVideo/{video_source}:
 *   get:
 *     summary: Fetch the observation with the highest observation_id for a video
 *     description: >
 *       Returns the observation record(s) matching the maximum
 *       observation_id for the given video_source. Note that despite the
 *       name, the repository implementation returns an array of matching
 *       observation records (from a findAll query) rather than a single
 *       integer id.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: path
 *         name: video_source
 *         required: true
 *         schema:
 *           type: string
 *         description: Video source value to match.
 *     responses:
 *       200:
 *         description: Matching observation record(s) returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Observation'
 */
app.get('/api/observation/getMaxObservationFromVideo/:video_source', asyncHandler(async (req, res) => {
    const data = await observationController.getMaxObservationFromVideo(req.params.video_source);
    res.json(data);
}));

/**
 * @openapi
 * /observation/updateObservationWithCount/{session_id}/{observation_id}/{count}:
 *   get:
 *     summary: Update an observation's count field
 *     description: >
 *       Updates the count field of a specific observation within a session.
 *       CRITICAL: despite using HTTP GET, this endpoint performs a database
 *       UPDATE — a REST verb violation. CRITICAL: the observation_id path
 *       parameter is actually matched against the obsID column, not the
 *       observation_id primary key column — supplying the real primary-key
 *       value will silently match zero rows, and the repository reports
 *       success regardless of how many rows were actually affected.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: path
 *         name: session_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Session identifier used together with obsID to locate the target observation.
 *       - in: path
 *         name: observation_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: >
 *           Matched against the obsID column, not the observation_id
 *           primary key, despite the parameter name.
 *       - in: path
 *         name: count
 *         required: true
 *         schema:
 *           type: integer
 *         description: New count value to persist.
 *     responses:
 *       200:
 *         description: >
 *           1 if the update statement executed without throwing, 0 if it
 *           failed. Does not indicate whether any row was actually matched.
 *         content:
 *           application/json:
 *             schema:
 *               type: integer
 */
app.get('/api/observation/updateObservationWithCount/:session_id/:observation_id/:count', asyncHandler(async (req, res) => {
    const data = await observationController.updateObservationWithCount(req.params.session_id, req.params.observation_id, req.params.count);
    res.json(data);
}));

/**
 * @openapi
 * /observation/updateObservationWithSize/{session_id}/{observation_id}/{size}:
 *   get:
 *     summary: Update an observation's size field
 *     description: >
 *       Updates the coarsesize field of a specific observation within a
 *       session. CRITICAL: despite using HTTP GET, this endpoint performs a
 *       database UPDATE — a REST verb violation. CRITICAL: the
 *       observation_id path parameter is actually matched against the
 *       obsID column, not the observation_id primary key column —
 *       supplying the real primary-key value will silently match zero
 *       rows, and the repository reports success regardless of how many
 *       rows were actually affected.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: path
 *         name: session_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Session identifier used together with obsID to locate the target observation.
 *       - in: path
 *         name: observation_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: >
 *           Matched against the obsID column, not the observation_id
 *           primary key, despite the parameter name.
 *       - in: path
 *         name: size
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: New coarse-size value to persist.
 *     responses:
 *       200:
 *         description: >
 *           1 if the update statement executed without throwing, 0 if it
 *           failed. Does not indicate whether any row was actually matched.
 *         content:
 *           application/json:
 *             schema:
 *               type: integer
 */
app.get('/api/observation/updateObservationWithSize/:session_id/:observation_id/:size', asyncHandler(async (req, res) => {
    const data = await observationController.updateObservationWithSize(req.params.session_id, req.params.observation_id, req.params.size);
    res.json(data);
}));

/**
 * @openapi
 * /observations/bySessionID/{session_id}:
 *   get:
 *     summary: Fetch observations for a session
 *     description: >
 *       Returns every observation belonging to a session, including
 *       associated keyframes when present.
 *     tags:
 *       - Observations
 *     parameters:
 *       - in: path
 *         name: session_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Session identifier to match.
 *     responses:
 *       200:
 *         description: Matching observations returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Observation'
 */
app.get('/api/observations/bySessionID/:session_id', asyncHandler(async (req, res) => {
    const data = await observationController.getObservationsBySessionID(req.params.session_id);
    res.json(data);
}));




/**
 * @openapi
 * /species:
 *   get:
 *     summary: Fetch all species
 *     description: >
 *       Returns every species record used for taxonomy, GUI display
 *       configuration, and ML model training labels. An empty array may
 *       indicate either that no records exist or that the database query
 *       failed.
 *     tags: [Species]
 *     responses:
 *       200:
 *         description: Species list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Species'
 */
app.get('/api/species', asyncHandler(async (req, res) => {
    const data = await speciesController.getSpecies();
    res.json(data);
}));

/**
 * @openapi
 * /species/by-comname/{comname}:
 *   get:
 *     summary: Fetch a species by common name
 *     description: >
 *       Returns the species record whose comname matches the supplied value,
 *       case-insensitively. Returns null both when no species matches and
 *       when the database query fails.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: comname
 *         required: true
 *         schema:
 *           type: string
 *         description: Common name to match, case-insensitively.
 *     responses:
 *       200:
 *         description: Matching species returned, or null if not found.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Species'
 *                 - type: 'null'
 */
app.get('/api/species/by-comname/:comname', asyncHandler(async (req, res) => {
    const data = await speciesController.getSpeciesByComname(req, res);
    res.json(data);
}));

/**
 * @openapi
 * /species/{id}:
 *   get:
 *     summary: Fetch a species by id
 *     description: >
 *       Returns a single species record by id, or null if not found. A
 *       database failure rejects the returned promise, so the route's
 *       .catch() responds with HTTP 500 in that case.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: id of the species record to fetch.
 *     responses:
 *       200:
 *         description: The matching species record, or null if not found.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Species'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/species/:id', asyncHandler(async (req, res) => {
    const data = await speciesController.getSpeciesById(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /species:
 *   post:
 *     summary: Create a new species record
 *     description: >
 *       Creates a new species record. The caller must supply a unique
 *       taxserial (see the species_taxserial_idx unique index in
 *       model/species.model.js). A database failure rejects the returned
 *       promise, so the route's .catch() responds with HTTP 500 in that
 *       case.
 *     tags: [Species]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - species
 *             properties:
 *               species:
 *                 $ref: '#/components/schemas/Species'
 *     responses:
 *       200:
 *         description: The created species record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Species'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.post('/api/species', asyncHandler(async (req, res) => {
    const data = await speciesController.createSpecies(req.body.species);
    res.json(data);
}));

/**
 * @openapi
 * /species/{id}:
 *   put:
 *     summary: Update an existing species record
 *     description: >
 *       Updates an existing species record by id. A database failure
 *       rejects the returned promise, so the route's .catch() responds
 *       with HTTP 500 in that case.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: id of the species record to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - species
 *             properties:
 *               species:
 *                 $ref: '#/components/schemas/Species'
 *     responses:
 *       200:
 *         description: >
 *           The updated species record, or null if no species matched the
 *           given id.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Species'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/species/:id', asyncHandler(async (req, res) => {
    const data = await speciesController.updateSpecies(req.params.id, req.body.species);
    res.json(data);
}));

/**
 * @openapi
 * /species/{id}:
 *   delete:
 *     summary: Delete a species record
 *     description: >
 *       Deletes a species record by id. A database failure rejects the
 *       returned promise, so the route's .catch() responds with HTTP 500
 *       in that case.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: id of the species record to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/species/:id', asyncHandler(async (req, res) => {
    const data = await speciesController.deleteSpecies(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /model_species:
 *   post:
 *     summary: Create a model-species linkage record
 *     description: >
 *       Creates a model_species join record linking an ML model to a species,
 *       using the request body directly as the record to insert. Note that
 *       when the insert fails the response body is an ErrorResponse-shaped
 *       object, but the endpoint currently still responds with HTTP 200
 *       rather than an error status.
 *     tags: [Species]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model_id
 *               - species_id
 *             properties:
 *               model_id:
 *                 type: integer
 *                 example: 7
 *               species_id:
 *                 type: integer
 *                 example: 42
 *               dataset_size:
 *                 type: integer
 *                 nullable: true
 *               balance_weight:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               precision_mean:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               recall_mean:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               f1_mean:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Model-species record created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ModelSpecies'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.post('/api/model_species', asyncHandler(async (req, res) => {
    const data = await speciesController.createModelSpecies(req, res);
    res.json(data);
}));

/**
 * @openapi
 * /model_species/{id}:
 *   get:
 *     summary: Fetch a model_species record by id
 *     description: >
 *       Returns a single model_species join record by ID, or null if not
 *       found. A database failure rejects the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the model_species record to fetch.
 *     responses:
 *       200:
 *         description: The matching model_species record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ModelSpecies'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/model_species/:id', asyncHandler(async (req, res) => {
    const data = await speciesController.getModelSpeciesById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `ModelSpecies ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /model_species/{id}:
 *   put:
 *     summary: Update an existing model_species record
 *     description: >
 *       Updates an existing model_species join record by ID. The request
 *       body fields are used directly (unwrapped), matching the
 *       POST /model_species convention. A database failure rejects the
 *       returned promise, so the route's .catch() responds with HTTP 500
 *       in that case.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the model_species record to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ModelSpecies'
 *     responses:
 *       200:
 *         description: >
 *           The updated model_species record, or null if no row matched
 *           the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/ModelSpecies'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/model_species/:id', asyncHandler(async (req, res) => {
    const data = await speciesController.updateModelSpecies(req.params.id, req.body);
    res.json(data);
}));

/**
 * @openapi
 * /model_species/{id}:
 *   delete:
 *     summary: Delete a model_species record
 *     description: >
 *       Deletes a model_species join record by ID. A database failure
 *       rejects the returned promise, so the route's .catch() responds
 *       with HTTP 500 in that case.
 *     tags: [Species]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the model_species record to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/model_species/:id', asyncHandler(async (req, res) => {
    const data = await speciesController.deleteModelSpecies(req.params.id);
    res.json(data);
}));


/**
 * @openapi
 * /users:
 *   get:
 *     summary: Fetch all users
 *     description: Returns every user record.
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: User list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
app.get('/api/users', asyncHandler(async (req, res) => {
    const data = await userController.getUsers();
    res.json(data);
}));

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Fetch a user by id
 *     description: >
 *       Returns a single user record by user_id, or null if not found.
 *       Database failures reject the returned promise, so the route's
 *       .catch() responds with HTTP 500 in that case. Registered under the
 *       plural /users path (rather than /user/:id) to avoid colliding with
 *       the existing name-based lookup at /user/{name}.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: user_id of the user to fetch.
 *     responses:
 *       200:
 *         description: The matching user record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/users/:id', asyncHandler(async (req, res) => {
    const data = await userController.getUserById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `User ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /user/{name}:
 *   get:
 *     summary: Fetch a user by name
 *     description: >
 *       Returns the user record(s) matching an exact display name. Resolves
 *       to an empty array both when no user has that name and when the
 *       underlying database query fails.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact display name to match.
 *     responses:
 *       200:
 *         description: Matching user record(s) returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
app.get('/api/user/:name', asyncHandler(async (req, res) => {
    const data = await userController.getUserByName(req.params.name);
    res.json(data);
}));

/**
 * @openapi
 * /projects:
 *   get:
 *     summary: Fetch all projects
 *     description: Returns every project record.
 *     tags: [Projects]
 *     responses:
 *       200:
 *         description: Project list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Project'
 */
app.get('/api/projects', asyncHandler(async (req, res) => {
    const data = await projectController.getProjects();
    res.json(data);
}));

/**
 * @openapi
 * /projects/user/{userID}:
 *   get:
 *     summary: Fetch projects belonging to a user
 *     description: >
 *       Returns every project that has at least one session belonging to
 *       the given user.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: userID
 *         required: true
 *         schema:
 *           type: integer
 *         description: Identifier of the user whose projects should be returned.
 *     responses:
 *       200:
 *         description: Matching project records returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Project'
 */
app.get('/api/projects/user/:userID', asyncHandler(async (req, res) => {
    const data = await projectController.getProjectsByUserID(req.params.userID);
    res.json(data);
}));

/**
 * @openapi
 * /project/getProjectByName/{projectName}:
 *   get:
 *     summary: Fetch a project by name
 *     description: >
 *       Returns the project record(s) matching an exact project name.
 *       CRITICAL: unlike other repository methods in this codebase, a
 *       database failure here resolves with the raw JavaScript Error
 *       object itself (not null, not an array, not an ErrorResponse-shaped
 *       body) — so a failure response will not match a typical error
 *       schema and callers should not rely on a consistent error shape
 *       from this endpoint.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectName
 *         required: true
 *         schema:
 *           type: string
 *         description: Exact project name to match.
 *     responses:
 *       200:
 *         description: >
 *           Matching project record(s) as an array, or a raw Error object
 *           if the query failed (see description).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Project'
 */
app.get('/api/project/getProjectByName/:projectName', asyncHandler(async (req, res) => {
    const data = await projectController.getProjectByName(req.params.projectName);
    res.json(data);
}));

/**
 * @openapi
 * /sessions:
 *   get:
 *     summary: Fetch all sessions
 *     description: Returns every session record, each including its associated user.
 *     tags: [Sessions]
 *     responses:
 *       200:
 *         description: Session list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 */
app.get('/api/sessions', asyncHandler(async (req, res) => {
    const data = await sessionController.getSessions();
    res.json(data);
}));

/**
 * @openapi
 * /session/{id}:
 *   get:
 *     summary: Fetch a session by id
 *     description: >
 *       Returns a single session record by session_id, or null if not
 *       found. Database failures reject the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: session_id of the session to fetch.
 *     responses:
 *       200:
 *         description: The matching session record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/session/:id', asyncHandler(async (req, res) => {
    const data = await sessionController.getSessionById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Session ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /sessions/user/{userID}/project/{projectID}:
 *   get:
 *     summary: Fetch sessions for a user within a project
 *     description: >
 *       Returns sessions matching the given user and project, each
 *       including its associated user and project.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: userID
 *         required: true
 *         schema:
 *           type: integer
 *         description: Identifier of the user whose sessions should be fetched.
 *       - in: path
 *         name: projectID
 *         required: true
 *         schema:
 *           type: integer
 *         description: Identifier of the project to scope the sessions to.
 *     responses:
 *       200:
 *         description: Matching session records returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 */
app.get('/api/sessions/user/:userID/project/:projectID', asyncHandler(async (req, res) => {
    const data = await sessionController.getSessionsByUserIdAndProjectId(req.params.userID, req.params.projectID);
    res.json(data);
}));

/**
 * @openapi
 * /metaInfo/dbName:
 *   get:
 *     summary: Retrieve active database name
 *     description: >
 *       Returns metadata identifying the current configured database as a
 *       single-element array containing only a name field (never the full
 *       metaInfo row).
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database name returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MetaInfoDbName'
 */
app.get('/api/metaInfo/dbName', asyncHandler(async (req, res) => {
    const data = await metaInfoController.getDBName();
    res.json(data);
}));

/**
 * @openapi
 * /user/getUserNameByID/{userID}:
 *   get:
 *     summary: Fetch a user's display name by id
 *     description: >
 *       Returns the display name of the user matching the given id.
 *       CRITICAL: if no user matches the given ID, this can throw / return
 *       an unhandled error (HTTP 500 via the framework's default error
 *       handling, or an unhandled rejection since the route has no
 *       .catch()), because the repository accesses a property on the
 *       query result without checking whether it's null first.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userID
 *         required: true
 *         schema:
 *           type: integer
 *         description: Identifier of the user whose name should be returned.
 *     responses:
 *       200:
 *         description: User name returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
app.get('/api/user/getUserNameByID/:userID', asyncHandler(async (req, res) => {
    const data = await userController.getUserNameByID(req.params.userID);
    res.json(data);
}));

/**
 * @openapi
 * /ml_models:
 *   get:
 *     summary: Fetch all ML models
 *     description: >
 *       Returns every ML model record. A database failure rejects rather
 *       than resolving to an empty array; the route's .catch() handles
 *       this and responds with HTTP 500.
 *     tags: [MachineLearning]
 *     responses:
 *       200:
 *         description: MlModel list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MlModel'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// GET /api/models
app.get('/api/ml_models', asyncHandler(async (req, res) => {
    const data = await datasetController.getMl_models();
    res.json(data);
}));





/**
 * @openapi
 * /dataset:
 *   get:
 *     summary: Fetch all datasets
 *     description: >
 *       Returns every dataset record. Database errors are swallowed and
 *       resolve to an empty array, so an empty result doesn't distinguish
 *       "no datasets" from "query failed."
 *     tags: [MachineLearning]
 *     responses:
 *       200:
 *         description: Dataset list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Dataset'
 */
app.get('/api/dataset', asyncHandler(async (req, res) => {
    const data = await datasetController.getDatasets();
    res.json(data);
}));


/**
 * @openapi
 * /dataset/{id}:
 *   get:
 *     summary: Fetch a dataset by id
 *     description: >
 *       Returns a single dataset record, or null if not found. Unlike
 *       getDatasets, a database error here does actually reject/throw, so
 *       the route's .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the dataset to fetch.
 *     responses:
 *       200:
 *         description: The matching dataset record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Dataset'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/dataset/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getDatasetById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Dataset ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /dataset/{id}:
 *   put:
 *     summary: Update an existing dataset
 *     description: >
 *       Updates an existing dataset record by ID. A database failure
 *       rejects the returned promise, so the route's .catch() responds
 *       with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the dataset to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dataset
 *             properties:
 *               dataset:
 *                 $ref: '#/components/schemas/Dataset'
 *     responses:
 *       200:
 *         description: >
 *           The updated dataset record, or null if no dataset matched the
 *           given ID.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Dataset'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/dataset/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.updateDataset(req.params.id, req.body.dataset);
    res.json(data);
}));

/**
 * @openapi
 * /dataset/{id}:
 *   delete:
 *     summary: Delete a dataset
 *     description: >
 *       Deletes a dataset record by ID. A database failure rejects the
 *       returned promise, so the route's .catch() responds with HTTP 500
 *       in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the dataset to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/dataset/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteDataset(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /dataset:
 *   post:
 *     summary: Create a new dataset
 *     description: >
 *       Creates a new dataset record. CRITICAL: a database failure here
 *       resolves to null rather than rejecting, so the route's .catch()
 *       handler is effectively dead code — a failed insert currently still
 *       responds with HTTP 200 and a null body rather than an error
 *       status.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dataset
 *             properties:
 *               dataset:
 *                 $ref: '#/components/schemas/Dataset'
 *     responses:
 *       200:
 *         description: >
 *           The created dataset record, or null if the insert failed (see
 *           description; the failure still returns HTTP 200).
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Dataset'
 *                 - type: 'null'
 */
// POST HERE
app.post('/api/dataset', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await datasetController.createDataset(req.body.dataset);
    res.json(data);
}));


/**
 * @openapi
 * /model:
 *   post:
 *     summary: Create a new ML model
 *     description: >
 *       Creates a new ML model record. Has a real .catch() handler that
 *       responds with HTTP 500 on failure.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *             properties:
 *               model:
 *                 $ref: '#/components/schemas/MlModel'
 *     responses:
 *       200:
 *         description: The created MlModel record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MlModel'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// ==========================================================
// POST /api/model
// ----------------------------------------------------------
// Creates a new ML model record in the database.
// Expects a JSON payload like:
// {
//   "model": {
//     "name": "yolov8_fish_2025",
//     "parent_model_id": 1,
//     "model_type": "YOLOv8",
//     "architecture_version": "custom-2025a",
//     "storage_path": "models/yolov8_fish_2025/weights",
//     "status": "training",
//     "notes": "Fine-tuned from yolov8_base on Fish2025 dataset"
//   }
// }
// ==========================================================
app.post('/api/model', asyncHandler(async (req, res) => {
    console.log("[API] POST /api/model", req.body);

    const data = await datasetController.createModel(req.body.model);
    res.json(data);
}));


/**
 * @openapi
 * /training_run:
 *   post:
 *     summary: Create a new training run
 *     description: Creates a new training run record.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - training_run
 *             properties:
 *               training_run:
 *                 $ref: '#/components/schemas/TrainingRun'
 *     responses:
 *       200:
 *         description: The created TrainingRun record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingRun'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/training_run
app.post('/api/training_run', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await datasetController.createTrainingRun(req.body.training_run);
    res.json(data);
}));


/**
 * @openapi
 * /training_run/{id}:
 *   put:
 *     summary: Update an existing training run
 *     description: >
 *       Updates an existing training run record by id. Returns the updated
 *       TrainingRun, or null if no row matched.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the training run to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - training_run
 *             properties:
 *               training_run:
 *                 $ref: '#/components/schemas/TrainingRun'
 *     responses:
 *       200:
 *         description: The updated TrainingRun record, or null if no row matched.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/TrainingRun'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// PUT /api/training_run/:id
app.put('/api/training_run/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = await datasetController.updateTrainingRun(id, req.body.training_run);
    res.json(data);
}));

/**
 * @openapi
 * /training_run/{id}:
 *   get:
 *     summary: Fetch a training run by id
 *     description: >
 *       Returns a single training run record by ID, or null if not found.
 *       A database failure rejects the returned promise, so the route's
 *       .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the training run to fetch.
 *     responses:
 *       200:
 *         description: The matching TrainingRun record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingRun'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/training_run/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getTrainingRunById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `TrainingRun ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /training_run/{id}:
 *   delete:
 *     summary: Delete a training run
 *     description: >
 *       Deletes a training run record by ID. A database failure rejects
 *       the returned promise, so the route's .catch() responds with HTTP
 *       500 in that case. Deleting a training run cascades to delete its
 *       epochs, metrics_summary, hyperparameters, and artifacts (see
 *       model/training_runs.model.js).
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the training run to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/training_run/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteTrainingRun(req.params.id);
    res.json(data);
}));


/**
 * @openapi
 * /metrics_summary:
 *   post:
 *     summary: Create a new metrics summary
 *     description: Creates a new metrics_summary record for a training run and dataset split.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metrics_summary
 *             properties:
 *               metrics_summary:
 *                 $ref: '#/components/schemas/MetricsSummary'
 *     responses:
 *       200:
 *         description: The created MetricsSummary record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MetricsSummary'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/metrics_summary
app.post('/api/metrics_summary', asyncHandler(async (req, res) => {
    const data = await datasetController.createMetricsSummary(req.body.metrics_summary);
    res.json(data);
}));

/**
 * @openapi
 * /metrics_summary/{id}:
 *   get:
 *     summary: Fetch a metrics_summary by id
 *     description: >
 *       Returns a single metrics_summary record by ID, or null if not
 *       found. A database failure rejects the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the metrics_summary to fetch.
 *     responses:
 *       200:
 *         description: The matching MetricsSummary record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MetricsSummary'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/metrics_summary/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getMetricsSummaryById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `MetricsSummary ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /metrics_summary/{id}:
 *   put:
 *     summary: Update an existing metrics_summary
 *     description: >
 *       Updates an existing metrics_summary record by ID. A database
 *       failure rejects the returned promise, so the route's .catch()
 *       responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the metrics_summary to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metrics_summary
 *             properties:
 *               metrics_summary:
 *                 $ref: '#/components/schemas/MetricsSummary'
 *     responses:
 *       200:
 *         description: >
 *           The updated metrics_summary record, or null if no row matched
 *           the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/MetricsSummary'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/metrics_summary/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.updateMetricsSummary(req.params.id, req.body.metrics_summary);
    res.json(data);
}));

/**
 * @openapi
 * /metrics_summary/{id}:
 *   delete:
 *     summary: Delete a metrics_summary
 *     description: >
 *       Deletes a metrics_summary record by ID. A database failure
 *       rejects the returned promise, so the route's .catch() responds
 *       with HTTP 500 in that case. Deleting a metrics_summary cascades
 *       to delete its metrics_curves (see model/metrics_summary.model.js).
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the metrics_summary to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/metrics_summary/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteMetricsSummary(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /metrics_curve:
 *   post:
 *     summary: Create a single metrics curve point
 *     description: Creates a single metrics_curve point tied to a metrics_summary record.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metrics_curve
 *             properties:
 *               metrics_curve:
 *                 $ref: '#/components/schemas/MetricsCurve'
 *     responses:
 *       200:
 *         description: The created MetricsCurve record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MetricsCurve'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/metrics_curve
app.post('/api/metrics_curve', asyncHandler(async (req, res) => {
    const data = await datasetController.createMetricsCurve(req.body.metrics_curve);
    res.json(data);
}));

/**
 * @openapi
 * /metrics_curve/{id}:
 *   get:
 *     summary: Fetch a metrics_curve by id
 *     description: >
 *       Returns a single metrics_curve record by ID, or null if not
 *       found. A database failure rejects the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the metrics_curve to fetch.
 *     responses:
 *       200:
 *         description: The matching MetricsCurve record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MetricsCurve'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/metrics_curve/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getMetricsCurveById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `MetricsCurve ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /metrics_curve/{id}:
 *   put:
 *     summary: Update an existing metrics_curve
 *     description: >
 *       Updates an existing metrics_curve record by ID. A database
 *       failure rejects the returned promise, so the route's .catch()
 *       responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the metrics_curve to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metrics_curve
 *             properties:
 *               metrics_curve:
 *                 $ref: '#/components/schemas/MetricsCurve'
 *     responses:
 *       200:
 *         description: >
 *           The updated metrics_curve record, or null if no row matched
 *           the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/MetricsCurve'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/metrics_curve/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.updateMetricsCurve(req.params.id, req.body.metrics_curve);
    res.json(data);
}));

/**
 * @openapi
 * /metrics_curve/{id}:
 *   delete:
 *     summary: Delete a metrics_curve
 *     description: >
 *       Deletes a metrics_curve record by ID. A database failure rejects
 *       the returned promise, so the route's .catch() responds with HTTP
 *       500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the metrics_curve to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/metrics_curve/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteMetricsCurve(req.params.id);
    res.json(data);
}));


/**
 * @openapi
 * /metrics_curves/bulk:
 *   post:
 *     summary: Bulk-create metrics curve records
 *     description: >
 *       Bulk-inserts metrics_curve records. CRITICAL: unlike every sibling
 *       create/bulk route, this method takes the raw Express req/res
 *       directly rather than an already-extracted body field — the
 *       request body must be a raw JSON array of MetricsCurve fields
 *       (req.body itself is passed straight to Sequelize's bulkCreate).
 *       CRITICAL: on a database failure this resolves to
 *       { error: err.message } at HTTP 200 rather than rejecting or
 *       returning a non-200 status; the route has no .catch() at all.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/MetricsCurve'
 *     responses:
 *       200:
 *         description: >
 *           On success, an { inserted: number } summary object (not the
 *           created records).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inserted:
 *                   type: integer
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// server.js or routes.js
app.post('/api/metrics_curves/bulk', asyncHandler(async (req, res) => {
    const data = await datasetController.bulkCreateMetricsCurves(req, res);
    res.json(data);
}));

/**
 * @openapi
 * /epoch:
 *   post:
 *     summary: Create a new epoch record
 *     description: Creates a new epoch record for a training run.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - epoch
 *             properties:
 *               epoch:
 *                 $ref: '#/components/schemas/Epoch'
 *     responses:
 *       200:
 *         description: The created Epoch record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Epoch'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/epoch
app.post('/api/epoch', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await datasetController.createEpoch(req.body.epoch);
    res.json(data);
}));


/**
 * @openapi
 * /epoch/{id}:
 *   put:
 *     summary: Update an existing epoch record
 *     description: >
 *       Updates an existing epoch record by id. Returns the updated Epoch,
 *       or null if no row matched.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the epoch to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - epoch
 *             properties:
 *               epoch:
 *                 $ref: '#/components/schemas/Epoch'
 *     responses:
 *       200:
 *         description: The updated Epoch record, or null if no row matched.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Epoch'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// PUT /api/epoch/:id
app.put('/api/epoch/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = await datasetController.updateEpoch(id, req.body.epoch);
    res.json(data);
}));

/**
 * @openapi
 * /epoch/{id}:
 *   get:
 *     summary: Fetch an epoch by id
 *     description: >
 *       Returns a single epoch record by ID, or null if not found. A
 *       database failure rejects the returned promise, so the route's
 *       .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the epoch to fetch.
 *     responses:
 *       200:
 *         description: The matching Epoch record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Epoch'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/epoch/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getEpochById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Epoch ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /epoch/{id}:
 *   delete:
 *     summary: Delete an epoch
 *     description: >
 *       Deletes an epoch record by ID. A database failure rejects the
 *       returned promise, so the route's .catch() responds with HTTP 500
 *       in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the epoch to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/epoch/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteEpoch(req.params.id);
    res.json(data);
}));



/**
 * @openapi
 * /model/{id}:
 *   put:
 *     summary: Update an existing ML model
 *     description: >
 *       Updates an existing ML model record by id. Returns the updated
 *       MlModel, or null if no row matched the given id (logged as a
 *       warning rather than an error in that case).
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the ML model to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *             properties:
 *               model:
 *                 $ref: '#/components/schemas/MlModel'
 *     responses:
 *       200:
 *         description: The updated MlModel record, or null if no row matched.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/MlModel'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// ==========================================================
// PUT /api/model/:id
// ----------------------------------------------------------
// Updates an existing ML model record.
// Expects a JSON payload like:
// {
//   "model": {
//     "storage_path": "models/yolov8_fish_2025/weights",
//     "status": "trained",
//     "updated_at": "2025-10-08T14:30:00Z"
//   }
// }
// ==========================================================
app.put('/api/model/:id', asyncHandler(async (req, res) => {
    console.log(`[API] PUT /api/model/${req.params.id}`, req.body);

    const data = await datasetController.updateModel(req.params.id, req.body.model);
    res.json(data);
}));

/**
 * @openapi
 * /model/{id}:
 *   get:
 *     summary: Fetch an ML model by id
 *     description: >
 *       Returns a single ML model record by ID, or null if not found. A
 *       database failure rejects the returned promise, so the route's
 *       .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the ML model to fetch.
 *     responses:
 *       200:
 *         description: The matching MlModel record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MlModel'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/model/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getModelById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `MlModel ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /model/{id}:
 *   delete:
 *     summary: Delete an ML model
 *     description: >
 *       Deletes an ML model record by ID. A database failure rejects the
 *       returned promise, so the route's .catch() responds with HTTP 500
 *       in that case. Deleting a model cascades to delete its
 *       training_runs (see model/ml_models.model.js).
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the ML model to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/model/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteModel(req.params.id);
    res.json(data);
}));


/**
 * @openapi
 * /dataset_observation:
 *   post:
 *     summary: Create a new dataset-observation link
 *     description: Creates a new dataset_observation join record linking a dataset to an observation.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dataset_observation
 *             properties:
 *               dataset_observation:
 *                 $ref: '#/components/schemas/DatasetObservation'
 *     responses:
 *       200:
 *         description: The created DatasetObservation record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DatasetObservation'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/dataset_observation
app.post('/api/dataset_observation', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await datasetController.createDatasetObservation(req.body.dataset_observation);
    res.json(data);
}));

/**
 * @openapi
 * /dataset_observation/{id}:
 *   get:
 *     summary: Fetch a dataset_observation by id
 *     description: >
 *       Returns a single dataset_observation record by ID, or null if not
 *       found. A database failure rejects the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the dataset_observation to fetch.
 *     responses:
 *       200:
 *         description: The matching DatasetObservation record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DatasetObservation'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/dataset_observation/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.getDatasetObservationById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `DatasetObservation ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /dataset_observation/{id}:
 *   put:
 *     summary: Update an existing dataset_observation
 *     description: >
 *       Updates an existing dataset_observation record by ID. A database
 *       failure rejects the returned promise, so the route's .catch()
 *       responds with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the dataset_observation to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dataset_observation
 *             properties:
 *               dataset_observation:
 *                 $ref: '#/components/schemas/DatasetObservation'
 *     responses:
 *       200:
 *         description: >
 *           The updated dataset_observation record, or null if no row
 *           matched the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/DatasetObservation'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/dataset_observation/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.updateDatasetObservation(req.params.id, req.body.dataset_observation);
    res.json(data);
}));

/**
 * @openapi
 * /dataset_observation/{id}:
 *   delete:
 *     summary: Delete a dataset_observation
 *     description: >
 *       Deletes a dataset_observation record by ID. A database failure
 *       rejects the returned promise, so the route's .catch() responds
 *       with HTTP 500 in that case.
 *     tags: [MachineLearning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the dataset_observation to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed (as returned by Sequelize).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/dataset_observation/:id', asyncHandler(async (req, res) => {
    const data = await datasetController.deleteDatasetObservation(req.params.id);
    res.json(data);
}));


/**
 * @openapi
 * /dataset_observations/bulk:
 *   post:
 *     summary: Bulk-create dataset-observation links
 *     description: >
 *       Bulk-inserts dataset_observation records. The response (per the
 *       route code) is { inserted: <count> }, NOT the created records.
 *       Uses ignoreDuplicates: true internally, which may not reliably
 *       suppress unique-constraint errors on Postgres depending on
 *       Sequelize version, so a 500 is still possible on duplicate
 *       observation_id values despite the flag.
 *     tags: [MachineLearning]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dataset_observations
 *             properties:
 *               dataset_observations:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/DatasetObservation'
 *     responses:
 *       200:
 *         description: >
 *           An { inserted: number } summary object rather than the created
 *           records.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inserted:
 *                   type: integer
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/dataset_observations/bulk
app.post('/api/dataset_observations/bulk', asyncHandler(async (req, res) => {
    console.log(`[INFO] Bulk insert ${req.body.dataset_observations?.length || 0} dataset_observations`);
    const data = await datasetController.bulkCreateDatasetObservations(req.body.dataset_observations);
    res.json({ inserted: data.length });
}));


/**
 * @openapi
 * /task:
 *   post:
 *     summary: Create a new task
 *     description: >
 *       Creates a new task record. Stamps createdate before insert.
 *       Database failures are logged and swallowed, resolving to an empty
 *       object `{}` rather than throwing or exposing error details.
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - task
 *             properties:
 *               task:
 *                 $ref: '#/components/schemas/Task'
 *     responses:
 *       200:
 *         description: >
 *           The created Task record, or an empty object `{}` if the insert
 *           failed (see description).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 */
app.post('/api/task', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await taskController.createTask(req.body.task);
    res.json(data);
}));

/**
 * @openapi
 * /observation:
 *   post:
 *     summary: Create a new observation
 *     description: >
 *       Creates a new observation record. Database failures are logged and
 *       swallowed, resolving to an empty object `{}` rather than throwing
 *       or exposing error details.
 *     tags: [Observations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - observation
 *             properties:
 *               observation:
 *                 $ref: '#/components/schemas/Observation'
 *     responses:
 *       200:
 *         description: >
 *           The created Observation record, or an empty object `{}` if the
 *           insert failed (see description).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Observation'
 */
app.post('/api/observation', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await observationController.createObservation(req.body.observation);
    res.json(data);
}));

/**
 * @openapi
 * /keyframe:
 *   post:
 *     summary: Bulk-create keyframe records
 *     description: >
 *       Creates one or more keyframe records in a single transaction.
 *       CRITICAL: unlike most other POST routes, the request body itself
 *       must be a JSON array of keyframe objects (not wrapped in a named
 *       field) — only the observation_id, x, y, width, height, subset,
 *       type, comname, and framenum fields are copied from each input
 *       object; any others are ignored. If the bulk insert fails, the
 *       transaction is rolled back and the failure is only logged, so the
 *       response resolves to an empty array `[]` rather than an error —
 *       callers cannot distinguish "nothing to insert" from "insert failed."
 *     tags: [Keyframes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/Keyframe'
 *     responses:
 *       200:
 *         description: >
 *           The created Keyframe records, or an empty array if the bulk
 *           insert failed (see description).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Keyframe'
 */
app.post('/api/keyframe', asyncHandler(async (req, res) => {
    const data = await keyframeController.createKeyframes(req.body);
    res.json(data);
}));

/**
 * @openapi
 * /user:
 *   post:
 *     summary: Create a new user
 *     description: Creates a new user record.
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user
 *             properties:
 *               user:
 *                 $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: The created User record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
app.post('/api/user', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await userController.createUser(req.body.user);
    res.json(data);
}));

/**
 * @openapi
 * /user/createUserByName/{userName}:
 *   post:
 *     summary: Create a new user by name only
 *     description: >
 *       Creates a new user record from a name alone, without a request
 *       body.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userName
 *         required: true
 *         schema:
 *           type: string
 *         description: Display name for the new user.
 *     responses:
 *       200:
 *         description: The created User record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
app.post('/api/user/createUserByName/:userName', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await userController.createUserByName(req.params.userName);
    res.json(data);
}));

/**
 * @openapi
 * /project:
 *   post:
 *     summary: Create a new project
 *     description: Creates a new project record.
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project
 *             properties:
 *               project:
 *                 $ref: '#/components/schemas/Project'
 *     responses:
 *       200:
 *         description: The created Project record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Project'
 */
app.post('/api/project', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await projectController.createProject(req.body.project);
    res.json(data);
}));

/**
 * @openapi
 * /project/createProjectByName/{projectName}:
 *   post:
 *     summary: Create a new project by name only
 *     description: >
 *       Creates a new project record from a name alone, without a request
 *       body.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name for the new project.
 *     responses:
 *       200:
 *         description: The created Project record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Project'
 */
app.post('/api/project/createProjectByName/:projectName', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await projectController.createProjectByName(req.params.projectName);
    res.json(data);
}));

/**
 * @openapi
 * /session:
 *   post:
 *     summary: Create a new session
 *     description: Creates a new session record.
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - session
 *             properties:
 *               session:
 *                 $ref: '#/components/schemas/Session'
 *     responses:
 *       200:
 *         description: The created Session record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 */
app.post('/api/session', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await sessionController.createSession(req.body.session);
    res.json(data);
}));

/**
 * @openapi
 * /session/createNewSession/{processorName}/{projectName}/{line}/{dive}/{lineID}/{type}:
 *   post:
 *     summary: Create a session, creating its project and processor user if needed
 *     description: >
 *       Convenience endpoint that looks up or creates the named processor
 *       (user) and project, then creates a new session linking them with
 *       the given line, dive, and type. All identifying values are passed
 *       as path segments rather than a request body.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: processorName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the user to look up or create as the session's processor.
 *       - in: path
 *         name: projectName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the project to look up or create.
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *         description: Line value for the new session.
 *       - in: path
 *         name: dive
 *         required: true
 *         schema:
 *           type: string
 *         description: Dive value for the new session.
 *       - in: path
 *         name: lineID
 *         required: true
 *         schema:
 *           type: string
 *         description: Line identifier for the new session.
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: Session type value.
 *     responses:
 *       200:
 *         description: The created Session record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 */
app.post('/api/session/createNewSession/:processorName/:projectName/:line/:dive/:lineID/:type', asyncHandler(async (req, res) => {
    console.log(req.body);
    const data = await sessionController.createSessionAndProjectandProcessor(
        req.params.processorName,
        req.params.projectName,
        req.params.line,
        req.params.dive,
        req.params.lineID,
        req.params.type
    );
    res.json(data);
}));

//PUT HERE

/**
 * @openapi
 * /task:
 *   put:
 *     summary: Update an existing task
 *     description: >
 *       Updates an existing task record by its id field. Stamps
 *       updateddate before update. Database failures are logged and
 *       swallowed, resolving to an empty object `{}` rather than throwing
 *       or exposing error details.
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - task
 *             properties:
 *               task:
 *                 $ref: '#/components/schemas/Task'
 *     responses:
 *       200:
 *         description: >
 *           The Sequelize update result, or an empty object `{}` if the
 *           update failed (see description).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/task', asyncHandler(async (req, res) => {
    const data = await taskController.updateTask(req.body.task);
    res.json(data);
}));

/**
 * @openapi
 * /observation:
 *   put:
 *     summary: Update an existing observation
 *     description: >
 *       Updates an existing observation by its observation_id field. If
 *       comname changes, the new value is propagated to every keyframe
 *       associated with the same observation, all within one transaction.
 *       Unlike most write methods in this codebase, this one does NOT
 *       swallow errors: if the observation_id doesn't exist or the update
 *       fails, the transaction is rolled back and the error is rethrown,
 *       resulting in an HTTP 500 by default (there is no explicit .catch()
 *       on this route, so Express's default error handling applies).
 *     tags: [Observations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - observation
 *             properties:
 *               observation:
 *                 $ref: '#/components/schemas/Observation'
 *     responses:
 *       200:
 *         description: The Sequelize update result (an array whose first element is the number of affected rows).
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/observation', asyncHandler(async (req, res) => {
    const data = await observationController.updateObservation(req.body.observation);
    res.json(data);
}));

/**
 * @openapi
 * /user:
 *   put:
 *     summary: Update an existing user
 *     description: Updates an existing user record by its user_id field.
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user
 *             properties:
 *               user:
 *                 $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: >
 *           Sequelize's update result (typically `[affectedCount]`), or
 *           `{}` if the update failed.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/user', asyncHandler(async (req, res) => {
    const data = await userController.updateUser(req.body.user);
    res.json(data);
}));

/**
 * @openapi
 * /project:
 *   put:
 *     summary: Update an existing project
 *     description: Updates an existing project record by its project_id field.
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project
 *             properties:
 *               project:
 *                 $ref: '#/components/schemas/Project'
 *     responses:
 *       200:
 *         description: The Sequelize update result.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/project', asyncHandler(async (req, res) => {
    const data = await projectController.updateProject(req.body.project);
    res.json(data);
}));

/**
 * @openapi
 * /session:
 *   put:
 *     summary: Update an existing session
 *     description: Updates an existing session record by its session_id field.
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - session
 *             properties:
 *               session:
 *                 $ref: '#/components/schemas/Session'
 *     responses:
 *       200:
 *         description: The Sequelize update result.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/session', asyncHandler(async (req, res) => {
    const data = await sessionController.updateSession(req.body.session);
    res.json(data);
}));

//DELETE HERE

/**
 * @openapi
 * /task/{id}:
 *   get:
 *     summary: Fetch a task by id
 *     description: >
 *       Returns a single task record, or null if not found. Database
 *       failures reject the returned promise, so the route's .catch()
 *       responds with HTTP 500 in that case.
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the task to fetch.
 *     responses:
 *       200:
 *         description: The matching task record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/task/:id', asyncHandler(async (req, res) => {
    const data = await taskController.getTaskById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Task ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /task/{id}:
 *   delete:
 *     summary: Delete a task
 *     description: >
 *       Deletes a task record by id. Database failures are logged and
 *       swallowed, resolving to an empty object `{}` rather than throwing.
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the task to delete.
 *     responses:
 *       200:
 *         description: >
 *           The number of rows destroyed (as returned by Sequelize), or an
 *           empty object `{}` if the delete failed.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/task/:id', asyncHandler(async (req, res) => {
    const data = await taskController.deleteTask(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /observation/{id}:
 *   get:
 *     summary: Fetch an observation by id
 *     description: >
 *       Returns a single observation record by observation_id, or null if
 *       not found. Database failures reject the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [Observations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: observation_id of the observation to fetch.
 *     responses:
 *       200:
 *         description: The matching observation record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Observation'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/observation/:id', asyncHandler(async (req, res) => {
    const data = await observationController.getObservationById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Observation ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /observation/{id}:
 *   delete:
 *     summary: Delete an observation
 *     description: >
 *       Deletes an observation record by its observation_id. Database
 *       failures are logged and swallowed, resolving to an empty object
 *       `{}` rather than throwing.
 *     tags: [Observations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: observation_id of the observation to delete.
 *     responses:
 *       200:
 *         description: >
 *           The number of rows destroyed (as returned by Sequelize), or an
 *           empty object `{}` if the delete failed.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/observation/:id', asyncHandler(async (req, res) => {
    const data = await observationController.deleteObservation(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /keyframe/{keyframe_id}:
 *   get:
 *     summary: Fetch a keyframe by id
 *     description: >
 *       Returns a single keyframe record by keyframe_id, or null if not
 *       found. Database failures reject the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [Keyframes]
 *     parameters:
 *       - in: path
 *         name: keyframe_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: keyframe_id of the keyframe to fetch.
 *     responses:
 *       200:
 *         description: The matching keyframe record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Keyframe'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/keyframe/:keyframe_id', asyncHandler(async (req, res) => {
    const data = await keyframeController.getKeyframeById(req.params.keyframe_id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Keyframe ${req.params.keyframe_id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /keyframe/{keyframe_id}:
 *   put:
 *     summary: Update an existing keyframe
 *     description: >
 *       Updates an existing keyframe record by keyframe_id. A database
 *       failure rejects the returned promise, so the route's .catch()
 *       responds with HTTP 500 in that case.
 *     tags: [Keyframes]
 *     parameters:
 *       - in: path
 *         name: keyframe_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: keyframe_id of the keyframe to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - keyframe
 *             properties:
 *               keyframe:
 *                 $ref: '#/components/schemas/Keyframe'
 *     responses:
 *       200:
 *         description: >
 *           The updated keyframe record, or null if no keyframe matched
 *           the given id.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Keyframe'
 *                 - type: 'null'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.put('/api/keyframe/:keyframe_id', asyncHandler(async (req, res) => {
    const data = await keyframeController.updateKeyframe(req.params.keyframe_id, req.body.keyframe);
    res.json(data);
}));

/**
 * @openapi
 * /keyframe/{keyframe_id}:
 *   delete:
 *     summary: Delete a keyframe
 *     description: >
 *       Deletes a keyframe record by id. Database failures are logged and
 *       swallowed, resolving to an empty object `{}` rather than throwing.
 *     tags: [Keyframes]
 *     parameters:
 *       - in: path
 *         name: keyframe_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: keyframe_id of the keyframe to delete.
 *     responses:
 *       200:
 *         description: >
 *           The number of rows destroyed (as returned by Sequelize), or an
 *           empty object `{}` if the delete failed.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/keyframe/:keyframe_id', asyncHandler(async (req, res) => {
    const data = await keyframeController.deleteKeyframe(req.params.keyframe_id);
    res.json(data);
}));

/**
 * @openapi
 * /user/{id}:
 *   delete:
 *     summary: Delete a user
 *     description: >
 *       Deletes a user record by user_id. Database failures are logged and
 *       swallowed, resolving to an empty object `{}` rather than throwing.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the user to delete.
 *     responses:
 *       200:
 *         description: >
 *           The number of rows destroyed (as returned by Sequelize), or an
 *           empty object `{}` if the delete failed.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.delete('/api/user/:id', asyncHandler(async (req, res) => {
    const data = await userController.deleteUser(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /project/{id}:
 *   get:
 *     summary: Fetch a project by id
 *     description: >
 *       Returns a single project record by project_id, or null if not
 *       found. Database failures reject the returned promise, so the
 *       route's .catch() responds with HTTP 500 in that case.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: project_id of the project to fetch.
 *     responses:
 *       200:
 *         description: The matching project record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Project'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
app.get('/api/project/:id', asyncHandler(async (req, res) => {
    const data = await projectController.getProjectById(req.params.id);

    if (!data) {
        throw new ApiError(
            404,
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Project ${req.params.id} was not found.`
        );
    }

    res.json(data);
}));

/**
 * @openapi
 * /project/{id}:
 *   delete:
 *     summary: Delete a project
 *     description: Deletes a project record by id.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the project to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed, as returned by Sequelize.
 */
app.delete('/api/project/:id', asyncHandler(async (req, res) => {
    const data = await projectController.deleteProject(req.params.id);
    res.json(data);
}));

/**
 * @openapi
 * /session/{id}:
 *   delete:
 *     summary: Delete a session
 *     description: Deletes a session record by id.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the session to delete.
 *     responses:
 *       200:
 *         description: The number of rows destroyed, as returned by Sequelize.
 */
app.delete('/api/session/:id', asyncHandler(async (req, res) => {
    const data = await sessionController.deleteSession(req.params.id);
    res.json(data);
}));

// Serve frontend shared assets and partials for all static apps.

/**
 * Root filesystem directory containing every static MARP frontend asset
 * (shared assets/partials and individual per-app bundles).
 *
 * @constant
 * @type {string}
 */
const frontendDirectory = path.join(__dirname, 'frontend');

/**
 * Directory containing one subfolder per static frontend application,
 * each with its own `index.html`.
 *
 * @constant
 * @type {string}
 */
const frontendAppsDirectory = path.join(frontendDirectory, 'apps');

/**
 * Directory containing static assets and partials shared across every
 * frontend application (styles, shared scripts, images).
 *
 * @constant
 * @type {string}
 */
const frontendSharedDirectory = path.join(frontendDirectory, 'shared');

// Compatibility alias for landing pages that still reference /assets/*.
app.use('/assets', express.static(path.join(frontendSharedDirectory, 'assets'), { index: false }));

app.use('/shared', express.static(frontendSharedDirectory, { index: false }));
app.use('/apps', express.static(frontendAppsDirectory, { index: false }));

/**
 * Serve the MARP entry application landing page at the site root.
 *
 * @name GET /
 * @function
 * @returns {void}
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendAppsDirectory, 'entry', 'index.html'));
});

/**
 * Serve the index.html of any frontend app folder by name.
 *
 * Allows new frontend apps to be added under frontend/apps/<appName>/
 * without requiring a new server route for each one. Falls through to the
 * next middleware (ultimately the 404 handler) if no matching app folder
 * exists.
 *
 * @name GET /apps/:appName
 * @function
 * @param {Object} req - Express request; `req.params.appName` names the app folder to serve.
 * @param {Object} res - Express response.
 * @param {Function} next - Called when no matching app folder exists, so the request falls through to later middleware.
 * @returns {void}
 */
app.get('/apps/:appName', (req, res, next) => {
    const appIndexPath = path.join(
        frontendAppsDirectory,
        req.params.appName,
        'index.html'
    );

    if (fs.existsSync(appIndexPath)) {
        return res.sendFile(appIndexPath);
    }

    return next();
});

/**
 * Temporary compatibility redirects from prior flat HTML page URLs to
 * their current locations under /apps/dashboard/. Kept only so old
 * bookmarks/links continue to resolve; new links should target the
 * /apps/dashboard/ paths directly.
 */
app.get('/dashboard1.html', (req, res) => {
    res.redirect('/apps/dashboard/');
});

app.get('/userActivity.html', (req, res) => {
    res.redirect('/apps/dashboard/user-activity.html');
});

app.get('/userHours.html', (req, res) => {
    res.redirect('/apps/dashboard/user-hours.html');
});

/**
 * Catch-all for unmatched /api routes. Registered after every real API
 * route above, so it only runs when nothing else matched. Returns a JSON
 * 404 instead of falling through to the plain-text/HTML 404 handler below,
 * so API clients always receive a JSON error body.
 */
app.use('/api', (req, res) => {
    apiNotFoundHandler(req, res);
});

// Standardize uncaught API errors with one shared contract envelope.
app.use(errorHandler);

/**
 * Catch-all 404 handler for any request that matched no route above,
 * including non-API paths that didn't match a static frontend file or app
 * folder.
 */
app.use((req, res) => {
    res.status(404).send('Not found');
});


/**
 * Express application instance, fully configured with middleware, routes,
 * documentation endpoints, and 404 handlers. Exported without calling
 * app.listen() so it can be used directly by the HTTP entry point
 * (server.js) or imported in-process by tests (e.g. Supertest).
 */
module.exports = app;
