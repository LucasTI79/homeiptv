/**
 * cast.js
 * Manages all Google Cast related functionality.
 */

import { showNotification } from './ui.js';
import { UIElements, guideState, appState } from './state.js';
import { stopStream } from './api.js';

const APPLICATION_ID = 'CC1AD845'; // Default Media Receiver App ID

// The Chromecast receiver fetches media URLs itself, directly over the LAN -
// it does NOT go through the sender's browser, so it is not bound by the
// sender page's mixed-content rules. Point it straight at the app's own
// plain-HTTP port instead of the (possibly self-signed HTTPS) page origin,
// so the TV never has to validate a certificate it doesn't trust.
const CAST_MEDIA_PORT = 8998;

/**
 * Converts a stream URL (relative, or absolute on our own origin) into the
 * URL the Chromecast receiver should fetch: our own plain-HTTP app port,
 * never the HTTPS page origin. External provider URLs are passed through.
 */
export function toCastMediaUrl(streamUrl) {
    if (!streamUrl.startsWith('http')) {
        return `http://${window.location.hostname}:${CAST_MEDIA_PORT}${streamUrl}`;
    }
    try {
        const parsed = new URL(streamUrl);
        if (parsed.hostname === window.location.hostname) {
            parsed.protocol = 'http:';
            parsed.port = String(CAST_MEDIA_PORT);
            return parsed.toString();
        }
    } catch (e) {
        // Not a parseable URL; fall through and use it as-is.
    }
    return streamUrl;
}

export const castState = {
    isAvailable: false,
    isCasting: false,
    session: null,
    player: null,
    playerController: null,
    currentMedia: null,
    currentCastStreamUrl: null, // Track the current Cast stream URL for cleanup
    // VOD seek support: our /stream endpoint re-encodes from scratch on every
    // request, so the receiver's own currentTime only reflects elapsed time
    // within the CURRENT ffmpeg segment. To seek we add that elapsed time to
    // the offset the segment itself started at, then reload from the new sum.
    currentIsVod: false,
    currentVodBaseUrl: null,
    currentVodSeekBase: 0,
    currentVodDuration: null, // Known real duration (seconds), preserved across seeks
    currentVodName: null,
    currentVodLogo: null,
    localPlayerState: {
        streamUrl: null,
        name: null,
        logo: null,
        isVod: false,
        originalUrl: null,
        userAgentId: null
    }
};

/**
 * Stops a Cast stream on the server by sending a stop request.
 * @param {string} streamUrl - The stream URL to stop.
 */
async function stopCastStream(streamUrl) {
    try {
        console.log(`[CAST] Sending stop request for Cast stream: ${streamUrl}`);
        const activeCastProfileId = guideState.settings?.activeCastProfileId || 'cast-default';
        const response = await fetch('/api/stream/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: streamUrl, profileId: activeCastProfileId })
        });

        if (response.ok) {
            console.log('[CAST] Cast stream stopped successfully on server.');
        } else {
            console.warn('[CAST] Failed to stop Cast stream on server:', response.status);
        }
    } catch (error) {
        console.error('[CAST] Error stopping Cast stream:', error);
    }
}

/**
 * Stores the details of the currently playing local media.
 * This is called from player.js whenever a channel starts playing locally.
 * @param {string} streamUrl - The URL of the stream.
 * @param {string} name - The name of the channel.
 * @param {string} logo - The URL for the channel's logo.
 * @param {string} originalUrl - The original stream URL (for stopping server stream).
 * @param {string} profileId - The profile ID (for stopping server stream).
 * @param {boolean} isVod - Whether this is VOD content (enables seek) vs. a live channel.
 * @param {string} userAgentId - The user agent ID used for playback (for duration probing).
 */
export function setLocalPlayerState(streamUrl, name, logo, originalUrl = null, profileId = null, isVod = false, userAgentId = null) {
    castState.localPlayerState.streamUrl = streamUrl;
    castState.localPlayerState.name = name;
    castState.localPlayerState.logo = logo;
    castState.localPlayerState.userAgentId = userAgentId;
    castState.localPlayerState.originalUrl = originalUrl;
    castState.localPlayerState.profileId = profileId;
    castState.localPlayerState.isVod = isVod;
    console.log(`[CAST] Local player state updated: ${name}`);
}

/**
 * Initializes the Google Cast API and sets up listeners.
 * THIS IS NO LONGER CALLED DIRECTLY. It's wrapped in the __onGCastApiAvailable callback.
 */
