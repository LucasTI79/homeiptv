import React, { useState } from 'react';
import type { SelectedChannel } from '../../../store/uiStore';
import {
  FiCast,
  FiRotateCcw,
  FiRotateCw,
  FiSkipBack,
  FiSkipForward,
  FiHardDrive,
  FiTv,
  FiHelpCircle,
  FiRefreshCw,
  FiPlay,
  FiPause,
} from 'react-icons/fi';

interface CastStatusOverlayProps {
  readonly selectedChannel: SelectedChannel;
  readonly isLocalMedia: boolean;
  readonly isOfflineMedia: boolean;
  readonly hasPrevEpisode: boolean;
  readonly hasNextEpisode: boolean;
  readonly currentTime?: number;
  readonly duration?: number;
  readonly isPaused?: boolean;
  readonly onTogglePlay?: () => void;
  readonly onSeekToTime?: (targetTime: number) => void;
  readonly formatTime?: (seconds: number) => string;
  readonly onSeek: (deltaSeconds: number) => void;
  readonly onRestart: () => void;
  readonly onPlayPrevEpisode: () => void;
  readonly onPlayNextEpisode: () => void;
  readonly onStopCasting: () => void;
  readonly onRetryCast?: () => void;
}

export function CastStatusOverlay({
  selectedChannel,
  isLocalMedia,
  isOfflineMedia,
  hasPrevEpisode,
  hasNextEpisode,
  currentTime = 0,
  duration = 0,
  isPaused = false,
  onTogglePlay,
  onSeekToTime,
  formatTime,
  onSeek,
  onRestart,
  onPlayPrevEpisode,
  onPlayNextEpisode,
  onStopCasting,
  onRetryCast,
}: CastStatusOverlayProps): React.JSX.Element {
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);

  return (
    <div className="w-full aspect-video bg-gray-950 flex flex-col items-center justify-center text-white p-6 relative overflow-hidden select-none">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-950/20 via-transparent to-black/60 pointer-events-none" />

      <FiCast className="w-16 h-16 text-blue-500 mb-4 animate-pulse relative z-10" />
      <h2 className="text-2xl font-bold relative z-10 tracking-wide">Transmitindo na TV</h2>
      <p className="text-gray-300 mt-1 relative z-10 font-medium line-clamp-1 max-w-lg text-center">
        {selectedChannel.name}
      </p>

      <div className="relative z-10 mt-2.5">
        {isLocalMedia ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium shadow-sm">
            <FiHardDrive className="w-3.5 h-3.5" /> Transmitindo na TV (Mídia Local do PC)
          </span>
        ) : isOfflineMedia ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium shadow-sm">
            <FiHardDrive className="w-3.5 h-3.5" /> Transmitindo na TV (Download Offline Local)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium shadow-sm">
            <FiTv className="w-3.5 h-3.5" /> Transmitindo na TV (Streaming Online via Provedor)
          </span>
        )}
      </div>

      {/* Progress timeline on Cast Screen */}
      {selectedChannel.isVod && (
        <div className="w-full max-w-md mt-4 px-4 py-3 bg-gray-900/80 border border-gray-800 rounded-2xl flex flex-col gap-2 relative z-10 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between text-xs font-mono text-gray-300">
            <span>{formatTime ? formatTime(currentTime) : '00:00'}</span>
            <span className="text-gray-400 font-semibold">
              {duration > 0 ? (formatTime ? formatTime(duration) : String(duration)) : '--:--'}
            </span>
          </div>

          {duration > 0 ? (
            <input
              type="range"
              min="0"
              max={duration}
              step="1"
              value={currentTime}
              onChange={(e) => onSeekToTime?.(parseFloat(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer h-2 bg-gray-700 rounded-lg appearance-none transition"
            />
          ) : (
            <div className="w-full h-2 bg-gray-700/80 rounded-lg overflow-hidden relative">
              <div className="h-full bg-blue-500/50 animate-pulse w-full" />
            </div>
          )}
        </div>
      )}

      {selectedChannel.isVod && (
        <div className="flex items-center gap-2 mt-4 flex-wrap justify-center relative z-10">
          {onTogglePlay && (
            <button
              type="button"
              onClick={onTogglePlay}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
              title={isPaused ? 'Reproduzir' : 'Pausar'}
            >
              {isPaused ? <FiPlay className="w-3.5 h-3.5" /> : <FiPause className="w-3.5 h-3.5" />}
              {isPaused ? 'Play' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onSeek(-10)}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
            title="Voltar 10 segundos"
          >
            <FiRotateCcw className="w-3.5 h-3.5" /> -10s
          </button>
          <button
            type="button"
            onClick={() => onSeek(-5)}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
            title="Voltar 5 segundos"
          >
            <FiRotateCcw className="w-3.5 h-3.5" /> -5s
          </button>
          <button
            type="button"
            onClick={() => onSeek(5)}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
            title="Avançar 5 segundos"
          >
            <FiRotateCw className="w-3.5 h-3.5" /> +5s
          </button>
          <button
            type="button"
            onClick={() => onSeek(10)}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
            title="Avançar 10 segundos"
          >
            <FiRotateCw className="w-3.5 h-3.5" /> +10s
          </button>

          <button
            type="button"
            onClick={onRestart}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
            title="Começar do início"
          >
            <FiRotateCcw className="w-3.5 h-3.5" /> Do início
          </button>

          {hasPrevEpisode && (
            <button
              type="button"
              onClick={onPlayPrevEpisode}
              className="px-2.5 py-1.5 bg-blue-900/40 hover:bg-blue-800 text-blue-200 border border-blue-500/30 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
              title="Episódio anterior"
            >
              <FiSkipBack className="w-3.5 h-3.5" /> Ep. Anterior
            </button>
          )}

          {hasNextEpisode && (
            <button
              type="button"
              onClick={onPlayNextEpisode}
              className="px-2.5 py-1.5 bg-blue-900/40 hover:bg-blue-800 text-blue-200 border border-blue-500/30 rounded-lg flex items-center gap-1 text-xs font-semibold shadow transition active:scale-95"
              title="Próximo episódio"
            >
              <FiSkipForward className="w-3.5 h-3.5" /> Próximo Ep.
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-6 relative z-10">
        <button
          type="button"
          onClick={onStopCasting}
          className="px-5 py-2 bg-red-600 hover:bg-red-500 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
        >
          Desconectar Transmissão
        </button>

        {onRetryCast && (
          <button
            type="button"
            onClick={onRetryCast}
            className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-white/10 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition active:scale-95"
            title="Reconectar mídia na TV"
          >
            <FiRefreshCw className="w-3.5 h-3.5" />
            <span>Reconectar</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowTroubleshooting((prev) => !prev)}
          className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white rounded-xl transition"
          title="Ajuda com Transmissão"
        >
          <FiHelpCircle className="w-4 h-4" />
        </button>
      </div>

      {showTroubleshooting && (
        <div className="mt-4 p-4 max-w-md bg-gray-900/90 border border-white/10 rounded-2xl text-left text-xs text-gray-300 space-y-2 relative z-10 animate-fade-in backdrop-blur-md">
          <h4 className="font-bold text-white flex items-center gap-1.5 text-xs">
            <FiHelpCircle className="w-4 h-4 text-blue-400" /> Dicas para Transmissão no Chromecast / Smart TV:
          </h4>
          <ul className="list-disc list-inside space-y-1 text-gray-300 text-[11px] leading-relaxed">
            <li>O Chromecast e este dispositivo devem estar na mesma rede Wi-Fi / LAN local.</li>
            <li>A TV se conecta diretamente à porta 8999 do servidor local (HTTP sem certificado).</li>
            <li>Se a tela ficar preta na TV, clique em <strong>Reconectar</strong> ou selecione a mídia novamente.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
