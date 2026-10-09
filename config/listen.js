/**
 * Serve plain HTTP and HTTPS on one port.
 *
 * **Why one port rather than two.** A browser only gives a page WebCodecs, which the video
 * player decodes with, on a secure address: HTTPS, or `localhost`. The development server
 * is reached at a bare IP address over plain HTTP, and only port 3000 is forwarded to it,
 * so the Mosaic's video page could not play at all (#181). Moving the port to HTTPS would
 * break everything already pointed at `http://...:3000` -- the GPU workers, the installers
 * built with that address, and the annotation GUI. So the port answers both: the first
 * byte a client sends says which. A TLS handshake always opens with `0x16`; an HTTP
 * request line never does.
 *
 * @fileoverview One listening port that speaks HTTP and HTTPS.
 * @author Isaac Travers
 * @module config/listen
 */

'use strict';

const http = require('http');
const https = require('https');
const net = require('net');

/** The first byte of every TLS record carrying a handshake. */
const TLS_HANDSHAKE = 0x16;

/**
 * Listen on `port` for both protocols, handing each connection to the right server.
 *
 * @param {Function} app - The request handler, an Express application.
 * @param {number|string} port - The port.
 * @param {Object} tls - `{ key, cert }` for the HTTPS side.
 * @param {Function} [onListening] - Called once the port is open.
 * @returns {net.Server} The listening socket.
 */
function listenHttpAndHttps(app, port, tls, onListening) {
    const plain = http.createServer(app);
    const secure = https.createServer(tls, app);

    const server = net.createServer((socket) => {
        // Look at the first byte only, then hand the socket over with it put back.
        socket.once('data', (first) => {
            socket.pause();
            socket.unshift(first);
            (first[0] === TLS_HANDSHAKE ? secure : plain).emit('connection', socket);
            process.nextTick(() => socket.resume());
        });

        // A client that connects and goes away before speaking is nobody's error.
        socket.on('error', () => socket.destroy());
    });

    return server.listen(port, onListening);
}

module.exports = { listenHttpAndHttps };
