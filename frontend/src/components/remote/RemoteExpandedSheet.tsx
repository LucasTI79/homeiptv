import React, { useState } from 'react';
import {
  FiX,
  FiPlay,
  FiPause,
  FiRotateCcw,
  FiRotateCw,
  FiSkipForward,
  FiVolume2,
  FiVolumeX,
  FiTv,
  FiSliders,
  FiNavigation,
  FiPower,
} from 'react-icons/fi';
import { useRemoteStore } from '../../store/remoteStore';
import { RemoteDpadView } from './RemoteDpadView';

interface RemoteExpandedSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RemoteExpandedSheet: React.FC<RemoteExpandedSheetProps> = ({ isOpen, onClose }) => {
  const { remoteNowPlaying, sendCommand, disconnect } = useRemoteStore();
  const [activeTab, setActiveTab] = useState<'media' | 'dpad'>('media');

  if (!isOpen) return null;

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(20);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_PLAY_PAUSE' });
  };

  const handleSeekDelta = (deltaSeconds: number) => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_SEEK', payload: { deltaSeconds } });
  };

  const handleSeekSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const positionSeconds = parseFloat(e.target.value);
    sendCommand({ type: 'COMMAND_SEEK', payload: { positionSeconds } });
  };

  const handleSkipIntro = () => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_SKIP_INTRO' });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const setVolume = parseFloat(e.target.value);
    sendCommand({ type: 'COMMAND_VOLUME', payload: { setVolume } });
  };

  const handleToggleMute = () => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_VOLUME', payload: { toggleMute: true } });
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  const duration = remoteNowPlaying?.duration || 0;
  const currentTime = remoteNowPlaying?.currentTime || 0;
  const isPaused = remoteNowPlaying?.isPaused ?? true;
  const volume = remoteNowPlaying?.volume ?? 1;
  const isMuted = remoteNowPlaying?.isMuted ?? false;
  const canSkipIntro = remoteNowPlaying?.introDetection?.canSkip;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-h-[92vh] bg-neutral-900 border-t border-neutral-800 rounded-t-3xl flex flex-col overflow-hidden shadow-2xl">
        {/* Drag Handle Bar */}
        <div className="w-12 h-1.5 bg-neutral-700 rounded-full mx-auto mt-3 mb-2" />

        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-neutral-800/80">
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
            <FiTv className="w-4 h-4" />
            <span>Transmitindo na TV</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDisconnect}
              className="px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors flex items-center gap-1.5"
              title="Desconectar da TV"
            >
              <FiPower className="w-3.5 h-3.5" />
              <span>Desconectar</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              aria-label="Fechar"
            >
              <FiX className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex px-6 pt-3 gap-2 border-b border-neutral-800">
          <button
            onClick={() => setActiveTab('media')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'media'
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <FiSliders className="w-4 h-4" />
            <span>Reprodução</span>
          </button>
          <button
            onClick={() => setActiveTab('dpad')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'dpad'
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <FiNavigation className="w-4 h-4" />
            <span>Controle Remoto</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="overflow-y-auto flex-1 p-6">
          {activeTab === 'dpad' ? (
            <RemoteDpadView />
          ) : (
            <div className="flex flex-col items-center max-w-sm mx-auto text-white">
              {/* Media Poster / Logo */}
              <div className="w-48 h-48 rounded-2xl bg-neutral-800 flex items-center justify-center overflow-hidden shadow-2xl mb-6 border border-neutral-700/50">
                {remoteNowPlaying?.logo ? (
                  <img
                    src={remoteNowPlaying.logo}
                    alt={remoteNowPlaying.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <FiTv className="w-16 h-16 text-neutral-600" />
                )}
              </div>

              {/* Title & Subtitle */}
              <div className="text-center w-full mb-6">
                <h3 className="text-xl font-bold truncate">
                  {remoteNowPlaying?.title || 'Nenhum vídeo em reprodução'}
                </h3>
                {remoteNowPlaying?.subtitle && (
                  <p className="text-sm text-neutral-400 mt-1">{remoteNowPlaying.subtitle}</p>
                )}
              </div>

              {/* Skip Intro Button (If Detected by Video Intelligence) */}
              {canSkipIntro && (
                <button
                  onClick={handleSkipIntro}
                  className="mb-6 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 active:scale-98 text-black font-bold shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 transition-all animate-pulse"
                >
                  <FiSkipForward className="w-5 h-5" />
                  <span>Pular Abertura</span>
                </button>
              )}

              {/* Time Scrubber Slider (VOD) */}
              {duration > 0 && (
                <div className="w-full mb-6">
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    step="1"
                    value={currentTime}
                    onChange={handleSeekSlider}
                    className="w-full accent-primary-500 h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs font-mono text-neutral-400 mt-2">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
              )}

              {/* Playback Controls */}
              <div className="flex items-center justify-center gap-6 mb-8">
                {duration > 0 && (
                  <button
                    onClick={() => handleSeekDelta(-10)}
                    className="p-3 text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-full transition-colors active:scale-95"
                    aria-label="Voltar 10 segundos"
                  >
                    <FiRotateCcw className="w-7 h-7" />
                  </button>
                )}

                <button
                  onClick={handlePlayPause}
                  className="w-18 h-18 rounded-full bg-primary-600 hover:bg-primary-500 active:scale-95 text-white shadow-xl shadow-primary-600/30 flex items-center justify-center transition-all"
                  aria-label={isPaused ? 'Reproduzir' : 'Pausar'}
                >
                  {isPaused ? <FiPlay className="w-9 h-9 ml-1" /> : <FiPause className="w-9 h-9" />}
                </button>

                {duration > 0 && (
                  <button
                    onClick={() => handleSeekDelta(30)}
                    className="p-3 text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-full transition-colors active:scale-95"
                    aria-label="Avançar 30 segundos"
                  >
                    <FiRotateCw className="w-7 h-7" />
                  </button>
                )}
              </div>

              {/* Volume Slider */}
              <div className="w-full flex items-center gap-3 bg-neutral-800/60 p-3.5 rounded-2xl border border-neutral-800">
                <button
                  onClick={handleToggleMute}
                  className="text-neutral-400 hover:text-white p-1"
                >
                  {isMuted || volume === 0 ? (
                    <FiVolumeX className="w-5 h-5 text-rose-400" />
                  ) : (
                    <FiVolume2 className="w-5 h-5" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-full accent-primary-500 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
