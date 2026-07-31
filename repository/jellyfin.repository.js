/**
 * Repository-layer HTTP client for the Jellyfin media server.
 *
 * There is no Sequelize model backing this domain -- Jellyfin is an
 * external service, not our own database -- so this file plays the role
 * a repository normally plays (the only layer that knows how to fetch the
 * underlying data) but does it over HTTP instead of SQL. It started as a
 * direct Node port of docs/old_scripts_for_reference/jellyfin_client.py
 * (auth, browsing, search, direct-play streaming), then absorbed the more
 * complete playback behavior from jellyfin_client.cs -- a production WPF
 * desktop client for the same Jellyfin server -- which additionally covers
 * capability-probed quality menus, real transcode negotiation, playback
 * -session reporting, a fuzzy video-name resolver, image URLs, and
 * trickplay scrubbing tiles. Both are ported as HTTP/data behavior only;
 * neither source file's UI/window code is relevant here. Uses the
 * platform `fetch` global rather than Python's httpx or C#'s HttpClient.
 *
 * Session handling: ONE Jellyfin login/session per distinct downstream
 * client identity, not one shared session for the whole process. This was
 * confirmed necessary against the live server, not assumed: sending a
 * different Device/Client/Version header on an individual request while
 * reusing an existing token has no effect on what Jellyfin's own
 * session/dashboard view reports -- Jellyfin binds device identity to the
 * token at the moment it is issued (login), not to headers sent on later
 * calls. So a caller-supplied client identity (see `clientIdentity`
 * parameters throughout) must map to its own login, or Jellyfin has no way
 * to distinguish real downstream clients from each other; every session
 * otherwise appears as one undifferentiated "MARP API" device. Sessions
 * are cached in `this.sessions` (a Map keyed by `_buildClientKey()`) for
 * the lifetime of the process -- same cache-forever model as before, just
 * multiplied per identity instead of global. A cached token that Jellyfin
 * has expired surfaces as an HTTP 401 for that specific session, handled
 * by re-authenticating that one session and retrying -- see
 * `_authenticatedRequest`.
 *
 * Error contract: every failure path here throws `ApiError` with a specific
 * status/code (404/RESOURCE_NOT_FOUND for a missing item, 502/UPSTREAM_ERROR
 * for a Jellyfin/network failure) rather than swallowing to `null`/`[]`.
 * This is a deliberate choice, not an accident -- this codebase already has
 * several existing repositories that swallow errors inconsistently (some to
 * `[]`, some to `null`, some to `{}`), and that inconsistency was flagged as
 * a standing cleanup item. New code should not add another shape to that
 * list.
 *
 * @fileoverview Jellyfin HTTP client used by the jellyfin service/controller.
 * @author Isaac Travers
 * @module repository/jellyfin
 */

const logger = require('../logger/api.logger');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');

/**
 * Repository for Jellyfin HTTP operations.
 *
 * @class JellyfinRepository
 */
class JellyfinRepository {

    constructor() {
        // Base URL, username, and password come from the environment only --
        // MARP always authenticates to Jellyfin as the same service account
        // ("who"), but as a distinct device session per downstream client
        // identity ("what is asking on whose behalf right now"), so Jellyfin
        // can tell real callers apart in its own session/dashboard view.
        this.baseUrl = this._normalizeBaseUrl(process.env.JELLYFIN_BASE_URL || '');
        this.username = process.env.JELLYFIN_USERNAME || '';
        this.password = process.env.JELLYFIN_PASSWORD || '';

        // One session ({ clientKey, clientIdentity, accessToken, userId })
        // per distinct downstream client identity, keyed by _buildClientKey().
        this.sessions = new Map();
    }

    /**
     * Strips trailing slashes from a configured Jellyfin base URL so
     * endpoint paths can be appended predictably.
     *
     * @param {string} baseUrl - Raw base URL from configuration.
     * @returns {string} Base URL with no trailing slash.
     */
    _normalizeBaseUrl(baseUrl) {
        return baseUrl.trim().replace(/\/+$/, '');
    }

    /**
     * Builds a stable, DeviceId-safe key for a downstream client identity.
     * Callers with no recognizable name collapse onto a single shared
     * 'unknown' session -- deliberately not a distinct session per
     * anonymous caller, since there would be nothing to distinguish it by.
     *
     * @param {Object} [clientIdentity] - Downstream client identity.
     * @param {string} [clientIdentity.name] - Client name, e.g. from an X-Client-Name header.
     * @param {string} [clientIdentity.version] - Client version, e.g. from an X-Client-Version header.
     * @returns {string} Sanitized key, safe to embed in a Jellyfin DeviceId.
     */
    _buildClientKey(clientIdentity) {
        const name = clientIdentity && clientIdentity.name ? String(clientIdentity.name).trim() : '';

        if (!name) {
            return 'unknown';
        }

        const version = clientIdentity && clientIdentity.version ? String(clientIdentity.version).trim() : '';
        const sanitize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        return version ? `${sanitize(name)}-${sanitize(version)}` : sanitize(name);
    }

    /**
     * Gets the cached session for a client identity, creating a blank
     * (not-yet-authenticated) one on first use.
     *
     * @param {Object} [clientIdentity] - Downstream client identity (see {@link JellyfinRepository#_buildClientKey}).
     * @returns {Object} Session object `{ clientKey, clientIdentity, accessToken, userId }`.
     */
    _getOrCreateSession(clientIdentity) {
        const clientKey = this._buildClientKey(clientIdentity);
        let session = this.sessions.get(clientKey);

        if (!session) {
            session = { clientKey, clientIdentity: clientIdentity || {}, accessToken: '', userId: '' };
            this.sessions.set(clientKey, session);
        }

        return session;
    }

    /**
     * Reports whether a session currently holds usable Jellyfin credentials.
     *
     * @param {Object} session - Session object.
     * @returns {boolean} True when base URL, access token, and user id are all present.
     */
    _isSessionAuthenticated(session) {
        return Boolean(this.baseUrl && session.accessToken && session.userId);
    }

