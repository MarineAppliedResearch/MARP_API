/**
 * HTTP entry point for the MARP API.
 *
 * Loads the fully configured Express application from app.js and starts it
 * listening on the configured port. Kept separate from app.js so the app
 * itself can be imported without side effects (e.g. by tests using
 * Supertest, which talk to the app in-process and never need a real port).
 *
 * Starting the server is also what starts the thumbnail extractor. It is
 * deliberately not started from `app.js`: every test suite imports the app
 * directly, and a background loop that began on import would have the whole
 * suite opening Jellyfin streams. Same split, same reason `app.listen` is here
 * rather than there.
 *
 * @fileoverview Starts the MARP API HTTP server.
 * @author Isaac Travers
 * @module server
 */

const fs = require('fs');
const https = require('https');
const app = require('./app');
const thumbnailExtraction = require('./service/thumbnail-extraction.service');

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

// Thumbnail extraction (#118). Reports and declines rather than throwing when
// ffmpeg is absent: extraction is the only thing that needs a decoder, and an
// API host without one must still serve observations.
thumbnailExtraction.start().then((result) => {
    if (result.started) {
        console.log('Thumbnail extraction started.');
    } else {
        console.log(`Thumbnail extraction is not running: ${result.reason}`);
    }
});
