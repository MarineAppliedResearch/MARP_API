# MARP Auth Phase 1 Migration Spec

This document defines the concrete Phase 1 schema rollout for MARP-owned authentication.

Scope covered:
- Local username/password for human users
- Session-backed login state in PostgreSQL
- Bearer-token auth for service applications
- Password reset token flow

Out of scope for Phase 1:
6. Add and use dedicated authentication testing scripts in `package.json`:
   - `test:auth` runs the auth test suite
   - `test:auth:watch` runs auth tests in watch mode for development
   - `test:auth:ci` runs auth tests with CI-friendly flags and coverage
7. Run auth smoke tests:
- Fine-grained row-level policy tables

## Decisions Locked

1. Keep `users` as the canonical person/profile table.
8. Run automated auth endpoint tests from the new scripts.

Required automated coverage included in Phase 6:
- Human auth endpoints
  - login success and login failure
  - logout success and idempotent logout behavior
  - current-user/whoami success with active session
  - current-user/whoami unauthorized without session
- User credential management endpoints
  - create user (admin path) success
  - set password success and validation failure
  - change username success, duplicate conflict, and validation failure
  - reset password request success for existing user and safe response for unknown user
  - reset password token consume success, expired token, reused token, and invalid token
- Service auth endpoints
  - create service client success and authorization failure
  - issue token success
  - rotate token success and old token invalidation
  - revoke token success and revoked-token rejection
- Auth middleware behavior on protected endpoints
  - session-authenticated human request accepted
  - bearer-authenticated service request accepted
  - invalid bearer token rejected
  - missing auth rejected
  - disabled user/service rejected

Error-contract assertions for all non-2xx auth responses:
- `error.code` present and correct
- `error.status` matches HTTP status
- `error.requestId` present

Operational assertions:
- successful login creates/updates auth session state
- service token checks update `last_used_at`
- password reset consumption marks token as used

Phase 6 completion criteria:
1. Auth endpoint tests are committed under the existing test suite structure.
2. `test:auth` and `test:auth:ci` pass in CI.
3. Critical auth paths and failure modes are covered.
4. No new auth endpoint ships without a corresponding automated test.
- Remove added columns.

## Migration 2: Create Auth Identities

Filename:
- `migrations/20260731101000-create-auth-identities-table.js`

New table:
- `auth_identities`

Columns:
- `auth_identity_id` INTEGER PK auto-increment
- `user_id` INTEGER NOT NULL FK -> `users.user_id`
- `provider` VARCHAR(30) NOT NULL
- `provider_subject` VARCHAR(255) NULL
- `password_hash` TEXT NULL
- `password_changed_at` DATE NULL
- `createdAt` DATE NOT NULL DEFAULT NOW
- `updatedAt` DATE NOT NULL DEFAULT NOW

Rules:
- For local identities: `provider='local'`, `provider_subject` NULL, `password_hash` required
- For external identities later: `provider='google'` (or other), `provider_subject` required, `password_hash` NULL allowed

Constraints and indexes:
- Unique index on (`provider`, `provider_subject`) where `provider_subject IS NOT NULL`
- Unique index on `user_id` where `provider='local'` to enforce one local credential set per user
- Index on `user_id`
- Optional check: `provider IN ('local', 'google')` (or omit and keep provider open-ended)

Down migration:
- Drop `auth_identities`.

## Migration 3: Create Auth Sessions

Filename:
- `migrations/20260731102000-create-auth-sessions-table.js`

New table:
- `auth_sessions`

Columns (compatible with Sequelize session store usage):
- `sid` VARCHAR(128) PK
- `expires` DATE NOT NULL
- `data` TEXT (or JSON/JSONB based on store expectations) NOT NULL
- `createdAt` DATE NOT NULL DEFAULT NOW
- `updatedAt` DATE NOT NULL DEFAULT NOW

Constraints and indexes:
- Index on `expires` for cleanup and lookup

Integration note:
- This table is for `express-session` + Sequelize session store.
- Keep distinct from the existing MARP domain table named `sessions`.

