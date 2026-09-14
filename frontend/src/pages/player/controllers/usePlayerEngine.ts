import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import mpegts from 'mpegts.js';
import Hls from 'hls.js';
import { toast } from 'react-hot-toast';
import type { SelectedChannel } from '../../../store/uiStore';
import type { PlayerLoadingStage, PlayerErrorInfo, AudioTrackOption, SubtitleTrackOption, VideoLevelOption } from '../types';
import { getDownloadTask, removeDownloadTask } from '../../../services/db';
import { getDownloadedFile, deleteDownloadedFile } from '../../../services/opfsStorage';

export interface PlayerEngineConfigSettings {
  readonly activeStreamProfileId?: string;
  readonly activeUserAgentId?: string;
  readonly vodPlaybackEngine?: string;
  readonly streamProfiles?: readonly { readonly id: string; readonly command: string }[];
}

export interface PlayerEngineController {
  readonly isOfflineMedia: boolean;
  readonly isLocalMedia: boolean;
  readonly loadingStage: PlayerLoadingStage;
  readonly playbackError: PlayerErrorInfo | null;
  readonly forceDirect: boolean;
  readonly hlsRef: RefObject<Hls | null>;
  readonly playerRef: RefObject<mpegts.Player | null>;
  readonly retryStream: () => void;
  readonly toggleDirectStream: () => void;
  readonly fallbackToOnlineStream: () => void;
  readonly clearError: () => void;
}

