    File: MareMediaElement.xaml.cs

    WebView2-backed video element for the MARE annotation GUI.

    This control intentionally mimics the small MediaElement/MareMediaElement surface
    that VideoPlayer.xaml.cs already uses. The critical difference is that Position
    returns the latest displayed-frame media time reported by requestVideoFrameCallback,
    not a coarse backend playback clock.
*/

using System;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using System.IO;
using Microsoft.Web.WebView2.Core;

namespace VIDEO_PLAYER
{
    public partial class MareMediaElement : UserControl, IDisposable
    {
        private Uri source;
        private bool isWebViewInitialized = false;
        private bool isHtmlLoaded = false;
        private bool disposed = false;

        private double latestDisplayedMediaTimeSeconds = 0.0;
        private double latestDurationSeconds = -1.0;

        private int latestNaturalVideoWidth = 0;
        private int latestNaturalVideoHeight = 0;

        private long latestPresentedFrames = -1;
        private long lastPresentedFrames = -1;
        private double lastDisplayedMediaTimeSeconds = -1.0;

        private double requestedVolume = 1.0;
        private double requestedSpeedRatio = 1.0;

        /// <summary>
        /// Raised whenever requestVideoFrameCallback reports a newly displayed frame.
        /// This is the future direct hook for annotation drawing.
        /// </summary>
        public event EventHandler<DisplayedFrameChangedEventArgs> DisplayedFrameChanged;

        public MareMediaElement()
        {
            InitializeComponent();
        }

        /// <summary>
        /// Gets or sets the media source URI.
        /// MP4/direct URLs are assigned directly to video.src.
        /// HLS .m3u8 URLs are loaded with hls.js.
        /// </summary>
        public Uri Source
        {
            get
            {
                return source;
            }

            set
            {
                source = value;

                ResetFrameClockState();

                Console.WriteLine("MareMediaElement Source set: " + source);

                if (source == null)
                {
                    return;
                }

                LoadSourceWhenReady();
            }
        }

        /// <summary>
        /// Gets or sets the current displayed-frame media position.
        /// Getter returns requestVideoFrameCallback metadata.mediaTime.
        /// Setter requests a browser seek. The getter will not reflect the new seek
        /// until the browser presents the target frame and sends the next frame callback.
        /// </summary>
        public TimeSpan Position
        {
            get
            {
                if (latestDisplayedMediaTimeSeconds < 0)
                {
                    return TimeSpan.Zero;
                }

                return TimeSpan.FromSeconds(latestDisplayedMediaTimeSeconds);
            }

            set
            {
                if (value < TimeSpan.Zero)
                {
                    value = TimeSpan.Zero;
                }

                double targetSeconds = value.TotalSeconds;

                ExecuteVideoScript(
                    "if (window.mareVideo) {" +
                    "  window.mareVideo.currentTime = " +
                    targetSeconds.ToString("0.000000", CultureInfo.InvariantCulture) +
                    ";" +
                    "}"
                );
            }
        }

        /// <summary>
        /// Gets the natural media duration.
        /// </summary>
        public Duration NaturalDuration
        {
            get
            {
                if (latestDurationSeconds <= 0 || Double.IsInfinity(latestDurationSeconds) || Double.IsNaN(latestDurationSeconds))
                {
                    return Duration.Automatic;
                }

                return new Duration(TimeSpan.FromSeconds(latestDurationSeconds));
            }
        }

        /// <summary>
        /// Gets the natural video width.
        /// </summary>
        public int NaturalVideoWidth
        {
            get
            {
                return latestNaturalVideoWidth;
            }
        }

        /// <summary>
        /// Gets the natural video height.
        /// </summary>
        public int NaturalVideoHeight
        {
            get
            {
                return latestNaturalVideoHeight;
            }
        }

        /// <summary>
        /// Gets or sets the video stretch mode used by existing MediaElement XAML.
        /// WebView2 uses CSS object-fit. Stretch.Fill maps to object-fit: fill.
        /// </summary>
        public Stretch Stretch
        {
            get;
            set;
        }