function initializeCastApi() {
    console.log('[CAST] Cast SDK is available. Initializing context...');
    const castContext = cast.framework.CastContext.getInstance();
    castContext.setOptions({
        receiverApplicationId: APPLICATION_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
    });

    castContext.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        handleSessionStateChange
    );

    castState.player = new cast.framework.RemotePlayer();
    castState.playerController = new cast.framework.RemotePlayerController(castState.player);
    castState.playerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        handleRemotePlayerConnectionChange
    );
    castState.playerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
        updatePlayerUI
    );
}

// --- FINAL FIX ---
// This is the official callback provided by the Google Cast SDK.
// It will be executed automatically by the SDK script once it has fully loaded and is ready.
// We wrap our entire initialization logic in here to prevent timing issues.
window['__onGCastApiAvailable'] = (isAvailable) => {
    if (isAvailable) {
        castState.isAvailable = true;
        initializeCastApi();
    } else {
        console.warn('[CAST] Cast SDK is not available on this device.');
        castState.isAvailable = false;
        // Optionally hide the cast button if the SDK is not available at all
        if (UIElements.castBtn) {
            UIElements.castBtn.style.display = 'none';
        }
    }
};


/**
 * Handles changes in the Cast session state.
 * @param {chrome.cast.SessionStateEventData} event - The session state event.
 */
function handleSessionStateChange(event) {
    console.log(`[CAST] Session state changed: ${event.sessionState}`);
    const castContext = cast.framework.CastContext.getInstance();
    castState.session = castContext.getCurrentSession(); // Update session reference

    switch (event.sessionState) {
        case cast.framework.SessionState.SESSION_STARTED:
        case cast.framework.SessionState.SESSION_RESUMED:
            castState.isCasting = true;
            showNotification(`Casting to ${castState.session.getCastDevice().friendlyName}`, false, 4000);

            // Auto-cast if local player is active and not already casting
            if (castState.localPlayerState.streamUrl && !castState.currentMedia) {
                console.log('[CAST] Automatically casting local content after session start.');

                // CRITICAL FIX: Stop the server-side stream FIRST
                const { originalUrl, profileId } = castState.localPlayerState;
                if (originalUrl && profileId) {
                    console.log(`[CAST] Stopping server stream: ${originalUrl} with profile ${profileId}`);
                    stopStream(originalUrl, profileId).catch(err => {
                        console.error('[CAST] Error stopping server stream:', err);
                    });
                }

                // CRITICAL FIX: Stop the local player before casting
                if (appState.player) {
                    console.log('[CAST] Stopping local player before casting.');
                    appState.player.destroy();
                    appState.player = null;
                    // Clear the video element
                    if (UIElements.videoElement) {
                        UIElements.videoElement.src = "";
                        UIElements.videoElement.removeAttribute('src');
                        UIElements.videoElement.load();
                    }
                }

                const { streamUrl, name, logo, isVod, userAgentId } = castState.localPlayerState;
                const absoluteUrl = toCastMediaUrl(streamUrl);
                if (isVod && originalUrl) {
                    probeVodDuration(originalUrl, userAgentId).then(duration => {
                        loadMedia(absoluteUrl, name, logo, isVod, 0, duration);
                    });
                } else {
                    loadMedia(absoluteUrl, name, logo, isVod);
                }
            }
            break;
        case cast.framework.SessionState.SESSION_ENDED:
            console.log('[CAST] Session ended, stopping Cast stream on server.');
            // Stop the Cast stream on the server
            if (castState.currentCastStreamUrl) {
                stopCastStream(castState.currentCastStreamUrl);
                castState.currentCastStreamUrl = null;
            }
            castState.session = null;
            castState.isCasting = false;
            castState.currentMedia = null;
            castState.currentIsVod = false;
            castState.currentVodBaseUrl = null;
            castState.currentVodSeekBase = 0;
            showNotification('Casting session ended.', false, 4000);
            updatePlayerUI();
            break;
        case cast.framework.SessionState.NO_SESSION:
            castState.session = null;
            castState.isCasting = false;
            castState.currentMedia = null;
            castState.currentIsVod = false;
            castState.currentVodBaseUrl = null;
            castState.currentVodSeekBase = 0;
            updatePlayerUI();
            break;
    }
}

/**
 * Handles changes in the remote player's connection status and updates the UI.
 */
function handleRemotePlayerConnectionChange() {
    updatePlayerUI();
}

/**
 * Updates the local player modal UI based on the casting state.
 */
