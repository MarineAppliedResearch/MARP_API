/**
 * Shared API error contract middleware and helpers.
 *
 * Defines one standardized error envelope shape and reusable helpers for
 * request correlation ids, API not-found responses, and global error handling.
 *
 * @fileoverview API error contract middleware.
 * @author Isaac Travers
 * @module middleware/error-contract
 */

/**
 * Canonical machine-readable error codes used by the API contract.
 *
 * @constant
 * @type {Object<string, string>}
 */
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/**
 * Application error with explicit HTTP status and contract code.
 */
class ApiError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} code - Machine-readable contract error code.
   * @param {string} message - Client-safe error message.
   * @param {Array<Object>|undefined} details - Optional structured issue details.
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Create a lightweight request id when one was not provided by the caller.
 *
 * @returns {string}
 */
function generateRequestId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `req_${ts}_${rand}`;
}

/**
 * Attach request id context to every request and echo it in the response.
 *
 * Uses incoming x-request-id if present, otherwise generates one.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next callback.
 * @returns {void}
 */
function requestIdMiddleware(req, res, next) {
  const incomingId = req.get('x-request-id');
  const requestId = incomingId && incomingId.trim() ? incomingId.trim() : generateRequestId();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
}

/**
 * Send one standardized error envelope payload.
 *
 * @param {Object} res - Express response.
 * @param {Object} payload - Error payload fields.
 * @param {number} payload.status - HTTP status code.
 * @param {string} payload.code - Machine-readable contract code.
 * @param {string} payload.message - Client-safe message.
 * @param {string} payload.requestId - Correlation id for this request.
 * @param {Array<Object>|undefined} payload.details - Optional issue details.
 * @returns {void}
 */
function sendError(res, { status, code, message, requestId, details }) {
  const body = {
    error: {
      code,
      message,
      status,
      requestId,
    },
  };

  if (Array.isArray(details) && details.length > 0) {
    body.error.details = details;
  }

  res.status(status).json(body);
}

/**
 * Convert common runtime/Sequelize errors into the API error contract.
 *
 * @param {Error|Object} err - Thrown error.
 * @returns {Object} Normalized error with `status` (number), `code`
 * (string), `message` (string), and optional `details` (Array<Object>).
 */
function normalizeError(err) {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  if (err && err.name === 'SequelizeValidationError') {
    return {
      status: 422,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Request validation failed.',
      details: (err.errors || []).map((item) => ({
        field: item.path,
        issue: item.message,
      })),
    };
  }

  if (err && err.name === 'SequelizeUniqueConstraintError') {
    return {
      status: 409,
      code: ERROR_CODES.CONFLICT,
      message: 'A unique constraint was violated.',
      details: (err.errors || []).map((item) => ({
        field: item.path,
        issue: item.message,
      })),
    };
  }

  return {
    status: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'An unexpected server error occurred.',
    details: undefined,
  };
}

/**
 * Standard JSON 404 for unmatched API routes.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @returns {void}
 */
function apiNotFoundHandler(req, res) {
  sendError(res, {
    status: 404,
    code: ERROR_CODES.ROUTE_NOT_FOUND,
    message: 'API route not found.',
    requestId: req.requestId || generateRequestId(),
  });
}

/**
 * Global Express error middleware returning the standardized contract.
 *
 * @param {Error|Object} err - Error passed through Express.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next callback.
 * @returns {void}
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const normalized = normalizeError(err);

  console.error('[API Error]', {
    requestId: req.requestId,
    code: normalized.code,
    status: normalized.status,
    message: err && err.message ? err.message : String(err),
  });

  return sendError(res, {
    ...normalized,
    requestId: req.requestId || generateRequestId(),
  });
}

/**
 * Wrap an async route handler so rejected promises are forwarded to Express
 * error middleware.
 *
 * @param {Function} handler - Async Express route handler.
 * @returns {Function}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = {
  ERROR_CODES,
  ApiError,
  asyncHandler,
  apiNotFoundHandler,
  errorHandler,
  requestIdMiddleware,
  sendError,
};