        /// <summary>
        /// Gets or sets the playback volume using MediaElement-style 0.0 to 1.0 values.
        /// </summary>
        public double Volume
        {
            get
            {
                return requestedVolume;
            }

            set
            {
                requestedVolume = Math.Max(0.0, Math.Min(1.0, value));

                ExecuteVideoScript(
                    "if (window.mareVideo) {" +
                    "  window.mareVideo.volume = " +
                    requestedVolume.ToString("0.000000", CultureInfo.InvariantCulture) +
                    ";" +
                    "  window.mareVideo.muted = " + (requestedVolume <= 0.0 ? "true" : "false") + ";" +
                    "}"
                );
            }
        }

        public double SpeedRatio
        {
            get
            {
                return requestedSpeedRatio;
            }

            set
            {
                requestedSpeedRatio = value;

                if (requestedSpeedRatio <= 0)
                {
                    requestedSpeedRatio = 1.0;
                }

                ExecuteVideoScript(
                    "if (window.mareVideo) {" +
                    "  window.mareVideo.playbackRate = " +
                    requestedSpeedRatio.ToString(
                        "0.000000",
                        CultureInfo.InvariantCulture
                    ) +
                    ";" +
                    "  console.log('playbackRate:', window.mareVideo.playbackRate);" +
                    "}"
                );
            }
        }

        /// <summary>
        /// Compatibility property for existing MediaElement-era code.
        /// </summary>
        public bool ScrubbingEnabled
        {
            get;
            set;
        }

        /// <summary>
        /// Compatibility property for existing MediaElement-era code.
        /// WebView2 playback is manually controlled by Play/Pause/Stop.
        /// </summary>
        public MediaState LoadedBehavior
        {
            get;
            set;
        }

        /// <summary>
        /// Identifies the OverlayContent dependency property.
        /// </summary>
        public static readonly DependencyProperty OverlayContentProperty =
            DependencyProperty.Register(
                "OverlayContent",
                typeof(object),
                typeof(MareMediaElement),
                new PropertyMetadata(null, OverlayContentChanged));

        /// <summary>
        /// Diagnostic helper for comparing the WPF-side displayed-frame clock
        /// against the browser video element currentTime.
        /// </summary>
        public async void LogBrowserClockSnapshot(string label)
        {
            if (!isWebViewInitialized || webVideo.CoreWebView2 == null)
            {
                Console.WriteLine("[WEBVIEW CLOCK SNAPSHOT] " + label + " WebView2 not initialized.");
                return;
            }

            try
            {
                string result = await webVideo.ExecuteScriptAsync(@"
            (function() {
                if (!window.mareVideo) {
                    return 'no mareVideo';
                }

                return JSON.stringify({
                    currentTime: window.mareVideo.currentTime,
                    paused: window.mareVideo.paused,
                    readyState: window.mareVideo.readyState,
                    seeking: window.mareVideo.seeking,
                    duration: window.mareVideo.duration
                });
            })();
        ");

                Console.WriteLine(
                    "[WEBVIEW CLOCK SNAPSHOT] " +
                    label +
                    " wrapperPosition=" +
                    Position +
                    " browser=" +
                    result
                );
            }
            catch (Exception ex)
            {
                Console.WriteLine("[WEBVIEW CLOCK SNAPSHOT ERROR] " + label + " " + ex);
            }
        }

        /// <summary>
        /// Gets or sets the WPF overlay content displayed above the WebView2 video surface.
        /// </summary>
        public object OverlayContent
        {
            get
            {
                return GetValue(OverlayContentProperty);
            }

            set
            {
                SetValue(OverlayContentProperty, value);
            }
        }

        /// <summary>
        /// Applies new overlay content to the wrapper overlay presenter.
        /// </summary>
        private static void OverlayContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            MareMediaElement mareMediaElement = d as MareMediaElement;

            if (mareMediaElement == null)
            {
                return;
            }

            if (mareMediaElement.overlayPresenter == null)
            {
                return;
            }

            mareMediaElement.overlayPresenter.Content = e.NewValue;
        }