    /**
     * Escapes a value placed inside a quoted MediaBrowser header field.
     * Client identity now comes from caller-supplied request headers, not
     * only hardcoded strings, so this prevents a crafted name/version from
     * breaking out of its quoted field.
     *
     * @param {string} value - Header field value.
     * @returns {string} Safely escaped value.
     */
    _escapeHeaderValue(value) {
        return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * Builds the `MediaBrowser` authorization header Jellyfin expects on
     * the login request, concatenating MARP's own identity with the real
     * downstream client's (e.g. `Client="MARP API/WebFrontend"`) so
     * Jellyfin's session/dashboard view can tell which actual client is
     * streaming through MARP, rather than seeing every request as one
     * undifferentiated "MARP API" session. Falls back to a plain "MARP
     * API" identity when no client identity is supplied.
     *
     * @param {Object} [clientIdentity] - Downstream client identity.
     * @returns {string} Header value.
     */
    _buildMediaBrowserAuthorizationHeader(clientIdentity) {
        const name = clientIdentity && clientIdentity.name ? String(clientIdentity.name).trim() : '';
        const version = clientIdentity && clientIdentity.version ? String(clientIdentity.version).trim() : '1.0.0';

        const clientName = name ? `MARP API/${name}` : 'MARP API';
        const deviceName = name || (process.env.HOSTNAME || 'marp-api');
        const deviceId = `marp-api-${this._buildClientKey(clientIdentity)}`;

        return (
            'MediaBrowser ' +
            `Client="${this._escapeHeaderValue(clientName)}", ` +
            `Device="${this._escapeHeaderValue(deviceName)}", ` +
            `DeviceId="${this._escapeHeaderValue(deviceId)}", ` +
            `Version="${this._escapeHeaderValue(version)}"`
        );
    }

    /**
     * Authenticates to Jellyfin with the configured service-account
     * username/password, using the session's client identity to build the
     * login header, and caches the resulting access token and user id on
     * that session object.
     *
     * @async
     * @param {Object} session - Session object to authenticate (mutated in place).
     * @returns {Promise<void>}
     * @throws {ApiError} 500/INTERNAL_ERROR if JELLYFIN_* env vars are missing;
     * 502/UPSTREAM_ERROR if Jellyfin is unreachable or rejects the login.
     */
    async authenticate(session) {
        if (!this.baseUrl) {
            throw new ApiError(500, ERROR_CODES.INTERNAL_ERROR, 'JELLYFIN_BASE_URL is not configured.');
        }

        if (!this.username || !this.password) {
            throw new ApiError(500, ERROR_CODES.INTERNAL_ERROR, 'Jellyfin credentials are not configured.');
        }

        let response;
        try {
            response = await fetch(`${this.baseUrl}/Users/AuthenticateByName`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: this._buildMediaBrowserAuthorizationHeader(session.clientIdentity),
                },
                body: JSON.stringify({ Username: this.username, Pw: this.password }),
            });
        } catch (err) {
            logger.error('Error in jellyfin authenticate (network)::' + err);
            throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, 'Could not reach the Jellyfin server.');
        }

        if (!response.ok) {
            logger.error(`Error in jellyfin authenticate: HTTP ${response.status}`);
            throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, 'Jellyfin authentication failed.');
        }

        const data = await response.json();

        session.accessToken = String(data.AccessToken || '');
        session.userId = String((data.User || {}).Id || '');

        if (!session.accessToken || !session.userId) {
            throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, 'Jellyfin did not return a usable access token.');
        }
    }

    /**
     * Gets (creating and authenticating if needed) the session for a
     * client identity. Called at the top of every authenticated method so
     * callers never have to manage login state themselves.
     *
     * @async
     * @param {Object} [clientIdentity] - Downstream client identity.
     * @returns {Promise<Object>} Authenticated session object.
     */
    async _ensureAuthenticated(clientIdentity) {
        const session = this._getOrCreateSession(clientIdentity);

        if (!this._isSessionAuthenticated(session)) {
            await this.authenticate(session);
        }

        return session;
    }

    /**
     * Sends one authenticated Jellyfin request on a given session, retrying
     * exactly once after a fresh login if the session's cached token has
     * expired (surfaced as an HTTP 401).
     *
     * @async
     * @param {Object} session - Authenticated session to use.
     * @param {string} method - HTTP method, e.g. 'GET' or 'POST'.
     * @param {string} url - Full request URL, already built by the caller.
     * @param {Object} [body] - JSON-serializable request body for POST requests.
     * @param {Object} [options] - Per-call request options.
     * @param {Array<number>} [options.notFoundStatuses=[404]] - HTTP statuses
     * that should be treated as "item not found" for this call. Confirmed
     * against the live server that `POST /Items/{id}/PlaybackInfo` reports
     * an unknown item id as HTTP 400, not 404 -- callers of that endpoint
     * pass `[400, 404]` here rather than relying on the general-purpose default.
     * @returns {Promise<Object|null>} Parsed JSON body, or null for a 204 response.
     * @throws {ApiError} 404/RESOURCE_NOT_FOUND when Jellyfin reports no such
     * item; 502/UPSTREAM_ERROR for any other network or non-2xx failure.
     */
    async _authenticatedRequest(session, method, url, body, options = {}) {
        const notFoundStatuses = options.notFoundStatuses || [404];
        const send = async () => {
            try {
                return await fetch(url, {
                    method,
                    headers: {
                        'X-Emby-Token': session.accessToken,
                        ...(body ? { 'Content-Type': 'application/json' } : {}),
                    },
                    body: body ? JSON.stringify(body) : undefined,
                });
            } catch (err) {
                logger.error(`Error in jellyfin ${method} ${url} (network)::` + err);
                throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, 'Could not reach the Jellyfin server.');
            }
        };

        let response = await send();

        // A 401 here means this session's cached token has expired
        // server-side (Jellyfin sessions are not indefinite) rather than
        // that the request itself is malformed -- re-authenticate this one
        // session and retry before giving up.
        if (response.status === 401) {
            session.accessToken = '';
            session.userId = '';
            await this.authenticate(session);
            response = await send();
        }

        if (notFoundStatuses.includes(response.status)) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, 'The requested Jellyfin item was not found.');
        }

        if (!response.ok) {
            logger.error(`Error in jellyfin ${method} ${url}: HTTP ${response.status}`);
            throw new ApiError(
                502,
                ERROR_CODES.UPSTREAM_ERROR,
                `Jellyfin request failed with status ${response.status}.`
            );
        }

        return response.status === 204 ? null : await response.json();
    }

    /**
     * Loads the top-level libraries visible to the authenticated user.
     *
     * @async
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items (see {@link JellyfinRepository#_parseItem}).
     */
    async getLibraries(clientIdentity = {}) {
        const session = await this._ensureAuthenticated(clientIdentity);

        const url = `${this.baseUrl}/Users/${encodeURIComponent(session.userId)}/Views?Fields=Path`;
        const data = await this._authenticatedRequest(session, 'GET', url);

        return this._parseItemsResponse(data);
    }

    /**
     * Loads one folder level of child items under a Jellyfin parent item.
     * Non-recursive by design -- callers browse one level at a time.
     *
     * @async
     * @param {string} parentItemId - Jellyfin id of the parent folder/library.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items (see {@link JellyfinRepository#_parseItem}).
     * @throws {ApiError} 400/VALIDATION_ERROR when parentItemId is missing.
     */
    async getChildItems(parentItemId, clientIdentity = {}) {
        if (!parentItemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin parent item id is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const fields = 'Path,MediaSources,RunTimeTicks,ChildCount';
        const url =
            `${this.baseUrl}/Users/${encodeURIComponent(session.userId)}/Items` +
            `?ParentId=${encodeURIComponent(parentItemId)}` +
            `&Recursive=false` +
            `&Fields=${encodeURIComponent(fields)}`;

        const data = await this._authenticatedRequest(session, 'GET', url);

        return this._parseItemsResponse(data);
    }

    /**
     * Searches Jellyfin video items by text, recursively across the whole
     * library. This is the resolve-by-name path a database `video_source`
     * value gets matched against.
     *
     * @async
     * @param {string} query - Filename or title search term.
     * @param {number} [limit=20] - Maximum number of matches to return.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items (see {@link JellyfinRepository#_parseItem}).
     * @throws {ApiError} 400/VALIDATION_ERROR when query is missing.
     */
    async searchVideoItems(query, limit = 20, clientIdentity = {}) {
        if (!query) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin search query is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const fields = 'Path,MediaSources,RunTimeTicks';
        const url =
            `${this.baseUrl}/Users/${encodeURIComponent(session.userId)}/Items` +
            `?Recursive=true` +
            `&IncludeItemTypes=Video` +
            `&SearchTerm=${encodeURIComponent(query)}` +
            `&Limit=${encodeURIComponent(limit)}` +
            `&Fields=${encodeURIComponent(fields)}`;

        const data = await this._authenticatedRequest(session, 'GET', url);

        return this._parseItemsResponse(data);
    }

    /**
     * Negotiates playback for one item via Jellyfin's PlaybackInfo endpoint.
     * This both validates that the item exists/is playable and returns the
     * media source capability flags a caller would need to decide between
     * direct play and transcoding.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to negotiate playback for.
     * @param {Object} [options] - Playback negotiation options.
     * @param {number} [options.maxStreamingBitrate=8000000] - Bitrate ceiling reported to Jellyfin.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} Parsed playback info (see {@link JellyfinRepository#_parsePlaybackInfo}).
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing; 404/RESOURCE_NOT_FOUND when the item does not exist.
     */
    async getPlaybackInfo(itemId, options = {}, clientIdentity = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const maxStreamingBitrate = options.maxStreamingBitrate || 8_000_000;
        const url = `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${encodeURIComponent(session.userId)}`;
        const body = {
            UserId: session.userId,
            MaxStreamingBitrate: maxStreamingBitrate,
            EnableDirectPlay: true,
            EnableDirectStream: true,
            EnableTranscoding: true,
        };

        // PlaybackInfo reports an unknown item id as HTTP 400, not 404 --
        // confirmed against the live server -- so 400 is treated as
        // not-found here specifically, rather than in the general default.
        const data = await this._authenticatedRequest(session, 'POST', url, body, { notFoundStatuses: [400, 404] });

        return this._parsePlaybackInfo(data);
    }

    /**
     * Builds the quality menu for one item: capability-probes it via
     * {@link JellyfinRepository#getPlaybackInfo}, then derives Auto/
     * Original/transcode-tier options from the source's actual bitrate and
     * resolution -- ports `BuildPlaybackOptions`/`AddTranscodeOptionIfUseful`
     * from jellyfin_client.cs. A tier is only offered if it is genuinely
     * below the source quality; there is no point offering "1080p" for a
     * source that is already 720p.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to build a quality menu for.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Array<Object>>} Playback options, each `{ displayName, mode, maxStreamingBitrate, maxWidth, maxHeight, isAuto, isOriginal, requiresTranscoding }`.
     */
    async getPlaybackOptions(itemId, clientIdentity = {}) {
        const playbackInfo = await this.getPlaybackInfo(itemId, {}, clientIdentity);

        return this._buildPlaybackOptions(playbackInfo);
    }

    /**
     * Pure derivation of quality options from a parsed PlaybackInfo result.
     *
     * @param {Object} playbackInfo - Parsed playback info (see {@link JellyfinRepository#_parsePlaybackInfo}).
     * @returns {Array<Object>} Playback options.
     */
    _buildPlaybackOptions(playbackInfo) {
        const options = [];
        const mediaSource = playbackInfo && playbackInfo.mediaSources && playbackInfo.mediaSources[0];

        if (!mediaSource) {
            return options;
        }

        const sourceBitrate = mediaSource.bitrate || 0;
        const sourceHeight = mediaSource.height || 0;

        // Auto is a placeholder for a future adaptive-quality decision, not a
        // concrete stream target -- same simplification jellyfin_client.cs
        // itself ships today ("For now, do not route Auto through the old
        // manual transcode URL builder").
        if (mediaSource.supportsTranscoding || mediaSource.supportsDirectStream) {
            options.push({
                displayName: 'Auto',
                mode: 'Auto',
                maxStreamingBitrate: null,
                maxWidth: null,
                maxHeight: null,
                isAuto: true,
                isOriginal: false,
                requiresTranscoding: false,
            });
        }

        if (mediaSource.supportsDirectPlay || mediaSource.supportsDirectStream) {
            const bitrateSuffix = sourceBitrate > 0 ? ` (${(sourceBitrate / 1_000_000).toFixed(2)} Mbps)` : '';

            options.push({
                displayName: `Original / Direct${bitrateSuffix}`,
                mode: 'Original',
                maxStreamingBitrate: null,
                maxWidth: mediaSource.width || null,
                maxHeight: mediaSource.height || null,
                isAuto: false,
                isOriginal: true,
                requiresTranscoding: false,
            });
        }

        if (mediaSource.supportsTranscoding) {
            this._addTranscodeOptionIfUseful(options, '1080p, 8 Mbps', 8_000_000, 1920, 1080, sourceBitrate, sourceHeight);
            this._addTranscodeOptionIfUseful(options, '720p, 4 Mbps', 4_000_000, 1280, 720, sourceBitrate, sourceHeight);
            this._addTranscodeOptionIfUseful(options, '480p, 1 Mbps', 1_000_000, 854, 480, sourceBitrate, sourceHeight);
        }

        return options;
    }

    /**
     * Adds one transcode-tier option only if it is actually lower quality
     * than the source -- prevents offering e.g. "1080p" for a 720p source.
     *
     * @param {Array<Object>} options - Destination options array, mutated in place.
     * @param {string} displayName - Human-readable option label.
     * @param {number} maxStreamingBitrate - Bitrate ceiling for this tier.
     * @param {number} maxWidth - Width ceiling for this tier.
     * @param {number} maxHeight - Height ceiling for this tier.
     * @param {number} sourceBitrate - Source media bitrate (0 if unknown).
     * @param {number} sourceHeight - Source media height (0 if unknown).
     * @returns {void}
     */
    _addTranscodeOptionIfUseful(options, displayName, maxStreamingBitrate, maxWidth, maxHeight, sourceBitrate, sourceHeight) {
        const bitrateIsUseful = sourceBitrate <= 0 || maxStreamingBitrate < sourceBitrate;
        const heightIsUseful = sourceHeight <= 0 || maxHeight <= sourceHeight;

        if (!bitrateIsUseful || !heightIsUseful) {
            return;
        }

        options.push({
            displayName,
            mode: 'Transcode',
            maxStreamingBitrate,
            maxWidth,
            maxHeight,
            isAuto: false,
            isOriginal: false,
            requiresTranscoding: true,
        });
    }

    /**
     * Negotiates a constrained transcode target via Jellyfin's PlaybackInfo
     * endpoint, using a DeviceProfile so Jellyfin picks and returns a real
     * session-associated `transcodingUrl` -- ports `GetTranscodePlaybackInfoAsync`
     * from jellyfin_client.cs. This is the "proper" negotiated path; it
     * deliberately does not manually assemble a `/Videos/{id}/stream?...`
     * query string the way the older `BuildTranscodeStreamUrl` did (that
     * method is explicitly marked deprecated in jellyfin_client.cs in favor
     * of this PlaybackInfo + DeviceProfile flow).
     *
     * @async
     * @param {string} itemId - Jellyfin item id to negotiate a transcode for.
     * @param {Object} [option] - Playback option selected from {@link JellyfinRepository#getPlaybackOptions}.
     * @param {number} [option.maxStreamingBitrate=4000000] - Bitrate ceiling.
     * @param {number} [option.maxWidth=1280] - Width ceiling.
     * @param {number} [option.maxHeight=720] - Height ceiling.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} Parsed playback info, with `mediaSources[].transcodingUrl` populated.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing; 404/RESOURCE_NOT_FOUND when the item does not exist.
     */
    async getTranscodePlaybackInfo(itemId, option = {}, clientIdentity = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const maxStreamingBitrate = option.maxStreamingBitrate || 4_000_000;
        const maxWidth = option.maxWidth || 1280;
        const maxHeight = option.maxHeight || 720;

        const url = `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${encodeURIComponent(session.userId)}`;
        const body = {
            UserId: session.userId,
            // This request intentionally asks Jellyfin for a transcode-only
            // result -- direct/original playback stays on getPlaybackInfo +
            // buildDirectStreamUrl.
            EnableDirectPlay: false,
            EnableDirectStream: false,
            EnableTranscoding: true,
            MaxStreamingBitrate: maxStreamingBitrate,
            MaxWidth: maxWidth,
            MaxHeight: maxHeight,
            AllowVideoStreamCopy: false,
            AllowAudioStreamCopy: true,
            DeviceProfile: {
                Name: 'MARP API',
                MaxStreamingBitrate: maxStreamingBitrate,
                TranscodingProfiles: [
                    {
                        Container: 'ts',
                        Type: 'Video',
                        VideoCodec: 'h264',
                        AudioCodec: 'aac',
                        Protocol: 'hls',
                    },
                ],
            },
        };

        const data = await this._authenticatedRequest(session, 'POST', url, body, { notFoundStatuses: [400, 404] });

        return this._parsePlaybackInfo(data);
    }

    /**
     * Resolves a possibly-relative Jellyfin URL (PlaybackInfo can return
     * `transcodingUrl`/`directStreamUrl` as server-root-relative paths) to
     * an absolute URL -- ports `BuildAbsoluteJellyfinUrl`.
     *
     * @param {string} jellyfinUrl - Absolute or relative Jellyfin URL.
     * @returns {string} Absolute URL, or '' if the input was blank.
     */
    buildAbsoluteUrl(jellyfinUrl) {
        if (!jellyfinUrl) {
            return '';
        }

        if (/^https?:\/\//i.test(jellyfinUrl)) {
            return jellyfinUrl;
        }

        return jellyfinUrl.startsWith('/') ? `${this.baseUrl}${jellyfinUrl}` : `${this.baseUrl}/${jellyfinUrl}`;
    }

    /**
     * Builds the direct (non-transcoded) Jellyfin stream URL for an item,
     * with the session's access token embedded as the `api_key` query
     * parameter -- required because this URL is handed to things that
     * cannot set a custom header (e.g. a video element's `src`, or the
     * redirect target this repository's caller returns to API clients).
     *
     * @async
     * @param {string} itemId - Jellyfin item id to build a stream URL for.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<string>} Absolute Jellyfin stream URL.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing.
     */
    async buildDirectStreamUrl(itemId, clientIdentity = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        return `${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/stream?static=true&api_key=${encodeURIComponent(session.accessToken)}`;
    }

    /**
     * Relays a playback report to one of Jellyfin's `/Sessions/Playing*`
     * endpoints -- ports `BuildPlaybackReportBody` + the three
     * `Report*Async` methods from jellyfin_client.cs. MARP holds no
     * server-side *playback* session state (see the module-level note on
     * statelessness), so every playback-position field the report needs
     * comes from the caller rather than from anything cached here -- the
     * `clientIdentity`-keyed Jellyfin login session is a separate concern
     * from playback position tracking.
     *
     * @async
     * @param {string} path - Jellyfin session endpoint suffix, e.g. '/Sessions/Playing'.
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} report - Report fields.
     * @param {string} [report.mediaSourceId] - MediaSource id from the earlier PlaybackInfo/stream response.
     * @param {string} [report.playSessionId] - PlaySessionId from the earlier PlaybackInfo/stream response.
     * @param {number} [report.positionTicks=0] - Current playback position, in Jellyfin ticks (100ns units).
     * @param {boolean} [report.isPaused=false] - Whether playback is currently paused.
     * @param {string} [report.playMethod='DirectStream'] - 'DirectStream' or 'Transcode'.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing.
     */
    async _reportPlayback(path, itemId, report = {}, clientIdentity = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const positionTicks = report.positionTicks && report.positionTicks > 0 ? report.positionTicks : 0;

        const body = {
            ItemId: itemId,
            MediaSourceId: report.mediaSourceId || '',
            PlaySessionId: report.playSessionId || '',
            PositionTicks: positionTicks,
            IsPaused: Boolean(report.isPaused),
            IsMuted: false,
            PlayMethod: report.playMethod || 'DirectStream',
            RepeatMode: 'RepeatNone',
            PlaybackRate: 1.0,
        };

        await this._authenticatedRequest(session, 'POST', `${this.baseUrl}${path}`, body);
    }

    /**
     * Reports that playback has started or resumed for an item.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} [report] - Report fields (see {@link JellyfinRepository#_reportPlayback}).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackStarted(itemId, report, clientIdentity) {
        await this._reportPlayback('/Sessions/Playing', itemId, report, clientIdentity);
    }

    /**
     * Reports current playback position/pause state for an item. Should be
     * called periodically during playback so Jellyfin's transcode-session
     * lifecycle and resume position stay accurate.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} [report] - Report fields (see {@link JellyfinRepository#_reportPlayback}).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackProgress(itemId, report, clientIdentity) {
        await this._reportPlayback('/Sessions/Playing/Progress', itemId, report, clientIdentity);
    }

    /**
     * Reports final playback position before the item/session changes or
     * closes, so Jellyfin can clean up any active transcode session.
     *
     * @async
     * @param {string} itemId - Jellyfin item id that was being played.
     * @param {Object} [report] - Report fields (see {@link JellyfinRepository#_reportPlayback}).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<void>}
     */
    async reportPlaybackStopped(itemId, report, clientIdentity) {
        await this._reportPlayback('/Sessions/Playing/Stopped', itemId, { ...report, isPaused: true }, clientIdentity);
    }

    /**
     * Builds a Jellyfin item image URL (poster/thumbnail/etc.) with the
     * session's token -- ports `BuildItemImageUrl` from jellyfin_client.cs.
     * Pure URL construction beyond ensuring authentication, no data request
     * is sent.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to build an image URL for.
     * @param {string} imageType - Jellyfin image type, e.g. 'Primary', 'Thumb', 'Backdrop'.
     * @param {number} [maxWidth=320] - Maximum image width Jellyfin should return.
     * @param {number} [quality=85] - JPEG quality (1-100).
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<string>} Absolute Jellyfin image URL.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId or imageType is missing.
     */
    async buildImageUrl(itemId, imageType, maxWidth = 320, quality = 85, clientIdentity = {}) {
        if (!itemId || !imageType) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id and image type are required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const safeMaxWidth = maxWidth > 0 ? maxWidth : 320;
        const safeQuality = quality > 0 && quality <= 100 ? quality : 85;

        return (
            `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}` +
            `?maxWidth=${safeMaxWidth}&quality=${safeQuality}&api_key=${encodeURIComponent(session.accessToken)}`
        );
    }

    /**
     * Sends an authenticated Jellyfin GET request and returns the raw text
     * body, for non-JSON endpoints such as the trickplay `.m3u8`-shaped
     * tile playlist -- ports `GetJellyfinTextAsync`.
     *
     * @async
     * @param {Object} session - Authenticated session to use.
     * @param {string} url - Full request URL.
     * @returns {Promise<string>} Raw response text.
     * @throws {ApiError} 404/RESOURCE_NOT_FOUND or 502/UPSTREAM_ERROR on failure.
     */
    async _authenticatedTextRequest(session, url) {
        const send = async () => {
            try {
                return await fetch(url, { headers: { 'X-Emby-Token': session.accessToken } });
            } catch (err) {
                logger.error(`Error in jellyfin GET ${url} (network)::` + err);
                throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, 'Could not reach the Jellyfin server.');
            }
        };

        let response = await send();

        if (response.status === 401) {
            session.accessToken = '';
            session.userId = '';
            await this.authenticate(session);
            response = await send();
        }

        if (response.status === 404) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, 'The requested Jellyfin resource was not found.');
        }

        if (!response.ok) {
            logger.error(`Error in jellyfin GET ${url}: HTTP ${response.status}`);
            throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, `Jellyfin request failed with status ${response.status}.`);
        }

        return await response.text();
    }

    /**
     * Checks whether an authenticated Jellyfin URL exists, preferring HEAD
     * (only existence is needed, not bytes) and falling back to GET if the
     * server rejects HEAD for this endpoint -- ports `JellyfinUrlExistsAsync`.
     *
     * Deliberately swallows failures to `false` rather than throwing: this
     * is the one legitimate exception to this file's no-swallow rule,
     * because it's used only to probe for an *optional* extra trickplay
     * tile that may or may not exist -- "can't tell if it exists" and
     * "confirmed absent" should both just mean "don't add it," not fail
     * the whole trickplay request.
     *
     * @async
     * @param {Object} session - Authenticated session to use.
     * @param {string} url - URL to probe.
     * @returns {Promise<boolean>} True if the URL responds successfully.
     */
    async _urlExists(session, url) {
        try {
            const headResponse = await fetch(url, { method: 'HEAD', headers: { 'X-Emby-Token': session.accessToken } });
            if (headResponse.ok) {
                return true;
            }
            if (headResponse.status !== 405 && headResponse.status !== 501) {
                return false;
            }
        } catch (err) {
            return false;
        }

        try {
            const getResponse = await fetch(url, { headers: { 'X-Emby-Token': session.accessToken } });
            return getResponse.ok;
        } catch (err) {
            return false;
        }
    }

    /**
     * Loads and parses Jellyfin's trickplay scrubbing-preview tile
     * playlist for one item -- ports `GetTrickplayInfoAsync`. Each tile
     * image URL Jellyfin lists already embeds its own access token (the
     * same signed-URL pattern already used for `stream`/image URLs), so
     * the returned tile URLs are directly fetchable by a caller without
     * MARP proxying the image bytes.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to load trickplay tiles for.
     * @param {number} width - Requested tile-sheet width (must match a width Jellyfin actually generated).
     * @param {Object} [options] - Additional options.
     * @param {string} [options.mediaSourceId] - Specific media source, if the item has more than one.
     * @param {number} [options.runTimeTicks] - Item runtime in Jellyfin ticks; when supplied, probes for extra tile sheets beyond what the playlist lists.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} `{ thumbnailWidth, thumbnailHeight, columns, rows, thumbnailDurationSeconds, tileImageUrls }`.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId/width are missing or invalid; 404/RESOURCE_NOT_FOUND when Jellyfin has no trickplay data for this item/width.
     */
    async getTrickplayInfo(itemId, width, options = {}, clientIdentity = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        if (!width || width <= 0) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A positive trickplay width is required.');
        }

        const session = await this._ensureAuthenticated(clientIdentity);

        const playlistUrl = this._buildTrickplayPlaylistUrl(itemId, width, options.mediaSourceId);
        const playlistText = await this._authenticatedTextRequest(session, playlistUrl);

        const trickplayInfo = this._parseTrickplayPlaylist(playlistUrl, playlistText);

        if (options.runTimeTicks) {
            await this._expandTrickplayTileUrlsFromRuntime(trickplayInfo, options.runTimeTicks, session);
        }

        return trickplayInfo;
    }

    /**
     * Builds the trickplay tile playlist URL for one item.
     *
     * @param {string} itemId - Jellyfin item id.
     * @param {number} width - Requested tile-sheet width.
     * @param {string} [mediaSourceId] - Specific media source id, if any.
     * @returns {string} Trickplay playlist URL.
     */
    _buildTrickplayPlaylistUrl(itemId, width, mediaSourceId) {
        const endpointItemId = this._formatItemIdForVideoEndpoint(itemId);
        let url = `${this.baseUrl}/Videos/${encodeURIComponent(endpointItemId)}/Trickplay/${width}/tiles.m3u8`;

        if (mediaSourceId) {
            url += `?MediaSourceId=${encodeURIComponent(mediaSourceId)}`;
        }

        return url;
    }

    /**
     * Some Jellyfin video endpoints expect the item id in hyphenated GUID
     * form even though item DTOs expose the same id as 32 hex characters
     * -- ports `FormatJellyfinItemIdForVideoEndpoint`. Non-GUID-shaped ids
     * are returned unchanged.
     *
     * @param {string} itemId - Jellyfin item id, compact or hyphenated.
     * @returns {string} Hyphenated GUID form when itemId is a bare 32-hex-digit id, otherwise itemId unchanged.
     */
    _formatItemIdForVideoEndpoint(itemId) {
        const trimmed = (itemId || '').trim();

        if (trimmed.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(trimmed)) {
            return trimmed;
        }

        return `${trimmed.slice(0, 8)}-${trimmed.slice(8, 12)}-${trimmed.slice(12, 16)}-${trimmed.slice(16, 20)}-${trimmed.slice(20, 32)}`;
    }

    /**
     * Parses Jellyfin's image-only trickplay playlist -- ports
     * `ParseTrickplayPlaylist`. Expected tile metadata example:
     * `#EXT-X-TILES:RESOLUTION=320x180,LAYOUT=10x10,DURATION=10`. Expected
     * tile image line example: `0.jpg?MediaSourceId=...&ApiKey=...`.
     *
     * @param {string} playlistUrl - URL the playlist was fetched from (tile lines are relative to this).
     * @param {string} playlistText - Raw playlist body.
     * @returns {Object} `{ thumbnailWidth, thumbnailHeight, columns, rows, thumbnailDurationSeconds, tileImageUrls }`.
     */
    _parseTrickplayPlaylist(playlistUrl, playlistText) {
        const trickplayInfo = {
            thumbnailWidth: 0,
            thumbnailHeight: 0,
            columns: 0,
            rows: 0,
            thumbnailDurationSeconds: 0,
            tileImageUrls: [],
        };

        if (!playlistText) {
            return trickplayInfo;
        }

        const lines = playlistText.split(/\r\n|\n/);

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (!line) {
                continue;
            }

            if (line.toUpperCase().startsWith('#EXT-X-TILES:')) {
                this._parseTrickplayTileMetadata(line, trickplayInfo);
                continue;
            }

            // Non-comment playlist entries are tile sheet image references,
            // relative to the playlist URL, not the server root.
            if (!line.startsWith('#')) {
                trickplayInfo.tileImageUrls.push(this._resolveUrlRelativeTo(playlistUrl, line));
            }
        }

        return trickplayInfo;
    }

    /**
     * Reads RESOLUTION, LAYOUT, and DURATION fields from one `#EXT-X-TILES` line.
     *
     * @param {string} tilesLine - Full `#EXT-X-TILES:...` line.
     * @param {Object} trickplayInfo - Destination object, mutated in place.
     * @returns {void}
     */
    _parseTrickplayTileMetadata(tilesLine, trickplayInfo) {
        const metadata = tilesLine.substring(tilesLine.indexOf(':') + 1);
        const parts = metadata.split(',');

        for (const rawPart of parts) {
            const part = rawPart.trim();
            const equalsIndex = part.indexOf('=');

            if (equalsIndex <= 0 || equalsIndex >= part.length - 1) {
                continue;
            }

            const key = part.substring(0, equalsIndex).trim().toUpperCase();
            const value = part.substring(equalsIndex + 1).trim();

            if (key === 'RESOLUTION') {
                const [w, h] = value.split('x').map(Number);
                if (Number.isInteger(w) && Number.isInteger(h)) {
                    trickplayInfo.thumbnailWidth = w;
                    trickplayInfo.thumbnailHeight = h;
                }
            } else if (key === 'LAYOUT') {
                const [columns, rows] = value.split('x').map(Number);
                if (Number.isInteger(columns) && Number.isInteger(rows)) {
                    trickplayInfo.columns = columns;
                    trickplayInfo.rows = rows;
                }
            } else if (key === 'DURATION') {
                const duration = Number(value);
                if (!Number.isNaN(duration)) {
                    trickplayInfo.thumbnailDurationSeconds = duration;
                }
            }
        }
    }

    /**
     * Resolves one playlist line into an absolute URL, relative to the
     * playlist's own URL -- ports `BuildAbsoluteUrlRelativeToPlaylist`.
     *
     * @param {string} playlistUrl - URL the playlist was fetched from.
     * @param {string} playlistLine - Raw (possibly relative) line from the playlist.
     * @returns {string} Absolute URL, or '' if playlistLine was blank.
     */
    _resolveUrlRelativeTo(playlistUrl, playlistLine) {
        if (!playlistLine) {
            return '';
        }

        if (/^https?:\/\//i.test(playlistLine)) {
            return playlistLine;
        }

        return new URL(playlistLine, playlistUrl).toString();
    }

    /**
     * Probes for additional numbered tile sheets beyond what the playlist
     * listed, when the item's runtime implies more should exist -- ports
     * `ExpandTrickplayTileUrlsFromRuntimeAsync`. Some Jellyfin servers
     * return a playlist containing only the first tile sheet even when
     * later numbered tiles exist on disk; this fills in the gap only for
     * tiles a live probe confirms are actually present.
     *
     * @async
     * @param {Object} trickplayInfo - Parsed trickplay info, mutated in place (tileImageUrls extended).
     * @param {number} runTimeTicks - Item runtime in Jellyfin ticks.
     * @param {Object} session - Authenticated session to use for the existence probes.
     * @returns {Promise<void>}
     */
    async _expandTrickplayTileUrlsFromRuntime(trickplayInfo, runTimeTicks, session) {
        const thumbnailsPerTile = trickplayInfo.columns * trickplayInfo.rows;

        if (
            !runTimeTicks ||
            runTimeTicks <= 0 ||
            trickplayInfo.tileImageUrls.length === 0 ||
            thumbnailsPerTile <= 0 ||
            trickplayInfo.thumbnailDurationSeconds <= 0
        ) {
            return;
        }

        const runtimeSeconds = runTimeTicks / 10_000_000;
        const secondsPerTileImage = thumbnailsPerTile * trickplayInfo.thumbnailDurationSeconds;

        if (secondsPerTileImage <= 0) {
            return;
        }

        const expectedTileImageCount = Math.ceil(runtimeSeconds / secondsPerTileImage);

        if (expectedTileImageCount <= trickplayInfo.tileImageUrls.length) {
            return;
        }

        const firstTileUrl = trickplayInfo.tileImageUrls[0];

        for (let tileIndex = trickplayInfo.tileImageUrls.length; tileIndex < expectedTileImageCount; tileIndex++) {
            const candidateTileUrl = this._buildTrickplayTileUrlFromFirstTileUrl(firstTileUrl, tileIndex);

            if (!candidateTileUrl) {
                break;
            }

            const exists = await this._urlExists(session, candidateTileUrl);

            if (!exists) {
                break;
            }

            trickplayInfo.tileImageUrls.push(candidateTileUrl);
        }
    }

    /**
     * Builds a numbered tile image URL from the first tile URL Jellyfin's
     * playlist returned -- ports `BuildTrickplayTileUrlFromFirstTileUrl`.
     * Example: `.../0.jpg?MediaSourceId=...&ApiKey=...` becomes
     * `.../1.jpg?MediaSourceId=...&ApiKey=...`.
     *
     * @param {string} firstTileUrl - The playlist's first tile image URL.
     * @param {number} tileIndex - Numbered tile index to build a URL for.
     * @returns {string} Candidate tile URL, or '' if firstTileUrl isn't in the expected `N.jpg` shape.
     */
    _buildTrickplayTileUrlFromFirstTileUrl(firstTileUrl, tileIndex) {
        if (!firstTileUrl) {
            return '';
        }

        const questionIndex = firstTileUrl.indexOf('?');
        const pathPart = questionIndex >= 0 ? firstTileUrl.substring(0, questionIndex) : firstTileUrl;
        const queryPart = questionIndex >= 0 ? firstTileUrl.substring(questionIndex) : '';

        const lastSlashIndex = pathPart.lastIndexOf('/');

        if (lastSlashIndex < 0 || lastSlashIndex >= pathPart.length - 1) {
            return '';
        }

        const fileName = pathPart.substring(lastSlashIndex + 1);

        if (!fileName.toLowerCase().endsWith('.jpg')) {
            return '';
        }

        const newPathPart = `${pathPart.substring(0, lastSlashIndex + 1)}${tileIndex}.jpg`;

        return `${newPathPart}${queryPart}`;
    }

    /**
     * Resolves a saved database `video_source` value (often a full old
     * Windows path from a different computer, not a value Jellyfin stores
     * verbatim) to the single best-matching Jellyfin video item -- ports
     * `TryLoadPlaybackStateByVideoNameAsync`/`ScoreJellyfinVideoMatch` from
     * jellyfin_client.cs. Tries several search-term variants (raw value,
     * filename, filename stem, underscore/space variants, an extracted
     * MARE timestamp), scores every candidate returned across all of them,
     * and rejects a weak best match rather than silently resolving to the
     * wrong video.
     *
     * @async
     * @param {string} videoSource - Saved filename, path, or other free-text video reference.
     * @param {number} [minScore=60] - Minimum acceptable match score (0-100); below this, no match is considered reliable.
     * @param {Object} [clientIdentity] - Downstream client identity, for Jellyfin session attribution.
     * @returns {Promise<Object>} `{ item, score, searchTerm }` for the best match.
     * @throws {ApiError} 400/VALIDATION_ERROR when videoSource is missing; 404/RESOURCE_NOT_FOUND when no candidate reaches minScore.
     */
    async resolveVideoSource(videoSource, minScore = 60, clientIdentity = {}) {
        if (!videoSource || !videoSource.trim()) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A video source value is required.');
        }

        const searchTerms = this._buildVideoSearchTerms(videoSource);

        let bestItem = null;
        let bestScore = 0;
        let bestSearchTerm = '';

        for (const searchTerm of searchTerms) {
            const items = await this.searchVideoItems(searchTerm, 20, clientIdentity);

            for (const item of items) {
                const score = this._scoreVideoMatch(videoSource, item);

                if (score > bestScore) {
                    bestItem = item;
                    bestScore = score;
                    bestSearchTerm = searchTerm;
                }
            }

            // A score at/above 95 is effectively an exact filename/path
            // match; broader search-term variants are unnecessary once one
            // is found.
            if (bestScore >= 95) {
                break;
            }
        }

        if (!bestItem || bestScore < minScore) {
            throw new ApiError(
                404,
                ERROR_CODES.RESOURCE_NOT_FOUND,
                'No sufficiently confident Jellyfin match was found for this video source.'
            );
        }

        return { item: bestItem, score: bestScore, searchTerm: bestSearchTerm };
    }

    /**
     * Builds ordered, de-duplicated Jellyfin search-term variants from a
     * saved database video location -- ports `BuildVideoSearchTerms`. Most
     * specific forms are tried first.
     *
     * @param {string} videoLocation - Saved filename, local path, or database video source.
     * @returns {Array<string>} Ordered, nonblank, case-insensitively de-duplicated search terms.
     */
    _buildVideoSearchTerms(videoLocation) {
        const searchTerms = [];
        const rawValue = (videoLocation || '').trim();

        if (!rawValue) {
            return searchTerms;
        }

        const fileName = this._getFileNameFromPath(rawValue) || rawValue;
        const fileNameStem = this._getFileNameStem(fileName);
        const underscoreStem = fileNameStem.replace(/ /g, '_');
        const spaceStem = fileNameStem.replace(/_/g, ' ');

        this._addUniqueSearchTerm(searchTerms, rawValue);
        this._addUniqueSearchTerm(searchTerms, fileName);
        this._addUniqueSearchTerm(searchTerms, fileNameStem);
        this._addUniqueSearchTerm(searchTerms, underscoreStem);
        this._addUniqueSearchTerm(searchTerms, spaceStem);

        // MARE video names commonly contain a date-and-time identifier such
        // as 20240730_190910 -- useful as a broader final search term.
        const timestampMatch = fileNameStem.match(/\d{8}[_ -]\d{6}/);

        if (timestampMatch) {
            const timestampValue = timestampMatch[0];
            this._addUniqueSearchTerm(searchTerms, timestampValue.replace(/ /g, '_'));
            this._addUniqueSearchTerm(searchTerms, timestampValue.replace(/_/g, ' '));
        }

        return searchTerms;
    }

    /**
     * Adds one nonblank search term when the same term (case-insensitively)
     * has not already been added -- ports `AddUniqueVideoSearchTerm`.
     *
     * @param {Array<string>} searchTerms - Ordered destination array, mutated in place.
     * @param {string} candidate - Possible search term.
     * @returns {void}
     */
    _addUniqueSearchTerm(searchTerms, candidate) {
        if (!candidate || !candidate.trim()) {
            return;
        }

        const cleaned = candidate.trim();
        const alreadyExists = searchTerms.some((existing) => existing.toLowerCase() === cleaned.toLowerCase());

        if (!alreadyExists) {
            searchTerms.push(cleaned);
        }
    }

    /**
     * Extracts the filename portion of a path, tolerating both `/` and `\`
     * separators (saved database values may be old Windows paths, while
     * Jellyfin's own paths use `/`) -- ports the `Path.GetFileName` calls
     * in jellyfin_client.cs without relying on Node's `path` module, which
     * only understands the host OS's separator.
     *
     * @param {string} value - Path or filename.
     * @returns {string} Final path segment, or '' if value was blank.
     */
    _getFileNameFromPath(value) {
        if (!value) {
            return '';
        }

        const segments = value.replace(/\\/g, '/').split('/');
        return segments[segments.length - 1] || '';
    }

    /**
     * Strips a file extension from a filename -- ports the
     * `Path.GetFileNameWithoutExtension` calls in jellyfin_client.cs.
     *
     * @param {string} fileName - Filename, with or without an extension.
     * @returns {string} Filename without its extension.
     */
    _getFileNameStem(fileName) {
        const lastDot = fileName.lastIndexOf('.');
        return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
    }

    /**
     * Converts a video name into a conservative comparison key: strips a
     * common video extension, treats spaces/underscores/hyphens as
     * equivalent separators, removes remaining punctuation, and lowercases
     * -- ports `NormalizeVideoMatchKey`.
     *
     * @param {string} value - Filename, filename stem, Jellyfin item name, or path basename.
     * @returns {string} Lowercase alphanumeric comparison key.
     */
    _normalizeVideoMatchKey(value) {
        let normalized = (value || '').trim().toLowerCase();
        normalized = normalized.replace(/\.(mp4|mov|mkv|avi|m4v)$/i, '');
        normalized = normalized.replace(/[\s_-]+/g, '');
        normalized = normalized.replace(/[^a-z0-9]/g, '');
        return normalized;
    }

    /**
     * Extracts the common MARE date-and-time identifier (e.g.
     * `20240730_190910`) from a video name -- ports `ExtractVideoTimestampKey`.
     *
     * @param {string} value - Filename, path basename, or combined Jellyfin item text.
     * @returns {string} Fourteen-digit yyyymmddhhmmss key, or '' if absent.
     */
    _extractVideoTimestampKey(value) {
        const match = (value || '').match(/(\d{8})[_ -](\d{6})/);
        return match ? match[1] + match[2] : '';
    }

    /**
     * Scores how closely one Jellyfin video item matches a saved database
     * video location, checking both the Jellyfin display name and the
     * basename of its server-side path -- ports `ScoreJellyfinVideoMatch`.
     *
     * @param {string} requestedVideoLocation - Filename or path stored in the database.
     * @param {Object} item - Jellyfin video candidate (see {@link JellyfinRepository#_parseItem}).
     * @returns {number} Score from 0 through 100.
     */
    _scoreVideoMatch(requestedVideoLocation, item) {
        if (!item) {
            return 0;
        }

        const requestedFileName = this._getFileNameFromPath(requestedVideoLocation) || requestedVideoLocation || '';
        const requestedStem = this._getFileNameStem(requestedFileName);

        const itemName = item.name || '';
        const itemPathFileName = this._getFileNameFromPath(item.path || '');
        const itemPathStem = this._getFileNameStem(itemPathFileName);

        const requestedStemKey = this._normalizeVideoMatchKey(requestedStem);
        const requestedFileKey = this._normalizeVideoMatchKey(requestedFileName);
        const itemNameKey = this._normalizeVideoMatchKey(itemName);
        const itemPathStemKey = this._normalizeVideoMatchKey(itemPathStem);
        const itemPathFileKey = this._normalizeVideoMatchKey(itemPathFileName);

        // Exact Jellyfin display-name match is the strongest, most common case.
        if (requestedStemKey && requestedStemKey === itemNameKey) {
            return 100;
        }

        // Exact match against the filename represented by Jellyfin's source path.
        if (requestedStemKey && requestedStemKey === itemPathStemKey) {
            return 98;
        }

        // Exact full filename match is strong when the path contains an extension.
        if (requestedFileKey && requestedFileKey === itemPathFileKey) {
            return 96;
        }

        // Jellyfin may append additional text to an otherwise exact item title.
        if (requestedStemKey && itemNameKey.includes(requestedStemKey)) {
            return 85;
        }

        // Containment in the source path filename is slightly weaker.
        if (requestedStemKey && itemPathStemKey.includes(requestedStemKey)) {
            return 82;
        }

        // The saved database value may contain a suffix absent from Jellyfin.
        if (itemNameKey && requestedStemKey.includes(itemNameKey)) {
            return 75;
        }

        // Matching only the timestamp is a useful fallback, but weaker than
        // an exact or contained filename match.
        const requestedTimestamp = this._extractVideoTimestampKey(requestedStem);
        const itemTimestamp = this._extractVideoTimestampKey(`${itemName} ${itemPathFileName}`);

        if (requestedTimestamp && requestedTimestamp === itemTimestamp) {
            return 70;
        }

        return 0;
    }

    /**
     * Parses a Jellyfin item-list response envelope.
     *
     * @param {Object} data - Decoded Jellyfin response body.
     * @returns {Array<Object>} Parsed items (see {@link JellyfinRepository#_parseItem}).
     */
    _parseItemsResponse(data) {
        const rawItems = (data && data.Items) || [];
        return rawItems.map((rawItem) => this._parseItem(rawItem));
    }

    /**
     * Normalizes one Jellyfin item DTO into the repository's internal item
     * shape.
     *
     * `path` (Jellyfin's server-side filesystem path) is carried through
     * here both because internal logic -- e.g. matching a database
     * `video_source` value against a Jellyfin item, the same job the old
     * `VideoSourceResolver` did -- needs it, and because it is deliberately
     * included in the public `JellyfinItem` OpenAPI schema too.
     *
     * @param {Object} rawItem - Raw Jellyfin item DTO.
     * @returns {Object} `{ id, name, type, path, isFolder, mediaType, runtimeTicks, childCount }`.
     */
    _parseItem(rawItem) {
        return {
            id: String(rawItem.Id || ''),
            name: String(rawItem.Name || ''),
            type: String(rawItem.Type || ''),
            path: String(rawItem.Path || ''),
            isFolder: Boolean(rawItem.IsFolder),
            mediaType: String(rawItem.MediaType || ''),
            runtimeTicks: rawItem.RunTimeTicks ?? null,
            childCount: rawItem.ChildCount ?? null,
        };
    }

    /**
     * Normalizes a Jellyfin PlaybackInfo response down to the fields MARP
     * needs to decide how to stream an item, build a quality menu, and
     * negotiate transcoding.
     *
     * @param {Object} data - Decoded Jellyfin PlaybackInfo response body.
     * @returns {Object} `{ playSessionId, errorCode, mediaSources }`.
     */
    _parsePlaybackInfo(data) {
        const rawMediaSources = (data && data.MediaSources) || [];

        return {
            playSessionId: String((data && data.PlaySessionId) || ''),
            errorCode: String((data && data.ErrorCode) || ''),
            mediaSources: rawMediaSources.map((source) => this._parseMediaSource(source)),
        };
    }

    /**
     * Normalizes one Jellyfin MediaSource DTO, including the bitrate/video
     * dimensions needed to build a quality menu and the direct/transcode
     * URLs Jellyfin may return once a specific playback mode is negotiated.
     *
     * @param {Object} source - Raw Jellyfin MediaSource DTO.
     * @returns {Object} Parsed media source.
     */
    _parseMediaSource(source) {
        const rawMediaStreams = (source && source.MediaStreams) || [];
        const videoStream = rawMediaStreams.find((stream) => stream.Type === 'Video');

        return {
            id: String(source.Id || ''),
            container: String(source.Container || ''),
            bitrate: source.Bitrate ?? null,
            width: videoStream ? videoStream.Width ?? null : null,
            height: videoStream ? videoStream.Height ?? null : null,
            supportsDirectPlay: Boolean(source.SupportsDirectPlay),
            supportsDirectStream: Boolean(source.SupportsDirectStream),
            supportsTranscoding: Boolean(source.SupportsTranscoding),
            directStreamUrl: String(source.DirectStreamUrl || ''),
            transcodingUrl: String(source.TranscodingUrl || ''),
        };
    }
}

module.exports = new JellyfinRepository();