Down migration:
- Drop `auth_sessions`.

## Migration 4: Create Service Clients

Filename:
- `migrations/20260731103000-create-service-clients-table.js`

New table:
- `service_clients`

Columns:
- `service_client_id` INTEGER PK auto-increment
- `name` VARCHAR(120) NOT NULL
- `description` TEXT NULL
- `status` VARCHAR(20) NOT NULL DEFAULT 'active'
- `created_by_user_id` INTEGER NULL FK -> `users.user_id`
- `last_used_at` DATE NULL
- `createdAt` DATE NOT NULL DEFAULT NOW
- `updatedAt` DATE NOT NULL DEFAULT NOW

Constraints and indexes:
- Unique index on `name`
- Index on `status`
- Optional check: `status IN ('active', 'disabled')`

Down migration:
- Drop `service_clients`.

## Migration 5: Create Service Tokens

Filename:
- `migrations/20260731104000-create-service-tokens-table.js`

New table:
- `service_tokens`

Columns:
- `service_token_id` INTEGER PK auto-increment
- `service_client_id` INTEGER NOT NULL FK -> `service_clients.service_client_id`
- `token_prefix` VARCHAR(16) NOT NULL
- `token_hash` TEXT NOT NULL
- `expires_at` DATE NULL
- `revoked_at` DATE NULL
- `last_used_at` DATE NULL
- `createdAt` DATE NOT NULL DEFAULT NOW
- `updatedAt` DATE NOT NULL DEFAULT NOW

Constraints and indexes:
- Unique index on `token_hash`
- Index on `service_client_id`
- Index on (`service_client_id`, `revoked_at`)
- Index on `expires_at`

Token handling requirements:
- Return raw token only once at creation.
- Persist only `token_hash`, never raw token.
- Use `token_prefix` for operational identification without exposing secret material.

Down migration:
- Drop `service_tokens`.

## Migration 6: Create Password Reset Tokens

Filename:
- `migrations/20260731105000-create-password-reset-tokens-table.js`

New table:
- `password_reset_tokens`

Columns:
- `password_reset_token_id` INTEGER PK auto-increment
- `user_id` INTEGER NOT NULL FK -> `users.user_id`
- `token_hash` TEXT NOT NULL
- `expires_at` DATE NOT NULL
- `used_at` DATE NULL
- `requested_at` DATE NOT NULL DEFAULT NOW
- `createdAt` DATE NOT NULL DEFAULT NOW
- `updatedAt` DATE NOT NULL DEFAULT NOW

Constraints and indexes:
- Unique index on `token_hash`
- Index on (`user_id`, `used_at`)
- Index on `expires_at`

Behavior requirements:
- One-time use: set `used_at` when consumed.
- Reject token if expired or already used.

Down migration:
- Drop `password_reset_tokens`.

## Data Migration Strategy

1. Deploy schema with backward-compatible nullable fields first.
2. Backfill `users.username` for existing rows.
3. Create local identity rows in `auth_identities` for existing users that should be able to log in.
4. After cutover, optionally enforce stronger NOT NULL and stricter checks in a hardening migration.

## Runtime Contract After Phase 1

Human authentication:
- Username/password verified against `auth_identities` local rows.
- Session persisted in `auth_sessions`.

Service authentication:
- Bearer token hashed and checked against `service_tokens`.
- Service principal resolved from `service_clients`.

## Test Checklist For Migration PR

1. Run migrations up on a fresh DB.
2. Run migrations up on a copy of current dev schema.
3. Verify down migrations reverse cleanly in local test DB.
4. Validate indexes and FKs exist as specified.
5. Validate no conflict with existing `sessions` domain table.

## Deployment Checklist

1. Backup database.
2. Stop API write traffic.
3. Apply migrations.
4. Deploy code that uses new schema.
5. Restart app.
6. Run auth smoke tests:
   - user login/logout
   - authenticated whoami
   - service token auth
   - denied invalid token
   - password reset flow