export function usePlayerEngine(
  selectedChannel: SelectedChannel | null,
  configSettings: PlayerEngineConfigSettings | undefined,
  videoRef: RefObject<HTMLVideoElement | null>,
  setVideoLevels: (levels: readonly VideoLevelOption[]) => void,
  setActiveVideoLevel: (level: number) => void,
  setAudioTracks: (tracks: readonly AudioTrackOption[]) => void,
  setActiveAudioTrack: (track: number) => void,
  setSubtitleTracks: (tracks: readonly SubtitleTrackOption[]) => void,
  setActiveSubtitleTrack: (track: number | string) => void
): PlayerEngineController {
  const [loadingStage, setLoadingStage] = useState<PlayerLoadingStage>('idle');
  const [playbackError, setPlaybackError] = useState<PlayerErrorInfo | null>(null);
  const [forceDirect, setForceDirect] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isOfflineMedia, setIsOfflineMedia] = useState(false);

  const hlsRef = useRef<Hls | null>(null);
  const playerRef = useRef<mpegts.Player | null>(null);

  const isLocalMedia = Boolean(
    selectedChannel?.isLocal ||
      selectedChannel?.url?.startsWith('/api/local-media') ||
      selectedChannel?.originalUrl?.startsWith('/api/local-media')
  );

  const clearError = useCallback(() => {
    setPlaybackError(null);
  }, []);

  const retryStream = useCallback(() => {
    setPlaybackError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  const toggleDirectStream = useCallback(() => {
    setPlaybackError(null);
    setForceDirect((prev) => !prev);
  }, []);

  const fallbackToOnlineStream = useCallback(() => {
    setPlaybackError(null);
    setIsOfflineMedia(false);
    setRetryNonce((n) => n + 1);
  }, []);

  // Automatically dismiss loading state when video actually starts playback or buffers,
  // and provide auto-recovery on transient network drops
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let networkRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    let networkRetryCount = 0;

    const handlePlaying = () => {
      networkRetryCount = 0;
      setLoadingStage('idle');
    };

    const handleCanPlay = () => {
      setLoadingStage('idle');
    };

    const handleTimeUpdate = () => {
      if (video.currentTime > 0) {
        setLoadingStage((prev) => (prev !== 'idle' ? 'idle' : prev));
      }
    };

    const handleWaiting = () => {
      if (!video.paused && !video.ended && video.readyState < 3) {
        setLoadingStage('buffering');
      }
    };

    const handleError = () => {
      const err = video.error;
      if (!err) return;

      console.warn('[PlayerEngine] Video element error encountered:', err.code, err.message);

      // MediaError.MEDIA_ERR_NETWORK = 2 (network error during range fetch)
      if (err.code === 2 && networkRetryCount < 3) {
        networkRetryCount += 1;
        const resumePos = video.currentTime;
        setLoadingStage('buffering');
        console.log(
          `[PlayerEngine] Transient network drop detected. Auto-recovering (attempt ${networkRetryCount}/3) at ${resumePos}s...`
        );

        networkRetryTimeout = setTimeout(() => {
          if (!videoRef.current) return;
          const v = videoRef.current;
          v.load();
          const onLoaded = () => {
            v.removeEventListener('loadedmetadata', onLoaded);
            if (resumePos > 0) {
              v.currentTime = resumePos;
            }
            void Promise.resolve(v.play()).catch(() => {});
          };
          v.addEventListener('loadedmetadata', onLoaded);
        }, 1500 * networkRetryCount);
      }
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleError);

    return () => {
      if (networkRetryTimeout) {
        clearTimeout(networkRetryTimeout);
      }
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleError);
    };
  }, [videoRef]);

  useEffect(() => {
    if (!selectedChannel || !configSettings) {
      setLoadingStage('idle');
      return;
    }

    setPlaybackError(null);
    setLoadingStage('checking_cache');

    const profileId = configSettings.activeStreamProfileId;
    const userAgentId = configSettings.activeUserAgentId;
    const profile = (configSettings.streamProfiles ?? []).find((p) => p.id === profileId);

    if (!profileId || !userAgentId || !profile) {
      console.error('[PlayerEngine] Missing active profile or user agent.');
      setLoadingStage('idle');
      return;
    }

    const isVod = Boolean(selectedChannel.isVod);
    const vodEngine = configSettings.vodPlaybackEngine ?? 'native';
    const useNativeVod = isVod && vodEngine === 'native';

    const isLocalApiUrl = selectedChannel.url.startsWith('/api/');

    const streamUrlToPlay = isLocalApiUrl
      ? selectedChannel.url
      : useNativeVod
      ? `/api/media-proxy?url=${encodeURIComponent(selectedChannel.url)}`
      : forceDirect || profile.command === 'redirect'
      ? selectedChannel.url
      : `/stream?url=${encodeURIComponent(selectedChannel.url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

    let isCancelled = false;
    let localBlobUrl: string | null = null;

    async function initPlayback() {
      const channel = selectedChannel;
      if (!channel) return;

      const playOnlineMedia = () => {
        if (isCancelled || !videoRef.current) return;
        setIsOfflineMedia(false);
        setLoadingStage('loading_stream');

        const isM3u8 = streamUrlToPlay.includes('.m3u8');

        if (isM3u8 && Hls.isSupported() && videoRef.current) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
          });
          hlsRef.current = hls;

          hls.loadSource(streamUrlToPlay);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            setLoadingStage('idle');
            setVideoLevels(data.levels ?? []);
            setActiveVideoLevel(hls.currentLevel);

            setAudioTracks(hls.audioTracks ?? []);
            setActiveAudioTrack(hls.audioTrack);

            setSubtitleTracks(hls.subtitleTracks ?? []);
            setActiveSubtitleTrack(hls.subtitleTrack);

            void Promise.resolve(videoRef.current?.play()).catch((e: unknown) => {
              if (e instanceof Error && e.name === 'AbortError') return;
              console.error('[PlayerEngine] HLS play error:', e);
            });
          });

          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
            setActiveAudioTrack(data.id);
          });

          hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
            setActiveSubtitleTrack(data.id);
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
            setActiveVideoLevel(data.level);
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError();
                  break;
                default:
                  hls.destroy();
                  setPlaybackError({
                    message: `HLS fatal error: ${data.details}`,
                    details: 'Falha irrecuperável de rede ou decodificação do fluxo HLS.',
                    canRetry: true,
                    canFallbackOnline: false,
                    canToggleTranscoder: true,
                  });
                  setLoadingStage('idle');
                  break;
              }
            }
          });

          return;
        }

        if (useNativeVod && videoRef.current) {
          const video = videoRef.current;
          video.src = streamUrlToPlay;
          video.load();
          setLoadingStage('buffering');

          void Promise.resolve(video.play())
            .then(() => {
              setLoadingStage('idle');
            })
            .catch((e: unknown) => {
            if (e instanceof Error && e.name === 'AbortError') {
              return;
            }
            console.error('[PlayerEngine] Native VOD play error', e);

            if (isLocalApiUrl && !streamUrlToPlay.includes('transcode=1')) {
              const fallbackUrl = `${streamUrlToPlay}${streamUrlToPlay.includes('?') ? '&' : '?'}transcode=1`;
              console.log('[PlayerEngine] Retrying local media with transcode=1 fallback:', fallbackUrl);
              video.src = fallbackUrl;
              video.load();
              void Promise.resolve(video.play())
                .then(() => {
                  setLoadingStage('idle');
                })
                .catch((fallbackErr: unknown) => {
                console.error('[PlayerEngine] Transcoding fallback play error:', fallbackErr);
                setPlaybackError({
                  message: 'Não foi possível reproduzir este formato de vídeo no navegador.',
                  details: 'O codec de áudio ou vídeo deste arquivo não é suportado nativamente pelo navegador.',
                  canRetry: true,
                  canFallbackOnline: false,
                  canToggleTranscoder: true,
                });
                setLoadingStage('idle');
              });
            } else {
              setPlaybackError({
                message: 'Erro ao iniciar reprodução nativa de VOD.',
                details: e instanceof Error ? e.message : 'Falha desconhecida no carregamento do stream.',
                canRetry: true,
                canFallbackOnline: false,
                canToggleTranscoder: true,
              });
              setLoadingStage('idle');
            }
          });
          return;
        }

        if (mpegts.isSupported() && videoRef.current) {
          const player = mpegts.createPlayer(
            {
              type: 'mse',
              isLive: !isVod,
              url: streamUrlToPlay,
            },
            {
              enableStashBuffer: true,
              stashInitialSize: isVod ? 1024 : 128,
              liveBufferLatencyChasing: !isVod ? false : undefined,
            }
          );

          playerRef.current = player;

          player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
            console.warn('[PlayerEngine] mpegts error:', errorType, errorDetail);
            setPlaybackError({
              message: 'Stream playback error encountered.',
              details: `${errorType}: ${errorDetail}`,
              canRetry: true,
              canFallbackOnline: false,
              canToggleTranscoder: true,
            });
            setLoadingStage('idle');
          });

          player.attachMediaElement(videoRef.current);
          player.load();
          setLoadingStage('buffering');

          void Promise.resolve(player.play())
            .then(() => {
              setLoadingStage('idle');
            })
            .catch((e: unknown) => {
            if (e instanceof Error && e.name === 'AbortError') {
              return;
            }
            console.error('[PlayerEngine] Play error', e);
          });
        }
      };

      // Check if media is saved in OPFS
      if (isVod && videoRef.current) {
        let fileName = channel.offlineFileName;
        let matchedTaskId: string | null = null;
        if (!fileName) {
          const candidateIds = [
            channel.id,
            `movie_${channel.id}`,
            channel.seriesContext
              ? `${channel.seriesContext.seriesId}_s${channel.seriesContext.season}_e${channel.seriesContext.episodeIndex}`
              : null,
          ].filter((id): id is string => typeof id === 'string' && id.length > 0);

          for (const cid of candidateIds) {
            const task = await getDownloadTask(cid);
            if (task && task.status === 'completed') {
              fileName = task.fileName;
              matchedTaskId = task.id;
              break;
            }
          }
        }

        if (fileName) {
          const localFile = await getDownloadedFile(fileName);
          if (localFile && !isCancelled && videoRef.current) {
            localBlobUrl = URL.createObjectURL(localFile);
            setIsOfflineMedia(true);
            const video = videoRef.current;
            video.src = localBlobUrl;
            video.load();
            setLoadingStage('buffering');

            let hasFallenBack = false;
            const fallbackToOnline = (err?: unknown) => {
              if (hasFallenBack || isCancelled) return;
              hasFallenBack = true;
              console.warn(
                '[PlayerEngine] Erro ao reproduzir mídia baixada localmente, fazendo fallback para stream remoto:',
                err
              );
              toast.error('Arquivo baixado corrompido ou incompleto. Reproduzindo via streaming online.');
              if (fileName) {
                deleteDownloadedFile(fileName).catch(() => {});
              }
              if (matchedTaskId) {
                removeDownloadTask(matchedTaskId).catch(() => {});
              }
              if (localBlobUrl) {
                URL.revokeObjectURL(localBlobUrl);
                localBlobUrl = null;
              }
              playOnlineMedia();
            };

            video.onerror = () => {
              fallbackToOnline(video.error);
            };

            void Promise.resolve(video.play())
              .then(() => {
                setLoadingStage('idle');
              })
              .catch((e: unknown) => {
              if (e instanceof Error && e.name === 'AbortError') {
                return;
              }
              console.error('[PlayerEngine] Offline VOD play error', e);
              fallbackToOnline(e);
            });
            return;
          }
        }
      }

      playOnlineMedia();
    }

    void initPlayback().catch((err: unknown) => {
      console.warn('[PlayerEngine] Playback initialization error:', err);
      setLoadingStage('idle');
      setPlaybackError({
        message: 'Falha ao inicializar o player de mídia.',
        details: err instanceof Error ? err.message : String(err),
        canRetry: true,
        canFallbackOnline: true,
        canToggleTranscoder: true,
      });
    });

    const videoEl = videoRef.current;

    return () => {
      isCancelled = true;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
        localBlobUrl = null;
      }
      if (videoEl) {
        try {
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
        } catch {
          // Ignore pause on unmounted element
        }
      }
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // Ignore teardown error
        }
        hlsRef.current = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          playerRef.current.unload();
          playerRef.current.detachMediaElement();
          playerRef.current.destroy();
        } catch {
          // Ignore teardown error
        }
        playerRef.current = null;
      }
    };
  }, [
    selectedChannel,
    configSettings,
    forceDirect,
    retryNonce,
    videoRef,
    setVideoLevels,
    setActiveVideoLevel,
    setAudioTracks,
    setActiveAudioTrack,
    setSubtitleTracks,
    setActiveSubtitleTrack,
  ]);

  return {
    isOfflineMedia,
    isLocalMedia,
    loadingStage,
    playbackError,
    forceDirect,
    hlsRef,
    playerRef,
    retryStream,
    toggleDirectStream,
    fallbackToOnlineStream,
    clearError,
  };
}
