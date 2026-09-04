import React, { useState } from 'react';
import { FiTv, FiPlay, FiPause, FiWifiOff, FiHardDrive, FiGlobe } from 'react-icons/fi';
import { useRemoteStore } from '../../store/remoteStore';
import { RemoteExpandedSheet } from './RemoteExpandedSheet';

export const RemoteNowPlayingBar: React.FC = () => {
  const { isPaired, role, remoteNowPlaying, connectionStatus, sendCommand } = useRemoteStore();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Only render on client devices that are paired
  if (!isPaired || role !== 'client') {
    return null;
  }

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(20);
    }
  };

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic();
    sendCommand({ type: 'COMMAND_PLAY_PAUSE' });
  };

  const isPaused = remoteNowPlaying?.isPaused ?? true;
  const progressPercent =
    remoteNowPlaying && remoteNowPlaying.duration > 0
      ? Math.min(100, (remoteNowPlaying.currentTime / remoteNowPlaying.duration) * 100)
      : 0;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="Abrir controles do controle remoto"
        onClick={() => setIsSheetOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsSheetOpen(true);
          }
        }}
        className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-6 sm:w-96 bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-2xl p-3 shadow-2xl z-40 flex items-center gap-3 cursor-pointer hover:border-neutral-700 transition-all active:scale-[0.99]"
      >
        {/* Thumbnail / Channel Icon */}
        <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center overflow-hidden flex-shrink-0 border border-neutral-700/50">
          {remoteNowPlaying?.logo ? (
            <img
              src={remoteNowPlaying.logo}
              alt={remoteNowPlaying.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <FiTv className="w-5 h-5 text-primary-400" />
          )}
        </div>

        {/* Title & Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              Na TV
            </span>
            {remoteNowPlaying?.isOffline ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-600/90 text-white flex items-center gap-1 shadow-xs">
                <FiHardDrive className="w-2.5 h-2.5" /> Offline Local
              </span>
            ) : remoteNowPlaying?.isCasting ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-indigo-600/90 text-white flex items-center gap-1 shadow-xs">
                <FiTv className="w-2.5 h-2.5" /> Na TV (Online)
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-600/80 text-blue-100 flex items-center gap-1 shadow-xs">
                <FiGlobe className="w-2.5 h-2.5" /> Online Playlist
              </span>
            )}
            {connectionStatus === 'reconnecting' && (
              <span className="text-[10px] text-amber-400 flex items-center gap-1">
                <FiWifiOff className="w-3 h-3" /> Reconectando...
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate text-white">
            {remoteNowPlaying?.title || 'Conectado à TV'}
          </p>
        </div>

        {/* Quick Play/Pause Button */}
        <button
          onClick={handlePlayPause}
          className="w-10 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 active:scale-95 text-white flex items-center justify-center shadow-lg transition-transform flex-shrink-0"
          aria-label={isPaused ? 'Reproduzir na TV' : 'Pausar na TV'}
        >
          {isPaused ? <FiPlay className="w-5 h-5 ml-0.5" /> : <FiPause className="w-5 h-5" />}
        </button>

        {/* Progress Bar line at the very bottom */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-800">
            <div
              className="h-full bg-primary-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      <RemoteExpandedSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
      />
    </>
  );
};