        /// <summary>
        /// Initializes WebView2 when the control enters the visual tree.
        /// </summary>
        private async void UserControl_Loaded(object sender, RoutedEventArgs e)
        {
            if (isWebViewInitialized)
            {
                return;
            }

            try
            {
                await webVideo.EnsureCoreWebView2Async();

                if (webVideo.CoreWebView2 != null)
                {
                    webVideo.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
                    isWebViewInitialized = true;

                    LoadSourceWhenReady();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[MareMediaElement INIT ERROR] " + ex);
            }
        }

        /// <summary>
        /// Detaches WebView2 event handlers when the control is unloaded.
        /// </summary>
        private void UserControl_Unloaded(object sender, RoutedEventArgs e)
        {
            // Do not dispose automatically here. WPF can unload/reload controls during layout
            // transitions. Final cleanup is handled by Dispose when VideoPlayer is closed.
        }

        /// <summary>
        /// Starts or resumes playback.
        /// </summary>
        public void Play()
        {
            Console.WriteLine("MareMediaElement Play called.");

            ExecuteVideoScript(
                "if (window.mareVideo) {" +
                "  window.mareVideo.play();" +
                "}"
            );
        }

        /// <summary>
        /// Pauses playback deterministically.
        /// </summary>
        public void Pause()
        {
            ExecuteVideoScript(
                "if (window.mareVideo) {" +
                "  window.mareVideo.pause();" +
                "}"
            );
        }

        /// <summary>
        /// Stops playback and seeks back to the beginning.
        /// </summary>
        public void Stop()
        {
            ExecuteVideoScript(
                "if (window.mareVideo) {" +
                "  window.mareVideo.pause();" +
                "  window.mareVideo.currentTime = 0;" +
                "}"
            );
        }

        /// <summary>
        /// Preserves the existing call surface used by VideoPlayer.
        /// </summary>
        public new bool Focus()
        {
            return base.Focus();
        }

        /// <summary>
        /// Loads the current Source after WebView2 is initialized.
        /// 
        /// WebView2 pages created with NavigateToString do not behave like normal
        /// local file pages. Loading file:/// videos directly from injected HTML can
        /// fail with HTMLMediaElement error code 4. For local files, map the file's
        /// containing folder to a WebView2 virtual host and give the video element an
        /// https:// URL. Remote Jellyfin/http URLs keep their original URL.
        /// </summary>
        private void LoadSourceWhenReady()
        {
            if (source == null)
            {
                return;
            }

            if (!isWebViewInitialized || webVideo.CoreWebView2 == null)
            {
                return;
            }

            string browserVideoUrl = source.AbsoluteUri;

            if (source.IsFile)
            {
                string localFilePath = source.LocalPath;
                string localFolderPath = Path.GetDirectoryName(localFilePath);
                string localFileName = Path.GetFileName(localFilePath);

                if (!String.IsNullOrWhiteSpace(localFolderPath) &&
                    !String.IsNullOrWhiteSpace(localFileName))
                {
                    string virtualHostName = "mare-local-video.local";

                    // The local video folder may change every time the user opens a different
                    // file. Clear the old mapping before applying the mapping for this source.
                    webVideo.CoreWebView2.ClearVirtualHostNameToFolderMapping(virtualHostName);

                    // Allow the injected player page to load the selected local file through a
                    // normal WebView2 web origin instead of a raw file:/// URL.
                    webVideo.CoreWebView2.SetVirtualHostNameToFolderMapping(
                        virtualHostName,
                        localFolderPath,
                        CoreWebView2HostResourceAccessKind.Allow
                    );

                    browserVideoUrl =
                        "https://" +
                        virtualHostName +
                        "/" +
                        Uri.EscapeDataString(localFileName);
                }
            }

            string html = BuildPlayerHtml(browserVideoUrl);
            isHtmlLoaded = false;

            webVideo.NavigateToString(html);
        }

        /// <summary>
        /// Builds the browser video page.
        /// hls.js is used for Jellyfin HLS/transcode URLs.
        /// Direct MP4/file URLs are assigned directly to the video element.
        /// </summary>
        private string BuildPlayerHtml(string videoUrl)
        {
            string escapedVideoUrl = JavaScriptStringEncode(videoUrl);
            string objectFit = GetCssObjectFitForStretch();

            return @"
<!doctype html>
<html>
<head>
    <meta charset='utf-8'>
    <script src='https://cdn.jsdelivr.net/npm/hls.js@latest'></script>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: black;
            overflow: hidden;
        }

        video {
            width: 100vw;
            height: 100vh;
            object-fit: " + objectFit + @";
            background: black;
        }
    </style>
</head>
<body>
    <video id='video' muted playsinline tabindex='-1'></video>

    <script>
        window.mareVideo = document.getElementById('video');

        const video = window.mareVideo;
        const sourceUrl = '" + escapedVideoUrl + @"';

        let callbackCount = 0;
        let hls = null;
        let frameClockStarted = false;

        video.volume = " + requestedVolume.ToString("0.000000", CultureInfo.InvariantCulture) + @";
        video.muted = " + (requestedVolume <= 0.0 ? "true" : "false") + @";
        video.playbackRate = " + requestedSpeedRatio.ToString("0.000000", CultureInfo.InvariantCulture) + @";

        function postMessage(message) {
            if (window.chrome && chrome.webview) {
                chrome.webview.postMessage(message);
            }
        }

        function postStatus(message) {
            postMessage('status|' + message);
        }

        function postMetadata() {
            const duration = Number.isFinite(video.duration) ? video.duration : -1;
            const width = video.videoWidth || -1;
            const height = video.videoHeight || -1;

            postMessage(
                'metadata|' +
                duration + '|' +
                width + '|' +
                height
            );
        }

        function onVideoFrame(now, metadata) {
            callbackCount++;

            const mediaTime = metadata.mediaTime ?? -1;
            const presentedFrames = metadata.presentedFrames ?? -1;
            const expectedDisplayTime = metadata.expectedDisplayTime ?? -1;
            const presentationTime = metadata.presentationTime ?? -1;
            const width = metadata.width ?? video.videoWidth ?? -1;
            const height = metadata.height ?? video.videoHeight ?? -1;

            postMessage(
                'frame|' +
                mediaTime + '|' +
                presentedFrames + '|' +
                expectedDisplayTime + '|' +
                presentationTime + '|' +
                width + '|' +
                height + '|' +
                callbackCount
            );

            video.requestVideoFrameCallback(onVideoFrame);
        }

        function startFrameClockIfAvailable() {
            if (frameClockStarted) {
                return;
            }

            frameClockStarted = true;

            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                postStatus('requestVideoFrameCallback available');
                video.requestVideoFrameCallback(onVideoFrame);
            } else {
                postStatus('requestVideoFrameCallback NOT available');
            }
        }

