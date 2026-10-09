/**
 * Passport local-strategy configuration for MARP authentication.
 *
 * Configures username/password verification, session serialization, and
 * session deserialization for users authenticated through local credentials.
 *
 * @fileoverview Passport local authentication setup.
 * @author Isaac Travers
 * @module auth/passport-local
 */

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const authController = require('../controller/auth.controller');

/**
 * Configure Passport local authentication behavior.
 *
 * @returns {void}
 */
function configurePassportLocalStrategy() {
  // Guard against duplicate strategy registration when app modules are
  // reloaded in development tooling.
  if (!passport._strategy('local')) {
    passport.use(
      new LocalStrategy(
        {
          // Read local credentials from a conventional request shape.
          usernameField: 'username',
          passwordField: 'password',
          // Keep callback signature minimal for now.
          passReqToCallback: false,
        },
        async (username, password, done) => {
          try {
            // Delegate credential verification to controller/service layers.
            const user = await authController.authenticateLocal(username, password);

            // Invalid credentials return false without leaking specifics.
            if (!user) {
              return done(null, false, { message: 'Invalid username or password.' });
            }

            // Success: attach safe user payload to session lifecycle.
            return done(null, user);
          } catch (error) {
            // Unexpected failures bubble to shared error handling.
            return done(error);
          }
        }
      )
    );
  }

  // Persist only the user id in session storage.
  passport.serializeUser((user, done) => {
    done(null, user.user_id);
  });

  // Resolve req.user from stored session user id.
  passport.deserializeUser(async (userId, done) => {
    try {
      // Re-load current user state (including active/disabled checks).
      const user = await authController.getSessionUserById(userId);

      // Missing/disabled users are treated as unauthenticated sessions.
      if (!user) {
        return done(null, false);
      }

      // Valid session principal restored.
      return done(null, user);
    } catch (error) {
      // Database/service failures propagate as auth middleware errors.
      return done(error);
    }
  });
}

module.exports = {
  configurePassportLocalStrategy,
};