function updatePlayerUI() {
    const videoElement = UIElements.videoElement;
    const castStatusDiv = UIElements.castStatus;
    const castBtn = UIElements.castBtn;
    const castControls = UIElements.castControls;

    if (castState.isCasting && castState.player.isConnected) {
        videoElement.classList.add('hidden');
        castStatusDiv.classList.remove('hidden');
        castStatusDiv.classList.add('flex');

        UIElements.castStatusText.textContent = `Casting to ${castState.session.getCastDevice().friendlyName}`;
        UIElements.castStatusChannel.textContent = castState.player.mediaInfo ? castState.player.mediaInfo.metadata.title : 'No media loaded.';

        // Add class to our custom button to indicate connected state
        if (castBtn) castBtn.classList.add('cast-connected');

        // Playback controls: play/pause always available once media is loaded,
        // seek only makes sense for VOD (live channels have nothing to seek to).
        if (castControls) {
            const hasMedia = !!castState.player.mediaInfo;
            castControls.classList.toggle('hidden', !hasMedia);
            castControls.classList.toggle('flex', hasMedia);
            if (UIElements.castRewindBtn) UIElements.castRewindBtn.classList.toggle('hidden', !castState.currentIsVod);
            if (UIElements.castForwardBtn) UIElements.castForwardBtn.classList.toggle('hidden', !castState.currentIsVod);
            if (UIElements.castPlayPauseBtn) {
                UIElements.castPlayPauseBtn.textContent = castState.player.isPaused ? '▶' : '⏸';
            }
        }

    } else {
        videoElement.classList.remove('hidden');
        castStatusDiv.classList.add('hidden');
        castStatusDiv.classList.remove('flex');

        // Remove connected state class
        if (castBtn) castBtn.classList.remove('cast-connected');
        if (castControls) {
            castControls.classList.add('hidden');
            castControls.classList.remove('flex');
        }
    }
}


/**
 * Probes a VOD source's real duration server-side (ffprobe), so the Cast
 * receiver can show accurate progress instead of estimating from whatever
 * it has buffered so far. Resolves to null (not rejects) on any failure so
 * callers can just proceed without a duration.
 * @param {string} sourceUrl - The original, un-proxied VOD content URL.
 * @param {string} userAgentId - User agent ID to probe with (some providers require it).
 */
export async function probeVodDuration(sourceUrl, userAgentId) {
    try {
        const params = new URLSearchParams({ url: sourceUrl });
        if (userAgentId) params.set('userAgentId', userAgentId);
        // Don't let a slow/unreachable provider stall the cast start for long.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const response = await fetch(`/api/vod/duration?${params}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) return null;
        const { duration } = await response.json();
        return typeof duration === 'number' && duration > 0 ? duration : null;
    } catch (error) {
        console.warn('[CAST] Duration probe failed, proceeding without it:', error);
        return null;
    }
}

/**
 * Loads a media stream onto the connected Cast device.
 * @param {string} url - The URL of the stream (without startTime baked in).
 * @param {string} name - The name of the channel.
 * @param {string} logo - The URL of the channel's logo.
 * @param {boolean} isVod - Whether this is VOD content (enables seek controls).
 * @param {number} seekSeconds - Absolute position (seconds) to start the VOD from.
 * @param {number|null} durationSeconds - Known real duration, if probed.
 */
