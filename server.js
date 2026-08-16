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

const fs = require('fs');
const https = require('https');
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
 * Filesystem paths to a TLS key/certificate pair.
 *
 * Both must be set to serve over HTTPS. Browsers only expose WebCodecs
 * (VideoDecoder), and other secure-context-gated APIs, over https or on
 * localhost -- so reaching this server at a LAN address needs real TLS.
 *
 * @constant
 * @type {string|undefined}
 */
const httpsKeyPath = process.env.HTTPS_KEY_PATH;
const httpsCertPath = process.env.HTTPS_CERT_PATH;

if (httpsKeyPath && httpsCertPath) {
    https
        .createServer(
            {
                key: fs.readFileSync(httpsKeyPath),
                cert: fs.readFileSync(httpsCertPath),
            },
            app
        )
        .listen(port, () => {
            console.log(`Server listening (https) on the port  ${port}`);
        });
} else {
    app.listen(port, () => {
        console.log(`Server listening on the port  ${port}`);
    });
}
