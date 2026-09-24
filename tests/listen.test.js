/**
 * One port, both protocols (#181).
 *
 * The workers, the installers and the annotation GUI talk plain HTTP to port 3000, and
 * the Mosaic's video page needs HTTPS on the same port, because only that port is
 * forwarded. This proves one listener answers both, with a throwaway certificate made by
 * openssl, which is on every machine that builds MARP. A missing openssl fails rather
 * than skips.
 *
 * @fileoverview Tests for config/listen.js.
 * @author Isaac Travers
 * @module tests/listen
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { listenHttpAndHttps } = require('../config/listen');

let server;
let port;

/** GET `/` on the listener by one protocol, and answer with the body. */
function get(client) {
    return new Promise((resolve, reject) => {
        const request = client.get(
            { host: '127.0.0.1', port, path: '/', rejectUnauthorized: false },
            (response) => {
                let body = '';
                response.on('data', (chunk) => { body += chunk; });
                response.on('end', () => resolve({ status: response.statusCode, body }));
            }
        );
        request.on('error', reject);
    });
}

beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-listen-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    const made = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
        '-days', '1', '-subj', '/CN=jest', '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { encoding: 'utf8' });

    if (made.status !== 0) {
        throw new Error(`openssl could not make a test certificate: ${made.error ? made.error.message : made.stderr}`);
    }

    const app = (req, res) => res.end(`answered over ${req.socket.encrypted ? 'https' : 'http'}`);

    await new Promise((resolve) => {
        server = listenHttpAndHttps(app, 0, { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, resolve);
    });
    port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('one port, both protocols (#181)', () => {
    it('answers plain HTTP, as the workers and the GUI use it', async () => {
        expect(await get(http)).toEqual({ status: 200, body: 'answered over http' });
    });

    it('answers HTTPS on the same port, as the video page needs', async () => {
        expect(await get(https)).toEqual({ status: 200, body: 'answered over https' });
    });
});

describe('a browser asking for a page over plain http (#181)', () => {
    const request = require('supertest');
    const app = require('../app');
    const saved = {};

    beforeAll(() => {
        for (const name of ['HTTPS_KEY_PATH', 'HTTPS_CERT_PATH']) {
            saved[name] = process.env[name];
            process.env[name] = 'set';
        }
    });

    afterAll(() => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    });

    it('is sent to https when the server has a certificate', async () => {
        const response = await request(app).get('/apps/marp-mosaic-review/inspect.html').set('Host', 'marp.test:3000');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('https://marp.test:3000/apps/marp-mosaic-review/inspect.html');
    });

    it('leaves a page on localhost alone, which is already secure', async () => {
        const response = await request(app).get('/apps/marp-mosaic-review/inspect.html').set('Host', 'localhost:3000');

        // Not signed in, so the session gate sends it to the front page -- but not to https.
        expect(response.headers.location || '').not.toMatch(/^https:/);
    });

    it('leaves the API on plain http, which the workers and the GUI use', async () => {
        const response = await request(app).get('/api/v2/gpu/workers');

        expect(response.status).not.toBe(302);
    });
});

