/**
 * Jellyfin, served from MARP's own address, for the browser video player (#181).
 *
 * **Why MARP carries these bytes.** The Mosaic's video page must be HTTPS -- a browser only
 * gives a page the WebCodecs decoder on a secure address -- and a secure page may not fetch
 * from a plain `http://` server. Jellyfin is plain HTTP on another machine, so the player
 * reaches it here instead, at `/jellyfin/...`, and this passes each request through
 * unchanged. Range requests pass through as they are, so the player still fetches only the
 * seconds around where it is, never the file.
 *
 * **It is not a way round Jellyfin's own sign-in.** The reviewer signs in to Jellyfin with
 * their own account and that token travels in the request as it would to Jellyfin
 * directly; this adds no credential of MARP's. It is also not open to the world: a caller
 * needs a MARP session that may read observations, the same gate as the Mosaic itself.
 * MARP's session cookie is taken off every request before it leaves, because it belongs to
 * MARP and Jellyfin has no business seeing it.
 *
 * @fileoverview Session-gated pass-through proxy to the configured Jellyfin.
 * @author Isaac Travers
 * @module middleware/jellyfin-proxy
 */

'use strict';

const http = require('http');
const https = require('https');

const jellyfinRepository = require('../repository/jellyfin.repository');
const usersRepository = require('../repository/v2_users.repository');

/** Where the player is told Jellyfin is. */
const PROXY_PATH = '/jellyfin';

/** The permission the Mosaic itself is gated on. */
const PERMISSION = 'observations:read';

/** Request headers that belong to this hop, or to MARP, and are not passed on. */
const DROPPED_REQUEST_HEADERS = ['host', 'cookie', 'connection', 'keep-alive', 'proxy-connection', 'upgrade'];

/**
 * Refuse a caller without a MARP session that may read observations.
 *
 * A 401 rather than the redirect the pages use: the caller is the player's `fetch`, and a
 * redirect to the front page would arrive as HTML where it expected video.
 */
async function requireReader(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: 'Sign in to MARP to reach the video server.' });
    }

    if (!(await usersRepository.userHasPermission(req.user.user_id, PERMISSION))) {
        return res.status(403).json({ error: `Reaching the video server needs ${PERMISSION}.` });
    }

    return next();
}

/**
 * Pass one request to Jellyfin and stream its answer back.
 *
 * @param {Object} req - Express request, mounted at {@link PROXY_PATH}.
 * @param {Object} res - Express response.
 * @returns {void}
 */
function forward(req, res) {
    const base = (jellyfinRepository.baseUrl || '').replace(/\/+$/, '');

    if (!base) {
        res.status(503).json({ error: 'No video server is configured (JELLYFIN_BASE_URL).' });
        return;
    }

    // `req.url` is the part after the mount, with its query string.
    const target = new URL(`${base}${req.url === '/' ? '' : req.url}`);
    const headers = { ...req.headers, host: target.host };

    for (const name of DROPPED_REQUEST_HEADERS.slice(1)) {
        delete headers[name];
    }

    const client = target.protocol === 'https:' ? https : http;
    const upstream = client.request(target, { method: req.method, headers }, (answer) => {
        const out = { ...answer.headers };

        // A redirect to Jellyfin's own address is brought back under this one.
        if (typeof out.location === 'string' && out.location.startsWith(base)) {
            out.location = `${PROXY_PATH}${out.location.slice(base.length)}`;
        }

        res.writeHead(answer.statusCode, out);
        answer.pipe(res);
    });

    upstream.on('error', (error) => {
        if (res.headersSent) {
            res.destroy(error);
        } else {
            res.status(502).json({ error: `The video server could not be reached: ${error.code || error.message}` });
        }
    });

    // A player that seeks away cancels its request; stop fetching for it.
    res.on('close', () => upstream.destroy());

    req.pipe(upstream);
}

/**
 * Mount the proxy. Call after authentication is configured, so the gate sees the session.
 *
 * @param {Object} app - Express application.
 * @returns {void}
 */
function mountJellyfinProxy(app) {
    app.use(PROXY_PATH, requireReader, forward);
}

module.exports = { mountJellyfinProxy, PROXY_PATH };
