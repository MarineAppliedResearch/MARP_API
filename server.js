/**
 * HTTP entry point for the MARP API.
 *
 * Loads the fully configured Express application from app.js and starts it
 * listening on the configured port. Kept separate from app.js so the app
 * itself can be imported without side effects (e.g. by tests using
 * Supertest, which talk to the app in-process and never need a real port).
 *
 * @fileoverview Starts the MARP API HTTP server.
 * @author Isaac Travers
 * @module server
 */

const app = require('./app');

/**
 * TCP port used by the HTTP server.
 *
 * The PORT environment variable takes precedence. Port 3000 is used when
 * no explicit port is configured.
 *
 * @constant
 * @type {number|string}
 */
const port = process.env.PORT || 3000;

/**
 * Start the HTTP server listening on the configured port.
 */
app.listen(port, () => {
    console.log(`Server listening on the port  ${port}`);
})
