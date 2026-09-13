import React from 'react';
import {
  FiCast,
  FiRotateCcw,
  FiRotateCw,
  FiPlay,
  FiX,
  FiHardDrive,
  FiSmartphone,
  FiGlobe,
  FiTv,
  FiSkipBack,
  FiSkipForward,
  FiZap,
  FiSettings,
} from 'react-icons/fi';
import { Tooltip } from '../../components/ui/Tooltip';
import { GuideTour } from '../../components/ui/GuideTour';
import { EmptyState } from '../../components/ui/EmptyState';
import { RemotePairingModal } from '../../components/remote/RemotePairingModal';
import { SkipIntroOverlay } from '../../components/vod/SkipIntroOverlay';

import { usePlayerController } from './usePlayerController';
import { PlayerLoadingState } from './components/PlayerLoadingState';
import { PlayerErrorState } from './components/PlayerErrorState';
import { CastStatusOverlay } from './components/CastStatusOverlay';

export function PlayerPage(): React.JSX.Element {
  const { state, actions } = usePlayerController();

  if (!state.selectedChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] p-4">
        <EmptyState
          icon="📺"
          title="No Channel Selected"
          description="Choose a live channel from the TV Guide or Multiview to start watching."
          primaryAction={{ label: 'Go to TV Guide', onClick: actions.navigateBack }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] bg-black p-4">
      <GuideTour
        tourKey="player-tour"
        steps={[
          {
            element: '#video-player',
            popover: { title: 'Video Player', description: 'This is the main player window.', side: 'bottom' },
          },
          { element: '#play-pause-btn', popover: { title: 'Play/Pause', description: 'Toggle playback here.' } },
          {
            element: '#pip-btn',
            popover: { title: 'Picture in Picture', description: 'Watch while browsing other tabs.' },
          },
        ]}
      />

      <div className="w-full max-w-5xl bg-gray-900 rounded-lg overflow-hidden shadow-2xl relative group">
        {/* Top Header Bar */}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-center">
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
            <h2 className="text-white font-bold text-xl drop-shadow-md truncate">{state.selectedChannel.name}</h2>
            {state.isCasting ? (
              state.isLocalMedia ? (
                <span className="bg-emerald-600/90 text-white text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                  <FiHardDrive className="w-3.5 h-3.5" />
                  <span>Na TV (Mídia Local)</span>
                </span>
              ) : state.isOfflineMedia ? (
                <span className="bg-emerald-600/90 text-white text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                  <FiHardDrive className="w-3.5 h-3.5" />
                  <span>Na TV (Offline)</span>
                </span>
              ) : (
                <span className="bg-indigo-600/90 text-white text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                  <FiTv className="w-3.5 h-3.5" />
                  <span>Na TV (Online)</span>
                </span>
              )
            ) : state.isLocalMedia ? (
              <span className="bg-emerald-600/90 text-white text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                <FiHardDrive className="w-3.5 h-3.5" />
                <span>Mídia Local PC</span>
              </span>
            ) : state.isOfflineMedia ? (
              <span className="bg-emerald-600/90 text-white text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                <FiHardDrive className="w-3.5 h-3.5" />
                <span>Offline Local</span>
              </span>
            ) : (
              <span className="bg-blue-600/80 text-blue-100 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                <FiGlobe className="w-3.5 h-3.5" />
                <span>Streaming Online</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={actions.navigateBack}
            className="text-gray-300 hover:text-white p-1 rounded hover:bg-gray-800 transition"
            title="Close Player"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Loading Overlay */}
        <PlayerLoadingState stage={state.loadingStage} />

        {/* Error Overlay */}
        {state.playbackError && !state.isCasting && (
          <PlayerErrorState
            error={state.playbackError}
            isOfflineMedia={state.isOfflineMedia}
            forceDirect={state.forceDirect}
            onRetry={actions.retryStream}
            onFallbackOnline={actions.fallbackToOnlineStream}
            onToggleDirect={actions.toggleDirectStream}
            onBackToGuide={actions.navigateBack}
          />
        )}

        {/* Casting Screen */}
        {state.isCasting && (
          <CastStatusOverlay
            selectedChannel={state.selectedChannel}
            isLocalMedia={state.isLocalMedia}
            isOfflineMedia={state.isOfflineMedia}
            hasPrevEpisode={state.hasPrevEpisode}
            hasNextEpisode={state.hasNextEpisode}
            currentTime={state.castCurrentTime > 0 ? state.castCurrentTime : state.currentTime}
            duration={
              state.castDuration > 0
                ? state.castDuration
                : (state.duration > 0 ? state.duration : (state.selectedChannel.duration ?? 0))
            }
            isPaused={state.castIsPaused}
            onTogglePlay={actions.togglePlay}
            onSeekToTime={(time) =>
              actions.handleProgressBarChange({
                target: { value: String(time) },
              } as React.ChangeEvent<HTMLInputElement>)
            }
            formatTime={actions.formatTime}
            onSeek={actions.handleSeek}
            onRestart={actions.handleRestart}
            onPlayPrevEpisode={actions.handlePlayPrevEpisode}
            onPlayNextEpisode={actions.handlePlayNextEpisode}
            onStopCasting={actions.stopCasting}
            onRetryCast={actions.requestCastSession}
          />
        )}

        {/* Video Element - kept mounted so videoRef and media states stay stable */}
        <video
          id="video-player"
          ref={state.videoRef}
          crossOrigin="anonymous"
          className={`w-full h-auto aspect-video object-contain bg-black ${state.isCasting ? 'hidden' : 'block'}`}
          onPlay={() => {}}
          onPause={() => {}}
          onTimeUpdate={(e) => actions.handleTimeUpdate(e.currentTarget.currentTime)}
          onLoadedMetadata={actions.handleLoadedMetadata}
          onEnded={actions.handleVideoEnded}
          onDurationChange={(e) => actions.handleDurationChange(e.currentTarget.duration)}
        />

        {/* Resume Prompt Toast */}
        {state.resumePrompt && (
          <div className="absolute top-16 left-4 z-30 bg-gray-900/95 border border-blue-500/50 shadow-2xl rounded-xl p-3.5 flex items-center gap-3.5 backdrop-blur-md animate-fade-in text-white max-w-sm">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <FiRotateCw className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-300">Resume from where you stopped?</p>
              <p className="text-sm font-bold text-white">{state.resumePrompt.formatted}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={actions.handleResumeConfirm}
                className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={actions.handleResumeDismiss}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg transition"
                title="Dismiss"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Skip Intro Overlay */}
        {state.activeIntroSegment &&
          !state.introDismissed &&
          state.currentTime >= state.activeIntroSegment.startSec &&
          state.currentTime < state.activeIntroSegment.endSec && (
            <SkipIntroOverlay
              isVisible={true}
              introEndSec={state.activeIntroSegment.endSec}
              onSkip={actions.handleSkipIntro}
            />
          )}

        {/* Next Episode Countdown Overlay */}
        {state.selectedChannel.nextEpisode && state.nextEpCountdown !== null && (
          <div className="absolute bottom-20 right-4 z-30 bg-gray-950/90 border border-blue-500/60 shadow-2xl rounded-2xl p-4 backdrop-blur-md max-w-xs w-full text-white animate-fade-in transition-all">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Next Episode in {state.nextEpCountdown}s
              </span>
              <button
                type="button"
                onClick={actions.cancelNextEpCountdown}
                className="text-gray-400 hover:text-white p-1 rounded transition -mr-1 -mt-1"
                title="Cancel Auto-play"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm font-semibold text-white line-clamp-1 mb-3">
              {state.selectedChannel.nextEpisode.name}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={actions.handlePlayNextEpisode}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow transition"
              >
                <FiPlay className="w-3.5 h-3.5 fill-current" /> Play Now ({state.nextEpCountdown}s)
              </button>
              <button
                type="button"
                onClick={actions.cancelNextEpCountdown}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Bottom Floating Controls Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
          {/* Progress timeline */}
          {state.selectedChannel.isVod && (() => {
            const effectiveDur = state.isCasting
              ? (state.castDuration > 0 ? state.castDuration : state.duration)
              : state.duration;
            const effectiveCurr = state.isCasting ? state.castCurrentTime : state.currentTime;

            return (
              <div className="flex items-center gap-3 w-full text-xs text-gray-300 font-mono">
                <span>{actions.formatTime(effectiveCurr)}</span>
                {effectiveDur > 0 ? (
                  <input
                    type="range"
                    min="0"
                    max={effectiveDur}
                    step="1"
                    value={effectiveCurr}
                    onChange={actions.handleProgressBarChange}
                    className="w-full accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg appearance-none"
                  />
                ) : (
                  <div className="w-full h-1.5 bg-gray-700/80 rounded-lg overflow-hidden relative">
                    <div className="h-full bg-blue-500/50 animate-pulse w-full" />
                  </div>
                )}
                <span>
                  {effectiveDur > 0 ? actions.formatTime(effectiveDur) : '--:--'}
                </span>
              </div>
            );
          })()}

          <div className="flex items-center justify-between">
            {/* Left Control Group */}
            <div className="flex items-center gap-3 sm:gap-4">
              {state.selectedChannel.isVod && (
                <Tooltip content="Começar do início">
                  <button
                    type="button"
                    onClick={actions.handleRestart}
                    className="text-amber-300 hover:text-amber-200 p-1 transition hover:scale-110 flex items-center justify-center"
                    title="Começar do início"
                  >
                    <FiRotateCcw className="w-5 h-5 text-amber-400" />
                  </button>
                </Tooltip>
              )}

              {state.hasPrevEpisode && (
                <Tooltip content="Episódio anterior">
                  <button
                    type="button"
                    onClick={actions.handlePlayPrevEpisode}
                    className="text-white hover:text-blue-400 p-1 transition hover:scale-110 flex items-center justify-center"
                    title="Episódio anterior"
                  >
                    <FiSkipBack className="w-5 h-5" />
                  </button>
                </Tooltip>
              )}

              <Tooltip content={(state.isCasting ? !state.castIsPaused : state.isPlaying) ? 'Pause' : 'Play'}>
                <button
                  id="play-pause-btn"
                  type="button"
                  onClick={actions.togglePlay}
                  className="text-white hover:text-blue-400 cursor-pointer"
                >
                  {(state.isCasting ? !state.castIsPaused : state.isPlaying) ? (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              </Tooltip>

              {state.hasNextEpisode && (
                <Tooltip content="Próximo episódio">
                  <button
                    type="button"
                    onClick={actions.handlePlayNextEpisode}
                    className="text-white hover:text-blue-400 p-1 transition hover:scale-110 flex items-center justify-center"
                    title="Próximo episódio"
                  >
                    <FiSkipForward className="w-5 h-5" />
                  </button>
                </Tooltip>
              )}

              {state.selectedChannel.isVod && (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Tooltip content="Rewind 10s">
                    <button
                      type="button"
                      onClick={() => actions.handleSeek(-10)}
                      className="text-white hover:text-blue-400 p-1 cursor-pointer"
                    >
                      <FiRotateCcw className="w-5 h-5" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Forward 10s">
                    <button
                      type="button"
                      onClick={() => actions.handleSeek(10)}
                      className="text-white hover:text-blue-400 p-1 cursor-pointer"
                    >
                      <FiRotateCw className="w-5 h-5" />
                    </button>
                  </Tooltip>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Tooltip content={(state.isCasting ? state.castIsMuted : state.isMuted) ? 'Unmute' : 'Mute'}>
                  <button type="button" onClick={actions.toggleMute} className="text-white hover:text-blue-400 cursor-pointer">
                    {(state.isCasting ? state.castIsMuted : state.isMuted) ||
                    (state.isCasting ? state.castVolume : state.volume) === 0 ? (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                          clipRule="evenodd"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                        />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.536 8.464a5 5 0 010 7.072m2.828-9.898a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                        />
                      </svg>
                    )}
                  </button>
                </Tooltip>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={
                    (state.isCasting ? state.castIsMuted : state.isMuted)
                      ? 0
                      : state.isCasting
                      ? state.castVolume
                      : state.volume
                  }
                  onChange={(e) => actions.setVolumeLevel(parseFloat(e.target.value))}
                  className="w-24 accent-blue-500"
                />
              </div>
            </div>

            {/* Right Control Group */}
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Playback Speed Controller */}
              <div className="relative" ref={state.speedMenuRef}>
                <Tooltip content="Velocidade de Reprodução">
                  <button
                    type="button"
                    onClick={() => actions.setIsSpeedMenuOpen(!state.isSpeedMenuOpen)}
                    className={`px-2 py-1 text-xs font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                      state.playbackSpeed !== 1.0
                        ? 'bg-blue-600/30 text-blue-400 border-blue-500/50 shadow-sm'
                        : 'bg-white/10 text-gray-300 border-white/10 hover:text-white hover:bg-white/20'
                    }`}
                    aria-label="Ajustar velocidade de reprodução"
                  >
                    <FiZap
                      className={`w-3.5 h-3.5 ${state.playbackSpeed !== 1.0 ? 'text-amber-400' : 'text-gray-400'}`}
                    />
                    <span>{state.playbackSpeed === 1 ? '1x' : `${state.playbackSpeed.toFixed(2)}x`}</span>
                  </button>
                </Tooltip>

                {state.isSpeedMenuOpen && (
                  <div className="absolute bottom-full mb-3 right-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 w-64 bg-gray-900/95 border border-white/15 shadow-2xl rounded-2xl p-4 backdrop-blur-md text-white z-50 animate-fade-in flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                        <FiZap className="w-3.5 h-3.5 text-amber-400" />
                        Velocidade
                      </span>
                      <span className="text-xs font-bold font-mono text-blue-400 bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 rounded-md">
                        {state.playbackSpeed.toFixed(2)}x
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {[1, 1.25, 1.5, 2].map((rate) => {
                        const isSelected = Math.abs(state.playbackSpeed - rate) < 0.01;
                        return (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => actions.handleSpeedChange(rate)}
                            className={`py-1.5 text-xs font-semibold rounded-lg transition active:scale-95 ${
                              isSelected
                                ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                                : 'bg-white/10 hover:bg-white/15 text-gray-300'
                            }`}
                          >
                            {rate}x
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => actions.handleSpeedChange(state.playbackSpeed - 0.05)}
                        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold flex items-center justify-center text-xs transition"
                        title="Diminuir 0.05x"
                        aria-label="Diminuir velocidade 0.05x"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min="0.25"
                        max="2.00"
                        step="0.05"
                        value={state.playbackSpeed}
                        onChange={(e) => actions.handleSpeedChange(parseFloat(e.target.value))}
                        className="flex-1 accent-blue-500 h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => actions.handleSpeedChange(state.playbackSpeed + 0.05)}
                        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold flex items-center justify-center text-xs transition"
                        title="Aumentar 0.05x"
                        aria-label="Aumentar velocidade 0.05x"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {state.isAvailable && (
                <Tooltip content={state.isCasting ? 'Connected' : 'Cast'}>
                  <button
                    id="cast-btn"
                    type="button"
                    onClick={actions.requestCastSession}
                    className={`hover:text-blue-400 cursor-pointer p-1 ${
                      state.isCasting ? 'text-blue-500' : 'text-white'
                    }`}
                  >
                    <FiCast className="w-6 h-6" />
                  </button>
                </Tooltip>
              )}

              <Tooltip content="Parear Celular (Controle Remoto)">
                <button
                  id="remote-pairing-btn"
                  type="button"
                  onClick={() => actions.setIsPairingModalOpen(true)}
                  className="hover:text-blue-400 cursor-pointer p-1 text-white"
                >
                  <FiSmartphone className="w-6 h-6" />
                </button>
              </Tooltip>

              {/* Settings Menu */}
              <div className="relative" ref={state.settingsMenuRef}>
                <Tooltip content="Configurações">
                  <button
                    type="button"
                    onClick={() => actions.setIsSettingsMenuOpen(!state.isSettingsMenuOpen)}
                    className={`p-1 transition-all ${
                      state.isSettingsMenuOpen ? 'text-blue-400' : 'text-white hover:text-blue-400'
                    }`}
                  >
                    <FiSettings
                      className={`w-6 h-6 ${state.isSettingsMenuOpen ? 'rotate-90' : ''} transition-transform`}
                    />
                  </button>
                </Tooltip>

                {state.isSettingsMenuOpen && (
                  <div className="absolute bottom-full mb-3 right-0 w-64 bg-gray-900/95 border border-white/15 shadow-2xl rounded-2xl p-4 backdrop-blur-md text-white z-50 animate-fade-in flex flex-col gap-4 max-h-96 overflow-y-auto">
                    {/* Audio */}
                    {state.audioTracks.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Áudio</h4>
                        <div className="flex flex-col gap-1">
                          {state.audioTracks.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => actions.changeAudioTrack(t.id)}
                              className={`text-left text-xs py-1.5 px-2 rounded-lg transition ${
                                state.activeAudioTrack === t.id
                                  ? 'bg-blue-600 text-white font-bold'
                                  : 'hover:bg-white/10 text-gray-300'
                              }`}
                            >
                              {t.name || t.lang || `Track ${t.id}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Subtitles */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Legendas</h4>
                        {state.selectedChannel.isVod && (
                          <button
                            type="button"
                            onClick={actions.startTranscription}
                            disabled={Boolean(
                              state.transcriptionJob && state.transcriptionJob.status !== 'failed'
                            )}
                            className="px-2 py-1 text-[10px] font-bold rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {state.transcriptionJob ? (
                              state.transcriptionJob.status === 'extracting_audio'
                                ? 'Extraindo...'
                                : state.transcriptionJob.status === 'transcribing'
                                ? 'Transcrevendo...'
                                : state.transcriptionJob.status === 'completed'
                                ? 'IA Concluída'
                                : state.transcriptionJob.status === 'failed'
                                ? 'Tentar Novamente'
                                : 'Na fila...'
                            ) : (
                              'Gerar via IA'
                            )}
                          </button>
                        )}
                      </div>

                      {state.subtitleTracks.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => actions.changeSubtitleTrack(-1)}
                            className={`text-left text-xs py-1.5 px-2 rounded-lg transition ${
                              state.activeSubtitleTrack === -1
                                ? 'bg-blue-600 text-white font-bold'
                                : 'hover:bg-white/10 text-gray-300'
                            }`}
                          >
                            Desativado
                          </button>
                          {state.subtitleTracks.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => actions.changeSubtitleTrack(t.id)}
                              className={`text-left text-xs py-1.5 px-2 rounded-lg transition ${
                                state.activeSubtitleTrack === t.id
                                  ? 'bg-blue-600 text-white font-bold'
                                  : 'hover:bg-white/10 text-gray-300'
                              }`}
                            >
                              {t.name || t.lang || `Track ${t.id}`}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 italic px-2">Nenhuma legenda disponível</div>
                      )}
                    </div>

                    {/* Quality */}
                    {state.videoLevels.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                          Qualidade
                        </h4>
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => actions.changeVideoLevel(-1)}
                            className={`text-left text-xs py-1.5 px-2 rounded-lg transition ${
                              state.activeVideoLevel === -1
                                ? 'bg-blue-600 text-white font-bold'
                                : 'hover:bg-white/10 text-gray-300'
                            }`}
                          >
                            Automático
                          </button>
                          {state.videoLevels.map((l, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => actions.changeVideoLevel(index)}
                              className={`text-left text-xs py-1.5 px-2 rounded-lg transition ${
                                state.activeVideoLevel === index
                                  ? 'bg-blue-600 text-white font-bold'
                                  : 'hover:bg-white/10 text-gray-300'
                              }`}
                            >
                              {l.height}p {l.bitrate ? `(${(l.bitrate / 1000000).toFixed(1)} Mbps)` : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {state.audioTracks.length === 0 &&
                      state.subtitleTracks.length === 0 &&
                      state.videoLevels.length === 0 && (
                        <div className="text-xs text-gray-400 text-center py-2">
                          Nenhuma opção disponível para esta mídia.
                        </div>
                      )}
                  </div>
                )}
              </div>

              <Tooltip content={state.isPip ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}>
                <button
                  id="pip-btn"
                  type="button"
                  onClick={actions.togglePip}
                  className="text-white hover:text-blue-400 cursor-pointer"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 3H3a2 2 0 00-2 2v14a2 2 0 002 2h18a2 2 0 002-2V5a2 2 0 00-2-2zm-9 11h7v4h-7v-4z"
                    />
                  </svg>
                </button>
              </Tooltip>

              <Tooltip content="Fullscreen">
                <button
                  type="button"
                  onClick={actions.toggleFullscreen}
                  className="text-white hover:text-blue-400 cursor-pointer"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                    />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      <RemotePairingModal
        isOpen={state.isPairingModalOpen}
        onClose={() => actions.setIsPairingModalOpen(false)}
      />
    </div>
  );
}