        function loadVideoSource() {
            postStatus('loading source=' + sourceUrl);

            if (sourceUrl.toLowerCase().includes('.m3u8')) {
                if (Hls.isSupported()) {
                    postStatus('hls.js supported');

                    hls = new Hls({
                        enableWorker: true,
                        lowLatencyMode: false,
                        debug: false
                    });

                    hls.on(Hls.Events.ERROR, function(event, data) {
                        postStatus(
                            'hls.js error type=' + data.type +
                            ' details=' + data.details +
                            ' fatal=' + data.fatal
                        );

                        if (data.fatal) {
                            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                                postStatus('hls.js trying network recovery');
                                hls.startLoad();
                            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                                postStatus('hls.js trying media recovery');
                                hls.recoverMediaError();
                            } else {
                                postStatus('hls.js fatal unrecoverable error');
                                hls.destroy();
                            }
                        }
                    });

                    hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                        postStatus('hls.js manifest parsed levels=' + data.levels.length);
                        //video.play();
                    });

                    hls.attachMedia(video);
                    hls.loadSource(sourceUrl);
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    postStatus('native HLS supported');
                    video.src = sourceUrl;
                } else {
                    postStatus('HLS not supported by hls.js or native video');
                }
            } else {
                postStatus('direct video src');
                video.src = sourceUrl;
            }
        }

        video.addEventListener('loadedmetadata', function() {
            postStatus('loadedmetadata duration=' + video.duration);
            postMetadata();
            startFrameClockIfAvailable();
        });

        video.addEventListener('durationchange', function() {
            postMetadata();
        });

        video.addEventListener('resize', function() {
            postMetadata();
        });

        video.addEventListener('error', function() {
            let errorCode = video.error ? video.error.code : 'unknown';
            postStatus('video error code=' + errorCode);
        });

        video.addEventListener('playing', function() {
            postStatus('playing');
        });

        video.addEventListener('pause', function() {
            postStatus('pause');
        });

        video.addEventListener('seeking', function() {
            postStatus('seeking currentTime=' + video.currentTime.toFixed(6));
        });

        video.addEventListener('seeked', function() {
            postStatus('seeked currentTime=' + video.currentTime.toFixed(6));
        });

        video.addEventListener('timeupdate', function() {
            // Deliberately ignored. timeupdate is coarse and is not our frame clock.
        });

        loadVideoSource();
    </script>
