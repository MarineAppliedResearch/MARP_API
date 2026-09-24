/**
 * The Jellyfin proxy the Mosaic's video page reaches Jellyfin through (#181).
 *
 * Against a fake Jellyfin on a local port, so this runs in CI and can see exactly what
 * arrived: the proxy is only worth having if the request reaches Jellyfin as the player
 * sent it -- its Range header, its sign-in body -- and without MARP's session cookie.
 *
 * @fileoverview Tests for middleware/jellyfin-proxy.middleware.js.
 * @author Isaac Travers
 * @module tests/jellyfin-proxy
 */

const http = require('http');
const request = require('supertest');

const app = require('../app');
const jellyfinRepository = require('../repository/jellyfin.repository');

let upstream;
let seen = [];
let originalBase;

beforeAll(async () => {
    upstream = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, headers: req.headers, body });

            if (req.url.startsWith('/redirect')) {
                res.writeHead(302, { location: `${jellyfinRepository.baseUrl}/Videos/1/stream` });
                res.end();
            } else if (req.headers.range) {
                res.writeHead(206, { 'content-range': 'bytes 0-3/100', 'content-type': 'video/mp4' });
                res.end('abcd');
            } else {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ServerName: 'jest-jellyfin' }));
            }
        });
    });

    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    originalBase = jellyfinRepository.baseUrl;
    jellyfinRepository.baseUrl = `http://127.0.0.1:${upstream.address().port}`;
});

beforeEach(() => {
    seen = [];
});

afterAll(async () => {
    jellyfinRepository.baseUrl = originalBase;
    await new Promise((resolve) => upstream.close(resolve));
});

describe('Jellyfin under MARP\'s own address (#181)', () => {
    it('passes a request through and answers with Jellyfin\'s reply', async () => {
        const response = await global.api.get('/jellyfin/System/Info/Public?x=1');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ServerName: 'jest-jellyfin' });
        expect(seen[0]).toMatchObject({ method: 'GET', url: '/System/Info/Public?x=1' });
    });

    it('keeps MARP\'s session cookie to itself', async () => {
        await global.api.get('/jellyfin/System/Info/Public');

        expect(seen[0].headers.cookie).toBeUndefined();
    });

    it('passes a byte range through, so the player fetches only what it needs', async () => {
        const response = await global.api.get('/jellyfin/Videos/1/stream').set('Range', 'bytes=0-3');

        expect(response.status).toBe(206);
        expect(response.headers['content-range']).toBe('bytes 0-3/100');
        expect(seen[0].headers.range).toBe('bytes=0-3');
    });

    it('passes the sign-in body through as it was sent', async () => {
        const body = { Username: 'jest-reviewer', Pw: 'not-a-real-password' };

        await global.api.post('/jellyfin/Users/AuthenticateByName').send(body);

        expect(seen[0].method).toBe('POST');
        expect(JSON.parse(seen[0].body)).toEqual(body);
    });

    it('brings a redirect to Jellyfin\'s own address back under MARP\'s', async () => {
        const response = await global.api.get('/jellyfin/redirect').redirects(0);

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/jellyfin/Videos/1/stream');
    });

    it('refuses anyone without a MARP session', async () => {
        const response = await request(app).get('/jellyfin/System/Info/Public');

        expect(response.status).toBe(401);
        expect(seen).toHaveLength(0);
    });
});
