/**
 * Authentication routes, registered code-first through the OpenAPI route
 * registry.
 *
 * These V2 endpoints establish MARP-owned local sign-in and session
 * lifecycle behavior. Service-token and password-reset routes are added in
 * follow-up phases.
 *
 * @fileoverview V2 authentication routes and OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/auth.routes
 */

const rateLimit = require('express-rate-limit');
const authController = require('../controller/auth.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * OpenAPI tag label shared by all auth routes.
 *
 * @constant
 * @type {string}
 */
const AUTH_TAG = 'V2 · Auth';

/**
 * Per-IP attempt limiter scoped only to the login endpoint, to slow down
 * credential-guessing. Not applied to logout/me, which don't take
 * credentials.
 *
 * @constant
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Return the project's standardized error envelope instead of
  // express-rate-limit's default plain response.
  handler: (req, res, next) => {
    next(new ApiError(429, ERROR_CODES.RATE_LIMITED, 'Too many login attempts. Please try again later.'));
  },
});

/**
 * Register all `/api/v2/auth/*` routes and their OpenAPI operations on
 * `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerAuthRoutes(app) {
  // Local sign-in endpoint creating a server-side session.
  registerOpenApiRoute(app, {
    method: 'post',
    path: '/api/v2/auth/login',
    summary: 'Sign in with local username and password',
    description:
      'Authenticates a local MARP user using username and password, then establishes a server-side session backed by PostgreSQL. On success, returns the authenticated user profile used in the session.',
    tags: [AUTH_TAG],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/AuthLoginRequest' },
        },
      },
    },
    responses: {
      200: {
        description: 'User authenticated and session established successfully.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AuthSessionUserResponse' },
          },
        },
      },
      400: { $ref: '#/components/responses/BadRequestError' },
      401: { $ref: '#/components/responses/UnauthorizedError' },
      429: { $ref: '#/components/responses/TooManyRequestsError' },
      500: { $ref: '#/components/responses/InternalServerError' },
    },
    // Rate limiter runs first so credential-guessing attempts are capped
    // before ever reaching the controller/service layers.
    handler: (req, res, next) => {
      loginRateLimiter(req, res, (limiterError) => {
        if (limiterError) {
          return next(limiterError);
        }

        return asyncHandler(async (innerReq, innerRes) => {
          // Require a JSON body for credential-based login.
          if (!innerReq.body || typeof innerReq.body !== 'object') {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'Request body is required.');
          }

          // Extract submitted credentials.
          const { username, password } = innerReq.body;

          // Delegate authentication to controller/service layers.
          const user = await authController.authenticateLocal(username, password);

          // Fail with a standardized unauthorized envelope.
          if (!user) {
            throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid username or password.');
          }

          // Persist authenticated principal into the session store.
          await new Promise((resolve, reject) => {
            innerReq.logIn(user, (error) => {
              if (error) {
                return reject(error);
              }

              return resolve();
            });
          });

          // Return the safe user payload now bound to this session.
          innerRes.json({ user });
        })(req, res, next);
      });
    },
  });

  // Session logout endpoint that clears Passport and session store state.
  registerOpenApiRoute(app, {
    method: 'post',
    path: '/api/v2/auth/logout',
    summary: 'Sign out the current authenticated session',
    description:
      'Clears the current server-side authentication session. Logout is idempotent and always returns 204 even when no authenticated session exists.',
    tags: [AUTH_TAG],
    responses: {
      204: {
        description: 'Session cleared successfully (or no session was active).',
      },
      500: { $ref: '#/components/responses/InternalServerError' },
    },
    handler: asyncHandler(async (req, res) => {
      // Remove authenticated principal from Passport session context.
      await new Promise((resolve, reject) => {
        req.logout((error) => {
          if (error) {
            return reject(error);
          }

          return resolve();
        });
      });

      // Destroy backing session record when a session exists.
      if (req.session) {
        await new Promise((resolve, reject) => {
          req.session.destroy((error) => {
            if (error) {
              return reject(error);
            }

            return resolve();
          });
        });
      }

      // Logout is idempotent and returns no body.
      res.status(204).send();
    }),
  });

  // Session introspection endpoint used by clients to confirm auth state.
  registerOpenApiRoute(app, {
    method: 'get',
    path: '/api/v2/auth/me',
    summary: 'Get the currently authenticated session user',
    description:
      'Returns the currently authenticated MARP user associated with the request session. Returns 401 when the request has no valid authenticated session.',
    tags: [AUTH_TAG],
    responses: {
      200: {
        description: 'Authenticated session user returned successfully.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AuthSessionUserResponse' },
          },
        },
      },
      401: { $ref: '#/components/responses/UnauthorizedError' },
      500: { $ref: '#/components/responses/InternalServerError' },
    },
    handler: asyncHandler(async (req, res) => {
      // Reject callers without an active authenticated session.
      if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
        throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'Authentication is required.');
      }

      // Return the current authenticated principal.
      res.json({ user: req.user });
    }),
  });
}

module.exports = registerAuthRoutes;