</body>
</html>";
        }

        /// <summary>
        /// Receives frame-clock and metadata messages from the browser video element.
        /// </summary>
        private void CoreWebView2_WebMessageReceived(
            object sender,
            CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message = e.TryGetWebMessageAsString();

            if (String.IsNullOrWhiteSpace(message))
            {
                return;
            }

            string[] parts = message.Split('|');

            if (parts.Length == 0)
            {
                return;
            }

            if (parts[0] == "status")
            {
                HandleStatusMessage(parts);
                return;
            }

            if (parts[0] == "metadata")
            {
                HandleMetadataMessage(parts);
                return;
            }

            if (parts[0] == "frame")
            {
                HandleFrameMessage(parts);
                return;
            }

            Console.WriteLine("[MareMediaElement UNKNOWN MESSAGE] " + message);
        }

        /// <summary>
        /// Handles browser status messages.
        /// </summary>
        private void HandleStatusMessage(string[] parts)
        {
            string status = parts.Length > 1 ? parts[1] : "";

            Console.WriteLine("[MareMediaElement STATUS] " + status);

            if (status.StartsWith("loadedmetadata", StringComparison.OrdinalIgnoreCase))
            {
                isHtmlLoaded = true;

                Dispatcher.BeginInvoke(new Action(delegate
                {
                    RaiseEvent(new RoutedEventArgs(MediaOpenedEvent));
                }));
            }

            if (status.StartsWith("seeking", StringComparison.OrdinalIgnoreCase))
            {
                // Reset diagnostic deltas across seeks so a seek is not misread as a dropped-frame jump.
                lastPresentedFrames = -1;
                lastDisplayedMediaTimeSeconds = -1.0;
            }
        }

        /// <summary>
        /// Handles video duration and natural size updates.
        /// </summary>
        private void HandleMetadataMessage(string[] parts)
        {
            if (parts.Length < 4)
            {
                return;
            }

            latestDurationSeconds = ParseDouble(parts[1]);
            latestNaturalVideoWidth = (int)ParseLong(parts[2]);
            latestNaturalVideoHeight = (int)ParseLong(parts[3]);

            Dispatcher.BeginInvoke(new Action(delegate
            {
                InvalidateMeasure();
                InvalidateVisual();
            }));
        }

        /// <summary>
        /// Handles requestVideoFrameCallback frame messages.
        /// </summary>
        private void HandleFrameMessage(string[] parts)
        {
            if (parts.Length < 8)
            {
                return;
            }

            double mediaTime = ParseDouble(parts[1]);
            long presentedFrames = ParseLong(parts[2]);
            double expectedDisplayTime = ParseDouble(parts[3]);
            double presentationTime = ParseDouble(parts[4]);
            int width = (int)ParseLong(parts[5]);
            int height = (int)ParseLong(parts[6]);
            long callbackCount = ParseLong(parts[7]);

            latestDisplayedMediaTimeSeconds = mediaTime;
            latestPresentedFrames = presentedFrames;

            if (width > 0)
            {
                latestNaturalVideoWidth = width;
            }

            if (height > 0)
            {
                latestNaturalVideoHeight = height;
            }

            long deltaPresentedFrames = lastPresentedFrames >= 0
                ? presentedFrames - lastPresentedFrames
                : 0;

            double deltaMediaTime = lastDisplayedMediaTimeSeconds >= 0
                ? mediaTime - lastDisplayedMediaTimeSeconds
                : 0.0;

            lastPresentedFrames = presentedFrames;
            lastDisplayedMediaTimeSeconds = mediaTime;

            if (callbackCount % 25 == 0)
            {
                Console.WriteLine(
                    "[MareMediaElement FRAME] mediaTime=" +
                    mediaTime.ToString("0.000000", CultureInfo.InvariantCulture) +
                    " presentedFrames=" + presentedFrames +
                    " deltaPresentedFrames=" + deltaPresentedFrames +
                    " deltaMediaTime=" + deltaMediaTime.ToString("0.000000", CultureInfo.InvariantCulture));
            }

            DisplayedFrameChangedEventArgs args = new DisplayedFrameChangedEventArgs(
                TimeSpan.FromSeconds(mediaTime),
                presentedFrames,
                expectedDisplayTime,
                presentationTime,
                width,
                height
            );

            Dispatcher.BeginInvoke(new Action(delegate
            {
                EventHandler<DisplayedFrameChangedEventArgs> handler = DisplayedFrameChanged;

                if (handler != null)
                {
                    handler(this, args);
                }
            }));
        }

        /// <summary>
        /// Executes JavaScript inside the WebView2 page.
        /// </summary>
        private async void ExecuteVideoScript(string script)
        {
            if (!isWebViewInitialized || webVideo.CoreWebView2 == null)
            {
                return;
            }

            try
            {
                await webVideo.ExecuteScriptAsync(script);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[MareMediaElement JS ERROR] " + ex);
            }
        }

        /// <summary>
        /// Clears frame-clock state when a new source is loaded.
        /// </summary>
        private void ResetFrameClockState()
        {
            latestDisplayedMediaTimeSeconds = 0.0;
            latestDurationSeconds = -1.0;
            latestNaturalVideoWidth = 0;
            latestNaturalVideoHeight = 0;
            latestPresentedFrames = -1;
            lastPresentedFrames = -1;
            lastDisplayedMediaTimeSeconds = -1.0;
            isHtmlLoaded = false;
        }

        /// <summary>
        /// Maps WPF Stretch to browser CSS object-fit.
        /// </summary>
        private string GetCssObjectFitForStretch()
        {
            if (Stretch == Stretch.Uniform)
            {
                return "contain";
            }

            if (Stretch == Stretch.UniformToFill)
            {
                return "cover";
            }

            // Existing player uses Stretch.Fill.
            return "fill";
        }

        /// <summary>
        /// Encodes a C# string so it can safely be placed inside a JavaScript string literal.
        /// </summary>
        private static string JavaScriptStringEncode(string value)
        {
            if (value == null)
            {
                return "";
            }

            return value
                .Replace("\\", "\\\\")
                .Replace("'", "\\'")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }

        private static double ParseDouble(string value)
        {
            double result;

            return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out result)
                ? result
                : -1.0;
        }

        private static long ParseLong(string value)
        {
            long result;

            return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result)
                ? result
                : -1;
        }

        /// <summary>
        /// Releases WebView2 resources owned by this control.
        /// </summary>
        public void Dispose()
        {
            if (disposed)
            {
                return;
            }

            disposed = true;

            try
            {
                Pause();
            }
            catch
            {
                // Best-effort shutdown only.
            }

            if (webVideo != null && webVideo.CoreWebView2 != null)
            {
                webVideo.CoreWebView2.WebMessageReceived -= CoreWebView2_WebMessageReceived;
            }

            overlayPresenter.Content = null;
        }

        /// <summary>
        /// WPF-style MediaOpened routed event.
        /// </summary>
        public static readonly RoutedEvent MediaOpenedEvent = EventManager.RegisterRoutedEvent(
            "MediaOpened",
            RoutingStrategy.Bubble,
            typeof(RoutedEventHandler),
            typeof(MareMediaElement));

        /// <summary>
        /// Occurs when media playback has opened.
        /// </summary>
        public event RoutedEventHandler MediaOpened
        {
            add
            {
                AddHandler(MediaOpenedEvent, value);
            }

            remove
            {
                RemoveHandler(MediaOpenedEvent, value);
            }
        }
    }

    /// <summary>
    /// Frame-clock event data from WebView2 requestVideoFrameCallback.
    /// </summary>
    public class DisplayedFrameChangedEventArgs : EventArgs
    {
        public DisplayedFrameChangedEventArgs(
            TimeSpan mediaTime,
            long presentedFrames,
            double expectedDisplayTime,
            double presentationTime,
            int videoWidth,
            int videoHeight)
        {
            MediaTime = mediaTime;
            PresentedFrames = presentedFrames;
            ExpectedDisplayTime = expectedDisplayTime;
            PresentationTime = presentationTime;
            VideoWidth = videoWidth;
            VideoHeight = videoHeight;
        }

        public TimeSpan MediaTime
        {
            get;
            private set;
        }

        public long PresentedFrames
        {
            get;
            private set;
        }

        public double ExpectedDisplayTime
        {
            get;
            private set;
        }

        public double PresentationTime
        {
            get;
            private set;
        }

        public int VideoWidth
        {
            get;
            private set;
        }

        public int VideoHeight
        {
            get;
            private set;
        }
    }
}