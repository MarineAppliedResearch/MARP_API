/**
 * Endpoint tests for the Jellyfin (V2) API.
 *
 * Every other domain's tests hit the real dev Postgres database directly,
 * because that database is ours to seed/reset. Jellyfin is a live
 * *external* third-party service we don't control the state of, so these
 * tests mock the HTTP boundary at the platform `fetch` global instead --
 * no new dependency (e.g. nock) is needed since the repository already
 * calls `fetch` directly and Jest can substitute it with a plain mock
 * function. A small number of manual live-smoke checks against the real
 * dev Jellyfin server were already run by hand during implementation (see
 * repository/jellyfin.repository.js's file-level doc comment); this suite
 * covers the golden path and key error cases for CI, without a live
 * dependency.
 *
 * @fileoverview Endpoint tests for /api/v2/jellyfin/*.
 * @author Isaac Travers
 * @module tests/jellyfin
 */

const request = require('supertest');
const app = require('../app');
const jellyfinRepository = require('../repository/jellyfin.repository');

/**
 * Builds a JSON Jellyfin response, matching what `fetch` would resolve to.
 *
 * @param {number} status - HTTP status code.
 * @param {Object} body - Response body, JSON-serialized.
 * @returns {Response}
 */
function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Builds a plain-text Jellyfin response (used for the trickplay playlist).
 *
 * @param {number} status - HTTP status code.
 * @param {string} body - Raw response text.
 * @returns {Response}
 */
function textResponse(status, body) {
    // A 204 response must not carry a body -- even an empty string throws
    // "Invalid response status code 204" from the platform Response
    // constructor, so a falsy body is passed through as null instead.
    return new Response(body || null, { status });
}

/**
 * Builds a fake Jellyfin server as a `fetch` mock: a fixed library, one
 * folder with one child, and one video item reachable via search, with
 * enough PlaybackInfo/trickplay/session-report coverage to exercise every
 * route in routes/jellyfin.routes.js.
 *
 * @returns {jest.Mock}
 */
function buildJellyfinFetchMock() {
    return jest.fn(async (url, options = {}) => {
        const method = options.method || 'GET';
        const parsedUrl = new URL(url);
        const path = parsedUrl.pathname;

        if (path === '/Users/AuthenticateByName') {
            return jsonResponse(200, { AccessToken: 'fake-access-token', User: { Id: 'fake-user-id' } });
        }

        if (/\/Users\/[^/]+\/Views$/.test(path)) {
            return jsonResponse(200, {
                Items: [
                    { Id: 'lib1', Name: 'Library One', Type: 'CollectionFolder', Path: '/data/lib1', IsFolder: true, MediaType: 'Unknown', ChildCount: 1 },
                ],
            });
        }

        if (/\/Users\/[^/]+\/Items$/.test(path)) {
            const params = parsedUrl.searchParams;

            if (params.get('ParentId') === 'notfound-id') {
                return jsonResponse(404, {});
            }

            if (params.has('ParentId')) {
                return jsonResponse(200, {
                    Items: [
                        { Id: 'child1', Name: 'Dive01', Type: 'Folder', Path: '/data/lib1/Dive01', IsFolder: true, ChildCount: 5 },
                    ],
                });
            }

            if (params.has('SearchTerm')) {
                const term = params.get('SearchTerm');

                if (term.toLowerCase().includes('nomatch')) {
                    return jsonResponse(200, { Items: [] });
                }

                return jsonResponse(200, {
                    Items: [
                        { Id: 'video1', Name: 'test_video', Type: 'Video', Path: '/data/lib1/test_video.mp4', IsFolder: false, MediaType: 'Video', RunTimeTicks: 1_000_000_000 },
                    ],
                });
            }
        }

        if (/\/Items\/[^/]+\/PlaybackInfo$/.test(path) && method === 'POST') {
            const body = JSON.parse(options.body);

            if (path.includes('notfound-item')) {
                return jsonResponse(400, { ErrorCode: 'NotFound' });
            }

            if (body.EnableTranscoding && !body.EnableDirectPlay) {
                return jsonResponse(200, {
                    PlaySessionId: 'transcode-session',
                    MediaSources: [
                        { Id: 'video1', Container: 'ts', Bitrate: 4_000_000, SupportsTranscoding: true, TranscodingUrl: '/videos/video1/master.m3u8?PlaySessionId=transcode-session' },
                    ],
                });
            }

            return jsonResponse(200, {
                PlaySessionId: 'direct-session',
                MediaSources: [
                    {
                        Id: 'video1',
                        Container: 'mp4',
                        Bitrate: 6_000_000,
                        SupportsDirectPlay: true,
                        SupportsDirectStream: true,
                        SupportsTranscoding: true,
                        MediaStreams: [{ Type: 'Video', Width: 1920, Height: 1080 }],
                    },
                ],
            });
        }

        if (/\/Sessions\/Playing/.test(path) && method === 'POST') {
            return textResponse(204, '');
        }

        if (/\/Videos\/[^/]+\/Trickplay\/\d+\/tiles\.m3u8$/.test(path)) {
            return textResponse(
                200,
                '#EXT-X-TILES:RESOLUTION=320x180,LAYOUT=10x10,DURATION=10\n0.jpg?MediaSourceId=video1&ApiKey=fake-access-token\n'
            );
        }

        return jsonResponse(404, {});
    });
}

