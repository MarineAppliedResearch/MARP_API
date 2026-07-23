/**
 * Main Express server and API endpoint definition file for the MARP API.
 *
 * This module initializes the Express application, loads environment
 * configuration, registers shared middleware, connects API routes to their
 * controllers, generates the OpenAPI specification, and serves API and
 * internal developer documentation.
 *
 * The server provides the HTTP interface used by MARP applications,
 * processing workers, reporting tools, and other authorized clients.
 *
 * Route handlers defined in this file should delegate application behavior to
 * controllers rather than implementing database access or business logic
 * directly.
 *
 * @fileoverview Express server initialization, middleware configuration,
 * API route registration, and documentation setup for the MARP API.
 * @author Isaac Travers
 * @module server
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


/**
 * TCP port used by the HTTP server.
 *
 * The PORT environment variable takes precedence. Port 3000 is used when
 * no explicit port is configured.
 *
 * @constant
 * @type {number|string}
 */
const port = process.env.PORT || 3000;


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
app.get('/api/getObservationsByVideo', (req, res) => {
    observationController
        .getObservationsByVideo(req.query.videoName)
        .then(data => res.json(data));
});


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
 *         description: Video summaries returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   video_source:
 *                     type: string
 *                     nullable: true
 *                     description: Video source value shared by the grouped observations.
 *                   videoLocation:
 *                     type: string
 *                     nullable: true
 *                     description: Video location value shared by the grouped observations.
 *                   distinct_species_count:
 *                     type: integer
 *                     description: Number of distinct non-null observation comname values.
 *                   session_count:
 *                     type: integer
 *                     description: Number of distinct sessions represented in the group.
 *                   dive:
 *                     nullable: true
 *                     description: Minimum dive value among the matching sessions.
 *                   line:
 *                     nullable: true
 *                     description: Minimum line value among the matching sessions.
 *                   session_type:
 *                     type: string
 *                     nullable: true
 *                     description: Minimum session type value among the matching sessions.
 */
app.get('/api/getVideoSummaries/:project_id', (req, res) => {
    observationController
        .getVideoSummariesByProject(req.params.project_id)
        .then(data => res.json(data));
});



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
 *                 type: object
 *                 additionalProperties: true
 */
app.get('/api/getObservationsByVideoAndComnames', (req, res) => {
    observationController
        .getObservationsByVideoAndComnames(
            req.query.videoName,
            req.query.comnameList
        )
        .then(data => res.json(data));
});


/**
 * @openapi
 * /getObservationsByVideoAndProject/{videoName}/{projectName}:
 *   get:
 *     summary: Retrieve observations for a video within a project
 *     description: >
 *       Returns observations whose video_source exactly matches videoName and
 *       whose associated session belongs to the project identified by
 *       projectName. Results are ordered by mediaPosition in ascending order.
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
 *                 type: object
 *                 additionalProperties: true
 */
