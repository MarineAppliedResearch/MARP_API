# MARP Auth Phase 1-2 Migration Spec

This document defines the schema and behavior actually implemented for MARP-owned
local authentication: `users` credential columns, `auth_identities`, and
`auth_sessions`, plus the `/api/v2/auth/*` login/logout/session-check routes built
on top of them.

Broader phases from the original rollout plan (service/bearer-token auth,
authorization/roles, Google account linking, self-service password reset) are
intentionally deferred — see [Deferred — Not Started](#deferred--not-started)
at the end of this document. None of that schema or code ships as part of this
spec.

## Scope covered

- Local username/password login for human users (`users` + `auth_identities`)
- Session-backed login state in PostgreSQL (`auth_sessions`, via
  `express-session` + `connect-session-sequelize`)
- `POST /api/v2/auth/login`, `POST /api/v2/auth/logout`, `GET /api/v2/auth/me`

## Decisions locked

1. Keep `users` as the canonical person/profile table — it does not become a
   credential table. `username`, `status`, and `last_login_at` are added to it,
   but password material lives only in `auth_identities`.
2. Credentials live in a separate `auth_identities` table, keyed by
   `(provider, provider_subject)`, so future external-identity linking (e.g.
   Google) doesn't require redesigning `users`.
3. Sessions are stored server-side in PostgreSQL (`auth_sessions`), not in a
   signed client-side cookie, so sessions can be invalidated server-side.
4. Passwords are hashed with Argon2 (`argon2` package); plaintext passwords are
   never persisted or logged.
5. No self-service password reset in this phase — see
   [Deferred — Not Started](#deferred--not-started).

## Migration 1: Add auth columns to users

Filename:
- `migrations/20260731100000-add-auth-columns-to-users.js`

Columns added to `users`:
- `username` VARCHAR(64) NULL
- `status` VARCHAR(20) NOT NULL DEFAULT `'active'`
- `last_login_at` DATE NULL

Constraints and indexes:
- Unique index `users_username_unique_not_null` on `username` where
  `username IS NOT NULL` (multiple `NULL` usernames are allowed; Postgres
  unique indexes don't treat `NULL` as a duplicate)
- Check constraint `users_status_allowed_values`: `status IN ('active',
  'disabled', 'pending')`

Down migration:
- Remove the check constraint and unique index, then drop all three columns.

## Migration 2: Create auth identities

Filename:
- `migrations/20260731101000-create-auth-identities-table.js`

New table: `auth_identities`

Columns:
- `auth_identity_id` INTEGER PK auto-increment
- `user_id` INTEGER NOT NULL FK -> `users.user_id` (`ON DELETE CASCADE`)
- `provider` VARCHAR(30) NOT NULL
- `provider_subject` VARCHAR(255) NULL
- `password_hash` TEXT NULL
- `password_changed_at` DATE NULL
- `createdAt` / `updatedAt` DATE NOT NULL DEFAULT NOW

Rules:
- Local identities: `provider='local'`, `provider_subject` NULL,
  `password_hash` required
- External identities (future): `provider='google'` (or other),
  `provider_subject` required, `password_hash` NULL

Constraints and indexes:
- Index on `user_id` (`auth_identities_user_id_idx`)
- Unique index `auth_identities_provider_subject_unique_not_null` on
  (`provider`, `provider_subject`) where `provider_subject IS NOT NULL` —
  prevents linking the same external account twice
- Unique index `auth_identities_one_local_per_user` on `user_id` where
  `provider='local'` — enforces exactly one local credential set per user
  (a plain unique index on `(provider, provider_subject)` would *not* catch
  this, since Postgres treats every `NULL` `provider_subject` as distinct)
- Check constraint `auth_identities_provider_allowed_values`:
  `provider IN ('local', 'google')`
- Check constraint `auth_identities_local_password_required`:
  `provider <> 'local' OR password_hash IS NOT NULL`

Down migration:
- Drop `auth_identities`.

## Migration 3: Create auth sessions

Filename:
- `migrations/20260731102000-create-auth-sessions-table.js`

New table: `auth_sessions` (session store backing `express-session` via
`connect-session-sequelize`)

Columns:
- `sid` VARCHAR(128) PK
- `expires` DATE NOT NULL
- `data` TEXT NOT NULL
- `createdAt` / `updatedAt` DATE NOT NULL DEFAULT NOW

Constraints and indexes:
- Index `auth_sessions_expires_idx` on `expires`, for store cleanup/lookup

Integration note:
- Deliberately named `auth_sessions`, distinct from the existing MARP domain
  table named `sessions` (dive/survey sessions) — the two are unrelated.

Down migration:
- Drop `auth_sessions`.

## Runtime contract

Human authentication:
- Username/password verified against the `auth_identities` row where
  `provider='local'`, joined to `users` by `user_id`.
- Only `users.status='active'` accounts may authenticate or resume a session.
- On success, a session is created/refreshed in `auth_sessions`; on
  `POST /logout`, the session is destroyed.
- Every auth response returns a safe user projection
  (`user_id`, `name`, `username`, `status`) — never `password_hash`.

## Test checklist for this migration set

1. Run migrations up on a fresh DB.
2. Run migrations up against the current dev schema.
3. Verify down migrations reverse cleanly (`db:migrate:undo:all --to
   20260731100000-add-auth-columns-to-users.js`, followed by `db:migrate`).
4. Validate indexes/constraints exist as specified (`\d users`, `\d
   auth_identities`, `\d auth_sessions` in `psql`).
5. Validate no conflict with the existing `sessions` domain table.

## Deployment checklist

1. Backup database.
2. Apply migrations (`npx sequelize-cli db:migrate`).
3. Deploy code that uses the new schema.
4. Restart app.
5. Run auth smoke tests: login, authenticated `/me`, logout, `/me` after
   logout returns 401.

## Deferred — Not Started

The following were part of the original multi-phase rollout plan but are
**not implemented, not migrated, and not scheduled** as part of this spec.
They're recorded here only so a future phase doesn't have to re-derive the
design from scratch.

- **Service/bearer-token auth** — `service_clients` (machine identities) and
  `service_tokens` (hashed bearer tokens, with prefix/rotation/revocation/
  `last_used_at` tracking) for worker/application callers. Needs its own
  migrations, repository/service/controller layers, and bearer-auth
  middleware.
- **Authorization/roles** — coarse roles (admin/user/service) and
  request-level policy/ownership checks. Nothing in the current schema or
  middleware enforces authorization beyond "is there a valid session."
- **Google account linking** — an external Passport strategy writing into
  `auth_identities` with `provider='google'`. The schema already supports
  this (see Migration 2); no strategy code exists yet.
- **Password reset** — explicitly scoped as an admin-only operation, not
  self-service, and blocked on the authorization phase above: there's no way
  to safely gate a "reset another user's password" endpoint without role
  checks. No `password_reset_tokens` table, endpoint, or email/SMTP
  integration exists in this codebase.
