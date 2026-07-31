/**
 * Service layer for authentication operations.
 *
 * Coordinates local credential verification and authenticated-session user
 * lookup using repository methods and password hashing utilities.
 *
 * @fileoverview Authentication service logic.
 * @author Isaac Travers
 * @module service/auth
 */

const argon2 = require('argon2');
const authRepository = require('../repository/auth.repository');

/**
 * Service for authentication operations.
 *
 * @class AuthService
 */
class AuthService {
  /**
   * Validate a local username/password pair.
   *
   * @async
   * @param {string} username - Username from login request.
   * @param {string} password - Plaintext password from login request.
   * @returns {Promise<Object|null>} Authenticated safe user payload, or null
   * when credentials are invalid.
   */
  async authenticateLocalUser(username, password) {
    // Basic presence validation before any database access.
    if (!username || !password) {
      return null;
    }

    // Normalize username input to avoid auth misses from surrounding spaces.
    const normalizedUsername = String(username).trim();

    // Reject effectively-empty usernames early.
    if (!normalizedUsername) {
      return null;
    }

    // Load local identity and associated user record.
    const identity = await authRepository.getLocalIdentityByUsername(normalizedUsername);

    // Fail closed when identity lookup is missing required fields.
    if (!identity || !identity.user || !identity.password_hash) {
      return null;
    }

    // Only active users are allowed to authenticate.
    if (identity.user.status && identity.user.status !== 'active') {
      return null;
    }

    // Verify password hash using Argon2.
    let isPasswordValid = false;

    try {
      // verify() performs constant-time hash verification.
      isPasswordValid = await argon2.verify(identity.password_hash, String(password));
    } catch (error) {
      // Treat verification errors as invalid credentials.
      isPasswordValid = false;
    }

    // Invalid credentials stop authentication without detail leakage.
    if (!isPasswordValid) {
      return null;
    }

    // Persist successful-login audit metadata.
    await authRepository.updateLastLogin(identity.user.user_id);

    // Return the safe session payload, never credential fields.
    return this.toSafeUser(identity.user);
  }

  /**
   * Resolve a logged-in session user by id.
   *
   * @async
   * @param {number} userId - User id stored in session.
   * @returns {Promise<Object|null>} Safe user payload, or null.
   */
  async getSessionUserById(userId) {
    // Resolve the user for session deserialization.
    const user = await authRepository.getUserById(userId);

    // Missing users invalidate the session principal.
    if (!user) {
      return null;
    }

    // Disabled users are treated as unauthenticated.
    if (user.status && user.status !== 'active') {
      return null;
    }

    // Return response-safe identity fields only.
    return this.toSafeUser(user);
  }

  /**
   * Convert a user model instance to a response-safe shape.
   *
   * @param {Object} user - Sequelize user instance or plain object.
   * @returns {Object} Safe user projection: `user_id` (number), `name`
   * (string), `username` (string), `status` (string or null).
   */
  toSafeUser(user) {
    // Keep this payload intentionally small: it is stored in session and
    // echoed through auth endpoints.
    return {
      user_id: user.user_id,
      name: user.name,
      username: user.username || null,
      status: user.status || null,
    };
  }
}

module.exports = new AuthService();
