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


// registerObservationRoutes is required first, deliberately, before anything
// that transitively requires session.controller.js (registerKeyframeRoutes,
// registerSessionRoutes). repository/session.repository.js and
// repository/observation.repository.js require each other's controller
// circularly; whichever of session.controller/observation.controller starts
// loading first leaves the OTHER side with an incomplete module.exports
// when the cycle closes. observation.repository.js is the side that
// actually calls methods on the circular reference (sessionController.*),
// so observation.controller's chain must be triggered first so that by the
// time it circles back to require session.controller, session.controller
// is not already mid-load. This matches the original (pre-code-first-routes)
// app.js, where observationController was required before sessionController.
const registerObservationRoutes = require('./routes/observation.routes');
const registerTaskRoutes = require('./routes/task.routes');
const registerMetaInfoRoutes = require('./routes/metaInfo.routes');
const registerKeyframeRoutes = require('./routes/keyframe.routes');
const registerSchemaRoutes = require('./routes/schema.routes');
const registerUserRoutes = require('./routes/user.routes');
const registerProjectRoutes = require('./routes/project.routes');
const registerSessionRoutes = require('./routes/session.routes');
const registerSpeciesRoutes = require('./routes/species.routes');
const registerDatasetRoutes = require('./routes/dataset.routes');
const registerAuthRoutes = require('./routes/auth.routes');
const registerUsersRoutes = require('./routes/v2_users.routes');

// Jellyfin (V2) has no Sequelize model or DB repository, so it has no
// dependency on session.controller.js/observation.controller.js -- none of
// the circular-require ordering constraints above apply to it, and its
// require position here is unconstrained.
const registerJellyfinRoutes = require('./routes/jellyfin.routes');
const { configureAuthentication } = require('./auth/auth.setup');


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
const { requireAuthenticatedSession, requirePermissionSession } = require('./middleware/require-authenticated-session.middleware');


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
    './repository/schema.repository',
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

// Parse incoming JSON request bodies. Must run before any route (including
// code-first registries like registerTaskRoutes) that reads req.body.
app.use(bodyParser.json());

// Attach or generate an API request correlation id.
app.use(requestIdMiddleware);

// Configure session-backed authentication before API route registration so
// downstream handlers can rely on req.user/req.isAuthenticated.
configureAuthentication(app);


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
registerTaskRoutes(app);
registerMetaInfoRoutes(app);
registerKeyframeRoutes(app);
registerSchemaRoutes(app);
registerUserRoutes(app);
registerProjectRoutes(app);
registerSessionRoutes(app);
registerSpeciesRoutes(app);
registerDatasetRoutes(app);
registerObservationRoutes(app);
registerJellyfinRoutes(app);
registerAuthRoutes(app);
registerUsersRoutes(app);

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

// The admin page needs the stricter admin-only check, registered before
// the broader dashboard guard below so it runs first for this one file.
app.use('/apps/dashboard/admin.html', requirePermissionSession('admin'));

// Gate every page under the dashboard app behind a real session, before the
// static mount below (or the /apps/:appName route further down) can serve
// any of its files to an unauthenticated request.
app.use('/apps/dashboard', requireAuthenticatedSession);

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