app.get(
    '/api/getObservationsByVideoAndProject/:videoName/:projectName',
    (req, res) => {
        observationController
            .getObservationsByVideoAndProject(
                req.params.videoName,
                req.params.projectName
            )
            .then(data => res.json(data));
    }
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
 *         description: The API request failed before a response could be produced.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.get('/api/getObservationsWithKeyframesByComnames', (req, res) => {
    // Convert the comma-separated query value into an array of decoded
    // common-name strings. A missing parameter produces an empty array.
    const comnameList = req.query.comnameList
        ? req.query.comnameList.split(',').map(decodeURIComponent)
        : [];

    // Delegate the filtered observation query to the observation controller.
    observationController
        .getObservationsWithKeyframesByComnames(comnameList)
        .then(data => res.json(data))
        .catch(err => {
            // Log controller or request-processing failures that propagate
            // through the returned promise.
            console.error('Error in API call:', err);

            // Return a generic error response without exposing internal details.
            res.status(500).json({
                error: 'An error occurred while fetching observations.'
            });
        });
});


/**
 * Retrieves all distinct comnames from observations that have associated keyframes.
 * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
 */
app.use('/api/getDistinctComnamesWithKeyframes', (req, res) => {
    observationController.getDistinctComnamesWithKeyframes().then(data => res.json(data));
});


app.get('/api/dashboardData', (req, res) => {
    observationController.getUserDashboardData(req.query.start, req.query.end).then(data => res.json(data));
});

app.get('/api/getProjectTimeByDateAndUser', (req, res) => {
    observationController.getProjectTimeByDateAndUser(req.query.start, req.query.end).then(data => res.json(data));
});

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
 *                 type: object
 *                 additionalProperties: true
 */
app.get('/api/tasks', (req, res) => {
    taskController.getTasks().then(data => res.json(data));
});

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
 */
app.get('/api/observations', (req, res) => {
    observationController.getObservations().then(data => res.json(data));
});

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
app.get('/api/observation/getLastVideoInfo/:session_id', (req, res) => {
    observationController.getLastVideoInfo(req.params.session_id).then(data => res.json(data));
});


app.get('/api/observation/getMaxObservationFromVideo/:video_source', (req, res) => {
    observationController.getMaxObservationFromVideo(req.params.video_source).then(data => res.json(data));
});

app.get('/api/observation/updateObservationWithCount/:session_id/:observation_id/:count', (req, res) => {
    observationController.updateObservationWithCount(req.params.session_id, req.params.observation_id, req.params.count).then(data => res.json(data));
});

app.get('/api/observation/updateObservationWithSize/:session_id/:observation_id/:size', (req, res) => {
    observationController.updateObservationWithSize(req.params.session_id, req.params.observation_id, req.params.size).then(data => res.json(data));
});

app.get('/api/observations/bySessionID/:session_id', (req, res) => {
    observationController.getObservationsBySessionID(req.params.session_id).then(data => res.json(data));
});




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
app.get('/api/species', (req, res) => {
    speciesController.getSpecies().then(data => res.json(data));
});

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
app.get('/api/species/by-comname/:comname', (req, res) => {
  speciesController.getSpeciesByComname(req, res).then(data => res.json(data));
});

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
 *         description: >
 *           Model-species record created successfully, or an ErrorResponse
 *           body if the insert failed (see description).
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/ModelSpecies'
 *                 - $ref: '#/components/schemas/ErrorResponse'
 */
app.post('/api/model_species', (req, res) => {
  speciesController.createModelSpecies(req, res)
    .then(data => res.json(data));
});


app.get('/api/users', (req, res) => {
    userController.getUsers().then(data => res.json(data));
});

app.get('/api/user/:name', (req, res) => {
    userController.getUserByName(req.params.name).then(data => res.json(data));
});

app.get('/api/projects', (req, res) => {
    projectController.getProjects().then(data => res.json(data));
});

app.get('/api/projects/user/:userID', (req, res) => {
    projectController.getProjectsByUserID(req.params.userID).then(data => res.json(data));
});

app.get('/api/project/getProjectByName/:projectName', (req, res) => {
    projectController.getProjectByName(req.params.projectName).then(data => res.json(data));
});

app.get('/api/sessions', (req, res) => {
    sessionController.getSessions().then(data => res.json(data));
});

app.get('/api/sessions/user/:userID/project/:projectID', (req, res) => {
    sessionController.getSessionsByUserIdAndProjectId(req.params.userID, req.params.projectID).then(data => res.json(data));
});

/**
 * @openapi
 * /metaInfo/dbName:
 *   get:
 *     summary: Retrieve active database name
 *     description: Returns metadata identifying the current configured database.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database name returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
app.get('/api/metaInfo/dbName', (req, res) => {
    metaInfoController.getDBName().then(data => res.json(data));
});

app.get('/api/user/getUserNameByID/:userID', (req, res) => {
    userController.getUserNameByID(req.params.userID).then(data => res.json(data));
});

// GET /api/models
app.get('/api/ml_models', (req, res) => {
    datasetController.getMl_models()
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error fetching models:", err);
            res.status(500).json({ error: "Failed to get models" });
        });
});





app.get('/api/dataset', (req, res) => {
    datasetController.getDatasets().then(data => res.json(data));
});


app.get('/api/dataset/:id', (req, res) => {
    datasetController.getDatasetById(req.params.id)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error fetching dataset:", err);
            res.status(500).json({ error: "Failed to get dataset" });
        });
});

// POST HERE
app.post('/api/dataset', (req, res) => {
    console.log(req.body);
    datasetController.createDataset(req.body.dataset)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating dataset:", err);
            res.status(500).json({ error: "Failed to create dataset" });
        });
});


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
app.post('/api/model', (req, res) => {
    console.log("[API] POST /api/model", req.body);

    datasetController.createModel(req.body.model)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating model:", err);
            res.status(500).json({ error: "Failed to create model" });
        });
});


// POST /api/training_run
app.post('/api/training_run', (req, res) => {
    console.log(req.body);
    datasetController.createTrainingRun(req.body.training_run)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating training run:", err);
            res.status(500).json({ error: "Failed to create training run" });
        });
});


// PUT /api/training_run/:id
app.put('/api/training_run/:id', (req, res) => {
    const id = req.params.id;
    datasetController.updateTrainingRun(id, req.body.training_run)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error updating training run:", err);
            res.status(500).json({ error: "Failed to update training run" });
        });
});


// POST /api/metrics_summary
app.post('/api/metrics_summary', (req, res) => {
    datasetController.createMetricsSummary(req.body.metrics_summary)
        .then(data => res.json(data))
        .catch(err => res.status(500).json({ error: "Failed to create metrics_summary" }));
});

// POST /api/metrics_curve
app.post('/api/metrics_curve', (req, res) => {
    datasetController.createMetricsCurve(req.body.metrics_curve)
        .then(data => res.json(data))
        .catch(err => res.status(500).json({ error: "Failed to create metrics_curve" }));
});


// server.js or routes.js
app.post('/api/metrics_curves/bulk', (req, res) => {
  datasetController.bulkCreateMetricsCurves(req, res)
    .then(data => res.json(data));
});

// POST /api/epoch
app.post('/api/epoch', (req, res) => {
    console.log(req.body);
    datasetController.createEpoch(req.body.epoch)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating epoch:", err);
            res.status(500).json({ error: "Failed to create epoch" });
        });
});


// PUT /api/epoch/:id
app.put('/api/epoch/:id', (req, res) => {
    const id = req.params.id;
    datasetController.updateEpoch(id, req.body.epoch)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error updating epoch:", err);
            res.status(500).json({ error: "Failed to update epoch" });
        });
});



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
app.put('/api/model/:id', (req, res) => {
    console.log(`[API] PUT /api/model/${req.params.id}`, req.body);

    datasetController.updateModel(req.params.id, req.body.model)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error updating model:", err);
            res.status(500).json({ error: "Failed to update model" });
        });
});


// POST /api/dataset_observation
app.post('/api/dataset_observation', (req, res) => {
    console.log(req.body);
    datasetController.createDatasetObservation(req.body.dataset_observation)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating dataset_observation:", err);
            res.status(500).json({ error: "Failed to create dataset_observation" });
        });
});


// POST /api/dataset_observations/bulk
app.post('/api/dataset_observations/bulk', (req, res) => {
    console.log(`[INFO] Bulk insert ${req.body.dataset_observations?.length || 0} dataset_observations`);
    datasetController.bulkCreateDatasetObservations(req.body.dataset_observations)
        .then(data => res.json({ inserted: data.length }))
        .catch(err => {
            console.error("Error in bulk dataset_observation insert:", err);
            res.status(500).json({ error: "Failed bulk insert" });
        });
});


app.post('/api/task', (req, res) => {
    console.log(req.body);
    taskController.createTask(req.body.task).then(data => res.json(data));
});

app.post('/api/observation', (req, res) => {
    console.log(req.body);
    observationController.createObservation(req.body.observation).then(data => res.json(data));
});

app.post('/api/keyframe', (req, res) => {
    keyframeController.createKeyframes(req.body).then(data => res.json(data));
});

app.post('/api/user', (req, res) => {
    console.log(req.body);
    userController.createUser(req.body.user).then(data => res.json(data));
});

app.post('/api/user/createUserByName/:userName', (req, res) => {
    console.log(req.body);
    userController.createUserByName(req.params.userName).then(data => res.json(data));
});

app.post('/api/project', (req, res) => {
    console.log(req.body);
    projectController.createProject(req.body.project).then(data => res.json(data));
});

app.post('/api/project/createProjectByName/:projectName', (req, res) => {
    console.log(req.body);
    projectController.createProjectByName(req.params.projectName).then(data => res.json(data));
});

app.post('/api/session', (req, res) => {
    console.log(req.body);
    sessionController.createSession(req.body.session).then(data => res.json(data));
});

app.post('/api/session/createNewSession/:processorName/:projectName/:line/:dive/:lineID/:type', (req, res) => {
    console.log(req.body);
    sessionController.createSessionAndProjectandProcessor(req.params.processorName, req.params.projectName, req.params.line, req.params.dive, req.params.lineID, req.params.type).then(data => res.json(data));
});

//PUT HERE

app.put('/api/task', (req, res) => {
    taskController.updateTask(req.body.task).then(data => res.json(data));
});
app.put('/api/observation', (req, res) => {
    observationController.updateObservation(req.body.observation).then(data => res.json(data));
});
app.put('/api/user', (req, res) => {
    userController.updateUser(req.body.user).then(data => res.json(data));
});

app.put('/api/project', (req, res) => {
    projectController.updateProject(req.body.project).then(data => res.json(data));
});

app.put('/api/session', (req, res) => {
    sessionController.updateSession(req.body.session).then(data => res.json(data));
});

//DELETE HERE

app.delete('/api/task/:id', (req, res) => {
    taskController.deleteTask(req.params.id).then(data => res.json(data));
});

app.delete('/api/observation/:id', (req, res) => {
    observationController.deleteObservation(req.params.id).then(data => res.json(data));
});

app.delete('/api/keyframe/:keyframe_id', (req, res) => {
    keyframeController.deleteKeyframe(req.params.keyframe_id).then(data => res.json(data));
});

app.delete('/api/user/:id', (req, res) => {
    userController.deleteUser(req.params.id).then(data => res.json(data));
});

app.delete('/api/project/:id', (req, res) => {
    projectController.deleteProject(req.params.id).then(data => res.json(data));
});

app.delete('/api/session/:id', (req, res) => {
    sessionController.deleteSession(req.params.id).then(data => res.json(data));
});

// Serve frontend shared assets and partials for all static apps.
const frontendDirectory = path.join(__dirname, 'frontend');
const frontendAppsDirectory = path.join(frontendDirectory, 'apps');
const frontendSharedDirectory = path.join(frontendDirectory, 'shared');

// Compatibility alias for landing pages that still reference /assets/*.
app.use('/assets', express.static(path.join(frontendSharedDirectory, 'assets'), { index: false }));

app.use('/shared', express.static(frontendSharedDirectory, { index: false }));
app.use('/apps', express.static(frontendAppsDirectory, { index: false }));

// Root route serves the MARP entry application landing page.
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendAppsDirectory, 'entry', 'index.html'));
});

// Generic app index route allows adding app folders without new server routes.
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

// Temporary compatibility routes from prior flat html page URLs.
app.get('/dashboard1.html', (req, res) => {
    res.redirect('/apps/dashboard/');
});

app.get('/userActivity.html', (req, res) => {
    res.redirect('/apps/dashboard/user-activity.html');
});

app.get('/userHours.html', (req, res) => {
    res.redirect('/apps/dashboard/user-hours.html');
});

// Return JSON for unknown API routes instead of falling through to a missing HTML file.
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
});

// Return plain 404 for unknown non-API routes.
app.use((req, res) => {
    res.status(404).send('Not found');
});

app.listen(port, () => {
    console.log(`Server listening on the port  ${port}`);
})