export async function loadMedia(url, name, logo, isVod = false, seekSeconds = 0, durationSeconds = null) {
    if (!castState.session) {
        showNotification('Not connected to a Cast device.', true);
        return;
    }

    console.log(`[CAST] Loading media: "${name}" from URL: ${url}`);

    // ONLY modify URL to use cast profile if NOT already using it
    // This ensures we switch to the active cast profile for Chromecast
    const activeCastProfileId = guideState.settings?.activeCastProfileId || 'cast-default';
    let castUrl = url;
    if (!url.includes(`profileId=${activeCastProfileId}`)) {
        if (url.includes('profileId=')) {
            // Replace existing profileId with active cast profile
            castUrl = url.replace(/profileId=[^&]+/, `profileId=${activeCastProfileId}`);
            console.log(`[CAST] Replaced profile with ${activeCastProfileId}`);
        } else {
            // Add cast profile
            const separator = url.includes('?') ? '&' : '?';
            castUrl = `${url}${separator}profileId=${activeCastProfileId}`;
            console.log(`[CAST] Added ${activeCastProfileId} profile`);
        }
    }

    // Seeking re-encodes from a new offset server-side (see /stream's `startTime`
    // handling), since the piped ffmpeg output has no byte-range seek support.
    if (isVod && seekSeconds > 0) {
        const separator = castUrl.includes('?') ? '&' : '?';
        castUrl = `${castUrl}${separator}startTime=${seekSeconds}`;
        console.log(`[CAST] Requesting VOD start offset: ${seekSeconds}s`);
    }

    // Generate and append cast authentication token
    try {
        console.log('[CAST] Requesting authentication token...');
        const response = await fetch('/api/cast/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamUrl: url })
        });

        if (!response.ok) {
            throw new Error(`Token generation failed: ${response.status}`);
        }

        const { token } = await response.json();
        const separator = castUrl.includes('?') ? '&' : '?';
        castUrl = `${castUrl}${separator}castToken=${token}`;

        console.log('[CAST] Authentication token added to URL');
    } catch (error) {
        console.error('[CAST] Failed to generate cast token:', error);
        showNotification('Failed to generate cast authentication token', true);
        return;
    }

    console.log(`[CAST] Cast URL ready for Chromecast`);

    // Use video/mp4 instead of video/mp2t for Chromecast compatibility
    const mediaInfo = new chrome.cast.media.MediaInfo(castUrl, 'video/mp4');
    // BUFFERED enables the receiver's native on-TV seek bar/controls for VOD.
    // Our /stream endpoint pipes a fresh, fragmented ffmpeg encode with no
    // duration metadata of its own (empty_moov, unbounded output) - every
    // load/seek restarts encoding from 0, so we tell the receiver the
    // duration of what's LEFT from this offset (total - seekSeconds), not
    // the full episode length. Without a probed duration it falls back to
    // the receiver's own (wrong, growing) estimate.
    mediaInfo.streamType = isVod ? chrome.cast.media.StreamType.BUFFERED : chrome.cast.media.StreamType.LIVE;
    if (isVod && typeof durationSeconds === 'number' && durationSeconds > 0) {
        mediaInfo.duration = Math.max(1, durationSeconds - seekSeconds);
    }
    mediaInfo.metadata = new chrome.cast.media.TvShowMediaMetadata();
    mediaInfo.metadata.title = name;
    if (logo) {
        mediaInfo.metadata.images = [new chrome.cast.Image(logo)];
    }

    const request = new chrome.cast.media.LoadRequest(mediaInfo);

    castState.session.loadMedia(request).then(
        () => {
            console.log('[CAST] Media loaded successfully.');
            castState.currentMedia = castState.session.getMediaSession();
            castState.currentCastStreamUrl = url; // Track for cleanup
            castState.currentIsVod = isVod;
            castState.currentVodBaseUrl = url;
            castState.currentVodSeekBase = seekSeconds;
            castState.currentVodDuration = durationSeconds;
            castState.currentVodName = name;
            castState.currentVodLogo = logo;
            updatePlayerUI();
        },
        (errorCode) => {
            console.error('[CAST] Error loading media:', errorCode);
            showNotification('Failed to load media on Cast device. Check console.', true);
        }
    );
}

/**
 * Toggles play/pause on the currently casting device.
 */
export function toggleCastPlayPause() {
    if (castState.playerController) {
        castState.playerController.playOrPause();
    }
}

/**
 * Seeks VOD content by reloading the stream from a new absolute offset.
 * Our /stream endpoint re-encodes from scratch each request (no byte-range
 * seek support in the piped ffmpeg output), so "seeking" means: figure out
 * where we actually are (segment start offset + elapsed time in that
 * segment), add the delta, and start a fresh transcode from there.
 * @param {number} deltaSeconds - Positive to skip forward, negative to rewind.
 */
export async function seekCastMedia(deltaSeconds) {
    if (!castState.isCasting || !castState.currentIsVod || !castState.currentVodBaseUrl) {
        return;
    }
    const elapsedInSegment = castState.player?.currentTime || 0;
    const newAbsolute = Math.max(0, castState.currentVodSeekBase + elapsedInSegment + deltaSeconds);
    console.log(`[CAST] Seeking ${deltaSeconds > 0 ? '+' : ''}${deltaSeconds}s -> absolute ${newAbsolute.toFixed(1)}s`);
    await loadMedia(castState.currentVodBaseUrl, castState.currentVodName, castState.currentVodLogo, true, newAbsolute, castState.currentVodDuration);
}

/**
 * Ends the entire Cast session, disconnecting from the device.
 */
export function endCastSession() {
    if (castState.session) {
        castState.session.endSession(true); // true to stop any playing media
    }
}
