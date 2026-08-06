/**
 * Bridges a MarpVideoShim instance's events and metadata to
 * chrome.webview.postMessage, in the exact `status|`/`metadata|`/`frame|`
 * text format MareMediaElement.xaml.cs's CoreWebView2_WebMessageReceived
 * handler parses (see that file's HandleStatusMessage/
 * HandleMetadataMessage/HandleFrameMessage) -- ported from the postMessage
 * glue that file's own BuildPlayerHtml() currently generates inline around
 * a plain <video> element, so the C# side needs no changes to its message
 * parsing, only to how its injected HTML loads the player (see this
 * package's README/handoff notes for the replacement HTML).
 *
 * Deliberately a thin translation layer only -- it reads MarpVideoShim's
 * public surface (currentTime/duration/videoWidth/videoHeight/paused/
 * playbackRate, addEventListener, requestVideoFrameCallback) the exact
 * same way any other consumer would, no special internal access.
 *
 * @fileoverview Bridges MarpVideoShim events to chrome.webview.postMessage in MareMediaElement.xaml.cs's expected format.
 * @author Isaac Travers
 * @module video-engine/webview2-bridge
 */

/**
 * Posts a raw string message to the WebView2 host, if one is present.
 * A no-op in a plain browser tab (no window.chrome.webview) so the exact
 * same bundle works unmodified inside and outside the WPF host.
 *
 * @param {string} message - Raw message text.
 * @returns {void}
 */
function postToHost(message) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
    }
}

/**
 * Wires a MarpVideoShim instance's lifecycle events, metadata, and
 * per-frame callback to chrome.webview.postMessage, matching the message
 * format MareMediaElement.xaml.cs already parses.
 *
 * @param {Object} marpVideo - A MarpVideoShim instance (or anything matching its public surface).
 * @returns {void}
 */
export function attachWebView2Bridge(marpVideo) {
    /**
     * Posts a `status|<message>` line -- matches HandleStatusMessage's
     * prefix checks (e.g. `status.StartsWith("loadedmetadata", ...)`).
     *
     * @param {string} message - Status text.
     * @returns {void}
     */
    function postStatus(message) {
        postToHost(`status|${message}`);
    }

    /**
     * Posts a `metadata|<duration>|<width>|<height>` line -- matches
     * HandleMetadataMessage's fixed 4-field split.
     *
     * @returns {void}
     */
    function postMetadata() {
        const duration = Number.isFinite(marpVideo.duration) ? marpVideo.duration : -1;
        const width = marpVideo.videoWidth || -1;
        const height = marpVideo.videoHeight || -1;
        postToHost(`metadata|${duration}|${width}|${height}`);
    }

    // Matches the real callbackCount field HandleFrameMessage expects as
    // its 8th field -- a running count purely for that handler's own
    // periodic ("every 25th frame") logging, not used by this bridge itself.
    let callbackCount = 0;

    /**
     * requestVideoFrameCallback handler -- posts a `frame|...` line per
     * presented frame, matching HandleFrameMessage's fixed 8-field split,
     * then re-registers itself (requestVideoFrameCallback is one-shot).
     *
     * @param {number} now - performance.now()-style timestamp.
     * @param {Object} metadata - Frame metadata from MarpVideoShim.
     * @returns {void}
     */
    function onVideoFrame(now, metadata) {
        callbackCount += 1;

        const mediaTime = metadata.mediaTime ?? -1;
        const presentedFrames = metadata.presentedFrames ?? -1;
        const expectedDisplayTime = metadata.expectedDisplayTime ?? -1;
        const presentationTime = metadata.presentationTime ?? -1;
        const width = metadata.width ?? marpVideo.videoWidth ?? -1;
        const height = metadata.height ?? marpVideo.videoHeight ?? -1;

        postToHost(`frame|${mediaTime}|${presentedFrames}|${expectedDisplayTime}|${presentationTime}|${width}|${height}|${callbackCount}`);

        marpVideo.requestVideoFrameCallback(onVideoFrame);
    }

    marpVideo.addEventListener('loadedmetadata', () => {
        postStatus(`loadedmetadata duration=${marpVideo.duration}`);
        postMetadata();
        // Starts the frame clock -- matches the original inline glue's
        // startFrameClockIfAvailable(), called once on first
        // loadedmetadata. No "is requestVideoFrameCallback available"
        // feature-detection here (unlike the original, which checked
        // HTMLVideoElement.prototype): MarpVideoShim always provides it,
        // it's this engine's own API, not a browser feature to detect.
        marpVideo.requestVideoFrameCallback(onVideoFrame);
    });

    marpVideo.addEventListener('durationchange', postMetadata);
    marpVideo.addEventListener('resize', postMetadata);

    marpVideo.addEventListener('error', (event) => {
        // Unlike a real HTMLVideoElement (MediaError code 1-4), MarpVideoShim
        // exposes the real underlying Error's message instead of a numeric
        // code -- HandleStatusMessage doesn't parse a specific code out of
        // this message today, it only logs unrecognized status text, so a
        // descriptive message is strictly more useful here than a code
        // would be.
        postStatus(`video error ${event.error ? event.error.message : '(no detail)'}`);
    });

    marpVideo.addEventListener('playing', () => postStatus('playing'));
    marpVideo.addEventListener('pause', () => postStatus('pause'));
    marpVideo.addEventListener('seeking', () => postStatus(`seeking currentTime=${marpVideo.currentTime.toFixed(6)}`));
    marpVideo.addEventListener('seeked', () => postStatus(`seeked currentTime=${marpVideo.currentTime.toFixed(6)}`));
}
