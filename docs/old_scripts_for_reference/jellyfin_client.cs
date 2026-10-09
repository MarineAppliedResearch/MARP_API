// -----------------------------------------------------------------------------
// JellyfinApiClient.cs
//
// Reusable Jellyfin API wrapper for the MARE annotation GUI.
//
// This class owns Jellyfin connection/session state, authentication, request
// headers, and low-level JSON request helpers. UI windows should call this class
// instead of constructing Jellyfin API requests directly.
//
// Isaac Travers 2026-06-22
// -----------------------------------------------------------------------------

using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Globalization;
using System.Threading.Tasks;
using System.Windows;

// System.IO provides filename and extension parsing for Jellyfin match scoring.
using System.IO;

// Regular expressions normalize filenames and extract MARE timestamp patterns.
using System.Text.RegularExpressions;

namespace MAREGUI_PROOFofCONCEPT
{
    public class JellyfinApiClient
    {
        // Keep one HttpClient for this Jellyfin API client instance.
        private readonly HttpClient _httpClient = new HttpClient();

        // Store the active Jellyfin session values after authentication.
        public string BaseUrl { get; private set; } = "";
        public string AccessToken { get; private set; } = "";
        public string UserId { get; private set; } = "";

        // ---------------------------------------------------------------------
        // IsAuthenticated
        //
        // Reports whether this client currently has enough Jellyfin session state to
        // make authenticated API calls. This lets non-browser load paths ensure the
        // client is signed in before requesting PlaybackInfo.
        // ---------------------------------------------------------------------
        public bool IsAuthenticated
        {
            get
            {
                return !String.IsNullOrWhiteSpace(BaseUrl) &&
                       !String.IsNullOrWhiteSpace(AccessToken) &&
                       !String.IsNullOrWhiteSpace(UserId);
            }
        }

