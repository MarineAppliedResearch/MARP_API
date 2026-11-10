/**
 * Habitat model routes: changing a habitat model's never-together groups (#287, R9).
 *
 * Isaac, 2026-11-10: Mud, Sand and Gravel never overlap, and the rule is a setting a person
 * can change, kept per model. A group names substrates of which at most one may be present at
 * a moment; where a model's scores put two of a group above their cut-offs, the surer stays.
 * Only this part of a model's decision rules is editable here. The cut-offs come from its
 * training, and the generic model update is not the way to change them.
 *
 * Refs MarineAppliedResearch/MARP_API#287.
 *
 * @fileoverview Habitat model routes and their OpenAPI documentation.
 * @module routes/habitat-model.routes
 */

const db = require('../model');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');
const { requirePermission } = require('../middleware/require-permission.middleware');
const { HABITAT_MODEL_TYPE } = require('../config/gpu-orchestration');
const { withExclusive, HabitatRulesError } = require('../db/habitat-rules');

/** Tag these operations group under in the API documentation. */
const TAG = 'V2 · Habitat models';

/**
 * Registers the habitat model routes.
 *
 * @param {Object} app - Express app.
 */
function registerHabitatModelRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/v2/model/:id/never-together',
        summary: 'Set which substrates a habitat model never reports together',
        description:
            'Replaces a habitat model\'s never-together groups, e.g. `[["Mud", "Sand", "Gravel"]]`. A group is two or more substrates, each one the model has or one the settled groups know of (Gravel). Where a run finds two of a group above their cut-offs at one moment, the one the model is surer of stays. Later runs use the new groups; runs already made keep what they were made with. An empty list means none. Requires `models:write`.',
        tags: [TAG],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'The habitat model.' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['groups'],
                        properties: {
                            groups: {
                                type: 'array',
                                items: { type: 'array', items: { type: 'string' }, minItems: 2 },
                                example: [['Mud', 'Sand', 'Gravel']],
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'The model, with its rules as now stored.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MlModel' } } } },
            400: { $ref: '#/components/responses/BadRequestError' },
            401: { $ref: '#/components/responses/UnauthorizedError' },
            403: { $ref: '#/components/responses/ForbiddenError' },
            404: { $ref: '#/components/responses/NotFoundError' },
        },
        handler: [
            requirePermission('models:write'),
            asyncHandler(async (req, res) => {
                const model = await db.ml_models.findByPk(Number(req.params.id));
                if (!model) {
                    throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Model ${req.params.id} was not found.`);
                }
                if (model.model_type !== HABITAT_MODEL_TYPE || !model.decision_rules) {
                    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR,
                        `Model ${model.id} (${model.name}) is not a habitat model with decision rules.`);
                }

                let rules;
                try {
                    rules = withExclusive(model.decision_rules, (req.body || {}).groups);
                } catch (error) {
                    if (error instanceof HabitatRulesError) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, error.message);
                    throw error;
                }
                await model.update({ decision_rules: rules, updated_at: new Date() });
                res.json(model);
            }),
        ],
    });
}

module.exports = registerHabitatModelRoutes;
