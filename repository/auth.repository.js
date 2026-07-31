/**
 * Repository module for authentication database operations.
 *
 * Encapsulates credential and session-adjacent reads/writes used by the
 * authentication service. Request handling must remain in controllers.
 *
 * @fileoverview Authentication persistence operations.
 * @author Isaac Travers
 * @module repository/auth
 */

const db = require('../model');
const logger = require('../logger/api.logger');

/**
 * Repository for authentication data access.
 *
 * @class AuthRepository
 */
class AuthRepository {
  db = {};

  constructor() {
    this.db = db;
  }

  /**
   * Fetch local-login credentials by username.
   *
   * @async
   * @param {string} username - Local username to look up.
   * @returns {Promise<Object|null>} Matching auth identity with associated
   * user record, or null when not found.
   */
  async getLocalIdentityByUsername(username) {
    try {
      // Local auth rows are identified by provider='local' and no external
      // provider subject value.
      return await this.db.auth_identities.findOne({
        where: {
          provider: 'local',
          provider_subject: null,
        },
        include: [
          {
            // Join the owning user row so service/controller logic can
            // evaluate account status and return safe profile fields.
            model: this.db.users,
            as: 'user',
            required: true,
            where: {
              // Username comparison is exact and case-sensitive here.
              username,
            },
          },
        ],
      });
    } catch (error) {
      // Repository logs low-level errors and rethrows so API handlers can
      // return standardized error envelopes.
      logger.error('Error::' + error);
      throw error;
    }
  }

  /**
   * Fetch one user by id.
   *
   * @async
   * @param {number} userId - User identifier.
   * @returns {Promise<Object|null>} Matching user, or null when not found.
   */
  async getUserById(userId) {
    try {
      // Resolve by primary key for deserializeUser/session hydration.
      const user = await this.db.users.findByPk(userId);

      // Normalize "not found" as null instead of undefined.
      return user || null;
    } catch (error) {
      // Preserve stack by rethrowing after logging.
      logger.error('Error::' + error);
      throw error;
    }
  }

  /**
   * Stamp a user row with the current login time.
   *
   * @async
   * @param {number} userId - User identifier.
   * @returns {Promise<void>}
   */
  async updateLastLogin(userId) {
    try {
      // Record successful login time for account-audit visibility.
      await this.db.users.update(
        { last_login_at: new Date() },
        {
          where: {
            // Update exactly one user row by numeric id.
            user_id: userId,
          },
        }
      );
    } catch (error) {
      // Caller decides whether this failure should block request flow.
      logger.error('Error::' + error);
      throw error;
    }
  }
}

module.exports = new AuthRepository();
