/**
 * Observation routes, registered code-first through the OpenAPI route
 * registry.
 *
 * This is the largest and most irregular domain in the API: alongside plain
 * observation CRUD, it carries several custom video/report query endpoints
 * and two GET routes that perform database writes (a REST-verb violation
 * carried forward from the original implementation, not fixed here). See
 * `repository/observation.repository.js` for the underlying query logic.
 *
 * @fileoverview Observation resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/observation.routes
 */

const observationController = require('../controller/observation.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { registerVersionedRoute } = require('./lib/register-versioned-route');

/**
 * Register every observation route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerObservationRoutes(app) {
    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/getObservationsByVideo',
        summary: 'Retrieve observations for a video',
        description:
            'Returns observations whose video_source exactly matches the supplied videoName. Results are ordered by mediaPosition in ascending order and include associated keyframes. Observations without keyframes are excluded. An empty array may indicate either that no records matched or that the database query failed.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'query', name: 'videoName', required: true, schema: { type: 'string' }, description: 'Exact video_source value to match.' },
        ],
        responses: {
            200: {
                description: 'Matching observations returned successfully.',
                content: {
                    'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Observation' } } },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getObservationsByVideo(req.query.videoName);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'reports:read',
        path: '/api/getVideoSummaries/:project_id',
        summary: 'Retrieve video summaries for a project',
        description:
            'Returns one summary row for each distinct combination of video_source and videoLocation associated with sessions in the specified project. Each row includes the number of distinct observation common names, the number of distinct sessions, and representative dive, line, and session type values selected using MIN aggregation. Results are ordered by the representative dive and line in ascending order. Videos without a matching session in the project are excluded. An empty array may mean that no matching observations were found or that the database query failed.',
        tags: ['V1 · Observations', 'V1 · Videos'],
        parameters: [
            { in: 'path', name: 'project_id', required: true, schema: { type: 'integer' }, description: 'Database identifier of the project whose videos should be summarized.' },
        ],
        responses: {
            200: {
                description:
                    'Video summaries returned successfully. distinct_species_count, session_count, dive, and line are numeric strings rather than numbers because they come back from raw Postgres aggregates (Sequelize raw:true); see VideoSummaryReport for the verified field-by-field shape, captured from real response samples.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoSummaryReport' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getVideoSummariesByProject(req.params.project_id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/getObservationsByVideoAndComnames',
        summary: 'Retrieve video observations filtered by common name',
        description:
            'Returns observations whose video_source exactly matches videoName and whose comname is included in comnameList. Results are ordered by mediaPosition in ascending order and include associated keyframes. Observations without at least one keyframe are excluded. The current repository returns an empty array both when no observations match and when the database query fails.',
        tags: ['V1 · Observations', 'V1 · Videos'],
        parameters: [
            { in: 'query', name: 'videoName', required: true, schema: { type: 'string' }, description: 'Exact value to match against the observation video_source field.' },
            {
                in: 'query',
                name: 'comnameList',
                required: true,
                style: 'form',
                explode: true,
                schema: { type: 'array', items: { type: 'string' } },
                description: 'Common names used to filter observations. Supply the parameter repeatedly, such as comnameList=Bat%20star&comnameList=Leather%20star.',
            },
        ],
        responses: {
            200: {
                description: 'Matching observations returned successfully.',
                content: {
                    'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ObservationWithKeyframes' } } },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getObservationsByVideoAndComnames(
                req.query.videoName,
                req.query.comnameList
            );
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/getObservationsByVideoAndProject/:videoName/:projectName',
        summary: 'Retrieve observations for a video within a project',
        description:
            'Returns observations whose video_source exactly matches videoName and whose associated session belongs to the project identified by projectName. Results are ordered by mediaPosition in ascending order. Each observation includes its full associated session object (the session join has no attribute restriction) in addition to keyframes. Associated keyframes are included when available, but observations without keyframes are also returned. An empty array may indicate that no observations matched, the project was not found, or the database query failed.',
        tags: ['V1 · Observations', 'V1 · Projects', 'V1 · Videos'],
        parameters: [
            { in: 'path', name: 'videoName', required: true, schema: { type: 'string' }, description: 'Exact value to match against the observation video_source field.' },
            { in: 'path', name: 'projectName', required: true, schema: { type: 'string' }, description: 'Exact project name used to locate the associated project record.' },
        ],
        responses: {
            200: {
                description: 'Matching observations returned successfully.',
                content: {
                    'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ObservationWithSessionAndKeyframes' } } },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getObservationsByVideoAndProject(
                req.params.videoName,
                req.params.projectName
            );
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/getObservationsWithKeyframesByComnames',
        summary: 'Retrieve observations with keyframes by common name',
        description:
            'Returns observations whose comname matches one of the supplied common names. The comnameList query parameter must contain a comma-separated list of URL-encoded common names. Results are ordered by mediaPosition in ascending order and include associated keyframes. Observations without at least one keyframe are excluded. An empty array may indicate that no observations matched or that the repository query failed.',
        tags: ['V1 · Observations'],
        parameters: [
            {
                in: 'query',
                name: 'comnameList',
                required: true,
                schema: { type: 'string' },
                example: 'Bat%20star,Leather%20star',
                description: 'Comma-separated list of common names. Each value is decoded after the string is split on commas.',
            },
        ],
        responses: {
            200: {
                description: 'Matching observations with keyframes returned successfully.',
                content: {
                    'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ObservationWithKeyframes' } } },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // Convert the comma-separated query value into an array of decoded
            // common-name strings. A missing parameter produces an empty array.
            const comnameList = req.query.comnameList
                ? req.query.comnameList.split(',').map(decodeURIComponent)
                : [];

            const data = await observationController.getObservationsWithKeyframesByComnames(comnameList);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        expressMethod: 'use',
        path: '/api/getDistinctComnamesWithKeyframes',
        summary: 'Fetch distinct common names that have keyframes',
        description:
            'Returns every distinct comname value found on observations that have at least one associated keyframe. This route is registered with `app.use` rather than `app.get`, so it technically responds to any HTTP method, not just GET.',
        tags: ['V1 · Observations'],
        responses: {
            200: {
                description: 'Distinct common names returned successfully.',
                content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getDistinctComnamesWithKeyframes();
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'reports:read',
        path: '/api/dashboardData',
        summary: 'Fetch per-user dashboard activity data',
        description:
            'Returns per-user, per-date observation activity counts for a dashboard view. Both start and end are required for any data to come back: the underlying query filters observations.createdAt with a Sequelize Op.between, and an undefined bound matches nothing, so omitting either parameter returns {} rather than unfiltered data. sessions and projects are always 0 in the current implementation; only the observations count is actually populated.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'query', name: 'start', required: false, schema: { type: 'string' }, description: 'Start of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.' },
            { in: 'query', name: 'end', required: false, schema: { type: 'string' }, description: 'End of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.' },
        ],
        responses: {
            200: {
                description: 'Dashboard data returned successfully.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/UserDashboardData' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getUserDashboardData(req.query.start, req.query.end);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'reports:read',
        path: '/api/getProjectTimeByDateAndUser',
        summary: 'Fetch estimated recording time by project, date, and user',
        description:
            'Returns an object keyed by project name, then by date, then by user name, containing the estimated minutes recorded within the given date range. Both start and end are required for any data to come back: the underlying query filters observations.createdAt with a Sequelize Op.between, and an undefined bound matches nothing, so omitting either parameter returns {} rather than unfiltered data. KNOWN BUG: the last observation of every session/day contributes zero minutes to the total, so returned time is systematically undercounted.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'query', name: 'start', required: false, schema: { type: 'string' }, description: 'Start of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.' },
            { in: 'query', name: 'end', required: false, schema: { type: 'string' }, description: 'End of the date range (inclusive) used to filter observations by createdAt. Required in practice for any data to be returned; see description.' },
        ],
        responses: {
            200: {
                description: 'Grouped time data returned successfully.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ProjectTimeByDateAndUser' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getProjectTimeByDateAndUser(req.query.start, req.query.end);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/observations',
        summary: 'Fetch all observations',
        description: 'Returns all observation records available through the V1 API.',
        tags: ['V1 · Observations'],
        responses: {
            200: {
                description: 'Observation list returned successfully.',
                content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Observation' } } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getObservations();
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/observation/getLastVideoInfo/:session_id',
        summary: 'Fetch latest video info for a session',
        description: 'Returns the most recent video metadata associated with a session.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'session_id', required: true, schema: { type: 'integer' }, description: 'Session identifier.' },
        ],
        responses: {
            200: { description: 'Last video information returned successfully.' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getLastVideoInfo(req.params.session_id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/observation/getMaxObservationFromVideo/:video_source',
        summary: 'Fetch the observation with the highest observation_id for a video',
        description:
            'Returns the observation record(s) matching the maximum observation_id for the given video_source. Note that despite the name, the repository implementation returns an array of matching observation records (from a findAll query) rather than a single integer id.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'video_source', required: true, schema: { type: 'string' }, description: 'Video source value to match.' },
        ],
        responses: {
            200: {
                description: 'Matching observation record(s) returned successfully.',
                content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Observation' } } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getMaxObservationFromVideo(req.params.video_source);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:write',
        path: '/api/observation/updateObservationWithCount/:session_id/:observation_id/:count',
        summary: "Update an observation's count field",
        description:
            'Updates the count field of a specific observation within a session. CRITICAL: despite using HTTP GET, this endpoint performs a database UPDATE — a REST verb violation. CRITICAL: the observation_id path parameter is actually matched against the obsID column, not the observation_id primary key column — supplying the real primary-key value will silently match zero rows, and the repository reports success regardless of how many rows were actually affected.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'session_id', required: true, schema: { type: 'integer' }, description: 'Session identifier used together with obsID to locate the target observation.' },
            { in: 'path', name: 'observation_id', required: true, schema: { type: 'integer' }, description: 'Matched against the obsID column, not the observation_id primary key, despite the parameter name.' },
            { in: 'path', name: 'count', required: true, schema: { type: 'integer' }, description: 'New count value to persist.' },
        ],
        responses: {
            200: {
                description: '1 if the update statement executed without throwing, 0 if it failed. Does not indicate whether any row was actually matched.',
                content: { 'application/json': { schema: { type: 'integer' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            // REST-verb violation and obsID/observation_id column mismatch are
            // both pre-existing, documented behavior -- not fixed here.
            const data = await observationController.updateObservationWithCount(req.params.session_id, req.params.observation_id, req.params.count);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:write',
        path: '/api/observation/updateObservationWithSize/:session_id/:observation_id/:size',
        summary: "Update an observation's size field",
        description:
            'Updates the coarsesize field of a specific observation within a session. CRITICAL: despite using HTTP GET, this endpoint performs a database UPDATE — a REST verb violation. CRITICAL: the observation_id path parameter is actually matched against the obsID column, not the observation_id primary key column — supplying the real primary-key value will silently match zero rows, and the repository reports success regardless of how many rows were actually affected.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'session_id', required: true, schema: { type: 'integer' }, description: 'Session identifier used together with obsID to locate the target observation.' },
            { in: 'path', name: 'observation_id', required: true, schema: { type: 'integer' }, description: 'Matched against the obsID column, not the observation_id primary key, despite the parameter name.' },
            { in: 'path', name: 'size', required: true, schema: { type: 'number', format: 'float' }, description: 'New coarse-size value to persist.' },
        ],
        responses: {
            200: {
                description: '1 if the update statement executed without throwing, 0 if it failed. Does not indicate whether any row was actually matched.',
                content: { 'application/json': { schema: { type: 'integer' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.updateObservationWithSize(req.params.session_id, req.params.observation_id, req.params.size);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/observations/bySessionID/:session_id',
        summary: 'Fetch observations for a session',
        description: 'Returns every observation belonging to a session, including associated keyframes when present.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'session_id', required: true, schema: { type: 'integer' }, description: 'Session identifier to match.' },
        ],
        responses: {
            200: {
                description: 'Matching observations returned successfully.',
                content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Observation' } } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getObservationsBySessionID(req.params.session_id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'observations:write',
        path: '/api/observation',
        summary: 'Create a new observation',
        description:
            'Creates a new observation record. Database failures are logged and swallowed, resolving to an empty object `{}` rather than throwing or exposing error details.',
        tags: ['V1 · Observations'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationCreateRequest' } } },
        },
        responses: {
            200: {
                description: 'The created Observation record, or an empty object `{}` if the insert failed (see description).',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Observation' } } },
            },
        },
        handler: asyncHandler(async (req, res) => {
            console.log(req.body);
            const data = await observationController.createObservation(req.body.observation);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'put',
        permission: 'observations:write',
        path: '/api/observation',
        summary: 'Update an existing observation',
        description:
            'Updates an existing observation by its observation_id field. If comname changes, the new value is propagated to every keyframe associated with the same observation, all within one transaction. Unlike most write methods in this codebase, this one does NOT swallow errors: if the observation_id doesn\'t exist or the update fails, the transaction is rolled back and the error is rethrown, resulting in an HTTP 500 by default (there is no explicit .catch() on this route, so Express\'s default error handling applies).',
        tags: ['V1 · Observations'],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationUpdateRequest' } } },
        },
        responses: {
            200: { description: 'The Sequelize update result (an array whose first element is the number of affected rows).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // No .catch() here deliberately -- a failure rejects and falls
            // through to Express's default error handling (500), unlike the
            // swallow-to-{} pattern most other write routes use.
            const data = await observationController.updateObservation(req.body.observation);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'observations:read',
        path: '/api/observation/:id',
        summary: 'Fetch an observation by id',
        description:
            "Returns a single observation record by observation_id, or null if not found. Database failures reject the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'observation_id of the observation to fetch.' },
        ],
        responses: {
            200: {
                description: 'The matching observation record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Observation' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.getObservationById(req.params.id);

            if (!data) {
                throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Observation ${req.params.id} was not found.`);
            }

            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'delete',
        permission: 'observations:write',
        path: '/api/observation/:id',
        summary: 'Delete an observation',
        description:
            'Deletes an observation record by its observation_id. Database failures are logged and swallowed, resolving to an empty object `{}` rather than throwing.',
        tags: ['V1 · Observations'],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'observation_id of the observation to delete.' },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize), or an empty object `{}` if the delete failed.' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await observationController.deleteObservation(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerObservationRoutes;
