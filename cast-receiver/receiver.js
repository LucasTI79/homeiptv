/**
 * ViniPlay Custom Web Receiver
 * Uses Google Cast Application Framework (CAF) v1.0
 */

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

const splashElement = document.getElementById('splash');

function showSplash() {
  if (splashElement) {
    splashElement.classList.remove('hidden');
  }
}

function hideSplash() {
  if (splashElement) {
    splashElement.classList.add('hidden');
  }
}

// 1. Configure Receiver Options
const options = new cast.framework.CastReceiverOptions();

// CRITICAL: Extend inactivity timeout to 3600 seconds (1 hour) to prevent
// Chromecast from shutting down when the stream is paused or waiting for playback.
options.maxInactivity = 3600;

options.supportedCommands =
  cast.framework.messages.Command.ALL_BASIC_MEDIA |
  cast.framework.messages.Command.SEEK |
  cast.framework.messages.Command.STREAM_VOLUME |
  cast.framework.messages.Command.STREAM_MUTE;

// 2. Playback Configuration & Buffering Tolerance
const playbackConfig = new cast.framework.PlaybackConfig();
// Allow network retries for transient stream drops
playbackConfig.manifestRequestHandler = (requestInfo) => {
  requestInfo.timeoutInterval = 30000;
};
playbackConfig.segmentRequestHandler = (requestInfo) => {
  requestInfo.timeoutInterval = 30000;
};

// 3. Message Interceptors
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    console.log('[ViniPlay Receiver] Intercepted LOAD request:', loadRequestData);

    // Hide idle splash screen as media begins loading
    hideSplash();

    if (loadRequestData.media) {
      // Ensure autoplay
      loadRequestData.autoplay = true;

      // Ensure proper stream type if missing
      if (!loadRequestData.media.streamType) {
        const url = (loadRequestData.media.contentUrl || loadRequestData.media.contentId || '').toLowerCase();
        if (url.includes('.m3u8') || url.includes('/stream?')) {
          loadRequestData.media.streamType = cast.framework.messages.StreamType.LIVE;
        } else {
          loadRequestData.media.streamType = cast.framework.messages.StreamType.BUFFERED;
        }
      }
    }

    return loadRequestData;
  }
);

// 4. Lifecycle & Player Event Listeners
playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_STATE_CHANGED,
  (event) => {
    console.log('[ViniPlay Receiver] Player State Changed:', event.playerState);
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.MEDIA_STATUS,
  (event) => {
    const mediaStatus = event.mediaStatus;
    if (mediaStatus && mediaStatus.playerState === cast.framework.messages.PlayerState.IDLE) {
      console.log('[ViniPlay Receiver] Player entered IDLE state (reason:', mediaStatus.idleReason, ')');
      // If playback stopped or finished, restore the idle splash screen
      showSplash();
    }
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.ERROR,
  (event) => {
    console.error('[ViniPlay Receiver] Playback Error Event:', event);
  }
);

// 5. Start CAF Receiver
context.start(options);
console.log('[ViniPlay Receiver] Initialized with maxInactivity: 3600s.');