        // ---------------------------------------------------------------------
        // AuthenticateAsync
        //
        // Signs into Jellyfin and stores the session values needed by later API
        // calls. The browser and player should use this rather than storing their
        // own duplicate Jellyfin auth state.
        // ---------------------------------------------------------------------
        public async Task<JellyfinAuthenticateResponse> AuthenticateAsync(
            string baseUrl,
            string username,
            string password
        )
        {
            BaseUrl = NormalizeBaseUrl(baseUrl);

            string url = BaseUrl + "/Users/AuthenticateByName";

            // Jellyfin expects username/password JSON in this exact shape.
            var body = new
            {
                Username = username,
                Pw = password
            };

            string json = JsonConvert.SerializeObject(body);

            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, url))
            {
                // Jellyfin uses this MediaBrowser header to identify the client
                // application and device during authentication.
                request.Headers.TryAddWithoutValidation(
                    "Authorization",
                    BuildMediaBrowserAuthorizationHeader(null)
                );

                request.Content = new StringContent(json, Encoding.UTF8, "application/json");

                using (HttpResponseMessage response = await _httpClient.SendAsync(request))
                {
                    string responseText = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        throw new Exception(
                            "AuthenticateAsync failed. " +
                            "Url=" + url +
                            " HTTP " + (int)response.StatusCode + ": " + responseText
                        );
                    }

                    JellyfinAuthenticateResponse authResponse =
                        JsonConvert.DeserializeObject<JellyfinAuthenticateResponse>(responseText);

                    if (authResponse == null ||
                        String.IsNullOrWhiteSpace(authResponse.AccessToken) ||
                        authResponse.User == null ||
                        String.IsNullOrWhiteSpace(authResponse.User.Id))
                    {
                        throw new Exception("Jellyfin did not return a valid access token or user ID.");
                    }

                    AccessToken = authResponse.AccessToken;
                    UserId = authResponse.User.Id;

                    Functions.log(
                        "JELLYFIN",
                        "Authenticated Jellyfin session. BaseUrl=" + BaseUrl + " UserId=" + UserId
                    );

                    return authResponse;
                }
            }
        }


        // ---------------------------------------------------------------------
        // TryAuthenticateAsync
        //
        // Attempts to authenticate with Jellyfin and returns false instead of
        // throwing when the server URL or credentials are rejected. This is useful
        // for saved-credential workflows that need to fall back to a sign-in dialog.
        // ---------------------------------------------------------------------
        public async Task<bool> TryAuthenticateAsync(
            string baseUrl,
            string username,
            string password
        )
        {
            try
            {
                // Use the normal authentication path so BaseUrl, AccessToken, and UserId
                // are populated exactly the same way for saved and manually entered creds.
                await AuthenticateAsync(baseUrl, username, password);

                return true;
            }
            catch (Exception ex)
            {
                // Login failure is expected when saved credentials are stale, wrong, or
                // pointed at the wrong server. Return false so the caller can recover.
                Functions.log("JELLYFIN", "Jellyfin authentication failed: " + ex.Message);

                return false;
            }
        }

        // ---------------------------------------------------------------------
        // GetLibrariesAsync
        //
        // Loads the top-level Jellyfin libraries available to the authenticated
        // user. This is the reusable version of the browser window's root load.
        // ---------------------------------------------------------------------
        public async Task<JellyfinItemsResponse> GetLibrariesAsync()
        {
            RequireAuthenticatedSession();

            string url = BaseUrl + "/Users/" + UserId + "/Views";

            return await GetJellyfinAsync<JellyfinItemsResponse>(url);
        }

        // ---------------------------------------------------------------------
        // GetChildItemsAsync
        //
        // Loads the child folders and media items under a Jellyfin parent item.
        // The field list stays centralized here so future callers get the same
        // metadata needed for browsing, selection, and playback setup.
        // ---------------------------------------------------------------------
        public async Task<JellyfinItemsResponse> GetChildItemsAsync(string parentItemId)
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(parentItemId))
            {
                throw new ArgumentException("Parent Jellyfin item ID is required.", "parentItemId");
            }

            string fields =
    "Path,Overview,MediaSources,MediaStreams,PrimaryImageAspectRatio,DateCreated,ChildCount,RunTimeTicks,ImageTags,BackdropImageTags";

            string url =
                BaseUrl +
                "/Users/" + UserId +
                "/Items?ParentId=" + Uri.EscapeDataString(parentItemId) +
                "&Recursive=false" +
                "&Fields=" + fields;

            return await GetJellyfinAsync<JellyfinItemsResponse>(url);
        }


        // -----------------------------------------------------------------------------
        // SearchVideoItemsAsync
        //
        // Searches all Jellyfin video items available to the authenticated user.
        //
        // The search is recursive because the caller may know only the filename and not
        // which Jellyfin library, project folder, or dive folder contains the video.
        // Path and media metadata are requested so the resolver can compare the saved
        // database filename against both the Jellyfin item name and server-side path.
        //
        // Inputs:
        //     query - Filename, filename stem, timestamp, or other Jellyfin search text.
        //     limit - Maximum number of Jellyfin items returned for this search term.
        //
        // Output:
        //     JellyfinItemsResponse containing the matching Jellyfin video items.
        //
        // Usage:
        //     Called by JellyfinApiSession when resolving an old database video location
        //     that no longer exists on the current computer.
        // -----------------------------------------------------------------------------
        public async Task<JellyfinItemsResponse> SearchVideoItemsAsync(
            string query,
            int limit = 20
        )
        {
            RequireAuthenticatedSession();

            // Blank searches could return an unnecessarily large portion of the library
            // and cannot provide a meaningful filename match.
            if (String.IsNullOrWhiteSpace(query))
            {
                throw new ArgumentException(
                    "Jellyfin video search query is required.",
                    "query"
                );
            }

            // Prevent accidental zero, negative, or excessively large search requests.
            if (limit <= 0)
            {
                limit = 20;
            }
            else if (limit > 100)
            {
                limit = 100;
            }

            // These fields contain the values needed for filename matching and for
            // constructing the playback state after a match is selected.
            string fields =
                "Path,MediaSources,MediaStreams,RunTimeTicks,ImageTags";

            // Search all folders recursively, but return only playable video items.
            string url =
                BaseUrl +
                "/Users/" + Uri.EscapeDataString(UserId) +
                "/Items" +
                "?Recursive=true" +
                "&IncludeItemTypes=Video" +
                "&SearchTerm=" + Uri.EscapeDataString(query.Trim()) +
                "&Limit=" + limit.ToString(CultureInfo.InvariantCulture) +
                "&Fields=" + Uri.EscapeDataString(fields);

            JellyfinItemsResponse response =
                await GetJellyfinAsync<JellyfinItemsResponse>(url);

            // Normalize a missing Items array so resolver code can safely iterate it.
            if (response == null)
            {
                response = new JellyfinItemsResponse();
            }

            if (response.Items == null)
            {
                response.Items = new List<JellyfinItemDto>();
            }

            return response;
        }




        // ---------------------------------------------------------------------
        // BuildItemImageUrl
        //
        // Builds a Jellyfin image URL for a specific item and image type. This keeps
        // image endpoint paths, image sizing, quality, and token placement centralized
        // in the API client instead of leaking Jellyfin URL details into the UI.
        // ---------------------------------------------------------------------
        public string BuildItemImageUrl(string itemId, string imageType, int maxWidth, int quality)
        {
            RequireAuthenticatedSession();

            // The UI should treat a blank URL as "no image available".
            if (String.IsNullOrWhiteSpace(itemId) || String.IsNullOrWhiteSpace(imageType))
            {
                return "";
            }

            // Clamp image settings to safe values so accidental bad inputs do not produce
            // strange Jellyfin URLs.
            if (maxWidth <= 0)
            {
                maxWidth = 320;
            }

            if (quality <= 0 || quality > 100)
            {
                quality = 85;
            }

            return BaseUrl +
                "/Items/" + Uri.EscapeDataString(itemId) +
                "/Images/" + Uri.EscapeDataString(imageType) +
                "?maxWidth=" + maxWidth.ToString() +
                "&quality=" + quality.ToString() +
                "&api_key=" + Uri.EscapeDataString(AccessToken);
        }

        // ---------------------------------------------------------------------
        // BuildPrimaryImageUrl
        //
        // Builds a Jellyfin Primary image URL. In your server layout this is used for
        // root project library images and dive folder poster images.
        // ---------------------------------------------------------------------
        public string BuildPrimaryImageUrl(string itemId, int maxWidth)
        {
            return BuildItemImageUrl(itemId, "Primary", maxWidth, 85);
        }

        // ---------------------------------------------------------------------
        // BuildThumbImageUrl
        //
        // Builds a Jellyfin Thumb image URL. In your server layout this is used for
        // video item thumbnail cards.
        // ---------------------------------------------------------------------
        public string BuildThumbImageUrl(string itemId, int maxWidth)
        {
            return BuildItemImageUrl(itemId, "Thumb", maxWidth, 85);
        }



        // ---------------------------------------------------------------------
        // BuildTrickplayPlaylistUrl
        //
        // Builds the Jellyfin trickplay HLS image playlist URL for one item.
        //
        // Some Jellyfin video endpoints expect the route item id in hyphenated GUID
        // form, even though many item DTOs expose the same id as 32 hex characters.
        // The mediaSourceId query value should remain in the form Jellyfin returned.
        // ---------------------------------------------------------------------
        public string BuildTrickplayPlaylistUrl(string itemId, int width, string mediaSourceId = null)
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                throw new ArgumentException("Jellyfin item ID is required.", "itemId");
            }

            if (width <= 0)
            {
                throw new ArgumentException("Trickplay width must be greater than zero.", "width");
            }

            string endpointItemId = FormatJellyfinItemIdForVideoEndpoint(itemId);

            string url =
                BaseUrl +
                "/Videos/" + Uri.EscapeDataString(endpointItemId) +
                "/Trickplay/" + width.ToString(CultureInfo.InvariantCulture) +
                "/tiles.m3u8";

            if (!String.IsNullOrWhiteSpace(mediaSourceId))
            {
                url += "?MediaSourceId=" + Uri.EscapeDataString(mediaSourceId);
            }

            return url;
        }


        // ---------------------------------------------------------------------
        // GetTrickplayInfoAsync
        //
        // Loads and parses Jellyfin's trickplay image playlist for one video item.
        //
        // The playlist describes a tile sheet image layout. Each tile sheet contains
        // many preview thumbnails packed into a grid. VideoPlayer uses this parsed
        // metadata to crop the correct thumbnail for the current slider time.
        //
        // Some Jellyfin servers can return a playlist containing only 0.jpg even when
        // later numbered tile images exist. When runtime is available, we probe for
        // those missing numbered tiles and add only URLs the server confirms.
        // ---------------------------------------------------------------------
        public async Task<JellyfinTrickplayInfo> GetTrickplayInfoAsync(
            string itemId,
            int width,
            string mediaSourceId = null,
            long runTimeTicks = 0)
        {
            RequireAuthenticatedSession();

            string playlistUrl = BuildTrickplayPlaylistUrl(itemId, width, mediaSourceId);
            string playlistText = await GetJellyfinTextAsync(playlistUrl);

            JellyfinTrickplayInfo trickplayInfo =
                ParseTrickplayPlaylist(itemId, width, playlistUrl, playlistText);

            await ExpandTrickplayTileUrlsFromRuntimeAsync(trickplayInfo, runTimeTicks);

            return trickplayInfo;
        }

        // ---------------------------------------------------------------------
        // ExpandTrickplayTileUrlsFromRuntimeAsync
        //
        // Adds missing numbered trickplay tile URLs when Jellyfin's playlist does not
        // list every tile sheet that exists.
        //
        // Runtime is used only to calculate how many tile sheets may be needed. Each
        // synthesized URL is probed before being added, so the client does not assume
        // that every numbered image exists.
        // ---------------------------------------------------------------------
        private async Task ExpandTrickplayTileUrlsFromRuntimeAsync(
            JellyfinTrickplayInfo trickplayInfo,
            long runTimeTicks)
        {
            if (trickplayInfo == null ||
                runTimeTicks <= 0 ||
                trickplayInfo.TileImageUrls == null ||
                trickplayInfo.TileImageUrls.Count <= 0 ||
                trickplayInfo.ThumbnailsPerTile <= 0 ||
                trickplayInfo.ThumbnailDurationSeconds <= 0)
            {
                return;
            }

            double runtimeSeconds = runTimeTicks / 10000000.0;
            double secondsPerTileImage =
                trickplayInfo.ThumbnailsPerTile *
                trickplayInfo.ThumbnailDurationSeconds;

            if (secondsPerTileImage <= 0)
            {
                return;
            }

            int expectedTileImageCount =
                (int)Math.Ceiling(runtimeSeconds / secondsPerTileImage);

            if (expectedTileImageCount <= trickplayInfo.TileImageUrls.Count)
            {
                return;
            }

            string firstTileUrl = trickplayInfo.TileImageUrls[0];

            for (int tileIndex = trickplayInfo.TileImageUrls.Count;
                 tileIndex < expectedTileImageCount;
                 tileIndex++)
            {
                string candidateTileUrl =
                    BuildTrickplayTileUrlFromFirstTileUrl(firstTileUrl, tileIndex);

                if (String.IsNullOrWhiteSpace(candidateTileUrl))
                {
                    break;
                }

                bool tileExists = await JellyfinUrlExistsAsync(candidateTileUrl);

                if (!tileExists)
                {
                    Functions.log(
                        "JELLYFIN",
                        "TRICKPLAY tile probe stopped at missing tile index " + tileIndex
                    );

                    break;
                }

                trickplayInfo.TileImageUrls.Add(candidateTileUrl);

                Functions.log(
                    "JELLYFIN",
                    "TRICKPLAY discovered extra tile index " + tileIndex +
                    " Url=" + candidateTileUrl
                );
            }
        }


        // ---------------------------------------------------------------------
        // BuildTrickplayTileUrlFromFirstTileUrl
        //
        // Builds a numbered tile image URL from the first tile URL returned by
        // Jellyfin's playlist.
        //
        // Example:
        // .../0.jpg?MediaSourceId=...&ApiKey=...
        // becomes:
        // .../1.jpg?MediaSourceId=...&ApiKey=...
        // ---------------------------------------------------------------------
        private string BuildTrickplayTileUrlFromFirstTileUrl(
            string firstTileUrl,
            int tileIndex)
        {
            if (String.IsNullOrWhiteSpace(firstTileUrl))
            {
                return "";
            }

            int questionIndex = firstTileUrl.IndexOf('?');
            string pathPart =
                questionIndex >= 0 ? firstTileUrl.Substring(0, questionIndex) : firstTileUrl;
            string queryPart =
                questionIndex >= 0 ? firstTileUrl.Substring(questionIndex) : "";

            int lastSlashIndex = pathPart.LastIndexOf('/');

            if (lastSlashIndex < 0 ||
                lastSlashIndex >= pathPart.Length - 1)
            {
                return "";
            }

            string fileName = pathPart.Substring(lastSlashIndex + 1);

            if (!fileName.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase))
            {
                return "";
            }

            string newPathPart =
                pathPart.Substring(0, lastSlashIndex + 1) +
                tileIndex.ToString(CultureInfo.InvariantCulture) +
                ".jpg";

            return newPathPart + queryPart;
        }


        // ---------------------------------------------------------------------
        // JellyfinUrlExistsAsync
        //
        // Checks whether an authenticated Jellyfin URL exists.
        //
        // HEAD is preferred because we only need existence, not image bytes. If the
        // server rejects HEAD for an endpoint, fall back to a small GET request.
        // ---------------------------------------------------------------------
        private async Task<bool> JellyfinUrlExistsAsync(string url)
        {
            RequireAuthenticatedSession();

            using (HttpRequestMessage headRequest = new HttpRequestMessage(HttpMethod.Head, url))
            {
                headRequest.Headers.TryAddWithoutValidation("X-Emby-Token", AccessToken);

                using (HttpResponseMessage headResponse = await _httpClient.SendAsync(headRequest))
                {
                    if (headResponse.IsSuccessStatusCode)
                    {
                        return true;
                    }

                    if (headResponse.StatusCode != System.Net.HttpStatusCode.MethodNotAllowed &&
                        headResponse.StatusCode != System.Net.HttpStatusCode.NotImplemented)
                    {
                        return false;
                    }
                }
            }

            using (HttpRequestMessage getRequest = new HttpRequestMessage(HttpMethod.Get, url))
            {
                getRequest.Headers.TryAddWithoutValidation("X-Emby-Token", AccessToken);

                using (HttpResponseMessage getResponse = await _httpClient.SendAsync(
                    getRequest,
                    HttpCompletionOption.ResponseHeadersRead))
                {
                    return getResponse.IsSuccessStatusCode;
                }
            }
        }


        // ---------------------------------------------------------------------
        // BuildDirectStreamUrl
        //
        // Builds the current original/direct stream URL used by the app. Keeping this
        // here gives us one place to replace or extend playback URL construction when
        // Jellyfin transcoding options are added.
        // ---------------------------------------------------------------------
        public string BuildDirectStreamUrl(string itemId)
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                return "";
            }

            return BaseUrl +
                "/Videos/" + Uri.EscapeDataString(itemId) +
                "/stream?static=true&api_key=" +
                Uri.EscapeDataString(AccessToken);
        }


        // ---------------------------------------------------------------------
        // BuildTranscodeStreamUrl
        //
        // Builds a constrained Jellyfin stream URL for a generated playback option.
        // If startTimeTicks is supplied, Jellyfin starts the generated stream at
        // that source-media offset. This is needed because LibVLC paused seeking
        // does not reliably resume from the requested position on forced Jellyfin
        // transcode streams.
        // ---------------------------------------------------------------------
        public string BuildTranscodeStreamUrl(
            string itemId,
            string mediaSourceId,
            string playSessionId,
            JellyfinPlaybackOption option
        )
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                return "";
            }

            if (option == null)
            {
                return "";
            }

            string url =
                BaseUrl +
                "/Videos/" + Uri.EscapeDataString(itemId) +
                "/stream" +
                "?api_key=" + Uri.EscapeDataString(AccessToken) +
                "&UserId=" + Uri.EscapeDataString(UserId) +
                "&EnableDirectPlay=false" +
                "&EnableDirectStream=false" +
                "&EnableTranscoding=true" +
                "&AllowVideoStreamCopy=false" +
                "&AllowAudioStreamCopy=true" +
                "&VideoCodec=h264" +
                "&AudioCodec=aac" +
                "&AudioBitRate=128000";

            if (!String.IsNullOrWhiteSpace(mediaSourceId))
            {
                url += "&MediaSourceId=" + Uri.EscapeDataString(mediaSourceId);
            }

            if (!String.IsNullOrWhiteSpace(playSessionId))
            {
                url += "&PlaySessionId=" + Uri.EscapeDataString(playSessionId);
            }

            

            if (option.MaxStreamingBitrate.HasValue)
            {
                url += "&VideoBitRate=" + option.MaxStreamingBitrate.Value;
            }

            if (option.MaxWidth.HasValue)
            {
                url += "&MaxWidth=" + option.MaxWidth.Value;
            }

            if (option.MaxHeight.HasValue)
            {
                url += "&MaxHeight=" + option.MaxHeight.Value;
            }

            return url;
        }


        // ---------------------------------------------------------------------
        // BuildStreamUrlForPlaybackOption
        //
        // Converts an app-level playback option into a safe initial Jellyfin playback
        // URL. Explicit transcode quality changes are handled by the async quality
        // menu path, which calls GetTranscodePlaybackInfoAsync and uses Jellyfin's
        // returned MediaSource.TranscodingUrl.
        //
        // This method must not call BuildTranscodeStreamUrl because that manually
        // constructs transcode URLs and bypasses the newer PlaybackInfo + DeviceProfile
        // flow.
        // ---------------------------------------------------------------------
        public string BuildStreamUrlForPlaybackOption(
            string itemId,
            JellyfinPlaybackInfoResponse playbackInfo,
            JellyfinPlaybackOption option
        )
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                return "";
            }

            if (option == null)
            {
                return BuildDirectStreamUrl(itemId);
            }

            // Original preserves the current direct/original behavior.
            if (option.IsOriginal ||
                String.Equals(option.Mode, "Original", StringComparison.OrdinalIgnoreCase))
            {
                return BuildDirectStreamUrl(itemId);
            }

            // Auto should eventually make an async quality decision using
            // GetTranscodePlaybackInfoAsync. For now, do not route Auto through the old
            // manual transcode URL builder.
            if (option.IsAuto ||
                String.Equals(option.Mode, "Auto", StringComparison.OrdinalIgnoreCase))
            {
                return BuildDirectStreamUrl(itemId);
            }

            // Explicit transcode options are handled by jellyfinPlaybackOption_Click,
            // where we can call GetTranscodePlaybackInfoAsync and use Jellyfin's returned
            // TranscodingUrl. This synchronous initial-load helper cannot do that.
            if (option.RequiresTranscoding ||
                String.Equals(option.Mode, "Transcode", StringComparison.OrdinalIgnoreCase))
            {
                return BuildDirectStreamUrl(itemId);
            }

            return BuildDirectStreamUrl(itemId);
        }


        // ---------------------------------------------------------------------
        // GetJellyfinTextAsync
        //
        // Sends an authenticated GET request to Jellyfin and returns the raw text
        // response. This is used for non-JSON endpoints such as trickplay m3u8
        // playlists.
        // ---------------------------------------------------------------------
        private async Task<string> GetJellyfinTextAsync(string url)
        {
            RequireAuthenticatedSession();

            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                request.Headers.TryAddWithoutValidation("X-Emby-Token", AccessToken);

                using (HttpResponseMessage response = await _httpClient.SendAsync(request))
                {
                    string responseText = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        throw new Exception("HTTP " + (int)response.StatusCode + ": " + responseText);
                    }

                    return responseText;
                }
            }
        }


        // ---------------------------------------------------------------------
        // GetJellyfinAsync
        //
        // Sends an authenticated GET request to Jellyfin and deserializes the
        // JSON response into the requested response type.
        // ---------------------------------------------------------------------
        private async Task<T> GetJellyfinAsync<T>(string url)
        {
            RequireAuthenticatedSession();

            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                // Keep token handling in one place so future API calls do not
                // accidentally diverge or leak auth details into UI code.
                request.Headers.TryAddWithoutValidation("X-Emby-Token", AccessToken);

                using (HttpResponseMessage response = await _httpClient.SendAsync(request))
                {
                    string responseText = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        throw new Exception("HTTP " + (int)response.StatusCode + ": " + responseText);
                    }

                    return JsonConvert.DeserializeObject<T>(responseText);
                }
            }
        }


        // ---------------------------------------------------------------------
        // PostJellyfinRawAsync
        //
        // Sends an authenticated POST request to Jellyfin and returns the raw JSON
        // response text. This is useful while inspecting new Jellyfin endpoints before
        // we commit to permanent DTO classes.
        // ---------------------------------------------------------------------
        private async Task<string> PostJellyfinRawAsync(string url, object body)
        {
            RequireAuthenticatedSession();

            string json = JsonConvert.SerializeObject(body);

            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, url))
            {
                // Keep token handling in the API client so UI code never needs to know
                // how Jellyfin expects authenticated requests to be shaped.
                request.Headers.TryAddWithoutValidation("X-Emby-Token", AccessToken);

                request.Content = new StringContent(json, Encoding.UTF8, "application/json");

                using (HttpResponseMessage response = await _httpClient.SendAsync(request))
                {
                    string responseText = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        throw new Exception(
                            "PostJellyfinRawAsync failed. " +
                            "Url=" + url +
                            " HTTP " + (int)response.StatusCode + ": " + responseText
                        );
                    }

                    return responseText;
                }
            }
        }


        // ---------------------------------------------------------------------
        // GetPlaybackInfoRawAsync
        //
        // Queries Jellyfin playback information for one media item and returns the raw
        // JSON response. We use this as a diagnostic step before designing permanent
        // playback/transcoding option models.
        // ---------------------------------------------------------------------
        public async Task<string> GetPlaybackInfoRawAsync(string itemId, int maxStreamingBitrate)
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                throw new ArgumentException("Jellyfin item ID is required.", "itemId");
            }

            string url =
                BaseUrl +
                "/Items/" + Uri.EscapeDataString(itemId) +
                "/PlaybackInfo?UserId=" + Uri.EscapeDataString(UserId);

            // Ask Jellyfin what is possible when all playback paths are allowed.
            // The bitrate value gives Jellyfin a target ceiling for transcode decisions.
            var body = new
            {
                UserId = UserId,
                MaxStreamingBitrate = maxStreamingBitrate,
                EnableDirectPlay = true,
                EnableDirectStream = true,
                EnableTranscoding = true
            };

            return await PostJellyfinRawAsync(url, body);
        }


        // ---------------------------------------------------------------------
        // GetPlaybackInfoAsync
        //
        // Queries Jellyfin playback information for one media item and returns the
        // typed subset of fields the MARE player needs for direct/original playback,
        // transcode menu construction, and future auto-quality decisions.
        // ---------------------------------------------------------------------
        public async Task<JellyfinPlaybackInfoResponse> GetPlaybackInfoAsync(string itemId, int maxStreamingBitrate)
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                throw new ArgumentException("Jellyfin item ID is required.", "itemId");
            }

            string url =
                BaseUrl +
                "/Items/" + Uri.EscapeDataString(itemId) +
                "/PlaybackInfo?UserId=" + Uri.EscapeDataString(UserId);

            // Keep all playback paths enabled while we inspect the server's source
            // capabilities. Later, profile-specific URL builders can request a narrower
            // transcode target.
            var body = new
            {
                UserId = UserId,
                MaxStreamingBitrate = maxStreamingBitrate,
                EnableDirectPlay = true,
                EnableDirectStream = true,
                EnableTranscoding = true
            };

            string responseText = await PostJellyfinRawAsync(url, body);

            JellyfinPlaybackInfoResponse playbackInfo =
                JsonConvert.DeserializeObject<JellyfinPlaybackInfoResponse>(responseText);

            LogPlaybackInfoSummary(itemId, playbackInfo);

            return playbackInfo;
        }


        // ---------------------------------------------------------------------
        // GetTranscodePlaybackInfoAsync
        //
        // Requests PlaybackInfo for one constrained Jellyfin transcode target.
        // This uses a client DeviceProfile so Jellyfin can choose and return a
        // session-associated TranscodingUrl instead of forcing the MARE client to
        // manually assemble fragile /Videos/.../stream query strings.
        // ---------------------------------------------------------------------
        public async Task<JellyfinPlaybackInfoResponse> GetTranscodePlaybackInfoAsync(
            string itemId,
            JellyfinPlaybackOption option
        )
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(itemId))
            {
                throw new ArgumentException("Jellyfin item ID is required.", "itemId");
            }

            if (option == null)
            {
                throw new ArgumentException("A Jellyfin playback option is required.", "option");
            }

            int maxStreamingBitrate = option.MaxStreamingBitrate.HasValue
                ? option.MaxStreamingBitrate.Value
                : 4000000;

            int maxWidth = option.MaxWidth.HasValue
                ? option.MaxWidth.Value
                : 1280;

            int maxHeight = option.MaxHeight.HasValue
                ? option.MaxHeight.Value
                : 720;

            string url =
                BaseUrl +
                "/Items/" + Uri.EscapeDataString(itemId) +
                "/PlaybackInfo?UserId=" + Uri.EscapeDataString(UserId);

            var body = new
            {
                UserId = UserId,

                // This request intentionally asks Jellyfin for a transcode-only result.
                // Direct/original playback stays on the existing direct stream path.
                EnableDirectPlay = false,
                EnableDirectStream = false,
                EnableTranscoding = true,

                MaxStreamingBitrate = maxStreamingBitrate,
                MaxWidth = maxWidth,
                MaxHeight = maxHeight,

                AllowVideoStreamCopy = false,
                AllowAudioStreamCopy = true,

                // This profile matches the successful Swagger test. Jellyfin uses it to
                // decide the output container/codecs and return MediaSource.TranscodingUrl.
                DeviceProfile = new
                {
                    Name = "MARE LibVLC Client",
                    MaxStreamingBitrate = maxStreamingBitrate,
                    TranscodingProfiles = new[]
                    {
                        new
                        {
                            Container = "ts",
                            Type = "Video",
                            VideoCodec = "h264",
                            AudioCodec = "aac",
                            Protocol = "hls"
                        }
                    }
                }
            };

            string responseText = await PostJellyfinRawAsync(url, body);

            JellyfinPlaybackInfoResponse playbackInfo =
                JsonConvert.DeserializeObject<JellyfinPlaybackInfoResponse>(responseText);

            LogPlaybackInfoSummary(itemId, playbackInfo);

            return playbackInfo;
        }


        // ---------------------------------------------------------------------
        // BuildPlaybackOptions
        //
        // Builds the first menu-ready playback choices from Jellyfin PlaybackInfo.
        // Jellyfin gives us source capability metadata, not a fixed quality menu, so
        // the MARE player defines predictable quality targets from the source bitrate
        // and resolution.
        // ---------------------------------------------------------------------
        public List<JellyfinPlaybackOption> BuildPlaybackOptions(JellyfinPlaybackInfoResponse playbackInfo)
        {
            List<JellyfinPlaybackOption> options = new List<JellyfinPlaybackOption>();

            if (playbackInfo == null ||
                playbackInfo.MediaSources == null ||
                playbackInfo.MediaSources.Count <= 0)
            {
                return options;
            }

            JellyfinMediaSource mediaSource = playbackInfo.MediaSources[0];

            JellyfinMediaStream videoStream = null;

            if (mediaSource.MediaStreams != null)
            {
                videoStream = mediaSource.MediaStreams
                    .FirstOrDefault(stream => String.Equals(stream.Type, "Video", StringComparison.OrdinalIgnoreCase));
            }

            int sourceBitrate = mediaSource.Bitrate.HasValue ? mediaSource.Bitrate.Value : 0;
            int sourceWidth = videoStream != null && videoStream.Width.HasValue ? videoStream.Width.Value : 0;
            int sourceHeight = videoStream != null && videoStream.Height.HasValue ? videoStream.Height.Value : 0;

            // Auto is a placeholder choice for the future adaptive mode. For now it can
            // map to a conservative transcode target when we wire playback selection.
            if (mediaSource.SupportsTranscoding == true || mediaSource.SupportsDirectStream == true)
            {
                options.Add(new JellyfinPlaybackOption
                {
                    DisplayName = "Auto",
                    Mode = "Auto",
                    MaxStreamingBitrate = null,
                    MaxWidth = null,
                    MaxHeight = null,
                    IsAuto = true,
                    IsOriginal = false,
                    RequiresTranscoding = false
                });
            }

            // Original keeps the source quality. This is the current behavior of the app.
            if (mediaSource.SupportsDirectPlay == true || mediaSource.SupportsDirectStream == true)
            {
                string bitrateText = sourceBitrate > 0
                    ? " (" + (sourceBitrate / 1000000.0).ToString("0.00") + " Mbps)"
                    : "";

                options.Add(new JellyfinPlaybackOption
                {
                    DisplayName = "Original / Direct" + bitrateText,
                    Mode = "Original",
                    MaxStreamingBitrate = null,
                    MaxWidth = sourceWidth > 0 ? (int?)sourceWidth : null,
                    MaxHeight = sourceHeight > 0 ? (int?)sourceHeight : null,
                    IsAuto = false,
                    IsOriginal = true,
                    RequiresTranscoding = false
                });
            }

            // Only offer transcode choices if Jellyfin says this media source can
            // transcode. Keep the first set conservative and predictable.
            if (mediaSource.SupportsTranscoding == true)
            {
                AddTranscodeOptionIfUseful(options, "1080p, 8 Mbps", 8000000, 1920, 1080, sourceBitrate, sourceHeight);
                AddTranscodeOptionIfUseful(options, "720p, 4 Mbps", 4000000, 1280, 720, sourceBitrate, sourceHeight);
                AddTranscodeOptionIfUseful(options, "480p, 1 Mbps", 1000000, 854, 480, sourceBitrate, sourceHeight);
            }

            return options;
        }


        // ---------------------------------------------------------------------
        // AddTranscodeOptionIfUseful
        //
        // Adds a transcode option only when it is below the source bitrate or source
        // height. This avoids showing pointless options that are higher quality than
        // the original media.
        // ---------------------------------------------------------------------
        private void AddTranscodeOptionIfUseful(
            List<JellyfinPlaybackOption> options,
            string displayName,
            int maxStreamingBitrate,
            int maxWidth,
            int maxHeight,
            int sourceBitrate,
            int sourceHeight
        )
        {
            bool bitrateIsUseful = sourceBitrate <= 0 || maxStreamingBitrate < sourceBitrate;
            bool heightIsUseful = sourceHeight <= 0 || maxHeight <= sourceHeight;

            if (!bitrateIsUseful || !heightIsUseful)
            {
                return;
            }

            options.Add(new JellyfinPlaybackOption
            {
                DisplayName = displayName,
                Mode = "Transcode",
                MaxStreamingBitrate = maxStreamingBitrate,
                MaxWidth = maxWidth,
                MaxHeight = maxHeight,
                IsAuto = false,
                IsOriginal = false,
                RequiresTranscoding = true
            });
        }


        // ---------------------------------------------------------------------
        // LogPlaybackInfoSummary
        //
        // Writes the playback URL/session fields Jellyfin returned for one
        // PlaybackInfo request. This is diagnostic output for the playback client
        // transition: it tells us whether Jellyfin is already providing direct or
        // transcode URLs for the current request/device profile.
        // ---------------------------------------------------------------------
        private void LogPlaybackInfoSummary(string itemId, JellyfinPlaybackInfoResponse playbackInfo)
        {
            Console.WriteLine("[Jellyfin PlaybackInfo] ItemId=" + itemId);

            if (playbackInfo == null)
            {
                Console.WriteLine("[Jellyfin PlaybackInfo] Response=null");
                return;
            }

            Console.WriteLine(
                "[Jellyfin PlaybackInfo] " +
                "PlaySessionId=" + playbackInfo.PlaySessionId +
                " ErrorCode=" + playbackInfo.ErrorCode
            );

            if (playbackInfo.MediaSources == null || playbackInfo.MediaSources.Count <= 0)
            {
                Console.WriteLine("[Jellyfin PlaybackInfo] No MediaSources returned.");
                return;
            }

            for (int i = 0; i < playbackInfo.MediaSources.Count; i++)
            {
                JellyfinMediaSource source = playbackInfo.MediaSources[i];

                Console.WriteLine(
                    "[Jellyfin PlaybackInfo MediaSource " + i + "] " +
                    "Id=" + source.Id +
                    " Name=" + source.Name +
                    " Protocol=" + source.Protocol +
                    " Container=" + source.Container +
                    " Bitrate=" + source.Bitrate +
                    " SupportsDirectPlay=" + source.SupportsDirectPlay +
                    " SupportsDirectStream=" + source.SupportsDirectStream +
                    " SupportsTranscoding=" + source.SupportsTranscoding
                );

                Console.WriteLine(
                    "[Jellyfin PlaybackInfo MediaSource " + i + " URLs] " +
                    "DirectStreamUrl=" + source.DirectStreamUrl +
                    " TranscodingUrl=" + source.TranscodingUrl +
                    " TranscodingSubProtocol=" + source.TranscodingSubProtocol +
                    " TranscodingContainer=" + source.TranscodingContainer
                );
            }
        }


        // ---------------------------------------------------------------------
        // RequireAuthenticatedSession
        //
        // Guards API methods that need a signed-in Jellyfin session. This keeps
        // failures close to the bad call instead of creating malformed URLs.
        // ---------------------------------------------------------------------
        private void RequireAuthenticatedSession()
        {
            if (String.IsNullOrWhiteSpace(BaseUrl) ||
                String.IsNullOrWhiteSpace(AccessToken) ||
                String.IsNullOrWhiteSpace(UserId))
            {
                throw new InvalidOperationException("Jellyfin API client is not authenticated.");
            }
        }

        // ---------------------------------------------------------------------
        // NormalizeBaseUrl
        //
        // Removes trailing slashes from the server URL so endpoint URLs can be
        // assembled safely.
        // ---------------------------------------------------------------------
        public static string NormalizeBaseUrl(string baseUrl)
        {
            if (String.IsNullOrWhiteSpace(baseUrl))
            {
                return "";
            }

            return baseUrl.Trim().TrimEnd('/');
        }


        // ---------------------------------------------------------------------
        // GetPrimaryMediaSource
        //
        // Returns the primary media source from a PlaybackInfo response. The current
        // MARE Jellyfin workflow uses one video media source per selected item, so
        // session reporting centralizes that assumption here.
        // ---------------------------------------------------------------------
        private JellyfinMediaSource GetPrimaryMediaSource(JellyfinPlaybackInfoResponse playbackInfo)
        {
            if (playbackInfo == null ||
                playbackInfo.MediaSources == null ||
                playbackInfo.MediaSources.Count <= 0)
            {
                return null;
            }

            return playbackInfo.MediaSources[0];
        }


        // ---------------------------------------------------------------------
        // GetPlayMethodForState
        //
        // Converts the selected playback option into Jellyfin's session-reporting
        // play method. Explicit transcodes and Auto-transcode selections report as
        // Transcode. Original/direct playback reports as DirectStream because the
        // client is consuming Jellyfin's HTTP stream URL rather than reading the file
        // directly from disk.
        // ---------------------------------------------------------------------
        private string GetPlayMethodForState(JellyfinPlaybackState state)
        {
            if (state == null || state.SelectedPlaybackOption == null)
            {
                return "DirectStream";
            }

            if (state.SelectedPlaybackOption.RequiresTranscoding ||
                String.Equals(state.SelectedPlaybackOption.Mode, "Transcode", StringComparison.OrdinalIgnoreCase))
            {
                return "Transcode";
            }

            // Auto can remain selected while the effective URL is a transcoded stream.
            // Detect that case from the active stream URL returned by Jellyfin.
            if (state.SelectedPlaybackOption.IsAuto &&
                !String.IsNullOrWhiteSpace(state.CurrentStreamUrl) &&
                state.CurrentStreamUrl.IndexOf("/stream.mp4", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "Transcode";
            }

            return "DirectStream";
        }


        // ---------------------------------------------------------------------
        // BuildPlaybackReportBody
        //
        // Builds the shared body used by Jellyfin playback started, progress, and
        // stopped reports. PositionTicks uses Jellyfin's 100-nanosecond tick unit,
        // matching TimeSpan.Ticks.
        // ---------------------------------------------------------------------
        private object BuildPlaybackReportBody(JellyfinPlaybackState state, TimeSpan position, bool isPaused)
        {
            if (state == null)
            {
                throw new ArgumentException("Jellyfin playback state is required.", "state");
            }

            if (String.IsNullOrWhiteSpace(state.ItemId))
            {
                throw new ArgumentException("Jellyfin item ID is required.", "state");
            }

            JellyfinMediaSource mediaSource = GetPrimaryMediaSource(state.PlaybackInfo);

            string mediaSourceId = mediaSource != null ? mediaSource.Id : "";
            string playSessionId = state.PlaybackInfo != null ? state.PlaybackInfo.PlaySessionId : "";

            long positionTicks = position.Ticks;

            if (positionTicks < 0)
            {
                positionTicks = 0;
            }

            return new
            {
                ItemId = state.ItemId,
                MediaSourceId = mediaSourceId,
                PlaySessionId = playSessionId,
                PositionTicks = positionTicks,
                IsPaused = isPaused,
                IsMuted = false,
                PlayMethod = GetPlayMethodForState(state),
                RepeatMode = "RepeatNone",
                PlaybackRate = 1.0
            };
        }


        // ---------------------------------------------------------------------
        // ReportPlaybackStartedAsync
        //
        // Reports to Jellyfin that this client has started or resumed playback for
        // the active item. This is the first step toward behaving like a real Jellyfin
        // playback client instead of only opening stream URLs.
        // ---------------------------------------------------------------------
        public async Task ReportPlaybackStartedAsync(JellyfinPlaybackState state, TimeSpan position, bool isPaused)
        {
            RequireAuthenticatedSession();

            string url = BaseUrl + "/Sessions/Playing";

            object body = BuildPlaybackReportBody(state, position, isPaused);

            await PostJellyfinRawAsync(url, body);

            Console.WriteLine(
                "[Jellyfin SESSION STARTED] " +
                "ItemId=" + state.ItemId +
                " PositionTicks=" + position.Ticks +
                " IsPaused=" + isPaused +
                " PlayMethod=" + GetPlayMethodForState(state)
            );
        }


        // ---------------------------------------------------------------------
        // ReportPlaybackProgressAsync
        //
        // Reports current playback position and pause state to Jellyfin. This should
        // be called periodically during playback and immediately after seek or pause
        // state changes.
        // ---------------------------------------------------------------------
        public async Task ReportPlaybackProgressAsync(JellyfinPlaybackState state, TimeSpan position, bool isPaused)
        {
            RequireAuthenticatedSession();

            string url = BaseUrl + "/Sessions/Playing/Progress";

            object body = BuildPlaybackReportBody(state, position, isPaused);

            await PostJellyfinRawAsync(url, body);

            Console.WriteLine(
                "[Jellyfin SESSION PROGRESS] " +
                "ItemId=" + state.ItemId +
                " PositionTicks=" + position.Ticks +
                " IsPaused=" + isPaused +
                " PlayMethod=" + GetPlayMethodForState(state)
            );
        }


        // ---------------------------------------------------------------------
        // ReportPlaybackStoppedAsync
        //
        // Reports final playback position to Jellyfin before the player changes item,
        // changes stream session, or closes. This helps Jellyfin clean up active
        // transcode sessions and update resume/progress state.
        // ---------------------------------------------------------------------
        public async Task ReportPlaybackStoppedAsync(JellyfinPlaybackState state, TimeSpan position)
        {
            RequireAuthenticatedSession();

            string url = BaseUrl + "/Sessions/Playing/Stopped";

            object body = BuildPlaybackReportBody(state, position, true);

            await PostJellyfinRawAsync(url, body);

            Console.WriteLine(
                "[Jellyfin SESSION STOPPED] " +
                "ItemId=" + state.ItemId +
                " PositionTicks=" + position.Ticks +
                " PlayMethod=" + GetPlayMethodForState(state)
            );
        }


        // ---------------------------------------------------------------------
        // BuildAbsoluteJellyfinUrl
        //
        // Jellyfin PlaybackInfo can return relative playback URLs such as
        // /videos/{id}/stream.mp4?... . The media player needs an absolute URL.
        // ---------------------------------------------------------------------
        public string BuildAbsoluteJellyfinUrl(string jellyfinUrl)
        {
            RequireAuthenticatedSession();

            if (String.IsNullOrWhiteSpace(jellyfinUrl))
            {
                return "";
            }

            if (jellyfinUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                jellyfinUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return jellyfinUrl;
            }

            if (jellyfinUrl.StartsWith("/", StringComparison.Ordinal))
            {
                return BaseUrl + jellyfinUrl;
            }

            return BaseUrl + "/" + jellyfinUrl;
        }

        // ---------------------------------------------------------------------
        // BuildMediaBrowserAuthorizationHeader
        //
        // Builds the Jellyfin MediaBrowser authorization header with optional
        // token support. Jellyfin uses this to identify the client application,
        // current computer, app version, and authenticated session.
        // ---------------------------------------------------------------------
        private string BuildMediaBrowserAuthorizationHeader(string token)
        {
            // Use the actual GUI version already reported elsewhere in the app.
            string appVersion = Functions.getVersion();

            // Use the current computer name so Jellyfin session/device listings show
            // which workstation connected.
            string computerName = Functions.getComputerName();

            // Build a stable readable device ID from the computer name. This avoids
            // every workstation pretending to be the same hard-coded dev machine.
            string deviceId = "mare-annotation-gui-" + computerName.Trim().ToLowerInvariant();

            string header =
                "MediaBrowser " +
                "Client=\"MARE Annotation GUI\", " +
                "Device=\"" + EscapeMediaBrowserHeaderValue(computerName) + "\", " +
                "DeviceId=\"" + EscapeMediaBrowserHeaderValue(deviceId) + "\", " +
                "Version=\"" + EscapeMediaBrowserHeaderValue(appVersion) + "\"";

            // Include the token when building authenticated request headers.
            if (!String.IsNullOrWhiteSpace(token))
            {
                header += ", Token=\"" + EscapeMediaBrowserHeaderValue(token) + "\"";
            }

            return header;
        }


        // ---------------------------------------------------------------------
        // EscapeMediaBrowserHeaderValue
        //
        // Escapes values placed inside quoted MediaBrowser authorization header fields.
        // This prevents quotes or slashes in computer names, versions, or tokens from
        // breaking the header format.
        // ---------------------------------------------------------------------
        private string EscapeMediaBrowserHeaderValue(string value)
        {
            // Null values should become empty strings inside the quoted header value.
            if (value == null)
            {
                return "";
            }

            // Escape backslashes first so quote escaping does not become ambiguous.
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"");
        }




        // ---------------------------------------------------------------------
        // ParseTrickplayPlaylist
        //
        // Parses Jellyfin's image-only HLS trickplay playlist.
        //
        // Expected tile metadata example:
        // #EXT-X-TILES:RESOLUTION=320x180,LAYOUT=10x10,DURATION=10
        //
        // Expected tile image line example:
        // 0.jpg?MediaSourceId=...&ApiKey=...
        // ---------------------------------------------------------------------
        private JellyfinTrickplayInfo ParseTrickplayPlaylist(
            string itemId,
            int requestedWidth,
            string playlistUrl,
            string playlistText)
        {
            JellyfinTrickplayInfo trickplayInfo = new JellyfinTrickplayInfo();
            trickplayInfo.ItemId = itemId;
            trickplayInfo.RequestedWidth = requestedWidth;
            trickplayInfo.PlaylistUrl = playlistUrl;
            trickplayInfo.RawPlaylistText = playlistText;

            if (String.IsNullOrWhiteSpace(playlistText))
            {
                return trickplayInfo;
            }

            string[] lines = playlistText.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);

            foreach (string rawLine in lines)
            {
                string line = rawLine.Trim();

                if (String.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                if (line.StartsWith("#EXT-X-TILES:", StringComparison.OrdinalIgnoreCase))
                {
                    ParseTrickplayTileMetadata(line, trickplayInfo);
                    continue;
                }

                // Non-comment playlist entries are tile sheet image references.
                // These are relative to the playlist URL, not relative to the server root.
                if (!line.StartsWith("#", StringComparison.Ordinal))
                {
                    string tileImageUrl = BuildAbsoluteUrlRelativeToPlaylist(playlistUrl, line);
                    trickplayInfo.TileImageUrls.Add(tileImageUrl);
                }
            }

            return trickplayInfo;
        }


        // ---------------------------------------------------------------------
        // ParseTrickplayTileMetadata
        //
        // Reads RESOLUTION, LAYOUT, and DURATION fields from Jellyfin's
        // #EXT-X-TILES line.
        // ---------------------------------------------------------------------
        private void ParseTrickplayTileMetadata(string tilesLine, JellyfinTrickplayInfo trickplayInfo)
        {
            string metadata = tilesLine.Substring("#EXT-X-TILES:".Length);
            string[] parts = metadata.Split(',');

            foreach (string rawPart in parts)
            {
                string part = rawPart.Trim();
                int equalsIndex = part.IndexOf('=');

                if (equalsIndex <= 0 || equalsIndex >= part.Length - 1)
                {
                    continue;
                }

                string key = part.Substring(0, equalsIndex).Trim();
                string value = part.Substring(equalsIndex + 1).Trim();

                if (key.Equals("RESOLUTION", StringComparison.OrdinalIgnoreCase))
                {
                    ParseTrickplayResolution(value, trickplayInfo);
                }
                else if (key.Equals("LAYOUT", StringComparison.OrdinalIgnoreCase))
                {
                    ParseTrickplayLayout(value, trickplayInfo);
                }
                else if (key.Equals("DURATION", StringComparison.OrdinalIgnoreCase))
                {
                    double durationSeconds;

                    if (Double.TryParse(
                        value,
                        NumberStyles.Float,
                        CultureInfo.InvariantCulture,
                        out durationSeconds))
                    {
                        trickplayInfo.ThumbnailDurationSeconds = durationSeconds;
                    }
                }
            }
        }


        // ---------------------------------------------------------------------
        // ParseTrickplayResolution
        //
        // Parses thumbnail cell size from values such as 320x180.
        // ---------------------------------------------------------------------
        private void ParseTrickplayResolution(string value, JellyfinTrickplayInfo trickplayInfo)
        {
            string[] pieces = value.Split('x');

            if (pieces.Length != 2)
            {
                return;
            }

            int width;
            int height;

            if (Int32.TryParse(pieces[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out width) &&
                Int32.TryParse(pieces[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out height))
            {
                trickplayInfo.ThumbnailWidth = width;
                trickplayInfo.ThumbnailHeight = height;
            }
        }


        // ---------------------------------------------------------------------
        // ParseTrickplayLayout
        //
        // Parses tile sheet grid size from values such as 10x10.
        // ---------------------------------------------------------------------
        private void ParseTrickplayLayout(string value, JellyfinTrickplayInfo trickplayInfo)
        {
            string[] pieces = value.Split('x');

            if (pieces.Length != 2)
            {
                return;
            }

            int columns;
            int rows;

            if (Int32.TryParse(pieces[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out columns) &&
                Int32.TryParse(pieces[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out rows))
            {
                trickplayInfo.Columns = columns;
                trickplayInfo.Rows = rows;
            }
        }


        // ---------------------------------------------------------------------
        // BuildAbsoluteUrlRelativeToPlaylist
        //
        // Converts tile image references from the trickplay playlist into absolute
        // URLs. Relative image lines such as 0.jpg?... are relative to the playlist
        // path, not to the Jellyfin server root.
        // ---------------------------------------------------------------------
        private string BuildAbsoluteUrlRelativeToPlaylist(string playlistUrl, string playlistLine)
        {
            if (String.IsNullOrWhiteSpace(playlistLine))
            {
                return "";
            }

            if (playlistLine.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                playlistLine.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return playlistLine;
            }

            Uri playlistUri = new Uri(playlistUrl, UriKind.Absolute);
            Uri absoluteTileUri = new Uri(playlistUri, playlistLine);

            return absoluteTileUri.AbsoluteUri;
        }


        // ---------------------------------------------------------------------
        // FormatJellyfinItemIdForVideoEndpoint
        //
        // Converts 32-character Jellyfin GUID ids to hyphenated GUID format for
        // video route endpoints. Non-GUID ids are returned unchanged.
        // ---------------------------------------------------------------------
        private string FormatJellyfinItemIdForVideoEndpoint(string itemId)
        {
            if (String.IsNullOrWhiteSpace(itemId))
            {
                return "";
            }

            string trimmedItemId = itemId.Trim();

            if (trimmedItemId.Length != 32)
            {
                return trimmedItemId;
            }

            for (int i = 0; i < trimmedItemId.Length; i++)
            {
                if (!Uri.IsHexDigit(trimmedItemId[i]))
                {
                    return trimmedItemId;
                }
            }

            Guid itemGuid;

            if (Guid.TryParseExact(trimmedItemId, "N", out itemGuid))
            {
                return itemGuid.ToString("D");
            }

            return trimmedItemId;
        }

    }


    // -------------------------------------------------------------------------
    // JellyfinApiSession
    //
    // Stores the active Jellyfin API client instance for the app. This lets the
    // Jellyfin browser authenticate first, while the video player can later reuse
    // the same authenticated client for playback quality switching.
    // -------------------------------------------------------------------------
    public static class JellyfinApiSession
    {
        // Temporary development credentials used for automatic Jellyfin authentication.
        // Later this should be replaced by a real login/settings flow before video load.
        public const string DefaultServerUrl = "http://47.208.203.78:8096";
        public const string DefaultUsername = "guest1";
        public const string DefaultPassword = "guest1";


        private static JellyfinApiClient _activeClient = null;

        // ---------------------------------------------------------------------
        // ActivePlaybackState
        //
        // Stores the currently selected Jellyfin media and playback options. This is
        // separate from the authenticated client so UI code can read current playback
        // state without owning Jellyfin API/session details.
        // ---------------------------------------------------------------------
        public static JellyfinPlaybackState ActivePlaybackState { get; private set; } = new JellyfinPlaybackState();

        // ---------------------------------------------------------------------
        // SetActivePlaybackState
        //
        // Replaces the current Jellyfin playback state after the browser selects a
        // media item or the player changes quality.
        // ---------------------------------------------------------------------
        public static void SetActivePlaybackState(JellyfinPlaybackState playbackState)
        {
            ActivePlaybackState = playbackState ?? new JellyfinPlaybackState();
        }


        // ---------------------------------------------------------------------
        // EnsureAuthenticatedAsync
        //
        // Ensures the shared Jellyfin API client is authenticated. This UI-capable
        // overload first reuses the current session, then tries saved credentials from
        // Documents/Jellyfin_API_CREDS, then opens JellyfinSignInWindow if needed.
        // ---------------------------------------------------------------------
        public static async Task<bool> EnsureAuthenticatedAsync(Window ownerWindow)
        {
            // Reuse the existing authenticated Jellyfin session when possible.
            // ActiveClient creates the shared client on first access.
            if (ActiveClient.IsAuthenticated)
            {
                return true;
            }

            string savedServerUrl = "";
            string savedUsername = "";
            string savedPassword = "";

            // Try loading saved credentials from the user's Documents folder.
            bool hasSavedCredentials = Functions.TryLoadJellyfinCredentials(
                out savedServerUrl,
                out savedUsername,
                out savedPassword
            );

            // Saved credentials should be attempted before interrupting the user.
            if (hasSavedCredentials)
            {
                bool savedCredentialsWorked = await ActiveClient.TryAuthenticateAsync(
                    savedServerUrl,
                    savedUsername,
                    savedPassword
                );

                // If the saved credentials worked, the shared client is now ready.
                if (savedCredentialsWorked)
                {
                    Functions.log("JELLYFIN", "Authenticated Jellyfin using saved credentials.");
                    return true;
                }
            }

            // Saved credentials are missing or invalid, so prompt the user.
            JellyfinSignInWindow signInWindow = new JellyfinSignInWindow();
            signInWindow.Owner = ownerWindow;

            bool? result = signInWindow.ShowDialog();

            // User cancelled sign-in.
            if (result != true)
            {
                Functions.log("JELLYFIN", "Jellyfin sign-in cancelled by user.");
                return false;
            }

            // Try the user-entered credentials through the Jellyfin API client.
            bool enteredCredentialsWorked = await ActiveClient.TryAuthenticateAsync(
                signInWindow.ServerUrl,
                signInWindow.Username,
                signInWindow.Password
            );

            // Failed manual sign-in should not save anything to disk.
            if (!enteredCredentialsWorked)
            {
                MessageBox.Show(
                    "Jellyfin sign-in failed. Check the server URL, username, and password.",
                    "Jellyfin Sign In",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );

                return false;
            }

            // Save only credentials that Jellyfin accepted.
            Functions.SaveJellyfinCredentials(
                signInWindow.ServerUrl,
                signInWindow.Username,
                signInWindow.Password
            );

            return true;
        }


        // -----------------------------------------------------------------------------
        // TryLoadPlaybackStateByVideoNameAsync
        //
        // Attempts to resolve a saved database video location by searching Jellyfin.
        //
        // Old database records may contain a local path from another computer rather
        // than a stable Jellyfin item reference. This method converts that saved value
        // into several conservative search terms, searches Jellyfin, scores every
        // returned video, and builds the normal shared playback state for the strongest
        // acceptable match.
        //
        // A score threshold is used so a broad timestamp or partial-name search does not
        // silently load an unrelated video. Exact normalized filename matches receive
        // the strongest scores.
        //
        // Input:
        //     videoLocation - Original filename or path stored in the database.
        //
        // Output:
        //     Fully populated JellyfinPlaybackState when a reliable match is found.
        //     Null when no acceptable match is found or the search cannot be completed.
        //
        // Usage:
        //     Called by Functions.setVideoSourceAsync after local path and saved local
        //     translation resolution have failed.
        // -----------------------------------------------------------------------------
        public static async Task<JellyfinPlaybackState> TryLoadPlaybackStateByVideoNameAsync(
            string videoLocation
        )
        {
            if (String.IsNullOrWhiteSpace(videoLocation))
            {
                return null;
            }

            try
            {
                // Searching and playback-state construction both require the shared
                // Jellyfin client to have a valid authenticated session.
                await EnsureAuthenticatedAsync();

                JellyfinApiClient client = ActiveClient;

                // Use multiple terms because the database, Windows filesystem, and
                // Jellyfin item name may represent separators and extensions differently.
                List<string> searchTerms = BuildVideoSearchTerms(videoLocation);

                JellyfinItemDto bestItem = null;
                int bestScore = 0;
                string bestSearchTerm = "";

                foreach (string searchTerm in searchTerms)
                {
                    Functions.log(
                        "JELLYFIN",
                        "Searching for saved video using term: " + searchTerm
                    );

                    JellyfinItemsResponse searchResponse =
                        await client.SearchVideoItemsAsync(searchTerm, 20);

                    if (searchResponse == null || searchResponse.Items == null)
                    {
                        continue;
                    }

                    foreach (JellyfinItemDto item in searchResponse.Items)
                    {
                        int score = ScoreJellyfinVideoMatch(videoLocation, item);

                        Functions.log(
                            "JELLYFIN",
                            "Search candidate: " +
                            (item != null ? item.Name : "") +
                            " Score=" +
                            score.ToString(CultureInfo.InvariantCulture)
                        );

                        if (score > bestScore)
                        {
                            bestItem = item;
                            bestScore = score;
                            bestSearchTerm = searchTerm;
                        }
                    }

                    // Scores at or above 95 represent an exact normalized filename or
                    // path filename match. Additional broader searches are unnecessary.
                    if (bestScore >= 95)
                    {
                        break;
                    }
                }

                // Reject weak matches rather than silently opening the wrong dive video.
                if (bestItem == null ||
                    String.IsNullOrWhiteSpace(bestItem.Id) ||
                    bestScore < 60)
                {
                    Functions.log(
                        "JELLYFIN",
                        "No reliable Jellyfin match found for saved video: " +
                        videoLocation +
                        " BestScore=" +
                        bestScore.ToString(CultureInfo.InvariantCulture)
                    );

                    return null;
                }

                string thumbnailUrl = "";

                // Use a Thumb image when Jellyfin reports one for this item.
                if (JellyfinItemHasImageType(bestItem, "Thumb"))
                {
                    thumbnailUrl = client.BuildThumbImageUrl(bestItem.Id, 640);
                }
                // Fall back to Primary because some videos expose a Primary image but
                // do not expose a separate Thumb image.
                else if (JellyfinItemHasImageType(bestItem, "Primary"))
                {
                    thumbnailUrl = client.BuildPrimaryImageUrl(bestItem.Id, 640);
                }

                Functions.log(
                    "JELLYFIN",
                    "Resolved saved video through Jellyfin. " +
                    "Requested=" + videoLocation +
                    " Item=" + bestItem.Name +
                    " ItemId=" + bestItem.Id +
                    " Score=" + bestScore.ToString(CultureInfo.InvariantCulture) +
                    " SearchTerm=" + bestSearchTerm
                );

                // Reuse the existing playback-state path so browser-selected and
                // filename-resolved videos receive identical playback options and state.
                return await LoadPlaybackStateForItemAsync(
                    bestItem.Id,
                    bestItem.Name ?? "",
                    bestItem.Path ?? "",
                    thumbnailUrl,
                    bestItem.RunTimeTicks.HasValue
                        ? bestItem.RunTimeTicks.Value
                        : 0
                );
            }
            catch (Exception ex)
            {
                // Filename resolution is an optional recovery path. Failure should leave
                // the existing local translation and manual file-selection fallback usable.
                Functions.log(
                    "JELLYFIN",
                    "Jellyfin filename resolution failed for " +
                    videoLocation +
                    ": " +
                    ex.Message
                );

                return null;
            }
        }

        // -----------------------------------------------------------------------------
        // BuildVideoSearchTerms
        //
        // Builds ordered Jellyfin search terms from a saved database video location.
        //
        // The most specific forms are searched first. Broader filename and timestamp
        // forms are included because old records may contain full Windows paths while
        // Jellyfin stores only a title, or because spaces and underscores may differ.
        //
        // Input:
        //     videoLocation - Saved filename, local path, or database video source.
        //
        // Output:
        //     Ordered, case-insensitively de-duplicated list of nonblank search terms.
        //
        // Usage:
        //     Used before calling JellyfinApiClient.SearchVideoItemsAsync.
        // -----------------------------------------------------------------------------
        private static List<string> BuildVideoSearchTerms(string videoLocation)
        {
            List<string> searchTerms = new List<string>();

            string rawValue = videoLocation == null
                ? ""
                : videoLocation.Trim();

            if (String.IsNullOrWhiteSpace(rawValue))
            {
                return searchTerms;
            }

            // Path.GetFileName handles the normal Windows path stored by the annotation
            // application. Normalize alternate separators as an additional safeguard.
            string normalizedPathValue = rawValue.Replace('/', Path.DirectorySeparatorChar);
            string fileName = Path.GetFileName(normalizedPathValue);

            if (String.IsNullOrWhiteSpace(fileName))
            {
                fileName = rawValue;
            }

            string fileNameStem = Path.GetFileNameWithoutExtension(fileName);

            string underscoreStem = fileNameStem.Replace(" ", "_");
            string spaceStem = fileNameStem.Replace("_", " ");

            AddUniqueVideoSearchTerm(searchTerms, rawValue);
            AddUniqueVideoSearchTerm(searchTerms, fileName);
            AddUniqueVideoSearchTerm(searchTerms, fileNameStem);
            AddUniqueVideoSearchTerm(searchTerms, underscoreStem);
            AddUniqueVideoSearchTerm(searchTerms, spaceStem);

            // MARE video names commonly contain a date-and-time identifier such as
            // 20240730_190910. It is useful as a broader final search term.
            Match timestampMatch = Regex.Match(
                fileNameStem,
                @"\d{8}[_ \-]\d{6}",
                RegexOptions.CultureInvariant
            );

            if (timestampMatch.Success)
            {
                string timestampValue = timestampMatch.Value;

                AddUniqueVideoSearchTerm(
                    searchTerms,
                    timestampValue.Replace(" ", "_")
                );

                AddUniqueVideoSearchTerm(
                    searchTerms,
                    timestampValue.Replace("_", " ")
                );
            }

            return searchTerms;
        }

        // -----------------------------------------------------------------------------
        // AddUniqueVideoSearchTerm
        //
        // Adds one nonblank search term when the same term has not already been added.
        //
        // Comparison is case-insensitive, but the original spelling of the first value
        // is retained for the Jellyfin request and diagnostic logs.
        //
        // Inputs:
        //     searchTerms - Ordered destination list.
        //     candidate   - Possible search term.
        //
        // Output:
        //     None. The destination list is updated in place.
        //
        // Usage:
        //     Keeps BuildVideoSearchTerms ordered and free of duplicate requests.
        // -----------------------------------------------------------------------------
        private static void AddUniqueVideoSearchTerm(
            List<string> searchTerms,
            string candidate
        )
        {
            if (searchTerms == null || String.IsNullOrWhiteSpace(candidate))
            {
                return;
            }

            string cleanedCandidate = candidate.Trim();

            bool alreadyExists = searchTerms.Any(
                existingTerm => String.Equals(
                    existingTerm,
                    cleanedCandidate,
                    StringComparison.OrdinalIgnoreCase
                )
            );

            if (!alreadyExists)
            {
                searchTerms.Add(cleanedCandidate);
            }
        }

        // -----------------------------------------------------------------------------
        // ScoreJellyfinVideoMatch
        //
        // Scores how closely one Jellyfin video matches a saved database video location.
        //
        // The comparison checks both the Jellyfin display name and the basename of its
        // server-side path. Separators, punctuation, case, and common video extensions
        // are ignored so values such as:
        //
        //     20240730_190910 Fwd.mp4
        //     20240730_190910_Fwd
        //
        // can be treated as the same video name.
        //
        // Inputs:
        //     requestedVideoLocation - Filename or path stored in the database.
        //     item                   - Jellyfin video candidate.
        //
        // Output:
        //     Integer score from zero through 100.
        //
        // Usage:
        //     The resolver selects the highest-scoring candidate and requires at least 60.
        // -----------------------------------------------------------------------------
        private static int ScoreJellyfinVideoMatch(
            string requestedVideoLocation,
            JellyfinItemDto item
        )
        {
            if (item == null)
            {
                return 0;
            }

            string normalizedRequestedPath =
                (requestedVideoLocation ?? "").Replace(
                    '/',
                    Path.DirectorySeparatorChar
                );

            string requestedFileName =
                Path.GetFileName(normalizedRequestedPath);

            if (String.IsNullOrWhiteSpace(requestedFileName))
            {
                requestedFileName = requestedVideoLocation ?? "";
            }

            string requestedStem =
                Path.GetFileNameWithoutExtension(requestedFileName);

            string itemName = item.Name ?? "";

            string normalizedItemPath =
                (item.Path ?? "").Replace(
                    '/',
                    Path.DirectorySeparatorChar
                );

            string itemPathFileName =
                Path.GetFileName(normalizedItemPath);

            string itemPathStem =
                Path.GetFileNameWithoutExtension(itemPathFileName);

            string requestedStemKey =
                NormalizeVideoMatchKey(requestedStem);

            string requestedFileKey =
                NormalizeVideoMatchKey(requestedFileName);

            string itemNameKey =
                NormalizeVideoMatchKey(itemName);

            string itemPathStemKey =
                NormalizeVideoMatchKey(itemPathStem);

            string itemPathFileKey =
                NormalizeVideoMatchKey(itemPathFileName);

            // Exact Jellyfin display-name match is the strongest and most common case.
            if (!String.IsNullOrWhiteSpace(requestedStemKey) &&
                requestedStemKey == itemNameKey)
            {
                return 100;
            }

            // Exact match against the filename represented by Jellyfin's source path.
            if (!String.IsNullOrWhiteSpace(requestedStemKey) &&
                requestedStemKey == itemPathStemKey)
            {
                return 98;
            }

            // Exact full filename match is strong when the path contains an extension.
            if (!String.IsNullOrWhiteSpace(requestedFileKey) &&
                requestedFileKey == itemPathFileKey)
            {
                return 96;
            }

            // Jellyfin may append additional text to an otherwise exact item title.
            if (!String.IsNullOrWhiteSpace(requestedStemKey) &&
                itemNameKey.Contains(requestedStemKey))
            {
                return 85;
            }

            // Containment in the source path filename is slightly weaker.
            if (!String.IsNullOrWhiteSpace(requestedStemKey) &&
                itemPathStemKey.Contains(requestedStemKey))
            {
                return 82;
            }

            // The saved database value may contain a suffix absent from Jellyfin.
            if (!String.IsNullOrWhiteSpace(itemNameKey) &&
                requestedStemKey.Contains(itemNameKey))
            {
                return 75;
            }

            // Matching only the timestamp is useful as a fallback, but it is not treated
            // as strongly as an exact or contained filename match.
            string requestedTimestamp =
                ExtractVideoTimestampKey(requestedStem);

            string itemTimestamp =
                ExtractVideoTimestampKey(
                    itemName + " " + itemPathFileName
                );

            if (!String.IsNullOrWhiteSpace(requestedTimestamp) &&
                requestedTimestamp == itemTimestamp)
            {
                return 70;
            }

            return 0;
        }

        // -----------------------------------------------------------------------------
        // NormalizeVideoMatchKey
        //
        // Converts a video name into a conservative comparison key.
        //
        // Common video extensions are removed. Spaces, underscores, and hyphens are
        // treated as equivalent separators. Remaining punctuation is removed and the
        // result is lowercased.
        //
        // Input:
        //     value - Filename, filename stem, Jellyfin item name, or path basename.
        //
        // Output:
        //     Lowercase alphanumeric comparison key.
        //
        // Usage:
        //     Used by ScoreJellyfinVideoMatch before equality and containment checks.
        // -----------------------------------------------------------------------------
        private static string NormalizeVideoMatchKey(string value)
        {
            string normalized = value == null
                ? ""
                : value.Trim().ToLowerInvariant();

            normalized = Regex.Replace(
                normalized,
                @"\.(mp4|mov|mkv|avi|m4v)$",
                "",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant
            );

            normalized = Regex.Replace(
                normalized,
                @"[\s_\-]+",
                "",
                RegexOptions.CultureInvariant
            );

            normalized = Regex.Replace(
                normalized,
                @"[^a-z0-9]",
                "",
                RegexOptions.CultureInvariant
            );

            return normalized;
        }

        // -----------------------------------------------------------------------------
        // ExtractVideoTimestampKey
        //
        // Extracts the common MARE date-and-time identifier from a video name.
        //
        // Supported examples:
        //     20240730_190910
        //     20240730 190910
        //     20240730-190910
        //
        // Input:
        //     value - Filename, path basename, or combined Jellyfin item text.
        //
        // Output:
        //     Fourteen-digit yyyymmddhhmmss key, or an empty string when absent.
        //
        // Usage:
        //     Provides a broad fallback signal during Jellyfin match scoring.
        // -----------------------------------------------------------------------------
        private static string ExtractVideoTimestampKey(string value)
        {
            Match timestampMatch = Regex.Match(
                value ?? "",
                @"(\d{8})[_ \-](\d{6})",
                RegexOptions.CultureInvariant
            );

            if (!timestampMatch.Success)
            {
                return "";
            }

            return timestampMatch.Groups[1].Value +
                   timestampMatch.Groups[2].Value;
        }

        // -----------------------------------------------------------------------------
        // JellyfinItemHasImageType
        //
        // Reports whether a Jellyfin item declares a specific image type.
        //
        // Jellyfin image dictionaries may vary in key casing, so this comparison is
        // performed case-insensitively rather than relying on Dictionary.ContainsKey.
        //
        // Inputs:
        //     item      - Jellyfin item returned by a search.
        //     imageType - Jellyfin image type such as Thumb or Primary.
        //
        // Output:
        //     True when the item declares the requested image type.
        //
        // Usage:
        //     Used when constructing optional playback-state thumbnail URLs.
        // -----------------------------------------------------------------------------
        private static bool JellyfinItemHasImageType(
            JellyfinItemDto item,
            string imageType
        )
        {
            if (item == null ||
                item.ImageTags == null ||
                String.IsNullOrWhiteSpace(imageType))
            {
                return false;
            }

            return item.ImageTags.Keys.Any(
                key => String.Equals(
                    key,
                    imageType,
                    StringComparison.OrdinalIgnoreCase
                )
            );
        }


        // ---------------------------------------------------------------------
        // TryExtractItemIdFromJellyfinVideoReference
        //
        // Attempts to recover a Jellyfin item ID from either a saved Jellyfin stream
        // URL or from the app's stable Jellyfin item reference format:
        //
        //     jellyfin:item:{itemId}
        //
        // This lets database/session restore avoid saving temporary stream URLs while
        // still preserving a loadable Jellyfin identity.
        // ---------------------------------------------------------------------
        public static bool TryExtractItemIdFromJellyfinVideoReference(string videoLocation, out string itemId)
        {
            itemId = "";

            if (String.IsNullOrWhiteSpace(videoLocation))
            {
                return false;
            }

            string trimmedLocation = videoLocation.Trim();

            const string itemPrefix = "jellyfin:item:";

            if (trimmedLocation.StartsWith(itemPrefix, StringComparison.OrdinalIgnoreCase))
            {
                itemId = trimmedLocation.Substring(itemPrefix.Length).Replace("-", "").Trim();
                return !String.IsNullOrWhiteSpace(itemId);
            }

            return TryExtractItemIdFromJellyfinVideoUrl(trimmedLocation, out itemId);
        }

        // ---------------------------------------------------------------------
        // EnsureAuthenticatedAsync
        //
        // Ensures the shared Jellyfin API client has authenticated session state
        // before lower-level code attempts to query PlaybackInfo or build transcoding
        // options.
        //
        // This no-UI overload does not open a sign-in window because it may be called
        // from playback/session code that has no owner window. It can reuse an active
        // session or saved credentials, but if neither works it throws and the caller
        // should route through a UI workflow.
        // ---------------------------------------------------------------------
        public static async Task EnsureAuthenticatedAsync()
        {
            // ActiveClient creates the shared Jellyfin API client on first access.
            JellyfinApiClient client = ActiveClient;

            // Existing authenticated session is ready for API calls.
            if (client.IsAuthenticated)
            {
                return;
            }

            string savedServerUrl = "";
            string savedUsername = "";
            string savedPassword = "";

            // Try saved credentials from Documents/Jellyfin_API_CREDS. This allows
            // non-browser playback restore paths to recover a Jellyfin session without
            // using hard-coded development credentials.
            bool hasSavedCredentials = Functions.TryLoadJellyfinCredentials(
                out savedServerUrl,
                out savedUsername,
                out savedPassword
            );

            if (hasSavedCredentials)
            {
                // Use the API client authentication path so BaseUrl, AccessToken, and
                // UserId are populated exactly the same way as normal sign-in.
                bool savedCredentialsWorked = await client.TryAuthenticateAsync(
                    savedServerUrl,
                    savedUsername,
                    savedPassword
                );

                // Saved credentials worked, so the shared client is ready.
                if (savedCredentialsWorked)
                {
                    Functions.log("JELLYFIN", "Authenticated Jellyfin using saved credentials.");
                    return;
                }
            }

            // No UI owner exists in this overload, so do not open a sign-in dialog here.
            // Window-level callers should use EnsureAuthenticatedAsync(Window ownerWindow).
            throw new Exception(
                "Jellyfin is not authenticated. Saved credentials are missing or invalid. " +
                "Use a Jellyfin UI workflow to sign in."
            );
        }

        // ---------------------------------------------------------------------
        // ForceDefaultAuthenticationAsync
        //
        // Clears the shared Jellyfin session and signs in again using the temporary
        // hardcoded development credentials. This is used by auto-load recovery when
        // a saved Jellyfin URL can identify the item, but the current token is missing,
        // stale, or rejected by the server.
        // ---------------------------------------------------------------------
        public static async Task ForceDefaultAuthenticationAsync()
        {
            Reset();

            Functions.log(
                "JELLYFIN",
                "Forcing fresh Jellyfin development login. Server=" +
                DefaultServerUrl +
                " Username=" +
                DefaultUsername
            );

            await ActiveClient.AuthenticateAsync(
                DefaultServerUrl,
                DefaultUsername,
                DefaultPassword
            );
        }


        // ---------------------------------------------------------------------
        // LoadPlaybackStateForItemAsync
        //
        // Builds the active Jellyfin playback state for one media item.
        //
        // This method is intentionally not part of JellyfinBrowserWindow. The browser
        // is only one way to choose a Jellyfin item. Database restore, recent media,
        // or future session reload code should all be able to rebuild the same
        // PlaybackInfo, option list, selected mode, and stream URL from a Jellyfin item ID.
        // ---------------------------------------------------------------------
        public static async Task<JellyfinPlaybackState> LoadPlaybackStateForItemAsync(
            string itemId,
            string name,
            string path,
            string thumbnailUrl,
            long runTimeTicks
        )
        {
            if (String.IsNullOrWhiteSpace(itemId))
            {
                throw new ArgumentException("Jellyfin item ID is required.", "itemId");
            }

            // Ensure the shared client is authenticated before querying Jellyfin. This is
            // required for database-loaded Jellyfin media because that path may not have
            // opened JellyfinBrowserWindow first.
            await EnsureAuthenticatedAsync();

            // Reuse the shared authenticated client. This keeps the Jellyfin login
            // session stable across browser windows, video player instances, and later
            // playback quality changes.
            JellyfinApiClient client = ActiveClient;

            // Ask Jellyfin for source media capabilities. This gives us the source
            // bitrate, stream codecs, MediaSourceId, PlaySessionId, and whether
            // transcoding is allowed for this item.
            JellyfinPlaybackInfoResponse playbackInfo = await client.GetPlaybackInfoAsync(
                itemId,
                8000000
            );

            // Jellyfin does not return a ready-made quality menu, so build our app-level
            // choices from the source capabilities. This is where Auto, Original, 1080p,
            // 720p, and 480p are created.
            List<JellyfinPlaybackOption> playbackOptions =
                client.BuildPlaybackOptions(playbackInfo);

            // Use Original / Direct as the initial selection while Jellyfin transcode
            // seeking is still being stabilized. Direct playback has been verified to
            // preserve paused slider seeks correctly, while forced transcode streams can
            // resume from the wrong backend stream position.
            JellyfinPlaybackOption selectedPlaybackOption = playbackOptions
                .FirstOrDefault(option => option.IsOriginal);

            // If Original is not available, fall back to Auto so the item can still load.
            if (selectedPlaybackOption == null)
            {
                selectedPlaybackOption = playbackOptions
                    .FirstOrDefault(option => option.IsAuto);
            }

            // Final fallback: use the first available option if neither Original nor Auto
            // was generated for this item.
            if (selectedPlaybackOption == null && playbackOptions.Count > 0)
            {
                selectedPlaybackOption = playbackOptions[0];
            }

            // Convert the selected app-level option into the actual Jellyfin playback
            // URL. This keeps endpoint/query-string rules out of browser and player UI.
            string streamUrl = client.BuildStreamUrlForPlaybackOption(
                itemId,
                playbackInfo,
                selectedPlaybackOption
            );

            // Store all Jellyfin media/playback state in one shared object. VideoPlayer
            // can read this for the overlay, but it does not need to own Jellyfin session
            // state or rebuild API details itself.
            JellyfinPlaybackState playbackState = new JellyfinPlaybackState
            {
                ItemId = itemId,
                Name = name ?? "",
                Path = path ?? "",
                ThumbnailUrl = thumbnailUrl ?? "",
                RunTimeTicks = runTimeTicks,

                PlaybackInfo = playbackInfo,
                PlaybackOptions = playbackOptions,
                SelectedPlaybackOption = selectedPlaybackOption,
                CurrentStreamUrl = streamUrl
            };

            // Publish the state after it is fully built so UI code never sees a half
            // populated Jellyfin playback state.
            SetActivePlaybackState(playbackState);

            return playbackState;
        }

        // ---------------------------------------------------------------------
        // TryExtractItemIdFromJellyfinVideoUrl
        //
        // Attempts to recover a Jellyfin item ID from an existing Jellyfin playback
        // URL. This supports old database rows that stored the final stream URL instead
        // of storing stable Jellyfin media identity fields.
        //
        // Expected URL shape:
        //     /Videos/{itemId}/stream
        //     /Videos/{itemId}/master.m3u8
        //
        // Jellyfin may place the item ID in either compact form:
        //     09ecb77217608fc6e87bdd76531df897
        //
        // or GUID-style hyphenated form:
        //     09ecb772-1760-8fc6-e87b-dd76531df897
        //
        // The rest of this app stores and uses the compact item ID, so this method
        // normalizes extracted IDs by removing hyphens.
        // ---------------------------------------------------------------------
        public static bool TryExtractItemIdFromJellyfinVideoUrl(string videoLocation, out string itemId)
        {
            itemId = "";

            if (String.IsNullOrWhiteSpace(videoLocation))
            {
                return false;
            }

            Uri uri;

            if (!Uri.TryCreate(videoLocation, UriKind.Absolute, out uri))
            {
                return false;
            }

            string absolutePath = uri.AbsolutePath;

            if (String.IsNullOrWhiteSpace(absolutePath))
            {
                return false;
            }

            string[] parts = absolutePath.Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);

            for (int i = 0; i < parts.Length - 1; i++)
            {
                if (String.Equals(parts[i], "Videos", StringComparison.OrdinalIgnoreCase))
                {
                    string extractedItemId = parts[i + 1];

                    if (String.IsNullOrWhiteSpace(extractedItemId))
                    {
                        return false;
                    }

                    // Jellyfin stream URLs can expose item IDs as GUID-style hyphenated
                    // values, while the app usually stores compact Jellyfin IDs. Normalize
                    // here so old saved stream URLs can still rebuild PlaybackInfo.
                    extractedItemId = extractedItemId.Replace("-", "").Trim();

                    if (extractedItemId.Length == 0)
                    {
                        return false;
                    }

                    itemId = extractedItemId;
                    return true;
                }
            }

            return false;
        }

        // ---------------------------------------------------------------------
        // ActiveClient
        //
        // Returns the current Jellyfin API client. A new unauthenticated client is
        // created on first access so all Jellyfin UI and playback code can share
        // the same client instance without each window owning its own session.
        // ---------------------------------------------------------------------
        public static JellyfinApiClient ActiveClient
        {
            get
            {
                if (_activeClient == null)
                {
                    _activeClient = new JellyfinApiClient();
                }

                return _activeClient;
            }
        }

        // ---------------------------------------------------------------------
        // Reset
        //
        // Clears the current Jellyfin API client. Use this when we intentionally
        // want to discard the existing Jellyfin login/session and start fresh.
        // ---------------------------------------------------------------------
        public static void Reset()
        {
            _activeClient = new JellyfinApiClient();
            ActivePlaybackState = new JellyfinPlaybackState();
        }
    }


    // -----------------------------------------------------------------------------
    // JellyfinTrickplayInfo
    //
    // Parsed metadata from Jellyfin's image-only trickplay playlist.
    //
    // A trickplay tile image is not one thumbnail. It is a sheet containing many
    // thumbnail cells. The preview time maps to a thumbnail index, then to a tile
    // sheet URL, then to a row/column crop inside that sheet.
    // -----------------------------------------------------------------------------
    public class JellyfinTrickplayInfo
    {
        public string ItemId { get; set; }
        public int RequestedWidth { get; set; }
        public string PlaylistUrl { get; set; }
        public string RawPlaylistText { get; set; }

        public int ThumbnailWidth { get; set; }
        public int ThumbnailHeight { get; set; }
        public int Columns { get; set; }
        public int Rows { get; set; }

        public double ThumbnailDurationSeconds { get; set; }

        public List<string> TileImageUrls { get; set; }

        public JellyfinTrickplayInfo()
        {
            TileImageUrls = new List<string>();
        }

        public int ThumbnailsPerTile
        {
            get
            {
                return Columns * Rows;
            }
        }

        public bool IsUsable
        {
            get
            {
                return ThumbnailWidth > 0 &&
                       ThumbnailHeight > 0 &&
                       Columns > 0 &&
                       Rows > 0 &&
                       ThumbnailDurationSeconds > 0 &&
                       TileImageUrls != null &&
                       TileImageUrls.Count > 0;
            }
        }

        public int GetThumbnailIndex(TimeSpan mediaTime)
        {
            if (ThumbnailDurationSeconds <= 0)
            {
                return 0;
            }

            double seconds = mediaTime.TotalSeconds;

            if (seconds < 0)
            {
                seconds = 0;
            }

            return (int)Math.Floor(seconds / ThumbnailDurationSeconds);
        }

        public int GetClampedThumbnailIndex(TimeSpan mediaTime)
        {
            int thumbnailIndex = GetThumbnailIndex(mediaTime);

            if (thumbnailIndex < 0)
            {
                thumbnailIndex = 0;
            }

            int maxAvailableThumbnailIndex = GetMaxAvailableThumbnailIndex();

            if (maxAvailableThumbnailIndex >= 0 &&
                thumbnailIndex > maxAvailableThumbnailIndex)
            {
                thumbnailIndex = maxAvailableThumbnailIndex;
            }

            return thumbnailIndex;
        }

        public int GetMaxAvailableThumbnailIndex()
        {
            if (TileImageUrls == null ||
                TileImageUrls.Count <= 0 ||
                ThumbnailsPerTile <= 0)
            {
                return -1;
            }

            return (TileImageUrls.Count * ThumbnailsPerTile) - 1;
        }

        public int GetTileImageIndex(TimeSpan mediaTime)
        {
            int thumbnailsPerTile = ThumbnailsPerTile;

            if (thumbnailsPerTile <= 0)
            {
                return 0;
            }

            return GetClampedThumbnailIndex(mediaTime) / thumbnailsPerTile;
        }

        public int GetLocalThumbnailIndex(TimeSpan mediaTime)
        {
            int thumbnailsPerTile = ThumbnailsPerTile;

            if (thumbnailsPerTile <= 0)
            {
                return 0;
            }

            return GetClampedThumbnailIndex(mediaTime) % thumbnailsPerTile;
        }

        public int GetColumn(TimeSpan mediaTime)
        {
            if (Columns <= 0)
            {
                return 0;
            }

            return GetLocalThumbnailIndex(mediaTime) % Columns;
        }

        public int GetRow(TimeSpan mediaTime)
        {
            if (Columns <= 0)
            {
                return 0;
            }

            return GetLocalThumbnailIndex(mediaTime) / Columns;
        }

        public string GetTileImageUrl(TimeSpan mediaTime)
        {
            if (TileImageUrls == null || TileImageUrls.Count == 0)
            {
                return "";
            }

            int tileImageIndex = GetTileImageIndex(mediaTime);

            if (tileImageIndex < 0)
            {
                tileImageIndex = 0;
            }

            if (tileImageIndex >= TileImageUrls.Count)
            {
                tileImageIndex = TileImageUrls.Count - 1;
            }

            return TileImageUrls[tileImageIndex];
        }
    }


        // -------------------------------------------------------------------------
        // JellyfinPlaybackState
        //
        // Stores the currently selected Jellyfin media item and playback option state.
        // This keeps Jellyfin-specific media/session details out of VideoPlayer while
        // still allowing the video overlay to display and change playback quality.
        // -------------------------------------------------------------------------
        public class JellyfinPlaybackState
    {
        public string ItemId { get; set; } = "";
        public string Name { get; set; } = "";
        public string Path { get; set; } = "";
        public string ThumbnailUrl { get; set; } = "";
        public long RunTimeTicks { get; set; } = 0;

        public string EffectivePlaybackDisplayName { get; set; } = "";

        public JellyfinPlaybackInfoResponse PlaybackInfo { get; set; } = null;
        public List<JellyfinPlaybackOption> PlaybackOptions { get; set; } = new List<JellyfinPlaybackOption>();
        public JellyfinPlaybackOption SelectedPlaybackOption { get; set; } = null;
        public string CurrentStreamUrl { get; set; } = "";
    }


    // -------------------------------------------------------------------------
    // Jellyfin DTO classes
    //
    // Minimal JSON models for the Jellyfin API responses used by this browser.
    // These are intentionally limited to the fields we currently need.
    // -------------------------------------------------------------------------
    public class JellyfinAuthenticateResponse
    {
        public JellyfinUser User { get; set; }
        public string AccessToken { get; set; }
        public string ServerId { get; set; }

        // Jellyfin returns SessionInfo as an object, not a string.
        public object SessionInfo { get; set; }
    }

    public class JellyfinUser
    {
        public string Name { get; set; }
        public string ServerId { get; set; }
        public string Id { get; set; }
        public bool HasPassword { get; set; }
    }

    public class JellyfinItemsResponse
    {
        public List<JellyfinItemDto> Items { get; set; }
        public int? TotalRecordCount { get; set; }
        public int? StartIndex { get; set; }
    }

    public class JellyfinItemDto
    {
        // Basic Jellyfin identity and display fields.
        public string Name { get; set; }
        public string ServerId { get; set; }
        public string Id { get; set; }
        public string Etag { get; set; }
        public string Type { get; set; }
        public string Path { get; set; }
        public string Overview { get; set; }

        // Folder/media classification fields returned by Jellyfin.
        public bool? IsFolder { get; set; }
        public string MediaType { get; set; }
        public string Container { get; set; }

        // Folder and runtime metadata used by the browser UI.
        public int? ChildCount { get; set; }
        public long? RunTimeTicks { get; set; }

        // Date metadata shown in the browser and details panel.
        public DateTime? DateCreated { get; set; }

        // Image metadata tells the browser which Jellyfin image endpoints exist.
        // Example keys from your server are Primary, Thumb, Box, Menu, and Logo.
        public Dictionary<string, string> ImageTags { get; set; }
        public List<string> BackdropImageTags { get; set; }
        public double? PrimaryImageAspectRatio { get; set; }

        // Media metadata. MediaSources gives file/source information, while
        // some Jellyfin responses also include top-level MediaStreams.
        public List<JellyfinMediaSource> MediaSources { get; set; }
        public List<JellyfinMediaStream> MediaStreams { get; set; }
    }

    public class JellyfinMediaSource
    {
        public string Id { get; set; }
        public string Path { get; set; }
        public string Container { get; set; }
        public string Name { get; set; }
        public string Protocol { get; set; }

        public long? Size { get; set; }
        public int? Bitrate { get; set; }
        public long? RunTimeTicks { get; set; }

        public bool? SupportsDirectPlay { get; set; }
        public bool? SupportsDirectStream { get; set; }
        public bool? SupportsTranscoding { get; set; }

        // Jellyfin may return these fields depending on the PlaybackInfo request,
        // selected media source, and device profile.
        public string DirectStreamUrl { get; set; }
        public string TranscodingUrl { get; set; }
        public string TranscodingSubProtocol { get; set; }
        public string TranscodingContainer { get; set; }

        public List<JellyfinMediaStream> MediaStreams { get; set; }
    }

    public class JellyfinMediaStream
    {
        public string Type { get; set; }
        public string Codec { get; set; }

        public int? Width { get; set; }
        public int? Height { get; set; }

        public int? BitRate { get; set; }
        public double? AverageFrameRate { get; set; }
        public double? RealFrameRate { get; set; }
    }

    // -------------------------------------------------------------------------
    // JellyfinPlaybackInfoResponse
    //
    // Minimal response model for /Items/{itemId}/PlaybackInfo. This captures the
    // playback/session fields needed before we build transcode option selection.
    // -------------------------------------------------------------------------
    public class JellyfinPlaybackInfoResponse
    {
        public List<JellyfinMediaSource> MediaSources { get; set; }
        public string PlaySessionId { get; set; }
        public string ErrorCode { get; set; }
    }


    // -------------------------------------------------------------------------
    // JellyfinPlaybackOption
    //
    // App-level playback choice generated from Jellyfin PlaybackInfo. Jellyfin
    // reports source capabilities, while this model represents the choices our
    // player can show to the user.
    // -------------------------------------------------------------------------
    public class JellyfinPlaybackOption
    {
        public string DisplayName { get; set; }
        public string Mode { get; set; }

        public int? MaxStreamingBitrate { get; set; }
        public int? MaxWidth { get; set; }
        public int? MaxHeight { get; set; }

        public bool IsAuto { get; set; }
        public bool IsOriginal { get; set; }
        public bool RequiresTranscoding { get; set; }
    }

}