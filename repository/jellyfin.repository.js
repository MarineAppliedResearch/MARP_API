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
 * Session handling: authentication is lazy (the first authenticated call
 * triggers a login) and the resulting access token/user id are cached in
 * memory for the lifetime of the process. A cached token that Jellyfin has
 * expired surfaces as an HTTP 401, which is handled by re-authenticating
 * once and retrying the original request -- see `_authenticatedRequest`.
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
        // there is no per-request override, since MARP authenticates to
        // Jellyfin as a single shared service account, not per end user.
        this.baseUrl = this._normalizeBaseUrl(process.env.JELLYFIN_BASE_URL || '');
        this.username = process.env.JELLYFIN_USERNAME || '';
        this.password = process.env.JELLYFIN_PASSWORD || '';

        // Populated by authenticate(); empty until the first authenticated call.
        this.accessToken = '';
        this.userId = '';
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
     * Reports whether this client currently holds a usable Jellyfin session.
     *
     * @returns {boolean} True when base URL, access token, and user id are all present.
     */
    get isAuthenticated() {
        return Boolean(this.baseUrl && this.accessToken && this.userId);
    }

    /**
     * Builds the `MediaBrowser` authorization header Jellyfin expects on
     * the initial (unauthenticated) login request.
     *
     * @returns {string} Header value identifying MARP as the calling client.
     */
    _buildMediaBrowserAuthorizationHeader() {
        const clientName = 'MARP API';
        const deviceName = process.env.HOSTNAME || 'marp-api';
        const deviceId = `marp-api-${deviceName}`.toLowerCase();
        const version = '1.0.0';

        return (
            'MediaBrowser ' +
            `Client="${clientName}", ` +
            `Device="${deviceName}", ` +
            `DeviceId="${deviceId}", ` +
            `Version="${version}"`
        );
    }

    /**
     * Authenticates to Jellyfin with the configured service-account
     * username/password and caches the resulting access token and user id.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {ApiError} 500/INTERNAL_ERROR if JELLYFIN_* env vars are missing;
     * 502/UPSTREAM_ERROR if Jellyfin is unreachable or rejects the login.
     */
    async authenticate() {
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
                    Authorization: this._buildMediaBrowserAuthorizationHeader(),
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

        this.accessToken = String(data.AccessToken || '');
        this.userId = String((data.User || {}).Id || '');

        if (!this.accessToken || !this.userId) {
            throw new ApiError(502, ERROR_CODES.UPSTREAM_ERROR, 'Jellyfin did not return a usable access token.');
        }
    }

    /**
     * Authenticates only if this client does not already hold a session.
     * Called at the top of every authenticated method so callers never have
     * to manage login state themselves.
     *
     * @async
     * @returns {Promise<void>}
     */
    async _ensureAuthenticated() {
        if (!this.isAuthenticated) {
            await this.authenticate();
        }
    }

    /**
     * Sends one authenticated Jellyfin request, retrying exactly once after
     * a fresh login if the cached token has expired (surfaced as an HTTP 401).
     *
     * @async
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
    async _authenticatedRequest(method, url, body, options = {}) {
        const notFoundStatuses = options.notFoundStatuses || [404];
        const send = async () => {
            try {
                return await fetch(url, {
                    method,
                    headers: {
                        'X-Emby-Token': this.accessToken,
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

        // A 401 here means the cached token has expired server-side (Jellyfin
        // sessions are not indefinite) rather than that the request itself is
        // malformed -- re-authenticate once and retry before giving up.
        if (response.status === 401) {
            this.accessToken = '';
            this.userId = '';
            await this.authenticate();
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
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items (see {@link JellyfinRepository#_parseItem}).
     */
    async getLibraries() {
        await this._ensureAuthenticated();

        const url = `${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Views?Fields=Path`;
        const data = await this._authenticatedRequest('GET', url);

        return this._parseItemsResponse(data);
    }

    /**
     * Loads one folder level of child items under a Jellyfin parent item.
     * Non-recursive by design -- callers browse one level at a time.
     *
     * @async
     * @param {string} parentItemId - Jellyfin id of the parent folder/library.
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items (see {@link JellyfinRepository#_parseItem}).
     * @throws {ApiError} 400/VALIDATION_ERROR when parentItemId is missing.
     */
    async getChildItems(parentItemId) {
        if (!parentItemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin parent item id is required.');
        }

        await this._ensureAuthenticated();

        const fields = 'Path,MediaSources,RunTimeTicks,ChildCount';
        const url =
            `${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Items` +
            `?ParentId=${encodeURIComponent(parentItemId)}` +
            `&Recursive=false` +
            `&Fields=${encodeURIComponent(fields)}`;

        const data = await this._authenticatedRequest('GET', url);

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
     * @returns {Promise<Array<Object>>} Parsed Jellyfin items (see {@link JellyfinRepository#_parseItem}).
     * @throws {ApiError} 400/VALIDATION_ERROR when query is missing.
     */
    async searchVideoItems(query, limit = 20) {
        if (!query) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin search query is required.');
        }

        await this._ensureAuthenticated();

        const fields = 'Path,MediaSources,RunTimeTicks';
        const url =
            `${this.baseUrl}/Users/${encodeURIComponent(this.userId)}/Items` +
            `?Recursive=true` +
            `&IncludeItemTypes=Video` +
            `&SearchTerm=${encodeURIComponent(query)}` +
            `&Limit=${encodeURIComponent(limit)}` +
            `&Fields=${encodeURIComponent(fields)}`;

        const data = await this._authenticatedRequest('GET', url);

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
     * @returns {Promise<Object>} Parsed playback info (see {@link JellyfinRepository#_parsePlaybackInfo}).
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing; 404/RESOURCE_NOT_FOUND when the item does not exist.
     */
    async getPlaybackInfo(itemId, options = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        await this._ensureAuthenticated();

        const maxStreamingBitrate = options.maxStreamingBitrate || 8_000_000;
        const url = `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${encodeURIComponent(this.userId)}`;
        const body = {
            UserId: this.userId,
            MaxStreamingBitrate: maxStreamingBitrate,
            EnableDirectPlay: true,
            EnableDirectStream: true,
            EnableTranscoding: true,
        };

        // PlaybackInfo reports an unknown item id as HTTP 400, not 404 --
        // confirmed against the live server -- so 400 is treated as
        // not-found here specifically, rather than in the general default.
        const data = await this._authenticatedRequest('POST', url, body, { notFoundStatuses: [400, 404] });

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
     * @returns {Promise<Array<Object>>} Playback options, each `{ displayName, mode, maxStreamingBitrate, maxWidth, maxHeight, isAuto, isOriginal, requiresTranscoding }`.
     */
    async getPlaybackOptions(itemId) {
        const playbackInfo = await this.getPlaybackInfo(itemId);

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
     * @returns {Promise<Object>} Parsed playback info, with `mediaSources[].transcodingUrl` populated.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing; 404/RESOURCE_NOT_FOUND when the item does not exist.
     */
    async getTranscodePlaybackInfo(itemId, option = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        await this._ensureAuthenticated();

        const maxStreamingBitrate = option.maxStreamingBitrate || 4_000_000;
        const maxWidth = option.maxWidth || 1280;
        const maxHeight = option.maxHeight || 720;

        const url = `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${encodeURIComponent(this.userId)}`;
        const body = {
            UserId: this.userId,
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

        const data = await this._authenticatedRequest('POST', url, body, { notFoundStatuses: [400, 404] });

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
     * @returns {Promise<string>} Absolute Jellyfin stream URL.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing.
     */
    async buildDirectStreamUrl(itemId) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        await this._ensureAuthenticated();

        return `${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/stream?static=true&api_key=${encodeURIComponent(this.accessToken)}`;
    }

    /**
     * Relays a playback report to one of Jellyfin's `/Sessions/Playing*`
     * endpoints -- ports `BuildPlaybackReportBody` + the three
     * `Report*Async` methods from jellyfin_client.cs. MARP holds no
     * server-side playback session state (see the module-level note on
     * statelessness), so every field the report needs comes from the
     * caller rather than from anything cached here.
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
     * @returns {Promise<void>}
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId is missing.
     */
    async _reportPlayback(path, itemId, report = {}) {
        if (!itemId) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id is required.');
        }

        await this._ensureAuthenticated();

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

        await this._authenticatedRequest('POST', `${this.baseUrl}${path}`, body);
    }

    /**
     * Reports that playback has started or resumed for an item.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} [report] - Report fields (see {@link JellyfinRepository#_reportPlayback}).
     * @returns {Promise<void>}
     */
    async reportPlaybackStarted(itemId, report) {
        await this._reportPlayback('/Sessions/Playing', itemId, report);
    }

    /**
     * Reports current playback position/pause state for an item. Should be
     * called periodically during playback so Jellyfin's transcode-session
     * lifecycle and resume position stay accurate.
     *
     * @async
     * @param {string} itemId - Jellyfin item id being played.
     * @param {Object} [report] - Report fields (see {@link JellyfinRepository#_reportPlayback}).
     * @returns {Promise<void>}
     */
    async reportPlaybackProgress(itemId, report) {
        await this._reportPlayback('/Sessions/Playing/Progress', itemId, report);
    }

    /**
     * Reports final playback position before the item/session changes or
     * closes, so Jellyfin can clean up any active transcode session.
     *
     * @async
     * @param {string} itemId - Jellyfin item id that was being played.
     * @param {Object} [report] - Report fields (see {@link JellyfinRepository#_reportPlayback}).
     * @returns {Promise<void>}
     */
    async reportPlaybackStopped(itemId, report) {
        await this._reportPlayback('/Sessions/Playing/Stopped', itemId, { ...report, isPaused: true });
    }

    /**
     * Builds a Jellyfin item image URL (poster/thumbnail/etc.) with the
     * cached session token -- ports `BuildItemImageUrl` from
     * jellyfin_client.cs. Pure URL construction, no request is sent.
     *
     * @async
     * @param {string} itemId - Jellyfin item id to build an image URL for.
     * @param {string} imageType - Jellyfin image type, e.g. 'Primary', 'Thumb', 'Backdrop'.
     * @param {number} [maxWidth=320] - Maximum image width Jellyfin should return.
     * @param {number} [quality=85] - JPEG quality (1-100).
     * @returns {Promise<string>} Absolute Jellyfin image URL.
     * @throws {ApiError} 400/VALIDATION_ERROR when itemId or imageType is missing.
     */
    async buildImageUrl(itemId, imageType, maxWidth = 320, quality = 85) {
        if (!itemId || !imageType) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A Jellyfin item id and image type are required.');
        }

        await this._ensureAuthenticated();

        const safeMaxWidth = maxWidth > 0 ? maxWidth : 320;
        const safeQuality = quality > 0 && quality <= 100 ? quality : 85;

        return (
            `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}` +
            `?maxWidth=${safeMaxWidth}&quality=${safeQuality}&api_key=${encodeURIComponent(this.accessToken)}`
        );
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
     * here because internal logic -- e.g. matching a database
     * `video_source` value against a Jellyfin item, the same job the old
     * `VideoSourceResolver` did -- may need it. Whether `path` is safe to
     * put in front of an API consumer is a separate decision, made at the
     * OpenAPI response-schema/serialization layer, not here.
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
