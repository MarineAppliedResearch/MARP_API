'use strict';

const controller = require('../controller/worker_provisioning.controller');
const { asyncHandler } = require('../middleware/error-contract.middleware');
const { requirePermission } = require('../middleware/require-permission.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

const TAG = 'V2 · Worker Provisioning';

function userId(req) {
    return req.principal && req.principal.type === 'user' ? req.principal.id : null;
}

module.exports = function registerWorkerProvisioningRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/gpu/worker-activation-codes',
        summary: 'Create a one-time worker activation code',
        description: 'Creates a short-lived code returned once. Requires `admin`.',
        tags: [TAG],
        requestBody: {
            required: false,
            content: { 'application/json': { schema: { type: 'object', properties: {
                label: { type: 'string', maxLength: 255 },
                ttl_minutes: { type: 'integer', minimum: 1, maximum: 10080, default: 60 },
            } } } },
        },
        responses: { 201: { description: 'Activation code created.' } },
        handler: [requirePermission('admin'), asyncHandler(async (req, res) => {
            res.status(201).json(await controller.createActivationCode(req.body || {}, userId(req)));
        })],
    });

    // Deliberately unauthenticated: the one-time activation code is the
    // credential. It is consumed transactionally and cannot be replayed.
    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/gpu/workers/activate',
        summary: 'Exchange a one-time code for a machine credential',
        description: 'Consumes an activation code and returns one worker-specific bearer credential once.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: {
                type: 'object',
                required: ['activation_code', 'local_id', 'name', 'platform', 'architecture', 'compute_runtime'],
                properties: {
                    activation_code: { type: 'string', maxLength: 128 },
                    local_id: { type: 'string', maxLength: 128 },
                    name: { type: 'string', maxLength: 255 },
                    platform: { type: 'string', maxLength: 32 },
                    architecture: { type: 'string', maxLength: 32 },
                    compute_runtime: { type: 'string', maxLength: 32 },
                    worker_version: { type: 'string', maxLength: 64 },
                },
            } } },
        },
        responses: { 201: { description: 'Worker activated.' }, 401: { $ref: '#/components/responses/UnauthorizedError' } },
        handler: asyncHandler(async (req, res) => {
            res.status(201).json(await controller.activate(req.body || {}));
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/gpu/worker-releases',
        summary: 'Approve worker release metadata',
        description: 'Registers an immutable package URL, size and SHA-256. Requires `admin`.',
        tags: [TAG],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: {
                type: 'object',
                required: ['version', 'platform', 'architecture', 'compute_runtime', 'download_url', 'size_bytes', 'sha256'],
                properties: {
                    version: { type: 'string', maxLength: 64 },
                    platform: { type: 'string', maxLength: 32 },
                    architecture: { type: 'string', maxLength: 32 },
                    compute_runtime: { type: 'string', maxLength: 32 },
                    download_url: { type: 'string', format: 'uri' },
                    size_bytes: { type: 'integer', minimum: 1 },
                    sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
                },
            } } },
        },
        responses: { 201: { description: 'Release approved.' } },
        handler: [requirePermission('admin'), asyncHandler(async (req, res) => {
            res.status(201).json(await controller.registerRelease(req.body || {}, userId(req)));
        })],
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/gpu/worker-releases',
        summary: 'List approved worker releases',
        description: 'Lists platform and runtime-specific packages an operator may target. Requires `admin`.',
        tags: [TAG],
        responses: { 200: { description: 'Approved releases, newest approval first.' } },
        handler: [requirePermission('admin'), asyncHandler(async (_req, res) => {
            res.json(await controller.listReleases());
        })],
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/v2/gpu/workers/:id/update',
        summary: 'Inspect one worker update state',
        description: 'Returns the installed release, durable state, last message, and selected target. Requires `admin`.',
        tags: [TAG],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Worker update state.' } },
        handler: [requirePermission('admin'), asyncHandler(async (req, res) => {
            res.json(await controller.getWorkerUpdate(req.params.id));
        })],
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/gpu/workers/:id/desired-release',
        summary: 'Request a worker update',
        description: 'Stores the operator-selected release target. Requires `admin`.',
        tags: [TAG],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: {
                type: 'object', required: ['release_id'],
                properties: { release_id: { type: 'integer' } },
            } } },
        },
        responses: { 200: { description: 'Update requested.' } },
        handler: [requirePermission('admin'), asyncHandler(async (req, res) => {
            res.json(await controller.setDesiredRelease(req.params.id, req.body || {}));
        })],
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/v2/gpu/workers/:id/check-in',
        summary: 'Report installed release and discover updates',
        description: 'Records platform, compute runtime, version and update state and returns approved release metadata. Requires `jobs:execute` and the credential bound to this worker.',
        tags: [TAG],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: {
                type: 'object',
                required: ['installed_version', 'platform', 'architecture', 'compute_runtime'],
                properties: {
                    installed_version: { type: 'string', maxLength: 64 },
                    platform: { type: 'string', maxLength: 32 },
                    architecture: { type: 'string', maxLength: 32 },
                    compute_runtime: { type: 'string', maxLength: 32 },
                    update_state: { type: 'string', enum: ['current', 'update_available', 'update_requested', 'updating', 'succeeded', 'failed', 'rolled_back'] },
                    update_message: { type: 'string', maxLength: 2000 },
                },
            } } },
        },
        responses: { 200: { description: 'Worker state and update instructions.' } },
        handler: [requirePermission('jobs:execute'), asyncHandler(async (req, res) => {
            res.json(await controller.checkIn(req.params.id, req.principal.tokenId, req.body || {}));
        })],
    });
};
