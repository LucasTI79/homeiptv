import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { generateCastToken, stopCastStreamOnServer } from '../../api/cast';
import { probeVodDuration } from '../../api/vod';
import { useConfig } from '../../api/guide';
import { toast } from 'react-hot-toast';

const APPLICATION_ID = 'CC1AD845';
const CAST_MEDIA_PORT = 8998;

export function toCastMediaUrl(streamUrl: string) {
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
    // fallback
  }
  return streamUrl;
}

interface CastContextType {
  isAvailable: boolean;
  isCasting: boolean;
  isConnected: boolean;
  isPaused: boolean;
  castCurrentTime: number;
  castDuration: number;
  castVolume: number;
  castIsMuted: boolean;
  currentMedia: chrome.cast.media.Media | null;
  loadMedia: (
    url: string,
    name: string,
    logo: string,
    isVod?: boolean,
    originalUrl?: string,
    seekSeconds?: number
  ) => Promise<void>;
  requestSession: () => Promise<void>;
  togglePlayPause: () => void;
  seekMedia: (deltaSeconds: number) => void;
  seekToTime: (targetSeconds: number) => void;
  setCastVolume: (volume: number) => void;
  toggleCastMute: () => void;
  stopCasting: () => void;
}

const CastContext = createContext<CastContextType | null>(null);