/**
 * Verifies the golden path and key error cases for every /api/v2/jellyfin
 * route, against a mocked Jellyfin server.
 */
describe('Jellyfin (V2) routes', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        // A fresh mock and a cleared session cache per test keep tests from
        // depending on call order -- otherwise a session authenticated in an
        // earlier test would skip the AuthenticateByName call other tests
        // expect to see mocked.
        jellyfinRepository.sessions.clear();
        global.fetch = buildJellyfinFetchMock();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('GET /libraries returns the top-level libraries', async () => {
        const res = await request(app).get('/api/v2/jellyfin/libraries');

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({ id: 'lib1', name: 'Library One', isFolder: true });
    });

    it('GET /items/:id/children returns one folder level of children', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/lib1/children');

        expect(res.status).toBe(200);
        expect(res.body.items[0]).toMatchObject({ id: 'child1', name: 'Dive01' });
    });

    it('GET /items/:id/children returns 404 for an unknown parent', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/notfound-id/children');

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('GET /items/search returns matching items', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/search').query({ q: 'test' });

        expect(res.status).toBe(200);
        expect(res.body.items[0]).toMatchObject({ id: 'video1', name: 'test_video' });
    });

    it('GET /items/search without q returns 400', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/search');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET /items/:id/playback-options returns Original and Transcode tiers', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/video1/playback-options');

        expect(res.status).toBe(200);
        expect(res.body.options.some((option) => option.mode === 'Original')).toBe(true);
        expect(res.body.options.some((option) => option.mode === 'Transcode')).toBe(true);
    });

    it('GET /items/:id/stream (default Original mode) redirects and returns session headers', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/video1/stream');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('/Videos/video1/stream');
        expect(res.headers['x-jellyfin-play-method']).toBe('DirectStream');
        expect(res.headers['x-jellyfin-play-session-id']).toBe('direct-session');
    });

    it('GET /items/:id/stream?mode=Transcode redirects to the negotiated transcodingUrl', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/video1/stream').query({ mode: 'Transcode' });

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('master.m3u8');
        expect(res.headers['x-jellyfin-play-method']).toBe('Transcode');
        expect(res.headers['x-jellyfin-play-session-id']).toBe('transcode-session');
    });

    it('GET /resolve finds a fuzzy match above the default threshold', async () => {
        const res = await request(app).get('/api/v2/jellyfin/resolve').query({ videoSource: 'test_video.mp4' });

        expect(res.status).toBe(200);
        expect(res.body.item.id).toBe('video1');
        expect(res.body.score).toBeGreaterThanOrEqual(60);
    });

    it('GET /resolve returns 404 when nothing matches', async () => {
        const res = await request(app).get('/api/v2/jellyfin/resolve').query({ videoSource: 'nomatch_xyz_987654' });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('POST /items/:id/playback/started relays the report and returns 204', async () => {
        const res = await request(app)
            .post('/api/v2/jellyfin/items/video1/playback/started')
            .send({ mediaSourceId: 'video1', playSessionId: 'direct-session', positionTicks: 0, isPaused: false, playMethod: 'DirectStream' });

        expect(res.status).toBe(204);
    });

    it('POST /items/:id/playback/progress relays the report and returns 204', async () => {
        const res = await request(app)
            .post('/api/v2/jellyfin/items/video1/playback/progress')
            .send({ mediaSourceId: 'video1', playSessionId: 'direct-session', positionTicks: 5_000_0000, isPaused: false, playMethod: 'DirectStream' });

        expect(res.status).toBe(204);
    });

    it('POST /items/:id/playback/stopped relays the report and returns 204', async () => {
        const res = await request(app)
            .post('/api/v2/jellyfin/items/video1/playback/stopped')
            .send({ mediaSourceId: 'video1', playSessionId: 'direct-session', positionTicks: 10_000_0000, playMethod: 'DirectStream' });

        expect(res.status).toBe(204);
    });

    it('GET /items/:id/images/:imageType redirects to a direct Jellyfin image URL', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/video1/images/Primary');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('/Items/video1/Images/Primary');
    });

    it('GET /items/:id/trickplay returns parsed tile metadata', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/video1/trickplay').query({ width: 320 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ columns: 10, rows: 10, thumbnailDurationSeconds: 10 });
        expect(res.body.tileImageUrls).toHaveLength(1);
    });

    it('GET /items/:id/trickplay without width returns 400', async () => {
        const res = await request(app).get('/api/v2/jellyfin/items/video1/trickplay');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('uses a distinct Jellyfin session per downstream client identity', async () => {
        await request(app).get('/api/v2/jellyfin/libraries').set('X-Client-Name', 'TestClientA');
        await request(app).get('/api/v2/jellyfin/libraries').set('X-Client-Name', 'TestClientB');
        await request(app).get('/api/v2/jellyfin/libraries');

        expect(jellyfinRepository.sessions.has('testclienta')).toBe(true);
        expect(jellyfinRepository.sessions.has('testclientb')).toBe(true);
        expect(jellyfinRepository.sessions.has('unknown')).toBe(true);
    });
});
