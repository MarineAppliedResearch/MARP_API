# API Error Contract

This document defines the canonical MARP API error contract used by all non-2xx responses.

## Envelope

All API errors must return JSON in this shape:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Requested session was not found.",
    "status": 404,
    "requestId": "req_mdxv3u_4f7k2q",
    "details": [
      {
        "field": "session_id",
        "issue": "must be an integer"
      }
    ]
  }
}
```

## Required fields

1. code: Stable machine-readable value in UPPER_SNAKE_CASE.
2. message: Client-safe human-readable message.
3. status: HTTP status code returned by the API.
4. requestId: Correlation id (echoes incoming x-request-id when provided, otherwise generated).

## Optional fields

1. details: Array of structured issues, primarily for validation/domain errors.

## Standard codes

1. VALIDATION_ERROR
2. RESOURCE_NOT_FOUND
3. ROUTE_NOT_FOUND
4. CONFLICT
5. UNAUTHORIZED
6. FORBIDDEN
7. INTERNAL_ERROR

## HTTP status mapping guidance

1. 400 Bad Request: Invalid request shape/parameters.
2. 401 Unauthorized: Authentication missing/invalid.
3. 403 Forbidden: Authenticated but not allowed.
4. 404 Not Found: Missing route or resource.
5. 409 Conflict: Unique or state conflict.
6. 422 Unprocessable Entity: Semantically invalid request.
7. 500 Internal Server Error: Unhandled server failure.

## Runtime implementation

1. Request id middleware: [middleware/error-contract.middleware.js](../middleware/error-contract.middleware.js)
2. Global handler: [middleware/error-contract.middleware.js](../middleware/error-contract.middleware.js)
3. App wiring: [app.js](../app.js)

## OpenAPI contract components

Reusable schemas and responses are defined in [docs/openapi.js](./openapi.js):

1. ErrorDetail
2. ErrorObject
3. ErrorEnvelope
4. ErrorResponse (backward-compatible alias)
5. Reusable response components (BadRequestError, NotFoundError, ConflictError, InternalServerError, etc.)

## Migration notes

1. Replace ad-hoc JSON error payloads and 200-on-failure paths with the standardized contract.
2. Update route annotations to reference reusable OpenAPI responses.
3. Add endpoint tests asserting error.code, error.status, and requestId presence.