export const CastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: config } = useConfig();
  const settings = config?.settings;
  const [isAvailable, setIsAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [castCurrentTime, setCastCurrentTime] = useState(0);
  const [castDuration, setCastDuration] = useState(0);
  const [castVolume, setCastVolumeState] = useState(1);
  const [castIsMuted, setCastIsMuted] = useState(false);
  const [currentMedia, setCurrentMedia] = useState<chrome.cast.media.Media | null>(null);

  const castSessionRef = useRef<cast.framework.CastSession | null>(null);
  const castPlayerRef = useRef<cast.framework.RemotePlayer | null>(null);
  const castControllerRef = useRef<cast.framework.RemotePlayerController | null>(null);

  // Tracking current cast state
  const currentCastState = useRef({
    streamUrl: null as string | null,
    isVod: false,
    baseUrl: null as string | null,
    name: null as string | null,
    logo: null as string | null,
    seekBase: 0,
    duration: null as number | null,
  });

  // Keep-alive references to prevent background tab sleep / throttling in Chromium & Edge
  const keepAliveAudioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Maintain active background status while casting so the browser never suspends the tab
  useEffect(() => {
    if (isCasting) {
      // 1. Silent keep-alive audio loop:
      // Browsers (Edge, Chrome, Safari) strictly exempt any tab playing audio from Sleeping Tabs & background throttling.
      try {
        if (!keepAliveAudioRef.current) {
          // Minimal valid 1-second silent WAV base64
          const silentWav = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
          const audio = new Audio(silentWav);
          audio.loop = true;
          audio.volume = 0.001; // tiny volume so browser registers active media playback
          keepAliveAudioRef.current = audio;
        }
        keepAliveAudioRef.current.play().catch(() => {});
      } catch {}

      // 2. Screen Wake Lock API
      const requestWakeLock = async () => {
        try {
          if ('wakeLock' in navigator && !wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            wakeLockRef.current.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          }
        } catch {}
      };
      requestWakeLock();

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && isCasting && !wakeLockRef.current) {
          requestWakeLock();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else {
      // Stop keep-alive audio
      if (keepAliveAudioRef.current) {
        try {
          keepAliveAudioRef.current.pause();
          keepAliveAudioRef.current.currentTime = 0;
        } catch {}
      }
      // Release wake lock
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release().catch(() => {});
          wakeLockRef.current = null;
        } catch {}
      }
    }
  }, [isCasting]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (keepAliveAudioRef.current) {
        try {
          keepAliveAudioRef.current.pause();
        } catch {}
      }
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release().catch(() => {});
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    // If the Cast SDK was already loaded before this component mounted:
    if (window.cast?.framework) {
      setIsAvailable(true);
      initializeCastApi();
    }

    // Add global callback for cast framework
    window.__onGCastApiAvailable = (available: boolean) => {
      setIsAvailable(available);
      if (available) {
        initializeCastApi();
      }
    };

    return () => {
      if (window.__onGCastApiAvailable) {
        delete window.__onGCastApiAvailable;
      }
    };
  }, []);

  const initializeCastApi = () => {
    if (!cast?.framework) return;

    const castContext = cast.framework.CastContext.getInstance();
    castContext.setOptions({
      receiverApplicationId: APPLICATION_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    castContext.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      handleSessionStateChange
    );

    castPlayerRef.current = new cast.framework.RemotePlayer();
    castControllerRef.current = new cast.framework.RemotePlayerController(castPlayerRef.current);

    castControllerRef.current.addEventListener(
      cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
      () => {
        setIsConnected(!!castPlayerRef.current?.isConnected);
      }
    );

    castControllerRef.current.addEventListener(
      cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
      () => {
        setIsPaused(!!castPlayerRef.current?.isPaused);
      }
    );

    castControllerRef.current.addEventListener(
      cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
      () => {
        setCastCurrentTime(castPlayerRef.current?.currentTime || 0);
      }
    );

    castControllerRef.current.addEventListener(
      cast.framework.RemotePlayerEventType.DURATION_CHANGED,
      () => {
        setCastDuration(castPlayerRef.current?.duration || 0);
      }
    );

    castControllerRef.current.addEventListener(
      cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
      () => {
        setCastVolumeState(castPlayerRef.current?.volumeLevel ?? 1);
      }
    );

    castControllerRef.current.addEventListener(
      cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED,
      () => {
        setCastIsMuted(!!castPlayerRef.current?.isMuted);
      }
    );
  };

  const handleSessionStateChange = (event: cast.framework.SessionStateEventData) => {
    const castContext = cast.framework.CastContext.getInstance();
    const session = castContext.getCurrentSession();
    castSessionRef.current = session;

    const SessionState = cast.framework.SessionState;

    switch (event.sessionState) {
      case SessionState.SESSION_STARTED:
      case SessionState.SESSION_RESUMED:
        setIsCasting(true);
        if (session) {
          toast.success(`Casting to ${session.getCastDevice().friendlyName}`);
        }
        break;
      case SessionState.SESSION_ENDED:
        handleSessionEnd();
        break;
      case SessionState.NO_SESSION:
        handleSessionEnd();
        break;
    }
  };

  const handleSessionEnd = () => {
    if (currentCastState.current.streamUrl) {
      stopCastStreamOnServer(currentCastState.current.streamUrl, settings?.activeCastProfileId || 'cast-default');
    }
    setIsCasting(false);
    setIsConnected(false);
    setIsPaused(false);
    setCastCurrentTime(0);
    setCastDuration(0);
    setCurrentMedia(null);
    currentCastState.current = { streamUrl: null, isVod: false, baseUrl: null, name: null, logo: null, seekBase: 0, duration: null };
  };

  const requestSession = useCallback(async () => {
    console.log('[CAST] requestSession called.');
    if (!window.cast?.framework) {
      console.warn('[CAST] Cast framework is not available on window.');
      toast.error('Cast framework is not available.');
      return;
    }
    try {
      console.log('[CAST] Getting CastContext instance...');
      const castContext = window.cast.framework.CastContext.getInstance();
      console.log('[CAST] Calling castContext.requestSession()...');
      const result = await castContext.requestSession();
      console.log('[CAST] castContext.requestSession() completed:', result);
    } catch (err) {
      console.log('[CAST] requestSession caught error/cancel:', err);
      if (err !== 'cancel') {
        console.error('Error requesting cast session:', err);
        toast.error('Could not initiate Cast session.');
      }
    }
  }, []);

  const stopCasting = useCallback(() => {
    if (castSessionRef.current) {
      castSessionRef.current.endSession(true);
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (castControllerRef.current) {
      castControllerRef.current.playOrPause();
    }
  }, []);

  const loadMedia = useCallback(
    async (url: string, name: string, logo: string, isVod = false, originalUrl?: string, seekSeconds = 0) => {
      if (!castSessionRef.current) {
        toast.error('Not connected to a Cast device.');
        return;
      }

      const activeCastProfileId = settings?.activeCastProfileId || 'cast-default';
      let castUrl = url;

      if (!url.includes(`profileId=${activeCastProfileId}`)) {
        if (url.includes('profileId=')) {
          castUrl = url.replace(/profileId=[^&]+/, `profileId=${activeCastProfileId}`);
        } else {
          castUrl = `${url}${url.includes('?') ? '&' : '?'}profileId=${activeCastProfileId}`;
        }
      }

      if (isVod && seekSeconds > 0) {
        castUrl = `${castUrl}${castUrl.includes('?') ? '&' : '?'}startTime=${seekSeconds}`;
      }

      try {
        const { token } = await generateCastToken(url);
        castUrl = `${castUrl}${castUrl.includes('?') ? '&' : '?'}castToken=${token}`;
      } catch (err) {
        toast.error('Failed to generate cast token');
        return;
      }

      const absoluteUrl = toCastMediaUrl(castUrl);

      let durationSeconds: number | null = null;
      if (isVod && originalUrl) {
        durationSeconds = await probeVodDuration(originalUrl, settings?.activeUserAgentId);
      }


      const mediaInfo = new chrome.cast.media.MediaInfo(absoluteUrl, 'video/mp4');

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

      try {
        await castSessionRef.current.loadMedia(request);
        setCurrentMedia(castSessionRef.current.getMediaSession());
        currentCastState.current = {
          streamUrl: url,
          isVod,
          baseUrl: url,
          name,
          logo,
          seekBase: seekSeconds,
          duration: durationSeconds,
        };
      } catch (err) {
        toast.error('Failed to load media on Cast device.');
      }
    },
    [settings]
  );

  const setCastVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    if (castPlayerRef.current && castControllerRef.current) {
      castPlayerRef.current.volumeLevel = clamped;
      castControllerRef.current.setVolumeLevel();
    } else if (castSessionRef.current) {
      castSessionRef.current.setVolume(clamped);
    }
    setCastVolumeState(clamped);
  }, []);

  const toggleCastMute = useCallback(() => {
    if (castControllerRef.current) {
      castControllerRef.current.muteOrUnmute();
    } else if (castSessionRef.current) {
      const isMuted = castSessionRef.current.isMute();
      castSessionRef.current.setMute(!isMuted);
    }
    setCastIsMuted((prev) => !prev);
  }, []);

  const seekToTime = useCallback(
    (targetSeconds: number) => {
      if (!isCasting) return;
      const media = castSessionRef.current?.getMediaSession();
      if (castPlayerRef.current && castControllerRef.current) {
        castPlayerRef.current.currentTime = targetSeconds;
        castControllerRef.current.seek();
        setCastCurrentTime(targetSeconds);
      } else if (media) {
        const seekReq = new chrome.cast.media.SeekRequest();
        seekReq.currentTime = targetSeconds;
        media.seek(
          seekReq,
          () => setCastCurrentTime(targetSeconds),
          (err) => console.warn('Cast seek error', err)
        );
      }
    },
    [isCasting]
  );

  const seekMedia = useCallback(
    (deltaSeconds: number) => {
      if (!isCasting) return;
      const curr = castPlayerRef.current?.currentTime ?? castCurrentTime;
      const dur = castPlayerRef.current?.duration ?? castDuration;
      const target = Math.max(0, dur > 0 ? Math.min(dur, curr + deltaSeconds) : curr + deltaSeconds);
      seekToTime(target);
    },
    [isCasting, castCurrentTime, castDuration, seekToTime]
  );

  return (
    <CastContext.Provider
      value={{
        isAvailable,
        isCasting,
        isConnected,
        isPaused,
        castCurrentTime,
        castDuration,
        castVolume,
        castIsMuted,
        currentMedia,
        loadMedia,
        requestSession,
        togglePlayPause,
        seekMedia,
        seekToTime,
        setCastVolume,
        toggleCastMute,
        stopCasting,
      }}
    >
      {children}
    </CastContext.Provider>
  );
};

export function useCast() {
  const context = useContext(CastContext);
  if (!context) {
    throw new Error('useCast must be used within a CastProvider');
  }
  return context;
}
