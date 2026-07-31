/**
 * Authentication middleware bootstrap for MARP.
 *
 * Wires session middleware and Passport local-auth support into the shared
 * Express app using the shared Sequelize connection.
 *
 * @fileoverview Session and Passport initialization.
 * @author Isaac Travers
 * @module auth/setup
 */

const session = require('express-session');
const passport = require('passport');
const SequelizeStoreFactory = require('connect-session-sequelize');
const db = require('../model');
const { configurePassportLocalStrategy } = require('./passport.local');

/**
 * Configure session and Passport middleware on the provided app.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 * @throws {Error} When no session secret is configured and `NODE_ENV` is
 * `'production'` — refuses to sign session cookies with a hardcoded secret.
 */
function configureAuthentication(app) {
  // Prefer the dedicated auth secret, then fall back to generic session
  // secret.
  const configuredSecret = process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET;

  // A hardcoded fallback secret would let anyone who reads this file forge
  // session cookies, so it is never acceptable in production.
  if (!configuredSecret && process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SESSION_SECRET (or SESSION_SECRET) must be set in production. Refusing to start with a hardcoded session secret.'
    );
  }

  // Outside production, allow a local-only fallback, but never silently --
  // a developer who forgets to set the secret should see this every time
  // the server starts.
  if (!configuredSecret) {
    console.warn(
      'AUTH_SESSION_SECRET is not set. Using an insecure development-only fallback session secret; set AUTH_SESSION_SECRET before deploying.'
    );
  }

  const sessionSecret = configuredSecret || 'dev-only-auth-session-secret-change-me';

  // Build the Sequelize-backed session store constructor used by
  // express-session.
  const SequelizeStore = SequelizeStoreFactory(session.Store);

  // Persist session state in PostgreSQL through the existing Sequelize
  // connection and the auth_sessions table managed by migrations.
  const sessionStore = new SequelizeStore({
    db: db.sequelize,
    tableName: 'auth_sessions',
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 7 * 24 * 60 * 60 * 1000,
  });

  // Register session middleware before Passport so authentication state
  // can be loaded from the session on each request.
  app.use(
    session({
      // Use a project-specific cookie name to avoid collisions.
      name: 'marp.sid',
      secret: sessionSecret,
      // Do not rewrite unmodified sessions back to storage.
      resave: false,
      // Avoid creating server-side sessions for anonymous traffic.
      saveUninitialized: false,
      // Refresh cookie expiration on active requests.
      rolling: true,
      store: sessionStore,
      cookie: {
        // Restrict cookie access to HTTP traffic only (not JS).
        httpOnly: true,
        // Keep cookie usable for normal same-site navigation and forms.
        sameSite: 'lax',
        // Require HTTPS in production deployments.
        secure: process.env.NODE_ENV === 'production',
        // Session lifetime: 7 days.
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Register local username/password strategy and session
  // serialization/deserialization behavior.
  configurePassportLocalStrategy();

  // Initialize Passport on the app.
  app.use(passport.initialize());

  // Enable persistent login sessions via req.user.
  app.use(passport.session());
}

module.exports = {
  configureAuthentication,
};
